const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBoundedCache } = require('../../src/core/bounded-cache');

describe('bounded-cache', () => {
  it('fresh hit returns immediately', () => {
    const cache = createBoundedCache({ maxSize: 10, freshMs: 5000, staleMs: 10000 });
    cache.set('a', { v: 1 });
    const hit = cache.get('a');
    assert.equal(hit.kind, 'fresh');
    assert.equal(hit.entry.value.v, 1);
  });

  it('stale returns old value', () => {
    const cache = createBoundedCache({ maxSize: 10, freshMs: 1, staleMs: 5000 });
    cache.set('a', { v: 1 });
    const start = cache.get('a').entry.updatedAt;
    while (Date.now() - start < 5) { /* wait fresh expiry */ }
    const hit = cache.get('a');
    assert.equal(hit.kind, 'stale');
    assert.equal(hit.entry.value.v, 1);
  });

  it('LRU evicts oldest', () => {
    const cache = createBoundedCache({ maxSize: 2, freshMs: 10000, staleMs: 20000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    assert.equal(cache.get('b').kind, 'miss');
    assert.equal(cache.get('a').kind, 'fresh');
    assert.equal(cache.get('c').kind, 'fresh');
  });

  it('error cache uses short TTL profile', () => {
    const cache = createBoundedCache({ maxSize: 10, freshMs: 10000, staleMs: 20000, errorMs: 50 });
    cache.set('e', { err: true }, { error: true, errorCode: 'timeout' });
    assert.equal(cache.get('e').kind, 'fresh');
  });
});
