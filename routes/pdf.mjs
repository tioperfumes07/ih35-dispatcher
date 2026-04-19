import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { dbQuery, getPool } from '../lib/db.mjs';
import { readFullErpJson, readMaintenanceJson } from '../lib/read-erp.mjs';
import { buildSettlementByLoad } from '../lib/settlement-by-load.mjs';
import { fetchLoadSettlementContextByNumber } from './tms.mjs';

const router = Router();

const TMS_COMPANY_NAME = String(process.env.TMS_COMPANY_NAME || 'IH35 Transportation, LLC').trim();
const TMS_COMPANY_ADDRESS = String(process.env.TMS_COMPANY_ADDRESS || '').trim();
const TMS_COMPANY_PHONE = String(process.env.TMS_COMPANY_PHONE || '').trim();
const TMS_INVOICE_TERMS = String(process.env.TMS_INVOICE_TERMS || 'Regular Pay').trim();
const TMS_INVOICE_PAYMENT_DAYS = (() => {
  const n = Number(process.env.TMS_INVOICE_PAYMENT_TERMS_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
})();
const TMS_INVOICE_FOOTER_NOTES = String(process.env.TMS_INVOICE_FOOTER_NOTES || '').trim();
const TMS_PDF_FOOTER_URL = String(process.env.TMS_PDF_FOOTER_URL || '').trim();

function safeNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function sliceDate(v) {
  if (!v) return '—';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function repairStatusPdfLabel(s) {
  const v = String(s || '').trim();
  if (v === 'queued') return 'Awaiting service';
  if (v === 'in_progress') return 'In progress';
  if (v === 'finished') return 'Completed';
  return v || '—';
}

function paymentDueIso(invDateYmd) {
  const d = new Date(String(invDateYmd).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '—';
  d.setDate(d.getDate() + TMS_INVOICE_PAYMENT_DAYS);
  return d.toISOString().slice(0, 10);
}

function parseInvoiceExtraLines(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.trim()) {
    try {
      const j = JSON.parse(val);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}

function itemNameFromErp(erp, qboId) {
  const items = erp?.qboCache?.items || [];
  const hit = items.find(i => String(i.qboId) === String(qboId));
  return hit ? String(hit.name || '').trim() || 'Service' : 'Service';
}

function vendorNameFromErp(erp, qboId) {
  const v = erp?.qboCache?.vendors || [];
  const hit = v.find(x => String(x.qboId) === String(qboId));
  return hit ? String(hit.name || '').trim() : '';
}

function accountNameFromErp(erp, qboId) {
  const a = [...(erp?.qboCache?.accounts || []), ...(erp?.qboCache?.accountsExpense || [])];
  const hit = a.find(x => String(x.qboId) === String(qboId));
  return hit ? String(hit.name || '').trim() : '';
}

function paymentMethodLabel(erp, pmId) {
  const p = (erp?.paymentMethods || []).find(x => String(x.id) === String(pmId));
  return p ? String(p.name || '').trim() : '';
}

function bankAccountLabel(erp, qboBankId) {
  const b = (erp?.qboCache?.accountsBank || []).find(x => String(x.qboId) === String(qboBankId));
  return b ? String(b.name || '').trim() : '';
}

function money(n) {
  const x = Number(n);
  return Number.isFinite(x) ? `$${x.toFixed(2)}` : '—';
}

function firstWoRefForLoad(erp, loadNumber) {
  const ln = String(loadNumber || '').trim();
  const wos = (erp.workOrders || []).filter(w => String(w.loadNumber || '').trim() === ln);
  const wo = wos[0];
  if (!wo) return '';
  return String(wo.internalWorkOrderNumber || wo.vendorInvoiceNumber || '').trim();
}

function drawHeaderBand(doc, titleRight) {
  const w = doc.page.width;
  doc.save();
  doc.rect(36, 36, w - 72, 52).fill('#1a237e');
  doc.fillColor('#ffffff').fontSize(15).font('Helvetica-Bold');
  doc.text(TMS_COMPANY_NAME, 48, 46, { width: w - 120 });
  doc.font('Helvetica').fontSize(8.5);
  const addr = [TMS_COMPANY_ADDRESS, TMS_COMPANY_PHONE].filter(Boolean).join(' · ');
  if (addr) doc.text(addr, 48, 66, { width: w - 120 });
  doc.fillColor('#1a237e').fontSize(18).font('Helvetica-Bold');
  doc.text(titleRight, 0, 48, { align: 'right', width: w - 48 });
  doc.restore();
  doc.y = 100;
  doc.fillColor('#000000').font('Helvetica').fontSize(10);
}

function hr(doc, y, x0 = 48, x1 = null) {
  const right = x1 ?? doc.page.width - 48;
  doc.save();
  doc.strokeColor('#cccccc').lineWidth(0.5).moveTo(x0, y).lineTo(right, y).stroke();
  doc.restore();
}

function pdfFooterLine(doc) {
  const parts = [sliceDate(new Date().toISOString()), TMS_PDF_FOOTER_URL || 'IH35 TMS'].filter(Boolean);
  doc.font('Helvetica').fontSize(7.5).fillColor('#666666').text(parts.join(' · '), 48, doc.page.height - 56, {
    align: 'center',
    width: doc.page.width - 96
  });
  doc.fillColor('#000000');
}

function sendPdf(res, filename, build) {
  const doc = new PDFDocument({ margin: 48, size: 'LETTER', bufferPages: false });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  build(doc);
  doc.end();
}

function ensureSpace(doc, y, need) {
  if (y + need > doc.page.height - 72) {
    doc.addPage();
    return 50;
  }
  return y;
}

function stopTypeLabel(t) {
  const u = String(t || '').toLowerCase();
  if (u === 'pickup' || u === 'pick') return 'Pickup';
  if (u === 'delivery' || u === 'deliver') return 'Deliver';
  if (u === 'empty') return 'Empty';
  return String(t || 'Stop').replace(/^\w/, c => c.toUpperCase());
}

function formatStopLine(s) {
  const dt = s?.stop_at ? sliceDate(s.stop_at) : '—';
  const loc = [s?.location_name, s?.address].filter(Boolean).join(', ').trim() || '—';
  return `${dt}, ${loc}`;
}

/** Always Track–style invoice: company left, meta right, BILL TO, LOAD DETAILS, RATES AND CHARGES table. */
router.get('/api/pdf/trip-invoice/:id', async (req, res) => {
  if (!getPool()) return res.status(503).send('Database not configured');
  try {
    const { rows } = await dbQuery(
      `SELECT l.*, t.unit_code AS truck_code, tr.unit_code AS trailer_code,
        c.name AS customer_join_name
       FROM loads l
       LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN trucks t ON t.id = l.truck_id
       LEFT JOIN trailers tr ON tr.id = l.trailer_id
       WHERE l.id = $1::uuid`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Load not found');
    const L = rows[0];
    const stopsRes = await dbQuery(
      `SELECT sequence_order, stop_type, location_name, address, practical_miles, stop_at
       FROM load_stops WHERE load_id = $1::uuid ORDER BY sequence_order`,
      [req.params.id]
    );
    const stops = stopsRes.rows || [];
    const erp = readMaintenanceJson();
    const extras = parseInvoiceExtraLines(L.invoice_extra_lines);
    const rev = safeNum(L.revenue_amount, 0);
    const invDate =
      (L.end_date && String(L.end_date).slice(0, 10)) ||
      (L.start_date && String(L.start_date).slice(0, 10)) ||
      new Date().toISOString().slice(0, 10);
    const shipDate = L.start_date ? sliceDate(L.start_date) : sliceDate(stops[0]?.stop_at);
    const delDate = L.end_date ? sliceDate(L.end_date) : sliceDate(stops[stops.length - 1]?.stop_at);
    const billTo = String(L.qbo_customer_name || '').trim() || String(L.customer_join_name || '').trim() || 'Customer';
    const fn = `Invoice-${String(L.load_number || 'load').replace(/[^\w.-]+/g, '_')}.pdf`;
    const loadedMiles = safeNum(L.practical_loaded_miles, 0);
    const woRef = firstWoRefForLoad(erp, L.load_number);

    const ratePerMile = loadedMiles > 0 && rev > 0 ? rev / loadedMiles : 0;
    const rateStr = loadedMiles > 0 ? ratePerMile.toFixed(2) : '0.00';

    const rateRows = [];
    if (rev > 0 || loadedMiles > 0) {
      rateRows.push({
        item: 'Line Haul',
        desc: 'Line Haul',
        miles: loadedMiles > 0 ? loadedMiles.toFixed(2) : '0.00',
        rate: rateStr,
        amount: rev > 0 ? rev.toFixed(2) : '0.00'
      });
    }
    for (const x of extras) {
      const amt = safeNum(x?.amount, 0);
      if (!(amt > 0)) continue;
      const nm = itemNameFromErp(erp, x.qbo_item_id);
      const desc = String(x?.description || '').trim();
      rateRows.push({
        item: nm.slice(0, 28),
        desc: desc ? desc.slice(0, 40) : nm.slice(0, 40),
        miles: '0.00',
        rate: amt.toFixed(2),
        amount: amt.toFixed(2)
      });
    }
    if (!rateRows.length) {
      rateRows.push({
        item: 'Line Haul',
        desc: 'Line Haul',
        miles: loadedMiles > 0 ? loadedMiles.toFixed(2) : '0.00',
        rate: '0.00',
        amount: '0.00'
      });
    }
    const totalCharges = rateRows.reduce((s, r) => s + Number(r.amount), 0);

    const pickup = stops[0];
    const deliver = stops.length > 1 ? stops[stops.length - 1] : stops[0];

    sendPdf(res, fn, doc => {
      const left = 50;
      const rightCol = 332;
      const pageW = doc.page.width;
      let y = 48;

      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(13).text(TMS_COMPANY_NAME, left, y);
      doc.font('Helvetica').fontSize(9);
      y += 16;
      if (TMS_COMPANY_ADDRESS) {
        for (const line of TMS_COMPANY_ADDRESS.split(/\n/)) {
          if (String(line).trim()) {
            doc.text(String(line).trim(), left, y);
            y += 11;
          }
        }
      } else {
        doc.fillColor('#888888').text('Set TMS_COMPANY_ADDRESS in .env for letterhead.', left, y);
        y += 12;
        doc.fillColor('#000000');
      }

      const metaY0 = 48;
      let ry = metaY0;
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('Invoice #', rightCol, ry);
      doc.font('Helvetica').text(String(L.load_number || '—'), rightCol + 78, ry, { width: pageW - rightCol - 130 });
      ry += 12;
      doc.font('Helvetica-Bold').text('Invoice Date', rightCol, ry);
      doc.font('Helvetica').text(invDate, rightCol + 78, ry, { width: 160 });
      ry += 12;
      doc.font('Helvetica-Bold').text('Payment Due', rightCol, ry);
      doc.font('Helvetica').text(paymentDueIso(invDate), rightCol + 78, ry, { width: 160 });
      ry += 12;
      doc.font('Helvetica-Bold').text('Load #', rightCol, ry);
      doc.font('Helvetica').text(String(L.load_number || '—'), rightCol + 78, ry, { width: 160 });
      ry += 12;
      doc.font('Helvetica-Bold').text('Ship Date', rightCol, ry);
      doc.font('Helvetica').text(shipDate, rightCol + 78, ry, { width: 160 });
      ry += 12;
      doc.font('Helvetica-Bold').text('Delivery Date', rightCol, ry);
      doc.font('Helvetica').text(delDate, rightCol + 78, ry, { width: 160 });
      ry += 12;
      doc.font('Helvetica-Bold').text('Terms', rightCol, ry);
      doc.font('Helvetica').text(TMS_INVOICE_TERMS, rightCol + 78, ry, { width: 160 });
      ry += 12;
      const displayWo = String(L.customer_wo_number || '').trim() || woRef;
      if (displayWo) {
        doc.font('Helvetica-Bold').text('W/O #', rightCol, ry);
        doc.font('Helvetica').text(String(displayWo).slice(0, 40), rightCol + 78, ry, { width: 160 });
        ry += 12;
      }

      y = Math.max(y, ry) + 14;
      hr(doc, y);
      y += 14;

      doc.font('Helvetica-Bold').fontSize(10).text('BILL TO:', left, y);
      y += 12;
      doc.font('Helvetica').fontSize(9.5);
      for (const line of billTo.split(/\n/)) {
        doc.text(line.trim() || ' ', left, y);
        y += 11;
      }
      y += 6;
      doc.text(`Truck: ${L.truck_code || '—'}  Trailer: ${L.trailer_code || '—'}`, left, y);
      y += 18;

      doc.font('Helvetica-Bold').fontSize(10).text('LOAD DETAILS', left, y);
      y += 12;
      doc.font('Helvetica').fontSize(9);
      if (pickup) {
        doc.text(`Pickup ${formatStopLine(pickup)}`, left, y, { width: pageW - 100 });
        y += 22;
      }
      if (deliver && deliver !== pickup) {
        doc.text(`Deliver ${formatStopLine(deliver)}`, left, y, { width: pageW - 100 });
        y += 22;
      }
      doc.fillColor('#555555')
        .fontSize(8.5)
        .text(
          `PO #: —   Seal: —   BOL: —   Quantity: —   Weight: —${L.notes ? `   Notes: ${String(L.notes).slice(0, 120)}` : ''}`,
          left,
          y,
          { width: pageW - 100 }
        );
      doc.fillColor('#000000');
      y += 20;

      doc.font('Helvetica-Bold').fontSize(10).text('RATES AND CHARGES', left, y);
      y += 12;

      const c0 = left;
      const c1 = left + 78;
      const c2 = left + 268;
      const c3 = left + 328;
      const c4 = left + 400;
      doc.font('Helvetica-Bold').fontSize(8);
      doc.text('Item', c0, y);
      doc.text('Description', c1, y, { width: c2 - c1 - 6 });
      doc.text('Miles', c2, y, { width: c3 - c2 - 6, align: 'right' });
      doc.text('Rate', c3, y, { width: c4 - c3 - 6, align: 'right' });
      doc.text('Amount', c4, y, { width: pageW - c4 - 50, align: 'right' });
      y += 12;
      hr(doc, y, left, pageW - 50);
      y += 8;
      doc.font('Helvetica').fontSize(8.5);
      for (const row of rateRows) {
        y = ensureSpace(doc, y, 28);
        doc.text(row.item, c0, y, { width: c1 - c0 - 4 });
        doc.text(row.desc, c1, y, { width: c2 - c1 - 6 });
        doc.text(row.miles, c2, y, { width: c3 - c2 - 6, align: 'right' });
        doc.text(row.rate, c3, y, { width: c4 - c3 - 6, align: 'right' });
        doc.text('$' + Number(row.amount).toFixed(2), c4, y, { width: pageW - c4 - 50, align: 'right' });
        y += 16;
      }
      y += 6;
      hr(doc, y, left, pageW - 50);
      y += 10;
      doc.font('Helvetica-Bold').fontSize(9.5);
      doc.text('Total Charges:', c3 - 20, y, { width: 120, align: 'right' });
      doc.text('$' + totalCharges.toFixed(2), c4, y, { width: pageW - c4 - 50, align: 'right' });
      y += 22;

      doc.font('Helvetica-Bold').fontSize(9).text('Notes:', left, y);
      y += 11;
      doc.font('Helvetica').fontSize(8.5).fillColor('#333333');
      const defaultNotes =
        'All payments must be assigned per your agreement with the carrier.\n' +
        'Amounts from IH35 TMS; post to QuickBooks from Dispatch when connected.';
      doc.text(TMS_INVOICE_FOOTER_NOTES || defaultNotes, left, y, { width: pageW - 100, lineGap: 2 });
      doc.fillColor('#000000');

      pdfFooterLine(doc);
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

/** Dispatch trip sheet — branded band (operations doc). */
router.get('/api/pdf/tms-load/:id', async (req, res) => {
  if (!getPool()) return res.status(503).send('Database not configured');
  try {
    const { rows } = await dbQuery(
      `SELECT l.*, t.unit_code AS truck_code, tr.unit_code AS trailer_code,
        c.name AS customer_join_name, d.name AS driver_join_name
       FROM loads l
       LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN drivers d ON d.id = l.driver_id
       LEFT JOIN trucks t ON t.id = l.truck_id
       LEFT JOIN trailers tr ON tr.id = l.trailer_id
       WHERE l.id = $1::uuid`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Load not found');
    const L = rows[0];
    const stops = await dbQuery(
      `SELECT sequence_order, stop_type, location_name, address, practical_miles, shortest_miles, stop_at, window_text
       FROM load_stops WHERE load_id = $1::uuid ORDER BY sequence_order`,
      [req.params.id]
    );
    const fn = `Trip-${String(L.load_number || 'load').replace(/[^\w.-]+/g, '_')}.pdf`;
    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'TRIP / LOAD');
      doc.fontSize(11).font('Helvetica-Bold').text(`Load / Invoice #  ${L.load_number || '—'}`, 48, doc.y);
      doc.moveDown(0.6);
      doc.font('Helvetica').fontSize(10);
      doc.text(`Status: ${L.status || '—'}`);
      doc.text(
        `Bill-to (QBO name): ${L.qbo_customer_name || L.customer_join_name || '—'} · Driver / carrier: ${L.qbo_driver_vendor_name || L.driver_join_name || '—'}`
      );
      doc.text(`Equipment: Truck ${L.truck_code || '—'} · Trailer ${L.trailer_code || '—'}`);
      doc.text(`Trip dates: ${String(L.start_date || '—').slice(0, 10)} → ${String(L.end_date || '—').slice(0, 10)}`);
      doc.text(
        `Miles (loaded / empty): ${L.practical_loaded_miles ?? 0} / ${L.practical_empty_miles ?? 0}` +
          (L.revenue_amount != null && String(L.revenue_amount).trim() !== ''
            ? ` · Trip revenue $${safeNum(L.revenue_amount, 0).toFixed(2)}`
            : '')
      );
      doc.moveDown(0.8);
      hr(doc, doc.y);
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(11).text('Stops (pickup → delivery)');
      doc.font('Helvetica').fontSize(9.5);
      for (const s of stops.rows || []) {
        doc.moveDown(0.35);
        doc.font('Helvetica-Bold').text(`${s.sequence_order}. ${String(s.stop_type || '').toUpperCase()}  ${s.location_name || ''}`);
        doc.font('Helvetica');
        if (s.address) doc.fillColor('#333333').text(s.address, { indent: 12 }).fillColor('#000000');
        doc.text(
          `   Miles: practical ${s.practical_miles ?? 0} · shortest ${s.shortest_miles ?? 0} · Window: ${s.window_text || '—'}`,
          { indent: 12 }
        );
      }
      doc.moveDown(1);
      hr(doc, doc.y);
      doc.moveDown(0.4);
      doc.fontSize(8).fillColor('#666666').text(`Generated ${new Date().toISOString().slice(0, 10)} · IH35 TMS`);
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

/** Company settlement for one load — sections like Always Track (charges, driver pay, expenses, revenue). */
router.get('/api/pdf/company-settlement/:loadNumber', async (req, res) => {
  try {
    const raw = req.params.loadNumber != null ? decodeURIComponent(String(req.params.loadNumber)) : '';
    if (!raw.trim()) return res.status(400).send('load number required');
    const erp = readMaintenanceJson();
    const rep = buildSettlementByLoad(erp, raw);
    let tms = null;
    try {
      tms = await fetchLoadSettlementContextByNumber(raw);
    } catch {
      tms = null;
    }
    const L = tms?.load;
    const rev =
      L?.revenue_amount != null && String(L.revenue_amount).trim() !== '' ? safeNum(L.revenue_amount, null) : null;
    const net = rev != null && Number.isFinite(rev) ? Math.round((rev - rep.grandTotal) * 100) / 100 : null;
    const pct = (() => {
      const n = Number(process.env.DRIVER_SETTLEMENT_PAY_PCT);
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
    })();
    const loadedM = L != null ? safeNum(L.practical_loaded_miles, 0) : 0;
    const emptyM = L != null ? safeNum(L.practical_empty_miles, 0) : 0;
    const driverPayEst = pct != null && rev != null && rev > 0 ? Math.round(rev * pct * 100) / 100 : null;
    const payPerLoaded =
      driverPayEst != null && loadedM > 0 ? (driverPayEst / loadedM).toFixed(2) : '0.40';

    const fn = `Company-Settlement-${String(raw).replace(/[^\w.-]+/g, '_')}.pdf`;
    const apById = new Map((erp.apTransactions || []).map(a => [String(a.id), a]));

    sendPdf(res, fn, doc => {
      const left = 50;
      const w = doc.page.width - 100;
      let y = 48;
      const stmtNo = String(raw).replace(/\D/g, '').slice(-4) || raw.slice(-4) || '—';

      doc.font('Helvetica-Bold').fontSize(12).text(`Company Settlement No. ${stmtNo}`, left, y);
      y += 16;
      doc.font('Helvetica').fontSize(9.5);
      doc.text(`Start Date:  ${L?.start_date ? sliceDate(L.start_date) : '—'}`, left, y);
      y += 12;
      doc.text(`End Date:  ${L?.end_date ? sliceDate(L.end_date) : '—'}`, left, y);
      y += 14;
      doc.font('Helvetica-Bold').text(TMS_COMPANY_NAME, left, y);
      y += 14;

      if (tms?.stops?.length) {
        doc.font('Helvetica-Bold').fontSize(9).text(`Load ${raw}`, left, y);
        y += 12;
        doc.font('Helvetica').fontSize(8.5);
        const trk = L?.truck_code || '—';
        const trl = L?.trailer_code || '—';
        const drv = L?.driver_name || L?.qbo_driver_vendor_name || '—';
        for (const s of tms.stops) {
          y = ensureSpace(doc, y, 20);
          const leg = `${stopTypeLabel(s.stop_type)}${formatStopLine(s)} Trk: ${trk} / Trlr: ${trl} / ${drv}`;
          doc.text(leg, left, y, { width: w });
          y += 14;
        }
        y += 8;
      }

      doc.font('Helvetica-Bold').fontSize(10).text('CUSTOMER CHARGES', left, y);
      y += 12;
      doc.font('Helvetica-Bold').fontSize(7.5);
      doc.text('Item', left, y);
      doc.text('Description', left + 72, y, { width: 200 });
      doc.text('Miles', left + 278, y, { width: 52, align: 'right' });
      doc.text('Rate', left + 330, y, { width: 52, align: 'right' });
      doc.text('Amount', left + 400, y, { width: 80, align: 'right' });
      y += 10;
      hr(doc, y, left, doc.page.width - 50);
      y += 8;
      doc.font('Helvetica').fontSize(8.5);
      const custLabel = L?.customer_name || L?.qbo_customer_name || 'Customer';
      const milesStr = loadedM > 0 ? loadedM.toFixed(1) : '0.0';
      const rateStr = loadedM > 0 && rev != null && rev > 0 ? (rev / loadedM).toFixed(2) : '0.00';
      const amtStr = rev != null ? rev.toFixed(2) : '0.00';
      doc.text('Line Haul', left, y);
      doc.text('Line Haul', left + 72, y, { width: 200 });
      doc.text(milesStr, left + 278, y, { width: 52, align: 'right' });
      doc.text(rateStr, left + 330, y, { width: 52, align: 'right' });
      doc.text(rev != null ? `$${amtStr}` : '—', left + 400, y, { width: 80, align: 'right' });
      y += 14;
      doc.font('Helvetica-Bold').text(`Total Line Haul:`, left + 250, y);
      doc.text(rev != null ? `$${amtStr}` : '—', left + 400, y, { width: 80, align: 'right' });
      y += 18;

      doc.font('Helvetica-Bold').fontSize(10).text('DRIVER PAYMENT', left, y);
      y += 12;
      doc.font('Helvetica').fontSize(8.5);
      if (L) {
        y = ensureSpace(doc, y, 36);
        doc.font('Helvetica-Bold').text(`Load ${raw} / ${L.qbo_driver_vendor_name || L.driver_name || 'Driver'}`, left, y);
        y += 12;
        doc.font('Helvetica');
        doc.text(
          `Loaded Miles${loadedM > 0 ? loadedM.toFixed(1) : '0'}  @  $${payPerLoaded}` +
            (driverPayEst != null ? `    $${driverPayEst.toFixed(2)}` : ''),
          left,
          y,
          { width: w }
        );
        y += 12;
        if (emptyM > 0) {
          doc.text(`Empty Miles${emptyM.toFixed(1)}  @  $${payPerLoaded}    (see TMS / env DRIVER_SETTLEMENT_PAY_PCT)`, left, y, {
            width: w
          });
          y += 12;
        }
      } else {
        doc.text('No TMS load for this # — driver lines omitted.', left, y);
        y += 12;
      }
      y += 10;

      doc.font('Helvetica-Bold').fontSize(10).text('EXPENSES', left, y);
      y += 12;
      doc.font('Helvetica-Bold').fontSize(7);
      doc.text('Date', left, y, { width: 54 });
      doc.text('Vendor', left + 54, y, { width: 72 });
      doc.text('Location', left + 128, y, { width: 100 });
      doc.text('Invoice', left + 228, y, { width: 52 });
      doc.text('Description', left + 278, y, { width: 120 });
      doc.text('Amount', left + 400, y, { width: 80, align: 'right' });
      y += 10;
      hr(doc, y, left, doc.page.width - 50);
      y += 6;
      doc.font('Helvetica').fontSize(7.5);
      for (const li of rep.lineItems || []) {
        y = ensureSpace(doc, y, 22);
        let dt = '—';
        let vendor = '—';
        let loc = '—';
        let inv = '—';
        if (li.kind === 'ap_transaction') {
          const ap = apById.get(String(li.id));
          if (ap) {
            dt = sliceDate(ap.txnDate);
            vendor = String(ap.vendorName || ap.vendor || '').slice(0, 20);
            loc = String(ap.assetUnit || '').slice(0, 24);
            inv = String(ap.docNumber || '').slice(0, 14);
          }
        } else if (li.kind === 'work_order_line') {
          const wo = (erp.workOrders || []).find(w => String(w.id) === String(li.parentId));
          if (wo) {
            dt = sliceDate(wo.serviceDate);
            vendor = String(wo.vendor || '').slice(0, 20);
            loc = String(wo.unit || '').slice(0, 24);
            inv = String(wo.vendorInvoiceNumber || wo.internalWorkOrderNumber || '').slice(0, 14);
          }
        } else {
          const rec = (erp.records || []).find(r => String(r.id) === String(li.id));
          if (rec) {
            dt = sliceDate(rec.serviceDate);
            vendor = String(rec.vendor || '').slice(0, 20);
            loc = String(rec.unit || '').slice(0, 24);
            inv = String(rec.vendorInvoiceNumber || '').slice(0, 14);
          }
        }
        const desc =
          li.kind === 'work_order_line'
            ? String(li.serviceType || '').slice(0, 40)
            : li.kind === 'ap_transaction'
              ? String(li.description || '').slice(0, 40)
              : `${String(li.serviceType || '').slice(0, 24)} ${String(li.description || '').slice(0, 16)}`.trim();
        doc.text(dt, left, y, { width: 54 });
        doc.text(vendor, left + 54, y, { width: 72 });
        doc.text(loc, left + 128, y, { width: 100 });
        doc.text(inv, left + 228, y, { width: 52 });
        doc.text(desc, left + 278, y, { width: 120 });
        doc.text('$' + Number(li.amount).toFixed(2), left + 400, y, { width: 80, align: 'right' });
        y += 14;
      }
      doc.font('Helvetica-Bold').text('Totals:', left + 320, y);
      doc.text('$' + rep.grandTotal.toFixed(2), left + 400, y, { width: 80, align: 'right' });
      y += 18;

      doc.font('Helvetica-Bold').fontSize(10).text('REVENUE', left, y);
      y += 12;
      doc.font('Helvetica').fontSize(9);
      if (rev != null) {
        doc.text(`Invoiced`, left, y);
        doc.text(`$${rev.toFixed(2)}`, left + 200, y);
        y += 12;
        doc.text(`Company expenses (roll-up)`, left, y);
        doc.text(`-$${rep.grandTotal.toFixed(2)}`, left + 200, y);
        y += 12;
        if (driverPayEst != null) {
          doc.text(`Driver salary (${((pct || 0) * 100).toFixed(1)}% of revenue, env)`, left, y);
          doc.text(`-$${driverPayEst.toFixed(2)}`, left + 200, y);
          y += 12;
        }
        doc.font('Helvetica-Bold');
        doc.text(`Net revenue (approx.)`, left, y);
        doc.text(`$${(rev - rep.grandTotal - (driverPayEst || 0)).toFixed(2)}`, left + 200, y);
        y += 12;
        doc.font('Helvetica');
        doc.text(`Miles (loaded + empty): ${(loadedM + emptyM).toFixed(1)}`, left, y);
      } else {
        doc.text('Add trip revenue on the TMS load to show invoiced / net lines.', left, y);
      }

      y += 20;
      doc.font('Helvetica').fontSize(7.5).fillColor('#666666').text('Single-load statement from IH35 TMS + local WO/AP/records.', left, y, { width: w });
      pdfFooterLine(doc);
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

/** Driver settlement — narrative per load + summary (Always Track–inspired). */
router.get('/api/pdf/driver-settlement/:vendorId', async (req, res) => {
  if (!getPool()) return res.status(503).send('Database not configured');
  try {
    const vendorId = String(req.params.vendorId || '').trim();
    if (!vendorId) return res.status(400).send('vendor id required');
    const { rows } = await dbQuery(
      `SELECT l.id, l.load_number, l.revenue_amount, l.status, l.qbo_driver_vendor_id, l.qbo_driver_vendor_name,
        l.start_date, l.end_date, l.practical_loaded_miles, l.practical_empty_miles,
        t.unit_code AS truck_code, tr.unit_code AS trailer_code
       FROM loads l
       LEFT JOIN trucks t ON t.id = l.truck_id
       LEFT JOIN trailers tr ON tr.id = l.trailer_id
       WHERE l.qbo_driver_vendor_id = $1
       ORDER BY COALESCE(l.start_date, l.end_date, l.created_at::date) NULLS LAST, l.load_number`,
      [vendorId]
    );
    if (!rows.length) return res.status(404).send('No loads for this driver vendor');
    const erp = readMaintenanceJson();
    const pct = (() => {
      const n = Number(process.env.DRIVER_SETTLEMENT_PAY_PCT);
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
    })();
    const vendorName = String(rows[0].qbo_driver_vendor_name || '').trim() || vendorId;

    const dates = rows.flatMap(r => [r.start_date, r.end_date].filter(Boolean).map(sliceDate));
    const startStmt = dates.length ? dates.sort()[0] : sliceDate(new Date().toISOString());
    const endStmt = dates.length ? dates.sort()[dates.length - 1] : startStmt;
    const stmtNo = String(rows.map(r => r.load_number).join('')).replace(/\D/g, '').slice(-4) || vendorId.slice(-4);

    const loadIds = rows.map(r => r.id);
    const stopsByLoad = new Map();
    if (loadIds.length) {
      const { rows: stopRows } = await dbQuery(
        `SELECT load_id, stop_type, location_name, address, practical_miles, stop_at, sequence_order
         FROM load_stops WHERE load_id = ANY($1::uuid[]) ORDER BY load_id, sequence_order`,
        [loadIds]
      );
      for (const s of stopRows) {
        const k = String(s.load_id);
        if (!stopsByLoad.has(k)) stopsByLoad.set(k, []);
        stopsByLoad.get(k).push(s);
      }
    }

    const fn = `Driver-Settlement-${vendorName.replace(/[^\w.-]+/g, '_').slice(0, 40)}.pdf`;

    sendPdf(res, fn, doc => {
      const left = 50;
      const w = doc.page.width - 100;
      let y = 48;

      doc.font('Helvetica-Bold').fontSize(12).text(`Driver Settlement No. ${stmtNo}`, left, y);
      y += 16;
      doc.font('Helvetica-Bold').fontSize(10).text(`${TMS_COMPANY_NAME}    ${vendorName}`, left, y, { width: w });
      y += 14;
      doc.font('Helvetica').fontSize(9.5);
      doc.text(`Start Date:  ${startStmt}`, left, y);
      y += 12;
      doc.text(`End Date:  ${endStmt}`, left, y);
      y += 12;
      if (TMS_COMPANY_ADDRESS) doc.text(`Address: ${TMS_COMPANY_ADDRESS.replace(/\n/g, ', ')}`, left, y, { width: w });
      y += TMS_COMPANY_ADDRESS ? 12 : 0;
      if (TMS_COMPANY_PHONE) doc.text(`Ph.: ${TMS_COMPANY_PHONE}`, left, y);
      y += 16;

      let sumLoaded = 0;
      let sumEmpty = 0;
      let sumSalary = 0;
      let sumRev = 0;
      let sumExp = 0;

      for (const r of rows) {
        const stops = stopsByLoad.get(String(r.id)) || [];
        const trk = r.truck_code || '—';
        const trl = r.trailer_code || '—';
        const rev = safeNum(r.revenue_amount, 0);
        let exp = 0;
        try {
          const rep = buildSettlementByLoad(erp, r.load_number);
          exp = safeNum(rep.grandTotal, 0);
        } catch {
          exp = 0;
        }
        const loaded = safeNum(r.practical_loaded_miles, 0);
        const empty = safeNum(r.practical_empty_miles, 0);
        const salary = pct != null && rev > 0 ? Math.round(rev * pct * 100) / 100 : null;
        const ppm = loaded > 0 && salary != null ? salary / loaded : safeNum(process.env.DRIVER_PDF_DEFAULT_MILE_RATE, 0.4);

        sumLoaded += loaded;
        sumEmpty += empty;
        if (salary != null) sumSalary += salary;
        sumRev += rev;
        sumExp += exp;

        y = ensureSpace(doc, y, 60);
        doc.font('Helvetica-Bold').fontSize(9.5).text(`Load ${r.load_number}    Truck ${trk} / Trailer ${trl}`, left, y, { width: w });
        y += 12;
        doc.font('Helvetica').fontSize(8.5);
        for (const s of stops) {
          y = ensureSpace(doc, y, 18);
          const pm = s.practical_miles != null ? `${Number(s.practical_miles).toFixed(1)}mi. ` : '';
          doc.text(`${stopTypeLabel(s.stop_type)}${pm}${formatStopLine(s)}`, left, y, { width: w });
          y += 13;
        }
        if (loaded > 0) {
          doc.text(`Loaded Miles${loaded.toFixed(1)}  @  $${ppm.toFixed(2)}    ${salary != null ? '$' + salary.toFixed(2) : '—'}`, left, y);
          y += 12;
        }
        if (empty > 0) {
          doc.text(`Empty Miles${empty.toFixed(1)}  @  $${ppm.toFixed(2)}    $${(empty * ppm).toFixed(2)}`, left, y);
          y += 12;
        }
        y += 6;
      }

      y = ensureSpace(doc, y, 56);
      doc.font('Helvetica-Bold').fontSize(9).text(`Total Loaded Miles ${sumLoaded.toFixed(1)}`, left, y);
      doc.font('Helvetica').text(
        pct != null ? `Salary: ${sumSalary.toFixed(2)}` : 'Set DRIVER_SETTLEMENT_PAY_PCT for salary total.',
        left + 200,
        y
      );
      y += 12;
      doc.text(`Total Empty Miles ${sumEmpty.toFixed(1)}`, left, y);
      y += 12;
      doc.text(`Total Miles ${(sumLoaded + sumEmpty).toFixed(1)}`, left, y);
      y += 18;

      doc.font('Helvetica-Bold').fontSize(9).text('Summary by load', left, y);
      y += 12;
      doc.font('Helvetica-Bold').fontSize(7.5);
      const x0 = left;
      const x1 = left + 78;
      const x2 = left + 168;
      const x3 = left + 248;
      const x4 = left + 328;
      const x5 = left + 408;
      doc.text('Load #', x0, y);
      doc.text('Revenue', x1, y, { width: x2 - x1 - 4, align: 'right' });
      doc.text('Expenses', x2, y, { width: x3 - x2 - 4, align: 'right' });
      doc.text('Net', x3, y, { width: x4 - x3 - 4, align: 'right' });
      doc.text('Pay %', x4, y, { width: x5 - x4 - 4, align: 'right' });
      doc.text('Suggested', x5, y, { width: 80, align: 'right' });
      y += 10;
      hr(doc, y, left, doc.page.width - 50);
      y += 6;
      doc.font('Helvetica').fontSize(8);
      for (const r of rows) {
        y = ensureSpace(doc, y, 16);
        const rev = safeNum(r.revenue_amount, 0);
        let exp = 0;
        try {
          exp = safeNum(buildSettlementByLoad(erp, r.load_number).grandTotal, 0);
        } catch {
          exp = 0;
        }
        const net = Math.round((rev - exp) * 100) / 100;
        const sug = pct != null && rev > 0 ? Math.round(rev * pct * 100) / 100 : null;
        doc.text(String(r.load_number), x0, y);
        doc.text('$' + rev.toFixed(2), x1, y, { width: x2 - x1 - 4, align: 'right' });
        doc.text('$' + exp.toFixed(2), x2, y, { width: x3 - x2 - 4, align: 'right' });
        doc.text('$' + net.toFixed(2), x3, y, { width: x4 - x3 - 4, align: 'right' });
        doc.text(pct != null ? `${(pct * 100).toFixed(0)}%` : '—', x4, y, { width: x5 - x4 - 4, align: 'right' });
        doc.text(sug != null ? '$' + sug.toFixed(2) : '—', x5, y, { width: 80, align: 'right' });
        y += 13;
      }

      y += 8;
      doc.font('Helvetica').fontSize(7.5).fillColor('#666666').text('Trip legs from TMS stops; expenses from WO/AP/unit records on load #.', left, y, { width: w });
      pdfFooterLine(doc);
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

router.get('/api/pdf/maintenance-record/:id', (req, res) => {
  try {
    const erp = readFullErpJson();
    const rec = (erp.records || []).find(r => String(r.id) === String(req.params.id));
    if (!rec) return res.status(404).send('Record not found');
    const fn = `maintenance-${String(rec.unit || 'unit').replace(/[^\w.-]+/g, '_')}-${String(rec.id).slice(-6)}.pdf`;
    const vendorQ = vendorNameFromErp(erp, rec.qboVendorId);
    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'MAINTENANCE RECORD');
      doc.font('Helvetica').fontSize(11);
      doc.text(`Unit: ${rec.unit || ''}`);
      doc.text(`Record type: ${rec.recordType || 'maintenance'}`);
      doc.text(`Repair / location type: ${rec.repairLocationType || '—'}`);
      doc.text(`Repair workflow: ${repairStatusPdfLabel(rec.repairStatus)}`);
      if (rec.repairStatusAt || rec.repairStatusBy) {
        const bits = [];
        if (rec.repairStatusAt) bits.push(`Recorded ${String(rec.repairStatusAt).replace('T', ' ').slice(0, 19)}`);
        if (rec.repairStatusBy) bits.push(`By: ${rec.repairStatusBy}`);
        doc.fontSize(9).fillColor('#444444').text(bits.join(' · '));
        doc.fontSize(11).fillColor('#000000');
      }
      doc.text(`Service: ${rec.serviceType || ''}`);
      doc.text(`Date: ${rec.serviceDate || ''}   Mileage: ${rec.serviceMileage ?? '—'}`);
      doc.text(`Vendor (name): ${rec.vendor || '—'}`);
      if (vendorQ) doc.text(`QuickBooks vendor (matched): ${vendorQ}`);
      doc.text(`Vendor invoice #: ${rec.vendorInvoiceNumber || '—'}`);
      doc.text(`Work order #: ${rec.workOrderNumber || '—'}`);
      doc.text(`Load / invoice #: ${rec.loadNumber || '—'}`);
      doc.text(`Detail mode: ${rec.detailMode || 'category'}   Payment: ${paymentMethodLabel(erp, rec.paymentMethodId)}`);
      if (rec.qboBankAccountId) doc.text(`Pay-from bank (QBO): ${bankAccountLabel(erp, rec.qboBankAccountId) || rec.qboBankAccountId}`);
      doc.text(`Total cost: ${money(rec.cost)}`);
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor('#444444').text(`QBO: ${rec.qboSyncStatus || '—'}  ${rec.qboEntityType || ''} ${rec.qboPurchaseId || ''}`.trim());
      doc.fontSize(10).fillColor('#000000');
      doc.moveDown();
      const costLines = Array.isArray(rec.costLines) ? rec.costLines : [];
      if (costLines.length) {
        doc.font('Helvetica-Bold').fontSize(10).text('Cost breakdown (parts & services)');
        doc.font('Helvetica').fontSize(9);
        costLines.forEach((ln, i) => {
          const q = ln.quantity;
          const up = ln.unitPrice;
          const amt = Number(ln.amount || 0).toFixed(2);
          const partBits = [ln.partPosition, ln.partCategory, ln.partNumber].filter(Boolean);
          const partSuf = partBits.length ? `  (${partBits.join(' · ')})` : '';
          const acct = ln.qboAccountId ? accountNameFromErp(erp, ln.qboAccountId) : '';
          const item = ln.qboItemId ? itemNameFromErp(erp, ln.qboItemId) : '';
          const meta = [acct && `Acct: ${acct}`, item && `Item: ${item}`].filter(Boolean).join(' · ');
          const line =
            q != null && up != null && Number(q) > 0 && Number(up) >= 0
              ? `${i + 1}. ${ln.description || '—'}${partSuf}  ${q} × $${Number(up).toFixed(2)} = $${amt}${meta ? `  ${meta}` : ''}`
              : `${i + 1}. ${ln.description || '—'}${partSuf}  $${amt}${meta ? `  ${meta}` : ''}`;
          doc.text(line);
        });
        doc.moveDown(0.5);
      }
      const tires = Array.isArray(rec.tireLineItems) ? rec.tireLineItems : [];
      if (tires.length) {
        doc.font('Helvetica-Bold').fontSize(10).text('Tire line items');
        doc.font('Helvetica').fontSize(9);
        tires.forEach((t, i) => {
          const line = [t.tirePosition, t.tireCondition, t.tireBrand, t.tireDot].filter(Boolean).join('  ·  ');
          doc.text(`${i + 1}. ${line || '—'}`);
        });
        doc.moveDown(0.5);
      }
      const planned = Array.isArray(rec.plannedWork) ? rec.plannedWork : [];
      const plannedLines = planned
        .map(x =>
          typeof x === 'string'
            ? String(x).trim()
            : String(x?.description || '')
                .trim()
        )
        .filter(Boolean);
      if (plannedLines.length) {
        doc.font('Helvetica-Bold').fontSize(10).text('Planned work (pre-cost scope)');
        doc.font('Helvetica').fontSize(9);
        plannedLines.forEach((line, i) => {
          doc.text(`${i + 1}. ${line}`);
        });
        doc.moveDown(0.5);
      }
      doc.font('Helvetica').fontSize(10).fillColor('#000000').text('Notes', { underline: true });
      doc.text(rec.notes || '—', { align: 'left' });
      doc.moveDown();
      doc.fontSize(8).fillColor('#666666').text(`ERP id: ${rec.id} · Generated ${sliceDate(new Date().toISOString())}`);
      pdfFooterLine(doc);
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

router.get('/api/pdf/ap-transaction/:id', (req, res) => {
  try {
    const erp = readFullErpJson();
    const ap = (erp.apTransactions || []).find(a => String(a.id) === String(req.params.id));
    if (!ap) return res.status(404).send('Transaction not found');
    const fn = `expense-${String(ap.docNumber || ap.id).replace(/[^\w.-]+/g, '_')}.pdf`;
    const vName = vendorNameFromErp(erp, ap.qboVendorId);
    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, ap.txnType === 'bill' ? 'BILL (AP)' : 'EXPENSE (AP)');
      doc.font('Helvetica').fontSize(11);
      doc.text(`Transaction type: ${ap.txnType || ''}   Line mode: ${ap.detailMode || ''}`);
      doc.text(`Vendor: ${vName || ap.qboVendorId || '—'}`);
      doc.text(`Doc #: ${ap.docNumber || '—'}`);
      doc.text(`Date: ${ap.txnDate || ''}   Due: ${ap.dueDate || '—'}`);
      doc.text(`Unit / class: ${ap.assetUnit || '—'}`);
      doc.text(`Payment method: ${paymentMethodLabel(erp, ap.paymentMethodId)}`);
      if (ap.qboBankAccountId) doc.text(`Pay-from bank (QBO): ${bankAccountLabel(erp, ap.qboBankAccountId) || ap.qboBankAccountId}`);
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text(`Amount: ${money(ap.amount)}`);
      doc.font('Helvetica');
      if (ap.detailMode === 'item') {
        doc.text(`QuickBooks item: ${itemNameFromErp(erp, ap.qboItemId)}`);
      } else {
        doc.text(`Expense account: ${accountNameFromErp(erp, ap.qboAccountId)}`);
      }
      doc.text(`Qty: ${ap.qty ?? '—'}`);
      doc.moveDown();
      doc.text('Description', { underline: true });
      doc.text(ap.description || '—');
      doc.moveDown(0.3);
      doc.text('Memo', { underline: true });
      doc.text(ap.memo || '—');
      doc.moveDown();
      doc.fontSize(9).fillColor('#444444').text(
        `QBO: ${ap.qboSyncStatus || '—'}  ${ap.qboEntityType || ''} ${ap.qboEntityId || ''}`.trim()
      );
      if (ap.importBatchId) doc.text(`Import batch: ${ap.importBatchId}`);
      doc.fontSize(8).fillColor('#666666').text(`ERP id: ${ap.id} · Post or revert from Accounting in Maintenance.`);
      pdfFooterLine(doc);
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

router.get('/api/pdf/work-order/:id', (req, res) => {
  try {
    const erp = readFullErpJson();
    const wo = (erp.workOrders || []).find(w => String(w.id) === String(req.params.id));
    if (!wo) return res.status(404).send('Work order not found');
    const lines = wo.lines || [];
    const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const fn = `work-order-${String(wo.unit || 'unit').replace(/[^\w.-]+/g, '_')}-${String(wo.id).slice(-6)}.pdf`;
    const vName = vendorNameFromErp(erp, wo.qboVendorId);
    const repairKind = wo.isInternalWorkOrder ? 'Internal (shop)' : 'External / vendor';
    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'WORK ORDER');
      doc.font('Helvetica').fontSize(11);
      doc.text(`Unit / asset: ${wo.unit || ''}`);
      doc.text(`Category: ${wo.assetCategory || '—'}   ·   ${repairKind}`);
      doc.text(`Repair / location type: ${wo.repairLocationType || '—'}`);
      doc.text(`Txn type: ${wo.txnType || 'expense'}   Service date: ${wo.serviceDate || '—'}`);
      doc.text(`Vendor (QBO): ${vName || wo.vendor || '—'}`);
      doc.text(`Vendor invoice #: ${wo.vendorInvoiceNumber || '—'}`);
      doc.text(`Shop / internal WO #: ${wo.internalWorkOrderNumber || '—'}`);
      doc.text(`Vendor WO #: ${wo.vendorWorkOrderNumber || '—'}`);
      doc.text(`Load / invoice #: ${wo.loadNumber || '—'}`);
      doc.text(`Due: ${wo.dueDate || '—'}`);
      doc.text(`Payment: ${paymentMethodLabel(erp, wo.paymentMethodId)}`);
      if (wo.qboBankAccountId) doc.text(`Pay-from bank (QBO): ${bankAccountLabel(erp, wo.qboBankAccountId) || wo.qboBankAccountId}`);
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10).text('Lines (parts & services)');
      doc.font('Helvetica').fontSize(9);
      lines.forEach((ln, i) => {
        const amt = money(ln.amount);
        const mode = ln.detailMode === 'item' ? 'Item' : 'Category';
        const acct = ln.detailMode === 'category' ? accountNameFromErp(erp, ln.qboAccountId) : '';
        const item = ln.detailMode === 'item' ? itemNameFromErp(erp, ln.qboItemId) : '';
        const tire = [ln.tirePosition, ln.tirePositionText].filter(Boolean).join(' ');
        const partMeta = [
          ln.partCategory && `type ${ln.partCategory}`,
          ln.partPosition && `pos ${ln.partPosition}`,
          ln.partNumber && `# ${ln.partNumber}`
        ]
          .filter(Boolean)
          .join(' · ');
        const lineBits = [
          `${i + 1}. ${ln.serviceType || ln.lineType || 'Line'}`,
          `Type: ${ln.lineType || '—'}`,
          mode,
          acct && `Acct: ${acct}`,
          item && `Item: ${item}`,
          `Qty ${ln.qty ?? 1} × rate ${ln.rate != null ? money(ln.rate) : '—'}`,
          amt,
          partMeta && `Parts: ${partMeta}`,
          tire && `Ref: ${tire}`,
          ln.qboLineDescription && `Line memo: ${String(ln.qboLineDescription).slice(0, 200)}`,
          typeof ln.billable === 'boolean' && (ln.billable ? 'Billable' : 'Not billable')
        ].filter(Boolean);
        doc.text(lineBits.join(' · '));
        if (ln.notes) doc.fontSize(8).fillColor('#555555').text(`   Notes: ${ln.notes}`);
        doc.fontSize(9).fillColor('#000000');
      });
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(12).text(`Total: ${money(total)}`);
      doc.font('Helvetica').fontSize(10);
      doc.moveDown();
      doc.text('Work order notes', { underline: true });
      doc.text(wo.notes || '—');
      doc.moveDown();
      doc.fontSize(9).fillColor('#444444').text(
        `QBO: ${wo.qboSyncStatus || '—'}  ${wo.qboEntityType || ''} ${wo.qboEntityId || ''}`.trim()
      );
      if (wo.importBatchId) doc.text(`Import batch: ${wo.importBatchId}`);
      doc.fontSize(8).fillColor('#666666').text(`ERP id: ${wo.id}`);
      pdfFooterLine(doc);
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

/** Unsaved fleet maintenance work order — snapshot from the Work order form (for shop/vendor packets). */
router.post('/api/pdf/fleet-maintenance-draft', (req, res) => {
  try {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const unit = String(b.unit || '').trim();
    if (!unit) return res.status(400).send('unit required');

    const safe = (v, max = 800) =>
      String(v ?? '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
        .slice(0, max);

    const recordType = safe(b.recordType, 40);
    const repairLoc = safe(b.repairLocationType, 40);
    const repairLabel = safe(b.repairLocationLabel, 120);
    const serviceType = safe(b.serviceType, 200);
    const serviceDate = safe(b.serviceDate, 24);
    const serviceMileage = safe(b.serviceMileage, 32);
    const vendor = safe(b.vendor, 200);
    const cost = b.cost != null && String(b.cost).trim() !== '' ? money(safeNum(b.cost, 0)) : '—';
    const vendorInv = safe(b.vendorInvoiceNumber, 80);
    const wo = safe(b.workOrderNumber, 80);
    const loadNo = safe(b.loadNumber, 80);
    const notes = safe(b.notes, 2400);
    const costLines = Array.isArray(b.costLines) ? b.costLines.slice(0, 45) : [];
    const plannedRaw = Array.isArray(b.plannedWork) ? b.plannedWork : [];
    const plannedLines = plannedRaw
      .map(x =>
        typeof x === 'string'
          ? safe(x, 240).trim()
          : safe(x?.description || x?.text || '', 240).trim()
      )
      .filter(Boolean)
      .slice(0, 40);

    const fn = `fleet-wo-draft-${unit.replace(/[^\w.-]+/g, '_')}-${Date.now()}.pdf`;
    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'WO DRAFT');
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#b45309');
      doc.text(
        'Draft — not saved in ERP. After save, use Fleet table → PDF / print on the row, or Save & record in QuickBooks.',
        48,
        doc.y,
        {
          width: doc.page.width - 96
        }
      );
      doc.fillColor('#000000').moveDown(0.8);
      doc.font('Helvetica').fontSize(10.5);
      doc.text(`Unit / asset: ${unit}`);
      doc.text(`Record type: ${recordType || '—'}`);
      if (repairLoc || repairLabel) {
        doc.text(`Repair / location: ${repairLabel || repairLoc || '—'}${repairLoc && repairLabel ? ` (${repairLoc})` : ''}`);
      }
      doc.text(`Service: ${serviceType || '—'}`);
      doc.text(`Service date: ${serviceDate || '—'}   Odometer: ${serviceMileage || '—'}`);
      doc.text(`Vendor (as entered): ${vendor || '—'}`);
      doc.text(`Invoice total: ${cost}`);
      doc.text(`Vendor invoice #: ${vendorInv || '—'}`);
      doc.text(`Work order / ref #: ${wo || '—'}`);
      doc.text(`Load / invoice #: ${loadNo || '—'}`);
      doc.moveDown(0.5);
      if (costLines.length) {
        doc.font('Helvetica-Bold').fontSize(10).text('Cost lines (draft)');
        doc.font('Helvetica').fontSize(9);
        costLines.forEach((ln, i) => {
          const desc = safe(ln.description, 200) || '—';
          const amt = ln.amount != null && String(ln.amount).trim() !== '' ? money(safeNum(ln.amount, 0)) : '—';
          const q = ln.quantity != null ? String(ln.quantity) : '';
          const up = ln.unitPrice != null ? money(safeNum(ln.unitPrice, 0)) : '';
          const mid = q && up ? `${q} × ${up} → ` : '';
          doc.text(`${i + 1}. ${mid}${amt} — ${desc}`);
        });
        doc.moveDown(0.5);
      }
      if (plannedLines.length) {
        doc.font('Helvetica-Bold').fontSize(10).text('Planned work (draft)');
        doc.font('Helvetica').fontSize(9).fillColor('#333333');
        plannedLines.forEach((line, i) => {
          doc.text(`${i + 1}. ${line}`);
        });
        doc.fillColor('#000000').moveDown(0.5);
      }
      doc.font('Helvetica-Bold').fontSize(10).text('Notes');
      doc.font('Helvetica').fontSize(9).fillColor('#333333').text(notes || '—', { align: 'left' });
      doc.fillColor('#000000').moveDown();
      doc.fontSize(8).fillColor('#666666').text(`Generated ${sliceDate(new Date().toISOString())} · ${TMS_COMPANY_NAME}`);
      pdfFooterLine(doc);
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

router.get('/api/pdf/shop-queue', (req, res) => {
  try {
    const erp = readFullErpJson();
    const active = (erp.maintenanceShopQueue || []).filter(e => String(e.status || '') !== 'finished');
    const fn = `shop-queue-${sliceDate(new Date().toISOString())}.pdf`;
    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'SHOP QUEUE');
      doc.font('Helvetica').fontSize(10);
      doc.text(`Open jobs (not finished) · ${sliceDate(new Date().toISOString())}`);
      doc.moveDown(0.8);
      const byType = { internal: [], external: [], roadside: [] };
      for (const e of active) {
        if (byType[e.shopType]) byType[e.shopType].push(e);
      }
      const heads = [
        ['internal', 'Internal shop'],
        ['external', 'External service'],
        ['roadside', 'Road side / OTR']
      ];
      for (const [key, title] of heads) {
        doc.font('Helvetica-Bold').fontSize(11).text(title);
        doc.font('Helvetica').fontSize(9);
        const rows = byType[key] || [];
        if (!rows.length) doc.fillColor('#666666').text('  (no open jobs)');
        else {
          doc.fillColor('#000000');
          rows.forEach(e => {
            const delay = e.delayReasonCode ? ` · delay: ${e.delayReasonCode}` : '';
            doc.text(
              `  ${e.unit || '—'} · ${e.title || 'Job'} · ${e.status || ''} · est ${e.estimatedHours != null ? e.estimatedHours + ' h' : '—'}${delay}`
            );
          });
        }
        doc.moveDown(0.6);
      }
      pdfFooterLine(doc);
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

export default router;
