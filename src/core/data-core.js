const path = require('path');
const { createMetrics } = require('./metrics');
const { createSingleflight } = require('./singleflight');
const { createBoundedCache } = require('./bounded-cache');
const { createConcurrencyLimiter } = require('./concurrency-limiter');
const { createPersistence } = require('./persistence');
const {
  normalizePackageDetail,
  normalizeAfterSale,
  normalizeSfFee,
  mergeCardDto,
  pickSfWaybill,
} = require('./normalizers');
const { fetchPackageDetailByCookie, fetchReturnsV3ByCookie } = require('../qianfan-package-api');
const {
  getShopCookie,
  invalidateShopCookie,
} = require('../qianfan-shop-cookies');
const { validateShopIdentity } = require('./shop-identity');
const { querySfWaybillFee } = require('../sf-waybill-client');

const TIMEOUT = {
  package: 8000,
  afterSale: 8000,
  cookie: 5000,
  sf: 15000,
};

const CACHE_PROFILE = {
  package: { maxSize: 1000, freshMs: 10_000, staleMs: 300_000 },
  afterSaleOpen: { maxSize: 1000, freshMs: 5000, staleMs: 120_000 },
  afterSaleClosed: { maxSize: 2000, freshMs: 86_400_000, staleMs: 7 * 86_400_000 },
  sfOk: { maxSize: 3000, freshMs: 86_400_000, staleMs: 30 * 86_400_000 },
  sfErr: { maxSize: 500, freshMs: 2000, staleMs: 3000, errorMs: 2000 },
};

function isClosedAfterSale(status) {
  const s = String(status || '').toLowerCase();
  return /完成|关闭|成功|已退|refund|closed|done|success/.test(s);
}

function cacheKeyPackage(shopKey, packageId) {
  return `pkg:${shopKey}:${packageId}`;
}

function cacheKeyAfterSale(shopKey, returnsId) {
  return `as:${shopKey}:${returnsId}`;
}

function cacheKeySf(partnerID, monthlyCard, waybill) {
  return `sf:${partnerID}:${monthlyCard}:${waybill}`;
}

const { runWithAbortTimeout } = require('./abort-timeout');

function createDataCore(options = {}) {
  const metrics = createMetrics();
  const sf = options.sf || {};
  const testHooks = options.testHooks || {};
  const onSfQueryResult = options.onSfQueryResult || (() => {});
  const persistPath = options.persistPath
    || path.join(options.root || process.cwd(), 'data', 'runtime', 'sf-data-core-cache.json');
  const persistence = createPersistence(persistPath);

  const packageCache = createBoundedCache(CACHE_PROFILE.package);
  const afterSaleOpenCache = createBoundedCache(CACHE_PROFILE.afterSaleOpen);
  const afterSaleClosedCache = createBoundedCache(CACHE_PROFILE.afterSaleClosed);
  const sfOkCache = createBoundedCache(CACHE_PROFILE.sfOk);
  const sfErrCache = createBoundedCache(CACHE_PROFILE.sfErr);

  const sfPackage = createSingleflight(metrics);
  const sfAfterSale = createSingleflight(metrics);
  const sfFeeFlight = createSingleflight(metrics);

  const qianfanLimiter = createConcurrencyLimiter(4, 2);
  const sfLimiter = createConcurrencyLimiter(6);

  const persisted = persistence.load();
  const schemaVersion = Number(persisted.schemaVersion) || 1;
  if (persisted.package) packageCache.load(persisted.package, CACHE_PROFILE.package);
  if (persisted.afterSaleOpen) afterSaleOpenCache.load(persisted.afterSaleOpen, CACHE_PROFILE.afterSaleOpen);
  else if (schemaVersion < 2 && persisted.afterSale) {
    afterSaleOpenCache.load(persisted.afterSale, CACHE_PROFILE.afterSaleOpen);
  }
  if (persisted.afterSaleClosed) afterSaleClosedCache.load(persisted.afterSaleClosed, CACHE_PROFILE.afterSaleClosed);
  if (persisted.sfOk) sfOkCache.load(persisted.sfOk, CACHE_PROFILE.sfOk);
  else if (schemaVersion < 2 && persisted.sf) {
    sfOkCache.load(persisted.sf, CACHE_PROFILE.sfOk);
  }

  let persistTimer = null;
  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistence.scheduleSave({
        schemaVersion: 2,
        savedAt: Date.now(),
        package: packageCache.dump(),
        afterSaleOpen: afterSaleOpenCache.dump(),
        afterSaleClosed: afterSaleClosedCache.dump(),
        sfOk: sfOkCache.dump(),
      });
    }, 100);
  }

  async function getCookie(shopKey, signal) {
    if (testHooks.getCookie) return testHooks.getCookie(shopKey, signal);
    return runWithAbortTimeout((sig) => getShopCookie(shopKey, sig), TIMEOUT.cookie, 'cookie', signal);
  }

  async function readCache(cache, key, metricsRef) {
    const hit = cache.get(key);
    if (hit.kind === 'fresh') {
      metricsRef.inc('cacheHitCount');
      return { value: hit.entry.value, state: 'fresh', stale: false };
    }
    if (hit.kind === 'stale') {
      metricsRef.inc('cacheStaleHitCount');
      return { value: hit.entry.value, state: 'stale', stale: true, entry: hit.entry };
    }
    metricsRef.inc('cacheMissCount');
    return { value: null, state: 'miss', stale: false };
  }

  async function swrLoad(cache, key, loader, afterSaleClosed = false) {
    const cached = await readCache(cache, key, metrics);
    if (cached.state === 'fresh') {
      return { data: cached.value, state: 'fresh', source: 'cache', stale: false };
    }
    if (cached.state === 'stale') {
      if (cache.markRefreshing(key)) {
        loader()
          .then((value) => {
            cache.set(key, value, { source: 'upstream' });
            schedulePersist();
          })
          .catch((err) => {
            /* keep stale */
          })
          .finally(() => cache.clearRefreshing(key));
      }
      return {
        data: cached.value,
        state: 'stale',
        source: 'cache',
        stale: true,
      };
    }
    try {
      const value = await loader();
      cache.set(key, value, { source: 'upstream' });
      schedulePersist();
      return { data: value, state: 'fresh', source: 'upstream', stale: false };
    } catch (err) {
      metrics.inc('errorCount');
      if (err.code === 'timeout') metrics.inc('timeoutCount');
      throw err;
    }
  }

  async function fetchPackage(shopKey, packageId, force = false) {
    const key = cacheKeyPackage(shopKey, packageId);
    if (force) packageCache.delete(key);

    return sfPackage.run(key, () =>
      qianfanLimiter.schedule(shopKey, async () => {
        const loader = async () => {
          if (testHooks.fetchPackage) {
            return runWithAbortTimeout(
              (signal) => testHooks.fetchPackage(shopKey, packageId, signal),
              TIMEOUT.package,
              'package_detail',
            );
          }
          const cookieRes = await getCookie(shopKey);
          if (!cookieRes.ok) {
            const err = new Error(cookieRes.error || 'cookie_unavailable');
            err.code = 'auth_error';
            throw err;
          }
          const detail = await runWithAbortTimeout(
            (signal) => fetchPackageDetailByCookie(packageId, cookieRes.cookie, signal),
            TIMEOUT.package,
            'package_detail',
          );
          if (!detail.ok) {
            if (detail.status === 401 || detail.status === 403) invalidateShopCookie(shopKey);
            const err = new Error(detail.error || 'package_fetch_failed');
            err.code = detail.status === 401 || detail.status === 403 ? 'auth_error' : 'upstream_error';
            throw err;
          }
          return normalizePackageDetail(detail.data, { packageId, shopKey });
        };

        if (force) {
          const value = await loader();
          packageCache.set(key, value, { source: 'upstream' });
          schedulePersist();
          return { data: value, state: 'fresh', source: 'upstream', stale: false };
        }
        return swrLoad(packageCache, key, loader);
      }),
    );
  }

  async function fetchAfterSale(shopKey, returnsId, packageId, force = false) {
    const key = cacheKeyAfterSale(shopKey, returnsId);
    if (force) {
      afterSaleOpenCache.delete(key);
      afterSaleClosedCache.delete(key);
    }

    return sfAfterSale.run(key, () =>
      qianfanLimiter.schedule(shopKey, async () => {
        const loader = async () => {
          if (testHooks.fetchAfterSale) {
            return runWithAbortTimeout(
              (signal) => testHooks.fetchAfterSale(shopKey, returnsId, packageId, signal),
              TIMEOUT.afterSale,
              'returns_v3',
            );
          }
          const cookieRes = await getCookie(shopKey);
          if (!cookieRes.ok) {
            const err = new Error(cookieRes.error || 'cookie_unavailable');
            err.code = 'auth_error';
            throw err;
          }
          const detail = await runWithAbortTimeout(
            (signal) => fetchReturnsV3ByCookie(returnsId, cookieRes.cookie, packageId, signal),
            TIMEOUT.afterSale,
            'returns_v3',
          );
          if (!detail.ok) {
            if (detail.status === 401 || detail.status === 403) invalidateShopCookie(shopKey);
            const err = new Error(detail.error || 'after_sale_fetch_failed');
            err.code = detail.status === 401 || detail.status === 403 ? 'auth_error' : 'upstream_error';
            throw err;
          }
          const normalized = normalizeAfterSale(detail.data, { returnsId, packageId });
          if (!normalized) {
            const err = new Error('after_sale_empty');
            err.code = 'not_found';
            throw err;
          }
          return normalized;
        };

        const openHit = afterSaleOpenCache.get(key);
        const closedHit = afterSaleClosedCache.get(key);
        const primary = closedHit.kind !== 'miss' ? afterSaleClosedCache : afterSaleOpenCache;
        const hit = closedHit.kind !== 'miss' ? closedHit : openHit;

        if (!force && hit.kind === 'fresh') {
          metrics.inc('cacheHitCount');
          return { data: hit.entry.value, state: 'fresh', source: 'cache', stale: false };
        }
        if (!force && hit.kind === 'stale') {
          metrics.inc('cacheStaleHitCount');
          if (primary.markRefreshing(key)) {
            loader()
              .then((value) => {
                const cache = isClosedAfterSale(value.afterSaleStatus)
                  ? afterSaleClosedCache
                  : afterSaleOpenCache;
                cache.set(key, value, { source: 'upstream' });
                schedulePersist();
              })
              .catch(() => {})
              .finally(() => primary.clearRefreshing(key));
          }
          return { data: hit.entry.value, state: 'stale', source: 'cache', stale: true };
        }

        try {
          const value = await loader();
          const cache = isClosedAfterSale(value.afterSaleStatus)
            ? afterSaleClosedCache
            : afterSaleOpenCache;
          cache.set(key, value, { source: 'upstream' });
          schedulePersist();
          return { data: value, state: 'fresh', source: 'upstream', stale: false };
        } catch (err) {
          metrics.inc('errorCount');
          if (err.code === 'timeout') metrics.inc('timeoutCount');
          if (hit.kind === 'stale') {
            return { data: hit.entry.value, state: 'stale', source: 'cache', stale: true, refreshError: err.message };
          }
          throw err;
        }
      }),
    );
  }

  async function fetchSfFee(waybill, force = false) {
    const no = String(waybill || '').trim().toUpperCase();
    if (!/^SF\d{10,}$/.test(no)) {
      return {
        data: normalizeSfFee({ waybill: no, ok: false, error: '非顺丰运单号' }),
        state: 'not_applicable',
        source: 'local',
        stale: false,
      };
    }
    const partnerID = String(sf.partnerID || '').trim();
    const monthlyCard = String(sf.monthlyCard || '').trim();
    const key = cacheKeySf(partnerID, monthlyCard, no);

    if (force) {
      sfOkCache.delete(key);
      sfErrCache.delete(key);
    }

    return sfFeeFlight.run(key, () =>
      sfLimiter.schedule('sf', async () => {
        const okHit = sfOkCache.get(key);
        const errHit = sfErrCache.get(key);
        const hit = okHit.kind !== 'miss' ? okHit : errHit;
        const cache = okHit.kind !== 'miss' ? sfOkCache : sfErrCache;

        if (!force && hit.kind === 'fresh') {
          metrics.inc('cacheHitCount');
          return { data: hit.entry.value, state: 'fresh', source: 'cache', stale: false };
        }
        if (!force && hit.kind === 'stale') {
          metrics.inc('cacheStaleHitCount');
          if (cache.markRefreshing(key)) {
            runWithAbortTimeout((signal) => {
              if (testHooks.fetchSfFee) return testHooks.fetchSfFee(no, sf, signal);
              return querySfWaybillFee(no, sf, signal);
            }, TIMEOUT.sf, 'sf_fee')
              .then((raw) => {
                const normalized = normalizeSfFee(raw);
                const target = normalized.errorCode ? sfErrCache : sfOkCache;
                target.set(key, normalized, {
                  source: 'upstream',
                  error: normalized.error,
                  errorCode: normalized.errorCode,
                });
                schedulePersist();
              })
              .catch(() => {})
              .finally(() => cache.clearRefreshing(key));
          }
          return { data: hit.entry.value, state: 'stale', source: 'cache', stale: true };
        }

        try {
          const raw = testHooks.fetchSfFee
            ? await runWithAbortTimeout((signal) => testHooks.fetchSfFee(no, sf, signal), TIMEOUT.sf, 'sf_fee')
            : await runWithAbortTimeout((signal) => querySfWaybillFee(no, sf, signal), TIMEOUT.sf, 'sf_fee');
          const normalized = normalizeSfFee(raw);
          onSfQueryResult({
            ok: normalized.sfFee != null && !normalized.errorCode,
            attempted: true,
            error: normalized.error,
            errorCode: normalized.errorCode,
          });
          const target = normalized.errorCode && normalized.errorCode !== 'not_found'
            ? sfErrCache
            : sfOkCache;
          target.set(key, normalized, {
            source: 'upstream',
            error: normalized.error,
            errorCode: normalized.errorCode,
          });
          schedulePersist();
          return {
            data: normalized,
            state: normalized.errorCode || 'fresh',
            source: 'upstream',
            stale: false,
          };
        } catch (err) {
          metrics.inc('errorCount');
          if (err.code === 'timeout') metrics.inc('timeoutCount');
          if (hit.kind === 'stale') {
            return { data: hit.entry.value, state: 'stale', source: 'cache', stale: true, refreshError: err.message };
          }
          throw err;
        }
      }),
    );
  }

  async function resolveCard(shopKey, card, force = false) {
    const packageId = String(card.packageId || '').trim();
    const hints = {
      shopKey,
      packageId,
      returnsId: String(card.returnsId || '').trim(),
      expressNos: [...new Set((card.expressNos || []).map((x) => String(x || '').trim()).filter(Boolean))],
    };

    let pkgPart = null;
    let afterPart = null;
    let sfPart = null;
    let err = null;
    let errCode = null;
    let stale = false;
    let source = 'merged';

    try {
      const pkgRes = await fetchPackage(shopKey, packageId, force);
      pkgPart = pkgRes.data;
      stale = stale || pkgRes.stale;
      source = pkgRes.source || source;
      if (!hints.returnsId && pkgPart?.returnsId) hints.returnsId = pkgPart.returnsId;
      if (!hints.expressNos.length && pkgPart?.expressNos?.length) {
        hints.expressNos = pkgPart.expressNos;
      }
    } catch (e) {
      err = e.message;
      errCode = e.code || 'upstream_error';
    }

    const returnsId = hints.returnsId;
    if (returnsId) {
      try {
        const asRes = await fetchAfterSale(shopKey, returnsId, packageId, force);
        afterPart = asRes.data;
        stale = stale || asRes.stale;
      } catch (e) {
        if (!err) {
          err = e.message;
          errCode = e.code || 'upstream_error';
        }
      }
    }

    const waybill = pickSfWaybill(hints.expressNos);
    if (waybill) {
      try {
        const sfRes = await fetchSfFee(waybill, force);
        sfPart = sfRes.data;
        stale = stale || sfRes.stale;
      } catch (e) {
        if (!err) {
          err = e.message;
          errCode = e.code || 'upstream_error';
        }
      }
    } else if (!waybill && hints.expressNos.length) {
      sfPart = { sfFee: null, error: '非顺丰运单', errorCode: 'not_applicable', waybill: '' };
    }

    const dto = mergeCardDto({
      hints,
      package: pkgPart || {},
      afterSale: afterPart || {},
      sf: sfPart || {},
      error: err,
      errorCode: errCode,
      stale,
      source,
      state: stale ? 'stale' : errCode || 'fresh',
      updatedAt: Date.now(),
    });
    return dto;
  }

  async function batchCards(body) {
    metrics.inc('batchRequestCount');
    const identity = validateShopIdentity({
      shopKey: body.shopKey,
      shopTitle: body.shopTitle || body.title,
      shopId: body.shopId,
    });
    if (!identity.ok) {
      return {
        ok: false,
        error: identity.error,
        errorCode: identity.errorCode,
        status: identity.errorCode === 'shop_identity_conflict' ? 409 : 400,
      };
    }
    const shopKey = identity.shopKey;
    const cards = Array.isArray(body.cards) ? body.cards : [];
    const force = Boolean(body.force);
    if (!cards.length) return { ok: false, error: 'missing_cards', status: 400 };
    if (cards.length > 50) return { ok: false, error: 'too_many_cards', status: 400 };

    const deduped = new Map();
    for (const c of cards) {
      const packageId = String(c.packageId || '').trim();
      if (!packageId || deduped.has(packageId)) continue;
      const expressNos = [...new Set((c.expressNos || []).map((x) => String(x || '').trim()).filter(Boolean))];
      const returnsId = String(c.returnsId || '').trim();
      deduped.set(packageId, { packageId, returnsId, expressNos });
    }

    metrics.inc('batchCardCount', deduped.size);
    const items = {};
    const errors = {};

    await Promise.all(
      [...deduped.values()].map(async (card) => {
        try {
          items[card.packageId] = await resolveCard(shopKey, card, force);
        } catch (e) {
          errors[card.packageId] = {
            packageId: card.packageId,
            error: e.message || String(e),
            errorCode: e.code || 'upstream_error',
          };
        }
      }),
    );

    return { ok: true, items, errors, metrics: metrics.snapshot() };
  }

  function invalidate(pattern) {
    if (!pattern || pattern === 'all') {
      packageCache.clear();
      afterSaleOpenCache.clear();
      afterSaleClosedCache.clear();
      sfOkCache.clear();
      sfErrCache.clear();
      return { ok: true };
    }
    packageCache.delete(pattern);
    afterSaleOpenCache.delete(pattern);
    afterSaleClosedCache.delete(pattern);
    sfOkCache.delete(pattern);
    sfErrCache.delete(pattern);
    return { ok: true };
  }

  function close() {
    persistence.close();
    if (persistTimer) clearTimeout(persistTimer);
  }

  return {
    batchCards,
    fetchPackage,
    fetchAfterSale,
    fetchSfFee,
    resolveCard,
    invalidate,
    metrics,
    close,
    sfConfigReady() {
      const partnerID = String(sf.partnerID || '').trim();
      const checkWord = String(sf.checkWord || '').trim();
      if (!partnerID || !checkWord) return false;
      if (!sf.sandbox && !String(sf.monthlyCard || '').trim()) return false;
      return true;
    },
    getLimiters() {
      return { qianfan: qianfanLimiter, sf: sfLimiter };
    },
    getSingleflights() {
      return { package: sfPackage, afterSale: sfAfterSale, sf: sfFeeFlight };
    },
    getCaches() {
      return {
        package: packageCache,
        afterSaleOpen: afterSaleOpenCache,
        afterSaleClosed: afterSaleClosedCache,
        sfOk: sfOkCache,
      };
    },
  };
}

module.exports = { createDataCore, cacheKeyPackage, cacheKeyAfterSale, cacheKeySf };
