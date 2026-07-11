const VERSION = '3.0.0';
const SERVICE = 'qf-sf-data-core';

function createRuntimeState(options = {}) {
  const startedAt = Date.now();
  const instanceId = options.instanceId || `core-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  let devtools = {
    connected: false,
    pageCount: 0,
    injectedCount: 0,
    expectedVersion: VERSION,
    versions: [],
  };
  let flags = {
    processAlive: true,
    coreReady: false,
    packageApiReady: false,
    afterSaleReady: false,
    sfConfigReady: false,
    devtoolsConnected: false,
    pageInjectionReady: false,
    webReady: false,
  };

  function setDevtools(patch) {
    devtools = { ...devtools, ...patch };
    flags.devtoolsConnected = Boolean(devtools.connected);
    const expected = devtools.expectedVersion || VERSION;
    const versions = devtools.versions || [];
    const allMatch = devtools.pageCount > 0
      && devtools.injectedCount >= devtools.pageCount
      && versions.every((v) => v === expected);
    flags.pageInjectionReady = allMatch;
  }

  function setFlags(patch) {
    flags = { ...flags, ...patch };
  }

  function buildHealth(metrics = {}) {
    const uptimeMs = Date.now() - startedAt;
    const ok = flags.coreReady
      && flags.packageApiReady
      && flags.afterSaleReady
      && flags.sfConfigReady
      && flags.devtoolsConnected
      && (devtools.pageCount === 0 || flags.pageInjectionReady);

    return {
      ok,
      service: SERVICE,
      version: VERSION,
      instanceId,
      startedAt,
      uptimeMs,
      features: {
        packageDetail: flags.packageApiReady,
        afterSale: flags.afterSaleReady,
        sfFee: flags.sfConfigReady,
        batchCards: flags.coreReady,
        singleflight: true,
        persistentCache: true,
        fonts: true,
      },
      checks: { ...flags },
      devtools: { ...devtools },
      metrics: metrics || {},
    };
  }

  return {
    VERSION,
    SERVICE,
    instanceId,
    startedAt,
    setDevtools,
    setFlags,
    buildHealth,
    get flags() {
      return { ...flags };
    },
  };
}

module.exports = { createRuntimeState, VERSION, SERVICE };
