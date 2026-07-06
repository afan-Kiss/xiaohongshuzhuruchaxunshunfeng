#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');

const EXPR = `(function(){
  var panel = document.getElementById('qf-sf-fee-panel-root');
  var body = panel && panel.querySelector('.qsf-body');
  var active = document.querySelector('.chat-item.active');
  var root = document.querySelector('[class*="order-detail"],[class*="orderDetail"],[class*="package-list"],[class*="right-content"]');
  return {
    version: window.__qfSfFeePanel?.version,
    bodyText: body ? body.innerText.slice(0, 500) : '',
    buyerTrace: document.querySelector('.qsf-buyer-trace')?.innerText || '',
    buyerNick: document.querySelector('.qsf-buyer-nick')?.innerText || '',
    expanded: panel?.classList.contains('qsf-expanded'),
    activeKey: active?.getAttribute('data-key')?.slice(0, 40) || '',
    orderPanel: root ? root.className.slice(0, 80) : null,
    orderPanelText: root ? root.innerText.slice(0, 400) : null,
  };
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const port = bot?.port || 9223;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pages = list.filter((p) => p.type === 'page' && (p.url || '').includes('walle.xiaohongshu.com'));
  for (const page of pages.slice(0, 3)) {
    const c = await CDP({ target: page.webSocketDebuggerUrl });
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
    console.log('\n===', page.title, '===');
    console.log(JSON.stringify(r.result?.value, null, 2));
    await c.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
