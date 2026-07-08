#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');

const EXPR = `(async function(){
  if (window.__qsfLogCapture) return window.__qsfLogCapture.slice(-5);
  window.__qsfLogCapture = [];
  var orig = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    var res = await orig(input, init);
    if (/logistics|express|track|trace|package/i.test(u)) {
      try {
        var clone = res.clone();
        var t = await clone.text();
        window.__qsfLogCapture.push({ url: u.slice(0,160), body: t.slice(0, 600) });
      } catch(e){}
    }
    return res;
  };
  var root = document.querySelector('.order-tool-content');
  var card = root?.querySelector('.order-card');
  (card?.querySelector('.order-card-header,.order-card-title,.order-card-title-id')||card)?.click();
  await new Promise(function(r){ setTimeout(r, 800); });
  var logBox = document.querySelector('.logistics-box');
  logBox?.click();
  await new Promise(function(r){ setTimeout(r, 1200); });
  return window.__qsfLogCapture;
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('拾玉居'));
  const c = await connectCdp(page.webSocketDebuggerUrl, 25000);
  await c.Runtime.evaluate({ expression: `(function(){ window.__qsfLogCapture=[]; })()` });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})().catch(console.error);
