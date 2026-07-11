const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBatchController } = require('../../src/client/batch-controller');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('batch-controller abort race', () => {
  it('A finally does not clear B controller', async () => {
    const ctrl = createBatchController({ timeoutMs: 500 });
    let aDone = false;
    const pA = ctrl.runBatch(async (signal) => {
      await sleep(80);
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return 'A';
    }, 1, () => false);
    await sleep(10);
    const pB = ctrl.runBatch(async (signal) => {
      await sleep(30);
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return 'B';
    }, 2, () => false);
    const b = await pB;
    assert.equal(b, 'B');
    assert.ok(ctrl.getActiveController() === null);
    await pA;
    aDone = true;
    assert.equal(aDone, true);
  });

  it('A timeout does not cancel B', async () => {
    const ctrl = createBatchController({ timeoutMs: 50 });
    const pA = ctrl.runBatch(async (signal) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve('A'), 500);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
      return 'A';
    }, 1, () => false);
    await sleep(10);
    const pB = ctrl.runBatch(async (signal) => {
      await sleep(30);
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return 'B';
    }, 2, () => false);
    const b = await pB;
    assert.equal(b, 'B');
    await sleep(60);
    assert.ok(ctrl.getActiveController() === null);
    const a = await pA;
    assert.ok(!a || a?.errorCode === 'timeout');
  });

  it('switch to C cancels B', async () => {
    const ctrl = createBatchController({ timeoutMs: 500 });
    let bAborted = false;
    const pB = ctrl.runBatch(async (signal) => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 200);
        signal.addEventListener('abort', () => {
          bAborted = true;
          clearTimeout(t);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
      return 'B';
    }, 2, (g) => g !== 2);
    await sleep(10);
    const pC = ctrl.runBatch(async () => 'C', 3, () => false);
    const c = await pC;
    assert.equal(c, 'C');
    await pB.catch(() => {});
    assert.equal(bAborted, true);
  });
});
