import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { dbQuery, getPool } from '../lib/db.mjs';
import { readMaintenanceJson } from '../lib/read-erp.mjs';
import { buildSettlementByLoad } from '../lib/settlement-by-load.mjs';
import { fetchLoadSettlementContextByNumber } from './tms.mjs';

const router = Router();

const TMS_COMPANY_NAME = String(process.env.TMS_COMPANY_NAME || 'IH35 Transportation').trim();
const TMS_COMPANY_ADDRESS = String(process.env.TMS_COMPANY_ADDRESS || '').trim();
const TMS_COMPANY_PHONE = String(process.env.TMS_COMPANY_PHONE || '').trim();

function safeNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
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

function hr(doc, y) {
  doc.save();
  doc.strokeColor('#cccccc').lineWidth(0.5).moveTo(48, y).lineTo(doc.page.width - 48, y).stroke();
  doc.restore();
}

function sendPdf(res, filename, build) {
  const doc = new PDFDocument({ margin: 48, size: 'LETTER', bufferPages: false });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  build(doc);
  doc.end();
}

/** Dispatch trip sheet — branded layout similar to carrier trip documents. */
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

/** Carrier-style invoice (Always Track–like): linehaul + extra QBO item lines. */
router.get('/api/pdf/trip-invoice/:id', async (req, res) => {
  if (!getPool()) return res.status(503).send('Database not configured');
  try {
    const { rows } = await dbQuery(
      `SELECT l.*, t.unit_code AS truck_code, tr.unit_code AS trailer_code
       FROM loads l
       LEFT JOIN trucks t ON t.id = l.truck_id
       LEFT JOIN trailers tr ON tr.id = l.trailer_id
       WHERE l.id = $1::uuid`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).send('Load not found');
    const L = rows[0];
    const erp = readMaintenanceJson();
    const extras = parseInvoiceExtraLines(L.invoice_extra_lines);
    const rev = safeNum(L.revenue_amount, 0);
    const invDate = (L.end_date && String(L.end_date).slice(0, 10)) || new Date().toISOString().slice(0, 10);
    const billTo = String(L.qbo_customer_name || '').trim() || 'Customer';
    const fn = `Invoice-${String(L.load_number || 'load').replace(/[^\w.-]+/g, '_')}.pdf`;

    const tableRows = [];
    if (rev > 0) {
      tableRows.push({
        activity: 'Line haul (primary)',
        qty: '1',
        rate: rev.toFixed(2),
        amount: rev.toFixed(2)
      });
    } else if (!extras.length) {
      tableRows.push({
        activity: 'Line haul (primary) — enter trip revenue on the load to show amount',
        qty: '—',
        rate: '0.00',
        amount: '0.00'
      });
    }
    for (const x of extras) {
      const amt = safeNum(x?.amount, 0);
      if (!(amt > 0)) continue;
      const nm = itemNameFromErp(erp, x.qbo_item_id);
      const desc = String(x?.description || '').trim();
      tableRows.push({
        activity: desc ? `${nm} — ${desc}` : nm,
        qty: '1',
        rate: amt.toFixed(2),
        amount: amt.toFixed(2)
      });
    }
    const subtotal = tableRows.reduce((s, r) => s + Number(r.amount), 0);

    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'INVOICE');
      doc.y += 4;
      doc.fontSize(10);
      doc.font('Helvetica-Bold').text('Bill to', 48, doc.y);
      doc.font('Helvetica').text(billTo, 120, doc.y - 12, { width: 400 });
      doc.moveDown(1.2);
      doc.font('Helvetica').fontSize(9);
      doc.text(`Invoice #: ${L.load_number || '—'}`, 48, doc.y, { continued: true });
      doc.text(`    Date: ${invDate}`, { continued: true });
      doc.text(`    Reference load: ${L.load_number || '—'}`);
      doc.text(`Truck: ${L.truck_code || '—'} · Trailer: ${L.trailer_code || '—'}`);
      doc.moveDown(0.8);
      hr(doc, doc.y);
      doc.moveDown(0.5);

      const x0 = 48;
      const x1 = 230;
      const x2 = 300;
      const x3 = 380;
      const x4 = 480;
      let y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('Activity / description', x0, y, { width: x1 - x0 - 8 });
      doc.text('Qty', x1, y, { width: x2 - x1 - 8, align: 'right' });
      doc.text('Rate', x2, y, { width: x3 - x2 - 8, align: 'right' });
      doc.text('Amount', x3, y, { width: x4 - x3, align: 'right' });
      y += 16;
      hr(doc, y);
      y += 8;
      doc.font('Helvetica').fontSize(9);
      for (const row of tableRows) {
        doc.text(row.activity, x0, y, { width: x1 - x0 - 8 });
        doc.text(row.qty, x1, y, { width: x2 - x1 - 8, align: 'right' });
        doc.text('$' + row.rate, x2, y, { width: x3 - x2 - 8, align: 'right' });
        doc.text('$' + row.amount, x3, y, { width: x4 - x3, align: 'right' });
        y += 22;
        if (y > doc.page.height - 120) {
          doc.addPage();
          y = 48;
        }
      }
      y += 6;
      hr(doc, y);
      y += 10;
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text('Total USD', x2, y, { width: x3 - x2 - 8, align: 'right' });
      doc.text('$' + subtotal.toFixed(2), x3, y, { width: x4 - x3, align: 'right' });
      doc.moveDown(2);
      doc.font('Helvetica').fontSize(8).fillColor('#555555').text('Amounts from TMS trip. Post to QuickBooks from Dispatch when connected.', 48, doc.y, {
        width: doc.page.width - 96
      });
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

/** Company settlement — trip revenue vs rolled-up expenses (Always Track–style summary). */
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
    const rev =
      tms?.load?.revenue_amount != null && String(tms.load.revenue_amount).trim() !== ''
        ? safeNum(tms.load.revenue_amount, null)
        : null;
    const net = rev != null && Number.isFinite(rev) ? Math.round((rev - rep.grandTotal) * 100) / 100 : null;
    const fn = `Company-Settlement-${String(raw).replace(/[^\w.-]+/g, '_')}.pdf`;

    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'COMPANY SETTLEMENT');
      doc.font('Helvetica').fontSize(10);
      doc.text(`Settlement load / invoice #: ${raw}`, 48, doc.y);
      doc.text(`Statement date: ${new Date().toISOString().slice(0, 10)}`);
      if (tms?.load) {
        doc.text(`TMS status: ${tms.load.status || '—'} · Customer: ${tms.load.customer_name || tms.load.qbo_customer_name || '—'}`);
      }
      doc.moveDown(0.8);
      if (rev != null) {
        doc.font('Helvetica-Bold').text(`Trip revenue (TMS): $${rev.toFixed(2)}`);
        doc.font('Helvetica').text(`Total trip expenses (WO + AP + unit records): $${rep.grandTotal.toFixed(2)}`);
        doc.font('Helvetica-Bold').text(`Net to company: $${net != null ? net.toFixed(2) : '—'}`);
      } else {
        doc.text(`Total trip expenses: $${rep.grandTotal.toFixed(2)} (add trip revenue on the load in TMS for net).`);
      }
      doc.moveDown(0.8);
      hr(doc, doc.y);
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10).text('Expense detail');
      doc.moveDown(0.3);
      const x0 = 48;
      const x1 = 120;
      const x2 = 380;
      const x3 = 500;
      let y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5);
      doc.text('Source', x0, y);
      doc.text('Description', x1, y, { width: x2 - x1 - 10 });
      doc.text('Unit', x2, y, { width: 60 });
      doc.text('Amount', x3, y, { width: 52, align: 'right' });
      y += 14;
      hr(doc, y);
      y += 6;
      doc.font('Helvetica').fontSize(8.5);
      for (const li of rep.lineItems || []) {
        let src = '—';
        if (li.kind === 'work_order_line') src = 'WO';
        else if (li.kind === 'ap_transaction') src = 'AP';
        else if (li.kind === 'maintenance_record') src = 'Unit';
        let desc = '';
        if (li.kind === 'work_order_line') desc = `${li.serviceType || ''} ${li.tireRef ? ' · ' + li.tireRef : ''}`.trim();
        else if (li.kind === 'ap_transaction') desc = li.description || '';
        else desc = `${li.serviceType || ''} ${li.description || ''}`.trim();
        doc.text(src, x0, y);
        doc.text(desc.slice(0, 120), x1, y, { width: x2 - x1 - 10 });
        doc.text(String(li.unit || ''), x2, y, { width: 60 });
        doc.text('$' + Number(li.amount).toFixed(2), x3, y, { width: 52, align: 'right' });
        y += 18;
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 48;
        }
      }
      doc.moveDown(1);
      doc.fontSize(8).fillColor('#666666').text('Roll-up matches Accounting → Settlement / P&L by load.', 48, doc.y);
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

/** Driver settlement — one QBO driver vendor, all loads with revenue / expenses / net (Always Track–style). */
router.get('/api/pdf/driver-settlement/:vendorId', async (req, res) => {
  if (!getPool()) return res.status(503).send('Database not configured');
  try {
    const vendorId = String(req.params.vendorId || '').trim();
    if (!vendorId) return res.status(400).send('vendor id required');
    const { rows } = await dbQuery(
      `SELECT id, load_number, revenue_amount, status, qbo_driver_vendor_id, qbo_driver_vendor_name
       FROM loads
       WHERE qbo_driver_vendor_id = $1
       ORDER BY load_number`,
      [vendorId]
    );
    if (!rows.length) return res.status(404).send('No loads for this driver vendor');
    const erp = readMaintenanceJson();
    const pct = (() => {
      const n = Number(process.env.DRIVER_SETTLEMENT_PAY_PCT);
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
    })();
    const vendorName = String(rows[0].qbo_driver_vendor_name || '').trim() || vendorId;
    const fn = `Driver-Settlement-${vendorName.replace(/[^\w.-]+/g, '_').slice(0, 40)}.pdf`;

    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'DRIVER SETTLEMENT');
      doc.font('Helvetica').fontSize(10);
      doc.text(`Driver / carrier (QuickBooks vendor): ${vendorName}`, 48, doc.y);
      doc.text(`Vendor ID: ${vendorId}`);
      doc.text(`Statement date: ${new Date().toISOString().slice(0, 10)}`);
      if (pct != null) doc.text(`Suggested pay rule (env): ${(pct * 100).toFixed(0)}% of trip revenue per load.`);
      doc.moveDown(0.8);
      hr(doc, doc.y);
      doc.moveDown(0.5);
      const x0 = 42;
      const x1 = 110;
      const x2 = 200;
      const x3 = 290;
      const x4 = 380;
      const x5 = 470;
      let y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5);
      doc.text('Load #', x0, y);
      doc.text('Status', x1, y, { width: x2 - x1 - 6 });
      doc.text('Revenue', x2, y, { width: x3 - x2 - 6, align: 'right' });
      doc.text('Expenses', x3, y, { width: x4 - x3 - 6, align: 'right' });
      doc.text('Company net', x4, y, { width: x5 - x4 - 6, align: 'right' });
      doc.text('Suggested pay', x5, y, { width: 72, align: 'right' });
      y += 14;
      hr(doc, y);
      y += 6;
      doc.font('Helvetica').fontSize(8.5);
      let sumRev = 0;
      let sumExp = 0;
      let sumNet = 0;
      let sumSug = 0;
      for (const r of rows) {
        const rev = safeNum(r.revenue_amount, 0);
        let exp = 0;
        try {
          const rep = buildSettlementByLoad(erp, r.load_number);
          exp = safeNum(rep.grandTotal, 0);
        } catch {
          exp = 0;
        }
        const net = Math.round((rev - exp) * 100) / 100;
        const sug = pct != null && rev > 0 ? Math.round(rev * pct * 100) / 100 : null;
        sumRev += rev;
        sumExp += exp;
        sumNet += net;
        if (sug != null) sumSug += sug;
        doc.text(String(r.load_number || ''), x0, y);
        doc.text(String(r.status || ''), x1, y, { width: x2 - x1 - 6 });
        doc.text('$' + rev.toFixed(2), x2, y, { width: x3 - x2 - 6, align: 'right' });
        doc.text('$' + exp.toFixed(2), x3, y, { width: x4 - x3 - 6, align: 'right' });
        doc.text('$' + net.toFixed(2), x4, y, { width: x5 - x4 - 6, align: 'right' });
        doc.text(sug != null ? '$' + sug.toFixed(2) : '—', x5, y, { width: 72, align: 'right' });
        y += 16;
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 48;
        }
      }
      y += 4;
      hr(doc, y);
      y += 8;
      doc.font('Helvetica-Bold');
      doc.text('Totals', x0, y);
      doc.text('', x1, y);
      doc.text('$' + sumRev.toFixed(2), x2, y, { width: x3 - x2 - 6, align: 'right' });
      doc.text('$' + sumExp.toFixed(2), x3, y, { width: x4 - x3 - 6, align: 'right' });
      doc.text('$' + sumNet.toFixed(2), x4, y, { width: x5 - x4 - 6, align: 'right' });
      doc.text(pct != null ? '$' + sumSug.toFixed(2) : '—', x5, y, { width: 72, align: 'right' });
      doc.moveDown(2);
      doc.font('Helvetica').fontSize(8).fillColor('#666666').text('Expense roll-up uses the same rules as Accounting → Driver pay settlements.', 48, doc.y, {
        width: doc.page.width - 96
      });
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

router.get('/api/pdf/maintenance-record/:id', (req, res) => {
  try {
    const erp = readMaintenanceJson();
    const rec = (erp.records || []).find(r => String(r.id) === String(req.params.id));
    if (!rec) return res.status(404).send('Record not found');
    const fn = `maintenance-${String(rec.unit || 'unit').replace(/[^\w.-]+/g, '_')}-${String(rec.id).slice(-6)}.pdf`;
    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'MAINTENANCE');
      doc.font('Helvetica').fontSize(11);
      doc.text(`Unit: ${rec.unit || ''}`);
      doc.text(`Record type: ${rec.recordType || ''}`);
      doc.text(`Service: ${rec.serviceType || ''}`);
      doc.text(`Date: ${rec.serviceDate || ''}   Mileage: ${rec.serviceMileage ?? ''}`);
      doc.text(`Vendor: ${rec.vendor || ''}`);
      doc.text(`Vendor invoice #: ${rec.vendorInvoiceNumber || '—'}`);
      doc.text(`Work order #: ${rec.workOrderNumber || '—'}`);
      doc.text(`Load / inv #: ${rec.loadNumber || '—'}`);
      doc.text(`Cost: ${rec.cost ?? ''}`);
      doc.moveDown();
      doc.fontSize(10).text(rec.notes || '', { align: 'left' });
      doc.moveDown();
      doc.fontSize(8).fillColor('#666666').text('IH35 Maintenance');
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

router.get('/api/pdf/ap-transaction/:id', (req, res) => {
  try {
    const erp = readMaintenanceJson();
    const ap = (erp.apTransactions || []).find(a => String(a.id) === String(req.params.id));
    if (!ap) return res.status(404).send('Transaction not found');
    const fn = `expense-${String(ap.docNumber || ap.id).replace(/[^\w.-]+/g, '_')}.pdf`;
    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'EXPENSE');
      doc.font('Helvetica').fontSize(11);
      doc.text(`Type: ${ap.txnType || ''}`);
      doc.text(`Doc #: ${ap.docNumber || '—'}`);
      doc.text(`Date: ${ap.txnDate || ''}   Due: ${ap.dueDate || '—'}`);
      doc.text(`Amount: $${Number(ap.amount || 0).toFixed(2)}`);
      doc.text(`Description: ${ap.description || ''}`);
      doc.text(`Unit: ${ap.assetUnit || ''}`);
      doc.text(`QBO sync: ${ap.qboSyncStatus || '—'}  ${ap.qboEntityType || ''} ${ap.qboEntityId || ''}`);
      doc.moveDown();
      doc.fontSize(8).fillColor('#666666').text('Post to QuickBooks from Maintenance if not yet posted.');
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

router.get('/api/pdf/work-order/:id', (req, res) => {
  try {
    const erp = readMaintenanceJson();
    const wo = (erp.workOrders || []).find(w => String(w.id) === String(req.params.id));
    if (!wo) return res.status(404).send('Work order not found');
    const lines = wo.lines || [];
    const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const fn = `work-order-${String(wo.unit || 'unit').replace(/[^\w.-]+/g, '_')}-${String(wo.id).slice(-6)}.pdf`;
    sendPdf(res, fn, doc => {
      drawHeaderBand(doc, 'WORK ORDER');
      doc.font('Helvetica').fontSize(11);
      doc.text(`Unit: ${wo.unit || ''}`);
      doc.text(`Txn type: ${wo.txnType || ''}   Date: ${wo.serviceDate || ''}`);
      doc.text(`Load / inv (settlement): ${wo.loadNumber || '—'}`);
      doc.text(`Vendor invoice #: ${wo.vendorInvoiceNumber || '—'}`);
      doc.text(`Shop / internal WO #: ${wo.internalWorkOrderNumber || '—'}`);
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(10).text('Lines');
      doc.font('Helvetica').fontSize(10);
      lines.forEach((ln, i) => {
        doc.text(`${i + 1}. ${ln.serviceType || ''}  $${Number(ln.amount || 0).toFixed(2)}  (${ln.detailMode || ''})`);
      });
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(11).text(`Total: $${total.toFixed(2)}`);
      doc.moveDown();
      doc.fontSize(8).fillColor('#666666').text(wo.notes || '');
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

export default router;
