const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  parseMoneyYuan,
  extractReturnsId,
  extractReturnsIdFromReturnInfoItem,
  normalizePackageDetail,
  normalizeAfterSale,
  mergeSfWaybillResults,
  mergeCardDto,
  pickSfWaybills,
} = require('../../src/core/normalizers');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'package-detail');

function loadFixture(name) {
  const file = path.join(FIXTURE_DIR, name);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.data;
}

describe('normalizers v3.0.4', () => {
  it('parseMoneyYuan keeps 16800 and 26800 yuan', () => {
    assert.equal(parseMoneyYuan(16800), 16800);
    assert.equal(parseMoneyYuan(26800), 26800);
    assert.equal(parseMoneyYuan('￥1,680'), 1680);
  });

  it('extractReturnsId ignores generic id', () => {
    assert.equal(extractReturnsId({ id: 'R_SHOULD_NOT', package_id: 'P1' }), '');
    assert.equal(extractReturnsId({ returns_id: 'R1' }), 'R1');
  });

  it('package raw.id without after-sale fields yields empty returnsId', () => {
    const file = fs.readdirSync(FIXTURE_DIR).find((f) => f.includes('raw_id_present'));
    const pkg = normalizePackageDetail(loadFixture(file));
    assert.equal(pkg.returnsId, '');
  });

  it('package_id is not used as returnsId', () => {
    const pkg = normalizePackageDetail({ package_id: 'P123', id: 'P123' });
    assert.equal(pkg.returnsId, '');
  });

  it('real hetianyayu fixture parses customer_pay_amount yuan + delivery_packages', () => {
    const file = fs.readdirSync(FIXTURE_DIR).find((f) => f.startsWith('hetianyayu__sf_'));
    assert.ok(file);
    const pkg = normalizePackageDetail(loadFixture(file));
    assert.equal(pkg.paidAmount, 917);
    assert.ok(pkg.expressNos.length >= 1);
    assert.equal(pkg.packages.length, 1);
    assert.equal(pkg.packages[0].isSf, true);
  });

  it('high value fixtures stay in yuan', () => {
    const f168 = fs.readdirSync(FIXTURE_DIR).find((f) => f.includes('yuan_16800'));
    const f268 = fs.readdirSync(FIXTURE_DIR).find((f) => f.includes('yuan_26800'));
    assert.equal(normalizePackageDetail(loadFixture(f168)).paidAmount, 16800);
    assert.equal(normalizePackageDetail(loadFixture(f268)).paidAmount, 26800);
  });

  it('return_info array picks active refunding record', () => {
    const file = fs.readdirSync(FIXTURE_DIR).find((f) => f.includes('return_info_array_refunding'));
    const pkg = normalizePackageDetail(loadFixture(file));
    assert.equal(pkg.refundApplyAmount, 200);
    assert.match(pkg.afterSaleStatus, /退款中/);
    assert.equal(pkg.returnsId, '');
  });

  it('multi sf waybills extracted', () => {
    const file = fs.readdirSync(FIXTURE_DIR).find((f) => f.includes('multi_sf_multi_package'));
    const pkg = normalizePackageDetail(loadFixture(file));
    assert.equal(pkg.expressNos.length, 2);
    assert.equal(pkg.packages.length, 2);
  });

  it('returns_v3 applied_amount yuan + ship fen', () => {
    const retFiles = fs.readdirSync(path.join(__dirname, '..', 'fixtures', 'returns-v3'));
    const file = retFiles.find((f) => f.includes('hetianyayu'));
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'returns-v3', file), 'utf8'));
    const as = normalizeAfterSale(raw.data, { returnsId: 'R_FIXTURE_2' });
    assert.equal(as.returnsId, 'R_FIXTURE_2');
    assert.equal(as.refundApplyAmount, 899);
  });

  it('mergeSfWaybillResults sums fees and marks partial', () => {
    const merged = mergeSfWaybillResults([
      { waybill: 'SF001', sfFee: 18, errorCode: null },
      { waybill: 'SF002', sfFee: null, error: 'fail', errorCode: 'upstream_error' },
    ]);
    assert.equal(merged.sfFee, 18);
    assert.equal(merged.state, 'partial');
    assert.equal(merged.sfFeeComplete, false);
    assert.equal(merged.sfSuccessCount, 1);
    assert.equal(merged.sfFailedCount, 1);
  });

  it('mergeCardDto withholds profit until sf complete', () => {
    const dto = mergeCardDto({
      hints: { packageId: 'P1' },
      package: { paidAmount: 1000, refundApplyAmount: 900 },
      sf: mergeSfWaybillResults([
        { waybill: 'SF1', sfFee: 10, errorCode: null },
        { waybill: 'SF2', sfFee: null, errorCode: 'upstream_error', error: 'x' },
      ]),
    });
    assert.equal(dto.sfFee, 10);
    assert.equal(dto.state, 'partial');
    assert.equal(dto.profit, null);
    assert.equal(dto.profitPending, true);
  });

  it('mergeCardDto computes profit when sf complete', () => {
    const dto = mergeCardDto({
      hints: { packageId: 'P1' },
      package: { paidAmount: 1000, refundApplyAmount: 900 },
      sf: mergeSfWaybillResults([
        { waybill: 'SF1', sfFee: 13, errorCode: null },
      ]),
    });
    assert.equal(dto.profit, 87);
    assert.equal(dto.sfFeeComplete, true);
  });

  it('mergeCardDto prefers package paidAmount when returns_v3 pay_amount is 0', () => {
    const retFiles = fs.readdirSync(path.join(__dirname, '..', 'fixtures', 'returns-v3'));
    const file = retFiles.find((f) => f.includes('hetianyayu'));
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'returns-v3', file), 'utf8'));
    const after = normalizeAfterSale(raw.data, { returnsId: 'R_FIXTURE_2' });
    assert.equal(after.paidAmount, null);
    const dto = mergeCardDto({
      hints: { packageId: 'P799', hasAfterSale: true },
      package: { paidAmount: 1998, hasAfterSale: true, afterSaleStatus: '待寄回' },
      afterSale: { ...after, refundApplyAmount: 1980 },
      sf: mergeSfWaybillResults([{ waybill: 'SF1', sfFee: 13, errorCode: null }]),
    });
    assert.equal(dto.paidAmount, 1998);
    assert.equal(dto.refundApplyAmount, 1980);
    assert.equal(dto.profit, 5);
    assert.equal(dto.isFullRefund, false);
    assert.equal(dto.warningType, null);
  });
});
