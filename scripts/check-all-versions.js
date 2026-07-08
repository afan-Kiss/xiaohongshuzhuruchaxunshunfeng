#!/usr/bin/env node
/** 检查四店千帆页面内嵌脚本版本是否一致 */
const fs = require('fs');
const path = require('path');
const { resolveDevtoolsFromQianfanBot } = require('../src/read-qianfan-debug-config');
const { connectCdp } = require('../src/cdp-connect');
const { isQianfanPageUrl } = require('../src/build-inject-source');

const ROOT = path.resolve(__dirname, '..');
const PANEL_PATH = path.join(ROOT, 'inject', 'qf-sf-fee-inline.js');
const expected = fs.readFileSync(PANEL_PATH, 'utf8').match(/const VERSION = '([^']+)'/)?.[1] || '';

const PROBE = `(function(){
  return {
    version: window.__qfSfFeeInline && window.__qfSfFeeInline.version,
    hasInline: !!window.__qfSfFeeInline,
    hasLegacyPanel: !!document.getElementById('qf-sf-fee-panel-root'),
    inlineRows: document.querySelectorAll('.qsf-inline-fee-row').length,
    title: document.title,
  };
})()`;

async function main() {
  const bot = resolveDevtoolsFromQianfanBot();
  const host = String(bot?.host || '127.0.0.1').trim();
  const port = Number(bot?.port || process.env.QIANFAN_DEVTOOLS_PORT || 9322);
  const list = await (await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(8000) })).json();
  const pages = list.filter((p) => p.type === 'page' && p.webSocketDebuggerUrl && isQianfanPageUrl(p.url));

  console.log(`期望版本: v${expected}  |  DevTools ${host}:${port}  |  ${pages.length} 个千帆页面\n`);

  const rows = [];
  for (const page of pages) {
    let client;
    try {
      client = await connectCdp(page.webSocketDebuggerUrl, 6000);
      const r = await client.Runtime.evaluate({ expression: PROBE, returnByValue: true });
      const info = r.result?.value || {};
      rows.push({
        title: page.title,
        version: info.version || '(无)',
        hasInline: info.hasInline,
        hasLegacyPanel: info.hasLegacyPanel,
        inlineRows: info.inlineRows || 0,
        ok: info.version === expected && info.hasInline && !info.hasLegacyPanel,
      });
    } catch (err) {
      rows.push({ title: page.title, version: `(探测失败: ${err.message})`, ok: false });
    } finally {
      if (client) {
        try { await client.close(); } catch { /* ignore */ }
      }
    }
  }

  for (const row of rows) {
    const mark = row.ok ? 'OK ' : 'ERR';
    console.log(`${mark}  ${row.title}`);
    console.log(`     脚本版本=${row.version}  内嵌=${row.hasInline ? '是' : '否'}  旧侧栏=${row.hasLegacyPanel ? '是' : '否'}  行数=${row.inlineRows ?? '-'}`);
  }

  const versions = [...new Set(rows.map((r) => r.version).filter((v) => v && !v.startsWith('(')))];
  const allOk = rows.length > 0 && rows.every((r) => r.ok);
  console.log('');
  if (allOk) {
    console.log(`全部 ${rows.length} 个页面均为 v${expected}`);
  } else {
    console.log(`版本不一致: 发现 ${versions.join(', ') || '未知'}，期望 v${expected}`);
    console.log('修复: node scripts/force-reinject.js');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
