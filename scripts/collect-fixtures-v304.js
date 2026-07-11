#!/usr/bin/env node
/**
 * Collect sanitized package/detail + returns_v3 fixtures from live 4-shop pages.
 */
const fs = require('fs');
const path = require('path');
const { connectCdp } = require('../src/cdp-connect');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const ROOT = path.resolve(__dirname, '..');
const PKG_DIR = path.join(ROOT, 'test', 'fixtures', 'package-detail');
const RET_DIR = path.join(ROOT, 'test', 'fixtures', 'returns-v3');
const PROXY = Number(process.env.QF_PACKAGE_PROXY_PORT || 4725);

const SHOP_MAP = [
  { match: 'XY祥钰', key: 'xyxiangyu', label: 'xyxiangyu' },
  { match: '祥钰珠宝', key: 'xiangyu', label: 'xiangyu' },
  { match: '和田雅玉', key: 'hetianyayu', label: 'hetianyayu' },
  { match: '拾玉居', key: 'shiyuju', label: 'shiyuju' },
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
    var sf = (text.match(/\\b(SF\\d{10,})\\b/gi)||[]).map(function(x){return x.toUpperCase();});
    var other = (text.match(/\\b([A-Z]{2,4}\\d{8,})\\b/g)||[]).filter(function(x){return !/^SF/i.test(x);});
    var hasRefund = /退款|退货|售后/.test(text);
    var hasLogistics = /物流|运单|快递|SF\\d|已发货/.test(text);
    var payM = text.match(/实付[^\\d]*(\\d[\\d,.]*)/);
    var pay = payM ? payM[1].replace(/,/g,'') : '';
    out.push({ packageId: pid, sfNos: sf, otherNos: other, hasRefund, hasLogistics, domPay: pay });
  }
  return out.slice(0, 12);
})()`;

function resolveShopKey(title) {
  const t = String(title || '').replace(/-工作台\s*$/, '');
  for (const row of SHOP_MAP) {
    if (t.includes(row.match)) return row;
  }
  return null;
}

function redactValue(key, val, seq) {
  if (val == null) return val;
  const lk = String(key).toLowerCase();
  if (typeof val === 'string') {
    if (/cookie|token|authorization/i.test(lk)) return '[REDACTED]';
    if (/phone|mobile|tel/i.test(lk)) return '138****0000';
    if (/name|nick|receiver|buyer|user/i.test(lk) && val.length > 1) return '[NAME]';
    if (/address|addr|detail/i.test(lk)) return '[ADDRESS]';
    if (/^P\d{10,}$/.test(val)) return `P_FIXTURE_${seq}`;
    if (/^R\d{10,}$/.test(val)) return `R_FIXTURE_${seq}`;
    if (/^SF\d{10,}$/i.test(val)) return `SF_FIXTURE_${String(seq).padStart(3, '0')}`;
    if (/^\d{11,}$/.test(val)) return 'U_FIXTURE';
  }
  return val;
}

function sanitize(obj, seq = 1, depth = 0) {
  if (obj == null || depth > 12) return obj;
  if (Array.isArray(obj)) return obj.map((x, i) => sanitize(x, seq + i, depth + 1));
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'object' && v !== null) {
      out[k] = sanitize(v, seq, depth + 1);
    } else {
      out[k] = redactValue(k, v, seq);
    }
  }
  return out;
}

function classifyPackage(data, card) {
  const d = data || {};
  const ri = d.return_info ?? d.returnInfo;
  const pkgs = d.delivery_packages || d.deliveryPackages || [];
  const express = d.express_number || d.express_no || d.expressNo || '';
  const pay = d.customer_pay_amount ?? d.customerPayAmount ?? d.paid_amount ?? d.paidAmount;
  const tags = [];
  if (pay != null && Number(pay) >= 10000) tags.push('high_value');
  if (Array.isArray(pkgs) && pkgs.length > 1) tags.push('multi_package');
  if (Array.isArray(ri)) tags.push('return_info_array');
  else if (ri && typeof ri === 'object') tags.push('return_info_object');
  else tags.push('no_after_sale');
  const sfCount = (card.sfNos || []).length;
  if (sfCount > 1) tags.push('multi_sf');
  else if (sfCount === 1 || /^SF/i.test(express)) tags.push('sf');
  else if ((card.otherNos || []).length) tags.push('non_sf');
  else if (!card.hasLogistics) tags.push('no_logistics');
  if (card.hasRefund) tags.push('has_refund_dom');
  const status = String(ri?.status || (Array.isArray(ri) ? ri[0]?.status : '') || '').trim();
  if (/退款中|申请/.test(status)) tags.push('refunding');
  if (/完成|成功|已退/.test(status)) tags.push('refund_done');
  return tags;
}

async function fetchPackage(shopKey, packageId) {
  const url = `http://127.0.0.1:${PROXY}/package-detail?packageId=${encodeURIComponent(packageId)}&shopKey=${encodeURIComponent(shopKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const json = await res.json();
  return json;
}

async function fetchReturns(shopKey, returnsId, packageId) {
  const url = `http://127.0.0.1:${PROXY}/returns-v3?returnsId=${encodeURIComponent(returnsId)}&packageId=${encodeURIComponent(packageId)}&shopKey=${encodeURIComponent(shopKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  try {
    return await res.json();
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}

function extractReturnsIdFromData(data) {
  const ri = data?.return_info ?? data?.returnInfo;
  if (Array.isArray(ri)) {
    for (const item of ri) {
      const id = item?.returns_id || item?.returnsId || item?.return_id || item?.returnId;
      if (id) return String(id).trim();
    }
    return '';
  }
  if (ri && typeof ri === 'object') {
    return String(ri.returns_id || ri.returnsId || ri.return_id || '').trim();
  }
  return String(data?.returns_id || data?.returnsId || '').trim();
}

(async () => {
  fs.mkdirSync(PKG_DIR, { recursive: true });
  fs.mkdirSync(RET_DIR, { recursive: true });

  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pages = list.filter((p) => p.type === 'page' && resolveShopKey(p.title));

  const summary = { shops: {}, fixtures: [] };
  let seq = 1;

  for (const page of pages) {
    const shop = resolveShopKey(page.title);
    if (!shop) continue;
    summary.shops[shop.label] = { title: page.title, cards: 0, saved: 0 };

    let client;
    try {
      client = await connectCdp(page.webSocketDebuggerUrl, 10000);
      const r = await client.Runtime.evaluate({ expression: CARD_EXPR, returnByValue: true });
      const cards = r.result?.value || [];
      summary.shops[shop.label].cards = cards.length;

      const seen = new Set();
      for (const card of cards) {
        if (!card.packageId || seen.has(card.packageId)) continue;
        seen.add(card.packageId);

        let pkgRes;
        try {
          pkgRes = await fetchPackage(shop.key, card.packageId);
        } catch (e) {
          console.error(`[${shop.label}] fetch failed ${card.packageId}:`, e.message);
          continue;
        }
        if (!pkgRes?.ok || !pkgRes.data) continue;

        const tags = classifyPackage(pkgRes.data, card);
        const name = `${shop.label}__${tags.join('_') || 'generic'}__${seq}.json`;
        const fixture = {
          meta: {
            shopKey: shop.key,
            shopTitle: shop.label,
            tags,
            domPay: card.domPay || null,
            collectedAt: new Date().toISOString(),
          },
          data: sanitize(pkgRes.data, seq),
        };
        fs.writeFileSync(path.join(PKG_DIR, name), `${JSON.stringify(fixture, null, 2)}\n`);
        summary.fixtures.push({ type: 'package', file: name, tags });
        summary.shops[shop.label].saved += 1;
        seq += 1;

        const returnsId = extractReturnsIdFromData(pkgRes.data);
        if (returnsId) {
          try {
            const retRes = await fetchReturns(shop.key, returnsId, card.packageId);
            if (retRes?.ok && retRes.data) {
              const retName = `${shop.label}__returns__${seq}.json`;
              const retFixture = {
                meta: {
                  shopKey: shop.key,
                  returnsIdPath: 'return_info',
                  tags,
                  collectedAt: new Date().toISOString(),
                },
                data: sanitize(retRes.data, seq),
              };
              fs.writeFileSync(path.join(RET_DIR, retName), `${JSON.stringify(retFixture, null, 2)}\n`);
              summary.fixtures.push({ type: 'returns', file: retName, tags });
              seq += 1;
            }
          } catch (e) {
            console.error(`[${shop.label}] returns failed:`, e.message);
          }
        }
      }
    } finally {
      if (client) {
        try { await client.close(); } catch { /* ignore */ }
      }
    }
  }

  fs.writeFileSync(
    path.join(ROOT, 'test', 'fixtures', 'collection-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
