const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Mirrors session generation / abort semantics from inject/qf-sf-fee-inline.js.
 */
function createSessionController() {
  let sessionGeneration = 0;
  let batchAbort = null;
  const pending = new Map();

  function isStale(gen) {
    return gen !== sessionGeneration;
  }

  function syncSession() {
    if (batchAbort) {
      batchAbort.abort();
    }
    batchAbort = new AbortController();
    sessionGeneration += 1;
    return sessionGeneration;
  }

  async function runBatch(gen, work) {
    const key = `batch-${gen}`;
    const p = work(batchAbort.signal).finally(() => {
      if (pending.get(key) === p) pending.delete(key);
    });
    pending.set(key, p);
    return p;
  }

  return { syncSession, isStale, runBatch, getGeneration: () => sessionGeneration, pending };
}

describe('session switch (100x)', () => {
  it('aborts stale batches and keeps only last session', async () => {
    const ctrl = createSessionController();
    const rejections = [];
    process.on('unhandledRejection', (e) => rejections.push(e));

    let lastCompleted = 0;
    const runs = [];

    for (let i = 0; i < 100; i += 1) {
      const gen = ctrl.syncSession();
      const p = ctrl.runBatch(gen, async (signal) => {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 5);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
        if (!ctrl.isStale(gen)) lastCompleted = gen;
        runs.push(gen);
      });
      p.catch((err) => {
        if (err.name !== 'AbortError') throw err;
      });
    }

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(lastCompleted, 100);
    assert.equal(ctrl.getGeneration(), 100);
    assert.equal(ctrl.pending.size, 0);
    assert.equal(rejections.length, 0);
    process.removeAllListeners('unhandledRejection');
  });
});
