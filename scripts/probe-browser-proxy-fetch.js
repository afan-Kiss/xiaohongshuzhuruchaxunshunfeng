#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const EXPR = `(async function(){
  var out = {};
  try {
    var h = await fetch('http://127.0.0.1:4725/health');
    out.health = { ok: h.ok, status: h.status, body: await h.text() };
  } catch (e) { out.health = { error: String(e.message||e) }; }
  try {
    var p = await fetch('http://127.0.0.1:4725/package-detail?packageId=P798434418773022311&shopKey=shiyuju');
    var j = await p.json();
    out.pkg = { ok: j.ok, express: j.data && j.data.express_number, error: j.error };
  } catch (e) { out.pkg = { error: String(e.message||e) }; }
  return out;
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('拾玉居'));
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})();
