#!/usr/bin/env node
/**
 * Smoke test: health endpoint shape (does not require live upstream).
 */
const http = require('http');

const PORT = Number(process.env.QF_PACKAGE_PROXY_PORT || 4725);

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function main() {
  try {
    const health = await get('/health');
    const json = JSON.parse(health.body || '{}');
    const required = ['service', 'version', 'features', 'checks', 'devtools', 'metrics'];
    for (const k of required) {
      if (!(k in json)) throw new Error(`health missing ${k}`);
    }
    if (json.service !== 'qf-sf-data-core') throw new Error(`wrong service: ${json.service}`);
    if (!json.features.batchCards) throw new Error('batchCards feature missing');
    console.log(`[smoke] health ok v${json.version} uptime=${json.uptimeMs}ms`);
    process.exit(0);
  } catch (err) {
    console.error(`[smoke] health check failed (is runtime running on :${PORT}?): ${err.message}`);
    process.exit(1);
  }
}

main();
