/**
 * 千帆客服台 · 顺丰月结运费侧栏（页面注入脚本）
 * 由 src/auto-inject.js 通过 CDP 自动注入，无需手动粘贴。
 * 丰桥凭证：config.json → sf.partnerID / sf.checkWord（或侧栏 ⚙ 一次）
 */
(function qfSfFeePanelBootstrap() {
  const VERSION = '1.0.83';
  const BUYER_CACHE_TTL_MS = 45 * 60 * 1000;
  const SF_ERR_CACHE_TTL_MS = 30 * 60 * 1000;
  const PKG_DETAIL_COOLDOWN_MS = 8000;
  const PKG_PREFETCH_CONCURRENCY = 2;
  const BACKGROUND_REVALIDATE_MS = 90 * 1000;
  const MIN_REFRESH_GAP_MS = 2000;
  const SESSION_POLL_MS = 6000;
  const HEADER_ATTACH_POLL_MS = 8000;
  const INGEST_BATCH_MAX = 4;
  const PANEL_PINNED_KEY = 'qsf_panel_pinned_v1';
  const AFTER_SALE_WINDOW_DAYS = 7;
  const DEFAULT_SHIPPING_DEDUCT_YUAN = 18;
  const PANEL_DOCK_WIDTH = 300;
  const PAGE_DOCK_CLASS = 'qsf-page-docked';
  const APP_SHELL_SELECTORS = [
    '#app',
    '#root',
    '.app',
    '.app-wrapper',
    '.farmer-chat',
    '.farmer-chat__wrap',
    '.farmer-chat__main',
    '[class*="layout-container"]',
    '[class*="main-layout"]',
    '[class*="page-container"]',
  ];
  const ICON_POS_KEY = 'qsf_icon_pos_v1';
  const STORAGE_KEY = 'qf_sf_fee_config_v1';
  const BUYER_CACHE_KEY = 'qsf_buyer_panel_v1';
  const MAX_BUYER_CACHE = 80;
  const SF_PROD = 'https://sfapi.sf-express.com/std/service';
  const SF_SBOX = 'https://sfapi-sbox.sf-express.com/std/service';
  const PANEL_ID = 'qf-sf-fee-panel-root';

  let activateTimer = null;
  let buyerRefreshTimer = null;
  let sessionActivateTimer = null;
  let messageListTimer = null;
  let activationGeneration = 0;
  let headerSyncTimer = null;
  let lastActivatedBuyerId = '';
  let lastSeenHeaderNick = '';
  let sessionPollTimer = null;
  let pendingRefreshOpts = null;
  let dockGuardTimer = null;
  let backgroundRevalidateTimer = null;
  let partialLoadRetryTimer = null;
  let refundPatchTimer = null;
  let lastRenderedCardRows = [];
  let ingestQueue = [];
  let ingestFlushTimer = null;
  let lastHeaderNickRefreshAt = 0;
  let lastClickedChatAppCid = '';
  let lastClickedChatAt = 0;
  let lastBuyerActivateAt = 0;
  let orderPanelWatchTimer = null;
  const lastBackgroundRefreshAt = new Map();
  const packageDetailInflight = new Map();
  const packageDetailFetchedAt = new Map();

  const SHOP_MATCH_ROWS = [
    { shopKey: 'xyxiangyu', matchNames: ['XY祥钰珠宝', 'XY祥钰', 'xy祥钰'] },
    { shopKey: 'xiangyu', matchNames: ['祥钰珠宝'] },
    { shopKey: 'hetianyayu', matchNames: ['和田雅玉'] },
    { shopKey: 'shiyuju', matchNames: ['拾玉居和田玉', '拾玉居'] },
  ];

  function resolveShopKeyFromPageTitle(pageTitle, rows) {
    const title = String(pageTitle || '').replace(/-工作台\s*$/, '').trim();
    if (!title) return '';
    let bestKey = '';
    let bestLen = 0;
    for (const row of rows) {
      for (const name of row.matchNames) {
        const n = String(name || '').trim();
        if (!n) continue;
        if (title !== n && !title.includes(n)) continue;
        if (n.length > bestLen) {
          bestLen = n.length;
          bestKey = row.shopKey;
        }
      }
    }
    return bestKey;
  }

  function detectCurrentShopKey() {
    return resolveShopKeyFromPageTitle(document.title, SHOP_MATCH_ROWS);
  }

  function getPackageProxyBase() {
    const port = Number(window.__qfPackageProxyPort || 4725);
    return `http://127.0.0.1:${port}`;
  }

  function qsfEnsureFooter() {
    try {
      const root = document.getElementById(PANEL_ID);
      const shell = root?.querySelector('.qsf-shell');
      if (!shell) return;
      let foot = shell.querySelector(':scope > .qsf-foot');
      if (!foot) {
        foot = document.createElement('div');
        foot.className = 'qsf-foot';
        shell.appendChild(foot);
      }
      let ver = foot.querySelector('.qsf-ver');
      if (!ver) {
        ver = document.createElement('span');
        ver.className = 'qsf-ver';
        foot.appendChild(ver);
      }
      ver.textContent = `v${VERSION}`;
    } catch {
      /* ignore */
    }
  }

  function patchAllVersionLabels() {
    try {
      const root = document.getElementById(PANEL_ID);
      if (!root) return;
      qsfEnsureFooter();
      root.querySelectorAll('.qsf-ver').forEach((el) => {
        el.textContent = `v${VERSION}`;
      });
      root.querySelectorAll('.qsf-footer-meta').forEach((el) => {
        const text = String(el.textContent || '');
        if (/\bv\d+\.\d+\.\d+\b/.test(text)) {
          el.textContent = text.replace(/\bv\d+\.\d+\.\d+\b/g, `v${VERSION}`);
        }
      });
    } catch {
      /* ignore */
    }
  }

  function isPanelRuntimeFresh() {
    const prev = window.__qfSfFeePanel;
    if (!prev || prev.version !== VERSION) return false;
    if (typeof prev.syncSession !== 'function') return false;
    if (typeof prev.patchVersionLabels !== 'function') return false;
    const foot = document.getElementById(PANEL_ID)?.querySelector('.qsf-ver');
    if (foot && foot.textContent.trim() !== `v${VERSION}`) return false;
    return true;
  }

  if (isPanelRuntimeFresh()) {
    console.log('[顺丰运费] 已加载，版本', window.__qfSfFeePanel.version);
    injectStyles();
    ensurePanelOnDocumentRoot();
    qsfEnsureFooter();
    patchAllVersionLabels();
    restorePinnedPanelState(false);
    syncPageDockLayout(document.getElementById(PANEL_ID)?.classList.contains('qsf-expanded'));
    if (!document.getElementById(PANEL_ID)) {
      delete window.__qfSfFeePanel;
    } else {
      window.__qfSfFeePanel.syncSession();
      const root = document.getElementById(PANEL_ID);
      if (root?.classList.contains('qsf-expanded') && root.querySelector('.qsf-body')) {
        const ab = window.__qfSfFeePanel.getActiveBuyer?.();
        if (!ab?.buyerUserId) {
          root.querySelector('.qsf-body').innerHTML = '<div class="qsf-empty">请在左侧点击一个买家会话，或通过浏览器插件跳转到买家后再展开侧栏</div>';
        }
      }
      return;
    }
  } else if (window.__qfSfFeePanel?.version) {
    try { window.__qfSfFeePanel.teardown?.(); } catch { /* ignore */ }
    delete window.__qfSfFeePanel;
    unhookNetApis();
  }
  if (window.__qfSfFeePanel) {
    try {
      window.__qfSfFeePanel.teardown?.();
      document.getElementById(PANEL_ID)?.remove();
      document.getElementById('qf-sf-fee-panel-style')?.remove();
    } catch {
      /* ignore */
    }
    delete window.__qfSfFeePanel;
    unhookNetApis();
  }

  function unhookNetApis() {
    try {
      if (window.__qfSfFeeNativeFetch) window.fetch = window.__qfSfFeeNativeFetch;
      if (window.__qfSfFeeNativeXhrOpen) XMLHttpRequest.prototype.open = window.__qfSfFeeNativeXhrOpen;
      if (window.__qfSfFeeNativeXhrSend) XMLHttpRequest.prototype.send = window.__qfSfFeeNativeXhrSend;
    } catch {
      /* ignore */
    }
    delete window.__qfSfFeeFetchHooked;
    delete window.__qfSfFeeXhrHooked;
  }

  function teardownPanel() {
    try {
      if (window.__qfSfChatClickHandler) {
        document.removeEventListener('click', window.__qfSfChatClickHandler, true);
        delete window.__qfSfChatClickHandler;
      }
      if (window.__qfSfFeeChatObs) {
        window.__qfSfFeeChatObs.disconnect();
        delete window.__qfSfFeeChatObs;
      }
      if (window.__qfSfHeaderObs) {
        window.__qfSfHeaderObs.disconnect();
        delete window.__qfSfHeaderObs;
      }
      if (headerSyncTimer) {
        clearInterval(headerSyncTimer);
        headerSyncTimer = null;
      }
      if (sessionPollTimer) {
        clearInterval(sessionPollTimer);
        sessionPollTimer = null;
      }
      if (dockGuardTimer) {
        clearInterval(dockGuardTimer);
        dockGuardTimer = null;
      }
      clearTimeout(activateTimer);
      clearTimeout(buyerRefreshTimer);
      clearTimeout(sessionActivateTimer);
      clearTimeout(messageListTimer);
      messageListTimer = null;
      activationGeneration++;
      if (window.__qsfBrowserJumpCleanup) {
        window.__qsfBrowserJumpCleanup();
      }
      clearTimeout(backgroundRevalidateTimer);
      backgroundRevalidateTimer = null;
      clearTimeout(partialLoadRetryTimer);
      partialLoadRetryTimer = null;
      clearTimeout(refundPatchTimer);
      refundPatchTimer = null;
      clearTimeout(scrollSettleTimer);
      scrollSettleTimer = null;
      scrollSettleQueue.clear();
      lastOrderListPatchSig = '';
      clearTimeout(orderPanelWatchTimer);
      orderPanelWatchTimer = null;
      clearTimeout(ingestFlushTimer);
      ingestFlushTimer = null;
      ingestQueue = [];
      if (window.__qfSfLauncherDragCleanup) {
        window.__qfSfLauncherDragCleanup();
        delete window.__qfSfLauncherDragCleanup;
      }
      syncPageDockLayout(false);
      unhookNetApis();
    } catch {
      /* ignore */
    }
  }

  // ─── MD5（丰桥 msgDigest，须与 Node crypto 一致） ─────────────────
  function md5Bytes(str) {
    function cmn(q, a, b, x, s, t) {
      a = (a + q + x + t) | 0;
      return (((a << s) | (a >>> (32 - s))) + b) | 0;
    }
    function ff(a, b, c, d, x, s, t) {
      return cmn((b & c) | (~b & d), a, b, x, s, t);
    }
    function gg(a, b, c, d, x, s, t) {
      return cmn((b & d) | (c & ~d), a, b, x, s, t);
    }
    function hh(a, b, c, d, x, s, t) {
      return cmn(b ^ c ^ d, a, b, x, s, t);
    }
    function ii(a, b, c, d, x, s, t) {
      return cmn(c ^ (b | ~d), a, b, x, s, t);
    }
    const state = [1732584193, -271733879, -1732584194, 271733878];
    const bytes = new TextEncoder().encode(String(str));
    const bitLen = bytes.length * 8;
    const withOne = bytes.length + 1;
    const padLen = withOne % 64 <= 56 ? 56 - (withOne % 64) : 120 - (withOne % 64);
    const total = withOne + padLen + 8;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[bytes.length] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 8, bitLen, true);
    view.setUint32(total - 4, Math.floor(bitLen / 0x100000000), true);
    for (let off = 0; off < total; off += 64) {
      const rest = [];
      for (let i = 0; i < 16; i++) rest[i] = view.getUint32(off + i * 4, true);
      let a = state[0];
      let b = state[1];
      let c = state[2];
      let d = state[3];
      a = ff(a, b, c, d, rest[0], 7, -680876936);
      d = ff(d, a, b, c, rest[1], 12, -389564586);
      c = ff(c, d, a, b, rest[2], 17, 606105819);
      b = ff(b, c, d, a, rest[3], 22, -1044525330);
      a = ff(a, b, c, d, rest[4], 7, -176418897);
      d = ff(d, a, b, c, rest[5], 12, 1200080426);
      c = ff(c, d, a, b, rest[6], 17, -1473231341);
      b = ff(b, c, d, a, rest[7], 22, -45705983);
      a = ff(a, b, c, d, rest[8], 7, 1770035416);
      d = ff(d, a, b, c, rest[9], 12, -1958414417);
      c = ff(c, d, a, b, rest[10], 17, -42063);
      b = ff(b, c, d, a, rest[11], 22, -1990404162);
      a = ff(a, b, c, d, rest[12], 7, 1804603682);
      d = ff(d, a, b, c, rest[13], 12, -40341101);
      c = ff(c, d, a, b, rest[14], 17, -1502002290);
      b = ff(b, c, d, a, rest[15], 22, 1236535329);
      a = gg(a, b, c, d, rest[1], 5, -165796510);
      d = gg(d, a, b, c, rest[6], 9, -1069501632);
      c = gg(c, d, a, b, rest[11], 14, 643717713);
      b = gg(b, c, d, a, rest[0], 20, -373897302);
      a = gg(a, b, c, d, rest[5], 5, -701558691);
      d = gg(d, a, b, c, rest[10], 9, 38016083);
      c = gg(c, d, a, b, rest[15], 14, -660478335);
      b = gg(b, c, d, a, rest[4], 20, -405537848);
      a = gg(a, b, c, d, rest[9], 5, 568446438);
      d = gg(d, a, b, c, rest[14], 9, -1019803690);
      c = gg(c, d, a, b, rest[3], 14, -187363961);
      b = gg(b, c, d, a, rest[8], 20, 1163531501);
      a = gg(a, b, c, d, rest[13], 5, -1444681467);
      d = gg(d, a, b, c, rest[2], 9, -51403784);
      c = gg(c, d, a, b, rest[7], 14, 1735328473);
      b = gg(b, c, d, a, rest[12], 20, -1926607734);
      a = hh(a, b, c, d, rest[5], 4, -378558);
      d = hh(d, a, b, c, rest[8], 11, -2022574463);
      c = hh(c, d, a, b, rest[11], 16, 1839030562);
      b = hh(b, c, d, a, rest[14], 23, -35309556);
      a = hh(a, b, c, d, rest[1], 4, -1530992060);
      d = hh(d, a, b, c, rest[4], 11, 1272893353);
      c = hh(c, d, a, b, rest[7], 16, -155497632);
      b = hh(b, c, d, a, rest[10], 23, -1094730640);
      a = hh(a, b, c, d, rest[13], 4, 681279174);
      d = hh(d, a, b, c, rest[0], 11, -358537222);
      c = hh(c, d, a, b, rest[3], 16, -722521979);
      b = hh(b, c, d, a, rest[6], 23, 76029189);
      a = hh(a, b, c, d, rest[9], 4, -640364487);
      d = hh(d, a, b, c, rest[12], 11, -421815835);
      c = hh(c, d, a, b, rest[15], 16, 530742520);
      b = hh(b, c, d, a, rest[2], 23, -995338651);
      a = ii(a, b, c, d, rest[0], 6, -198630844);
      d = ii(d, a, b, c, rest[7], 10, 1126891415);
      c = ii(c, d, a, b, rest[14], 15, -1416354905);
      b = ii(b, c, d, a, rest[5], 21, -57434055);
      a = ii(a, b, c, d, rest[12], 6, 1700485571);
      d = ii(d, a, b, c, rest[3], 10, -1894986606);
      c = ii(c, d, a, b, rest[10], 15, -1051523);
      b = ii(b, c, d, a, rest[1], 21, -2054922799);
      a = ii(a, b, c, d, rest[8], 6, 1873313359);
      d = ii(d, a, b, c, rest[15], 10, -30611744);
      c = ii(c, d, a, b, rest[6], 15, -1560198380);
      b = ii(b, c, d, a, rest[13], 21, 1309151649);
      a = ii(a, b, c, d, rest[4], 6, -145523070);
      d = ii(d, a, b, c, rest[11], 10, -1120210379);
      c = ii(c, d, a, b, rest[2], 15, 718787259);
      b = ii(b, c, d, a, rest[9], 21, -343485551);
      state[0] = (state[0] + a) | 0;
      state[1] = (state[1] + b) | 0;
      state[2] = (state[2] + c) | 0;
      state[3] = (state[3] + d) | 0;
    }
    const out = new Uint8Array(16);
    for (let k = 0; k < 4; k++) {
      out[k * 4] = state[k] & 255;
      out[k * 4 + 1] = (state[k] >> 8) & 255;
      out[k * 4 + 2] = (state[k] >> 16) & 255;
      out[k * 4 + 3] = (state[k] >> 24) & 255;
    }
    return out;
  }

  function sfMsgDigest(msgData, timestamp, checkWord) {
    const raw = String(msgData) + String(timestamp) + String(checkWord);
    const bytes = md5Bytes(raw);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function resolveCheckWord(cfg) {
    if (cfg.sandbox) return String(cfg.checkWordSandbox || '').trim();
    return String(cfg.checkWord || '').trim();
  }

  // ─── 工具 ───────────────────────────────────────────────────────────
  function readStoredConfigRaw() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function applyPresetConfig() {
    const preset = window.__qfSfFeePreset;
    if (!preset || typeof preset !== 'object') return;
    const prev = readStoredConfigRaw();
    const merged = {
      partnerID: '',
      checkWord: '',
      checkWordSandbox: '',
      sandbox: false,
      phoneLast4: '',
      monthlyCard: '',
      shippingDeductYuan: DEFAULT_SHIPPING_DEDUCT_YUAN,
      ...prev,
      ...preset,
    };
    Object.keys(preset).forEach((k) => {
      merged[k] = preset[k];
    });
    merged.sandbox = Boolean(preset.sandbox);
    const changed = ['partnerID', 'checkWord', 'checkWordSandbox', 'monthlyCard', 'sandbox', 'phoneLast4']
      .some((k) => String(prev[k] ?? '') !== String(merged[k] ?? ''));
    saveConfig(merged);
    if (changed) {
      expressCache.clear();
      clearBuyerPanelCache();
    }
  }

  function loadConfig() {
    applyPresetConfig();
    try {
      return { partnerID: '', checkWord: '', checkWordSandbox: '', sandbox: false, phoneLast4: '', monthlyCard: '', shippingDeductYuan: DEFAULT_SHIPPING_DEDUCT_YUAN, ...readStoredConfigRaw() };
    } catch {
      return { partnerID: '', checkWord: '', checkWordSandbox: '', sandbox: false, phoneLast4: '', monthlyCard: '', shippingDeductYuan: DEFAULT_SHIPPING_DEDUCT_YUAN };
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
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

  function getAppCidFromEl(el) {
    if (!el) return '';
    return (
      el.getAttribute('data-key') ||
      el.getAttribute('data-app-cid') ||
      el.getAttribute('data-appcid') ||
      el.getAttribute('data-cid') ||
      (el.dataset && (el.dataset.key || el.dataset.appCid || el.dataset.appcid || el.dataset.cid)) ||
      ''
    );
  }

  function nickFromChatItem(el) {
    const t = (el?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const m = t.match(/^(.+?)(\d{1,2}:\d{2}(:\d{2})?|\d{2}\/\d{2})/);
    let nick = m ? m[1].trim() : t.split(' ')[0] || '';
    nick = nick.replace(/\b[0-9a-f]{20,32}\b/gi, '').replace(/\s+/g, ' ').trim();
    return cleanBuyerNick(nick);
  }

  function normPanelText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function cleanBuyerNick(raw) {
    let nick = normPanelText(raw);
    if (!nick) return '';
    nick = nick.replace(/点击添加备注.*$/i, '').trim();
    nick = nick.replace(/老客.*$/i, '').trim();
    nick = nick.replace(/共消费.*$/i, '').trim();
    nick = nick.replace(/已等待\d+秒.*$/i, '').trim();
    nick = nick.replace(/^\d+(?=[\u4e00-\u9fa5A-Za-z])/, '').trim();
    return nick.slice(0, 40);
  }

  function scrapeHeaderBuyerNick() {
    const ui = document.querySelector('.user-info-detail, .user-info');
    if (!ui) return '';
    return cleanBuyerNick(ui.textContent);
  }

  function findSessionRowElements() {
    if (Date.now() - sessionRowCache.at < SESSION_ROW_CACHE_MS && sessionRowCache.rows.length) {
      return sessionRowCache.rows;
    }
    const seen = new Set();
    const out = [];
    const add = (el) => {
      if (!el || seen.has(el)) return;
      const appCid = getAppCidFromEl(el);
      if (!appCid) return;
      seen.add(el);
      out.push(el);
    };
    document.querySelectorAll('.chat-item, [class*="chat-item"]').forEach(add);
    document.querySelectorAll('[data-key^="$3$"], [data-app-cid^="$3$"], [data-appcid^="$3$"]').forEach(add);
    document.querySelectorAll('[class*="search"] [class*="item"], [class*="session"][class*="item"], [class*="result"][class*="item"]').forEach(add);
    sessionRowCache = { at: Date.now(), rows: out };
    return out;
  }

  function findChatItemByNick(buyerNick) {
    const nick = normPanelText(buyerNick);
    if (!nick) return null;
    const items = findSessionRowElements();
    const exact = items.find((el) => nickFromChatItem(el) === nick);
    if (exact) return exact;
    const fuzzy = items.filter((el) => {
      const itemNick = nickFromChatItem(el);
      if (!itemNick || itemNick.length < 2) return false;
      return itemNick.startsWith(nick) || nick.startsWith(itemNick) || nicksRoughlyMatch(itemNick, nick);
    });
    if (fuzzy.length === 1) return fuzzy[0];
    return null;
  }

  const ACTIVE_CHAT_SELECTORS = [
    '.chat-item.active',
    '.chat-item.selected',
    '.chat-item.current',
    '.chat-item.is-active',
    '.chat-item[aria-selected="true"]',
    '.chat-item[aria-current="true"]',
    '[class*="chat-item"][class*="active"]',
    '[class*="chat-item"][class*="selected"]',
    '[class*="chat-item"][class*="current"]',
    '[class*="search"][class*="item"][class*="active"]',
    '[class*="search"][class*="item"][aria-selected="true"]',
    '[class*="session"][class*="item"][class*="active"]',
    '[class*="session"][class*="item"][aria-selected="true"]',
    '[class*="result"][class*="item"][class*="active"]',
    '[data-key^="$3$"][aria-selected="true"]',
    '[data-key^="$3$"].active',
    '[data-key^="$3$"].selected',
  ];

  function nicksRoughlyMatch(a, b) {
    const x = normPanelText(a);
    const y = normPanelText(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.startsWith(y) || y.startsWith(x)) return true;
    return false;
  }

  function resolveDisplayNick(fallbackNick, cachedNick) {
    return scrapeHeaderBuyerNick() || fallbackNick || cachedNick || '';
  }

  function cacheMatchesCurrentSession(cached, buyerUserId) {
    if (!cached) return false;
    const uid = String(buyerUserId || '').trim();
    if (!uid) return false;
    const active = findActiveChatItemEl();
    if (active) {
      const activeUid = uidFromAppCid(getAppCidFromEl(active));
      if (activeUid && activeUid !== uid) return false;
    }
    const headerNick = scrapeHeaderBuyerNick();
    if (headerNick && cached.buyerNick && !nicksRoughlyMatch(headerNick, cached.buyerNick)) {
      return false;
    }
    return true;
  }

  function rememberClickedChatItem(item) {
    const appCid = getAppCidFromEl(item);
    if (!appCid) return;
    lastClickedChatAppCid = appCid;
    lastClickedChatAt = Date.now();
  }

  function findStrictActiveChatItemEl() {
    for (const sel of ACTIVE_CHAT_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && getAppCidFromEl(el)) return el;
      } catch {
        /* ignore invalid selector */
      }
    }
    if (lastClickedChatAppCid && Date.now() - lastClickedChatAt < 12000) {
      for (const el of findSessionRowElements()) {
        if (getAppCidFromEl(el) === lastClickedChatAppCid) return el;
      }
    }
    return null;
  }

  function findActiveChatItemEl() {
    for (const sel of ACTIVE_CHAT_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && getAppCidFromEl(el)) return el;
      } catch {
        /* ignore invalid selector */
      }
    }
    if (lastClickedChatAppCid && Date.now() - lastClickedChatAt < 12000) {
      for (const el of findSessionRowElements()) {
        if (getAppCidFromEl(el) === lastClickedChatAppCid) return el;
      }
    }
    const headerNick = scrapeHeaderBuyerNick();
    if (headerNick) {
      const byHeader = findChatItemByNick(headerNick);
      if (byHeader) return byHeader;
    }
    return null;
  }

  function extractAppCidFromNode(node) {
    if (!node || typeof node !== 'object') return '';
    return String(
      node.appCid || node.app_cid || node.cid
      || node.singleChatInfo?.appCid || node.single_chat_info?.appCid
      || node.chatInfo?.appCid || node.conversation?.appCid || '',
    ).trim();
  }

  function isInternalId(s) {
    return /^[0-9a-f]{20,32}$/i.test(String(s || '').trim());
  }

  function pickTraceText(node) {
    if (!node || typeof node !== 'object') return '';
    const direct = [
      node.latest_trace, node.latestTrace, node.last_trace, node.lastTrace,
      node.logistics_status_desc, node.logisticsStatusDesc, node.track_desc, node.trackDesc,
      node.trace_desc, node.traceDesc, node.status_desc, node.statusDesc,
      node.logistics_latest_desc, node.logisticsLatestDesc,
      node.csstatus, node.erp_status_str, node.status_name, node.ship_time_format,
    ].find((v) => typeof v === 'string' && v.trim() && !isInternalId(v));
    if (direct) return direct.trim();
    const lists = [
      node.trace_list, node.traceList, node.traces, node.route_list, node.routeList,
      node.logistics_traces, node.logisticsTraces, node.express_traces, node.expressTraces,
      node.track_list, node.trackList,
    ];
    for (const list of lists) {
      if (!Array.isArray(list) || !list.length) continue;
      const candidates = [list[0], list[list.length - 1]];
      for (const item of candidates) {
        if (typeof item === 'string' && item.trim()) return item.trim();
        if (item && typeof item === 'object') {
          const txt = item.desc || item.remark || item.context || item.accept_station
            || item.acceptStation || item.status || item.content || item.msg || '';
          if (String(txt).trim()) return String(txt).trim();
        }
      }
    }
    return '';
  }

  function feeCacheKey(cfg, no) {
    const mode = cfg.sandbox ? 'sbox' : 'prod';
    const partner = String(cfg.partnerID || '').trim();
    const card = String(cfg.monthlyCard || '').trim();
    return `${mode}:${partner}:${card}:${no}`;
  }

  function panelConfigCacheKey(cfg) {
    const mode = cfg.sandbox ? 'sbox' : 'prod';
    const partner = String(cfg.partnerID || '').trim();
    const card = String(cfg.monthlyCard || '').trim();
    return `${mode}:${partner}:${card}`;
  }

  function buildSfWaybillMsgData(cfg, expressNo) {
    const payload = {
      trackingType: '2',
      trackingNum: String(expressNo || '').trim(),
    };
    const phone = String(cfg.phoneLast4 || '').trim();
    if (phone) payload.phone = phone;
    const card = String(cfg.monthlyCard || '').trim();
    if (card) payload.monthlyCard = card;
    return JSON.stringify(payload);
  }

  function loadBuyerCacheStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(BUYER_CACHE_KEY) || '{}');
      if (!raw || typeof raw !== 'object') return { v: VERSION, buyers: {} };
      if (!raw.buyers || typeof raw.buyers !== 'object') return { v: VERSION, buyers: {} };
      return raw;
    } catch {
      return { v: VERSION, buyers: {} };
    }
  }

  function saveBuyerCacheStore(store) {
    try {
      localStorage.setItem(BUYER_CACHE_KEY, JSON.stringify(store));
    } catch {
      /* ignore quota */
    }
  }

  function ensureBuyerCacheVersion() {
    const store = loadBuyerCacheStore();
    if (store.v !== VERSION) {
      saveBuyerCacheStore({ v: VERSION, buyers: {} });
    }
  }

  function cardHasAfterSaleSignals(card) {
    if (!card) return false;
    if (card.querySelector(
      '.after-sale-box, .sku-after-sale, .sku-after-sale-status, [class*="after-sale"], [class*="after_sale"]',
    )) return true;
    const statusEl = card.querySelector('[class*="refund"], [class*="return"], [class*="after-sale"]');
    if (statusEl && /退款|退货|换货|售后/.test(statusEl.textContent || '')) return true;
    return /退款|退货|换货|售后/.test(card.innerText || '');
  }

  function packageHasCompleteRefundInfo(buyerUserId, packageId) {
    const uid = String(buyerUserId || '').trim();
    const pid = String(packageId || '').trim();
    if (!uid || !pid) return false;
    const cached = buyerPackageById.get(pkgByIdKey(uid, pid)) || {};
    const afterSale = cached.afterSale;
    const hasRefund = afterSale?.refundApplyAmount != null || afterSale?.refundActualAmount != null;
    if (!hasRefund) return false;
    return resolveActualPayAmount(uid, pid) != null;
  }

  function afterSaleRefundChanged(prev, next) {
    const p = normalizeAfterSale(prev);
    const n = normalizeAfterSale(next);
    if (!n) return false;
    const hadAmt = p?.refundApplyAmount != null || p?.refundActualAmount != null;
    const hasAmt = n.refundApplyAmount != null || n.refundActualAmount != null;
    if (!hasAmt) return false;
    return !hadAmt
      || p.refundApplyAmount !== n.refundApplyAmount
      || p.refundActualAmount !== n.refundActualAmount;
  }

  function packageNeedsOrderDetailPrefetch(buyerUserId, packageId) {
    const uid = String(buyerUserId || '').trim();
    const pid = String(packageId || '').trim();
    if (!uid || !pid) return false;
    const card = findCardByPackageId(pid);
    if (card && uid) ingestOrderCardElement(card, uid);
    const cached = buyerPackageById.get(pkgByIdKey(uid, pid)) || {};
    const hasExpress = Boolean(
      cached.expressNo || extractExpressFromCardLogistics(card).expressNo,
    );
    if (!hasExpress) return true;
    if (cached.apiError && !cardHasAfterSaleSignals(card) && !cached.afterSale) return false;
    if (packageHasCompleteRefundInfo(uid, pid)) return false;
    const hasPay = cached.actualPayAmount != null || extractOrderMetaFromCard(card).actualPayAmount != null;
    const needRefund = cardHasAfterSaleSignals(card) || Boolean(cached.afterSale);
    if (needRefund && !packageHasCompleteRefundInfo(uid, pid)) return true;
    if (!hasPay && needRefund) return true;
    return false;
  }

  function scheduleRefundPanelPatch() {
    runWhenScrollSettled(() => {
      clearTimeout(refundPatchTimer);
      refundPatchTimer = setTimeout(() => {
        refundPatchTimer = null;
        if (isUserScrolling()) {
          scheduleRefundPanelPatch();
          return;
        }
        patchOrderCardsSection();
      }, 320);
    });
  }

  function orderCardsRenderSig(buyerUserId, cardRows) {
    const uid = String(buyerUserId || '').trim();
    return (cardRows || []).map((row) => {
      const pid = String(row?.pkg?.packageId || row?.pkg?.orderId || '').trim();
      const no = String(row?.pkg?.expressNo || '').trim();
      const fee = row?.fee?.totalFee != null ? String(row.fee.totalFee) : '';
      const refund = row?.pkg?.afterSale?.refundApplyAmount != null
        ? String(row.pkg.afterSale.refundApplyAmount) : '';
      return `${pid}:${no}:${fee}:${refund}`;
    }).join('|');
  }

  function patchOrderCardsSection() {
    if (!bodyEl || !activeBuyer.buyerUserId || !isPanelExpanded()) return;
    if (isUserScrolling()) {
      runWhenScrollSettled(() => patchOrderCardsSection());
      return;
    }
    const uid = activeBuyer.buyerUserId;
    const orderList = bodyEl.querySelector('.qsf-order-list');
    if (!orderList) return;
    const cardRows = lastRenderedCardRows.length
      ? lastRenderedCardRows
      : (loadBuyerPanelCache(uid, loadConfig())?.cards || []);
    const sig = orderCardsRenderSig(uid, cardRows);
    if (sig && sig === lastOrderListPatchSig) return;
    const nextHtml = renderOrderCardsList(uid, cardRows);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = nextHtml;
    const nextList = wrapper.querySelector('.qsf-order-list');
    if (nextList && nextList.innerHTML !== orderList.innerHTML) {
      orderList.replaceWith(nextList);
      lastOrderListPatchSig = sig;
    }
  }

  function runAfterPaint(fn) {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(fn));
    } else {
      setTimeout(fn, 32);
    }
  }

  function runWhenIdle(fn, timeoutMs = 900) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: timeoutMs });
    } else {
      setTimeout(fn, 48);
    }
  }

  function ensurePanelRefs() {
    const root = document.getElementById(PANEL_ID);
    if (!root) {
      buildPanel();
      return;
    }
    panelEl = root;
    bodyEl = root.querySelector('.qsf-body');
    settingsEl = root.querySelector('.qsf-settings');
  }

  function paintBuyerPanelFromCache(buyerUserId, buyerNick) {
    if (!bodyEl || !isPanelExpanded()) return false;
    const uid = String(buyerUserId || '').trim();
    if (!uid) return false;
    const cfg = loadConfig();
    let cached = loadBuyerPanelCache(uid, cfg);
    if (cached && !cacheMatchesCurrentSession(cached, uid)) cached = null;
    if (!cached) return false;
    const displayNick = resolveDisplayNick(buyerNick, cached.buyerNick);
    if (cached.empty) {
      bodyEl.innerHTML = renderEmptySfPanel(
        displayNick,
        uid,
        { fromCache: true, updatedAt: cached.updatedAt, noOrder: cached.noOrder === true },
      );
      return true;
    }
    if (!cached.cards?.length) return false;
    hydrateExpressCacheFromCards(cached.cards, cfg);
    lastRenderedCardRows = cached.cards;
    bodyEl.innerHTML = renderPanelCards(
      displayNick,
      uid,
      cached.cards,
      cached.updatedAt,
      { fromCache: true },
    );
    patchTraceDisplay();
    return true;
  }

  function cardsCoverVisibleIds(cards, visibleIds) {
    const pkgIdOf = (row) => String(row?.pkg?.packageId || row?.pkg?.orderId || '').trim();
    if (!visibleIds?.length) return Boolean(cards?.length);
    return visibleIds.every((id) => {
      const row = (cards || []).find((r) => pkgIdOf(r) === id);
      return Boolean(row?.pkg?.expressNo);
    });
  }

  function panelHasStableContent() {
    if (!bodyEl || !isPanelExpanded()) return false;
    if (bodyEl.classList.contains('is-busy') || bodyEl.querySelector('.qsf-loading')) return false;
    return Boolean(bodyEl.querySelector('.qsf-order-list, .qsf-waybill-head, .qsf-buyer-nick'));
  }

  function shouldBackgroundRevalidate(buyerUserId, cached, cfg) {
    if (!cached) return true;
    const uid = String(buyerUserId || '').trim();
    if (!uid) return true;
    if (cached.cfgKey && cached.cfgKey !== panelConfigCacheKey(cfg)) return true;
    const lastBg = lastBackgroundRefreshAt.get(uid) || 0;
    if (Date.now() - lastBg < BACKGROUND_REVALIDATE_MS) return false;
    const age = Date.now() - Number(cached.updatedAt || 0);
    const visibleIds = getVisibleOrderPackageIds();
    if (age < 45000 && cardsCoverVisibleIds(cached.cards, visibleIds)) return false;
    if (age > BACKGROUND_REVALIDATE_MS) return true;
    if (cached.expressFingerprint && visibleIds.length) {
      const live = liveExpressFingerprint(uid, visibleIds);
      const hasLiveExpress = live.split('\u0001').some((part) => /:[^:]+$/.test(part) && !part.endsWith(':'));
      if (hasLiveExpress && live !== cached.expressFingerprint) return true;
    }
    return false;
  }

  function markBackgroundRevalidate(buyerUserId) {
    const uid = String(buyerUserId || '').trim();
    if (uid) lastBackgroundRefreshAt.set(uid, Date.now());
  }

  function scheduleBackgroundRevalidateOnce(buyerUserId, retryLeft = 8) {
    const uid = String(buyerUserId || '').trim();
    if (!uid) return;
    clearTimeout(backgroundRevalidateTimer);
    const delayMs = retryLeft >= 8 ? 2500 : 800;
    backgroundRevalidateTimer = setTimeout(() => {
      backgroundRevalidateTimer = null;
      if (activeBuyer.buyerUserId !== uid || !isPanelExpanded()) return;
      if (isUserScrolling()) {
        scheduleBackgroundRevalidateOnce(uid, retryLeft);
        return;
      }
      if (refreshInFlight) {
        if (retryLeft > 0) scheduleBackgroundRevalidateOnce(uid, retryLeft - 1);
        return;
      }
      const cfg = loadConfig();
      const cached = loadBuyerPanelCache(uid, cfg);
      if (!cached || !shouldBackgroundRevalidate(uid, cached, cfg)) return;
      if (cached.updatedAt && Date.now() - cached.updatedAt < 20000 && panelHasStableContent()) return;
      markBackgroundRevalidate(uid);
      void refreshPanel({ preferCache: false, waitForData: false, background: true });
    }, delayMs);
  }

  function schedulePartialLoadRetry(buyerUserId) {
    const uid = String(buyerUserId || '').trim();
    if (!uid || !isPanelExpanded()) return;
    clearTimeout(partialLoadRetryTimer);
    partialLoadRetryTimer = setTimeout(() => {
      partialLoadRetryTimer = null;
      if (activeBuyer.buyerUserId !== uid || !isPanelExpanded() || refreshInFlight) return;
      if (isUserScrolling()) {
        schedulePartialLoadRetry(uid);
        return;
      }
      const visibleIds = getVisibleOrderPackageIds();
      if (!visibleIds.length) return;
      if (countLoadedOrderExpress(uid, visibleIds) >= visibleIds.length) return;
      void refreshPanel({ preferCache: false, waitForData: true, background: true });
    }, 1200);
  }

  function liveExpressFingerprint(buyerUserId, visibleIds) {
    const uid = String(buyerUserId || '').trim();
    return (visibleIds || []).map((id) => {
      const p = buyerPackageById.get(pkgByIdKey(uid, id));
      return `${id}:${String(p?.expressNo || '').trim().toUpperCase()}`;
    }).join('\u0001');
  }

  function cacheExpressFingerprint(cards) {
    const pkgIdOf = (row) => String(row?.pkg?.packageId || row?.pkg?.orderId || '').trim();
    return (cards || []).map((row) => {
      const pid = pkgIdOf(row);
      return `${pid}:${String(row?.pkg?.expressNo || '').trim().toUpperCase()}`;
    }).join('\u0001');
  }

  function reconcileCachedEntry(entry, buyerUserId) {
    if (!entry) return null;
    const visibleIds = getVisibleOrderPackageIds();
    const snap = getOrderPanelSnapshot();

    if (entry.empty) {
      if (visibleIds.length > 0 || (snap.cardCount > 0 && !snap.empty)) return null;
      return entry;
    }

    if (!Array.isArray(entry.cards) || !entry.cards.length) return null;

    const pkgIdOf = (row) => String(row?.pkg?.packageId || row?.pkg?.orderId || '').trim();

    if (entry.visibleOrderIds?.length && visibleIds.length) {
      const prevKey = entry.visibleOrderIds.join('\u0001');
      const curKey = visibleIds.join('\u0001');
      if (prevKey !== curKey) {
        const overlap = visibleIds.some((id) => entry.visibleOrderIds.includes(id));
        if (!overlap) return null;
      }
    }

    let cards = entry.cards.filter((row) => {
      const pid = pkgIdOf(row);
      return pid && (!visibleIds.length || visibleIds.includes(pid));
    });

    if (visibleIds.length) {
      cards = visibleIds
        .map((id) => cards.find((row) => pkgIdOf(row) === id))
        .filter(Boolean);
      if (visibleIds.length === 1 && cards.length > 1) cards = cards.slice(0, 1);
      if (!cards.length) return null;
    }

    if (entry.expressFingerprint && visibleIds.length) {
      const live = liveExpressFingerprint(buyerUserId, visibleIds);
      const hasLiveExpress = live.split('\u0001').some((part) => /:[^:]+$/.test(part) && !part.endsWith(':'));
      if (hasLiveExpress && live !== entry.expressFingerprint && !cardsCoverVisibleIds(cards, visibleIds)) {
        return null;
      }
    }

    const headerNick = scrapeHeaderBuyerNick();
    if (headerNick && entry.buyerNick && !nicksRoughlyMatch(headerNick, entry.buyerNick)) {
      return null;
    }

    return { ...entry, cards };
  }

  function loadBuyerPanelCache(buyerUserId, cfg) {
    const uid = String(buyerUserId || '').trim();
    if (!uid) return null;
    const store = loadBuyerCacheStore();
    if (store.v !== VERSION) return null;
    const entry = store.buyers?.[uid];
    if (!entry) return null;
    if (entry.cfgKey !== panelConfigCacheKey(cfg)) return null;
    if (entry.updatedAt && Date.now() - entry.updatedAt > BUYER_CACHE_TTL_MS) return null;
    return reconcileCachedEntry(entry, uid);
  }

  function saveBuyerPanelCache(buyerUserId, entry) {
    const uid = String(buyerUserId || '').trim();
    if (!uid || !entry) return;
    const store = loadBuyerCacheStore();
    store.v = VERSION;
    if (!store.buyers) store.buyers = {};
    store.buyers[uid] = entry;
    const keys = Object.keys(store.buyers);
    if (keys.length > MAX_BUYER_CACHE) {
      keys.sort((a, b) => (store.buyers[a]?.updatedAt || 0) - (store.buyers[b]?.updatedAt || 0));
      for (let i = 0; i < keys.length - MAX_BUYER_CACHE; i += 1) {
        delete store.buyers[keys[i]];
      }
    }
    saveBuyerCacheStore(store);
  }

  function clearBuyerPanelCache() {
    try {
      localStorage.removeItem(BUYER_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }

  function sanitizeFeeForCache(fee) {
    if (!fee || typeof fee !== 'object') return fee;
    const { raw, ...rest } = fee;
    return rest;
  }

  function hydrateExpressCacheFromCards(cards, cfg) {
    for (const row of cards || []) {
      const no = row?.pkg?.expressNo;
      const fee = row?.fee;
      if (!no || !fee) continue;
      expressCache.set(feeCacheKey(cfg, no), fee);
    }
  }

  function findChatItem(el) {
    let node = el;
    while (node && node !== document.body) {
      const appCid = getAppCidFromEl(node);
      if (appCid && appCid.startsWith('$3$')) return node;
      if (node.classList) {
        const cls = [...node.classList].join(' ');
        if (/chat-item|search-item|session-item|result-item|conv-item|contact-item/i.test(cls)) return node;
        if (/search|session|result|conv|contact/i.test(cls) && /item|row|cell|card/i.test(cls)) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  const NON_SF_HINT = '非顺丰运单（单号非 SF 开头），本侧栏仅支持查询顺丰月结费用';

  function isSfExpressNo(no) {
    const n = String(no || '').trim().toUpperCase();
    return /^SF\d{10,}$/.test(n);
  }

  function makeNonSfFeeResult(expressNo) {
    const company = String(expressNo || '').trim();
    return {
      ok: false,
      skipped: true,
      error: company ? NON_SF_HINT : '暂无运单号',
    };
  }

  function money(n) {
    const v = Number(n);
    return Number.isFinite(v) ? `¥${v.toFixed(2)}` : '-';
  }

  function parseMoneyYuan(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const s = String(value).replace(/[,，]/g, '').trim();
    const m = s.match(/(\d+(?:\.\d{1,2})?)/);
    return m ? Number(m[1]) : null;
  }

  function resolveShippingDeductYuan(cfg) {
    const v = Number(cfg?.shippingDeductYuan ?? DEFAULT_SHIPPING_DEDUCT_YUAN);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_SHIPPING_DEDUCT_YUAN;
  }

  const SF_EXPRESS_LABELS = {
    B1: '顺丰标快',
    S1: '顺丰特惠',
    T1: '顺丰次晨',
    T4: '顺丰特快',
    T6: '顺丰即日',
    T8: '顺丰次晨',
    T11: '物流普运',
    T12: '顺丰空配',
  };

  function sfExpressTypeLabel(code) {
    const c = String(code || '').trim().toUpperCase();
    return SF_EXPRESS_LABELS[c] || (c ? `产品 ${c}` : '');
  }

  function formatRoute(fee) {
    const from = String(fee.jCity || fee.jProvince || '').trim();
    const to = String(fee.dCity || fee.dProvince || '').trim();
    if (from && to) return `${from} → ${to}`;
    return from || to || '';
  }

  function formatWeightPair(real, meterage) {
    const r = Number(real);
    const m = Number(meterage);
    const rOk = Number.isFinite(r);
    const mOk = Number.isFinite(m);
    if (rOk && mOk) {
      if (r !== m) return `实重 ${r} kg · 计费 ${m} kg`;
      return `实重/计费 ${m} kg`;
    }
    if (mOk) return `计费 ${m} kg`;
    if (rOk) return `实重 ${r} kg`;
    return '';
  }

  function renderFeeCardMeta(fee, pkg) {
    let html = '';
    const route = formatRoute(fee);
    const product = sfExpressTypeLabel(fee.expressTypeCode);
    const recipient = String(fee.addresseeContName || '').trim();
    const line1 = [recipient, route, product].filter(Boolean).join(' · ');
    if (line1) html += `<div class="qsf-meta">${esc(line1)}</div>`;

    const weight = formatWeightPair(fee.realWeightQty, fee.meterageWeightQty);
    const acct = fee.customerAcctCode ? `月结 ${fee.customerAcctCode}` : '';
    const orderId = String(pkg.orderId || '').trim();
    const orderIds = mergeOrderIds(pkg.orderIds, orderId);
    const childs = String(fee.waybillChilds || '').trim();
    const line2 = [
      weight,
      acct,
      orderIds.length ? `订单 ${orderIds.join(' / ')}` : '',
      childs ? `子单 ${childs}` : '',
    ].filter(Boolean).join(' · ');
    if (line2) {
      const warn = Number.isFinite(Number(fee.realWeightQty))
        && Number.isFinite(Number(fee.meterageWeightQty))
        && Number(fee.realWeightQty) !== Number(fee.meterageWeightQty);
      html += `<div class="qsf-meta${warn ? ' qsf-meta-warn' : ''}">${esc(line2)}</div>`;
    }
    return html;
  }

  function uuid() {
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ─── 运单缓存（网络 hook 写入） ─────────────────────────────────────
  const buyerPackages = new Map(); // buyerUserId -> Map(expressNo -> pkg)
  const buyerPackageById = new Map(); // `${buyerUserId}:${packageId}` -> pkg
  const expressCache = new Map(); // expressNo -> sf fee result
  const sfFeeInflight = new Map(); // cacheKey -> Promise
  const buyerIdentityByNick = new Map(); // nick/uid -> { buyerUserId, buyerNick, appCid, at }

  function rememberBuyerIdentity(buyerUserId, buyerNick, appCid) {
    const uid = String(buyerUserId || '').trim();
    if (!uid) return;
    const nick = normPanelText(buyerNick);
    const row = { buyerUserId: uid, buyerNick: nick, appCid: String(appCid || '').trim(), at: Date.now() };
    buyerIdentityByNick.set(`uid:${uid}`, row);
    if (nick) buyerIdentityByNick.set(`nick:${nick}`, row);
  }

  function resolveBuyerUserIdByNick(buyerNick) {
    const nick = normPanelText(buyerNick);
    if (!nick) return '';
    const direct = buyerIdentityByNick.get(`nick:${nick}`);
    if (direct && Date.now() - direct.at < 60 * 60 * 1000) return direct.buyerUserId;
    for (const [key, val] of buyerIdentityByNick.entries()) {
      if (!key.startsWith('nick:')) continue;
      if (Date.now() - val.at > 60 * 60 * 1000) continue;
      if (nicksRoughlyMatch(key.slice(5), nick)) return val.buyerUserId;
    }
    return '';
  }

  function resolveBuyerUserIdFromVisibleOrders() {
    const visibleIds = getVisibleOrderPackageIds();
    if (!visibleIds.length) return '';
    const hits = new Map();
    for (const pid of visibleIds) {
      for (const [key, pkg] of buyerPackageById.entries()) {
        if (!key.endsWith(`:${pid}`)) continue;
        const uid = key.slice(0, key.length - pid.length - 1);
        if (uid) hits.set(uid, (hits.get(uid) || 0) + 1);
      }
    }
    if (hits.size === 1) return [...hits.keys()][0];
    let bestUid = '';
    let bestCount = 0;
    for (const [uid, count] of hits.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestUid = uid;
      }
    }
    return bestUid;
  }

  let activeBuyer = { buyerUserId: '', buyerNick: '', appCid: '' };
  let refreshInFlight = false;
  let lastRefreshStartedAt = 0;
  let refreshSession = 0;
  let orderPanelStale = false;
  let lastPanelExpandAt = 0;
  let orderDomCache = { at: 0, root: null, ids: [], map: new Map(), primaryNo: '' };
  let sessionRowCache = { at: 0, rows: [] };
  let scrollSettleTimer = null;
  const scrollSettleQueue = new Set();
  let lastOrderListPatchSig = '';
  let userScrollingUntil = 0;
  const ORDER_DOM_CACHE_MS = 500;
  const SESSION_ROW_CACHE_MS = 1500;
  const SCROLL_PAUSE_MS = 1400;
  const FEE_QUERY_CONCURRENCY = 4;
  const RENDER_FAST_DOM_THRESHOLD = 8;

  function markUserScrolling() {
    userScrollingUntil = Date.now() + SCROLL_PAUSE_MS;
    clearTimeout(scrollSettleTimer);
    scrollSettleTimer = setTimeout(flushScrollSettleQueue, SCROLL_PAUSE_MS + 100);
  }

  function isUserScrolling() {
    return Date.now() < userScrollingUntil;
  }

  function runWhenScrollSettled(fn) {
    if (typeof fn !== 'function') return;
    if (!isUserScrolling()) {
      fn();
      return;
    }
    scrollSettleQueue.add(fn);
  }

  function flushScrollSettleQueue() {
    scrollSettleTimer = null;
    if (isUserScrolling()) {
      scrollSettleTimer = setTimeout(flushScrollSettleQueue, 220);
      return;
    }
    const batch = [...scrollSettleQueue];
    scrollSettleQueue.clear();
    for (const fn of batch) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }

  function invalidateOrderDomCache() {
    orderDomCache.at = 0;
  }

  function rebuildOrderDomCache(force = false) {
    const root = orderPanelRoot();
    if (!root) return orderDomCache;
    if (!force && orderDomCache.root === root && Date.now() - orderDomCache.at < ORDER_DOM_CACHE_MS) {
      return orderDomCache;
    }
    const map = new Map();
    const ids = [];
    const seen = new Set();
    for (const card of root.querySelectorAll('.order-card')) {
      const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      if (!packageId || seen.has(packageId)) continue;
      seen.add(packageId);
      ids.push(packageId);
      map.set(packageId, card);
    }
    const box = root.querySelector('.logistics-box, .delivery-row-logistics');
    const m = box ? (box.innerText || '').match(/\b(SF\d{10,})\b/i) : null;
    orderDomCache = {
      at: Date.now(),
      root,
      ids,
      map,
      primaryNo: m ? m[1].toUpperCase() : '',
    };
    return orderDomCache;
  }

  function orderPanelRoot() {
    return document.querySelector('.order-tool-content')
      || document.querySelector('.new-right-panel')
      || document.querySelector('.order-tool-container')
      || document.querySelector('.farmer-chat__right')
      || null;
  }

  function scrapeLogisticsFromBox(box) {
    if (!box) return '';
    const parts = (box.innerText || '')
      .split(/\n|\s*[|｜]\s*/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const line = parts[i];
      if (line.length < 4 || isInternalId(line)) continue;
      if (/^SF\d/i.test(line) || /顺丰速运/.test(line)) continue;
      if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(line)) continue;
      if (/^(运输中|已签收|待揽收|派件中|已发货|待发货)$/.test(line)) continue;
      if (/快件|签收|派送|揽收|离开|到达|配送|发往|转运|投递|签收/.test(line)) return line;
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const line = parts[i];
      if (line.length >= 2 && !/^SF\d/i.test(line) && !/顺丰速运/.test(line) && !isInternalId(line)) {
        return line;
      }
    }
    return '';
  }

  function scrapeLogisticsFromPanel() {
    const root = orderPanelRoot();
    if (!root) return '';
    const box = root.querySelector('.logistics-box')
      || root.querySelector('.delivery-row-logistics');
    return scrapeLogisticsFromBox(box);
  }

  function scrapeLogisticsExpressNoFromBox(box) {
    if (!box) return '';
    const m = (box.innerText || box.textContent || '').match(/\b(SF\d{10,})\b/i);
    return m ? m[1].toUpperCase() : '';
  }

  function scrapePanelLogisticsExpressNo() {
    const root = orderPanelRoot();
    if (!root) return '';
    const box = root.querySelector('.logistics-box, .delivery-row-logistics');
    return scrapeLogisticsExpressNoFromBox(box);
  }

  function normalizeShipTimeText(text) {
    const s = String(text || '').trim().replace(/-/g, '/');
    if (!s) return '';
    if (/晚发必赔|承诺发货|必赔|内贸|暂无|^[\u4e00-\u9fa5]{2,12}$/.test(s)) return '';
    const ms = parseQianfanDateTime(s);
    return ms ? formatQianfanDateTime(ms) : '';
  }

  function buildShipTimeResult(ms, text) {
    const normalized = normalizeShipTimeText(text) || (ms ? formatQianfanDateTime(ms) : '');
    const resolvedMs = ms || parseQianfanDateTime(normalized);
    if (!resolvedMs && !normalized) return null;
    return {
      shipTimeMs: resolvedMs || null,
      shipTimeText: normalized || (resolvedMs ? formatQianfanDateTime(resolvedMs) : ''),
    };
  }

  /** 千帆物流区：单号下方第一条轨迹的时间（.logistics-box-detail 末尾日期） */
  function scrapeShipTimeFromLogisticsBox(box) {
    if (!box) return null;
    const detail = box.querySelector('.logistics-box-detail') || box;
    const text = (detail.innerText || detail.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const matches = [...text.matchAll(/(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/g)];
    if (!matches.length) return null;
    const picked = matches[0][1];
    return buildShipTimeResult(parseQianfanDateTime(picked), picked);
  }

  function pickTraceItemTime(item) {
    if (item == null) return null;
    if (typeof item === 'string') {
      const m = item.match(/(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/);
      return m ? buildShipTimeResult(parseQianfanDateTime(m[1]), m[1]) : null;
    }
    if (typeof item !== 'object') return null;
    const timeFields = [
      'time', 'accept_time', 'acceptTime', 'trace_time', 'traceTime', 'event_time',
      'eventTime', 'datetime', 'date', 'accept_station_time', 'operate_time', 'operateTime',
      'timestamp', 'create_time', 'createTime',
    ];
    for (const k of timeFields) {
      const ms = parseApiTimeValue(item[k]);
      if (ms) return buildShipTimeResult(ms, formatQianfanDateTime(ms));
    }
    for (const k of ['desc', 'remark', 'context', 'accept_station', 'acceptStation', 'status', 'content', 'msg']) {
      const s = String(item[k] || '');
      const m = s.match(/(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/);
      if (m) return buildShipTimeResult(parseQianfanDateTime(m[1]), m[1]);
    }
    return null;
  }

  function pickFirstLogisticsTraceTimeFromNode(node) {
    if (!node || typeof node !== 'object') return null;
    const lists = [];
    const listKeys = new Set([
      'trace_list', 'traceList', 'traces', 'route_list', 'routeList',
      'logistics_traces', 'logisticsTraces', 'express_traces', 'expressTraces',
      'track_list', 'trackList', 'data_list', 'records', 'items', 'route_details',
    ]);
    function collect(o, depth) {
      if (!o || depth > 10) return;
      if (Array.isArray(o)) {
        if (o.length && (typeof o[0] === 'object' || typeof o[0] === 'string')) lists.push(o);
        o.forEach((x) => collect(x, depth + 1));
        return;
      }
      if (typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (listKeys.has(k) && Array.isArray(v) && v.length) lists.push(v);
        collect(v, depth + 1);
      }
    }
    collect(node, 0);

    const entries = [];
    for (const list of lists) {
      for (const item of list) {
        const t = pickTraceItemTime(item);
        if (t?.shipTimeMs) {
          entries.push({
            ...t,
            shipLike: /揽收|已发货|已揽收|发出|收件|揽件|交接|打包|出库/.test(JSON.stringify(item).slice(0, 240)),
          });
        }
      }
    }
    if (entries.length) {
      entries.sort((a, b) => a.shipTimeMs - b.shipTimeMs);
      const shipLike = entries.filter((e) => e.shipLike);
      return shipLike[0] || entries[0];
    }

    const fmt = normalizeShipTimeText(node.ship_time_format ?? node.shipTimeFormat ?? node.ship_time_str);
    if (fmt) return buildShipTimeResult(parseQianfanDateTime(fmt), fmt);
    const shipMs = parseApiTimeValue(node.ship_time ?? node.shipTime ?? node.send_time);
    if (shipMs) return buildShipTimeResult(shipMs, formatQianfanDateTime(shipMs));
    return null;
  }

  function syncShipTimeFromPanelLogistics(buyerUserId, packageId) {
    const uid = String(buyerUserId || '').trim();
    if (!uid) return;
    const root = orderPanelRoot();
    if (!root) return;
    const box = root.querySelector('.logistics-box, .delivery-row-logistics');
    const ship = scrapeShipTimeFromLogisticsBox(box);
    if (!ship?.shipTimeMs && !ship?.shipTimeText) return;
    const panelNo = scrapeLogisticsExpressNoFromBox(box);
    let targets = packageId ? [String(packageId).trim()] : [];
    if (!targets.length) {
      if (!panelNo) return;
      targets = getVisibleOrderPackageIds().filter((pid) => {
        const cached = buyerPackageById.get(pkgByIdKey(uid, pid)) || {};
        const pkgNo = String(
          cached.expressNo || extractExpressFromCardLogistics(findCardByPackageId(pid)).expressNo || '',
        ).trim().toUpperCase();
        return pkgNo && pkgNo === panelNo;
      });
      if (!targets.length) return;
    }
    for (const pid of targets) {
      if (!pid) continue;
      const key = pkgByIdKey(uid, pid);
      const cached = buyerPackageById.get(key) || { packageId: pid, orderId: pid };
      const pkgNo = String(cached.expressNo || extractExpressFromCardLogistics(findCardByPackageId(pid)).expressNo || '').trim().toUpperCase();
      if (panelNo && pkgNo && panelNo !== pkgNo) continue;
      if (!panelNo && !packageId) continue;
      indexPackageById(uid, mergeOrderMetaIntoPkg(cached, ship));
    }
  }

  function mergeOrderIds(...sources) {
    const ids = new Set();
    for (const src of sources) {
      if (!src) continue;
      if (Array.isArray(src)) src.forEach((id) => { if (id) ids.add(String(id).trim()); });
      else String(src).split(/[,，]/).forEach((id) => { if (id.trim()) ids.add(id.trim()); });
    }
    return [...ids];
  }

  function parsePackageIdFromUrl(url) {
    const u = String(url || '');
    let m = u.match(/\/package\/([^/?#]+)\/detail/i);
    if (m) return decodeURIComponent(m[1]);
    m = u.match(/[?&]packageId=([^&]+)/i);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function parseAppCidFromPageUrl() {
    try {
      const href = String(location.href || '');
      const fromQuery = parseAppCidFromUrl(href);
      if (fromQuery.startsWith('$3$')) return fromQuery;
      const hash = String(location.hash || '').replace(/^#/, '');
      if (hash) {
        const candidates = [
          hash.includes('=') ? `?${hash}` : '',
          `?${hash}`,
          hash,
        ].filter(Boolean);
        for (const candidate of candidates) {
          const fromHash = parseAppCidFromUrl(candidate);
          if (fromHash.startsWith('$3$')) return fromHash;
          const m = candidate.match(/\$3\$[^&#\s]+/);
          if (m) return decodeURIComponent(m[0]);
        }
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  function parseActiveSessionFromLatestChats() {
    try {
      const raw = localStorage.getItem('latestChats');
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      const visibleCids = new Set(
        findSessionRowElements().map((el) => getAppCidFromEl(el)).filter((cid) => cid.startsWith('$3$')),
      );
      let activeHit = null;
      let best = null;
      let bestTime = 0;
      const consider = (chat) => {
        if (!chat || typeof chat !== 'object') return;
        const appCid = String(chat.id || chat.cid || chat.imChatId || chat.im_chat_id || '').trim();
        if (!appCid.startsWith('$3$')) return;
        if (visibleCids.size && !visibleCids.has(appCid)) return;
        const buyerUserId = String(
          chat.customerUserId || chat.customer_user_id || chat.userId
          || chat.pairInfo?.refUserId || chat.userProfile?.refUserId
          || chat.target_info?.id || uidFromAppCid(appCid) || '',
        ).trim();
        if (!buyerUserId) return;
        const buyerNick = cleanBuyerNick(
          chat.nickname || chat.nickName || chat.pairInfo?.nickName || chat.pairInfo?.nickname
          || chat.userProfile?.nickName || chat.userProfile?.nickname
          || chat.target_info?.nickname || '',
        );
        const ts = Number(
          chat.time || chat.statusTime || chat.inactivedAt || chat.inactiveTime
          || chat.lastMessage?.time || chat.lastMsg?.msgTime || 0,
        );
        if (chat.active === true) {
          if (!activeHit || ts >= (activeHit.ts || 0)) {
            activeHit = { appCid, buyerUserId, buyerNick, ts };
          }
          return;
        }
        if (ts >= bestTime) {
          best = { appCid, buyerUserId, buyerNick, ts };
          bestTime = ts;
        }
      };
      for (const bucket of Object.values(data)) {
        if (Array.isArray(bucket)) bucket.forEach(consider);
        else if (bucket && typeof bucket === 'object') consider(bucket);
      }
      return activeHit || best;
    } catch {
      return null;
    }
  }

  function resolveOpenSessionFromDom() {
    const headerNick = scrapeHeaderBuyerNick();
    const strict = findStrictActiveChatItemEl();
    if (headerNick && strict) {
      const strictNick = nickFromChatItem(strict);
      if (!nicksRoughlyMatch(headerNick, strictNick)) {
        const matched = findChatItemByNick(headerNick);
        if (matched) {
          const appCid = getAppCidFromEl(matched);
          const buyerUserId = uidFromAppCid(appCid);
          if (buyerUserId) {
            return { appCid, buyerUserId, buyerNick: headerNick, source: 'headerOverStrict' };
          }
        }
        const cachedUid = resolveBuyerUserIdByNick(headerNick);
        if (cachedUid) {
          return { appCid: '', buyerUserId: cachedUid, buyerNick: headerNick, source: 'headerCache' };
        }
      }
    }
    if (strict) {
      const appCid = getAppCidFromEl(strict);
      const buyerUserId = uidFromAppCid(appCid);
      if (buyerUserId) {
        return {
          appCid,
          buyerUserId,
          buyerNick: nickFromChatItem(strict),
          source: 'strictActive',
        };
      }
    }
    const headerNickFallback = scrapeHeaderBuyerNick();
    if (headerNickFallback) {
      const matched = findChatItemByNick(headerNickFallback);
      if (matched) {
        const appCid = getAppCidFromEl(matched);
        const buyerUserId = uidFromAppCid(appCid);
        if (buyerUserId) {
          return { appCid, buyerUserId, buyerNick: headerNickFallback, source: 'headerMatch' };
        }
      }
      const cachedUid = resolveBuyerUserIdByNick(headerNickFallback);
      if (cachedUid) {
        return { appCid: '', buyerUserId: cachedUid, buyerNick: headerNickFallback, source: 'headerCache' };
      }
    }
    const latest = parseActiveSessionFromLatestChats();
    if (latest?.buyerUserId) {
      return {
        appCid: latest.appCid || '',
        buyerUserId: latest.buyerUserId,
        buyerNick: latest.buyerNick || '',
        source: 'latestChats',
      };
    }
    return null;
  }

  function syncBrowserJumpSession() {
    let appCid = parseAppCidFromPageUrl();
    let buyerUserId = uidFromAppCid(appCid);
    let buyerNick = '';
    let fromUrlAppCid = buyerUserId !== '';
    let fromExternalOpen = false;

    if (!buyerUserId) {
      const open = resolveOpenSessionFromDom();
      if (open?.buyerUserId) {
        appCid = open.appCid || appCid;
        buyerUserId = open.buyerUserId;
        buyerNick = open.buyerNick || '';
        fromExternalOpen = true;
      }
    } else {
      fromExternalOpen = false;
    }

    if (!buyerUserId) return false;

    if (activeBuyer.buyerUserId && activeBuyer.buyerUserId !== buyerUserId) {
      orderPanelStale = true;
    }

    const headerNick = scrapeHeaderBuyerNick() || buyerNick;
    queueSessionActivation({
      buyerUserId,
      appCid,
      buyerNick: headerNick || buyerNick,
      fromUrlAppCid,
      fromExternalOpen,
    });
    return true;
  }

  function parseAppCidFromUrl(url) {
    const u = String(url || '');
    const m = u.match(/[?&](?:appCid|app_cid|cid)=([^&#]+)/i);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function pkgByIdKey(buyerUserId, packageId) {
    const uid = String(buyerUserId || '').trim();
    const pid = String(packageId || '').trim();
    return uid && pid ? `${uid}:${pid}` : '';
  }

  function getVisibleOrderPackageIds() {
    const idx = rebuildOrderDomCache();
    if (idx.ids.length) return idx.ids;
    if (isUserScrolling() && orderDomCache.ids.length) return orderDomCache.ids.slice();
    const root = orderPanelRoot();
    if (!root) return [];
    const ids = [];
    const seen = new Set();
    const add = (raw) => {
      const id = String(raw || '').trim();
      if (!id || seen.has(id)) return;
      if (!/^P\d{10,}$/i.test(id)) return;
      seen.add(id);
      ids.push(id);
    };
    const text = root.innerText || '';
    const allowRegex = !orderPanelStale || sessionBuyerAlignedWithDom();
    if (allowRegex) {
      for (const m of text.matchAll(/\b(P\d{15,})\b/gi)) add(m[1]);
    }
    return ids;
  }

  function sessionBuyerAlignedWithDom() {
    if (!activeBuyer.buyerUserId) return false;
    const headerNick = scrapeHeaderBuyerNick();
    const urlUid = uidFromAppCid(parseAppCidFromPageUrl());
    if (urlUid && urlUid === activeBuyer.buyerUserId) return true;
    const strict = findStrictActiveChatItemEl();
    const strictUid = strict ? uidFromAppCid(getAppCidFromEl(strict)) : '';
    if (strictUid && strictUid === activeBuyer.buyerUserId) return true;
    if (headerNick && activeBuyer.buyerNick && nicksRoughlyMatch(headerNick, activeBuyer.buyerNick)) {
      const open = resolveOpenSessionFromDom();
      if (open?.buyerUserId === activeBuyer.buyerUserId) return true;
    }
    const latest = parseActiveSessionFromLatestChats();
    if (latest?.buyerUserId === activeBuyer.buyerUserId) return true;
    return false;
  }

  function maybeClearOrderPanelStale() {
    if (!orderPanelStale || !activeBuyer.buyerUserId) return false;
    if (!sessionBuyerAlignedWithDom()) return false;
    const strict = findStrictActiveChatItemEl();
    const activeUid = strict ? uidFromAppCid(getAppCidFromEl(strict)) : '';
    const urlUid = uidFromAppCid(parseAppCidFromPageUrl());
    const latestUid = parseActiveSessionFromLatestChats()?.buyerUserId || '';
    const uidOk = activeUid && activeUid === activeBuyer.buyerUserId;
    const urlUidOk = urlUid && urlUid === activeBuyer.buyerUserId;
    const latestUidOk = latestUid && latestUid === activeBuyer.buyerUserId;
    const hasOrders = getVisibleOrderPackageIds().length > 0;
    const hasLogistics = Boolean(scrapeLogisticsExpressNo() || scrapePanelLogisticsExpressNo());
    const snap = getOrderPanelSnapshot();
    if ((uidOk || urlUidOk || latestUidOk) && (hasOrders || hasLogistics)) {
      orderPanelStale = false;
      return true;
    }
    if ((uidOk || urlUidOk || latestUidOk) && snap.cardCount > 0 && !snap.loading) {
      orderPanelStale = false;
      return true;
    }
    return false;
  }

  function shouldScrapeOrderDom() {
    if (!hasActiveBuyerSession()) return false;
    if (!orderPanelStale) return true;
    maybeClearOrderPanelStale();
    if (!orderPanelStale) return true;
    if (!sessionBuyerAlignedWithDom()) return false;
    if (scrapeLogisticsExpressNo() || getVisibleOrderPackageIds().length > 0) {
      return true;
    }
    return false;
  }

  function getPackageIdsForBuyer(buyerUserId) {
    const visible = getVisibleOrderPackageIds();
    if (visible.length) return visible;
    const uid = String(buyerUserId || '').trim();
    if (!uid) return [];
    const ids = [];
    const seen = new Set();
    for (const key of buyerPackageById.keys()) {
      if (!key.startsWith(`${uid}:`)) continue;
      const pid = key.slice(uid.length + 1);
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      ids.push(pid);
    }
    return ids;
  }

  function pruneStalePackagesForBuyer(buyerUserId) {
    const uid = String(buyerUserId || '').trim();
    if (!uid || orderPanelStale) return;
    const visibleSet = new Set(getVisibleOrderPackageIds());
    if (!visibleSet.size) return;
    for (const key of [...buyerPackageById.keys()]) {
      if (!key.startsWith(`${uid}:`)) continue;
      const pid = key.slice(uid.length + 1);
      if (!visibleSet.has(pid)) buyerPackageById.delete(key);
    }
    const pkgs = buyerPackages.get(uid);
    if (pkgs) {
      for (const [no, pkg] of [...pkgs.entries()]) {
        const ids = mergeOrderIds(pkg.orderIds, pkg.orderId, pkg.packageId);
        if (!ids.some((id) => visibleSet.has(id))) pkgs.delete(no);
      }
    }
  }

  function finalizePackagesForDisplay(pkgs, buyerUserId) {
    const visibleIds = getVisibleOrderPackageIds();
    const byPackageId = new Map();

    for (const pkg of pkgs || []) {
      const pid = String(pkg.packageId || pkg.orderId || '').trim();
      const expressNo = String(pkg.expressNo || '').trim();
      if (!pid || !expressNo) continue;
      if (visibleIds.length && !visibleIds.includes(pid)) continue;
      const prev = byPackageId.get(pid);
      byPackageId.set(pid, prev ? { ...prev, ...pkg, packageId: pid, orderId: pid } : { ...pkg, packageId: pid, orderId: pid });
    }

    let list = visibleIds.length
      ? visibleIds.map((id) => byPackageId.get(id)).filter(Boolean)
      : [...byPackageId.values()];

    // 可见订单数固定时，结果条数不得超过订单数
    if (visibleIds.length && list.length > visibleIds.length) {
      list = visibleIds.map((id) => byPackageId.get(id)).filter(Boolean);
    }

    // 仅 1 单时不应出现 2 条（去掉游离/过期缓存项）
    if (visibleIds.length === 1 && list.length > 1) {
      list = list.filter((p) => String(p.packageId) === visibleIds[0]).slice(0, 1);
    }

    return sortSfPackages(list);
  }

  function getOrderPanelSnapshot() {
    const root = orderPanelRoot();
    if (!root) return { ready: false, cardCount: 0, empty: false, loading: true };
    const visibleIds = getVisibleOrderPackageIds();
    const cardCount = visibleIds.length || root.querySelectorAll('.order-card').length;
    const text = (root.innerText || '').replace(/\s+/g, ' ');
    const empty = cardCount === 0 && /暂无|无订单|没有订单|未找到订单|无相关订单|暂无数据|还没有订单/i.test(text);
    const loading = cardCount === 0 && /加载中|loading|请稍候/i.test(text);
    return {
      ready: cardCount > 0 || empty || (!loading && cardCount === 0),
      cardCount,
      empty,
      loading,
    };
  }

  function canIngestOrderDom() {
    return shouldScrapeOrderDom();
  }

  function clearOrderPanelStaleIfReady() {
    maybeClearOrderPanelStale();
  }

  function pkgDetailKey(buyerUserId, packageId) {
    const uid = String(buyerUserId || '').trim();
    const pid = String(packageId || '').trim();
    return uid && pid ? `${uid}:${pid}` : pid;
  }

  function tryQuickCollect(buyerUserId) {
    const uid = String(buyerUserId || '').trim();
    if (!uid) return null;
    maybeClearOrderPanelStale();
    const visibleIds = getVisibleOrderPackageIds();
    if (!visibleIds.length) {
      maybeClearOrderPanelStale();
      if (orderPanelStale) return null;
      const snap = getOrderPanelSnapshot();
      if (snap.empty) return [];
      scrapeOrderCardsFromPanel();
      pruneStalePackagesForBuyer(uid);
      const idsAfter = getVisibleOrderPackageIds();
      if (!idsAfter.length) {
        if (snap.ready && snap.cardCount === 0) return [];
        return null;
      }
    }
    if (canIngestOrderDom()) scrapeOrderCardsFromPanel();
    pruneStalePackagesForBuyer(uid);
    const ids = visibleIds.length ? visibleIds : getVisibleOrderPackageIds();
    if (!ids.length) return null;
    const loaded = countLoadedOrderExpress(uid, ids);
    if (loaded >= ids.length) {
      clearOrderPanelStaleIfReady();
      return collectAllPackages(uid);
    }
    return null;
  }

  function collectPackagesFromLivePanel(buyerUserId) {
    const uid = String(buyerUserId || '').trim();
    if (!uid) return [];
    maybeClearOrderPanelStale();
    let pkgs = [];
    if (shouldScrapeOrderDom()) {
      pkgs = scrapeOrderCardsFromPanel();
    }
    if (!pkgs.length) {
      const expressNo = scrapePanelLogisticsExpressNo();
      const ids = getVisibleOrderPackageIds();
      if (expressNo) {
        const packageId = ids[0] || '';
        const trace = scrapeLogisticsFromPanel();
        pkgs = [{
          expressNo,
          expressCompany: isSfExpressNo(expressNo) ? '顺丰' : '',
          packageId,
          orderId: packageId,
          primary: true,
          ...(trace ? { lastTrace: trace } : {}),
        }];
        if (packageId) indexPackageById(uid, pkgs[0]);
      }
    }
    return finalizePackagesForDisplay(pkgs, uid);
  }

  function buildCardRowsFromPackages(pkgs, cfg) {
    return (pkgs || []).map((pkg) => {
      const no = String(pkg.expressNo || '').trim();
      if (!isSfExpressNo(no)) {
        return { pkg, fee: makeNonSfFeeResult(no) };
      }
      const ck = feeCacheKey(cfg, no);
      const cached = expressCache.get(ck);
      return { pkg, fee: cached || null };
    });
  }

  function paintBuyerPanelFromLiveDom(buyerUserId, buyerNick) {
    if (!bodyEl || !isPanelExpanded()) return false;
    const uid = String(buyerUserId || '').trim();
    if (!uid) return false;
    const pkgs = collectPackagesFromLivePanel(uid);
    const displayPkgs = (pkgs || []).filter((p) => String(p.expressNo || '').trim());
    if (!displayPkgs.length) return false;
    const cfg = loadConfig();
    const cards = buildCardRowsFromPackages(displayPkgs, cfg);
    lastRenderedCardRows = cards;
    bodyEl.innerHTML = renderPanelCards(
      resolveDisplayNick(buyerNick),
      uid,
      cards,
      Date.now(),
      { fromCache: true },
    );
    patchTraceDisplay();
    return true;
  }

  function stopOrderPanelWatch() {
    clearTimeout(orderPanelWatchTimer);
    orderPanelWatchTimer = null;
  }

  function watchOrderPanelAfterSwitch(buyerUserId, buyerNick) {
    stopOrderPanelWatch();
    const uid = String(buyerUserId || '').trim();
    if (!uid || !isPanelExpanded()) return;
    const startedAt = Date.now();
    const tick = () => {
      orderPanelWatchTimer = null;
      if (lastActivatedBuyerId !== uid || !isPanelExpanded()) return;
      if (paintBuyerPanelFromCache(uid, buyerNick) || paintBuyerPanelFromLiveDom(uid, buyerNick)) {
        void refreshPanel({
          preferCache: true,
          reopen: false,
          waitForData: false,
          background: true,
        });
        return;
      }
      if (Date.now() - startedAt < 2400) {
        orderPanelWatchTimer = setTimeout(tick, 45);
      } else {
        void refreshPanel({ preferCache: true, reopen: false, waitForData: false });
      }
    };
    tick();
  }

  function countLoadedOrderExpress(buyerUserId, visibleIds) {
    const uid = String(buyerUserId || '').trim();
    let count = 0;
    for (const packageId of visibleIds) {
      const fromId = buyerPackageById.get(pkgByIdKey(uid, packageId));
      if (fromId?.expressNo) {
        count += 1;
        continue;
      }
      const card = findCardByPackageId(packageId);
      if (extractExpressFromCardLogistics(card).expressNo) count += 1;
    }
    return count;
  }

  function bootstrapBuyerFromOrderPanel() {
    if (activeBuyer.buyerUserId) return;
    const visibleIds = getVisibleOrderPackageIds();
    if (!visibleIds.length) return;
    const card = findCardByPackageId(visibleIds[0]);
    if (!card) return;
    try {
      card.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    } catch {
      /* ignore */
    }
    const clickTarget = card.querySelector('.order-card-header')
      || card.querySelector('.order-card-title')
      || card.querySelector('.order-card-title-id')
      || card;
    try {
      clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      clickTarget.click?.();
    } catch {
      /* ignore */
    }
  }

  async function waitForBuyerUserId(maxMs = 2400) {
    let clicked = false;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (activeBuyer.buyerUserId) return activeBuyer.buyerUserId;
      if (!clicked) {
        bootstrapBuyerFromOrderPanel();
        clicked = true;
      }
      await sleep(200);
    }
    return activeBuyer.buyerUserId || '';
  }

  function findCardByPackageId(packageId) {
    if (!packageId) return null;
    const idx = rebuildOrderDomCache();
    const card = idx.map.get(String(packageId).trim());
    if (card) return card;
    const root = orderPanelRoot();
    if (root && (root.innerText || '').includes(packageId)) return root;
    return null;
  }

  function extractExpressFromCardLogistics(card) {
    if (!card) return { expressNo: '', expressCompany: '' };
    const logistics = card.querySelector('.delivery-row-logistics, .logistics-box');
    if (!logistics) return { expressNo: '', expressCompany: '' };
    const text = logistics.innerText || '';
    const m = text.match(/\b([A-Z]{1,4}\d{10,20})\b/i);
    if (!m) return { expressNo: '', expressCompany: '' };
    const expressNo = m[1].toUpperCase();
    const companyMatch = text.match(/(顺丰速运|顺丰|圆通|中通|韵达|申通|极兔|京东|EMS|邮政|德邦)/);
    return { expressNo, expressCompany: companyMatch ? companyMatch[1] : '' };
  }

  function extractSfFromCardLogistics(card) {
    const { expressNo } = extractExpressFromCardLogistics(card);
    return isSfExpressNo(expressNo) ? expressNo : '';
  }

  function parseQianfanDateTime(s) {
    const m = String(s || '').trim().match(/(\d{4})[/-](\d{2})[/-](\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0),
    );
    const ms = d.getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  function parseApiTimeValue(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
      const n = v > 0 && v < 1e12 ? v * 1000 : v;
      return Number.isFinite(n) ? n : null;
    }
    return parseQianfanDateTime(String(v));
  }

  function formatQianfanDateTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function evalAfterSale7Days(applyTimeMs) {
    if (!applyTimeMs) return null;
    const daysPassed = (Date.now() - applyTimeMs) / 86400000;
    const over7Days = daysPassed > AFTER_SALE_WINDOW_DAYS;
    return {
      daysPassed: Math.floor(daysPassed * 10) / 10,
      over7Days,
      label: over7Days ? `已超过${AFTER_SALE_WINDOW_DAYS}天` : `未超过${AFTER_SALE_WINDOW_DAYS}天`,
    };
  }

  function evalRefundLossRisk({ actualPayAmount, refundApplyAmount, refundActualAmount, shippingDeductYuan } = {}) {
    const pay = parseMoneyYuan(actualPayAmount);
    const apply = parseMoneyYuan(refundApplyAmount);
    const refunded = parseMoneyYuan(refundActualAmount);
    const refundAmt = apply ?? refunded;
    if (pay == null || refundAmt == null) return null;

    const expectedDeduct = resolveShippingDeductYuan(loadConfig());
    const shippingDeduct = Number.isFinite(Number(shippingDeductYuan))
      ? Number(shippingDeductYuan)
      : expectedDeduct;
    const tolerance = 0.02;
    const deducted = Math.round((pay - refundAmt) * 100) / 100;
    const isFullRefund = refundAmt >= pay - tolerance;
    const underDeducted = deducted < shippingDeduct - tolerance;
    const extraRefund = Math.max(0, Math.round((shippingDeduct - deducted) * 100) / 100);

    let level = 'ok';
    let label = `已扣运费 ${money(deducted)}，符合不包邮扣 ${money(shippingDeduct)} 预期`;
    if (isFullRefund) {
      level = 'danger';
      label = `全额退款（申请 ${money(refundAmt)} = 实付 ${money(pay)}），未扣运费，发件顺丰成本必亏`;
    } else if (underDeducted) {
      level = deducted <= 0 ? 'danger' : 'warn';
      label = `运费扣减不足：应扣约 ${money(shippingDeduct)}，实际仅扣 ${money(deducted)}${extraRefund > 0 ? `，约多退 ${money(extraRefund)}` : ''}`;
    }

    return {
      actualPayAmount: pay,
      refundAmount: refundAmt,
      refundApplyAmount: apply,
      refundActualAmount: refunded,
      deducted,
      expectedDeduct: shippingDeduct,
      isFullRefund,
      underDeducted,
      extraRefund,
      level,
      label,
    };
  }

  function normalizeAfterSale(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const applyTimeMs = parseApiTimeValue(raw.applyTimeMs ?? raw.apply_time ?? raw.applyTime);
    const applyTimeText = String(raw.applyTimeText || raw.apply_time_str || '').trim()
      || (applyTimeMs ? formatQianfanDateTime(applyTimeMs) : '');
    const type = String(raw.type || raw.returns_type || raw.return_type || '').trim();
    const status = String(raw.status || raw.status_name || raw.returns_status || '').trim();
    const refundApplyAmount = parseMoneyYuan(
      raw.refundApplyAmount ?? raw.apply_amount ?? raw.applyAmount
      ?? raw.returns_apply_amount ?? raw.refund_apply_amount ?? raw.request_amount,
    );
    const refundActualAmount = parseMoneyYuan(
      raw.refundActualAmount ?? raw.refund_amount ?? raw.refundAmount
      ?? raw.actual_refund_amount ?? raw.refunded_amount ?? raw.return_amount,
    );
    if (!applyTimeMs && !type && !status && !raw.returnsId && refundApplyAmount == null && refundActualAmount == null) {
      return null;
    }
    return {
      type: type || (/(退|售后)/.test(status) ? status.split('|')[0].trim() : '售后'),
      status,
      applyTimeMs: applyTimeMs || parseQianfanDateTime(applyTimeText),
      applyTimeText,
      returnsId: String(raw.returnsId || raw.returns_id || raw.return_id || raw.after_sale_id || '').trim(),
      reason: String(raw.reason || raw.returns_reason || raw.after_sale_reason || '').trim(),
      refundApplyAmount,
      refundActualAmount,
    };
  }

  function pickOrderAmountsFromNode(node) {
    if (!node || typeof node !== 'object') return {};
    const actualPayAmount = parseMoneyYuan(
      node.customer_pay_amount ?? node.customerPayAmount ?? node.actual_pay_amount
      ?? node.pay_amount ?? node.deal_price ?? node.dealPrice ?? node.total_pay_amount,
    );
    return actualPayAmount == null ? {} : { actualPayAmount };
  }

  function extractOrderAmountsFromCard(card) {
    if (!card) return {};
    const text = card.innerText || '';
    const payMatches = [...text.matchAll(/实付\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/g)];
    const payMatch = payMatches.length ? payMatches[payMatches.length - 1] : null;
    const actualPayAmount = payMatch ? parseMoneyYuan(payMatch[1]) : null;
    return actualPayAmount == null ? {} : { actualPayAmount };
  }

  function extractAfterSaleFromCard(card) {
    if (!card) return null;
    const box = card.querySelector('.after-sale-box, .sku-after-sale');
    const text = (box || card).innerText || card.innerText || '';
    if (!box && !cardHasAfterSaleSignals(card)) return null;
    const statusText = (card.querySelector('.sku-after-sale-status')?.textContent || '').trim();
    const typeMatch = statusText.match(/(退货|退款|换货)/) || text.match(/(退货|退款|换货)/);
    const applyTimeMatch = text.match(/申请时间\s*(\d{4}[/-]\d{2}[/-]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/);
    const applyTimeText = applyTimeMatch ? applyTimeMatch[1].trim() : '';
    const reasonMatch = text.match(/售后原因\s*([^\n申请]+)/);
    const refundApplyMatch = text.match(/申请金额\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)/);
    const refundDoneMatch = text.match(/(\d+(?:\.\d{1,2})?)元已退款成功/);
    return normalizeAfterSale({
      type: typeMatch ? typeMatch[1] : '售后',
      status: statusText,
      applyTimeText,
      returnsId: (text.match(/售后编号\s*(R\d+)/) || [])[1] || '',
      reason: reasonMatch ? reasonMatch[1].trim() : '',
      refundApplyAmount: refundApplyMatch ? refundApplyMatch[1] : null,
      refundActualAmount: refundDoneMatch ? refundDoneMatch[1] : null,
    });
  }

  function pickAfterSaleFromData(data) {
    if (!data || typeof data !== 'object') return null;
    const lists = [
      data.return_info, data.returnInfo, data.returns_info, data.refund_info, data.after_sale_info,
      data.returns_list, data.return_list, data.after_sale_list, data.refund_list,
    ];
    for (const list of lists) {
      const arr = Array.isArray(list) ? list : (list && typeof list === 'object' ? [list] : []);
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const normalized = normalizeAfterSale({
          type: item.returns_type || item.return_type || item.type || item.after_sale_type,
          status: item.status_name || item.status || item.returns_status || item.after_sale_status,
          apply_time: item.apply_time || item.applyTime || item.create_time || item.createTime
            || item.returns_apply_time || item.refund_apply_time,
          returns_id: item.returns_id || item.return_id || item.after_sale_id,
          reason: item.reason || item.returns_reason || item.after_sale_reason,
          apply_amount: item.apply_amount ?? item.applyAmount ?? item.returns_apply_amount
            ?? item.refund_apply_amount ?? item.request_amount ?? item.refund_apply_price,
          refund_amount: item.refund_amount ?? item.refundAmount ?? item.actual_refund_amount
            ?? item.refunded_amount ?? item.return_amount ?? item.refund_price,
        });
        if (normalized?.refundApplyAmount != null || normalized?.refundActualAmount != null) return normalized;
        if (normalized) return normalized;
      }
    }
    const direct = normalizeAfterSale({
      type: data.returns_type || data.return_type || data.after_sale_type,
      status: data.after_sale_status || data.csstatus || data.erp_status_str,
      apply_time: data.apply_time || data.after_sale_apply_time || data.refund_apply_time || data.returns_apply_time,
      apply_amount: data.apply_amount ?? data.returns_apply_amount ?? data.refund_apply_amount,
      refund_amount: data.refund_amount ?? data.actual_refund_amount ?? data.refunded_amount,
    });
    if (direct?.refundApplyAmount != null || direct?.refundActualAmount != null) return direct;
    const statusHint = String(data.after_sale_status || data.csstatus || data.erp_status_str || '').trim();
    if (/退款|退货|换货|售后/.test(statusHint)) {
      return normalizeAfterSale({
        type: statusHint,
        status: statusHint,
        apply_time: data.apply_time || data.after_sale_apply_time || data.refund_apply_time,
      });
    }
    return direct;
  }

  function pickAfterSaleFromNode(node) {
    if (!node || typeof node !== 'object') return null;
    const status = String(
      node.after_sale_status || node.afterSaleStatus || node.returns_status
      || node.refund_status || node.status_name || '',
    ).trim();
    if (!/退款|退货|换货|售后/.test(status) && !node.return_info && !node.returnInfo) return null;
    const fromList = pickAfterSaleFromData(node);
    if (fromList) return fromList;
    return normalizeAfterSale({
      type: node.returns_type || node.return_type || status,
      status,
      apply_time: node.apply_time || node.applyTime || node.returns_apply_time
        || node.refund_apply_time || node.after_sale_apply_time || node.create_time,
      returns_id: node.returns_id || node.return_id || node.after_sale_id,
      reason: node.reason || node.returns_reason,
      apply_amount: node.apply_amount ?? node.applyAmount ?? node.returns_apply_amount ?? node.refund_apply_amount,
      refund_amount: node.refund_amount ?? node.refundAmount ?? node.actual_refund_amount ?? node.refunded_amount,
    });
  }

  function pickOrderTimesFromNode(node) {
    return pickFirstLogisticsTraceTimeFromNode(node) || {};
  }

  function extractOrderTimesFromCard(card) {
    if (!card) return {};
    const fromLogistics = scrapeShipTimeFromLogisticsBox(
      card.querySelector('.logistics-box, .delivery-row-logistics'),
    );
    if (fromLogistics) return fromLogistics;
    const text = card.innerText || '';
    const shipMatch = text.match(/(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/);
    if (!shipMatch) return {};
    return buildShipTimeResult(parseQianfanDateTime(shipMatch[1]), shipMatch[1]) || {};
  }

  function pickOrderMetaFromNode(node) {
    return { ...pickOrderAmountsFromNode(node), ...pickOrderTimesFromNode(node) };
  }

  function extractOrderMetaFromCard(card) {
    return { ...extractOrderAmountsFromCard(card), ...extractOrderTimesFromCard(card) };
  }

  function mergeOrderMetaIntoPkg(pkg, meta) {
    if (!meta || typeof meta !== 'object') return pkg;
    let out = { ...pkg };
    const actualPayAmount = parseMoneyYuan(meta.actualPayAmount ?? out.actualPayAmount);
    if (actualPayAmount != null) out = { ...out, actualPayAmount };
    const shipTimeMs = meta.shipTimeMs ?? out.shipTimeMs;
    const shipTimeText = String(meta.shipTimeText ?? out.shipTimeText ?? '').trim();
    if (shipTimeMs || shipTimeText) {
      out = {
        ...out,
        shipTimeMs: shipTimeMs || out.shipTimeMs || null,
        shipTimeText: shipTimeText || out.shipTimeText || '',
      };
    }
    return out;
  }

  function mergeOrderAmountsIntoPkg(pkg, amounts) {
    return mergeOrderMetaIntoPkg(pkg, amounts);
  }

  function mergeAfterSaleIntoPkg(pkg, afterSale) {
    const normalized = normalizeAfterSale(afterSale);
    if (!normalized) return pkg;
    return { ...pkg, afterSale: normalized };
  }

  function resolveAfterSaleForPackage(buyerUserId, packageId) {
    const uid = String(buyerUserId || '').trim();
    const pid = String(packageId || '').trim();
    if (!pid) return null;
    const fromDom = extractAfterSaleFromCard(findCardByPackageId(pid));
    if (fromDom?.applyTimeMs || fromDom?.refundApplyAmount != null || fromDom?.refundActualAmount != null) {
      return fromDom;
    }
    if (uid) {
      const cached = buyerPackageById.get(pkgByIdKey(uid, pid))?.afterSale;
      if (cached?.applyTimeMs || cached?.refundApplyAmount != null || cached?.refundActualAmount != null) {
        return normalizeAfterSale(cached);
      }
    }
    return fromDom;
  }

  function resolveActualPayAmount(buyerUserId, packageId) {
    const uid = String(buyerUserId || '').trim();
    const pid = String(packageId || '').trim();
    if (uid && pid) {
      const cached = buyerPackageById.get(pkgByIdKey(uid, pid))?.actualPayAmount;
      if (cached != null) return parseMoneyYuan(cached);
    }
    return extractOrderAmountsFromCard(findCardByPackageId(pid)).actualPayAmount ?? null;
  }

  function resolveRefundRiskEval(buyerUserId, packageId) {
    const afterSale = resolveAfterSaleForPackage(buyerUserId, packageId);
    if (!afterSale) return null;
    const refundApplyAmount = afterSale.refundApplyAmount;
    const refundActualAmount = afterSale.refundActualAmount;
    if (refundApplyAmount == null && refundActualAmount == null) return null;
    return evalRefundLossRisk({
      actualPayAmount: resolveActualPayAmount(buyerUserId, packageId),
      refundApplyAmount,
      refundActualAmount,
    });
  }

  function resolveShipTimeForPackage(buyerUserId, packageId) {
    const uid = String(buyerUserId || '').trim();
    const pid = String(packageId || '').trim();
    if (!pid) return { shipTimeMs: null, shipTimeText: '' };
    const card = findCardByPackageId(pid);
    const cached = uid ? (buyerPackageById.get(pkgByIdKey(uid, pid)) || {}) : {};
    const pkgNo = String(cached.expressNo || extractExpressFromCardLogistics(card).expressNo || '').trim().toUpperCase();
    const panelNo = scrapePanelLogisticsExpressNo();

    const fromCardLogistics = scrapeShipTimeFromLogisticsBox(
      card?.querySelector('.logistics-box, .delivery-row-logistics'),
    );
    if (fromCardLogistics?.shipTimeMs || fromCardLogistics?.shipTimeText) return fromCardLogistics;

    if (!panelNo || !pkgNo || panelNo === pkgNo) {
      const root = orderPanelRoot();
      const fromPanel = scrapeShipTimeFromLogisticsBox(
        root?.querySelector('.logistics-box, .delivery-row-logistics'),
      );
      if ((fromPanel?.shipTimeMs || fromPanel?.shipTimeText) && pkgNo && panelNo === pkgNo) {
        return fromPanel;
      }
    }

    if (cached.shipTimeMs || cached.shipTimeText) {
      return { shipTimeMs: cached.shipTimeMs || null, shipTimeText: cached.shipTimeText || '' };
    }

    return extractOrderTimesFromCard(card);
  }

  function formatDisplayTime(ms, text) {
    const t = String(text || '').trim();
    if (t) return t;
    return ms ? formatQianfanDateTime(ms) : '—';
  }

  function getDisplayPackageIds(buyerUserId, cards) {
    const visible = getVisibleOrderPackageIds();
    if (visible.length) return visible;
    const fromCards = (cards || [])
      .map((c) => String(c.pkg?.packageId || c.pkg?.orderId || '').trim())
      .filter(Boolean);
    if (fromCards.length) return fromCards;
    return getPackageIdsForBuyer(buyerUserId);
  }

  function mergeCardsByPackageId(cards) {
    const map = new Map();
    for (const row of cards || []) {
      const pid = String(row.pkg?.packageId || row.pkg?.orderId || '').trim();
      if (pid) map.set(pid, row);
    }
    return map;
  }

  function renderDetailRow(label, valueHtml, opts = {}) {
    const warn = opts.warn ? ' qsf-kv-warn' : '';
    const muted = opts.muted ? ' qsf-kv-muted' : '';
    return `<div class="qsf-kv${warn}${muted}"><span class="qsf-kv-k">${esc(label)}</span><span class="qsf-kv-v">${valueHtml}</span></div>`;
  }

  function resolveCardFieldsFast(buyerUserId, packageId, pkg, fee) {
    const pid = String(packageId || '').trim();
    const cached = buyerPackageById.get(pkgByIdKey(buyerUserId, pid)) || {};
    const merged = { ...cached, ...pkg };
    const card = findCardByPackageId(pid);
    if (!merged.expressNo && card) {
      const ext = extractExpressFromCardLogistics(card);
      if (ext.expressNo) {
        merged.expressNo = ext.expressNo;
        merged.expressCompany = ext.expressCompany || merged.expressCompany;
      }
    }
    if (!merged.shipTimeMs && !merged.shipTimeText && card) {
      const ship = scrapeShipTimeFromLogisticsBox(
        card.querySelector('.logistics-box, .delivery-row-logistics'),
      );
      if (ship?.shipTimeMs || ship?.shipTimeText) {
        merged.shipTimeMs = ship.shipTimeMs || null;
        merged.shipTimeText = ship.shipTimeText || '';
      }
    }
    if (!merged.actualPayAmount && card) {
      const amt = extractOrderMetaFromCard(card).actualPayAmount;
      if (amt != null) merged.actualPayAmount = amt;
    }
    const afterSale = normalizeAfterSale(merged.afterSale)
      || extractAfterSaleFromCard(card)
      || null;
    const ship = {
      shipTimeMs: merged.shipTimeMs || null,
      shipTimeText: merged.shipTimeText || '',
    };
    const actualPay = merged.actualPayAmount != null ? parseMoneyYuan(merged.actualPayAmount) : null;
    let evalRisk = null;
    if (afterSale && (afterSale.refundApplyAmount != null || afterSale.refundActualAmount != null) && actualPay != null) {
      evalRisk = evalRefundLossRisk({
        actualPayAmount: actualPay,
        refundApplyAmount: afterSale.refundApplyAmount,
        refundActualAmount: afterSale.refundActualAmount,
      });
    }
    return { merged, afterSale, ship, actualPay, evalRisk, fee };
  }

  function renderUnifiedOrderCard(buyerUserId, packageId, data, idx, total, opts = {}) {
    const pid = String(packageId || '').trim();
    if (!pid) return '';
    const fast = opts.fast === true;
    const pkg = data?.pkg || buyerPackageById.get(pkgByIdKey(buyerUserId, pid)) || {};
    const fee = data?.fee;
    let cardPkg = pkg;
    let afterSale;
    let ship;
    let actualPay;
    let evalRisk;
    if (fast) {
      let merged;
      ({ merged, afterSale, ship, actualPay, evalRisk } = resolveCardFieldsFast(buyerUserId, pid, pkg, fee));
      cardPkg = merged;
      if (!cardPkg.expressNo && buyerUserId) {
        void fetchPackageDetailFromApi(pid, buyerUserId);
      }
    } else {
      afterSale = resolveAfterSaleForPackage(buyerUserId, pid);
      ship = resolveShipTimeForPackage(buyerUserId, pid);
      actualPay = resolveActualPayAmount(buyerUserId, pid);
      evalRisk = resolveRefundRiskEval(buyerUserId, pid);
      if (!pkg.expressNo && !cardPkg.expressNo && buyerUserId) {
        void fetchPackageDetailFromApi(pid, buyerUserId);
      }
    }
    const badge = total > 1 ? `订单 ${idx + 1}/${total}` : '订单';

    let html = `<div class="qsf-order-card">`;
    html += `<div class="qsf-order-card-head">`;
    html += `<span class="qsf-order-card-badge">${esc(badge)}</span>`;
    html += `<span class="qsf-order-card-id" title="${esc(pid)}">${esc(pid)}</span>`;
    html += `</div>`;
    html += `<div class="qsf-order-card-body">`;

    html += renderDetailRow('订单号', `<span class="qsf-mono">${esc(pid)}</span>`);
    html += renderDetailRow(
      '发货时间',
      esc(formatDisplayTime(ship.shipTimeMs, ship.shipTimeText)),
    );

    if (afterSale?.applyTimeMs || afterSale?.applyTimeText) {
      const applyText = formatDisplayTime(afterSale.applyTimeMs, afterSale.applyTimeText);
      const eval7 = afterSale.applyTimeMs ? evalAfterSale7Days(afterSale.applyTimeMs) : null;
      const suffix = eval7 ? ` · ${eval7.daysPassed}天 · ${eval7.label}` : '';
      html += renderDetailRow(
        '申请退款',
        esc(`${applyText}${suffix}`),
        { warn: Boolean(eval7?.over7Days) },
      );
    } else {
      html += renderDetailRow('申请退款', '<span class="qsf-muted">—</span>', { muted: true });
    }

    if (actualPay != null) {
      html += renderDetailRow('实付金额', `<span class="qsf-money">${esc(money(actualPay))}</span>`);
    }

    if (evalRisk) {
      const cls = evalRisk.level === 'danger'
        ? 'qsf-refund-danger'
        : evalRisk.level === 'warn'
          ? 'qsf-refund-warn'
          : 'qsf-refund-ok';
      const prefix = evalRisk.level === 'ok' ? '✓' : '⚠';
      html += `<div class="qsf-refund-risk ${cls}">${prefix} 退款 ${money(evalRisk.refundAmount)} · 扣减 ${money(evalRisk.deducted)} · ${esc(evalRisk.label)}</div>`;
    }

    const expressNo = String(cardPkg.expressNo || '').trim();
    const hasLogistics = Boolean(expressNo || fee);
    html += `<div class="qsf-order-card-divider"></div>`;
    html += `<div class="qsf-order-card-subtitle">物流与月结</div>`;

    if (expressNo) {
      const companyPrefix = cardPkg.expressCompany && !isSfExpressNo(expressNo)
        ? `${esc(cardPkg.expressCompany)} `
        : '';
      html += renderDetailRow('发货单号', `<span class="qsf-mono">${companyPrefix}${esc(expressNo)}</span>`);
    } else {
      html += renderDetailRow('发货单号', '<span class="qsf-muted">暂无</span>', { muted: true });
    }

    if (fee) {
      const feePart = renderWaybillFeeAmount(fee);
      const feeVal = feePart.hint && (fee.skipped || !fee.ok)
        ? `<span class="${feePart.cls}" title="${esc(feePart.hint)}">${esc(feePart.text)}</span>`
        : `<span class="${feePart.cls}">${esc(feePart.text)}</span>`;
      html += renderDetailRow('月结扣费', feeVal);
      if (feePart.hint && (fee.skipped || !fee.ok)) {
        html += `<div class="qsf-hint qsf-card-hint">${esc(feePart.hint)}</div>`;
      }
      if (fee.ok) {
        html += renderFeeCardMeta(fee, pkg);
        for (const line of fee.fees || []) {
          html += `<div class="qsf-fee-line"><span>${esc(line.name)}${line.settlement ? ` (${esc(line.settlement)})` : ''}</span><span>${money(line.amount)}</span></div>`;
        }
      }
    } else if (expressNo) {
      html += renderDetailRow('月结扣费', '<span class="qsf-muted">查询中…</span>', { muted: true });
    } else {
      html += renderDetailRow('月结扣费', '<span class="qsf-muted">—</span>', { muted: true });
    }

    if (pkg.lastTrace && hasLogistics) {
      html += `<div class="qsf-card-trace">${esc(pkg.lastTrace)}</div>`;
    }
    if (pkg.apiError) {
      html += `<div class="qsf-hint qsf-card-hint">${esc(pkg.apiError)}</div>`;
    }

    html += `</div></div>`;
    return html;
  }

  function renderOrderCardsList(buyerUserId, cards) {
    const uid = String(buyerUserId || '').trim();
    if (!uid) return '';
    const packageIds = getDisplayPackageIds(uid, cards);
    if (!packageIds.length) return '';
    const cardMap = mergeCardsByPackageId(cards);
    const useFast = packageIds.length >= RENDER_FAST_DOM_THRESHOLD;
    let html = `<div class="qsf-order-list">`;
    for (let i = 0; i < packageIds.length; i += 1) {
      html += renderUnifiedOrderCard(uid, packageIds[i], cardMap.get(packageIds[i]), i, packageIds.length, { fast: useFast });
    }
    html += `</div>`;
    return html;
  }

  function isRelevantToActiveBuyer(buyerUserId, packageId) {
    if (!activeBuyer.buyerUserId) return false;
    if (orderPanelStale) return Boolean(buyerUserId && buyerUserId === activeBuyer.buyerUserId);
    if (buyerUserId && buyerUserId === activeBuyer.buyerUserId) return true;
    if (packageId && getVisibleOrderPackageIds().includes(packageId)) return true;
    return false;
  }

  function indexPackageById(buyerUserId, pkg) {
    const uid = String(buyerUserId || '').trim();
    const packageId = String(pkg.packageId || pkg.orderId || '').trim();
    if (!uid || !packageId) return;
    const key = pkgByIdKey(uid, packageId);
    const prev = buyerPackageById.get(key) || {};
    const merged = {
      ...prev,
      ...pkg,
      packageId,
      orderId: packageId,
      orderIds: [packageId],
    };
    buyerPackageById.set(key, merged);
    if (merged.expressNo && isSfExpressNo(merged.expressNo)) {
      indexPackage(uid, { ...merged, packageId });
    }
    if (uid === activeBuyer.buyerUserId && isPanelExpanded() && afterSaleRefundChanged(prev.afterSale, merged.afterSale)) {
      scheduleRefundPanelPatch();
    }
  }

  function pickExpressFromPackageDetail(data) {
    if (!data || typeof data !== 'object') return { expressNo: '', expressCompany: '' };
    let expressNo = String(
      data.express_number || data.express_no || data.expressNo || data.ship_express_no || '',
    ).trim().toUpperCase();
    let expressCompany = String(
      data.express_company || data.express_company_name || data.expressCompany || '',
    ).trim();
    if (!expressNo && Array.isArray(data.delivery_packages)) {
      for (const dp of data.delivery_packages) {
        if (!dp || typeof dp !== 'object') continue;
        const no = String(dp.express_no || dp.express_number || dp.expressNo || '').trim().toUpperCase();
        if (!no) continue;
        expressNo = no;
        expressCompany = String(
          dp.express_company_name || dp.express_company_code || expressCompany || '',
        ).trim();
        break;
      }
    }
    return { expressNo, expressCompany };
  }

  function ingestPackageDetailEnvelope(json, meta = {}) {
    if (!json || typeof json !== 'object') return { ok: false };
    const data = json.data && typeof json.data === 'object' ? json.data : null;
    if (!data) return { ok: false };
    const urlPid = String(meta.packageId || '').trim();
    const packageId = String(data.package_id || data.packageId || urlPid || '').trim();
    if (!packageId) return { ok: false };
    const userId = String(data.user_id || data.buyer_user_id || '').trim();
    const { expressNo: rawExpress, expressCompany: rawCompany } = pickExpressFromPackageDetail(data);
    const expressNo = rawExpress;
    const expressCompany = rawCompany;
    const orderId = String(data.order_id || data.orderId || packageId).trim();
    const uid = userId
      || String(meta.buyerUserId || '').trim()
      || (activeBuyer.buyerUserId && getVisibleOrderPackageIds().includes(packageId) ? activeBuyer.buyerUserId : '')
      || (isRelevantToActiveBuyer('', packageId) ? activeBuyer.buyerUserId : '');
    if (!uid) return { ok: false };
    if (!userId && meta.buyerUserId && activeBuyer.buyerUserId
      && String(meta.buyerUserId).trim() !== activeBuyer.buyerUserId) return { ok: false };
    const prev = buyerPackageById.get(pkgByIdKey(uid, packageId)) || {};
    const hadExpress = Boolean(prev.expressNo);
    const lastTrace = pickTraceText(data);
    const afterSale = pickAfterSaleFromData(data);
    const orderMeta = pickOrderMetaFromNode(data);
    indexPackageById(uid, mergeOrderMetaIntoPkg(mergeAfterSaleIntoPkg({
      packageId,
      expressNo,
      expressCompany,
      apiError: '',
      ...(lastTrace ? { lastTrace } : {}),
    }, afterSale), orderMeta));
    const nick = String(data.nick_name || data.buyer_nick || data.user_name || scrapeHeaderBuyerNick() || '').trim();
    rememberBuyerIdentity(userId || uid, nick, extractAppCidFromNode(data));
    if (userId && userId !== activeBuyer.buyerUserId) {
      const metaUid = String(meta.buyerUserId || '').trim();
      const visibleIds = getVisibleOrderPackageIds();
      const allowSwitch = metaUid === activeBuyer.buyerUserId
        || visibleIds.includes(packageId)
        || uid === activeBuyer.buyerUserId;
      if (allowSwitch) {
        queueSessionActivation({ buyerUserId: userId, buyerNick: nick, fromOrderPanel: true });
      }
    }
    if (uid === activeBuyer.buyerUserId) maybeClearOrderPanelStale();
    return {
      ok: Boolean(expressNo || afterSale || orderMeta.actualPayAmount != null),
      gotExpress: Boolean(expressNo),
      newExpress: Boolean(expressNo && !hadExpress),
      gotAfterSale: Boolean(afterSale),
    };
  }

  function resolveBuyerTrace(buyerUserId) {
    const domTrace = scrapeLogisticsFromPanel();
    if (domTrace) {
      if (buyerUserId && activeBuyer.buyerUserId === buyerUserId) {
        const pkgs = buyerPackages.get(buyerUserId);
        if (pkgs) {
          for (const pkg of pkgs.values()) {
            indexPackage(buyerUserId, { ...pkg, lastTrace: domTrace });
            break;
          }
        }
      }
      return domTrace;
    }
    return latestTraceForBuyer(buyerUserId);
  }

  function indexPackage(buyerUserId, pkg) {
    const uid = String(buyerUserId || '').trim();
    const no = String(pkg.expressNo || '').trim().toUpperCase();
    if (!uid || !no) return;
    const packageId = String(pkg.packageId || pkg.orderId || '').trim();
    if (!buyerPackages.has(uid)) buyerPackages.set(uid, new Map());
    const prev = buyerPackages.get(uid).get(no) || {};
    const orderIds = packageId
      ? mergeOrderIds(prev.orderIds, packageId)
      : mergeOrderIds(prev.orderIds, prev.orderId, pkg.orderId);
    buyerPackages.get(uid).set(no, {
      ...prev,
      ...pkg,
      expressNo: no,
      packageId: packageId || prev.packageId || '',
      orderId: packageId || prev.orderId || pkg.orderId || '',
      orderIds,
      lastTrace: pkg.lastTrace ? pkg.lastTrace : (prev.lastTrace || ''),
    });
  }

  function latestTraceForBuyer(buyerUserId) {
    const uid = String(buyerUserId || '').trim();
    if (!uid || !buyerPackages.has(uid)) return '';
    const panelNo = scrapePanelLogisticsExpressNo();
    if (panelNo) {
      const hit = buyerPackages.get(uid).get(panelNo);
      if (hit?.lastTrace) return hit.lastTrace;
    }
    const visibleIds = getVisibleOrderPackageIds();
    for (const pid of visibleIds) {
      const cached = buyerPackageById.get(pkgByIdKey(uid, pid));
      if (cached?.lastTrace) return cached.lastTrace;
    }
    let last = '';
    for (const pkg of buyerPackages.get(uid).values()) {
      if (pkg.lastTrace) last = pkg.lastTrace;
    }
    return last;
  }

  function walkJson(obj, fn, depth = 0, maxDepth = 14) {
    if (!obj || depth > maxDepth) return;
    if (Array.isArray(obj)) {
      for (const item of obj) walkJson(item, fn, depth + 1, maxDepth);
      return;
    }
    if (typeof obj === 'object') {
      fn(obj);
      for (const v of Object.values(obj)) walkJson(v, fn, depth + 1, maxDepth);
    }
  }

  function shouldProcessNetworkIngest() {
    return Boolean(isPanelExpanded() || isPanelPinned());
  }

  function isHighFrequencyChatUrl(url) {
    const u = String(url || '');
    return /\/impaas\/|message-list|messagelist|singlechat|open.?session|\/chat\/|\/conv\/|heartbeat|typing|unread|presence|online-status|poll/i.test(u);
  }

  function shouldIngestApiUrl(url) {
    const u = String(url || '');
    if (!u || /sf-express\.com/i.test(u)) return false;
    if (!/xiaohongshu/i.test(u)) return false;
    if (isHighFrequencyChatUrl(u)) return false;
    return /search-list/i.test(u)
      || /\/package\/[^/?#]+\/detail/i.test(u)
      || /\/api\/edith\/(package|order)/i.test(u)
      || /\/api\/edith\/logistics\//i.test(u);
  }

  function shouldWalkJsonUrl(url) {
    const u = String(url || '');
    if (!shouldIngestApiUrl(u)) return false;
    if (/search-list/i.test(u)) return false;
    if (/\/package\/[^/?#]+\/detail/i.test(u)) return false;
    return /\/api\/edith\/(package|order|logistics)/i.test(u);
  }

  function enqueueIngestJson(json, meta) {
    if (!shouldProcessNetworkIngest()) return;
    ingestQueue.push({ json, meta });
    if (ingestFlushTimer) return;
    ingestFlushTimer = setTimeout(flushIngestQueue, 16);
  }

  function flushIngestQueue() {
    ingestFlushTimer = null;
    const batch = ingestQueue.splice(0, INGEST_BATCH_MAX);
    for (const item of batch) {
      try {
        ingestJsonBody(item.json, item.meta);
      } catch {
        /* ignore */
      }
    }
    if (ingestQueue.length) {
      ingestFlushTimer = setTimeout(flushIngestQueue, 48);
    }
  }

  function scheduleIngestRefresh(reason) {
    if (!activeBuyer.buyerUserId) return;
    if (reason === 'traceOnly') {
      runWhenScrollSettled(() => {
        if (isPanelExpanded()) patchTraceDisplay();
      });
      return;
    }
    if (reason === 'afterSale') {
      runWhenScrollSettled(() => {
        if (isPanelExpanded()) scheduleRefundPanelPatch();
      });
      return;
    }
    if (reason === 'newExpress' && isPanelExpanded()) {
      runWhenScrollSettled(() => {
        if (isUserScrolling()) {
          scheduleIngestRefresh('newExpress');
          return;
        }
        patchOrderCardsSection();
        if (!refreshInFlight) schedulePartialLoadRetry(activeBuyer.buyerUserId);
      });
      return;
    }
  }

  function patchTraceDisplay() {
    if (!bodyEl || !activeBuyer.buyerUserId || isUserScrolling()) return;
    const trace = resolveBuyerTrace(activeBuyer.buyerUserId);
    if (!trace) return;
    const header = bodyEl.querySelector('.qsf-buyer');
    if (header) {
      let el = header.querySelector('.qsf-buyer-trace');
      if (!el) {
        el = document.createElement('div');
        el.className = 'qsf-buyer-trace';
        header.appendChild(el);
      }
      if (el.textContent !== trace) el.textContent = trace;
    }
    bodyEl.querySelectorAll('.qsf-card .qsf-trace').forEach((el) => el.remove());
  }

  function ingestSearchListEnvelope(json) {
    const list = json?.data?.result_list;
    if (!Array.isArray(list) || !list.length) return false;
    for (const item of list) {
      const packageId = String(item.package_id || item.packageId || '').trim();
      const uid = String(item.user_id || item.buyer_user_id || item.buyerUserId || '').trim();
      if (!packageId || !uid) continue;
      const nick = String(
        item.nick_name || item.buyer_nick || item.user_name || item.receiver_name || item.customer_name || '',
      ).trim();
      const appCid = extractAppCidFromNode(item);
      rememberBuyerIdentity(uid, nick, appCid);
      const expressNo = String(
        item.express_number || item.express_no || item.expressNo || item.ship_express_no || '',
      ).trim().toUpperCase();
      indexPackageById(uid, mergeOrderMetaIntoPkg(mergeAfterSaleIntoPkg({
        packageId,
        orderId: String(item.order_id || item.orderId || packageId).trim(),
        ...(expressNo ? { expressNo } : {}),
      }, pickAfterSaleFromNode(item)), pickOrderMetaFromNode(item)));
      if (uid === activeBuyer.buyerUserId) maybeClearOrderPanelStale();
    }
    const headerNick = scrapeHeaderBuyerNick();
    if (headerNick) {
      const uid = resolveBuyerUserIdByNick(headerNick);
      if (uid && uid !== activeBuyer.buyerUserId) {
        queueSessionActivation({ buyerUserId: uid, buyerNick: headerNick, fromSearch: true });
      }
    }
    return true;
  }

  function ingestJsonBody(json, meta = {}) {
    if (!json || typeof json !== 'object') return;
    const reqUrl = String(meta.url || '');
    const urlPid = String(meta.packageId || parsePackageIdFromUrl(reqUrl) || '').trim();
    let refreshReason = null;

    if (/search-list/i.test(reqUrl)) {
      ingestSearchListEnvelope(json);
      return;
    }

    if (/\/package\/[^/?#]+\/detail/i.test(reqUrl) || (urlPid && meta.via)) {
      const ing = ingestPackageDetailEnvelope(json, { ...meta, packageId: urlPid });
      if (ing?.newExpress) refreshReason = 'newExpress';
      else if (ing?.gotAfterSale) refreshReason = 'afterSale';
      else if (ing?.gotExpress) refreshReason = 'newExpress';
      if (refreshReason) scheduleIngestRefresh(refreshReason);
      return;
    }

    if (!shouldWalkJsonUrl(reqUrl)) return;

    const visibleIds = getVisibleOrderPackageIds();
    const walkRoot = json.data && typeof json.data === 'object' ? json.data : json;
    walkJson(walkRoot, (node) => {
      const packageId = String(node.package_id || node.packageId || '').trim();
      if (!packageId) return;
      const buyerUserId = String(node.buyer_user_id || node.buyerUserId || node.user_id || '').trim();
      const expressNo = String(
        node.express_no || node.express_number || node.expressNo || node.ship_express_no || node.tracking_no || '',
      ).trim().toUpperCase();
      const uid = buyerUserId
        || (visibleIds.includes(packageId) && activeBuyer.buyerUserId ? activeBuyer.buyerUserId : '');
      if (!uid || uid !== activeBuyer.buyerUserId) return;

      const afterSaleFromNode = pickAfterSaleFromNode(node);
      const orderMetaFromNode = pickOrderMetaFromNode(node);
      const lastTrace = pickTraceText(node);

      if (afterSaleFromNode || orderMetaFromNode.actualPayAmount != null || orderMetaFromNode.shipTimeMs) {
        indexPackageById(uid, mergeOrderMetaIntoPkg(
          mergeAfterSaleIntoPkg({ packageId, orderId: packageId, ...(lastTrace ? { lastTrace } : {}) }, afterSaleFromNode),
          orderMetaFromNode,
        ));
        if (afterSaleFromNode) {
          const normalized = normalizeAfterSale(afterSaleFromNode);
          if (normalized?.refundApplyAmount != null || normalized?.refundActualAmount != null) {
            refreshReason = 'afterSale';
          }
        }
      }

      if (expressNo) {
        const hadExpress = buyerPackages.get(uid)?.has(expressNo);
        indexPackageById(uid, mergeOrderMetaIntoPkg(
          mergeAfterSaleIntoPkg({
            packageId,
            orderId: packageId,
            expressNo,
            expressCompany: String(node.express_company || node.expressCompanyName || '').trim(),
            ...(lastTrace ? { lastTrace } : {}),
          }, afterSaleFromNode),
          orderMetaFromNode,
        ));
        if (isSfExpressNo(expressNo)) {
          indexPackage(uid, { packageId, orderId: packageId, expressNo, ...(lastTrace ? { lastTrace } : {}) });
          if (!hadExpress) refreshReason = refreshReason || 'newExpress';
        }
      } else if (lastTrace) {
        const prevPkg = buyerPackageById.get(pkgByIdKey(uid, packageId));
        if (prevPkg?.expressNo) {
          indexPackageById(uid, { ...prevPkg, lastTrace });
          refreshReason = refreshReason || 'traceOnly';
        }
      }
    }, 0, 8);
    if (refreshReason) scheduleIngestRefresh(refreshReason);
  }

  function isImpaasMessageListUrl(url) {
    const u = String(url || '');
    return /\/impaas\/message\/user\/list/i.test(u) && !/\/batch/i.test(u);
  }

  function parseHttpRequestBody(body) {
    if (body == null) return null;
    if (typeof body === 'string') {
      const s = body.trim();
      if (!s || (s[0] !== '{' && s[0] !== '[')) return null;
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    }
    if (typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
      return body;
    }
    return null;
  }

  function extractAppCidFromRequestBody(json) {
    if (!json || typeof json !== 'object') return '';
    const direct = String(json.appCid || json.cid || json.data?.appCid || '').trim();
    if (direct.startsWith('$3$')) return direct;
    const list = json.appCids || json.cids || json.data?.appCids;
    if (Array.isArray(list)) {
      for (const c of list) {
        const s = String(c || '').trim();
        if (s.startsWith('$3$')) return s;
      }
    }
    return '';
  }

  function ingestMessageListRequest(url, rawBody) {
    if (!isImpaasMessageListUrl(url)) return;
    const appCid = extractAppCidFromRequestBody(parseHttpRequestBody(rawBody));
    if (!appCid.startsWith('$3$')) return;
    const buyerUserId = uidFromAppCid(appCid);
    if (!buyerUserId) return;
    const captured = { buyerUserId, appCid };
    clearTimeout(messageListTimer);
    messageListTimer = setTimeout(() => {
      if (window.__qfSfFeePanel?.version !== VERSION) return;
      const headerNick = scrapeHeaderBuyerNick();
      const strict = findStrictActiveChatItemEl();
      const activeUid = strict ? uidFromAppCid(getAppCidFromEl(strict)) : '';
      if (activeUid && activeUid !== captured.buyerUserId && headerNick) {
        const headerUid = resolveBuyerUserIdByNick(headerNick) || uidFromAppCid(parseAppCidFromPageUrl());
        if (headerUid === captured.buyerUserId) {
          /* 浏览器/插件跳转：左侧会话未选中，以 message/list 为准 */
        } else if (headerUid && headerUid === activeUid && headerUid !== captured.buyerUserId) {
          return;
        } else if (headerUid && headerUid !== captured.buyerUserId) {
          return;
        } else if (!headerUid) {
          const activeNick = strict ? nickFromChatItem(strict) : '';
          if (activeNick && !nicksRoughlyMatch(headerNick, activeNick)) return;
        }
      }
      queueSessionActivation({
        buyerUserId: captured.buyerUserId,
        appCid: captured.appCid,
        buyerNick: headerNick,
        fromMessageList: true,
      });
    }, 80);
  }

  function hookFetch() {
    if (window.__qfSfFeeFetchHooked) return;
    if (!window.__qfSfFeeNativeFetch) {
      window.__qfSfFeeNativeFetch = window.fetch.bind(window);
    }
    window.__qfSfFeeFetchHooked = true;
    const orig = window.__qfSfFeeNativeFetch;
    window.fetch = async function patchedFetch(input, init) {
      const reqUrl = typeof input === 'string' ? input : input?.url || '';
      try {
        ingestMessageListRequest(reqUrl, init?.body);
      } catch {
        /* ignore */
      }
      const res = await orig(input, init);
      if (/sf-express\.com/i.test(reqUrl)) return res;
      if (!shouldProcessNetworkIngest()) return res;
      try {
        if (!shouldIngestApiUrl(reqUrl)) return res;
        const clone = res.clone();
        const ct = clone.headers.get('content-type') || '';
        if (ct.includes('json') || /xiaohongshu/i.test(reqUrl)) {
          const meta = {
            url: reqUrl,
            packageId: parsePackageIdFromUrl(reqUrl),
            appCid: parseAppCidFromUrl(reqUrl),
          };
          clone.json().then((j) => enqueueIngestJson(j, meta)).catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return res;
    };
  }

  function hookXhr() {
    if (window.__qfSfFeeXhrHooked) return;
    if (!window.__qfSfFeeNativeXhrOpen) {
      window.__qfSfFeeNativeXhrOpen = XMLHttpRequest.prototype.open;
      window.__qfSfFeeNativeXhrSend = XMLHttpRequest.prototype.send;
    }
    window.__qfSfFeeXhrHooked = true;
    const origOpen = window.__qfSfFeeNativeXhrOpen;
    const origSend = window.__qfSfFeeNativeXhrSend;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__qfSfUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function patchedSend(body) {
      try {
        ingestMessageListRequest(this.__qfSfUrl || '', body);
      } catch {
        /* ignore */
      }
      this.addEventListener('load', function onLoad() {
        try {
          if (!shouldProcessNetworkIngest()) return;
          const url = this.__qfSfUrl || '';
          if (!shouldIngestApiUrl(url)) return;
          const meta = {
            url,
            packageId: parsePackageIdFromUrl(url),
            appCid: parseAppCidFromUrl(url),
          };
          if (String(this.responseType) === 'json' && this.response) {
            enqueueIngestJson(this.response, meta);
          } else if (typeof this.responseText === 'string' && this.responseText.startsWith('{')) {
            enqueueIngestJson(JSON.parse(this.responseText), meta);
          }
        } catch {
          /* ignore */
        }
      }, { once: true });
      return origSend.apply(this, arguments);
    };
  }

  function scrapeLogisticsExpressNo() {
    const idx = rebuildOrderDomCache();
    if (idx.primaryNo) return idx.primaryNo;
    const root = orderPanelRoot();
    if (!root) return '';
    const box = root.querySelector('.logistics-box') || root.querySelector('.delivery-row-logistics');
    if (!box) return '';
    const m = (box.innerText || '').match(/\b(SF\d{10,})\b/i);
    return m ? m[1].toUpperCase() : '';
  }

  function sortSfPackages(pkgs) {
    return [...pkgs].sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      if (a.orderId && !b.orderId) return -1;
      if (!a.orderId && b.orderId) return 1;
      return String(a.expressNo || '').localeCompare(String(b.expressNo || ''));
    });
  }

  function ingestOrderCardElement(card, buyerUserId, primaryNoHint) {
    if (!card || !buyerUserId) return;
    if (buyerUserId !== activeBuyer.buyerUserId) return;
    const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    if (!packageId) return;
    const logistics = card.querySelector('.delivery-row-logistics, .logistics-box');
    const { expressNo, expressCompany } = extractExpressFromCardLogistics(card);
    const primaryNo = primaryNoHint || rebuildOrderDomCache().primaryNo || scrapeLogisticsExpressNo();
    indexPackageById(buyerUserId, mergeOrderAmountsIntoPkg(mergeAfterSaleIntoPkg({
      orderId: packageId,
      packageId,
      ...(expressNo ? {
        expressNo,
        expressCompany: expressCompany || (isSfExpressNo(expressNo) ? '顺丰' : ''),
        primary: expressNo === primaryNo,
        lastTrace: scrapeLogisticsFromBox(logistics),
      } : {}),
    }, extractAfterSaleFromCard(card)), extractOrderMetaFromCard(card)));
  }

  async function waitForCardPackageData(buyerUserId, packageId, card, sessionId, timeoutMs = 800) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (sessionId !== undefined && sessionId !== refreshSession) return null;
      const cached = buyerPackageById.get(pkgByIdKey(buyerUserId, packageId));
      if (cached?.expressNo) return cached;
      ingestOrderCardElement(card, buyerUserId);
      if (packageHasCompleteRefundInfo(buyerUserId, packageId)) {
        return buyerPackageById.get(pkgByIdKey(buyerUserId, packageId)) || null;
      }
      const { expressNo, expressCompany } = extractExpressFromCardLogistics(card);
      if (expressNo) {
        const row = {
          expressNo,
          expressCompany: expressCompany || (isSfExpressNo(expressNo) ? '顺丰' : ''),
          packageId,
          orderId: packageId,
        };
        indexPackageById(buyerUserId, row);
        return row;
      }
      await sleep(45);
    }
    ingestOrderCardElement(card, buyerUserId);
    return buyerPackageById.get(pkgByIdKey(buyerUserId, packageId)) || null;
  }

  function packageNeedsDetailPrefetch(buyerUserId, packageId) {
    return packageNeedsOrderDetailPrefetch(buyerUserId, packageId);
  }

  async function prefetchRefundDetailsBackground(buyerUserId, sessionId) {
    const uid = String(buyerUserId || '').trim();
    if (!uid || uid !== activeBuyer.buyerUserId || !isPanelExpanded()) return;
    const ids = getVisibleOrderPackageIds().filter((id) => {
      if (packageHasCompleteRefundInfo(uid, id)) return false;
      const card = findCardByPackageId(id);
      return cardHasAfterSaleSignals(card) || buyerPackageById.get(pkgByIdKey(uid, id))?.afterSale;
    });
    if (!ids.length) return;
    await prefetchPackageDetailsParallel(uid, sessionId, ids.slice(0, 3));
    if (sessionId === refreshSession && uid === activeBuyer.buyerUserId) {
      scheduleRefundPanelPatch();
    }
  }

  function buildPackageDetailProxyUrl(packageId) {
    const pid = encodeURIComponent(String(packageId || '').trim());
    const base = getPackageProxyBase();
    const shopKey = detectCurrentShopKey();
    if (shopKey) return `${base}/package-detail?packageId=${pid}&shopKey=${encodeURIComponent(shopKey)}`;
    const shopTitle = String(document.title || '').replace(/-工作台\s*$/, '').trim();
    if (shopTitle) return `${base}/package-detail?packageId=${pid}&shopTitle=${encodeURIComponent(shopTitle)}`;
    return `${base}/package-detail?packageId=${pid}`;
  }

  async function waitForPackageExpress(buyerUserId, sessionId, packageIds, maxWaitMs = 4000) {
    const uid = String(buyerUserId || '').trim();
    const ids = [...new Set((packageIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!uid || !ids.length) return;
    const deadline = Date.now() + maxWaitMs;
    const missingExpress = () => ids.filter((id) => {
      const cached = buyerPackageById.get(pkgByIdKey(uid, id));
      if (cached?.expressNo) return false;
      const card = findCardByPackageId(id);
      return !extractExpressFromCardLogistics(card).expressNo;
    });
    while (Date.now() < deadline) {
      if (sessionId !== undefined && sessionId !== refreshSession) return;
      if (uid !== activeBuyer.buyerUserId) return;
      const missing = missingExpress();
      if (!missing.length) return;
      await Promise.all(
        missing.slice(0, PKG_PREFETCH_CONCURRENCY).map((id) => fetchPackageDetailFromApi(id, uid)),
      );
      if (packageDetailInflight.size) {
        await Promise.all([...packageDetailInflight.values()].map((p) => p.catch(() => null)));
      }
      if (!missingExpress().length) return;
      await sleep(100);
    }
  }

  async function fetchPackageDetailFromApi(packageId, buyerUserId) {
    const pid = String(packageId || '').trim();
    const uid = String(buyerUserId || activeBuyer.buyerUserId || '').trim();
    if (!pid || !uid || !hasActiveBuyerSession()) return null;
    if (uid !== activeBuyer.buyerUserId) return null;
    if (!packageNeedsDetailPrefetch(uid, pid)) {
      return buyerPackageById.get(pkgByIdKey(uid, pid)) || null;
    }
    const detailKey = pkgDetailKey(uid, pid);
    if (packageDetailInflight.has(detailKey)) return packageDetailInflight.get(detailKey);
    const lastAt = packageDetailFetchedAt.get(detailKey) || 0;
    if (Date.now() - lastAt < PKG_DETAIL_COOLDOWN_MS) {
      return buyerPackageById.get(pkgByIdKey(uid, pid)) || null;
    }

    const job = (async () => {
      const metaBase = { packageId: pid, buyerUserId: uid };
      try {
        const proxyUrl = buildPackageDetailProxyUrl(pid);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const proxyRes = await fetch(proxyUrl);
            const envelope = await proxyRes.json().catch(() => null);
            if (envelope?.ok && envelope.data) {
              const json = { code: 0, data: envelope.data };
              const ing = ingestPackageDetailEnvelope(json, { ...metaBase, url: proxyUrl, via: envelope.via || 'proxy' });
              if (ing?.gotExpress) {
                packageDetailFetchedAt.set(detailKey, Date.now());
                if (ing.newExpress && uid === activeBuyer.buyerUserId) scheduleIngestRefresh('newExpress');
                return envelope.data;
              }
            }
            if (envelope && !envelope.ok && uid === activeBuyer.buyerUserId) {
              indexPackageById(uid, {
                packageId: pid,
                orderId: pid,
                apiError: String(envelope.error || '订单详情 API 失败').slice(0, 120),
              });
            }
            if (envelope && (envelope.status === 401 || envelope.status === 403) && attempt === 0) {
              continue;
            }
            break;
          } catch {
            if (attempt === 0) continue;
          }
        }

        const urls = [
          `https://eva.xiaohongshu.com/api/edith/package/${encodeURIComponent(pid)}/detail`,
          `https://walle.xiaohongshu.com/api/edith/package/${encodeURIComponent(pid)}/detail`,
        ];
        for (const url of urls) {
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) continue;
          const json = await res.json();
          const ing = ingestPackageDetailEnvelope(json, { ...metaBase, url });
          if (ing?.gotExpress) {
            packageDetailFetchedAt.set(detailKey, Date.now());
            if (ing.newExpress && uid === activeBuyer.buyerUserId) scheduleIngestRefresh('newExpress');
            return json?.data || null;
          }
        }
      } catch {
        /* ignore */
      }
      return null;
    })();

    packageDetailInflight.set(detailKey, job);
    try {
      return await job;
    } finally {
      packageDetailInflight.delete(detailKey);
    }
  }

  function packageNeedsShipTimeFromLogistics(buyerUserId, packageId, card) {
    const uid = String(buyerUserId || '').trim();
    const pid = String(packageId || '').trim();
    if (!uid || !pid) return false;
    const cached = buyerPackageById.get(pkgByIdKey(uid, pid)) || {};
    if (cached.shipTimeMs || cached.shipTimeText) return false;
    if (scrapeShipTimeFromLogisticsBox(card?.querySelector('.logistics-box, .delivery-row-logistics'))) {
      return false;
    }
    return Boolean(cached.expressNo || extractExpressFromCardLogistics(card).expressNo);
  }

  async function resolveVisiblePackageIds(buyerUserId, sessionId, maxWaitMs = 350) {
    let ids = getVisibleOrderPackageIds();
    if (ids.length) return ids;
    const cached = getPackageIdsForBuyer(buyerUserId);
    if (cached.length) return cached;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      if (sessionId !== undefined && sessionId !== refreshSession) return [];
      await sleep(40);
      ids = getVisibleOrderPackageIds();
      if (ids.length) return ids;
      const snap = getOrderPanelSnapshot();
      if (snap.empty) return [];
      if (snap.ready && snap.cardCount === 0) return [];
    }
    return getVisibleOrderPackageIds();
  }

  async function prefetchPackageDetailsParallel(buyerUserId, sessionId, packageIds) {
    const uid = String(buyerUserId || '').trim();
    if (!uid || !hasActiveBuyerSession() || uid !== activeBuyer.buyerUserId) return;
    const ids = [...new Set((packageIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    const need = ids.filter((id) => packageNeedsDetailPrefetch(uid, id));
    if (!need.length) return;
    for (let i = 0; i < need.length; i += PKG_PREFETCH_CONCURRENCY) {
      if (sessionId !== undefined && sessionId !== refreshSession) return;
      if (uid !== activeBuyer.buyerUserId) return;
      await Promise.all(need.slice(i, i + PKG_PREFETCH_CONCURRENCY).map((id) => fetchPackageDetailFromApi(id, uid)));
    }
    syncShipTimeFromPanelLogistics(uid);
  }

  async function prefetchVisiblePackageDetails(buyerUserId, sessionId) {
    const uid = String(buyerUserId || '').trim();
    if (!uid || !hasActiveBuyerSession() || uid !== activeBuyer.buyerUserId) return;
    if (canIngestOrderDom()) scrapeOrderCardsFromPanel();
    const ids = getPackageIdsForBuyer(uid);
    await prefetchPackageDetailsParallel(uid, sessionId, ids);
  }

  async function fastCollectPackages(buyerUserId, sessionId, opts = {}) {
    const uid = String(buyerUserId || '').trim();
    if (!uid) return [];

    const quick = tryQuickCollect(uid);
    if (quick !== null) {
      void prefetchRefundDetailsBackground(uid, sessionId);
      return quick;
    }

    const maxWait = opts.fastMode ? 280 : 450;
    let visibleIds = await resolveVisiblePackageIds(uid, sessionId, maxWait);
    if (sessionId !== undefined && sessionId !== refreshSession) return [];

    if (!visibleIds.length) {
      const snap = getOrderPanelSnapshot();
      if (snap.empty || (snap.ready && snap.cardCount === 0)) return [];
    }

    await prefetchPackageDetailsParallel(
      uid,
      sessionId,
      visibleIds.length ? visibleIds : getPackageIdsForBuyer(uid),
    );
    await waitForPackageExpress(
      uid,
      sessionId,
      visibleIds.length ? visibleIds : getPackageIdsForBuyer(uid),
      opts.fastMode ? 2200 : 4500,
    );
    if (canIngestOrderDom()) scrapeOrderCardsFromPanel();
    pruneStalePackagesForBuyer(uid);

    visibleIds = visibleIds.length ? visibleIds : getVisibleOrderPackageIds();
    let loaded = countLoadedOrderExpress(uid, visibleIds);
    if (visibleIds.length && loaded >= visibleIds.length) {
      clearOrderPanelStaleIfReady();
      return collectAllPackages(uid);
    }

    if (!opts.skipClick && !orderPanelStale) {
      await autoLoadOrderCards(uid, sessionId, { apiFirst: true, noClick: true });
      loaded = countLoadedOrderExpress(uid, visibleIds);
      if (visibleIds.length && loaded >= visibleIds.length) {
        clearOrderPanelStaleIfReady();
        return collectAllPackages(uid);
      }
    }

    const deadline = Date.now() + (opts.fastMode ? 900 : 1800);
    while (Date.now() < deadline) {
      if (sessionId !== undefined && sessionId !== refreshSession) return null;
      if (isUserScrolling()) {
        await sleep(120);
        continue;
      }
      if (canIngestOrderDom()) scrapeOrderCardsFromPanel();
      if (!opts.skipClick && hasPendingExpressLoad(uid) && !orderPanelStale) {
        await autoLoadOrderCards(uid, sessionId, { apiFirst: true, onlyPending: true, noClick: true });
      }
      loaded = countLoadedOrderExpress(uid, visibleIds);
      if (visibleIds.length && loaded >= visibleIds.length) break;
      if (!hasPendingExpressLoad(uid)) break;
      await sleep(50);
    }
    clearOrderPanelStaleIfReady();
    return collectAllPackages(uid);
  }

  function cardNeedsExpressLoad(buyerUserId, card, packageId) {
    const cached = buyerPackageById.get(pkgByIdKey(buyerUserId, packageId));
    if (cached?.expressNo) return false;
    return !extractExpressFromCardLogistics(card).expressNo;
  }

  function cardNeedsRefundLoad(buyerUserId, card, packageId) {
    if (packageHasCompleteRefundInfo(buyerUserId, packageId)) return false;
    return cardHasAfterSaleSignals(card);
  }

  function hasPendingExpressLoad(buyerUserId) {
    const idx = rebuildOrderDomCache();
    for (const packageId of idx.ids) {
      const card = idx.map.get(packageId);
      if (card && cardNeedsExpressLoad(buyerUserId, card, packageId)) return true;
    }
    return false;
  }

  async function autoLoadOrderCards(buyerUserId, sessionId, opts = {}) {
    const root = orderPanelRoot();
    if (!root || !buyerUserId || !hasActiveBuyerSession()) return;
    if (!opts.apiFirst && !opts.onlyPending) {
      await prefetchVisiblePackageDetails(buyerUserId, sessionId);
    }
    if (opts.noClick || orderPanelStale || isUserScrolling()) {
      syncShipTimeFromPanelLogistics(buyerUserId);
      return;
    }
    const idx = rebuildOrderDomCache(true);
    const cards = idx.ids.map((id) => idx.map.get(id)).filter(Boolean);
    if (!cards.length) return;
    const pending = cards.filter((card) => {
      const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      if (!packageId) return false;
      if (opts.onlyPending) {
        return cardNeedsExpressLoad(buyerUserId, card, packageId)
          || cardNeedsRefundLoad(buyerUserId, card, packageId);
      }
      return cardNeedsExpressLoad(buyerUserId, card, packageId)
        || packageNeedsShipTimeFromLogistics(buyerUserId, packageId, card)
        || cardNeedsRefundLoad(buyerUserId, card, packageId);
    });
    if (!pending.length) {
      syncShipTimeFromPanelLogistics(buyerUserId);
      return;
    }
    for (const card of pending.slice(0, 8)) {
      if (sessionId !== undefined && sessionId !== refreshSession) return;
      const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      if (!packageId) continue;
      if (!cardNeedsExpressLoad(buyerUserId, card, packageId)
        && !packageNeedsShipTimeFromLogistics(buyerUserId, packageId, card)
        && !cardNeedsRefundLoad(buyerUserId, card, packageId)) {
        continue;
      }
      ingestOrderCardElement(card, buyerUserId);
      try {
        card.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      } catch {
        /* ignore */
      }
      await sleep(20);
      const clickTarget = card.querySelector('.order-card-header')
        || card.querySelector('.order-card-title')
        || card.querySelector('.order-card-title-id')
        || card;
      try {
        clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        clickTarget.click?.();
      } catch {
        /* ignore */
      }
      const hasLogistics = card.querySelector('.delivery-row-logistics, .logistics-box');
      const waitMs = cardNeedsRefundLoad(buyerUserId, card, packageId)
        ? 520
        : (hasLogistics ? 280 : 120);
      await waitForCardPackageData(buyerUserId, packageId, card, sessionId, waitMs);
      syncShipTimeFromPanelLogistics(buyerUserId, packageId);
      ingestOrderCardElement(card, buyerUserId);
    }
    syncShipTimeFromPanelLogistics(buyerUserId);
  }

  function scrapeOrderCardsFromPanel() {
    const root = orderPanelRoot();
    if (!root || !canIngestOrderDom()) return [];
    const idx = rebuildOrderDomCache(true);
    const primaryNo = idx.primaryNo;
    const found = new Map();
    for (const card of idx.map.values()) {
      ingestOrderCardElement(card, activeBuyer.buyerUserId, primaryNo);
      const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      const { expressNo, expressCompany } = extractExpressFromCardLogistics(card);
      if (!expressNo || !packageId) continue;
      found.set(packageId, {
        expressNo,
        expressCompany: expressCompany || (isSfExpressNo(expressNo) ? '顺丰' : ''),
        orderId: packageId,
        packageId,
        primary: expressNo === primaryNo,
        lastTrace: scrapeLogisticsFromBox(card.querySelector('.delivery-row-logistics, .logistics-box')),
      });
    }
    return sortSfPackages([...found.values()]);
  }

  function scrapeDomTrace(root) {
    if (!root) return '';
    const box = root.querySelector('.logistics-box') || root.querySelector('.delivery-row-logistics');
    if (box) return scrapeLogisticsFromPanel();
    return '';
  }

  function collectAllPackages(buyerUserId) {
    const uid = String(buyerUserId || '').trim();
    if (!uid) return [];
    scrapeOrderCardsFromPanel();
    pruneStalePackagesForBuyer(uid);
    const visibleIds = getVisibleOrderPackageIds();
    const primaryNo = scrapeLogisticsExpressNo();
    const result = new Map();

    for (const packageId of visibleIds) {
      const key = pkgByIdKey(uid, packageId);
      const fromId = buyerPackageById.get(key);
      if (fromId?.expressNo) {
        result.set(packageId, {
          ...fromId,
          packageId,
          orderId: packageId,
          primary: fromId.expressNo === primaryNo,
        });
        continue;
      }
      const card = findCardByPackageId(packageId);
      const { expressNo, expressCompany } = extractExpressFromCardLogistics(card);
      if (expressNo) {
        const pkg = {
          expressNo,
          expressCompany: expressCompany || (isSfExpressNo(expressNo) ? '顺丰' : ''),
          packageId,
          orderId: packageId,
          primary: expressNo === primaryNo,
        };
        indexPackageById(uid, pkg);
        result.set(packageId, pkg);
      }
    }

    return finalizePackagesForDisplay([...result.values()], uid);
  }

  function stampFeeCache(entry) {
    return { ...entry, cachedAt: Date.now() };
  }

  async function queryFeesForPackages(sfPkgs, cfg, sessionId, force) {
    const list = sfPkgs || [];
    const results = new Array(list.length);
    let cursor = 0;
    const workers = Math.min(FEE_QUERY_CONCURRENCY, list.length || 1);

    async function worker() {
      while (cursor < list.length) {
        if (sessionId !== refreshSession) return;
        const i = cursor;
        cursor += 1;
        const pkg = list[i];
        if (isSfExpressNo(pkg.expressNo)) {
          const ck = feeCacheKey(cfg, pkg.expressNo);
          if (expressCache.has(ck) && !force) {
            results[i] = { pkg, fee: sanitizeFeeForCache(expressCache.get(ck)) };
            continue;
          }
        }
        const fee = isSfExpressNo(pkg.expressNo)
          ? await querySfWaybillFee(pkg.expressNo, cfg)
          : makeNonSfFeeResult(pkg.expressNo);
        results[i] = { pkg, fee: sanitizeFeeForCache(fee) };
      }
    }

    await Promise.all(Array.from({ length: workers }, () => worker()));
    return results.filter(Boolean);
  }

  // ─── 顺丰清单运费 ───────────────────────────────────────────────────
  async function querySfWaybillFee(expressNo, cfg) {
    const no = String(expressNo || '').trim();
    if (!no) return { ok: false, error: '缺少运单号' };
    if (!isSfExpressNo(no)) return makeNonSfFeeResult(no);
    const ck = feeCacheKey(cfg, no);
    if (expressCache.has(ck)) {
      const cached = expressCache.get(ck);
      if (cached.ok || cached.skipped || cached.apiCode === 'A1004' || cached.apiCode === '8152') {
        return cached;
      }
      if (cached.apiCode === '8148') {
        if (cached.cachedAt && Date.now() - cached.cachedAt < SF_ERR_CACHE_TTL_MS) return cached;
        expressCache.delete(ck);
      } else if (cached.cachedAt && Date.now() - cached.cachedAt < SF_ERR_CACHE_TTL_MS) {
        return cached;
      } else {
        expressCache.delete(ck);
      }
    }
    if (sfFeeInflight.has(ck)) return sfFeeInflight.get(ck);

    const job = (async () => {
      if (!cfg.partnerID || !resolveCheckWord(cfg)) {
        const hint = cfg.sandbox ? '请配置沙箱校验码 checkWordSandbox' : '请配置丰桥 partnerID 与 checkWord';
        return { ok: false, error: `请先在 ⚙ ${hint}` };
      }
      if (!cfg.sandbox && !String(cfg.monthlyCard || '').trim()) {
        return {
          ok: false,
          error: '生产环境需配置顺丰月结卡号（8151）。侧栏 ⚙ → 填入「顺丰月结卡号 monthlyCard」后保存再查。',
          apiCode: '8151',
        };
      }

      const checkWord = resolveCheckWord(cfg);
      const msgData = buildSfWaybillMsgData(cfg, no);
      const timestamp = Date.now();
      const msgDigest = sfMsgDigest(msgData, timestamp, checkWord);
      const body = new URLSearchParams({
        partnerID: cfg.partnerID,
        requestID: uuid(),
        serviceCode: 'EXP_RECE_QUERY_SFWAYBILL',
        timestamp: String(timestamp),
        msgDigest,
        msgData,
      });

      const url = cfg.sandbox ? SF_SBOX : SF_PROD;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: body.toString(),
        });
        const text = await res.text();
        let outer;
        try {
          outer = JSON.parse(text);
        } catch {
          return { ok: false, error: `顺丰响应非 JSON：${text.slice(0, 120)}` };
        }
        const outerCode = String(outer.apiResultCode || '').trim();
        if (outerCode && outerCode !== 'A1000') {
          let errMsg = outer.apiErrorMsg || '查询失败';
          const apiCode = outerCode;
          if (apiCode === 'A1004' || /无对应服务权限/.test(errMsg)) {
            errMsg =
              '丰桥未开通「清单运费查询」接口权限（A1004）。'
              + '请登录 qiao.sf-express.com → 应用管理 → 关联 API → 勾选 EXP_RECE_QUERY_SFWAYBILL，'
              + '沙箱联调 3 次成功后上线生产环境。';
          } else if (apiCode === 'A1006' || /数字签名无效/.test(errMsg)) {
            errMsg = '丰桥数字签名无效（A1006）。请核对顾客编码与校验码是否匹配当前环境（沙箱/生产）。';
          }
          const result = stampFeeCache({ ok: false, error: errMsg, apiCode });
          if (apiCode !== 'A1006') expressCache.set(ck, result);
          return result;
        }
        let inner = outer;
        if (typeof outer.apiResultData === 'string') {
          try {
            inner = JSON.parse(outer.apiResultData);
          } catch {
            inner = { success: false, errorMsg: outer.apiErrorMsg || 'apiResultData 解析失败' };
          }
        }
        if (!inner.success && inner.success !== true) {
          const apiCode = outer.apiResultCode || inner.errorCode || '';
          let errMsg = inner.errorMsg || outer.apiErrorMsg || '查询失败';
          if (apiCode === 'A1004' || /无对应服务权限/.test(errMsg)) {
            errMsg =
              '丰桥未开通「清单运费查询」接口权限（A1004）。'
              + '请登录 qiao.sf-express.com → 应用管理 → 关联 API → 勾选 EXP_RECE_QUERY_SFWAYBILL，'
              + '沙箱联调 3 次成功后上线生产环境。';
          } else if (apiCode === 'A1006' || /数字签名无效/.test(errMsg)) {
            errMsg = '丰桥数字签名无效（A1006）。请核对顾客编码与校验码是否匹配当前环境（沙箱/生产）。';
          } else if (String(inner.errorCode || '') === '8152' || /月结卡号没有配置/.test(errMsg)) {
            errMsg = '月结卡号未在丰桥配置正确（8152）。请在丰桥应用里绑定你的顺丰月结账号后再查。';
          } else if (String(inner.errorCode || '') === '8151' || /没有传入月结卡号|WQS没有传入月结卡号/.test(errMsg)) {
            errMsg = String(cfg.monthlyCard || '').trim()
              ? '该运单未挂在你月结卡下，丰桥查不到扣费（8151）。常见：买家付运费、他司月结、退回件。可点 ↻ 刷新；本单可按默认运费 ¥18 估算损失。'
              : '未传入月结卡号（8151）。侧栏 ⚙ → 填入「顺丰月结卡号 monthlyCard」（与丰桥应用绑定的月结账号一致）后保存再查。';
          } else if (String(inner.errorCode || '') === '8148' || /没有运单信息/.test(errMsg)) {
            errMsg =
              '丰桥查不到该运单的月结费用（8148）。'
              + '千帆有物流轨迹 ≠ 该单挂在你月结账号下；'
              + '常见原因：退回件单号、他司月结发货、买家付运费。请以下方有金额的运单为准。';
          }
          const result = stampFeeCache({
            ok: false,
            error: errMsg,
            raw: inner,
            apiCode: apiCode || String(inner.errorCode || ''),
          });
          if (apiCode !== 'A1006') expressCache.set(ck, result);
          return result;
        }
        const data = inner.msgData || inner;
        const info = data.waybillInfo || {};
        const fees = data.waybillFeeList || [];
        const total = fees.reduce((s, f) => s + (Number(f.feeAmt ?? f.value) || 0), 0) || info.totalFee;
        const result = {
          ok: true,
          waybillNo: info.waybillNo || no,
          customerAcctCode: info.customerAcctCode || '',
          meterageWeightQty: info.meterageWeightQty,
          realWeightQty: info.realWeightQty,
          jProvince: info.jProvince,
          jCity: info.jCity,
          dProvince: info.dProvince,
          dCity: info.dCity,
          addresseeContName: info.addresseeContName,
          expressTypeCode: info.expressTypeCode,
          waybillChilds: info.waybillChilds,
          totalFee: total,
          fees: fees.map((f) => ({
            name: f.feeName || f.name || '费用',
            amount: Number(f.feeAmt ?? f.value) || 0,
            settlement: f.settlementTypeCode === '2' ? '月结' : f.settlementTypeCode === '1' ? '现结' : '',
          })),
        };
        expressCache.set(ck, stampFeeCache(result));
        return result;
      } catch (err) {
        const msg = String(err.message || err);
        const hint = /failed to fetch|network|cors/i.test(msg)
          ? '（若报跨域：千帆 Electron 可能拦截外网请求，需在丰桥侧确认或联系管理员）'
          : '';
        return { ok: false, error: msg + hint };
      }
    })();

    sfFeeInflight.set(ck, job);
    try {
      return await job;
    } finally {
      sfFeeInflight.delete(ck);
    }
  }

  // ─── UI ─────────────────────────────────────────────────────────────
  let panelEl;
  let bodyEl;
  let settingsEl;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function renderBuyerHeader(buyerNick, buyerUserId) {
    const nick = String(buyerNick || '').trim();
    const trace = resolveBuyerTrace(buyerUserId);
    if (!nick && !trace) return '';
    let html = '<div class="qsf-buyer">';
    if (nick) html += `<div class="qsf-buyer-nick">${esc(nick)}</div>`;
    if (trace) html += `<div class="qsf-buyer-trace">${esc(trace)}</div>`;
    html += '</div>';
    return html;
  }

  function renderLoadingPanel(buyerNick, text, buyerUserId) {
    const cardsHtml = renderOrderCardsList(buyerUserId, []);
    return `${renderBuyerHeader(buyerNick, buyerUserId)}${cardsHtml}<div class="qsf-buffer"><div class="qsf-buffer-bar"><div class="qsf-buffer-bar-inner"></div></div><div class="qsf-loading">${esc(text || '正在加载运单信息…')}</div></div>`;
  }

  function sortPanelCards(cards) {
    return [...cards].sort((a, b) => {
      if (a.fee?.ok && !b.fee?.ok) return -1;
      if (!a.fee?.ok && b.fee?.ok) return 1;
      if (a.fee?.skipped && !b.fee?.skipped) return 1;
      if (!a.fee?.skipped && b.fee?.skipped) return -1;
      if (a.pkg?.primary && !b.pkg?.primary) return -1;
      if (!a.pkg?.primary && b.pkg?.primary) return 1;
      return 0;
    });
  }

  function formatPanelFooterTime(updatedAt, fromCache) {
    const t = new Date(updatedAt || Date.now()).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    return fromCache ? `缓存 ${t}` : `已更新 ${t}`;
  }

  function renderWaybillFeeAmount(fee) {
    if (fee?.ok && Number.isFinite(Number(fee.totalFee))) {
      return { text: money(fee.totalFee), cls: 'qsf-waybill-fee-ok' };
    }
    if (fee?.skipped) {
      return { text: '—', cls: 'qsf-waybill-fee-muted', hint: fee.error || '' };
    }
    if (fee && !fee.ok) {
      return { text: '查询失败', cls: 'qsf-waybill-fee-err', hint: fee.error || '' };
    }
    return { text: '—', cls: 'qsf-waybill-fee-muted' };
  }

  function renderPanelCards(buyerNick, buyerUserId, cards, updatedAt, opts = {}) {
    const fromCache = opts.fromCache === true;
    const sorted = sortPanelCards(cards);
    let html = renderBuyerHeader(buyerNick, buyerUserId);
    const okCards = sorted.filter((c) => c.fee?.ok);
    const packageIds = getDisplayPackageIds(buyerUserId, sorted);
    if (packageIds.length > 1) {
      const sum = okCards.reduce((s, c) => s + (Number(c.fee?.totalFee) || 0), 0);
      html += `<div class="qsf-summary">${packageIds.length} 笔订单 · 可计费 ${okCards.length} 单 · 月结合计 ${money(sum)}</div>`;
    }
    html += renderOrderCardsList(buyerUserId, sorted);
    const hint = fromCache ? ' · 点 ↻ 重新查询' : '';
    html += `<div class="qsf-meta qsf-footer-meta">${formatPanelFooterTime(updatedAt, fromCache)} · v${VERSION}${hint}</div>`;
    return html;
  }

  function renderEmptySfPanel(buyerNick, buyerUserId, opts = {}) {
    const fromCache = opts.fromCache === true;
    const updatedAt = opts.updatedAt || Date.now();
    const noOrder = opts.noOrder === true;
    const partialLoad = opts.partialLoad === true;
    const cardsHtml = noOrder ? '' : renderOrderCardsList(buyerUserId, []);
    let msg = partialLoad
      ? '正在通过订单 API 获取运单号…'
      : noOrder
        ? '该买家暂无订单'
        : cardsHtml
          ? '以上订单暂未识别到顺丰运单号'
          : '未找到顺丰运单号';
    if (partialLoad) {
      msg += '<br><small>请确保已运行 npm start（本机 package 代理 4725）</small>';
    } else if (!noOrder && !cardsHtml) {
      msg += '<br><br>请确认该买家已发货，并在千帆右侧订单区加载完成后再点 ↻ 刷新'
        + '<br><small>侧栏会从页面网络响应和 DOM 中自动抓取 express_no</small>';
    } else if (!noOrder && cardsHtml) {
      msg += '<br><small>若已发货，请点 ↻ 刷新或稍等自动加载</small>';
    }
    const hint = fromCache ? ' · 点 ↻ 重新查询' : '';
    return `
      ${renderBuyerHeader(buyerNick, buyerUserId)}
      ${cardsHtml}
      <div class="qsf-empty">${msg}</div>
      <div class="qsf-meta qsf-footer-meta">${formatPanelFooterTime(updatedAt, fromCache)} · v${VERSION}${hint}</div>
    `;
  }

  function setRefreshLoading(on) {
    const btn = panelEl?.querySelector('[data-act="refresh"]');
    if (btn) {
      btn.classList.toggle('is-loading', on);
      btn.disabled = on;
    }
    if (bodyEl) bodyEl.classList.toggle('is-busy', on);
  }

  function launcherIconUrl() {
    return String(window.__qfSfFeeIconDataUrl || '').trim();
  }

  function isPanelExpanded() {
    return Boolean(panelEl?.classList.contains('qsf-expanded'));
  }

  function isPanelPinned() {
    try {
      return sessionStorage.getItem(PANEL_PINNED_KEY) === '1';
    } catch {
      return false;
    }
  }

  function setPanelPinned(on) {
    try {
      sessionStorage.setItem(PANEL_PINNED_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  function restorePinnedPanelState(refresh) {
    if (!panelEl || !isPanelPinned()) return;
    if (!panelEl.classList.contains('qsf-icon-only')) {
      syncPageDockLayout(true);
      return;
    }
    panelEl.classList.remove('qsf-icon-only');
    panelEl.classList.add('qsf-expanded');
    clearIconInlinePos();
    syncPageDockLayout(true);
    lastPanelExpandAt = Date.now();
    if (refresh === true) {
      if (hasActiveBuyerSession()) {
        void refreshPanel({ preferCache: true, reopen: true, waitForData: false });
      } else {
        showIdlePanel();
      }
    }
  }

  function hasActiveBuyerSession() {
    return Boolean(String(activeBuyer.buyerUserId || '').trim());
  }

  function renderIdlePanel() {
    return '<div class="qsf-empty">请在左侧点击一个买家会话，或通过浏览器插件跳转到买家后再展开侧栏</div>';
  }

  function showIdlePanel() {
    if (!bodyEl || !isPanelExpanded()) return;
    bodyEl.innerHTML = renderIdlePanel();
  }

  function syncPageDockLayout(expanded) {
    const on = expanded !== false && panelEl?.classList.contains('qsf-expanded');
    const html = document.documentElement;
    const body = document.body;
    if (!html) return;
    const dockW = `${PANEL_DOCK_WIDTH}px`;
    const appW = `calc(100vw - ${PANEL_DOCK_WIDTH}px)`;
    if (on) {
      html.classList.add(PAGE_DOCK_CLASS);
      html.style.setProperty('--qsf-dock-width', dockW);
      html.style.setProperty('margin-right', dockW, 'important');
      html.style.setProperty('box-sizing', 'border-box', 'important');
      html.style.setProperty('overflow-x', 'hidden', 'important');
      if (body) {
        body.classList.add(PAGE_DOCK_CLASS);
        body.style.setProperty('--qsf-dock-width', dockW);
        body.style.setProperty('margin-right', dockW, 'important');
        body.style.setProperty('box-sizing', 'border-box', 'important');
        body.style.setProperty('overflow-x', 'hidden', 'important');
        body.style.setProperty('width', appW, 'important');
        body.style.setProperty('max-width', appW, 'important');
      }
      applyDockToAppShells(true);
      bindDockLayoutGuard(true);
    } else {
      html.classList.remove(PAGE_DOCK_CLASS);
      html.style.removeProperty('--qsf-dock-width');
      html.style.removeProperty('margin-right');
      html.style.removeProperty('box-sizing');
      html.style.removeProperty('overflow-x');
      if (body) {
        body.classList.remove(PAGE_DOCK_CLASS);
        body.style.removeProperty('--qsf-dock-width');
        body.style.removeProperty('margin-right');
        body.style.removeProperty('box-sizing');
        body.style.removeProperty('overflow-x');
        body.style.removeProperty('width');
        body.style.removeProperty('max-width');
      }
      applyDockToAppShells(false);
      bindDockLayoutGuard(false);
    }
    ensurePanelOnDocumentRoot();
    if (on && panelEl) {
      panelEl.style.setProperty('position', 'fixed', 'important');
      panelEl.style.setProperty('right', '0', 'important');
      panelEl.style.setProperty('top', '0', 'important');
      panelEl.style.setProperty('bottom', '0', 'important');
      panelEl.style.setProperty('left', 'auto', 'important');
      panelEl.style.setProperty('width', dockW, 'important');
      panelEl.style.setProperty('height', '100vh', 'important');
      panelEl.style.setProperty('z-index', '2147483647', 'important');
    }
  }

  function applyDockToAppShells(on) {
    const appW = `calc(100vw - ${PANEL_DOCK_WIDTH}px)`;
    const clearEl = (el) => {
      delete el.dataset.qsfDocked;
      el.style.removeProperty('width');
      el.style.removeProperty('max-width');
      el.style.removeProperty('box-sizing');
    };
    if (!on) {
      document.querySelectorAll('[data-qsf-docked="1"]').forEach(clearEl);
      return;
    }
    for (const sel of APP_SHELL_SELECTORS) {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.id === PANEL_ID || el.closest(`#${PANEL_ID}`)) return;
        el.dataset.qsfDocked = '1';
        el.style.setProperty('width', appW, 'important');
        el.style.setProperty('max-width', appW, 'important');
        el.style.setProperty('box-sizing', 'border-box', 'important');
      });
    }
  }

  function bindDockLayoutGuard(on) {
    if (!on) {
      if (dockGuardTimer) {
        clearInterval(dockGuardTimer);
        dockGuardTimer = null;
      }
      window.removeEventListener('resize', onDockViewportResize);
      return;
    }
    if (dockGuardTimer) return;
    window.addEventListener('resize', onDockViewportResize);
    dockGuardTimer = setInterval(() => {
      if (!panelEl?.classList.contains('qsf-expanded')) return;
      ensurePanelOnDocumentRoot();
      syncPageDockLayout(true);
    }, 8000);
  }

  function onDockViewportResize() {
    if (panelEl?.classList.contains('qsf-expanded')) syncPageDockLayout(true);
  }

  function ensurePanelOnDocumentRoot() {
    const el = document.getElementById(PANEL_ID);
    if (!el) return;
    const root = document.documentElement;
    if (el.parentElement !== root && el.parentElement !== document.body) {
      root.appendChild(el);
    } else if (el.parentElement === document.body && root) {
      root.appendChild(el);
    }
  }

  function expandPanel() {
    if (!panelEl) return;
    setPanelPinned(true);
    panelEl.classList.remove('qsf-icon-only');
    panelEl.classList.add('qsf-expanded');
    clearIconInlinePos();
    syncPageDockLayout(true);
    lastPanelExpandAt = Date.now();
    syncActiveBuyerFromDom();
    if (!hasActiveBuyerSession()) syncActiveSessionFromDom();
    if (hasActiveBuyerSession()) {
      maybeClearOrderPanelStale();
      if (shouldScrapeOrderDom()) scrapeOrderCardsFromPanel();
      void refreshPanel({ preferCache: true, reopen: false, waitForData: false });
    } else {
      showIdlePanel();
    }
  }

  function collapseToIcon() {
    if (!panelEl) return;
    setPanelPinned(false);
    refreshSession++;
    refreshInFlight = false;
    clearTimeout(backgroundRevalidateTimer);
    backgroundRevalidateTimer = null;
    clearTimeout(partialLoadRetryTimer);
    partialLoadRetryTimer = null;
    setRefreshLoading(false);
    panelEl.classList.add('qsf-icon-only');
    panelEl.classList.remove('qsf-expanded');
    syncPageDockLayout(false);
    if (settingsEl) settingsEl.classList.remove('open');
    applyIconPosition();
  }

  function loadIconPos() {
    try {
      const pos = JSON.parse(localStorage.getItem(ICON_POS_KEY) || 'null');
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) return pos;
    } catch {
      /* ignore */
    }
    return null;
  }

  function saveIconPos(left, top) {
    try {
      localStorage.setItem(ICON_POS_KEY, JSON.stringify({ left, top }));
    } catch {
      /* ignore */
    }
  }

  function clearIconInlinePos() {
    if (!panelEl) return;
    panelEl.style.left = '';
    panelEl.style.top = '';
    panelEl.style.right = '';
    panelEl.style.bottom = '';
  }

  function applyIconPosition() {
    if (!panelEl || !panelEl.classList.contains('qsf-icon-only')) return;
    const pos = loadIconPos();
    if (pos) {
      const size = 30;
      const left = Math.max(4, Math.min(pos.left, window.innerWidth - size - 4));
      const top = Math.max(4, Math.min(pos.top, window.innerHeight - size - 4));
      panelEl.style.left = `${left}px`;
      panelEl.style.top = `${top}px`;
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
    } else {
      panelEl.style.top = '48px';
      panelEl.style.right = '8px';
      panelEl.style.left = 'auto';
      panelEl.style.bottom = 'auto';
    }
    ensureIconInViewport();
  }

  function ensureIconInViewport() {
    if (!panelEl || !panelEl.classList.contains('qsf-icon-only')) return;
    const rect = panelEl.getBoundingClientRect();
    const offScreen = rect.width < 1 || rect.height < 1
      || rect.right < 4 || rect.bottom < 4
      || rect.left > window.innerWidth - 4
      || rect.top > window.innerHeight - 4;
    if (!offScreen) return;
    try {
      localStorage.removeItem(ICON_POS_KEY);
    } catch {
      /* ignore */
    }
    clearIconInlinePos();
    panelEl.style.top = '48px';
    panelEl.style.right = '8px';
    panelEl.style.left = 'auto';
    panelEl.style.bottom = 'auto';
  }

  let launcherDrag = null;

  function bindLauncherDrag() {
    const launcher = panelEl?.querySelector('.qsf-launcher');
    if (!launcher || launcher.__qsfDragBound) return;
    launcher.__qsfDragBound = true;
    launcher.setAttribute('title', '按住拖动 · 单击展开');

    launcher.addEventListener('mousedown', (ev) => {
      if (!panelEl.classList.contains('qsf-icon-only') || ev.button !== 0) return;
      ev.stopPropagation();
      const rect = panelEl.getBoundingClientRect();
      launcherDrag = {
        startX: ev.clientX,
        startY: ev.clientY,
        origLeft: rect.left,
        origTop: rect.top,
        moved: false,
      };
      panelEl.style.left = `${rect.left}px`;
      panelEl.style.top = `${rect.top}px`;
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';

      const onMove = (e) => {
        if (!launcherDrag) return;
        const dx = e.clientX - launcherDrag.startX;
        const dy = e.clientY - launcherDrag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 4) launcherDrag.moved = true;
        const size = 30;
        let left = launcherDrag.origLeft + dx;
        let top = launcherDrag.origTop + dy;
        left = Math.max(4, Math.min(left, window.innerWidth - size - 4));
        top = Math.max(4, Math.min(top, window.innerHeight - size - 4));
        panelEl.style.left = `${left}px`;
        panelEl.style.top = `${top}px`;
        launcher.style.cursor = launcherDrag.moved ? 'grabbing' : 'grab';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onUp);
        delete window.__qfSfLauncherDragCleanup;
        launcher.style.cursor = 'grab';
        if (!launcherDrag) return;
        if (launcherDrag.moved) {
          const rect = panelEl.getBoundingClientRect();
          saveIconPos(rect.left, rect.top);
        } else {
          expandPanel();
        }
        launcherDrag = null;
      };

      window.__qfSfLauncherDragCleanup = onUp;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      window.addEventListener('blur', onUp);
    });
  }

  function injectStyles() {
    const css = `
      #${PANEL_ID} {
        position: fixed !important; z-index: 2147483647 !important; pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px; color: #1f2937;
      }
      #${PANEL_ID} .qsf-launcher, #${PANEL_ID} .qsf-shell { pointer-events: auto; }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .qsf-launcher {
        width: 30px; height: 30px; padding: 0; margin: 0; border: none; border-radius: 6px;
        background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.18); cursor: grab;
        display: flex; align-items: center; justify-content: center; overflow: hidden;
        user-select: none; touch-action: none;
      }
      #${PANEL_ID} .qsf-launcher:hover { box-shadow: 0 4px 16px rgba(0,0,0,.22); }
      #${PANEL_ID} .qsf-launcher img { width: 30px; height: 30px; object-fit: cover; display: block; }
      #${PANEL_ID} .qsf-launcher-fallback {
        width: 30px; height: 30px; line-height: 30px; text-align: center; font-weight: 700;
        font-size: 11px; color: #dc2626; background: #fff;
      }
      #${PANEL_ID} .qsf-shell {
        display: none; flex-direction: column; background: #fff;
        border-left: 1px solid #e5e7eb; box-shadow: -4px 0 16px rgba(0,0,0,.08);
      }
      #${PANEL_ID}.qsf-icon-only {
        width: 30px; height: 30px; bottom: auto;
      }
      #${PANEL_ID}.qsf-icon-only .qsf-launcher { display: flex; }
      #${PANEL_ID}.qsf-icon-only .qsf-shell { display: none; }
      #${PANEL_ID}.qsf-expanded {
        top: 0 !important; right: 0 !important; bottom: 0 !important;
        width: ${PANEL_DOCK_WIDTH}px !important; left: auto !important;
        height: 100vh !important; max-height: 100vh !important;
      }
      #${PANEL_ID}.qsf-expanded .qsf-launcher { display: none; }
      #${PANEL_ID}.qsf-expanded .qsf-shell { display: flex; width: 100%; height: 100%; }
      #${PANEL_ID} .qsf-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px; border-bottom: 1px solid #f3f4f6; background: #fafafa; flex-shrink: 0;
      }
      #${PANEL_ID} .qsf-title { font-weight: 600; font-size: 14px; }
      #${PANEL_ID} .qsf-head-btns { display: flex; gap: 6px; }
      #${PANEL_ID} .qsf-btn {
        border: none; background: #f3f4f6; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 12px;
      }
      #${PANEL_ID} .qsf-btn:hover { background: #e5e7eb; }
      #${PANEL_ID} .qsf-btn:disabled { opacity: 0.55; cursor: wait; }
      #${PANEL_ID} .qsf-btn.is-loading { animation: qsf-spin 0.75s linear infinite; }
      @keyframes qsf-spin { to { transform: rotate(360deg); } }
      #${PANEL_ID} .qsf-body.is-busy { opacity: 0.88; pointer-events: none; }
      #${PANEL_ID} .qsf-body { flex: 1; overflow: auto; padding: 10px 12px; -webkit-overflow-scrolling: touch; }
      #${PANEL_ID} .qsf-buyer { margin-bottom: 10px; padding: 8px 10px; background: #f0f9ff; border-radius: 10px; border: 1px solid #bae6fd; }
      #${PANEL_ID} .qsf-buyer-nick { font-weight: 600; font-size: 13px; }
      #${PANEL_ID} .qsf-buyer-trace {
        color: #4b5563; font-size: 11px; line-height: 1.45; margin-top: 4px;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      #${PANEL_ID} .qsf-order-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; }
      #${PANEL_ID} .qsf-order-card {
        border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden;
        background: #fff; box-shadow: 0 1px 4px rgba(15, 23, 42, .06);
        contain: layout style;
      }
      #${PANEL_ID} .qsf-order-card-head {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 8px 10px; background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
        border-bottom: 1px solid #e2e8f0;
      }
      #${PANEL_ID} .qsf-order-card-badge {
        font-size: 11px; font-weight: 700; color: #1d4ed8;
        background: #dbeafe; padding: 2px 8px; border-radius: 999px; flex-shrink: 0;
      }
      #${PANEL_ID} .qsf-order-card-id {
        font-family: ui-monospace, monospace; font-size: 10px; color: #64748b;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 58%;
      }
      #${PANEL_ID} .qsf-order-card-body { padding: 8px 10px 10px; }
      #${PANEL_ID} .qsf-order-card-divider {
        height: 1px; background: #e2e8f0; margin: 8px 0 6px;
      }
      #${PANEL_ID} .qsf-order-card-subtitle {
        font-size: 10px; font-weight: 700; color: #94a3b8; letter-spacing: .06em;
        margin-bottom: 2px; text-transform: uppercase;
      }
      #${PANEL_ID} .qsf-kv {
        display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;
        padding: 3px 0; font-size: 11px; line-height: 1.45;
      }
      #${PANEL_ID} .qsf-kv-k { color: #64748b; flex-shrink: 0; min-width: 52px; }
      #${PANEL_ID} .qsf-kv-v { color: #0f172a; text-align: right; word-break: break-all; flex: 1; }
      #${PANEL_ID} .qsf-kv-warn .qsf-kv-v { color: #b91c1c; font-weight: 600; }
      #${PANEL_ID} .qsf-kv-muted .qsf-kv-v { color: #94a3b8; }
      #${PANEL_ID} .qsf-mono { font-family: ui-monospace, monospace; font-weight: 600; }
      #${PANEL_ID} .qsf-muted { color: #94a3b8; }
      #${PANEL_ID} .qsf-money { color: #0f172a; font-weight: 600; }
      #${PANEL_ID} .qsf-order-card .qsf-refund-risk { margin-top: 6px; margin-bottom: 0; }
      #${PANEL_ID} .qsf-card-trace {
        margin-top: 6px; padding: 6px 8px; border-radius: 6px;
        background: #f8fafc; border: 1px solid #e2e8f0;
        color: #475569; font-size: 10px; line-height: 1.45;
      }
      #${PANEL_ID} .qsf-card-hint { margin-top: 4px; font-size: 10px; line-height: 1.4; }
      #${PANEL_ID} .qsf-waybill-fee-ok { color: #dc2626; font-size: 14px; font-weight: 700; }
      #${PANEL_ID} .qsf-waybill-fee-err { color: #dc2626; font-size: 11px; font-weight: 600; }
      #${PANEL_ID} .qsf-waybill-fee-muted { color: #94a3b8; font-weight: 500; }
      #${PANEL_ID} .qsf-meta { color: #6b7280; font-size: 11px; margin-top: 4px; line-height: 1.45; }
      #${PANEL_ID} .qsf-footer-meta { text-align: center; margin-top: 8px; }
      #${PANEL_ID} .qsf-meta-warn { color: #b45309; }
      #${PANEL_ID} .qsf-summary {
        margin-bottom: 10px; padding: 8px 10px; background: #fef2f2; border-radius: 10px;
        border: 1px solid #fecaca; color: #991b1b; font-size: 12px; font-weight: 600; text-align: center;
      }
      #${PANEL_ID} .qsf-fee-line {
        display: flex; justify-content: space-between; padding: 2px 0 2px 8px;
        font-size: 11px; color: #475569; border-left: 2px solid #e2e8f0; margin-top: 2px;
      }
      #${PANEL_ID} .qsf-err { color: #dc2626; font-size: 12px; }
      #${PANEL_ID} .qsf-hint { color: #92400e; font-size: 12px; line-height: 1.5; }
      #${PANEL_ID} .qsf-after-sale {
        margin-top: 6px; padding: 6px 8px; border-radius: 6px; font-size: 11px; line-height: 1.45;
      }
      #${PANEL_ID} .qsf-after-sale-warn { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
      #${PANEL_ID} .qsf-after-sale-ok { background: #ecfdf5; color: #047857; border: 1px solid #bbf7d0; }
      #${PANEL_ID} .qsf-buyer-after-sale { font-size: 11px; margin-top: 4px; line-height: 1.4; }
      #${PANEL_ID} .qsf-refund-risk {
        margin-top: 6px; padding: 6px 8px; border-radius: 6px; font-size: 11px; line-height: 1.45;
      }
      #${PANEL_ID} .qsf-refund-danger { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
      #${PANEL_ID} .qsf-refund-warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
      #${PANEL_ID} .qsf-refund-ok { background: #ecfdf5; color: #047857; border: 1px solid #bbf7d0; }
      #${PANEL_ID} .qsf-buyer-refund { font-size: 11px; margin-top: 4px; line-height: 1.4; padding: 4px 6px; border-radius: 4px; }
      #${PANEL_ID} .qsf-empty { color: #9ca3af; text-align: center; padding: 24px 8px; line-height: 1.6; }
      #${PANEL_ID} .qsf-settings {
        display: none; padding: 10px 12px; border-top: 1px solid #e5e7eb; background: #fafafa; flex-shrink: 0;
      }
      #${PANEL_ID} .qsf-settings.open { display: block; }
      #${PANEL_ID} .qsf-foot {
        flex-shrink: 0; padding: 6px 12px; border-top: 1px solid #e5e7eb;
        text-align: center; color: #6b7280; font-size: 11px; background: #fafafa;
      }
      #${PANEL_ID} .qsf-ver { font-weight: 500; }
      #${PANEL_ID} .qsf-settings label { display: block; margin-bottom: 8px; font-size: 12px; color: #374151; }
      #${PANEL_ID} .qsf-settings input[type=text], #${PANEL_ID} .qsf-settings input[type=password] {
        width: 100%; margin-top: 4px; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px;
      }
      #${PANEL_ID} .qsf-loading { color: #6b7280; font-size: 12px; text-align: center; }
      #${PANEL_ID} .qsf-buffer { padding: 20px 4px 8px; }
      #${PANEL_ID} .qsf-buffer-bar {
        height: 3px; background: #e5e7eb; border-radius: 2px; overflow: hidden; margin-bottom: 14px;
      }
      #${PANEL_ID} .qsf-buffer-bar-inner {
        height: 100%; width: 38%; background: linear-gradient(90deg, #2563eb, #60a5fa);
        border-radius: 2px; animation: qsf-buffer-slide 1.1s ease-in-out infinite;
      }
      @keyframes qsf-buffer-slide {
        0% { transform: translateX(-110%); }
        100% { transform: translateX(320%); }
      }
    `;
    const dockCss = `
      html.${PAGE_DOCK_CLASS},
      body.${PAGE_DOCK_CLASS} {
        margin-right: var(--qsf-dock-width, ${PANEL_DOCK_WIDTH}px) !important;
        box-sizing: border-box !important;
        overflow-x: hidden !important;
      }
      html.${PAGE_DOCK_CLASS} body {
        width: calc(100vw - var(--qsf-dock-width, ${PANEL_DOCK_WIDTH}px)) !important;
        max-width: calc(100vw - var(--qsf-dock-width, ${PANEL_DOCK_WIDTH}px)) !important;
      }
      html.${PAGE_DOCK_CLASS} #app,
      html.${PAGE_DOCK_CLASS} #root,
      html.${PAGE_DOCK_CLASS} .app,
      html.${PAGE_DOCK_CLASS} .app-wrapper,
      html.${PAGE_DOCK_CLASS} .farmer-chat,
      html.${PAGE_DOCK_CLASS} .farmer-chat__wrap,
      html.${PAGE_DOCK_CLASS} .farmer-chat__main,
      html.${PAGE_DOCK_CLASS} [class*="layout-container"],
      html.${PAGE_DOCK_CLASS} [class*="main-layout"],
      html.${PAGE_DOCK_CLASS} [class*="page-container"],
      body.${PAGE_DOCK_CLASS} #app,
      body.${PAGE_DOCK_CLASS} .farmer-chat {
        width: calc(100vw - var(--qsf-dock-width, ${PANEL_DOCK_WIDTH}px)) !important;
        max-width: calc(100vw - var(--qsf-dock-width, ${PANEL_DOCK_WIDTH}px)) !important;
        box-sizing: border-box !important;
      }
    `;
    let style = document.getElementById('qf-sf-fee-panel-style');
    if (style) {
      style.textContent = css + dockCss;
      return;
    }
    style = document.createElement('style');
    style.id = 'qf-sf-fee-panel-style';
    style.textContent = css + dockCss;
    document.head.appendChild(style);
  }

  function launcherMarkup() {
    const icon = launcherIconUrl();
    if (icon) {
      return `<button type="button" class="qsf-launcher" title="按住拖动 · 单击展开"><img src="${icon}" alt="顺丰运费" width="30" height="30" draggable="false"></button>`;
    }
    return `<button type="button" class="qsf-launcher" title="按住拖动 · 单击展开"><span class="qsf-launcher-fallback">SF</span></button>`;
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) {
      panelEl = document.getElementById(PANEL_ID);
      bodyEl = panelEl.querySelector('.qsf-body');
      settingsEl = panelEl.querySelector('.qsf-settings');
      const titleText = panelEl.querySelector('.qsf-title-text');
      if (titleText) titleText.textContent = '顺丰月结运费';
      injectStyles();
      qsfEnsureFooter();
      patchAllVersionLabels();
      bindLauncherDrag();
      if (panelEl.classList.contains('qsf-icon-only')) applyIconPosition();
      restorePinnedPanelState(false);
      syncPageDockLayout(panelEl.classList.contains('qsf-expanded'));
      return;
    }
    injectStyles();
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.className = 'qsf-icon-only';
    panelEl.innerHTML = `
      ${launcherMarkup()}
      <div class="qsf-shell">
        <div class="qsf-head">
          <div class="qsf-title"><span class="qsf-title-text">顺丰月结运费</span></div>
          <div class="qsf-head-btns">
            <button type="button" class="qsf-btn" data-act="refresh" title="刷新">↻</button>
            <button type="button" class="qsf-btn" data-act="settings" title="丰桥配置">⚙</button>
            <button type="button" class="qsf-btn" data-act="collapse" title="收起为图标">×</button>
          </div>
        </div>
        <div class="qsf-body"></div>
        <div class="qsf-settings"></div>
        <div class="qsf-foot"><span class="qsf-ver">v${VERSION}</span></div>
      </div>
    `;
    document.documentElement.appendChild(panelEl);
    bodyEl = panelEl.querySelector('.qsf-body');
    settingsEl = panelEl.querySelector('.qsf-settings');

    panelEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'refresh') void refreshPanel({ force: true, waitForData: false });
      if (act === 'settings') toggleSettings();
      if (act === 'collapse') collapseToIcon();
      if (act === 'save-config') saveSettingsFromForm();
    });

    bindLauncherDrag();
    applyIconPosition();

    renderSettingsForm();
    bodyEl.innerHTML = '<div class="qsf-empty">点击左侧买家会话，侧栏将自动查询运费与退款风险</div>';
    qsfEnsureFooter();
    patchAllVersionLabels();
  }

  function renderSettingsForm() {
    const cfg = loadConfig();
    settingsEl.innerHTML = `
      <label>丰桥顾客编码 partnerID<input type="text" id="qsf-cfg-partner" value="${esc(cfg.partnerID)}" autocomplete="off"></label>
      <label>顺丰月结卡号 monthlyCard<input type="text" id="qsf-cfg-monthly" value="${esc(cfg.monthlyCard)}" autocomplete="off" placeholder="生产环境必填，如 7551234567"></label>
      <label>丰桥校验码 checkWord（生产）<input type="password" id="qsf-cfg-check" value="${esc(cfg.checkWord)}" autocomplete="off"></label>
      <label>沙箱校验码 checkWordSandbox<input type="password" id="qsf-cfg-check-sbox" value="${esc(cfg.checkWordSandbox)}" autocomplete="off"></label>
      <label>手机后四位（可选，丰桥开启校验时填写）<input type="text" id="qsf-cfg-phone" value="${esc(cfg.phoneLast4)}" maxlength="4"></label>
      <label>退款应扣运费（元，不包邮默认18）<input type="number" id="qsf-cfg-ship-deduct" min="0" step="1" value="${esc(String(cfg.shippingDeductYuan ?? DEFAULT_SHIPPING_DEDUCT_YUAN))}"></label>
      <label><input type="checkbox" id="qsf-cfg-sandbox" ${cfg.sandbox ? 'checked' : ''}> 使用沙箱环境</label>
      <button type="button" class="qsf-btn" data-act="save-config" style="width:100%;margin-top:4px;background:#2563eb;color:#fff;">保存配置</button>
      <div class="qsf-meta" style="margin-top:8px;">配置保存在本机 localStorage，仅用于调用顺丰丰桥 API</div>
      <div class="qsf-meta">${cfgCheckWordStatus(cfg)}</div>
    `;
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function cfgCheckWordStatus(cfg) {
    const prod = String(cfg.checkWord || '').trim();
    const sbox = String(cfg.checkWordSandbox || '').trim();
    const card = String(cfg.monthlyCard || '').trim();
    const parts = [];
    if (prod) parts.push(`生产校验码已配置（${prod.length} 字符）`);
    else parts.push('生产校验码未配置');
    if (sbox) parts.push(`沙箱校验码已配置（${sbox.length} 字符）`);
    if (card) parts.push(`月结卡 ${card}`);
    return parts.join(' · ');
  }

  function toggleSettings() {
    settingsEl.classList.toggle('open');
  }

  function saveSettingsFromForm() {
    const prev = loadConfig();
    const checkWordInput = (document.getElementById('qsf-cfg-check')?.value || '').trim();
    const checkWordSandboxInput = (document.getElementById('qsf-cfg-check-sbox')?.value || '').trim();
    const cfg = {
      ...prev,
      partnerID: (document.getElementById('qsf-cfg-partner')?.value || '').trim(),
      monthlyCard: (document.getElementById('qsf-cfg-monthly')?.value || '').trim(),
      checkWord: checkWordInput || prev.checkWord || '',
      checkWordSandbox: checkWordSandboxInput || prev.checkWordSandbox || '',
      phoneLast4: (document.getElementById('qsf-cfg-phone')?.value || '').trim(),
      shippingDeductYuan: parseMoneyYuan(document.getElementById('qsf-cfg-ship-deduct')?.value) ?? DEFAULT_SHIPPING_DEDUCT_YUAN,
      sandbox: Boolean(document.getElementById('qsf-cfg-sandbox')?.checked),
    };
    saveConfig(cfg);
    expressCache.clear();
    clearBuyerPanelCache();
    settingsEl.classList.remove('open');
    if (isPanelExpanded()) void refreshPanel();
  }

  async function refreshPanel(opts = {}) {
    ensurePanelRefs();
    if (!isPanelExpanded()) return;
    const force = opts.force === true;
    const reopen = opts.reopen === true;
    const background = opts.background === true;
    if (background && refreshInFlight) {
      pendingRefreshOpts = { preferCache: false, background: true, reopen: false, waitForData: false, force: false };
      return;
    }
    const preferCache = opts.preferCache === true && !force && !background;
    if (!force && !background && !reopen && !preferCache && Date.now() - lastRefreshStartedAt < MIN_REFRESH_GAP_MS) {
      pendingRefreshOpts = { ...opts, preferCache: false, background: false };
      return;
    }
    const waitForData = !force && (opts.waitForData !== false || preferCache);
    const cfg = loadConfig();
    let { buyerUserId, buyerNick } = activeBuyer;

    if (reopen) syncActiveBuyerFromDom();
    if (reopen && !buyerUserId) syncActiveSessionFromDom();
    buyerUserId = activeBuyer.buyerUserId;
    buyerNick = resolveDisplayNick(activeBuyer.buyerNick, buyerNick);

    if (!hasActiveBuyerSession()) {
      showIdlePanel();
      return;
    }

    if (preferCache) {
      let cached = loadBuyerPanelCache(buyerUserId, cfg);
      if (cached && !cacheMatchesCurrentSession(cached, buyerUserId)) cached = null;
      if (cached) {
        const displayNick = resolveDisplayNick(buyerNick, cached.buyerNick);
        if (cached.empty) {
          if (!panelHasStableContent()) {
            bodyEl.innerHTML = renderEmptySfPanel(
              displayNick,
              buyerUserId,
              { fromCache: true, updatedAt: cached.updatedAt, noOrder: cached.noOrder === true },
            );
          }
          if (shouldBackgroundRevalidate(buyerUserId, cached, cfg)) {
            scheduleBackgroundRevalidateOnce(buyerUserId);
          }
          return;
        }
        if (cached.cards?.length) {
          hydrateExpressCacheFromCards(cached.cards, cfg);
          if (reopen && canIngestOrderDom()) {
            runWhenIdle(() => {
              if (activeBuyer.buyerUserId === buyerUserId) scrapeOrderCardsFromPanel();
            });
          }
          lastRenderedCardRows = cached.cards;
          if (!panelHasStableContent()) {
            bodyEl.innerHTML = renderPanelCards(
              displayNick,
              buyerUserId,
              cached.cards,
              cached.updatedAt,
              { fromCache: true },
            );
            patchTraceDisplay();
          }
          if (shouldBackgroundRevalidate(buyerUserId, cached, cfg)) {
            scheduleBackgroundRevalidateOnce(buyerUserId);
          } else {
            void prefetchRefundDetailsBackground(buyerUserId, refreshSession);
          }
          return;
        }
      }
    }

    if (refreshInFlight && !force && !reopen && !background) {
      pendingRefreshOpts = { ...opts, preferCache: false, background: false };
      return;
    }

    const sessionId = ++refreshSession;

    if (!background) setRefreshLoading(true);
    refreshInFlight = true;
    if (!background) lastRefreshStartedAt = Date.now();

    try {
      if (force) syncActiveBuyerFromDom();

      if (sessionId !== refreshSession) return;
      if (!background) {
        const quickPainted = paintBuyerPanelFromLiveDom(buyerUserId, buyerNick)
          || (panelHasStableContent() && lastRenderedCardRows.length);
        if (!quickPainted) {
          bodyEl.innerHTML = renderLoadingPanel(
            buyerNick,
            waitForData ? '正在同步订单与运单…' : '正在刷新顺丰月结费用…',
            buyerUserId,
          );
        }
      }

      const rawPkgs = await fastCollectPackages(buyerUserId, sessionId, {
        fastMode: background || (!waitForData && !force),
      });
      if (sessionId !== refreshSession) return;
      const sfPkgs = finalizePackagesForDisplay(rawPkgs || [], buyerUserId);

      if (force) {
        for (const pkg of sfPkgs || []) {
          if (isSfExpressNo(pkg.expressNo)) expressCache.delete(feeCacheKey(cfg, pkg.expressNo));
        }
      }

      if (!sfPkgs || !sfPkgs.length) {
        const visibleIds = getVisibleOrderPackageIds();
        const snap = getOrderPanelSnapshot();
        const noOrder = snap.empty || (snap.ready && snap.cardCount === 0);
        const partialLoad = visibleIds.length > 0
          && countLoadedOrderExpress(buyerUserId, visibleIds) < visibleIds.length;
        const updatedAt = Date.now();
        if (partialLoad) {
          if (!background && waitForData) {
            bodyEl.innerHTML = renderEmptySfPanel(buyerNick, buyerUserId, {
              noOrder: false,
              updatedAt,
              partialLoad: true,
            });
          }
          schedulePartialLoadRetry(buyerUserId);
          return;
        }
        saveBuyerPanelCache(buyerUserId, {
          buyerNick,
          updatedAt,
          cfgKey: panelConfigCacheKey(cfg),
          empty: true,
          noOrder,
          visibleOrderIds: visibleIds,
          expressFingerprint: liveExpressFingerprint(buyerUserId, visibleIds),
          cards: [],
        });
        bodyEl.innerHTML = renderEmptySfPanel(buyerNick, buyerUserId, { noOrder, updatedAt });
        return;
      }

      if (!background) {
        bodyEl.innerHTML = renderLoadingPanel(buyerNick, '正在查询月结费用…', buyerUserId);
      }

      const cards = await queryFeesForPackages(sfPkgs, cfg, sessionId, force);
      if (sessionId !== refreshSession) return;
      const validCards = cards.filter(Boolean);
      lastRenderedCardRows = validCards;

      const updatedAt = Date.now();
      const visibleIds = getVisibleOrderPackageIds();
      saveBuyerPanelCache(buyerUserId, {
        buyerNick: resolveDisplayNick(buyerNick),
        updatedAt,
        cfgKey: panelConfigCacheKey(cfg),
        visibleOrderIds: visibleIds,
        expressFingerprint: cacheExpressFingerprint(validCards),
        cards: validCards,
      });
      if (background) {
        patchTraceDisplay();
        patchOrderCardsSection();
      } else {
        bodyEl.innerHTML = renderPanelCards(
          resolveDisplayNick(buyerNick),
          buyerUserId,
          validCards,
          updatedAt,
          { fromCache: false },
        );
        lastOrderListPatchSig = orderCardsRenderSig(buyerUserId, validCards);
      }
      clearOrderPanelStaleIfReady();
    } finally {
      if (sessionId === refreshSession) {
        refreshInFlight = false;
        if (!background) setRefreshLoading(false);
        if (orderPanelStale && isPanelExpanded() && !panelHasStableContent()) {
          watchOrderPanelAfterSwitch(activeBuyer.buyerUserId, activeBuyer.buyerNick);
          schedulePartialLoadRetry(activeBuyer.buyerUserId);
        }
        if (pendingRefreshOpts) {
          const next = pendingRefreshOpts;
          pendingRefreshOpts = null;
          void refreshPanel(next);
        }
      }
    }
  }

  function queueSessionActivation(info) {
    let buyerUserId = String(info?.buyerUserId || uidFromAppCid(info?.appCid) || '').trim();
    let appCid = String(info?.appCid || activeBuyer.appCid || '').trim();
    const fromOrderPanel = info?.fromOrderPanel === true;
    const fromMessageList = info?.fromMessageList === true;
    const fromSearch = info?.fromSearch === true;
    let fromUrlAppCid = info?.fromUrlAppCid === true;
    let fromExternalOpen = info?.fromExternalOpen === true;
    const fromDomSync = info?.fromDomSync === true;
    const fromChatClick = info?.fromChatClick === true;
    const trustedSource = fromOrderPanel || fromUrlAppCid || fromExternalOpen || fromMessageList || fromSearch || fromDomSync || fromChatClick;

    const domOpen = resolveOpenSessionFromDom();
    if (domOpen?.buyerUserId) {
      const shouldAdoptDom = !trustedSource
        ? (!buyerUserId || (buyerUserId === activeBuyer.buyerUserId && domOpen.buyerUserId !== buyerUserId))
        : !buyerUserId;
      if (shouldAdoptDom && domOpen.buyerUserId !== buyerUserId) {
        buyerUserId = domOpen.buyerUserId;
        appCid = domOpen.appCid || appCid;
        fromExternalOpen = !trustedSource || fromExternalOpen;
      }
    }

    if (!buyerUserId) return;
    const headerNick = scrapeHeaderBuyerNick();
    const buyerNick = String(info?.buyerNick || domOpen?.buyerNick || headerNick || activeBuyer.buyerNick || '').trim();

    const matchedItem = headerNick ? findChatItemByNick(headerNick) : null;
    if (matchedItem) {
      const expectedUid = uidFromAppCid(getAppCidFromEl(matchedItem));
      if (expectedUid && buyerUserId !== expectedUid && !fromUrlAppCid && !fromMessageList && !fromExternalOpen) return;
    } else if (headerNick && !trustedSource && !resolveBuyerUserIdFromVisibleOrders()) {
      return;
    }

    if (buyerUserId === activeBuyer.buyerUserId && orderPanelStale) {
      maybeClearOrderPanelStale();
      if (orderPanelStale && isPanelExpanded()) {
        watchOrderPanelAfterSwitch(buyerUserId, buyerNick || activeBuyer.buyerNick);
        if (!refreshInFlight) {
          void refreshPanel({ preferCache: false, waitForData: true, force: false });
        } else {
          schedulePartialLoadRetry(buyerUserId);
        }
      }
      return;
    }

    if (buyerUserId === activeBuyer.buyerUserId && !orderPanelStale) {
      const headerChanged = headerNick && headerNick !== activeBuyer.buyerNick;
      const strict = findStrictActiveChatItemEl();
      const strictUid = strict ? uidFromAppCid(getAppCidFromEl(strict)) : '';
      if (headerChanged && strictUid && strictUid !== buyerUserId) {
        const strictNick = nickFromChatItem(strict);
        const urlUid = uidFromAppCid(parseAppCidFromPageUrl());
        if (!(urlUid && urlUid === buyerUserId) && nicksRoughlyMatch(headerNick, strictNick)) {
          buyerUserId = strictUid;
          appCid = getAppCidFromEl(strict) || appCid;
          fromExternalOpen = true;
        }
      } else if (headerChanged) {
        activeBuyer = { ...activeBuyer, buyerNick: headerNick };
        if (isPanelExpanded() && bodyEl && Date.now() - lastHeaderNickRefreshAt >= 3000) {
          lastHeaderNickRefreshAt = Date.now();
          void refreshPanel({ preferCache: true, reopen: true, waitForData: false });
        } else {
          buildPanel();
        }
        return;
      }
      const patch = {};
      if (buyerNick && buyerNick !== activeBuyer.buyerNick) patch.buyerNick = buyerNick;
      if (appCid && appCid !== activeBuyer.appCid) patch.appCid = appCid;
      if (Object.keys(patch).length) {
        activeBuyer = { ...activeBuyer, ...patch };
        buildPanel();
      }
      if (buyerUserId !== activeBuyer.buyerUserId) {
        /* fall through to full activation */
      } else {
        return;
      }
    }
    clearTimeout(sessionActivateTimer);
    const gen = ++activationGeneration;
    sessionActivateTimer = setTimeout(() => {
      if (gen !== activationGeneration) return;
      if (window.__qfSfFeePanel?.version !== VERSION) return;
      onBuyerActivated(appCid, buyerNick, { buyerUserId });
    }, 90);
  }

  function onBuyerActivated(appCid, buyerNick, opts = {}) {
    const buyerUserId = String(opts.buyerUserId || uidFromAppCid(appCid) || '').trim();
    if (!buyerUserId) return;
    rememberBuyerIdentity(buyerUserId, buyerNick || scrapeHeaderBuyerNick(), appCid);
    const buyerChanged = buyerUserId !== lastActivatedBuyerId;
    const resolvedNick = buyerChanged
      ? (buyerNick || scrapeHeaderBuyerNick() || '')
      : (buyerNick || scrapeHeaderBuyerNick() || activeBuyer.buyerNick);
    if (buyerChanged) {
      refreshSession++;
      refreshInFlight = false;
      setRefreshLoading(false);
      clearTimeout(backgroundRevalidateTimer);
      backgroundRevalidateTimer = null;
      clearTimeout(partialLoadRetryTimer);
      partialLoadRetryTimer = null;
      pendingRefreshOpts = null;
    }
    lastActivatedBuyerId = buyerUserId;
    orderPanelStale = buyerChanged ? true : orderPanelStale;
    activeBuyer = {
      buyerUserId,
      buyerNick: resolvedNick || scrapeHeaderBuyerNick() || activeBuyer.buyerNick,
      appCid: appCid || (buyerChanged ? '' : activeBuyer.appCid) || '',
    };
    if (buyerChanged && (isPanelPinned() || isPanelExpanded()) && panelEl?.classList.contains('qsf-icon-only')) {
      expandPanel();
      watchOrderPanelAfterSwitch(buyerUserId, resolvedNick);
      return;
    }
    ensurePanelRefs();
    lastBuyerActivateAt = Date.now();
    stopOrderPanelWatch();
    let paintedFromCache = false;
    let paintedFromDom = false;
    if (isPanelExpanded() && buyerChanged && bodyEl) {
      paintedFromCache = paintBuyerPanelFromCache(buyerUserId, resolvedNick);
      if (!paintedFromCache) {
        paintedFromDom = paintBuyerPanelFromLiveDom(buyerUserId, resolvedNick);
      }
      if (!paintedFromCache && !paintedFromDom) {
        const loadingNick = resolveDisplayNick(resolvedNick, '');
        bodyEl.innerHTML = `${renderBuyerHeader(loadingNick || '切换中…', buyerUserId)}<div class="qsf-empty">正在同步订单…</div>`;
        watchOrderPanelAfterSwitch(buyerUserId, resolvedNick);
      }
    }
    if (!isPanelExpanded()) return;

    if (!buyerChanged && !orderPanelStale && panelHasStableContent()) return;

    if (!buyerChanged && orderPanelStale && refreshInFlight) {
      schedulePartialLoadRetry(buyerUserId);
      return;
    }

    if (Date.now() - lastPanelExpandAt < 500 && !buyerChanged) return;

    clearTimeout(buyerRefreshTimer);
    const painted = paintedFromCache || paintedFromDom;
    buyerRefreshTimer = setTimeout(() => {
      void refreshPanel({
        preferCache: true,
        reopen: false,
        force: false,
        waitForData: false,
        background: painted,
      });
    }, painted ? 50 : 0);
  }

  function scheduleActivateChatItem(item, opts = {}) {
    if (!item) return;
    rememberClickedChatItem(item);
    const appCid = getAppCidFromEl(item);
    const buyerUserId = uidFromAppCid(appCid);
    const headerNick = scrapeHeaderBuyerNick();
    const itemNick = nickFromChatItem(item);
    if (buyerUserId && buyerUserId === activeBuyer.buyerUserId && !orderPanelStale) {
      const nickAligned = !headerNick || headerNick === itemNick || headerNick === activeBuyer.buyerNick
        || nicksRoughlyMatch(headerNick, itemNick);
      if (nickAligned) return;
    }
    if (Date.now() - lastPanelExpandAt < 500 && buyerUserId === activeBuyer.buyerUserId) return;
    clearTimeout(activateTimer);
    const delay = opts.immediate ? 0 : 60;
    const gen = ++activationGeneration;
    activateTimer = setTimeout(() => {
      if (gen !== activationGeneration) return;
      if (window.__qfSfFeePanel?.version !== VERSION) return;
      queueSessionActivation({
        buyerUserId,
        appCid,
        buyerNick: itemNick || headerNick,
        fromChatClick: true,
      });
    }, delay);
  }

  function activateChatItem(item) {
    if (!item) return false;
    const appCid = getAppCidFromEl(item);
    if (!appCid) return false;
    scheduleActivateChatItem(item);
    return true;
  }

  function syncActiveBuyerFromDom() {
    const active = findActiveChatItemEl();
    if (active) {
      const appCid = getAppCidFromEl(active);
      const buyerUserId = uidFromAppCid(appCid);
      if (!buyerUserId) return;
      activeBuyer = { buyerUserId, buyerNick: nickFromChatItem(active) || scrapeHeaderBuyerNick(), appCid };
      return;
    }
    const headerNick = scrapeHeaderBuyerNick();
    if (headerNick) activeBuyer = { ...activeBuyer, buyerNick: headerNick };
  }

  function syncActiveSessionFromDom() {
    if (Date.now() - lastBuyerActivateAt < 700) return Boolean(activeBuyer.buyerUserId);
    const active = findActiveChatItemEl();
    const headerNick = scrapeHeaderBuyerNick();

    if (!active && !headerNick) {
      if (hasActiveBuyerSession()) {
        activeBuyer = { buyerUserId: '', buyerNick: '', appCid: '' };
        lastActivatedBuyerId = '';
        orderPanelStale = true;
        refreshSession++;
      }
      if (isPanelExpanded()) showIdlePanel();
      return false;
    }

    if (headerNick) lastSeenHeaderNick = headerNick;

    if (active) {
      const appCid = getAppCidFromEl(active);
      const buyerUserId = uidFromAppCid(appCid);
      if (buyerUserId && buyerUserId === activeBuyer.buyerUserId && !orderPanelStale) {
        const headerNick = scrapeHeaderBuyerNick();
        const itemNick = nickFromChatItem(active);
        if (
          nicksRoughlyMatch(itemNick, activeBuyer.buyerNick)
          || nicksRoughlyMatch(headerNick, activeBuyer.buyerNick)
        ) {
          return true;
        }
      }
      scheduleActivateChatItem(active);
      return true;
    }

    const headerUid = (() => {
      const byNick = resolveBuyerUserIdByNick(headerNick);
      if (byNick) return byNick;
      const matched = findChatItemByNick(headerNick);
      return matched ? uidFromAppCid(getAppCidFromEl(matched)) : '';
    })();
    const visibleUid = !headerUid ? resolveBuyerUserIdFromVisibleOrders() : '';

    if (headerUid && headerUid !== activeBuyer.buyerUserId) {
      orderPanelStale = true;
      const matchedItem = findChatItemByNick(headerNick);
      const appCid = matchedItem ? getAppCidFromEl(matchedItem) : '';
      queueSessionActivation({ buyerUserId: headerUid, appCid, buyerNick: headerNick, fromDomSync: true });
      return true;
    }

    if (visibleUid && visibleUid !== activeBuyer.buyerUserId) {
      orderPanelStale = true;
      queueSessionActivation({ buyerUserId: visibleUid, buyerNick: headerNick, fromDomSync: true });
      return true;
    }

    if (headerNick !== activeBuyer.buyerNick || !activeBuyer.buyerUserId) {
      const matchedItem = findChatItemByNick(headerNick);
      if (matchedItem) {
        scheduleActivateChatItem(matchedItem);
        return true;
      }
      const fallbackUid = headerUid || visibleUid;
      if (fallbackUid) {
        queueSessionActivation({ buyerUserId: fallbackUid, buyerNick: headerNick, fromDomSync: true });
        return true;
      }
      activeBuyer = { buyerUserId: '', buyerNick: headerNick, appCid: '' };
      if (isPanelExpanded()) showIdlePanel();
      else buildPanel();
    }
    return Boolean(activeBuyer.buyerUserId);
  }

  function syncActiveChatItem() {
    syncActiveSessionFromDom();
  }

  function bindHeaderBuyerObserver() {
    if (window.__qfSfHeaderObs) return;
    let timer = null;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const nick = scrapeHeaderBuyerNick();
        const nickChanged = Boolean(nick && nick !== lastSeenHeaderNick);
        if (nickChanged) lastSeenHeaderNick = nick;
        if (nickChanged || (nick && nick !== activeBuyer.buyerNick) || !activeBuyer.buyerUserId) {
          syncBrowserJumpSession();
          syncActiveSessionFromDom();
        }
      }, 300);
    });
    const attach = () => {
      const el = document.querySelector('.user-info-detail') || document.querySelector('.user-info');
      if (!el || el.__qsfHeaderObserved) return;
      el.__qsfHeaderObserved = true;
      obs.observe(el, { childList: true, subtree: true, characterData: true });
      lastSeenHeaderNick = scrapeHeaderBuyerNick() || lastSeenHeaderNick;
    };
    attach();
    headerSyncTimer = setInterval(attach, HEADER_ATTACH_POLL_MS);
    window.__qfSfHeaderObs = obs;
  }

  function bindSessionPoll() {
    if (sessionPollTimer) return;
    sessionPollTimer = setInterval(() => {
      const active = findActiveChatItemEl();
      const nick = scrapeHeaderBuyerNick();
      if (!active && !nick) {
        if (hasActiveBuyerSession()) syncActiveSessionFromDom();
        else if (isPanelExpanded()) showIdlePanel();
        return;
      }
      if (!activeBuyer.buyerUserId || nick !== lastSeenHeaderNick || nick !== activeBuyer.buyerNick) {
        syncBrowserJumpSession();
        syncActiveSessionFromDom();
      }
    }, SESSION_POLL_MS);
  }

  function bindClickListener() {
    if (window.__qfSfChatClickHandler) return;
    window.__qfSfChatClickHandler = (ev) => {
      const item = findChatItem(ev.target);
      if (!item) return;
      scheduleActivateChatItem(item, { immediate: true });
    };
    document.addEventListener('click', window.__qfSfChatClickHandler, true);
  }

  function mutationInsidePanel(node) {
    if (!node || node.nodeType !== 1) return false;
    const root = document.getElementById(PANEL_ID);
    return Boolean(root && (node === root || root.contains(node)));
  }

  function bindBrowserJumpWatcher() {
    if (window.__qsfBrowserJumpCleanup) {
      window.__qsfBrowserJumpCleanup();
    }
    let lastLatestChatsSig = '';
    const tick = () => {
      if (window.__qfSfFeePanel?.version !== VERSION) return;
      let latestChanged = false;
      try {
        const sig = String(localStorage.getItem('latestChats') || '').slice(0, 240);
        if (sig && sig !== lastLatestChatsSig) {
          lastLatestChatsSig = sig;
          latestChanged = true;
        }
      } catch {
        /* ignore */
      }
      if (latestChanged || !hasActiveBuyerSession() || orderPanelStale || scrapeHeaderBuyerNick()) {
        syncBrowserJumpSession();
      }
      maybeClearOrderPanelStale();
      if (!activeBuyer.buyerUserId) syncActiveSessionFromDom();
    };
    const onHash = () => tick();
    const onPop = () => tick();
    const onQfSync = (ev) => {
      const appCid = String(ev?.detail?.appCid || '').trim();
      if (!appCid.startsWith('$3$')) return;
      const buyerUserId = uidFromAppCid(appCid);
      if (!buyerUserId) return;
      queueSessionActivation({
        buyerUserId,
        appCid,
        buyerNick: scrapeHeaderBuyerNick(),
        fromExternalOpen: true,
      });
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onPop);
    window.addEventListener('qf-sync-messages', onQfSync);
    const nativePush = history.pushState.bind(history);
    const nativeReplace = history.replaceState.bind(history);
    history.pushState = function qsfPushState(...args) {
      const ret = nativePush(...args);
      tick();
      return ret;
    };
    history.replaceState = function qsfReplaceState(...args) {
      const ret = nativeReplace(...args);
      tick();
      return ret;
    };
    const t1 = setTimeout(tick, 300);
    const t2 = setTimeout(tick, 1200);
    const intervalId = setInterval(() => {
      if (!hasActiveBuyerSession() || orderPanelStale || scrapeHeaderBuyerNick()) tick();
    }, 2000);
    let burst = 0;
    const burstId = setInterval(() => {
      burst += 1;
      tick();
      if (burst >= 24) clearInterval(burstId);
    }, 500);
    window.__qsfBrowserJumpBound = true;
    window.__qsfBrowserJumpCleanup = () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('qf-sync-messages', onQfSync);
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(intervalId);
      clearInterval(burstId);
      history.pushState = nativePush;
      history.replaceState = nativeReplace;
      delete window.__qsfBrowserJumpBound;
      delete window.__qsfBrowserJumpCleanup;
    };
  }

  function bindScrollPerfGuards() {
    if (window.__qsfScrollPerfBound) return;
    window.__qsfScrollPerfBound = true;
    const onScroll = (ev) => {
      const panel = document.getElementById(PANEL_ID);
      if (panel && ev?.target && panel.contains(ev.target)) return;
      markUserScrolling();
    };
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  }

  function bindOrderPanelDomObserver() {
    if (window.__qsfOrderPanelObs) return;
    let timer = null;
    const obs = new MutationObserver(() => {
      if (isUserScrolling()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (isUserScrolling()) return;
        const root = orderPanelRoot();
        if (!root) return;
        const nextCount = root.querySelectorAll('.order-card .order-card-title-id').length;
        if (nextCount === orderDomCache.ids.length && Date.now() - orderDomCache.at < 2500) return;
        invalidateOrderDomCache();
      }, 480);
    });
    const attach = () => {
      const root = orderPanelRoot();
      if (!root || root.__qsfOrderObserved) return;
      root.__qsfOrderObserved = true;
      obs.observe(root, { childList: true, subtree: true });
    };
    attach();
    setInterval(attach, HEADER_ATTACH_POLL_MS);
    window.__qsfOrderPanelObs = obs;
  }

  function bindActiveChatObserver() {
    if (window.__qfSfFeeChatObs) return;
    let traceTimer = null;
    let syncTimer = null;
    const obs = new MutationObserver((mutations) => {
      let chatChanged = false;
      for (const m of mutations) {
        if (mutationInsidePanel(m.target)) continue;
        if (m.type !== 'attributes') continue;
        const el = m.target;
        if (!el?.classList) continue;
        const cls = [...el.classList].join(' ');
        if ((cls.includes('chat-item') || /search|session|result|conv|contact/i.test(cls))
          && (m.attributeName === 'class'
          || m.attributeName === 'aria-selected'
          || m.attributeName === 'aria-current'
          || m.attributeName === 'data-key')) {
          chatChanged = true;
        }
        if (el.hasAttribute('data-key') && String(el.getAttribute('data-key') || '').startsWith('$3$')
          && (m.attributeName === 'class' || m.attributeName === 'aria-selected' || m.attributeName === 'aria-current')) {
          chatChanged = true;
        }
      }
      if (chatChanged) {
        if (Date.now() - lastBuyerActivateAt < 700) return;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
          syncBrowserJumpSession();
          syncActiveSessionFromDom();
        }, 450);
      }
      if (!panelEl?.classList.contains('qsf-expanded')) return;
      clearTimeout(traceTimer);
      traceTimer = setTimeout(() => {
        if (isUserScrolling()) return;
        if (activeBuyer.buyerUserId) patchTraceDisplay();
      }, 1800);
    });
    obs.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-selected', 'aria-current'],
    });
    window.__qfSfFeeChatObs = obs;
  }

  // ─── 启动（等待 body 就绪，避免刷新后注入失败）────────────────────
  function startPanel() {
    if (!document.body) return;
    if (window.__qfSfFeePanel?.version === VERSION && document.getElementById(PANEL_ID)) {
      hookFetch();
      hookXhr();
      buildPanel();
      ensureIconInViewport();
      syncActiveSessionFromDom();
      return;
    }
    try {
      if (sessionStorage.getItem('qsf_fee_cache_ver') !== VERSION) {
        expressCache.clear();
        clearBuyerPanelCache();
        sessionStorage.setItem('qsf_fee_cache_ver', VERSION);
      }
    } catch {
      expressCache.clear();
      clearBuyerPanelCache();
    }
    ensureBuyerCacheVersion();
    hookFetch();
    hookXhr();
    buildPanel();
    patchAllVersionLabels();
    bindClickListener();
    bindActiveChatObserver();
    bindHeaderBuyerObserver();
    bindSessionPoll();
    bindScrollPerfGuards();
    bindOrderPanelDomObserver();
    bindBrowserJumpWatcher();
    restorePinnedPanelState(false);
    ensureIconInViewport();
    window.addEventListener('resize', ensureIconInViewport);
    setTimeout(syncActiveSessionFromDom, 400);
    setTimeout(syncBrowserJumpSession, 600);

    try {
      const uiVer = sessionStorage.getItem('qsf_fee_ui_ver');
      sessionStorage.setItem('qsf_fee_ui_ver', VERSION);
      if (uiVer && uiVer !== VERSION && panelEl?.classList.contains('qsf-expanded')) {
        if (hasActiveBuyerSession()) {
          setTimeout(() => void refreshPanel({ preferCache: true }), 300);
        } else {
          showIdlePanel();
        }
      }
    } catch {
      /* ignore */
    }

    window.__qfSfFeePanel = {
      version: VERSION,
      refresh: refreshPanel,
      setBuyer: onBuyerActivated,
      getActiveBuyer: () => ({ ...activeBuyer }),
      syncSession: syncActiveSessionFromDom,
      teardown: teardownPanel,
      patchVersionLabels: patchAllVersionLabels,
      clearCache: () => {
        expressCache.clear();
        sfFeeInflight.clear();
        buyerPackages.clear();
        buyerPackageById.clear();
        clearBuyerPanelCache();
      },
    };
    window.__qfSfExpandPanel = expandPanel;

    console.log(`[顺丰运费] 侧栏 v${VERSION} 已注入。配置：侧栏 ⚙ → 填入丰桥 partnerID / checkWord`);
  }

  function bootPanel() {
    if (document.body) {
      startPanel();
      return;
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startPanel, { once: true });
      return;
    }
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (document.body) {
        clearInterval(timer);
        startPanel();
      } else if (tries >= 200) {
        clearInterval(timer);
      }
    }, 50);
  }

  bootPanel();
})();
