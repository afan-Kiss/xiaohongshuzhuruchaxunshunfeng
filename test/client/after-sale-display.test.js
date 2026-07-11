const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAfterSaleBlocks } = require('../../src/client/after-sale-display');
const { buildCardHtml } = require('../../src/client/render-utils');

const helpers = {
  stateText: () => '—',
  formatSfFee: (item) => (item?.sfFee != null ? `${Number(item.sfFee).toFixed(2)}元` : null),
  isSfNo: (no) => /^SF\d{10,}$/i.test(String(no || '')),
};

describe('after-sale display v3.0.6', () => {
  it('after-sale without returnsId still shows refund row loading', () => {
    const blocks = buildAfterSaleBlocks(
      { hasAfterSale: true, afterSaleLifecycle: 'active', sfFee: 13, sfFeeComplete: true, warningType: 'refund_unverified' },
      { hasAfterSale: true, expressNos: ['SF1234567890123'] },
      helpers,
    );
    assert.ok(blocks.some((b) => b.text === '⚠退款待核对'));
  });

  it('cancelled lifecycle hides refund warning', () => {
    const blocks = buildAfterSaleBlocks({
      hasAfterSale: true,
      afterSaleLifecycle: 'cancelled',
      calculationType: 'suppressed',
      refundApplyAmount: 1998,
      refundActualAmount: 0,
      refundBasisAmount: 0,
      sfFee: 13,
      warningType: null,
    }, { hasAfterSale: true }, helpers);
    assert.equal(blocks.some((b) => /退款|亏损/.test(b.text)), false);
  });

  it('full refund warning uses warn-full class in html', () => {
    const blocks = buildAfterSaleBlocks({
      hasAfterSale: true,
      afterSaleLifecycle: 'active',
      paidAmount: 1998,
      refundApplyAmount: 1998,
      refundBasisAmount: 1998,
      sfFee: 13,
      sfFeeComplete: true,
      profit: -13,
      warningType: 'full_refund_shipping_loss',
    }, { hasAfterSale: true }, helpers);
    const html = buildCardHtml(blocks, false);
    assert.match(html, /qsf-inline-warn-full/);
    assert.match(html, /⚠亏损13\.00元/);
  });

  it('completed uses refundBasisAmount', () => {
    const blocks = buildAfterSaleBlocks({
      hasAfterSale: true,
      afterSaleLifecycle: 'completed',
      refundApplyAmount: 1998,
      refundActualAmount: 1500,
      refundBasisAmount: 1500,
      refundBasis: 'actual',
      sfFee: 13,
      sfFeeComplete: true,
      profit: 485,
    }, { hasAfterSale: true }, helpers);
    assert.ok(blocks.some((b) => b.text === '退款1500.00元'));
    assert.ok(blocks.some((b) => b.text === '利485.00元'));
  });

  it('no after-sale hides refund row', () => {
    const blocks = buildAfterSaleBlocks({
      hasAfterSale: false,
      afterSaleLifecycle: 'none',
      sfFee: 13,
    }, { hasAfterSale: false }, helpers);
    assert.equal(blocks.some((b) => /退款/.test(b.text)), false);
  });

  it('sf partial failure blocks final profit', () => {
    const blocks = buildAfterSaleBlocks({
      hasAfterSale: true,
      afterSaleLifecycle: 'active',
      refundBasisAmount: 1998,
      sfFee: 18,
      sfFeeComplete: false,
      warningType: 'sf_fee_incomplete',
    }, { hasAfterSale: true }, helpers);
    assert.ok(blocks.some((b) => b.text === '⚠利润待核对'));
  });
});
