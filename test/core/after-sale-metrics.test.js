const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeCardDto, pickRefundApplyFromReturnsV3 } = require('../../src/core/normalizers');
const {
  computeIsFullRefund,
  computeAfterSaleMetrics,
} = require('../../src/core/after-sale-metrics');

describe('after-sale metrics v3.0.5', () => {
  it('full refund 1998 + sf 13 → full_refund_shipping_loss', () => {
    const dto = mergeCardDto({
      hints: { packageId: 'P1', hasAfterSale: true, afterSaleStatus: '退货待寄回' },
      package: { paidAmount: 1998, refundApplyAmount: 1998, hasAfterSale: true, afterSaleStatus: '待寄回' },
      sf: { sfFee: 13, sfFeeComplete: true, sfWaybillCount: 1, sfSuccessCount: 1 },
    });
    assert.equal(dto.isFullRefund, true);
    assert.equal(dto.profit, -13);
    assert.equal(dto.warningType, 'full_refund_shipping_loss');
  });

  it('negative profit uses expected_loss not earned wording', () => {
    const m = computeAfterSaleMetrics({
      hints: { hasAfterSale: true },
      paidAmount: 1998,
      refundApplyAmount: 1998,
      sfFee: 13,
      sfFeeComplete: true,
      profit: -13,
    });
    assert.equal(m.warningType, 'full_refund_shipping_loss');
  });

  it('after-sale without refund amount → refund_unverified', () => {
    const dto = mergeCardDto({
      hints: { packageId: 'P1', hasAfterSale: true, afterSaleStatus: '退货待寄回' },
      package: { paidAmount: 1998, hasAfterSale: true, afterSaleStatus: '待寄回' },
      sf: { sfFee: 13, sfFeeComplete: true, sfWaybillCount: 1, sfSuccessCount: 1 },
    });
    assert.equal(dto.hasAfterSale, true);
    assert.equal(dto.refundApplyAmount, null);
    assert.equal(dto.warningType, 'refund_unverified');
  });

  it('partial sf fee → sf_fee_incomplete', () => {
    const dto = mergeCardDto({
      hints: { hasAfterSale: true },
      package: { paidAmount: 1998, refundApplyAmount: 1998, hasAfterSale: true },
      sf: {
        sfFee: 18,
        sfFeeComplete: false,
        sfWaybillCount: 2,
        sfSuccessCount: 1,
        sfFailedCount: 1,
        state: 'partial',
      },
    });
    assert.equal(dto.profit, null);
    assert.equal(dto.warningType, 'sf_fee_incomplete');
  });

  it('negotiate_returns_amount parses yuan', () => {
    const amt = pickRefundApplyFromReturnsV3({
      negotiate_order: [{ negotiate_returns_amount: 1880 }],
    });
    assert.equal(amt, 1880);
  });

  it('origin_negotiate_returns_amount parses yuan', () => {
    const amt = pickRefundApplyFromReturnsV3({
      negotiate_order: [{ origin_negotiate_returns_amount: 2680 }],
    });
    assert.equal(amt, 2680);
  });

  it('no after-sale → no warning', () => {
    const dto = mergeCardDto({
      package: { paidAmount: 500 },
      sf: { sfFee: 13, sfFeeComplete: true, sfWaybillCount: 1, sfSuccessCount: 1 },
    });
    assert.equal(dto.hasAfterSale, false);
    assert.equal(dto.warningType, null);
  });

  it('closed after-sale does not auto full refund', () => {
    assert.equal(computeIsFullRefund(1998, 0), false);
  });
});
