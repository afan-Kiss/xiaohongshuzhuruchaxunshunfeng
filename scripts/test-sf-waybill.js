#!/usr/bin/env node
/** 测试丰桥清单运费查询 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
const sf = cfg.sf || {};
const waybill = process.argv[2] || 'SF5115411160725';
const useSandbox = process.argv.includes('--sandbox');

const partnerID = sf.partnerID;
const checkWord = useSandbox ? sf.checkWordSandbox : sf.checkWord;
const url = useSandbox
  ? 'https://sfapi-sbox.sf-express.com/std/service'
  : 'https://sfapi.sf-express.com/std/service';

function sfMsgDigest(msgData, timestamp, word) {
  const raw = String(msgData) + String(timestamp) + String(word);
  const md5 = crypto.createHash('md5').update(raw, 'utf8').digest();
  return md5.toString('base64');
}

async function query() {
  const msgData = JSON.stringify({ trackingType: '2', trackingNum: waybill });
  const timestamp = Date.now();
  const msgDigest = sfMsgDigest(msgData, timestamp, checkWord);
  const body = new URLSearchParams({
    partnerID,
    requestID: crypto.randomUUID().replace(/-/g, ''),
    serviceCode: 'EXP_RECE_QUERY_SFWAYBILL',
    timestamp: String(timestamp),
    msgDigest,
    msgData,
  });

  console.log('env:', useSandbox ? 'sandbox' : 'production');
  console.log('partnerID:', partnerID);
  console.log('waybill:', waybill);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: body.toString(),
  });
  const text = await res.text();
  console.log('HTTP', res.status);
  console.log(text.slice(0, 2000));

  try {
    const outer = JSON.parse(text);
    if (typeof outer.apiResultData === 'string') {
      console.log('\n--- apiResultData ---');
      console.log(JSON.stringify(JSON.parse(outer.apiResultData), null, 2));
    }
  } catch {
    /* ignore */
  }
}

query().catch(console.error);
