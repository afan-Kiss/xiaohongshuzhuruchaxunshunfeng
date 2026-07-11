const fs = require('fs');
const path = require('path');

const OWNER_FILENAME = 'runtime-owner.json';

function ownerPath(root) {
  return path.join(root || process.cwd(), 'data', 'runtime', OWNER_FILENAME);
}

function readOwner(root) {
  const file = ownerPath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeOwnerAtomic(root, payload) {
  const file = ownerPath(root);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

function createRuntimeOwner(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const payload = {
    service: options.service || 'qf-sf-data-core',
    version: options.version || '',
    pid: process.pid,
    instanceId: options.instanceId || '',
    projectRoot: root,
    runtimeScript: path.join(root, 'src', 'runtime.js'),
    startedAt: Date.now(),
  };
  writeOwnerAtomic(root, payload);
  return payload;
}

function removeRuntimeOwnerIfOwned(root, expected = {}) {
  const current = readOwner(root);
  if (!current) return false;
  if (Number(current.pid) !== Number(expected.pid)) return false;
  if (expected.instanceId && current.instanceId !== expected.instanceId) return false;
  try {
    fs.unlinkSync(ownerPath(root));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  OWNER_FILENAME,
  ownerPath,
  readOwner,
  writeOwnerAtomic,
  createRuntimeOwner,
  removeRuntimeOwnerIfOwned,
};
