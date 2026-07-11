#!/usr/bin/env node
/**
 * Real 4-shop validation: DevTools config + upstream package/returns/SF + Data Core DTO + page text.
 * Derived fixtures must not substitute this script.
 */
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { getShopCookie, resolveShopTitleFromKey } = require('../src/qianfan-shop-cookies');
const { fetchPackageDetailByCookie, fetchReturnsV3ByCookie } = require('../src/qianfan-package-api');
const { querySfWaybillFee } = require('../src/sf-waybill-client');
const { loadInjectConfig } = require('../src/injection-daemon');

const SHOPS = [
  { match: 'XY祥钰珠宝', key: 'xyxiangyu', title: 'XY祥钰珠宝', exclude: [] },
  { match: '祥钰珠宝', key: 'xiangyu', title: '祥钰珠宝', exclude: ['XY祥钰'] },
  { match: '和田雅玉', key: 'hetianyayu', title: '和田雅玉', exclude: [] },
  { match: '拾玉居', key: 'shiyuju', title: '拾玉居和田玉', exclude: [] },
];

function findShopPage(list, shop) {
  return list.find((p) => {
    const title = String(p.title || '');
    const url = String(p.url || '');
    if (!url.includes('dashboard')) return false;
    if (!title.includes(shop.match)) return false;
    for (const ex of shop.exclude || []) {
      if (title.includes(ex)) return false;
    }
    return true;
  });
}

const CARD_EXPR = `(function(){
  var cards = document.querySelectorAll('.order-card');
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var pid = String((c.querySelector('.order-card-title-id') || {}).textContent || '').trim();
    if (!pid) continue;
    var html = c.innerHTML || '';
    var text = (c.innerText || '').replace(/\\s+/g, ' ');
    var rid = ((html.match(/\\b(R\\d{10,})\\b/) || text.match(/\\b(R\\d{10,})\\b/) || [])[1]) || '';
    var expressNos = [];
    var matches = text.match(/\\b(SF\\d{10,}|[A-Z]{2,4}\\d{8,})\\b/gi) || [];
    for (var j = 0; j < matches.length; j++) {
      var n = matches[j].toUpperCase();
      if (n !== pid.toUpperCase() && expressNos.indexOf(n) < 0) expressNos.push(n);
    }
    var wrap = c.querySelector('.qsf-inline-fee-wrap');
    var summary = c.querySelector('.summary');
    out.push({
      packageId: pid,
      returnsId: rid,
      expressNos: expressNos,
      feeRow: wrap ? wrap.innerText.replace(/\\s+/g, ' ').trim() : '',
      summaryText: summary ? summary.innerText.replace(/\\s+/g, ' ').trim() : '',
      wrapTag: wrap ? wrap.tagName : '',
      wrapParent: wrap && wrap.parentElement ? wrap.parentElement.className : '',
    });
  }
  return out.slice(0, 2);
})()`;

function isSf(no) {
  return /^SF\d{10,}$/i.test(String(no || ''));
}

async function batchResolve(shopKey, shopTitle, cards) {
  const res = await fetch('http://127.0.0.1:4725/v1/cards/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopKey, shopTitle, cards, force: true }),
    signal: AbortSignal.timeout(60000),
  });
  return res.json();
}

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(bot?.host || '127.0.0.1').trim();
  const port = Number(bot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9223);
  const list = await (await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const injectCfg = loadInjectConfig();
  const report = {
    at: new Date().toISOString(),
    devtools: `${host}:${port}`,
    shops: [],
    ok: true,
    failures: [],
  };

  for (const shop of SHOPS) {
    const page = findShopPage(list, shop);
    const entry = {
      shopKey: shop.key,
      shopTitle: shop.title || resolveShopTitleFromKey(shop.key),
      pageTitle: page?.title || 'missing',
      cards: [],
    };
    if (!page) {
      entry.note = 'page_missing';
      report.ok = false;
      report.failures.push(`${shop.key}:page_missing`);
      report.shops.push(entry);
      continue;
    }

    const cookieRes = await getShopCookie(shop.key);
    if (!cookieRes.ok) {
      entry.note = cookieRes.error || 'cookie_unavailable';
      report.ok = false;
      report.failures.push(`${shop.key}:cookie`);
      report.shops.push(entry);
      continue;
    }

    const c = await CDP({ target: page.webSocketDebuggerUrl });
    const r = await c.Runtime.evaluate({ expression: CARD_EXPR, returnByValue: true });
    const domCards = r.result?.value || [];
    await c.close();

    if (!domCards.length) {
      entry.note = 'no_visible_order_cards';
      report.shops.push(entry);
      continue;
    }

    const batch = await batchResolve(shop.key, entry.shopTitle, domCards.map((d) => ({
      packageId: d.packageId,
      returnsId: d.returnsId,
      expressNos: d.expressNos,
      hasAfterSale: Boolean(d.returnsId) || /售后|退款|退货/.test(d.summaryText || ''),
    })));

    for (const snap of domCards) {
      const pkg = await fetchPackageDetailByCookie(snap.packageId, cookieRes.cookie);
      let returnsV3 = null;
      const returnsId = snap.returnsId || '';
      if (returnsId) {
        returnsV3 = await fetchReturnsV3ByCookie(returnsId, cookieRes.cookie, snap.packageId);
      }
      const sfRaw = [];
      for (const no of (snap.expressNos || []).filter(isSf).slice(0, 3)) {
        try {
          const fee = await querySfWaybillFee(no, injectCfg.sf, AbortSignal.timeout(15000));
          sfRaw.push({ waybill: no, ok: fee?.ok, fee: fee?.totalFee ?? fee?.sfFee ?? null, error: fee?.error || null });
        } catch (e) {
          sfRaw.push({ waybill: no, ok: false, fee: null, error: e.message });
        }
      }
      const dto = batch.items?.[snap.packageId] || null;
      const err = batch.errors?.[snap.packageId] || null;
      const card = {
        packageId: snap.packageId,
        returnsId,
        upstream: {
          customer_pay_amount: pkg.data?.customer_pay_amount ?? null,
          return_info_len: Array.isArray(pkg.data?.return_info) ? pkg.data.return_info.length : null,
          returns_v3_applied: returnsV3?.ok ? returnsV3.data?.after_sale?.applied_amount : null,
          returns_v3_status: returnsV3?.ok ? returnsV3.data?.after_sale?.status_name : null,
          sfRaw,
        },
        dto: dto ? {
          paidAmount: dto.paidAmount,
          refundApplyAmount: dto.refundApplyAmount,
          refundActualAmount: dto.refundActualAmount,
          refundBasisAmount: dto.refundBasisAmount,
          afterSaleLifecycle: dto.afterSaleLifecycle,
          sfFee: dto.sfFee,
          profit: dto.profit,
          warningType: dto.warningType,
          shopKey: dto.shopKey,
        } : err,
        page: {
          feeRow: snap.feeRow,
          summaryText: snap.summaryText,
          wrapTag: snap.wrapTag,
          wrapParent: snap.wrapParent,
        },
      };
      if (dto && dto.shopKey && dto.shopKey !== shop.key) {
        report.ok = false;
        report.failures.push(`${shop.key}:${snap.packageId}:shop_key_mismatch`);
      }
      if (dto && pkg.data?.customer_pay_amount != null && dto.paidAmount != null
        && Number(pkg.data.customer_pay_amount) > 0 && Number(dto.paidAmount) === 0) {
        report.ok = false;
        report.failures.push(`${shop.key}:${snap.packageId}:paidAmount_zero`);
      }
      entry.cards.push(card);
    }
    report.shops.push(entry);
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
