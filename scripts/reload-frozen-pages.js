#!/usr/bin/env node
/** 刷新卡死的千帆页面：evaluate 无响应时用 DevTools HTTP 关闭标签 */
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const PING = '({ ok: true, t: Date.now() })';

async function closeViaHttp(host, port, pageId) {
  const res = await fetch(`http://${host}:${port}/json/close/${pageId}`, {
    signal: AbortSignal.timeout(5000),
  });
  return res.text();
}

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(bot?.host || '127.0.0.1').trim();
  const port = Number(bot?.port || 9223);
  const list = await (await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const pages = list.filter((p) => p.type === 'page' && p.webSocketDebuggerUrl && isQianfanPageUrl(p.url));
  for (const page of pages) {
    let client;
    let frozen = false;
    try {
      client = await connectCdp(page.webSocketDebuggerUrl, 5000);
      await Promise.race([
        client.Runtime.evaluate({ expression: PING, returnByValue: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('frozen')), 3000)),
      ]);
      console.log(page.title, 'alive');
    } catch (e) {
      frozen = true;
      console.log(page.title, 'frozen → close tab');
    } finally {
      if (client) await client.close().catch(() => {});
    }
    if (frozen && page.id) {
      try {
        const msg = await closeViaHttp(host, port, page.id);
        console.log(page.title, msg.trim());
      } catch (err) {
        console.log(page.title, 'close fail:', err.message);
      }
    }
  }
  console.log('done — 请在千帆里重新打开店铺工作台');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
