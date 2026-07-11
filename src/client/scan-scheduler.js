/**
 * Scan scheduler — ignores plugin-owned DOM mutations, coalesces concurrent scans.
 */
const OWN_WRAP_CLASS = 'qsf-inline-fee-wrap';
const OWN_STYLE_ID = 'qf-sf-fee-inline-style';

function isOwnNode(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.classList?.contains(OWN_WRAP_CLASS)) return true;
  if (node.id === OWN_STYLE_ID) return true;
  return Boolean(node.closest?.(`.${OWN_WRAP_CLASS}`));
}

function isOwnMutation(mutation) {
  if (!mutation) return false;
  const target = mutation.target;
  if (target && isOwnNode(target)) return true;
  if (mutation.type === 'childList') {
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    if (nodes.length > 0 && nodes.every((n) => n.nodeType !== 1 || isOwnNode(n))) {
      return true;
    }
  }
  return false;
}

function createScanScheduler(options = {}) {
  const debounceMs = Number(options.debounceMs ?? 70);
  const onScan = options.onScan || (async () => {});

  let scanTimer = null;
  let scanRunning = false;
  let scanPending = false;
  let scanCount = 0;

  function scheduleScan(immediate = false) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      void triggerScan();
    }, immediate ? 0 : debounceMs);
  }

  async function triggerScan() {
    if (scanRunning) {
      scanPending = true;
      return;
    }
    scanRunning = true;
    scanCount += 1;
    try {
      await onScan();
    } finally {
      scanRunning = false;
      if (scanPending) {
        scanPending = false;
        void triggerScan();
      }
    }
  }

  function handleMutations(mutations) {
    for (const m of mutations) {
      if (isOwnMutation(m)) continue;
      if (m.type === 'childList') {
        scheduleScan(false);
        return;
      }
      if (m.type === 'attributes' && m.target?.closest?.('.order-card')) {
        scheduleScan(false);
        return;
      }
    }
  }

  function clearTimer() {
    clearTimeout(scanTimer);
    scanTimer = null;
  }

  function getStats() {
    return { scanCount, scanRunning, scanPending };
  }

  return {
    isOwnMutation,
    scheduleScan,
    triggerScan,
    handleMutations,
    clearTimer,
    getStats,
  };
}

module.exports = {
  OWN_WRAP_CLASS,
  OWN_STYLE_ID,
  isOwnNode,
  isOwnMutation,
  createScanScheduler,
};
