#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const EXPR = `(function(){
  var panel = document.getElementById('qf-sf-fee-panel-root');
  var body = panel && panel.querySelector('.qsf-body');
  return {
    version: window.__qfSfFeePanel && window.__qfSfFeePanel.version,
    expanded: panel && panel.classList.contains('qsf-expanded'),
    bodyPreview: body ? body.innerText.slice(0, 600) : '',
    hasMetaWarn: !!document.querySelector('.qsf-meta-warn'),
    metaLines: body ? [...body.querySelectorAll('.qsf-meta')].map(function(el){ return el.textContent; }) : []
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
