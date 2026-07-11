const VERSION = '3.0.2';
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
    sfConfigured: false,
    sfReady: false,
    devtoolsConnected: false,
    pageInjectionReady: false,
    webReady: false,
  };
  let sfMeta = {
    sfLastQueryOK: null,
    sfLastError: null,
    sfLastErrorCode: null,
    sfLastSuccessAt: null,
    sfLastFailureAt: null,
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
    if (patch.sfConfigReady != null && patch.sfConfigured == null) {
      flags.sfConfigured = Boolean(patch.sfConfigReady);
    }
    if (patch.webPortConflict) {
      flags.webReady = false;
    }
  }

  function setSfQueryResult(result = {}) {
    const ok = Boolean(result.ok);
    const at = Date.now();
    if (ok) {
      sfMeta.sfLastQueryOK = true;
      sfMeta.sfLastError = null;
      sfMeta.sfLastErrorCode = null;
      sfMeta.sfLastSuccessAt = at;
      flags.sfReady = true;
    } else if (result.attempted) {
      sfMeta.sfLastQueryOK = false;
      sfMeta.sfLastError = result.error || null;
      sfMeta.sfLastErrorCode = result.errorCode || null;
      sfMeta.sfLastFailureAt = at;
      flags.sfReady = false;
    }
  }

  function buildHealth(metrics = {}) {
    const uptimeMs = Date.now() - startedAt;
    const degradedReasons = [];

    const coreOk = flags.coreReady && flags.packageApiReady && flags.afterSaleReady;
    if (!flags.sfConfigured) degradedReasons.push('sf_config_missing');
    else if (sfMeta.sfLastQueryOK === false) {
      const code = sfMeta.sfLastErrorCode || '';
      if (code === 'auth_error' || /A1006|签名/.test(sfMeta.sfLastError || '')) {
        degradedReasons.push('sf_auth_error');
      } else {
        degradedReasons.push('sf_upstream_error');
      }
    } else if (sfMeta.sfLastQueryOK === null && flags.sfConfigured) {
      degradedReasons.push('sf_unverified');
    }
    if (!flags.devtoolsConnected) degradedReasons.push('devtools_offline');
    if (devtools.pageCount === 0) degradedReasons.push('no_qianfan_pages');
    else if (!flags.pageInjectionReady) degradedReasons.push('injection_incomplete');
    if (!flags.webReady) {
      if (flags.webPortConflict) degradedReasons.push('web_port_conflict');
      else degradedReasons.push('web_unavailable');
    }

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
        sfFee: flags.sfReady === true,
        batchCards: flags.coreReady,
        singleflight: true,
        persistentCache: true,
        fonts: true,
      },
      checks: { ...flags },
      sf: { ...sfMeta },
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
    setSfQueryResult,
    buildHealth,
    get flags() {
      return { ...flags };
    },
  };
}

module.exports = { createRuntimeState, VERSION, SERVICE };
