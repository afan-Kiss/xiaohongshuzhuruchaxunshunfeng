/**
 * After-sale card display blocks — uses Data Core DTO fields.
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
  blocks.push({ label: '月结费用：', text: feeText, kind: feeText === '…' ? 'muted' : '' });

  if (hasAfterSale) {
    let refundText = '…';
    let refundKind = 'muted';
    if (item?.refundApplyAmount != null) {
      refundText = fmtMoney(item.refundApplyAmount);
      refundKind = 'refund';
    } else if (item && item.warningType === 'refund_unverified') {
      refundText = '未获取';
      refundKind = 'refund';
    } else if (!item || item.refundApplyAmount == null) {
      refundText = '…';
      refundKind = 'muted';
    } else if (item) {
      refundText = stateText(item, 'refund');
      refundKind = 'muted';
    }
    blocks.push({ label: '用户申请退款金额：', text: refundText, kind: refundKind });
    if (item?.warningType === 'refund_unverified') {
      blocks.push({
        label: '',
        text: '⚠ 订单售后中，退款金额尚未核对',
        kind: 'warn-full',
      });
    }
  }

  if (hasAfterSale && item?.warningType === 'sf_fee_incomplete') {
    blocks.push({
      label: '',
      text: '⚠ 运费未查询完整，暂不能计算最终亏损',
      kind: 'warn-full',
    });
    return blocks;
  }

  if (!hasAfterSale || item?.refundApplyAmount == null) return blocks;
  if (item.sfFeeComplete === false || item.profitPending) return blocks;

  const profit = item.profit;
  const sfFee = item.sfFee;
  if (item.warningType === 'full_refund_shipping_loss' && sfFee != null) {
    blocks.push({
      label: '',
      text: `⚠ 全额退款，仍产生顺丰费用${fmtMoney(sfFee)}，预计亏损${fmtMoney(sfFee)}`,
      kind: 'warn-full',
    });
    return blocks;
  }

  if (profit == null || sfFee == null) return blocks;

  if (profit > EPSILON) {
    blocks.push({ label: '', text: `实际剩余利润：${fmtMoney(profit)}`, kind: 'profit' });
  } else if (Math.abs(profit) <= EPSILON) {
    blocks.push({ label: '', text: '退款后不含运费利润为0元', kind: 'warn' });
  } else {
    blocks.push({ label: '', text: `⚠ 预计亏损${fmtMoney(Math.abs(profit))}`, kind: 'warn-full' });
  }

  return blocks;
}

module.exports = {
  EPSILON,
  buildAfterSaleBlocks,
};
