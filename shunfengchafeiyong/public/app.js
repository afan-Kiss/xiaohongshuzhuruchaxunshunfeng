(function () {
  const base = (function detectBase() {
    const p = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
    return p || '/shunfengchafeiyong';
  })();

  const api = (path) => `${base}/api${path}`;

  let lastRows = [];
  let importedRows = [];
  let csvText = '';
  let activeTab = 'paste';

  const $ = (id) => document.getElementById(id);

  function money(n) {
    const v = Number(n);
    return Number.isFinite(v) ? `¥${v.toFixed(2)}` : '—';
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function previewImportedRows(rows, fileName) {
    const sample = rows.slice(0, 8).map((r) => [
      r.waybill,
      r.orderId || '',
      r.buyerNick || '',
      r.paidAmount != null ? r.paidAmount : '',
    ].join('\t')).join('\n');
    $('csvPreview').value = [
      `文件：${fileName}`,
      `识别 ${rows.length} 个顺丰运单号`,
      '',
      '运单号\t订单号\t买家\t实付',
      sample,
      rows.length > 8 ? `\n… 还有 ${rows.length - 8} 条` : '',
    ].join('\n');
  }

  async function loadStatus() {
    const bar = $('statusBar');
    try {
      const r = await fetch(api('/status'));
      const d = await r.json();
      if (!d.ok) {
        bar.className = 'status-bar err';
        bar.textContent = '丰桥未配置：请在服务器 config.json 填写 partnerID / checkWord / monthlyCard';
        return;
      }
      bar.className = 'status-bar ok';
      bar.textContent = `丰桥已就绪 · 顾客编码 ${d.partnerID} · 月结卡 ${d.monthlyCard} · ${d.env === 'sandbox' ? '沙箱' : '生产'}`;
    } catch (e) {
      bar.className = 'status-bar err';
      bar.textContent = `无法连接 API：${e.message}`;
    }
  }

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active'));
      $(`pane-${activeTab}`).classList.add('active');
    });
  });

  $('csvFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importedRows = [];
    csvText = '';
    const prog = $('progress');
    prog.textContent = '正在解析文件…';

    const lower = file.name.toLowerCase();
    const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls');

    try {
      if (isExcel) {
        const buffer = await file.arrayBuffer();
        const r = await fetch(api('/parse-file'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            data: arrayBufferToBase64(buffer),
          }),
        });
        const data = await r.json();
        if (!data.ok) {
          $('csvPreview').value = data.error || 'Excel 解析失败';
          prog.textContent = '';
          return;
        }
        importedRows = data.rows || [];
        previewImportedRows(importedRows, file.name);
        prog.textContent = `已解析 ${importedRows.length} 个运单号，点击「开始查询并排序」`;
        return;
      }

      csvText = await file.text();
      const r = await fetch(api('/parse'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'csv', text: csvText }),
      });
      const data = await r.json();
      if (!data.ok || !data.rows?.length) {
        $('csvPreview').value = (csvText.slice(0, 4000) + (csvText.length > 4000 ? '\n…' : ''))
          + '\n\n未识别到 SF 运单号，请检查列名或改用 Excel 导出';
        prog.textContent = '';
        return;
      }
      importedRows = data.rows;
      previewImportedRows(importedRows, file.name);
      prog.textContent = `已解析 ${importedRows.length} 个运单号，点击「开始查询并排序」`;
    } catch (err) {
      $('csvPreview').value = String(err.message || err);
      prog.textContent = '';
    }
  });

  function renderRows(data) {
    lastRows = data.rows || [];
    $('summary').classList.remove('hidden');
    $('statCount').textContent = String(data.count || 0);
    $('statOk').textContent = String(data.successCount || 0);
    $('statTotal').textContent = money(data.totalFee);
    $('statAvg').textContent = money(data.avgFee);
    $('statMax').textContent = money(data.maxFee);

    const tbody = $('resultBody');
    if (!lastRows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">无结果</td></tr>';
      $('btnExport').disabled = true;
      return;
    }

    tbody.innerHTML = lastRows.map((r, i) => {
      const feeCell = r.ok
        ? `<td class="fee">${money(r.totalFee)}</td>`
        : `<td class="fee">—</td>`;
      const status = r.ok
        ? (r.lossHint ? `<span style="color:var(--warn)">${esc(r.lossHint)}</span>` : '成功')
        : `<span class="err">${esc(r.error)}</span>`;
      return `<tr>
        <td>${i + 1}</td>
        ${feeCell}
        <td>${esc(r.waybill)}</td>
        <td>${esc(r.orderId)}</td>
        <td>${esc(r.buyerNick)}</td>
        <td>${r.paidAmount != null ? money(r.paidAmount) : '—'}</td>
        <td>${esc(r.route)}</td>
        <td>${r.weight != null ? r.weight : '—'}</td>
        <td>${status}</td>
      </tr>`;
    }).join('');
    $('btnExport').disabled = false;
  }

  $('btnQuery').addEventListener('click', async () => {
    const btn = $('btnQuery');
    const prog = $('progress');
    btn.disabled = true;
    const total = activeTab === 'csv' && importedRows.length
      ? importedRows.length
      : (activeTab === 'paste' ? ($('pasteInput').value.match(/\bSF\d{10,18}\b/gi) || []).length : 0);
    const etaMin = total > 0 ? Math.max(1, Math.ceil(total / 6 * 0.5 / 60)) : 0;
    prog.textContent = total > 0
      ? `正在查询 ${total} 单，请稍候${etaMin > 1 ? `（约 ${etaMin} 分钟）` : ''}…`
      : '正在查询丰桥，请稍候…';

    let body;
    if (activeTab === 'csv') {
      if (importedRows.length) {
        body = { rows: importedRows };
      } else {
        body = { mode: 'csv', text: csvText || $('csvPreview').value };
      }
    } else {
      body = { mode: 'paste', text: $('pasteInput').value };
    }

    try {
      const r = await fetch(api('/batch-query'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!data.ok) {
        alert(data.error || '查询失败');
        prog.textContent = '';
        return;
      }
      renderRows(data);
      prog.textContent = `完成：${data.successCount}/${data.count} 成功，月结合计 ${money(data.totalFee)}`;
    } catch (e) {
      alert(String(e.message || e));
      prog.textContent = '';
    } finally {
      btn.disabled = false;
    }
  });

  $('btnExport').addEventListener('click', () => {
    if (!lastRows.length) return;
    const header = ['排名', '月结扣费', '运单号', '订单号', '买家', '实付金额', '线路', '计费重', '状态', '错误信息'];
    const lines = [header.join(',')];
    lastRows.forEach((r, i) => {
      lines.push([
        i + 1,
        r.ok ? r.totalFee : '',
        r.waybill,
        r.orderId,
        r.buyerNick,
        r.paidAmount ?? '',
        r.route,
        r.weight ?? '',
        r.ok ? '成功' : '失败',
        r.error || '',
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    });
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `顺丰运费分析_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });

  loadStatus();
})();
