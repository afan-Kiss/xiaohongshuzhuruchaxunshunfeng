#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const EXPR = `(function(){
  var ids = [];
  document.querySelectorAll('.order-card .order-card-title-id').forEach(function(el){
    var id = String(el.textContent||'').trim();
    if (id && ids.indexOf(id) < 0) ids.push(id);
  });
  var cards = document.querySelectorAll('.order-card');
  return {
    packageIds: ids.slice(0, 5),
    cardCount: cards.length,
    collapsed: Array.from(cards).map(function(c){
      return {
        id: (c.querySelector('.order-card-title-id')||{}).textContent,
        hasLogistics: !!c.querySelector('.delivery-row-logistics, .logistics-box'),
        expanded: !c.classList.contains('collapsed') && !c.querySelector('.order-card-body')?.classList?.contains?.('hidden'),
      };
    }).slice(0,5),
    shopKey: (function(){
      var t = document.title.replace(/-工作台\\s*$/, '');
      if (t.includes('拾玉居')) return 'shiyuju';
      return t;
    })(),
    proxyPort: window.__qfPackageProxyPort || 4725,
  };
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((p) => (p.title || '').includes('拾玉居'));
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  const info = r.result?.value;
  console.log('page:', JSON.stringify(info, null, 2));
  const pid = info?.packageIds?.[0];
  if (pid) {
    const proxyUrl = `http://127.0.0.1:${info.proxyPort}/package-detail?packageId=${encodeURIComponent(pid)}&shopKey=shiyuju`;
    console.log('proxyUrl:', proxyUrl);
    try {
      const res = await fetch(proxyUrl);
      const json = await res.json();
      console.log('proxy result:', JSON.stringify({
        ok: json.ok,
        error: json.error,
        via: json.via,
        express_number: json.data?.express_number,
        express_no: json.data?.express_no,
        keys: json.data ? Object.keys(json.data).slice(0, 30) : [],
      }, null, 2));
    } catch (e) {
      console.log('proxy fetch failed:', e.message);
    }
  }
  await c.close();
})().catch((e) => { console.error(e); process.exit(1); });
