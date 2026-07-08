#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');

const EXPR = `(async function(){
  var pid = 'P798556283501269411';
  var urls = [
    'https://walle.xiaohongshu.com/api/edith/package/' + pid + '/detail',
    'https://eva.xiaohongshu.com/api/edith/package/' + pid + '/detail',
  ];
  var out = [];
  for (var u of urls) {
    try {
      var r = await fetch(u, { credentials: 'include' });
      var j = await r.json();
      var d = j.data || {};
      var hits = [];
      function walk(o, depth, path) {
        if (!o || depth > 9) return;
        if (Array.isArray(o)) { o.forEach(function(x,i){ walk(x, depth+1, path+'['+i+']'); }); return; }
        if (typeof o !== 'object') return;
        for (var k of Object.keys(o)) {
          if (/trace|logistics|route|ship|express|track|accept|time|delivery|send/i.test(k)) {
            var v = o[k];
            hits.push({ k: path+'.'+k, t: Array.isArray(v)?'arr'+v.length:typeof v, s: typeof v==='string'?v.slice(0,100): (Array.isArray(v)&&v[0]?JSON.stringify(v[0]).slice(0,150): (typeof v==='number'?v:'')) });
          }
          walk(o[k], depth+1, path+'.'+k);
        }
      }
      walk(j, 0, 'root');
      out.push({ url: u, status: r.status, ship_time: d.ship_time, ship_time_format: d.ship_time_format, express: d.express_number, hits: hits.slice(0, 35) });
    } catch (e) {
      out.push({ url: u, error: String(e.message||e) });
    }
  }
  return out;
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('拾玉居'));
  const c = await connectCdp(page.webSocketDebuggerUrl, 20000);
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})().catch(console.error);
