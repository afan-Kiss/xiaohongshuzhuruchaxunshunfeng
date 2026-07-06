#!/usr/bin/env node
/** 扫描千帆页面网络缓存中的物流字段名 */
const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '../../千帆中转机器人/config/qianfan-protocol-shops.local.json');
if (!fs.existsSync(p)) {
  console.log('no capture file');
  process.exit(0);
}
const raw = fs.readFileSync(p, 'utf8');
const keys = new Set();
const re = /"(express[^"]*|logistics[^"]*|track[^"]*|trace[^"]*|route[^"]*|csstatus|erp_status[^"]*)"\s*:/gi;
let m;
while ((m = re.exec(raw))) keys.add(m[1]);
console.log([...keys].sort().join('\n'));
