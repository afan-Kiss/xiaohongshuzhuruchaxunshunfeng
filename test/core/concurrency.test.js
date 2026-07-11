const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createConcurrencyLimiter } = require('../../src/core/concurrency-limiter');

describe('concurrency-limiter', () => {
  it('limits global concurrency', async () => {
    const limiter = createConcurrencyLimiter(4, 2);
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 20 }, (_, i) =>
      limiter.schedule('shop-a', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 30));
        active -= 1;
        return i;
      }),
    );
    await Promise.all(tasks);
    assert.ok(maxActive <= 4);
  });

  it('limits per-key concurrency', async () => {
    const limiter = createConcurrencyLimiter(4, 2);
    let shopAActive = 0;
    let shopAMax = 0;
    const tasks = [
      ...Array.from({ length: 10 }, () =>
        limiter.schedule('shop-a', async () => {
          shopAActive += 1;
          shopAMax = Math.max(shopAMax, shopAActive);
          await new Promise((r) => setTimeout(r, 20));
          shopAActive -= 1;
        }),
      ),
      ...Array.from({ length: 10 }, () =>
        limiter.schedule('shop-b', async () => {
          await new Promise((r) => setTimeout(r, 10));
        }),
      ),
    ];
    await Promise.all(tasks);
    assert.ok(shopAMax <= 2);
  });
});
