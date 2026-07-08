#!/usr/bin/env node
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const PROBE = `(function(){
  try {
    return JSON.parse(localStorage.getItem('qf_sf_fee_config_v1') || '{}');
  } catch (e) {
    return { err: String(e.message || e) };
  }
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(bot?.host || '127.0.0.1').trim();
  const port = Number(bot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9223);
  const list = await (await fetch(`http://${host}:${port}/json/list`)).json();
  for (const page of list.filter((p) => p.type === 'page' && isQianfanPageUrl(p.url))) {
    let client;
    try {
      client = await connectCdp(page.webSocketDebuggerUrl, 5000);
      const r = await client.Runtime.evaluate({ expression: PROBE, returnByValue: true });
      const cfg = r.result?.value || {};
      console.log(page.title);
      console.log('  partnerID:', cfg.partnerID);
      console.log('  checkWord:', cfg.checkWord);
      console.log('  checkWordSandbox:', cfg.checkWordSandbox);
      console.log('  monthlyCard:', cfg.monthlyCard);
      console.log('  sandbox:', cfg.sandbox);
    } finally {
      if (client) try { await client.close(); } catch { /* ignore */ }
    }
  }
})().catch((err) => { console.error(err); process.exit(1); });
