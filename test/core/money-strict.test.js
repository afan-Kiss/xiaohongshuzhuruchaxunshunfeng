const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseFieldAmount, normalizePackageDetail } = require('../../src/core/normalizers');
const { runWithAbortTimeout } = require('../../src/core/abort-timeout');

describe('money parsing v3.0.6', () => {
  it('unknown field returns null instead of guessing yuan', () => {
    assert.equal(parseFieldAmount('mystery_amount', 199800), null);
    assert.equal(parseFieldAmount('sku_mystery', 100), null);
  });

  it('sku_pay_amount is registered as yuan', () => {
    assert.equal(parseFieldAmount('sku_pay_amount', 999), 999);
    assert.equal(parseFieldAmount('skuPayAmount', 1000), 1000);
  });

  it('multi-sku sums sku_pay_amount when order total missing', () => {
    const pkg = normalizePackageDetail({
      sku_snapshots: [
        { sku_pay_amount: 500 },
        { sku_pay_amount: 300 },
      ],
    });
    assert.equal(pkg.paidAmount, 800);
  });
});

describe('abort timeout v3.0.6', () => {
  it('rejects after resolve if signal already aborted', async () => {
    const parent = new AbortController();
    await assert.rejects(
      () => runWithAbortTimeout(async () => {
        parent.abort();
        return 'ok';
      }, 1000, 'test', parent.signal),
      (err) => err.code === 'aborted' || err.code === 'timeout',
    );
  });
});
