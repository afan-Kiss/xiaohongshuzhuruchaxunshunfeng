#!/usr/bin/env node
const CDP = require('chrome-remote-interface');

const EXPR = `(function(){
  var k = document.querySelector('.chat-item.active') && document.querySelector('.chat-item.active').getAttribute('data-key') || '';
  function uidFromAppCid(appCid) {
    var s = String(appCid || '').trim();
    if (!s.startsWith('$3$')) return '';
    var rest = s.slice(3);
    var dot = rest.indexOf('.');
    if (dot < 0) return '';
    try {
      var buyerRaw = atob(rest.slice(0, dot));
      var m = buyerRaw.match(/1#2#2#([0-9a-f]+)/i);
      return m ? m[1] : ('raw:' + buyerRaw);
    } catch (e) { return 'err:' + e.message; }
  }
  return { dataKey: k, buyerUserId: uidFromAppCid(k) };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => (p.title || '').includes('XY祥钰'));
  const c = await CDP({ target: page.webSocketDebuggerUrl });
  const r = await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log(r.result.value);
  await c.close();
})();
