/**
 * IH35 ERP — standalone print documents (inline HTML + CSS, no external assets).
 * Used by maintenance work orders and extended for AP / fuel forms.
 */
(function () {
  'use strict';

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

  function workorderBadgeTitle(rt, label) {
    const lab = String(label || '').trim();
    const low = lab.toLowerCase();
    if (low.includes('repair')) return 'REPAIR ORDER';
    if (low.includes('maintenance')) return 'MAINTENANCE ORDER';
    if (low.includes('pm')) return 'PM SERVICE ORDER';
    if (low.includes('inspection')) return 'INSPECTION RECORD';
    if (low.includes('accident')) return 'ACCIDENT REPAIR ORDER';
    if (low.includes('tire')) return 'TIRE SERVICE ORDER';
    if (low.includes('air bag')) return 'AIR BAG SERVICE';
    if (low.includes('battery')) return 'BATTERY SERVICE ORDER';
    if (low.includes('body')) return 'BODY WORK ORDER';
    const r = String(rt || '').toLowerCase().replace(/-/g, '_');
    const map = {
      repair: 'REPAIR ORDER',
      maintenance_order: 'MAINTENANCE ORDER',
      maintenance: 'MAINTENANCE ORDER',
      pm: 'PM SERVICE ORDER',
      inspection: 'INSPECTION RECORD',
      accident: 'ACCIDENT REPAIR ORDER',
      tire: 'TIRE SERVICE ORDER',
      air_bag: 'AIR BAG SERVICE',
      battery: 'BATTERY SERVICE ORDER',
      custom: 'WORK ORDER'
    };
    return map[r] || 'WORK ORDER';
  }

  function baseStyles() {
    return `
@page { size: letter portrait; margin: 0.65in 0.65in 0.85in 0.65in; }
@page :first { margin-top: 0.55in; }
html, body { margin:0; padding:0; color:#000; background:#fff; font-family: Arial, Helvetica, sans-serif; font-size:10pt; line-height:1.35; }
body { counter-reset: page; }
.pwrap { max-width: 7in; margin: 0 auto; padding-bottom: 0.35in; }
.hdr { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; border-bottom:2px solid #000; padding-bottom:8px; margin-bottom:10px; }
.co-l .co-name { font-size:14pt; font-weight:700; }
.co-l .co-addr { font-size:9pt; color:#444; margin-top:2px; }
.co-r { text-align:right; }
.doc-badge { display:inline-block; border:2px solid #000; padding:6px 14px; font-size:18pt; font-weight:700; }
.wo-meta { margin-top:6px; font-size:10pt; }
.wo-meta .muted { font-size:9pt; color:#555; }
.grid2 { display:flex; gap:0; border:1px solid #000; margin-bottom:8px; }
.grid2-l { flex:1.5; padding:6pt; border-right:1px solid #000; }
.grid2-r { flex:1; padding:6pt; }
.kv { margin:0 0 4px; font-size:9.5pt; }
.kv b { font-weight:700; }
.row4 { display:flex; border:1px solid #000; margin-bottom:8px; font-size:9pt; }
.row4 > div { flex:1; padding:6pt; border-right:1px solid #000; }
.row4 > div:last-child { border-right:none; }
.row5 { display:flex; border:1px solid #000; margin-bottom:8px; font-size:9pt; }
.row5 > div { flex:1; padding:6pt; border-right:1px solid #000; }
.row5 > div:last-child { border-right:none; }
.sec-title { font-weight:700; font-size:10pt; margin:10px 0 4px; }
.box { border:1px solid #000; padding:6pt; margin-bottom:8px; font-size:9.5pt; white-space:pre-wrap; }
table.cost { width:100%; border-collapse:collapse; font-size:8.5pt; margin-bottom:8px; }
table.cost th, table.cost td { border:1px solid #ccc; padding:3px 4px; vertical-align:top; }
table.cost th { background:#f0f0f0; font-weight:700; }
table.cost tr:nth-child(even) td { background:#f9f9f9; }
.tot { text-align:right; font-weight:700; margin-top:4px; }
.sig-row { display:flex; gap:8px; margin-top:18px; page-break-inside:avoid; }
.sig { flex:1; font-size:8pt; border-top:1px solid #000; padding-top:4px; margin-top:28px; }
.parts-map { max-width:3in; margin:8px auto 0; text-align:center; }
.parts-map svg { max-width:3in; height:auto; }
.parts-map svg rect, .parts-map svg circle { fill:#fff !important; stroke:#000 !important; }
.parts-map svg text { fill:#000 !important; }
.parts-map svg circle.active { fill:#ccc !important; }
.footer { position:fixed; bottom:0.35in; left:0.65in; right:0.65in; font-size:8pt; border-top:1px solid #999; padding-top:4px; display:flex; justify-content:space-between; gap:8px; }
.footer .c { flex:1; text-align:center; }
.pnum:after { content: counter(page); }
`;
  }

  function workorderDoc(d) {
    const data = d || {};
    const lines = Array.isArray(data.costLines) ? data.costLines : [];
    const rt = String(data.recordType || '').toLowerCase();
    const showMaintCols = rt === 'maintenance' || rt === 'repair' || rt === 'tire' || rt === 'custom';
    let catSum = 0;
    let itemSum = 0;
    lines.forEach(ln => {
      const amt = Number(ln.amount) || 0;
      if (ln.detailMode === 'category') catSum += amt;
      else itemSum += amt;
    });

    const headCat = showMaintCols
      ? '<tr><th>#</th><th>Category / Account</th><th>Description</th><th>Amount</th><th>Billable</th><th>Customer</th><th>Class</th><th>Position</th><th>Part #</th></tr>'
      : '<tr><th>#</th><th>Category / Account</th><th>Description</th><th>Amount</th><th>Billable</th><th>Customer</th><th>Class</th><th></th><th></th></tr>';

    const headItem = showMaintCols
      ? '<tr><th>#</th><th>Product / Service</th><th>SKU</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Billable</th><th>Customer</th><th>Class</th><th>Position</th><th>Part #</th></tr>'
      : '<tr><th>#</th><th>Product / Service</th><th>SKU</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Billable</th><th>Customer</th><th>Class</th><th></th><th></th></tr>';

    let tableHtml = '';
    const catLines = lines.filter(l => l.detailMode === 'category');
    const itemLines = lines.filter(l => l.detailMode === 'item');
    const theadCat = `<thead>${headCat.replace('<tr>', '<tr>').replace('</tr>', '</tr>')}</thead>`.replace(
      '<thead><tr>',
      '<thead><tr>'
    );
    const theadCatReal = `<thead><tr>${headCat
      .replace(/^<tr>/, '')
      .replace(/<\/tr>$/, '')}</tr></thead>`;
    const theadItemReal = `<thead><tr>${headItem
      .replace(/^<tr>/, '')
      .replace(/<\/tr>$/, '')}</tr></thead>`;

    if (catLines.length) {
      const body = catLines
        .map((ln, i) => {
          const idx = lines.indexOf(ln) + 1;
          const bill = ln.billable ? 'Yes' : 'No';
          const amt = Number(ln.amount) || 0;
          return `<tr><td>${idx}</td><td>${esc(ln.accountLabel || ln.qboAccountId || '')}</td><td>${esc(
            ln.description || ''
          )}</td><td>${esc(money(amt))}</td><td>${esc(bill)}</td><td>${esc(ln.customerLabel || '')}</td><td>${esc(
            ln.classLabel || ''
          )}</td>${
            showMaintCols
              ? `<td>${esc(ln.partPosition || '')}</td><td>${esc(ln.partNumber || '')}</td>`
              : '<td></td><td></td>'
          }</tr>`;
        })
        .join('');
      tableHtml += `<div class="sec-title">Category lines</div><table class="cost">${theadCatReal}<tbody>${body}</tbody></table>
        <div class="tot" style="font-size:9pt;margin:2px 0 6px">Category subtotal: ${esc(money(catSum))}</div>`;
    }
    if (itemLines.length) {
      const body = itemLines
        .map(ln => {
          const idx = lines.indexOf(ln) + 1;
          const bill = ln.billable ? 'Yes' : 'No';
          const qty = ln.quantity != null ? String(ln.quantity) : '';
          const rate = ln.unitPrice != null ? money(ln.unitPrice) : '';
          const amt = Number(ln.amount) || 0;
          return `<tr><td>${idx}</td><td>${esc(ln.itemLabel || ln.qboItemId || '')}</td><td>${esc(
            ln.sku || ''
          )}</td><td>${esc(ln.description || '')}</td><td>${esc(qty)}</td><td>${esc(rate)}</td><td>${esc(
            money(amt)
          )}</td><td>${esc(bill)}</td><td>${esc(ln.customerLabel || '')}</td><td>${esc(ln.classLabel || '')}</td>${
            showMaintCols
              ? `<td>${esc(ln.partPosition || '')}</td><td>${esc(ln.partNumber || '')}</td>`
              : '<td></td><td></td>'
          }</tr>`;
        })
        .join('');
      tableHtml += `<div class="sec-title">Item lines</div><table class="cost">${theadItemReal}<tbody>${body}</tbody></table>
        <div class="tot" style="font-size:9pt;margin:2px 0 6px">Item subtotal: ${esc(money(itemSum))}</div>`;
    }
    void theadCat;
    if (!tableHtml) {
      tableHtml = '<p class="kv"><b>Cost lines:</b> —</p>';
    }

    const total = Number(data.invoiceTotal);
    const totalDisp = Number.isFinite(total) ? money(total) : money(catSum + itemSum);

    const planned = String(data.plannedService || '').trim();
    const notes = String(data.notes || '').trim();

    let accidentBlock = '';
    if (rt === 'accident') {
      accidentBlock = `
        <div class="sec-title">ACCIDENT INFORMATION</div>
        <div class="grid2"><div class="grid2-l" style="flex:1;border:none">
          <p class="kv"><b>Accident location:</b> ${esc(data.accidentLocation || '')}</p>
          <p class="kv"><b>Police / report #:</b> ${esc(data.accidentReportNumber || '')}</p>
          <p class="kv"><b>Fault:</b> ${esc(data.accidentFault || '')}</p>
        </div></div>`;
    }

    const svcLower = String(data.serviceType || '').toLowerCase();
    let inspectionBlock = '';
    if (data.inspectionLayout) {
      inspectionBlock = `
        <div class="sec-title">INSPECTION RESULTS</div>
        <div class="box">${esc(data.inspectionSummary || '')}</div>`;
    } else if (svcLower.includes('inspection') || svcLower.includes('dot annual')) {
      inspectionBlock = `
        <div class="sec-title">INSPECTION RESULTS</div>
        <div class="box">${esc(
          `Type: ${data.serviceType || '—'}\nInspector / result: see service notes and cost lines.\nNotes:\n${notes || '—'}`
        )}</div>`;
    }

    const partsHtml = data.partsMapSvg
      ? `<div class="sec-title">Parts / positions</div><div class="parts-map">${data.partsMapSvg}</div>`
      : '';

    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${esc(
      'WO ' + (data.workOrderNumber || '')
    )}</title><style>${baseStyles()}</style></head><body>
<div class="pwrap">
  <div class="hdr">
    <div class="co-l">
      <div class="co-name">${esc(data.companyName || 'IH 35 Transportation LLC')}</div>
      <div class="co-addr">${esc(data.companyAddress || 'Laredo, TX')}</div>
    </div>
    <div class="co-r">
      <div class="doc-badge">WORK ORDER</div>
      <div class="wo-meta"><div><b>WO #</b> ${esc(data.workOrderNumber || '—')}</div>
      <div class="muted">Printed ${esc(data.printedAt || '')}</div></div>
    </div>
  </div>

  <div class="grid2">
    <div class="grid2-l">
      <p class="kv"><b>Unit #:</b> ${esc(data.unitNumber || '')}</p>
      <p class="kv"><b>Year / Make / Model:</b> ${esc(data.yearMakeModel || '')}</p>
      <p class="kv"><b>VIN:</b> ${esc(data.vin || '')}</p>
      <p class="kv"><b>Plate:</b> ${esc(data.plate || '')}</p>
      <p class="kv"><b>Odometer:</b> ${esc(data.odometer || '')}</p>
      <p class="kv"><b>Fuel level:</b> ${esc(data.fuelLevel || '')}</p>
    </div>
    <div class="grid2-r">
      <p class="kv"><b>Record type:</b> ${esc(data.recordTypeLabel || data.recordType || '')}</p>
      <p class="kv"><b>Service type:</b> ${esc(data.serviceType || '')}</p>
      <p class="kv"><b>Service date:</b> ${esc(data.serviceDate || '')}</p>
      <p class="kv"><b>Service location:</b> ${esc(data.serviceLocation || '')}</p>
      <p class="kv"><b>Location detail:</b> ${esc(data.locationDetail || '')}</p>
      <p class="kv"><b>Repair status:</b> ${esc(data.repairStatus || '')}</p>
    </div>
  </div>

  <div class="row4">
    <div><p class="kv"><b>Vendor</b><br>${esc(data.vendor || '')}</p></div>
    <div><p class="kv"><b>Load #</b><br>${esc(data.loadNumber || '')}</p></div>
    <div><p class="kv"><b>Vendor invoice #</b><br>${esc(data.vendorInvoice || '')}</p></div>
    <div><p class="kv"><b>Invoice total</b><br>${esc(totalDisp)}</p></div>
  </div>

  ${accidentBlock}
  ${inspectionBlock}

  ${
    planned
      ? `<div class="sec-title">PLANNED SERVICE / REPAIR</div><div class="box">${esc(planned)}</div>`
      : ''
  }

  <div class="sec-title">COST BREAKDOWN</div>
  ${tableHtml}
  <div class="tot">
    Category lines: ${esc(money(catSum))}<br/>
    Item lines: ${esc(money(itemSum))}<br/>
    <span style="font-size:11pt">TOTAL: ${esc(totalDisp)}</span>
  </div>

  ${partsHtml}

  ${notes ? `<div class="sec-title">NOTES</div><div class="box">${esc(notes)}</div>` : ''}

  <div class="sig-row">
    <div class="sig">Technician: __________________________ &nbsp; Date: __________</div>
    <div class="sig">Supervisor: __________________________ &nbsp; Date: __________</div>
    <div class="sig">Approved by: __________________________ &nbsp; Date: __________</div>
  </div>
</div>
<div class="footer">
  <span>${esc(data.companyName || 'IH 35 Transportation LLC')} — Confidential</span>
  <span class="c">WO ${esc(data.workOrderNumber || '—')}</span>
  <span>Page <span class="pnum"></span></span>
</div>
</body></html>`;
  }

  function docBadgeForApType(type, data) {
    const t = String(type || '').toLowerCase();
    const map = {
      expense: 'EXPENSE',
      bill: 'BILL',
      'maintenance-expense': 'MAINTENANCE EXPENSE',
      'maintenance-bill': 'MAINTENANCE BILL',
      'fuel-bill': 'FUEL BILL',
      'vendor-driver-bill': 'VENDOR / DRIVER BILL'
    };
    if (map[t]) return map[t];
    const dt = String((data && data.docTitle) || '').trim();
    return dt ? dt.toUpperCase() : 'DOCUMENT';
  }

  function apCostSectionHtml(lines, headerAmountDisplay) {
    const arr = Array.isArray(lines) ? lines : [];
    const cats = arr.filter(l => l.detailMode === 'category');
    const items = arr.filter(l => l.detailMode === 'item');
    let catSum = 0;
    let itemSum = 0;
    cats.forEach(l => {
      catSum += Number(l.amount) || 0;
    });
    items.forEach(l => {
      itemSum += Number(l.amount) || 0;
    });
    let html = '';
    if (cats.length) {
      html += `<div class="sec-title">Category lines</div><table class="cost"><thead><tr><th>#</th><th>Category</th><th>Description</th><th>Amount</th><th>Billable</th><th>Customer</th><th>Class</th><th>Position</th><th>Part #</th><th>Line memo</th></tr></thead><tbody>`;
      cats.forEach((ln, i) => {
        const bill = ln.billable ? 'Yes' : 'No';
        html += `<tr><td>${i + 1}</td><td>${esc(ln.accountLabel || '')}</td><td>${esc(ln.description || ln.serviceType || '')}</td><td>${esc(
          money(Number(ln.amount) || 0)
        )}</td><td>${esc(bill)}</td><td>${esc(ln.customerLabel || '')}</td><td>${esc(ln.classLabel || '')}</td><td>${esc(
          ln.partPosition || ''
        )}</td><td>${esc(ln.partNumber || '')}</td><td>${esc(ln.lineMemo || '')}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
    if (items.length) {
      html += `<div class="sec-title">Item lines</div><table class="cost"><thead><tr><th>#</th><th>Product / service</th><th>SKU</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Billable</th><th>Customer</th><th>Class</th><th>Position</th><th>Part #</th><th>Line memo</th></tr></thead><tbody>`;
      items.forEach((ln, i) => {
        const bill = ln.billable ? 'Yes' : 'No';
        const qty = ln.quantity != null ? String(ln.quantity) : String(ln.qty != null ? ln.qty : '');
        const rate = ln.unitPrice != null && Number.isFinite(Number(ln.unitPrice)) ? money(Number(ln.unitPrice)) : '';
        html += `<tr><td>${i + 1}</td><td>${esc(ln.itemLabel || '')}</td><td>${esc(ln.sku || '')}</td><td>${esc(
          ln.description || ln.serviceType || ''
        )}</td><td>${esc(qty)}</td><td>${esc(rate)}</td><td>${esc(money(Number(ln.amount) || 0))}</td><td>${esc(
          bill
        )}</td><td>${esc(ln.customerLabel || '')}</td><td>${esc(ln.classLabel || '')}</td><td>${esc(
          ln.partPosition || ''
        )}</td><td>${esc(ln.partNumber || '')}</td><td>${esc(ln.lineMemo || '')}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
    if (!html) html = '<p class="kv"><b>Cost lines:</b> —</p>';
    const hdr = String(headerAmountDisplay || '').trim();
    html += `<div class="tot">Category lines: ${esc(money(catSum))}<br/>Item lines: ${esc(money(itemSum))}<br/><span style="font-size:11pt">TOTAL: ${esc(
      money(catSum + itemSum)
    )}</span>${hdr ? ` &nbsp; <span class="muted">(Header total: ${esc(hdr)})</span>` : ''}</div>`;
    return html;
  }

  function apExpenseBillDoc(data, type) {
    const d = data || {};
    const badge = docBadgeForApType(type, d);
    const lines = Array.isArray(d.costLines) ? d.costLines : [];
    const memo = String(d.memo || '').trim();
    const attN = Number(d.attachmentCount) || 0;
    const billExtras = d.isBill
      ? `<div class="row4" style="margin-top:6px;font-size:9pt">
        <div><p class="kv"><b>Terms</b><br>${esc(d.terms || '')}</p></div>
        <div><p class="kv"><b>Bill date</b><br>${esc(d.paymentDate || '')}</p></div>
        <div><p class="kv"><b>Due date</b><br>${esc(d.dueDate || '')}</p></div>
        <div><p class="kv"><b>Unit</b><br>${esc(d.unit || '')}</p></div>
      </div>`
      : '';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${esc(d.docTitle || badge)}</title><style>${baseStyles()}
.muted { color:#555;font-size:9pt; }
</style></head><body>
<div class="pwrap">
  <div class="hdr">
    <div class="co-l">
      <div class="co-name">${esc(d.companyName || 'IH 35 Transportation LLC')}</div>
      <div class="co-addr">${esc(d.companyAddress || 'Laredo, TX')}</div>
    </div>
    <div class="co-r">
      <div class="doc-badge">${esc(badge)}</div>
      <div class="wo-meta"><div class="muted">Printed ${esc(d.printedAt || '')}</div></div>
    </div>
  </div>

  <div class="row5">
    <div><p class="kv"><b>Payee / vendor</b><br>${esc(d.payee || '')}</p></div>
    <div><p class="kv"><b>Payment account</b><br>${esc(d.paymentAccount || '')}</p></div>
    <div><p class="kv"><b>${d.isBill ? 'Bill date' : 'Payment date'}</b><br>${esc(d.paymentDate || '')}</p></div>
    <div><p class="kv"><b>Payment method</b><br>${esc(d.paymentMethod || '')}</p></div>
    <div><p class="kv"><b>Amount</b><br>${esc(d.amountDisplay || '')}</p></div>
  </div>
  <div class="row5">
    <div><p class="kv"><b>Load / inv #</b><br>${esc(d.loadInvoice || '')}</p></div>
    <div><p class="kv"><b>Vendor invoice #</b><br>${esc(d.vendorInvoice || '')}</p></div>
    <div><p class="kv"><b>Shop / WO #</b><br>${esc(d.shopWo || '')}</p></div>
    <div><p class="kv"><b>Ref no.</b><br>${esc(d.refNo || '')}</p></div>
    <div><p class="kv"><b>Type</b><br>${esc(d.txnType || '')}</p></div>
  </div>
  <div class="row5">
    <div style="flex:2"><p class="kv"><b>Service</b><br>${esc(d.serviceType || '')}</p></div>
    <div style="flex:1"><p class="kv"><b>Unit</b><br>${esc(d.unit || '')}</p></div>
  </div>
  ${billExtras}

  <div class="sec-title">COST LINES</div>
  ${apCostSectionHtml(lines, d.amountDisplay)}

  ${memo ? `<div class="sec-title">MEMO</div><div class="box">${esc(memo)}</div>` : ''}
  ${attN > 0 ? `<p class="kv"><b>Attachments:</b> ${esc(String(attN))} file(s) on record (not printed here).</p>` : ''}

  <div class="sig-row">
    <div class="sig">Prepared by: __________________________ &nbsp; Date: __________</div>
    <div class="sig">Approved by: __________________________ &nbsp; Date: __________</div>
  </div>
</div>
<div class="footer">
  <span>${esc(d.companyName || 'IH 35 Transportation LLC')} — Confidential</span>
  <span class="c">${esc(d.docTitle || badge)}</span>
  <span>Page <span class="pnum"></span></span>
</div>
</body></html>`;
  }

  function fuelManualDoc(data) {
    const d = data || {};
    const badge = String(d.docTitle || 'FUEL')
      .toUpperCase()
      .includes('BILL')
      ? 'FUEL BILL'
      : 'FUEL EXPENSE';
    const rows = Array.isArray(d.fuelLines) ? d.fuelLines : [];
    let galSum = 0;
    let amtSum = 0;
    const body = rows
      .map((r, i) => {
        const g = Number(r.gallons);
        const a = Number(r.amount);
        if (Number.isFinite(g)) galSum += g;
        if (Number.isFinite(a)) amtSum += a;
        const amtCell = Number.isFinite(a) ? money(a) : esc(String(r.amount || '').trim() || '—');
        return `<tr><td>${i + 1}</td><td>${esc(r.description)}</td><td>${esc(r.gallons)}</td><td>${esc(
          r.ppg
        )}</td><td>${amtCell}</td><td>${r.lock ? 'Yes' : 'No'}</td><td>${esc(
          r.mode === 'item' ? r.itemLabel : r.categoryLabel
        )}</td><td>${esc(d.driver || '')}</td></tr>`;
      })
      .join('');
    const tbl =
      rows.length === 0
        ? '<p class="kv">No fuel lines.</p>'
        : `<table class="cost"><thead><tr><th>#</th><th>Description</th><th>Qty (gal)</th><th>$/gal</th><th>Amount</th><th>Lock $</th><th>Category / item</th><th>Driver</th></tr></thead><tbody>${body}</tbody></table>`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${esc(d.docTitle || 'Fuel')}</title><style>${baseStyles()}.muted{color:#555;font-size:9pt}</style></head><body>
<div class="pwrap">
  <div class="hdr">
    <div class="co-l">
      <div class="co-name">${esc(d.companyName || 'IH 35 Transportation LLC')}</div>
      <div class="co-addr">${esc(d.companyAddress || 'Laredo, TX')}</div>
    </div>
    <div class="co-r">
      <div class="doc-badge">${esc(badge)}</div>
      <div class="wo-meta"><div class="muted">Printed ${esc(d.printedAt || '')}</div></div>
    </div>
  </div>
  <div class="row4">
    <div><p class="kv"><b>Vendor</b><br>${esc(d.payee || '')}</p></div>
    <div><p class="kv"><b>Unit</b><br>${esc(d.unit || '')}</p></div>
    <div><p class="kv"><b>Date</b><br>${esc(d.paymentDate || '')}</p></div>
    <div><p class="kv"><b>Total</b><br>${esc(d.amountDisplay || '')}</p></div>
  </div>
  <div class="row4">
    <div><p class="kv"><b>Payment account</b><br>${esc(d.paymentAccount || '')}</p></div>
    <div><p class="kv"><b>Payment method</b><br>${esc(d.paymentMethod || '')}</p></div>
    <div><p class="kv"><b>Location</b><br>${esc(d.location || '')}</p></div>
    <div><p class="kv"><b>Class</b><br>${esc(d.classLabel || '')}</p></div>
  </div>
  <div class="row4">
    <div><p class="kv"><b>Load / inv #</b><br>${esc(d.loadInvoice || '')}</p></div>
    <div><p class="kv"><b>Vendor inv #</b><br>${esc(d.vendorInvoice || '')}</p></div>
    <div><p class="kv"><b>Shop / WO #</b><br>${esc(d.shopWo || '')}</p></div>
    <div><p class="kv"><b>Expense doc #</b><br>${esc(d.expenseDoc || '')}</p></div>
  </div>
  <div class="sec-title">COST LINES</div>
  ${tbl}
  <div class="tot">Total gallons: ${esc(Number.isFinite(galSum) ? galSum.toFixed(3) : '—')}<br/>Total amount: ${esc(
    money(amtSum)
  )}</div>
  ${String(d.memo || '').trim() ? `<div class="sec-title">MEMO</div><div class="box">${esc(d.memo)}</div>` : ''}
  <div class="sig-row">
    <div class="sig">Prepared by: __________________________ &nbsp; Date: __________</div>
    <div class="sig">Approved by: __________________________ &nbsp; Date: __________</div>
  </div>
</div>
<div class="footer">
  <span>${esc(d.companyName || 'IH 35 Transportation LLC')} — Confidential</span>
  <span class="c">${esc(d.docTitle || badge)}</span>
  <span>Page <span class="pnum"></span></span>
</div>
</body></html>`;
  }

  function genericDoc(type, data) {
    const title = String(type || 'report').replace(/-/g, ' ');
    const rows =
      data && typeof data === 'object' && !Array.isArray(data)
        ? Object.keys(data)
            .map(k => `<tr><th>${esc(k)}</th><td>${esc(String(data[k]))}</td></tr>`)
            .join('')
        : '';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title><style>${baseStyles()}
table.meta { width:100%; border-collapse:collapse; font-size:9pt; margin-top:10px; }
table.meta th, table.meta td { border:1px solid #ccc; padding:4px 6px; text-align:left; vertical-align:top; }
</style></head><body><div class="pwrap">
<div class="hdr"><div class="co-l"><div class="co-name">${esc(
      (data && data.companyName) || 'IH 35 Transportation LLC'
    )}</div><div class="co-addr">${esc((data && data.companyAddress) || 'Laredo, TX')}</div></div>
<div class="co-r"><div class="doc-badge">${esc(title.toUpperCase())}</div></div></div>
<p class="kv">Generated ${esc((data && data.printedAt) || new Date().toLocaleString())}</p>
<table class="meta">${rows || '<tr><td>No data</td></tr>'}</table>
</div></body></html>`;
  }

  function generatePrintDoc(type, data) {
    const t = String(type || '');
    if (t === 'workorder') return workorderDoc(data);
    if (
      t === 'expense' ||
      t === 'bill' ||
      t === 'maintenance-expense' ||
      t === 'maintenance-bill' ||
      t === 'fuel-bill' ||
      t === 'vendor-driver-bill'
    ) {
      return apExpenseBillDoc(data, t);
    }
    if (t === 'fuel-expense') return fuelManualDoc(data);
    return genericDoc(t, data);
  }

  function erpPrintOpenAndPrint(html) {
    const w = window.open('', '_blank', 'noopener');
    if (!w || !w.document) throw new Error('Unable to open print window (popup blocked?).');
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    const done = () => {
      try {
        w.close();
      } catch (_) {}
    };
    w.addEventListener('afterprint', done, { once: true });
    setTimeout(() => {
      try {
        w.print();
      } catch (_) {
        done();
      }
    }, 80);
    setTimeout(done, 120000);
  }

  window.generatePrintDoc = generatePrintDoc;
  window.erpPrintOpenAndPrint = erpPrintOpenAndPrint;
})();
