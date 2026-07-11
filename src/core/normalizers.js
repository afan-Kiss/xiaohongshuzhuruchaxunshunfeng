/**
 * Unified parsing for package detail, after-sale, and card DTO.
 * Amounts: explicit yuan vs fen fields — never guess by magnitude.
 */

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
    obj.id,
  );
}

function pickRefundApplyFromReturnsV3(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const direct = parseYuanAmount(
    raw.applied_amount
      ?? raw.expected_refund_amount
      ?? raw.apply_amount
      ?? raw.applyAmount,
  );
  if (direct != null) return direct;
  const refundFee = parseYuanAmount(raw.refund_fee ?? raw.refundFee);
  if (refundFee != null) return refundFee;
  const sku = parseFenAmount(raw.applied_skus_amount_sum ?? raw.appliedSkusAmountSum);
  const ship = parseFenAmount(raw.applied_ship_fee_amount ?? raw.appliedShipFeeAmount);
  if (sku != null || ship != null) return roundYuan((sku || 0) + (ship || 0));
  return null;
}

function pickRefundActualFromReturnsV3(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return parseYuanAmount(
    raw.refund_amount
      ?? raw.actual_refund_amount
      ?? raw.refunded_amount,
  );
}

function normalizePackageDetail(data, hints = {}) {
  const raw = data || {};
  const returnInfo = raw.return_info || raw.returnInfo || {};
  const afterSale = raw.after_sale || raw.afterSale || {};
  const returnsId = firstNonEmpty(
    hints.returnsId,
    extractReturnsId(raw),
    extractReturnsId(returnInfo),
    extractReturnsId(afterSale),
    extractReturnsId(raw.after_sales?.[0]),
  );
  const paidAmount = parseYuanAmount(
    raw.paid_amount ?? raw.paidAmount ?? raw.pay_amount ?? raw.order_amount,
  );
  const refundApplyAmount = parseYuanAmount(
    returnInfo.return_amt
      ?? returnInfo.refund_amount
      ?? returnInfo.apply_amount
      ?? afterSale.apply_amount
      ?? afterSale.refund_apply_amount,
  );
  const refundActualAmount = parseYuanAmount(
    returnInfo.refunded_amount ?? afterSale.refund_amount ?? afterSale.actual_refund_amount,
  );
  const expressNos = [];
  const expressList = raw.express_list || raw.expressList || raw.logistics || [];
  if (Array.isArray(expressList)) {
    for (const e of expressList) {
      const no = String(e?.express_no || e?.expressNo || e?.waybill || e || '').trim();
      if (no) expressNos.push(no);
    }
  }
  const singleNo = String(raw.express_no || raw.expressNo || raw.waybill || '').trim();
  if (singleNo && !expressNos.includes(singleNo)) expressNos.push(singleNo);

  return {
    packageId: firstNonEmpty(hints.packageId, raw.package_id, raw.packageId),
    returnsId,
    expressNos,
    rawExpress: expressNos[0] || '',
    paidAmount,
    refundApplyAmount,
    refundActualAmount,
    afterSaleStatus: String(afterSale.status || returnInfo.status || '').trim(),
    afterSaleType: String(afterSale.type || returnInfo.type || '').trim(),
    source: 'package_detail',
  };
}

function normalizeAfterSale(data, hints = {}) {
  const raw = data || {};
  const afterSale = raw.after_sale || raw.afterSale || raw;
  const returnsId = firstNonEmpty(hints.returnsId, extractReturnsId(raw), extractReturnsId(afterSale));
  const refundApplyAmount = pickRefundApplyFromReturnsV3(afterSale) ?? pickRefundApplyFromReturnsV3(raw);
  const refundActualAmount = pickRefundActualFromReturnsV3(afterSale) ?? pickRefundActualFromReturnsV3(raw);
  const paidAmount = parseYuanAmount(
    afterSale.paid_amount ?? raw.paid_amount ?? afterSale.order_amount,
  );
  const status = String(afterSale.status || raw.status || '').trim();
  const type = String(afterSale.type || raw.type || '').trim();
  if (!returnsId && !status && !type && refundApplyAmount == null && refundActualAmount == null) {
    return null;
  }
  return {
    packageId: firstNonEmpty(hints.packageId, afterSale.package_id, raw.package_id),
    returnsId,
    expressNos: [],
    rawExpress: '',
    paidAmount,
    refundApplyAmount,
    refundActualAmount,
    afterSaleStatus: status,
    afterSaleType: type,
    source: 'after_sale',
  };
}

function normalizeSfFee(result) {
  const waybill = String(result?.waybill || '').trim();
  if (!result?.ok) {
    const msg = String(result?.error || 'sf_query_failed');
    let errorCode = 'upstream_error';
    if (/非顺丰/.test(msg)) errorCode = 'not_applicable';
    else if (/未配置|月结卡/.test(msg)) errorCode = 'config_error';
    else if (/8151|8148/.test(msg)) errorCode = 'not_found';
    return { sfFee: null, error: msg, errorCode, waybill };
  }
  const fee = result.totalFee != null ? roundYuan(result.totalFee) : null;
  return { sfFee: fee, error: null, errorCode: null, waybill };
}

function computeProfit(paidAmount, refundApplyAmount, sfFee) {
  if (paidAmount == null || refundApplyAmount == null) return null;
  const sf = sfFee != null ? sfFee : 0;
  return roundYuan(paidAmount - refundApplyAmount - sf);
}

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
  ].map((x) => String(x || '').trim()).filter(Boolean))];

  const returnsId = firstNonEmpty(hints.returnsId, after.returnsId, pkg.returnsId);
  const paidAmount = after.paidAmount ?? pkg.paidAmount ?? null;
  const refundApplyAmount = after.refundApplyAmount ?? pkg.refundApplyAmount ?? null;
  const refundActualAmount = after.refundActualAmount ?? pkg.refundActualAmount ?? null;
  const sfFee = sf.sfFee ?? null;
  const error = parts.error || sf.error || after.error || pkg.error || null;
  const errorCode = parts.errorCode || sf.errorCode || after.errorCode || pkg.errorCode || null;

  let state = parts.state || 'fresh';
  if (errorCode) state = errorCode;
  else if (parts.stale) state = 'stale';

  return {
    packageId: firstNonEmpty(hints.packageId, pkg.packageId, after.packageId),
    shopKey: hints.shopKey || '',
    returnsId,
    expressNos,
    rawExpress: expressNos[0] || '',
    paidAmount,
    refundApplyAmount,
    refundActualAmount,
    afterSaleStatus: after.afterSaleStatus || pkg.afterSaleStatus || '',
    afterSaleType: after.afterSaleType || pkg.afterSaleType || '',
    sfFee,
    profit: computeProfit(paidAmount, refundApplyAmount, sfFee),
    state,
    source: parts.source || 'merged',
    stale: Boolean(parts.stale),
    updatedAt: parts.updatedAt || Date.now(),
    error,
    errorCode,
    refreshError: parts.refreshError || null,
  };
}

function pickSfWaybill(expressNos) {
  const list = Array.isArray(expressNos) ? expressNos : [expressNos];
  for (const w of list) {
    const no = String(w || '').trim().toUpperCase();
    if (/^SF\d{10,}$/.test(no)) return no;
  }
  return '';
}

module.exports = {
  parseYuanAmount,
  parseFenAmount,
  parseMoneyYuan,
  extractReturnsId,
  normalizePackageDetail,
  normalizeAfterSale,
  normalizeSfFee,
  mergeCardDto,
  pickSfWaybill,
  pickRefundApplyFromReturnsV3,
  computeProfit,
};
