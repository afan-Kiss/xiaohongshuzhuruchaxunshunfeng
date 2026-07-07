#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const EXPR = `(function(){
  function norm(s){ return String(s||'').replace(/\\s+/g,' ').trim(); }
  function scrape(){
    var ui = document.querySelector('.user-info-detail,.user-info');
    if (!ui) return '';
    return norm(ui.textContent).replace(/点击添加备注.*/,'').replace(/老客.*/,'').trim();
  }
  if (window.__qfSfFeePanel?.syncSession) window.__qfSfFeePanel.syncSession();
  return {
    version: window.__qfSfFeePanel?.version,
    header: scrape(),
    active: window.__qfSfFeePanel?.getActiveBuyer?.() || null,
  };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('XY祥钰'));
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
