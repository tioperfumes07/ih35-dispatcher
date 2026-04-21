import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { formatIsoDateShortPlain } from '../lib/format-iso-date-short-plain.mjs';
import { readFullErpJson } from '../lib/read-erp.mjs';
import { buildDotAuditJson } from '../lib/dot-audit-build.mjs';
import { buildDotVehicleAuditV1 } from '../lib/dot-vehicle-audit-api.mjs';

const router = Router();

const FOOTER = 'Confidential — IH 35 Transportation LLC';

function sliceIso(v) {
  const s = String(v || '').trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function pdfDateCell(v) {
  return formatIsoDateShortPlain(sliceIso(v));
}

function writeSectionPage(doc, title, yStart = 60) {
  doc.addPage();
  let y = yStart;
  doc.fontSize(14).fillColor('#111').text(title, 48, y, { width: 520 });
  y += 28;
  return y;
}

/** Renders all rows; adds pages when y exceeds page body. */
function drawTable(doc, startY, headers, rows, colWidths) {
  let y = startY;
  const x0 = 48;
  const x1 = 520;
  doc.fontSize(9).fillColor('#333');
  let x = x0;
  for (let i = 0; i < headers.length; i++) {
    doc.text(String(headers[i] ?? ''), x, y, { width: colWidths[i] });
    x += colWidths[i];
  }
  y += 14;
  doc.moveTo(x0, y).lineTo(x1, y).strokeColor('#cccccc').stroke();
  y += 8;
  for (const row of rows) {
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

function drawSubheading(doc, y, text) {
  doc.fontSize(11).fillColor('#0f172a').text(text, 48, y, { width: 520 });
  return y + 18;
}

function overallLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'compliant') return 'COMPLIANT — Ready for audit';
  if (s === 'attention') return 'ATTENTION NEEDED — Review flagged items';
  if (s === 'non_compliant') return 'NON-COMPLIANT — Corrective action required';
  return String(status || '—');
}

function drawComplianceMatrix(doc, startY, cc) {
  let y = startY;
  const rows = [
    [
      'Annual inspection current (≤ 12 months)',
      cc.annual_inspection_current ? 'PASS' : 'FAIL',
      pdfDateCell(cc.annual_inspection_date)
    ],
    ['PM schedule vs. odometer', cc.pm_schedule_current ? 'PASS' : 'FAIL', '—'],
    [
      'Vehicle registration current',
      cc.registration_current ? 'PASS' : 'FAIL',
      pdfDateCell(cc.registration_expiry)
    ],
    ['No open DVIR defects (uncorrected)', cc.no_open_violations ? 'PASS' : 'FAIL', '—'],
    ['DVIR records on file (period / Samsara)', cc.dvir_on_file_90_days ? 'PASS' : 'FAIL', '—'],
    ['No out-of-service events', cc.no_oos_events ? 'PASS' : 'FAIL', '—']
  ];
  y = drawTable(doc, y, ['Control', 'Status', 'Notes / dates'], rows, [240, 56, 200]);
  if (cc.dvir_note) {
    if (y > 680) {
      doc.addPage();
      y = 60;
    }
    doc.fontSize(8).fillColor('#666').text(`DVIR data source: ${cc.dvir_note}`, 48, y, { width: 480 });
    y += 28;
  }
  return y;
}

/** Part 4 subsection codes (4A = chronological register; 4A–4H = ERP buckets; 4I = service locations). */
const BUCKET_DEFS = [
  ['section4_pm_service', '4A — PM service history'],
  ['section4_maintenance', '4B — Maintenance history'],
  ['section4_repair', '4C — Repair history'],
  ['section4_tire', '4D — Tire service history'],
  ['section4_air_bag', '4E — Air bag service history'],
  ['section4_battery', '4F — Battery service history'],
  ['section4_body', '4G — Body work history'],
  ['section4_inspection', '4H — Inspection history (non-annual)'],
  ['section4_other', 'Other — Uncategorized work orders']
];

router.get('/api/reports/dot-audit/:unit', (req, res) => {
  try {
    const erp = readFullErpJson();
    const unit = String(req.params.unit || '').trim();
    if (!unit) return res.status(400).json({ ok: false, error: 'unit required' });
    const cp = erp.companyProfile && typeof erp.companyProfile === 'object' ? erp.companyProfile : {};
    const data = buildDotAuditJson(erp, unit, req.query.startDate, req.query.endDate, cp, { ...req.query });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

async function streamDotAuditPdf(res, unit, startDate, endDate, filterQuery = {}) {
  try {
    const erp = readFullErpJson();
    const cp = erp.companyProfile && typeof erp.companyProfile === 'object' ? erp.companyProfile : {};
    const audit = await buildDotVehicleAuditV1(erp, unit, startDate, endDate, cp, filterQuery);
    const s = audit.sections || {};
    const cc = audit.compliance_checklist || {};
    const legal = String(cp.legalName || 'IH 35 Transportation LLC').trim();
    const safeFile = unit.replace(/[^\w.-]+/g, '_') || 'unit';
    const filt = audit.filters || {};
    const periodStart = sliceIso(filt.startDate) || '(all)';
    const periodEnd = sliceIso(filt.endDate) || '(all)';

    const doc = new PDFDocument({ margin: 48, size: 'LETTER', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="DOT_Audit_${safeFile}_${sliceIso(startDate)}_${sliceIso(endDate)}.pdf"`
    );
    doc.pipe(res);

    const vi = s.vehicle_info || {};

    // Cover
    doc.fontSize(22).fillColor('#0f172a').text('DOT Compliance File', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(16).text(`Unit ${unit}`, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(11).fillColor('#444').text(legal, { align: 'center' });
    doc.text(`USDOT ${cp.usdotNumber || '—'} · MC ${cp.mcNumber || '—'}`, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(10).text(`Generated ${pdfDateCell(audit.generatedAt)}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#1557a0').text('PREPARED FOR: DOT AUDIT REVIEW (multi-part vehicle file)', { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(10).fillColor('#111').text(`Period: ${pdfDateCell(periodStart)} → ${pdfDateCell(periodEnd)}`, { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(12).text('Table of contents', { underline: true });
    doc.moveDown(0.5);
    [
      'Part 1 — Vehicle identification & registration context',
      'Part 2 — Annual inspection history',
      'Part 3 — Preventive maintenance history',
      'Part 4 — Repair & maintenance (4A register; 4A–4H by category; 4I service locations)',
      'Part 5 — Accident / incident history',
      'Part 6 — DVIR (Samsara live, when configured)',
      'Part 7 — Out of service history',
      'Part 8 — Tire records',
      'Part 9 — Compliance control matrix & sign-off block'
    ].forEach(t => {
      doc.fontSize(10).text(t, { indent: 12 });
    });

    let y = writeSectionPage(doc, 'Part 1 — Vehicle identification');
    doc.fontSize(10).fillColor('#111');
    doc.text(`Unit number: ${vi.unitNumber || unit}`);
    doc.text(`VIN: ${vi.vin || '—'}`);
    doc.text(`YMM: ${vi.ymm || '—'}`);
    doc.text(`License plate: ${vi.plate || '—'}`);
    doc.text(`GVWR / class: ${vi.gvwr || '—'}  ${vi.vehicleType || ''}`);
    doc.text(`Registration (if recorded): ${pdfDateCell(vi.registrationExp)}`);
    doc.text(`USDOT: ${cp.usdotNumber || '—'}  MC: ${cp.mcNumber || '—'}`);
    doc.text(`Legal name: ${legal}`);

    y = writeSectionPage(doc, 'Part 2 — Annual inspection history');
    drawTable(
      doc,
      y,
      ['Date', 'Vendor / inspector', 'Type', 'WO', 'Notes'],
      (s.annual_inspections || []).map(r => [pdfDateCell(r.date), r.inspector, r.type, r.wo, r.defects || r.notes || '']),
      [64, 120, 100, 72, 140]
    );

    y = writeSectionPage(doc, 'Part 3 — Preventive maintenance');
    drawTable(
      doc,
      y,
      ['Date', 'Miles', 'Service', 'Vendor', 'WO', '$'],
      (s.pm_history || []).map(r => [pdfDateCell(r.date), r.mileage, r.service, r.vendor, r.wo, r.cost]),
      [64, 52, 120, 100, 72, 52]
    );

    y = writeSectionPage(doc, 'Part 4 — Repair & maintenance documentation');
    doc
      .fontSize(10)
      .fillColor('#333')
      .text(
        'Summary register of all work orders in period (ERP). Following pages break the same population by maintenance category and by service location.',
        48,
        y,
        { width: 500 }
      );
    y = doc.y + 16;
    y = drawSubheading(doc, y, '4A — Chronological repair / service register');
    drawTable(
      doc,
      y,
      ['Date', 'WO', 'Service type', 'Vendor', '$', 'Description (trimmed)'],
      (s.repair_history || []).map(r => [
        pdfDateCell(r.date),
        r.wo,
        r.serviceType,
        r.vendor,
        r.cost,
        String(r.description || '').slice(0, 80)
      ]),
      [56, 64, 100, 92, 44, 140]
    );

    y = writeSectionPage(doc, 'Part 4 (continued) — Work by category');
    doc.fontSize(9).fillColor('#555').text('Each subsection lists work orders classified from ERP line items and service types.', 48, y, { width: 500 });
    y += 36;
    const skipBuckets = audit.meta && audit.meta.dotPdfSkipBuckets;
    for (const [key, label] of BUCKET_DEFS) {
      if (skipBuckets) break;
      const rows = s[key] || [];
      if (y > 720) {
        doc.addPage();
        y = 60;
      }
      y = drawSubheading(doc, y, label);
      if (!rows.length) {
        doc.fontSize(9).fillColor('#666').text('No records in this period.', 48, y, { width: 480 });
        y += 22;
        continue;
      }
      y = drawTable(
        doc,
        y,
        ['Date', 'WO', 'Service type', 'Vendor', '$', 'Description'],
        rows.map(r => [pdfDateCell(r.date), r.wo, r.serviceType, r.vendor, r.cost, String(r.description || '').slice(0, 72)]),
        [56, 56, 92, 88, 40, 152]
      );
    }

    y = writeSectionPage(doc, 'Part 4 (continued) — Service locations & spend profile');
    y = drawSubheading(doc, y, '4I — Service locations (by site) & spend mix');
    const locSum = s.section4_location_summary || {};
    doc.fontSize(10).fillColor('#111').text('Internal vs. external vs. roadside (work orders in period)', 48, y, { width: 500 });
    y += 20;
    doc.fontSize(10).text(
      `Spend mix — Internal: ${locSum.pct_internal ?? '—'}% · External: ${locSum.pct_external ?? '—'}% · Roadside: ${locSum.pct_roadside ?? '—'}%`,
      48,
      y,
      { width: 500 }
    );
    y += 18;
    doc.fontSize(9).fillColor('#555').text(
      `Visit mix (records) — Internal: ${locSum.pct_internal_records ?? '—'}% · External: ${locSum.pct_external_records ?? '—'}% · Roadside: ${locSum.pct_roadside_records ?? '—'}%`,
      48,
      y,
      { width: 500 }
    );
    y += 28;
    const locs = s.section4i_service_locations || [];
    if (!locs.length) {
      doc.fontSize(10).text('No location grouping available for this period.');
    } else {
      for (const block of locs) {
        if (y > 700) {
          doc.addPage();
          y = 60;
        }
        y = drawSubheading(doc, y, `4I — ${block.locationName || '—'} (${block.locationType || 'type n/a'})`);
        const recs = block.records || [];
        if (!recs.length) {
          doc.fontSize(9).text('No detail rows.', 48, y);
          y += 18;
          continue;
        }
        y = drawTable(
          doc,
          y,
          ['Date', 'Primary service', '$'],
          recs.map(r => [pdfDateCell(r.date), r.service, r.cost]),
          [80, 280, 72]
        );
      }
    }

    y = writeSectionPage(doc, 'Part 5 — Accident / incident history');
    const acc = s.accident_history || [];
    if (!acc.length) {
      doc.fontSize(10).text('No accidents or collision-coded work orders on record for this vehicle in the specified period.');
    } else {
      drawTable(
        doc,
        y,
        ['Date', 'Location', 'Police #', 'DOT rep.', 'Fault', '$ est', 'Corrective / notes'],
        acc.map(r => [
          pdfDateCell(r.date),
          r.location,
          r.policeReport,
          r.dotReportable,
          r.fault,
          r.estDamage,
          String(r.corrective || '').slice(0, 40)
        ]),
        [52, 88, 56, 44, 44, 44, 160]
      );
    }

    y = writeSectionPage(doc, 'Part 6 — DVIR history (Samsara)');
    const dvir = s.dvir_history || [];
    if (!dvir.length) {
      doc
        .fontSize(10)
        .text(
          cc.dvir_note
            ? `No DVIR rows returned for this unit/period. (${cc.dvir_note})`
            : 'No DVIR rows for this unit in the selected period. Configure Samsara read token and vehicle name match for live inspections.',
          48,
          y,
          { width: 500 }
        );
    } else {
      drawTable(
        doc,
        y,
        ['Date / time', 'Driver', 'Type', 'Def?', 'Defect summary', 'Corr.', 'Mechanic'],
        dvir.map(r => [
          pdfDateCell(r.date),
          r.driver,
          r.type,
          r.defects_found,
          String(r.defect_description || '').slice(0, 48),
          r.corrected,
          String(r.mechanic || '').slice(0, 20)
        ]),
        [100, 72, 56, 28, 120, 36, 72]
      );
    }

    y = writeSectionPage(doc, 'Part 7 — Out of service history');
    const oos = s.out_of_service || [];
    if (!oos.length) {
      doc.fontSize(10).text('No out-of-service events recorded for this vehicle in ERP for this period.');
    } else {
      drawTable(doc, y, ['Date', 'Detail'], oos.map(r => [pdfDateCell(r.date || r.startDate), JSON.stringify(r).slice(0, 120)]), [80, 380]);
    }

    y = writeSectionPage(doc, 'Part 8 — Tire records');
    drawTable(
      doc,
      y,
      ['Date', 'Pos', 'Brand', 'Part', 'Miles', '$', 'Reason'],
      (s.tire_records || []).map(r => [
        pdfDateCell(r.date),
        r.position,
        r.brand,
        r.partNumber,
        r.mileage,
        r.cost,
        String(r.reason || '').slice(0, 24)
      ]),
      [52, 40, 72, 72, 48, 44, 160]
    );

    y = writeSectionPage(doc, 'Part 9 — Compliance control matrix');
    doc.fontSize(12).fillColor('#111').text(`Overall: ${overallLabel(cc.overall_status)}`, 48, y, { width: 500 });
    y += 24;
    y = drawComplianceMatrix(doc, y, cc);
    if (y > 640) {
      doc.addPage();
      y = 60;
    }
    doc.moveDown(1);
    doc.fontSize(10).fillColor('#111').text('Auditor / safety manager sign-off', 48, y);
    y += 20;
    doc.fontSize(9).fillColor('#444');
    doc.text('Name: ________________________________   Date: _______________', 48, y);
    y += 28;
    doc.text('Carrier representative: ________________________________', 48, y);
    y += 36;
    if (audit.meta?.disclaimer) {
      doc.fontSize(8).fillColor('#666').text(String(audit.meta.disclaimer), 48, y, { width: 500 });
    }

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

router.get('/api/reports/dot-audit/:unit/pdf', async (req, res) => {
  const unit = String(req.params.unit || '').trim();
  if (!unit) return res.status(400).send('unit required');
  await streamDotAuditPdf(res, unit, req.query.startDate, req.query.endDate, { ...req.query });
});

router.post('/api/reports/export/dot-audit-pdf', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const unit = String(body.unitId || body.unit || '').trim();
  if (!unit) return res.status(400).send('unitId required');
  const filterRest = { ...body };
  delete filterRest.unitId;
  delete filterRest.unit;
  delete filterRest.startDate;
  delete filterRest.endDate;
  await streamDotAuditPdf(res, unit, body.startDate, body.endDate, filterRest);
});

export default router;
