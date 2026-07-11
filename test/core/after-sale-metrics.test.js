const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveAfterSaleLifecycle,
  computeAfterSaleMetrics,
  LIFECYCLE,
} = require('../../src/core/after-sale-metrics');
const { mergeCardDto, mergeSfWaybillResults } = require('../../src/core/normalizers');

describe('after-sale metrics v3.0.6', () => {
  it('full refund 1998 + sf 13 → full_refund_shipping_loss', () => {
    const m = computeAfterSaleMetrics({
      package: { paidAmount: 1998, refundApplyAmount: 1998, hasAfterSale: true, afterSaleStatus: '待寄回' },
      paidAmount: 1998,
      refundApplyAmount: 1998,
      sfFee: 13,
      sfFeeComplete: true,
      profit: -13,
    });
    assert.equal(m.afterSaleLifecycle, LIFECYCLE.ACTIVE);
    assert.equal(m.refundBasisAmount, 1998);
    assert.equal(m.warningType, 'full_refund_shipping_loss');
    assert.equal(m.isFullRefund, true);
  });

  it('completed uses actual refund 1500 not apply 1998', () => {
    const dto = mergeCardDto({
      hints: { packageId: 'P1', hasAfterSale: true },
      package: { paidAmount: 1998, hasAfterSale: true },
      afterSale: {
        refundApplyAmount: 1998,
        refundActualAmount: 1500,
        afterSaleStatus: '退款完成',
        hasAfterSale: true,
      },
      sf: mergeSfWaybillResults([{ waybill: 'SF1', sfFee: 13, errorCode: null }]),
    });
    assert.equal(dto.afterSaleLifecycle, LIFECYCLE.COMPLETED);
    assert.equal(dto.refundBasisAmount, 1500);
    assert.equal(dto.refundBasis, 'actual');
    assert.equal(dto.profit, 1998 - 1500 - 13);
    assert.equal(dto.isFullRefund, false);
  });

  it('cancelled with actual 0 suppresses loss warning', () => {
    const dto = mergeCardDto({
      hints: { packageId: 'P1', hasAfterSale: true },
      package: { paidAmount: 1998, hasAfterSale: true },
      afterSale: {
        refundApplyAmount: 1998,
        refundActualAmount: 0,
        afterSaleStatus: '退款取消',
        hasAfterSale: true,
      },
      sf: mergeSfWaybillResults([{ waybill: 'SF1', sfFee: 13, errorCode: null }]),
    });
    assert.equal(dto.afterSaleLifecycle, LIFECYCLE.CANCELLED);
    assert.equal(dto.calculationType, 'suppressed');
    assert.equal(dto.warningType, null);
    assert.equal(dto.profit, null);
  });

  it('closed without refund amount does not show refund_unverified', () => {
    const m = computeAfterSaleMetrics({
      package: { paidAmount: 1998, hasAfterSale: true, afterSaleStatus: '售后关闭' },
      paidAmount: 1998,
      refundApplyAmount: null,
      sfFee: 13,
      sfFeeComplete: true,
    });
    assert.equal(m.afterSaleLifecycle, LIFECYCLE.CANCELLED);
    assert.equal(m.warningType, null);
  });

  it('active without refund amount → refund_unverified', () => {
    const m = computeAfterSaleMetrics({
      package: { paidAmount: 1998, hasAfterSale: true, afterSaleStatus: '待寄回' },
      paidAmount: 1998,
      refundApplyAmount: null,
      sfFee: 13,
      sfFeeComplete: true,
    });
    assert.equal(m.afterSaleLifecycle, LIFECYCLE.ACTIVE);
    assert.equal(m.warningType, 'refund_unverified');
  });

  it('negotiate_returns_amount parses yuan via apply path', () => {
    assert.equal(resolveAfterSaleLifecycle('退货待寄回'), LIFECYCLE.ACTIVE);
  });

  it('partial sf fee → sf_fee_incomplete', () => {
    const m = computeAfterSaleMetrics({
      package: { paidAmount: 1998, refundApplyAmount: 1998, hasAfterSale: true, afterSaleStatus: '待寄回' },
      paidAmount: 1998,
      refundApplyAmount: 1998,
      sfFee: 18,
      sfFeeComplete: false,
      profit: null,
    });
    assert.equal(m.warningType, 'sf_fee_incomplete');
  });

  it('no after-sale → no warning', () => {
    const m = computeAfterSaleMetrics({
      package: { paidAmount: 500 },
      paidAmount: 500,
      sfFee: 13,
      sfFeeComplete: true,
    });
    assert.equal(m.afterSaleLifecycle, LIFECYCLE.NONE);
    assert.equal(m.warningType, null);
  });
});
