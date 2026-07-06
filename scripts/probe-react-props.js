#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const PROBE = `(function(){
  var keys = [];
  function scan(obj, prefix, depth){
    if (!obj || depth>3) return;
    if (typeof obj !== 'object') return;
    for (var k of Object.keys(obj)){
      var lk = String(k).toLowerCase();
      if (/appcid|buyer|userid|customer|receiver|conv|session|package|express/.test(lk)){
        keys.push(prefix + k);
      }
      try {
        var v = obj[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) scan(v, prefix + k + '.', depth+1);
      } catch(e){}
    }
  }
  scan(window, 'window.', 0);
  var active = document.querySelector('.chat-item.active');
  var reactKey = active && Object.keys(active).find(function(k){ return k.startsWith('__reactFiber') || k.startsWith('__reactProps'); });
  var reactProps = null;
  if (active && reactKey){
    try {
      var fiber = active[reactKey];
      var p = fiber && (fiber.memoizedProps || fiber.pendingProps);
      if (p) reactProps = JSON.stringify(p).slice(0,800);
    } catch(e){ reactProps = String(e.message); }
  }
  return { stateKeys: keys.slice(0,40), reactKey: reactKey||null, reactProps: reactProps };
})()`;

async function main() {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const page = (await res.json()).find((p) => (p.title||'').includes('XY祥钰'));
  const client = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await client.Runtime.evaluate({ expression: PROBE, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await client.close();
}
main().catch(console.error);
