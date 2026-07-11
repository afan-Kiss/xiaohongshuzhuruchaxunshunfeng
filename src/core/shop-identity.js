/**
 * Strict shop identity resolution — no fuzzy substring matching.
 */

const SHOP_ROWS = [
  { shopKey: 'xyxiangyu', shopName: 'XY祥钰珠宝', aliases: ['XY祥钰珠宝', 'XY祥钰', 'xy祥钰'] },
  { shopKey: 'xiangyu', shopName: '祥钰珠宝', aliases: ['祥钰珠宝'] },
  { shopKey: 'hetianyayu', shopName: '和田雅玉', aliases: ['和田雅玉'] },
  { shopKey: 'shiyuju', shopName: '拾玉居和田玉', aliases: ['拾玉居和田玉', '拾玉居'] },
];

const SHOP_ID_TO_KEY = {
  xyxiangyu: 'xyxiangyu',
  xiangyu: 'xiangyu',
  hetianyayu: 'hetianyayu',
  shiyuju: 'shiyuju',
};

function normalizeShopTitle(title) {
  return String(title || '')
    .replace(/[-—–]\s*工作台\s*$/i, '')
    .replace(/工作台\s*$/i, '')
    .replace(/千帆/g, '')
    .replace(/客服台?/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function resolveShopTitleFromKey(shopKey) {
  const key = String(shopKey || '').trim();
  const row = SHOP_ROWS.find((r) => r.shopKey === key);
  return row?.shopName || key;
}

function resolveShopFromTitle(pageTitle) {
  const norm = normalizeShopTitle(pageTitle);
  if (!norm) return { ok: false, error: 'unknown_shop', errorCode: 'unknown_shop' };

  const ordered = [...SHOP_ROWS].sort((a, b) => b.shopName.length - a.shopName.length);
  for (const row of ordered) {
    const names = [row.shopName, ...(row.aliases || [])];
    for (const name of names) {
      if (normalizeShopTitle(name) === norm) {
        return { ok: true, shopKey: row.shopKey, shopTitle: row.shopName, normalized: norm };
      }
    }
  }
  return { ok: false, error: 'unknown_shop', errorCode: 'unknown_shop', normalized: norm };
}

function resolveShopFromId(shopId) {
  const id = String(shopId || '').trim().toLowerCase();
  if (!id) return null;
  const key = SHOP_ID_TO_KEY[id] || (SHOP_ROWS.some((r) => r.shopKey === id) ? id : '');
  if (!key) return null;
  return { ok: true, shopKey: key, shopTitle: resolveShopTitleFromKey(key) };
}

function validateShopIdentity(input = {}) {
  const shopKey = String(input.shopKey || '').trim();
  const shopTitle = String(input.shopTitle || input.title || '').trim();
  const shopId = String(input.shopId || '').trim();

  const resolved = new Map();

  if (shopKey) {
    const row = SHOP_ROWS.find((r) => r.shopKey === shopKey);
    if (row) resolved.set('shopKey', { shopKey: row.shopKey, shopTitle: row.shopName });
    else resolved.set('shopKey', { shopKey, shopTitle: shopKey });
  }
  if (shopTitle) {
    const fromTitle = resolveShopFromTitle(shopTitle);
    if (fromTitle.ok) resolved.set('shopTitle', { shopKey: fromTitle.shopKey, shopTitle: fromTitle.shopTitle });
    else resolved.set('shopTitle', { error: fromTitle.errorCode });
  }
  if (shopId) {
    const fromId = resolveShopFromId(shopId);
    if (fromId?.ok) resolved.set('shopId', { shopKey: fromId.shopKey, shopTitle: fromId.shopTitle });
    else resolved.set('shopId', { error: 'unknown_shop' });
  }

  const errors = [...resolved.values()].filter((v) => v.error);
  if (errors.length && !shopKey) {
    return { ok: false, error: 'unknown_shop', errorCode: 'unknown_shop' };
  }

  const keys = new Set();
  const titles = new Set();
  for (const v of resolved.values()) {
    if (v.error) continue;
    keys.add(v.shopKey);
    titles.add(v.shopTitle);
  }

  if (keys.size > 1) {
    return { ok: false, error: 'shop_identity_conflict', errorCode: 'shop_identity_conflict' };
  }
  if (resolved.get('shopTitle')?.error && shopKey) {
    const row = SHOP_ROWS.find((r) => r.shopKey === shopKey);
    const expected = row?.shopName || '';
    const fromTitle = resolveShopFromTitle(shopTitle);
    if (fromTitle.ok && fromTitle.shopKey !== shopKey) {
      return { ok: false, error: 'shop_identity_conflict', errorCode: 'shop_identity_conflict' };
    }
    if (shopTitle && expected && normalizeShopTitle(shopTitle) !== normalizeShopTitle(expected)) {
      return { ok: false, error: 'shop_identity_conflict', errorCode: 'shop_identity_conflict' };
    }
  }

  if (keys.size === 1) {
    const key = [...keys][0];
    return { ok: true, shopKey: key, shopTitle: resolveShopTitleFromKey(key) };
  }
  if (shopKey) {
    return { ok: true, shopKey, shopTitle: resolveShopTitleFromKey(shopKey) };
  }
  if (shopTitle) {
    const fromTitle = resolveShopFromTitle(shopTitle);
    if (fromTitle.ok) return fromTitle;
    return { ok: false, error: 'unknown_shop', errorCode: 'unknown_shop' };
  }
  return { ok: false, error: 'unknown_shop', errorCode: 'unknown_shop' };
}

module.exports = {
  SHOP_ROWS,
  normalizeShopTitle,
  resolveShopFromTitle,
  resolveShopFromId,
  resolveShopTitleFromKey,
  validateShopIdentity,
};
