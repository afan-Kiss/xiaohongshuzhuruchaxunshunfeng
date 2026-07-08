/** 构建 CDP 注入脚本（auto-inject / force-reinject 共用） */
const STORAGE_KEY = 'qf_sf_fee_config_v1';

function buildPresetBootstrap(sfCfg, iconDataUrl, extra = {}) {
  const preset = {
    partnerID: String(sfCfg.partnerID || '').trim(),
    checkWord: String(sfCfg.checkWord || '').trim(),
    checkWordSandbox: String(sfCfg.checkWordSandbox || '').trim(),
    phoneLast4: String(sfCfg.phoneLast4 || '').trim(),
    monthlyCard: String(sfCfg.monthlyCard || '').trim(),
    sandbox: Boolean(sfCfg.sandbox),
  };
  const presetJson = JSON.stringify(preset);
  const iconLiteral = JSON.stringify(iconDataUrl || '');
  const proxyPort = Number(extra.packageProxyPort || sfCfg.packageProxyPort || 4725);
  return `(function(){
  try {
    window.__qfSfFeeIconDataUrl = ${iconLiteral};
    window.__qfPackageProxyPort = ${proxyPort};
    window.__qfSfFeePreset = ${presetJson};
    var preset = ${presetJson};
    var key = '${STORAGE_KEY}';
    var prev = {};
    try { prev = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
    var merged = Object.assign({}, prev, preset);
    Object.keys(preset).forEach(function(k) { merged[k] = preset[k]; });
    merged.sandbox = !!preset.sandbox;
    localStorage.setItem(key, JSON.stringify(merged));
    try { localStorage.removeItem('qf_sf_fee_buyer_cache_v1'); } catch (e) {}
    try { sessionStorage.removeItem('qsf_fee_cache_ver'); } catch (e) {}
  } catch (e) {}
})();`;
}

function buildInjectSource(panelJs, sfCfg, iconDataUrl, extra = {}) {
  return `${buildPresetBootstrap(sfCfg, iconDataUrl, extra)}\n${panelJs}`;
}

function isQianfanPageUrl(url) {
  const u = String(url || '').toLowerCase();
  return u.includes('walle.xiaohongshu.com')
    || u.includes('edith.xiaohongshu.com')
    || u.includes('eva.xiaohongshu.com');
}

module.exports = {
  STORAGE_KEY,
  buildInjectSource,
  buildPresetBootstrap,
  isQianfanPageUrl,
};
