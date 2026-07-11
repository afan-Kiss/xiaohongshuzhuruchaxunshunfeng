#!/usr/bin/env node
/**
 * Controlled stress test with fake upstream loaders.
 */
const { createDataCore } = require('../src/core/data-core');
const { createSingleflight } = require('../src/core/singleflight');
const { createMetrics } = require('../src/core/metrics');

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
  let qfMax = 0;
  let qfActive = 0;

  const core = createDataCore({
    root: process.cwd(),
    sf: { partnerID: 'P', checkWord: 'W', monthlyCard: 'M' },
    testHooks: {
      getCookie: async () => ({ ok: true, cookie: 'x' }),
      fetchPackage: async () => {
        qfActive += 1;
        qfMax = Math.max(qfMax, qfActive);
        pkgLoads += 1;
        await sleep(25);
        qfActive -= 1;
        return { packageId: 'P1', expressNos: ['SF1234567890123'], paidAmount: 16800 };
      },
      fetchSfFee: async () => {
        sfLoads += 1;
        await sleep(20);
        return { waybill: 'SF1234567890123', ok: true, totalFee: 13 };
      },
    },
  });

  const sf = createSingleflight(createMetrics());
  let joined = 0;
  let loaderRuns = 0;
  const sameKeyStart = Date.now();
  await Promise.all(
    Array.from({ length: 100 }, () =>
      sf.run('waybill:SF123', async () => {
        joined += 1;
        loaderRuns += 1;
        await sleep(40);
        return 13;
      }),
    ),
  );
  const sameKeyMs = Date.now() - sameKeyStart;

  const cards = Array.from({ length: 20 }, (_, i) => ({
    packageId: `P${i}`,
    expressNos: ['SF1234567890123'],
  }));

  const batchTimes = [];
  for (let page = 0; page < 4; page++) {
    const t0 = Date.now();
    const r = await core.batchCards({
      shopKey: 'xyxiangyu',
      shopTitle: 'XY祥钰珠宝',
      cards,
    });
    batchTimes.push(Date.now() - t0);
    if (!r.ok) {
      console.error('[stress] batch failed', r);
      process.exit(1);
    }
  }

  batchTimes.sort((a, b) => a - b);
  const m = core.metrics.snapshot();

  console.log('[stress] results:');
  console.log(`  100 same-key loader runs: ${loaderRuns} (expect 1)`);
  console.log(`  100 same-key joined: ${joined - loaderRuns} (expect 99)`);
  console.log(`  20-card qf max concurrent: ${qfMax} (expect <=4)`);
  console.log(`  package loader total (4 pages): ${pkgLoads}`);
  console.log(`  sf loader total (4 pages): ${sfLoads}`);
  console.log(`  batch P50=${percentile(batchTimes, 50)}ms P95=${percentile(batchTimes, 95)}ms P99=${percentile(batchTimes, 99)}ms`);
  console.log(`  metrics: ${JSON.stringify(m)}`);

  core.close();

  if (loaderRuns !== 1) process.exit(1);
  if (qfMax > 4) process.exit(1);
  console.log('[stress] PASS');
}

main().catch((err) => {
  console.error('[stress] FAIL', err);
  process.exit(1);
});
