#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const EXPR = `(async function(){
  var pid = document.querySelector('.order-card .order-card-title-id')?.textContent?.trim() || '';
  var ids = [];
  document.querySelectorAll('.order-card .order-card-title-id').forEach(function(el){
    var id = String(el.textContent||'').trim(); if(id) ids.push(id);
  });
  var card = document.querySelector('.order-card');
  var logistics = card?.querySelector('.delivery-row-logistics, .logistics-box');
  if (logistics) logistics.style.display = 'none';
  await window.__qfSfFeePanel.refresh({ preferCache: false, waitForData: true, force: true });
  await new Promise(function(r){ setTimeout(r, 6500); });
  if (logistics) logistics.style.display = '';
  var bodyHtml = document.querySelector('#qf-sf-fee-panel-root .qsf-body')?.innerHTML || '';
  return {
    version: window.__qfSfFeePanel.version,
    visiblePackageIds: ids,
    hasOrderList: bodyHtml.includes('qsf-order-list'),
    hasExpressRow: bodyHtml.includes('发货单号'),
    hasSf: /SF\\d{10,}/.test(bodyHtml),
    orderPanelStaleUnknown: null,
    bodyTextLen: (document.querySelector('#qf-sf-fee-panel-root .qsf-body')?.innerText||'').length,
  };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('拾玉居'));
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
