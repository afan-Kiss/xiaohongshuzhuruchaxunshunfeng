const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TEARDOWN_EXPR, compareSemver, isVerifiedProbe } = require('../../src/inject-page');

describe('inject teardown v3.0.6', () => {
  it('TEARDOWN_EXPR awaits destroy or teardown', () => {
    assert.match(TEARDOWN_EXPR, /api\.teardown/);
    assert.match(TEARDOWN_EXPR, /api\.destroy/);
    assert.match(TEARDOWN_EXPR, /await/);
  });

  it('compareSemver orders versions', () => {
    assert.equal(compareSemver('3.0.6', '3.0.5'), 1);
    assert.equal(compareSemver('3.0.5', '3.0.6'), -1);
    assert.equal(compareSemver('3.0.6', '3.0.6'), 0);
  });

  it('isVerifiedProbe requires alive !== false', () => {
    const base = {
      mode: 'inline',
      hasInline: true,
      version: '3.0.6',
      hasLegacyPanel: false,
      alive: true,
    };
    assert.equal(isVerifiedProbe(base, '3.0.6'), true);
    assert.equal(isVerifiedProbe({ ...base, alive: false }, '3.0.6'), false);
  });
});
