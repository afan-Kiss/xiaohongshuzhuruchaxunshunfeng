/** CDP 注入：优先热更新，必要时硬重注入 */

const TEARDOWN_EXPR = `(function(){
  try {
    if (window.__qfSfFeeInline?.teardown) window.__qfSfFeeInline.teardown();
    else if (window.__qfSfFeePanel?.teardown) window.__qfSfFeePanel.teardown();
    delete window.__qfSfFeeInline;
    delete window.__qfSfFeePanel;
    delete window.__qfSfExpandPanel;
    delete window.__qfSfLauncherDragCleanup;
    document.querySelectorAll('#qf-sf-fee-panel-root').forEach(function(el){ el.remove(); });
    document.getElementById('qf-sf-fee-panel-style')?.remove();
    document.querySelectorAll('.qsf-inline-fee-wrap').forEach(function(el){ el.remove(); });
    document.getElementById('qf-sf-fee-inline-style')?.remove();
    document.documentElement.classList.remove('qsf-page-docked');
    document.body?.classList.remove('qsf-page-docked');
    try { sessionStorage.removeItem('qsf_panel_pinned_v1'); } catch (e) {}
    if (window.__qfSfFeeNativeFetch) window.fetch = window.__qfSfFeeNativeFetch;
    if (window.__qsfInlineNativeFetch) window.fetch = window.__qsfInlineNativeFetch;
    if (window.__qfSfFeeNativeXhrOpen) XMLHttpRequest.prototype.open = window.__qfSfFeeNativeXhrOpen;
    if (window.__qfSfFeeNativeXhrSend) XMLHttpRequest.prototype.send = window.__qfSfFeeNativeXhrSend;
    delete window.__qfSfFeeFetchHooked;
    delete window.__qfSfFeeXhrHooked;
    delete window.__qsfInlineFetchHooked;
    delete window.__qsfInlineNativeFetch;
    delete window.__qfSfFeeIconDataUrl;
    delete window.__qsfLegacyPanelWatch;
  } catch (e) {}
})()`;

const VERSION_PROBE_EXPR = `(function(){
  var inline = window.__qfSfFeeInline;
  var panel = window.__qfSfFeePanel;
  return {
    version: inline && inline.version || panel && panel.version,
    mode: inline ? 'inline' : (panel ? 'panel' : 'none'),
    hasInline: !!inline,
    hasLegacyPanel: !!document.getElementById('qf-sf-fee-panel-root'),
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
    var inline = window.__qfSfFeeInline;
    return {
      version: inline && inline.version,
      mode: inline ? 'inline' : 'none',
      hasInline: !!inline,
      hasLegacyPanel: !!document.getElementById('qf-sf-fee-panel-root'),
    };
  })()`);
  const info = probe.result?.value || {};
  return info.version === expectedVersion && info.hasInline && !info.hasLegacyPanel;
}

async function clearRegisteredPageScripts(client) {
  const { Page } = client;
  if (typeof Page.removeScriptToEvaluateOnNewDocument !== 'function') return;
  for (let i = 1; i <= 120; i += 1) {
    try {
      await Page.removeScriptToEvaluateOnNewDocument({ identifier: String(i) });
    } catch {
      /* ignore missing id */
    }
  }
}

async function hardInjectPage(client, source, options = {}) {
  const { Page } = client;
  await clearRegisteredPageScripts(client);
  await evaluate(client, TEARDOWN_EXPR);
  if (options.registerOnNewDocument) {
    await Page.addScriptToEvaluateOnNewDocument({ source });
  }
  await evaluate(client, source, { awaitPromise: true });
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
  await hardInjectPage(client, source, { registerOnNewDocument });
  return { mode: 'hard' };
}

module.exports = {
  injectPage,
  softInjectPage,
  hardInjectPage,
  clearRegisteredPageScripts,
  VERSION_PROBE_EXPR,
  TEARDOWN_EXPR,
};
