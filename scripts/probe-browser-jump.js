#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const EXPR = `(function(){
  function parseAppCidFromUrl(url) {
    var u = String(url || '');
    var m = u.match(/[?&](?:appCid|app_cid|cid)=([^&#]+)/i);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function parseAppCidFromPageUrl() {
    try {
      var href = String(location.href || '');
      var fromQuery = parseAppCidFromUrl(href);
      if (fromQuery.indexOf('$3$') === 0) return fromQuery;
      var hash = String(location.hash || '').replace(/^#/, '');
      if (hash) {
        var candidates = [
          hash.indexOf('=') >= 0 ? '?' + hash : '',
          '?' + hash,
          hash,
        ].filter(Boolean);
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          var fromHash = parseAppCidFromUrl(c);
          if (fromHash.indexOf('$3$') === 0) return fromHash;
          var m = c.match(/\\$3\\$[^&#\\s]+/);
          if (m) return decodeURIComponent(m[0]);
        }
      }
    } catch (e) {}
    return '';
  }
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
  function scrapeHeader() {
    var ui = document.querySelector('.user-info-detail,.user-info,.chat-header-user,.buyer-info');
    if (!ui) return '';
    return String(ui.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  }
  var appCid = parseAppCidFromPageUrl();
  var strict = document.querySelector('.chat-item.active,[class*="chat-item"][class*="active"]');
  return {
    href: location.href,
    hash: location.hash,
    search: location.search,
    pathname: location.pathname,
    appCidFromUrl: appCid,
    uidFromUrl: uidFromAppCid(appCid),
    header: scrapeHeader(),
    strictActiveKey: strict ? (strict.getAttribute('data-key') || strict.getAttribute('data-app-cid') || '') : '',
    strictActiveText: strict ? String(strict.textContent || '').trim().slice(0, 40) : '',
    panelVersion: window.__qfSfFeePanel && window.__qfSfFeePanel.version,
    activeBuyer: window.__qfSfFeePanel && window.__qfSfFeePanel.getActiveBuyer ? window.__qfSfFeePanel.getActiveBuyer() : null,
    latestActive: (function(){
      try {
        var data = JSON.parse(localStorage.getItem('latestChats') || 'null');
        if (!data) return null;
        for (var k in data) {
          var arr = data[k];
          if (!Array.isArray(arr)) continue;
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].active) return { nick: arr[i].nickname, uid: arr[i].customerUserId, cid: arr[i].id };
          }
        }
      } catch (e) {}
      return null;
    })(),
    bodyPreview: (document.querySelector('#qf-sf-fee-panel-root .qsf-body') || {}).innerText
      ? document.querySelector('#qf-sf-fee-panel-root .qsf-body').innerText.slice(0, 120) : '',
    sessionStorageKeys: Object.keys(sessionStorage || {}).filter(function(k){ return /cid|chat|session|buyer/i.test(k); }).slice(0, 12),
    localStorageKeys: Object.keys(localStorage || {}).filter(function(k){ return /cid|chat|session|buyer|qianfan|walle/i.test(k); }).slice(0, 12),
  };
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const host = bot?.host || '127.0.0.1';
  const list = await (await fetch(`http://${host}:${port}/json/list`)).json();
  const pages = list.filter((p) => p.type === 'page' && /xiaohongshu/i.test(p.url || ''));
  for (const p of pages) {
    if (!(p.title || '').includes('拾玉居')) continue;
    const c = await CDP({ target: p.webSocketDebuggerUrl });
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
    console.log('===', p.title, '===');
    console.log(JSON.stringify(r.result?.value, null, 2));
    await c.close();
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
