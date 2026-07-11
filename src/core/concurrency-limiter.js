/**
 * Simple FIFO concurrency limiter with per-key caps.
 */
function createConcurrencyLimiter(globalMax, perKeyMax = 0) {
  const globalLimit = Math.max(1, Number(globalMax) || 1);
  const keyLimit = perKeyMax > 0 ? perKeyMax : globalLimit;
  let active = 0;
  const queue = [];
  const keyActive = new Map();

  function canRun(job) {
    if (active >= globalLimit) return false;
    return (keyActive.get(job.key) || 0) < keyLimit;
  }

  function runNext() {
    while (active < globalLimit && queue.length) {
      const idx = queue.findIndex((j) => canRun(j));
      if (idx < 0) break;
      const job = queue.splice(idx, 1)[0];
      active += 1;
      keyActive.set(job.key, (keyActive.get(job.key) || 0) + 1);
      job
        .fn()
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          keyActive.set(job.key, Math.max(0, (keyActive.get(job.key) || 1) - 1));
          runNext();
        });
    }
  }

  function schedule(key, fn) {
    return new Promise((resolve, reject) => {
      queue.push({ key: String(key || 'global'), fn, resolve, reject });
      runNext();
    });
  }

  return {
    schedule,
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
  };
}

module.exports = { createConcurrencyLimiter };
