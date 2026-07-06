/**
 * 千帆客服台 · 顺丰月结运费侧栏（页面注入脚本）
 * 由 src/auto-inject.js 通过 CDP 自动注入，无需手动粘贴。
 * 丰桥凭证：config.json → sf.partnerID / sf.checkWord（或侧栏 ⚙ 一次）
 */
(function qfSfFeePanelBootstrap() {
  const VERSION = '1.0.9';
  const STORAGE_KEY = 'qf_sf_fee_config_v1';
  const SF_PROD = 'https://sfapi.sf-express.com/std/service';
  const SF_SBOX = 'https://sfapi-sbox.sf-express.com/std/service';
  const PANEL_ID = 'qf-sf-fee-panel-root';

  if (window.__qfSfFeePanel?.version === VERSION) {
    console.log('[顺丰运费] 已加载，版本', window.__qfSfFeePanel.version);
    return;
  }
  if (window.__qfSfFeePanel) {
    try {
      document.getElementById(PANEL_ID)?.remove();
      document.getElementById('qf-sf-fee-panel-style')?.remove();
    } catch {
      /* ignore */
    }
    delete window.__qfSfFeePanel;
    delete window.__qfSfFeeFetchHooked;
    delete window.__qfSfFeeXhrHooked;
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
    ].find((v) => typeof v === 'string' && v.trim());
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

  function findChatItem(el) {
    let node = el;
    while (node && node !== document.body) {
      if (node.classList && [...node.classList].some((c) => c.includes('chat-item'))) return node;
      node = node.parentElement;
    }
    return null;
  }

  function isSfExpressNo(no, company) {
    const n = String(no || '').trim().toUpperCase();
    const c = String(company || '');
    if (!n) return false;
    if (/^SF\d{10,}$/.test(n)) return true;
    if (/顺丰|SF/i.test(c) && n.length >= 10) return true;
    return false;
  }

  function money(n) {
    const v = Number(n);
    return Number.isFinite(v) ? `¥${v.toFixed(2)}` : '-';
  }

  function uuid() {
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ─── 运单缓存（网络 hook 写入） ─────────────────────────────────────
  const buyerPackages = new Map(); // buyerUserId -> Map(expressNo -> pkg)
  const expressCache = new Map(); // expressNo -> sf fee result
  let activeBuyer = { buyerUserId: '', buyerNick: '', appCid: '' };

  function indexPackage(buyerUserId, pkg) {
    const uid = String(buyerUserId || '').trim();
    const no = String(pkg.expressNo || '').trim();
    if (!uid || !no) return;
    if (!buyerPackages.has(uid)) buyerPackages.set(uid, new Map());
    const prev = buyerPackages.get(uid).get(no) || {};
    buyerPackages.get(uid).set(no, {
      ...prev,
      ...pkg,
      expressNo: no,
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

  let ingestRefreshTimer = null;

  function scheduleIngestRefresh() {
    if (!activeBuyer.buyerUserId || refreshInFlight) return;
    clearTimeout(ingestRefreshTimer);
    ingestRefreshTimer = setTimeout(() => {
      if (!refreshInFlight && activeBuyer.buyerUserId) {
        void refreshPanel({ waitForData: false });
      }
    }, 800);
  }

  function ingestJsonBody(json) {
    if (!json || typeof json !== 'object') return;
    let touched = false;
    walkJson(json, (node) => {
      const buyerUserId = String(node.buyer_user_id || node.buyerUserId || '').trim();
      const expressNo = String(
        node.express_no || node.express_number || node.expressNo || node.ship_express_no || node.tracking_no || '',
      ).trim();
      const expressCompany = String(node.express_company || node.expressCompanyName || node.express_company_name || '').trim();
      const orderId = String(node.order_id || node.orderId || '').trim();
      const packageId = String(node.package_id || node.packageId || '').trim();
      const lastTrace = pickTraceText(node);
      const pkgBase = { expressCompany, orderId, packageId, ...(lastTrace ? { lastTrace } : {}) };
      if (buyerUserId && expressNo) {
        indexPackage(buyerUserId, { ...pkgBase, expressNo });
        if (buyerUserId === activeBuyer.buyerUserId) touched = true;
      } else if (expressNo && isSfExpressNo(expressNo, expressCompany)) {
        if (activeBuyer.buyerUserId) {
          indexPackage(activeBuyer.buyerUserId, { ...pkgBase, expressNo });
          touched = true;
        }
      } else if (lastTrace && buyerUserId) {
        const pkgs = buyerPackages.get(buyerUserId);
        if (pkgs && pkgs.size === 1) {
          const only = [...pkgs.values()][0];
          if (only) {
            indexPackage(buyerUserId, { ...only, lastTrace });
            if (buyerUserId === activeBuyer.buyerUserId) touched = true;
          }
        }
      }
    });
    if (touched) scheduleIngestRefresh();
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
        const clone = res.clone();
        const ct = clone.headers.get('content-type') || '';
        if ((ct.includes('json') || /xiaohongshu/i.test(reqUrl)) && !/sf-express\.com/i.test(reqUrl)) {
          clone.json().then(ingestJsonBody).catch(() => {});
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
          if (String(this.responseType) === 'json' && this.response) ingestJsonBody(this.response);
          else if (typeof this.responseText === 'string' && this.responseText.startsWith('{')) {
            ingestJsonBody(JSON.parse(this.responseText));
          }
        } catch {
          /* ignore */
        }
      });
      return origSend.apply(this, arguments);
    };
  }

  function orderPanelRoot() {
    const selectors = [
      '[class*="order-detail"]', '[class*="orderDetail"]', '[class*="OrderDetail"]',
      '[class*="package-list"]', '[class*="packageList"]', '[class*="PackageList"]',
      '[class*="right-content"]', '[class*="rightContent"]', '[class*="RightContent"]',
      '[class*="order-panel"]', '[class*="OrderPanel"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function scrapeDomTrace(root) {
    if (!root) return '';
    const selectors = [
      '[class*="logistics"]', '[class*="trace"]', '[class*="express-track"]',
      '[class*="Logistics"]', '[class*="Trace"]',
    ];
    for (const sel of selectors) {
      const nodes = root.querySelectorAll(sel);
      for (const node of nodes) {
        const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length >= 4 && t.length <= 120 && !isInternalId(t)) return t;
      }
    }
    return '';
  }

  function scrapeDomExpress() {
    const root = orderPanelRoot();
    const found = new Map();
    const domTrace = scrapeDomTrace(root);
    const text = root ? root.innerText || '' : '';
    const re = /\b(SF\d{10,15})\b/gi;
    let m;
    while ((m = re.exec(text))) {
      const no = m[1].toUpperCase();
      found.set(no, {
        expressNo: no,
        expressCompany: '顺丰',
        orderId: '',
        packageId: '',
        ...(domTrace ? { lastTrace: domTrace } : {}),
      });
    }
    if (activeBuyer.buyerUserId) {
      for (const pkg of found.values()) indexPackage(activeBuyer.buyerUserId, pkg);
    }
    return [...found.values()];
  }

  function packagesForBuyer(buyerUserId) {
    const uid = String(buyerUserId || '').trim();
    const fromCache = uid && buyerPackages.has(uid) ? [...buyerPackages.get(uid).values()] : [];
    const sfOnly = fromCache.filter((p) => isSfExpressNo(p.expressNo, p.expressCompany));
    if (sfOnly.length) return sfOnly;
    if (!orderPanelRoot()) return [];
    return scrapeDomExpress();
  }

  // ─── 顺丰清单运费 ───────────────────────────────────────────────────
  async function querySfWaybillFee(expressNo, cfg) {
    const no = String(expressNo || '').trim();
    if (!no) return { ok: false, error: '缺少运单号' };
    const ck = feeCacheKey(cfg, no);
    if (expressCache.has(ck)) {
      const cached = expressCache.get(ck);
      if (cached.ok || cached.apiCode === 'A1004' || cached.apiCode === '8152') return cached;
      expressCache.delete(ck);
    }

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
        }
        const result = { ok: false, error: errMsg, raw: inner, apiCode };
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
  }

  // ─── UI ─────────────────────────────────────────────────────────────
  let panelEl;
  let bodyEl;
  let settingsEl;
  let refreshInFlight = false;
  let refreshSession = 0;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function renderBuyerHeader(buyerNick, buyerUserId) {
    const nick = String(buyerNick || '').trim();
    const trace = latestTraceForBuyer(buyerUserId);
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

  function sfPackagesForBuyer(buyerUserId) {
    return packagesForBuyer(buyerUserId).filter((p) => isSfExpressNo(p.expressNo, p.expressCompany));
  }

  async function waitForSfPackages(buyerUserId, sessionId, maxMs = 5000, intervalMs = 400) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if (sessionId !== refreshSession) return null;
      scrapeDomExpress();
      const sfPkgs = sfPackagesForBuyer(buyerUserId);
      if (sfPkgs.length) return sfPkgs;
      await sleep(intervalMs);
    }
    if (sessionId !== refreshSession) return null;
    scrapeDomExpress();
    return sfPackagesForBuyer(buyerUserId);
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

  function expandPanel() {
    if (!panelEl) return;
    panelEl.classList.remove('qsf-icon-only');
    panelEl.classList.add('qsf-expanded');
  }

  function collapseToIcon() {
    if (!panelEl) return;
    panelEl.classList.add('qsf-icon-only');
    panelEl.classList.remove('qsf-expanded');
    if (settingsEl) settingsEl.classList.remove('open');
  }

  function injectStyles() {
    if (document.getElementById('qf-sf-fee-panel-style')) return;
    const style = document.createElement('style');
    style.id = 'qf-sf-fee-panel-style';
    style.textContent = `
      #${PANEL_ID} {
        position: fixed; z-index: 2147483000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px; color: #1f2937;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .qsf-launcher {
        width: 30px; height: 30px; padding: 0; margin: 0; border: none; border-radius: 6px;
        background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.18); cursor: pointer;
        display: flex; align-items: center; justify-content: center; overflow: hidden;
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
        top: 48px; right: 8px; width: 30px; height: 30px; bottom: auto;
      }
      #${PANEL_ID}.qsf-icon-only .qsf-launcher { display: flex; }
      #${PANEL_ID}.qsf-icon-only .qsf-shell { display: none; }
      #${PANEL_ID}.qsf-expanded {
        top: 48px; right: 0; bottom: 0; width: 300px;
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
      #${PANEL_ID} .qsf-meta { color: #6b7280; font-size: 11px; margin-top: 4px; }
      #${PANEL_ID} .qsf-total { font-size: 18px; font-weight: 700; color: #dc2626; margin: 6px 0; }
      #${PANEL_ID} .qsf-fee-line { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
      #${PANEL_ID} .qsf-err { color: #dc2626; font-size: 12px; }
      #${PANEL_ID} .qsf-empty { color: #9ca3af; text-align: center; padding: 24px 8px; line-height: 1.6; }
      #${PANEL_ID} .qsf-settings {
        display: none; padding: 10px 12px; border-top: 1px solid #e5e7eb; background: #fafafa; flex-shrink: 0;
      }
      #${PANEL_ID} .qsf-settings.open { display: block; }
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
    document.head.appendChild(style);
  }

  function launcherMarkup() {
    const icon = launcherIconUrl();
    if (icon) {
      return `<button type="button" class="qsf-launcher" data-act="expand" title="顺丰月结运费"><img src="${icon}" alt="顺丰运费" width="30" height="30"></button>`;
    }
    return `<button type="button" class="qsf-launcher" data-act="expand" title="顺丰月结运费"><span class="qsf-launcher-fallback">SF</span></button>`;
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) {
      panelEl = document.getElementById(PANEL_ID);
      bodyEl = panelEl.querySelector('.qsf-body');
      settingsEl = panelEl.querySelector('.qsf-settings');
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
      </div>
    `;
    document.body.appendChild(panelEl);
    bodyEl = panelEl.querySelector('.qsf-body');
    settingsEl = panelEl.querySelector('.qsf-settings');

    panelEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'expand') expandPanel();
      if (act === 'refresh') void refreshPanel({ force: true, waitForData: false });
      if (act === 'settings') toggleSettings();
      if (act === 'collapse') collapseToIcon();
      if (act === 'save-config') saveSettingsFromForm();
    });

    renderSettingsForm();
    bodyEl.innerHTML = '<div class="qsf-empty">点击左侧买家会话，将自动查询顺丰运单月结扣费</div>';
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
    settingsEl.classList.remove('open');
    void refreshPanel();
  }

  async function refreshPanel(opts = {}) {
    const force = opts.force === true;
    const waitForData = opts.waitForData !== false && !force;
    const sessionId = ++refreshSession;
    buildPanel();
    setRefreshLoading(true);
    refreshInFlight = true;

    try {
      const cfg = loadConfig();
      const { buyerUserId, buyerNick } = activeBuyer;

      if (!buyerUserId) {
        if (sessionId !== refreshSession) return;
        bodyEl.innerHTML = '<div class="qsf-empty">请在左侧点击一个买家会话</div>';
        return;
      }

      if (force) {
        syncActiveBuyerFromDom();
        scrapeDomExpress();
      }

      if (sessionId !== refreshSession) return;
      bodyEl.innerHTML = renderLoadingPanel(
        buyerNick,
        waitForData ? '正在同步该买家运单…' : '正在刷新顺丰运单与月结费用…',
        buyerUserId,
      );

      let sfPkgs;
      if (waitForData) {
        sfPkgs = await waitForSfPackages(buyerUserId, sessionId);
      } else {
        scrapeDomExpress();
        sfPkgs = sfPackagesForBuyer(buyerUserId);
      }
      if (sessionId !== refreshSession) return;

      if (force) {
        for (const pkg of sfPkgs || []) expressCache.delete(feeCacheKey(cfg, pkg.expressNo));
      }

      if (!sfPkgs || !sfPkgs.length) {
        bodyEl.innerHTML = `
          ${renderBuyerHeader(buyerNick, buyerUserId)}
          <div class="qsf-empty">未找到顺丰运单号<br><br>请确认该买家已发货，并在千帆右侧订单区加载完成后再点 ↻ 刷新<br><small>侧栏会从页面网络响应和 DOM 中自动抓取 express_no</small></div>
        `;
        return;
      }

      bodyEl.innerHTML = renderLoadingPanel(buyerNick, '正在查询月结费用…', buyerUserId);

      const cards = [];
      for (const pkg of sfPkgs) {
        if (sessionId !== refreshSession) return;
        const fee = await querySfWaybillFee(pkg.expressNo, cfg);
        cards.push({ pkg, fee });
      }
      if (sessionId !== refreshSession) return;

      let html = renderBuyerHeader(buyerNick, buyerUserId);
      for (const { pkg, fee } of cards) {
        html += `<div class="qsf-card">`;
        html += `<div class="qsf-no">${esc(pkg.expressNo)}</div>`;
        if (pkg.lastTrace) html += `<div class="qsf-meta qsf-trace">${esc(pkg.lastTrace)}</div>`;
        else if (pkg.orderId && !isInternalId(pkg.orderId)) html += `<div class="qsf-meta">订单 ${esc(pkg.orderId)}</div>`;
        if (!fee.ok) {
          html += `<div class="qsf-err">${esc(fee.error)}</div>`;
        } else {
          html += `<div class="qsf-total">${money(fee.totalFee)}</div>`;
          if (fee.customerAcctCode) html += `<div class="qsf-meta">月结账号 ${esc(fee.customerAcctCode)} · 计费重 ${fee.meterageWeightQty ?? '-'} kg</div>`;
          for (const line of fee.fees) {
            html += `<div class="qsf-fee-line"><span>${esc(line.name)}${line.settlement ? ` (${line.settlement})` : ''}</span><span>${money(line.amount)}</span></div>`;
          }
        }
        html += `</div>`;
      }
      html += `<div class="qsf-meta" style="text-align:center;margin-top:8px;">已更新 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>`;
      bodyEl.innerHTML = html;
    } finally {
      if (sessionId === refreshSession) {
        refreshInFlight = false;
        setRefreshLoading(false);
      }
    }
  }

  let activateTimer = null;

  function onBuyerActivated(appCid, buyerNick) {
    const buyerUserId = uidFromAppCid(appCid);
    if (!buyerUserId) return;
    activeBuyer = { buyerUserId, buyerNick: buyerNick || activeBuyer.buyerNick, appCid };
    buildPanel();
    void refreshPanel({ waitForData: true });
  }

  function scheduleActivateChatItem(item) {
    if (!item) return;
    clearTimeout(activateTimer);
    activateTimer = setTimeout(() => onBuyerActivated(getAppCidFromEl(item), nickFromChatItem(item)), 380);
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
    document.addEventListener(
      'click',
      (ev) => {
        const item = findChatItem(ev.target);
        if (!item) return;
        setTimeout(() => scheduleActivateChatItem(item), 300);
      },
      true,
    );
  }

  function bindActiveChatObserver() {
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
        const el = m.target;
        if (!el?.classList?.contains('chat-item')) continue;
        if (el.classList.contains('active')) {
          setTimeout(() => scheduleActivateChatItem(el), 200);
        }
      }
      if (activeBuyer.buyerUserId) scrapeDomExpress();
    });
    obs.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  // ─── 启动 ───────────────────────────────────────────────────────────
  try {
    if (sessionStorage.getItem('qsf_fee_cache_ver') !== VERSION) {
      expressCache.clear();
      sessionStorage.setItem('qsf_fee_cache_ver', VERSION);
    }
  } catch {
    expressCache.clear();
  }
  hookFetch();
  hookXhr();
  buildPanel();
  bindClickListener();
  bindActiveChatObserver();
  setTimeout(syncActiveChatItem, 600);

  window.__qfSfFeePanel = {
    version: VERSION,
    refresh: refreshPanel,
    setBuyer: onBuyerActivated,
    clearCache: () => {
      expressCache.clear();
      buyerPackages.clear();
    },
  };

  console.log(`[顺丰运费] 侧栏 v${VERSION} 已注入。配置：侧栏 ⚙ → 填入丰桥 partnerID / checkWord`);
})();
