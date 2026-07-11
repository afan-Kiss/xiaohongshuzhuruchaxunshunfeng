#!/usr/bin/env node
const CDP = require('chrome-remote-interface');

const EXPR = `(async function(){
  const card = document.querySelector('.order-card');
  if (!card) return { err: 'no card' };
  const html = card.innerHTML || '';
  const ridM = html.match(/\\b(R\\d{10,})\\b/);
  const pid = card.querySelector('.order-card-title-id')?.textContent?.trim() || '';
  const shopTitle = String(document.title || '').replace(/-工作台\\s*$/, '').trim();
  const port = Number(window.__qfPackageProxyPort || 4725);
  const qs = new URLSearchParams({ returnsId: ridM ? ridM[1] : '', packageId: pid, shopTitle });
  const url = 'http://127.0.0.1:' + port + '/after-sale?' + qs.toString();
  let proxy = null;
  try {
    const r = await fetch(url);
    proxy = await r.json();
  } catch (e) {
    proxy = { fetchErr: String(e.message || e) };
  }
  const raw = proxy?.data?.after_sale || proxy?.data || null;
  const amountFields = raw ? {
    applied_amount: raw.applied_amount,
    expected_refund_amount: raw.expected_refund_amount,
    applied_skus_amount_sum: raw.applied_skus_amount_sum,
    applied_ship_fee_amount: raw.applied_ship_fee_amount,
    expect_refund_fee: raw.expect_refund_fee,
    refund_fee: raw.refund_fee,
  } : null;
  return {
    version: window.__qfSfFeeInline?.version,
    pid,
    returnsId: ridM && ridM[1],
    shopTitle,
    url,
    proxyOk: proxy?.ok,
    proxyError: proxy?.error,
    amountFields,
    proxyDataKeys: proxy?.data ? Object.keys(proxy.data) : null,
  };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const pages = list.filter((p) => /dashboard/.test(p.url || '') || /工作台/.test(p.title || ''));
  if (!pages.length) {
    console.log('no dashboard page');
    return;
  }
  for (const page of pages.slice(0, 3)) {
    console.log('---', page.title);
    const c = await CDP({ target: page.webSocketDebuggerUrl });
    const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(r.result?.value, null, 2));
    await c.close();
  }
})().catch(console.error);
