/** 构建 CDP 注入脚本（auto-inject / force-reinject 共用） */
const STORAGE_KEY = 'qf_sf_fee_config_v1';

function buildPresetBootstrap(sfCfg, iconDataUrl) {
  const preset = JSON.stringify({
    partnerID: sfCfg.partnerID || '',
    checkWord: sfCfg.checkWord || '',
    checkWordSandbox: sfCfg.checkWordSandbox || '',
    phoneLast4: sfCfg.phoneLast4 || '',
    sandbox: Boolean(sfCfg.sandbox),
  });
  const iconLiteral = JSON.stringify(iconDataUrl || '');
  return `(function(){
  try {
    window.__qfSfFeeIconDataUrl = ${iconLiteral};
    var preset = ${preset};
    var key = '${STORAGE_KEY}';
    var prev = {};
    try { prev = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
    var merged = Object.assign({}, preset, prev);
    ['partnerID','checkWord','checkWordSandbox','phoneLast4'].forEach(function(k) {
      if (!merged[k] && preset[k]) merged[k] = preset[k];
    });
    if (merged.sandbox === undefined) merged.sandbox = preset.sandbox;
    if (merged.partnerID && (merged.checkWord || merged.checkWordSandbox)) {
      localStorage.setItem(key, JSON.stringify(merged));
    }
  } catch (e) {}
})();`;
}

function buildInjectSource(panelJs, sfCfg, iconDataUrl) {
  return `${buildPresetBootstrap(sfCfg, iconDataUrl)}\n${panelJs}`;
}

function isQianfanPageUrl(url) {
  const u = String(url || '').toLowerCase();
  return u.includes('walle.xiaohongshu.com') || u.includes('edith.xiaohongshu.com');
}

module.exports = {
  STORAGE_KEY,
  buildInjectSource,
  buildPresetBootstrap,
  isQianfanPageUrl,
};
