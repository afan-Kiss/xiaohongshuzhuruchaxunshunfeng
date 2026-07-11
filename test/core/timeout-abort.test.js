const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { runWithAbortTimeout } = require('../../src/core/abort-timeout');
const { createDataCore } = require('../../src/core/data-core');
const path = require('path');
const os = require('os');
const fs = require('fs');

describe('abort timeout', () => {
  it('aborts hanging upstream and allows next request', async () => {
    const server = http.createServer((_req, res) => {
      /* never respond */
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    let active = 0;
    const hang = () => runWithAbortTimeout(async (signal) => {
      active += 1;
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal });
      return res.text();
    }, 80, 'hang').finally(() => { active -= 1; });

    await assert.rejects(hang, (e) => e.code === 'timeout');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(active, 0);

    const ok = await runWithAbortTimeout(async () => 'ok', 100, 'fast');
    assert.equal(ok, 'ok');
    server.close();
  });

  it('data-core timeout releases inflight via fake hook', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-timeout-'));
    const core = createDataCore({
      root,
      sf: { partnerID: 'p', checkWord: 'w', monthlyCard: 'm' },
      testHooks: {
        getCookie: async () => ({ ok: true, cookie: 'c' }),
        fetchPackage: async (_sk, _pid, signal) => {
          await new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
          });
          return { packageId: 'P1' };
        },
      },
    });
    await assert.rejects(
      core.fetchPackage('xyxiangyu', 'P1'),
      (e) => e.code === 'timeout',
    );
    assert.equal(core.metrics.snapshot().inflightCount, 0);
    core.close();
  });
});
