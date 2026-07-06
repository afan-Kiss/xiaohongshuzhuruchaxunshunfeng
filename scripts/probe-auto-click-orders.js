#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const EXPR = `(async function(){
  var root = document.querySelector('.order-tool-content');
  if (!root) return { err: 'no root' };
  var cards = [...root.querySelectorAll('.order-card')];
  var before = cards.map(function(c){
    return { id: c.querySelector('.order-card-title-id')?.textContent?.trim(), sf: (c.innerText||'').match(/\\b(SF\\d{10,15})\\b/i)?.[1]||'' };
  });
  for (var card of cards) {
    if (/\\bSF\\d{10,15}\\b/i.test(card.innerText||'')) continue;
    try { card.scrollIntoView({ block: 'nearest' }); } catch(e){}
    var header = card.querySelector('.order-card-header') || card;
    header.click();
    await new Promise(function(r){ setTimeout(r, 700); });
  }
  cards = [...root.querySelectorAll('.order-card')];
  var after = cards.map(function(c){
    return { id: c.querySelector('.order-card-title-id')?.textContent?.trim(), sf: (c.innerText||'').match(/\\b(SF\\d{10,15})\\b/i)?.[1]||'' };
  });
  return { before: before, after: after };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('和田雅玉'));
  const c = await connectCdp(page.webSocketDebuggerUrl, 20000);
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
