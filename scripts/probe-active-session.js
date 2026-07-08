#!/usr/bin/env node
/** 探测千帆当前会话如何标记（active / selected / URL 等） */
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const PROBE = `(function(){
  function attrs(el) {
    if (!el) return null;
    var out = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      out[a.name] = (a.value || '').slice(0, 100);
    }
    return out;
  }
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
  var items = Array.from(document.querySelectorAll('.chat-item, [class*="chat-item"]'));
  var selectors = [
    '.chat-item.active',
    '.chat-item.selected',
    '.chat-item.current',
    '.chat-item.is-active',
    '.chat-item[aria-selected="true"]',
    '.chat-item[aria-current="true"]',
    '[class*="chat-item"][class*="active"]',
    '[class*="chat-item"][class*="selected"]',
    '[class*="chat-item"][class*="current"]',
  ];
  var hits = {};
  selectors.forEach(function(sel) {
    try {
      var el = document.querySelector(sel);
      hits[sel] = el ? { cls: String(el.className || '').slice(0, 80), key: el.getAttribute('data-key') || '', text: (el.textContent || '').trim().slice(0, 40) } : null;
    } catch (e) { hits[sel] = 'err'; }
  });
  var headerNick = '';
  var headerSels = [
    '[class*="chat-header"]',
    '[class*="conversation-header"]',
    '[class*="buyer-name"]',
    '[class*="nick-name"]',
    '[class*="user-name"]',
  ];
  for (var i = 0; i < headerSels.length; i++) {
    var h = document.querySelector(headerSels[i]);
    if (h && (h.textContent || '').trim()) {
      headerNick = (h.textContent || '').trim().slice(0, 60);
      break;
    }
  }
  var urlInfo = {
    href: location.href,
    hash: location.hash,
    search: location.search,
  };
  var inlineState = window.__qfSfFeeInline ? {
    version: window.__qfSfFeeInline.version,
    activeSession: window.__qfSfFeeInline.getActiveSessionKey ? window.__qfSfFeeInline.getActiveSessionKey() : null,
  } : null;
  return {
    urlInfo: urlInfo,
    hits: hits,
    headerNick: headerNick,
    itemCount: items.length,
    itemClasses: items.slice(0, 5).map(function(el) {
      return {
        cls: String(el.className || ''),
        key: el.getAttribute('data-key') || '',
        uid: uidFromAppCid(el.getAttribute('data-key') || ''),
        text: (el.textContent || '').trim().slice(0, 35),
      };
    }),
    orderPanel: !!document.querySelector('.order-card, [class*="order-card"]'),
    inlineState: inlineState,
    inlineRows: document.querySelectorAll('.qsf-inline-fee-row').length,
    hasLegacyPanel: !!document.getElementById('qf-sf-fee-panel-root'),
  };
})()`;

async function main() {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const pages = list.filter((p) => p.type === 'page' && /walle\.xiaohongshu\.com/i.test(p.url || ''));
  for (const page of pages) {
    console.log('\n===', page.title, '===');
    const client = await CDP({ target: page.webSocketDebuggerUrl });
    const r = await client.Runtime.evaluate({ expression: PROBE, returnByValue: true });
    console.log(JSON.stringify(r.result?.value, null, 2));
    await client.close();
  }
}

main().catch(console.error);
