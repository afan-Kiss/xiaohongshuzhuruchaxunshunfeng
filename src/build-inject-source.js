/** 构建 CDP 注入脚本（auto-inject / force-reinject 共用） */
const STORAGE_KEY = 'qf_sf_fee_config_v1';

function buildPresetBootstrap(sfCfg, extra = {}) {
  const proxyPort = Number(extra.packageProxyPort || sfCfg.packageProxyPort || 4725);
  const dataCoreMode = String(extra.dataCoreMode || 'core-only');
  return `(function(){
  try {
    window.__qfPackageProxyPort = ${proxyPort};
    window.__qfDataCoreMode = ${JSON.stringify(dataCoreMode)};
  } catch (e) {}
})();`;
}

function buildInjectSource(inlineJs, sfCfg, extra = {}) {
  return `${buildPresetBootstrap(sfCfg, extra)}\n${inlineJs}`;
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
