const fs = require('fs');
const path = require('path');

const QIANFAN_BOT_CONFIG = path.resolve(__dirname, '../../千帆中转机器人/config.wxbot-new.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveDevtoolsFromQianfanBot() {
  const cfg = readJson(QIANFAN_BOT_CONFIG);
  const qd = cfg?.qianfanDebug || cfg || {};
  const port = Number(qd.devtoolsPort);
  const host = String(qd.devtoolsHost || '127.0.0.1').trim();
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host, port, source: QIANFAN_BOT_CONFIG };
}

module.exports = { resolveDevtoolsFromQianfanBot, QIANFAN_BOT_CONFIG };
