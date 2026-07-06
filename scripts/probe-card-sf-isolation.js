#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const EXPR = `(function(){
  var root = document.querySelector('.order-tool-content');
  if (!root) return { err: 'no root' };
  var cards = [...root.querySelectorAll('.order-card')];
  return cards.map(function(card){
    var id = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    var logistics = card.querySelector('.delivery-row-logistics, .logistics-box');
    var cardSf = (card.innerText||'').match(/\\b(SF\\d{10,15})\\b/gi) || [];
    var logSf = logistics ? (logistics.innerText||'').match(/\\b(SF\\d{10,15})\\b/gi) || [] : [];
    return {
      id,
      cardSf: [...new Set(cardSf.map(function(x){ return x.toUpperCase(); }))],
      logSf: [...new Set(logSf.map(function(x){ return x.toUpperCase(); }))],
      logText: logistics ? logistics.innerText.slice(0,120) : null
    };
  });
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('和田雅玉'));
  const c = await connectCdp(page.webSocketDebuggerUrl, 8000);
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
