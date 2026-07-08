/**
 * 千帆 DevTools 自动注入守护：千帆调试模式启动后，自动向页面注入顺丰月结扣费内嵌脚本
 */
const fs = require('fs');
const path = require('path');
const { resolveDevtoolsFromQianfanBot } = require('./read-qianfan-debug-config');
const { buildInjectSource, isQianfanPageUrl } = require('./build-inject-source');
const { connectCdp } = require('./cdp-connect');
const { startPackageProxy, DEFAULT_PORT: PACKAGE_PROXY_PORT } = require('./qianfan-package-proxy');
const { injectPage, VERSION_PROBE_EXPR } = require('./inject-page');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const INLINE_SCRIPT_PATH = path.join(ROOT, 'inject', 'qf-sf-fee-inline.js');
const LOCK_PATH = path.join(ROOT, '.inject-daemon.lock');
const LOG_PREFIX = '[顺丰运费注入]';

function log(msg) {
  const line = `${new Date().toLocaleString('zh-CN', { hour12: false })} ${LOG_PREFIX} ${msg}`;
  console.log(line);
}

function acquireSingleInstance() {
  if (fs.existsSync(LOCK_PATH)) {
    try {
      const oldPid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
      if (oldPid > 0) {
        try {
          process.kill(oldPid, 0);
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
    packageProxyPort: Number(fileCfg.packageProxyPort || process.env.QF_PACKAGE_PROXY_PORT || PACKAGE_PROXY_PORT),
    sf: {
      partnerID: String(fileCfg.sf?.partnerID || '').trim(),
      checkWord: String(fileCfg.sf?.checkWord || '').trim(),
      checkWordSandbox: String(fileCfg.sf?.checkWordSandbox || '').trim(),
      phoneLast4: String(fileCfg.sf?.phoneLast4 || '').trim(),
      monthlyCard: String(fileCfg.sf?.monthlyCard || '').trim(),
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

async function injectToPage(page, source, prev, panelVersion) {
  let client;
  try {
    client = await connectCdp(page.webSocketDebuggerUrl, 8000);
    try {
      await client.Page.enable();
    } catch {
      /* ignore */
    }
    const result = await injectPage(client, source, {
      softFirst: Boolean(prev?.ok) && prev?.injectedVersion === panelVersion,
      expectedVersion: panelVersion,
      registerOnNewDocument: !prev?.scriptRegistered || prev?.injectedVersion !== panelVersion,
    });
    if (result.mode === 'hard') {
      log(`已注入: ${page.title || page.url}`);
    }
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
  try {
    await startPackageProxy({ port: config.packageProxyPort });
  } catch (err) {
    if (err?.code === 'EADDRINUSE') {
      try {
        const res = await fetch(`http://127.0.0.1:${config.packageProxyPort}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        const body = await res.json().catch(() => ({}));
        if (!body?.features?.fonts) {
          log(`提示: 端口 ${config.packageProxyPort} 为旧版代理，请重启守护进程以启用字体等新特性`);
        }
      } catch {
        log(`订单详情代理端口 ${config.packageProxyPort} 已被占用`);
      }
    } else {
      log(`订单详情代理启动失败: ${err.message || err}`);
    }
  }
  if (!fs.existsSync(INLINE_SCRIPT_PATH)) {
    console.error(`${LOG_PREFIX} 缺少 ${INLINE_SCRIPT_PATH}`);
    process.exit(1);
  }
  const panelJs = fs.readFileSync(INLINE_SCRIPT_PATH, 'utf8');
  let panelVersion = panelJs.match(/const VERSION = '([^']+)'/)?.[1] || '';
  let injectSource = buildInjectSource(panelJs, config.sf, {
    packageProxyPort: config.packageProxyPort,
  });

  log(`守护启动 → DevTools ${config.devtoolsHost}:${config.devtoolsPort}，内嵌 v${panelVersion}`);
  if (config.devtoolsSource) log(`端口来源: ${config.devtoolsSource}`);
  if (!config.sf.partnerID || !config.sf.checkWord) {
    log('提示: config.json 未填 sf.partnerID / checkWord');
  }
  if (!config.sf.sandbox && !config.sf.monthlyCard) {
    log('提示: 生产环境需配置 sf.monthlyCard（顺丰月结卡号），否则清单运费查询会报 8151');
  }

  const injected = new Map();
  let devtoolsUp = false;
  let nextPollMs = config.pollIntervalMs;
  let lastStatusLog = 0;
  let lastPageCount = 0;

  for (;;) {
    let needFastPoll = false;
    try {
      const currentPanelJs = fs.readFileSync(INLINE_SCRIPT_PATH, 'utf8');
      const currentVersion = currentPanelJs.match(/const VERSION = '([^']+)'/)?.[1] || '';
      if (currentVersion && currentVersion !== panelVersion) {
        panelVersion = currentVersion;
        injectSource = buildInjectSource(currentPanelJs, config.sf, {
          packageProxyPort: config.packageProxyPort,
        });
        injected.clear();
        log(`检测到内嵌新版本 v${panelVersion}，将同步注入全部页面`);
      }

      const pages = await fetchPageList(config.devtoolsHost, config.devtoolsPort);
      if (!devtoolsUp) {
        log(`已连接 DevTools ${config.devtoolsHost}:${config.devtoolsPort}，当前 ${pages.length} 个千帆页面`);
        devtoolsUp = true;
      } else if (pages.length !== lastPageCount) {
        log(`千帆页面数变化 ${lastPageCount} → ${pages.length}`);
      }
      lastPageCount = pages.length;

      const alive = new Set(pages.map((p) => p.webSocketDebuggerUrl));
      for (const [ws] of injected) {
        if (!alive.has(ws)) injected.delete(ws);
      }

      for (const page of pages) {
        const ws = page.webSocketDebuggerUrl;
        const prev = injected.get(ws) || { ok: false, fails: 0 };
        const versionCheckDue =
          prev.ok && (!prev.versionCheckedAt || Date.now() - prev.versionCheckedAt > 30000);
        let needInject = !prev.ok;

        if (prev.injectedVersion && prev.injectedVersion !== panelVersion) {
          needInject = true;
        }

        if (!needInject && versionCheckDue) {
          try {
            const client = await connectCdp(ws, 5000);
            const check = await Promise.race([
              client.Runtime.evaluate({
                expression: VERSION_PROBE_EXPR,
                returnByValue: true,
              }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('version check timeout')), 5000)),
            ]);
            const info = check.result?.value || {};
            if (info.version === panelVersion && info.hasInline && !info.hasLegacyPanel) {
              await client.Runtime.evaluate({
                expression: 'window.__qfSfFeeInline?.syncSession?.(); window.__qfSfFeeInline?.rescan?.();',
              });
            }
            await client.close();
            injected.set(ws, { ...prev, versionCheckedAt: Date.now() });
            if (info.version !== panelVersion || !info.hasInline) needInject = true;
            else if (info.hasLegacyPanel) needInject = true;
          } catch {
            injected.set(ws, { ...prev, versionCheckedAt: Date.now() - 25000 });
            needInject = true;
            needFastPoll = true;
          }
        } else if (prev.ok && !needInject) {
          continue;
        }

        if (!needInject) continue;
        needFastPoll = true;

        try {
          await injectToPage(page, injectSource, prev, panelVersion);
          injected.set(ws, {
            ok: true,
            fails: 0,
            lastInjectAt: Date.now(),
            injectedVersion: panelVersion,
            versionCheckedAt: Date.now(),
            title: page.title,
            scriptRegistered: true,
            url: page.url,
          });
          if (prev.injectedVersion && prev.injectedVersion !== panelVersion) {
            log(`已升级 ${page.title || 'page'}: v${prev.injectedVersion || '?'} → v${panelVersion}`);
          } else if (!prev.ok) {
            log(`已注入: ${page.title || page.url}`);
          }
        } catch (err) {
          const fails = (prev.fails || 0) + 1;
          injected.set(ws, {
            at: Date.now(),
            lastInjectAt: Date.now(),
            ok: false,
            fails,
            injectedVersion: prev.injectedVersion || '',
            title: page.title,
            url: page.url,
          });
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

    const injectedOk = [...injected.values()].filter((v) => v.ok).length;
    if (Date.now() - lastStatusLog > 60000) {
      log(
        `状态 · DevTools ${devtoolsUp ? '在线' : '离线'} · 千帆页 ${lastPageCount} · 已注入 ${injectedOk}/${injected.size} · 内嵌 v${panelVersion} · 代理 :${config.packageProxyPort}`,
      );
      lastStatusLog = Date.now();
    }

    nextPollMs = needFastPoll ? 1200 : config.pollIntervalMs;
    await new Promise((r) => setTimeout(r, nextPollMs));
  }
}

main().catch((err) => {
  console.error(`${LOG_PREFIX} 致命错误:`, err);
  process.exit(1);
});
