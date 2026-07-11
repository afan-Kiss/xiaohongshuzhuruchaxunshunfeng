#!/usr/bin/env node
/**
 * Build sanitized fixtures from live upstream package/detail + returns_v3.
 */
const fs = require('fs');
const path = require('path');
const { fetchPackageDetailByCookie, fetchReturnsV3ByCookie } = require('../src/qianfan-package-api');
const { getShopCookie } = require('../src/qianfan-shop-cookies');

const ROOT = path.resolve(__dirname, '..');
const PKG_DIR = path.join(ROOT, 'test', 'fixtures', 'package-detail');
const RET_DIR = path.join(ROOT, 'test', 'fixtures', 'returns-v3');

const SAMPLES = [
  { shop: 'hetianyayu', packageId: 'P798534497049316691', returnsId: 'R4931669195404211', tags: ['sf', 'return_info_array', 'refund_done', 'normal'] },
  { shop: 'shiyuju', packageId: 'P798556283501269411', returnsId: '', tags: ['sf', 'return_info_array', 'refund_done', 'normal'] },
  { shop: 'shiyuju', packageId: 'P798434418773022311', returnsId: '', tags: ['sf', 'return_info_array', 'refund_done'] },
];

function redact(obj, seq = 1, depth = 0) {
  if (obj == null || depth > 14) return obj;
  if (Array.isArray(obj)) return obj.map((x, i) => redact(x, seq + i, depth + 1));
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (typeof v === 'string') {
      if (/cookie|token/i.test(lk)) out[k] = '[REDACTED]';
      else if (/phone|mobile/.test(lk)) out[k] = '138****0000';
      else if (/name|nick|receiver|user_name|seller_name/.test(lk)) out[k] = '[NAME]';
      else if (/address/.test(lk)) out[k] = '[ADDRESS]';
      else if (/^P\d{10,}$/.test(v)) out[k] = `P_FIXTURE_${seq}`;
      else if (/^R\d{10,}$/.test(v)) out[k] = `R_FIXTURE_${seq}`;
      else if (/^SF\d{10,}$/i.test(v)) out[k] = `SF_FIXTURE_${String(seq).padStart(3, '0')}`;
      else if (/^\d{11,}$/.test(v)) out[k] = 'U_FIXTURE';
      else out[k] = v;
    } else {
      out[k] = redact(v, seq, depth + 1);
    }
  }
  return out;
}

function cloneDerived(base, patch, tags) {
  const data = JSON.parse(JSON.stringify(base));
  Object.assign(data, patch);
  return { data, tags };
}

(async () => {
  fs.mkdirSync(PKG_DIR, { recursive: true });
  fs.mkdirSync(RET_DIR, { recursive: true });

  let seq = 1;
  const saved = [];
  let hetianRaw = null;

  for (const sample of SAMPLES) {
    const cookieRes = await getShopCookie(sample.shop);
    if (!cookieRes.ok) continue;
    const detail = await fetchPackageDetailByCookie(sample.packageId, cookieRes.cookie);
    if (!detail.ok) continue;
    const raw = detail.data;
    if (sample.shop === 'hetianyayu') hetianRaw = raw;

    const name = `${sample.shop}__${sample.tags.join('_')}__${seq}.json`;
    fs.writeFileSync(path.join(PKG_DIR, name), `${JSON.stringify({
      meta: { shopKey: sample.shop, tags: sample.tags, source: 'upstream', units: { customer_pay_amount: 'yuan', return_amt: 'yuan' } },
      data: redact(raw, seq),
    }, null, 2)}\n`);
    saved.push(name);
    seq += 1;

    const rid = sample.returnsId;
    if (rid) {
      const ret = await fetchReturnsV3ByCookie(rid, cookieRes.cookie, sample.packageId);
      if (ret.ok && ret.data) {
        const retName = `${sample.shop}__returns_v3__${seq}.json`;
        fs.writeFileSync(path.join(RET_DIR, retName), `${JSON.stringify({
          meta: { shopKey: sample.shop, returnsIdPath: 'after_sale.returns_id', tags: sample.tags, units: { applied_amount: 'yuan', applied_ship_fee_amount: 'fen' } },
          data: redact(ret.data, seq),
        }, null, 2)}\n`);
        saved.push(retName);
        seq += 1;
      }
    }
  }

  if (hetianRaw) {
    const derived = [
      cloneDerived(hetianRaw, { customer_pay_amount: 16800, package_id: 'P_FIXTURE_HIGH_16800' }, ['high_value', 'sf', 'yuan_16800']),
      cloneDerived(hetianRaw, { customer_pay_amount: 26800, package_id: 'P_FIXTURE_HIGH_26800' }, ['high_value', 'sf', 'yuan_26800']),
      cloneDerived(hetianRaw, {
        customer_pay_amount: 520,
        express_number: 'YT1234567890',
        delivery_packages: [{ express_no: 'YT1234567890', express_company_code: 'yuantong', express_company_name: '圆通速递', delivery_package_id: 'P_FIXTURE_NON_SF' }],
      }, ['non_sf']),
      cloneDerived(hetianRaw, {
        customer_pay_amount: 300,
        express_number: '',
        delivery_packages: [],
        return_info: null,
      }, ['no_logistics', 'no_after_sale']),
      cloneDerived(hetianRaw, {
        package_id: 'P_FIXTURE_MULTI_SF',
        delivery_packages: [
          { express_no: 'SF5113800000001', express_company_code: 'shunfeng', express_company_name: '顺丰速运', delivery_package_id: 'DP_FIXTURE_1' },
          { express_no: 'SF5113800000002', express_company_code: 'shunfeng', express_company_name: '顺丰速运', delivery_package_id: 'DP_FIXTURE_2' },
        ],
        express_number: 'SF5113800000001',
      }, ['multi_sf', 'multi_package']),
      cloneDerived(hetianRaw, {
        package_id: 'P_FIXTURE_RET_ARRAY',
        id: 'SHOULD_NOT_BE_RETURNS_ID',
        return_info: [
          { return_amt: 100, status_str: '退款成功', time: '2026-06-01 10:00:00', record_id: 'REC_OLD' },
          { return_amt: 200, status_str: '退款中', time: '2026-07-10 12:00:00', record_id: 'REC_NEW' },
        ],
      }, ['return_info_array', 'refunding']),
      cloneDerived(hetianRaw, { package_id: 'P_FIXTURE_ID_ONLY', id: 'PKG_ID_NOT_RETURNS', return_info: null }, ['no_after_sale', 'raw_id_present']),
    ];
    for (const item of derived) {
      const name = `derived__${item.tags.join('_')}__${seq}.json`;
      fs.writeFileSync(path.join(PKG_DIR, name), `${JSON.stringify({
        meta: { shopKey: 'hetianyayu', tags: item.tags, source: 'derived_from_upstream', units: { customer_pay_amount: 'yuan' } },
        data: redact(item.data, seq),
      }, null, 2)}\n`);
      saved.push(name);
      seq += 1;
    }
  }

  fs.writeFileSync(path.join(ROOT, 'test', 'fixtures', 'collection-summary.json'), `${JSON.stringify({ saved, count: saved.length }, null, 2)}\n`);
  console.log(`saved ${saved.length} fixtures`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
