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
      out[k] = {
        value: e.value,
        updatedAt: e.updatedAt,
        freshUntil: e.freshUntil,
        staleUntil: e.staleUntil,
        source: e.source,
        error: e.error || null,
        errorCode: e.errorCode || null,
      };
    }
    return out;
  }

  function load(entries = {}, profile = {}) {
    map.clear();
    const t = now();
    const pFresh = Number(profile.freshMs || freshMs);
    const pStale = Number(profile.staleMs || staleMs);
    const pError = Number(profile.errorMs || errorMs);

    const rows = [];
    for (const [k, raw] of Object.entries(entries || {})) {
      if (!raw || typeof raw !== 'object') continue;
      const updatedAt = Number(raw.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;

      let freshUntil = Number(raw.freshUntil);
      let staleUntil = Number(raw.staleUntil);
      const isError = Boolean(raw.error || raw.errorCode);

      if (!Number.isFinite(freshUntil) || !Number.isFinite(staleUntil)) {
        const errMs = isError ? pError : pFresh;
        const stMs = isError ? pError : pStale;
        freshUntil = updatedAt + errMs;
        staleUntil = updatedAt + stMs;
      }

      if (staleUntil <= t) continue;

      rows.push({
        key: k,
        entry: {
          value: raw.value,
          updatedAt,
          freshUntil,
          staleUntil,
          source: raw.source || 'persisted',
          error: raw.error || null,
          errorCode: raw.errorCode || null,
          refreshing: false,
        },
      });
    }

    rows.sort((a, b) => b.entry.updatedAt - a.entry.updatedAt);
    for (const row of rows.slice(0, maxSize)) {
      map.set(row.key, row.entry);
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
    profile: () => ({ maxSize, freshMs, staleMs, errorMs }),
  };
}

module.exports = { createBoundedCache };
