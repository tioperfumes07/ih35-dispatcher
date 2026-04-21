export const INTEGRITY_LIMITS = {
  maxServiceRecordsPerUnit60d: 6,
  maxTireReplacementsPerUnit60d: 4,
  maxAccidentsPerUnit365d: 3,
};

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isWithinDays(inputDate, days) {
  if (!inputDate) return false;

  const now = new Date();
  const dt = new Date(inputDate);

  if (Number.isNaN(dt.getTime())) return false;

  const diffMs = now.getTime() - dt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return diffDays >= 0 && diffDays <= days;
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
    alerts.push({
      type: 'service-frequency',
      severity: 'warning',
      message: `High service frequency in last 60 days: ${recentServiceCount}`,
    });
  }

  if (recentTireCount > limits.maxTireReplacementsPerUnit60d) {
    alerts.push({
      type: 'tire-frequency',
      severity: 'warning',
      message: `High tire replacement frequency in last 60 days: ${recentTireCount}`,
    });
  }

  if (recentAccidentCount > limits.maxAccidentsPerUnit365d) {
    alerts.push({
      type: 'accident-frequency',
      severity: 'warning',
      message: `High accident frequency in last 365 days: ${recentAccidentCount}`,
    });
  }

  const odometer = Number(unit.odometer || 0);
  const lastServiceMileage = Number(unit.lastServiceMileage || 0);
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
    summaries,
  };
}

export default {
  INTEGRITY_LIMITS,
  summarizeUnitIntegrity,
  summarizeFleetIntegrity,
};
