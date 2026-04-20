import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { readFullErpJson } from '../lib/read-erp.mjs';
import { buildDotAuditJson } from '../lib/dot-audit-build.mjs';

const router = Router();

const FOOTER = 'Confidential — IH 35 Transportation LLC';

function sliceIso(v) {
  const s = String(v || '').trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function writeSectionPage(doc, title, yStart = 60) {
  doc.addPage();
  let y = yStart;
  doc.fontSize(14).fillColor('#111').text(title, 48, y, { width: 520 });
  y += 28;
  return y;
}

function drawTable(doc, startY, headers, rows, colWidths) {
  let y = startY;
  const x0 = 48;
  doc.fontSize(9).fillColor('#333');
  let x = x0;
  for (let i = 0; i < headers.length; i++) {
    doc.text(String(headers[i] ?? ''), x, y, { width: colWidths[i] });
    x += colWidths[i];
  }
  y += 14;
  doc.moveTo(x0, y).lineTo(520, y).strokeColor('#cccccc').stroke();
  y += 8;
  for (const row of rows.slice(0, 45)) {
    if (y > 700) {
      doc.addPage();
      y = 60;
    }
    x = x0;
    for (let i = 0; i < row.length; i++) {
      doc.text(String(row[i] ?? ''), x, y, { width: colWidths[i], ellipsis: true });
      x += colWidths[i];
    }
    y += 12;
  }
  return y + 10;
}

router.get('/api/reports/dot-audit/:unit', (req, res) => {
  try {
    const erp = readFullErpJson();
    const unit = String(req.params.unit || '').trim();
    if (!unit) return res.status(400).json({ ok: false, error: 'unit required' });
    const cp = erp.companyProfile && typeof erp.companyProfile === 'object' ? erp.companyProfile : {};
    const data = buildDotAuditJson(erp, unit, req.query.startDate, req.query.endDate, cp);
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

function streamDotAuditPdf(res, unit, startDate, endDate) {
  try {
    const erp = readFullErpJson();
    const cp = erp.companyProfile && typeof erp.companyProfile === 'object' ? erp.companyProfile : {};
    const d = buildDotAuditJson(erp, unit, startDate, endDate, cp);
    const legal = String(cp.legalName || 'IH 35 Transportation LLC').trim();
    const safeFile = unit.replace(/[^\w.-]+/g, '_') || 'unit';

    const doc = new PDFDocument({ margin: 48, size: 'LETTER', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DOT_Audit_${safeFile}_${sliceIso(startDate)}_${sliceIso(endDate)}.pdf"`);
    doc.pipe(res);

    // Cover
    doc.fontSize(22).fillColor('#0f172a').text('DOT Compliance File', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(16).text(`Unit ${unit}`, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(11).fillColor('#444').text(legal, { align: 'center' });
    doc.text(`USDOT ${cp.usdotNumber || '—'} · MC ${cp.mcNumber || '—'}`, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(10).text(`Generated ${sliceIso(d.generatedAt) || ''}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#1557a0').text('PREPARED FOR: DOT AUDIT REVIEW', { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(10).fillColor('#111').text(`Period: ${d.startDate || '(all)'} → ${d.endDate || '(all)'}`, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(12).text('Table of contents', { underline: true });
    doc.moveDown(0.5);
    [
      '1. Vehicle identification',
      '2. Annual inspection history',
      '3. Preventive maintenance',
      '4. Repair history',
      '5. Accident history',
      '6. DVIR (Samsara — connect for detail)',
      '7. Out of service history',
      '8. Tire records',
      '9. Compliance checklist'
    ].forEach(t => {
      doc.fontSize(10).text(t, { indent: 12 });
    });

    let y = writeSectionPage(doc, 'Section 1 — Vehicle identification');
    doc.fontSize(10);
    doc.text(`Unit: ${unit}`);
    doc.text(`USDOT: ${cp.usdotNumber || '—'}`);
    doc.text(`MC: ${cp.mcNumber || '—'}`);
    doc.text(`Legal name: ${legal}`);

    y = writeSectionPage(doc, 'Section 2 — Annual inspection history');
    drawTable(
      doc,
      y,
      ['Date', 'Vendor', 'Type', 'WO'],
      (d.section2Annual || []).map(r => [r.date, r.inspector, r.type, r.wo]),
      [72, 140, 160, 100]
    );

    y = writeSectionPage(doc, 'Section 3 — Preventive maintenance');
    drawTable(
      doc,
      y,
      ['Date', 'Miles', 'Service', 'Vendor', 'WO', '$'],
      (d.section3Pm || []).map(r => [r.date, r.mileage, r.service, r.vendor, r.wo, r.cost]),
      [72, 56, 120, 100, 72, 50]
    );

    y = writeSectionPage(doc, 'Section 4 — Repair history');
    drawTable(
      doc,
      y,
      ['Date', 'WO', 'Type', 'Vendor', '$'],
      (d.section4Repairs || []).map(r => [r.date, r.wo, r.serviceType, r.vendor, r.cost]),
      [72, 80, 120, 160, 60]
    );

    y = writeSectionPage(doc, 'Section 5 — Accident history');
    if (!(d.section5Accidents || []).length) {
      doc.fontSize(10).text('No accidents on record for this vehicle in the specified period.');
    } else {
      drawTable(
        doc,
        y,
        ['Date', 'Location', 'Police #', 'DOT rep.', 'Fault', '$ est'],
        (d.section5Accidents || []).map(r => [
          r.date,
          r.location,
          r.policeReport,
          r.dotReportable,
          r.fault,
          r.estDamage
        ]),
        [60, 100, 70, 50, 60, 50]
      );
    }

    y = writeSectionPage(doc, 'Section 6 — DVIR');
    doc
      .fontSize(10)
      .text(
        'DVIR detail is sourced from Samsara when inspection APIs are enabled. This export lists ERP context only.'
      );

    y = writeSectionPage(doc, 'Section 7 — Out of service history');
    doc.fontSize(10).text('No out of service events recorded for this vehicle.');

    y = writeSectionPage(doc, 'Section 8 — Tire records');
    drawTable(
      doc,
      y,
      ['Date', 'Pos', 'Brand', 'Part', 'Miles', '$'],
      (d.section8Tires || []).map(r => [r.date, r.position, r.brand, r.partNumber, r.mileage, r.cost]),
      [60, 50, 80, 80, 56, 50]
    );

    y = writeSectionPage(doc, 'Section 9 — Compliance checklist');
    doc.fontSize(11).fillColor('#111').text(`Overall: ${d.overall}`, { width: 500 });
    doc.moveDown(0.5);
    (d.checklist || []).forEach(c => {
      doc.fontSize(10).fillColor(c.ok ? '#0a7a2d' : '#b00020').text(`${c.ok ? '●' : '○'} ${c.label}`);
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#666').text(`Page ${i - range.start + 1} of ${range.count}`, 48, 740, {
        width: 520,
        align: 'center'
      });
      doc.text(FOOTER, 48, 752, { width: 520, align: 'center' });
    }

    doc.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).send(e.message || String(e));
  }
}

router.get('/api/reports/dot-audit/:unit/pdf', (req, res) => {
  const unit = String(req.params.unit || '').trim();
  if (!unit) return res.status(400).send('unit required');
  streamDotAuditPdf(res, unit, req.query.startDate, req.query.endDate);
});

router.post('/api/reports/export/dot-audit-pdf', (req, res) => {
  const unit = String(req.body?.unitId || req.body?.unit || '').trim();
  if (!unit) return res.status(400).send('unitId required');
  streamDotAuditPdf(res, unit, req.body?.startDate, req.body?.endDate);
});

export default router;
