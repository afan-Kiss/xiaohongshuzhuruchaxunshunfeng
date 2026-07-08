#!/usr/bin/env node
/** 在千帆页面内实测丰桥签名 + 清缓存 */
const fs = require('fs');
const path = require('path');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).sf;

const PROBE = `(async function(){
  var cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('qf_sf_fee_config_v1') || '{}'); } catch (e) {}
  var waybill = 'SF0218863429615';
  function md5Bytes(str) {
    function cmn(q,a,b,x,s,t){a=(a+q+x+t)|0;return(((a<<s)|(a>>>(32-s)))+b)|0;}
    function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t);}
    function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t);}
    function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);}
    function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t);}
    var state=[1732584193,-271733879,-1732584194,271733878];
    var bytes=new TextEncoder().encode(String(str));
    var bitLen=bytes.length*8;
    var withOne=bytes.length+1;
    var padLen=withOne%64<=56?56-withOne%64:120-withOne%64;
    var total=withOne+padLen+8;
    var buf=new Uint8Array(total);
    buf.set(bytes);buf[bytes.length]=0x80;
    var view=new DataView(buf.buffer);
    view.setUint32(total-8,bitLen,true);view.setUint32(total-4,Math.floor(bitLen/0x100000000),true);
    for(var off=0;off<total;off+=64){
      var rest=[];for(var i=0;i<16;i++)rest[i]=view.getUint32(off+i*4,true);
      var a=state[0],b=state[1],c=state[2],d=state[3];
      a=ff(a,b,c,d,rest[0],7,-680876936);d=ff(d,a,b,c,rest[1],12,-389564586);c=ff(c,d,a,b,rest[2],17,606105819);b=ff(b,c,d,a,rest[3],22,-1044525330);
      a=ff(a,b,c,d,rest[4],7,-176418897);d=ff(d,a,b,c,rest[5],12,1200080426);c=ff(c,d,a,b,rest[6],17,-1473231341);b=ff(b,c,d,a,rest[7],22,-45705983);
      a=ff(a,b,c,d,rest[8],7,1770035416);d=ff(d,a,b,c,rest[9],12,-1958414417);c=ff(c,d,a,b,rest[10],17,-42063);b=ff(b,c,d,a,rest[11],22,-1990404162);
      a=ff(a,b,c,d,rest[12],7,1804603682);d=ff(d,a,b,c,rest[13],12,-40341101);c=ff(c,d,a,b,rest[14],17,-1502002290);b=ff(b,c,d,a,rest[15],22,1236535329);
      a=gg(a,b,c,d,rest[1],5,-165796510);d=gg(d,a,b,c,rest[6],9,-1069501632);c=gg(c,d,a,b,rest[11],14,643717713);b=gg(b,c,d,a,rest[0],20,-373897302);
      a=gg(a,b,c,d,rest[5],5,-701558691);d=gg(d,a,b,c,rest[10],9,38016083);c=gg(c,d,a,b,rest[15],14,-660478335);b=gg(b,c,d,a,rest[4],20,-405537848);
      a=gg(a,b,c,d,rest[9],5,568446438);d=gg(d,a,b,c,rest[14],9,-1019803690);c=gg(c,d,a,b,rest[3],14,-187363961);b=gg(b,c,d,a,rest[8],20,1163531501);
      a=gg(a,b,c,d,rest[13],5,-1444681467);d=gg(d,a,b,c,rest[2],9,-51403784);c=gg(c,d,a,b,rest[7],14,1735328473);b=gg(b,c,d,a,rest[12],20,-1926607734);
      a=hh(a,b,c,d,rest[5],4,-378558);d=hh(d,a,b,c,rest[8],11,-2022574463);c=hh(c,d,a,b,rest[11],16,1839030562);b=hh(b,c,d,a,rest[14],23,-35309556);
      a=hh(a,b,c,d,rest[1],4,-1530992060);d=hh(d,a,b,c,rest[4],11,1272893353);c=hh(c,d,a,b,rest[7],16,-155497632);b=hh(b,c,d,a,rest[10],23,-1094730640);
      a=hh(a,b,c,d,rest[13],4,681279174);d=hh(d,a,b,c,rest[0],11,-358537222);c=hh(c,d,a,b,rest[3],16,-722521979);b=hh(b,c,d,a,rest[6],23,76029189);
      a=hh(a,b,c,d,rest[9],4,-640364487);d=hh(d,a,b,c,rest[12],11,-421815835);c=hh(c,d,a,b,rest[15],16,530742520);b=hh(b,c,d,a,rest[2],23,-995338651);
      a=ii(a,b,c,d,rest[0],6,-198630844);d=ii(d,a,b,c,rest[7],10,1126891415);c=ii(c,d,a,b,rest[14],15,-1416354905);b=ii(b,c,d,a,rest[5],21,-57434055);
      a=ii(a,b,c,d,rest[12],6,1700485571);d=ii(d,a,b,c,rest[3],10,-1894986606);c=ii(c,d,a,b,rest[10],15,-1051523);b=ii(b,c,d,a,rest[1],21,-2054922799);
      a=ii(a,b,c,d,rest[8],6,1873313359);d=ii(d,a,b,c,rest[15],10,-30611744);c=ii(c,d,a,b,rest[6],15,-1560198380);b=ii(b,c,d,a,rest[13],21,1309151649);
      a=ii(a,b,c,d,rest[4],6,-145523070);d=ii(d,a,b,c,rest[11],10,-1120210379);c=ii(c,d,a,b,rest[2],15,718787259);b=ii(b,c,d,a,rest[9],21,-343485551);
      state[0]=(state[0]+a)|0;state[1]=(state[1]+b)|0;state[2]=(state[2]+c)|0;state[3]=(state[3]+d)|0;
    }
    var out=new Uint8Array(16);
    for(var k=0;k<4;k++){out[k*4]=state[k]&255;out[k*4+1]=(state[k]>>8)&255;out[k*4+2]=(state[k]>>16)&255;out[k*4+3]=(state[k]>>24)&255;}
    return out;
  }
  function digest(msgData, ts, word){
    var raw=String(msgData)+String(ts)+String(word);
    var bytes=md5Bytes(raw);var bin='';for(var i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);return btoa(bin);
  }
  var checkWord = cfg.sandbox ? (cfg.checkWordSandbox||'') : (cfg.checkWord||'');
  var msgData = JSON.stringify({trackingType:'2',trackingNum:waybill,monthlyCard:cfg.monthlyCard||''});
  var ts = Date.now();
  var body = new URLSearchParams({
    partnerID: cfg.partnerID||'',
    requestID: crypto.randomUUID().replace(/-/g,''),
    serviceCode: 'EXP_RECE_QUERY_SFWAYBILL',
    timestamp: String(ts),
    msgDigest: digest(msgData, ts, checkWord),
    msgData: msgData,
  });
  var url = cfg.sandbox ? 'https://sfapi-sbox.sf-express.com/std/service' : 'https://sfapi.sf-express.com/std/service';
  var res = await fetch(url, {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}, body: body.toString()});
  var text = await res.text();
  var outer = JSON.parse(text);
  var inner = {};
  try { inner = JSON.parse(outer.apiResultData||'{}'); } catch(e) {}
  return {
    cfg: { partnerID: cfg.partnerID, sandbox: cfg.sandbox, checkWordLen: (checkWord||'').length, monthlyCard: cfg.monthlyCard },
    outerCode: outer.apiResultCode,
    outerErr: outer.apiErrorMsg,
    innerCode: inner.errorCode,
    innerErr: inner.errorMsg,
    ok: inner.success === true || inner.success === 'true',
    fee: inner.msgData && inner.msgData.waybillFeeList && inner.msgData.waybillFeeList[0] && inner.msgData.waybillFeeList[0].value,
  };
})()`;

const CLEAR = `(function(){
  try {
    localStorage.removeItem('qf_sf_fee_buyer_cache_v1');
    sessionStorage.removeItem('qsf_fee_cache_ver');
  } catch (e) {}
  return true;
})()`;

(async () => {
  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(cfg.devtoolsHost || bot?.host || '127.0.0.1').trim();
  const port = Number(cfg.devtoolsPort || bot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9223);
  const list = await (await fetch(`http://${host}:${port}/json/list`)).json();
  const page = list.find((p) => p.type === 'page' && isQianfanPageUrl(p.url) && /拾玉居|和田/.test(p.title || ''));
  if (!page) { console.log('no page'); return; }
  const client = await connectCdp(page.webSocketDebuggerUrl, 8000);
  try {
    await client.Runtime.evaluate({ expression: CLEAR, returnByValue: true });
    const r = await client.Runtime.evaluate({ expression: PROBE, awaitPromise: true, returnByValue: true });
    console.log(page.title, JSON.stringify(r.result?.value, null, 2));
  } finally {
    await client.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
