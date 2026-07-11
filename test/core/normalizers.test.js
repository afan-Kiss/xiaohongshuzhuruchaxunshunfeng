const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMoneyYuan,
  extractReturnsId,
  normalizePackageDetail,
  normalizeAfterSale,
  mergeCardDto,
} = require('../../src/core/normalizers');

describe('normalizers', () => {
  it('parseMoneyYuan handles yuan, fen, symbols', () => {
    assert.equal(parseMoneyYuan(12.5), 12.5);
    assert.equal(parseMoneyYuan('￥1,680'), 1680);
    assert.equal(parseMoneyYuan(168000), 1680);
    assert.equal(parseMoneyYuan(''), null);
    assert.equal(parseMoneyYuan(null), null);
  });

  it('keeps returnsId from package detail return_info', () => {
    const pkg = normalizePackageDetail({
      package_id: 'P123',
      return_info: { returns_id: 'R999', return_amt: 1999 },
      paid_amount: 2000,
    });
    assert.equal(pkg.returnsId, 'R999');
    assert.equal(pkg.refundApplyAmount, 1999);
  });

  it('normalizeAfterSale preserves returnsId', () => {
    const as = normalizeAfterSale({
      after_sale: {
        returns_id: 'R555',
        applied_amount: 1099,
        status_name: '退款中',
      },
    }, { packageId: 'P1' });
    assert.equal(as.returnsId, 'R555');
    assert.equal(as.refundApplyAmount, 1099);
  });

  it('returns_v3 applied_skus + ship fee', () => {
    const as = normalizeAfterSale({
      returns_id: 'R1',
      applied_skus_amount_sum: 100000,
      applied_ship_fee_amount: 800,
    });
    assert.equal(as.refundApplyAmount, 1008);
    assert.equal(as.returnsId, 'R1');
  });

  it('mergeCardDto prefers after-sale refund over package', () => {
    const dto = mergeCardDto({
      hints: { packageId: 'P1', returnsId: 'R1' },
      package: { refundApplyAmount: 100, returnsId: 'R1', paidAmount: 1900 },
      afterSale: { refundApplyAmount: 1880, returnsId: 'R1', paidAmount: 1900 },
      sf: { sfFee: 13 },
    });
    assert.equal(dto.refundApplyAmount, 1880);
    assert.equal(dto.sfFee, 13);
    assert.equal(dto.profit, 7);
  });

  it('extractReturnsId checks multiple keys', () => {
    assert.equal(extractReturnsId({ returnsId: 'R1' }), 'R1');
    assert.equal(extractReturnsId({ after_sale_id: 'R2' }), 'R2');
  });
});
