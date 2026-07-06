/**
 * 千帆 DevTools 自动注入守护：千帆调试模式启动后，自动向页面注入顺丰运费侧栏
 */
const fs = require('fs');
const path = require('path');
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('./read-qianfan-debug-config');
const { loadLauncherIconDataUrl } = require('./load-launcher-icon');
const { buildInjectSource, isQianfanPageUrl } = require('./build-inject-source');
const { connectCdp } = require('./cdp-connect');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const PANEL_SCRIPT_PATH = path.join(ROOT, 'inject', 'qf-sf-fee-panel.js');
const LOCK_PATH = path.join(ROOT, '.inject-daemon.lock');
const LOG_PREFIX = '[顺丰运费注入]';

function log(msg) {
  const line = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${LOG_PREFIX} ${msg}`;
  console.log(line);
}

function acquireSingleInstance() {
  if (fs.existsSync(LOCK_PATH)) {
    try {
      const oldPid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
      if (oldPid > 0) {
        try {
          process.kill(oldPid, 0);
          log(`已有守护进程 PID=${oldPid}，本进程退出`);
          process.exit(0);
        } catch {
          /* stale lock */
        }
      }
    } catch {
      /* ignore */
    }
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid), 'utf8');
  const cleanup = () => {
    try {
      if (fs.existsSync(LOCK_PATH) && fs.readFileSync(LOCK_PATH, 'utf8').trim() === String(process.pid)) {
        fs.unlinkSync(LOCK_PATH);
      }
    } catch {
      /* ignore */
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

function loadConfig() {
  let fileCfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      log(`config.json 解析失败: ${err.message}`);
    }
  }

  const fromBot = resolveDevtoolsFromQianfanBot();
  const host = String(fileCfg.devtoolsHost || fromBot?.host || '127.0.0.1').trim();
  const port = Number(
    fileCfg.devtoolsPort || fromBot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9322,
  );

  return {
    devtoolsHost: host,
    devtoolsPort: port,
    pollIntervalMs: Number(fileCfg.pollIntervalMs) || 2500,
    sf: {
      partnerID: String(fileCfg.sf?.partnerID || '').trim(),
      checkWord: String(fileCfg.sf?.checkWord || '').trim(),
      checkWordSandbox: String(fileCfg.sf?.checkWordSandbox || '').trim(),
      phoneLast4: String(fileCfg.sf?.phoneLast4 || '').trim(),
      sandbox: Boolean(fileCfg.sf?.sandbox),
    },
    devtoolsSource: fromBot?.source || '',
  };
}

async function fetchPageList(host, port) {
  const res = await fetch(`http://${host}:${port}/json/list`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`DevTools HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('DevTools 返回格式异常');
  return list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl && isQianfanPageUrl(t.url));
}

async function injectToPage(page, source, prev) {
  let client;
  try {
    client = await connectCdp(page.webSocketDebuggerUrl, 8000);
    const { Page, Runtime } = client;
    try {
      await Page.enable();
    } catch {
      /* ignore */
    }
    if (!prev?.scriptRegistered) {
      await Page.addScriptToEvaluateOnNewDocument({ source });
    }
    await Runtime.evaluate({ expression: source, returnByValue: true, awaitPromise: true });
    log(`已注入: ${page.title || page.url}`);
    return true;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  }
}

async function main() {
  acquireSingleInstance();
  const config = loadConfig();
  if (!fs.existsSync(PANEL_SCRIPT_PATH)) {
    console.error(`${LOG_PREFIX} 缺少 ${PANEL_SCRIPT_PATH}`);
    process.exit(1);
  }
  const panelJs = fs.readFileSync(PANEL_SCRIPT_PATH, 'utf8');
  const iconDataUrl = loadLauncherIconDataUrl();
  let panelVersion = panelJs.match(/const VERSION = '([^']+)'/)?.[1] || '';
  let injectSource = buildInjectSource(panelJs, config.sf, iconDataUrl);

  log(`守护启动 → DevTools ${config.devtoolsHost}:${config.devtoolsPort}，侧栏 v${panelVersion}`);
  if (config.devtoolsSource) log(`端口来源: ${config.devtoolsSource}`);
  if (!config.sf.partnerID || !config.sf.checkWord) {
    log('提示: config.json 未填 sf.partnerID / checkWord，可在侧栏 ⚙ 配置（仅首次）');
  }

  const injected = new Map();
  let devtoolsUp = false;
  let nextPollMs = config.pollIntervalMs;

  for (;;) {
    let needFastPoll = false;
    try {
      const currentPanelJs = fs.readFileSync(PANEL_SCRIPT_PATH, 'utf8');
      const currentVersion = currentPanelJs.match(/const VERSION = '([^']+)'/)?.[1] || '';
      if (currentVersion && currentVersion !== panelVersion) {
        panelVersion = currentVersion;
        injectSource = buildInjectSource(currentPanelJs, config.sf, iconDataUrl);
        injected.clear();
        log(`检测到侧栏新版本 v${panelVersion}，将重新注入所有页面`);
      }

      const pages = await fetchPageList(config.devtoolsHost, config.devtoolsPort);
      if (!devtoolsUp) {
        log(`已连接 DevTools，当前 ${pages.length} 个千帆页面`);
        devtoolsUp = true;
      }

      const alive = new Set(pages.map((p) => p.webSocketDebuggerUrl));
      for (const [ws] of injected) {
        if (!alive.has(ws)) injected.delete(ws);
      }

      for (const page of pages) {
        const ws = page.webSocketDebuggerUrl;
        const prev = injected.get(ws) || { ok: false, fails: 0 };
        let needInject = !prev.ok;

        const versionCheckDue =
          prev.ok && (!prev.versionCheckedAt || Date.now() - prev.versionCheckedAt > 30000);

        if (versionCheckDue) {
          try {
            const client = await connectCdp(ws, 5000);
            const check = await Promise.race([
              client.Runtime.evaluate({
                expression: `(function(){
                var p = document.getElementById('qf-sf-fee-panel-root');
                return {
                  version: window.__qfSfFeePanel && window.__qfSfFeePanel.version,
                  hasPanel: !!p
                };
              })()`,
                returnByValue: true,
              }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('version check timeout')), 5000)),
            ]);
            await client.close();
            const info = check.result?.value || {};
            injected.set(ws, { ...prev, versionCheckedAt: Date.now() });
            if (info.version !== panelVersion) needInject = true;
            else if (!info.hasPanel) needInject = true;
            else continue;
          } catch {
            needInject = true;
          }
        } else if (prev.ok) {
          continue;
        }

        if (!needInject) continue;
        needFastPoll = true;

        try {
          await injectToPage(page, injectSource, prev);
          injected.set(ws, { ok: true, fails: 0, title: page.title, scriptRegistered: true, url: page.url });
        } catch (err) {
          const fails = (prev.fails || 0) + 1;
          injected.set(ws, { at: Date.now(), ok: false, fails, title: page.title, url: page.url });
          needFastPoll = true;
          if (fails <= 2) log(`注入失败 (${page.title || 'page'}): ${err.message || err}`);
        }
      }
    } catch (err) {
      if (devtoolsUp) {
        log(`DevTools 离线，等待千帆启动… (${err.message || err})`);
        devtoolsUp = false;
        injected.clear();
      }
      needFastPoll = true;
    }

    nextPollMs = needFastPoll ? 800 : config.pollIntervalMs;
    await new Promise((r) => setTimeout(r, nextPollMs));
  }
}

main().catch((err) => {
  console.error(`${LOG_PREFIX} 致命错误:`, err);
  process.exit(1);
});
