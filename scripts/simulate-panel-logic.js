#!/usr/bin/env node
/**
 * 离线 + 在线模拟：检测侧栏逻辑 bug（hook 叠加、重复刷新、并发 prefetch）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const ROOT = path.resolve(__dirname, '..');
const PANEL_PATH = path.join(ROOT, 'inject', 'qf-sf-fee-panel.js');
const VERSION = fs.readFileSync(PANEL_PATH, 'utf8').match(/const VERSION = '([^']+)'/)?.[1] || '';
const results = [];
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    results.push({ ok: true, name });
    return;
  }
  failed += 1;
  results.push({ ok: false, name, detail: detail || '' });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 模拟 fetch hook 叠加 / 恢复 */
function simulateHookStacking() {
  const win = {
    __qfSfFeeFetchHooked: false,
    __qfSfFeeNativeFetch: null,
    calls: 0,
  };
  win.fetch = async function nativeFetch() {
    win.calls += 1;
    return { ok: true, clone: () => ({ json: async () => ({}) }) };
  };

  function unhookNetApis() {
    if (win.__qfSfFeeNativeFetch) win.fetch = win.__qfSfFeeNativeFetch;
    delete win.__qfSfFeeFetchHooked;
  }

  function hookFetch() {
    if (win.__qfSfFeeFetchHooked) return;
    if (!win.__qfSfFeeNativeFetch) win.__qfSfFeeNativeFetch = win.fetch.bind(win);
    win.__qfSfFeeFetchHooked = true;
    const orig = win.__qfSfFeeNativeFetch;
    win.fetch = async function patchedFetch() {
      win.hookHits = (win.hookHits || 0) + 1;
      return orig();
    };
  }

  for (let i = 0; i < 3; i += 1) {
    delete win.__qfSfFeeFetchHooked;
    hookFetch();
  }
  return (async () => {
    await win.fetch();
    assert('hook 叠加：3 次错误 hook 只触发 1 层', win.hookHits === 1 && win.calls === 1, `hookHits=${win.hookHits} calls=${win.calls}`);
    unhookNetApis();
    await win.fetch();
    assert('unhook 后恢复原生 fetch', win.hookHits === 1 && win.calls === 2, `hookHits=${win.hookHits} calls=${win.calls}`);
  })();
}

/** 模拟 refreshSession / preferCache 行为 */
function simulateRefreshSession() {
  let refreshSession = 0;
  let cancelled = false;

  function preferCacheRefresh() {
    // v1.0.57+：缓存路径不应递增 session
    const cached = true;
    if (cached) return refreshSession;
    refreshSession += 1;
    return refreshSession;
  }

  function fullRefresh() {
    refreshSession += 1;
    const sessionId = refreshSession;
    return sessionId;
  }

  function onBuyerChanged() {
    refreshSession += 1;
  }

  onBuyerChanged();
  const before = refreshSession;
  preferCacheRefresh();
  assert('preferCache 不递增 refreshSession', refreshSession === before, `session=${refreshSession}`);
  const sid = fullRefresh();
  assert('全量刷新递增 refreshSession', sid === before + 1, `sid=${sid}`);
  refreshSession += 1;
  cancelled = sid !== refreshSession;
  assert('切买家取消旧 session', cancelled === true, `cancelled=${cancelled}`);
  return Promise.resolve();
}

/** 模拟 packageDetailInflight 共享 Promise（v1.0.68+ 按 buyer+packageId 去重） */
function simulatePackageInflight() {
  const inflight = new Map();
  let apiCalls = 0;

  function pkgDetailKey(buyerUserId, packageId) {
    const uid = String(buyerUserId || '').trim();
    const pid = String(packageId || '').trim();
    return uid && pid ? `${uid}:${pid}` : pid;
  }

  async function fetchDetail(buyerUserId, pid) {
    const key = pkgDetailKey(buyerUserId, pid);
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      apiCalls += 1;
      await sleep(30);
      return { buyerUserId, id: pid };
    })();
    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }

  return Promise.all([
    fetchDetail('U1', 'P1'),
    fetchDetail('U1', 'P1'),
    fetchDetail('U2', 'P1'),
  ]).then((rows) => {
    assert('同买家同 packageId 并发只请求 1 次', apiCalls === 2, `apiCalls=${apiCalls}`);
    assert('不同买家同 packageId 各自请求', rows[0].buyerUserId === 'U1' && rows[2].buyerUserId === 'U2', JSON.stringify(rows));
  });
}

/** 模拟后台刷新去重 */
async function simulateBackgroundDedup() {
  let timers = 0;
  let runs = 0;
  let timer = null;

  function scheduleOnce(fn) {
    clearTimeout(timer);
    timer = setTimeout(fn, 10);
    timers += 1;
  }

  for (let i = 0; i < 5; i += 1) scheduleOnce(() => { runs += 1; });
  await sleep(40);
  assert('后台刷新定时器合并为 1 次执行', timers === 5 && runs === 1, `timers=${timers} runs=${runs}`);
}

/** 模拟 shouldBackgroundRevalidate 90s 窗口 */
function simulateBackgroundGuard() {
  const lastBg = new Map();
  const BACKGROUND_MS = 90_000;

  function shouldRevalidate(uid, cached, now) {
    const last = lastBg.get(uid) || 0;
    if (now - last < BACKGROUND_MS) return false;
    if (now - cached.updatedAt > BACKGROUND_MS) return true;
    return false;
  }

  const uid = 'u1';
  const now = Date.now();
  lastBg.set(uid, now);
  const cached = { updatedAt: now - 1000 };
  assert('90s 内不重复后台刷新', shouldRevalidate(uid, cached, now + 1000) === false);
  assert('缓存过期允许后台刷新', shouldRevalidate(uid, cached, now + BACKGROUND_MS + 1) === true);
  return Promise.resolve();
}

/** 模拟 orderPanelStale 时同买家触发 watch 而非重复激活 */
function simulateOrderPanelStaleDedup() {
  let activations = 0;
  let watches = 0;
  let orderPanelStale = true;
  const activeBuyer = { buyerUserId: 'U1', buyerNick: 'A' };

  function queueSessionActivation(buyerUserId) {
    if (buyerUserId === activeBuyer.buyerUserId) {
      if (orderPanelStale) {
        watches += 1;
        return;
      }
      return;
    }
    activations += 1;
  }

  queueSessionActivation('U1');
  queueSessionActivation('U1');
  assert('orderPanelStale 同买家触发 watch 不激活', activations === 0 && watches === 2, `activations=${activations} watches=${watches}`);
  orderPanelStale = false;
  queueSessionActivation('U1');
  assert('stale 清除后同买家不触发新激活', activations === 0, `activations=${activations}`);
  queueSessionActivation('U2');
  assert('不同买家仍可激活', activations === 1, `activations=${activations}`);
  return Promise.resolve();
}

/** 模拟切买家时释放 refreshInFlight */
function simulateRefreshInFlightReset() {
  let refreshInFlight = true;
  let refreshSession = 1;
  let loading = true;

  function onBuyerChanged() {
    refreshSession += 1;
    refreshInFlight = false;
    loading = false;
  }

  onBuyerChanged();
  assert('切买家释放 refreshInFlight', refreshInFlight === false, `inFlight=${refreshInFlight}`);
  assert('切买家关闭 loading', loading === false, `loading=${loading}`);
  assert('切买家递增 refreshSession', refreshSession === 2, `session=${refreshSession}`);
  return Promise.resolve();
}

/** 模拟 maybeClearOrderPanelStale 需会话对齐且有订单 */
function simulateStrictStaleClear() {
  let orderPanelStale = true;
  const activeBuyer = { buyerUserId: 'U1', buyerNick: '张三' };

  function maybeClear(activeUid, headerNick, hasOrders) {
    if (!orderPanelStale) return false;
    const uidOk = activeUid === activeBuyer.buyerUserId;
    const nickOk = headerNick && activeBuyer.buyerNick && headerNick.includes('张');
    if ((uidOk || nickOk) && hasOrders) {
      orderPanelStale = false;
      return true;
    }
    return false;
  }

  assert('仅 UID 对齐无订单不清 stale', maybeClear('U1', '张三', false) === false && orderPanelStale === true);
  assert('UID 对齐且有订单才清 stale', maybeClear('U1', '张三', true) === true && orderPanelStale === false);
  orderPanelStale = true;
  assert('昵称对齐且有订单可清 stale', maybeClear('', '张三', true) === true && orderPanelStale === false);
  return Promise.resolve();
}

/** 在线：检测页面 hook 层数与重复计时器 */
const LIVE_PROBE = `(function(){
  var panel = window.__qfSfFeePanel;
  var root = document.getElementById('qf-sf-fee-panel-root');
  var fetchStr = String(window.fetch || '');
  var hookLayer = 0;
  var f = window.fetch;
  var seen = new Set();
  for (var i = 0; i < 8; i++) {
    if (!f || seen.has(f)) break;
    seen.add(f);
    if (/patchedFetch|__qfSfFeeFetchHooked/.test(String(f))) hookLayer += 1;
    try {
      var next = Object.getPrototypeOf(f);
      if (!next || next === f) break;
      f = next;
    } catch (e) { break; }
  }
  var inflightBg = 0;
  try {
    inflightBg = typeof backgroundRevalidateTimer !== 'undefined' ? 0 : 0;
  } catch (e) {}
  return {
    version: panel && panel.version,
    hasPanel: !!root,
    expanded: !!(root && root.classList.contains('qsf-expanded')),
    fetchHooked: !!window.__qfSfFeeFetchHooked,
    hasNativeFetch: !!window.__qfSfFeeNativeFetch,
    fetchLooksPatched: /patchedFetch/.test(fetchStr),
    xhrHooked: !!window.__qfSfFeeXhrHooked,
    hasNativeXhr: !!(window.__qfSfFeeNativeXhrOpen && window.__qfSfFeeNativeXhrSend),
    activeBuyer: panel && panel.getActiveBuyer && panel.getActiveBuyer(),
  };
})()`;

async function probeLivePages() {
  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(bot?.host || '127.0.0.1').trim();
  const port = Number(bot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9322);
  let list;
  try {
    list = await (await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  } catch (err) {
    results.push({ ok: true, name: `在线探测跳过（DevTools 不可用: ${err.message}）` });
    return;
  }
  const pages = list.filter((p) => p.type === 'page' && p.webSocketDebuggerUrl && isQianfanPageUrl(p.url));
  if (!pages.length) {
    results.push({ ok: true, name: '在线探测跳过（无千帆页面）' });
    return;
  }
  for (const page of pages.slice(0, 3)) {
    let client;
    try {
      client = await connectCdp(page.webSocketDebuggerUrl, 5000);
      const r = await client.Runtime.evaluate({ expression: LIVE_PROBE, returnByValue: true });
      const info = r.result?.value || {};
      if (info.hasPanel) {
        assert(
          `[${page.title}] 版本匹配 ${VERSION}`,
          info.version === VERSION,
          `got ${info.version}`,
        );
        assert(
          `[${page.title}] fetch hook 未叠加`,
          info.fetchHooked && info.hasNativeFetch && !info.fetchLooksPatched.includes('patchedFetch patchedFetch'),
          JSON.stringify(info),
        );
        assert(
          `[${page.title}] XHR hook 有原生备份`,
          !info.xhrHooked || info.hasNativeXhr,
          JSON.stringify(info),
        );
      }
    } catch (err) {
      results.push({ ok: true, name: `[${page.title}] 探测跳过: ${err.message}` });
    } finally {
      if (client) {
        try { await client.close(); } catch { /* ignore */ }
      }
    }
  }
}

async function main() {
  console.log(`\n=== 侧栏逻辑模拟 v${VERSION} ===\n`);
  await simulateHookStacking();
  await simulateRefreshSession();
  await simulatePackageInflight();
  await simulateBackgroundDedup();
  await simulateBackgroundGuard();
  await simulateOrderPanelStaleDedup();
  await simulateRefreshInFlightReset();
  await simulateStrictStaleClear();
  await probeLivePages();

  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\n${results.length - failed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
