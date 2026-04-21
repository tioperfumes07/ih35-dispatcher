export const INTEGRITY_LIMITS = {
  maxServiceRecordsPerUnit60d: 6,
  maxTireReplacementsPerUnit60d: 4,
  maxAccidentsPerUnit365d: 3,
};

export function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function isWithinDays(inputDate, days) {
  if (!inputDate) return false;

  const now = new Date();
  const dt = new Date(inputDate);

  if (Number.isNaN(dt.getTime())) return false;

  const diffMs = now.getTime() - dt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return diffDays >= 0 && diffDays <= days;
}

export function alertCategory(alert = {}) {
  if (typeof alert === 'string') {
    const text = alert.toLowerCase();

    if (text.includes('tire')) return 'tire';
    if (text.includes('accident')) return 'accident';
    if (text.includes('service')) return 'service';
    if (text.includes('repair')) return 'repair';
    if (text.includes('inspection')) return 'inspection';

    return 'general';
  }

  const type = String(alert.type || '').toLowerCase();
  const category = String(alert.category || '').toLowerCase();
  const message = String(alert.message || '').toLowerCase();

  const combined = `${type} ${category} ${message}`;

  if (combined.includes('tire')) return 'tire';
  if (combined.includes('accident')) return 'accident';
  if (combined.includes('service')) return 'service';
  if (combined.includes('repair')) return 'repair';
  if (combined.includes('inspection')) return 'inspection';

  return category || type || 'general';
}

export function buildAlert(input = {}) {
  return {
    type: input.type || 'general',
    category: input.category || alertCategory(input),
    severity: input.severity || 'warning',
    message: input.message || '',
    unitNumber: input.unitNumber || input.unit || null,
    createdAt: input.createdAt || new Date().toISOString(),
    ...input,
  };
}

export function summarizeUnitIntegrity(unit = {}, options = {}) {
  const limits = {
    ...INTEGRITY_LIMITS,
    ...options,
  };

  const serviceRecords = Array.isArray(unit.serviceRecords) ? unit.serviceRecords : [];
  const tireRecords = Array.isArray(unit.tireRecords) ? unit.tireRecords : [];
  const accidentRecords = Array.isArray(unit.accidentRecords) ? unit.accidentRecords : [];

  const recentServiceCount = serviceRecords.filter((r) => isWithinDays(r.date, 60)).length;
  const recentTireCount = tireRecords.filter((r) => isWithinDays(r.date, 60)).length;
  const recentAccidentCount = accidentRecords.filter((r) => isWithinDays(r.date, 365)).length;

  const alerts = [];

  if (recentServiceCount > limits.maxServiceRecordsPerUnit60d) {
    alerts.push(buildAlert({
      type: 'service-frequency',
      category: 'service',
      severity: 'warning',
      unitNumber: unit.unitNumber || unit.unit || 'UNKNOWN',
      message: `High service frequency in last 60 days: ${recentServiceCount}`,
    }));
  }

  if (recentTireCount > limits.maxTireReplacementsPerUnit60d) {
    alerts.push(buildAlert({
      type: 'tire-frequency',
      category: 'tire',
      severity: 'warning',
      unitNumber: unit.unitNumber || unit.unit || 'UNKNOWN',
      message: `High tire replacement frequency in last 60 days: ${recentTireCount}`,
    }));
  }

  if (recentAccidentCount > limits.maxAccidentsPerUnit365d) {
    alerts.push(buildAlert({
      type: 'accident-frequency',
      category: 'accident',
      severity: 'warning',
      unitNumber: unit.unitNumber || unit.unit || 'UNKNOWN',
      message: `High accident frequency in last 365 days: ${recentAccidentCount}`,
    }));
  }

  const odometer = toNumber(unit.odometer, 0);
  const lastServiceMileage = toNumber(unit.lastServiceMileage, 0);
  const milesSinceService = Math.max(0, odometer - lastServiceMileage);

  return {
    unitNumber: unit.unitNumber || unit.unit || 'UNKNOWN',
    recentServiceCount,
    recentTireCount,
    recentAccidentCount,
    milesSinceService,
    alerts,
    ok: alerts.length === 0,
  };
}

export function summarizeFleetIntegrity(units = [], options = {}) {
  const safeUnits = Array.isArray(units) ? units : [];
  const summaries = safeUnits.map((unit) => summarizeUnitIntegrity(unit, options));

  return {
    totalUnits: summaries.length,
    unitsWithAlerts: summaries.filter((u) => !u.ok).length,
    alerts: summaries.flatMap((u) => u.alerts || []),
    summaries,
  };
}

export function evaluateIntegrity(units = [], options = {}) {
  return summarizeFleetIntegrity(units, options);
}

export default {
  INTEGRITY_LIMITS,
  toNumber,
  isWithinDays,
  alertCategory,
  buildAlert,
  summarizeUnitIntegrity,
  summarizeFleetIntegrity,
  evaluateIntegrity,
};

export function compareIntegrityAlertsDesc(a, b) {
  const da = new Date(a?.triggeredDate || a?.createdAt || 0).getTime();
  const db = new Date(b?.triggeredDate || b?.createdAt || 0).getTime();
  return db - da;
}

export function effectiveIntegrityAlertCategory(alert = {}) {
  return alert.category || alertCategory(alert);
}

export function buildInvestigateRecords(alert = {}, erp = {}) {
  return {
    alert,
    relatedRecords: [],
    erpSnapshot: erp || {},
    generatedAt: new Date().toISOString()
  };
}
