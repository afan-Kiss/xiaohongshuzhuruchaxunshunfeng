#!/usr/bin/env node
/** 探测订单卡片/ API 中的退款退货字段 */
const CDP = require('chrome-remote-interface');
const EXPR = `(function(){
  function walk(obj, fn, d) {
    if (!obj || d > 10) return;
    if (Array.isArray(obj)) { obj.forEach(function(x){ walk(x, fn, d+1); }); return; }
    if (typeof obj === 'object') { fn(obj); Object.values(obj).forEach(function(x){ walk(x, fn, d+1); }); }
  }
  var cards = Array.from(document.querySelectorAll('.order-card')).slice(0, 5);
  var dom = cards.map(function(card) {
    var id = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    var text = (card.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300);
    var refundEls = Array.from(card.querySelectorAll('[class*="refund"],[class*="return"],[class*="after"],[class*="售后"],[class*="退货"],[class*="退款"]')).map(function(el){
      return { cls: String(el.className||'').slice(0,60), text: (el.textContent||'').trim().slice(0,80) };
    });
    return { id: id, text: text, refundEls: refundEls };
  });
  var apiKeys = [];
  if (window.__qsfRefundKeyLog) apiKeys = window.__qsfRefundKeyLog;
  return { cardCount: cards.length, dom: dom, apiKeys: apiKeys.slice(-30) };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  for (const page of list.filter((p) => /dashboard/.test(p.url || ''))) {
    console.log('\n===', page.title, '===');
    const c = await CDP({ target: page.webSocketDebuggerUrl });
    await c.Runtime.evaluate({
      expression: `(function(){
        if (window.__qsfRefundHooked) return;
        window.__qsfRefundHooked = true;
        window.__qsfRefundKeyLog = [];
        var re = /refund|return|after.?sale|售后|退货|退款|cancel|reverse/i;
        function scan(obj, url) {
          if (!obj || typeof obj !== 'object') return;
          function walk(o, d) {
            if (!o || d > 8) return;
            if (Array.isArray(o)) { o.forEach(function(x){ walk(x, d+1); }); return; }
            if (typeof o === 'object') {
              for (var k of Object.keys(o)) {
                if (re.test(k)) {
                  var v = o[k];
                  window.__qsfRefundKeyLog.push({
                    url: String(url||'').slice(0,120),
                    key: k,
                    val: typeof v === 'string' ? v.slice(0,80) : (typeof v === 'number' ? v : JSON.stringify(v).slice(0,80))
                  });
                }
              }
              Object.values(o).forEach(function(x){ walk(x, d+1); });
            }
          }
          walk(obj, 0);
        }
        var orig = window.fetch.bind(window);
        window.fetch = async function(input, init) {
          var u = typeof input === 'string' ? input : (input && input.url) || '';
          var res = await orig(input, init);
          try {
            if (/package|order|after|refund|return|search-list/i.test(u)) {
              var clone = res.clone();
              clone.json().then(function(j){ scan(j, u); }).catch(function(){});
            }
          } catch(e){}
          return res;
        };
      })()`,
    });
    await new Promise((r) => setTimeout(r, 500));
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
    console.log(JSON.stringify(r.result?.value, null, 2));
    await c.close();
  }
})();
