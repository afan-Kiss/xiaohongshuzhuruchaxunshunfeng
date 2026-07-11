#!/usr/bin/env node
/** 强制向所有千帆页面重新注入最新内嵌脚本 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { buildInjectSource, isQianfanPageUrl } = require('../src/build-inject-source');
const { connectCdp } = require('../src/cdp-connect');
const {
  injectPage,
  evaluateOrThrow,
  evaluateBestEffort,
  probePage,
  isVerifiedProbe,
  clearRegisteredPageScripts,
  TEARDOWN_EXPR,
} = require('../src/inject-page');
const { readPanelVersion } = require('../src/injection-daemon');

const ROOT = path.resolve(__dirname, '..');
const INLINE_SCRIPT_PATH = path.join(ROOT, 'inject', 'qf-sf-fee-inline.js');
const EXPECTED_SERVICE = 'qf-sf-data-core';

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

function fail(msg, code = 1) {
  console.error(`[force-reinject] ${msg}`);
  process.exitCode = code;
  throw new Error(msg);
}

function ensureInlineSynced() {
  try {
    execSync('node scripts/sync-inline-client.js --check', { cwd: ROOT, stdio: 'pipe' });
  } catch {
    fail('内嵌客户端未同步，请执行 npm run build:inline');
  }
}

function ensureSyntax() {
  try {
    execSync(`node --check "${INLINE_SCRIPT_PATH}"`, { cwd: ROOT, stdio: 'pipe' });
  } catch (err) {
    fail(`注入脚本语法错误: ${err.stderr?.toString() || err.message}`);
  }
}

async function ensureDataCore(panelVersion) {
  const port = sfCfg.packageProxyPort;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) fail(`Data Core /health HTTP ${res.status}`);
    const body = await res.json();
    if (body.service !== EXPECTED_SERVICE) {
      fail(`Data Core service=${body.service || 'unknown'}, expected ${EXPECTED_SERVICE}`);
    }
    if (body.version !== panelVersion) {
      fail(`Data Core version=${body.version || 'unknown'}, expected ${panelVersion}`);
    }
    return body;
  } catch (err) {
    if (process.exitCode) throw err;
    fail(`Data Core 不可达: ${err.message}`);
  }
}

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

function printPageResult(page, result) {
  console.log([
    `[${result.ok ? 'OK' : 'ERR'}] ${page.title}`,
    `  url=${page.url}`,
    `  mode=${result.mode}`,
    `  expected=${result.expectedVersion}`,
    `  actual=${result.actualVersion}`,
    `  hasInline=${result.hasInline}`,
    `  hasLegacyPanel=${result.hasLegacyPanel}`,
    result.error ? `  error=${result.error}` : '',
  ].filter(Boolean).join('\n'));
}

async function injectOne(page, source, panelVersion) {
  const ws = page.webSocketDebuggerUrl;
  const client = await connectCdp(ws, 8000);
  const base = {
    title: page.title,
    url: page.url,
    expectedVersion: panelVersion,
    actualVersion: '',
    mode: 'none',
    hasInline: false,
    hasLegacyPanel: false,
    ok: false,
    error: null,
  };
  try {
    try { await client.Page.enable(); } catch { /* ignore */ }
    await clearRegisteredPageScripts(client, ws);
    await evaluateBestEffort(client, TEARDOWN_EXPR);
    await evaluateOrThrow(client, WRITE_CFG_EXPR);
    const injectResult = await injectPage(client, source, {
      softFirst: false,
      expectedVersion: panelVersion,
      registerOnNewDocument: true,
      ws,
      pageTitle: page.title || '',
      pageUrl: page.url || '',
    });
    await evaluateOrThrow(client, WRITE_CFG_EXPR);
    const probe = await probePage(client);
    const ok = isVerifiedProbe(probe, panelVersion);
    const result = {
      ...base,
      ok,
      mode: probe.mode,
      actualVersion: probe.version || '',
      hasInline: Boolean(probe.hasInline),
      hasLegacyPanel: Boolean(probe.hasLegacyPanel),
      injectMode: injectResult.mode,
    };
    if (!ok) {
      result.error = `verify failed mode=${probe.mode} version=${probe.version || ''}`;
    }
    return result;
  } catch (err) {
    return {
      ...base,
      error: err.message || String(err),
      exception: err.exceptionDetails || null,
    };
  } finally {
    await client.close();
  }
}

(async () => {
  ensureInlineSynced();
  ensureSyntax();
  const panelVersion = readPanelVersion();
  if (!panelVersion) fail('无法读取注入脚本版本');
  console.log(`[force-reinject] panel version v${panelVersion}`);
  await ensureDataCore(panelVersion);

  const panelJs = fs.readFileSync(INLINE_SCRIPT_PATH, 'utf8');
  const source = buildInjectSource(panelJs, sfCfg, { packageProxyPort: sfCfg.packageProxyPort });

  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(cfg.devtoolsHost || bot?.host || '127.0.0.1').trim();
  const port = Number(cfg.devtoolsPort || bot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9322);
  const list = await (await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(8000) })).json();
  const pages = list.filter(
    (p) => p.type === 'page' && p.webSocketDebuggerUrl && isQianfanPageUrl(p.url),
  );

  if (!pages.length) fail('未发现千帆页面', 1);

  let successCount = 0;
  const results = [];
  for (const page of pages) {
    const result = await injectOne(page, source, panelVersion);
    results.push(result);
    if (result.ok) successCount += 1;
    printPageResult(page, result);
  }

  const failureCount = pages.length - successCount;
  console.log(`[force-reinject] totalPages=${pages.length} successCount=${successCount} failureCount=${failureCount}`);

  if (failureCount > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`PASS: ${successCount}/${pages.length} pages verified inline v${panelVersion}`);
})().catch((err) => {
  if (!process.exitCode) process.exitCode = 1;
  if (!String(err.message).startsWith('内嵌') && !String(err.message).startsWith('注入脚本')) {
    console.error('[force-reinject] fatal:', err.message || err);
  }
});
