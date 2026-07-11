const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runWithAbortTimeout } = require('../../src/core/abort-timeout');

describe('abort-timeout cleanup', () => {
  it('completes normally without hanging listeners', async () => {
    const parent = new AbortController();
    const result = await runWithAbortTimeout(async () => 'ok', 1000, 'test', parent.signal);
    assert.equal(result, 'ok');
  });

  it('times out and rejects with timeout code', async () => {
    const parent = new AbortController();
    await assert.rejects(
      () => runWithAbortTimeout(
        (signal) => new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
        20,
        'test',
        parent.signal,
      ),
      (err) => err.code === 'timeout',
    );
  });

  it('survives 1000 iterations without MaxListenersExceededWarning', async () => {
    const parent = new AbortController();
    const warnings = [];
    const onWarning = (w) => warnings.push(w);
    process.on('warning', onWarning);
    try {
      for (let i = 0; i < 1000; i++) {
        await runWithAbortTimeout(async () => i, 5, 'loop', parent.signal);
      }
      assert.equal(warnings.filter((w) => /MaxListenersExceededWarning/.test(w.name || w.message)).length, 0);
    } finally {
      process.off('warning', onWarning);
    }
  });
});
