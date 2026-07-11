/**
 * 千帆客服台 · 顺丰月结扣费内嵌 v3（轻量 batch 客户端）
 * 模板文件 — 运行 npm run build:inline 生成 inject/qf-sf-fee-inline.js
 */
(function qfSfFeeInlineV3() {
  // __QSF_CLIENT_BUNDLE_BEGIN__
  // __QSF_CLIENT_BUNDLE_END__

  const VERSION = '3.0.3';
  const STYLE_ID = 'qf-sf-fee-inline-style';
  const SCAN_DEBOUNCE_MS = 70;
  const BATCH_TIMEOUT_MS = 3000;
  const SESSION_POLL_MS = 500;
  const RENDER_CACHE_MAX = 200;

  const batchCtrl = createBatchController({ timeoutMs: BATCH_TIMEOUT_MS });
  const scanSched = createScanScheduler({
    debounceMs: SCAN_DEBOUNCE_MS,
    onScan: () => runScan(),
  });

  const renderCache = new Map();
  let sessionGeneration = 0;
  let activeSessionKey = '';
  let sessionObs = null;
  let sessionPollTimer = null;
  let orderObs = null;
  let coreOnline = null;
  let renderCount = 0;

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

  function onSessionChanged(nextKey) {
    const key = String(nextKey || '').trim();
    if (!key || key === activeSessionKey) return;
    activeSessionKey = key;
    sessionGeneration += 1;
    batchCtrl.cancelBatch();
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
      .qsf-inline-fee-wrap { margin: 4px 0 6px; font-size: 12px; line-height: 1.45; }
      .qsf-inline-fee-row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 0; }
      .qsf-inline-seg { display: inline-flex; align-items: baseline; white-space: nowrap; }
      .qsf-inline-gap { display: inline-block; width: 10px; }
      .qsf-inline-fee-label { color: #666; margin-right: 2px; }
      .qsf-inline-fee-amount { color: #1a1a1a; font-weight: 500; }
      .qsf-inline-fee-muted .qsf-inline-fee-amount { color: #888; font-weight: 400; }
      .qsf-inline-refund .qsf-inline-fee-amount { color: #c45656; }
      .qsf-inline-profit .qsf-inline-fee-amount { color: #2e7d32; }
      .qsf-inline-warn-full .qsf-inline-fee-amount { color: #d4380d; }
      .qsf-inline-fee-loading .qsf-inline-fee-amount { color: #888; }
      .qsf-inline-stale .qsf-inline-fee-amount { opacity: 0.85; }
    `;
    document.head.appendChild(style);
  }

  function isSfNo(no) {
    return /^SF\d{10,}$/i.test(String(no || '').trim());
  }

  function extractCardSnapshot(card) {
    const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    const innerText = card.innerText || '';
    const returnsId = (() => {
      const m = innerText.match(/\b(R\d{10,})\b/);
      return m ? m[1] : '';
    })();
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
    return { card, packageId, returnsId, expressNos, hasRefund: Boolean(returnsId) };
  }

  function findOrderCards() {
    const cards = [...document.querySelectorAll('.order-card, [class*="order-card"]')];
    return cards.filter((c) => c.querySelector('.order-card-title-id'));
  }

  function findQtyAndPayAnchors(card) {
    const scopes = [card.querySelector('.order-card-footer'), card].filter(Boolean);
    let qtyEl = null;
    let payEl = null;
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll('div, span, p')) {
        if (el.closest('.qsf-inline-fee-wrap')) continue;
        const t = normText(el.textContent);
        if (!t || t.length > 80) continue;
        if (/共\s*\d+\s*件/.test(t) && !/(实付|应付)/.test(t)) qtyEl = qtyEl || el;
        if (/(实付|应付)/.test(t) && (/[¥￥]/.test(t) || /\d/.test(t))) payEl = payEl || el;
      }
    }
    return { qtyEl, payEl };
  }

  function ensureFeeWrap(card) {
    let wrap = card.querySelector('.qsf-inline-fee-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'qsf-inline-fee-wrap';
      wrap.setAttribute('data-qsf-inline', VERSION);
      const { qtyEl, payEl } = findQtyAndPayAnchors(card);
      if (qtyEl && payEl && qtyEl.parentElement === payEl.parentElement) {
        const parent = qtyEl.parentElement;
        parent.insertBefore(wrap, qtyEl.compareDocumentPosition(payEl) & Node.DOCUMENT_POSITION_FOLLOWING ? payEl : qtyEl.nextSibling);
      } else if (payEl?.parentElement) {
        payEl.parentElement.insertBefore(wrap, payEl);
      } else {
        const header = card.querySelector('.order-card-header');
        if (header?.parentElement) header.parentElement.insertBefore(wrap, header.nextSibling);
        else card.appendChild(wrap);
      }
    }
    return wrap;
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
      timeout: '查询超时，稍后自动重试',
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

  function buildBlocks(item, snap) {
    const returnsId = snap?.returnsId || item?.returnsId || '';
    const showRefund = Boolean(returnsId || item?.refundApplyAmount != null);
    const blocks = [];

    let feeText = '…';
    if (item?.sfFee != null) feeText = fmtMoney(item.sfFee);
    else if (item?.errorCode === 'not_applicable') feeText = '非顺丰';
    else if (!(snap?.expressNos || []).some(isSfNo) && !item?.expressNos?.some(isSfNo)) feeText = '无物流单号';
    else if (item) feeText = stateText(item, 'sf');

    blocks.push({ label: '月结费用：', text: feeText, kind: feeText === '…' ? 'muted' : '' });

    if (showRefund) {
      let refundText = '…';
      if (item?.refundApplyAmount != null) refundText = fmtMoney(item.refundApplyAmount);
      else if (item) refundText = stateText(item, 'refund');
      blocks.push({ label: '用户申请退款金额：', text: refundText, kind: refundText === '…' ? 'muted' : 'refund' });
    }

    if (item?.profit != null && item.refundApplyAmount != null && item.sfFee != null) {
      blocks.push({ label: '', text: `赚到${fmtMoney(item.profit)}`, kind: 'profit' });
    }

    return blocks;
  }

  function paintCard(snap, item, stale) {
    const { card, packageId, hasRefund } = snap;
    if (!packageId) return;
    const wrap = ensureFeeWrap(card);
    const cached = renderCache.get(packageId);
    if (!item && cached?.blocks) {
      const r = renderCardHtml(wrap, cached.blocks, cached.stale, cached.fingerprint);
      renderCount += r.renderCount;
      return;
    }
    const blocks = item ? buildBlocks(item, snap) : [
      { label: '月结费用：', text: '…', kind: 'muted' },
      ...(hasRefund ? [{ label: '用户申请退款金额：', text: '…', kind: 'muted' }] : []),
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
      const res = await fetch(`${coreBase()}/health`, { signal: AbortSignal.timeout(1500) });
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

  async function runScan() {
    const gen = sessionGeneration;
    const cards = findOrderCards();
    const snaps = cards.map((card) => {
      const snap = extractCardSnapshot(card);
      card.__qsfSnap = snap;
      return snap;
    });
    for (const snap of snaps) {
      if (isSessionStale(gen)) return;
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
    if (isSessionStale(gen)) return;

    if (!online) {
      paintCoreOffline(snaps);
      return;
    }

    const shopKey = resolveLocalShopKey();
    const result = await batchFetch(payload, shopKey, gen);
    if (isSessionStale(gen) || !result) return;

    if (!result.ok) {
      const code = result.errorCode || 'upstream_error';
      for (const snap of snaps) {
        paintCard(snap, { errorCode: code, error: result.error || code }, false);
      }
      return;
    }

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

  function boot() {
    if (window.__qfSfFeeInline?.version === VERSION) return;
    injectStyles();
    watchSession();
    watchOrders();
    scanSched.scheduleScan(true);
    window.__qfSfFeeInline = {
      version: VERSION,
      rescan: () => scanSched.scheduleScan(true),
      syncSession: () => syncSession(),
      getStats: () => ({
        ...scanSched.getStats(),
        ...batchCtrl.getStats(),
        renderCount,
      }),
      destroy: () => {
        batchCtrl.cancelBatch();
        scanSched.clearTimer();
        if (orderObs) orderObs.disconnect();
        if (sessionObs) sessionObs.disconnect();
        if (sessionPollTimer) clearInterval(sessionPollTimer);
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
