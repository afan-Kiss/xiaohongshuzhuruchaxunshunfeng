const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeState, VERSION } = require('../../src/core/runtime-state');
const { buildDevtoolsStatus } = require('../../src/injection-daemon');

describe('injection health consistency', () => {
  it('health uses verified page probes not stale internal ok flags', () => {
    const pages = [
      { webSocketDebuggerUrl: 'ws://a', title: 'A', url: 'http://a' },
      { webSocketDebuggerUrl: 'ws://b', title: 'B', url: 'http://b' },
    ];
    const injected = new Map([
      ['ws://a', {
        verified: true,
        actualVersion: VERSION,
        version: VERSION,
        mode: 'inline',
        hasInline: true,
        title: 'A',
        url: 'http://a',
      }],
      ['ws://b', {
        verified: false,
        actualVersion: '',
        mode: 'none',
        hasInline: false,
        title: 'B',
        url: 'http://b',
      }],
    ]);
    const status = buildDevtoolsStatus(pages, injected, VERSION);
    assert.equal(status.injectedCount, 1);
    assert.equal(status.versions.length, 1);

    const st = createRuntimeState();
    st.setFlags({ coreReady: true, packageApiReady: true, afterSaleReady: true, sfConfigured: true, webReady: true });
    st.setDevtools(status);
    const h = st.buildHealth();
    assert.equal(h.devtools.injectedCount, 1);
    assert.equal(h.checks.pageInjectionReady, false);
    assert.ok(h.degradedReasons.includes('injection_incomplete'));
  });
});
