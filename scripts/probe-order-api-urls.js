#!/usr/bin/env node
/** 监听千帆页面与订单相关的 API URL 模式（只读探测） */
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const EXPR = `(function(){
  if (window.__qsfUrlLog) return window.__qsfUrlLog.slice(-40);
  window.__qsfUrlLog = [];
  if (!window.__qsfUrlHooked) {
    window.__qsfUrlHooked = true;
    var orig = window.fetch.bind(window);
    window.fetch = function(input, init){
      var u = typeof input === 'string' ? input : (input && input.url) || '';
      if (/package|order|express|logistics|edith|walle/i.test(u)) {
        window.__qsfUrlLog.push({ t: Date.now(), u: u.slice(0, 180) });
        if (window.__qsfUrlLog.length > 80) window.__qsfUrlLog.shift();
      }
      return orig(input, init);
    };
    var xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u){
      this.__qsfUrl = u;
      return xo.apply(this, arguments);
    };
    var xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(){
      var u = this.__qsfUrl || '';
      if (/package|order|express|logistics|edith|walle/i.test(u)) {
        window.__qsfUrlLog.push({ t: Date.now(), u: String(u).slice(0, 180), xhr: true });
        if (window.__qsfUrlLog.length > 80) window.__qsfUrlLog.shift();
      }
      return xs.apply(this, arguments);
    };
  }
  return { installed: true, log: window.__qsfUrlLog.slice(-20) };
})()`;

(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((p) => isQianfanPageUrl(p.url) && (p.title || '').includes('和田雅玉'));
  if (!page) return console.log('no page');
  const c = await connectCdp(page.webSocketDebuggerUrl, 8000);
  await c.Runtime.evaluate({ expression: EXPR, returnByValue: true });
  console.log('Hook installed. Click another buyer chat in qianfan, wait 3s, then re-run with read flag.');
  await c.close();
})();
