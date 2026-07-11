#!/usr/bin/env node
/**
 * Unified Node Runtime — single process: Data Core HTTP + CDP inject + fee web.
 */
const path = require('path');
const nodeHttp = require('http');
const { createDataCore } = require('./core/data-core');
const { createDataCoreHttpServer } = require('./core/http-server');
const { createRuntimeState, VERSION } = require('./core/runtime-state');
const { startInjectionDaemon, loadInjectConfig } = require('./injection-daemon');
const { createServer: createFeeWebServer } = require('../shunfengchafeiyong/server');
const { loadConfig } = require('./load-config');

const ROOT = path.resolve(__dirname, '..');

function log(msg) {
  console.log(`[qf-runtime] ${new Date().toLocaleString('zh-CN', { hour12: false })} ${msg}`);
}

async function main() {
  const injectCfg = loadInjectConfig();
  const webCfg = loadConfig();
  const runtimeState = createRuntimeState();
  const abort = new AbortController();

  const dataCore = createDataCore({
    root: ROOT,
    sf: injectCfg.sf,
  });

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

  const feeServer = createFeeWebServer({ dataCore });
  const feePort = webCfg.webPort;
  let webReady = false;
  let webOwned = false;

  function probeFeeWeb() {
    return new Promise((resolve) => {
      const req = nodeHttp.get(`http://127.0.0.1:${feePort}${webCfg.basePath}/api/status`, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });
      req.on('error', () => resolve(false));
    });
  }

  if (await probeFeeWeb()) {
    webReady = true;
    log(`查询 Web 端口 ${feePort} 已有服务在运行，复用`);
  } else {
    try {
      await new Promise((resolve, reject) => {
        feeServer.once('error', reject);
        feeServer.listen(feePort, '0.0.0.0', () => {
          webOwned = true;
          webReady = true;
          log(`顺丰批量 Web http://127.0.0.1:${feePort}${webCfg.basePath}/`);
          resolve();
        });
      });
    } catch (err) {
      if (err.code === 'EADDRINUSE' && await probeFeeWeb()) {
        webReady = true;
        log(`查询 Web 端口 ${feePort} 已被占用但探测正常，复用`);
      } else {
        console.error(`[qf-runtime] 查询 Web 启动失败: ${err.message || err}`);
        await coreHttp.close();
        dataCore.close();
        process.exit(1);
      }
    }
  }
  runtimeState.setFlags({ webReady });

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

  log(`Runtime v${VERSION} 已就绪 · Data Core :${httpStarted.port}`);

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
      if (!webOwned) {
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
