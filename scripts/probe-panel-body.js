#!/usr/bin/env node
const CDP = require('chrome-remote-interface');

const EXPR = `(function(){
  var panel = document.getElementById('qf-sf-fee-panel-root');
  var body = panel && panel.querySelector('.qsf-body');
  return {
    version: window.__qfSfFeePanel?.version,
    bodyHtml: body ? body.innerHTML.slice(0,400) : '',
    activeKey: document.querySelector('.chat-item.active')?.getAttribute('data-key')||'',
  };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('XY祥钰'));
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log(JSON.stringify(r.result.value, null, 2));
  await c.close();
})();
