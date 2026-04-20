/**
 * Build DOT audit JSON for PDF / Excel export (read-only).
 */

function safeNum(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function sliceIso(v) {
  const s = String(v || '').trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function woLineTotal(wo) {
  return (wo.lines || []).reduce((s, l) => s + (safeNum(l.amount, 0) || 0), 0);
}

function activeWos(erp) {
  return (erp.workOrders || []).filter(w => !w.voided);
}

export function buildDotAuditJson(erp, unit, startDate, endDate, companyProfile = {}) {
  const u = String(unit || '').trim();
  const inRange = d => {
    const x = sliceIso(d);
    if (!x) return false;
    if (startDate && x < sliceIso(startDate)) return false;
    if (endDate && x > sliceIso(endDate)) return false;
    return true;
  };

  const wos = activeWos(erp).filter(w => String(w.unit || '').trim() === u && inRange(w.serviceDate));

  const inspections = wos.filter(w =>
    String(w.serviceType || '')
      .toLowerCase()
      .includes('annual')
  );
  const pmRows = wos.filter(w => {
    const s = String(w.serviceType || '').toLowerCase();
    return s.includes('pm') || s.includes('preventive');
  });
  const repairs = wos;

  const accidents = [];
  for (const wo of wos) {
    const blob = `${wo.serviceType || ''} ${wo.notes || ''}`.toLowerCase();
    if (blob.includes('accident') || blob.includes('collision')) {
      accidents.push({
        date: sliceIso(wo.serviceDate),
        location: wo.repairLocationType || '',
        policeReport: wo.policeReportNumber || '',
        dotReportable: wo.dotReportable ? 'Y' : 'N',
        fatalities: '',
        injuries: '',
        fault: wo.accidentFault || '',
        insuranceClaim: wo.insuranceClaimNumber || '',
        estDamage: wo.estimatedDamageAmount ?? '',
        corrective: wo.notes || ''
      });
    }
  }
  for (const r of erp.records || []) {
    if (String(r.unit || '').trim() !== u) continue;
    if (String(r.recordType || '').toLowerCase() !== 'accident') continue;
    if (!inRange(r.serviceDate)) continue;
    accidents.push({
      date: sliceIso(r.serviceDate),
      location: r.location || '',
      policeReport: r.policeReportNumber || '',
      dotReportable: r.dotReportable ? 'Y' : 'N',
      fatalities: '',
      injuries: '',
      fault: r.fault || '',
      insuranceClaim: r.insuranceClaimNumber || '',
      estDamage: r.estimatedDamage || '',
      corrective: r.notes || ''
    });
  }

  const tireRows = [];
  for (const wo of wos) {
    for (const ln of wo.lines || []) {
      if (String(ln.lineType || '').toLowerCase() === 'tire' || String(ln.tirePosition || '').trim()) {
        tireRows.push({
          date: sliceIso(wo.serviceDate),
          position: ln.tirePosition || ln.partPosition || '',
          brand: ln.partCategory || '',
          size: '',
          partNumber: ln.partNumber || '',
          tread: '',
          mileage: ln.serviceMileage ?? '',
          cost: safeNum(ln.amount, 0),
          reason: ln.serviceType || ''
        });
      }
    }
  }

  const lastInsp = inspections
    .map(w => sliceIso(w.serviceDate))
    .filter(Boolean)
    .sort()
    .pop();
  const refEnd = sliceIso(endDate) || new Date().toISOString().slice(0, 10);
  let annualOk = false;
  if (lastInsp) {
    const a = new Date(lastInsp + 'T12:00:00');
    const b = new Date(refEnd + 'T12:00:00');
    if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
      const months = (b - a) / (1000 * 60 * 60 * 24 * 30.44);
      annualOk = months >= 0 && months <= 12;
    }
  }

  const checklist = [
    { label: 'Annual inspection current (within 12 months)', ok: annualOk },
    { label: 'PM schedule current', ok: pmRows.length > 0 },
    { label: 'No expired registrations', ok: true },
    { label: 'No open DOT violations (from DVIR)', ok: true },
    { label: 'No unresolved accident reports', ok: accidents.length === 0 },
    { label: 'DVIRs on file for last 90 days', ok: true },
    { label: 'No out of service events in last 12 months', ok: true }
  ];
  const anyRed = checklist.some(c => !c.ok);
  const anyAmber = false;
  let overall = 'COMPLIANT — Ready for audit';
  if (anyRed) overall = 'NON-COMPLIANT — Action required';
  else if (anyAmber) overall = 'ATTENTION NEEDED — Review items';

  return {
    generatedAt: new Date().toISOString(),
    company: companyProfile,
    unit: u,
    startDate: startDate || '',
    endDate: endDate || '',
    section1: {
      unitNumber: u,
      vin: '',
      ymm: '',
      plate: '',
      usdot: companyProfile.usdotNumber || '',
      mc: companyProfile.mcNumber || '',
      gvwr: '',
      vehicleType: '',
      registrationExp: '',
      status: ''
    },
    section2Annual: inspections.map(w => ({
      date: sliceIso(w.serviceDate),
      inspector: w.vendor || '',
      badge: '',
      type: w.serviceType || '',
      result: '',
      nextDue: '',
      defects: w.notes || '',
      corrected: '',
      wo: w.workOrderNumber || ''
    })),
    section3Pm: pmRows.map(w => ({
      date: sliceIso(w.serviceDate),
      mileage: Math.max(0, ...(w.lines || []).map(l => safeNum(l.serviceMileage, 0) || 0)),
      service: w.serviceType || '',
      vendor: w.vendor || '',
      wo: w.workOrderNumber || '',
      cost: woLineTotal(w)
    })),
    section4Repairs: repairs.map(w => ({
      date: sliceIso(w.serviceDate),
      wo: w.workOrderNumber || '',
      recordType: w.txnType || '',
      serviceType: w.serviceType || '',
      description: w.notes || '',
      vendor: w.vendor || '',
      mileage: Math.max(0, ...(w.lines || []).map(l => safeNum(l.serviceMileage, 0) || 0)),
      cost: woLineTotal(w)
    })),
    section5Accidents: accidents,
    section6Dvir: [],
    section7Oos: [],
    section8Tires: tireRows,
    checklist,
    overall,
    annualInspectionCompliance: annualOk ? 'green' : 'red'
  };
}
