/**
 * After-sale card display blocks — compact inline text for amount row.
 */
const EPSILON = 0.005;

function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return `${Number(n).toFixed(2)}元`;
}

function buildAfterSaleBlocks(item, snap, helpers = {}) {
  const stateText = helpers.stateText || (() => '—');
  const formatSfFee = helpers.formatSfFee || (() => null);
  const hasAfterSale = Boolean(
    item?.hasAfterSale
    || snap?.hasAfterSale
    || snap?.hasRefund,
  );
  const blocks = [];

  let feeText = '…';
  const formatted = formatSfFee(item);
  if (formatted) feeText = formatted;
  else if (item?.errorCode === 'not_applicable') feeText = '非顺丰';
  else if (!(snap?.expressNos || []).some(helpers.isSfNo) && !item?.expressNos?.some(helpers.isSfNo)) feeText = '无物流单号';
  else if (item) feeText = stateText(item, 'sf');

  const feeCompact = feeText === '…' ? '月结查询中…' : `月结${feeText}`;
  const feeTitle = feeText === '…' ? '顺丰月结费用：查询中…' : `顺丰月结费用：${feeText}`;
  blocks.push({
    text: feeCompact,
    title: feeTitle,
    kind: feeText === '…' ? 'muted' : '',
  });

  if (hasAfterSale) {
    let refundText = '退款查询中…';
    let refundTitle = '用户申请退款金额：查询中…';
    let refundKind = 'muted';
    if (item?.refundApplyAmount != null) {
      refundText = `退款${fmtMoney(item.refundApplyAmount)}`;
      refundTitle = `用户申请退款金额：${fmtMoney(item.refundApplyAmount)}`;
      refundKind = 'refund';
    } else if (item && item.warningType === 'refund_unverified') {
      refundText = '⚠退款待核对';
      refundTitle = '订单售后中，退款金额尚未核对';
      refundKind = 'warn-full';
    } else if (item) {
      const st = stateText(item, 'refund');
      refundText = st === '—' ? '退款查询中…' : `退款${st}`;
      refundTitle = `用户申请退款金额：${st}`;
      refundKind = 'muted';
    }
    blocks.push({ text: refundText, title: refundTitle, kind: refundKind });
  }

  if (hasAfterSale && item?.warningType === 'sf_fee_incomplete') {
    blocks.push({
      text: '⚠利润待核对',
      title: '运费未查询完整，暂不能计算最终亏损',
      kind: 'warn-full',
    });
    return blocks;
  }

  if (!hasAfterSale || item?.refundApplyAmount == null) return blocks;
  if (item.sfFeeComplete === false || item.profitPending) return blocks;

  const profit = item.profit;
  const sfFee = item.sfFee;
  if (item.warningType === 'full_refund_shipping_loss' && sfFee != null) {
    const loss = fmtMoney(sfFee);
    blocks.push({
      text: `⚠亏损${loss}`,
      title: `全额退款，仍产生顺丰费用${loss}，预计亏损${loss}`,
      kind: 'warn-full',
    });
    return blocks;
  }

  if (profit == null || sfFee == null) return blocks;

  if (profit > EPSILON) {
    blocks.push({
      text: `利${fmtMoney(profit)}`,
      title: `实际剩余利润：${fmtMoney(profit)}`,
      kind: 'profit',
    });
  } else if (Math.abs(profit) <= EPSILON) {
    blocks.push({
      text: '⚠利润0元',
      title: '退款后不含运费利润为0元',
      kind: 'warn',
    });
  } else {
    const loss = fmtMoney(Math.abs(profit));
    blocks.push({
      text: `⚠亏损${loss}`,
      title: `预计亏损${loss}`,
      kind: 'warn-full',
    });
  }

  return blocks;
}

module.exports = {
  EPSILON,
  buildAfterSaleBlocks,
};
