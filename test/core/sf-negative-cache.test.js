const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createDataCore } = require('../../src/core/data-core');

describe('sf negative cache v3.0.6', () => {
  it('8148/not_found goes to short err cache then can succeed later', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qsf-sf-'));
    let calls = 0;
    const core = createDataCore({
      root,
      sf: { partnerID: 'p', monthlyCard: 'm', checkWord: 'c' },
      testHooks: {
        fetchSfFee: async () => {
          calls += 1;
          if (calls === 1) {
            return { waybill: 'SF1111111111111', ok: false, error: '暂未出账', errorCode: '8148' };
          }
          return { waybill: 'SF1111111111111', ok: true, totalFee: 13, sfFee: 13 };
        },
      },
    });

    const first = await core.fetchSfFee('SF1111111111111', true);
    assert.equal(first.data.errorCode, 'not_found');
    assert.ok(first.data.sfFee == null);

    // force bypasses cache; without force should still hit short err cache while fresh
    const cached = await core.fetchSfFee('SF1111111111111', false);
    assert.equal(cached.source, 'cache');

    await new Promise((r) => setTimeout(r, 2200));
    const second = await core.fetchSfFee('SF1111111111111', false);
    assert.equal(second.data.sfFee, 13);
    assert.equal(second.data.errorCode, null);
    assert.ok(calls >= 2);
  });
});
