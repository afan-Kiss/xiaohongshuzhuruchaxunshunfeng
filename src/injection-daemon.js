/**
 * CDP injection loop — no lock file, no self-supervision.
 */
const fs = require('fs');
const path = require('path');
const { resolveDevtoolsFromQianfanBot } = require('./read-qianfan-debug-config');
const { buildInjectSource, isQianfanPageUrl } = require('./build-inject-source');
const { connectCdp } = require('./cdp-connect');
const { injectPage, VERSION_PROBE_EXPR } = require('./inject-page');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const INLINE_SCRIPT_PATH = path.join(ROOT, 'inject', 'qf-sf-fee-inline.js');
const LOG_PREFIX = '[顺丰运费注入]';

function log(msg) {
  console.log(`${new Date().toLocaleString('zh-CN', { hour12: false })} ${LOG_PREFIX} ${msg}`);
}

function loadInjectConfig() {
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
  const port = Number(fileCfg.devtoolsPort || fromBot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9322);
  return {
    devtoolsHost: host,
    devtoolsPort: port,
    pollIntervalMs: Number(fileCfg.pollIntervalMs) || 2500,
    packageProxyPort: Number(fileCfg.packageProxyPort || process.env.QF_PACKAGE_PROXY_PORT || 4725),
    sf: fileCfg.sf || {},
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

async function injectToPage(page, source, prev, panelVersion) {
  let client;
  try {
    client = await connectCdp(page.webSocketDebuggerUrl, 8000);
    try {
      await client.Page.enable();
    } catch {
      /* ignore */
    }
    await injectPage(client, source, {
      softFirst: Boolean(prev?.ok) && prev?.injectedVersion === panelVersion,
      expectedVersion: panelVersion,
      registerOnNewDocument: !prev?.scriptRegistered || prev?.injectedVersion !== panelVersion,
    });
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

function readPanelVersion() {
  if (!fs.existsSync(INLINE_SCRIPT_PATH)) return '';
  const panelJs = fs.readFileSync(INLINE_SCRIPT_PATH, 'utf8');
  return panelJs.match(/const VERSION = '([^']+)'/)?.[1] || '';
}

async function startInjectionDaemon(options = {}) {
  const config = options.config || loadInjectConfig();
  const signal = options.signal;
  const onStatus = options.onStatus || (() => {});

  if (!fs.existsSync(INLINE_SCRIPT_PATH)) {
    throw new Error(`缺少内嵌脚本 ${INLINE_SCRIPT_PATH}`);
  }

  let panelVersion = readPanelVersion();
  let injectSource = buildInjectSource(
    fs.readFileSync(INLINE_SCRIPT_PATH, 'utf8'),
    config.sf,
    { packageProxyPort: config.packageProxyPort },
  );

  log(`注入守护启动 → DevTools ${config.devtoolsHost}:${config.devtoolsPort} · 内嵌 v${panelVersion}`);
  if (config.devtoolsSource) log(`端口来源: ${config.devtoolsSource}`);

  const injected = new Map();
  let devtoolsUp = false;
  let lastPageCount = 0;
  let lastStatusLog = 0;

  const abortWait = (ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });

  while (!signal?.aborted) {
    let needFastPoll = false;
    try {
      const currentVersion = readPanelVersion();
      if (currentVersion && currentVersion !== panelVersion) {
        panelVersion = currentVersion;
        injectSource = buildInjectSource(
          fs.readFileSync(INLINE_SCRIPT_PATH, 'utf8'),
          config.sf,
          { packageProxyPort: config.packageProxyPort },
        );
        injected.clear();
        log(`检测到内嵌新版本 v${panelVersion}，将同步注入全部页面`);
      }

      const pages = await fetchPageList(config.devtoolsHost, config.devtoolsPort);
      if (!devtoolsUp) {
        log(`已连接 DevTools，当前 ${pages.length} 个千帆页面`);
        devtoolsUp = true;
      } else if (pages.length !== lastPageCount) {
        log(`千帆页面数变化 ${lastPageCount} → ${pages.length}`);
      }
      lastPageCount = pages.length;

      const alive = new Set(pages.map((p) => p.webSocketDebuggerUrl));
      for (const [ws] of injected) {
        if (!alive.has(ws)) injected.delete(ws);
      }

      const versions = [];
      for (const page of pages) {
        const ws = page.webSocketDebuggerUrl;
        const prev = injected.get(ws) || { ok: false, fails: 0 };
        let needInject = !prev.ok || prev.injectedVersion !== panelVersion;

        if (!needInject && prev.ok) {
          versions.push(panelVersion);
          continue;
        }

        needFastPoll = true;
        try {
          await injectToPage(page, injectSource, prev, panelVersion);
          injected.set(ws, {
            ok: true,
            fails: 0,
            lastInjectAt: Date.now(),
            injectedVersion: panelVersion,
            title: page.title,
            url: page.url,
            scriptRegistered: true,
          });
          versions.push(panelVersion);
          if (!prev.ok) log(`已注入: ${page.title || page.url}`);
        } catch (err) {
          const fails = (prev.fails || 0) + 1;
          injected.set(ws, {
            ok: false,
            fails,
            lastInjectAt: Date.now(),
            injectedVersion: prev.injectedVersion || '',
            title: page.title,
            url: page.url,
          });
          if (fails <= 2) log(`注入失败 (${page.title || 'page'}): ${err.message || err}`);
        }
      }

      const injectedOk = [...injected.values()].filter((v) => v.ok).length;
      onStatus({
        connected: true,
        pageCount: pages.length,
        injectedCount: injectedOk,
        expectedVersion: panelVersion,
        versions,
      });

      if (Date.now() - lastStatusLog > 60000) {
        log(`状态 · DevTools 在线 · 千帆页 ${lastPageCount} · 已注入 ${injectedOk}/${injected.size} · v${panelVersion}`);
        lastStatusLog = Date.now();
      }
    } catch (err) {
      if (devtoolsUp) {
        log(`DevTools 离线: ${err.message || err}`);
        devtoolsUp = false;
        injected.clear();
      }
      onStatus({
        connected: false,
        pageCount: 0,
        injectedCount: 0,
        expectedVersion: panelVersion,
        versions: [],
      });
      needFastPoll = true;
    }

    const delay = needFastPoll ? 1200 : config.pollIntervalMs;
    try {
      await abortWait(delay);
    } catch {
      break;
    }
  }

  return { stopped: true };
}

module.exports = { startInjectionDaemon, loadInjectConfig, INLINE_SCRIPT_PATH };
