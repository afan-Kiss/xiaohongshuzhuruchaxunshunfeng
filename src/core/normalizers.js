/**
 * Unified parsing for package detail, after-sale, and card DTO.
 * Amounts: explicit yuan vs fen fields — never guess by magnitude.
 */

const YUAN_FIELDS = new Set([
  'sku_pay_amount',
  'skuPayAmount',
  'customer_pay_amount',
  'customerPayAmount',
  'paid_amount',
  'paidAmount',
  'pay_amount',
  'payAmount',
  'order_amount',
  'orderAmount',
  'actual_pay_amount',
  'actualPayAmount',
  'total_pay_amount',
  'totalPayAmount',
  'deal_price',
  'dealPrice',
  'trans_price',
  'transPrice',
  'return_amt',
  'returnAmt',
  'refund_amount',
  'refundAmount',
  'apply_amount',
  'applyAmount',
  'refund_apply_amount',
  'refundApplyAmount',
  'refunded_amount',
  'refundedAmount',
  'actual_refund_amount',
  'actualRefundAmount',
  'applied_amount',
  'expected_refund_amount',
  'refund_fee',
  'refundFee',
  'negotiate_returns_amount',
  'origin_negotiate_returns_amount',
  'expect_refund_fee',
  'expectRefundFee',
  'max_refund_amount',
  'maxRefundAmount',
]);

const FEN_FIELDS = new Set([
  'applied_skus_amount_sum',
  'appliedSkusAmountSum',
  'applied_ship_fee_amount',
  'appliedShipFeeAmount',
]);

function roundYuan(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseYuanAmount(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return roundYuan(raw);
  }
  const s = String(raw).trim().replace(/[￥¥,\s]/g, '');
  if (!s || s === '-' || s === '—') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return roundYuan(n);
}

function parseFenAmount(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return roundYuan(raw / 100);
  }
  const s = String(raw).trim().replace(/[￥¥,\s]/g, '');
  if (!s || s === '-' || s === '—') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return roundYuan(n / 100);
}

function parseFieldAmount(key, raw) {
  const k = String(key || '');
  if (FEN_FIELDS.has(k)) return parseFenAmount(raw);
  if (YUAN_FIELDS.has(k)) return parseYuanAmount(raw);
  return null;
}

/** @deprecated use parseYuanAmount */
const parseMoneyYuan = parseYuanAmount;

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

function extractReturnsId(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return firstNonEmpty(
    obj.returns_id,
    obj.returnsId,
    obj.return_id,
    obj.returnId,
    obj.after_sale_id,
    obj.afterSaleId,
  );
}

function extractReturnsIdFromReturnInfoItem(item) {
  if (!item || typeof item !== 'object') return '';
  return firstNonEmpty(
    item.returns_id,
    item.returnsId,
    item.return_id,
    item.returnId,
    item.after_sale_id,
    item.afterSaleId,
  );
}

function parseReturnInfoTime(item) {
  if (!item || typeof item !== 'object') return 0;
  const candidates = [item.update_at, item.updateAt, item.finish_at, item.finishAt, item.time];
  for (const raw of candidates) {
    if (raw == null || raw === '') continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const s = String(raw).trim();
    const m = s.match(/(\d{4})[/-](\d{2})[/-](\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      const ms = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        Number(m[6] || 0),
      ).getTime();
      if (Number.isFinite(ms)) return ms;
    }
  }
  return 0;
}

function returnInfoStatusRank(status) {
  const s = String(status || '').trim();
  if (/退款中|申请|待|处理中|进行中/.test(s)) return 3;
  if (/完成|成功|已退/.test(s)) return 2;
  if (/关闭|取消|拒绝/.test(s)) return 1;
  return 0;
}

function pickActiveReturnInfo(rawReturnInfo) {
  if (!rawReturnInfo) return null;
  if (!Array.isArray(rawReturnInfo)) {
    return typeof rawReturnInfo === 'object' ? rawReturnInfo : null;
  }
  if (!rawReturnInfo.length) return null;
  let best = rawReturnInfo[0];
  let bestScore = -1;
  for (const item of rawReturnInfo) {
    const rank = returnInfoStatusRank(item?.status_str || item?.status || item?.status_name);
    const time = parseReturnInfoTime(item);
    const score = rank * 1e15 + time;
    if (score >= bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

function isSfCarrier(code, name) {
  const c = String(code || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  return c === 'shunfeng' || c === 'sf' || /顺丰/.test(n);
}

function collectExpressFromNode(node, out, seen, depth = 0) {
  if (!node || depth > 10) return;
  if (Array.isArray(node)) {
    for (const item of node) collectExpressFromNode(item, out, seen, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  const expressNo = firstNonEmpty(
    node.express_no,
    node.expressNo,
    node.express_number,
    node.expressNumber,
    node.waybill,
    node.waybill_no,
    node.waybillNo,
    node.tracking_no,
    node.trackingNo,
  );
  const carrier = firstNonEmpty(
    node.express_company_name,
    node.expressCompanyName,
    node.express_company,
    node.expressCompany,
    node.express_company_code,
    node.expressCompanyCode,
    node.carrier,
    node.logistics_company,
    node.logisticsCompany,
  );
  const packageId = firstNonEmpty(
    node.delivery_package_id,
    node.deliveryPackageId,
    node.package_id,
    node.packageId,
  );

  if (expressNo) {
    const key = expressNo.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        packageId,
        expressNo: key,
        carrier,
        isSf: isSfCarrier(node.express_company_code || node.expressCompanyCode, carrier) || /^SF\d{10,}$/i.test(key),
      });
    }
  }

  const childKeys = [
    'delivery_packages',
    'deliveryPackages',
    'express_list',
    'expressList',
    'logistics',
    'packages',
    'express_infos',
    'expressInfos',
    'shipment_list',
    'shipmentList',
  ];
  for (const k of childKeys) {
    if (node[k]) collectExpressFromNode(node[k], out, seen, depth + 1);
  }
}

function extractPackages(raw) {
  const out = [];
  const seen = new Set();
  collectExpressFromNode(raw, out, seen, 0);
  const expressNos = out.map((p) => p.expressNo);
  return { packages: out, expressNos };
}

function pickPaidAmount(raw) {
  const pairs = [
    ['customer_pay_amount', raw.customer_pay_amount],
    ['customerPayAmount', raw.customerPayAmount],
    ['paid_amount', raw.paid_amount],
    ['paidAmount', raw.paidAmount],
    ['pay_amount', raw.pay_amount],
    ['payAmount', raw.payAmount],
    ['order_amount', raw.order_amount],
    ['orderAmount', raw.orderAmount],
    ['deal_price', raw.deal_price],
    ['dealPrice', raw.dealPrice],
  ];
  for (const [key, val] of pairs) {
    const parsed = parseFieldAmount(key, val);
    if (parsed != null && parsed > 0) return parsed;
  }
  const skus = raw.sku_snapshots || raw.skuSnapshots || [];
  if (Array.isArray(skus) && skus.length) {
    let sum = 0;
    let hit = 0;
    for (const sku of skus) {
      const skuPay = parseFieldAmount('sku_pay_amount', sku.sku_pay_amount ?? sku.skuPayAmount);
      if (skuPay != null && skuPay > 0) {
        sum += skuPay;
        hit += 1;
      }
    }
    if (hit > 0) return roundYuan(sum);
  }
  return null;
}

function pickAfterSaleFromSkus(raw) {
  const skus = raw.sku_snapshots || raw.skuSnapshots || [];
  if (!Array.isArray(skus) || !skus.length) return { hasAfterSale: false, afterSaleStatus: '' };
  const sku = skus.find((s) => Number(s.return_type) > 0 || /待寄回|退货|退款|售后/.test(String(s.status_name || '')))
    || skus[0];
  const status = String(sku.status_name || '').trim();
  const hasAfterSale = Number(sku.return_type) > 0 || /待寄回|退货|退款|售后/.test(status);
  return { hasAfterSale, afterSaleStatus: status };
}

function pickNegotiateRefundAmount(raw) {
  const list = raw.negotiate_order || raw.negotiateOrder;
  if (!Array.isArray(list) || !list.length) return null;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i] || {};
    const amt = parseFieldAmount('negotiate_returns_amount', item.negotiate_returns_amount)
      ?? parseFieldAmount('origin_negotiate_returns_amount', item.origin_negotiate_returns_amount);
    if (amt != null) return amt;
  }
  return null;
}

function pickRefundApplyFromReturnsV3(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const direct = parseFieldAmount('applied_amount', raw.applied_amount)
    ?? parseFieldAmount('expected_refund_amount', raw.expected_refund_amount)
    ?? parseFieldAmount('expect_refund_fee', raw.expect_refund_fee)
    ?? parseFieldAmount('apply_amount', raw.apply_amount)
    ?? parseFieldAmount('applyAmount', raw.applyAmount)
    ?? parseFieldAmount('refund_apply_amount', raw.refund_apply_amount)
    ?? parseFieldAmount('refundApplyAmount', raw.refundApplyAmount);
  if (direct != null) return direct;
  const negotiate = pickNegotiateRefundAmount(raw);
  if (negotiate != null) return negotiate;
  const refundFee = parseFieldAmount('refund_fee', raw.refund_fee ?? raw.refundFee);
  if (refundFee != null) return refundFee;
  const sku = parseFieldAmount('applied_skus_amount_sum', raw.applied_skus_amount_sum ?? raw.appliedSkusAmountSum);
  const ship = parseFieldAmount('applied_ship_fee_amount', raw.applied_ship_fee_amount ?? raw.appliedShipFeeAmount);
  if (sku != null || ship != null) return roundYuan((sku || 0) + (ship || 0));
  return null;
}

function pickRefundActualFromReturnsV3(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return parseFieldAmount('refund_amount', raw.refund_amount)
    ?? parseFieldAmount('actual_refund_amount', raw.actual_refund_amount)
    ?? parseFieldAmount('refunded_amount', raw.refunded_amount);
}

function normalizePackageDetail(data, hints = {}) {
  const raw = data || {};
  const returnInfoRaw = raw.return_info ?? raw.returnInfo ?? null;
  const returnInfo = pickActiveReturnInfo(returnInfoRaw);
  const afterSale = raw.after_sale || raw.afterSale || {};
  const { packages, expressNos } = extractPackages(raw);

  const returnsId = firstNonEmpty(
    hints.returnsId,
    extractReturnsId(raw),
    extractReturnsIdFromReturnInfoItem(returnInfo),
    extractReturnsId(afterSale),
    extractReturnsId(raw.after_sales?.[0]),
  );

  const skuAfterSale = pickAfterSaleFromSkus(raw);

  const paidAmount = pickPaidAmount(raw);
  const refundApplyAmount = parseFieldAmount('return_amt', returnInfo?.return_amt)
    ?? parseFieldAmount('returnAmt', returnInfo?.returnAmt)
    ?? parseFieldAmount('apply_amount', returnInfo?.apply_amount)
    ?? parseFieldAmount('applyAmount', returnInfo?.applyAmount)
    ?? parseFieldAmount('refund_amount', returnInfo?.refund_amount)
    ?? parseFieldAmount('apply_amount', afterSale.apply_amount)
    ?? parseFieldAmount('refund_apply_amount', afterSale.refund_apply_amount);
  const refundActualAmount = parseFieldAmount('refunded_amount', returnInfo?.refunded_amount)
    ?? parseFieldAmount('refund_amount', afterSale.refund_amount)
    ?? parseFieldAmount('actual_refund_amount', afterSale.actual_refund_amount);
  const afterSaleStatus = firstNonEmpty(
    afterSale.status_name,
    afterSale.status,
    returnInfo?.status_str,
    returnInfo?.status,
    skuAfterSale.afterSaleStatus,
  );
  const hasAfterSale = Boolean(
    skuAfterSale.hasAfterSale
    || (Array.isArray(returnInfoRaw) && returnInfoRaw.length > 0)
    || (returnInfo && typeof returnInfo === 'object')
    || returnsId
    || refundApplyAmount != null
    || refundActualAmount != null,
  );

  return {
    packageId: firstNonEmpty(hints.packageId, raw.package_id, raw.packageId),
    returnsId,
    expressNos,
    packages,
    rawExpress: expressNos[0] || '',
    paidAmount,
    refundApplyAmount,
    refundActualAmount,
    hasAfterSale,
    afterSaleStatus: String(afterSaleStatus || '').trim(),
    afterSaleType: String(afterSale.type || afterSale.type_name || returnInfo?.type || '').trim(),
    source: 'package_detail',
  };
}

function normalizeAfterSale(data, hints = {}) {
  const raw = data || {};
  const afterSale = raw.after_sale || raw.afterSale || raw;
  const returnsId = firstNonEmpty(hints.returnsId, extractReturnsId(raw), extractReturnsId(afterSale));
  const refundApplyAmount = pickRefundApplyFromReturnsV3(afterSale) ?? pickRefundApplyFromReturnsV3(raw);
  const refundActualAmount = pickRefundActualFromReturnsV3(afterSale) ?? pickRefundActualFromReturnsV3(raw);
  const paidAmount = pickPaidAmount(afterSale) ?? pickPaidAmount(raw);
  const status = String(afterSale.status_name || afterSale.status || raw.status || '').trim();
  const type = String(afterSale.type_name || afterSale.type || raw.type || '').trim();
  if (!returnsId && !status && !type && refundApplyAmount == null && refundActualAmount == null) {
    return null;
  }
  const hasAfterSale = Boolean(
    returnsId
    || refundApplyAmount != null
    || refundActualAmount != null
    || /售后|退款|退货|待寄回/.test(status),
  );
  return {
    packageId: firstNonEmpty(hints.packageId, afterSale.package_id, raw.package_id),
    returnsId,
    expressNos: [],
    packages: [],
    rawExpress: '',
    paidAmount,
    refundApplyAmount,
    refundActualAmount,
    hasAfterSale,
    afterSaleStatus: status,
    afterSaleType: type,
    source: 'after_sale',
  };
}

function normalizeSfFee(result) {
  const waybill = String(result?.waybill || '').trim();
  if (!result?.ok) {
    const msg = String(result?.error || result?.errorCode || 'sf_query_failed');
    let errorCode = 'upstream_error';
    if (/非顺丰/.test(msg)) errorCode = 'not_applicable';
    else if (/未配置|月结卡/.test(msg)) errorCode = 'config_error';
    else if (/8151|8148|not_found/.test(msg) || result?.errorCode === 'not_found' || result?.errorCode === '8148') {
      errorCode = 'not_found';
    }
    return { sfFee: null, error: msg, errorCode, waybill, state: errorCode };
  }
  const fee = result.totalFee != null ? roundYuan(result.totalFee)
    : (result.sfFee != null ? roundYuan(result.sfFee) : null);
  return { sfFee: fee, error: null, errorCode: null, waybill, state: 'fresh' };
}

function computeProfit(paidAmount, refundApplyAmount, sfFee, sfFeeComplete = true) {
  if (!sfFeeComplete) return null;
  if (paidAmount == null || refundApplyAmount == null || sfFee == null) return null;
  return roundYuan(paidAmount - refundApplyAmount - sfFee);
}

function mergeSfWaybillResults(results = []) {
  const sfWaybills = [];
  let sfFee = 0;
  let sfSuccessCount = 0;
  let sfFailedCount = 0;
  let hasSf = false;
  let firstError = null;
  let firstErrorCode = null;

  for (const item of results) {
    if (!item) continue;
    const waybill = String(item.waybill || '').trim();
    if (!waybill) continue;
    hasSf = true;
    const entry = {
      waybill,
      fee: item.sfFee ?? null,
      state: item.errorCode || item.state || (item.sfFee != null ? 'fresh' : 'upstream_error'),
      error: item.error || null,
      errorCode: item.errorCode || null,
    };
    sfWaybills.push(entry);
    if (entry.fee != null && !entry.errorCode) {
      sfFee = roundYuan(sfFee + entry.fee);
      sfSuccessCount += 1;
    } else if (entry.errorCode === 'not_applicable') {
      /* skip */
    } else {
      sfFailedCount += 1;
      if (!firstError) {
        firstError = entry.error;
        firstErrorCode = entry.errorCode;
      }
    }
  }

  const sfWaybillCount = sfWaybills.length;
  let sfFeeComplete = false;
  let state = 'fresh';
  let aggregatedFee = null;

  if (!hasSf) {
    return {
      sfWaybills: [],
      sfFee: null,
      sfFeeComplete: true,
      sfWaybillCount: 0,
      sfSuccessCount: 0,
      sfFailedCount: 0,
      state: 'not_applicable',
      error: null,
      errorCode: 'not_applicable',
    };
  }

  if (sfSuccessCount === sfWaybillCount && sfWaybillCount > 0) {
    sfFeeComplete = true;
    aggregatedFee = sfFee;
    state = 'fresh';
  } else if (sfSuccessCount > 0) {
    sfFeeComplete = false;
    aggregatedFee = sfFee;
    state = 'partial';
  } else {
    sfFeeComplete = false;
    aggregatedFee = null;
    state = firstErrorCode || 'upstream_error';
  }

  return {
    sfWaybills,
    sfFee: aggregatedFee,
    sfFeeComplete,
    sfWaybillCount,
    sfSuccessCount,
    sfFailedCount,
    state,
    error: sfSuccessCount > 0 ? null : firstError,
    errorCode: sfSuccessCount > 0 ? null : firstErrorCode,
  };
}

const { computeAfterSaleMetrics } = require('./after-sale-metrics');

function mergeCardDto(parts = {}) {
  const pkg = parts.package || {};
  const after = parts.afterSale || {};
  const sf = parts.sf || {};
  const hints = parts.hints || {};
  const expressNos = [...new Set([
    ...(hints.expressNos || []),
    ...(pkg.expressNos || []),
    ...(after.expressNos || []),
    hints.expressNo,
    pkg.rawExpress,
    ...(sf.sfWaybills || []).map((w) => w.waybill),
  ].map((x) => String(x || '').trim()).filter(Boolean))];

  const packages = [
    ...(pkg.packages || []),
    ...(after.packages || []),
  ].filter((p, idx, arr) => arr.findIndex((x) => x.expressNo === p.expressNo) === idx);

  const returnsId = firstNonEmpty(hints.returnsId, after.returnsId, pkg.returnsId);
  const paidAmount = (pkg.paidAmount != null && pkg.paidAmount > 0)
    ? pkg.paidAmount
    : (after.paidAmount ?? pkg.paidAmount ?? null);
  const refundApplyAmount = after.refundApplyAmount ?? pkg.refundApplyAmount ?? null;
  const refundActualAmount = after.refundActualAmount ?? pkg.refundActualAmount ?? null;
  const sfFee = sf.sfFee ?? null;
  const sfFeeComplete = sf.sfFeeComplete ?? (sf.sfWaybills ? sf.sfWaybillCount === 0 || sf.sfSuccessCount === sf.sfWaybillCount : true);
  const error = parts.error || sf.error || after.error || pkg.error || null;
  const errorCode = parts.errorCode || sf.errorCode || after.errorCode || pkg.errorCode || null;

  let state = parts.state || sf.state || 'fresh';
  if (errorCode && state === 'fresh') state = errorCode;
  else if (parts.stale) state = 'stale';
  else if (sf.state === 'partial') state = 'partial';

  const afterSaleStatus = after.afterSaleStatus || pkg.afterSaleStatus || hints.afterSaleStatus || '';
  const preMetrics = computeAfterSaleMetrics({
    hints,
    package: pkg,
    afterSale: after,
    afterSaleStatus,
    paidAmount,
    refundApplyAmount,
    refundActualAmount,
    sfFee,
    sfFeeComplete,
  });
  const refundBasisAmount = preMetrics.refundBasisAmount;
  const profit = preMetrics.calculationType === 'suppressed'
    ? null
    : computeProfit(paidAmount, refundBasisAmount, sfFee, sfFeeComplete);
  const metrics = computeAfterSaleMetrics({
    hints,
    package: pkg,
    afterSale: after,
    afterSaleStatus,
    paidAmount,
    refundApplyAmount,
    refundActualAmount,
    sfFee,
    sfFeeComplete,
    profit,
  });

  return {
    packageId: firstNonEmpty(hints.packageId, pkg.packageId, after.packageId),
    shopKey: hints.shopKey || '',
    returnsId,
    expressNos,
    packages,
    rawExpress: expressNos[0] || '',
    paidAmount,
    refundApplyAmount,
    refundActualAmount,
    refundBasisAmount: metrics.refundBasisAmount,
    refundBasis: metrics.refundBasis,
    calculationType: metrics.calculationType,
    hasAfterSale: metrics.hasAfterSale,
    afterSaleLifecycle: metrics.afterSaleLifecycle,
    afterSaleStatus,
    afterSaleType: after.afterSaleType || pkg.afterSaleType || '',
    sfFee,
    sfFeeComplete,
    sfWaybills: sf.sfWaybills || [],
    sfWaybillCount: sf.sfWaybillCount ?? (sf.sfWaybills || []).length,
    sfSuccessCount: sf.sfSuccessCount ?? 0,
    sfFailedCount: sf.sfFailedCount ?? 0,
    netAfterRefund: metrics.netAfterRefund,
    isFullRefund: metrics.isFullRefund,
    warningType: metrics.warningType,
    profit,
    profitPending: !sfFeeComplete && (sf.sfWaybillCount || 0) > 0,
    state,
    source: parts.source || 'merged',
    stale: Boolean(parts.stale),
    updatedAt: parts.updatedAt || Date.now(),
    error,
    errorCode,
    refreshError: parts.refreshError || null,
  };
}

function pickSfWaybills(expressNos) {
  const list = Array.isArray(expressNos) ? expressNos : [expressNos];
  const out = [];
  const seen = new Set();
  for (const w of list) {
    const no = String(w || '').trim().toUpperCase();
    if (!/^SF\d{10,}$/.test(no) || seen.has(no)) continue;
    seen.add(no);
    out.push(no);
  }
  return out;
}

/** @deprecated use pickSfWaybills */
function pickSfWaybill(expressNos) {
  return pickSfWaybills(expressNos)[0] || '';
}

module.exports = {
  YUAN_FIELDS,
  FEN_FIELDS,
  parseYuanAmount,
  parseFenAmount,
  parseFieldAmount,
  parseMoneyYuan,
  extractReturnsId,
  extractReturnsIdFromReturnInfoItem,
  pickActiveReturnInfo,
  extractPackages,
  normalizePackageDetail,
  normalizeAfterSale,
  normalizeSfFee,
  mergeSfWaybillResults,
  mergeCardDto,
  pickSfWaybills,
  pickSfWaybill,
  pickRefundApplyFromReturnsV3,
  computeProfit,
};
