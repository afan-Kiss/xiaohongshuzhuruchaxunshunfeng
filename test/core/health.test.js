const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createPersistence } = require('../../src/core/persistence');
const { createRuntimeState, VERSION, SERVICE } = require('../../src/core/runtime-state');

describe('persistence', () => {
  it('recovers from corrupt file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-cache-'));
    const file = path.join(dir, 'cache.json');
    fs.writeFileSync(file, '{not json', 'utf8');
    const p = createPersistence(file);
    const data = p.load();
    assert.deepEqual(data, {});
    assert.ok(fs.existsSync(file) === false || !fs.readFileSync(file, 'utf8').startsWith('{not'));
  });
});

describe('runtime-state health', () => {
  it('builds health with required fields', () => {
    const st = createRuntimeState();
    st.setFlags({ coreReady: true, packageApiReady: true, afterSaleReady: true, sfConfigured: true });
    st.setDevtools({ connected: true, pageCount: 2, injectedCount: 2, expectedVersion: VERSION, versions: [VERSION, VERSION] });
    const h = st.buildHealth({ cacheHitCount: 3 });
    assert.equal(h.service, SERVICE);
    assert.equal(h.version, VERSION);
    assert.equal(h.features.batchCards, true);
    assert.equal(h.checks.coreReady, true);
    assert.equal(h.devtools.injectedCount, 2);
  });

  it('degrades health when injection version mismatch', () => {
    const st = createRuntimeState();
    st.setFlags({ coreReady: true, packageApiReady: true, afterSaleReady: true, sfConfigured: true });
    st.setDevtools({ connected: true, pageCount: 2, injectedCount: 2, expectedVersion: VERSION, versions: ['2.0.0', VERSION] });
    const h = st.buildHealth();
    assert.equal(h.ok, true);
    assert.equal(h.status, 'degraded');
    assert.ok(h.degradedReasons.includes('injection_incomplete'));
  });
});
