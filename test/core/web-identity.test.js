const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateWebStatus, buildWebStatusPayload } = require('../../src/core/web-identity');

const EXPECT = {
  version: '3.0.2',
  dataCoreVersion: '3.0.2',
  runtimeInstanceId: 'inst-1',
};

describe('web identity', () => {
  it('accepts current legal web', () => {
    const body = buildWebStatusPayload({ ...EXPECT });
    assert.equal(validateWebStatus(body, EXPECT).ok, true);
  });

  it('rejects v2 old web', () => {
    const body = {
      ok: true,
      service: 'qf-sf-fee-web',
      version: '2.0.0',
      dataCoreBacked: false,
    };
    assert.equal(validateWebStatus(body, EXPECT).ok, false);
  });

  it('rejects arbitrary HTTP 200', () => {
    assert.equal(validateWebStatus({ ok: true }, EXPECT).ok, false);
  });

  it('rejects invalid JSON body', () => {
    assert.equal(validateWebStatus(null, EXPECT).reason, 'invalid_json');
  });

  it('rejects wrong service name', () => {
    const body = buildWebStatusPayload(EXPECT);
    body.service = 'other';
    assert.equal(validateWebStatus(body, EXPECT).reason, 'wrong_service');
  });

  it('rejects dataCoreBacked=false', () => {
    const body = buildWebStatusPayload(EXPECT);
    body.dataCoreBacked = false;
    assert.equal(validateWebStatus(body, EXPECT).reason, 'not_data_core_backed');
  });

  it('rejects wrong data core version', () => {
    const body = buildWebStatusPayload(EXPECT);
    body.dataCoreVersion = '3.0.0';
    assert.equal(validateWebStatus(body, EXPECT).reason, 'wrong_data_core_version');
  });
});
