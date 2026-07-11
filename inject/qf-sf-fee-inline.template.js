/**
 * 千帆客服台 · 顺丰月结扣费内嵌 v3（轻量 batch 客户端）
 * 模板文件 — 运行 npm run build:inline 生成 inject/qf-sf-fee-inline.js
 */
(function qfSfFeeInlineV3() {
  // __QSF_CLIENT_BUNDLE_BEGIN__
  // __QSF_CLIENT_BUNDLE_END__

  const VERSION = '3.0.6';
  const STYLE_ID = 'qf-sf-fee-inline-style';
  const SCAN_DEBOUNCE_MS = 70;
  const BATCH_TIMEOUT_MS = 45000;
  const HEALTH_PROBE_TIMEOUT_MS = 1500;
  const RETRY_DELAYS_MS = [2000, 5000, 15000];
  const RETRYABLE_CODES = new Set(['timeout', 'core_offline', 'upstream_error', 'stale', 'partial']);
  const NO_RETRY_CODES = new Set(['unknown_shop', 'shop_identity_conflict', 'auth_error', 'not_applicable']);
  const SESSION_POLL_MS = 500;
  const RENDER_CACHE_MAX = 200;
  const INSTANCE_ID = `inline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const batchCtrl = createBatchController({ timeoutMs: BATCH_TIMEOUT_MS });
  const scanSched = createScanScheduler({
    debounceMs: SCAN_DEBOUNCE_MS,
    onScan: () => runScan(),
  });

  const renderCache = new Map();
  const retryState = new Map();
  let sessionGeneration = 0;
  let activeSessionKey = '';
  let sessionObs = null;
  let sessionPollTimer = null;
  let orderObs = null;
  let coreOnline = null;
  let renderCount = 0;
  let destroyed = false;
  let lastScanAt = 0;
  let lastSuccessfulBatchAt = 0;
  let bootListener = null;

  function normText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function proxyPort() {
    return Number(window.__qfPackageProxyPort || 4725);
  }

  function coreBase() {
    return `http://127.0.0.1:${proxyPort()}`;
  }

  function shopTitle() {
    return String(document.title || '').replace(/-工作台\s*$/, '').trim();
  }

  function resolveLocalShopKey() {
    const raw = shopTitle().replace(/[-—–]\s*工作台\s*$/i, '').replace(/千帆|客服台?/g, '').replace(/\s+/g, '');
    const rows = [
      ['XY祥钰珠宝', 'xyxiangyu'], ['XY祥钰', 'xyxiangyu'],
      ['祥钰珠宝', 'xiangyu'],
      ['和田雅玉', 'hetianyayu'],
      ['拾玉居和田玉', 'shiyuju'], ['拾玉居', 'shiyuju'],
    ].sort((a, b) => b[0].length - a[0].length);
    for (const [name, key] of rows) {
      if (raw === name) return key;
    }
    return '';
  }

  function extractPageShopId() {
    const el = document.querySelector('[data-shop-id],[data-account-id],[data-seller-id]');
    if (!el) return '';
    return String(
      el.getAttribute('data-shop-id')
      || el.getAttribute('data-account-id')
      || el.getAttribute('data-seller-id')
      || '',
    ).trim();
  }

  function uidFromAppCid(appCid) {
    const s = String(appCid || '').trim();
    if (!s.startsWith('$3$')) return '';
    const rest = s.slice(3);
    const dot = rest.indexOf('.');
    if (dot < 0) return '';
    try {
      const buyerRaw = atob(rest.slice(0, dot));
      const m = buyerRaw.match(/1#2#2#([0-9a-f]+)/i);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  function getActiveSessionKey() {
    const selectors = [
      '.chat-item.active',
      '.chat-item.selected',
      '.chat-item[aria-selected="true"]',
      '[class*="chat-item"][class*="active"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const key = el.getAttribute('data-key') || '';
      const uid = uidFromAppCid(key);
      if (uid) return uid;
      if (key) return key;
    }
    const header = document.querySelector('[class*="chat-header"], [class*="conversation-header"], [class*="buyer-name"]');
    const nick = normText(header?.textContent || '');
    return nick ? `nick:${nick}` : '';
  }

  function isSessionStale(gen) {
    return gen !== sessionGeneration;
  }

  function trimRenderCache() {
    if (renderCache.size <= RENDER_CACHE_MAX) return;
    const drop = renderCache.size - RENDER_CACHE_MAX;
    const keys = renderCache.keys();
    for (let i = 0; i < drop; i++) {
      const k = keys.next().value;
      if (k == null) break;
      renderCache.delete(k);
    }
  }

  function clearRetries() {
    for (const entry of retryState.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    retryState.clear();
  }

  function onSessionChanged(nextKey) {
    const key = String(nextKey || '').trim();
    if (!key || key === activeSessionKey) return;
    activeSessionKey = key;
    sessionGeneration += 1;
    batchCtrl.cancelBatch();
    clearRetries();
    scanSched.clearTimer();
    document.querySelectorAll('.qsf-inline-fee-wrap').forEach((el) => el.remove());
    scanSched.scheduleScan(true);
  }

  function syncSession() {
    const key = getActiveSessionKey();
    if (!key) return;
    if (!activeSessionKey) {
      activeSessionKey = key;
      scanSched.scheduleScan(true);
      return;
    }
    if (key !== activeSessionKey) onSessionChanged(key);
  }

  function watchSession() {
    syncSession();
    if (sessionPollTimer) clearInterval(sessionPollTimer);
    sessionPollTimer = setInterval(syncSession, SESSION_POLL_MS);
    if (sessionObs) sessionObs.disconnect();
    const root = document.querySelector('.chat-list, .farmer-chat__left, [class*="chat-list"]') || document.body;
    sessionObs = new MutationObserver(() => syncSession());
    sessionObs.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'data-key', 'aria-selected'],
      subtree: true,
      childList: true,
    });
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .qsf-inline-fee-wrap {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        min-width: 0;
        margin: 0 10px;
        font-size: 12px;
        line-height: 1.4;
        white-space: nowrap;
        vertical-align: middle;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .qsf-inline-fee-row {
        display: inline-flex;
        align-items: center;
        flex-wrap: nowrap;
        white-space: nowrap;
      }
      .qsf-inline-seg { display: inline-flex; align-items: baseline; white-space: nowrap; }
      .qsf-inline-gap { display: inline-block; width: 8px; }
      .qsf-inline-fee-amount { color: #1a1a1a; font-weight: 500; }
      .qsf-inline-fee-muted .qsf-inline-fee-amount { color: #888; font-weight: 400; }
      .qsf-inline-refund .qsf-inline-fee-amount { color: #c45656; }
      .qsf-inline-profit .qsf-inline-fee-amount { color: #2e7d32; }
      .qsf-inline-warn .qsf-inline-fee-amount { color: #d48806; }
      .qsf-inline-warn-full .qsf-inline-fee-amount { color: #d4380d; font-weight: 600; }
      .qsf-inline-fee-loading .qsf-inline-fee-amount { color: #888; }
      .qsf-inline-stale .qsf-inline-fee-amount { opacity: 0.85; }
    `;
    document.head.appendChild(style);
  }

  function isSfNo(no) {
    return /^SF\d{10,}$/i.test(String(no || '').trim());
  }

  function detectAfterSaleFromCard(card) {
    const text = normText(card.innerText || '');
    const pipe = text.match(/(?:退货|退款)\s*\|\s*([^|]+)/);
    const statusText = pipe ? normText(pipe[1]) : '';
    const hasAfterSale = /售后中|退款中|退货待寄回|待买家寄回|待商家收货|退款成功|退款完成|售后关闭|退款信息|退货\s*\|/.test(text);
    return { hasAfterSale, statusText: statusText || (hasAfterSale ? '售后中' : '') };
  }

  function extractCardSnapshot(card) {
    const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    const innerText = card.innerText || '';
    const innerHtml = card.innerHTML || '';
    const returnsId = (() => {
      const htmlR = innerHtml.match(/\b(R\d{10,})\b/);
      if (htmlR) return htmlR[1];
      const textR = innerText.match(/\b(R\d{10,})\b/);
      return textR ? textR[1] : '';
    })();
    const afterSale = detectAfterSaleFromCard(card);
    const expressNos = (() => {
      const nos = [];
      const logistics = card.querySelector('.delivery-row-logistics, .logistics-box');
      const logisticsText = (logistics?.innerText || '').replace(/\s+/g, ' ');
      if (logisticsText) {
        const m = logisticsText.match(/\b(SF\d{10,}|[A-Z]{2,4}\d{8,})\b/i);
        if (m) nos.push(m[1].toUpperCase());
      }
      const matches = innerText.replace(/\s+/g, ' ').match(/\b(SF\d{10,}|[A-Z]{2,4}\d{8,})\b/gi) || [];
      for (const c of matches) {
        const n = c.toUpperCase();
        if (n && n !== packageId.toUpperCase() && !nos.includes(n)) nos.push(n);
      }
      return nos;
    })();
    return {
      card,
      packageId,
      returnsId,
      expressNos,
      hasAfterSale: afterSale.hasAfterSale,
      afterSaleStatus: afterSale.statusText,
      hasRefund: afterSale.hasAfterSale || Boolean(returnsId),
    };
  }

  function findOrderCards() {
    const cards = [...document.querySelectorAll('.order-card, [class*="order-card"]')];
    return cards.filter((c) => c.querySelector('.order-card-title-id'));
  }

  function fmtMoney(n) {
    if (n == null || !Number.isFinite(Number(n))) return null;
    return `${Number(n).toFixed(2)}元`;
  }

  function stateText(item, field) {
    const code = item?.errorCode || item?.state || '';
    const map = {
      loading: '查询中…',
      fresh: null,
      stale: '缓存数据，正在更新',
      not_applicable: field === 'sf' ? '非顺丰' : '无售后申请',
      not_found: '上游查不到',
      auth_error: 'Cookie 已失效',
      config_error: '顺丰月结卡未配置',
      timeout: '查询超时，正在重试…',
      core_offline: '数据核心未连接',
      unhealthy: '数据核心异常',
      upstream_error: '上游接口异常',
      unknown_shop: '店铺身份无法确认',
      shop_identity_conflict: '店铺身份冲突',
    };
    if (map[code]) return map[code];
    if (item?.error) return String(item.error);
    return '—';
  }

  function formatSfFee(item) {
    if (item?.sfFee != null) {
      const total = Number(item.sfFee).toFixed(2);
      if (item.state === 'partial' || item.sfFeeComplete === false) {
        const ok = item.sfSuccessCount ?? 0;
        const all = item.sfWaybillCount ?? ok;
        if (all > ok) return `${total}元(${ok}/${all})`;
      }
      return `${total}元`;
    }
    return null;
  }

  function buildBlocks(item, snap) {
    return buildAfterSaleBlocks(item, snap, {
      stateText,
      formatSfFee,
      isSfNo,
    });
  }

  function paintCard(snap, item, stale) {
    const { card, packageId } = snap;
    if (!packageId) return;
    const wrap = ensureFeeWrap(card, VERSION);
    ensureFeeWrapPosition(card, wrap);
    const cached = renderCache.get(packageId);
    if (!item && cached?.blocks) {
      const r = renderCardHtml(wrap, cached.blocks, cached.stale, cached.fingerprint);
      renderCount += r.renderCount;
      return;
    }
    const blocks = item ? buildBlocks(item, snap) : [
      { text: '月结查询中…', title: '顺丰月结费用：查询中…', kind: 'muted' },
      ...(snap?.hasAfterSale || snap?.hasRefund
        ? [{ text: '退款查询中…', title: '用户申请退款金额：查询中…', kind: 'muted' }]
        : []),
    ];
    const fingerprint = item ? buildRenderFingerprint(item, packageId) : `${packageId}:loading`;
    const r = renderCardHtml(wrap, blocks, stale, fingerprint);
    renderCount += r.renderCount;
    if (item) {
      renderCache.set(packageId, { blocks, at: Date.now(), stale: Boolean(stale), fingerprint });
      trimRenderCache();
    }
  }

  async function probeCore() {
    try {
      const res = await fetch(`${coreBase()}/health`, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) });
      if (!res.ok) return false;
      const body = await res.json();
      coreOnline = Boolean(body?.ok && body?.service === 'qf-sf-data-core' && body?.features?.batchCards);
      return coreOnline;
    } catch {
      coreOnline = false;
      return false;
    }
  }

  async function batchFetch(snaps, shopKey, gen) {
    const title = shopTitle();
    if (!title || !snaps.length) return null;
    const shopId = extractPageShopId();
    const cards = snaps.map((s) => ({
      packageId: s.packageId,
      returnsId: s.returnsId,
      expressNos: s.expressNos,
      hasAfterSale: s.hasAfterSale,
      afterSaleStatus: s.afterSaleStatus,
    }));
    const payload = { shopKey, shopTitle: title, cards };
    if (shopId) payload.shopId = shopId;

    return batchCtrl.runBatch(async (signal) => {
      const res = await fetch(`${coreBase()}/v1/cards/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return parseBatchResponse(res, body);
    }, gen, isSessionStale);
  }

  function scheduleRetry(packageId, gen, attempt) {
    const pid = String(packageId || '').trim();
    if (!pid || NO_RETRY_CODES.has(retryState.get(pid)?.lastCode)) return;
    const prev = retryState.get(pid);
    if (prev?.timer) clearTimeout(prev.timer);
    if (attempt >= RETRY_DELAYS_MS.length) return;
    const delay = RETRY_DELAYS_MS[attempt];
    const timer = setTimeout(() => {
      if (isSessionStale(gen)) return;
      const entry = retryState.get(pid);
      if (!entry || entry.gen !== gen) return;
      scanSched.scheduleScan(true);
    }, delay);
    retryState.set(pid, { gen, attempt: attempt + 1, timer, lastCode: prev?.lastCode || '' });
  }

  function maybeScheduleRetries(snaps, result, gen) {
    if (!result) return;
    if (result.ok) {
      for (const snap of snaps) {
        const item = result.items?.[snap.packageId];
        const errItem = result.errors?.[snap.packageId];
        if (errItem) {
          const code = errItem.errorCode || 'upstream_error';
          if (!RETRYABLE_CODES.has(code) || NO_RETRY_CODES.has(code)) continue;
          const prev = retryState.get(snap.packageId) || { attempt: 0 };
          retryState.set(snap.packageId, { ...prev, lastCode: code, gen });
          scheduleRetry(snap.packageId, gen, prev.attempt || 0);
          continue;
        }
        if (!item) continue;
        const code = item.errorCode || item.state || '';
        if (code === 'partial' || item.sfFeeComplete === false) {
          const prev = retryState.get(snap.packageId) || { attempt: 0 };
          retryState.set(snap.packageId, { ...prev, lastCode: 'partial', gen });
          scheduleRetry(snap.packageId, gen, prev.attempt || 0);
          continue;
        }
        if (code === 'fresh' || code === 'not_applicable') {
          retryState.delete(snap.packageId);
          continue;
        }
        if (!RETRYABLE_CODES.has(code)) continue;
        const prev = retryState.get(snap.packageId) || { attempt: 0 };
        retryState.set(snap.packageId, { ...prev, lastCode: code, gen });
        scheduleRetry(snap.packageId, gen, prev.attempt || 0);
      }
      return;
    }
    const code = result.errorCode || 'upstream_error';
    if (!RETRYABLE_CODES.has(code) || NO_RETRY_CODES.has(code)) return;
    const seen = new Set();
    for (const snap of snaps) {
      if (!snap.packageId || seen.has(snap.packageId)) continue;
      seen.add(snap.packageId);
      const prev = retryState.get(snap.packageId) || { attempt: 0 };
      retryState.set(snap.packageId, { ...prev, lastCode: code, gen });
      scheduleRetry(snap.packageId, gen, prev.attempt || 0);
    }
  }

  function maybeScheduleItemRetries(snaps, result, gen) {
    maybeScheduleRetries(snaps, result, gen);
  }

  async function runScan() {
    if (destroyed) return;
    lastScanAt = Date.now();
    const gen = sessionGeneration;
    const cards = findOrderCards();
    const snaps = cards.map((card) => {
      const snap = extractCardSnapshot(card);
      card.__qsfSnap = snap;
      return snap;
    });
    for (const snap of snaps) {
      if (isSessionStale(gen) || destroyed) return;
      paintCard(snap, null, false);
    }
    if (!snaps.length) return;

    const payload = [];
    const seen = new Set();
    for (const snap of snaps) {
      if (!snap.packageId || seen.has(snap.packageId)) continue;
      seen.add(snap.packageId);
      payload.push(snap);
    }

    const online = await probeCore();
    if (isSessionStale(gen) || destroyed) return;

    if (!online) {
      paintCoreOffline(snaps);
      maybeScheduleRetries(snaps, { ok: false, errorCode: 'core_offline' }, gen);
      return;
    }

    const shopKey = resolveLocalShopKey();
    const result = await batchFetch(payload, shopKey, gen);
    if (isSessionStale(gen) || destroyed || !result) return;

    if (!result.ok) {
      const code = result.errorCode || 'upstream_error';
      for (const snap of snaps) {
        paintCard(snap, { errorCode: code, error: result.error || code }, false);
      }
      maybeScheduleRetries(snaps, result, gen);
      return;
    }

    lastSuccessfulBatchAt = Date.now();
    maybeScheduleItemRetries(snaps, result, gen);

    for (const snap of snaps) {
      const item = result.items?.[snap.packageId] || result.errors?.[snap.packageId];
      if (!item) continue;
      const stale = item.state === 'stale' || item.stale;
      paintCard(snap, item, stale);
    }
  }

  function paintCoreOffline(snaps) {
    for (const snap of snaps) {
      paintCard(snap, { errorCode: 'core_offline', error: '数据核心未连接' }, false);
    }
  }

  function watchOrders() {
    const root = document.querySelector('.chat-content, .farmer-chat__right, [class*="message-list"]') || document.body;
    if (orderObs) orderObs.disconnect();
    orderObs = new MutationObserver((mutations) => scanSched.handleMutations(mutations));
    orderObs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function destroy() {
    destroyed = true;
    batchCtrl.cancelBatch();
    clearRetries();
    scanSched.clearTimer();
    if (orderObs) {
      orderObs.disconnect();
      orderObs = null;
    }
    if (sessionObs) {
      sessionObs.disconnect();
      sessionObs = null;
    }
    if (sessionPollTimer) {
      clearInterval(sessionPollTimer);
      sessionPollTimer = null;
    }
    if (bootListener) {
      document.removeEventListener('DOMContentLoaded', bootListener);
      bootListener = null;
    }
    document.querySelectorAll('.qsf-inline-fee-wrap').forEach((el) => el.remove());
    document.getElementById(STYLE_ID)?.remove();
    if (window.__qfSfFeeInline?.instanceId === INSTANCE_ID) {
      delete window.__qfSfFeeInline;
    }
  }

  function health() {
    return {
      alive: !destroyed && window.__qfSfFeeInline?.instanceId === INSTANCE_ID,
      instanceId: INSTANCE_ID,
      version: VERSION,
      lastScanAt,
      lastSuccessfulBatchAt,
      sessionPolling: Boolean(sessionPollTimer),
      orderObserverActive: Boolean(orderObs),
      sessionObserverActive: Boolean(sessionObs),
      retryCount: retryState.size,
    };
  }

  function compareSemverLocal(a, b) {
    const pa = String(a || '0').split('.').map((n) => Number(n) || 0);
    const pb = String(b || '0').split('.').map((n) => Number(n) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function boot() {
    const existing = window.__qfSfFeeInline;
    if (existing) {
      const existingHealth = typeof existing.health === 'function' ? existing.health() : null;
      const cmp = compareSemverLocal(VERSION, existing.version || '0');
      if (cmp < 0) return;
      if (cmp === 0 && existingHealth?.alive) return;
      if (typeof existing.destroy === 'function') existing.destroy();
      else if (typeof existing.teardown === 'function') existing.teardown();
    }
    destroyed = false;
    injectStyles();
    watchSession();
    watchOrders();
    scanSched.scheduleScan(true);
    window.__qfSfFeeInline = {
      version: VERSION,
      instanceId: INSTANCE_ID,
      rescan: () => scanSched.scheduleScan(true),
      syncSession: () => syncSession(),
      getStats: () => ({
        ...scanSched.getStats(),
        ...batchCtrl.getStats(),
        renderCount,
        health: health(),
      }),
      health,
      destroy,
      teardown: destroy,
    };
  }

  if (document.readyState === 'loading') {
    bootListener = boot;
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
