/**
 * Card render helpers — skip redundant DOM writes.
 */
function buildRenderFingerprint(item, packageId) {
  if (!item) return `${packageId}:loading`;
  return [
    packageId,
    item.state || item.errorCode || '',
    item.hasAfterSale ? '1' : '0',
    item.afterSaleStatus || '',
    item.paidAmount ?? '',
    item.refundApplyAmount ?? '',
    item.refundActualAmount ?? '',
    item.isFullRefund ? '1' : '0',
    item.warningType || '',
    item.profit ?? '',
    item.sfFee ?? '',
    item.sfFeeComplete === false ? 'partial' : '',
    item.sfSuccessCount ?? '',
    item.stale ? '1' : '0',
  ].join('|');
}

function buildCardHtml(blocks, stale) {
  const rowCls = [
    'qsf-inline-fee-row',
    blocks.some((b) => /查询中/.test(b.text)) ? 'qsf-inline-fee-loading' : '',
    stale ? 'qsf-inline-stale' : '',
  ].filter(Boolean).join(' ');
  const segs = blocks.map((block) => {
    const segCls = [
      'qsf-inline-seg',
      block.kind === 'muted' ? 'qsf-inline-fee-muted' : '',
      block.kind === 'refund' ? 'qsf-inline-refund' : '',
      block.kind === 'profit' ? 'qsf-inline-profit' : '',
      block.kind === 'warn' ? 'qsf-inline-warn' : '',
      block.kind === 'warn-full' ? 'qsf-inline-warn-full' : '',
    ].filter(Boolean).join(' ');
    const titleAttr = block.title ? ` title="${escHtml(block.title)}"` : '';
    const text = block.text || `${block.label || ''}${block.label ? '' : ''}`;
    return `<span class="${segCls}"${titleAttr}><span class="qsf-inline-fee-amount">${escHtml(text)}</span></span>`;
  }).join('<span class="qsf-inline-gap"></span>');
  return `<span class="${rowCls}">${segs}</span>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function renderCardHtml(wrap, blocks, stale, fingerprint) {
  if (!wrap || !blocks?.length) return { rendered: false, renderCount: 0 };
  const nextHtml = buildCardHtml(blocks, stale);
  const fp = fingerprint || nextHtml;
  const prevFp = wrap.__qsfFp || '';
  if (prevFp === fp && wrap.innerHTML) {
    return { rendered: false, renderCount: 0 };
  }
  if (wrap.innerHTML === nextHtml) {
    wrap.__qsfFp = fp;
    return { rendered: false, renderCount: 0 };
  }
  wrap.innerHTML = nextHtml;
  wrap.__qsfFp = fp;
  return { rendered: true, renderCount: 1 };
}

module.exports = {
  buildRenderFingerprint,
  buildCardHtml,
  renderCardHtml,
  escHtml,
};
