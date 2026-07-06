#!/usr/bin/env node
/** 强制向所有千帆页面重新注入最新脚本 */
const fs = require('fs');
const path = require('path');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { loadLauncherIconDataUrl } = require('../src/load-launcher-icon');
const { buildInjectSource, isQianfanPageUrl } = require('../src/build-inject-source');
const { connectCdp } = require('../src/cdp-connect');

const ROOT = path.resolve(__dirname, '..');
const panelJs = fs.readFileSync(path.join(ROOT, 'inject', 'qf-sf-fee-panel.js'), 'utf8');
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
  sandbox: Boolean(cfg.sf?.sandbox),
};

const source = buildInjectSource(panelJs, sfCfg, loadLauncherIconDataUrl());

async function inject(page) {
  const client = await connectCdp(page.webSocketDebuggerUrl, 8000);
  const { Page, Runtime } = client;
  try {
    await Page.enable();
  } catch {
    /* ignore */
  }
  await Page.addScriptToEvaluateOnNewDocument({ source });
  await Runtime.evaluate({ expression: source, returnByValue: true, awaitPromise: true });
  const v = await Runtime.evaluate({
    expression: `({
      v: window.__qfSfFeePanel?.version,
      iconOnly: document.getElementById('qf-sf-fee-panel-root')?.classList.contains('qsf-icon-only'),
      hasIcon: !!window.__qfSfFeeIconDataUrl
    })`,
    returnByValue: true,
  });
  console.log(page.title, v.result?.value);
  await client.close();
}

(async () => {
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
