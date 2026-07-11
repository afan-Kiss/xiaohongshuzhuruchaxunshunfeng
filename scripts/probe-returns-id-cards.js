#!/usr/bin/env node
const CDP = require('chrome-remote-interface');

const EXPR = `(function(){
  const cards = Array.from(document.querySelectorAll('.order-card')).slice(0, 8).map(function(card){
    const pid = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    const html = card.innerHTML || '';
    const text = card.innerText || '';
    const htmlR = html.match(/\\b(R\\d{10,})\\b/);
    const textR = text.match(/\\b(R\\d{10,})\\b/);
    const dataR = text.match(/售后单[号:]\\s*(R\\d+)/i);
    const status = card.querySelector('.sku-after-sale-status')?.textContent?.trim() || '';
    const head = text.slice(0, 200);
    const hasAfterSale = /售后|退款|退货|换货/.test(head + status);
    return {
      pid,
      htmlR: htmlR && htmlR[1],
      textR: textR && textR[1],
      dataR: dataR && dataR[1],
      status,
      hasAfterSale,
      feeRow: card.querySelector('.qsf-inline-fee-wrap')?.innerText?.replace(/\\s+/g, ' ').slice(0, 120) || '',
    };
  });
  return { version: window.__qfSfFeeInline?.version, cards };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const pages = list.filter((p) => /工作台/.test(p.title || '') && /dashboard/.test(p.url || ''));
  for (const page of pages) {
    console.log('---', page.title);
    const c = await CDP({ target: page.webSocketDebuggerUrl });
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
    console.log(JSON.stringify(r.result?.value, null, 2));
    await c.close();
  }
})().catch(console.error);
