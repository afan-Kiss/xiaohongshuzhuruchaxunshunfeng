#!/usr/bin/env node
/** 紧急解除侧栏对千帆的影响：执行 teardown 并收起为图标 */
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const EXPR = `(function(){
  try {
    window.__qfSfFeePanel?.teardown?.();
    var p = document.getElementById('qf-sf-fee-panel-root');
    if (p) p.remove();
    var st = document.getElementById('qf-sf-fee-panel-style');
    if (st) st.remove();
    delete window.__qfSfFeePanel;
    delete window.__qfSfLauncherDragCleanup;
    return { ok: true, removed: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
})()`;

async function evalWithTimeout(client, expression, ms = 5000) {
  return Promise.race([
    client.Runtime.evaluate({ expression, returnByValue: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`evaluate 超时 ${ms}ms`)), ms)),
  ]);
}

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(bot?.host || '127.0.0.1').trim();
  const port = Number(bot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9223);
  const list = await (await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const pages = list.filter((p) => p.type === 'page' && p.webSocketDebuggerUrl && isQianfanPageUrl(p.url));
  for (const page of pages) {
    let client;
    try {
      client = await connectCdp(page.webSocketDebuggerUrl, 5000);
      const r = await evalWithTimeout(client, EXPR, 5000);
      console.log(page.title, r.result?.value);
    } catch (e) {
      console.log(page.title, 'skip:', e.message);
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
  console.log('done', pages.length);
})().catch((e) => {  console.error(e);
  process.exit(1);
});
