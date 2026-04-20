/**
 * IH35 ERP — approved print documents (Arial/Helvetica, fixed pt scale).
 * Browser-only IIFE; exposes window.generatePrintWindow, helpers, generateFilename.
 */
(function (global) {
  'use strict';

  const PRINT_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8pt;
      color: #111;
      background: #ffffff;
      line-height: 1.4;
    }
    @page { size: letter portrait; margin: 0.65in 0.65in 0.75in 0.65in; }
    .pwrap { max-width: 7in; margin: 0 auto 0.55in; padding-bottom: 0.15in; }
    .letterhead {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1.5pt solid #1a1f36;
      padding-bottom: 8pt;
      margin-bottom: 10pt;
    }
    .co-name { font-size: 11pt; font-weight: bold; color: #1a1f36; }
    .co-sub { font-size: 7pt; color: #555; margin-top: 2pt; line-height: 1.5; }
    .doc-title-box { text-align: right; }
    .doc-title {
      display: inline-block;
      font-size: 13pt;
      font-weight: bold;
      color: #1a1f36;
      border: 1.5pt solid #1a1f36;
      padding: 3pt 10pt;
    }
    .doc-sub { font-size: 7pt; color: #555; margin-top: 3pt; }
    .section {
      border: 0.5pt solid #ccc;
      margin-bottom: 7pt;
      page-break-inside: avoid;
    }
    .section-header {
      background: #1a1f36;
      color: #ffffff;
      padding: 3pt 7pt;
      font-size: 6.5pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .section-body { padding: 6pt 8pt; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt; }
    .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8pt; }
    .grid4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8pt; }
    .field { margin-bottom: 4pt; }
    .field-label {
      font-size: 6.5pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #666;
      margin-bottom: 1pt;
      display: block;
    }
    .field-value {
      font-size: 8pt;
      color: #111;
      border-bottom: 0.5pt solid #999;
      padding-bottom: 1pt;
      min-height: 11pt;
      display: block;
    }
    .field-value.large { font-size: 11pt; font-weight: bold; }
    .border-left { border-left: 1pt solid #ccc; padding-left: 8pt; }
    table { width: 100%; border-collapse: collapse; font-size: 7pt; margin-bottom: 4pt; }
    thead { display: table-header-group; }
    thead tr { background: #1a1f36; }
    thead th {
      color: #ffffff;
      padding: 3pt 5pt;
      text-align: left;
      font-size: 6.5pt;
      font-weight: bold;
      border: 0.5pt solid #1a1f36;
    }
    thead th.right { text-align: right; }
    tbody tr { page-break-inside: avoid; }
    tbody tr:nth-child(even) { background: #f9f9f9; }
    tbody td {
      padding: 3pt 5pt;
      border: 0.5pt solid #ddd;
      vertical-align: top;
    }
    tbody td.right { text-align: right; }
    .totals-row td {
      font-weight: bold;
      background: #f0f0f0;
      border-top: 1pt solid #999;
      font-size: 8pt;
    }
    .subtotal-bar {
      display: flex;
      justify-content: flex-end;
      gap: 20pt;
      padding: 3pt 5pt;
      border-top: 0.5pt solid #ccc;
      font-size: 8pt;
    }
    .grand-total {
      text-align: right;
      padding: 4pt 5pt;
      font-size: 10pt;
      font-weight: bold;
      border-top: 1.5pt solid #1a1f36;
      margin-top: 3pt;
    }
    .section-sublabel {
      font-size: 7pt;
      font-weight: bold;
      text-transform: uppercase;
      color: #555;
      letter-spacing: 0.05em;
      margin-bottom: 3pt;
    }
    .divider {
      text-align: center;
      font-size: 7pt;
      color: #666;
      padding: 3pt;
      border-top: 0.5pt dashed #ccc;
      border-bottom: 0.5pt dashed #ccc;
      margin: 4pt 0;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .both-notice {
      background: #f0f7ff;
      border: 0.5pt solid #c5d9f7;
      padding: 3pt 7pt;
      font-size: 7pt;
      color: #1557a0;
      margin-bottom: 5pt;
    }
    .note-box {
      border: 0.5pt solid #ccc;
      padding: 5pt 7pt;
      min-height: 28pt;
      font-size: 7.5pt;
      color: #333;
      background: #fafafa;
    }
    .map-container { display: flex; gap: 8pt; padding: 0; align-items: flex-start; }
    .map-svg-wrap {
      flex: 0 0 60%;
      max-width: 60%;
      background: #f9f9f9;
      padding: 6pt;
      border: 0.5pt solid #ddd;
    }
    .map-svg-wrap svg { width: 100%; height: auto; display: block; }
    .map-side { flex: 1; border-left: 1pt solid #ccc; padding-left: 8pt; min-width: 0; }
    .position-table table thead tr { background: #1a1f36; }
    .position-table table thead th { border-color: #1a1f36; }
    .sig-row { display: flex; gap: 14pt; margin-top: 16pt; border-top: 0.5pt solid #ccc; padding-top: 6pt; }
    .sig-block {
      flex: 1;
      border-top: 0.5pt solid #999;
      padding-top: 3pt;
      font-size: 7pt;
      color: #555;
      line-height: 1.8;
    }
    .page-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      border-top: 0.5pt solid #ccc;
      padding: 3pt 0.65in;
      font-size: 6.5pt;
      color: #888;
      display: flex;
      justify-content: space-between;
      background: #ffffff;
    }
    .pill {
      display: inline-block;
      border: 0.5pt solid #999;
      border-radius: 2pt;
      padding: 1pt 5pt;
      font-size: 7pt;
    }
    .payment-stub { border-top: 1pt dashed #999; margin-top: 10pt; padding-top: 6pt; }
    .stub-header {
      font-size: 7pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #555;
      margin-bottom: 4pt;
    }
    .stub-row { display: flex; justify-content: space-between; font-size: 8pt; padding: 2pt 0; border-bottom: 0.5pt solid #eee; flex-wrap: wrap; gap: 4pt; }
    .stub-fill { display: flex; gap: 20pt; font-size: 8pt; margin-top: 4pt; flex-wrap: wrap; }
    .zero-balance { color: #137333; font-weight: bold; }
    .mono { font-family: 'Courier New', Courier, monospace; }
    .pill-pass { background: #e8f5e9; color: #137333; border-color: #7cb342; }
    .pill-fail { background: #ffebee; color: #c62828; border-color: #e57373; }
    .pill-warn { background: #fff8e1; color: #f57f17; border-color: #ffb74d; }
    h1, h2, h3 { page-break-after: avoid; }
    tr { page-break-inside: avoid; }
  `;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return '$' + x.toFixed(2);
  }

  function pick(...xs) {
    for (const x of xs) {
      if (x != null && x !== '') return x;
    }
    return '';
  }

  function getCompanyInfo(data) {
    const d = data && typeof data === 'object' ? data : {};
    const g =
      typeof global.__erpPrintCompanyInfo === 'object' && global.__erpPrintCompanyInfo != null
        ? global.__erpPrintCompanyInfo
        : {};
    const ci = d.companyInfo && typeof d.companyInfo === 'object' ? d.companyInfo : {};
    const name = pick(ci.companyName, ci.legalName, ci.dbaName, g.companyName, d.companyName, 'IH 35 Transportation LLC');
    const addr = pick(ci.address, g.address, d.companyAddress);
    const city = pick(ci.city, g.city);
    const phone = pick(ci.phone, g.phone, d.companyPhone);
    const usdot = pick(ci.usdot, g.usdot, d.usdot);
    const mc = pick(ci.mcNumber, g.mcNumber, d.mcNumber);
    const lines = [];
    if (addr) lines.push(`<div class="co-sub">${esc(addr)}</div>`);
    if (city) lines.push(`<div class="co-sub">${esc(city)}</div>`);
    if (phone) lines.push(`<div class="co-sub">${esc(phone)}</div>`);
    const reg = [];
    if (usdot) reg.push('USDOT ' + esc(usdot));
    if (mc) reg.push('MC ' + esc(mc));
    if (reg.length) lines.push(`<div class="co-sub">${reg.join(' · ')}</div>`);
    return { name, subHtml: lines.join('') };
  }

  function buildLetterhead(companyInfo, docTitle, docSubtitle) {
    const c = getCompanyInfo(companyInfo || {});
    return `<div class="letterhead">
      <div>
        <div class="co-name">${esc(c.name)}</div>
        ${c.subHtml}
      </div>
      <div class="doc-title-box">
        <div class="doc-title">${esc(docTitle)}</div>
        ${docSubtitle ? `<div class="doc-sub">${esc(docSubtitle)}</div>` : ''}
      </div>
    </div>`;
  }

  function buildSection(sectionNumber, sectionTitle, bodyHTML) {
    return `<div class="section"><div class="section-header">${esc(String(sectionNumber))} — ${esc(
      sectionTitle
    )}</div><div class="section-body">${bodyHTML || ''}</div></div>`;
  }

  function buildFieldGrid(fields, columns) {
    const n = columns === 4 || columns === 3 ? columns : 2;
    const cls = n === 4 ? 'grid4' : n === 3 ? 'grid3' : 'grid2';
    const cells = (Array.isArray(fields) ? fields : [])
      .map(f => {
        const v = f && f.value != null ? String(f.value) : '';
        const lg = f && f.large ? ' field-value large' : ' field-value';
        return `<div class="field"><span class="field-label">${esc(f.label || '')}</span><span class="${lg.trim()}">${esc(
          v
        )}</span></div>`;
      })
      .join('');
    return `<div class="${cls}">${cells}</div>`;
  }

  function amtLine(ln) {
    return Number(ln && (ln.amount != null ? ln.amount : ln.amt)) || 0;
  }

  function buildCategoryTable(lines) {
    const rows = (Array.isArray(lines) ? lines : []).filter(ln => amtLine(ln) > 0);
    if (!rows.length) return '';
    const body = rows
      .map((ln, i) => {
        const cat = ln.category || ln.accountLabel || ln.qboAccountId || '';
        const desc = ln.description || ln.serviceType || '';
        const cls = ln.classLabel || ln.class || '';
        return `<tr><td>${i + 1}</td><td>${esc(cat)}</td><td>${esc(desc)}</td><td class="right">${esc(
          money(amtLine(ln))
        )}</td><td>${esc(cls)}</td></tr>`;
      })
      .join('');
    return `<table><thead><tr><th>#</th><th>Category / account</th><th>Description</th><th class="right">Amount</th><th>Class</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function buildItemTable(lines) {
    const rows = (Array.isArray(lines) ? lines : []).filter(ln => amtLine(ln) > 0);
    if (!rows.length) return '';
    const body = rows
      .map((ln, i) => {
        const qty = ln.qty != null ? ln.qty : ln.quantity != null ? ln.quantity : '';
        const rate = ln.rate != null ? ln.rate : ln.unitPrice != null ? ln.unitPrice : '';
        const prod = ln.product || ln.itemLabel || ln.qboItemId || '';
        const sku = ln.sku || '';
        const desc = ln.description || ln.serviceType || '';
        const cls = ln.classLabel || ln.class || '';
        return `<tr><td>${i + 1}</td><td>${esc(prod)}</td><td>${esc(sku)}</td><td>${esc(
          desc
        )}</td><td class="right">${esc(String(qty))}</td><td class="right">${esc(
          Number.isFinite(Number(rate)) ? money(Number(rate)) : String(rate || ''))
        )}</td><td class="right">${esc(money(amtLine(ln)))}</td><td>${esc(cls)}</td></tr>`;
      })
      .join('');
    return `<table><thead><tr><th>#</th><th>Product / service</th><th>SKU</th><th>Description</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th><th>Class</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function buildCostSection(categoryLines, itemLines, invoiceTotal) {
    const cats = (Array.isArray(categoryLines) ? categoryLines : []).filter(ln => amtLine(ln) > 0);
    const items = (Array.isArray(itemLines) ? itemLines : []).filter(ln => amtLine(ln) > 0);
    const catSum = cats.reduce((s, ln) => s + amtLine(ln), 0);
    const itemSum = items.reduce((s, ln) => s + amtLine(ln), 0);
    const inv = Number(invoiceTotal);
    const grand = Number.isFinite(inv) ? inv : Math.round((catSum + itemSum) * 100) / 100;
    let html = '';
    if (cats.length && !items.length) {
      html += `<div class="section-sublabel">Category expense lines</div>${buildCategoryTable(cats)}`;
      html += `<table><tbody><tr class="totals-row"><td colspan="3">Subtotal</td><td class="right">${esc(
        money(catSum)
      )}</td><td></td></tr></tbody></table>`;
    } else if (!cats.length && items.length) {
      html += `<div class="section-sublabel">Product / service lines</div>${buildItemTable(items)}`;
      html += `<table><tbody><tr class="totals-row"><td colspan="6">Subtotal</td><td class="right">${esc(
        money(itemSum)
      )}</td><td></td></tr></tbody></table>`;
    } else if (cats.length && items.length) {
      html += `<div class="both-notice">Both category and item lines present — printing both sections below.</div>`;
      html += `<div class="section-sublabel">Category expense lines</div>${buildCategoryTable(cats)}`;
      html += `<div class="divider">Product / service lines</div>`;
      html += `<div class="section-sublabel">Product / service lines</div>${buildItemTable(items)}`;
      html += `<div class="subtotal-bar"><span>Category subtotal: ${esc(money(catSum))}</span><span>Item subtotal: ${esc(
        money(itemSum)
      )}</span></div>`;
    } else {
      html += `<p class="field-value" style="border:none">No cost lines entered.</p>`;
      if (Number.isFinite(inv)) {
        html += `<p class="field-label" style="margin-top:6pt">Invoice total</p><p class="field-value large">${esc(
          money(inv)
        )}</p>`;
      }
    }
    if (cats.length || items.length || Number.isFinite(inv)) {
      html += `<div class="grand-total">Grand total: ${esc(money(grand))}</div>`;
    }
    return html;
  }

  function normCostFromMixed(lines) {
    const categoryLines = [];
    const itemLines = [];
    (Array.isArray(lines) ? lines : []).forEach(ln => {
      const dm = String(ln.detailMode || '').toLowerCase();
      const o = { ...ln };
      if (dm === 'category') categoryLines.push(o);
      else itemLines.push(o);
    });
    return { categoryLines, itemLines };
  }

  function inferMapType(positions) {
    const ps = (Array.isArray(positions) ? positions : []).map(p => String(p || '').trim().toUpperCase()).filter(Boolean);
    if (!ps.length) return null;
    if (ps.every(p => /^B\d$/i.test(p))) return 'battery';
    if (ps.some(p => /^(L|R)ST$|FD\d|RD\d/i.test(p))) return 'tires';
    if (ps.some(p => /CAB|FA|RA/i.test(p))) return 'airbags';
    return 'full';
  }

  function tireEllipse(cx, cy, label, active) {
    const fill = active ? '#333333' : 'none';
    const stroke = active ? '#333333' : '#999';
    const tc = active ? '#ffffff' : '#666';
    return `<ellipse cx="${cx}" cy="${cy}" rx="18" ry="11" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/><text x="${cx}" y="${
      cy + 3
    }" text-anchor="middle" font-size="5pt" fill="${tc}">${esc(label)}</text>`;
  }

  function buildTireSvg(selected) {
    const set = new Set((selected || []).map(s => String(s || '').trim().toUpperCase()));
    const TIRES = [
      { k: 'LST', x: 60, y: 22 },
      { k: 'RST', x: 140, y: 22 },
      { k: 'LFD1', x: 30, y: 55 },
      { k: 'LFD2', x: 60, y: 55 },
      { k: 'RFD1', x: 120, y: 55 },
      { k: 'RFD2', x: 150, y: 55 },
      { k: 'LRD1', x: 30, y: 92 },
      { k: 'LRD2', x: 60, y: 92 },
      { k: 'RRD1', x: 120, y: 92 },
      { k: 'RRD2', x: 150, y: 92 }
    ];
    let body = '';
    TIRES.forEach(t => {
      body += tireEllipse(t.x, t.y, t.k, set.has(t.k));
    });
    return `<svg viewBox="0 0 190 110" xmlns="http://www.w3.org/2000/svg" aria-label="Tire map">
      <rect x="8" y="8" width="174" height="94" fill="none" stroke="#999" stroke-width="0.5" rx="4"/>
      ${body}
    </svg>`;
  }

  function buildAirbagSvg(selected) {
    const set = new Set((selected || []).map(s => String(s || '').trim().toUpperCase()));
    const boxes = [
      { k: 'CAB-L', x: 20, y: 10 },
      { k: 'CAB-R', x: 100, y: 10 },
      { k: 'FA-L', x: 20, y: 50 },
      { k: 'FA-R', x: 100, y: 50 },
      { k: 'RA-L', x: 20, y: 90 },
      { k: 'RA-R', x: 100, y: 90 }
    ];
    let g = '';
    boxes.forEach(b => {
      const on = set.has(b.k);
      const fill = on ? '#333' : 'none';
      const stroke = on ? '#333' : '#999';
      const tc = on ? '#fff' : '#666';
      g += `<rect x="${b.x}" y="${b.y}" width="72" height="28" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/><text x="${
        b.x + 36
      }" y="${b.y + 18}" text-anchor="middle" font-size="6pt" fill="${tc}">${esc(b.k)}</text>`;
    });
    return `<svg viewBox="0 0 192 128" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
  }

  function buildBatterySvg(selected) {
    const set = new Set((selected || []).map(s => String(s || '').trim().toUpperCase()));
    let g = '';
    const pts = [
      { k: 'B1', x: 10, y: 10 },
      { k: 'B2', x: 70, y: 10 },
      { k: 'B3', x: 130, y: 10 },
      { k: 'B4', x: 10, y: 50 },
      { k: 'B5', x: 70, y: 50 },
      { k: 'B6', x: 130, y: 50 }
    ];
    pts.forEach(b => {
      const on = set.has(b.k);
      const fill = on ? '#333' : 'none';
      const stroke = on ? '#333' : '#999';
      const tc = on ? '#fff' : '#666';
      g += `<rect x="${b.x}" y="${b.y}" width="52" height="32" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/><text x="${
        b.x + 26
      }" y="${b.y + 20}" text-anchor="middle" font-size="7pt" fill="${tc}">${esc(b.k)}</text>`;
    });
    return `<svg viewBox="0 0 192 90" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
  }

  function buildFullMapSvg(selected) {
    const tire = buildTireSvg(selected);
    return `<div style="display:flex;flex-direction:column;gap:6pt">${tire}<div class="section-sublabel" style="margin:0">Air bags / battery (reference)</div>${buildAirbagSvg(
      selected
    )}</div>`;
  }

  function buildPositionMap(selectedPositions, mapType, positionDetails, partsMapSvg) {
    const pos = Array.isArray(selectedPositions) ? selectedPositions.map(p => String(p || '').trim()).filter(Boolean) : [];
    const mt = mapType || inferMapType(pos);
    let svg = '';
    if (partsMapSvg && String(partsMapSvg).indexOf('<svg') !== -1) {
      svg = String(partsMapSvg);
    } else if (mt === 'tires') svg = buildTireSvg(pos);
    else if (mt === 'airbags') svg = buildAirbagSvg(pos);
    else if (mt === 'battery') svg = buildBatterySvg(pos);
    else if (mt === 'full') svg = buildFullMapSvg(pos);
    if (!svg && !pos.length) return '';
    const list = pos.length ? pos.join(', ') : '—';
    const rows = Array.isArray(positionDetails) ? positionDetails : [];
    const detBody = rows.length
      ? rows
          .map(r => {
            return `<tr><td>${esc(r.position || '')}</td><td class="mono">${esc(r.partNumber || '')}</td><td>${esc(
              r.description || ''
            )}</td><td class="right">${esc(String(r.qty != null ? r.qty : ''))}</td><td class="right">${esc(
              r.amount != null ? money(Number(r.amount)) : ''
            )}</td></tr>`;
          })
          .join('')
      : pos.map(p => `<tr><td>${esc(p)}</td><td></td><td></td><td></td><td></td></tr>`).join('');
    return `<div class="map-container">
      <div class="map-svg-wrap">${svg || '<p class="co-sub">No diagram</p>'}<p class="co-sub" style="margin-top:4pt">Positions serviced: ${esc(
        list
      )}</p></div>
      <div class="map-side position-table">
        <div class="section-sublabel">Position detail</div>
        <table><thead><tr><th>Position</th><th>Part #</th><th>Description</th><th class="right">Qty</th><th class="right">Amount</th></tr></thead><tbody>${detBody}</tbody></table>
      </div>
    </div>`;
  }

  function buildSignatureBlocks(blocks) {
    const rows = (Array.isArray(blocks) ? blocks : [])
      .map(
        b => `<div class="sig-block">${(b.lines || [])
          .map(l => `${esc(l)}<br/>`)
          .join('')}</div>`
      )
      .join('');
    return `<div class="sig-row">${rows}</div>`;
  }

  function buildPageFooter(leftText, centerText, rightText) {
    const left = leftText || 'IH 35 Transportation LLC — Confidential';
    const c = centerText || '';
    const r = rightText || 'Page 1';
    return `<div class="page-footer"><span>${esc(left)}</span><span style="text-align:center;flex:1;padding:0 6pt">${esc(
      c
    )}</span><span>${esc(r)}</span></div>`;
  }

  function buildPaymentStub(billNumber, vendor, dueDate, amountDue) {
    return `<div class="payment-stub">
      <div class="stub-header">— Payment stub — Detach and return with payment —</div>
      <div class="stub-row"><span>Bill #: ${esc(billNumber)}</span><span>Vendor: ${esc(vendor)}</span></div>
      <div class="stub-row"><span>Due: ${esc(dueDate)}</span><span>Amount due: ${esc(money(Number(amountDue)))}</span></div>
      <div class="stub-fill"><span>Check #: _________________</span><span>Amount paid: $______________</span><span>Date: _____________________</span></div>
    </div>`;
  }

  function sanitizeFilename(str) {
    if (!str) return '';
    return String(str)
      .replace(/\s+/g, '-')
      .replace(/[/\\:*?"<>|(),']/g, '')
      .replace(/&/g, 'and')
      .replace(/#/g, 'No')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 40);
  }

  function formatDateForFilename(dateStr) {
    const s = String(dateStr || '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = s ? new Date(s) : null;
    if (d && !isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return '';
  }

  const WO_FILE_LABEL = {
    workorder: 'WorkOrder',
    'repair-order': 'RepairOrder',
    'maintenance-order': 'MaintenanceOrder',
    'pm-service': 'PMService',
    'inspection-record': 'InspectionRecord',
    'accident-repair': 'AccidentRepair',
    'tire-service': 'TireService',
    'airbag-service': 'AirBagService',
    'battery-service': 'BatteryService',
    'body-work': 'BodyWork'
  };

  const WO_TITLE = {
    workorder: 'WORK ORDER',
    'repair-order': 'REPAIR ORDER',
    'maintenance-order': 'MAINTENANCE ORDER',
    'pm-service': 'PM SERVICE ORDER',
    'inspection-record': 'INSPECTION RECORD',
    'accident-repair': 'ACCIDENT REPAIR ORDER',
    'tire-service': 'TIRE SERVICE ORDER',
    'airbag-service': 'AIR BAG SERVICE ORDER',
    'battery-service': 'BATTERY SERVICE ORDER',
    'body-work': 'BODY WORK ORDER'
  };

  function generateFilename(documentType, data, extension) {
    const ext = extension || 'pdf';
    const d = data || {};
    let segments = [];
    const dt = String(documentType || '');
    if (WO_TITLE[dt]) {
      segments = [
        sanitizeFilename(d.unit || d.unitNumber),
        WO_FILE_LABEL[dt] || 'WorkOrder',
        sanitizeFilename(d.serviceType),
        sanitizeFilename(d.vendor),
        formatDateForFilename(d.serviceDate)
      ];
    } else if (dt === 'expense' || dt === 'maintenance-expense') {
      segments = [
        sanitizeFilename(d.vendor || d.payee),
        'Expense',
        sanitizeFilename(d.refNumber || d.refNo),
        formatDateForFilename(d.paymentDate)
      ];
    } else if (dt === 'bill' || dt === 'maintenance-bill' || dt === 'vendor-driver-bill') {
      segments = [
        sanitizeFilename(d.vendor || d.payee),
        'Bill',
        sanitizeFilename(d.billNumber || d.vendorInvoice),
        formatDateForFilename(d.billDate || d.paymentDate)
      ];
    } else if (dt === 'fuel-expense') {
      segments = [
        sanitizeFilename(d.vendor || d.payee),
        'Fuel',
        sanitizeFilename(d.unit),
        formatDateForFilename(d.txnDate || d.paymentDate)
      ];
    } else if (dt === 'fuel-bill') {
      segments = [
        sanitizeFilename(d.vendor || d.payee),
        'FuelBill',
        sanitizeFilename(d.billNumber || d.vendorInvoice),
        formatDateForFilename(d.billDate || d.paymentDate)
      ];
    } else if (dt === 'payment-receipt' || dt === 'bill-payment') {
      segments = [
        sanitizeFilename(d.vendor),
        'Payment',
        sanitizeFilename(d.paymentNumber),
        formatDateForFilename(d.paymentDate)
      ];
    } else if (dt === 'multiple-bills') {
      const bills = Array.isArray(d.bills) ? d.bills : [];
      const firstNum = bills[0] && bills[0].billNumber;
      const lastNum = bills.length ? bills[bills.length - 1].billNumber : '';
      segments = [
        sanitizeFilename(d.vendor),
        'Bills',
        sanitizeFilename(firstNum),
        'to',
        sanitizeFilename(lastNum),
        formatDateForFilename(new Date().toISOString())
      ];
    } else {
      segments = [sanitizeFilename(dt), formatDateForFilename(new Date().toISOString())];
    }
    let base = segments.filter(Boolean).join('-');
    if (base.length > 120) base = base.slice(0, 120);
    return base + '.' + ext;
  }

  function wrapHtml(title, inner, footerParts) {
    const f = footerParts || {};
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body><div class="pwrap">${inner}</div>${buildPageFooter(
      f.left,
      f.center,
      f.right
    )}</body></html>`;
  }

  function normalizeWoCost(data) {
    let cat = data.categoryLines;
    let it = data.itemLines;
    if ((!cat || !cat.length) && (!it || !it.length) && Array.isArray(data.costLines)) {
      const n = normCostFromMixed(data.costLines);
      cat = n.categoryLines;
      it = n.itemLines;
    }
    return { categoryLines: cat || [], itemLines: it || [] };
  }

  function extractPositionsFromCost(data) {
    const lines = Array.isArray(data.costLines) ? data.costLines : [];
    const pos = [];
    const details = [];
    lines.forEach(ln => {
      const p = String(ln.partPosition || ln.tirePositionText || '').trim();
      if (p) pos.push(p.split(/[·|]/)[0].trim());
      if (p) {
        details.push({
          position: p,
          partNumber: ln.partNumber || '',
          description: ln.description || ln.serviceType || '',
          qty: ln.quantity,
          amount: ln.amount
        });
      }
    });
    return { positions: [...new Set(pos)], details };
  }

  function buildWorkOrderHtml(documentType, data) {
    const d = data || {};
    const dt = WO_TITLE[documentType] ? documentType : 'workorder';
    const title = WO_TITLE[dt];
    const wo = pick(d.woNumber, d.workOrderNumber, 'DRAFT');
    const sub = `WO#: ${wo} · ${pick(d.serviceDate, '')}`;
    const co = buildLetterhead(d, title, sub);
    const fuelDisp = (() => {
      const f = String(d.fuel || d.fuelLevel || '').trim();
      if (!f) return '';
      return /%$/.test(f) ? f : `${f}%`;
    })();
    const opPill = d.opStatus || d.operationalStatus ? `<span class="pill">${esc(d.opStatus || d.operationalStatus)}</span>` : '—';
    const ymm = d.yearMakeModel || [d.year, d.make, d.model].filter(Boolean).join(' ');
    const leftCol = `<div class="field"><span class="field-label">Unit #</span><span class="field-value large">${esc(
      d.unit || d.unitNumber || ''
    )}</span></div>
      <div class="field"><span class="field-label">Year / make / model</span><span class="field-value">${esc(ymm)}</span></div>
      <div class="field"><span class="field-label">VIN</span><span class="field-value mono">${esc(d.vin || '')}</span></div>
      <div class="field"><span class="field-label">License plate</span><span class="field-value">${esc(d.plate || '')}</span></div>`;
    const rightCol = `<div class="field"><span class="field-label">Odometer at service</span><span class="field-value large">${esc(
      d.odometer || ''
    )}</span></div>
      <div class="field"><span class="field-label">Fuel level</span><span class="field-value">${esc(fuelDisp || '—')}</span></div>
      <div class="field"><span class="field-label">Operational status</span><span class="field-value" style="border:none">${opPill}</span></div>
      <div class="field"><span class="field-label">Repair status</span><span class="field-value">${esc(d.repairStatus || '')}</span></div>`;
    const sec1 = `<div class="grid2"><div>${leftCol}</div><div class="border-left">${rightCol}</div></div>`;
    const row1 = buildFieldGrid(
      [
        { label: 'Record type', value: d.recordTypeLabel || d.recordType || '' },
        { label: 'Service type', value: d.serviceType || '' },
        { label: 'Service date', value: d.serviceDate || '' }
      ],
      3
    );
    const row2 = buildFieldGrid(
      [
        { label: 'Service location', value: d.serviceLocation || '' },
        { label: 'Location detail', value: d.locationDetail || '' },
        { label: 'Vendor', value: d.vendor || '' }
      ],
      3
    );
    const row3 = buildFieldGrid(
      [
        { label: 'Driver', value: d.driver || d.driverName || '' },
        { label: 'Vendor invoice #', value: d.vendorInvoice || '' },
        { label: 'Reference / WO #', value: d.referenceWO || d.vendorReferenceNumber || '' },
        { label: 'Invoice total', value: Number.isFinite(Number(d.invoiceTotal)) ? money(Number(d.invoiceTotal)) : '' }
      ],
      4
    );
    let sec2 = row1 + `<div style="height:5pt"></div>` + row2 + `<div style="height:5pt"></div>` + row3;
    const planned = pick(d.plannedWork, d.plannedService);
    if (planned) {
      sec2 += `<div class="field" style="margin-top:6pt"><span class="field-label">Planned service / repair</span><div class="note-box">${esc(
        planned
      )}</div></div>`;
    }
    const { categoryLines, itemLines } = normalizeWoCost(d);
    const sec3 = buildCostSection(categoryLines, itemLines, d.invoiceTotal);
    const exPos = extractPositionsFromCost(d);
    const positions = (Array.isArray(d.positions) && d.positions.length ? d.positions : exPos.positions).filter(Boolean);
    const mapT = d.positionMap || inferMapType(positions);
    let sec4 = '';
    if (positions.length || mapT || d.partsMapSvg) {
      sec4 = buildPositionMap(positions, mapT, exPos.details, d.partsMapSvg);
    }
    let sec5 = '';
    if (pick(d.notes)) sec5 = `<div class="note-box">${esc(d.notes)}</div>`;
    let sec6 = '';
    const rt = String(d.recordType || '').toLowerCase();
    if (rt === 'accident') {
      const dot = d.accidentDotReportable ? 'YES — DOT REPORTABLE' : 'No';
      const g1 = buildFieldGrid(
        [
          { label: 'Accident date', value: d.accidentDate || '' },
          { label: 'Accident location', value: d.accidentLocation || '' },
          { label: 'Police report #', value: d.accidentReportNumber || '' },
          { label: 'Insurance claim #', value: d.insuranceClaimNumber || '' }
        ],
        4
      );
      const g2 = buildFieldGrid(
        [
          { label: 'Fault', value: d.accidentFault || '' },
          { label: 'DOT reportable', value: dot },
          { label: 'Estimated damage $', value: d.estimatedDamage != null ? money(d.estimatedDamage) : '' },
          { label: 'Actual repair $', value: d.actualRepair != null ? money(d.actualRepair) : '' }
        ],
        4
      );
      const third = d.thirdPartyInfo ? `<div class="field" style="margin-top:6pt"><span class="field-label">Third party information</span><div class="note-box">${esc(
        d.thirdPartyInfo
      )}</div></div>` : '';
      sec6 = g1 + g2 + third;
    } else if (rt === 'inspection' || String(d.serviceType || '').toLowerCase().includes('inspection')) {
      const result = (d.inspectionResult || '').toUpperCase();
      let pillClass = 'pill';
      if (result.includes('PASS')) pillClass += ' pill-pass';
      else if (result.includes('FAIL') || result.includes('OUT')) pillClass += ' pill-fail';
      else if (result) pillClass += ' pill-warn';
      const g = buildFieldGrid(
        [
          { label: 'Inspection type', value: d.inspectionType || d.inspectionScope || '' },
          { label: 'Inspector name', value: d.inspectorName || '' },
          { label: 'Badge #', value: d.inspectorBadge || '' },
          { label: 'Next due date', value: d.inspectionNextDue || '' }
        ],
        4
      );
      const pill = result ? `<p style="margin-top:6pt"><span class="${pillClass}">${esc(result)}</span></p>` : '';
      const oos =
        d.outOfServiceItems && String(d.outOfServiceItems).trim()
          ? `<div class="field" style="margin-top:6pt"><span class="field-label">Out of service items</span><div class="note-box">${esc(
              d.outOfServiceItems
            )}</div></div>`
          : '';
      sec6 = g + pill + oos;
    } else if (rt === 'pm') {
      sec6 = buildFieldGrid(
        [
          { label: 'Last PM date', value: d.lastPmDate || '' },
          { label: 'Last PM mileage', value: d.lastPmMiles != null ? String(d.lastPmMiles) : '' },
          { label: 'Next PM due miles', value: d.nextPmDueMiles != null ? String(d.nextPmDueMiles) : '' },
          { label: 'Interval miles', value: d.pmIntervalMiles != null ? String(d.pmIntervalMiles) : '' }
        ],
        4
      );
    }
    const sig = buildSignatureBlocks([
      {
        lines: [
          'Technician: _______________________',
          'Print name: ________________________',
          'Date: _____________________________'
        ]
      },
      {
        lines: [
          'Supervisor: ________________________',
          'Print name: ________________________',
          'Date: _____________________________'
        ]
      },
      {
        lines: [
          'Approved by: _______________________',
          'Title: _____________________________',
          'Date: _____________________________'
        ]
      }
    ]);
    const parts = [co, buildSection('1', 'Vehicle information', sec1), buildSection('2', 'Service information', sec2), buildSection('3', 'Cost breakdown', sec3)];
    if (sec4) parts.push(buildSection('4', 'Parts / position diagram', sec4));
    if (sec5) parts.push(buildSection('5', 'Notes', sec5));
    if (sec6) {
      const lab =
        rt === 'accident' ? 'Accident information' : rt === 'pm' ? 'PM details' : 'Inspection results';
      parts.push(buildSection('6', lab, sec6));
    }
    parts.push(sig);
    const fn = generateFilename(dt, d, 'pdf').replace(/\.pdf$/i, '');
    const foot = {
      center: [title, pick(d.unit, d.unitNumber, '—'), pick(d.serviceDate, '')].filter(Boolean).join(' · ')
    };
    return wrapHtml(fn, parts.join(''), foot);
  }

  function buildExpenseHtml(data) {
    const d = data || {};
    const ref = pick(d.refNumber, d.refNo, d.vendorInvoice, '—');
    const sub = `Ref #: ${ref} · ${pick(d.paymentDate, '')}`;
    const co = buildLetterhead(d, 'EXPENSE RECORD', sub);
    const pay = buildFieldGrid(
      [
        { label: 'Payee / vendor', value: d.vendor || d.payee || '' },
        { label: 'Payment date', value: d.paymentDate || '' },
        { label: 'Payment method', value: d.paymentMethod || '' },
        { label: 'Payment account', value: d.paymentAccount || '' }
      ],
      4
    );
    const truckRow = buildFieldGrid(
      [
        { label: 'Unit', value: d.unit || '' },
        { label: 'Driver', value: d.driver || '' },
        { label: 'Load #', value: d.loadNumber || d.loadInvoice || '' },
        { label: 'Ref #', value: ref }
      ],
      4
    );
    const hasTruck = !!(d.unit || d.driver || d.loadNumber || d.loadInvoice || d.refNumber || d.refNo);
    let sec2 = '';
    if (d.pickupDate || d.deliveryDate || d.emptyMiles || d.loadedMiles) {
      sec2 = buildFieldGrid(
        [
          { label: 'Pick up date', value: d.pickupDate || '' },
          { label: 'Delivery date', value: d.deliveryDate || '' },
          { label: 'Empty miles', value: d.emptyMiles != null ? String(d.emptyMiles) : '' },
          { label: 'Loaded miles', value: d.loadedMiles != null ? String(d.loadedMiles) : '' }
        ],
        4
      );
    }
    const { categoryLines, itemLines } = normCostFromMixed(d.costLines || []);
    const cost = buildCostSection(categoryLines, itemLines, d.balanceDue != null ? d.balanceDue : d.invoiceTotal);
    const memo = pick(d.memo) ? buildSection('4', 'Memo', `<div class="note-box">${esc(d.memo)}</div>`) : '';
    const sig = buildSignatureBlocks([
      { lines: ['Prepared by: _______________________', 'Date: _____________________________'] },
      { lines: ['Approved by: _______________________', 'Date: _____________________________'] }
    ]);
    const body =
      co +
      buildSection('1', 'Payment information', pay + (hasTruck ? `<div style="height:5pt"></div>` + truckRow : '')) +
      (sec2 ? buildSection('2', 'Trucking details', sec2) : '') +
      buildSection('3', 'Expense lines', cost) +
      memo +
      sig;
    return wrapHtml(generateFilename('expense', d, 'pdf').replace(/\.pdf$/i, ''), body, {
      center: ['EXPENSE RECORD', ref, d.paymentDate || ''].filter(Boolean).join(' · ')
    });
  }

  function buildBillHtml(data) {
    const d = data || {};
    const billNo = pick(d.billNumber, d.vendorInvoice, '—');
    const sub = `Bill #: ${billNo} · Due: ${pick(d.dueDate, '')}`;
    const co = buildLetterhead(d, 'BILL', sub);
    const bal = Number(d.balanceDue);
    const balDisp = Number.isFinite(bal) ? money(bal) : pick(d.amountDisplay, '');
    const s1 = buildFieldGrid(
      [
        { label: 'Vendor', value: d.vendor || d.payee || '' },
        { label: 'Bill date', value: pick(d.billDate, d.paymentDate) },
        { label: 'Due date', value: d.dueDate || '' },
        { label: 'Terms', value: d.terms || '' }
      ],
      4
    );
    const extra = `<div style="margin-top:5pt;text-align:right;font-size:11pt;font-weight:bold">Balance due: ${esc(balDisp)}</div>`;
    const { categoryLines, itemLines } = normCostFromMixed(d.costLines || []);
    const cost = buildCostSection(categoryLines, itemLines, Number.isFinite(bal) ? bal : d.invoiceTotal);
    const memo = pick(d.memo) ? buildSection('3', 'Memo', `<div class="note-box">${esc(d.memo)}</div>`) : '';
    const stub = buildPaymentStub(billNo, d.vendor || d.payee || '', d.dueDate || '', Number.isFinite(bal) ? bal : 0);
    const body = co + buildSection('1', 'Bill information', s1 + extra) + buildSection('2', 'Bill lines', cost) + memo + stub;
    return wrapHtml(generateFilename('bill', d, 'pdf').replace(/\.pdf$/i, ''), body, {
      center: ['BILL', billNo, pick(d.billDate, d.paymentDate, '')].filter(Boolean).join(' · ')
    });
  }

  function buildFuelBillHtml(data) {
    const d = data || {};
    const billNo = pick(d.billNumber, d.vendorInvoice, '—');
    const sub = `Bill #: ${billNo} · Due: ${pick(d.dueDate, '')}`;
    const co = buildLetterhead(d, 'FUEL BILL', sub);
    const bal = Number(d.balanceDue);
    const balDisp = Number.isFinite(bal) ? money(bal) : pick(d.amountDisplay, '');
    const rowA = buildFieldGrid(
      [
        { label: 'Vendor / merchant', value: d.vendor || d.payee || '' },
        { label: 'Transaction date', value: d.txnDate || d.paymentDate || '' },
        { label: 'Unit / truck', value: d.unit || '' },
        { label: 'Driver', value: d.driver || '' }
      ],
      4
    );
    const rowB = buildFieldGrid(
      [
        { label: 'Payment method', value: d.paymentMethod || '' },
        { label: 'Pay from account', value: d.paymentAccount || d.payFromAccount || '' },
        { label: 'Load #', value: d.loadNumber || d.loadInvoice || '' },
        { label: 'Vendor invoice #', value: d.vendorInvoice || '' }
      ],
      4
    );
    const rowC = buildFieldGrid(
      [
        { label: 'Terms', value: d.terms || '' },
        { label: 'Due date', value: d.dueDate || '' },
        { label: 'Bill #', value: billNo },
        { label: 'Statement #', value: d.statementNumber || d.expenseDoc || '' }
      ],
      4
    );
    const balRow = `<div style="margin-top:6pt;text-align:right;font-size:11pt;font-weight:bold">Balance due: ${esc(balDisp)}</div>`;
    const sec1 = rowA + rowB + rowC + balRow;
    const rows = Array.isArray(d.fuelLines) ? d.fuelLines : [];
    let gal = 0;
    let amt = 0;
    const body = rows
      .map((r, i) => {
        const g = Number(r.gallons || r.qtyGal);
        const a = Number(r.amount);
        if (Number.isFinite(g)) gal += g;
        if (Number.isFinite(a)) amt += a;
        const acct = r.mode === 'item' ? r.itemLabel : r.categoryLabel || r.account;
        return `<tr><td>${i + 1}</td><td>${esc(r.description || '')}</td><td>${esc(acct || '')}</td><td class="right">${esc(
          String(r.gallons || r.qtyGal || '')
        )}</td><td class="right">${esc(String(r.pricePerGal || r.ppg || ''))}</td><td class="right">${esc(
          Number.isFinite(a) ? money(a) : String(r.amount || '')
        )}</td></tr>`;
      })
      .join('');
    let sec2Inner =
      rows.length === 0
        ? '<p class="co-sub">No fuel lines.</p>'
        : `<table><thead><tr><th>#</th><th>Description</th><th>Account</th><th class="right">Qty (gal)</th><th class="right">$/gal</th><th class="right">Amount</th></tr></thead><tbody>${body}</tbody><tr class="totals-row"><td colspan="3">Total</td><td class="right">${esc(
            Number.isFinite(gal) ? gal.toFixed(3) : '—'
          )}</td><td>—</td><td class="right">${esc(money(Number.isFinite(amt) ? amt : Number(d.totalAmount) || 0))}</td></tr></table>`;
    if (rows.length === 0) {
      const { categoryLines, itemLines } = normCostFromMixed(d.costLines || []);
      if (categoryLines.length || itemLines.length) {
        sec2Inner = buildCostSection(categoryLines, itemLines, Number.isFinite(bal) ? bal : d.invoiceTotal);
      }
    }
    const memo = pick(d.memo) ? buildSection('3', 'Memo', `<div class="note-box">${esc(d.memo)}</div>`) : '';
    const stub = buildPaymentStub(billNo, d.vendor || d.payee || '', d.dueDate || '', Number.isFinite(bal) ? bal : 0);
    const bodyHtml =
      co +
      buildSection('1', 'Fuel transaction', sec1) +
      buildSection('2', 'Fuel cost lines', sec2Inner) +
      memo +
      stub;
    return wrapHtml(generateFilename('fuel-bill', d, 'pdf').replace(/\.pdf$/i, ''), bodyHtml, {
      center: ['FUEL BILL', billNo, pick(d.billDate, d.paymentDate, '')].filter(Boolean).join(' · ')
    });
  }

  function buildFuelTxnBlock(d, includeExtraRow) {
    const rowA = buildFieldGrid(
      [
        { label: 'Vendor / merchant', value: d.vendor || d.payee || '' },
        { label: 'Transaction date', value: d.txnDate || d.paymentDate || '' },
        { label: 'Unit / truck', value: d.unit || '' },
        { label: 'Driver', value: d.driver || '' }
      ],
      4
    );
    const rowB = buildFieldGrid(
      [
        { label: 'Payment method', value: d.paymentMethod || '' },
        { label: 'Pay from account', value: d.paymentAccount || d.payFromAccount || '' },
        { label: 'Load #', value: d.loadNumber || d.loadInvoice || '' },
        { label: 'Vendor invoice #', value: d.vendorInvoice || '' }
      ],
      4
    );
    let x = rowA + rowB;
    if (includeExtraRow) {
      x += buildFieldGrid(
        [
          { label: 'Terms', value: d.terms || '' },
          { label: 'Due date', value: d.dueDate || '' },
          { label: 'Bill #', value: d.billNumber || '' },
          { label: 'Statement #', value: d.statementNumber || d.expenseDoc || '' }
        ],
        4
      );
    }
    return buildSection('1', 'Fuel transaction', x);
  }

  function buildFuelExpenseHtml(data) {
    const d = data || {};
    const ref = pick(d.expenseNumber, d.expenseDoc, d.vendorInvoice, '—');
    const sub = `Ref #: ${ref} · ${pick(d.txnDate, d.paymentDate, '')}`;
    const co = buildLetterhead(d, 'FUEL EXPENSE', sub);
    const sec1 = buildFuelTxnBlock(d, false);
    const rows = Array.isArray(d.fuelLines) ? d.fuelLines : [];
    let gal = 0;
    let amt = 0;
    const body = rows
      .map((r, i) => {
        const g = Number(r.gallons || r.qtyGal);
        const a = Number(r.amount);
        if (Number.isFinite(g)) gal += g;
        if (Number.isFinite(a)) amt += a;
        const acct = r.mode === 'item' ? r.itemLabel : r.categoryLabel || r.account;
        return `<tr><td>${i + 1}</td><td>${esc(r.description || '')}</td><td>${esc(acct || '')}</td><td class="right">${esc(
          String(r.gallons || r.qtyGal || '')
        )}</td><td class="right">${esc(String(r.pricePerGal || r.ppg || ''))}</td><td class="right">${esc(
          Number.isFinite(a) ? money(a) : String(r.amount || '')
        )}</td></tr>`;
      })
      .join('');
    const tbl =
      rows.length === 0
        ? '<p class="co-sub">No fuel lines.</p>'
        : `<table><thead><tr><th>#</th><th>Description</th><th>Account</th><th class="right">Qty (gal)</th><th class="right">$/gal</th><th class="right">Amount</th></tr></thead><tbody>${body}</tbody><tr class="totals-row"><td colspan="3">Total</td><td class="right">${esc(
            Number.isFinite(gal) ? gal.toFixed(3) : '—'
          )}</td><td>—</td><td class="right">${esc(money(Number.isFinite(amt) ? amt : Number(d.totalAmount) || 0))}</td></tr></table>`;
    const memo = pick(d.memo) ? buildSection('3', 'Memo', `<div class="note-box">${esc(d.memo)}</div>`) : '';
    const sig = buildSignatureBlocks([
      { lines: ['Prepared by: _______________________', 'Date: _____________________________'] },
      { lines: ['Approved by: _______________________', 'Date: _____________________________'] }
    ]);
    const bodyHtml = co + sec1 + buildSection('2', 'Fuel cost lines', tbl) + memo + sig;
    return wrapHtml(generateFilename('fuel-expense', d, 'pdf').replace(/\.pdf$/i, ''), bodyHtml, {
      center: ['FUEL EXPENSE', d.unit || '', d.txnDate || d.paymentDate || ''].filter(Boolean).join(' · ')
    });
  }

  function parseMoneyCell(s) {
    const n = Number(String(s || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function buildPaymentReceiptHtml(data) {
    const d = data || {};
    const sub = `Payment #: ${pick(d.paymentNumber, d.checkNum, '—')} · ${pick(d.paymentDate, '')}`;
    const co = buildLetterhead(d, 'PAYMENT RECEIPT', sub);
    const paidDisp = Number.isFinite(Number(d.totalPaid)) ? money(Number(d.totalPaid)) : pick(d.amountDisplay, '');
    const g1 = buildFieldGrid(
      [
        { label: 'Payment #', value: pick(d.paymentNumber, d.checkNum, ''), large: false },
        { label: 'Payment date', value: d.paymentDate || '' },
        { label: 'Vendor', value: d.vendor || '' },
        { label: 'Total paid', value: paidDisp, large: true }
      ],
      4
    );
    const qboPill = d.qboStatus ? `<div style="margin-top:6pt"><span class="pill">${esc(d.qboStatus)}</span></div>` : '';
    const g2 =
      buildFieldGrid(
        [
          { label: 'Payment method', value: d.paymentMethod || '' },
          { label: 'Account', value: d.account || d.payFromAccount || '' },
          { label: 'Check #', value: d.checkNumber || d.checkNum || '' },
          { label: 'QBO status', value: d.qboStatus ? String(d.qboStatus) : '' }
        ],
        4
      ) + qboPill;
    const rows = Array.isArray(d.billsPaid) ? d.billsPaid : [];
    let sumBill = 0;
    let sumPay = 0;
    let sumRem = 0;
    const tb = rows.length
      ? rows
          .map(r => {
            const ba = parseMoneyCell(r.billAmount);
            const pa = parseMoneyCell(r.amountPaid);
            const rm = parseMoneyCell(r.remaining);
            if (Number.isFinite(ba)) sumBill += ba;
            if (Number.isFinite(pa)) sumPay += pa;
            if (Number.isFinite(rm)) sumRem += rm;
            const remCell =
              Number.isFinite(rm) && Math.abs(rm) < 0.005
                ? `<td class="right zero-balance">${esc(money(0))}</td>`
                : `<td class="right">${esc(r.remaining || '')}</td>`;
            return `<tr><td class="mono">${esc(r.billNumber || r.docNumber || '')}</td><td>${esc(
              r.billDate || ''
            )}</td><td>${esc(r.description || '')}</td><td class="right">${esc(r.billAmount || '')}</td><td class="right">${esc(
              r.amountPaid || ''
            )}</td>${remCell}</tr>`;
          })
          .join('')
      : '<tr><td colspan="6" class="co-sub">No bills selected.</td></tr>';
    const tbl = `<table><thead><tr><th>Bill #</th><th>Bill date</th><th>Description</th><th class="right">Bill amount</th><th class="right">Payment applied</th><th class="right">Remaining</th></tr></thead><tbody>${tb}</tbody><tr class="totals-row"><td colspan="3">Total payment applied</td><td class="right">${esc(
      money(sumBill)
    )}</td><td class="right">${esc(money(sumPay))}</td><td class="right">${esc(money(sumRem))}</td></tr></table>`;
    const memo = pick(d.memo) ? buildSection('3', 'Memo', `<div class="note-box">${esc(d.memo)}</div>`) : '';
    const sig = buildSignatureBlocks([
      { lines: ['Authorized by: _____________________', 'Date: ___________________________'] },
      { lines: ['QBO reference: __________________', 'Memo: ___________________________'] }
    ]);
    const body =
      co +
      buildSection('1', 'Payment details', g1 + `<div style="height:5pt"></div>` + g2) +
      buildSection('2', 'Bills paid', tbl) +
      memo +
      sig;
    return wrapHtml(generateFilename('payment-receipt', d, 'pdf').replace(/\.pdf$/i, ''), body, {
      center: ['PAYMENT RECEIPT', d.vendor || '', d.paymentDate || ''].filter(Boolean).join(' · ')
    });
  }

  function buildMultipleBillsHtml(data) {
    const d = data || {};
    const bills = Array.isArray(d.bills) ? d.bills : [];
    const first = bills[0] && bills[0].billNumber;
    const last = bills.length && bills[bills.length - 1].billNumber;
    const sub = `${pick(d.vendor, '—')} · ${pick(first, '')} to ${pick(last, '')}`;
    const co = buildLetterhead(d, 'BILL SERIES SUMMARY', sub);
    const tot = Number(d.totalAmount);
    const s1 =
      buildFieldGrid(
        [
          { label: 'Vendor', value: d.vendor || '' },
          { label: 'Frequency', value: d.frequency || '' },
          { label: 'Total bills', value: String(bills.length) },
          { label: 'Total amount', value: Number.isFinite(tot) ? money(tot) : '', large: true }
        ],
        4
      ) +
      (d.description ? `<div class="field" style="margin-top:6pt"><span class="field-label">Description</span><div class="note-box">${esc(
        d.description
      )}</div></div>` : '');
    const bodyRows = bills
      .map(b => {
        const st = b.status || (b.past ? 'Past' : 'Scheduled');
        return `<tr><td class="mono">${esc(b.billNumber || '')}</td><td>${esc(b.billDate || '')}</td><td>${esc(
          b.dueDate || ''
        )}</td><td class="right">${esc(money(Number(b.amount) || 0))}</td><td>${esc(st)}</td></tr>`;
      })
      .join('');
    const sum = bills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const tbl = `<table><thead><tr><th>Bill #</th><th>Bill date</th><th>Due date</th><th class="right">Amount</th><th>Status</th></tr></thead><tbody>${bodyRows}<tr class="totals-row"><td>Total</td><td>—</td><td>—</td><td class="right">${esc(
      money(sum)
    )}</td><td>—</td></tr></tbody></table>`;
    const body = co + buildSection('1', 'Series information', s1) + buildSection('2', 'Bill schedule', tbl);
    return wrapHtml(generateFilename('multiple-bills', d, 'pdf').replace(/\.pdf$/i, ''), body, {
      center: ['BILL SERIES SUMMARY', d.vendor || ''].filter(Boolean).join(' · ')
    });
  }

  function generatePrintDoc(documentType, data) {
    const t = String(documentType || '');
    if (WO_TITLE[t]) return buildWorkOrderHtml(t, data);
    if (t === 'expense' || t === 'maintenance-expense') return buildExpenseHtml(data);
    if (t === 'bill' || t === 'maintenance-bill' || t === 'vendor-driver-bill') return buildBillHtml(data);
    if (t === 'fuel-bill') return buildFuelBillHtml(data);
    if (t === 'fuel-expense') return buildFuelExpenseHtml(data);
    if (t === 'payment-receipt' || t === 'bill-payment') return buildPaymentReceiptHtml(data);
    if (t === 'multiple-bills') return buildMultipleBillsHtml(data);
    return wrapHtml(
      t || 'document',
      buildLetterhead(data, String(t || 'DOCUMENT').toUpperCase(), '') +
        `<div class="note-box"><pre style="white-space:pre-wrap;font:inherit">${esc(JSON.stringify(data, null, 2).slice(0, 4000))}</pre></div>`,
      { center: String(t || 'DOCUMENT').toUpperCase() }
    );
  }

  function toast(msg) {
    try {
      if (typeof global.showErpToast === 'function') global.showErpToast(msg, 'warning');
      else if (typeof global.erpNotify === 'function') global.erpNotify(msg, 'warning');
      else alert(msg);
    } catch (_) {
      alert(msg);
    }
  }

  function generatePrintWindow(documentType, data, extension) {
    const ext = extension || 'pdf';
    const html = generatePrintDoc(documentType, data);
    const filename = generateFilename(documentType, data, ext);
    const w = global.open('', '_blank', 'width=900,height=750,scrollbars=yes,resizable=yes');
    if (!w || w.closed) {
      toast('Popup blocked. Allow popups for this site to print documents.');
      return;
    }
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
      const base = filename.replace(new RegExp('\\.' + ext + '$', 'i'), '');
      w.document.title = base;
    } catch (e) {
      toast(String(e.message || e));
      try {
        w.close();
      } catch (_) {}
      return;
    }
    w.onload = function () {
      setTimeout(function () {
        try {
          w.focus();
          w.print();
        } catch (_) {}
      }, 400);
    };
  }

  global.PRINT_CSS = PRINT_CSS;
  global.sanitizeFilename = sanitizeFilename;
  global.formatDateForFilename = formatDateForFilename;
  global.generateFilename = function (documentType, data, extension) {
    return generateFilename(documentType, data, extension);
  };
  global.buildLetterhead = buildLetterhead;
  global.buildSection = buildSection;
  global.buildFieldGrid = buildFieldGrid;
  global.buildCategoryTable = buildCategoryTable;
  global.buildItemTable = buildItemTable;
  global.buildCostSection = buildCostSection;
  global.buildPositionMap = buildPositionMap;
  global.buildSignatureBlocks = buildSignatureBlocks;
  global.buildPageFooter = buildPageFooter;
  global.buildPaymentStub = buildPaymentStub;
  global.generatePrintDoc = generatePrintDoc;
  global.generatePrintWindow = generatePrintWindow;
  global.erpPrintOpenAndPrint = function (html, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const suggested = String(opts.suggestedFilename || opts.filename || '').trim();
    const w = global.open('', '_blank', 'width=900,height=750,scrollbars=yes,resizable=yes');
    if (!w || w.closed) {
      toast('Popup blocked. Allow popups for this site to print documents.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    if (suggested) {
      try {
        w.document.title = suggested.replace(/\.[a-z0-9]+$/i, '');
      } catch (_) {}
    }
    w.onload = function () {
      setTimeout(function () {
        try {
          w.focus();
          w.print();
        } catch (_) {}
      }, 400);
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
