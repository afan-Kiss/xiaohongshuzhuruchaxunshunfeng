#!/usr/bin/env node
const CDP = require('chrome-remote-interface');

const EXPR = `(async function(){
  var pid = '';
  var cards = document.querySelectorAll('.order-card');
  for (var i = 0; i < cards.length; i++) {
    pid = (cards[i].querySelector('.order-card-title-id') || {}).textContent || '';
    pid = String(pid).trim();
    if (pid) break;
  }
  if (!pid) return { err: 'no pid' };
  var urls = [
    'https://eva.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/detail',
    'https://walle.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/detail',
  ];
  for (var u of urls) {
    try {
      var r = await fetch(u, { credentials: 'include' });
      var j = await r.json();
      if (j && j.data) return { pid: pid, url: u, status: r.status, data: j.data };
      return { pid: pid, url: u, status: r.status, body: j };
    } catch (e) {}
  }
  return { err: 'all failed', pid: pid };
})()`;

(async () => {
  const titleMatch = process.argv[2] || '和田雅玉';
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes(titleMatch));
  if (!page) {
    console.log('no page for', titleMatch);
    process.exit(1);
  }
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true, awaitPromise: true });
  const v = r.result?.value || {};
  if (v.data) {
    const d = v.data;
    const summary = {
      pid: v.pid,
      url: v.url,
      keys: Object.keys(d),
      customer_pay_amount: d.customer_pay_amount,
      customerPayAmount: d.customerPayAmount,
      paid_amount: d.paid_amount,
      paidAmount: d.paidAmount,
      pay_amount: d.pay_amount,
      order_amount: d.order_amount,
      express_number: d.express_number,
      delivery_packages: Array.isArray(d.delivery_packages) ? d.delivery_packages.slice(0, 3) : d.delivery_packages,
      express_list: Array.isArray(d.express_list) ? d.express_list.slice(0, 3) : d.express_list,
      return_info_type: Array.isArray(d.return_info) ? 'array' : typeof d.return_info,
      return_info: Array.isArray(d.return_info) ? d.return_info.slice(0, 2) : d.return_info,
      package_id: d.package_id,
      id: d.id,
    };
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(JSON.stringify(v, null, 2));
  }
  await c.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
