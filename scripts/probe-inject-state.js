#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const PROBE = `(function(){
  function count(sel){ try { return document.querySelectorAll(sel).length; } catch(e){ return -1; } }
  function sample(sel, n){
    return Array.from(document.querySelectorAll(sel)).slice(0, n).map(function(el){
      return {
        tag: el.tagName,
        cls: (el.className||'').toString().slice(0,80),
        appCid: el.getAttribute('data-app-cid')||el.getAttribute('data-appcid')||el.getAttribute('data-cid')||'',
        text: (el.textContent||'').trim().slice(0,40)
      };
    });
  }
  return {
    href: location.href,
    title: document.title,
    hasInline: count('.qf-sf-fee-inline') > 0,
    inlineCount: count('.qf-sf-fee-inline'),
    hasLegacyPanel: !!document.getElementById('qf-sf-fee-panel-root'),
    hasInlineApi: !!window.__qfSfFeeInline,
    version: window.__qfSfFeeInline && window.__qfSfFeeInline.version,
    chatItem: count('.chat-item'),
    chatItemPartial: count('[class*="chat-item"]'),
    appCidNodes: count('[data-app-cid],[data-appcid],[data-cid]'),
    convNodes: count('[class*="conv"],[class*="session"]'),
    samples: sample('[data-app-cid],[data-appcid],[data-cid],.chat-item,[class*="chat-item"]', 5),
    frameCount: window.frames.length,
    bodyChildCount: document.body ? document.body.childElementCount : 0
  };
})()`;

async function main() {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const host = bot?.host || '127.0.0.1';
  const res = await fetch(`http://${host}:${port}/json/list`);
  const list = await res.json();
  const pages = list.filter((p) => p.type === 'page' && /xiaohongshu\.com/i.test(p.url || ''));
  console.log(`DevTools ${host}:${port} — ${pages.length} xhs pages\n`);
  for (const p of pages) {
    console.log('---', p.title, '---');
    console.log(p.url);
    try {
      const client = await CDP({ target: p.webSocketDebuggerUrl });
      const { Runtime } = client;
      const r = await Runtime.evaluate({ expression: PROBE, returnByValue: true });
      console.log(JSON.stringify(r.result?.value, null, 2));
      await client.close();
    } catch (err) {
      console.log('probe failed:', err.message);
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
