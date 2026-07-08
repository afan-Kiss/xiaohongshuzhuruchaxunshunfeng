#!/usr/bin/env node
/** 紧急移除旧侧栏窗口，保留订单卡内嵌 */
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');
const { TEARDOWN_EXPR, clearRegisteredPageScripts } = require('../src/inject-page');

const PROBE = `(function(){
  return {
    hasLegacyPanel: !!document.getElementById('qf-sf-fee-panel-root'),
    hasInline: !!window.__qfSfFeeInline,
    inlineVersion: window.__qfSfFeeInline?.version || null,
  };
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(bot?.host || '127.0.0.1').trim();
  const port = Number(bot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9223);
  const list = await (await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const pages = list.filter((p) => p.type === 'page' && p.webSocketDebuggerUrl && isQianfanPageUrl(p.url));
  for (const page of pages) {
    let client;
    try {
      client = await connectCdp(page.webSocketDebuggerUrl, 8000);
      await client.Page.enable();
      await clearRegisteredPageScripts(client);
      await client.Runtime.evaluate({ expression: TEARDOWN_EXPR, returnByValue: true, awaitPromise: true });
      const r = await client.Runtime.evaluate({ expression: PROBE, returnByValue: true });
      console.log(page.title, r.result?.value);
    } catch (e) {
      console.log(page.title, 'skip:', e.message);
    } finally {
      if (client) {
        try { await client.close(); } catch { /* ignore */ }
      }
    }
  }
  console.log('done', pages.length, '— 请运行 node scripts/force-reinject.js 重新注入内嵌脚本');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
