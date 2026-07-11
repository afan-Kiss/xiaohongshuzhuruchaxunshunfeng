/**
 * Process-wide request coalescing. Old inflight cleanup only removes its own promise.
 */
function createSingleflight(metrics) {
  const inflight = new Map();

  async function run(key, loader) {
    const k = String(key || '');
    if (!k) return loader();

    const existing = inflight.get(k);
    if (existing) {
      metrics?.inc('singleflightJoinedCount');
      return existing;
    }

    metrics?.inc('inflightCount');
    const current = (async () => {
      try {
        metrics?.inc('upstreamRequestCount');
        return await loader();
      } finally {
        metrics?.inc('inflightCount', -1);
        if (inflight.get(k) === current) inflight.delete(k);
      }
    })();

    inflight.set(k, current);
    return current;
  }

  function size() {
    return inflight.size;
  }

  function clear() {
    inflight.clear();
  }

  return { run, size, clear };
}

module.exports = { createSingleflight };
