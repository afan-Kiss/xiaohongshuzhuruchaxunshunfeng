#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const EXPR = `(function(){
  function uidFromAppCid(appCid) {
    var s = String(appCid || '').trim();
    if (s.indexOf('$3$') !== 0) return '';
    var rest = s.slice(3);
    var dot = rest.indexOf('.');
    if (dot < 0) return '';
    try {
      var buyerRaw = atob(rest.slice(0, dot));
      var m = buyerRaw.match(/1#2#2#([0-9a-f]+)/i);
      return m ? m[1] : buyerRaw;
    } catch (e) { return ''; }
  }
  function attrs(el) {
    var out = {};
    if (!el || !el.attributes) return out;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      out[a.name] = String(a.value || '').slice(0, 120);
    }
    return out;
  }
  var ui = document.querySelector('.user-info-detail, .user-info');
  var strict = document.querySelector('.chat-item.active,[class*="chat-item"][class*="active"]');
  var orderRoot = document.querySelector('[class*="order"],[class*="Order"],[class*="package"],[class*="Package"]');
  var latestChats = null;
  try { latestChats = JSON.parse(localStorage.getItem('latestChats') || 'null'); } catch (e) {}
  return {
    headerAttrs: attrs(ui),
    headerText: ui ? String(ui.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : '',
    strictActive: strict ? {
      attrs: attrs(strict),
      nick: String(strict.textContent || '').trim().slice(0, 60),
      uid: uidFromAppCid(strict.getAttribute('data-key') || strict.getAttribute('data-app-cid') || ''),
    } : null,
    chatItemCount: document.querySelectorAll('.chat-item,[class*="chat-item"]').length,
    dataKeyCount: document.querySelectorAll('[data-key^="$3$"]').length,
    orderPanelText: orderRoot ? String(orderRoot.innerText || '').slice(0, 200) : '',
    latestChatsSample: Array.isArray(latestChats) ? latestChats.slice(0, 2) : latestChats,
    locationHref: location.href,
  };
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const host = bot?.host || '127.0.0.1';
  const list = await (await fetch(`http://${host}:${port}/json/list`)).json();
  for (const p of list.filter((x) => x.type === 'page' && /xiaohongshu/i.test(x.url || ''))) {
    if (!(p.title || '').includes('拾玉居')) continue;
    const c = await CDP({ target: p.webSocketDebuggerUrl });
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
    console.log(JSON.stringify(r.result?.value, null, 2));
    await c.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
