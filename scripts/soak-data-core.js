#!/usr/bin/env node
/**
 * Memory soak test with fake upstream (no real Cookie).
 */
const { createDataCore } = require('../src/core/data-core');

const SOAK_MINUTES = Number(process.env.SOAK_MINUTES || 1);
const INTERVAL_MS = Number(process.env.SOAK_INTERVAL_MS || 2000);

function mem() {
  const u = process.memoryUsage();
  return { heapUsed: u.heapUsed, rss: u.rss };
}

function fmt(n) {
  return `${Math.round(n / 1024 / 1024)}MB`;
}

async function main() {
  const core = createDataCore({
    root: process.cwd(),
    sf: { partnerID: 'P', checkWord: 'W', monthlyCard: 'M' },
    testHooks: {
      getCookie: async () => ({ ok: true, cookie: 'x' }),
      fetchPackage: async (_sk, pid) => ({ packageId: pid, paidAmount: 16800 }),
      fetchSfFee: async () => ({ waybill: 'SF1234567890123', ok: true, totalFee: 12 }),
    },
  });

  const start = mem();
  let peak = { ...start };
  const endAt = Date.now() + SOAK_MINUTES * 60 * 1000;
  let cycles = 0;

  while (Date.now() < endAt) {
    const cards = Array.from({ length: 10 }, (_, i) => ({
      packageId: `P${(cycles + i) % 50}`,
      expressNos: ['SF1234567890123'],
    }));
    await core.batchCards({ shopKey: 'xyxiangyu', shopTitle: 'XY祥钰珠宝', cards });
    cycles += 1;
    const cur = mem();
    if (cur.heapUsed > peak.heapUsed) peak = { ...cur };
    if (cur.rss > peak.rss) peak.rss = cur.rss;
    const m = core.metrics.snapshot();
  if (cycles % 5 === 0) {
      console.log(
        `[soak] cycle=${cycles} heap=${fmt(cur.heapUsed)} rss=${fmt(cur.rss)} cachePkg=${core.getCaches().package.size()} inflight=${m.inflightCount}`,
      );
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  const end = mem();
  const growth = end.heapUsed - start.heapUsed;
  console.log('[soak] summary:');
  console.log(`  duration: ${SOAK_MINUTES} min, cycles: ${cycles}`);
  console.log(`  heap start=${fmt(start.heapUsed)} peak=${fmt(peak.heapUsed)} end=${fmt(end.heapUsed)}`);
  console.log(`  rss  start=${fmt(start.rss)} peak=${fmt(peak.rss)} end=${fmt(end.rss)}`);
  console.log(`  heap growth: ${fmt(growth)}`);

  core.close();

  if (growth > 80 * 1024 * 1024) {
    console.error('[soak] FAIL: heap grew more than 80MB');
    process.exit(1);
  }
  console.log('[soak] PASS');
}

main().catch((err) => {
  console.error('[soak] FAIL', err);
  process.exit(1);
});
