/** 解析粘贴文本 / CSV 为运单查询行 */
const SF_RE = /\b(SF\d{10,18})\b/gi;

const COL_ALIASES = {
  waybill: ['运单号', '发货单号', '快递单号', '物流单号', '顺丰单号', '物流运单', '快递运单', '运单编号', 'express_no', 'expressno', 'waybill', 'tracking', 'sf'],
  orderId: ['订单号', 'package_id', 'packageid', 'order_id', 'orderid', '订单编号', '包裹号', '发货单'],
  buyerNick: ['买家', '买家昵称', '昵称', 'buyer', 'buyer_nick', 'customer', '收货人'],
  paidAmount: ['实付', '实付金额', '支付金额', '实收款', '买家实付', 'paid', 'paid_amount', 'amount'],
  shipTime: ['发货时间', 'ship_time', 'shipped_at'],
  remark: ['备注', 'remark', 'note'],
};

function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[\s_\-]/g, '');
}

function matchCol(header, aliases) {
  const n = normHeader(header);
  return aliases.some((a) => n === normHeader(a) || n.includes(normHeader(a)));
}

function detectColumns(headers) {
  const map = {};
  headers.forEach((h, i) => {
    for (const [key, aliases] of Object.entries(COL_ALIASES)) {
      if (matchCol(h, aliases)) map[key] = i;
    }
  });
  return map;
}

function parseMoney(v) {
  if (v == null || v === '') return null;
  const m = String(v).replace(/[,，¥￥]/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function extractSfFromText(text) {
  const found = new Set();
  for (const m of String(text || '').matchAll(SF_RE)) {
    found.add(m[1].toUpperCase());
  }
  return [...found];
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if ((c === ',' || c === '\t') && !inQ) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function parseTableRows(rows2d) {
  const table = (rows2d || [])
    .map((row) => (Array.isArray(row) ? row : [row]).map((c) => String(c ?? '').trim()))
    .filter((row) => row.some((c) => c));
  if (!table.length) return [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(table.length, 8); i += 1) {
    const joined = table[i].join(' ');
    if (/订单|运单|实付|买家|package|express|waybill|sf|物流|快递/i.test(joined)) {
      headerIdx = i;
      break;
    }
  }

  const headers = table[headerIdx];
  const colMap = detectColumns(headers);
  const dataLines = table.slice(headerIdx + 1);
  const rows = [];

  for (const cells of dataLines) {
    if (!cells.length) continue;
    let waybill = colMap.waybill != null ? String(cells[colMap.waybill] || '').trim() : '';
    const fromCells = extractSfFromText(cells.join(' '));
    if (!waybill && fromCells.length) waybill = fromCells[0];
    if (!waybill) {
      const fromLine = extractSfFromText(cells.join(','));
      if (!fromLine.length) continue;
      waybill = fromLine[0];
    }
    waybill = waybill.toUpperCase();
    if (!/^SF\d{10,}$/.test(waybill)) continue;
    rows.push({
      waybill,
      orderId: colMap.orderId != null ? String(cells[colMap.orderId] || '').trim() : '',
      buyerNick: colMap.buyerNick != null ? String(cells[colMap.buyerNick] || '').trim() : '',
      paidAmount: colMap.paidAmount != null ? parseMoney(cells[colMap.paidAmount]) : null,
      shipTime: colMap.shipTime != null ? String(cells[colMap.shipTime] || '').trim() : '',
      remark: colMap.remark != null ? String(cells[colMap.remark] || '').trim() : '',
    });
  }
  return dedupeRows(rows);
}

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const table = lines.map((line) => splitCsvLine(line));
  return parseTableRows(table);
}

function parseXlsx(buffer) {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const rows2d = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  return parseTableRows(rows2d);
}

function parseUploadFile(name, buffer) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseXlsx(buffer);
  }
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  return parseCsv(text);
}

function parsePaste(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const waybills = extractSfFromText(line);
    if (!waybills.length) continue;
    for (const waybill of waybills) {
      rows.push({ waybill, orderId: '', buyerNick: '', paidAmount: null, shipTime: '', remark: '' });
    }
  }
  if (!rows.length) {
    for (const waybill of extractSfFromText(text)) {
      rows.push({ waybill, orderId: '', buyerNick: '', paidAmount: null, shipTime: '', remark: '' });
    }
  }
  return dedupeRows(rows);
}

function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.waybill;
    if (!map.has(key)) map.set(key, row);
    else {
      const prev = map.get(key);
      map.set(key, {
        ...prev,
        orderId: prev.orderId || row.orderId,
        buyerNick: prev.buyerNick || row.buyerNick,
        paidAmount: prev.paidAmount ?? row.paidAmount,
        shipTime: prev.shipTime || row.shipTime,
        remark: prev.remark || row.remark,
      });
    }
  }
  return [...map.values()];
}

module.exports = { parseCsv, parsePaste, parseXlsx, parseUploadFile, extractSfFromText };
