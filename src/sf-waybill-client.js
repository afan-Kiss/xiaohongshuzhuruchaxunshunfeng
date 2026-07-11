/** 丰桥清单运费查询 EXP_RECE_QUERY_SFWAYBILL */
const crypto = require('crypto');

const SF_PROD = 'https://sfapi.sf-express.com/std/service';
const SF_SBOX = 'https://sfapi-sbox.sf-express.com/std/service';

function sfMsgDigest(msgData, timestamp, checkWord) {
  const raw = String(msgData) + String(timestamp) + String(checkWord);
  const md5 = crypto.createHash('md5').update(raw, 'utf8').digest();
  return md5.toString('base64');
}

function buildMsgData(waybill, cfg) {
  const payload = {
    trackingType: '2',
    trackingNum: String(waybill || '').trim().toUpperCase(),
  };
  const phone = String(cfg.phoneLast4 || '').trim();
  if (phone) payload.phone = phone;
  const card = String(cfg.monthlyCard || '').trim();
  if (card) payload.monthlyCard = card;
  return JSON.stringify(payload);
}

function resolveCheckWord(cfg) {
  if (cfg.sandbox) return String(cfg.checkWordSandbox || cfg.checkWord || '').trim();
  return String(cfg.checkWord || '').trim();
}

function parseFeeResult(waybill, outer, inner) {
  const outerCode = String(outer?.apiResultCode || '').trim();
  if (outerCode && outerCode !== 'A1000') {
    return {
      waybill,
      ok: false,
      error: outer.apiErrorMsg || `丰桥外层错误 ${outerCode}`,
      apiCode: outerCode,
      totalFee: null,
    };
  }
  if (!inner || (inner.success !== true && inner.success !== 'true')) {
    const code = String(inner?.errorCode || outerCode || '').trim();
    let error = inner?.errorMsg || outer?.apiErrorMsg || '查询失败';
    if (code === '8151' || /没有传入月结卡号/.test(error)) {
      error = '未关联月结卡号（8151），请确认 config.json 中 monthlyCard 已配置';
    } else if (code === '8148' || /没有运单信息/.test(error)) {
      error = '丰桥查不到该运单月结费用（8148），可能非本账号月结发货';
    } else if (code === 'A1006' || /数字签名无效/.test(error)) {
      error = '数字签名无效（A1006），请核对顾客编码与校验码、环境（沙箱/生产）';
    }
    return { waybill, ok: false, error, apiCode: code, totalFee: null };
  }
  const data = inner.msgData || inner;
  const info = data.waybillInfo || {};
  const fees = data.waybillFeeList || [];
  const total = fees.reduce((s, f) => s + (Number(f.feeAmt ?? f.value) || 0), 0)
    || Number(info.totalFee)
    || null;
  const feeItems = fees.map((f) => ({
    name: f.feeName || f.name || '费用',
    amount: Number(f.feeAmt ?? f.value) || 0,
    settlement: f.settlementTypeCode === '2' ? '月结' : f.settlementTypeCode === '1' ? '现结' : '',
  }));
  return {
    waybill: info.waybillNo || waybill,
    ok: true,
    totalFee: total,
    fees: feeItems,
    customerAcctCode: info.customerAcctCode || '',
    meterageWeightQty: info.meterageWeightQty,
    realWeightQty: info.realWeightQty,
    jProvince: info.jProvince || info.sourceProvince || '',
    jCity: info.jCity || info.sourceCity || '',
    dProvince: info.dProvince || info.addresseeProvince || '',
    dCity: info.dCity || info.addresseeCity || '',
    expressTypeCode: info.expressTypeCode || '',
    apiCode: 'S0000',
  };
}

async function querySfWaybillFee(waybill, cfg, signal) {
  const no = String(waybill || '').trim().toUpperCase();
  if (!/^SF\d{10,}$/.test(no)) {
    return { waybill: no, ok: false, error: '非顺丰运单号（需 SF 开头）', totalFee: null };
  }
  const partnerID = String(cfg.partnerID || '').trim();
  const checkWord = resolveCheckWord(cfg);
  if (!partnerID || !checkWord) {
    return { waybill: no, ok: false, error: '未配置 partnerID / checkWord', totalFee: null };
  }
  if (!cfg.sandbox && !String(cfg.monthlyCard || '').trim()) {
    return { waybill: no, ok: false, error: '生产环境需配置 monthlyCard 月结卡号', totalFee: null };
  }

  const msgData = buildMsgData(no, cfg);
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
  const url = cfg.sandbox ? SF_SBOX : SF_PROD;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
      signal: signal || AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let outer;
    try {
      outer = JSON.parse(text);
    } catch {
      return { waybill: no, ok: false, error: `响应非 JSON：${text.slice(0, 120)}`, totalFee: null };
    }
    let inner = outer;
    if (typeof outer.apiResultData === 'string') {
      try {
        inner = JSON.parse(outer.apiResultData);
      } catch {
        inner = { success: false, errorMsg: 'apiResultData 解析失败' };
      }
    }
    return parseFeeResult(no, outer, inner);
  } catch (err) {
    return { waybill: no, ok: false, error: String(err.message || err), totalFee: null };
  }
}

async function querySfWaybillFees(waybills, cfg, opts = {}) {
  const list = [...new Set((waybills || []).map((w) => String(w || '').trim().toUpperCase()).filter(Boolean))];
  const concurrency = Math.max(1, Math.min(Number(opts.concurrency) || 4, 8));
  const delayMs = Math.max(0, Number(opts.delayMs) || 80);
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < list.length) {
      const i = idx;
      idx += 1;
      const waybill = list[i];
      const row = await querySfWaybillFee(waybill, cfg);
      results[i] = row;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));
  return results;
}

module.exports = {
  querySfWaybillFee,
  querySfWaybillFees,
  sfMsgDigest,
  resolveCheckWord,
};
