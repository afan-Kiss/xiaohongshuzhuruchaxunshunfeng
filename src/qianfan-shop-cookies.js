/**

 * 四店 shopKey 识别 + Cookie 加载（manual-cookies.txt / 主播分析 API）

 */

const fs = require('fs');

const path = require('path');

const {
  SHOP_ROWS,
  resolveShopFromTitle,
  resolveShopTitleFromKey: titleFromShopKey,
} = require('./core/shop-identity');



const cookieCache = new Map();

const COOKIE_TTL_MS = 5 * 60 * 1000;



function resolveShopKeyFromTitle(pageTitle) {
  const result = resolveShopFromTitle(pageTitle);
  return result.ok ? result.shopKey : '';
}



function resolveShopTitleFromKey(shopKey) {
  return titleFromShopKey(shopKey);
}



function invalidateShopCookie(shopKey) {

  const key = String(shopKey || '').trim();

  if (key) cookieCache.delete(key);

}



function manualCookiePaths() {

  const root = path.resolve(__dirname, '..');

  return [

    path.join(root, 'data', 'manual-cookies.txt'),

    path.resolve(root, '..', '千帆中转机器人', 'data', 'manual-cookies.txt'),

  ];

}



function parseManualCookiesFile(text) {

  const shops = {};

  const blocks = String(text || '').split(/【/);

  for (const block of blocks) {

    const keyMatch = block.match(/shopKey=([a-z]+)/i);

    if (!keyMatch) continue;

    const shopKey = keyMatch[1];

    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const cookieLine = lines.find((l) => l.startsWith('a1=') && l.includes('access-token'));

    if (cookieLine) shops[shopKey] = cookieLine;

  }

  return shops;

}



function loadManualCookiesMap() {

  for (const filePath of manualCookiePaths()) {

    try {

      if (!fs.existsSync(filePath)) continue;

      const map = parseManualCookiesFile(fs.readFileSync(filePath, 'utf8'));

      if (Object.keys(map).length) return { map, source: filePath };

    } catch {

      /* ignore */

    }

  }

  return { map: {}, source: '' };

}



async function fetchCookieFromAnalyst(shopKey, signal) {
  const bases = [
    String(process.env.QIANFAN_ANALYST_COOKIE_BASE_URL || 'http://127.0.0.1:4723').replace(/\/$/, ''),
    'http://127.0.0.1:4790',
  ];
  for (const base of bases) {
    const url = `${base}/api/shop-cookies/plain?shopKey=${encodeURIComponent(shopKey)}`;
    try {
      const res = await fetch(url, {
        signal: signal || AbortSignal.timeout(8000),
      });
      const json = await res.json().catch(() => ({}));
      const payload = json?.data || json;
      const cookie = String(payload?.cookie || '').trim();
      if (res.ok && cookie.length >= 80) return cookie;
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      /* try next */
    }
  }
  return '';
}

async function getShopCookie(shopKey, options = {}) {
  const key = String(shopKey || '').trim();
  if (!key) return { ok: false, error: 'missing_shop_key' };

  // Compat: getShopCookie(shopKey, AbortSignal)
  if (options && typeof options.aborted === 'boolean' && typeof options.addEventListener === 'function') {
    options = { signal: options };
  }

  if (options.forceRefresh) invalidateShopCookie(key);

  const cached = cookieCache.get(key);
  if (cached && Date.now() - cached.at < COOKIE_TTL_MS) {
    return { ok: true, cookie: cached.cookie, source: cached.source };
  }

  const manual = loadManualCookiesMap();
  let cookie = String(manual.map[key] || '').trim();
  let source = cookie ? `manual:${manual.source}` : '';

  if (!cookie) {
    cookie = await fetchCookieFromAnalyst(key, options.signal);
    if (cookie) source = 'analyst-api';
  }

  if (!cookie) {
    return { ok: false, error: 'cookie_not_found', shopKey: key };
  }

  cookieCache.set(key, { at: Date.now(), cookie, source });
  return { ok: true, cookie, source, shopKey: key };
}



module.exports = {

  SHOP_ROWS,

  resolveShopKeyFromTitle,

  resolveShopTitleFromKey,

  getShopCookie,

  invalidateShopCookie,

  loadManualCookiesMap,

  parseManualCookiesFile,

};


