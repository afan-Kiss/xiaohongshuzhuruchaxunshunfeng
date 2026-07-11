const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createDataCore } = require('../../src/core/data-core');
const { createSingleflight } = require('../../src/core/singleflight');
const { createMetrics } = require('../../src/core/metrics');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qf-core-test-'));
}

describe('data-core integration', () => {
  it('20 cards respect concurrency limits', async () => {
    let qfActive = 0;
    let qfMax = 0;
    let shopAMax = 0;
    const shopActive = new Map();
    const core = createDataCore({
      root: tempRoot(),      sf: { partnerID: 'p', checkWord: 'w', monthlyCard: 'm' },
      testHooks: {
        getCookie: async () => ({ ok: true, cookie: 'c' }),
        fetchPackage: async (shopKey) => {
          qfActive += 1;
          shopActive.set(shopKey, (shopActive.get(shopKey) || 0) + 1);
          qfMax = Math.max(qfMax, qfActive);
          shopAMax = Math.max(shopAMax, shopActive.get(shopKey) || 0);
          await sleep(30);
          shopActive.set(shopKey, (shopActive.get(shopKey) || 1) - 1);
          qfActive -= 1;
          return { packageId: 'P1', returnsId: '', expressNos: [], paidAmount: 100 };
        },
        fetchSfFee: async () => ({ waybill: 'SF123', ok: true, totalFee: 12 }),
      },
    });

    const cards = Array.from({ length: 20 }, (_, i) => ({
      packageId: `P${i}`,
      returnsId: '',
      expressNos: ['SF1234567890123'],
    }));
    const result = await core.batchCards({ shopKey: 'xyxiangyu', shopTitle: 'XY祥钰珠宝', cards });
    assert.equal(result.ok, true);
    assert.equal(Object.keys(result.items).length, 20);
    assert.ok(qfMax <= 4);
    assert.ok(shopAMax <= 2);
    core.close();
  });

  it('four pages same key dedupe loaders', async () => {
    let pkgCount = 0;
    let asCount = 0;
    let sfCount = 0;
    const core = createDataCore({
      root: tempRoot(),
      sf: { partnerID: 'p', checkWord: 'w', monthlyCard: 'm' },
      testHooks: {
        getCookie: async () => ({ ok: true, cookie: 'c' }),
        fetchPackage: async () => {
          pkgCount += 1;
          await sleep(20);
          return { packageId: 'P1', returnsId: 'R1', expressNos: ['SF1234567890123'], paidAmount: 100 };
        },
        fetchAfterSale: async () => {
          asCount += 1;
          await sleep(20);
          return { returnsId: 'R1', refundApplyAmount: 50 };
        },
        fetchSfFee: async () => {
          sfCount += 1;
          await sleep(20);
          return { waybill: 'SF1234567890123', ok: true, totalFee: 13 };
        },
      },
    });

    const card = { packageId: 'P1', returnsId: 'R1', expressNos: ['SF1234567890123'] };
    await Promise.all([
      core.batchCards({ shopKey: 'xyxiangyu', shopTitle: 'XY祥钰珠宝', cards: [card] }),
      core.batchCards({ shopKey: 'xyxiangyu', shopTitle: 'XY祥钰珠宝', cards: [card] }),
      core.batchCards({ shopKey: 'xyxiangyu', shopTitle: 'XY祥钰珠宝', cards: [card] }),
      core.batchCards({ shopKey: 'xyxiangyu', shopTitle: 'XY祥钰珠宝', cards: [card] }),
    ]);
    assert.equal(pkgCount, 1);
    assert.equal(asCount, 1);
    assert.equal(sfCount, 1);
    core.close();
  });

  it('timeout releases inflight', async () => {
    const sf = createSingleflight(createMetrics());
    const p = sf.run('t', async () => {
      await sleep(50);
      return 1;
    });
    assert.equal(sf.size(), 1);
    await p;
    assert.equal(sf.size(), 0);
  });

  it('one card failure does not fail batch', async () => {    const core = createDataCore({
      root: tempRoot(),
      sf: { partnerID: 'p', checkWord: 'w', monthlyCard: 'm' },
      testHooks: {
        getCookie: async () => ({ ok: true, cookie: 'c' }),
        fetchPackage: async (_sk, pid) => {
          if (pid === 'P_BAD') throw Object.assign(new Error('boom'), { code: 'upstream_error' });
          return { packageId: pid, paidAmount: 10 };
        },
      },
    });
    const result = await core.batchCards({
      shopKey: 'xyxiangyu',
      shopTitle: 'XY祥钰珠宝',
      cards: [{ packageId: 'P_OK' }, { packageId: 'P_BAD' }],
    });
    assert.equal(result.ok, true);
    assert.ok(result.items.P_OK);
    assert.equal(result.items.P_BAD.errorCode, 'upstream_error');    core.close();
  });
});
