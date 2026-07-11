/**
 * Abortable timeout helper — propagates signal to loaders.
 */
function runWithAbortTimeout(fn, ms, label, parentSignal) {
  const ctrl = new AbortController();
  const { signal } = ctrl;
  let timer = null;
  let onParentAbort = null;

  function cleanup() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (parentSignal && onParentAbort) {
      parentSignal.removeEventListener('abort', onParentAbort);
      onParentAbort = null;
    }
  }

  if (parentSignal) {
    if (parentSignal.aborted) {
      const err = new Error(`${label || 'request'}_aborted`);
      err.code = 'timeout';
      return Promise.reject(err);
    }
    onParentAbort = () => ctrl.abort();
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  timer = setTimeout(() => ctrl.abort(), ms);

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
    .finally(cleanup);
}

module.exports = { runWithAbortTimeout };
