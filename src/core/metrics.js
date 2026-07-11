/** @typedef {Record<string, number>} MetricsSnapshot */

function createMetrics() {
  const counters = {
    inflightCount: 0,
    upstreamRequestCount: 0,
    singleflightJoinedCount: 0,
    cacheHitCount: 0,
    cacheStaleHitCount: 0,
    cacheMissCount: 0,
    errorCount: 0,
    timeoutCount: 0,
    batchCardCount: 0,
    batchRequestCount: 0,
  };

  return {
    inc(name, n = 1) {
      if (counters[name] == null) counters[name] = 0;
      counters[name] += n;
    },
    set(name, value) {
      counters[name] = value;
    },
    snapshot() {
      return { ...counters };
    },
    reset() {
      for (const k of Object.keys(counters)) counters[k] = 0;
    },
  };
}

module.exports = { createMetrics };
