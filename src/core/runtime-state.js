const VERSION = '3.0.1';
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
    sfReady: false,
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
      && versions.length >= devtools.pageCount
      && versions.every((v) => v === expected);
    flags.pageInjectionReady = devtools.pageCount === 0 ? true : allMatch;
  }

  function setFlags(patch) {
    flags = { ...flags, ...patch };
    if (patch.sfConfigReady != null && patch.sfReady == null) {
      flags.sfReady = Boolean(patch.sfConfigReady);
    }
  }

  function buildHealth(metrics = {}) {
    const uptimeMs = Date.now() - startedAt;
    const degradedReasons = [];

    const coreOk = flags.coreReady && flags.packageApiReady && flags.afterSaleReady;
    if (!flags.sfReady) degradedReasons.push('sf_config_missing');
    if (!flags.devtoolsConnected) degradedReasons.push('devtools_offline');
    if (devtools.pageCount === 0) degradedReasons.push('no_qianfan_pages');
    else if (!flags.pageInjectionReady) degradedReasons.push('injection_incomplete');
    if (!flags.webReady) degradedReasons.push('web_unavailable');

    let status = 'unhealthy';
    let ok = false;
    if (!coreOk) {
      status = 'unhealthy';
      ok = false;
    } else if (degradedReasons.length > 0) {
      status = 'degraded';
      ok = true;
    } else {
      status = 'healthy';
      ok = true;
    }

    return {
      ok,
      status,
      service: SERVICE,
      version: VERSION,
      instanceId,
      startedAt,
      uptimeMs,
      features: {
        packageDetail: flags.packageApiReady,
        afterSale: flags.afterSaleReady,
        sfFee: flags.sfReady,
        batchCards: flags.coreReady,
        singleflight: true,
        persistentCache: true,
        fonts: true,
      },
      checks: { ...flags },
      degradedReasons,
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
