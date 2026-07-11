#!/usr/bin/env node
/**
 * Embeds src/client modules into inject/qf-sf-fee-inline.js (browser IIFE preamble).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INJECT_PATH = path.join(ROOT, 'inject', 'qf-sf-fee-inline.js');
const MARKER = '// __QSF_CLIENT_BUNDLE__';
const CLIENT_FILES = [
  'batch-controller.js',
  'scan-scheduler.js',
  'render-utils.js',
];

function stripExports(code) {
  return code.replace(/\r\n/g, '\n').replace(/module\.exports\s*=\s*\{[\s\S]*?\};?\s*$/m, '').trim();
}

function buildBundle() {
  const parts = CLIENT_FILES.map((name) => {
    const file = path.join(ROOT, 'src', 'client', name);
    return stripExports(fs.readFileSync(file, 'utf8'));
  });
  return `${parts.join('\n\n')}\n`;
}

function main() {
  const inject = fs.readFileSync(INJECT_PATH, 'utf8');
  if (!inject.includes(MARKER)) {
    console.error(`[sync-inline-client] marker ${MARKER} not found in inject script`);
    process.exit(1);
  }
  const bundle = buildBundle();
  const next = inject.replace(MARKER, `${MARKER}\n${bundle}`);
  fs.writeFileSync(INJECT_PATH, next, 'utf8');
  console.log('[sync-inline-client] embedded client modules into inject script');
}

main();
