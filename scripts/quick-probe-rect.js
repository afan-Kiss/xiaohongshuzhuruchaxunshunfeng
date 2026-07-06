#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const EXPR = `(function(){
  var p = document.getElementById('qf-sf-fee-panel-root');
  if (!p) return { hasPanel: false };
  var rect = p.getBoundingClientRect();
  var style = getComputedStyle(p);
  return {
    version: window.__qfSfFeePanel && window.__qfSfFeePanel.version,
    classes: p.className,
    rect: { w: rect.width, h: rect.height, l: rect.left, t: rect.top, r: rect.right, b: rect.bottom },
    pointerEvents: style.pointerEvents,
    position: style.position,
    zIndex: style.zIndex,
    display: style.display
  };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const pages = list.filter((p) => p.type === 'page' && isQianfanPageUrl(p.url));
  for (const page of pages) {
    let client;
    try {
      client = await connectCdp(page.webSocketDebuggerUrl, 5000);
      const r = await Promise.race([
        client.Runtime.evaluate({ expression: EXPR, returnByValue: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      console.log(page.title, JSON.stringify(r.result?.value));
    } catch (e) {
      console.log(page.title, e.message);
    } finally {
      if (client) await client.close().catch(() => {});
    }
  }
})();
