#!/usr/bin/env node
/** 诊断丰桥签名：对比多种签名方式 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
const sf = cfg.sf || {};
const waybill = process.argv[2] || 'SF0218863429615';
const useSandbox = process.argv.includes('--sandbox');

const partnerID = sf.partnerID;
const checkWord = useSandbox ? (sf.checkWordSandbox || sf.checkWord) : sf.checkWord;
const url = useSandbox
  ? 'https://sfapi-sbox.sf-express.com/std/service'
  : 'https://sfapi.sf-express.com/std/service';

function sfUrlEncode(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charAt(i);
    const enc = encodeURIComponent(c);
    out += enc === c ? c : enc.replace(/%([0-9a-f]{2})/gi, (_, h) => `%${h.toUpperCase()}`);
  }
  return out;
}

function digest(mode, msgData, timestamp, word) {
  const concat = String(msgData) + String(timestamp) + String(word);
  const raw = mode === 'urlencode' ? sfUrlEncode(concat) : concat;
  return crypto.createHash('md5').update(raw, 'utf8').digest('base64');
}

async function call(mode, msgData) {
  const timestamp = Date.now();
  const msgDigest = digest(mode, msgData, timestamp, checkWord);
  const body = new URLSearchParams({
    partnerID,
    requestID: crypto.randomUUID().replace(/-/g, ''),
    serviceCode: 'EXP_RECE_QUERY_SFWAYBILL',
    timestamp: String(timestamp),
    msgDigest,
    msgData,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: body.toString(),
  });
  const text = await res.text();
  let code = '?';
  try {
    code = JSON.parse(text).apiResultCode || JSON.parse(text).apiErrorMsg;
  } catch {
    code = text.slice(0, 80);
  }
  return { mode, msgData, code, text: text.slice(0, 200) };
}

async function main() {
  console.log('env:', useSandbox ? 'sandbox' : 'production');
  console.log('partnerID:', partnerID);
  console.log('checkWord len:', checkWord.length);
  console.log('waybill:', waybill);
  console.log('');

  const payloads = [
    JSON.stringify({ trackingType: '2', trackingNum: waybill }),
    JSON.stringify({ trackingNum: waybill, trackingType: '2' }),
    JSON.stringify({ trackingType: '1', trackingNum: 'LFCN0007556700' }),
  ];

  for (const msgData of payloads) {
    for (const mode of ['urlencode', 'plain']) {
      const r = await call(mode, msgData);
      console.log(`[${mode}] ${msgData.slice(0, 60)} => ${r.code}`);
      if (!String(r.code).includes('A1006')) console.log('  ', r.text);
    }
  }
}

main().catch(console.error);
