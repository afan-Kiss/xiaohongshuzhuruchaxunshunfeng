#!/usr/bin/env node
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');

const EXPR = `(function(){
  function rect(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, top: r.top, height: r.height };
  }
  const picks = ['html','body','#app','#root','.farmer-chat','.farmer-chat__wrap','.farmer-chat__main','.new-right-panel','.order-tool-container','.farmer-chat__right'];
  const out = {};
  for (const sel of picks) {
    const el = sel === 'html' ? document.documentElement : sel === 'body' ? document.body : document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    out[sel] = {
      rect: rect(el),
      position: cs.position,
      width: cs.width,
      maxWidth: cs.maxWidth,
      marginRight: cs.marginRight,
      transform: cs.transform !== 'none' ? cs.transform.slice(0,40) : '',
      class: String(el.className||'').slice(0,60)
    };
  }
  const panel = document.getElementById('qf-sf-fee-panel-root');
  return {
    version: window.__qfSfFeePanel?.version,
    innerWidth: window.innerWidth,
    panel: panel ? { parent: panel.parentElement?.nodeName, rect: rect(panel), classes: panel.className } : null,
    layout: out
  };
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9322;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((p) => p.type === 'page' && (p.title || '').includes('拾玉居'));
  const c = await connectCdp(page.webSocketDebuggerUrl, 8000);
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
