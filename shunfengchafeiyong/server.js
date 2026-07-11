#!/usr/bin/env node
/**
 * 顺丰月结运费分析 Web — 部署路径 /shunfengchafeiyong
 * 启动: npm run start:fee-web
 */
const http = require('http');
const path = require('path');
const { loadConfig } = require('../src/load-config');
const { querySfWaybillFees } = require('../src/sf-waybill-client');
const { buildWebStatusPayload, WEB_SERVICE } = require('../src/core/web-identity');
const { parseCsv, parsePaste, parseUploadFile } = require('./parse-import');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function feeLog(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] [顺丰查费用] ${msg}`;
  console.log(line);
}

function sendJson(res, status, data) {
  const text = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function mergeRow(meta, fee) {
  const totalFee = fee.ok ? Number(fee.totalFee) : null;
  const paid = meta.paidAmount != null ? Number(meta.paidAmount) : null;
  let lossHint = '';
  if (fee.ok && totalFee != null && paid != null && paid > 0 && totalFee > paid) {
    lossHint = `运费超过实付 ¥${(totalFee - paid).toFixed(2)}`;
  }
  return {
    waybill: fee.waybill || meta.waybill,
    orderId: meta.orderId || '',
    buyerNick: meta.buyerNick || '',
    paidAmount: paid,
    shipTime: meta.shipTime || '',
    remark: meta.remark || '',
    ok: fee.ok,
    totalFee,
    error: fee.error || '',
    apiCode: fee.apiCode || '',
    route: fee.ok ? `${fee.jProvince || ''}${fee.jCity || ''} → ${fee.dProvince || ''}${fee.dCity || ''}`.trim() : '',
    weight: fee.meterageWeightQty ?? fee.realWeightQty ?? null,
    customerAcctCode: fee.customerAcctCode || '',
    fees: fee.fees || [],
    lossHint,
  };
}

async function handleBatchQuery(cfg, body, dataCore) {
  let rows = [];
  if (body.mode === 'csv' && body.text) {
    rows = parseCsv(body.text);
  } else if (body.mode === 'paste' && body.text) {
    rows = parsePaste(body.text);
  } else if (Array.isArray(body.rows)) {
    rows = body.rows.map((r) => ({
      waybill: String(r.waybill || '').trim().toUpperCase(),
      orderId: String(r.orderId || '').trim(),
      buyerNick: String(r.buyerNick || '').trim(),
      paidAmount: r.paidAmount != null ? Number(r.paidAmount) : null,
      shipTime: String(r.shipTime || '').trim(),
      remark: String(r.remark || '').trim(),
    })).filter((r) => r.waybill);
  } else if (Array.isArray(body.waybills)) {
    rows = body.waybills.map((w) => ({
      waybill: String(w).trim().toUpperCase(),
      orderId: '',
      buyerNick: '',
      paidAmount: null,
      shipTime: '',
      remark: '',
    }));
  }
  if (!rows.length) {
    return { ok: false, error: '未识别到顺丰运单号（SF 开头）' };
  }

  const metaByWaybill = new Map(rows.map((r) => [r.waybill, r]));
  let fees;
  if (dataCore) {
    fees = await Promise.all(rows.map(async (r) => {
      try {
        const result = await dataCore.fetchSfFee(r.waybill);
        const d = result.data || {};
        return {
          waybill: r.waybill,
          ok: d.sfFee != null,
          totalFee: d.sfFee,
          error: d.error || '',
          apiCode: d.errorCode || '',
        };
      } catch (e) {
        return { waybill: r.waybill, ok: false, totalFee: null, error: e.message, apiCode: e.code || '' };
      }
    }));
  } else {
    fees = await querySfWaybillFees(rows.map((r) => r.waybill), cfg.sf, {
      concurrency: 6,
      delayMs: 60,
    });
  }
  const results = fees.map((fee) => mergeRow(metaByWaybill.get(fee.waybill) || { waybill: fee.waybill }, fee));

  results.sort((a, b) => {
    const fa = a.ok ? Number(a.totalFee) || 0 : -1;
    const fb = b.ok ? Number(b.totalFee) || 0 : -1;
    return fb - fa;
  });

  const okRows = results.filter((r) => r.ok && r.totalFee != null);
  const totalFee = okRows.reduce((s, r) => s + Number(r.totalFee), 0);
  return {
    ok: true,
    count: results.length,
    successCount: okRows.length,
    failCount: results.length - okRows.length,
    totalFee: Math.round(totalFee * 100) / 100,
    avgFee: okRows.length ? Math.round((totalFee / okRows.length) * 100) / 100 : 0,
    maxFee: okRows.length ? Math.max(...okRows.map((r) => Number(r.totalFee))) : 0,
    rows: results,
  };
}

function serveStatic(req, res, basePath, urlPath) {
  let rel = urlPath.slice(basePath.length) || '/index.html';
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel.replace(/^\//, '')));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const fs = require('fs');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function createServer(options = {}) {
  const { sf, webPort, basePath } = loadConfig();
  const dataCore = options.dataCore || null;
  const legacyMode = Boolean(options.legacyMode);
  const statusPayload = options.dataCore
    ? buildWebStatusPayload({
      version: options.webVersion || '3.0.2',
      dataCoreVersion: options.dataCoreVersion || '3.0.2',
      dataCoreService: 'qf-sf-data-core',
      runtimeInstanceId: options.runtimeInstanceId || '',
    })
    : {
      ok: Boolean(sf.partnerID && (sf.checkWord || sf.checkWordSandbox)),
      service: WEB_SERVICE,
      version: options.webVersion || '2.0.0',
      dataCoreBacked: false,
      legacy: true,
      partnerID: sf.partnerID || '',
      monthlyCard: sf.monthlyCard || '',
      sandbox: sf.sandbox,
      env: sf.sandbox ? 'sandbox' : 'production',
    };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const rawPath = url.pathname || '/';
      const pathname = rawPath.length > 1 && rawPath.endsWith('/')
        ? rawPath.slice(0, -1)
        : rawPath;

      if (pathname === `${basePath}/api/status` && req.method === 'GET') {
        return sendJson(res, 200, statusPayload);
      }

      if (pathname === `${basePath}/api/parse` && req.method === 'POST') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const rows = body.mode === 'csv' ? parseCsv(body.text || '') : parsePaste(body.text || '');
        return sendJson(res, 200, { ok: true, count: rows.length, rows });
      }

      if (pathname === `${basePath}/api/parse-file` && req.method === 'POST') {
        const raw = await readBody(req, 15 * 1024 * 1024);
        const body = JSON.parse(raw || '{}');
        const name = String(body.fileName || body.name || 'upload.xlsx').trim();
        const b64 = String(body.data || body.contentBase64 || '').trim();
        if (!b64) {
          return sendJson(res, 400, { ok: false, error: '未收到文件内容' });
        }
        const buf = Buffer.from(b64, 'base64');
        if (!buf.length) {
          return sendJson(res, 400, { ok: false, error: '文件内容为空' });
        }
        const rows = parseUploadFile(name, buf);
        if (!rows.length) {
          return sendJson(res, 400, {
            ok: false,
            error: '未识别到顺丰运单号（SF 开头）。请确认 Excel/CSV 含「运单号/快递单号/物流单号」列',
          });
        }
        return sendJson(res, 200, { ok: true, count: rows.length, rows, fileName: name });
      }

      if (pathname === `${basePath}/api/batch-query` && req.method === 'POST') {
        const raw = await readBody(req, 30 * 1024 * 1024);
        const body = JSON.parse(raw || '{}');
        const data = await handleBatchQuery({ sf }, body, dataCore);
        if (data.ok) {
          feeLog(`批量查询 ${data.count} 单 · 成功 ${data.successCount} · 失败 ${data.failCount} · 运费合计 ¥${data.totalFee}`);
        } else {
          feeLog(`批量查询失败: ${data.error || 'unknown'}`);
        }
        return sendJson(res, data.ok ? 200 : 400, data);
      }

      if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
        if (pathname.startsWith(`${basePath}/api/`)) {
          return sendJson(res, 404, { ok: false, error: 'not_found' });
        }
        if (rawPath === basePath) {
          res.writeHead(301, { Location: `${basePath}/` });
          return res.end();
        }
        return serveStatic(req, res, basePath, rawPath);
      }

      if (pathname === '/' || pathname === '') {
        res.writeHead(302, { Location: `${basePath}/` });
        return res.end();
      }

      res.writeHead(404);
      res.end('Not Found');
    } catch (err) {
      sendJson(res, 500, { ok: false, error: String(err.message || err) });
    }
  });
}

if (require.main === module) {
  const { sf, webPort, basePath } = loadConfig();
  const server = createServer();
  server.on('error', (err) => {
    feeLog(`Web 启动失败: ${err.message || err}`);
    process.exit(1);
  });
  server.listen(webPort, '0.0.0.0', () => {
    feeLog(`Web 已监听 http://127.0.0.1:${webPort}${basePath}/`);
    feeLog(`顺丰环境 ${sf.sandbox ? '沙箱' : '生产'} · 月结卡 ${sf.monthlyCard || '未配置'} · partner ${sf.partnerID || '未配置'}`);
  });
}

module.exports = { createServer };
