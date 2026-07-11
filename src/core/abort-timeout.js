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

  function abortedError(code) {
    const err = new Error(`${label || 'request'}_${code === 'timeout' ? 'timeout' : 'aborted'}`);
    err.code = code === 'timeout' ? 'timeout' : 'aborted';
    return err;
  }

  if (parentSignal) {
    if (parentSignal.aborted) {
      return Promise.reject(abortedError('aborted'));
    }
    onParentAbort = () => ctrl.abort();
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  timer = setTimeout(() => ctrl.abort(), ms);

  return Promise.resolve()
    .then(() => fn(signal))
    .then((value) => {
      if (signal.aborted) throw abortedError(parentSignal?.aborted ? 'aborted' : 'timeout');
      return value;
    })
    .catch((err) => {
      if (signal.aborted) {
        throw abortedError(parentSignal?.aborted ? 'aborted' : 'timeout');
      }
      throw err;
    })
    .finally(cleanup);
}

module.exports = { runWithAbortTimeout };
