const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAfterSaleBlocks } = require('../../src/client/after-sale-display');
const { buildCardHtml } = require('../../src/client/render-utils');

const helpers = {
  stateText: () => '—',
  formatSfFee: (item) => (item?.sfFee != null ? `${Number(item.sfFee).toFixed(2)}元` : null),
  isSfNo: (no) => /^SF\d{10,}$/i.test(String(no || '')),
};

describe('after-sale display v3.0.5', () => {
  it('after-sale without returnsId still shows refund row loading', () => {
    const blocks = buildAfterSaleBlocks(
      { hasAfterSale: true, sfFee: 13, sfFeeComplete: true },
      { hasAfterSale: true, expressNos: ['SF1234567890123'] },
      helpers,
    );
    assert.ok(blocks.some((b) => b.label === '用户申请退款金额：' && b.text === '…'));
  });

  it('full refund warning uses warn-full class in html', () => {
    const blocks = buildAfterSaleBlocks({
      hasAfterSale: true,
      paidAmount: 1998,
      refundApplyAmount: 1998,
      sfFee: 13,
      sfFeeComplete: true,
      profit: -13,
      warningType: 'full_refund_shipping_loss',
    }, { hasAfterSale: true }, helpers);
    const html = buildCardHtml(blocks, false);
    assert.match(html, /qsf-inline-warn-full/);
    assert.match(html, /全额退款，仍产生顺丰费用13\.00元，预计亏损13\.00元/);
    assert.doesNotMatch(html, /赚到-13/);
  });

  it('negative profit shows 预计亏损', () => {
    const blocks = buildAfterSaleBlocks({
      hasAfterSale: true,
      paidAmount: 2000,
      refundApplyAmount: 1900,
      sfFee: 13,
      sfFeeComplete: true,
      profit: -13,
      warningType: 'expected_loss',
    }, { hasAfterSale: true }, helpers);
    assert.ok(blocks.some((b) => /预计亏损13\.00元/.test(b.text)));
  });

  it('refund unverified shows warning', () => {
    const blocks = buildAfterSaleBlocks({
      hasAfterSale: true,
      sfFee: 13,
      warningType: 'refund_unverified',
    }, { hasAfterSale: true }, helpers);
    assert.ok(blocks.some((b) => b.text === '未获取'));
    assert.ok(blocks.some((b) => /退款金额尚未核对/.test(b.text)));
  });

  it('no after-sale hides refund row', () => {
    const blocks = buildAfterSaleBlocks({
      hasAfterSale: false,
      sfFee: 13,
    }, { hasAfterSale: false }, helpers);
    assert.equal(blocks.some((b) => b.label === '用户申请退款金额：'), false);
  });

  it('sf partial failure blocks final profit', () => {
    const blocks = buildAfterSaleBlocks({
      hasAfterSale: true,
      refundApplyAmount: 1998,
      sfFee: 18,
      sfFeeComplete: false,
      warningType: 'sf_fee_incomplete',
    }, { hasAfterSale: true }, helpers);
    assert.ok(blocks.some((b) => /运费未查询完整/.test(b.text)));
    assert.equal(blocks.some((b) => /赚到/.test(b.text)), false);
  });
});
