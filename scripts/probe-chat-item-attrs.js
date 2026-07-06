#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const PROBE = `(function(){
  function attrs(el){
    var out = {};
    if (!el || !el.attributes) return out;
    for (var i=0;i<el.attributes.length;i++){
      var a = el.attributes[i];
      out[a.name] = (a.value||'').slice(0,120);
    }
    return out;
  }
  function walk(el, depth){
    if (!el || depth>4) return null;
    var cid = el.getAttribute && (el.getAttribute('data-app-cid')||el.getAttribute('data-appcid')||el.getAttribute('data-cid'));
    if (cid) return { el: el.tagName, cls: String(el.className||'').slice(0,60), cid: cid };
    for (var c=el.firstElementChild; c; c=c.nextElementSibling){
      var hit = walk(c, depth+1);
      if (hit) return hit;
    }
    return null;
  }
  var items = Array.from(document.querySelectorAll('.chat-item')).slice(0,3);
  var active = document.querySelector('.chat-item.active') || items[0];
  var storeKeys = [];
  try {
    if (window.__STORE__) storeKeys.push('__STORE__');
    if (window.__INITIAL_STATE__) storeKeys.push('__INITIAL_STATE__');
    if (window.__qfImpaasSockets) storeKeys.push('__qfImpaasSockets');
  } catch(e){}
  var activeWalk = active ? walk(active, 0) : null;
  return {
    activeText: active ? (active.textContent||'').trim().slice(0,60) : '',
    activeAttrs: active ? attrs(active) : {},
    activeChildWalk: activeWalk,
    itemSamples: items.map(function(el){
      return { attrs: attrs(el), childWalk: walk(el,0), text: (el.textContent||'').trim().slice(0,40) };
    }),
    storeKeys: storeKeys,
    impaasHook: typeof window.__qfImpaasSockets,
  };
})()`;

async function main() {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const page = list.find((p) => p.title && p.title.includes('XY祥钰')) || list.find((p) => /dashboard/.test(p.url||''));
  if (!page) { console.log('no page'); return; }
  const client = await CDP({ target: page.webSocketDebuggerUrl });
  const { Runtime } = client;
  const r = await Runtime.evaluate({ expression: PROBE, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await client.close();
}

main().catch(console.error);
