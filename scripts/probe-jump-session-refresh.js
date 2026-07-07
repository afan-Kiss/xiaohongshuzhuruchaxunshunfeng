#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const EXPR = `(async function(){
  var panel = document.getElementById('qf-sf-fee-panel-root');
  if (panel) {
    panel.classList.remove('qsf-icon-only');
    panel.classList.add('qsf-expanded');
  }
  if (window.__qfSfFeePanel?.syncSession) window.__qfSfFeePanel.syncSession();
  await window.__qfSfFeePanel.refresh({ preferCache: true });
  await new Promise(function(r){ setTimeout(r, 3000); });
  return {
    version: window.__qfSfFeePanel?.version,
    active: window.__qfSfFeePanel?.getActiveBuyer?.() || null,
    body: document.querySelector('#qf-sf-fee-panel-root .qsf-body')?.innerText?.slice(0, 200) || '',
  };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('XY祥钰'));
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
