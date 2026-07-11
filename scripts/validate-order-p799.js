#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { fetchPackageDetailByCookie, fetchReturnsV3ByCookie } = require('../src/qianfan-package-api');
const { getShopCookie } = require('../src/qianfan-shop-cookies');

const PID = 'P799151115637001961';
const SHOP = 'shiyuju';

const EXPR = `(function(){
  var cards = document.querySelectorAll('.order-card');
  for (var i = 0; i < cards.length; i++) {
    var pid = (cards[i].querySelector('.order-card-title-id') || {}).textContent || '';
    if (String(pid).trim() !== '${PID}') continue;
    var html = cards[i].innerHTML || '';
    var text = (cards[i].innerText || '').replace(/\\s+/g, ' ');
    var rid = (html.match(/\\b(R\\d{10,})\\b/) || [])[1] || '';
    var feeRow = (cards[i].querySelector('.qsf-inline-fee-wrap') || {}).innerText || '';
    return { returnsId: rid, feeRow: feeRow.replace(/\\s+/g, ' ').trim(), text: text.slice(0, 300) };
  }
  return { err: 'card not found' };
})()`;

(async () => {
  const cookieRes = await getShopCookie(SHOP);
  const pkg = await fetchPackageDetailByCookie(PID, cookieRes.cookie);
  const dom = await (async () => {
    const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
    const page = list.find((p) => (p.title || '').includes('拾玉居'));
    const c = await CDP({ target: page.webSocketDebuggerUrl });
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
    await c.close();
    return r.result?.value || {};
  })();

  const returnsId = dom.returnsId || '';
  let returnsV3 = null;
  if (returnsId) {
    returnsV3 = await fetchReturnsV3ByCookie(returnsId, cookieRes.cookie, PID);
  }

  const batch = await fetch('http://127.0.0.1:4725/v1/cards/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shopKey: SHOP,
      shopTitle: '拾玉居和田玉',
      force: true,
      cards: [{
        packageId: PID,
        returnsId,
        expressNos: ['SF5157739745715'],
        hasAfterSale: true,
        afterSaleStatus: '待寄回',
      }],
    }),
    signal: AbortSignal.timeout(30000),
  }).then((r) => r.json());

  const dto = batch.items?.[PID];
  console.log(JSON.stringify({
    packageDetail: {
      customer_pay_amount: pkg.data?.customer_pay_amount,
      return_info: pkg.data?.return_info,
      sku_status: pkg.data?.sku_snapshots?.[0]?.status_name,
      return_type: pkg.data?.sku_snapshots?.[0]?.return_type,
      status: pkg.data?.status,
    },
    returnsIdSource: returnsId ? 'card.innerHTML' : 'none',
    returnsId,
    returns_v3: returnsV3?.ok ? {
      applied_amount: returnsV3.data?.after_sale?.applied_amount,
      expected_refund_amount: returnsV3.data?.after_sale?.expected_refund_amount,
      status_name: returnsV3.data?.after_sale?.status_name,
    } : returnsV3?.error,
    dto: dto ? {
      paidAmount: dto.paidAmount,
      refundApplyAmount: dto.refundApplyAmount,
      sfFee: dto.sfFee,
      profit: dto.profit,
      isFullRefund: dto.isFullRefund,
      warningType: dto.warningType,
      hasAfterSale: dto.hasAfterSale,
      afterSaleStatus: dto.afterSaleStatus,
    } : batch.errors?.[PID],
    pageFeeRow: dom.feeRow,
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
