#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const EXPR = `(function(){
  function parse(s){
    var m=String(s||'').trim().match(/(\\d{4})[\\/-](\\d{2})[\\/-](\\d{2})(?:\\s+(\\d{2}):(\\d{2})(?::(\\d{2}))?)?/);
    if(!m)return null;
    var d=new Date(+m[1],+m[2]-1,+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0));
    return isNaN(d.getTime())?null:d.getTime();
  }
  var cards = Array.from(document.querySelectorAll('.order-card')).slice(0,3).map(function(card){
    var id = card.querySelector('.order-card-title-id')?.textContent?.trim()||'';
    var text = card.innerText||'';
    var apply = text.match(/申请时间\\s*(\\d{4}[\\/-]\\d{2}[\\/-]\\d{2}\\s+\\d{2}:\\d{2}(?::\\d{2})?)/);
    var ms = apply ? parse(apply[1]) : null;
    var days = ms ? ((Date.now()-ms)/86400000).toFixed(1) : null;
    return { id:id, apply:apply&&apply[1], days:days, over7: ms ? (Date.now()-ms)>7*86400000 : null };
  });
  return { version: window.__qfSfFeeInline?.version, cards:cards };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('XY祥钰'));
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
