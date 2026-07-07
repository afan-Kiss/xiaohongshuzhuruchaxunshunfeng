#!/usr/bin/env node
/** 无 .active 时探测当前会话买家信息 */
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const PROBE = `(function(){
  function norm(s){ return String(s||'').replace(/\\s+/g,' ').trim(); }
  function uidFromAppCid(appCid) {
    var s = String(appCid || '').trim();
    if (!s.startsWith('$3$')) return '';
    var rest = s.slice(3);
    var dot = rest.indexOf('.');
    if (dot < 0) return '';
    try {
      var buyerRaw = atob(rest.slice(0, dot));
      var m = buyerRaw.match(/1#2#2#([0-9a-f]+)/i);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }
  var sels = [
    '[class*="chat-header"]',
    '[class*="conversation-header"]',
    '[class*="session-header"]',
    '[class*="buyer-name"]',
    '[class*="nick-name"]',
    '[class*="user-name"]',
    '[class*="customer-name"]',
    '[class*="chat-title"]',
    '[class*="conv-title"]',
    '[class*="im-header"]',
    '[class*="detail-header"]',
    '[class*="chat-top"]',
    '[class*="chat-info"]',
    '[class*="user-info"]',
  ];
  var headerHits = [];
  sels.forEach(function(sel){
    document.querySelectorAll(sel).forEach(function(el){
      var t = norm(el.textContent);
      if (t && t.length < 80) headerHits.push({ sel: sel, text: t, cls: String(el.className||'').slice(0,60) });
    });
  });
  var msgRoot = document.querySelector('[class*="msg-list"],[class*="message-list"],[class*="chat-content"],[class*="chat-main"],[class*="im-chat"]');
  var msgAttrs = [];
  if (msgRoot) {
    var p = msgRoot;
    for (var i=0; i<6 && p; i++) {
      msgAttrs.push({ tag: p.tagName, cls: String(p.className||'').slice(0,80), key: p.getAttribute('data-key')||'', appCid: p.getAttribute('data-app-cid')||p.getAttribute('data-appcid')||'' });
      p = p.parentElement;
    }
  }
  var dataKeyNodes = Array.from(document.querySelectorAll('[data-key^="$3$"]')).slice(0,8).map(function(el){
    return { tag: el.tagName, cls: String(el.className||'').slice(0,60), key: (el.getAttribute('data-key')||'').slice(0,60), text: norm(el.textContent).slice(0,30) };
  });
  var orderBuyer = '';
  var orderRoot = document.querySelector('.order-card, [class*="order-card"], [class*="order-panel"], [class*="package-list"]');
  if (orderRoot) {
    var buyerEl = document.querySelector('[class*="buyer"], [class*="receiver"], [class*="customer"]');
    if (buyerEl) orderBuyer = norm(buyerEl.textContent).slice(0,60);
  }
  var activeItems = Array.from(document.querySelectorAll('.chat-item.active, .chat-item[class*="active"]')).map(function(el){
    return { key: el.getAttribute('data-key')||'', uid: uidFromAppCid(el.getAttribute('data-key')||''), text: norm(el.textContent).slice(0,40) };
  });
  return {
    page: document.title,
    activeItems: activeItems,
    headerHits: headerHits.slice(0,12),
    msgRoot: msgRoot ? String(msgRoot.className||'').slice(0,80) : null,
    msgAttrs: msgAttrs,
    dataKeyNodes: dataKeyNodes,
    orderBuyer: orderBuyer,
    orderCards: document.querySelectorAll('.order-card').length,
  };
})()`;

async function main() {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((p) => (p.title || '').includes('XY祥钰')) || list.find((p) => /dashboard/.test(p.url || ''));
  if (!page) { console.log('no page'); return; }
  const client = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await client.Runtime.evaluate({ expression: PROBE, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await client.close();
}

main().catch(console.error);
