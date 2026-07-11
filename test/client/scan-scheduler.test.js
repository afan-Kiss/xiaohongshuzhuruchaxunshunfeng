const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isOwnMutation, createScanScheduler } = require('../../src/client/scan-scheduler');

function mockEl(cls) {
  return {
    nodeType: 1,
    id: '',
    classList: { contains: (c) => c === cls },
    closest: () => null,
    matches: () => false,
  };
}

describe('scan-scheduler', () => {
  it('ignores own wrap mutations', () => {
    const wrap = {
      nodeType: 1,
      id: '',
      classList: { contains: (c) => c === 'qsf-inline-fee-wrap' },
      closest: (sel) => (String(sel).includes('qsf-inline-fee-wrap') ? wrap : null),
      matches: () => false,
    };
    const m = {
      type: 'childList',
      target: wrap,
      addedNodes: [wrap],
      removedNodes: [],
    };
    assert.equal(isOwnMutation(m), true);
  });

  it('coalesces concurrent scans to at most one pending rerun', async () => {
    let running = 0;
    let maxRunning = 0;
    let scanCount = 0;
    const sched = createScanScheduler({
      debounceMs: 0,
      onScan: async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        scanCount += 1;
        await new Promise((r) => setTimeout(r, 30));
        running -= 1;
      },
    });
    sched.scheduleScan(true);
    sched.scheduleScan(true);
    sched.scheduleScan(true);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(maxRunning, 1);
    assert.ok(scanCount <= 2);
  });

  it('real order mutation triggers scan', async () => {
    let scans = 0;
    const sched = createScanScheduler({
      debounceMs: 0,
      onScan: async () => { scans += 1; },
    });
    const orderCard = mockEl('order-card');
    sched.handleMutations([{
      type: 'childList',
      target: orderCard,
      addedNodes: [mockEl('child')],
      removedNodes: [],
    }]);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(scans, 1);
  });

  it('own wrap mutations do not trigger scan loop', async () => {
    let scans = 0;
    const sched = createScanScheduler({
      debounceMs: 0,
      onScan: async () => { scans += 1; },
    });
    const wrap = {
      nodeType: 1,
      id: '',
      classList: { contains: (c) => c === 'qsf-inline-fee-wrap' },
      closest: (sel) => (String(sel).includes('qsf-inline-fee-wrap') ? wrap : null),
      matches: () => false,
    };
    for (let i = 0; i < 20; i++) {
      sched.handleMutations([{
        type: 'childList',
        target: wrap,
        addedNodes: [wrap],
        removedNodes: [],
      }]);
    }
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(scans, 0);
  });

  it('5s idle does not self-trigger beyond initial scan', async () => {
    let scans = 0;
    const sched = createScanScheduler({
      debounceMs: 0,
      onScan: async () => { scans += 1; },
    });
    sched.scheduleScan(true);
    await new Promise((r) => setTimeout(r, 100));
    const afterFirst = scans;
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(scans, afterFirst);
  });
});
