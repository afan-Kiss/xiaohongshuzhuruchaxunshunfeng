const EPSILON = 0.005;

function roundYuan(n) {
  return Math.round(Number(n) * 100) / 100;
}

function isClosedAfterSaleStatus(status) {
  const s = String(status || '').trim();
  if (!s) return false;
  return /售后关闭|退款取消|已取消|拒绝退款|关闭|取消/.test(s) && !/售后中|待/.test(s);
}

function isActiveAfterSaleStatus(status) {
  const s = String(status || '').trim();
  if (!s) return false;
  if (isClosedAfterSaleStatus(s)) return false;
  return /售后中|退款中|退货|待寄回|待买家|待商家|退款|售后/.test(s);
}

function detectHasAfterSale(parts = {}) {
  const hints = parts.hints || {};
  const pkg = parts.package || {};
  const after = parts.afterSale || {};
  if (hints.hasAfterSale === true) return true;
  if (String(hints.returnsId || pkg.returnsId || after.returnsId || '').trim()) return true;
  if (pkg.refundApplyAmount != null || after.refundApplyAmount != null) return true;
  if (pkg.refundActualAmount != null || after.refundActualAmount != null) return true;
  if (pkg.hasAfterSale || after.hasAfterSale) return true;
  if (isActiveAfterSaleStatus(pkg.afterSaleStatus) || isActiveAfterSaleStatus(after.afterSaleStatus)) return true;
  if (isActiveAfterSaleStatus(hints.afterSaleStatus)) return true;
  return false;
}

function computeIsFullRefund(paidAmount, refundApplyAmount) {
  if (paidAmount == null || refundApplyAmount == null) return false;
  return refundApplyAmount >= paidAmount - EPSILON;
}

function computeWarningType(fields = {}) {
  const {
    hasAfterSale,
    paidAmount,
    refundApplyAmount,
    sfFee,
    sfFeeComplete,
    profit,
    isFullRefund,
  } = fields;
  if (!hasAfterSale) return null;
  if (sfFeeComplete === false) return 'sf_fee_incomplete';
  if (refundApplyAmount == null) return 'refund_unverified';
  if (isFullRefund && sfFee != null && sfFee > EPSILON) return 'full_refund_shipping_loss';
  if (profit != null && profit < -EPSILON) return 'expected_loss';
  if (profit != null && Math.abs(profit) <= EPSILON) return 'zero_profit';
  return null;
}

function computeAfterSaleMetrics(fields = {}) {
  const hasAfterSale = detectHasAfterSale(fields);
  const paidAmount = fields.paidAmount ?? null;
  const refundApplyAmount = fields.refundApplyAmount ?? null;
  const sfFee = fields.sfFee ?? null;
  const sfFeeComplete = fields.sfFeeComplete !== false;
  const netAfterRefund = paidAmount != null && refundApplyAmount != null
    ? roundYuan(paidAmount - refundApplyAmount)
    : null;
  const isFullRefund = computeIsFullRefund(paidAmount, refundApplyAmount);
  const profit = fields.profit ?? null;
  const warningType = computeWarningType({
    hasAfterSale,
    paidAmount,
    refundApplyAmount,
    sfFee,
    sfFeeComplete,
    profit,
    isFullRefund,
  });
  return {
    hasAfterSale,
    netAfterRefund,
    isFullRefund,
    warningType,
  };
}

module.exports = {
  EPSILON,
  isActiveAfterSaleStatus,
  isClosedAfterSaleStatus,
  detectHasAfterSale,
  computeIsFullRefund,
  computeWarningType,
  computeAfterSaleMetrics,
};
