/**
 * Batch request controller with AbortController race safety.
 */
function createBatchController(options = {}) {
  const timeoutMs = Number(options.timeoutMs || 3000);
  let batchAbort = null;
  let batchCount = 0;
  let abortCount = 0;

  function cancelBatch() {
    const ctrl = batchAbort;
    if (!ctrl) return;
    abortCount += 1;
    ctrl.abort();
    if (batchAbort === ctrl) batchAbort = null;
  }

  function getActiveController() {
    return batchAbort;
  }

  async function runBatch(fetchFn, gen, isStale) {
    cancelBatch();
    const controller = new AbortController();
    batchAbort = controller;
    batchCount += 1;
    const timer = setTimeout(() => {
      if (batchAbort === controller) controller.abort();
    }, timeoutMs);
    try {
      const result = await fetchFn(controller.signal);
      if (isStale(gen)) return null;
      return result;
    } catch (err) {
      if (err?.name === 'AbortError') {
        return isStale(gen) ? null : { error: '查询超时', errorCode: 'timeout' };
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (batchAbort === controller) batchAbort = null;
    }
  }

  function getStats() {
    return { batchCount, abortCount };
  }

  return {
    cancelBatch,
    runBatch,
    getActiveController,
    getStats,
  };
}

function parseBatchResponse(res, body) {
  if (!res.ok) {
    const parsed = body && typeof body === 'object' ? body : {};
    return {
      ok: false,
      error: parsed.error || `HTTP ${res.status}`,
      errorCode: parsed.errorCode || mapHttpStatus(res.status),
      status: res.status,
    };
  }
  return body;
}

function mapHttpStatus(status) {
  if (status === 400) return 'unknown_shop';
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 409) return 'shop_identity_conflict';
  if (status === 503) return 'unhealthy';
  return 'upstream_error';
}

module.exports = {
  createBatchController,
  parseBatchResponse,
  mapHttpStatus,
};
