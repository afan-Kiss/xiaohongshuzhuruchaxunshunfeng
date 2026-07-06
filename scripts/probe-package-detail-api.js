#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const EXPR = `(async function(){
  var root = document.querySelector('.order-tool-content');
  if (!root) return { err: 'no root' };
  var cards = root.querySelectorAll('.order-card');
  var pid = '';
  for (var i=0;i<cards.length;i++){
    var id = cards[i].querySelector('.order-card-title-id')?.textContent?.trim() || '';
    var sf = (cards[i].innerText||'').match(/\\b(SF\\d{10,15})\\b/i);
    if (id && !sf) { pid = id; break; }
  }
  if (!pid && cards[0]) pid = cards[0].querySelector('.order-card-title-id')?.textContent?.trim() || '';
  if (!pid) return { err: 'no pid' };
  var urls = [
    'https://eva.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/detail',
    'https://walle.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/detail'
  ];
  var out = { pid: pid, tries: [] };
  for (var u of urls) {
    try {
      var r = await fetch(u, { credentials: 'include' });
      var t = await r.text();
      out.tries.push({ url: u, status: r.status, body: t.slice(0, 500) });
    } catch (e) {
      out.tries.push({ url: u, error: String(e.message || e) });
    }
  }
  return out;
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('和田雅玉'));
  const c = await connectCdp(page.webSocketDebuggerUrl, 15000);
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
