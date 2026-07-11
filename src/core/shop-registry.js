/**
 * Shop registry — accountIds loaded from local config.json (not committed).
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_ROWS = [
  { shopKey: 'xyxiangyu', shopName: 'XY祥钰珠宝', aliases: ['XY祥钰珠宝', 'XY祥钰', 'xy祥钰'], accountIds: [] },
  { shopKey: 'xiangyu', shopName: '祥钰珠宝', aliases: ['祥钰珠宝'], accountIds: [] },
  { shopKey: 'hetianyayu', shopName: '和田雅玉', aliases: ['和田雅玉'], accountIds: [] },
  { shopKey: 'shiyuju', shopName: '拾玉居和田玉', aliases: ['拾玉居和田玉', '拾玉居'], accountIds: [] },
];

let cached = null;

function readConfigShops() {
  const configPath = path.join(__dirname, '..', '..', 'config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return raw.shops || {};
  } catch {
    return {};
  }
}

function loadShopRegistry() {
  if (cached) return cached;
  const cfgShops = readConfigShops();
  const rows = DEFAULT_ROWS.map((row) => {
    const extra = cfgShops[row.shopKey] || {};
    const accountIds = Array.isArray(extra.accountIds)
      ? extra.accountIds.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    return {
      ...row,
      accountIds,
    };
  });
  const accountIdToKey = new Map();
  for (const row of rows) {
    for (const id of row.accountIds) {
      accountIdToKey.set(id, row.shopKey);
    }
  }
  cached = { rows, accountIdToKey };
  return cached;
}

function resetShopRegistryCache() {
  cached = null;
}

module.exports = {
  DEFAULT_ROWS,
  loadShopRegistry,
  resetShopRegistryCache,
};
