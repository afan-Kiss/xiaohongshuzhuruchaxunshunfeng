#!/usr/bin/env node
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');

const EXPR = `(function(){
  var p = document.getElementById('qf-sf-fee-panel-root');
  if (!p) return { err: 'no panel' };
  if (window.__qfSfFeePanel?.syncSession) window.__qfSfFeePanel.syncSession();
  p.classList.remove('qsf-icon-only');
  p.classList.add('qsf-expanded');
  if (typeof window.__qfSfExpandPanel === 'function') {
    window.__qfSfExpandPanel();
  } else {
    p.style.left = 'auto';
    p.style.top = '0';
    p.style.right = '0';
    p.style.bottom = '0';
    document.documentElement.classList.add('qsf-page-docked');
    document.documentElement.style.setProperty('--qsf-dock-width', '300px');
    document.body?.classList.add('qsf-page-docked');
  }
  var pr = p.getBoundingClientRect();
  var app = document.querySelector('#app') || document.querySelector('.farmer-chat');
  var right = document.querySelector('.new-right-panel') || document.querySelector('.order-tool-container') || document.querySelector('.farmer-chat__right');
  var html = document.documentElement;
  var cs = getComputedStyle(html);
  var ancestors = [];
  var el = p;
  while (el && el !== document.documentElement) {
    var st = getComputedStyle(el);
    if (st.transform !== 'none' || st.filter !== 'none' || st.perspective !== 'none' || st.contain === 'paint') {
      ancestors.push({ tag: el.tagName, id: el.id, cls: (el.className||'').slice(0,60), transform: st.transform, filter: st.filter });
    }
    el = el.parentElement;
  }
  return {
    version: window.__qfSfFeePanel?.version,
    parent: p.parentElement?.nodeName,
    panel: { left: pr.left, right: pr.right, width: pr.width, top: pr.top, bottom: pr.bottom },
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    htmlMarginRight: cs.marginRight,
    htmlPaddingRight: cs.paddingRight,
    htmlClass: html.classList.contains('qsf-page-docked'),
    app: app ? { cls: String(app.className||'').slice(0,80), width: app.getBoundingClientRect().width, right: app.getBoundingClientRect().right, left: app.getBoundingClientRect().left } : null,
    rightPanel: right ? { cls: String(right.className||'').slice(0,80), rect: { left: right.getBoundingClientRect().left, right: right.getBoundingClientRect().right, width: right.getBoundingClientRect().width } } : null,
    hasOrderCards: !!p.querySelector('.qsf-order-card'),
    bodyPreview: p.querySelector('.qsf-body')?.innerText?.slice(0, 200),
    fixedAncestors: ancestors
  };
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9322;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pages = list.filter((p) => p.type === 'page' && (p.url || '').includes('walle.xiaohongshu.com'));
  for (const page of pages.slice(0, 2)) {
    const c = await connectCdp(page.webSocketDebuggerUrl, 8000);
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
    console.log('\n===', page.title, '===');
    console.log(JSON.stringify(r.result?.value, null, 2));
    await c.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
