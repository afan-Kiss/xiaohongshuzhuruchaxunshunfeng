const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderCardHtml, buildRenderFingerprint } = require('../../src/client/render-utils');

describe('render-utils', () => {
  it('skips duplicate innerHTML writes', () => {
    const wrap = { innerHTML: '', __qsfFp: '' };
    const blocks = [{ kind: 'muted', label: '实付', text: '16800' }];
    const fp = buildRenderFingerprint({ paidAmount: 16800, state: 'ok' }, 'P1');
    const r1 = renderCardHtml(wrap, blocks, false, fp);
    assert.equal(r1.rendered, true);
    const html = wrap.innerHTML;
    const r2 = renderCardHtml(wrap, blocks, false, fp);
    assert.equal(r2.rendered, false);
    assert.equal(wrap.innerHTML, html);
  });
});
