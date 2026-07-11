const EPSILON = 0.005;

function roundYuan(n) {
  return Math.round(Number(n) * 100) / 100;
}

const LIFECYCLE = {
  NONE: 'none',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown',
};

function resolveAfterSaleLifecycle(status, parts = {}) {
  const s = String(status || '').trim();
  const pkg = parts.package || {};
  const after = parts.afterSale || {};
  const hints = parts.hints || {};
  const hasSignal = Boolean(
    hints.hasAfterSale
    || pkg.hasAfterSale
    || after.hasAfterSale
    || String(hints.returnsId || pkg.returnsId || after.returnsId || '').trim()
    || pkg.refundApplyAmount != null
    || after.refundApplyAmount != null
    || pkg.refundActualAmount != null
    || after.refundActualAmount != null
    || s,
  );

  if (/退款成功|退款完成|已退款|退款已完成/.test(s)) return LIFECYCLE.COMPLETED;
  if (/售后关闭|退款取消|拒绝退款|已取消|关闭/.test(s) && !/售后中|待/.test(s)) {
    return LIFECYCLE.CANCELLED;
  }
  if (/售后中|退款中|待寄回|待买家|待商家|待收货|退货待寄回/.test(s)) {
    return LIFECYCLE.ACTIVE;
  }
  if (!hasSignal) return LIFECYCLE.NONE;
  if (s) return LIFECYCLE.UNKNOWN;
  if (pkg.refundActualAmount != null || after.refundActualAmount != null) {
    const actual = after.refundActualAmount ?? pkg.refundActualAmount;
    if (actual != null && actual <= EPSILON) return LIFECYCLE.CANCELLED;
    if (actual != null && actual > EPSILON) return LIFECYCLE.COMPLETED;
  }
  if (hints.hasAfterSale || pkg.hasAfterSale || after.hasAfterSale
    || pkg.refundApplyAmount != null || after.refundApplyAmount != null
    || String(hints.returnsId || pkg.returnsId || after.returnsId || '').trim()) {
    return LIFECYCLE.ACTIVE;
  }
  return LIFECYCLE.NONE;
}

function detectHasAfterSale(parts = {}) {
  const lifecycle = resolveAfterSaleLifecycle(
    parts.afterSale?.afterSaleStatus || parts.package?.afterSaleStatus || parts.hints?.afterSaleStatus,
    parts,
  );
  return lifecycle !== LIFECYCLE.NONE;
}

function pickRefundBasis(fields = {}) {
  const lifecycle = fields.afterSaleLifecycle || LIFECYCLE.NONE;
  const apply = fields.refundApplyAmount ?? null;
  const actual = fields.refundActualAmount ?? null;

  if (lifecycle === LIFECYCLE.NONE || lifecycle === LIFECYCLE.CANCELLED) {
    if (lifecycle === LIFECYCLE.CANCELLED && (actual == null || actual <= EPSILON)) {
      return {
        refundBasisAmount: actual == null ? 0 : actual,
        refundBasis: actual == null ? 'cancelled_zero' : 'actual',
        calculationType: 'suppressed',
      };
    }
    if (lifecycle === LIFECYCLE.NONE) {
      return { refundBasisAmount: null, refundBasis: 'none', calculationType: 'none' };
    }
  }
  if (lifecycle === LIFECYCLE.COMPLETED) {
    if (actual != null) {
      return { refundBasisAmount: actual, refundBasis: 'actual', calculationType: 'final' };
    }
    if (apply != null) {
      return { refundBasisAmount: apply, refundBasis: 'apply', calculationType: 'final_fallback_apply' };
    }
    return { refundBasisAmount: null, refundBasis: 'missing', calculationType: 'final' };
  }
  if (lifecycle === LIFECYCLE.ACTIVE || lifecycle === LIFECYCLE.UNKNOWN) {
    if (apply != null) {
      return { refundBasisAmount: apply, refundBasis: 'apply', calculationType: 'expected' };
    }
    return { refundBasisAmount: null, refundBasis: 'missing', calculationType: 'expected' };
  }
  return { refundBasisAmount: apply, refundBasis: apply != null ? 'apply' : 'missing', calculationType: 'expected' };
}

function computeIsFullRefund(paidAmount, refundBasisAmount) {
  if (paidAmount == null || refundBasisAmount == null) return false;
  return refundBasisAmount >= paidAmount - EPSILON;
}

function computeWarningType(fields = {}) {
  const {
    hasAfterSale,
    afterSaleLifecycle,
    paidAmount,
    refundBasisAmount,
    calculationType,
    sfFee,
    sfFeeComplete,
    profit,
    isFullRefund,
  } = fields;
  if (!hasAfterSale) return null;
  if (afterSaleLifecycle === LIFECYCLE.CANCELLED || calculationType === 'suppressed') return null;
  if (afterSaleLifecycle === LIFECYCLE.NONE) return null;
  if (sfFeeComplete === false) return 'sf_fee_incomplete';
  if (refundBasisAmount == null) {
    if (afterSaleLifecycle === LIFECYCLE.ACTIVE || afterSaleLifecycle === LIFECYCLE.UNKNOWN) {
      return 'refund_unverified';
    }
    return null;
  }
  if (isFullRefund && sfFee != null && sfFee > EPSILON) return 'full_refund_shipping_loss';
  if (profit != null && profit < -EPSILON) return 'expected_loss';
  if (profit != null && Math.abs(profit) <= EPSILON) return 'zero_profit';
  return null;
}

function computeAfterSaleMetrics(fields = {}) {
  const status = fields.afterSaleStatus
    || fields.afterSale?.afterSaleStatus
    || fields.package?.afterSaleStatus
    || fields.hints?.afterSaleStatus
    || '';
  const afterSaleLifecycle = resolveAfterSaleLifecycle(status, fields);
  const hasAfterSale = afterSaleLifecycle !== LIFECYCLE.NONE;
  const paidAmount = fields.paidAmount ?? null;
  const refundApplyAmount = fields.refundApplyAmount ?? null;
  const refundActualAmount = fields.refundActualAmount ?? null;
  const basis = pickRefundBasis({
    afterSaleLifecycle,
    refundApplyAmount,
    refundActualAmount,
  });
  const sfFee = fields.sfFee ?? null;
  const sfFeeComplete = fields.sfFeeComplete !== false;
  const refundBasisAmount = basis.refundBasisAmount;
  const netAfterRefund = paidAmount != null && refundBasisAmount != null
    ? roundYuan(paidAmount - refundBasisAmount)
    : null;
  const isFullRefund = basis.calculationType === 'suppressed'
    ? false
    : computeIsFullRefund(paidAmount, refundBasisAmount);
  const profit = fields.profit ?? null;
  const warningType = computeWarningType({
    hasAfterSale,
    afterSaleLifecycle,
    paidAmount,
    refundBasisAmount,
    calculationType: basis.calculationType,
    sfFee,
    sfFeeComplete,
    profit,
    isFullRefund,
  });
  return {
    hasAfterSale,
    afterSaleLifecycle,
    refundBasisAmount,
    refundBasis: basis.refundBasis,
    calculationType: basis.calculationType,
    netAfterRefund,
    isFullRefund,
    warningType,
  };
}

module.exports = {
  EPSILON,
  LIFECYCLE,
  resolveAfterSaleLifecycle,
  detectHasAfterSale,
  pickRefundBasis,
  computeIsFullRefund,
  computeWarningType,
  computeAfterSaleMetrics,
};
