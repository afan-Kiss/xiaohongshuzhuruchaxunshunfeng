#!/usr/bin/env node
/**
 * Unified Node Runtime — single process: Data Core HTTP + CDP inject + fee web.
 */
const path = require('path');
const nodeHttp = require('http');
const { createDataCore } = require('./core/data-core');
const { createDataCoreHttpServer } = require('./core/http-server');
const { createRuntimeState, VERSION } = require('./core/runtime-state');
const { validateWebStatus } = require('./core/web-identity');
const { startInjectionDaemon, loadInjectConfig } = require('./injection-daemon');
const { createServer: createFeeWebServer } = require('../shunfengchafeiyong/server');
const { loadConfig } = require('./load-config');

const ROOT = path.resolve(__dirname, '..');

function log(msg) {
  console.log(`[qf-runtime] ${new Date().toLocaleString('zh-CN', { hour12: false })} ${msg}`);
}

function probeFeeWebStatus(feePort, basePath) {
  return new Promise((resolve) => {
    const req = nodeHttp.get(`http://127.0.0.1:${feePort}${basePath}/api/status`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body || '{}');
        } catch {
          json = null;
        }
        resolve({ statusCode: res.statusCode, body: json, raw: body });
      });
    });
    req.on('error', () => resolve({ statusCode: 0, body: null, raw: '' }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ statusCode: 0, body: null, raw: '' });
    });
  });
}

async function main() {
  const injectCfg = loadInjectConfig();
  const webCfg = loadConfig();
  const runtimeState = createRuntimeState();
  const abort = new AbortController();

  const dataCore = createDataCore({
    root: ROOT,
    sf: injectCfg.sf,
    onSfQueryResult: (r) => runtimeState.setSfQueryResult(r),
  });

  const sfConfigured = Boolean(
    injectCfg.sf?.partnerID
    && (injectCfg.sf?.checkWord || injectCfg.sf?.checkWordSandbox)
    && (injectCfg.sf?.sandbox || injectCfg.sf?.monthlyCard),
  );
  runtimeState.setFlags({ sfConfigured });

  const coreHttp = createDataCoreHttpServer({
    port: injectCfg.packageProxyPort,
    dataCore,
    runtimeState,
  });

  let httpStarted;
  try {
    httpStarted = await coreHttp.start();
  } catch (err) {
    if (err.code === 'ALREADY_RUNNING') {
      log(`同版本 Data Core 已在运行 (v${VERSION}) instance=${err.health?.instanceId || '?'}`);
      console.log(JSON.stringify({ alreadyRunning: true, health: err.health || null }));
      process.exit(2);
    }
    console.error(`[qf-runtime] Data Core 启动失败: ${err.message || err}`);
    process.exit(1);
  }

  runtimeState.setFlags({ processAlive: true, coreReady: true });

  const feePort = webCfg.webPort;
  const basePath = webCfg.basePath;
  let webReady = false;
  let webOwned = false;
  let webConflict = null;
  let feeServer = null;

  const existing = await probeFeeWebStatus(feePort, basePath);
  if (existing.statusCode >= 200 && existing.statusCode < 300 && existing.body) {
    const valid = validateWebStatus(existing.body, {
      version: VERSION,
      dataCoreVersion: VERSION,
      runtimeInstanceId: runtimeState.instanceId,
    });
    if (valid.ok) {
      webReady = true;
      log(`查询 Web 端口 ${feePort} 已有合法服务，复用`);
    } else {
      webConflict = valid;
      log(`查询 Web 端口 ${feePort} 被占用: ${valid.reason} (service=${existing.body.service || '?'} version=${existing.body.version || '?'})`);
    }
  }

  if (!webReady && !webConflict) {
    feeServer = createFeeWebServer({
      dataCore,
      runtimeInstanceId: runtimeState.instanceId,
      dataCoreVersion: VERSION,
    });
    try {
      await new Promise((resolve, reject) => {
        feeServer.once('error', reject);
        feeServer.listen(feePort, '0.0.0.0', () => {
          webOwned = true;
          webReady = true;
          log(`顺丰批量 Web http://127.0.0.1:${feePort}${basePath}/`);
          resolve();
        });
      });
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        const again = await probeFeeWebStatus(feePort, basePath);
        const valid = again.body && validateWebStatus(again.body, {
          version: VERSION,
          dataCoreVersion: VERSION,
          runtimeInstanceId: runtimeState.instanceId,
        });
        if (valid?.ok) {
          webReady = true;
          log(`查询 Web 端口 ${feePort} 启动冲突但探测合法，复用`);
        } else {
          webConflict = valid || { ok: false, reason: 'web_port_conflict' };
          log(`查询 Web 端口 ${feePort} 被占用且身份不合法: ${webConflict.reason || 'unknown'}`);
        }
      } else {
        console.error(`[qf-runtime] 查询 Web 启动失败: ${err.message || err}`);
      }
    }
  }

  runtimeState.setFlags({
    webReady,
    webPortConflict: Boolean(webConflict),
  });

  const injectPromise = startInjectionDaemon({
    config: injectCfg,
    signal: abort.signal,
    onStatus: (st) => runtimeState.setDevtools(st),
  }).catch((err) => {
    if (err.message !== 'aborted') {
      console.error('[qf-runtime] 注入守护异常:', err);
      shutdown(1);
    }
  });

  log(`Runtime v${VERSION} 已就绪 · Data Core :${httpStarted.port}${webReady ? '' : ' · Web 降级'}`);

  let shuttingDown = false;
  async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('正在关闭 Runtime…');
    abort.abort();
    try {
      await coreHttp.close();
    } catch {
      /* ignore */
    }
    await new Promise((resolve) => {
      if (!webOwned || !feeServer) {
        resolve();
        return;
      }
      try {
        feeServer.close(() => resolve());
      } catch {
        resolve();
      }
    });
    dataCore.close();
    setTimeout(() => process.exit(code), 200);
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  await injectPromise;
  await shutdown(0);
}

main().catch((err) => {
  console.error('[qf-runtime] 致命错误:', err);
  process.exit(1);
});
