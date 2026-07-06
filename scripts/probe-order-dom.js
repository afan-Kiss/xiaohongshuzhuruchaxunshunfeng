#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const EXPR = `(function(){
  var out = { classes: [], texts: [] };
  var all = document.querySelectorAll('[class*="order"],[class*="Order"],[class*="package"],[class*="Package"],[class*="logistics"],[class*="Logistics"],[class*="express"],[class*="Express"],[class*="right"],[class*="Right"]');
  var seen = new Set();
  for (var i = 0; i < Math.min(all.length, 80); i++) {
    var el = all[i];
    var cn = (el.className && String(el.className).slice(0, 100)) || '';
    if (cn && !seen.has(cn)) { seen.add(cn); out.classes.push(cn); }
  }
  var bodyText = document.body.innerText || '';
  var idx = bodyText.indexOf('SF');
  if (idx >= 0) out.texts.push(bodyText.slice(Math.max(0, idx - 80), idx + 120));
  var active = document.querySelector('.chat-item.active');
  if (active) {
    var panel = active.closest('[class*="layout"]')?.parentElement || document.body;
    var right = document.querySelector('main') || document.body;
    out.mainChildren = [...(right.children || [])].slice(0, 5).map(function(c){ return c.className?.toString?.().slice(0,60)||c.tagName; });
  }
  return out;
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((p) => (p.title || '').includes('拾玉居'));
  if (!page) return console.log('no page');
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
