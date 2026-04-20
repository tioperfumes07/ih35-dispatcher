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

  function lineHasPositiveAmount(ln) {
    return (Number(ln && ln.amount) || 0) > 0;
  }

  function slugFilenamePart(s) {
    return String(s || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 72);
  }

  function workorderSuggestedFilename(d) {
    const data = d || {};
    const unit = slugFilenamePart(data.unitNumber || 'Unit') || 'Unit';
    const badge = workorderBadgeTitle(String(data.recordType || ''), data.recordTypeLabel || '');
    const doc = slugFilenamePart(badge.replace(/\s+/g, '-')) || 'WorkOrder';
    const svc = slugFilenamePart(data.serviceType || '') || 'Service';
    const vendor = slugFilenamePart(data.vendor || '') || '';
    const date = String(data.serviceDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    const parts = [unit, doc, svc].concat(vendor ? [vendor] : [], [date]);
    return parts.filter(Boolean).join('-') + '.pdf';
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
    if (low.includes('battery')) return 'BATTERY SERVICE';
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
      battery: 'BATTERY SERVICE',
      custom: 'WORK ORDER'
    };
    return map[r] || 'WORK ORDER';
  }

  function baseStyles() {
    return `
@page { size: letter portrait; margin: 0.65in 0.65in 0.85in 0.65in; counter-increment: page; }
@page :first { margin-top: 0.55in; }
html, body { margin:0; padding:0; color:#000; background:#fff; font-family: Arial, Helvetica, sans-serif; font-size:10pt; line-height:1.35; }
body { counter-reset: page 0; }
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
.pnum::after { content: counter(page); }
`;
  }

  function workorderDoc(d) {
    const data = d || {};
    const lines = Array.isArray(data.costLines) ? data.costLines : [];
    const rt = String(data.recordType || '').toLowerCase();
    const catLines = lines.filter(l => l.detailMode === 'category' && lineHasPositiveAmount(l));
    const itemLines = lines.filter(l => l.detailMode === 'item' && lineHasPositiveAmount(l));
    let catSum = 0;
    let itemSum = 0;
    catLines.forEach(ln => {
      catSum += Number(ln.amount) || 0;
    });
    itemLines.forEach(ln => {
      itemSum += Number(ln.amount) || 0;
    });

    const headCat =
      '<tr><th>#</th><th>CATEGORY / ACCOUNT</th><th>DESCRIPTION</th><th>AMOUNT</th><th>CLASS</th></tr>';

    const headItem =
      '<tr><th>#</th><th>PRODUCT / SERVICE</th><th>SKU</th><th>DESCRIPTION</th><th>QTY</th><th>RATE</th><th>AMOUNT</th><th>CLASS</th></tr>';

    let tableHtml = '';
    const theadCatReal = `<thead>${headCat}</thead>`;
    const theadItemReal = `<thead>${headItem}</thead>`;

    if (catLines.length) {
      const body = catLines
        .map((ln, i) => {
          const idx = i + 1;
          const amt = Number(ln.amount) || 0;
          return `<tr><td>${idx}</td><td>${esc(ln.accountLabel || ln.qboAccountId || '')}</td><td>${esc(
            ln.description || ''
          )}</td><td>${esc(money(amt))}</td><td>${esc(ln.classLabel || '')}</td></tr>`;
        })
        .join('');
      tableHtml += `<div class="sec-title" style="font-size:8pt;letter-spacing:0.04em;text-transform:uppercase;color:#333">Category expense lines</div><table class="cost">${theadCatReal}<tbody>${body}</tbody></table>
        <div class="tot" style="font-size:9pt;margin:2px 0 6px">Category subtotal: ${esc(money(catSum))}</div>`;
    }
    if (itemLines.length) {
      if (catLines.length) {
        tableHtml += '<div style="border-top:1px solid #999;margin:10pt 0 8px;padding-top:2px"></div>';
      }
      const body = itemLines
        .map((ln, i) => {
          const idx = i + 1;
          const qty = ln.quantity != null ? String(ln.quantity) : '';
          const rate = ln.unitPrice != null ? money(ln.unitPrice) : '';
          const amt = Number(ln.amount) || 0;
          return `<tr><td>${idx}</td><td>${esc(ln.itemLabel || ln.qboItemId || '')}</td><td>${esc(
            ln.sku || ''
          )}</td><td>${esc(ln.description || '')}</td><td>${esc(qty)}</td><td>${esc(rate)}</td><td>${esc(
            money(amt)
          )}</td><td>${esc(ln.classLabel || '')}</td></tr>`;
        })
        .join('');
      tableHtml += `<div class="sec-title" style="font-size:8pt;letter-spacing:0.04em;text-transform:uppercase;color:#333">Product / service lines</div><table class="cost">${theadItemReal}<tbody>${body}</tbody></table>
        <div class="tot" style="font-size:9pt;margin:2px 0 6px">Item subtotal: ${esc(money(itemSum))}</div>`;
    }
    if (!tableHtml) {
      tableHtml = '<p class="kv"><b>No cost lines entered.</b></p>';
    }

    const total = Number(data.invoiceTotal);
    const totalDisp = Number.isFinite(total) ? money(total) : money(catSum + itemSum);

    const planned = String(data.plannedService || '').trim();
    const notes = String(data.notes || '').trim();
    const badge = workorderBadgeTitle(rt, data.recordTypeLabel);
    const woDisp = String(data.workOrderNumber || '').trim() || 'DRAFT';
    const subLine = `WO #: ${woDisp} · Date: ${data.serviceDate || '—'}`;
    const fleetType = String(data.fleetType || '').trim();
    const opStat = String(data.operationalStatus || '').trim();
    const driverNm = String(data.driverName || '').trim();
    const vendorRef = String(data.vendorReferenceNumber || '').trim();

    let accidentBlock = '';
    if (rt === 'accident') {
      const dot = data.accidentDotReportable ? 'YES' : 'NO';
      accidentBlock = `
        <div class="sec-title">ACCIDENT INFORMATION</div>
        <div class="grid2"><div class="grid2-l" style="flex:1;border:none">
          <p class="kv"><b>Accident location:</b> ${esc(data.accidentLocation || '')}</p>
          <p class="kv"><b>Police / report #:</b> ${esc(data.accidentReportNumber || '')}</p>
          <p class="kv"><b>Fault:</b> ${esc(data.accidentFault || '')}</p>
          <p class="kv"><b>DOT reportable:</b> ${esc(dot)}</p>
        </div></div>`;
    }

    const svcLower = String(data.serviceType || '').toLowerCase();
    let inspectionBlock = '';
    const inspScope = String(data.inspectionScope || '').trim();
    if (data.inspectionLayout) {
      inspectionBlock = `
        <div class="sec-title">INSPECTION RESULTS</div>
        <div class="box">${esc(data.inspectionSummary || '')}</div>`;
    } else if (svcLower.includes('inspection') || svcLower.includes('dot annual') || inspScope) {
      inspectionBlock = `
        <div class="sec-title">INSPECTION RESULTS</div>
        <div class="box">${esc(
          `${inspScope ? `Inspection type / scope: ${inspScope}\n` : ''}Service: ${data.serviceType || '—'}\nNotes:\n${notes || '—'}`
        )}</div>`;
    }

    const partsHtml = data.partsMapSvg
      ? `<div class="sec-title">Parts / positions</div><div class="parts-map">${data.partsMapSvg}</div>`
      : '';

    const docTitle = `${badge} — ${data.unitNumber || 'Unit'}`;

    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${esc(docTitle)}</title><style>${baseStyles()}</style></head><body>
<div class="pwrap">
  <div class="hdr">
    <div class="co-l">
      <div class="co-name">${esc(data.companyName || 'IH 35 Transportation LLC')}</div>
      <div class="co-addr">${esc(data.companyAddress || 'Laredo, TX')}</div>
      ${data.companyPhone ? `<div class="co-addr">${esc(data.companyPhone)}</div>` : ''}
    </div>
    <div class="co-r">
      <div class="doc-badge">${esc(badge)}</div>
      <div class="wo-meta">
        <div class="muted">${esc(subLine)}</div>
        <div class="muted" style="margin-top:4px">Printed ${esc(data.printedAt || '')}</div>
      </div>
    </div>
  </div>

  <div class="sec-title">VEHICLE INFORMATION</div>
  <div class="grid2">
    <div class="grid2-l">
      <p class="kv" style="font-size:12pt"><b>Unit #:</b> ${esc(data.unitNumber || '')}</p>
      <p class="kv"><b>Year / Make / Model:</b> ${esc(data.yearMakeModel || '')}</p>
      <p class="kv"><b>VIN:</b> ${esc(data.vin || '')}</p>
      <p class="kv"><b>License plate:</b> ${esc(data.plate || '')}</p>
      <p class="kv"><b>Fleet type:</b> ${esc(fleetType || '—')}</p>
    </div>
    <div class="grid2-r">
      <p class="kv"><b>Odometer:</b> ${esc(data.odometer || '')} mi</p>
      <p class="kv"><b>Fuel level:</b> ${esc(
        (() => {
          const f = String(data.fuelLevel || '').trim();
          if (!f) return '';
          return /%$/.test(f) ? f : `${f}%`;
        })()
      )}</p>
      <p class="kv"><b>Operational status:</b> ${esc(opStat || '—')}</p>
      <p class="kv"><b>Repair status:</b> ${esc(data.repairStatus || '')}</p>
    </div>
  </div>

  <div class="sec-title">SERVICE INFORMATION</div>
  <div class="row4">
    <div><p class="kv"><b>Record type</b><br>${esc(data.recordTypeLabel || data.recordType || '')}</p></div>
    <div><p class="kv"><b>Service type</b><br>${esc(data.serviceType || '')}</p></div>
    <div><p class="kv"><b>Service date</b><br>${esc(data.serviceDate || '')}</p></div>
    <div><p class="kv"><b>Service location</b><br>${esc(data.serviceLocation || '')}</p></div>
  </div>
  <div class="row4">
    <div><p class="kv"><b>Location detail</b><br>${esc(data.locationDetail || '')}</p></div>
    <div><p class="kv"><b>Vendor</b><br>${esc(data.vendor || '')}</p></div>
    <div><p class="kv"><b>Driver</b><br>${esc(driverNm || '—')}</p></div>
    <div><p class="kv"><b>Load #</b><br>${esc(data.loadNumber || '')}</p></div>
  </div>
  <div class="row4">
    <div><p class="kv"><b>Odometer at service</b><br>${esc(data.odometer || '')}</p></div>
    <div><p class="kv"><b>Vendor invoice #</b><br>${esc(data.vendorInvoice || '')}</p></div>
    <div><p class="kv"><b>Reference / WO #</b><br>${esc(vendorRef || '—')}</p></div>
    <div><p class="kv"><b>Invoice total</b><br><span style="font-size:12pt;font-weight:700">${esc(totalDisp)}</span></p></div>
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
    ${catLines.length ? `Category lines: ${esc(money(catSum))}<br/>` : ''}${
      itemLines.length ? `Item lines: ${esc(money(itemSum))}<br/>` : ''
    }<span style="font-size:12pt;font-weight:700">TOTAL: ${esc(totalDisp)}</span>
  </div>

  ${partsHtml}

  ${notes ? `<div class="sec-title">NOTES</div><div class="box">${esc(notes)}</div>` : ''}

  <div class="sec-title">SIGNATURES</div>
  <div class="sig-row">
    <div class="sig">Technician: __________________________<br/>Print name: __________________________<br/>Date: __________</div>
    <div class="sig">Supervisor: __________________________<br/>Print name: __________________________<br/>Date: __________</div>
    <div class="sig">Approved by: __________________________<br/>Title: __________________________<br/>Date: __________</div>
  </div>
</div>
<div class="footer">
  <span>${esc(data.companyName || 'IH 35 Transportation LLC')} — Confidential</span>
  <span class="c">${esc(badge)} · ${esc(data.unitNumber || '—')} · ${esc(data.serviceDate || '')}</span>
  <span>Page <span class="pnum"></span></span>
</div>
</body></html>`;
  }

  function docBadgeForApType(type, data) {
    const t = String(type || '').toLowerCase();
    const map = {
      expense: 'EXPENSE RECORD',
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
    const cats = arr.filter(l => l.detailMode === 'category' && lineHasPositiveAmount(l));
    const items = arr.filter(l => l.detailMode === 'item' && lineHasPositiveAmount(l));
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
      html += `<div class="sec-title" style="font-size:8pt;letter-spacing:0.04em;text-transform:uppercase;color:#333">Expense lines (category)</div><table class="cost"><thead><tr><th>#</th><th>Category / account</th><th>Description</th><th>Amount</th><th>Class</th></tr></thead><tbody>`;
      cats.forEach((ln, i) => {
        html += `<tr><td>${i + 1}</td><td>${esc(ln.accountLabel || '')}</td><td>${esc(ln.description || ln.serviceType || '')}</td><td>${esc(
          money(Number(ln.amount) || 0)
        )}</td><td>${esc(ln.classLabel || '')}</td></tr>`;
      });
      html += `</tbody></table><div class="tot" style="font-size:9pt;margin:2px 0 6px">Category subtotal: ${esc(
        money(catSum)
      )}</div>`;
    }
    if (items.length) {
      if (cats.length) {
        html += '<div style="border-top:1px solid #999;margin:10pt 0 8px;padding-top:2px"></div>';
      }
      html += `<div class="sec-title" style="font-size:8pt;letter-spacing:0.04em;text-transform:uppercase;color:#333">Product / service lines</div><table class="cost"><thead><tr><th>#</th><th>Product / service</th><th>SKU</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Class</th></tr></thead><tbody>`;
      items.forEach((ln, i) => {
        const qty = ln.quantity != null ? String(ln.quantity) : String(ln.qty != null ? ln.qty : '');
        const rate = ln.unitPrice != null && Number.isFinite(Number(ln.unitPrice)) ? money(Number(ln.unitPrice)) : '';
        html += `<tr><td>${i + 1}</td><td>${esc(ln.itemLabel || '')}</td><td>${esc(ln.sku || '')}</td><td>${esc(
          ln.description || ln.serviceType || ''
        )}</td><td>${esc(qty)}</td><td>${esc(rate)}</td><td>${esc(money(Number(ln.amount) || 0))}</td><td>${esc(ln.classLabel || '')}</td></tr>`;
      });
      html += `</tbody></table><div class="tot" style="font-size:9pt;margin:2px 0 6px">Item subtotal: ${esc(
        money(itemSum)
      )}</div>`;
    }
    if (!html) html = '<p class="kv"><b>No expense lines entered.</b></p>';
    const hdr = String(headerAmountDisplay || '').trim();
    const grand = money(catSum + itemSum);
    html += `<div class="tot">${cats.length ? `Category lines: ${esc(money(catSum))}<br/>` : ''}${
      items.length ? `Item lines: ${esc(money(itemSum))}<br/>` : ''
    }<span style="font-size:12pt;font-weight:700">INVOICE TOTAL: ${esc(grand)}</span>${hdr ? ` &nbsp; <span class="muted">(Header: ${esc(
      hdr
    )})</span>` : ''}</div>`;
    return html;
  }

  function apExpenseBillDoc(data, type) {
    const d = data || {};
    const t = String(type || '').toLowerCase();
    const isBill = !!d.isBill || t === 'bill' || t.endsWith('-bill');
    const badge = isBill ? 'BILL' : docBadgeForApType(type, d);
    const lines = Array.isArray(d.costLines) ? d.costLines : [];
    const memo = String(d.memo || '').trim();
    const attN = Number(d.attachmentCount) || 0;
    const refDisp = String(d.refNo || d.vendorInvoice || d.shopWo || '').trim() || '—';
    const subLine = isBill
      ? `Bill # ${String(d.billNumber || d.vendorInvoice || '—').trim()} · ${d.paymentDate || '—'}`
      : `Expense # ${refDisp} · ${d.paymentDate || '—'}`;
    const titleTag = badge;
    const paymentStub = isBill
      ? `<div class="sec-title" style="margin-top:16px">Payment stub</div>
      <div class="box" style="border-style:dashed">
        <p class="kv" style="margin:0 0 6px"><b>PAYMENT STUB</b> — Bill # ${esc(String(d.billNumber || d.vendorInvoice || '').trim())}</p>
        <p class="kv" style="margin:0 0 6px">Vendor: ${esc(d.payee || '')} &nbsp;|&nbsp; Amount due: ${esc(
          d.amountDisplay || (Number.isFinite(Number(d.balanceDue)) ? money(Number(d.balanceDue)) : '—')
        )} &nbsp;|&nbsp; Due date: ${esc(d.dueDate || '')}</p>
        <p class="kv" style="margin:0">Check #: _______________ &nbsp;|&nbsp; Amount paid: $____________</p>
      </div>`
      : '';
    const trucking =
      d.unit || d.driver || d.loadInvoice || d.pickupDate || d.deliveryDate || d.emptyMiles || d.loadedMiles
        ? `<div class="sec-title">Trucking details</div>
      <div class="row4">
        <div><p class="kv"><b>Unit</b><br>${esc(d.unit || '')}</p></div>
        <div><p class="kv"><b>Driver</b><br>${esc(d.driver || '')}</p></div>
        <div><p class="kv"><b>Load #</b><br>${esc(d.loadInvoice || '')}</p></div>
        <div><p class="kv"><b>Settlement #</b><br>${esc(d.settlementNumber || '')}</p></div>
      </div>
      <div class="row4">
        <div><p class="kv"><b>Pick up date</b><br>${esc(d.pickupDate || '')}</p></div>
        <div><p class="kv"><b>Delivery date</b><br>${esc(d.deliveryDate || '')}</p></div>
        <div><p class="kv"><b>Empty miles</b><br>${esc(d.emptyMiles || '')}</p></div>
        <div><p class="kv"><b>Loaded miles</b><br>${esc(d.loadedMiles || '')}</p></div>
      </div>`
        : '';
    const billInfo = isBill
      ? `<div class="sec-title">Bill information</div>
      <div class="row4">
        <div><p class="kv"><b>Vendor</b><br>${esc(d.payee || '')}</p></div>
        <div><p class="kv"><b>Bill date</b><br>${esc(d.paymentDate || '')}</p></div>
        <div><p class="kv"><b>Due date</b><br>${esc(d.dueDate || '')}</p></div>
        <div><p class="kv"><b>Terms</b><br>${esc(d.terms || '')}</p></div>
      </div>
      <div class="row4">
        <div><p class="kv"><b>Bill #</b><br>${esc(String(d.billNumber || d.vendorInvoice || '').trim())}</p></div>
        <div style="flex:2"><p class="kv"><b>Balance due</b><br><span style="font-size:12pt;font-weight:700">${esc(
          d.amountDisplay || '—'
        )}</span></p></div>
      </div>`
      : '';
    const payInfo = !isBill
      ? `<div class="sec-title">Payment information</div>
      <div class="row4">
        <div><p class="kv"><b>Payee / vendor</b><br>${esc(d.payee || '')}</p></div>
        <div><p class="kv"><b>Payment date</b><br>${esc(d.paymentDate || '')}</p></div>
        <div><p class="kv"><b>Amount</b><br>${esc(d.amountDisplay || '')}</p></div>
        <div><p class="kv"><b>Payment account</b><br>${esc(d.paymentAccount || '')}</p></div>
      </div>
      <div class="row4">
        <div><p class="kv"><b>Payment method</b><br>${esc(d.paymentMethod || '')}</p></div>
        <div><p class="kv"><b>Ref #</b><br>${esc(refDisp)}</p></div>
        <div><p class="kv"><b>Txn type</b><br>${esc(d.txnType || '')}</p></div>
        <div><p class="kv"><b>Vendor invoice #</b><br>${esc(d.vendorInvoice || '')}</p></div>
      </div>`
      : '';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${esc(String(titleTag))}</title><style>${baseStyles()}
.muted { color:#555;font-size:9pt; }
</style></head><body>
<div class="pwrap">
  <div class="hdr">
    <div class="co-l">
      <div class="co-name">${esc(d.companyName || 'IH 35 Transportation LLC')}</div>
      <div class="co-addr">${esc(d.companyAddress || 'Laredo, TX')}</div>
      ${d.companyPhone ? `<div class="co-addr">${esc(d.companyPhone)}</div>` : ''}
    </div>
    <div class="co-r">
      <div class="doc-badge">${esc(badge)}</div>
      <div class="wo-meta"><div class="muted">${esc(subLine)}</div><div class="muted" style="margin-top:4px">Printed ${esc(
        d.printedAt || ''
      )}</div></div>
    </div>
  </div>

  ${billInfo}
  ${payInfo}
  ${trucking}

  <div class="sec-title">Cost breakdown</div>
  ${apCostSectionHtml(lines, d.amountDisplay)}

  ${memo ? `<div class="sec-title">Memo</div><div class="box">${esc(memo)}</div>` : ''}
  ${attN > 0 ? `<p class="kv"><b>Attachments:</b> ${esc(String(attN))} file(s) on record (not printed here).</p>` : ''}

  <div class="sig-row">
    <div class="sig">Prepared by: __________________________<br/>Date: __________</div>
    <div class="sig">Approved by: __________________________<br/>Date: __________</div>
  </div>
  ${paymentStub}
</div>
<div class="footer">
  <span>${esc(d.companyName || 'IH 35 Transportation LLC')} — Confidential</span>
  <span class="c">${esc(titleTag)} · ${esc(d.payee || d.unit || '—')}</span>
  <span>Page <span class="pnum"></span></span>
</div>
</body></html>`;
  }

  function paymentReceiptDoc(d) {
    const data = d || {};
    const rows = Array.isArray(data.billsPaid) ? data.billsPaid : [];
    let tot = 0;
    const body = rows
      .map(r => {
        const paid = Number(String(r.amountPaid || '').replace(/[^0-9.-]/g, ''));
        if (Number.isFinite(paid)) tot += paid;
        return `<tr><td>${esc(r.docNumber || '')}</td><td>${esc(r.billDate || '')}</td><td class="num">${esc(
          r.billAmount || ''
        )}</td><td class="num">${esc(r.amountPaid || '')}</td><td class="num">${esc(r.remaining || '')}</td></tr>`;
      })
      .join('');
    const payNo = String(data.paymentNumber || data.checkNum || 'DRAFT').trim();
    const sub = `Payment # ${payNo} · ${data.paymentDate || '—'}`;
    const tbl =
      rows.length === 0
        ? '<p class="kv">No bills selected for this draft.</p>'
        : `<table class="cost"><thead><tr><th>Bill #</th><th>Bill date</th><th>Amount</th><th>Payment applied</th><th>Remaining</th></tr></thead><tbody>${body}</tbody></table>`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>PAYMENT RECEIPT</title><style>${baseStyles()}
.muted { color:#555;font-size:9pt; }
table.cost td.num { text-align:right; }
</style></head><body>
<div class="pwrap">
  <div class="hdr">
    <div class="co-l">
      <div class="co-name">${esc(data.companyName || 'IH 35 Transportation LLC')}</div>
      <div class="co-addr">${esc(data.companyAddress || 'Laredo, TX')}</div>
    </div>
    <div class="co-r">
      <div class="doc-badge">PAYMENT RECEIPT</div>
      <div class="wo-meta"><div class="muted">${esc(sub)}</div><div class="muted" style="margin-top:4px">Printed ${esc(
        data.printedAt || ''
      )}</div></div>
    </div>
  </div>
  <div class="sec-title">Payment details</div>
  <div class="row4">
    <div><p class="kv"><b>Payment #</b><br>${esc(payNo)}</p></div>
    <div><p class="kv"><b>Date</b><br>${esc(data.paymentDate || '')}</p></div>
    <div><p class="kv"><b>Vendor</b><br>${esc(data.vendor || '')}</p></div>
    <div><p class="kv"><b>Amount</b><br>${esc(data.amountDisplay || '')}</p></div>
  </div>
  <div class="row4">
    <div><p class="kv"><b>Payment method</b><br>${esc(data.paymentMethod || '')}</p></div>
    <div><p class="kv"><b>Account</b><br>${esc(data.account || '')}</p></div>
    <div><p class="kv"><b>Check #</b><br>${esc(data.checkNum || '')}</p></div>
    <div></div>
  </div>
  <div class="sec-title">Bills paid</div>
  ${tbl}
  <div class="tot">TOTAL PAID: ${esc(money(tot))}</div>
  <div class="sig-row" style="margin-top:24px">
    <div class="sig">Authorized by: __________________________<br/>Title: __________________________<br/>Date: __________</div>
  </div>
</div>
<div class="footer">
  <span>${esc(data.companyName || 'IH 35 Transportation LLC')} — Confidential</span>
  <span class="c">Payment receipt · ${esc(data.vendor || '')}</span>
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
        const acct = r.mode === 'item' ? r.itemLabel : r.categoryLabel;
        return `<tr><td>${i + 1}</td><td>${esc(r.description)}</td><td>${esc(r.gallons)}</td><td>${esc(
          r.ppg
        )}</td><td>${amtCell}</td><td>${esc(acct || '')}</td></tr>`;
      })
      .join('');
    const tbl =
      rows.length === 0
        ? '<p class="kv">No fuel lines.</p>'
        : `<table class="cost"><thead><tr><th>#</th><th>Description</th><th>Qty (gal)</th><th>$/gal</th><th>Amount</th><th>Account</th></tr></thead><tbody>${body}</tbody></table>`;
    const expNo = String(d.expenseDoc || '').trim() || '—';
    const subFuel = `Expense # ${expNo} · ${d.paymentDate || '—'}`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${esc(d.docTitle || 'Fuel')}</title><style>${baseStyles()}.muted{color:#555;font-size:9pt}</style></head><body>
<div class="pwrap">
  <div class="hdr">
    <div class="co-l">
      <div class="co-name">${esc(d.companyName || 'IH 35 Transportation LLC')}</div>
      <div class="co-addr">${esc(d.companyAddress || 'Laredo, TX')}</div>
    </div>
    <div class="co-r">
      <div class="doc-badge">${esc(badge)}</div>
      <div class="wo-meta"><div class="muted">${esc(subFuel)}</div><div class="muted" style="margin-top:4px">Printed ${esc(
        d.printedAt || ''
      )}</div></div>
    </div>
  </div>
  <div class="sec-title">Fuel transaction</div>
  <div class="row4">
    <div><p class="kv"><b>Vendor / merchant</b><br>${esc(d.payee || '')}</p></div>
    <div><p class="kv"><b>Date</b><br>${esc(d.paymentDate || '')}</p></div>
    <div><p class="kv"><b>Unit / truck</b><br>${esc(d.unit || '')}</p></div>
    <div><p class="kv"><b>Driver</b><br>${esc(d.driver || '')}</p></div>
  </div>
  <div class="row4">
    <div><p class="kv"><b>Load #</b><br>${esc(d.loadInvoice || '')}</p></div>
    <div><p class="kv"><b>Payment method</b><br>${esc(d.paymentMethod || '')}</p></div>
    <div><p class="kv"><b>Pay from account</b><br>${esc(d.paymentAccount || '')}</p></div>
    <div><p class="kv"><b>Total</b><br>${esc(d.amountDisplay || '')}</p></div>
  </div>
  <div class="row4">
    <div><p class="kv"><b>Vendor inv #</b><br>${esc(d.vendorInvoice || '')}</p></div>
    <div><p class="kv"><b>Shop / WO #</b><br>${esc(d.shopWo || '')}</p></div>
    <div><p class="kv"><b>Expense doc #</b><br>${esc(d.expenseDoc || '')}</p></div>
    <div><p class="kv"><b>Location</b><br>${esc(d.location || '')}</p></div>
  </div>
  <div class="sec-title">Fuel cost lines</div>
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
    if (t === 'payment-receipt' || t === 'bill-payment') return paymentReceiptDoc(data);
    return genericDoc(t, data);
  }

  function erpPrintOpenAndPrint(html, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const suggested = String(opts.suggestedFilename || opts.filename || '').trim();
    const w = window.open('', '_blank', 'width=900,height=700,noopener,noreferrer');
    if (!w || !w.document) throw new Error('Unable to open print window (popup blocked?).');
    w.document.open();
    w.document.write(html);
    w.document.close();
    if (suggested) {
      try {
        const base = suggested.replace(/\.[a-z0-9]+$/i, '');
        w.document.title = base || suggested;
      } catch (_) {}
    }
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

  function generatePrintWindow(documentType, data, options) {
    const html = generatePrintDoc(documentType, data);
    const opts = options && typeof options === 'object' ? options : {};
    let suggested = String(opts.suggestedFilename || '').trim();
    if (!suggested && String(documentType || '') === 'workorder') {
      suggested = workorderSuggestedFilename(data);
    }
    if (!suggested && typeof window.generateFilename === 'function') {
      try {
        suggested = window.generateFilename(documentType, data, 'pdf');
      } catch (_) {}
    }
    erpPrintOpenAndPrint(html, { suggestedFilename: suggested });
  }

  window.generatePrintDoc = generatePrintDoc;
  window.erpPrintOpenAndPrint = erpPrintOpenAndPrint;
  window.generatePrintWindow = generatePrintWindow;
})();
