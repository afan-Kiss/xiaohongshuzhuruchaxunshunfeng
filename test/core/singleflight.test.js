const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSingleflight } = require('../../src/core/singleflight');
const { createMetrics } = require('../../src/core/metrics');

describe('singleflight', () => {
  it('100 concurrent same-key calls run loader once', async () => {
    const metrics = createMetrics();
    const sf = createSingleflight(metrics);
    let runs = 0;
    const loader = () =>
      new Promise((resolve) => {
        runs += 1;
        setTimeout(() => resolve(runs), 30);
      });
    const results = await Promise.all(
      Array.from({ length: 100 }, () => sf.run('k1', loader)),
    );
    assert.equal(runs, 1);
    assert.ok(results.every((r) => r === 1));
    assert.equal(sf.size(), 0);
    assert.equal(metrics.snapshot().singleflightJoinedCount, 99);
  });

  it('old finally does not delete new inflight', async () => {
    const metrics = createMetrics();
    const sf = createSingleflight(metrics);
    let release1;
    const p1 = sf.run('race', () => new Promise((resolve) => {
      release1 = resolve;
    }));
    await new Promise((r) => setTimeout(r, 5));
    release1(1);
    await p1;
    const r2 = await sf.run('race', async () => 2);
    assert.equal(r2, 2);
    assert.equal(sf.size(), 0);
  });
});
