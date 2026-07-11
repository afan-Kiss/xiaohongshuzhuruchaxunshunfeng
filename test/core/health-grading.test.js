const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeState, VERSION } = require('../../src/core/runtime-state');

describe('health grading v3.0.1', () => {
  it('healthy when all green', () => {
    const st = createRuntimeState();
    st.setFlags({
      coreReady: true,
      packageApiReady: true,
      afterSaleReady: true,
      sfReady: true,
      webReady: true,
    });
    st.setDevtools({ connected: true, pageCount: 2, injectedCount: 2, expectedVersion: VERSION, versions: [VERSION, VERSION] });
    const h = st.buildHealth();
    assert.equal(h.status, 'healthy');
    assert.equal(h.ok, true);
    assert.equal(h.degradedReasons.length, 0);
  });

  it('degraded when sf missing but core ok', () => {
    const st = createRuntimeState();
    st.setFlags({ coreReady: true, packageApiReady: true, afterSaleReady: true, sfReady: false, webReady: true });
    st.setDevtools({ connected: false, pageCount: 0, injectedCount: 0, expectedVersion: VERSION, versions: [] });
    const h = st.buildHealth();
    assert.equal(h.status, 'degraded');
    assert.equal(h.ok, true);
    assert.ok(h.degradedReasons.includes('sf_config_missing'));
    assert.ok(h.degradedReasons.includes('devtools_offline'));
  });

  it('unhealthy when package api down', () => {
    const st = createRuntimeState();
    st.setFlags({ coreReady: false, packageApiReady: false, afterSaleReady: true, sfReady: true });
    const h = st.buildHealth();
    assert.equal(h.status, 'unhealthy');
    assert.equal(h.ok, false);
  });
});
