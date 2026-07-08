/**
 * @deprecated 侧栏已废弃，请使用 inject/qf-sf-fee-inline.js
 * 保留此文件仅为清除浏览器中残留的旧注入脚本。
 */
(function qfSfFeePanelKillSwitch() {
  try {
    if (window.__qfSfFeePanel?.teardown) window.__qfSfFeePanel.teardown();
    document.querySelectorAll('#qf-sf-fee-panel-root').forEach((el) => el.remove());
    document.getElementById('qf-sf-fee-panel-style')?.remove();
    document.documentElement.classList.remove('qsf-page-docked');
    document.body?.classList.remove('qsf-page-docked');
    try { sessionStorage.removeItem('qsf_panel_pinned_v1'); } catch { /* ignore */ }
    delete window.__qfSfFeePanel;
    delete window.__qfSfExpandPanel;
    delete window.__qfSfLauncherDragCleanup;
    if (window.__qfSfFeeInline?.rescan) window.__qfSfFeeInline.rescan();
  } catch {
    /* ignore */
  }
})();
