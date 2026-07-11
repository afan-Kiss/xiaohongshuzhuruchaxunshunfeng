const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createBoundedCache } = require('../../src/core/bounded-cache');
const { createPersistence } = require('../../src/core/persistence');

describe('cache persistence schema v2', () => {
  it('restores fresh and stale TTL from disk', () => {
    const cache = createBoundedCache({ maxSize: 10, freshMs: 5000, staleMs: 20000 });
    const t = Date.now();
    cache.set('fresh1', { v: 1 });
    const freshEntry = cache.dump()['fresh1'];
    const staleEntry = {
      value: { v: 2 },
      updatedAt: t - 6000,
      freshUntil: t - 1000,
      staleUntil: t + 15000,
      source: 'upstream',
    };
    const expired = {
      value: { v: 3 },
      updatedAt: t - 30000,
      freshUntil: t - 25000,
      staleUntil: t - 5000,
      source: 'upstream',
    };
    const data = {
      fresh1: freshEntry,
      stale1: staleEntry,
      expired1: expired,
    };

    const cache2 = createBoundedCache({ maxSize: 10, freshMs: 5000, staleMs: 20000 });
    cache2.load(data, { freshMs: 5000, staleMs: 20000 });
    assert.equal(cache2.get('fresh1').kind, 'fresh');
    assert.equal(cache2.get('stale1').kind, 'stale');
    assert.equal(cache2.get('expired1').kind, 'miss');
  });

  it('compatible with v1 format without freshUntil', () => {
    const t = Date.now() - 2000;
    const cache = createBoundedCache({ maxSize: 5, freshMs: 10000, staleMs: 30000 });
    cache.load({ old: { value: { x: 1 }, updatedAt: t, source: 'persisted' } }, {
      freshMs: 10000,
      staleMs: 30000,
    });
    const hit = cache.get('old');
    assert.ok(hit.kind === 'fresh' || hit.kind === 'stale');
  });

  it('persistence roundtrip via file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-persist-'));
    const file = path.join(dir, 'cache.json');
    const p = createPersistence(file, { debounceMs: 10 });
    const payload = {
      schemaVersion: 2,
      savedAt: Date.now(),
      package: {
        k1: {
          value: { a: 1 },
          updatedAt: Date.now(),
          freshUntil: Date.now() + 5000,
          staleUntil: Date.now() + 20000,
          source: 'upstream',
        },
      },
    };
    p.flushNow(payload);
    const loaded = p.load();
    assert.equal(loaded.schemaVersion, 2);
    assert.ok(loaded.package.k1);
    p.close();
  });
});
