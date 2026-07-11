const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveShopFromTitle,
  validateShopIdentity,
  normalizeShopTitle,
} = require('../../src/core/shop-identity');

describe('shop identity', () => {
  it('XY祥钰 vs 祥钰珠宝 exact match', () => {
    assert.equal(resolveShopFromTitle('XY祥钰珠宝-工作台').shopKey, 'xyxiangyu');
    assert.equal(resolveShopFromTitle('祥钰珠宝-工作台').shopKey, 'xiangyu');
  });

  it('other shops', () => {
    assert.equal(resolveShopFromTitle('和田雅玉').shopKey, 'hetianyayu');
    assert.equal(resolveShopFromTitle('拾玉居和田玉').shopKey, 'shiyuju');
  });

  it('unknown shop', () => {
    const r = resolveShopFromTitle('未知店铺');
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, 'unknown_shop');
  });

  it('shop identity conflict', () => {
    const r = validateShopIdentity({
      shopKey: 'xyxiangyu',
      shopTitle: '祥钰珠宝',
    });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, 'shop_identity_conflict');
  });

  it('consistent identity passes', () => {
    const r = validateShopIdentity({
      shopKey: 'xyxiangyu',
      shopTitle: 'XY祥钰珠宝-工作台',
    });
    assert.equal(r.ok, true);
    assert.equal(r.shopKey, 'xyxiangyu');
  });

  it('normalize removes suffix noise', () => {
    assert.equal(normalizeShopTitle('XY祥钰珠宝-工作台'), 'XY祥钰珠宝');
    assert.equal(normalizeShopTitle(' 祥钰珠宝 千帆客服 '), '祥钰珠宝');
  });
});
