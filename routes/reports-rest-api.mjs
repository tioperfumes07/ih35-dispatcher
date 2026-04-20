/**
 * Canonical GET /api/reports/... tabular endpoints + QBO proxy + DOT vehicle audit compound JSON.
 * Read-only: delegates to lib/reports-datasets.mjs (ERP JSON + optional Postgres TMS reads).
 */

import {
  buildReportDataset,
  buildServiceLocationsFilterList,
  buildServiceTypesUsedList,
  buildFleetUnitsFilterList
} from '../lib/reports-datasets.mjs';
import { wrapStandardReport } from '../lib/reports-envelope.mjs';
import { flattenQboReportToStandard } from '../lib/qbo-report-flat.mjs';
import {
  buildHosViolationsRows,
  buildDvirRows,
  buildSafetyEventsRows,
  buildHosSummaryFromLogs,
  buildSafetyScoresPlaceholder
} from '../lib/reports-safety-live.mjs';
import { buildDotVehicleAuditV1 } from '../lib/dot-vehicle-audit-api.mjs';

const TABULAR_PATHS = [
  ['maintenance/work-order-history', 'a1-work-order-history'],
  ['maintenance/cost-by-unit', 'a2-cost-by-unit'],
  ['maintenance/cost-by-service-type', 'a3-cost-by-service-type'],
  ['maintenance/pm-schedule', 'a4-pm-schedule'],
  ['maintenance/tire-history', 'a5-tire-history'],
  ['maintenance/air-bag-history', 'a6-air-bag-history'],
  ['maintenance/battery-history', 'a7-battery-history'],
  ['maintenance/accident-history', 'a8-accident-collision'],
  ['maintenance/fleet-repair-summary', 'a9-fleet-repair-monthly'],
  ['maintenance/inspection-history', 'a10-inspection-history'],
  ['maintenance/by-service-type', 'm1-expense-by-service-type'],
  ['maintenance/cost-pivot', 'm2-maintenance-cost-pivot'],
  ['maintenance/repair-vs-maintenance', 'm3-repair-vs-maintenance'],
  ['maintenance/by-location', 'm4-work-by-location'],
  ['maintenance/internal-external', 'm5-internal-external'],
  ['maintenance/location-summary', 'm6-location-summary'],
  ['accounting/expense-history', 'b6-expense-history'],
  ['accounting/bill-history', 'b7-bill-history'],
  ['accounting/fuel-expense-history', 'b8-fuel-expense-history'],
  ['accounting/monthly-summary', 'b9-monthly-expense-summary'],
  ['accounting/vendor-spend', 'b11-vendor-spend'],
  ['accounting/qbo-sync-errors', 'b10-qbo-sync-errors'],
  ['safety/hos-summary', 'c1-driver-hos-summary'],
  ['safety/hos-violations', 'c2-hos-violations'],
  ['safety/safety-scores', 'c4-safety-score-driver'],
  ['safety/dvir', 'c10-dvir'],
  ['safety/driver-qualifications', 'c9-driver-qualification'],
  ['safety/speeding', 'c6-speeding'],
  ['safety/harsh-driving', 'c7-harsh-driving'],
  ['safety/daily-driver-log', 'c3-daily-driver-log'],
  ['safety/safety-scores-fleet', 'c5-safety-score-fleet'],
  ['safety/unassigned-hos', 'c8-unassigned-hos'],
  ['fuel/cost-by-unit', 'd1-fuel-cost-by-unit'],
  ['fuel/cost-by-driver', 'd2-fuel-cost-by-driver'],
  ['fuel/transactions', 'd3-fuel-card-transactions'],
  ['fuel/ifta', 'd4-ifta-mileage'],
  ['fuel/mpg-by-unit', 'd5-mpg-by-unit'],
  ['operations/load-history', 'e1-load-history'],
  ['operations/revenue-by-driver', 'e2-revenue-by-driver'],
  ['operations/revenue-by-customer', 'e3-revenue-by-customer'],
  ['operations/settlement', 'e5-settlement-report'],
  ['operations/activity-summary', 'e6-activity-summary'],
  ['operations/dispatch-summary', 'e4-dispatch-summary'],
  ['operations/fleet-benchmarks', 'e7-fleet-benchmarks'],
  ['dot/fleet-overview', 'f-dot-fleet-overview'],
  ['dot/drug-alcohol-testing', 'g3-drug-alcohol-testing']
];

const QBO_ALLOWED = new Set([
  'ProfitAndLoss',
  'BalanceSheet',
  'CashFlow',
  'AgedPayableDetail',
  'AgedPayableSummary',
  'AgedReceivableDetail',
  'TrialBalance',
  'GeneralLedger',
  'TransactionList',
  'VendorBalance',
  'CustomerBalance',
  'SalesByCustomerSummary',
  'CheckDetail',
  'OpenInvoices',
  'UnpaidBills',
  'ExpensesByVendorSummary',
  'GeneralLedgerDetail',
  'AgedPayables',
  'AgedReceivables',
  'CustomerSales',
  'Check'
]);

const qboReportCache = new Map();

async function loadDbLoads(dbQuery) {
  if (!dbQuery) return [];
  try {
    const { rows } = await dbQuery(
      `SELECT l.load_number, l.status, l.start_date::text AS start_date, l.created_at::text AS created_at,
              l.revenue_amount,
              d.name AS driver_name,
              t.unit_code AS truck_unit,
              c.name AS customer_name,
              (COALESCE(l.practical_loaded_miles,0)+COALESCE(l.practical_empty_miles,0))::numeric AS miles,
              (SELECT ls.location_name FROM load_stops ls WHERE ls.load_id = l.id ORDER BY ls.sequence_order ASC NULLS LAST LIMIT 1) AS origin,
              (SELECT ls2.location_name FROM load_stops ls2 WHERE ls2.load_id = l.id ORDER BY ls2.sequence_order DESC NULLS LAST LIMIT 1) AS destination
       FROM loads l
       LEFT JOIN drivers d ON d.id = l.driver_id
       LEFT JOIN trucks t ON t.id = l.truck_id
       LEFT JOIN customers c ON c.id = l.customer_id
       ORDER BY l.created_at DESC NULLS LAST
       LIMIT 2000`
    );
    return (rows || []).map(r => ({
      load_number: r.load_number,
      status: r.status,
      pickup_date: r.start_date,
      created_at: r.created_at,
      revenue_amount: r.revenue_amount,
      driver_name: r.driver_name,
      truck_unit: r.truck_unit,
      customer_name: r.customer_name,
      miles: r.miles,
      origin: r.origin,
      destination: r.destination
    }));
  } catch {
    return [];
  }
}

async function enrichSamsara(datasetId, query, samsaraConnected) {
  const samsara = {};
  if (!samsaraConnected) return { samsara };
  try {
    if (datasetId === 'c1-driver-hos-summary') {
      const r = await buildHosSummaryFromLogs(query);
      samsara.hosSummary = r.rows;
      if (r.error) samsara.hosSummaryError = r.error;
    }
    if (datasetId === 'c2-hos-violations') {
      const r = await buildHosViolationsRows(query);
      samsara.hosViolations = r.rows;
      if (r.error) samsara.hosViolationsError = r.error;
    }
    if (datasetId === 'c6-speeding') {
      const r = await buildSafetyEventsRows(query, 'speed');
      samsara.speeding = r.rows;
      if (r.error) samsara.speedingError = r.error;
    }
    if (datasetId === 'c7-harsh-driving') {
      const r = await buildSafetyEventsRows(query, 'harsh');
      samsara.harsh = r.rows;
      if (r.error) samsara.harshError = r.error;
    }
    if (datasetId === 'c10-dvir') {
      const r = await buildDvirRows(query);
      samsara.dvir = r.rows;
      if (r.error) samsara.dvirError = r.error;
    }
    if (datasetId === 'c4-safety-score-driver' || datasetId === 'c5-safety-score-fleet') {
      const ph = await buildSafetyScoresPlaceholder(query);
      if (ph.disclaimer) samsara.safetyScoresDisclaimer = ph.disclaimer;
      if (ph.error) samsara.safetyScoresDisclaimer = ph.error;
    }
  } catch (e) {
    samsara.liveError = e.message || String(e);
  }
  return { samsara };
}

export function mountReportsRestApi(app, deps) {
  const {
    readErp,
    dbQuery,
    fetchTrackedFleetSnapshot,
    fetchAllSamsaraHosClocks,
    qboConfigured,
    qboGet,
    readQbo,
    logError,
    hasSamsaraReadToken
  } = deps;

  async function buildCtx(query, datasetId) {
    const erp = readErp();
    let fleetByUnit = {};
    try {
      const snap = await fetchTrackedFleetSnapshot();
      for (const v of snap.enrichedVehicles || []) {
        const name = String(v.name || '').trim();
        if (!name) continue;
        fleetByUnit[name] = {
          ymm: [v.year, v.make, v.model].filter(Boolean).join(' '),
          odometerMiles: v.odometerMiles != null ? v.odometerMiles : null
        };
      }
    } catch (_) {
      fleetByUnit = {};
    }
    let hosClocks = [];
    try {
      hosClocks = await fetchAllSamsaraHosClocks();
    } catch (_) {
      hosClocks = [];
    }
    const dbLoads = await loadDbLoads(dbQuery);
    const samsaraConnected = hasSamsaraReadToken();
    const { samsara } = await enrichSamsara(datasetId, query, samsaraConnected);
    return { erp, ctx: { fleetByUnit, hosClocks, dbLoads, samsaraConnected, samsara } };
  }

  for (const [pathSuffix, datasetId] of TABULAR_PATHS) {
    app.get(`/api/reports/${pathSuffix}`, async (req, res) => {
      try {
        const { erp, ctx } = await buildCtx(req.query, datasetId);
        const raw = await buildReportDataset(datasetId, erp, req.query, ctx);
        if (!raw.ok) {
          return res.status(400).json(
            wrapStandardReport({ ok: false, title: raw.title || 'Report', error: raw.error }, { filters: req.query, path: pathSuffix })
          );
        }
        res.json(wrapStandardReport(raw, { filters: { ...req.query }, path: pathSuffix }));
      } catch (error) {
        logError?.(`api/reports/${pathSuffix}`, error);
        res.status(200).json(
          wrapStandardReport(
            { ok: false, title: 'Report', error: error?.message || String(error) },
            { filters: { ...req.query }, path: pathSuffix }
          )
        );
      }
    });
  }

  app.get('/api/reports/qbo/:reportName', async (req, res) => {
    const reportName = String(req.params.reportName || '').trim();
    if (!reportName || !QBO_ALLOWED.has(reportName)) {
      return res.status(400).json({
        title: 'QuickBooks report',
        generatedAt: new Date().toISOString(),
        filters: { ...req.query },
        columns: [],
        rows: [],
        totals: {},
        meta: { totalRows: 0, hasChart: false, error: 'Unsupported or missing reportName' }
      });
    }
    try {
      if (!qboConfigured()) {
        return res.status(200).json({
          title: `QuickBooks — ${reportName}`,
          generatedAt: new Date().toISOString(),
          filters: { ...req.query },
          columns: [],
          rows: [],
          totals: {},
          meta: { totalRows: 0, hasChart: false, error: 'QuickBooks OAuth is not configured on this server.', needsQbo: true }
        });
      }
      const store = readQbo();
      if (!store.tokens?.refresh_token) {
        return res.status(200).json({
          title: `QuickBooks — ${reportName}`,
          generatedAt: new Date().toISOString(),
          filters: { ...req.query },
          columns: [],
          rows: [],
          totals: {},
          meta: { totalRows: 0, hasChart: false, error: 'QuickBooks connection required.', needsConnect: true }
        });
      }
      const cacheKey = JSON.stringify({
        reportName,
        q: req.query || {},
        realm: store.tokens?.realmId || ''
      });
      const hit = qboReportCache.get(cacheKey);
      if (hit && Date.now() - hit.at < 300000) {
        return res.json(hit.payload);
      }
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query || {})) {
        if (v == null || v === '') continue;
        if (k === 'startDate') sp.set('start_date', String(v));
        else if (k === 'endDate') sp.set('end_date', String(v));
        else sp.set(k, String(v));
      }
      if (!sp.get('minorversion')) sp.set('minorversion', '65');
      const qs = sp.toString();
      const path = `reports/${encodeURIComponent(reportName)}${qs ? `?${qs}` : ''}`;
      const report = await qboGet(path);
      const flat = flattenQboReportToStandard(report, reportName);
      const realmId = store.tokens?.realmId || '';
      const viewUrl = realmId ? `https://app.qbo.intuit.com/app/reportv2?companyId=${encodeURIComponent(realmId)}` : '';
      const payload = {
        ...wrapStandardReport(flat, { filters: { ...req.query, reportName }, path: `/api/reports/qbo/${reportName}` }),
        qboViewUrl: viewUrl,
        qboRawAvailable: true
      };
      qboReportCache.set(cacheKey, { at: Date.now(), payload });
      res.json(payload);
    } catch (error) {
      logError?.('api/reports/qbo', error);
      res.status(200).json({
        title: `QuickBooks — ${reportName}`,
        generatedAt: new Date().toISOString(),
        filters: { ...req.query },
        columns: [],
        rows: [],
        totals: {},
        meta: { totalRows: 0, hasChart: false, error: error?.message || String(error) }
      });
    }
  });

  app.get('/api/reports/dot/vehicle-audit/:unitId', async (req, res) => {
    try {
      const erp = readErp();
      const unitId = String(req.params.unitId || '').trim();
      if (!unitId) return res.status(400).json({ error: 'unitId required' });
      const merged = erp.companyProfile && typeof erp.companyProfile === 'object' ? erp.companyProfile : {};
      const data = await buildDotVehicleAuditV1(erp, unitId, req.query.startDate, req.query.endDate, merged);
      res.json(data);
    } catch (error) {
      logError?.('api/reports/dot/vehicle-audit', error);
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/reports/dot/driver-audit/:driverId', async (req, res) => {
    try {
      const erp = readErp();
      const driverId = String(req.params.driverId || '').trim();
      const profiles = erp.driverProfiles || [];
      const prof =
        profiles.find(d => String(d.id) === driverId) ||
        profiles.find(d => String(d.name || '').toLowerCase() === driverId.toLowerCase()) ||
        null;
      let vio = { rows: [] };
      try {
        vio = await buildHosViolationsRows({ ...req.query, driverId: prof?.samsaraDriverId || driverId });
      } catch (_) {
        vio = { rows: [] };
      }
      res.json({
        title: 'DOT driver audit',
        generatedAt: new Date().toISOString(),
        filters: { driverId, ...req.query },
        columns: [],
        rows: [],
        totals: {},
        sections: {
          driver_info: prof || { note: 'Driver not found in ERP profiles' },
          hos_violations_sample: vio.rows?.slice(0, 50) || [],
          compliance_checklist: {
            profile_on_file: Boolean(prof),
            overall_status: prof ? 'attention' : 'non_compliant'
          }
        },
        meta: { compound: true, hasChart: false, totalRows: 0 }
      });
    } catch (error) {
      logError?.('api/reports/dot/driver-audit', error);
      res.status(500).json({ error: error?.message || String(error) });
    }
  });
}
