/**
 * 千帆客服台 · 顺丰月结扣费内嵌 v3（轻量 batch 客户端）
 */
(function qfSfFeeInlineV3() {
  const VERSION = '3.0.0';
  const STYLE_ID = 'qf-sf-fee-inline-style';
  const SCAN_DEBOUNCE_MS = 70;
  const BATCH_TIMEOUT_MS = 3000;
  const RENDER_CACHE_MAX = 200;
  const CORE_MODE = String(window.__qfDataCoreMode || 'prefer-core');

  const renderCache = new Map();
  let scanTimer = null;
  let batchAbort = null;
  let sessionGeneration = 0;
  let activeSessionKey = '';
  let sessionObs = null;
  let sessionPollTimer = null;
  let orderObs = null;
  let coreOnline = null;

  function normText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
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

  function cancelBatch() {
    if (batchAbort) {
      batchAbort.abort();
      batchAbort = null;
    }
  }

  function onSessionChanged(nextKey) {
    const key = String(nextKey || '').trim();
    if (!key || key === activeSessionKey) return;
    activeSessionKey = key;
    sessionGeneration += 1;
    cancelBatch();
    clearTimeout(scanTimer);
    scanTimer = null;
    document.querySelectorAll('.qsf-inline-fee-wrap').forEach((el) => el.remove());
    scheduleScan(true);
  }

  function syncSession() {
    const key = getActiveSessionKey();
    if (!key) return;
    if (!activeSessionKey) {
      activeSessionKey = key;
      scheduleScan(true);
      return;
    }
    if (key !== activeSessionKey) onSessionChanged(key);
  }

  function watchSession() {
    syncSession();
    if (sessionPollTimer) clearInterval(sessionPollTimer);
    sessionPollTimer = setInterval(syncSession, 250);
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

  function extractReturnsId(card) {
    if (!card) return '';
    const text = card.innerText || '';
    const m = text.match(/\b(R\d{10,})\b/);
    return m ? m[1] : '';
  }

  function extractExpressNos(card) {
    const nos = [];
    const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    const logistics = card.querySelector('.delivery-row-logistics, .logistics-box');
    const logisticsText = (logistics?.innerText || '').replace(/\s+/g, ' ');
    if (logisticsText) {
      const m = logisticsText.match(/\b(SF\d{10,}|[A-Z]{2,4}\d{8,})\b/i);
      if (m) nos.push(m[1].toUpperCase());
    }
    const cardText = (card.innerText || '').replace(/\s+/g, ' ');
    const matches = cardText.match(/\b(SF\d{10,}|[A-Z]{2,4}\d{8,})\b/gi) || [];
    for (const c of matches) {
      const n = c.toUpperCase();
      if (n && n !== packageId.toUpperCase() && !nos.includes(n)) nos.push(n);
    }
    return nos;
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
      upstream_error: '上游接口异常',
      unknown: '无法识别',
    };
    if (map[code]) return map[code];
    if (item?.error) return String(item.error);
    return '—';
  }

  function buildBlocks(item, card) {
    const returnsId = extractReturnsId(card);
    const showRefund = Boolean(returnsId || item?.returnsId || item?.refundApplyAmount != null);
    const blocks = [];

    let feeText = '…';
    if (item?.sfFee != null) feeText = fmtMoney(item.sfFee);
    else if (item?.errorCode === 'not_applicable') feeText = '非顺丰';
    else if (!extractExpressNos(card).some(isSfNo) && !item?.expressNos?.some(isSfNo)) feeText = '无物流单号';
    else if (item) feeText = stateText(item, 'sf');

    blocks.push({
      label: '月结费用：',
      text: feeText,
      kind: feeText === '…' ? 'muted' : '',
    });

    if (showRefund) {
      let refundText = '…';
      if (item?.refundApplyAmount != null) refundText = fmtMoney(item.refundApplyAmount);
      else if (item) refundText = stateText(item, 'refund');
      blocks.push({
        label: '用户申请退款金额：',
        text: refundText,
        kind: refundText === '…' ? 'muted' : 'refund',
      });
    }

    if (item?.profit != null && item.refundApplyAmount != null && item.sfFee != null) {
      blocks.push({
        label: '',
        text: `赚到${fmtMoney(item.profit)}`,
        kind: 'profit',
      });
    }

    return blocks;
  }

  function renderCardInfo(wrap, blocks, stale) {
    if (!wrap || !blocks?.length) return;
    const rowCls = [
      'qsf-inline-fee-row',
      blocks.some((b) => b.text === '…') ? 'qsf-inline-fee-loading' : '',
      stale ? 'qsf-inline-stale' : '',
    ].filter(Boolean).join(' ');
    const segs = blocks.map((block) => {
      const segCls = [
        'qsf-inline-seg',
        block.kind === 'muted' ? 'qsf-inline-fee-muted' : '',
        block.kind === 'refund' ? 'qsf-inline-refund' : '',
        block.kind === 'profit' ? 'qsf-inline-profit' : '',
      ].filter(Boolean).join(' ');
      if (block.kind === 'profit' || !block.label) {
        return `<span class="${segCls}"><span class="qsf-inline-fee-amount">${esc(block.text)}</span></span>`;
      }
      return `<span class="${segCls}"><span class="qsf-inline-fee-label">${esc(block.label)}</span><span class="qsf-inline-fee-amount">${esc(block.text)}</span></span>`;
    }).join('<span class="qsf-inline-gap"></span>');
    wrap.innerHTML = `<div class="${rowCls}">${segs}</div>`;
  }

  function paintCard(card, item, stale) {
    const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    if (!packageId) return;
    const wrap = ensureFeeWrap(card);
    const cached = renderCache.get(packageId);
    if (!item && cached?.blocks) {
      renderCardInfo(wrap, cached.blocks, cached.stale);
      return;
    }
    const blocks = item ? buildBlocks(item, card) : [
      { label: '月结费用：', text: '…', kind: 'muted' },
      ...(extractReturnsId(card) ? [{ label: '用户申请退款金额：', text: '…', kind: 'muted' }] : []),
    ];
    renderCardInfo(wrap, blocks, stale);
    if (item) {
      renderCache.set(packageId, { blocks, at: Date.now(), stale: Boolean(stale) });
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

  async function batchFetch(cards, gen) {
    const title = shopTitle();
    if (!title || !cards.length) return null;
    cancelBatch();
    batchAbort = new AbortController();
    const timer = setTimeout(() => batchAbort.abort(), BATCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${coreBase()}/v1/cards/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopTitle: title, cards }),
        signal: batchAbort.signal,
      });
      if (isSessionStale(gen)) return null;
      if (!res.ok) return { error: `HTTP ${res.status}`, errorCode: 'upstream_error' };
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        return isSessionStale(gen) ? null : { error: '查询超时', errorCode: 'timeout' };
      }
      return { error: String(err.message || err), errorCode: 'core_offline' };
    } finally {
      clearTimeout(timer);
      batchAbort = null;
    }
  }

  async function runScan() {
    const gen = sessionGeneration;
    const cards = findOrderCards();
    for (const card of cards) {
      if (isSessionStale(gen)) return;
      paintCard(card, null, false);
    }
    if (!cards.length) return;

    const payload = [];
    const seen = new Set();
    for (const card of cards) {
      const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      if (!packageId || seen.has(packageId)) continue;
      seen.add(packageId);
      payload.push({
        packageId,
        returnsId: extractReturnsId(card),
        expressNos: extractExpressNos(card),
      });
    }

    const online = await probeCore();
    if (isSessionStale(gen)) return;

    if (!online && CORE_MODE === 'legacy-only') {
      paintCoreOffline(cards);
      return;
    }
    if (!online) {
      paintCoreOffline(cards);
      return;
    }

    const result = await batchFetch(payload, gen);
    if (isSessionStale(gen) || !result) return;

    if (!result.ok) {
      for (const card of cards) {
        paintCard(card, { errorCode: result.errorCode || 'upstream_error', error: result.error }, false);
      }
      return;
    }

    for (const card of cards) {
      const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      const item = result.items?.[packageId] || result.errors?.[packageId];
      if (!item) continue;
      const stale = item.state === 'stale' || item.stale;
      paintCard(card, item, stale);
    }
  }

  function paintCoreOffline(cards) {
    for (const card of cards) {
      paintCard(card, { errorCode: 'core_offline', error: '数据核心未连接' }, false);
    }
  }

  function scheduleScan(immediate) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      runScan().catch(() => {});
    }, immediate ? 0 : SCAN_DEBOUNCE_MS);
  }

  function watchOrders() {
    const root = document.querySelector('.chat-content, .farmer-chat__right, [class*="message-list"]') || document.body;
    if (orderObs) orderObs.disconnect();
    orderObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList' || (m.type === 'attributes' && m.target?.closest?.('.order-card'))) {
          scheduleScan(false);
          return;
        }
      }
    });
    orderObs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function boot() {
    if (window.__qfSfFeeInline?.version === VERSION) return;
    injectStyles();
    watchSession();
    watchOrders();
    scheduleScan(true);
    window.__qfSfFeeInline = {
      version: VERSION,
      rescan: () => scheduleScan(true),
      syncSession: () => syncSession(),
      destroy: () => {
        cancelBatch();
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
