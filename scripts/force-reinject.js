#!/usr/bin/env node
/** 强制向所有千帆页面重新注入最新内嵌脚本 */
const fs = require('fs');
const path = require('path');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { buildInjectSource, isQianfanPageUrl } = require('../src/build-inject-source');
const { connectCdp } = require('../src/cdp-connect');
const { injectPage, TEARDOWN_EXPR, clearRegisteredPageScripts } = require('../src/inject-page');

const ROOT = path.resolve(__dirname, '..');
const panelJs = fs.readFileSync(path.join(ROOT, 'inject', 'qf-sf-fee-inline.js'), 'utf8');
const panelVersion = panelJs.match(/const VERSION = '([^']+)'/)?.[1] || '';
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
} catch {
  /* ignore */
}

const sfCfg = {
  partnerID: String(cfg.sf?.partnerID || '').trim(),
  checkWord: String(cfg.sf?.checkWord || '').trim(),
  checkWordSandbox: String(cfg.sf?.checkWordSandbox || '').trim(),
  phoneLast4: String(cfg.sf?.phoneLast4 || '').trim(),
  monthlyCard: String(cfg.sf?.monthlyCard || '').trim(),
  sandbox: Boolean(cfg.sf?.sandbox),
  packageProxyPort: Number(cfg.packageProxyPort || 4725),
};

const source = buildInjectSource(panelJs, sfCfg, {
  packageProxyPort: sfCfg.packageProxyPort,
});

const WRITE_CFG_EXPR = `(function(){
  var cfg = ${JSON.stringify({
    partnerID: sfCfg.partnerID,
    checkWord: sfCfg.checkWord,
    checkWordSandbox: sfCfg.checkWordSandbox,
    phoneLast4: sfCfg.phoneLast4,
    monthlyCard: sfCfg.monthlyCard,
    sandbox: sfCfg.sandbox,
  })};
  try {
    localStorage.setItem('qf_sf_fee_config_v1', JSON.stringify(cfg));
    localStorage.removeItem('qf_sf_fee_buyer_cache_v1');
    sessionStorage.removeItem('qsf_fee_cache_ver');
  } catch (e) {}
  return cfg;
})()`;

async function inject(page) {
  const client = await connectCdp(page.webSocketDebuggerUrl, 8000);
  try {
    try {
      await client.Page.enable();
    } catch {
      /* ignore */
    }
    await clearRegisteredPageScripts(client);
    await client.Runtime.evaluate({ expression: TEARDOWN_EXPR, returnByValue: true, awaitPromise: true });
    await client.Runtime.evaluate({ expression: WRITE_CFG_EXPR, returnByValue: true });
    await injectPage(client, source, {
      softFirst: false,
      expectedVersion: panelVersion,
      registerOnNewDocument: true,
    });
    await client.Runtime.evaluate({ expression: WRITE_CFG_EXPR, returnByValue: true });
    const v = await client.Runtime.evaluate({
      expression: `({
      v: window.__qfSfFeeInline?.version,
      mode: window.__qfSfFeeInline ? 'inline' : 'none',
      hasLegacyPanel: !!document.getElementById('qf-sf-fee-panel-root'),
      inlineRows: document.querySelectorAll('.qsf-inline-fee-row').length
    })`,
      returnByValue: true,
    });
    console.log(page.title, v.result?.value);
  } finally {
    await client.close();
  }
}

const { startPackageProxy } = require('../src/qianfan-package-proxy');

async function ensurePackageProxy(port) {
  let ready = false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      ready = Boolean(body?.features?.fonts);
    }
  } catch {
    /* not running or old proxy */
  }
  if (ready) return;

  try {
    const conn = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) }).catch(() => null);
    if (conn?.ok) {
      console.warn(`[顺丰运费] 代理 ${port} 为旧版本(无字体路由)，请重启 npm start 或结束占用 ${port} 的进程后重试`);
    }
  } catch { /* ignore */ }

  try {
    await startPackageProxy({ port });
    console.log(`[顺丰运费] 订单详情代理已启动 http://127.0.0.1:${port}/package-detail`);
  } catch (err) {
    if (String(err.message || err).includes('EADDRINUSE')) {
      console.warn(`[顺丰运费] 端口 ${port} 已被旧代理占用，字体/新特性可能不可用`);
      return;
    }
    console.warn(`[顺丰运费] 订单详情代理未启动(${port}): ${err.message || err}`);
  }
}

(async () => {
  await ensurePackageProxy(sfCfg.packageProxyPort);
  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(cfg.devtoolsHost || bot?.host || '127.0.0.1').trim();
  const port = Number(cfg.devtoolsPort || bot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9322);
  const list = await (await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const pages = list.filter(
    (p) => p.type === 'page' && p.webSocketDebuggerUrl && isQianfanPageUrl(p.url),
  );
  for (const p of pages) {
    try {
      await inject(p);
    } catch (e) {
      console.log(p.title, 'fail:', e.message);
    }
  }
  console.log('done', pages.length, 'pages');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
