const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { VERSION, SERVICE } = require('./runtime-state');
const {
  resolveShopKeyFromTitle,
  resolveShopTitleFromKey,
  loadManualCookiesMap,
} = require('../qianfan-shop-cookies');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const FONT_FILES = {
  '/fonts/HarmonyOS_SansSC_Regular.ttf': 'HarmonyOS_SansSC_Regular.ttf',
  '/fonts/HarmonyOS_SansSC_Medium.ttf': 'HarmonyOS_SansSC_Medium.ttf',
};

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  const cors = resolveCorsOrigin(req);
  if (cors) headers['Access-Control-Allow-Origin'] = cors;
  res.writeHead(status, headers);
  res.end(text);
}

function readBody(req, limit = 1024 * 256) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendFont(req, res, fileName) {
  const filePath = path.join(FONT_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    sendJson(req, res, 404, { ok: false, error: 'font_not_found' });
    return;
  }
  const headers = {
    'Content-Type': 'font/ttf',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=604800',
  };
  const cors = resolveCorsOrigin(req);
  if (cors) headers['Access-Control-Allow-Origin'] = cors;
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

async function probeExistingService(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { kind: 'foreign' };
    const body = await res.json();
    if (body?.service === SERVICE && body?.version === VERSION) {
      return { kind: 'same', body };
    }
    return { kind: 'foreign', body };
  } catch {
    return { kind: 'down' };
  }
}

function createDataCoreHttpServer(options = {}) {
  const port = Number(options.port || 4725);
  const dataCore = options.dataCore;
  const runtimeState = options.runtimeState;
  const host = '127.0.0.1';

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        sendJson(req, res, 204, {});
        return;
      }

      const u = new URL(req.url || '/', `http://${host}:${port}`);

      if (req.method === 'GET' && u.pathname === '/health') {
        const health = runtimeState.buildHealth(dataCore.metrics.snapshot());
        sendJson(req, res, health.ok ? 200 : 503, health);
        return;
      }

      if (req.method === 'GET' && u.pathname === '/v1/metrics') {
        sendJson(req, res, 200, { ok: true, metrics: dataCore.metrics.snapshot() });
        return;
      }

      if (req.method === 'POST' && u.pathname === '/v1/cards/batch') {
        const raw = await readBody(req);
        let body = {};
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          sendJson(req, res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        const result = await dataCore.batchCards(body);
        sendJson(req, res, result.ok === false ? result.status || 400 : 200, result);
        return;
      }

      if (req.method === 'GET' && u.pathname === '/package-detail') {
        const shopKey = String(u.searchParams.get('shopKey') || u.searchParams.get('shop_key') || '').trim()
          || resolveShopKeyFromTitle(u.searchParams.get('shopTitle') || u.searchParams.get('title') || '');
        const packageId = String(u.searchParams.get('packageId') || u.searchParams.get('package_id') || '').trim();
        if (!shopKey || !packageId) {
          sendJson(req, res, 400, { ok: false, error: 'missing shopKey or packageId' });
          return;
        }
        try {
          const result = await dataCore.fetchPackage(shopKey, packageId);
          sendJson(req, res, 200, {
            ok: true,
            shopKey,
            shopTitle: resolveShopTitleFromKey(shopKey),
            packageId,
            data: result.data,
            state: result.state,
            source: result.source,
          });
        } catch (err) {
          sendJson(req, res, err.code === 'auth_error' ? 401 : 502, {
            ok: false,
            error: err.message,
            errorCode: err.code,
          });
        }
        return;
      }

      if (req.method === 'GET' && u.pathname === '/after-sale') {
        const shopKey = String(u.searchParams.get('shopKey') || '').trim()
          || resolveShopKeyFromTitle(u.searchParams.get('shopTitle') || '');
        const returnsId = String(u.searchParams.get('returnsId') || u.searchParams.get('returns_id') || '').trim();
        const packageId = String(u.searchParams.get('packageId') || '').trim();
        if (!shopKey || !returnsId) {
          sendJson(req, res, 400, { ok: false, error: 'missing shopKey or returnsId' });
          return;
        }
        try {
          const result = await dataCore.fetchAfterSale(shopKey, returnsId, packageId);
          sendJson(req, res, 200, {
            ok: true,
            shopKey,
            returnsId,
            packageId,
            data: result.data,
            state: result.state,
            source: result.source,
          });
        } catch (err) {
          sendJson(req, res, err.code === 'auth_error' ? 401 : 502, {
            ok: false,
            error: err.message,
            errorCode: err.code,
          });
        }
        return;
      }

      if (req.method === 'GET' && u.pathname === '/v1/sf-fee') {
        const waybill = String(u.searchParams.get('waybill') || '').trim();
        if (!waybill) {
          sendJson(req, res, 400, { ok: false, error: 'missing waybill' });
          return;
        }
        try {
          const force = ['1', 'true', 'yes'].includes(String(u.searchParams.get('force') || '').toLowerCase());
          const result = await dataCore.fetchSfFee(waybill, force);
          sendJson(req, res, 200, { ok: true, ...result.data, state: result.state, source: result.source });
        } catch (err) {
          sendJson(req, res, 502, { ok: false, error: err.message, errorCode: err.code });
        }
        return;
      }

      if (req.method === 'POST' && u.pathname === '/v1/sf-fees/batch') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const waybills = [...new Set((body.waybills || []).map((w) => String(w || '').trim()).filter(Boolean))];
        const items = {};
        await Promise.all(waybills.map(async (w) => {
          try {
            const r = await dataCore.fetchSfFee(w);
            items[w] = { ...r.data, state: r.state, source: r.source };
          } catch (e) {
            items[w] = { ok: false, error: e.message, errorCode: e.code };
          }
        }));
        sendJson(req, res, 200, { ok: true, items, metrics: dataCore.metrics.snapshot() });
        return;
      }

      if (req.method === 'POST' && u.pathname === '/v1/cache/invalidate') {
        const remote = String(req.socket.remoteAddress || '');
        if (!remote.endsWith('127.0.0.1') && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
          sendJson(req, res, 403, { ok: false, error: 'local_only' });
          return;
        }
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        sendJson(req, res, 200, dataCore.invalidate(body.key || body.pattern || 'all'));
        return;
      }

      const fontFile = FONT_FILES[u.pathname];
      if (req.method === 'GET' && fontFile) {
        sendFont(req, res, fontFile);
        return;
      }

      sendJson(req, res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      sendJson(req, res, 500, { ok: false, error: String(err.message || err) });
    }
  });

  async function start() {
    const existing = await probeExistingService(port);
    if (existing.kind === 'same') {
      const err = new Error('already_running');
      err.code = 'ALREADY_RUNNING';
      err.health = existing.body;
      throw err;
    }
    if (existing.kind === 'foreign') {
      const err = new Error(`port ${port} occupied by foreign service`);
      err.code = 'EADDRINUSE';
      throw err;
    }

    return new Promise((resolve, reject) => {
      server.on('error', reject);
      server.listen(port, host, () => {
        const manual = loadManualCookiesMap();
        runtimeState.setFlags({
          coreReady: true,
          packageApiReady: true,
          afterSaleReady: true,
          sfConfigured: dataCore.sfConfigReady(),
        });
        console.log(`[qf-sf-data-core] http://${host}:${port} v${VERSION} shops=${Object.keys(manual.map || {}).length}`);
        resolve({ server, port, host });
      });
    });
  }

  function close() {
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  return { server, start, close, port };
}

module.exports = { createDataCoreHttpServer, probeExistingService, VERSION, SERVICE };
