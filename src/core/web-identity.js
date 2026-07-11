/**
 * Web service identity validation for port 6666 reuse.
 */
const WEB_SERVICE = 'qf-sf-fee-web';

function validateWebStatus(body, expected = {}) {
  const version = String(expected.version || '3.0.5');
  const dataCoreVersion = String(expected.dataCoreVersion || version);
  const dataCoreService = String(expected.dataCoreService || 'qf-sf-data-core');
  const runtimeInstanceId = String(expected.runtimeInstanceId || '');

  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'invalid_json' };
  }
  if (body.service !== WEB_SERVICE) {
    return { ok: false, reason: 'wrong_service', actual: body.service || '' };
  }
  if (body.version !== version) {
    return { ok: false, reason: 'wrong_version', actual: body.version || '' };
  }
  if (!body.dataCoreBacked) {
    return { ok: false, reason: 'not_data_core_backed' };
  }
  if (body.dataCoreService !== dataCoreService) {
    return { ok: false, reason: 'wrong_data_core_service', actual: body.dataCoreService || '' };
  }
  if (body.dataCoreVersion !== dataCoreVersion) {
    return { ok: false, reason: 'wrong_data_core_version', actual: body.dataCoreVersion || '' };
  }
  if (runtimeInstanceId && body.runtimeInstanceId !== runtimeInstanceId) {
    return { ok: false, reason: 'wrong_runtime_instance', actual: body.runtimeInstanceId || '' };
  }
  return { ok: true };
}

function buildWebStatusPayload(options = {}) {
  return {
    ok: true,
    service: WEB_SERVICE,
    version: options.version || '3.0.5',
    dataCoreBacked: true,
    dataCoreService: options.dataCoreService || 'qf-sf-data-core',
    dataCoreVersion: options.dataCoreVersion || options.version || '3.0.5',
    runtimeInstanceId: options.runtimeInstanceId || '',
  };
}

module.exports = {
  WEB_SERVICE,
  validateWebStatus,
  buildWebStatusPayload,
};
