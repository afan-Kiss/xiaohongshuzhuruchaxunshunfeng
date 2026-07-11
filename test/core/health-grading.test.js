const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeState, VERSION } = require('../../src/core/runtime-state');

describe('health grading v3.0.3', () => {
  it('healthy when all green', () => {
    const st = createRuntimeState();
    st.setFlags({
      coreReady: true,
      packageApiReady: true,
      afterSaleReady: true,
      sfConfigured: true,
      webReady: true,
    });
    st.setSfQueryResult({ ok: true, attempted: true });
    st.setDevtools({ connected: true, pageCount: 2, injectedCount: 2, expectedVersion: VERSION, versions: [VERSION, VERSION] });
    const h = st.buildHealth();
    assert.equal(h.status, 'healthy');
    assert.equal(h.ok, true);
    assert.equal(h.degradedReasons.length, 0);
    assert.equal(h.checks.sfReady, true);
  });

  it('degraded when sf unconfigured but core ok', () => {
    const st = createRuntimeState();
    st.setFlags({ coreReady: true, packageApiReady: true, afterSaleReady: true, sfConfigured: false, webReady: true });
    st.setDevtools({ connected: false, pageCount: 0, injectedCount: 0, expectedVersion: VERSION, versions: [] });
    const h = st.buildHealth();
    assert.equal(h.status, 'degraded');
    assert.equal(h.ok, true);
    assert.ok(h.degradedReasons.includes('sf_config_missing'));
  });

  it('degraded when sf configured but never queried', () => {
    const st = createRuntimeState();
    st.setFlags({ coreReady: true, packageApiReady: true, afterSaleReady: true, sfConfigured: true, webReady: true });
    st.setDevtools({ connected: true, pageCount: 1, injectedCount: 1, expectedVersion: VERSION, versions: [VERSION] });
    const h = st.buildHealth();
    assert.ok(h.degradedReasons.includes('sf_unverified'), h.degradedReasons.join(','));
    assert.notEqual(h.checks.sfReady, true);
    assert.equal(h.checks.sfVerified, false);
  });

  it('unhealthy when package api down', () => {
    const st = createRuntimeState();
    st.setFlags({ coreReady: false, packageApiReady: false, afterSaleReady: true, sfConfigured: true });
    const h = st.buildHealth();
    assert.equal(h.status, 'unhealthy');
    assert.equal(h.ok, false);
  });
});
