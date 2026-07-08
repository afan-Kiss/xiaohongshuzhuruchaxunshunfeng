/**
 * 本机 HTTP 代理：按 shopKey + packageId 查千帆订单详情
 */
const http = require('http');
const { URL } = require('url');
const {
  resolveShopKeyFromTitle,
  resolveShopTitleFromKey,
  getShopCookie,
  invalidateShopCookie,
} = require('./qianfan-shop-cookies');
const { fetchPackageDetailByCookie } = require('./qianfan-package-api');

const DEFAULT_PORT = 4725;

function resolveCorsOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return 'null';
  try {
    const u = new URL(origin);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return origin;
    if (u.hostname.endsWith('xiaohongshu.com')) return origin;
  } catch {
    /* ignore */
  }
  return '';
}

function sendJson(req, res, status, body) {
  const text = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const cors = resolveCorsOrigin(req);
  if (cors) headers['Access-Control-Allow-Origin'] = cors;
  res.writeHead(status, headers);
  res.end(text);
}

async function handlePackageDetail(query) {
  const packageId = String(query.packageId || query.package_id || '').trim();
  const shopKey = String(query.shopKey || query.shop_key || '').trim()
    || resolveShopKeyFromTitle(query.shopTitle || query.shop_title || query.title || '');
  if (!packageId) return { ok: false, status: 400, error: 'missing packageId' };
  if (!shopKey) return { ok: false, status: 400, error: 'missing shopKey or shopTitle' };

  const cookieRes = await getShopCookie(shopKey);
  if (!cookieRes.ok) {
    return { ok: false, status: 503, error: cookieRes.error, shopKey };
  }

  const detail = await fetchPackageDetailByCookie(packageId, cookieRes.cookie);
  if (!detail.ok) {
    const status = detail.status || 502;
    if (status === 401 || status === 403) {
      invalidateShopCookie(shopKey);
    }
    return {
      ok: false,
      status,
      error: detail.error || 'fetch_failed',
      shopKey,
      shopTitle: resolveShopTitleFromKey(shopKey),
      cookieSource: cookieRes.source,
      via: detail.via,
    };
  }

  return {
    ok: true,
    shopKey,
    shopTitle: resolveShopTitleFromKey(shopKey),
    packageId,
    cookieSource: cookieRes.source,
    via: detail.via,
    data: detail.data,
  };
}

function createPackageProxyServer(options = {}) {
  const port = Number(options.port || process.env.QF_PACKAGE_PROXY_PORT || DEFAULT_PORT);

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        sendJson(req, res, 204, {});
        return;
      }

      const u = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && u.pathname === '/health') {
        const manual = require('./qianfan-shop-cookies').loadManualCookiesMap();
        sendJson(req, res, 200, {
          ok: true,
          shops: Object.keys(manual.map || {}),
          manualSource: manual.source || null,
        });
        return;
      }

      if (req.method === 'GET' && u.pathname === '/package-detail') {
        const result = await handlePackageDetail(Object.fromEntries(u.searchParams.entries()));
        sendJson(req, res, result.ok ? 200 : result.status || 500, result);
        return;
      }

      sendJson(req, res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      sendJson(req, res, 500, { ok: false, error: String(err.message || err) });
    }
  });

  return { server, port };
}

function startPackageProxy(options = {}) {
  const { server, port } = createPackageProxyServer(options);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      console.log(`[顺丰运费] 订单详情代理 http://127.0.0.1:${port}/package-detail`);
      resolve({ server, port });
    });
  });
}

module.exports = {
  DEFAULT_PORT,
  startPackageProxy,
  handlePackageDetail,
};
