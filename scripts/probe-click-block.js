#!/usr/bin/env node
/** 探测千帆页面侧栏是否遮挡点击 */
const fs = require('fs');
const path = require('path');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const ROOT = path.resolve(__dirname, '..');
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
} catch {
  /* ignore */
}

const PROBE_EXPR = String.raw`(function(){
  var p = document.getElementById('qf-sf-fee-panel-root');
  var rect = p ? p.getBoundingClientRect() : null;
  var style = p ? getComputedStyle(p) : null;
  var cx = Math.floor(window.innerWidth / 2);
  var cy = Math.floor(window.innerHeight / 2);
  var topEl = document.elementFromPoint(cx, cy);
  return {
    version: window.__qfSfFeePanel && window.__qfSfFeePanel.version,
    panelCount: document.querySelectorAll('#qf-sf-fee-panel-root').length,
    hasPanel: !!p,
    classes: p ? p.className : '',
    rect: rect ? { w: rect.width, h: rect.height, l: rect.left, t: rect.top } : null,
    pointerEvents: style ? style.pointerEvents : null,
    zIndex: style ? style.zIndex : null,
    stuckDrag: !!window.__qfSfLauncherDragCleanup,
    centerHit: topEl ? { tag: topEl.tagName, id: topEl.id || '', cls: (topEl.className || '').slice(0, 80) } : null,
    viewport: { w: window.innerWidth, h: window.innerHeight }
  };
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(cfg.devtoolsHost || bot?.host || '127.0.0.1').trim();
  const port = Number(cfg.devtoolsPort || bot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9322);
  const list = await (await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const pages = list.filter((p) => p.type === 'page' && p.webSocketDebuggerUrl && isQianfanPageUrl(p.url));
  console.log('devtools', `${host}:${port}`, 'pages', pages.length);
  for (const page of pages) {
    let client;
    try {
      client = await connectCdp(page.webSocketDebuggerUrl, 6000);
      const r = await client.Runtime.evaluate({ expression: PROBE_EXPR, returnByValue: true });
      console.log('\n---', page.title, '---');
      console.log(JSON.stringify(r.result?.value, null, 2));
    } catch (e) {
      console.log('\n---', page.title, 'SKIP:', e.message);
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
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
