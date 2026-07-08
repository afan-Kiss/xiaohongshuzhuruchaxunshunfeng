#!/usr/bin/env node
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');

const EXPR = `(function(){
  var st = document.getElementById('qf-sf-fee-panel-style');
  var html = document.documentElement;
  var rules = [];
  if (st && st.sheet) {
    try {
      for (var i = 0; i < st.sheet.cssRules.length; i++) {
        var t = st.sheet.cssRules[i].cssText;
        if (t.includes('qsf-page-docked')) rules.push(t.slice(0, 120));
      }
    } catch (e) { rules.push('blocked:' + e.message); }
  }
  html.classList.add('qsf-page-docked');
  html.style.setProperty('--qsf-dock-width', '300px');
  var cs = getComputedStyle(html);
  var bodyCs = document.body ? getComputedStyle(document.body) : null;
  return {
    version: window.__qfSfFeePanel?.version,
    hasStyle: !!st,
    styleLen: st ? st.textContent.length : 0,
    hasDockInStyle: st ? st.textContent.includes('qsf-page-docked') : false,
    dockRules: rules.slice(0, 5),
    htmlMarginRight: cs.marginRight,
    htmlPaddingRight: cs.paddingRight,
    htmlWidth: cs.width,
    bodyMarginRight: bodyCs?.marginRight,
    bodyWidth: bodyCs?.width,
    htmlInline: html.getAttribute('style'),
  };
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9322;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((p) => p.type === 'page' && (p.title || '').includes('拾玉居'))
    || list.find((p) => p.type === 'page' && (p.title || '').includes('XY祥钰'));
  const c = await connectCdp(page.webSocketDebuggerUrl, 8000);
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
