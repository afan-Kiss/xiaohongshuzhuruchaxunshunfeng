/**
 * LRU cache with fresh / stale TTL and background refresh dedupe.
 */
function createBoundedCache(options = {}) {
  const maxSize = Number(options.maxSize || 1000);
  const freshMs = Number(options.freshMs || 10_000);
  const staleMs = Number(options.staleMs || 300_000);
  const errorMs = Number(options.errorMs || 2000);
  const map = new Map();

  function now() {
    return Date.now();
  }

  function touch(key, entry) {
    if (map.has(key)) map.delete(key);
    map.set(key, entry);
    while (map.size > maxSize) {
      const first = map.keys().next().value;
      map.delete(first);
    }
  }

  function wrap(value, meta = {}) {
    const t = now();
    const isError = Boolean(meta.error);
    const freshUntil = t + (isError ? errorMs : freshMs);
    const staleUntil = t + (isError ? errorMs : staleMs);
    return {
      value,
      updatedAt: t,
      freshUntil,
      staleUntil,
      source: meta.source || 'upstream',
      error: meta.error || null,
      errorCode: meta.errorCode || null,
      refreshing: false,
    };
  }

  function get(key) {
    const entry = map.get(key);
    if (!entry) return { kind: 'miss' };
    touch(key, entry);
    const t = now();
    if (t <= entry.freshUntil) return { kind: 'fresh', entry };
    if (t <= entry.staleUntil) return { kind: 'stale', entry };
    map.delete(key);
    return { kind: 'miss' };
  }

  function set(key, value, meta) {
    const entry = wrap(value, meta);
    touch(key, entry);
    return entry;
  }

  function markRefreshing(key) {
    const entry = map.get(key);
    if (!entry || entry.refreshing) return false;
    entry.refreshing = true;
    return true;
  }

  function clearRefreshing(key) {
    const entry = map.get(key);
    if (entry) entry.refreshing = false;
  }

  function deleteKey(key) {
    map.delete(key);
  }

  function clear() {
    map.clear();
  }

  function dump() {
    const out = {};
    for (const [k, e] of map) {
      out[k] = { value: e.value, updatedAt: e.updatedAt, source: e.source };
    }
    return out;
  }

  function load(entries = {}) {
    map.clear();
    for (const [k, raw] of Object.entries(entries)) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = {
        value: raw.value,
        updatedAt: Number(raw.updatedAt) || now(),
        freshUntil: Number(raw.freshUntil) || 0,
        staleUntil: Number(raw.staleUntil) || 0,
        source: raw.source || 'persisted',
        error: raw.error || null,
        errorCode: raw.errorCode || null,
        refreshing: false,
      };
      if (entry.staleUntil > now()) map.set(k, entry);
    }
  }

  return {
    get,
    set,
    markRefreshing,
    clearRefreshing,
    delete: deleteKey,
    clear,
    dump,
    load,
    size: () => map.size,
  };
}

module.exports = { createBoundedCache };
