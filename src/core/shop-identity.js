/**
 * Strict shop identity resolution — no fuzzy substring matching.
 */
const { loadShopRegistry } = require('./shop-registry');

function getRegistry() {
  return loadShopRegistry();
}

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
  const row = getRegistry().rows.find((r) => r.shopKey === key);
  return row?.shopName || '';
}

function isRegisteredShopKey(shopKey) {
  const key = String(shopKey || '').trim();
  return getRegistry().rows.some((r) => r.shopKey === key);
}

function resolveShopFromTitle(pageTitle) {
  const norm = normalizeShopTitle(pageTitle);
  if (!norm) return { ok: false, error: 'unknown_shop', errorCode: 'unknown_shop' };

  const ordered = [...getRegistry().rows].sort((a, b) => b.shopName.length - a.shopName.length);
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
  const id = String(shopId || '').trim();
  if (!id) return null;
  const reg = getRegistry();
  const key = reg.accountIdToKey.get(id);
  if (!key) return null;
  return { ok: true, shopKey: key, shopTitle: resolveShopTitleFromKey(key) };
}

function validateShopIdentity(input = {}) {
  const shopKey = String(input.shopKey || '').trim();
  const shopTitle = String(input.shopTitle || input.title || '').trim();
  const shopId = String(input.shopId || '').trim();

  if (shopKey && !isRegisteredShopKey(shopKey)) {
    return { ok: false, error: 'unknown_shop', errorCode: 'unknown_shop' };
  }

  const resolved = new Map();

  if (shopKey) {
    const row = getRegistry().rows.find((r) => r.shopKey === shopKey);
    resolved.set('shopKey', { shopKey: row.shopKey, shopTitle: row.shopName });
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
  for (const v of resolved.values()) {
    if (v.error) continue;
    keys.add(v.shopKey);
  }

  if (keys.size > 1) {
    return { ok: false, error: 'shop_identity_conflict', errorCode: 'shop_identity_conflict' };
  }

  if (shopKey && shopTitle) {
    const row = getRegistry().rows.find((r) => r.shopKey === shopKey);
    const fromTitle = resolveShopFromTitle(shopTitle);
    if (fromTitle.ok && fromTitle.shopKey !== shopKey) {
      return { ok: false, error: 'shop_identity_conflict', errorCode: 'shop_identity_conflict' };
    }
    if (row && normalizeShopTitle(shopTitle) !== normalizeShopTitle(row.shopName)) {
      const aliasHit = (row.aliases || []).some((a) => normalizeShopTitle(a) === normalizeShopTitle(shopTitle));
      if (!aliasHit && !fromTitle.ok) {
        return { ok: false, error: 'shop_identity_conflict', errorCode: 'shop_identity_conflict' };
      }
    }
  }

  if (keys.size === 1) {
    const key = [...keys][0];
    return { ok: true, shopKey: key, shopTitle: resolveShopTitleFromKey(key) };
  }
  if (shopTitle) {
    const fromTitle = resolveShopFromTitle(shopTitle);
    if (fromTitle.ok) return fromTitle;
    return { ok: false, error: 'unknown_shop', errorCode: 'unknown_shop' };
  }
  return { ok: false, error: 'unknown_shop', errorCode: 'unknown_shop' };
}

module.exports = {
  get SHOP_ROWS() {
    return getRegistry().rows;
  },
  normalizeShopTitle,
  resolveShopFromTitle,
  resolveShopFromId,
  resolveShopTitleFromKey,
  validateShopIdentity,
  isRegisteredShopKey,
};
