/**
 * 千帆客服台 · 顺丰月结运费侧栏（页面注入脚本）
 * 由 src/auto-inject.js 通过 CDP 自动注入，无需手动粘贴。
 * 丰桥凭证：config.json → sf.partnerID / sf.checkWord（或侧栏 ⚙ 一次）
 */
(function qfSfFeePanelBootstrap() {
  const VERSION = '1.0.31';
  const ICON_POS_KEY = 'qsf_icon_pos_v1';
  const STORAGE_KEY = 'qf_sf_fee_config_v1';
  const BUYER_CACHE_KEY = 'qsf_buyer_panel_v1';
  const MAX_BUYER_CACHE = 80;
  const SF_PROD = 'https://sfapi.sf-express.com/std/service';
  const SF_SBOX = 'https://sfapi-sbox.sf-express.com/std/service';
  const PANEL_ID = 'qf-sf-fee-panel-root';

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

  if (window.__qfSfFeePanel?.version === VERSION) {
    console.log('[顺丰运费] 已加载，版本', window.__qfSfFeePanel.version);
    qsfEnsureFooter();
    if (!document.getElementById(PANEL_ID)) {
      delete window.__qfSfFeePanel;
    } else {
      const root = document.getElementById(PANEL_ID);
      if (root?.classList.contains('qsf-expanded') && typeof window.__qfSfFeePanel.refresh === 'function') {
        void window.__qfSfFeePanel.refresh({ preferCache: true });
      }
      return;
    }
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
      if (window.__qfSfLauncherDragCleanup) {
        window.__qfSfLauncherDragCleanup();
        delete window.__qfSfLauncherDragCleanup;
      }
    } catch {
      /* ignore */
    }
  }

  // ─── MD5（丰桥 msgDigest） ─────────────────────────────────────────
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
    function md5blk(s) {
      const blks = [];
      for (let i = 0; i < 64; i += 4) {
        blks[i >> 2] =
          s.charCodeAt(i) |
          (s.charCodeAt(i + 1) << 8) |
          (s.charCodeAt(i + 2) << 16) |
          (s.charCodeAt(i + 3) << 24);
      }
      return blks;
    }
    const utf8 = unescape(encodeURIComponent(str));
    const n = utf8.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= n; i += 64) {
      const blk = md5blk(utf8.substring(i - 64, i));
      let a = state[0];
      let b = state[1];
      let c = state[2];
      let d = state[3];
      a = ff(a, b, c, d, blk[0], 7, -680876936);
      d = ff(d, a, b, c, blk[1], 12, -389564586);
      c = ff(c, d, a, b, blk[2], 17, 606105819);
      b = ff(b, c, d, a, blk[3], 22, -1044525330);
      a = ff(a, b, c, d, blk[4], 7, -176418897);
      d = ff(d, a, b, c, blk[5], 12, 1200080426);
      c = ff(c, d, a, b, blk[6], 17, -1473231341);
      b = ff(b, c, d, a, blk[7], 22, -45705983);
      a = ff(a, b, c, d, blk[8], 7, 1770035416);
      d = ff(d, a, b, c, blk[9], 12, -1958414417);
      c = ff(c, d, a, b, blk[10], 17, -42063);
      b = ff(b, c, d, a, blk[11], 22, -1990404162);
      a = ff(a, b, c, d, blk[12], 7, 1804603682);
      d = ff(d, a, b, c, blk[13], 12, -40341101);
      c = ff(c, d, a, b, blk[14], 17, -1502002290);
      b = ff(b, c, d, a, blk[15], 22, 1236535329);
      a = gg(a, b, c, d, blk[1], 5, -165796510);
      d = gg(d, a, b, c, blk[6], 9, -1069501632);
      c = gg(c, d, a, b, blk[11], 14, 643717713);
      b = gg(b, c, d, a, blk[0], 20, -373897302);
      a = gg(a, b, c, d, blk[5], 5, -701558691);
      d = gg(d, a, b, c, blk[10], 9, 38016083);
      c = gg(c, d, a, b, blk[15], 14, -660478335);
      b = gg(b, c, d, a, blk[4], 20, -405537848);
      a = gg(a, b, c, d, blk[9], 5, 568446438);
      d = gg(d, a, b, c, blk[14], 9, -1019803690);
      c = gg(c, d, a, b, blk[3], 14, -187363961);
      b = gg(b, c, d, a, blk[8], 20, 1163531501);
      a = gg(a, b, c, d, blk[13], 5, -1444681467);
      d = gg(d, a, b, c, blk[2], 9, -51403784);
      c = gg(c, d, a, b, blk[7], 14, 1735328473);
      b = gg(b, c, d, a, blk[12], 20, -1926607734);
      a = hh(a, b, c, d, blk[5], 4, -378558);
      d = hh(d, a, b, c, blk[8], 11, -2022574463);
      c = hh(c, d, a, b, blk[11], 16, 1839030562);
      b = hh(b, c, d, a, blk[14], 23, -35309556);
      a = hh(a, b, c, d, blk[1], 4, -1530992060);
      d = hh(d, a, b, c, blk[4], 11, 1272893353);
      c = hh(c, d, a, b, blk[7], 16, -155497632);
      b = hh(b, c, d, a, blk[10], 23, -1094730640);
      a = hh(a, b, c, d, blk[13], 4, 681279174);
      d = hh(d, a, b, c, blk[0], 11, -358537222);
      c = hh(c, d, a, b, blk[3], 16, -722521979);
      b = hh(b, c, d, a, blk[6], 23, 76029189);
      a = hh(a, b, c, d, blk[9], 4, -640364487);
      d = hh(d, a, b, c, blk[12], 11, -421815835);
      c = hh(c, d, a, b, blk[15], 16, 530742520);
      b = hh(b, c, d, a, blk[2], 23, -995338651);
      a = ii(a, b, c, d, blk[0], 6, -198630844);
      d = ii(d, a, b, c, blk[7], 10, 1126891415);
      c = ii(c, d, a, b, blk[14], 15, -1416354905);
      b = ii(b, c, d, a, blk[5], 21, -57434055);
      a = ii(a, b, c, d, blk[12], 6, 1700485571);
      d = ii(d, a, b, c, blk[3], 10, -1894986606);
      c = ii(c, d, a, b, blk[10], 15, -1051523);
      b = ii(b, c, d, a, blk[1], 21, -2054922799);
      a = ii(a, b, c, d, blk[8], 6, 1873313359);
      d = ii(d, a, b, c, blk[15], 10, -30611744);
      c = ii(c, d, a, b, blk[6], 15, -1560198380);
      b = ii(b, c, d, a, blk[13], 21, 1309151649);
      a = ii(a, b, c, d, blk[4], 6, -145523070);
      d = ii(d, a, b, c, blk[11], 10, -1120210379);
      c = ii(c, d, a, b, blk[2], 15, 718787259);
      b = ii(b, c, d, a, blk[9], 21, -343485551);
      state[0] = (state[0] + a) | 0;
      state[1] = (state[1] + b) | 0;
      state[2] = (state[2] + c) | 0;
      state[3] = (state[3] + d) | 0;
    }
    const tail = utf8.substring(i - 64);
    const rest = new Array(16).fill(0);
    for (let j = 0; j < tail.length; j++) rest[j >> 2] |= tail.charCodeAt(j) << ((j % 4) << 3);
    rest[tail.length >> 2] |= 0x80 << ((tail.length % 4) << 3);
    rest[14] = n * 8;
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
  function loadConfig() {
    try {
      return { partnerID: '', checkWord: '', checkWordSandbox: '', sandbox: false, phoneLast4: '', ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch {
      return { partnerID: '', checkWord: '', checkWordSandbox: '', sandbox: false, phoneLast4: '' };
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
    return nick;
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
    return `${cfg.sandbox ? 'sbox' : 'prod'}:${no}`;
  }

  function panelConfigCacheKey(cfg) {
    const mode = cfg.sandbox ? 'sbox' : 'prod';
    const partner = String(cfg.partnerID || '').trim();
    return `${mode}:${partner}`;
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
      if (node.classList && [...node.classList].some((c) => c.includes('chat-item'))) return node;
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
  let activeBuyer = { buyerUserId: '', buyerNick: '', appCid: '' };
  let refreshInFlight = false;
  let refreshSession = 0;
  let orderPanelStale = false;

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

  function pkgByIdKey(buyerUserId, packageId) {
    const uid = String(buyerUserId || '').trim();
    const pid = String(packageId || '').trim();
    return uid && pid ? `${uid}:${pid}` : '';
  }

  function getVisibleOrderPackageIds() {
    const root = orderPanelRoot();
    if (!root) return [];
    const ids = [];
    const seen = new Set();
    for (const el of root.querySelectorAll('.order-card .order-card-title-id')) {
      const id = el.textContent?.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
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

  async function waitForOrderPanelReady(sessionId, maxMs = 1100) {
    const deadline = Date.now() + maxMs;
    let lastSnap = getOrderPanelSnapshot();
    while (Date.now() < deadline) {
      if (sessionId !== undefined && sessionId !== refreshSession) return null;
      const snap = getOrderPanelSnapshot();
      lastSnap = snap;
      if (snap.cardCount > 0) return snap;
      if (snap.empty) return snap;
      if (snap.ready && !snap.loading && snap.cardCount === 0) return snap;
      await sleep(50);
    }
    return lastSnap;
  }

  function tryQuickCollect(buyerUserId) {
    const uid = String(buyerUserId || '').trim();
    if (!uid || orderPanelStale) return null;
    const snap = getOrderPanelSnapshot();
    if (snap.empty) return [];
    scrapeOrderCardsFromPanel();
    pruneStalePackagesForBuyer(uid);
    const visibleIds = getVisibleOrderPackageIds();
    if (!visibleIds.length) {
      if (snap.ready && snap.cardCount === 0) return [];
      return null;
    }
    const pkgs = collectAllPackages(uid);
    const loaded = countLoadedOrderExpress(uid, visibleIds);
    if (loaded >= visibleIds.length) return pkgs;
    if (pkgs.length && loaded > 0 && pkgs.length <= visibleIds.length) return pkgs;
    return null;
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

  function findCardByPackageId(packageId) {
    const root = orderPanelRoot();
    if (!root || !packageId) return null;
    for (const card of root.querySelectorAll('.order-card')) {
      const id = card.querySelector('.order-card-title-id')?.textContent?.trim();
      if (id === packageId) return card;
    }
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
  }

  function ingestPackageDetailEnvelope(json, meta = {}) {
    if (!json || typeof json !== 'object') return false;
    const data = json.data && typeof json.data === 'object' ? json.data : null;
    if (!data) return false;
    const urlPid = String(meta.packageId || '').trim();
    const packageId = String(data.package_id || data.packageId || urlPid || '').trim();
    if (!packageId) return false;
    const userId = String(data.user_id || data.buyer_user_id || '').trim();
    const expressNo = String(
      data.express_number || data.express_no || data.expressNo || data.ship_express_no || '',
    ).trim();
    const expressCompany = String(data.express_company || data.expressCompany || '').trim();
    const orderId = String(data.order_id || data.orderId || packageId).trim();
    const uid = userId || (isRelevantToActiveBuyer('', packageId) ? activeBuyer.buyerUserId : '');
    if (!uid) return false;
    const lastTrace = pickTraceText(data);
    indexPackageById(uid, {
      packageId,
      expressNo: expressNo.toUpperCase(),
      expressCompany,
      ...(lastTrace ? { lastTrace } : {}),
    });
    return Boolean(expressNo);
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
    let last = '';
    for (const pkg of buyerPackages.get(uid).values()) {
      if (pkg.lastTrace) last = pkg.lastTrace;
    }
    return last;
  }

  function walkJson(obj, fn, depth = 0) {
    if (!obj || depth > 14) return;
    if (Array.isArray(obj)) {
      for (const item of obj) walkJson(item, fn, depth + 1);
      return;
    }
    if (typeof obj === 'object') {
      fn(obj);
      for (const v of Object.values(obj)) walkJson(v, fn, depth + 1);
    }
  }

  function shouldIngestApiUrl(url) {
    const u = String(url || '');
    if (!u || /sf-express\.com/i.test(u)) return false;
    if (!/xiaohongshu/i.test(u)) return false;
    return /\/api\/edith\/(package|order|logistics|express)/i.test(u)
      || /search-list/i.test(u)
      || /\/package\//i.test(u)
      || /logistics/i.test(u);
  }

  function scheduleIngestRefresh(reason) {
    if (!activeBuyer.buyerUserId || refreshInFlight) return;
    if (reason === 'traceOnly') {
      if (isPanelExpanded()) patchTraceDisplay();
    }
    // 不因 hook 到新运单号就自动全量刷新，避免重复查费、长时间 loading
  }

  function patchTraceDisplay() {
    if (!bodyEl || !activeBuyer.buyerUserId) return;
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

  function ingestJsonBody(json, meta = {}) {
    if (!json || typeof json !== 'object') return;
    const reqUrl = String(meta.url || '');
    const urlPid = String(meta.packageId || parsePackageIdFromUrl(reqUrl) || '').trim();
    let refreshReason = null;
    const fromDetail = ingestPackageDetailEnvelope(json, { ...meta, packageId: urlPid });
    if (fromDetail && activeBuyer.buyerUserId) refreshReason = 'newExpress';
    if (!fromDetail && !shouldIngestApiUrl(reqUrl)) return;
    walkJson(json, (node) => {
      const buyerUserId = String(node.buyer_user_id || node.buyerUserId || '').trim();
      const expressNo = String(
        node.express_no || node.express_number || node.expressNo || node.ship_express_no || node.tracking_no || '',
      ).trim().toUpperCase();
      const expressCompany = String(node.express_company || node.expressCompanyName || node.express_company_name || '').trim();
      const packageId = String(node.package_id || node.packageId || '').trim();
      const lastTrace = pickTraceText(node);
      const isDetailUrl = /\/package\/[^/?#]+\/detail/i.test(String(meta.url || ''));
      const resolvedPackageId = packageId || (isDetailUrl && urlPid ? urlPid : '');
      const uid = buyerUserId
        || (resolvedPackageId && isRelevantToActiveBuyer('', resolvedPackageId) ? activeBuyer.buyerUserId : '');
      const isActive = Boolean(uid && uid === activeBuyer.buyerUserId);
      const pkgBase = {
        expressCompany,
        orderId: resolvedPackageId,
        packageId: resolvedPackageId,
        ...(lastTrace ? { lastTrace } : {}),
      };

      if (!uid || !resolvedPackageId) return;

      if (expressNo) {
        const hadExpress = buyerPackages.get(uid)?.has(expressNo);
        indexPackageById(uid, { ...pkgBase, expressNo });
        if (isActive && isSfExpressNo(expressNo)) {
          indexPackage(uid, { ...pkgBase, expressNo, packageId: resolvedPackageId });
          refreshReason = hadExpress ? 'traceOnly' : 'newExpress';
        }
      } else if (lastTrace && isActive) {
        const prevPkg = buyerPackageById.get(pkgByIdKey(uid, resolvedPackageId));
        if (prevPkg?.expressNo) {
          indexPackageById(uid, { ...prevPkg, lastTrace });
          refreshReason = 'traceOnly';
        }
      }
    });
    if (refreshReason) scheduleIngestRefresh(refreshReason);
  }

  function hookFetch() {
    if (window.__qfSfFeeFetchHooked) return;
    window.__qfSfFeeFetchHooked = true;
    const orig = window.fetch.bind(window);
    window.fetch = async function patchedFetch(input, init) {
      const reqUrl = typeof input === 'string' ? input : input?.url || '';
      const res = await orig(input, init);
      if (/sf-express\.com/i.test(reqUrl)) return res;
      try {
        if (!shouldIngestApiUrl(reqUrl)) return res;
        const clone = res.clone();
        const ct = clone.headers.get('content-type') || '';
        if (ct.includes('json') || /xiaohongshu/i.test(reqUrl)) {
          const meta = { url: reqUrl, packageId: parsePackageIdFromUrl(reqUrl) };
          clone.json().then((j) => ingestJsonBody(j, meta)).catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return res;
    };
  }

  function hookXhr() {
    if (window.__qfSfFeeXhrHooked) return;
    window.__qfSfFeeXhrHooked = true;
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__qfSfUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function patchedSend(body) {
      this.addEventListener('load', function onLoad() {
        try {
          const url = this.__qfSfUrl || '';
          if (!shouldIngestApiUrl(url)) return;
          const meta = { url, packageId: parsePackageIdFromUrl(url) };
          if (String(this.responseType) === 'json' && this.response) ingestJsonBody(this.response, meta);
          else if (typeof this.responseText === 'string' && this.responseText.startsWith('{')) {
            ingestJsonBody(JSON.parse(this.responseText), meta);
          }
        } catch {
          /* ignore */
        }
      }, { once: true });
      return origSend.apply(this, arguments);
    };
  }

  function scrapeLogisticsExpressNo() {
    const root = orderPanelRoot();
    if (!root) return '';
    const box = root.querySelector('.logistics-box') || root.querySelector('.delivery-row-logistics');
    if (!box) return '';
    const m = (box.innerText || '').match(/\b(SF\d{10,15})\b/i);
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

  function ingestOrderCardElement(card, buyerUserId) {
    if (!card || !buyerUserId) return;
    const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    if (!packageId) return;
    const logistics = card.querySelector('.delivery-row-logistics, .logistics-box');
    const { expressNo, expressCompany } = extractExpressFromCardLogistics(card);
    const primaryNo = scrapeLogisticsExpressNo();
    indexPackageById(buyerUserId, {
      orderId: packageId,
      packageId,
      ...(expressNo ? {
        expressNo,
        expressCompany: expressCompany || (isSfExpressNo(expressNo) ? '顺丰' : ''),
        primary: expressNo === primaryNo,
        lastTrace: scrapeLogisticsFromBox(logistics),
      } : {}),
    });
  }

  async function waitForCardPackageData(buyerUserId, packageId, card, sessionId, timeoutMs = 800) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (sessionId !== undefined && sessionId !== refreshSession) return null;
      const cached = buyerPackageById.get(pkgByIdKey(buyerUserId, packageId));
      if (cached?.expressNo) return cached;
      ingestOrderCardElement(card, buyerUserId);
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

  function cardNeedsExpressLoad(buyerUserId, card, packageId) {
    const cached = buyerPackageById.get(pkgByIdKey(buyerUserId, packageId));
    if (cached?.expressNo) return false;
    return !extractExpressFromCardLogistics(card).expressNo;
  }

  function hasPendingExpressLoad(buyerUserId) {
    const root = orderPanelRoot();
    if (!root) return false;
    for (const card of root.querySelectorAll('.order-card')) {
      const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      if (packageId && cardNeedsExpressLoad(buyerUserId, card, packageId)) return true;
    }
    return false;
  }

  async function autoLoadOrderCards(buyerUserId, sessionId) {
    const root = orderPanelRoot();
    if (!root || !buyerUserId) return;
    const cards = [...root.querySelectorAll('.order-card')];
    if (!cards.length) return;
    const pending = cards.filter((card) => {
      const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      return packageId && cardNeedsExpressLoad(buyerUserId, card, packageId);
    });
    if (!pending.length) return;
    for (const card of pending) {
      if (sessionId !== undefined && sessionId !== refreshSession) return;
      const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      if (!packageId) continue;
      ingestOrderCardElement(card, buyerUserId);
      try {
        card.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      } catch {
        /* ignore */
      }
      await sleep(30);
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
      await waitForCardPackageData(buyerUserId, packageId, card, sessionId, hasLogistics ? 800 : 320);
    }
  }

  function scrapeOrderCardsFromPanel() {
    const root = orderPanelRoot();
    if (!root) return [];
    const primaryNo = scrapeLogisticsExpressNo();
    const found = new Map();
    root.querySelectorAll('.order-card').forEach((card) => {
      if (activeBuyer.buyerUserId) ingestOrderCardElement(card, activeBuyer.buyerUserId);
      const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      const { expressNo, expressCompany } = extractExpressFromCardLogistics(card);
      if (!expressNo || !packageId) return;
      found.set(packageId, {
        expressNo,
        expressCompany: expressCompany || (isSfExpressNo(expressNo) ? '顺丰' : ''),
        orderId: packageId,
        packageId,
        primary: expressNo === primaryNo,
        lastTrace: scrapeLogisticsFromBox(card.querySelector('.delivery-row-logistics, .logistics-box')),
      });
    });
    return sortSfPackages([...found.values()]);
  }

  function scrapeDomExpress() {
    const pkgs = scrapeOrderCardsFromPanel();
    if (activeBuyer.buyerUserId) {
      for (const pkg of pkgs) indexPackageById(activeBuyer.buyerUserId, pkg);
    }
    return pkgs;
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

  async function collectAllPackagesAsync(buyerUserId, sessionId) {
    const quick = tryQuickCollect(buyerUserId);
    if (quick !== null) {
      orderPanelStale = false;
      return quick;
    }
    const panelSnap = await waitForOrderPanelReady(sessionId, 1100);
    if (sessionId !== undefined && sessionId !== refreshSession) return [];
    orderPanelStale = false;
    if (panelSnap?.empty || (panelSnap?.ready && panelSnap.cardCount === 0 && !panelSnap?.loading)) {
      return [];
    }
    if (!panelSnap?.cardCount && panelSnap?.loading) {
      const retry = await waitForOrderPanelReady(sessionId, 700);
      if (sessionId !== undefined && sessionId !== refreshSession) return [];
      if (retry?.empty || (retry?.ready && retry.cardCount === 0)) return [];
      if (!retry?.cardCount) return [];
    } else if (!panelSnap?.cardCount) {
      return [];
    }
    await autoLoadOrderCards(buyerUserId, sessionId);
    return collectAllPackages(buyerUserId);
  }

  function packagesForBuyer(buyerUserId) {
    return collectAllPackages(buyerUserId);
  }

  // ─── 顺丰清单运费 ───────────────────────────────────────────────────
  async function querySfWaybillFee(expressNo, cfg) {
    const no = String(expressNo || '').trim();
    if (!no) return { ok: false, error: '缺少运单号' };
    if (!isSfExpressNo(no)) return makeNonSfFeeResult(no);
    const ck = feeCacheKey(cfg, no);
    if (expressCache.has(ck)) {
      const cached = expressCache.get(ck);
      if (
        cached.ok
        || cached.skipped
        || cached.apiCode === 'A1004'
        || cached.apiCode === '8152'
        || cached.apiCode === '8148'
      ) return cached;
      expressCache.delete(ck);
    }
    if (sfFeeInflight.has(ck)) return sfFeeInflight.get(ck);

    const job = (async () => {
      if (!cfg.partnerID || !resolveCheckWord(cfg)) {
        const hint = cfg.sandbox ? '请配置沙箱校验码 checkWordSandbox' : '请配置丰桥 partnerID 与 checkWord';
        return { ok: false, error: `请先在 ⚙ ${hint}` };
      }

      const checkWord = resolveCheckWord(cfg);
      const msgData = JSON.stringify({ trackingType: '2', trackingNum: no, ...(cfg.phoneLast4 ? { phone: cfg.phoneLast4 } : {}) });
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
          const result = { ok: false, error: errMsg, apiCode };
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
          } else if (String(inner.errorCode || '') === '8148' || /没有运单信息/.test(errMsg)) {
            errMsg =
              '丰桥查不到该运单的月结费用（8148）。'
              + '千帆有物流轨迹 ≠ 该单挂在你月结账号下；'
              + '常见原因：退回件单号、他司月结发货、买家付运费。请以下方有金额的运单为准。';
          }
          const result = { ok: false, error: errMsg, raw: inner, apiCode: apiCode || String(inner.errorCode || '') };
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
        expressCache.set(ck, result);
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
    return `${renderBuyerHeader(buyerNick, buyerUserId)}<div class="qsf-buffer"><div class="qsf-buffer-bar"><div class="qsf-buffer-bar-inner"></div></div><div class="qsf-loading">${esc(text || '正在加载运单信息…')}</div></div>`;
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

  function renderPanelCards(buyerNick, buyerUserId, cards, updatedAt, opts = {}) {
    const fromCache = opts.fromCache === true;
    const sorted = sortPanelCards(cards);
    let html = renderBuyerHeader(buyerNick, buyerUserId);
    const okCards = sorted.filter((c) => c.fee?.ok);
    if (sorted.length > 1) {
      const sum = okCards.reduce((s, c) => s + (Number(c.fee?.totalFee) || 0), 0);
      html += `<div class="qsf-summary">共 ${sorted.length} 个运单 · 可计费 ${okCards.length} 单 · 合计 ${money(sum)}</div>`;
    }
    for (const { pkg, fee } of sorted) {
      html += `<div class="qsf-card">`;
      const companyLabel = pkg.expressCompany && !isSfExpressNo(pkg.expressNo)
        ? `${esc(pkg.expressCompany)} · `
        : '';
      html += `<div class="qsf-no">${companyLabel}${esc(pkg.expressNo)}</div>`;
      if (sorted.length > 1 && (pkg.orderId || (pkg.orderIds && pkg.orderIds.length))) {
        const ids = mergeOrderIds(pkg.orderIds, pkg.orderId);
        if (ids.length) html += `<div class="qsf-meta" style="margin-top:2px;">订单 ${esc(ids.join(' / '))}</div>`;
      }
      if (fee?.skipped) {
        html += `<div class="qsf-hint">${esc(fee.error)}</div>`;
      } else if (!fee?.ok) {
        html += `<div class="qsf-err">${esc(fee?.error || '查询失败')}</div>`;
      } else {
        html += `<div class="qsf-total">${money(fee.totalFee)}</div>`;
        html += renderFeeCardMeta(fee, pkg);
        for (const line of fee.fees || []) {
          html += `<div class="qsf-fee-line"><span>${esc(line.name)}${line.settlement ? ` (${line.settlement})` : ''}</span><span>${money(line.amount)}</span></div>`;
        }
      }
      html += `</div>`;
    }
    const hint = fromCache ? ' · 点 ↻ 重新查询' : '';
    html += `<div class="qsf-meta" style="text-align:center;margin-top:8px;">${formatPanelFooterTime(updatedAt, fromCache)} · v${VERSION}${hint}</div>`;
    return html;
  }

  function sfPackagesForBuyer(buyerUserId) {
    return packagesForBuyer(buyerUserId).filter((p) => isSfExpressNo(p.expressNo));
  }

  function renderEmptySfPanel(buyerNick, buyerUserId, opts = {}) {
    const fromCache = opts.fromCache === true;
    const updatedAt = opts.updatedAt || Date.now();
    const noOrder = opts.noOrder === true;
    let msg = noOrder
      ? '该买家暂无订单'
      : '未找到顺丰运单号';
    if (!noOrder) {
      msg += '<br><br>请确认该买家已发货，并在千帆右侧订单区加载完成后再点 ↻ 刷新'
        + '<br><small>侧栏会从页面网络响应和 DOM 中自动抓取 express_no</small>';
    }
    const hint = fromCache ? ' · 点 ↻ 重新查询' : '';
    return `
      ${renderBuyerHeader(buyerNick, buyerUserId)}
      <div class="qsf-empty">${msg}</div>
      <div class="qsf-meta" style="text-align:center;margin-top:8px;">${formatPanelFooterTime(updatedAt, fromCache)} · v${VERSION}${hint}</div>
    `;
  }

  async function waitForSfPackages(buyerUserId, sessionId) {
    const quick = tryQuickCollect(buyerUserId);
    if (quick !== null) {
      orderPanelStale = false;
      return quick;
    }

    let panelSnap = await waitForOrderPanelReady(sessionId, 1100);
    if (sessionId !== refreshSession) return null;
    orderPanelStale = false;
    pruneStalePackagesForBuyer(buyerUserId);

    if (panelSnap?.empty) return [];

    if (!panelSnap?.cardCount) {
      if (panelSnap?.loading) {
        panelSnap = await waitForOrderPanelReady(sessionId, 700);
        if (sessionId !== refreshSession) return null;
      }
      if (panelSnap?.empty || (panelSnap?.ready && panelSnap.cardCount === 0)) return [];
      if (!panelSnap?.cardCount) return [];
    }

    const visibleIds = getVisibleOrderPackageIds();
    const cardCount = visibleIds.length || panelSnap?.cardCount || 0;
    if (!cardCount) return [];

    const maxMs = Math.min(6000, 800 + (cardCount - countLoadedOrderExpress(buyerUserId, visibleIds)) * 400);
    const deadline = Date.now() + maxMs;
    await autoLoadOrderCards(buyerUserId, sessionId);
    let pkgs = collectAllPackages(buyerUserId);
    if (countLoadedOrderExpress(buyerUserId, visibleIds) >= cardCount) return pkgs;

    while (Date.now() < deadline) {
      if (sessionId !== refreshSession) return null;
      if (!hasPendingExpressLoad(buyerUserId)) return pkgs;
      await autoLoadOrderCards(buyerUserId, sessionId);
      pkgs = collectAllPackages(buyerUserId);
      if (countLoadedOrderExpress(buyerUserId, visibleIds) >= cardCount) return pkgs;
      await sleep(100);
    }
    return pkgs;
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

  function expandPanel() {
    if (!panelEl) return;
    panelEl.classList.remove('qsf-icon-only');
    panelEl.classList.add('qsf-expanded');
    clearIconInlinePos();
    void refreshPanel({ preferCache: true });
  }

  function collapseToIcon() {
    if (!panelEl) return;
    refreshSession++;
    refreshInFlight = false;
    panelEl.classList.add('qsf-icon-only');
    panelEl.classList.remove('qsf-expanded');
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
        position: fixed; z-index: 2147483000; pointer-events: none;
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
        top: 48px; right: 0; bottom: 0; width: 300px; left: auto !important;
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
      #${PANEL_ID} .qsf-body.is-busy { opacity: 0.72; pointer-events: none; transition: opacity 0.15s; }
      #${PANEL_ID} .qsf-body { flex: 1; overflow: auto; padding: 10px 12px; }
      #${PANEL_ID} .qsf-buyer { margin-bottom: 10px; padding: 8px; background: #f0f9ff; border-radius: 8px; }
      #${PANEL_ID} .qsf-buyer-nick { font-weight: 600; }
      #${PANEL_ID} .qsf-buyer-trace {
        color: #4b5563; font-size: 11px; line-height: 1.45; margin-top: 4px;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      #${PANEL_ID} .qsf-card {
        border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; margin-bottom: 10px; background: #fff;
      }
      #${PANEL_ID} .qsf-no { font-family: ui-monospace, monospace; font-weight: 600; color: #111827; }
      #${PANEL_ID} .qsf-meta { color: #6b7280; font-size: 11px; margin-top: 4px; line-height: 1.45; }
      #${PANEL_ID} .qsf-meta-warn { color: #b45309; }
      #${PANEL_ID} .qsf-total { font-size: 18px; font-weight: 700; color: #dc2626; margin: 6px 0; }
      #${PANEL_ID} .qsf-summary {
        margin-bottom: 10px; padding: 8px 10px; background: #fef2f2; border-radius: 8px;
        color: #991b1b; font-size: 12px; font-weight: 600; text-align: center;
      }
      #${PANEL_ID} .qsf-fee-line { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
      #${PANEL_ID} .qsf-err { color: #dc2626; font-size: 12px; }
      #${PANEL_ID} .qsf-hint { color: #92400e; font-size: 12px; line-height: 1.5; }
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
    let style = document.getElementById('qf-sf-fee-panel-style');
    if (style) {
      style.textContent = css;
      return;
    }
    style = document.createElement('style');
    style.id = 'qf-sf-fee-panel-style';
    style.textContent = css;
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
      bindLauncherDrag();
      if (panelEl.classList.contains('qsf-icon-only')) applyIconPosition();
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
    document.body.appendChild(panelEl);
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
    bodyEl.innerHTML = '<div class="qsf-empty">点击左侧买家会话，将自动查询顺丰运单月结扣费</div>';
    qsfEnsureFooter();
  }

  function renderSettingsForm() {
    const cfg = loadConfig();
    settingsEl.innerHTML = `
      <label>丰桥顾客编码 partnerID<input type="text" id="qsf-cfg-partner" value="${esc(cfg.partnerID)}" autocomplete="off"></label>
      <label>丰桥校验码 checkWord（生产）<input type="password" id="qsf-cfg-check" value="${esc(cfg.checkWord)}" autocomplete="off"></label>
      <label>沙箱校验码 checkWordSandbox<input type="password" id="qsf-cfg-check-sbox" value="${esc(cfg.checkWordSandbox)}" autocomplete="off"></label>
      <label>手机后四位（可选，丰桥开启校验时填写）<input type="text" id="qsf-cfg-phone" value="${esc(cfg.phoneLast4)}" maxlength="4"></label>
      <label><input type="checkbox" id="qsf-cfg-sandbox" ${cfg.sandbox ? 'checked' : ''}> 使用沙箱环境</label>
      <button type="button" class="qsf-btn" data-act="save-config" style="width:100%;margin-top:4px;background:#2563eb;color:#fff;">保存配置</button>
      <div class="qsf-meta" style="margin-top:8px;">配置保存在本机 localStorage，仅用于调用顺丰丰桥 API</div>
    `;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function toggleSettings() {
    settingsEl.classList.toggle('open');
  }

  function saveSettingsFromForm() {
    const prev = loadConfig();
    const cfg = {
      ...prev,
      partnerID: (document.getElementById('qsf-cfg-partner')?.value || '').trim(),
      checkWord: (document.getElementById('qsf-cfg-check')?.value || '').trim(),
      checkWordSandbox: (document.getElementById('qsf-cfg-check-sbox')?.value || '').trim(),
      phoneLast4: (document.getElementById('qsf-cfg-phone')?.value || '').trim(),
      sandbox: Boolean(document.getElementById('qsf-cfg-sandbox')?.checked),
    };
    saveConfig(cfg);
    expressCache.clear();
    clearBuyerPanelCache();
    settingsEl.classList.remove('open');
    if (isPanelExpanded()) void refreshPanel();
  }

  async function refreshPanel(opts = {}) {
    buildPanel();
    if (!isPanelExpanded()) return;
    const force = opts.force === true;
    const preferCache = opts.preferCache === true && !force;
    const waitForData = !force && (opts.waitForData !== false || preferCache);
    const sessionId = ++refreshSession;
    const cfg = loadConfig();
    const { buyerUserId, buyerNick } = activeBuyer;

    if (!buyerUserId) {
      bodyEl.innerHTML = '<div class="qsf-empty">请在左侧点击一个买家会话</div>';
      return;
    }

    if (preferCache) {
      const cached = loadBuyerPanelCache(buyerUserId, cfg);
      if (cached) {
        if (cached.empty) {
          bodyEl.innerHTML = renderEmptySfPanel(
            cached.buyerNick || buyerNick,
            buyerUserId,
            { fromCache: true, updatedAt: cached.updatedAt, noOrder: cached.noOrder === true },
          );
          return;
        }
        if (cached.cards?.length) {
          hydrateExpressCacheFromCards(cached.cards, cfg);
          bodyEl.innerHTML = renderPanelCards(
            cached.buyerNick || buyerNick,
            buyerUserId,
            cached.cards,
            cached.updatedAt,
            { fromCache: true },
          );
          return;
        }
      }
    }

    if (refreshInFlight && !force) return;

    setRefreshLoading(true);
    refreshInFlight = true;

    try {
      if (force) syncActiveBuyerFromDom();

      if (sessionId !== refreshSession) return;
      bodyEl.innerHTML = renderLoadingPanel(
        buyerNick,
        waitForData ? '正在自动加载全部订单运单…' : '正在刷新全部顺丰运单与月结费用…',
        buyerUserId,
      );

      const rawPkgs = waitForData
        ? await waitForSfPackages(buyerUserId, sessionId)
        : await collectAllPackagesAsync(buyerUserId, sessionId);
      if (sessionId !== refreshSession) return;
      const sfPkgs = finalizePackagesForDisplay(rawPkgs || [], buyerUserId);

      if (force) {
        for (const pkg of sfPkgs || []) {
          if (isSfExpressNo(pkg.expressNo)) expressCache.delete(feeCacheKey(cfg, pkg.expressNo));
        }
      }

      if (!sfPkgs || !sfPkgs.length) {
        const snap = getOrderPanelSnapshot();
        const noOrder = snap.empty || (snap.ready && snap.cardCount === 0);
        const updatedAt = Date.now();
        saveBuyerPanelCache(buyerUserId, {
          buyerNick,
          updatedAt,
          cfgKey: panelConfigCacheKey(cfg),
          empty: true,
          noOrder,
          visibleOrderIds: getVisibleOrderPackageIds(),
          cards: [],
        });
        bodyEl.innerHTML = renderEmptySfPanel(buyerNick, buyerUserId, { noOrder, updatedAt });
        return;
      }

      bodyEl.innerHTML = renderLoadingPanel(buyerNick, '正在查询月结费用…', buyerUserId);

      const cards = await Promise.all(sfPkgs.map(async (pkg) => {
        if (sessionId !== refreshSession) return null;
        if (isSfExpressNo(pkg.expressNo)) {
          const ck = feeCacheKey(cfg, pkg.expressNo);
          if (expressCache.has(ck) && !force) {
            return { pkg, fee: sanitizeFeeForCache(expressCache.get(ck)) };
          }
        }
        const fee = isSfExpressNo(pkg.expressNo)
          ? await querySfWaybillFee(pkg.expressNo, cfg)
          : makeNonSfFeeResult(pkg.expressNo);
        return { pkg, fee: sanitizeFeeForCache(fee) };
      }));
      if (sessionId !== refreshSession) return;
      const validCards = cards.filter(Boolean);

      const updatedAt = Date.now();
      saveBuyerPanelCache(buyerUserId, {
        buyerNick,
        updatedAt,
        cfgKey: panelConfigCacheKey(cfg),
        visibleOrderIds: getVisibleOrderPackageIds(),
        cards: validCards,
      });
      bodyEl.innerHTML = renderPanelCards(buyerNick, buyerUserId, validCards, updatedAt, { fromCache: false });
    } finally {
      if (sessionId === refreshSession) {
        refreshInFlight = false;
        setRefreshLoading(false);
      }
    }
  }

  let activateTimer = null;
  let buyerRefreshTimer = null;
  let lastActivatedBuyerId = '';

  function onBuyerActivated(appCid, buyerNick) {
    const buyerUserId = uidFromAppCid(appCid);
    if (!buyerUserId) return;
    const buyerChanged = buyerUserId !== lastActivatedBuyerId;
    lastActivatedBuyerId = buyerUserId;
    orderPanelStale = buyerChanged ? true : orderPanelStale;
    activeBuyer = { buyerUserId, buyerNick: buyerNick || activeBuyer.buyerNick, appCid };
    buildPanel();
    if (!isPanelExpanded()) return;

    if (!buyerChanged && !orderPanelStale && loadBuyerPanelCache(buyerUserId, loadConfig())) {
      return;
    }

    clearTimeout(buyerRefreshTimer);
    buyerRefreshTimer = setTimeout(() => {
      void refreshPanel({ preferCache: true });
    }, buyerChanged ? 150 : 80);
  }

  function scheduleActivateChatItem(item) {
    if (!item) return;
    const appCid = getAppCidFromEl(item);
    const buyerUserId = uidFromAppCid(appCid);
    if (buyerUserId && buyerUserId === activeBuyer.buyerUserId && !orderPanelStale) return;
    clearTimeout(activateTimer);
    activateTimer = setTimeout(() => onBuyerActivated(appCid, nickFromChatItem(item)), 120);
  }

  function activateChatItem(item) {
    if (!item) return false;
    const appCid = getAppCidFromEl(item);
    if (!appCid) return false;
    scheduleActivateChatItem(item);
    return true;
  }

  function syncActiveBuyerFromDom() {
    const active = document.querySelector('.chat-item.active');
    if (!active) return;
    const appCid = getAppCidFromEl(active);
    const buyerUserId = uidFromAppCid(appCid);
    if (!buyerUserId) return;
    activeBuyer = { buyerUserId, buyerNick: nickFromChatItem(active), appCid };
  }

  function syncActiveChatItem() {
    const active = document.querySelector('.chat-item.active');
    if (active) scheduleActivateChatItem(active);
  }

  function bindClickListener() {
    if (window.__qfSfChatClickHandler) return;
    window.__qfSfChatClickHandler = (ev) => {
      const item = findChatItem(ev.target);
      if (!item) return;
      scheduleActivateChatItem(item);
    };
    document.addEventListener('click', window.__qfSfChatClickHandler, true);
  }

  function bindActiveChatObserver() {
    if (window.__qfSfFeeChatObs) return;
    let traceTimer = null;
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
        const el = m.target;
        if (!el?.classList?.contains('chat-item')) continue;
        if (el.classList.contains('active')) {
          scheduleActivateChatItem(el);
        }
      }
      if (!panelEl?.classList.contains('qsf-expanded')) return;
      clearTimeout(traceTimer);
      traceTimer = setTimeout(() => {
        if (activeBuyer.buyerUserId) patchTraceDisplay();
      }, 1000);
    });
    obs.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    window.__qfSfFeeChatObs = obs;
  }

  // ─── 启动（等待 body 就绪，避免刷新后注入失败）────────────────────
  function startPanel() {
    if (!document.body) return;
    if (window.__qfSfFeePanel?.version === VERSION && document.getElementById(PANEL_ID)) {
      buildPanel();
      ensureIconInViewport();
      return;
    }
    try {
      if (sessionStorage.getItem('qsf_fee_cache_ver') !== VERSION) {
        expressCache.clear();
        sessionStorage.setItem('qsf_fee_cache_ver', VERSION);
      }
    } catch {
      expressCache.clear();
    }
    ensureBuyerCacheVersion();
    hookFetch();
    hookXhr();
    buildPanel();
    bindClickListener();
    bindActiveChatObserver();
    ensureIconInViewport();
    window.addEventListener('resize', ensureIconInViewport);
    setTimeout(syncActiveChatItem, 600);

    try {
      const uiVer = sessionStorage.getItem('qsf_fee_ui_ver');
      sessionStorage.setItem('qsf_fee_ui_ver', VERSION);
      if (uiVer && uiVer !== VERSION && panelEl?.classList.contains('qsf-expanded')) {
        setTimeout(() => void refreshPanel({ preferCache: true }), 300);
      }
    } catch {
      /* ignore */
    }

    window.__qfSfFeePanel = {
      version: VERSION,
      refresh: refreshPanel,
      setBuyer: onBuyerActivated,
      teardown: teardownPanel,
      clearCache: () => {
        expressCache.clear();
        sfFeeInflight.clear();
        buyerPackages.clear();
        buyerPackageById.clear();
        clearBuyerPanelCache();
      },
    };

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
