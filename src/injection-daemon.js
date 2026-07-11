/**
 * CDP injection loop — no lock file, no self-supervision.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveDevtoolsFromQianfanBot } = require('./read-qianfan-debug-config');
const { buildInjectSource, isQianfanPageUrl } = require('./build-inject-source');
const { connectCdp } = require('./cdp-connect');
const {
  injectPage,
  evaluateOrThrow,
  evaluateBestEffort,
  probePage,
  isVerifiedProbe,
  globalScriptRegistry,
  createEmptyProbe,
  probeToRecord,
  TEARDOWN_EXPR,
} = require('./inject-page');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const INLINE_SCRIPT_PATH = path.join(ROOT, 'inject', 'qf-sf-fee-inline.js');
const LOG_PREFIX = '[顺丰运费注入]';

function log(msg) {
  console.log(`${new Date().toLocaleString('zh-CN', { hour12: false })} ${LOG_PREFIX} ${msg}`);
}

function logInjectError(page, err) {
  const title = page?.title || err?.page?.title || 'page';
  const url = page?.url || err?.page?.url || '';
  const line = err?.lineNumber != null ? `:${err.lineNumber}` : '';
  const col = err?.columnNumber != null ? `:${err.columnNumber}` : '';
  log(`注入失败 [${title}] ${url} ${err?.code || ''} ${err?.message || err}${line}${col}`);
}

const VERIFICATION_PROBE_MS = 5000;
const VERIFICATION_TTL_MS = 10000;

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
    pollIntervalMs: Number(fileCfg.pollIntervalMs) || 5000,
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

function readPanelVersion() {
  if (!fs.existsSync(INLINE_SCRIPT_PATH)) return '';
  const panelJs = fs.readFileSync(INLINE_SCRIPT_PATH, 'utf8');
  return panelJs.match(/const VERSION = '([^']+)'/)?.[1] || '';
}

async function probePageLive(page, expectedVersion) {
  let client;
  try {
    client = await connectCdp(page.webSocketDebuggerUrl, 5000);
    const probe = await probePage(client);
    const record = probeToRecord(probe, expectedVersion, {
      title: page.title || '',
      url: page.url || '',
    });
    return record;
  } catch (err) {
    return {
      ...createEmptyProbe(expectedVersion),
      title: page.title || '',
      url: page.url || '',
      error: err.message || String(err),
      errorCode: err.code || 'probe_error',
      fails: 1,
    };
  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
  }
}

async function injectToPage(page, source, prev, panelVersion) {
  const ws = page.webSocketDebuggerUrl;
  let client;
  try {
    client = await connectCdp(ws, 8000);
    try {
      await client.Page.enable();
    } catch {
      /* ignore */
    }
    const result = await injectPage(client, source, {
      softFirst: Boolean(prev?.ok) && prev?.actualVersion === panelVersion,
      expectedVersion: panelVersion,
      registerOnNewDocument: !prev?.scriptRegistered || prev?.actualVersion !== panelVersion,
      ws,
      pageTitle: page.title || '',
      pageUrl: page.url || '',
    });
    const probe = await probePage(client);
    if (!isVerifiedProbe(probe, panelVersion)) {
      const error = new Error(`injection_verify_failed after ${result.mode}`);
      error.code = 'injection_verify_failed';
      error.probe = probe;
      throw error;
    }
    return {
      ...probeToRecord(probe, panelVersion, {
        title: page.title || '',
        url: page.url || '',
        lastInjectAt: Date.now(),
        fails: 0,
        scriptRegistered: Boolean(result.scriptIdentifier),
        scriptIdentifier: result.scriptIdentifier || prev?.scriptIdentifier || '',
        injectMode: result.mode,
      }),
    };
  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
  }
}

function buildDevtoolsStatus(pages, injectedMap, panelVersion) {
  const now = Date.now();
  const pageRecords = pages.map((page) => {
    const entry = injectedMap.get(page.webSocketDebuggerUrl);
    const base = entry ? { ...entry } : {
      ...createEmptyProbe(panelVersion),
      title: page.title || '',
      url: page.url || '',
    };
    const lastVerifiedAt = Number(base.lastVerifiedAt || 0);
    const verificationAgeMs = lastVerifiedAt > 0 ? now - lastVerifiedAt : null;
    const verificationFresh = Boolean(
      base.verified
      && base.actualVersion === panelVersion
      && lastVerifiedAt > 0
      && verificationAgeMs <= VERIFICATION_TTL_MS,
    );
    return {
      ...base,
      lastVerifiedAt: lastVerifiedAt || null,
      verificationAgeMs,
      verificationFresh,
    };
  });
  const verified = pageRecords.filter((p) => p.verificationFresh);
  const versions = verified.map((p) => p.actualVersion);
  return {
    connected: true,
    pageCount: pages.length,
    injectedCount: verified.length,
    expectedVersion: panelVersion,
    versions,
    pages: pageRecords,
  };
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
      let timer = null;
      let onAbort = null;
      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
          onAbort = null;
        }
      };
      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      if (signal) {
        onAbort = () => {
          cleanup();
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
        globalScriptRegistry.byWs.clear();
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
      globalScriptRegistry.pruneAlive(alive);
      for (const [ws] of injected) {
        if (!alive.has(ws)) injected.delete(ws);
      }

      for (const page of pages) {
        const ws = page.webSocketDebuggerUrl;
        const prev = injected.get(ws) || createEmptyProbe(panelVersion);
        let needInject = !prev.verified || prev.actualVersion !== panelVersion;

        if (!needInject && prev.verified) {
          const due = !prev.lastVerifiedAt || Date.now() - prev.lastVerifiedAt > VERIFICATION_PROBE_MS;
          if (due) {
            const live = await probePageLive(page, panelVersion);
            prev.lastVerifiedAt = Date.now();
            if (!live.verified) {
              needInject = true;
              injected.set(ws, { ...live, fails: (prev.fails || 0) + 1, lastVerifiedAt: Date.now() });
            } else {
              injected.set(ws, { ...prev, ...live, fails: 0, lastVerifiedAt: Date.now() });
            }
          }
          if (!needInject) continue;
        }

        needFastPoll = true;
        try {
          const record = await injectToPage(page, injectSource, prev, panelVersion);
          injected.set(ws, record);
          if (!prev.verified) log(`已注入: ${page.title || page.url} v${record.actualVersion}`);
        } catch (err) {
          const fails = (prev.fails || 0) + 1;
          const failRecord = {
            ...createEmptyProbe(panelVersion),
            title: page.title || '',
            url: page.url || '',
            fails,
            lastInjectAt: Date.now(),
            error: err.message || String(err),
            errorCode: err.code || 'inject_error',
            probe: err.probe || null,
          };
          injected.set(ws, failRecord);
          if (fails <= 3) logInjectError(page, err);
        }
      }

      const status = buildDevtoolsStatus(pages, injected, panelVersion);
      onStatus(status);

      if (Date.now() - lastStatusLog > 60000) {
        log(`状态 · DevTools 在线 · 千帆页 ${status.pageCount} · 已验证 ${status.injectedCount}/${status.pageCount} · v${panelVersion}`);
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
        pages: [],
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

module.exports = {
  startInjectionDaemon,
  loadInjectConfig,
  INLINE_SCRIPT_PATH,
  readPanelVersion,
  probePageLive,
  buildDevtoolsStatus,
  injectToPage,
};
