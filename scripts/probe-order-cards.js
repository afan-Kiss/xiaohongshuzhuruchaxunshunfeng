#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const EXPR = `(function(){
  var root = document.querySelector('.order-tool-content');
  if (!root) return { err: 'no root' };
  var cards = root.querySelectorAll('.order-card');
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var idEl = c.querySelector('.order-card-title-id');
    var orderId = idEl ? idEl.textContent.trim() : '';
    var sf = (c.innerText || '').match(/\\b(SF\\d{10,15})\\b/i);
    out.push({ i: i, orderId: orderId, sf: sf ? sf[1] : '' });
  }
  return { cardCount: cards.length, cards: out };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  for (const p of list.filter((x) => x.type === 'page' && (x.url || '').includes('walle'))) {
    const c = await connectCdp(p.webSocketDebuggerUrl, 6000);
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
    console.log('\n', p.title, JSON.stringify(r.result?.value, null, 2));
    await c.close();
  }
})();
