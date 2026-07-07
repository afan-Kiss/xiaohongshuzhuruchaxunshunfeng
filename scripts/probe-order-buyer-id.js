#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const EXPR = `(function(){
  function walk(obj, fn, d){
    if (!obj || d>8) return;
    if (Array.isArray(obj)) { obj.forEach(function(x){ walk(x,fn,d+1); }); return; }
    if (typeof obj === 'object') { fn(obj); Object.values(obj).forEach(function(x){ walk(x,fn,d+1); }); }
  }
  var out = { buyerIds: [], appCids: [] };
  if (window.__qfImpaasSockets) out.impaas = window.__qfImpaasSockets.length;
  // scan recent fetch responses isn't available; scan DOM react on order cards
  var cards = Array.from(document.querySelectorAll('.order-card')).slice(0,3);
  out.cards = cards.map(function(card){
    var id = card.querySelector('.order-card-title-id')?.textContent?.trim()||'';
    var reactKey = Object.keys(card).find(function(k){ return k.startsWith('__reactFiber')||k.startsWith('__reactProps'); });
    var sample = '';
    if (reactKey) {
      try {
        var p = card[reactKey]?.memoizedProps || card[reactKey]?.pendingProps;
        sample = JSON.stringify(p).slice(0,300);
      } catch(e){ sample = e.message; }
    }
    return { id: id, reactSample: sample };
  });
  return out;
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('XY祥钰'));
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
