const fs = require('fs');
const path = require('path');

function createPersistence(filePath, options = {}) {
  const debounceMs = Number(options.debounceMs || 3000);
  const root = path.dirname(filePath);
  let timer = null;
  let pending = null;

  function ensureDir() {
    fs.mkdirSync(root, { recursive: true });
  }

  function backupCorrupt() {
    if (!fs.existsSync(filePath)) return;
    const bak = `${filePath}.corrupt.${Date.now()}.bak`;
    try {
      fs.renameSync(filePath, bak);
    } catch {
      /* ignore */
    }
  }

  function load() {
    if (!fs.existsSync(filePath)) return {};
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      backupCorrupt();
      return {};
    }
  }

  function flushNow(data) {
    ensureDir();
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 0), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  function scheduleSave(data) {
    pending = data;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!pending) return;
      try {
        flushNow(pending);
      } catch (err) {
        console.error('[data-core] persistence write failed:', err.message || err);
      }
      pending = null;
    }, debounceMs);
  }

  function close() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      try {
        flushNow(pending);
      } catch {
        /* ignore */
      }
      pending = null;
    }
  }

  return { load, scheduleSave, flushNow, close, filePath };
}

module.exports = { createPersistence };
