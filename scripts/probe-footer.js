#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const EXPR = `(function(){
  var panel = document.getElementById('qf-sf-fee-panel-root');
  var shell = panel && panel.querySelector('.qsf-shell');
  var foot = panel && panel.querySelector('.qsf-foot');
  var style = foot ? getComputedStyle(foot) : null;
  return {
    version: window.__qfSfFeePanel && window.__qfSfFeePanel.version,
    expanded: panel && panel.classList.contains('qsf-expanded'),
    hasFoot: !!foot,
    footText: foot ? foot.textContent.trim() : '',
    footDisplay: style ? style.display : null,
    footVisible: foot ? foot.offsetHeight > 0 : false,
    shellChildren: shell ? [...shell.children].map(function(c){ return c.className; }) : [],
    panelHtmlTail: shell ? shell.innerHTML.slice(-400) : ''
  };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  for (const page of list.filter((p) => p.type === 'page' && isQianfanPageUrl(p.url))) {
    let c;
    try {
      c = await connectCdp(page.webSocketDebuggerUrl, 6000);
      const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
      console.log('\n===', page.title, '===');
      console.log(JSON.stringify(r.result?.value, null, 2));
    } catch (e) {
      console.log(page.title, e.message);
    } finally {
      if (c) await c.close().catch(() => {});
    }
  }
})();
