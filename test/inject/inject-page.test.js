const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateOrThrow,
  isVerifiedProbe,
  waitForVerifiedInjection,
  VERSION_PROBE_EXPR,
} = require('../../src/inject-page');

function mockClient(handlers = {}) {
  return {
    Runtime: {
      evaluate: handlers.evaluate || (async () => ({ result: { value: {} } })),
    },
  };
}

describe('inject-page CDP', () => {
  it('evaluateOrThrow throws on exceptionDetails', async () => {
    const client = mockClient({
      evaluate: async () => ({
        exceptionDetails: {
          text: 'Uncaught SyntaxError',
          exception: { description: "Identifier 'OWN_WRAP_CLASS' has already been declared" },
          lineNumber: 12,
          columnNumber: 6,
        },
      }),
    });
    await assert.rejects(
      () => evaluateOrThrow(client, 'bad'),
      (err) => err.code === 'cdp_evaluate_error' && /OWN_WRAP_CLASS/.test(err.message),
    );
  });

  it('waitForVerifiedInjection fails when window object missing', async () => {
    let calls = 0;
    const client = mockClient({
      evaluate: async ({ expression }) => {
        calls += 1;
        if (expression === VERSION_PROBE_EXPR) {
          return { result: { value: { version: '', mode: 'none', hasInline: false, hasLegacyPanel: false } } };
        }
        return { result: { value: {} } };
      },
    });
    await assert.rejects(
      () => waitForVerifiedInjection(client, '3.0.3', 200),
      (err) => err.code === 'injection_verify_failed',
    );
    assert.ok(calls >= 1);
  });

  it('isVerifiedProbe requires inline correct version without legacy panel', () => {
    assert.equal(isVerifiedProbe({
      mode: 'inline', hasInline: true, version: '3.0.3', hasLegacyPanel: false,
    }, '3.0.3'), true);
    assert.equal(isVerifiedProbe({
      mode: 'inline', hasInline: true, version: '3.0.2', hasLegacyPanel: false,
    }, '3.0.3'), false);
    assert.equal(isVerifiedProbe({
      mode: 'none', hasInline: false, version: '', hasLegacyPanel: false,
    }, '3.0.3'), false);
    assert.equal(isVerifiedProbe({
      mode: 'inline', hasInline: true, version: '3.0.3', hasLegacyPanel: true,
    }, '3.0.3'), false);
  });

  it('waitForVerifiedInjection succeeds on matching probe', async () => {
    const client = mockClient({
      evaluate: async ({ expression }) => {
        if (expression === VERSION_PROBE_EXPR) {
          return {
            result: {
              value: { version: '3.0.3', mode: 'inline', hasInline: true, hasLegacyPanel: false },
            },
          };
        }
        return { result: { value: {} } };
      },
    });
    const v = await waitForVerifiedInjection(client, '3.0.3', 500);
    assert.equal(v.version, '3.0.3');
    assert.ok(v.verifiedAt > 0);
  });
});
