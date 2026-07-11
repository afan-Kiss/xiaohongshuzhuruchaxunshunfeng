const VERSION = '3.0.5';
const SERVICE = 'qf-sf-data-core';

const VERIFICATION_TTL_MS = 10_000;

function enrichPageRecord(page, expectedVersion) {
  const now = Date.now();
  const lastVerifiedAt = Number(page.lastVerifiedAt || 0);
  const verificationAgeMs = lastVerifiedAt > 0 ? now - lastVerifiedAt : null;
  const verificationFresh = Boolean(
    page.verified
    && (page.actualVersion || page.version) === expectedVersion
    && lastVerifiedAt > 0
    && verificationAgeMs <= VERIFICATION_TTL_MS,
  );
  return {
    ...page,
    lastVerifiedAt: lastVerifiedAt || null,
    verificationAgeMs,
    verificationFresh,
  };
}

function createRuntimeState(options = {}) {
  const startedAt = Date.now();
  const instanceId = options.instanceId || `core-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  let devtools = {
    connected: false,
    pageCount: 0,
    injectedCount: 0,
    expectedVersion: VERSION,
    versions: [],
    pages: [],
  };
  let flags = {
    processAlive: true,
    coreReady: false,
    packageApiReady: false,
    afterSaleReady: false,
    sfConfigured: false,
    sfVerified: false,
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
    const pages = Array.isArray(devtools.pages) ? devtools.pages : [];
    if (pages.length > 0) {
      const enriched = pages.map((p) => enrichPageRecord(p, expected));
      devtools.pages = enriched;
      const verifiedPages = enriched.filter((p) => p.verificationFresh);
      devtools.injectedCount = verifiedPages.length;
      devtools.versions = verifiedPages.map((p) => p.actualVersion || p.version || '');
      flags.pageInjectionReady = devtools.pageCount > 0
        && verifiedPages.length >= devtools.pageCount
        && enriched.every((p) => p.verificationFresh);
    } else {
      const versions = devtools.versions || [];
      flags.pageInjectionReady = devtools.pageCount === 0 ? true : (
        devtools.injectedCount >= devtools.pageCount
        && versions.length >= devtools.pageCount
        && versions.every((v) => v === expected)
      );
    }
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
      flags.sfVerified = true;
      flags.sfReady = true;
    } else if (result.attempted) {
      sfMeta.sfLastQueryOK = false;
      sfMeta.sfLastError = result.error || null;
      sfMeta.sfLastErrorCode = result.errorCode || null;
      sfMeta.sfLastFailureAt = at;
      flags.sfVerified = true;
      flags.sfReady = false;
    }
  }

  function buildHealth(metrics = {}) {
    const uptimeMs = Date.now() - startedAt;
    const degradedReasons = [];

    const coreOk = flags.coreReady && flags.packageApiReady && flags.afterSaleReady;
    if (!flags.sfConfigured) degradedReasons.push('sf_config_missing');
    else if (!flags.sfVerified) degradedReasons.push('sf_unverified');
    else if (sfMeta.sfLastQueryOK === false) {
      const code = sfMeta.sfLastErrorCode || '';
      if (code === 'auth_error' || /A1006|签名/.test(sfMeta.sfLastError || '')) {
        degradedReasons.push('sf_auth_error');
      } else {
        degradedReasons.push('sf_upstream_error');
      }
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
