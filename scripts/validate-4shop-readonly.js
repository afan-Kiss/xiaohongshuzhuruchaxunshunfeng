#!/usr/bin/env node
/**
 * Read-only 4-shop validation: compare upstream + DTO + page display.
 */
const CDP = require('chrome-remote-interface');

const SHOPS = [
  { match: '和田雅玉', key: 'hetianyayu' },
  { match: '拾玉居', key: 'shiyuju' },
  { match: 'XY祥钰', key: 'xyxiangyu' },
  { match: '祥钰珠宝', key: 'xiangyu' },
];

const CARD_EXPR = `(function(){
  var cards = document.querySelectorAll('.order-card');
  var out = [];
  for (var i=0;i<cards.length;i++){
    var c = cards[i];
    var pid = (c.querySelector('.order-card-title-id')||{}).textContent||'';
    pid = String(pid).trim();
    if (!pid) continue;
    var text = (c.innerText||'').replace(/\\s+/g,' ');
    var ridM = text.match(/\\b(R\\d{10,})\\b/);
    var sf = (text.match(/\\b(SF\\d{10,})\\b/gi)||[]).map(function(x){return x.toUpperCase();});
    var feeRow = (c.querySelector('.qsf-inline-fee-wrap')||{}).innerText||'';
    out.push({ packageId: pid, returnsId: ridM?ridM[1]:'', expressNos: sf, feeRow: feeRow.replace(/\\s+/g,' ').trim() });
  }
  return out.slice(0, 3);
})()`;

async function batchResolve(shopKey, cards) {
  const res = await fetch('http://127.0.0.1:4725/v1/cards/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopKey, shopTitle: shopKey, cards }),
    signal: AbortSignal.timeout(25000),
  });
  return res.json();
}

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const report = { at: new Date().toISOString(), shops: [] };

  for (const shop of SHOPS) {
    const page = list.find((p) => (p.title || '').includes(shop.match) && (p.url || '').includes('dashboard'));
    const entry = { shop: shop.key, title: page?.title || 'missing', cards: [] };
    if (!page) {
      report.shops.push(entry);
      continue;
    }
    const c = await CDP({ target: page.webSocketDebuggerUrl });
    const r = await c.Runtime.evaluate({ expression: CARD_EXPR, returnByValue: true });
    const domCards = r.result?.value || [];
    if (!domCards.length) {
      entry.note = 'no visible order cards';
      report.shops.push(entry);
      await c.close();
      continue;
    }
    const batch = await batchResolve(shop.key, domCards);
    for (const snap of domCards) {
      const dto = batch.items?.[snap.packageId] || batch.errors?.[snap.packageId] || null;
      entry.cards.push({
        packageId: snap.packageId,
        returnsId: { dom: snap.returnsId, dto: dto?.returnsId || '' },
        paidAmount: dto?.paidAmount ?? null,
        refundApplyAmount: dto?.refundApplyAmount ?? null,
        sfFee: dto?.sfFee ?? null,
        sfFeeComplete: dto?.sfFeeComplete,
        sfWaybillCount: dto?.sfWaybillCount,
        profit: dto?.profit,
        state: dto?.state,
        feeRow: snap.feeRow,
        expressNos: { dom: snap.expressNos, dto: dto?.expressNos || [] },
      });
    }
    report.shops.push(entry);
    await c.close();
  }

  console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
