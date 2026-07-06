#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const EXPR = `(function(){
  var root = document.querySelector('.order-tool-content');
  if (!root) return { err: 'no root' };
  var cards = root.querySelectorAll('.order-card');
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var header = c.querySelector('.order-card-header, .order-card-title');
    var logistics = c.querySelector('.delivery-row-logistics, .logistics-box');
    var id = c.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    out.push({
      i, id,
      hasLogistics: !!logistics,
      sf: (c.innerText||'').match(/\\b(SF\\d{10,15})\\b/i)?.[1] || '',
      headerCls: header ? header.className : '',
      cardCls: c.className,
      childCount: c.children.length,
      htmlHead: c.innerHTML.slice(0, 180)
    });
  }
  return { count: cards.length, cards: out };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('和田雅玉'));
  if (!page) return console.log('no page');
  const c = await connectCdp(page.webSocketDebuggerUrl, 6000);
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
