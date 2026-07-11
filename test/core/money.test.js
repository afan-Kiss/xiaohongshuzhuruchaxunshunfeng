const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseYuanAmount,
  parseFenAmount,
  pickRefundApplyFromReturnsV3,
  computeProfit,
  mergeCardDto,
} = require('../../src/core/normalizers');

describe('money parsing v3.0.1', () => {
  it('parseYuanAmount never divides by magnitude', () => {
    assert.equal(parseYuanAmount(16800), 16800);
    assert.equal(parseYuanAmount(26800), 26800);
    assert.equal(parseYuanAmount(39800), 39800);
    assert.equal(parseYuanAmount(168000), 168000);
    assert.equal(parseYuanAmount('￥16,800.00'), 16800);
    assert.equal(parseYuanAmount('1680.50'), 1680.5);
    assert.equal(parseYuanAmount(null), null);
    assert.equal(parseYuanAmount('—'), null);
  });

  it('parseFenAmount converts fen to yuan', () => {
    assert.equal(parseFenAmount(168000), 1680);
    assert.equal(parseFenAmount(100000), 1000);
    assert.equal(parseFenAmount(800), 8);
  });

  it('returns_v3 sku+ship fen sums to yuan', () => {
    const amt = pickRefundApplyFromReturnsV3({
      applied_skus_amount_sum: 100000,
      applied_ship_fee_amount: 800,
    });
    assert.equal(amt, 1008);
  });

  it('high ticket jewelry profit', () => {
    const dto = mergeCardDto({
      hints: { packageId: 'P1' },
      package: { paidAmount: 26800, refundApplyAmount: 26000 },
      sf: { sfFee: 18 },
    });
    assert.equal(dto.paidAmount, 26800);
    assert.equal(dto.refundApplyAmount, 26000);
    assert.equal(dto.profit, 782);
  });
});
