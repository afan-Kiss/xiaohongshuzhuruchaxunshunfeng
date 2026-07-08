const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

function loadConfig() {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    /* ignore */
  }
  const sf = fileCfg.sf || {};
  return {
    sf: {
      partnerID: String(process.env.SF_PARTNER_ID || sf.partnerID || '').trim(),
      checkWord: String(process.env.SF_CHECK_WORD || sf.checkWord || '').trim(),
      checkWordSandbox: String(process.env.SF_CHECK_WORD_SANDBOX || sf.checkWordSandbox || '').trim(),
      phoneLast4: String(process.env.SF_PHONE_LAST4 || sf.phoneLast4 || '').trim(),
      monthlyCard: String(process.env.SF_MONTHLY_CARD || sf.monthlyCard || '').trim(),
      sandbox: process.env.SF_SANDBOX === '1' || process.env.SF_SANDBOX === 'true' || Boolean(sf.sandbox),
    },
    webPort: Number(process.env.PORT || process.env.SF_FEE_WEB_PORT || fileCfg.sfFeeWebPort || 6666),
    basePath: String(process.env.SF_FEE_BASE_PATH || '/shunfengchafeiyong').replace(/\/$/, '') || '/shunfengchafeiyong',
  };
}

module.exports = { loadConfig, CONFIG_PATH, ROOT };
