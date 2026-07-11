/**
 * Place inline fee wrap between quantity and payment columns in order card footer.
 */
const QTY_RE = /共\s*\d+\s*件/;
const EXCLUDE_SELECTORS = [
  '.delivery-row-logistics',
  '.logistics-box',
  '.order-card-header',
  '.sku-list',
  '.goods-list',
  '.goods-info',
  '.after-sale-box',
  '[class*="after-sale"]',
  '[class*="logistics"]',
];

function isAmountSummaryContext(el) {
  return Boolean(el?.closest?.('.summary, .order-card-footer, [class*="summary"]'));
}

function isPayAnchorText(t, el) {
  if (!/(实付|应付)/.test(t) || t.length > 80) return false;
  if (/[¥￥]/.test(t) || /\d/.test(t)) return true;
  if (isLeafTextEl(el) && (/^实付$/.test(t) || /^应付$/.test(t))) {
    const parentText = normText(el.parentElement?.textContent || '');
    return /[¥￥]/.test(parentText) || /\d/.test(parentText);
  }
  return false;
}

function isExcluded(el, card) {
  if (!el || !card) return true;
  if (isAmountSummaryContext(el)) return false;
  for (const sel of EXCLUDE_SELECTORS) {
    if (el.closest?.(sel)) return true;
  }
  return false;
}

function getDirectChildUnder(row, element) {
  let current = element;
  while (current && current.parentElement !== row) {
    current = current.parentElement;
  }
  return current || null;
}

function normText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function rowScore(row, card) {
  if (!row || row === card) return -1;
  let score = 0;
  const cls = String(row.className || '');
  if (/order-card-footer/i.test(cls)) score += 50;
  if (/summary/i.test(cls)) score += 40;
  if (/footer|amount|price|pay/i.test(cls)) score += 20;
  let depth = 0;
  let cur = row;
  while (cur && cur !== card) {
    depth += 1;
    cur = cur.parentElement;
  }
  score += Math.max(0, 15 - depth);
  return score;
}

function isLeafTextEl(el) {
  return !el.children?.length;
}

function findAnchorElements(card) {
  const qty = [];
  const pay = [];
  const nodes = card.querySelectorAll('span, div, p');
  for (const el of nodes) {
    if (el.closest?.('.qsf-inline-fee-wrap')) continue;
    if (isExcluded(el, card)) continue;
    if (!isLeafTextEl(el)) continue;
    const t = normText(el.textContent);
    if (!t) continue;
    if (QTY_RE.test(t) && !/(实付|应付)/.test(t) && t.length <= 40) qty.push(el);
    if (/实付/.test(t) && isPayAnchorText(t, el)) {
      pay.push({ el, pri: 2 });
    } else if (/应付/.test(t) && isPayAnchorText(t, el)) {
      pay.push({ el, pri: 1 });
    }
  }
  return { qty, pay };
}

function pickSmallestText(els) {
  return els.reduce((best, el) => {
    if (!best) return el;
    const bl = normText(best.textContent).length;
    const elLen = normText(el.textContent).length;
    return elLen <= bl ? el : best;
  }, null);
}

function pickBestPay(payList) {
  if (!payList.length) return null;
  return [...payList].sort(
    (a, b) => b.pri - a.pri || normText(a.el.textContent).length - normText(b.el.textContent).length,
  )[0].el;
}

function findOrderAmountRow(card) {
  if (!card) return { row: null, qtyAnchor: null, payAnchor: null };
  const { qty: qtyList, pay: payList } = findAnchorElements(card);
  const qtyAnchor = pickSmallestText(qtyList);
  const payAnchor = pickBestPay(payList);
  if (!qtyAnchor || !payAnchor) return { row: null, qtyAnchor, payAnchor };

  let candidate = payAnchor.parentElement;
  let best = null;
  let bestScore = -1;
  while (candidate && candidate !== card) {
    if (candidate.contains(qtyAnchor) && candidate.contains(payAnchor)) {
      const qtyColumn = getDirectChildUnder(candidate, qtyAnchor);
      const payColumn = getDirectChildUnder(candidate, payAnchor);
      if (qtyColumn && payColumn && qtyColumn !== payColumn) {
        const score = rowScore(candidate, card);
        if (score > bestScore) {
          bestScore = score;
          best = { row: candidate, qtyAnchor, payAnchor, qtyColumn, payColumn };
        }
      }
    }
    candidate = candidate.parentElement;
  }
  if (best) return best;
  return { row: null, qtyAnchor, payAnchor };
}

function isPositionCorrect(wrap, row, qtyColumn, payColumn) {
  if (!wrap || !row || wrap.parentElement !== row) return false;
  if (!qtyColumn || !payColumn) return false;
  const children = [...row.children];
  const qi = children.indexOf(qtyColumn);
  const wi = children.indexOf(wrap);
  const pi = children.indexOf(payColumn);
  return qi >= 0 && wi >= 0 && pi >= 0 && qi < wi && wi < pi;
}

function ensureFeeWrapPosition(card, wrap) {
  if (!card || !wrap) return false;
  const { row, qtyAnchor, payAnchor } = findOrderAmountRow(card);
  if (!row || !qtyAnchor || !payAnchor) return false;
  const qtyColumn = getDirectChildUnder(row, qtyAnchor);
  const payColumn = getDirectChildUnder(row, payAnchor);
  if (!qtyColumn || !payColumn) return false;
  if (isPositionCorrect(wrap, row, qtyColumn, payColumn)) return true;
  row.insertBefore(wrap, payColumn);
  return isPositionCorrect(wrap, row, qtyColumn, payColumn);
}

function ensureFeeWrap(card, version) {
  const wraps = [...card.querySelectorAll('.qsf-inline-fee-wrap')];
  let wrap = wraps[0] || null;
  for (let i = 1; i < wraps.length; i += 1) wraps[i].remove();
  if (!wrap) {
    wrap = document.createElement('span');
    wrap.className = 'qsf-inline-fee-wrap';
    wrap.setAttribute('data-qsf-inline', version);
  }
  if (!ensureFeeWrapPosition(card, wrap)) {
    const found = findOrderAmountRow(card);
    if (found.row && found.payColumn) {
      found.row.insertBefore(wrap, found.payColumn);
    }
  }
  return wrap;
}

module.exports = {
  QTY_RE,
  normText,
  getDirectChildUnder,
  findOrderAmountRow,
  isPositionCorrect,
  ensureFeeWrapPosition,
  ensureFeeWrap,
};
