#!/usr/bin/env node
/**
 * Controlled stress test with fake upstream loaders — true parallel pages.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createDataCore } = require('../src/core/data-core');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  let pkgLoads = 0;
  let sfLoads = 0;
  let qfActive = 0;
  let qfMax = 0;
  const shopActive = new Map();
  let shopMax = 0;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-stress-'));
  const core = createDataCore({
    root,
    sf: { partnerID: 'P', checkWord: 'W', monthlyCard: 'M' },
    testHooks: {
      getCookie: async () => ({ ok: true, cookie: 'x' }),
      fetchPackage: async (shopKey) => {
        qfActive += 1;
        shopActive.set(shopKey, (shopActive.get(shopKey) || 0) + 1);
        qfMax = Math.max(qfMax, qfActive);
        shopMax = Math.max(shopMax, shopActive.get(shopKey) || 0);
        pkgLoads += 1;
        await sleep(25);
        shopActive.set(shopKey, (shopActive.get(shopKey) || 1) - 1);
        qfActive -= 1;
        return { packageId: 'x', expressNos: ['SF1234567890123'], paidAmount: 16800 };
      },
      fetchSfFee: async (waybill) => {
        sfLoads += 1;
        await sleep(15);
        return { waybill, ok: true, totalFee: 13 };
      },
    },
  });

  const sameKey = 'SF1234567890123';
  const sameKeyStart = Date.now();
  await Promise.all(
    Array.from({ length: 100 }, () =>
      core.batchCards({
        shopKey: 'xyxiangyu',
        shopTitle: 'XY祥钰珠宝',
        cards: [{ packageId: 'P_SAME', expressNos: [sameKey] }],
      }),
    ),
  );
  const sameKeyMs = Date.now() - sameKeyStart;
  const afterSameKeyPkgLoads = pkgLoads;
  const afterSameKeySfLoads = sfLoads;

  const sfWaybills = Array.from({ length: 20 }, (_, i) => `SF1234567890${String(i).padStart(3, '0')}`);
  const cards20 = sfWaybills.map((w, i) => ({
    packageId: `P${i}`,
    expressNos: [w],
  }));

  const shops = [
    { shopKey: 'xyxiangyu', shopTitle: 'XY祥钰珠宝' },
    { shopKey: 'xiangyu', shopTitle: '祥钰珠宝' },
  ];

  const coldTimes = [];
  const warmTimes = [];

  const pageRuns = shops.flatMap((shop) =>
    Array.from({ length: 2 }, () => async () => {
      const t0 = Date.now();
      const r = await core.batchCards({ ...shop, cards: cards20 });
      coldTimes.push(Date.now() - t0);
      if (!r.ok) throw new Error('batch failed');
    }),
  );

  pkgLoads = 0;
  sfLoads = 0;
  await Promise.all(pageRuns.map((fn) => fn()));

  const warmStart = Date.now();
  await Promise.all(pageRuns.map((fn) => fn()));
  warmTimes.push(Date.now() - warmStart);

  coldTimes.sort((a, b) => a - b);
  warmTimes.sort((a, b) => a - b);
  const m = core.metrics.snapshot();

  console.log('[stress] results:');
  console.log(`  100 same-key Data Core package loaders: ${afterSameKeyPkgLoads} (expect 1)`);
  console.log(`  100 same-key Data Core sf loaders: ${afterSameKeySfLoads} (expect 1)`);
  console.log(`  100 same-key wall ms: ${sameKeyMs}`);
  console.log(`  parallel pages: ${pageRuns.length} (Promise.all)`);
  console.log(`  simulated shops: ${shops.length}`);
  console.log(`  qf global max concurrent: ${qfMax} (expect <=4)`);
  console.log(`  qf per-shop max concurrent: ${shopMax} (expect <=2)`);
  console.log(`  sf loader total (cold 4 pages x 20 waybills): ${sfLoads} (expect <=120, >1)`);
  console.log(`  cold P50=${percentile(coldTimes, 50)}ms P95=${percentile(coldTimes, 95)}ms P99=${percentile(coldTimes, 99)}ms`);
  console.log(`  warm P50=${percentile(warmTimes, 50)}ms P95=${percentile(warmTimes, 95)}ms P99=${percentile(warmTimes, 99)}ms`);
  console.log(`  metrics: ${JSON.stringify(m)}`);

  core.close();

  let fail = false;
  if (afterSameKeyPkgLoads !== 1) fail = true;
  if (afterSameKeySfLoads !== 1) fail = true;
  if (qfMax > 4) fail = true;
  if (shopMax > 2) fail = true;
  if (sfLoads <= 1) fail = true;
  if (fail) process.exit(1);
  console.log('[stress] PASS');
}

main().catch((err) => {
  console.error('[stress] FAIL', err);
  process.exit(1);
});
