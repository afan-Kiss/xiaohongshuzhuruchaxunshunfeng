#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { fetchPackageDetailByCookie, fetchReturnsV3ByCookie } = require('../src/qianfan-package-api');
const { getShopCookie } = require('../src/qianfan-shop-cookies');

const PID = 'P799151115637001961';
const SHOP = 'shiyuju';

const EXPR = `(function(){
  function normText(s){ return String(s||'').replace(/\\s+/g,' ').trim(); }
  function getDirectChildUnder(row, element) {
    var current = element;
    while (current && current.parentElement !== row) current = current.parentElement;
    return current;
  }
  function findOrderAmountRow(card) {
    var qtyAnchor = null, payAnchor = null, payPri = 0;
    var nodes = card.querySelectorAll('span, div, p');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest('.qsf-inline-fee-wrap')) continue;
      var t = normText(el.textContent);
      if (!t) continue;
      if (/共\\s*\\d+\\s*件/.test(t) && !/(实付|应付)/.test(t) && t.length <= 40) {
        if (!qtyAnchor || t.length < normText(qtyAnchor.textContent).length) qtyAnchor = el;
      }
      if (/实付/.test(t) && (/[¥￥]/.test(t) || /\\d/.test(t)) && t.length <= 80) {
        if (payPri < 2 || t.length < normText(payAnchor.textContent).length) { payAnchor = el; payPri = 2; }
      } else if (/应付/.test(t) && (/[¥￥]/.test(t) || /\\d/.test(t)) && t.length <= 80) {
        if (payPri < 1) payAnchor = el;
      }
    }
    if (!qtyAnchor || !payAnchor) return { row: null, qtyAnchor: qtyAnchor, payAnchor: payAnchor };
    var candidate = payAnchor.parentElement;
    var best = null, bestScore = -1;
    while (candidate && candidate !== card) {
      if (candidate.contains(qtyAnchor) && candidate.contains(payAnchor)) {
        var qtyCol = getDirectChildUnder(candidate, qtyAnchor);
        var payCol = getDirectChildUnder(candidate, payAnchor);
        if (qtyCol && payCol && qtyCol !== payCol) {
          var score = 0;
          var cls = String(candidate.className || '');
          if (/order-card-footer/i.test(cls)) score += 50;
          if (/footer|amount|price|pay|summary/i.test(cls)) score += 20;
          if (score > bestScore) { bestScore = score; best = { row: candidate, qtyCol: qtyCol, payCol: payCol }; }
        }
      }
      candidate = candidate.parentElement;
    }
    return best ? { row: best.row, qtyCol: best.qtyCol, payCol: best.payCol, qtyAnchor: qtyAnchor, payAnchor: payAnchor } : { row: null, qtyAnchor: qtyAnchor, payAnchor: payAnchor };
  }
  var cards = document.querySelectorAll('.order-card');
  for (var i = 0; i < cards.length; i++) {
    var pid = (cards[i].querySelector('.order-card-title-id') || {}).textContent || '';
    if (String(pid).trim() !== '${PID}') continue;
    var html = cards[i].innerHTML || '';
    var text = (cards[i].innerText || '').replace(/\\s+/g, ' ');
    var rid = (html.match(/\\b(R\\d{10,})\\b/) || [])[1] || '';
    var wrap = cards[i].querySelector('.qsf-inline-fee-wrap');
    var feeRow = wrap ? (wrap.innerText || '').replace(/\\s+/g, ' ').trim() : '';
    var amount = findOrderAmountRow(cards[i]);
    var footerText = '';
    if (amount.row) {
      footerText = normText(amount.row.textContent);
    }
    var positionOk = false;
    var qtyIndex = -1, pluginIndex = -1, payIndex = -1;
    if (wrap && amount.row && amount.qtyCol && amount.payCol) {
      var kids = Array.prototype.slice.call(amount.row.children);
      qtyIndex = kids.indexOf(amount.qtyCol);
      pluginIndex = kids.indexOf(wrap);
      payIndex = kids.indexOf(amount.payCol);
      positionOk = wrap.parentElement === amount.row && qtyIndex >= 0 && pluginIndex >= 0 && payIndex >= 0 && qtyIndex < pluginIndex && pluginIndex < payIndex;
    }
    var display = wrap ? getComputedStyle(wrap).display : '';
    return {
      returnsId: rid,
      feeRow: feeRow,
      footerText: footerText,
      positionOk: positionOk,
      qtyIndex: qtyIndex,
      pluginIndex: pluginIndex,
      payIndex: payIndex,
      wrapDisplay: display,
      wrapTag: wrap ? wrap.tagName : '',
      text: text.slice(0, 300)
    };
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
    await c.Runtime.evaluate({ expression: 'window.__qfSfFeeInline && window.__qfSfFeeInline.rescan()', returnByValue: true });
    await new Promise((r) => setTimeout(r, 3500));
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
    let screenshotPath = null;
    try {
      await c.Page.enable();
      const shot = await c.Page.captureScreenshot({ format: 'png', fromSurface: true });
      const fs = require('fs');
      const path = require('path');
      screenshotPath = path.join(__dirname, '..', 'logs', `p799-amount-row-${new Date().toISOString().slice(0, 10)}.png`);
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
    } catch {
      screenshotPath = null;
    }
    await c.close();
    return { ...(r.result?.value || {}), screenshotPath };
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
    footerAmountRow: dom.footerText,
    position: {
      ok: dom.positionOk,
      qtyIndex: dom.qtyIndex,
      pluginIndex: dom.pluginIndex,
      payIndex: dom.payIndex,
      wrapTag: dom.wrapTag,
      wrapDisplay: dom.wrapDisplay,
    },
    screenshotPath: dom.screenshotPath,
  }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
