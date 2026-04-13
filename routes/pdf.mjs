import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { dbQuery, getPool } from '../lib/db.mjs';
import { readMaintenanceJson } from '../lib/read-erp.mjs';

const router = Router();

function sendPdf(res, filename, build) {
  const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  build(doc);
  doc.end();
}

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
    const fn = `load-${String(L.load_number || 'trip').replace(/[^\w.-]+/g, '_')}.pdf`;
    sendPdf(res, fn, doc => {
      doc.fontSize(18).text(`Load ${L.load_number}`, { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11);
      doc.text(`Status: ${L.status || ''}`);
      doc.text(`Invoice / doc #: ${L.load_number || ''}`);
      doc.text(`Customer (TMS): ${L.customer_join_name || '—'}`);
      doc.text(`Driver (TMS): ${L.driver_join_name || '—'}`);
      doc.text(`Truck: ${L.truck_code || '—'}   Trailer: ${L.trailer_code || '—'}`);
      doc.text(`Dates: ${L.start_date || '—'} → ${L.end_date || '—'}`);
      doc.text(`Miles (loaded / empty): ${L.practical_loaded_miles ?? 0} / ${L.practical_empty_miles ?? 0}`);
      if (L.revenue_amount != null && String(L.revenue_amount).trim() !== '') {
        doc.text(`Revenue: $${Number(L.revenue_amount).toFixed(2)}`);
      }
      doc.moveDown();
      doc.fontSize(13).text('Stops', { underline: true });
      doc.fontSize(10);
      for (const s of stops.rows || []) {
        doc.moveDown(0.3);
        doc.text(
          `${s.sequence_order}. [${s.stop_type || ''}] ${s.location_name || ''}`.trim(),
          { continued: false }
        );
        if (s.address) doc.fontSize(9).fillColor('#444444').text(s.address).fillColor('#000000');
        doc.fontSize(10);
        doc.text(
          `  Prac. ${s.practical_miles ?? 0} mi   Short. ${s.shortest_miles ?? 0} mi   Window: ${s.window_text || '—'}`
        );
      }
      doc.moveDown();
      doc.fontSize(8).fillColor('#666666').text('Generated from IH35 TMS — use Print in your PDF viewer for paper copies.');
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
      doc.fontSize(16).text(`Maintenance record`, { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11);
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
      doc.fontSize(8).fillColor('#666666').text('IH35 Maintenance — print from browser PDF viewer.');
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
      doc.fontSize(16).text(`Maintenance expense (local)`, { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11);
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
      doc.fontSize(16).text(`Work order / shop purchase`, { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11);
      doc.text(`Unit: ${wo.unit || ''}`);
      doc.text(`Txn type: ${wo.txnType || ''}   Date: ${wo.serviceDate || ''}`);
      doc.text(`Load / inv (settlement): ${wo.loadNumber || '—'}`);
      doc.text(`Vendor invoice #: ${wo.vendorInvoiceNumber || '—'}`);
      doc.text(`Shop / internal WO #: ${wo.internalWorkOrderNumber || '—'}`);
      doc.moveDown();
      doc.fontSize(12).text('Lines');
      doc.fontSize(10);
      lines.forEach((ln, i) => {
        doc.text(`${i + 1}. ${ln.serviceType || ''}  $${Number(ln.amount || 0).toFixed(2)}  (${ln.detailMode || ''})`);
      });
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Total: $${total.toFixed(2)}`);
      doc.moveDown();
      doc.fontSize(8).fillColor('#666666').text(wo.notes || '');
    });
  } catch (e) {
    res.status(500).send(e.message || 'PDF failed');
  }
});

export default router;
