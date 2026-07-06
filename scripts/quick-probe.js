#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const EXPR = `(function(){
  var p = document.getElementById('qf-sf-fee-panel-root');
  var style = p ? getComputedStyle(p) : null;
  var cx = Math.floor(window.innerWidth / 2);
  var cy = Math.floor(window.innerHeight / 2);
  var topEl = document.elementFromPoint(cx, cy);
  return {
    version: window.__qfSfFeePanel && window.__qfSfFeePanel.version,
    panelCount: document.querySelectorAll('#qf-sf-fee-panel-root').length,
    classes: p ? p.className : '',
    pointerEvents: style ? style.pointerEvents : null,
    stuckDrag: !!window.__qfSfLauncherDragCleanup,
    centerHit: topEl ? topEl.tagName + '#' + (topEl.id || '') : null
  };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list', { signal: AbortSignal.timeout(5000) })).json();
  const pages = list.filter((p) => p.type === 'page' && p.webSocketDebuggerUrl && isQianfanPageUrl(p.url));
  for (const page of pages) {
    let client;
    try {
      console.log('connect', page.title);
      client = await connectCdp(page.webSocketDebuggerUrl, 5000);
      const r = await Promise.race([
        client.Runtime.evaluate({ expression: EXPR, returnByValue: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), 5000)),
      ]);
      console.log('ok', page.title, JSON.stringify(r.result?.value));
    } catch (e) {
      console.log('fail', page.title, e.message);
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
