#!/usr/bin/env node
/** Prove 20 consecutive force-reinjects leave a single set of listeners. */
const CDP = require('chrome-remote-interface');
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROBE = `(function(){
  var api = window.__qfSfFeeInline;
  var h = api && typeof api.health === 'function' ? api.health() : null;
  return {
    version: api && api.version,
    health: h,
    wraps: document.querySelectorAll('.qsf-inline-fee-wrap').length,
  };
})()`;

(async () => {
  for (let i = 0; i < 20; i += 1) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'force-reinject.js')], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
    });
    if (r.status !== 0) {
      console.error('force-reinject failed at', i, r.stderr || r.stdout);
      process.exit(1);
    }
  }

  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const pages = list.filter((p) => (p.url || '').includes('cstools') && p.webSocketDebuggerUrl);
  const results = [];
  for (const page of pages) {
    const c = await CDP({ target: page.webSocketDebuggerUrl });
    const r = await c.Runtime.evaluate({ expression: PROBE, returnByValue: true });
    results.push({ title: page.title, ...(r.result?.value || {}) });
    await c.close();
  }

  let ok = true;
  for (const row of results) {
    const h = row.health || {};
    if (row.version !== '3.0.6') ok = false;
    if (!h.alive) ok = false;
    if (h.sessionPolling !== true) ok = false;
    if (h.orderObserverActive !== true && !(row.title || '').includes('登录')) ok = false;
  }
  console.log(JSON.stringify({ ok, results }, null, 2));
  process.exit(ok ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
