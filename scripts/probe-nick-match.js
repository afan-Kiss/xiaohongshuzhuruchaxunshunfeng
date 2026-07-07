#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const PROBE = `(function(){
  function norm(s){ return String(s||'').replace(/\\s+/g,' ').trim(); }
  var nick = '';
  var ui = document.querySelector('.user-info-detail, .user-info');
  if (ui) nick = norm(ui.textContent).replace(/点击添加备注.*/,'').trim();
  var items = Array.from(document.querySelectorAll('.chat-item')).map(function(el){
    return { key: el.getAttribute('data-key')||'', text: norm(el.textContent).slice(0,50), matchNick: nick && norm(el.textContent).indexOf(nick)===0 };
  });
  var matchByNick = items.filter(function(x){ return x.matchNick; });
  var orderIds = Array.from(document.querySelectorAll('.order-card-title-id')).map(function(el){ return norm(el.textContent); });
  return { headerNick: nick, matchByNick: matchByNick, orderIds: orderIds, allItemNicks: items.slice(0,6) };
})()`;

async function main() {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((p) => (p.title || '').includes('XY祥钰'));
  const client = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await client.Runtime.evaluate({ expression: PROBE, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await client.close();
}

main().catch(console.error);
