/** CDP 注入：严格异常检查 + 注入后实测验证 */

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
    version: inline && inline.version || panel && panel.version || '',
    mode: inline ? 'inline' : (panel ? 'panel' : 'none'),
    hasInline: !!inline,
    hasLegacyPanel: !!document.getElementById('qf-sf-fee-panel-root'),
    inlineRows: document.querySelectorAll('.qsf-inline-fee-row').length,
  };
})()`;

function formatEvaluateError(response) {
  const details = response.exceptionDetails || {};
  return details.exception?.description || details.text || 'Runtime.evaluate failed';
}

async function evaluateOrThrow(client, expression, options = {}) {
  const response = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: Boolean(options.awaitPromise),
  });
  if (response.exceptionDetails) {
    const details = response.exceptionDetails;
    const message = formatEvaluateError(response);
    const error = new Error(message);
    error.code = 'cdp_evaluate_error';
    error.lineNumber = details.lineNumber;
    error.columnNumber = details.columnNumber;
    error.stackTrace = details.stackTrace;
    error.exceptionDetails = details;
    throw error;
  }
  return response;
}

async function evaluateBestEffort(client, expression, options = {}) {
  try {
    return await evaluateOrThrow(client, expression, options);
  } catch {
    return null;
  }
}

function probeFromResponse(response) {
  return response?.result?.value || {
    version: '',
    mode: 'none',
    hasInline: false,
    hasLegacyPanel: false,
    inlineRows: 0,
  };
}

function isVerifiedProbe(info, expectedVersion) {
  return info.mode === 'inline'
    && info.hasInline === true
    && info.version === expectedVersion
    && !info.hasLegacyPanel;
}

async function probePage(client) {
  const response = await evaluateOrThrow(client, VERSION_PROBE_EXPR);
  return probeFromResponse(response);
}

async function waitForVerifiedInjection(client, expectedVersion, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probePage(client);
    if (isVerifiedProbe(last, expectedVersion)) {
      return { ...last, verifiedAt: Date.now() };
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  const error = new Error(`injection_verify_failed: mode=${last?.mode || 'none'} version=${last?.version || ''}`);
  error.code = 'injection_verify_failed';
  error.probe = last;
  throw error;
}

/** Per-page CDP script registration tracker */
class PageScriptRegistry {
  constructor() {
    this.byWs = new Map();
  }

  get(ws) {
    return this.byWs.get(ws) || null;
  }

  set(ws, entry) {
    this.byWs.set(ws, entry);
  }

  delete(ws) {
    this.byWs.delete(ws);
  }

  pruneAlive(aliveWsSet) {
    for (const ws of this.byWs.keys()) {
      if (!aliveWsSet.has(ws)) this.byWs.delete(ws);
    }
  }
}

const globalScriptRegistry = new PageScriptRegistry();

async function removeRegisteredScript(client, identifier) {
  if (!identifier || typeof client.Page.removeScriptToEvaluateOnNewDocument !== 'function') return;
  try {
    await client.Page.removeScriptToEvaluateOnNewDocument({ identifier });
  } catch {
    /* ignore missing */
  }
}

async function registerPageScriptOnNewDocument(client, ws, source, version) {
  const prev = globalScriptRegistry.get(ws);
  if (prev?.identifier && prev.version !== version) {
    await removeRegisteredScript(client, prev.identifier);
  }
  if (prev?.identifier && prev.version === version) {
    return prev.identifier;
  }
  const result = await client.Page.addScriptToEvaluateOnNewDocument({ source });
  const identifier = result?.identifier || '';
  globalScriptRegistry.set(ws, { identifier, version, registeredAt: Date.now() });
  return identifier;
}

async function clearRegisteredPageScripts(client, ws) {
  const prev = globalScriptRegistry.get(ws);
  if (prev?.identifier) {
    await removeRegisteredScript(client, prev.identifier);
  }
  if (ws) globalScriptRegistry.delete(ws);
}

async function softInjectPage(client, source, expectedVersion, ws) {
  await evaluateOrThrow(client, source, { awaitPromise: true });
  if (!expectedVersion) {
    const probe = await probePage(client);
    return { ok: true, mode: 'soft', version: probe.version || '', verifiedAt: Date.now(), scriptIdentifier: '' };
  }
  const verified = await waitForVerifiedInjection(client, expectedVersion);
  return {
    ok: true,
    mode: 'soft',
    version: verified.version,
    verifiedAt: verified.verifiedAt,
    scriptIdentifier: globalScriptRegistry.get(ws)?.identifier || '',
  };
}

async function hardInjectPage(client, source, options = {}) {
  const { ws = '', expectedVersion = '', registerOnNewDocument = false } = options;
  await clearRegisteredPageScripts(client, ws);
  await evaluateBestEffort(client, TEARDOWN_EXPR);
  let scriptIdentifier = '';
  if (registerOnNewDocument && ws) {
    scriptIdentifier = await registerPageScriptOnNewDocument(client, ws, source, expectedVersion);
  } else if (registerOnNewDocument) {
    const result = await client.Page.addScriptToEvaluateOnNewDocument({ source });
    scriptIdentifier = result?.identifier || '';
  }
  await evaluateOrThrow(client, source, { awaitPromise: true });
  if (!expectedVersion) {
    const probe = await probePage(client);
    return { ok: true, mode: 'hard', version: probe.version || '', verifiedAt: Date.now(), scriptIdentifier };
  }
  const verified = await waitForVerifiedInjection(client, expectedVersion);
  return {
    ok: true,
    mode: 'hard',
    version: verified.version,
    verifiedAt: verified.verifiedAt,
    scriptIdentifier,
  };
}

async function injectPage(client, source, options = {}) {
  const {
    softFirst = true,
    expectedVersion = '',
    registerOnNewDocument = false,
    ws = '',
    pageTitle = '',
    pageUrl = '',
  } = options;

  const logCtx = { title: pageTitle, url: pageUrl };

  if (softFirst) {
    try {
      return await softInjectPage(client, source, expectedVersion, ws);
    } catch (err) {
      if (err.code !== 'injection_verify_failed' && err.code !== 'cdp_evaluate_error') throw err;
      err.page = logCtx;
    }
  }

  try {
    return await hardInjectPage(client, source, { ws, expectedVersion, registerOnNewDocument });
  } catch (err) {
    err.page = logCtx;
    throw err;
  }
}

function createEmptyProbe(expectedVersion = '') {
  return {
    ok: false,
    verified: false,
    mode: 'none',
    actualVersion: '',
    expectedVersion,
    version: '',
    hasInline: false,
    hasLegacyPanel: false,
    inlineRows: 0,
    error: null,
    errorCode: null,
  };
}

function probeToRecord(probe, expectedVersion, extra = {}) {
  const ok = isVerifiedProbe(probe, expectedVersion);
  return {
    ok,
    verified: ok,
    mode: probe.mode || 'none',
    actualVersion: probe.version || '',
    expectedVersion,
    version: probe.version || '',
    hasInline: Boolean(probe.hasInline),
    hasLegacyPanel: Boolean(probe.hasLegacyPanel),
    inlineRows: probe.inlineRows || 0,
    lastVerifiedAt: ok ? Date.now() : 0,
    error: null,
    errorCode: null,
    ...extra,
  };
}

module.exports = {
  TEARDOWN_EXPR,
  VERSION_PROBE_EXPR,
  evaluateOrThrow,
  evaluateBestEffort,
  probePage,
  waitForVerifiedInjection,
  isVerifiedProbe,
  injectPage,
  softInjectPage,
  hardInjectPage,
  clearRegisteredPageScripts,
  registerPageScriptOnNewDocument,
  PageScriptRegistry,
  globalScriptRegistry,
  createEmptyProbe,
  probeToRecord,
};
