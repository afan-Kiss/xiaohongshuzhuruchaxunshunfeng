const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUTPUT = path.join(ROOT, 'inject', 'qf-sf-fee-inline.js');
const SYNC = path.join(ROOT, 'scripts', 'sync-inline-client.js');

const EXPECTED_ONCE = [
  'const OWN_WRAP_CLASS',
  'const OWN_STYLE_ID',
  'function createBatchController',
  'function createScanScheduler',
  'function renderCardHtml',
  '// __QSF_CLIENT_BUNDLE_BEGIN__',
  '// __QSF_CLIENT_BUNDLE_END__',
];

function countOccurrences(content, needle) {
  return content.split(needle).length - 1;
}

function sha(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('inline bundle idempotent', () => {
  it('generates three identical outputs', () => {
    const hashes = [];
    const sizes = [];
    for (let i = 0; i < 3; i++) {
      execSync(`node "${SYNC}" --write`, { cwd: ROOT, stdio: 'pipe' });
      const content = fs.readFileSync(OUTPUT, 'utf8');
      hashes.push(sha(content));
      sizes.push(content.length);
      execSync(`node --check "${OUTPUT}"`, { cwd: ROOT, stdio: 'pipe' });
      for (const needle of EXPECTED_ONCE) {
        assert.equal(countOccurrences(content, needle), 1, `${needle} must appear once`);
      }
    }
    assert.equal(new Set(hashes).size, 1);
    assert.equal(new Set(sizes).size, 1);
  });

  it('check mode passes when synced', () => {
    execSync(`node "${SYNC}" --write`, { cwd: ROOT, stdio: 'pipe' });
    execSync(`node "${SYNC}" --check`, { cwd: ROOT, stdio: 'pipe' });
  });

  it('rejects corrupted duplicate declarations', () => {
    execSync(`node "${SYNC}" --write`, { cwd: ROOT, stdio: 'pipe' });
    const badPath = path.join(ROOT, 'inject', '_bad-syntax-check.js');
    const bad = fs.readFileSync(OUTPUT, 'utf8').replace(
      "const OWN_WRAP_CLASS = 'qsf-inline-fee-wrap';",
      "const OWN_WRAP_CLASS = 'a';\nconst OWN_WRAP_CLASS = 'b';",
    );
    fs.writeFileSync(badPath, bad);
    try {
      assert.throws(() => execSync(`node --check "${badPath}"`, { stdio: 'pipe' }));
    } finally {
      try { fs.unlinkSync(badPath); } catch { /* ignore */ }
    }
  });
});
