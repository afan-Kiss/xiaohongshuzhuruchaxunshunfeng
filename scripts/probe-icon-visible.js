#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const EXPR = `(function(){
  var panel = document.getElementById('qf-sf-fee-panel-root');
  var launcher = panel && panel.querySelector('.qsf-launcher');
  var rect = panel ? panel.getBoundingClientRect() : null;
  var lrect = launcher ? launcher.getBoundingClientRect() : null;
  var style = panel ? getComputedStyle(panel) : null;
  var lstyle = launcher ? getComputedStyle(launcher) : null;
  return {
    version: window.__qfSfFeePanel && window.__qfSfFeePanel.version,
    hasPanel: !!panel,
    hasLauncher: !!launcher,
    iconOnly: panel && panel.classList.contains('qsf-icon-only'),
    iconUrl: !!(window.__qfSfFeeIconDataUrl),
    panelRect: rect ? { l: rect.left, t: rect.top, w: rect.width, h: rect.height } : null,
    launcherRect: lrect ? { l: lrect.left, t: lrect.top, w: lrect.width, h: lrect.height } : null,
    panelDisplay: style ? style.display : null,
    launcherDisplay: lstyle ? lstyle.display : null,
    panelLeft: panel ? panel.style.left : '',
    panelTop: panel ? panel.style.top : '',
    inViewport: rect ? rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth : false
  };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  for (const page of list.filter((p) => p.type === 'page' && isQianfanPageUrl(p.url))) {
    const c = await connectCdp(page.webSocketDebuggerUrl, 6000);
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
    console.log('\n===', page.title, '===');
    console.log(JSON.stringify(r.result?.value, null, 2));
    await c.close();
  }
})();
