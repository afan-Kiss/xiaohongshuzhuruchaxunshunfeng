/**
 * Abortable timeout helper — propagates signal to loaders.
 */
function runWithAbortTimeout(fn, ms, label, parentSignal) {
  const ctrl = new AbortController();
  const { signal } = ctrl;

  if (parentSignal) {
    if (parentSignal.aborted) {
      const err = new Error(`${label || 'request'}_aborted`);
      err.code = 'timeout';
      return Promise.reject(err);
    }
    parentSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  const timer = setTimeout(() => ctrl.abort(), ms);

  return Promise.resolve()
    .then(() => fn(signal))
    .catch((err) => {
      if (signal.aborted) {
        const timeoutErr = new Error(`${label || 'request'}_timeout`);
        timeoutErr.code = 'timeout';
        throw timeoutErr;
      }
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

module.exports = { runWithAbortTimeout };
