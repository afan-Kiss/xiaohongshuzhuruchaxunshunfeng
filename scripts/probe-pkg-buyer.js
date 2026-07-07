#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');
const EXPR = `(async function(){
  var pid = 'P798363361535472351';
  var u = 'https://walle.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/detail';
  var r = await fetch(u, { credentials: 'include' });
  var j = await r.json();
  return {
    status: r.status,
    user_id: j && j.data && j.data.user_id,
    buyer_user_id: j && j.data && j.data.buyer_user_id,
    nick: j && j.data && (j.data.nick_name || j.data.buyer_nick),
  };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('XY祥钰'));
  const c = await connectCdp(page.webSocketDebuggerUrl, 15000);
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
