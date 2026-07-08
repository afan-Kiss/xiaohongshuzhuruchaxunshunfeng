/** CDP 注入：优先热更新，必要时硬重注入并保留侧栏展开状态 */

const TEARDOWN_EXPR = `(function(){
  try {
    if (window.__qfSfFeePanel?.teardown) window.__qfSfFeePanel.teardown();
    delete window.__qfSfFeePanel;
    document.getElementById('qf-sf-fee-panel-root')?.remove();
    document.getElementById('qf-sf-fee-panel-style')?.remove();
    document.documentElement.classList.remove('qsf-page-docked');
    document.body?.classList.remove('qsf-page-docked');
    if (window.__qfSfFeeNativeFetch) window.fetch = window.__qfSfFeeNativeFetch;
    if (window.__qfSfFeeNativeXhrOpen) XMLHttpRequest.prototype.open = window.__qfSfFeeNativeXhrOpen;
    if (window.__qfSfFeeNativeXhrSend) XMLHttpRequest.prototype.send = window.__qfSfFeeNativeXhrSend;
    delete window.__qfSfFeeFetchHooked;
    delete window.__qfSfFeeXhrHooked;
  } catch (e) {}
})()`;

const CAPTURE_UI_EXPR = `(function(){
  try {
    var p = document.getElementById('qf-sf-fee-panel-root');
    var pinned = sessionStorage.getItem('qsf_panel_pinned_v1') === '1';
    var expanded = !!(p && p.classList.contains('qsf-expanded'));
    return { pinned: pinned, expanded: expanded, keepOpen: pinned || expanded };
  } catch (e) {
    return { pinned: false, expanded: false, keepOpen: false };
  }
})()`;

const RESTORE_EXPANDED_EXPR = `(function(){
  try {
    if (window.__qfSfExpandPanel) {
      window.__qfSfExpandPanel();
      return true;
    }
    var p = document.getElementById('qf-sf-fee-panel-root');
    if (p) {
      p.classList.remove('qsf-icon-only');
      p.classList.add('qsf-expanded');
    }
    return !!p;
  } catch (e) {
    return false;
  }
})()`;

const RESTORE_PINNED_EXPR = `(function(){
  try {
    sessionStorage.setItem('qsf_panel_pinned_v1', '1');
    if (window.__qfSfExpandPanel) {
      window.__qfSfExpandPanel();
      return true;
    }
    var p = document.getElementById('qf-sf-fee-panel-root');
    if (p) {
      p.classList.remove('qsf-icon-only');
      p.classList.add('qsf-expanded');
    }
    return !!p;
  } catch (e) {
    return false;
  }
})()`;

const VERSION_PROBE_EXPR = `(function(){
  var p = document.getElementById('qf-sf-fee-panel-root');
  var ver = document.querySelector('#qf-sf-fee-panel-root .qsf-ver');
  var footer = ver ? String(ver.textContent || '').trim() : '';
  return {
    version: window.__qfSfFeePanel && window.__qfSfFeePanel.version,
    hasPanel: !!p,
    footerVersion: footer,
    hasPatch: !!(window.__qfSfFeePanel && window.__qfSfFeePanel.patchVersionLabels),
  };
})()`;

async function evaluate(client, expression, opts = {}) {
  const { Runtime } = client;
  return Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: Boolean(opts.awaitPromise),
  });
}

async function softInjectPage(client, source, expectedVersion) {
  await evaluate(client, source, { awaitPromise: true });
  if (!expectedVersion) return true;
  const probe = await evaluate(client, `(function(){
    var ver = document.querySelector('#qf-sf-fee-panel-root .qsf-ver');
    return {
      version: window.__qfSfFeePanel && window.__qfSfFeePanel.version,
      hasPanel: !!document.getElementById('qf-sf-fee-panel-root'),
      footerVersion: ver ? String(ver.textContent || '').trim() : '',
      hasPatch: !!(window.__qfSfFeePanel && window.__qfSfFeePanel.patchVersionLabels),
    };
  })()`);
  const info = probe.result?.value || {};
  const wantFooter = 'v' + expectedVersion;
  return info.version === expectedVersion && info.hasPanel && info.footerVersion === wantFooter && info.hasPatch;
}

async function hardInjectPage(client, source, options = {}) {
  const { Page } = client;
  let keepOpen = false;
  let wasPinned = false;
  if (options.preserveUi !== false) {
    const cap = await evaluate(client, CAPTURE_UI_EXPR);
    wasPinned = Boolean(cap.result?.value?.pinned);
    keepOpen = Boolean(cap.result?.value?.keepOpen);
  }
  await evaluate(client, TEARDOWN_EXPR);
  if (options.registerOnNewDocument) {
    await Page.addScriptToEvaluateOnNewDocument({ source });
  }
  await evaluate(client, source, { awaitPromise: true });
  if (keepOpen) {
    await evaluate(client, wasPinned ? RESTORE_PINNED_EXPR : RESTORE_EXPANDED_EXPR, { awaitPromise: true });
  }
  return true;
}

async function injectPage(client, source, options = {}) {
  const { softFirst = true, expectedVersion = '', registerOnNewDocument = false } = options;
  if (softFirst) {
    try {
      const ok = await softInjectPage(client, source, expectedVersion);
      if (ok) return { mode: 'soft' };
    } catch {
      /* fall through */
    }
  }
  await hardInjectPage(client, source, { registerOnNewDocument, preserveUi: true });
  return { mode: 'hard' };
}

module.exports = {
  injectPage,
  softInjectPage,
  hardInjectPage,
  VERSION_PROBE_EXPR,
};
