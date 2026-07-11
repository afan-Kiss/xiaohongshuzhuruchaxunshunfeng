/**
 * 千帆客服台 · 顺丰月结扣费内嵌（订单卡片内显示，无侧栏窗口）
 * 由 src/auto-inject.js 通过 CDP 自动注入。
 */
(function qfSfFeeInlineBootstrap() {
  const VERSION = '2.3.2';
  const STORAGE_KEY = 'qf_sf_fee_config_v1';
  const STYLE_ID = 'qf-sf-fee-inline-style';
  const SF_PROD = 'https://sfapi.sf-express.com/std/service';
  const SF_SBOX = 'https://sfapi-sbox.sf-express.com/std/service';
  const SF_ERR_CACHE_TTL_MS = 30 * 60 * 1000;
  const PKG_DETAIL_COOLDOWN_MS = 8000;
  const PKG_DETAIL_HOOK_WAIT_MS = 100;
  const SCAN_DEBOUNCE_MS = 80;
  const CARD_RENDER_STALE_MS = 45 * 1000;
  const MAX_CARD_RETRY = 2;
  const MONEY_EPS = 0.005;

  const EXPRESS_CACHE_MAX = 400;

  function trimExpressCache() {
    if (expressCache.size <= EXPRESS_CACHE_MAX) return;
    const drop = expressCache.size - EXPRESS_CACHE_MAX;
    const keys = expressCache.keys();
    for (let i = 0; i < drop; i++) {
      const k = keys.next().value;
      if (k == null) break;
      expressCache.delete(k);
    }
  }

  const expressCache = new Map();
  const sfFeeInflight = new Map();
  const packageDetailFetchedAt = new Map();
  const packageDetailInflight = new Map();
  const packageDetailCache = new Map();
  const afterSaleApiCache = new Map();
  const afterSaleFetchedAt = new Map();
  const afterSaleInflight = new Map();
  const cardJobs = new Map();
  const cardRenderCache = new Map();
  const cardRetryCount = new Map();
  const cardRetryTimers = new Map();
  const cardStableKeys = new Set();

  let scanTimer = null;
  let orderObs = null;
  let sessionObs = null;
  let sessionPollTimer = null;
  let activeSessionKey = '';
  let sessionGeneration = 0;

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
    if (nick) return `nick:${nick}`;
    return '';
  }

  function isSessionStale(gen) {
    return gen !== sessionGeneration;
  }

  function clearCardRetryTimers() {
    for (const timer of cardRetryTimers.values()) clearTimeout(timer);
    cardRetryTimers.clear();
  }

  function cancelSessionWork() {
    sessionGeneration += 1;
    clearTimeout(scanTimer);
    scanTimer = null;
    clearCardRetryTimers();
    cardJobs.clear();
    packageDetailInflight.clear();
    afterSaleInflight.clear();
    cardRetryCount.clear();
    cardStableKeys.clear();
    document.querySelectorAll('.qsf-inline-fee-wrap').forEach((el) => el.remove());
  }

  function onSessionChanged(nextKey) {
    const key = String(nextKey || '').trim();
    if (!key || key === activeSessionKey) return;
    activeSessionKey = key;
    cancelSessionWork();
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
    sessionPollTimer = setInterval(syncSession, 200);
    if (sessionObs) sessionObs.disconnect();
    const chatRoot = document.querySelector(
      '.chat-list, .farmer-chat__left, [class*="session-list"], [class*="chat-list"]',
    ) || document.body;
    sessionObs = new MutationObserver(() => syncSession());
    sessionObs.observe(chatRoot, {
      attributes: true,
      attributeFilter: ['class', 'data-key', 'aria-selected'],
      subtree: true,
      childList: true,
    });
  }

  function unwatchSession() {
    if (sessionObs) {
      sessionObs.disconnect();
      sessionObs = null;
    }
    if (sessionPollTimer) {
      clearInterval(sessionPollTimer);
      sessionPollTimer = null;
    }
    activeSessionKey = '';
  }

  function unhookFetch() {
    if (window.__qsfInlineNativeFetch) {
      window.fetch = window.__qsfInlineNativeFetch;
    }
    delete window.__qsfInlineFetchHooked;
    delete window.__qsfInlineNativeFetch;
  }

  function isAfterSaleApiUrl(url) {
    return /after-sales\/returns_v3\//i.test(String(url || ''));
  }

  function isPackageDetailUrl(url) {
    const u = String(url || '');
    return /\/package\/[^/?#]+\/detail/i.test(u)
      || /package-detail|package_detail/i.test(u);
  }

  async function waitForPackageCache(packageId, ms = PKG_DETAIL_HOOK_WAIT_MS) {
    const ck = detailCacheKey(packageId);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const cached = packageDetailCache.get(ck);
      if (cached) return cached;
      await sleep(60);
    }
    return packageDetailCache.get(ck) || null;
  }

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function normText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function md5Bytes(str) {
    function cmn(q, a, b, x, s, t) {
      a = (a + q + x + t) | 0;
      return (((a << s) | (a >>> (32 - s))) + b) | 0;
    }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
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
      let a = state[0]; let b = state[1]; let c = state[2]; let d = state[3];
      a = ff(a, b, c, d, rest[0], 7, -680876936); d = ff(d, a, b, c, rest[1], 12, -389564586);
      c = ff(c, d, a, b, rest[2], 17, 606105819); b = ff(b, c, d, a, rest[3], 22, -1044525330);
      a = ff(a, b, c, d, rest[4], 7, -176418897); d = ff(d, a, b, c, rest[5], 12, 1200080426);
      c = ff(c, d, a, b, rest[6], 17, -1473231341); b = ff(b, c, d, a, rest[7], 22, -45705983);
      a = ff(a, b, c, d, rest[8], 7, 1770035416); d = ff(d, a, b, c, rest[9], 12, -1958414417);
      c = ff(c, d, a, b, rest[10], 17, -42063); b = ff(b, c, d, a, rest[11], 22, -1990404162);
      a = ff(a, b, c, d, rest[12], 7, 1804603682); d = ff(d, a, b, c, rest[13], 12, -40341101);
      c = ff(c, d, a, b, rest[14], 17, -1502002290); b = ff(b, c, d, a, rest[15], 22, 1236535329);
      a = gg(a, b, c, d, rest[1], 5, -165796510); d = gg(d, a, b, c, rest[6], 9, -1069501632);
      c = gg(c, d, a, b, rest[11], 14, 643717713); b = gg(b, c, d, a, rest[0], 20, -373897302);
      a = gg(a, b, c, d, rest[5], 5, -701558691); d = gg(d, a, b, c, rest[10], 9, 38016083);
      c = gg(c, d, a, b, rest[15], 14, -660478335); b = gg(b, c, d, a, rest[4], 20, -405537848);
      a = gg(a, b, c, d, rest[9], 5, 568446438); d = gg(d, a, b, c, rest[14], 9, -1019803690);
      c = gg(c, d, a, b, rest[3], 14, -187363961); b = gg(b, c, d, a, rest[8], 20, 1163531501);
      a = gg(a, b, c, d, rest[13], 5, -1444681467); d = gg(d, a, b, c, rest[2], 9, -51403784);
      c = gg(c, d, a, b, rest[7], 14, 1735328473); b = gg(b, c, d, a, rest[12], 20, -1926607734);
      a = hh(a, b, c, d, rest[5], 4, -378558); d = hh(d, a, b, c, rest[8], 11, -2022574463);
      c = hh(c, d, a, b, rest[11], 16, 1839030562); b = hh(b, c, d, a, rest[14], 23, -35309556);
      a = hh(a, b, c, d, rest[1], 4, -1530992060); d = hh(d, a, b, c, rest[4], 11, 1272893353);
      c = hh(c, d, a, b, rest[7], 16, -155497632); b = hh(b, c, d, a, rest[10], 23, -1094730640);
      a = hh(a, b, c, d, rest[13], 4, 681279174); d = hh(d, a, b, c, rest[0], 11, -358537222);
      c = hh(c, d, a, b, rest[3], 16, -722521979); b = hh(b, c, d, a, rest[6], 23, 76029189);
      a = hh(a, b, c, d, rest[9], 4, -640364487); d = hh(d, a, b, c, rest[12], 11, -421815835);
      c = hh(c, d, a, b, rest[15], 16, 530742520); b = hh(b, c, d, a, rest[2], 23, -995338651);
      a = ii(a, b, c, d, rest[0], 6, -198630844); d = ii(d, a, b, c, rest[7], 10, 1126891415);
      c = ii(c, d, a, b, rest[14], 15, -1416354905); b = ii(b, c, d, a, rest[5], 21, -57434055);
      a = ii(a, b, c, d, rest[12], 6, 1700485571); d = ii(d, a, b, c, rest[3], 10, -1894986606);
      c = ii(c, d, a, b, rest[10], 15, -1051523); b = ii(b, c, d, a, rest[1], 21, -2054922799);
      a = ii(a, b, c, d, rest[8], 6, 1873313359); d = ii(d, a, b, c, rest[15], 10, -30611744);
      c = ii(c, d, a, b, rest[6], 15, -1560198380); b = ii(b, c, d, a, rest[13], 21, 1309151649);
      a = ii(a, b, c, d, rest[4], 6, -145523070); d = ii(d, a, b, c, rest[11], 10, -1120210379);
      c = ii(c, d, a, b, rest[2], 15, 718787259); b = ii(b, c, d, a, rest[9], 21, -343485551);
      state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
      state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
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
    const bytes = md5Bytes(String(msgData) + String(timestamp) + String(checkWord));
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function applyPresetConfig() {
    const preset = window.__qfSfFeePreset;
    if (!preset || typeof preset !== 'object') return;
    let prev = {};
    try { prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { /* ignore */ }
    const merged = { ...prev, ...preset };
    Object.keys(preset).forEach((k) => { merged[k] = preset[k]; });
    merged.sandbox = Boolean(preset.sandbox);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  }

  function loadConfig() {
    applyPresetConfig();
    try {
      return {
        partnerID: '',
        checkWord: '',
        checkWordSandbox: '',
        sandbox: false,
        phoneLast4: '',
        monthlyCard: '',
        ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'),
      };
    } catch {
      return {
        partnerID: '', checkWord: '', checkWordSandbox: '', sandbox: false, phoneLast4: '', monthlyCard: '',
      };
    }
  }

  function resolveCheckWord(cfg) {
    if (cfg.sandbox) return String(cfg.checkWordSandbox || '').trim();
    return String(cfg.checkWord || '').trim();
  }

  function feeCacheKey(cfg, expressNo) {
    const mode = cfg.sandbox ? 'sbox' : 'prod';
    const partner = String(cfg.partnerID || '').trim();
    const card = String(cfg.monthlyCard || '').trim();
    return `${mode}:${partner}:${card}:${String(expressNo || '').trim().toUpperCase()}`;
  }

  function buildSfWaybillMsgData(cfg, expressNo) {
    const payload = { trackingType: '2', trackingNum: String(expressNo || '').trim() };
    const phone = String(cfg.phoneLast4 || '').trim();
    if (phone) payload.phone = phone;
    const card = String(cfg.monthlyCard || '').trim();
    if (card) payload.monthlyCard = card;
    return JSON.stringify(payload);
  }

  function detailCacheKey(packageId) {
    return String(packageId || '').trim();
  }

  function stableKey(packageId) {
    return String(packageId || '').trim();
  }

  function renderCacheKey(packageId) {
    return stableKey(packageId);
  }

  function isLikelyPackageId(no) {
    return /^P\d{10,}$/i.test(normalizeExpressNo(no));
  }

  function isLikelyExpressNo(no) {
    const n = normalizeExpressNo(no);
    if (!n || n.length < 8 || isLikelyPackageId(n)) return false;
    return isSfExpressNo(n) || /^[A-Z]{2,4}\d{8,}$/.test(n) || /^\d{12,15}$/.test(n);
  }

  function isSfExpressNo(no) {
    return /^SF\d{10,}$/i.test(String(no || '').trim());
  }

  function normalizeExpressNo(no) {
    return String(no || '').trim().toUpperCase();
  }

  function pickRawExpressNo(...values) {
    for (const value of values) {
      const n = normalizeExpressNo(value);
      if (n.length >= 8 && isLikelyExpressNo(n)) return n;
    }
    return '';
  }

  function extractRawExpressFromCard(card) {
    if (!card) return '';
    const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    const logistics = card.querySelector('.delivery-row-logistics, .logistics-box');
    const logisticsText = (logistics?.innerText || '').replace(/\s+/g, ' ');
    if (logisticsText) {
      const m = logisticsText.match(/\b(SF\d{10,}|[A-Z]{2,4}\d{8,}|\d{12,15})\b/i);
      if (m && isLikelyExpressNo(m[1])) return normalizeExpressNo(m[1]);
    }
    const cardText = (card.innerText || '').replace(/\s+/g, ' ');
    const matches = cardText.match(/\b(SF\d{10,}|[A-Z]{2,4}\d{8,})\b/gi) || [];
    for (const candidate of matches) {
      const n = normalizeExpressNo(candidate);
      if (n && n !== normalizeExpressNo(packageId) && isLikelyExpressNo(n)) return n;
    }
    return '';
  }

  function pickRawExpressFromPackageDetail(data) {
    if (!data || typeof data !== 'object') return '';
    let raw = pickRawExpressNo(
      data.express_number, data.express_no, data.expressNo, data.ship_express_no,
    );
    if (raw) return raw;
    if (Array.isArray(data.delivery_packages)) {
      for (const dp of data.delivery_packages) {
        if (!dp) continue;
        raw = pickRawExpressNo(dp.express_no, dp.express_number, dp.expressNo);
        if (raw) return raw;
      }
    }
    return '';
  }

  function isNonSfExpress(rawExpress) {
    const no = normalizeExpressNo(rawExpress);
    return Boolean(no) && !isSfExpressNo(no);
  }

  function parseMoneyYuan(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const s = String(value).replace(/[,，]/g, '').trim();
    const m = s.match(/(\d+(?:\.\d{1,2})?)/);
    return m ? Number(m[1]) : null;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeAfterSale(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const refundApplyAmount = parseMoneyYuan(
      raw.refundApplyAmount ?? raw.apply_amount ?? raw.applyAmount
      ?? raw.returns_apply_amount ?? raw.refund_apply_amount ?? raw.request_amount,
    );
    const refundActualAmount = parseMoneyYuan(
      raw.refundActualAmount ?? raw.refund_amount ?? raw.refundAmount
      ?? raw.actual_refund_amount ?? raw.refunded_amount ?? raw.return_amount,
    );
    const status = String(raw.status || raw.status_name || raw.returns_status || '').trim();
    const type = String(raw.type || raw.returns_type || raw.return_type || '').trim();
    if (!status && !type && refundApplyAmount == null && refundActualAmount == null) return null;
    const paidAmount = parseMoneyYuan(raw.paidAmount ?? raw.customer_pay_amount ?? raw.customerPayAmount);
    return { type, status, refundApplyAmount, refundActualAmount, paidAmount };
  }

  function pickAfterSaleFromData(data) {
    if (!data || typeof data !== 'object') return null;

    if (Array.isArray(data.return_info)) {
      for (const item of data.return_info) {
        if (!item || typeof item !== 'object') continue;
        const normalized = normalizeAfterSale({
          type: item.type || item.return_type || item.returns_type,
          status: item.status_str || item.status || item.status_name,
          apply_amount: item.apply_amount ?? item.applyAmount ?? item.returns_apply_amount
            ?? item.refund_apply_amount ?? item.request_amount,
          refund_amount: item.return_amt ?? item.refund_amount ?? item.refundAmount
            ?? item.actual_refund_amount ?? item.refunded_amount,
        });
        if (normalized?.refundApplyAmount != null || normalized?.refundActualAmount != null) {
          normalized.fromReturnInfo = true;
          return normalized;
        }
      }
    }

    const lists = [
      data.returnInfo, data.returns_info, data.refund_info, data.after_sale_info,
      data.returns_list, data.return_list, data.after_sale_list, data.refund_list,
    ];
    for (const list of lists) {
      const arr = Array.isArray(list) ? list : (list && typeof list === 'object' ? [list] : []);
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const normalized = normalizeAfterSale({
          type: item.returns_type || item.return_type || item.type || item.after_sale_type,
          status: item.status_name || item.status || item.returns_status || item.after_sale_status,
          apply_amount: item.apply_amount ?? item.applyAmount ?? item.returns_apply_amount
            ?? item.refund_apply_amount ?? item.request_amount ?? item.refund_apply_price,
          refund_amount: item.refund_amount ?? item.refundAmount ?? item.actual_refund_amount
            ?? item.refunded_amount ?? item.return_amount ?? item.refund_price ?? item.return_amt,
        });
        if (normalized?.refundApplyAmount != null || normalized?.refundActualAmount != null) return normalized;
        if (normalized) return normalized;
      }
    }
    return normalizeAfterSale({
      type: data.returns_type || data.return_type || data.after_sale_type,
      status: data.after_sale_status || data.csstatus || data.erp_status_str,
      apply_amount: data.apply_amount ?? data.returns_apply_amount ?? data.refund_apply_amount,
      refund_amount: data.refund_amount ?? data.actual_refund_amount ?? data.refunded_amount,
    });
  }

  function pickAfterSaleFromPackageDetail(data) {
    return pickAfterSaleFromData(data);
  }

  function pickRefundApplyFromReturnsV3(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const applied = parseMoneyYuan(raw.applied_amount ?? raw.appliedAmount);
    if (applied != null && applied > 0) return applied;
    const expected = parseMoneyYuan(raw.expected_refund_amount ?? raw.expectedRefundAmount);
    if (expected != null && expected > 0) return expected;
    const skuSum = parseMoneyYuan(raw.applied_skus_amount_sum ?? raw.appliedSkusAmountSum);
    const shipFee = parseMoneyYuan(raw.applied_ship_fee_amount ?? raw.appliedShipFeeAmount);
    if (skuSum != null || shipFee != null) {
      const total = (skuSum ?? 0) + (shipFee ?? 0);
      if (total > 0) return total;
    }
    const expectOnly = parseMoneyYuan(raw.expect_refund_fee ?? raw.expectRefundFee);
    if (expectOnly != null && expectOnly > 0) return expectOnly;
    return null;
  }

  function parseReturnsV3Response(json) {
    const raw = json?.data?.after_sale || json?.data;
    if (!raw || typeof raw !== 'object') return null;
    const returnsId = String(raw.returns_id || raw.returnsId || '').trim();
    const packageId = String(raw.package_id || raw.packageId || '').trim();
    const refundApplyAmount = pickRefundApplyFromReturnsV3(raw);
    const refundActualAmount = parseMoneyYuan(raw.refund_fee ?? raw.refundFee);
    const base = normalizeAfterSale({
      type: raw.returns_type_name || raw.return_type_name || raw.type || '售后',
      status: raw.status_name || String(raw.status || ''),
      refundApplyAmount,
      refundActualAmount: refundActualAmount > 0 ? refundActualAmount : null,
    });
    if (!base && !returnsId) return null;
    return {
      ...(base || {}),
      type: base?.type || raw.returns_type_name || raw.return_type_name || raw.type || '售后',
      status: base?.status || raw.status_name || String(raw.status || ''),
      refundApplyAmount: refundApplyAmount ?? base?.refundApplyAmount ?? null,
      refundActualAmount: (refundActualAmount > 0 ? refundActualAmount : null) ?? base?.refundActualAmount ?? null,
      returnsId,
      packageId,
      fromAfterSaleApi: true,
    };
  }

  function afterSaleCacheKey(returnsId) {
    return String(returnsId || '').trim();
  }

  function extractReturnsIdFromCard(card) {
    if (!card) return '';
    const parts = [card.innerHTML, card.innerText, card.outerHTML];
    for (const src of parts) {
      const m = String(src || '').match(/\b(R\d{10,})\b/);
      if (m) return m[1];
    }
    return '';
  }

  function resolveReturnsId(card, afterSale) {
    return extractReturnsIdFromCard(card) || String(afterSale?.returnsId || '').trim();
  }

  function isRefundTextFinal(text) {
    const t = String(text || '').trim();
    if (!t || t === '…' || t === '—') return false;
    return true;
  }

  function cardOrderStatusText(card, detail) {
    const parts = [
      card?.querySelector('.order-card-title-status')?.textContent,
      card?.querySelector('.order-card-title-tag')?.textContent,
      card?.querySelector('.order-card-title')?.textContent,
      detail?.erpStatus,
    ];
    return parts.map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  }

  function isOrderCancelled(card, detail) {
    return /已取消|取消发货/.test(cardOrderStatusText(card, detail));
  }

  function hasLogisticsNumber(expressNos, rawExpress) {
    return Boolean(expressNos?.length || rawExpress);
  }

  function shouldShowNoExpress(card, detail, expressNos, rawExpress) {
    if (isOrderCancelled(card, detail)) return true;
    return !hasLogisticsNumber(expressNos, rawExpress);
  }

  function mergeAfterSaleSources(pkgSale, returnsSale) {
    if (!pkgSale && !returnsSale) return null;
    if (!pkgSale) return returnsSale;
    if (!returnsSale) return pkgSale;
    return {
      ...pkgSale,
      ...returnsSale,
      refundApplyAmount: returnsSale.refundApplyAmount ?? pkgSale.refundApplyAmount,
      refundActualAmount: returnsSale.refundActualAmount ?? pkgSale.refundActualAmount,
      status: returnsSale.status || pkgSale.status,
      type: returnsSale.type || pkgSale.type,
      fromAfterSaleApi: returnsSale.fromAfterSaleApi ?? pkgSale.fromAfterSaleApi,
      fromReturnInfo: pkgSale.fromReturnInfo && !returnsSale.fromAfterSaleApi,
    };
  }

  function resolveRefundApplyAmount(afterSale) {
    if (!afterSale) return null;
    return afterSale.refundApplyAmount ?? null;
  }

  function resolveRefundDisplayAmount(afterSale) {
    const apply = resolveRefundApplyAmount(afterSale);
    if (apply != null) return apply;
    if (afterSale?.fromReturnInfo && afterSale?.refundActualAmount != null) {
      return afterSale.refundActualAmount;
    }
    return null;
  }

  function resolvePaidAmount(card, afterSale, packageDetail) {
    const fromApi = packageDetail?.paidAmount ?? afterSale?.paidAmount;
    if (fromApi != null) return fromApi;
    const { payEl } = findQtyAndPayAnchors(card);
    if (payEl) {
      const t = payEl.textContent || '';
      const m = t.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
      if (m) return parseMoneyYuan(m[1]);
    }
    return null;
  }

  function assessRefundWarning(paidAmount, applyAmount) {
    if (paidAmount == null || applyAmount == null) {
      return { rowKind: '', suffix: '', title: '' };
    }
    if (Math.abs(applyAmount - paidAmount) <= MONEY_EPS) {
      return {
        rowKind: 'warn-full',
        suffix: '[警告]',
        title: '申请退款金额与实付一致，买家可能连运费一并申请退款',
      };
    }
    if (applyAmount < paidAmount - MONEY_EPS) {
      return {
        rowKind: 'ok-normal',
        suffix: '',
        title: `实付 ${paidAmount.toFixed(2)} 元，申请 ${applyAmount.toFixed(2)} 元，未退运费部分`,
      };
    }
    return { rowKind: '', suffix: '', title: '' };
  }

  function refundDisplayMeta(afterSale, paidAmount) {
    const applyOnly = resolveRefundApplyAmount(afterSale);
    const warn = applyOnly != null
      ? assessRefundWarning(paidAmount, applyOnly)
      : { rowKind: '', suffix: '', title: '' };
    const parts = [];
    if (afterSale?.fromAfterSaleApi && afterSale?.refundApplyAmount != null) {
      parts.push('来自售后 API applied_amount');
    } else if (afterSale?.fromReturnInfo && afterSale?.refundApplyAmount != null) {
      parts.push('来自订单 API return_info');
    } else if (afterSale?.pendingRefund) {
      parts.push('售后进行中，等待售后 API');
    } else if (afterSale?.refundApplyAmount != null) {
      parts.push('来自订单 API 申请金额');
    } else if (afterSale?.refundActualAmount != null) {
      parts.push('无申请金额，显示已退金额');
    }
    if (warn.title) parts.push(warn.title);
    return { title: parts.join(' · '), ...warn };
  }

  function isFeeTextFinal(text) {
    const t = String(text || '').trim();
    if (!t || t === '…' || t === '查询中…') return false;
    return true;
  }

  function canMarkCardStable(blocks, showRefund, afterSale, returnsId) {
    const feeBlock = (blocks || []).find((b) => b.label === '月结费用：');
    if (!isFeeTextFinal(feeBlock?.text)) return false;
    if (showRefund) {
      const refundBlock = (blocks || []).find((b) => b.label === '用户申请退款金额：');
      if (!isRefundTextFinal(refundBlock?.text)) return false;
    }
    if (showRefund && isAwaitingAfterSaleApi(afterSale, returnsId)) return false;
    if (showRefund && resolveRefundApplyAmount(afterSale) == null && returnsId && !afterSale?.fetchError) {
      return false;
    }
    return true;
  }

  function cardBlocksSig(blocks) {
    return JSON.stringify((blocks || []).map((b) => [b.label, b.text, b.kind, b.rowKind || '', b.title || '']));
  }

  function findCardByPackageId(packageId) {
    const pid = String(packageId || '').trim();
    if (!pid) return null;
    const root = orderPanelRoot();
    if (!root) return null;
    for (const card of root.querySelectorAll('.order-card')) {
      const id = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      if (id === pid) return card;
    }
    return null;
  }

  function mergePackageDetailCache(packageId, parsed) {
    const ck = detailCacheKey(packageId);
    const prev = packageDetailCache.get(ck) || { expressNos: [], rawExpress: '', afterSale: null, paidAmount: null, erpStatus: '' };
    return {
      expressNos: parsed.expressNos?.length ? parsed.expressNos : prev.expressNos,
      rawExpress: parsed.rawExpress || prev.rawExpress || '',
      afterSale: mergeAfterSalePreferApi(prev.afterSale, parsed.afterSale),
      paidAmount: parsed.paidAmount ?? prev.paidAmount,
      erpStatus: parsed.erpStatus || prev.erpStatus || '',
    };
  }

  function cacheDetailImproved(prev, merged) {
    if (!prev) return true;
    if (merged.expressNos?.length && !prev.expressNos?.length) return true;
    if (merged.rawExpress && !prev.rawExpress) return true;
    if (merged.paidAmount != null && prev.paidAmount == null) return true;
    const p = prev.afterSale;
    const m = merged.afterSale;
    if (m?.refundApplyAmount != null && p?.refundApplyAmount == null) return true;
    if (m?.refundActualAmount != null && p?.refundActualAmount == null) return true;
    return false;
  }

  function ingestRefundJson(json) {
    if (!json || typeof json !== 'object') return;
    const data = json.data && typeof json.data === 'object' ? json.data : null;
    if (!data) return;
    const packageId = String(data.package_id || data.packageId || '').trim();
    if (!packageId) return;
    const parsed = parsePackageDetail(data);
    const ck = detailCacheKey(packageId);
    const prev = packageDetailCache.get(ck);
    const merged = mergePackageDetailCache(packageId, parsed);
    const improved = cacheDetailImproved(prev, merged);
    if (!improved && cardStableKeys.has(stableKey(packageId))) return;
    packageDetailCache.set(ck, merged);
    packageDetailFetchedAt.set(ck, Date.now());
    scheduleScan();
  }

  function ingestAfterSaleV3Json(json, url) {
    const parsed = parseReturnsV3Response(json);
    if (!parsed?.returnsId) return;
    const ck = afterSaleCacheKey(parsed.returnsId);
    const prev = afterSaleApiCache.get(ck);
    if (prev?.refundApplyAmount != null && parsed.refundApplyAmount == null) return;
    afterSaleApiCache.set(ck, parsed);
    afterSaleFetchedAt.set(ck, Date.now());
    if (parsed.packageId && cardStableKeys.has(stableKey(parsed.packageId))) {
      /* still refresh — apply amount may have arrived */
    }
    scheduleScan();
  }

  function hookFetchForRefund() {
    unhookFetch();
    window.__qsfInlineNativeFetch = window.fetch.bind(window);
    const orig = window.__qsfInlineNativeFetch;
    window.__qsfInlineFetchHooked = true;
    window.fetch = async function qsfInlineFetchHook(...args) {
      const res = await orig(...args);
      try {
        const input = args[0];
        const u = typeof input === 'string' ? input : (input && input.url) || '';
        if (isPackageDetailUrl(u)) {
          res.clone().json().then((json) => ingestRefundJson(json)).catch(() => {});
        } else if (isAfterSaleApiUrl(u)) {
          res.clone().json().then((json) => ingestAfterSaleV3Json(json, u)).catch(() => {});
        }
      } catch { /* ignore */ }
      return res;
    };
  }

  function shouldShowRefundRow(card, afterSale, returnsId) {
    if (returnsId) return true;
    if (resolveRefundApplyAmount(afterSale) != null) return true;
    if (afterSale?.fromAfterSaleApi) return true;
    if (card?.querySelector('.after-sale-box, .sku-after-sale, .sku-after-sale-status')) return true;
    const statusText = (card?.querySelector('.sku-after-sale-status')?.textContent || '').trim();
    if (statusText && /退|换货|售后/.test(statusText)) return true;
    const headText = (card?.innerText || '').slice(0, 160);
    if (/售后完成|售后中/.test(headText)) return true;
    if (/(?:退货|退款|换货)\s*[|｜]/.test(headText)) return true;
    return false;
  }

  function isAwaitingAfterSaleApi(afterSale, returnsId) {
    if (!returnsId) return false;
    if (resolveRefundApplyAmount(afterSale) != null) return false;
    if (afterSale?.fetchError) return false;
    return true;
  }

  function describeProxyFetchError(err) {
    const msg = String(err?.message || err || '').trim();
    if (!msg || /abort/i.test(msg)) return '订单代理未响应，请运行 npm start';
    if (/failed to fetch|network|ECONNREFUSED|ERR_CONNECTION/i.test(msg)) {
      return '订单代理未启动，请运行 npm start';
    }
    return msg;
  }

  async function fetchAfterSaleDirectFromPage(returnsId, packageId) {
    const rid = String(returnsId || '').trim();
    if (!rid) return null;
    const url = `https://ark.xiaohongshu.com/api/edith/after-sales/returns_v3/${encodeURIComponent(rid)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        credentials: 'include',
        signal: ctrl.signal,
        headers: { Accept: 'application/json, text/plain, */*' },
      });
      const json = await res.json().catch(() => null);
      if (json?.data) {
        const parsed = parseReturnsV3Response({ ok: true, data: json.data });
        if (parsed) {
          parsed.viaPageFetch = true;
          return parsed;
        }
      }
      if (!res.ok) return { fromAfterSaleApi: true, fetchError: `页面售后 API HTTP ${res.status}`, returnsId: rid, packageId };
    } catch (err) {
      return { fromAfterSaleApi: true, fetchError: describeProxyFetchError(err), returnsId: rid, packageId };
    } finally {
      clearTimeout(timer);
    }
    return null;
  }

  function mergeAfterSalePreferApi(domSale, apiSale) {
    return mergeAfterSaleSources(domSale, apiSale);
  }

  function formatYuan(n) {
    const v = Number(n);
    return Number.isFinite(v) ? `${v.toFixed(2)}元` : '—';
  }

  function calcCompanyProfit(paidAmount, applyAmount, sfFee) {
    const paid = Number(paidAmount);
    const apply = Number(applyAmount);
    const fee = Number(sfFee);
    if (!Number.isFinite(paid) || !Number.isFinite(apply) || !Number.isFinite(fee)) return null;
    return paid - apply - fee;
  }

  function buildProfitBlock(paidAmount, applyAmount, sfFee, rowKind) {
    if (rowKind === 'warn-full') return null;
    if (applyAmount == null) return null;
    const profit = calcCompanyProfit(paidAmount, applyAmount, sfFee);
    if (profit == null) return null;
    if (profit < -MONEY_EPS) {
      return {
        label: '',
        text: `损耗${Math.abs(profit).toFixed(2)}元`,
        kind: 'profit',
        title: `实付 ${Number(paidAmount).toFixed(2)} - 申请退 ${Number(applyAmount).toFixed(2)} - 月结 ${Number(sfFee).toFixed(2)} = ${profit.toFixed(2)} 元`,
      };
    }
    return {
      label: '',
      text: `赚到${profit.toFixed(2)}元`,
      kind: 'profit',
      title: `实付 ${Number(paidAmount).toFixed(2)} - 申请退 ${Number(applyAmount).toFixed(2)} - 月结 ${Number(sfFee).toFixed(2)} = ${profit.toFixed(2)} 元`,
    };
  }

  function stampFeeCache(fee) {
    return { ...fee, cachedAt: Date.now() };
  }

  async function querySfWaybillFee(expressNo, cfg) {
    const no = String(expressNo || '').trim().toUpperCase();
    if (!no) return { ok: false, error: '缺少运单号' };
    if (!isSfExpressNo(no)) return { ok: false, skipped: true, error: '非顺丰运单' };
    const ck = feeCacheKey(cfg, no);
    if (expressCache.has(ck)) {
      const cached = expressCache.get(ck);
      if (cached.ok || cached.skipped || cached.apiCode === 'A1004' || cached.apiCode === '8152') return cached;
      if (cached.cachedAt && Date.now() - cached.cachedAt < SF_ERR_CACHE_TTL_MS) return cached;
      expressCache.delete(ck);
    }
    if (sfFeeInflight.has(ck)) return sfFeeInflight.get(ck);

    const job = (async () => {
      if (!cfg.partnerID || !resolveCheckWord(cfg)) {
        return { ok: false, error: '未配置丰桥 partnerID / checkWord' };
      }
      if (!cfg.sandbox && !String(cfg.monthlyCard || '').trim()) {
        return { ok: false, error: '未配置月结卡号', apiCode: '8151' };
      }
      const msgData = buildSfWaybillMsgData(cfg, no);
      const timestamp = Date.now();
      const body = new URLSearchParams({
        partnerID: cfg.partnerID,
        requestID: uuid(),
        serviceCode: 'EXP_RECE_QUERY_SFWAYBILL',
        timestamp: String(timestamp),
        msgDigest: sfMsgDigest(msgData, timestamp, resolveCheckWord(cfg)),
        msgData,
      });
      try {
        const res = await fetch(cfg.sandbox ? SF_SBOX : SF_PROD, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: body.toString(),
        });
        const outer = JSON.parse(await res.text());
        const outerCode = String(outer.apiResultCode || '').trim();
        if (outerCode && outerCode !== 'A1000') {
          const result = stampFeeCache({ ok: false, error: outer.apiErrorMsg || '查询失败', apiCode: outerCode });
          if (outerCode !== 'A1006') expressCache.set(ck, result);
          return result;
        }
        let inner = outer;
        if (typeof outer.apiResultData === 'string') {
          try { inner = JSON.parse(outer.apiResultData); } catch { inner = { success: false }; }
        }
        if (!inner.success && inner.success !== true) {
          const apiCode = String(inner.errorCode || outer.apiResultCode || '');
          let errMsg = inner.errorMsg || outer.apiErrorMsg || '查询失败';
          if (apiCode === '8151') errMsg = '该运单未挂月结卡';
          if (apiCode === '8148') errMsg = '丰桥无该运单扣费';
          const result = stampFeeCache({ ok: false, error: errMsg, apiCode });
          expressCache.set(ck, result);
          return result;
        }
        const data = inner.msgData || inner;
        const info = data.waybillInfo || {};
        const fees = data.waybillFeeList || [];
        const total = fees.reduce((s, f) => s + (Number(f.feeAmt ?? f.value) || 0), 0) || info.totalFee;
        const result = stampFeeCache({ ok: true, totalFee: total, waybillNo: info.waybillNo || no });
        expressCache.set(ck, result);
        trimExpressCache();
        return result;
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }
    })();

    sfFeeInflight.set(ck, job);
    try {
      return await job;
    } finally {
      sfFeeInflight.delete(ck);
    }
  }

  function orderPanelRoot() {
    return document.querySelector('.order-tool-content')
      || document.querySelector('.new-right-panel')
      || document.querySelector('.order-tool-container')
      || document.querySelector('.farmer-chat__right');
  }

  function extractExpressFromCard(card) {
    if (!card) return [];
    const found = new Set();
    const add = (no) => {
      const n = String(no || '').trim().toUpperCase();
      if (isSfExpressNo(n)) found.add(n);
    };
    const logistics = card.querySelector('.delivery-row-logistics, .logistics-box');
    if (logistics) {
      const m = (logistics.innerText || '').match(/\b(SF\d{10,})\b/gi);
      if (m) m.forEach(add);
    }
    const text = card.innerText || '';
    const all = text.match(/\b(SF\d{10,})\b/gi);
    if (all) all.forEach(add);
    return [...found];
  }

  function pickExpressFromPackageDetail(data) {
    if (!data || typeof data !== 'object') return [];
    const out = new Set();
    const add = (no) => {
      const n = String(no || '').trim().toUpperCase();
      if (isSfExpressNo(n)) out.add(n);
    };
    add(data.express_number || data.express_no || data.expressNo || data.ship_express_no);
    if (Array.isArray(data.delivery_packages)) {
      for (const dp of data.delivery_packages) {
        if (!dp) continue;
        add(dp.express_no || dp.express_number || dp.expressNo);
      }
    }
    return [...out];
  }

  function buildPackageDetailProxyUrl(packageId) {
    const pid = encodeURIComponent(String(packageId || '').trim());
    const port = Number(window.__qfPackageProxyPort || 4725);
    const base = `http://127.0.0.1:${port}`;
    const shopTitle = String(document.title || '').replace(/-工作台\s*$/, '').trim();
    if (shopTitle) return `${base}/package-detail?packageId=${pid}&shopTitle=${encodeURIComponent(shopTitle)}`;
    return `${base}/package-detail?packageId=${pid}`;
  }

  function parsePackageDetail(data) {
    if (!data || typeof data !== 'object') {
      return { expressNos: [], rawExpress: '', afterSale: null, paidAmount: null, erpStatus: '' };
    }
    const expressNos = pickExpressFromPackageDetail(data);
    const rawExpress = pickRawExpressFromPackageDetail(data);
    const afterSale = pickAfterSaleFromPackageDetail(data);
    const sku = Array.isArray(data.sku_snapshots) ? data.sku_snapshots[0] : null;
    const paidAmount = parseMoneyYuan(data.customer_pay_amount ?? data.customerPayAmount)
      ?? parseMoneyYuan(sku?.sku_pay_amount ?? sku?.total_price);
    const erpStatus = String(data.erp_status_str || data.erpStatus || sku?.status_name || '').trim();
    return { expressNos, rawExpress, afterSale, paidAmount, erpStatus };
  }

  function buildAfterSaleProxyUrl(returnsId, packageId) {
    const rid = encodeURIComponent(String(returnsId || '').trim());
    const pid = encodeURIComponent(String(packageId || '').trim());
    const port = Number(window.__qfPackageProxyPort || 4725);
    const base = `http://127.0.0.1:${port}`;
    const shopTitle = String(document.title || '').replace(/-工作台\s*$/, '').trim();
    const qs = new URLSearchParams({ returnsId: String(returnsId || '').trim(), packageId: String(packageId || '').trim() });
    if (shopTitle) qs.set('shopTitle', shopTitle);
    return `${base}/after-sale?${qs.toString()}`;
  }

  async function fetchAfterSaleFromApi(returnsId, packageId, force = false) {
    const rid = String(returnsId || '').trim();
    if (!rid) return null;
    const ck = afterSaleCacheKey(rid);
    const cached = afterSaleApiCache.get(ck);
    const lastAt = afterSaleFetchedAt.get(ck) || 0;
    if (!force && cached) {
      const age = Date.now() - lastAt;
      if (cached.refundApplyAmount != null && age < PKG_DETAIL_COOLDOWN_MS) return cached;
      if (!cached.fetchError && age < PKG_DETAIL_COOLDOWN_MS) return cached;
      if (cached.fetchError && age < 2500) return cached;
    }

    if (afterSaleInflight.has(ck)) return afterSaleInflight.get(ck);

    const job = (async () => {
      let lastError = '';
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(buildAfterSaleProxyUrl(rid, packageId), { signal: ctrl.signal });
        clearTimeout(timer);
        const envelope = await res.json().catch(() => null);
        if (envelope?.ok && envelope.data) {
          const parsed = parseReturnsV3Response(envelope);
          if (parsed) {
            afterSaleFetchedAt.set(ck, Date.now());
            afterSaleApiCache.set(ck, parsed);
            return parsed;
          }
          lastError = '售后数据无申请金额';
        } else {
          lastError = envelope?.error || `代理 HTTP ${res.status}`;
        }
      } catch (err) {
        lastError = describeProxyFetchError(err);
      }

      const pageParsed = await fetchAfterSaleDirectFromPage(rid, packageId);
      if (pageParsed?.refundApplyAmount != null) {
        afterSaleFetchedAt.set(ck, Date.now());
        afterSaleApiCache.set(ck, pageParsed);
        return pageParsed;
      }
      if (pageParsed?.fetchError && !lastError) lastError = pageParsed.fetchError;

      const failed = {
        fromAfterSaleApi: true,
        fetchError: lastError || '售后查询失败',
        returnsId: rid,
        packageId: String(packageId || '').trim(),
      };
      afterSaleFetchedAt.set(ck, Date.now());
      afterSaleApiCache.set(ck, failed);
      return cached?.refundApplyAmount != null ? cached : failed;
    })();

    afterSaleInflight.set(ck, job);
    try {
      return await job;
    } finally {
      afterSaleInflight.delete(ck);
    }
  }

  async function fetchPackageDetailFromApi(packageId, force = false) {
    const pid = String(packageId || '').trim();
    if (!pid) return { expressNos: [], rawExpress: '', afterSale: null, paidAmount: null, erpStatus: '' };

    const ck = detailCacheKey(pid);
    const sk = stableKey(pid);
    if (cardStableKeys.has(sk) && !force) {
      return packageDetailCache.get(ck) || { expressNos: [], rawExpress: '', afterSale: null, paidAmount: null, erpStatus: '' };
    }

    const cached = packageDetailCache.get(ck);
    const lastAt = packageDetailFetchedAt.get(ck) || 0;
    if (!force && cached && Date.now() - lastAt < PKG_DETAIL_COOLDOWN_MS) return cached;

    const inflightKey = `${activeSessionKey}:${pid}`;
    if (packageDetailInflight.has(inflightKey)) return packageDetailInflight.get(inflightKey);

    const job = (async () => {
      if (!force && !packageDetailCache.has(ck)) {
        await waitForPackageCache(pid);
        const hooked = packageDetailCache.get(ck);
        if (hooked) return hooked;
      }
      try {
        const res = await fetch(buildPackageDetailProxyUrl(pid));
        const envelope = await res.json().catch(() => null);
        if (envelope?.ok && envelope.data) {
          const parsed = parsePackageDetail(envelope.data);
          packageDetailFetchedAt.set(ck, Date.now());
          packageDetailCache.set(ck, parsed);
          return parsed;
        }
      } catch { /* ignore */ }
      return { expressNos: [], rawExpress: '', afterSale: null, paidAmount: null, erpStatus: '' };
    })();

    packageDetailInflight.set(inflightKey, job);
    try {
      return await job;
    } finally {
      packageDetailInflight.delete(inflightKey);
    }
  }

  function findQtyAndPayAnchors(card) {
    const scopes = [
      card.querySelector('.order-card-footer, .order-footer, [class*="card-footer"], [class*="order-bottom"]'),
      card,
    ].filter(Boolean);
    let qtyEl = null;
    let payEl = null;
    let qtyScore = Infinity;
    let payScore = Infinity;
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll('div, span, p')) {
        if (el.closest('.qsf-inline-fee-wrap')) continue;
        const t = normText(el.textContent);
        if (!t || t.length > 80) continue;
        if (/共\s*\d+\s*件/.test(t) && !/(实付|应付)/.test(t) && t.length < qtyScore) {
          qtyScore = t.length;
          qtyEl = el;
        }
        if (/(实付|应付)/.test(t) && (/[¥￥]/.test(t) || /\d+(?:\.\d{1,2})?/.test(t)) && t.length < payScore) {
          payScore = t.length;
          payEl = el;
        }
      }
      if (qtyEl && payEl) break;
    }
    return { qtyEl, payEl };
  }

  function insertWrapBetweenAnchors(card, wrap) {
    const { qtyEl, payEl } = findQtyAndPayAnchors(card);
    if (qtyEl && payEl && qtyEl.parentElement === payEl.parentElement) {
      const parent = qtyEl.parentElement;
      if (qtyEl.compareDocumentPosition(payEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
        parent.insertBefore(wrap, payEl);
      } else {
        parent.insertBefore(wrap, qtyEl.nextSibling);
      }
      return true;
    }
    if (payEl?.parentElement) {
      payEl.parentElement.insertBefore(wrap, payEl);
      return true;
    }
    if (qtyEl?.parentElement) {
      qtyEl.parentElement.insertBefore(wrap, qtyEl.nextSibling);
      return true;
    }
    return false;
  }

  function repositionFeeWrap(card, wrap) {
    insertWrapBetweenAnchors(card, wrap);
  }

  function ensureFeeWrap(card) {
    let wrap = card.querySelector('.qsf-inline-fee-wrap');
    const isNew = !wrap;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'qsf-inline-fee-wrap';
      wrap.setAttribute('data-qsf-inline', VERSION);
    }

    if (!insertWrapBetweenAnchors(card, wrap) && isNew) {
      const header = card.querySelector('.order-card-header');
      if (header?.parentElement) {
        header.parentElement.insertBefore(wrap, header.nextSibling);
      } else {
        card.appendChild(wrap);
      }
    }
    return wrap;
  }

  function renderCardInfo(wrap, blocks) {
    if (!wrap || !blocks?.length) return;
    const rowKind = blocks.find((b) => b.rowKind)?.rowKind
      || (blocks.some((b) => b.kind === 'loading') ? 'loading' : '');
    const rowCls = [
      'qsf-inline-fee-row',
      rowKind === 'warn-full' ? 'qsf-inline-warn-full' : '',
      rowKind === 'ok-normal' ? 'qsf-inline-ok-normal' : '',
      rowKind === 'loading' ? 'qsf-inline-fee-loading' : '',
    ].filter(Boolean).join(' ');
    const title = blocks.map((b) => b.title).filter(Boolean).join(' · ');
    const segs = blocks.map((block) => {
      const segCls = [
        'qsf-inline-seg',
        block.kind === 'muted' ? 'qsf-inline-fee-muted' : '',
        block.kind === 'refund' && !block.rowKind ? 'qsf-inline-refund' : '',
        block.kind === 'profit' ? 'qsf-inline-profit' : '',
      ].filter(Boolean).join(' ');
      if (block.kind === 'profit' || !block.label) {
        return `<span class="${segCls}"><span class="qsf-inline-fee-amount">${block.text}</span></span>`;
      }
      return `<span class="${segCls}"><span class="qsf-inline-fee-label">${block.label}</span><span class="qsf-inline-fee-amount">${block.text}</span></span>`;
    }).join('<span class="qsf-inline-gap"></span>');
    wrap.innerHTML = `<div class="${rowCls}"${title ? ` title="${esc(title)}"` : ''}>${segs}</div>`;
  }

  function placeholderBlocks(returnsId, hasAfterSale) {
    return [
      { label: '月结费用：', text: '…', kind: 'muted' },
      ...(returnsId || hasAfterSale ? [{ label: '用户申请退款金额：', text: '…', kind: 'muted' }] : []),
    ];
  }

  function paintCachedOrPlaceholder(wrap, packageId, returnsId, hasAfterSale, card) {
    const cachedRender = cardRenderCache.get(renderCacheKey(packageId));
    if (cachedRender?.blocks?.length && card && renderCacheIsFresh(cachedRender, card)) {
      renderCardInfo(wrap, cachedRender.blocks);
      return cachedRender;
    }
    renderCardInfo(wrap, placeholderBlocks(returnsId, hasAfterSale));
    return null;
  }

  function renderCacheIsFresh(cachedRender, card) {
    if (!cachedRender?.blocks?.length || !card) return false;
    if (cachedRender.at && Date.now() - cachedRender.at > CARD_RENDER_STALE_MS) return false;
    const feeText = cachedRender.blocks.find((b) => b.label === '月结费用：')?.text;
    if (!isFeeTextFinal(feeText)) return false;
    const returnsId = extractReturnsIdFromCard(card);
    const showRefund = shouldShowRefundRow(card, null, returnsId);
    if (!showRefund) return true;
    const refundText = cachedRender.blocks.find((b) => b.label === '用户申请退款金额：')?.text;
    return isRefundTextFinal(refundText);
  }

  async function querySfFeesForNos(expressNos, cfg, gen) {
    let sfFeeTotal = null;
    let feeFallback = null;
    for (const no of expressNos) {
      if (isSessionStale(gen)) return { sfFeeTotal: null, feeFallback, aborted: true };
      const fee = await querySfWaybillFee(no, cfg);
      if (isSessionStale(gen)) return { sfFeeTotal: null, feeFallback, aborted: true };
      if (fee.ok && Number.isFinite(Number(fee.totalFee))) {
        sfFeeTotal = (sfFeeTotal ?? 0) + Number(fee.totalFee);
      } else if (!feeFallback) {
        feeFallback = fee;
      }
    }
    return { sfFeeTotal, feeFallback, aborted: false };
  }

  async function refreshCard(card, opts = {}) {
    const gen = sessionGeneration;
    const silent = opts.silent === true;
    const packageId = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
    if (!packageId || !card.isConnected) return;
    const jobKey = `${activeSessionKey}:${packageId}`;
    if (cardJobs.get(jobKey) === 'running') return;
    cardJobs.set(jobKey, 'running');

    const wrap = ensureFeeWrap(card);
    let returnsId = extractReturnsIdFromCard(card);
    const hasAfterSale = shouldShowRefundRow(card, null, returnsId);
    const cachedRender = cardRenderCache.get(renderCacheKey(packageId));
    const retryCount = cardRetryCount.get(packageId) || 0;

    if (!wrap.querySelector('.qsf-inline-fee-row')) {
      paintCachedOrPlaceholder(wrap, packageId, returnsId, hasAfterSale, card);
    }

    try {
      if (isSessionStale(gen)) return;

      const domExpressNos = extractExpressFromCard(card);
      let expressNos = [...domExpressNos];
      let rawExpress = extractRawExpressFromCard(card);
      let afterSale = null;
      let paidAmount = null;
      let erpStatus = '';
      const detailCk = detailCacheKey(packageId);
      const cachedDetail = packageDetailCache.get(detailCk);
      if (cachedDetail) {
        if (cachedDetail.expressNos?.length) {
          expressNos = [...new Set([...expressNos, ...cachedDetail.expressNos])];
        }
        if (cachedDetail.rawExpress && !rawExpress) rawExpress = cachedDetail.rawExpress;
        afterSale = cachedDetail.afterSale || null;
        paidAmount = cachedDetail.paidAmount ?? null;
        erpStatus = cachedDetail.erpStatus || '';
      }

      if (returnsId) {
        const cachedAfterSale = afterSaleApiCache.get(afterSaleCacheKey(returnsId));
        afterSale = mergeAfterSaleSources(afterSale, cachedAfterSale);
      }

      const cfg = loadConfig();
      const needApi = !packageDetailCache.has(detailCk) || opts.forceApi === true;
      const canSkipHookWait = domExpressNos.length > 0 || packageDetailCache.has(detailCk);

      const sfFeePromise = domExpressNos.length
        ? querySfFeesForNos(domExpressNos, cfg, gen)
        : Promise.resolve({ sfFeeTotal: null, feeFallback: null, aborted: false });

      const detailPromise = (async () => {
        if (!needApi && !opts.forceApi) return cachedDetail || packageDetailCache.get(detailCk) || null;
        if (needApi && !opts.forceApi && !canSkipHookWait) {
          await waitForPackageCache(packageId, PKG_DETAIL_HOOK_WAIT_MS);
          if (isSessionStale(gen)) return null;
          const hooked = packageDetailCache.get(detailCk);
          if (hooked) return hooked;
        }
        return fetchPackageDetailFromApi(packageId, opts.forceApi === true);
      })();

      const afterSalePromise = returnsId
        ? fetchAfterSaleFromApi(returnsId, packageId, opts.forceApi === true)
        : Promise.resolve(null);

      const [detail, returnsSale, sfEarly] = await Promise.all([
        detailPromise,
        afterSalePromise,
        sfFeePromise,
      ]);
      if (isSessionStale(gen)) return;

      if (detail?.expressNos?.length) {
        expressNos = [...new Set([...expressNos, ...detail.expressNos])];
      }
      if (detail?.rawExpress && !rawExpress) rawExpress = detail.rawExpress;
      afterSale = mergeAfterSaleSources(afterSale, detail?.afterSale || null);
      afterSale = mergeAfterSaleSources(afterSale, returnsSale);
      returnsId = resolveReturnsId(card, afterSale);
      if (returnsId && resolveRefundApplyAmount(afterSale) == null
        && (!returnsSale || returnsSale?.fetchError)) {
        const lateSale = await fetchAfterSaleFromApi(returnsId, packageId, Boolean(returnsSale?.fetchError) || opts.forceApi === true);
        if (isSessionStale(gen)) return;
        afterSale = mergeAfterSaleSources(afterSale, lateSale);
      }
      paidAmount = detail?.paidAmount ?? paidAmount;
      erpStatus = detail?.erpStatus || erpStatus;
      if (!rawExpress) rawExpress = extractRawExpressFromCard(card);
      paidAmount = resolvePaidAmount(card, afterSale, { paidAmount });

      const blocks = [];
      let sfFeeTotal = sfEarly.sfFeeTotal;
      let feeFallback = sfEarly.feeFallback;
      let feeQueryFailed = false;

      const detailOnlyExpress = expressNos.filter((n) => !domExpressNos.includes(n));
      if (!sfEarly.aborted && detailOnlyExpress.length) {
        const late = await querySfFeesForNos(detailOnlyExpress, cfg, gen);
        if (isSessionStale(gen)) return;
        if (late.sfFeeTotal != null) sfFeeTotal = (sfFeeTotal ?? 0) + late.sfFeeTotal;
        if (!feeFallback && late.feeFallback) feeFallback = late.feeFallback;
      } else if (!sfEarly.aborted && sfFeeTotal == null && !feeFallback && !domExpressNos.length && expressNos.length) {
        const late = await querySfFeesForNos(expressNos, cfg, gen);
        if (isSessionStale(gen)) return;
        sfFeeTotal = late.sfFeeTotal;
        feeFallback = late.feeFallback;
      }
      const detailCtx = { erpStatus };
      const noExpress = shouldShowNoExpress(card, detailCtx, expressNos, rawExpress);
      const nonSfExpress = !noExpress && isNonSfExpress(rawExpress);

      if (noExpress) {
        const title = isOrderCancelled(card, detailCtx) ? '订单已取消' : '无物流单号';
        blocks.push({ label: '月结费用：', text: '无单号', kind: 'muted', title });
      } else if (nonSfExpress) {
        blocks.push({ label: '月结费用：', text: '非顺丰', kind: 'muted', title: `运单 ${rawExpress}` });
      } else if (!expressNos.length) {
        blocks.push({ label: '月结费用：', text: '无单号', kind: 'muted', title: '无顺丰运单号' });
      } else if (sfFeeTotal != null) {
        blocks.push({ label: '月结费用：', text: formatYuan(sfFeeTotal) });
      } else if (feeFallback?.skipped) {
        blocks.push({ label: '月结费用：', text: '非顺丰', kind: 'muted' });
      } else {
        feeQueryFailed = true;
        const giveUp = retryCount >= MAX_CARD_RETRY;
        blocks.push({
          label: '月结费用：',
          text: giveUp ? '—' : '…',
          kind: 'muted',
          title: feeFallback?.error || (giveUp ? '查询失败' : '查询中'),
        });
      }

      const refundApplyAmt = resolveRefundApplyAmount(afterSale);
      const refundDisplayAmt = resolveRefundDisplayAmount(afterSale);
      const showRefund = shouldShowRefundRow(card, afterSale, returnsId);
      const sk = stableKey(packageId);
      if (showRefund) {
        if (refundDisplayAmt != null) {
          const meta = refundDisplayMeta(afterSale, paidAmount);
          blocks.push({
            label: '用户申请退款金额：',
            text: `${formatYuan(refundDisplayAmt)}${meta.suffix}`,
            kind: 'refund',
            rowKind: meta.rowKind,
            title: meta.title,
          });
          const profitBlock = buildProfitBlock(paidAmount, refundApplyAmt, sfFeeTotal, meta.rowKind);
          if (profitBlock) blocks.push(profitBlock);
        } else if (isAwaitingAfterSaleApi(afterSale, returnsId)) {
          blocks.push({ label: '用户申请退款金额：', text: '…', kind: 'muted' });
        } else {
          blocks.push({
            label: '用户申请退款金额：',
            text: '—',
            kind: 'muted',
            title: afterSale?.fetchError || '无申请金额',
          });
        }
      }

      if (!blocks.length) {
        blocks.push({ label: '月结费用：', text: '—', kind: 'muted', title: '无扣费数据' });
      }

      if (isSessionStale(gen)) return;

      const sig = cardBlocksSig(blocks);
      const hasLoading = blocks.some((b) => b.kind === 'loading');
      if (cachedRender?.sig !== sig) {
        cardRenderCache.set(renderCacheKey(packageId), { sig, blocks, at: Date.now() });
        renderCardInfo(wrap, blocks);
      } else if (!wrap.querySelector('.qsf-inline-fee-row')) {
        cardRenderCache.set(renderCacheKey(packageId), { sig, blocks, at: Date.now() });
        renderCardInfo(wrap, blocks);
      } else {
        cardRenderCache.set(renderCacheKey(packageId), { sig, blocks, at: cachedRender?.at || Date.now() });
      }
      if (!hasLoading && canMarkCardStable(blocks, showRefund, afterSale, returnsId)) {
        cardStableKeys.add(sk);
      } else {
        cardStableKeys.delete(sk);
      }

      const retries = retryCount;
      const needRefundRetry = showRefund && returnsId && isAwaitingAfterSaleApi(afterSale, returnsId)
        && retries < MAX_CARD_RETRY && !afterSale?.fetchError;
      const shouldRetryExpress = !noExpress && !nonSfExpress && !hasLoading && !expressNos.length
        && !cardStableKeys.has(sk) && card.isConnected && retries < MAX_CARD_RETRY;
      const needFeeRetry = feeQueryFailed && retryCount < MAX_CARD_RETRY && card.isConnected;
      if ((shouldRetryExpress || needRefundRetry || needFeeRetry) && card.isConnected) {
        cardRetryCount.set(packageId, retries + 1);
        cardJobs.delete(jobKey);
        const prevTimer = cardRetryTimers.get(packageId);
        if (prevTimer) clearTimeout(prevTimer);
        const timer = setTimeout(() => {
          cardRetryTimers.delete(packageId);
          if (isSessionStale(gen) || !card.isConnected) return;
          void refreshCard(card, { silent: true, forceApi: retries >= 1 });
        }, 700 + retries * 500);
        cardRetryTimers.set(packageId, timer);
        return;
      }
      cardRetryCount.delete(packageId);
    } catch (err) {
      if (!silent && !isSessionStale(gen)) {
        const errBlocks = [{
          label: '月结费用：',
          text: '…',
          kind: 'muted',
          title: String(err.message || err),
        }];
        if (returnsId || hasAfterSale) {
          errBlocks.push({ label: '用户申请退款金额：', text: '…', kind: 'muted' });
        }
        renderCardInfo(wrap, errBlocks);
      }
      cardStableKeys.delete(stableKey(packageId));
    } finally {
      cardJobs.delete(jobKey);
      if (isSessionStale(gen) && wrap && !wrap.querySelector('.qsf-inline-fee-row')) {
        wrap.remove();
      }
    }
  }

  function scanOrderCards() {
    syncSession();
    const root = orderPanelRoot();
    if (!root) return;
    const cards = root.querySelectorAll('.order-card');
    const activeIds = new Set();
    cards.forEach((card) => {
      const pid = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
      if (!pid) return;
      activeIds.add(pid);
      const sk = stableKey(pid);
      const jobKey = `${activeSessionKey}:${pid}`;
      if (cardJobs.get(jobKey) === 'running') return;
      const wrap = ensureFeeWrap(card);
      const returnsId = extractReturnsIdFromCard(card);
      const hasAfterSale = shouldShowRefundRow(card, null, returnsId);
      const cachedRender = cardRenderCache.get(renderCacheKey(pid));
      const refundText = cachedRender?.blocks?.find((b) => b.label === '用户申请退款金额：')?.text;
      if (refundText === '—' && returnsId) cardStableKeys.delete(sk);
      paintCachedOrPlaceholder(wrap, pid, returnsId, hasAfterSale, card);
      if (cardStableKeys.has(sk) && wrap && renderCacheIsFresh(cachedRender, card)) {
        repositionFeeWrap(card, wrap);
        return;
      }
      if (cardStableKeys.has(sk) && !wrap) {
        cardStableKeys.delete(sk);
      }
      void refreshCard(card, { silent: true });
    });
    for (const key of [...cardStableKeys]) {
      const pid = key.includes(':') ? key.split(':').slice(1).join(':') : key;
      if (!activeIds.has(pid)) cardStableKeys.delete(key);
    }
    root.querySelectorAll('.qsf-inline-fee-wrap').forEach((wrap) => {
      const card = wrap.closest('.order-card');
      if (!card) wrap.remove();
    });
  }

  function scheduleScan(immediate = false) {
    if (immediate) {
      clearTimeout(scanTimer);
      scanTimer = null;
      scanOrderCards();
      return;
    }
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanOrderCards();
    }, SCAN_DEBOUNCE_MS);
  }

  function bindOrderObserver() {
    if (orderObs) orderObs.disconnect();
    const root = orderPanelRoot();
    if (!root) {
      setTimeout(bindOrderObserver, 400);
      return;
    }
    orderObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])];
          const addedCard = nodes.some((n) => {
            if (n.nodeType !== 1) return false;
            return n.matches?.('.order-card') || Boolean(n.querySelector?.('.order-card'));
          });
          if (addedCard) {
            scheduleScan(true);
            return;
          }
          const relevant = nodes.some((n) => {
            if (n.nodeType !== 1) return n.parentElement && !n.parentElement.closest?.('.qsf-inline-fee-wrap');
            return !n.classList?.contains?.('qsf-inline-fee-wrap') && !n.closest?.('.qsf-inline-fee-wrap')
              && (n.matches?.('.order-card, .order-card *') || n.querySelector?.('.order-card'));
          });
          if (relevant) {
            scheduleScan();
            return;
          }
        } else if (m.type === 'attributes' && m.target?.nodeType === 1) {
          const t = m.target;
          if (t.closest?.('.order-card') && !t.closest?.('.qsf-inline-fee-wrap')) {
            scheduleScan();
            return;
          }
        }
      }
    });
    orderObs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    scheduleScan(true);
  }

  function ensureStyles() {
    const port = Number(window.__qfPackageProxyPort || 4725);
    const fontBase = `http://127.0.0.1:${port}/fonts`;
    let style = document.getElementById(STYLE_ID);
    if (style && style.getAttribute('data-qsf-ver') === VERSION) return;
    if (style) style.remove();
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute('data-qsf-ver', VERSION);
    style.textContent = `
      @font-face {
        font-family: 'HarmonyOS Sans SC';
        src: url('${fontBase}/HarmonyOS_SansSC_Regular.ttf') format('truetype');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }
      @font-face {
        font-family: 'HarmonyOS Sans SC';
        src: url('${fontBase}/HarmonyOS_SansSC_Medium.ttf') format('truetype');
        font-weight: 600;
        font-style: normal;
        font-display: swap;
      }
      .qsf-inline-fee-wrap {
        display: inline-flex;
        flex-direction: row;
        flex-wrap: nowrap;
        align-items: baseline;
        justify-content: flex-start;
        gap: 0;
        margin: 0 10px;
        padding: 0 2px;
        vertical-align: middle;
        pointer-events: none;
        flex: 0 0 auto;
        white-space: nowrap;
        font-family: 'HarmonyOS Sans SC', 'HarmonyOS Sans', sans-serif;
      }
      .qsf-inline-fee-row {
        display: inline-flex;
        align-items: baseline;
        gap: 0;
        font-size: 14px;
        line-height: 1.35;
        color: #ff2442;
        white-space: nowrap;
        font-family: inherit;
      }
      .qsf-inline-seg { display: inline-flex; align-items: baseline; gap: 0; font-family: inherit; }
      .qsf-inline-gap { display: inline-block; width: 6px; flex: 0 0 6px; }
      .qsf-inline-fee-label { color: rgba(0,0,0,.65); font-weight: 400; font-family: inherit; margin: 0; padding: 0; }
      .qsf-inline-fee-amount { font-weight: 600; color: #ff2442; font-family: inherit; margin: 0; padding: 0; }
      .qsf-inline-refund .qsf-inline-fee-amount { color: #e6a23c; }
      .qsf-inline-refund .qsf-inline-fee-label { color: rgba(0,0,0,.55); }
      .qsf-inline-warn-full,
      .qsf-inline-warn-full .qsf-inline-fee-label,
      .qsf-inline-warn-full .qsf-inline-fee-amount {
        color: #ff2442 !important;
        font-weight: 600;
      }
      .qsf-inline-ok-normal,
      .qsf-inline-ok-normal .qsf-inline-fee-label,
      .qsf-inline-ok-normal .qsf-inline-fee-amount {
        color: #389e0d !important;
        font-weight: 600;
      }
      .qsf-inline-fee-loading { color: rgba(0,0,0,.45); font-size: 14px; font-family: inherit; }
      .qsf-inline-fee-muted { color: rgba(0,0,0,.35); font-size: 14px; font-family: inherit; }
    `;
    document.head.appendChild(style);
  }

  function teardownLegacyPanel() {
    try {
      if (window.__qfSfFeePanel?.teardown) window.__qfSfFeePanel.teardown();
    } catch { /* ignore */ }
    document.querySelectorAll('#qf-sf-fee-panel-root').forEach((el) => el.remove());
    document.getElementById('qf-sf-fee-panel-style')?.remove();
    document.documentElement.classList.remove('qsf-page-docked');
    document.body?.classList.remove('qsf-page-docked');
    try { sessionStorage.removeItem('qsf_panel_pinned_v1'); } catch { /* ignore */ }
    delete window.__qfSfFeePanel;
    delete window.__qfSfExpandPanel;
    delete window.__qfSfLauncherDragCleanup;
  }

  function ensureLegacyPanelWatchdog() {
    if (window.__qsfLegacyPanelWatch) return;
    window.__qsfLegacyPanelWatch = setInterval(() => {
      if (document.getElementById('qf-sf-fee-panel-root') || window.__qfSfFeePanel) {
        teardownLegacyPanel();
      }
    }, 1200);
  }

  function teardown() {
    sessionGeneration += 1;
    clearTimeout(scanTimer);
    scanTimer = null;
    clearCardRetryTimers();
    if (orderObs) {
      orderObs.disconnect();
      orderObs = null;
    }
    unwatchSession();
    document.querySelectorAll('.qsf-inline-fee-wrap').forEach((el) => el.remove());
    document.getElementById(STYLE_ID)?.remove();
    if (window.__qsfLegacyPanelWatch) {
      clearInterval(window.__qsfLegacyPanelWatch);
      delete window.__qsfLegacyPanelWatch;
    }
    unhookFetch();
    expressCache.clear();
    sfFeeInflight.clear();
    packageDetailCache.clear();
    packageDetailFetchedAt.clear();
    packageDetailInflight.clear();
    afterSaleApiCache.clear();
    afterSaleFetchedAt.clear();
    afterSaleInflight.clear();
    cardRenderCache.clear();
    cardRetryCount.clear();
    cardStableKeys.clear();
    cardJobs.clear();
    teardownLegacyPanel();
    delete window.__qfSfFeeInline;
  }

  function boot() {
    teardownLegacyPanel();
    if (window.__qfSfFeeInline?.version === VERSION) {
      ensureLegacyPanelWatchdog();
      ensureStyles();
      if (!window.__qsfInlineFetchHooked) hookFetchForRefund();
      if (!sessionPollTimer) watchSession();
      else syncSession();
      if (!orderObs) bindOrderObserver();
      else scheduleScan(true);
      return;
    }
    if (window.__qfSfFeeInline?.teardown) window.__qfSfFeeInline.teardown();
    teardownLegacyPanel();
    ensureStyles();
    hookFetchForRefund();
    watchSession();
    bindOrderObserver();
    ensureLegacyPanelWatchdog();
    window.__qfSfFeeInline = {
      version: VERSION,
      teardown,
      rescan: scheduleScan,
      syncSession,
      getActiveSessionKey,
    };
    console.log(`[顺丰运费] 内嵌 v${VERSION} 已注入（订单卡常驻显示，切换会话自动停查）`);
  }

  boot();
})();
