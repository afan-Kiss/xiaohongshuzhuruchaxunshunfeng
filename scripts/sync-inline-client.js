#!/usr/bin/env node
/**
 * Idempotent generator: template + client modules → inject/qf-sf-fee-inline.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'inject', 'qf-sf-fee-inline.template.js');
const OUTPUT_PATH = path.join(ROOT, 'inject', 'qf-sf-fee-inline.js');
const BEGIN = '// __QSF_CLIENT_BUNDLE_BEGIN__';
const END = '// __QSF_CLIENT_BUNDLE_END__';

const CLIENT_FILES = [
  'batch-controller.js',
  'scan-scheduler.js',
  'after-sale-display.js',
  'render-utils.js',
];

const EXPECTED_DECLARATIONS = [
  { pattern: /const OWN_WRAP_CLASS\s*=/g, name: 'const OWN_WRAP_CLASS' },
  { pattern: /const OWN_STYLE_ID\s*=/g, name: 'const OWN_STYLE_ID' },
  { pattern: /function createBatchController\s*\(/g, name: 'function createBatchController' },
  { pattern: /function createScanScheduler\s*\(/g, name: 'function createScanScheduler' },
  { pattern: /function buildAfterSaleBlocks\s*\(/g, name: 'function buildAfterSaleBlocks' },
  { pattern: /function renderCardHtml\s*\(/g, name: 'function renderCardHtml' },
  { pattern: /\/\/ __QSF_CLIENT_BUNDLE_BEGIN__/g, name: 'BEGIN marker' },
  { pattern: /\/\/ __QSF_CLIENT_BUNDLE_END__/g, name: 'END marker' },
];

function stripExports(code) {
  return code.replace(/\r\n/g, '\n').replace(/module\.exports\s*=\s*\{[\s\S]*?\};?\s*$/m, '').trim();
}

function buildBundle() {
  return CLIENT_FILES.map((name) => {
    const file = path.join(ROOT, 'src', 'client', name);
    return stripExports(fs.readFileSync(file, 'utf8'));
  }).join('\n\n');
}

function validateOutput(content) {
  for (const { pattern, name } of EXPECTED_DECLARATIONS) {
    const matches = content.match(pattern) || [];
    if (matches.length !== 1) {
      throw new Error(`expected exactly 1 "${name}", found ${matches.length}`);
    }
  }
}

function generateOutput() {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  if (!template.includes(BEGIN) || !template.includes(END)) {
    throw new Error(`template must contain ${BEGIN} and ${END}`);
  }
  const beginIdx = template.indexOf(BEGIN);
  const endIdx = template.indexOf(END);
  if (beginIdx >= endIdx) {
    throw new Error('BEGIN must appear before END in template');
  }
  const bundle = buildBundle();
  const output = `${template.slice(0, beginIdx + BEGIN.length)}\n${bundle}\n${template.slice(endIdx)}`;
  validateOutput(output);
  return output;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function main() {
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check') || !write;

  let expected;
  try {
    expected = generateOutput();
  } catch (err) {
    console.error(`[sync-inline-client] generate failed: ${err.message}`);
    process.exit(1);
  }

  if (write) {
    fs.writeFileSync(OUTPUT_PATH, expected, 'utf8');
    console.log(`[sync-inline-client] wrote ${OUTPUT_PATH} (${expected.length} bytes, sha256=${sha256(expected).slice(0, 12)}…)`);
  }

  if (check) {
    if (!fs.existsSync(OUTPUT_PATH)) {
      console.error('内嵌客户端未同步，请执行 npm run build:inline');
      process.exit(1);
    }
    const disk = fs.readFileSync(OUTPUT_PATH, 'utf8');
    if (disk !== expected) {
      console.error('内嵌客户端未同步，请执行 npm run build:inline');
      console.error(`  disk sha256=${sha256(disk).slice(0, 12)}… expected=${sha256(expected).slice(0, 12)}…`);
      process.exit(1);
    }
    if (!write) {
      console.log('[sync-inline-client] inline bundle is up to date');
    }
  }
}

main();
