const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBoundedCache } = require('../../src/core/bounded-cache');

describe('bounded-cache LRU restore order', () => {
  it('keeps newest maxSize and evicts oldest on insert', () => {
    const t = Date.now();
    const data = {
      old: { value: 1, updatedAt: t - 3000, freshUntil: t + 5000, staleUntil: t + 20000, source: 'x' },
      mid: { value: 2, updatedAt: t - 2000, freshUntil: t + 5000, staleUntil: t + 20000, source: 'x' },
      new: { value: 3, updatedAt: t - 1000, freshUntil: t + 5000, staleUntil: t + 20000, source: 'x' },
      newest: { value: 4, updatedAt: t - 500, freshUntil: t + 5000, staleUntil: t + 20000, source: 'x' },
      extra: { value: 5, updatedAt: t - 200, freshUntil: t + 5000, staleUntil: t + 20000, source: 'x' },
    };
    const cache = createBoundedCache({ maxSize: 3, freshMs: 5000, staleMs: 20000 });
    cache.load(data, { freshMs: 5000, staleMs: 20000 });
    assert.equal(cache.get('old').kind, 'miss');
    assert.equal(cache.get('mid').kind, 'miss');
    cache.set('brand', { v: 9 });
    assert.equal(cache.get('new').kind, 'miss');
    assert.equal(cache.get('newest').kind, 'fresh');
    assert.equal(cache.get('extra').kind, 'fresh');
  });

  it('touch moves entry to newest side', () => {
    const t = Date.now();
    const cache = createBoundedCache({ maxSize: 2, freshMs: 5000, staleMs: 20000 });
    cache.load({
      a: { value: 1, updatedAt: t - 2000, freshUntil: t + 5000, staleUntil: t + 20000, source: 'x' },
      b: { value: 2, updatedAt: t - 1000, freshUntil: t + 5000, staleUntil: t + 20000, source: 'x' },
    }, { freshMs: 5000, staleMs: 20000 });
    cache.get('a');
    cache.set('c', { v: 3 });
    assert.equal(cache.get('a').kind, 'fresh');
    assert.equal(cache.get('b').kind, 'miss');
  });
});
