#!/usr/bin/env node
const { connectCdp } = require('../src/cdp-connect');

const PID = process.argv[2] || 'P798535644148309221';
const EXPR = `(async function(){
  var pid = ${JSON.stringify(PID)};
  var urls = [
    'https://eva.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/detail',
    'https://eva.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/after_sale',
    'https://eva.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/returns',
    'https://eva.xiaohongshu.com/api/edith/after_sale/package/' + encodeURIComponent(pid),
    'https://walle.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/detail',
    'https://walle.xiaohongshu.com/api/edith/package/' + encodeURIComponent(pid) + '/after_sale',
  ];
  var out = [];
  for (var u of urls) {
    try {
      var r = await fetch(u, { credentials: 'include' });
      var t = await r.text();
      var j = null; try { j = JSON.parse(t); } catch {}
      var refundHits = [];
      function walk(o,d,p){
        if(!o||d>7||refundHits.length>20) return;
        if(Array.isArray(o)){o.forEach((x,i)=>walk(x,d+1,p+'['+i+']'));return;}
        if(typeof o==='object'){
          for(var k of Object.keys(o)){
            if(/refund|return_amt|apply_amount|returns_/i.test(k)){
              var v=o[k];
              refundHits.push({k:p+'.'+k,v:typeof v==='number'?v:(typeof v==='string'?v.slice(0,60):JSON.stringify(v).slice(0,80))});
            }
            walk(o[k],d+1,p+'.'+k);
          }
        }
      }
      walk(j,0,'root');
      out.push({ url: u, status: r.status, code: j && j.code, msg: j && (j.msg||j.message), refundHits: refundHits.slice(0,15) });
    } catch (e) {
      out.push({ url: u, error: String(e.message||e) });
    }
  }
  return out;
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => /dashboard/.test(p.url || ''));
  if (!page) return console.log('no page');
  const c = await connectCdp(page.webSocketDebuggerUrl, 20000);
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 2));
  await c.close();
})().catch(console.error);
