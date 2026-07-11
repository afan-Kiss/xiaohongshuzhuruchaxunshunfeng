const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  findOrderAmountRow,
  getDirectChildUnder,
  ensureFeeWrapPosition,
  ensureFeeWrap,
  isPositionCorrect,
} = require('../../src/client/amount-row-placement');

function createDom(html) {
  if (typeof document !== 'undefined' && document.createElement) {
    const root = document.createElement('div');
    root.innerHTML = html.trim();
    return root.firstElementChild;
  }
  return parseHtmlTree(html.trim());
}

function parseHtmlTree(html) {
  const tagRe = /<(\/?)([\w-]+)([^>]*)>/g;
  const root = { tagName: 'ROOT', children: [], parentElement: null, className: '', textContent: '' };
  const stack = [root];
  let lastIndex = 0;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const text = html.slice(lastIndex, m.index);
    if (text.trim()) {
      const parent = stack[stack.length - 1];
      const textNode = { nodeType: 3, textContent: text };
      parent.childNodes = parent.childNodes || [];
      parent.childNodes.push(textNode);
      parent.textContent = (parent.textContent || '') + text;
    }
    lastIndex = tagRe.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2];
    const attrs = m[3] || '';
    if (closing) {
      stack.pop();
      continue;
    }
    const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
    const el = makeElement(tag, cls);
    const parent = stack[stack.length - 1];
    parent.children.push(el);
    parent.childNodes = parent.childNodes || [];
    parent.childNodes.push(el);
    el.parentElement = parent === root ? null : parent;
    stack.push(el);
  }
  return root.children[0];
}

function makeElement(tag, className = '') {
  const el = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    className,
    classList: {
      contains: (c) => className.split(/\s+/).filter(Boolean).includes(c),
    },
    children: [],
    childNodes: [],
    parentElement: null,
    textContent: '',
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    contains(node) {
      if (node === this) return true;
      return this.children.some((c) => c === node || c.contains?.(node));
    },
    closest(sel) {
      let cur = this;
      while (cur) {
        if (cur.matches?.(sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    matches(sel) {
      if (sel.startsWith('.')) return this.className.split(/\s+/).filter(Boolean).includes(sel.slice(1));
      if (sel.includes('[class*="')) {
        const cls = sel.match(/\[class\*="([^"]+)"\]/)?.[1];
        return cls ? this.className.includes(cls) : false;
      }
      return false;
    },
    querySelector(sel) {
      const all = this.querySelectorAll(sel);
      return all[0] || null;
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        if (node.nodeType !== 1) return;
        let match = false;
        if (sel === '.qsf-inline-fee-wrap') match = node.className.includes('qsf-inline-fee-wrap');
        else if (sel === 'span, div, p') match = /^(SPAN|DIV|P)$/.test(node.tagName);
        else if (sel.startsWith('.')) match = node.className.split(/\s+/).filter(Boolean).includes(sel.slice(1));
        if (match) out.push(node);
        for (const c of node.children) walk(c);
      };
      walk(this);
      return out;
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      this.childNodes.push(child);
      this._syncText();
      return child;
    },
    insertBefore(child, ref) {
      child.parentElement = this;
      const idx = ref ? this.children.indexOf(ref) : this.children.length;
      this.children.splice(idx < 0 ? this.children.length : idx, 0, child);
      this.childNodes.splice(idx < 0 ? this.childNodes.length : idx, 0, child);
      this._syncText();
      return child;
    },
    remove() {
      if (!this.parentElement) return;
      const p = this.parentElement;
      p.children = p.children.filter((c) => c !== this);
      p.childNodes = p.childNodes.filter((c) => c !== this);
      this.parentElement = null;
      p._syncText?.();
    },
    _syncText() {
      this.textContent = this.children.map((c) => c.textContent || '').join('');
      if (this.parentElement?._syncText) this.parentElement._syncText();
    },
  };
  return el;
}

function setText(el, text) {
  const child = { nodeType: 3, textContent: text };
  el.children = [];
  el.childNodes = [child];
  el.textContent = text;
}

function buildAmountRowCard() {
  const card = makeElement('div', 'order-card');
  const goods = makeElement('div', 'goods-info');
  setText(goods, '商品名称 实付￥999');
  card.appendChild(goods);
  const logistics = makeElement('div', 'logistics-box');
  setText(logistics, '顺丰 SF123 实付信息');
  card.appendChild(logistics);
  const footer = makeElement('div', 'order-card-footer');
  const row = makeElement('div', 'amount-row');
  const qty = makeElement('span', 'qty-col');
  setText(qty, '共 1 件');
  const payWrap = makeElement('span', 'pay-col');
  const payYing = makeElement('span', 'ying');
  setText(payYing, '应付￥1998');
  const payShi = makeElement('span', 'shi');
  setText(payShi, '实付￥1998');
  payWrap.appendChild(payYing);
  payWrap.appendChild(payShi);
  row.appendChild(qty);
  row.appendChild(payWrap);
  footer.appendChild(row);
  card.appendChild(footer);
  return { card, row, qty, payWrap };
}

describe('amount-row-placement v3.0.5', () => {
  if (typeof document === 'undefined') {
    global.document = { createElement: (tag) => makeElement(tag, '') };
  }

  it('qty and pay siblings → plugin inserted between', () => {
    const { card, row, qty, payWrap } = buildAmountRowCard();
    const wrap = makeElement('span', 'qsf-inline-fee-wrap');
    wrap.setAttribute('data-qsf-inline', '3.0.5');
    row.insertBefore(wrap, payWrap);
    const found = findOrderAmountRow(card);
    assert.ok(found.row);
    assert.equal(getDirectChildUnder(found.row, found.qtyAnchor).textContent, '共 1 件');
    assert.match(found.payAnchor.textContent, /实付/);
    const children = [...found.row.children];
    const qi = children.indexOf(qty);
    const wi = children.indexOf(wrap);
    const pi = children.indexOf(payWrap);
    assert.ok(qi < wi && wi < pi);
  });

  it('nested span layers → uses common amount row', () => {
    const { card, row } = buildAmountRowCard();
    const wrap = makeElement('span', 'qsf-inline-fee-wrap');
    ensureFeeWrapPosition(card, wrap);
    assert.equal(wrap.parentElement, row);
    assert.ok(isPositionCorrect(wrap, row, row.children[0], row.children[row.children.length - 1]));
  });

  it('multiple 实付 texts → picks footer summary row', () => {
    const card = makeElement('div', 'order-card');
    const goods = makeElement('div', 'goods-info');
    setText(goods, '实付￥100');
    card.appendChild(goods);
    const footer = makeElement('div', 'order-card-footer');
    const row = makeElement('div', 'summary');
    const qty = makeElement('span', '');
    setText(qty, '共 2 件');
    const pay = makeElement('span', '');
    setText(pay, '实付￥520');
    row.appendChild(qty);
    row.appendChild(pay);
    footer.appendChild(row);
    card.appendChild(footer);
    const found = findOrderAmountRow(card);
    assert.equal(found.row, row);
    assert.match(found.payAnchor.textContent, /实付￥520/);
  });

  it('amount row re-render restores position', () => {
    const { card, row, payWrap } = buildAmountRowCard();
    const wrap = ensureFeeWrap(card, '3.0.5');
    card.appendChild(wrap);
    ensureFeeWrapPosition(card, wrap);
    assert.equal(wrap.parentElement, row);
    const pi = [...row.children].indexOf(payWrap);
    const wi = [...row.children].indexOf(wrap);
    assert.ok(wi >= 0 && wi < pi);
  });

  it('continuous ensure keeps single plugin node', () => {
    const { card } = buildAmountRowCard();
    for (let i = 0; i < 100; i += 1) {
      ensureFeeWrap(card, '3.0.5');
    }
    assert.equal(card.querySelectorAll('.qsf-inline-fee-wrap').length, 1);
  });

  it('qianfan summary row with label-only 实付', () => {
    const card = makeElement('div', 'order-card');
    const container = makeElement('div', 'goods-info-container');
    const row = makeElement('div', 'summary');
    const qty = makeElement('span', 'summary-left');
    setText(qty, '共 1 件');
    const payCol = makeElement('div', 'summary-right');
    const payYingLabel = makeElement('span', 'summary-right-sub-label');
    setText(payYingLabel, '应付');
    const payShiLabel = makeElement('span', 'summary-right-label');
    setText(payShiLabel, '实付');
    payCol.appendChild(payYingLabel);
    payCol.appendChild(payShiLabel);
    payCol.textContent = '应付¥1998 实付 ¥1998';
    row.appendChild(qty);
    row.appendChild(payCol);
    container.appendChild(row);
    card.appendChild(container);
    const wrap = ensureFeeWrap(card, '3.0.5');
    assert.equal(wrap.parentElement, row);
    const kids = [...row.children];
    assert.ok(kids.indexOf(qty) < kids.indexOf(wrap));
    assert.ok(kids.indexOf(wrap) < kids.indexOf(payCol));
  });
});
