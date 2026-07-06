#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const EXPR = `(function(){
  var root = document.querySelector('.order-tool-content')
    || document.querySelector('.new-right-panel')
    || document.querySelector('.order-tool-container')
    || document.querySelector('.farmer-chat__right');
  if (!root) return { error: 'no root' };
  var items = root.querySelectorAll('[class*="order-item"],[class*="orderItem"],[class*="package-item"],[class*="PackageItem"],[class*="order-card"],[class*="OrderCard"],[class*="delivery-row"],[class*="logistics"]');
  var samples = [];
  for (var i = 0; i < Math.min(items.length, 12); i++) {
    var el = items[i];
    var txt = (el.innerText || '').slice(0, 200);
    var sf = txt.match(/\\b(SF\\d{10,15})\\b/i);
    samples.push({ cls: (el.className||'').toString().slice(0,80), sf: sf?sf[1]:'', text: txt.slice(0,100) });
  }
  var allSf = [];
  var re = /\\b(SF\\d{10,15})\\b/gi, m;
  var full = root.innerText || '';
  while ((m = re.exec(full))) allSf.push(m[1].toUpperCase());
  allSf = [...new Set(allSf)];
  return {
    rootCls: (root.className||'').toString().slice(0,100),
    itemCount: items.length,
    allSfCount: allSf.length,
    allSf: allSf.slice(0, 20),
    samples
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
