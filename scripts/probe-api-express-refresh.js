#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const EXPR = `(async function(){
  var pid = document.querySelector('.order-card .order-card-title-id')?.textContent?.trim() || '';
  var uid = window.__qfSfFeePanel?.getActiveBuyer?.()?.buyerUserId || '';
  var card = document.querySelector('.order-card');
  var logistics = card?.querySelector('.delivery-row-logistics, .logistics-box');
  if (logistics) logistics.style.display = 'none';
  var proxyUrl = 'http://127.0.0.1:' + (window.__qfPackageProxyPort || 4725) + '/package-detail?packageId=' + encodeURIComponent(pid) + '&shopKey=shiyuju';
  var proxy = null;
  try {
    var pr = await fetch(proxyUrl);
    proxy = await pr.json();
  } catch (e) {
    proxy = { error: String(e.message || e) };
  }
  var direct = null;
  try {
    var dr = await fetch('https://eva.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/detail', { credentials: 'include' });
    direct = { status: dr.status, express: (await dr.json().catch(function(){ return {}; }))?.data?.express_number };
  } catch (e) {
    direct = { error: String(e.message || e) };
  }
  await window.__qfSfFeePanel?.refresh?.({ preferCache: false, waitForData: true, force: true });
  await new Promise(function(r){ setTimeout(r, 6000); });
  if (logistics) logistics.style.display = '';
  var body = document.querySelector('#qf-sf-fee-panel-root .qsf-body')?.innerText || '';
  return { pid, uid, proxyExpress: proxy?.data?.express_number, proxyOk: proxy?.ok, direct, hasOrderCard: body.includes('发货单号'), hasSf: /SF\\d{10,}/.test(body), body: body.slice(0, 300) };
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const list = await (await fetch(`http://127.0.0.1:${bot?.port || 9223}/json/list`)).json();
  const page = list.find((p) => (p.title || '').includes('拾玉居'));
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})().catch((e) => { console.error(e); process.exit(1); });
