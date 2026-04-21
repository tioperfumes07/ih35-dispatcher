/**
 * Reports hub: 8 category tabs + card grid + dataset / QBO viewer (#rep-dynamic).
 * Uses: j(), escapeHtml(), openReportsTab(), openReportsTabFromSidebar(), repReportsRoadmapMsg(), erpNotify(), authFetchHeaders().
 */
(function () {
  /** One-shot extra query params applied on next dataset open (e.g. drill-down from location summary). */
  window.__repPendingExtraParams = window.__repPendingExtraParams || null;

  function slugifyRepSectionId(t) {
    return (
      'rep-grp-' +
      String(t || 'sec')
        .replace(/[^\w.-]+/g, '-')
        .slice(0, 96)
    );
  }

  /** Collapse `URLSearchParams` into a JSON-friendly object for Excel/PDF export headers. */
  function searchParamsToFilterRecord(sp) {
    const out = {};
    if (!(sp instanceof URLSearchParams)) return out;
    const multi = {};
    for (const [k, v] of sp.entries()) {
      if (!multi[k]) multi[k] = [];
      multi[k].push(v);
    }
    for (const [k, arr] of Object.entries(multi)) {
      out[k] = arr.length === 1 ? arr[0] : arr;
    }
    return out;
  }

  const SAM = 'Samsara';
  const QBO = 'QuickBooks';
  const ERP = 'ERP';

  const REP_CATS = [
    { id: 'overview', label: 'Overview' },
    { id: 'maintenance', label: 'Maintenance' },
    { id: 'accounting', label: 'Accounting' },
    { id: 'safety', label: 'Safety & HOS' },
    { id: 'fuel', label: 'Fuel & energy' },
    { id: 'operations', label: 'Operations' },
    { id: 'dot', label: 'DOT compliance' },
    { id: 'custom', label: 'Custom' }
  ];

  /** @type {{cat:string,title:string,desc:string,source:string,keywords:string,dataset?:string,qbo?:string,legacy?:string,dotPdf?:boolean,custom?:string}[]} */
  const REP_ITEMS = [];
  function add(cat, title, desc, source, keywords, extra = {}) {
    REP_ITEMS.push({ cat, title, desc, source, keywords: keywords.toLowerCase(), ...extra });
  }

  add('overview', 'Executive overview', 'Metric board + Refresh reports', ERP, 'overview dashboard executive', { legacy: 'rep-overview' });
  add('overview', 'TMS loads', 'Postgres pipeline counts', ERP, 'tms loads trips', { legacy: 'rep-tms' });
  add('overview', 'Settlement / P&L by load', 'Per-load rollup when TMS on', ERP, 'settlement pnl profit', { legacy: 'rep-settlement' });
  add('overview', 'Team & security', 'Sign-in posture', ERP, 'team security users', { legacy: 'rep-team' });

  add('maintenance', 'Expense by service type', 'Compare costs across service types', ERP, 'expense service type grouped', {
    dataset: 'm1-expense-by-service-type',
    subsection: 'Cost analysis'
  });
  add('maintenance', 'Maintenance cost summary', 'Pivot: service types × months', ERP, 'pivot heat cost months', {
    dataset: 'm2-maintenance-cost-pivot',
    subsection: 'Cost analysis'
  });
  add('maintenance', 'Repair vs maintenance split', 'Planned vs unplanned over time', ERP, 'repair maintenance ratio', {
    dataset: 'm3-repair-vs-maintenance',
    subsection: 'Cost analysis'
  });
  add('maintenance', 'Cost by unit', 'Bar + table', ERP, 'cost unit spend', { dataset: 'a2-cost-by-unit', subsection: 'Cost analysis' });
  add('maintenance', 'Cost by service type', 'Pie + table', ERP, 'service type spend', { dataset: 'a3-cost-by-service-type', subsection: 'Cost analysis' });
  add('maintenance', 'Work order history', 'Filters + totals', ERP, 'work order history wo', { dataset: 'a1-work-order-history', subsection: 'Service history' });
  add('maintenance', 'PM schedule', 'Miles-based status colors', ERP, 'pm preventive schedule', { dataset: 'a4-pm-schedule', subsection: 'Service history' });
  add('maintenance', 'Inspection history', 'DOT / shop inspections', ERP, 'inspection history', { dataset: 'a10-inspection-history', subsection: 'Service history' });
  add('maintenance', 'Parts / positions (line detail)', 'Tire, item, and part# lines', ERP, 'parts positions line detail', {
    dataset: 'a11-parts-positions',
    subsection: 'Service history'
  });
  add('maintenance', 'Tire history', 'Position map filter', ERP, 'tire position', { dataset: 'a5-tire-history', subsection: 'Service history' });
  add('maintenance', 'Air bag history', 'Position map', ERP, 'air bag suspension', { dataset: 'a6-air-bag-history', subsection: 'Service history' });
  add('maintenance', 'Battery history', 'Parts + cost', ERP, 'battery', { dataset: 'a7-battery-history', subsection: 'Service history' });
  add('maintenance', 'Accident / collision', 'Fault + insurance fields', ERP, 'accident collision police', { dataset: 'a8-accident-collision', subsection: 'Service history' });
  add('maintenance', 'Work by service location', 'Grouped by where work was done', ERP, 'location shop vendor', {
    dataset: 'm4-work-by-location',
    subsection: 'Location analysis'
  });
  add('maintenance', 'Internal vs external shop analysis', 'In-house vs vendor spend', ERP, 'internal external shop', {
    dataset: 'm5-internal-external',
    subsection: 'Location analysis'
  });
  add('maintenance', 'All locations — service summary', 'One row per location', ERP, 'location summary rollup', {
    dataset: 'm6-location-summary',
    subsection: 'Location analysis'
  });
  add('maintenance', 'Fleet repair summary (monthly)', 'Spend by month', ERP, 'monthly repair fleet', { dataset: 'a9-fleet-repair-monthly', subsection: 'Location analysis' });
  add('maintenance', 'Spend by unit (legacy)', 'Original summary table', ERP, 'spend unit maintenance', { legacy: 'rep-maint' });
  add('maintenance', 'Detailed (parts / positions)', 'Line-level export', ERP, 'parts positions tires', { legacy: 'rep-maint-detail' });

  const QBO_MAP = [
    ['ProfitAndLoss', 'Profit & Loss', 'profit loss p&l'],
    ['BalanceSheet', 'Balance Sheet', 'balance sheet'],
    ['CashFlow', 'Cash Flow Statement', 'cash flow'],
    ['AgedPayables', 'Accounts Payable Aging', 'ap aging payable'],
    ['VendorBalance', 'Vendor balance summary', 'vendor balance'],
    ['TrialBalance', 'Trial Balance', 'trial balance'],
    ['GeneralLedgerDetail', 'General Ledger', 'general ledger gl'],
    ['Check', 'Check detail', 'check detail'],
    ['OpenInvoices', 'Open invoices', 'open invoices ar'],
    ['AgedReceivables', 'Accounts receivable aging', 'ar aging receivable'],
    ['CustomerSales', 'Sales by customer', 'sales customer revenue']
  ];
  for (const [report, title, kw] of QBO_MAP) {
    add('accounting', title, 'Live QBO Reports API', QBO, kw, { qbo: report });
  }
  add('accounting', 'Expense history (ERP)', 'Posted + local AP expenses', ERP, 'expense history ap', { dataset: 'b6-expense-history' });
  add('accounting', 'Bill history (ERP)', 'AP bills', ERP, 'bill history ap', { dataset: 'b7-bill-history' });
  add('accounting', 'Fuel expense history (ERP)', 'Fuel ledger', ERP, 'fuel expense', { dataset: 'b8-fuel-expense-history' });
  add('accounting', 'Monthly expense summary (ERP)', 'Maint + fuel + other', ERP, 'monthly expense summary', { dataset: 'b9-monthly-expense-summary' });
  add('accounting', 'QBO sync errors log', 'ERP posting errors', ERP, 'sync error qbo', { dataset: 'b10-qbo-sync-errors' });
  add('accounting', 'QuickBooks activity (legacy)', 'Recent QBO tx window', QBO, 'quickbooks activity bills', { legacy: 'rep-qbo' });
  add('accounting', 'ERP ↔ QBO sync (legacy)', 'Posting mix', ERP, 'erp sync reconcile', { legacy: 'rep-sync' });

  add('safety', 'Driver HOS summary', 'Clock snapshot', SAM, 'hos hours duty', { dataset: 'c1-driver-hos-summary' });
  add('safety', 'HOS violations log', 'Safety API roadmap', SAM, 'hos violation', { dataset: 'c2-hos-violations' });
  add('safety', 'Daily driver log summary', 'Samsara roadmap', SAM, 'daily log driver', { dataset: 'c3-daily-driver-log' });
  add('safety', 'Safety score by driver', 'Samsara roadmap', SAM, 'safety score driver', { dataset: 'c4-safety-score-driver' });
  add('safety', 'Safety score fleet overview', 'Samsara roadmap', SAM, 'safety fleet benchmark', { dataset: 'c5-safety-score-fleet' });
  add('safety', 'Speeding report', 'Samsara roadmap', SAM, 'speeding', { dataset: 'c6-speeding' });
  add('safety', 'Harsh driving events', 'Samsara roadmap', SAM, 'harsh brake', { dataset: 'c7-harsh-driving' });
  add('safety', 'Unassigned HOS segments', 'Samsara roadmap', SAM, 'unassigned hos', { dataset: 'c8-unassigned-hos' });
  add('safety', 'Driver qualification file', 'CDL / medical / MVR', ERP, 'driver qualification cdl medical', { dataset: 'c9-driver-qualification' });
  add('safety', 'DVIR', 'Inspection reports', SAM, 'dvir inspection', { dataset: 'c10-dvir' });

  add('fuel', 'Fuel cost by unit', 'Gallons + $', ERP, 'fuel cost unit', { dataset: 'd1-fuel-cost-by-unit' });
  add('fuel', 'Fuel cost by driver', 'From fuel expense drafts', ERP, 'fuel cost driver', { dataset: 'd2-fuel-cost-by-driver' });
  add('fuel', 'Fuel card transactions', 'Comdata / Relay style rows', ERP, 'fuel card relay comdata', { dataset: 'd3-fuel-card-transactions' });
  add('fuel', 'IFTA mileage (jurisdiction)', 'Roadmap + fuel context', ERP, 'ifta mileage jurisdiction', { dataset: 'd4-ifta-mileage' });
  add('fuel', 'MPG by unit', 'Miles ÷ gallons', ERP, 'mpg miles gallon', { dataset: 'd5-mpg-by-unit' });
  add('fuel', 'IFTA & compliance (legacy)', 'Roadmap notes', ERP, 'ifta compliance hub', { legacy: 'rep-ifta' });

  add('operations', 'Load history', 'TMS Postgres', ERP, 'load history trip', { dataset: 'e1-load-history' });
  add('operations', 'Revenue by driver', 'TMS rollup', ERP, 'revenue driver', { dataset: 'e2-revenue-by-driver' });
  add('operations', 'Revenue by customer', 'TMS rollup', ERP, 'revenue customer', { dataset: 'e3-revenue-by-customer' });
  add('operations', 'Dispatch summary', 'Roadmap', ERP, 'dispatch summary', { dataset: 'e4-dispatch-summary' });
  add('operations', 'Settlement report', 'TMS + ERP tie-in', ERP, 'settlement report driver pay', { dataset: 'e5-settlement-report' });
  add('operations', 'Activity summary', 'Odometer snapshot', SAM, 'activity summary miles', { dataset: 'e6-activity-summary' });
  add('operations', 'Fleet benchmarks', 'Industry reference', SAM, 'benchmark fleet', { dataset: 'e7-fleet-benchmarks' });

  add('dot', 'DOT audit file (PDF)', 'Per-vehicle multi-section', ERP, 'dot audit file vehicle', { dotPdf: true });
  add('dot', 'DOT audit (configure)', 'Sections, grouping, filters → PDF', ERP, 'dot audit configure', { custom: 'dot-audit-config' });
  add('dot', 'DOT fleet overview', 'Compliance matrix', ERP, 'dot fleet overview', { dataset: 'f-dot-fleet-overview' });
  add('dot', 'Driver qualification (DOT)', '391 file status', ERP, 'driver qualification dot', { dataset: 'g1-driver-qualification' });
  add('dot', 'Driver DOT audit file', 'Per-driver packet (shell)', ERP, 'driver dot audit', { dataset: 'g2-driver-dot-audit' });
  add('dot', 'Drug & alcohol testing log', 'FMCSA program', ERP, 'drug alcohol testing', { dataset: 'g3-drug-alcohol-testing' });
  add('dot', 'Integrity dashboard', 'Open compliance hub', ERP, 'integrity compliance dashboard', {
    custom: 'integrity-dashboard'
  });
  add('dot', 'IFTA quarterly (jurisdiction)', 'Fuel + miles', ERP, 'ifta quarterly', { dataset: 'd4-ifta-mileage' });

  add('custom', '+ New custom report', 'Roadmap — builder', ERP, 'custom report new', { custom: 'new' });
  add('custom', 'Scheduled reports', 'Roadmap — scheduler', ERP, 'scheduled reports', { custom: 'scheduled' });

  let __repCat = 'overview';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function ymd(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function defaultRange() {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    return { start: ymd(start), end: ymd(end) };
  }

  /** Prefer canonical GET /api/reports/... (standard envelope); fallback to /api/reports/dataset?id= */
  const DATASET_REST = {
    'a1-work-order-history': '/api/reports/maintenance/work-order-history',
    'a2-cost-by-unit': '/api/reports/maintenance/cost-by-unit',
    'a3-cost-by-service-type': '/api/reports/maintenance/cost-by-service-type',
    'a4-pm-schedule': '/api/reports/maintenance/pm-schedule',
    'a5-tire-history': '/api/reports/maintenance/tire-history',
    'a6-air-bag-history': '/api/reports/maintenance/air-bag-history',
    'a7-battery-history': '/api/reports/maintenance/battery-history',
    'a8-accident-collision': '/api/reports/maintenance/accident-history',
    'a9-fleet-repair-monthly': '/api/reports/maintenance/fleet-repair-summary',
    'a10-inspection-history': '/api/reports/maintenance/inspection-history',
    'a11-parts-positions': '/api/reports/maintenance/parts-positions',
    'm1-expense-by-service-type': '/api/reports/maintenance/by-service-type',
    'm2-maintenance-cost-pivot': '/api/reports/maintenance/cost-pivot',
    'm3-repair-vs-maintenance': '/api/reports/maintenance/repair-vs-maintenance',
    'm4-work-by-location': '/api/reports/maintenance/by-location',
    'm5-internal-external': '/api/reports/maintenance/internal-external',
    'm6-location-summary': '/api/reports/maintenance/location-summary',
    'b6-expense-history': '/api/reports/accounting/expense-history',
    'b7-bill-history': '/api/reports/accounting/bill-history',
    'b8-fuel-expense-history': '/api/reports/accounting/fuel-expense-history',
    'b9-monthly-expense-summary': '/api/reports/accounting/monthly-summary',
    'b10-qbo-sync-errors': '/api/reports/accounting/qbo-sync-errors',
    'b11-vendor-spend': '/api/reports/accounting/vendor-spend',
    'c1-driver-hos-summary': '/api/reports/safety/hos-summary',
    'c2-hos-violations': '/api/reports/safety/hos-violations',
    'c3-daily-driver-log': '/api/reports/safety/daily-driver-log',
    'c4-safety-score-driver': '/api/reports/safety/safety-scores',
    'c5-safety-score-fleet': '/api/reports/safety/safety-scores-fleet',
    'c6-speeding': '/api/reports/safety/speeding',
    'c7-harsh-driving': '/api/reports/safety/harsh-driving',
    'c8-unassigned-hos': '/api/reports/safety/unassigned-hos',
    'c9-driver-qualification': '/api/reports/safety/driver-qualifications',
    'g1-driver-qualification': '/api/reports/safety/driver-qualifications',
    'c10-dvir': '/api/reports/safety/dvir',
    'd1-fuel-cost-by-unit': '/api/reports/fuel/cost-by-unit',
    'd2-fuel-cost-by-driver': '/api/reports/fuel/cost-by-driver',
    'd3-fuel-card-transactions': '/api/reports/fuel/transactions',
    'd4-ifta-mileage': '/api/reports/fuel/ifta',
    'd5-mpg-by-unit': '/api/reports/fuel/mpg-by-unit',
    'e1-load-history': '/api/reports/operations/load-history',
    'e2-revenue-by-driver': '/api/reports/operations/revenue-by-driver',
    'e3-revenue-by-customer': '/api/reports/operations/revenue-by-customer',
    'e4-dispatch-summary': '/api/reports/operations/dispatch-summary',
    'e5-settlement-report': '/api/reports/operations/settlement',
    'e6-activity-summary': '/api/reports/operations/activity-summary',
    'e7-fleet-benchmarks': '/api/reports/operations/fleet-benchmarks',
    'f-dot-fleet-overview': '/api/reports/dot/fleet-overview',
    'g1-driver-qualification': '/api/reports/safety/driver-qualifications',
    'g3-drug-alcohol-testing': '/api/reports/dot/drug-alcohol-testing'
  };

  function repSaveRecent(datasetId, title) {
    try {
      const key = 'erp.reports.recent';
      const prev = JSON.parse(localStorage.getItem(key) || '[]').filter(x => x.id !== datasetId);
      prev.unshift({ id: datasetId, title, at: Date.now() });
      localStorage.setItem(key, JSON.stringify(prev.slice(0, 5)));
    } catch (_) {}
  }

  function repDynamicBack() {
    if (typeof openReportsTab === 'function') {
      const b = document.querySelector('#section-reports .subtab[onclick*="rep-overview"]');
      openReportsTab('rep-overview', b);
    }
  }

  function repPrintCompanyBlock() {
    const g =
      typeof window.__erpPrintCompanyInfo === 'object' && window.__erpPrintCompanyInfo != null ? window.__erpPrintCompanyInfo : {};
    const name = String(g.companyName || '').trim() || 'IH 35 Transportation LLC';
    const bits = [];
    if (String(g.address || '').trim()) bits.push(`<div class="co-sub">${escapeHtml(String(g.address).trim())}</div>`);
    if (String(g.city || '').trim()) bits.push(`<div class="co-sub">${escapeHtml(String(g.city).trim())}</div>`);
    if (String(g.phone || '').trim()) bits.push(`<div class="co-sub">${escapeHtml(String(g.phone).trim())}</div>`);
    const reg = [];
    if (String(g.usdot || '').trim()) reg.push('USDOT ' + escapeHtml(String(g.usdot).trim()));
    if (String(g.mcNumber || '').trim()) reg.push('MC ' + escapeHtml(String(g.mcNumber).trim()));
    if (reg.length) bits.push(`<div class="co-sub">${reg.join(' · ')}</div>`);
    return `<div class="company-name">${escapeHtml(name)}</div>${bits.join('')}`;
  }

  function repDynamicPrint() {
    const st = window.__repDynState;
    if (!st || !st.columns) return;
    const keys = st.columns.map(c => c.key);
    const th = st.columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('');
    const tr = (st.rows || [])
      .map(r => `<tr>${keys.map(k => `<td>${escapeHtml(String(r[k] ?? ''))}</td>`).join('')}</tr>`)
      .join('');
    const tot =
      st.totals && Object.keys(st.totals).length
        ? `<tr class="totals-row">${keys
            .map((k, i) => `<td>${i === 0 ? 'Total' : escapeHtml(String(st.totals[k] ?? ''))}</td>`)
            .join('')}</tr>`
        : '';
    const footerCenter = [escapeHtml(st.title || 'Report'), escapeHtml(st.unitTag || ''), escapeHtml(st.startDate || ''), escapeHtml(st.endDate || '')]
      .filter(Boolean)
      .join(' · ');
    const extraCss =
      typeof window.PRINT_CSS === 'string'
        ? ''
        : `
    .page-footer{position:fixed;bottom:0;left:0;right:0;z-index:100;border-top:0.5pt solid #ccc;padding:4pt 0.65in;font-size:6.5pt;color:#888;display:flex;justify-content:space-between;align-items:center;gap:8pt;background:#fff}
    .page-footer__center{text-align:center;flex:1;min-width:0}
    .page-footer__pg{flex-shrink:0;white-space:nowrap}
    @media print{.page-footer__pg::after{content:"Page " counter(page) " of " counter(pages)}}
    @media screen{.page-footer__pg::after{content:"Page 1"}}`;
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(st.title || 'Report')}</title><style>
${typeof window.PRINT_CSS === 'string' ? window.PRINT_CSS : ''}
@page { size: letter portrait; margin: 0.65in; }
body{font-family:Arial,Helvetica,sans-serif;font-size:7pt;color:#111;background:#fff;line-height:1.4}
.pwrap{max-width:100%;margin:0 auto;padding-bottom:0.35in}
table{width:100%;border-collapse:collapse;margin-bottom:6pt}
thead{display:table-header-group}
th{background:#1a1f36;color:#fff;padding:3pt 5pt;font-size:6.5pt;font-weight:bold;text-align:left;border:0.5pt solid #1a1f36}
th.right{text-align:right}
td{padding:3pt 5pt;border:0.5pt solid #ddd;font-size:7pt;vertical-align:top}
tr:nth-child(even) td{background:#f9f9f9}
.totals-row td{font-weight:bold;background:#f0f0f0;border-top:0.5pt solid #ccc;font-size:8pt}
.report-header{border-bottom:1.5pt solid #1a1f36;padding-bottom:8pt;margin-bottom:10pt;display:flex;justify-content:space-between;align-items:flex-start}
.company-name{font-size:11pt;font-weight:bold;color:#1a1f36}
.co-sub{font-size:6.5pt;color:#555;margin-top:2pt;line-height:1.5}
.report-title{font-size:13pt;font-weight:bold;color:#1a1f36;border:1.5pt solid #1a1f36;padding:3pt 10pt;text-align:right;display:inline-block}
.genline{font-size:7pt;color:#555;margin:0 0 8px}
@media print{thead{display:table-header-group}tr{page-break-inside:avoid}}
${extraCss}
</style></head><body><div class="pwrap">
<div class="report-header"><div>${repPrintCompanyBlock()}<div class="genline">${escapeHtml(st.subtitle || '')}</div></div>
<div class="report-title">${escapeHtml(st.title || 'Report')}</div></div>
<div class="genline">Generated ${escapeHtml(new Date().toISOString())}</div>
<table><thead><tr>${th}</tr></thead><tbody>${tr}${tot}</tbody></table>
</div><div class="page-footer"><span></span><span class="page-footer__center">${footerCenter}</span><span class="page-footer__pg"></span></div>
</body></html>`;
    let suggested = '';
    if (typeof window.generateFilename === 'function') {
      try {
        suggested = window.generateFilename(
          'report',
          {
            reportName: st.title,
            unitFilter: st.unitTag || 'All',
            startDate: st.startDate,
            endDate: st.endDate
          },
          'pdf'
        );
      } catch (_) {}
    }
    const co =
      typeof window.__erpPrintCompanyInfo === 'object' && window.__erpPrintCompanyInfo != null
        ? String(window.__erpPrintCompanyInfo.companyName || '').trim()
        : '';
    const footerLeft = co || 'IH 35 Transportation LLC';
    const htmlWithFooter = html.replace(
      '<div class="page-footer"><span></span>',
      `<div class="page-footer"><span>${escapeHtml(footerLeft)}</span>`
    );
    if (typeof window.erpPrintOpenAndPrint === 'function') {
      window.erpPrintOpenAndPrint(htmlWithFooter, { suggestedFilename: suggested || undefined });
      return;
    }
    const w = window.open('', '_blank', 'width=900,height=750,scrollbars=yes,resizable=yes');
    if (!w || w.closed) {
      if (typeof window.erpNotify === 'function') window.erpNotify('Popup blocked. Allow popups for this site to print reports.', 'warning');
      return;
    }
    w.document.open();
    w.document.write(htmlWithFooter);
    w.document.close();
    if (suggested) {
      try {
        w.document.title = suggested.replace(/\.pdf$/i, '');
      } catch (_) {}
    }
    w.focus();
    setTimeout(() => {
      try {
        w.print();
      } catch (_) {}
    }, 400);
  }

  async function repDynamicExport(format) {
    const st = window.__repDynState;
    if (!st || !Array.isArray(st.columns) || !Array.isArray(st.rows)) return;
    try {
      if (window.ErpExportUtil && typeof window.ErpExportUtil.exportReport === 'function') {
        await window.ErpExportUtil.exportReport(
          format === 'xlsx' ? 'excel' : format,
          {
            title: st.title,
            columns: st.columns,
            rows: st.rows,
            totals: st.totals || {},
            filters: st.filtersApplied || { startDate: st.startDate, endDate: st.endDate, unit: st.unitTag },
            groupedSections: st.groupedSections || null
          },
          {
            filename: st.title || 'Report',
            companyName: 'IH 35 Transportation LLC',
            dateRange: `${st.startDate || ''} to ${st.endDate || ''}`,
            filtersApplied: st.filtersApplied || { startDate: st.startDate, endDate: st.endDate, unit: st.unitTag }
          }
        );
        return;
      }
      const r = await fetch('/api/reports/export-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(typeof authFetchHeaders === 'function' ? authFetchHeaders() : {}) },
        body: JSON.stringify({
          format,
          title: st.title || 'Report',
          subtitle: st.subtitle || '',
          columns: st.columns,
          rows: st.rows,
          unitTag: st.unitTag || '',
          rangeTag: `${st.startDate || ''}_${st.endDate || ''}`
        })
      });
      if (!r.ok) {
        const t = await r.text();
        let err = t;
        try {
          err = JSON.parse(t).error || t;
        } catch (_) {}
        throw new Error(err || r.statusText);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (st.title || 'report').replace(/[^\w.-]+/g, '_') + '.' + (format === 'xlsx' ? 'xlsx' : format);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (typeof erpNotify === 'function') erpNotify(String(e.message || e), 'error');
    }
  }

  function renderPmScheduleTable(columns, rows, fleetAvgMeta) {
    const fa = Number(fleetAvgMeta) > 0 ? Number(fleetAvgMeta) : 12000;
    const keys = columns.map(c => c.key);
    const th = columns
      .map(c => {
        if (c.key === 'weeksRemainingDisplay') {
          return `<th data-k="${escapeHtml(c.key)}">${escapeHtml(c.label)}<div class="rep-pm-head-note">Based on fleet avg ${fa.toLocaleString(
            'en-US'
          )} mi/month</div></th>`;
        }
        return `<th data-k="${escapeHtml(c.key)}">${escapeHtml(c.label)}</th>`;
      })
      .join('');
    const tr = (rows || [])
      .map(r => {
        const rowCls = 'rep-pm-row rep-pm-row--' + String(r.status || 'gray');
        return `<tr class="${rowCls}">${keys
          .map(k => {
            const raw = r[k];
            const isOverdueWeeks =
              k === 'weeksRemainingDisplay' && String(r.status || '') === 'red' && String(raw).toLowerCase().includes('overdue');
            const inner = isOverdueWeeks
              ? `<span class="rep-pm-weeks-overdue">${escapeHtml(String(raw ?? ''))}</span>`
              : escapeHtml(String(raw ?? ''));
            return `<td>${inner}</td>`;
          })
          .join('')}</tr>`;
      })
      .join('');
    return `<table class="rep-dyn-table rep-pm-schedule-table" style="min-width:520px;font-size:12px;width:100%"><thead><tr>${th}</tr></thead><tbody>${tr || ''}</tbody></table>`;
  }

  const RECORD_TYPE_ROW_CLASS = {
    pm_service: 'rep-row-rt rep-row-rt--pm',
    maintenance: 'rep-row-rt rep-row-rt--maint',
    repair: 'rep-row-rt rep-row-rt--repair',
    inspection: 'rep-row-rt rep-row-rt--insp',
    tire: 'rep-row-rt rep-row-rt--tire',
    air_bag: 'rep-row-rt rep-row-rt--airbag',
    battery: 'rep-row-rt rep-row-rt--battery',
    accident: 'rep-row-rt rep-row-rt--accident',
    body: 'rep-row-rt rep-row-rt--body',
    other: 'rep-row-rt rep-row-rt--other'
  };

  function maintRowClassFromRow(r) {
    const k = String(r.recordCategory || r.recordCategoryKey || '').trim().toLowerCase();
    if (k && RECORD_TYPE_ROW_CLASS[k]) return RECORD_TYPE_ROW_CLASS[k];
    const blob = `${r.recordType || ''} ${r.recordCategory || ''}`.toLowerCase();
    if (blob.includes('pm')) return RECORD_TYPE_ROW_CLASS.pm_service;
    if (blob.includes('inspect')) return RECORD_TYPE_ROW_CLASS.inspection;
    if (blob.includes('tire')) return RECORD_TYPE_ROW_CLASS.tire;
    if (blob.includes('air')) return RECORD_TYPE_ROW_CLASS.air_bag;
    if (blob.includes('battery')) return RECORD_TYPE_ROW_CLASS.battery;
    if (blob.includes('accident') || blob.includes('collision')) return RECORD_TYPE_ROW_CLASS.accident;
    if (blob.includes('body')) return RECORD_TYPE_ROW_CLASS.body;
    if (blob.includes('repair')) return RECORD_TYPE_ROW_CLASS.repair;
    if (blob.includes('maint')) return RECORD_TYPE_ROW_CLASS.maintenance;
    return '';
  }

  function renderSortableTable(columns, rows, rowClassFn) {
    const keys = columns.map(c => c.key);
    const th = columns.map(c => `<th data-k="${escapeHtml(c.key)}">${escapeHtml(c.label)}</th>`).join('');
    const tr = (rows || [])
      .map(r => {
        const rc = rowClassFn ? rowClassFn(r) : '';
        const cls = rc ? ` class="${rc}"` : '';
        return `<tr${cls}>${keys.map(k => `<td>${escapeHtml(String(r[k] ?? ''))}</td>`).join('')}</tr>`;
      })
      .join('');
    return `<table class="rep-dyn-table" style="min-width:520px;font-size:12px;width:100%"><thead><tr>${th}</tr></thead><tbody>${tr || ''}</tbody></table>`;
  }

  function colIndex(tbl, k) {
    return [...tbl.querySelectorAll('thead th[data-k]')].findIndex(h => h.getAttribute('data-k') === k);
  }

  function bindSortable(host) {
    const tbl = host.querySelector('table.rep-dyn-table');
    if (!tbl) return;
    let sortKey = '';
    let dir = 1;
    tbl.querySelectorAll('thead th[data-k]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const k = th.getAttribute('data-k');
        dir = sortKey === k ? -dir : 1;
        sortKey = k;
        const tbody = tbl.querySelector('tbody');
        const idx = colIndex(tbl, k);
        if (idx < 0) return;
        const arr = Array.from(tbody.querySelectorAll('tr'));
        arr.sort((a, b) => {
          const ta = a.children[idx]?.textContent || '';
          const tb = b.children[idx]?.textContent || '';
          const na = parseFloat(ta.replace(/[^0-9.-]/g, ''));
          const nb = parseFloat(tb.replace(/[^0-9.-]/g, ''));
          if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
          return ta.localeCompare(tb) * dir;
        });
        arr.forEach(r => tbody.appendChild(r));
      });
    });
  }

  function flattenQboReportForTable(report) {
    const rows = [];
    const walk = r => {
      if (!r) return;
      const list = Array.isArray(r) ? r : [r];
      for (const row of list) {
        if (row.ColData) {
          const cds = Array.isArray(row.ColData) ? row.ColData : [row.ColData];
          const obj = {};
          cds.forEach((cd, i) => {
            obj['c' + i] = cd?.value ?? '';
          });
          rows.push(obj);
        }
        if (row.Rows && row.Rows.Row) walk(row.Rows.Row);
      }
    };
    if (report?.Rows?.Row) walk(report.Rows.Row);
    const ncols = rows.reduce((m, r) => Math.max(m, Object.keys(r).filter(k => k.startsWith('c')).length), 0);
    const columns = [];
    for (let i = 0; i < ncols; i++) columns.push({ key: 'c' + i, label: 'Column ' + (i + 1) });
    if (!columns.length) columns.push({ key: 'a', label: 'Data' });
    return { columns, rows };
  }

  const FILTER_PANEL_DATASETS = new Set([
    'a1-work-order-history',
    'a2-cost-by-unit',
    'a3-cost-by-service-type',
    'a4-pm-schedule',
    'a5-tire-history',
    'a6-air-bag-history',
    'a7-battery-history',
    'a8-accident-collision',
    'a9-fleet-repair-monthly',
    'a10-inspection-history',
    'a11-parts-positions',
    'm1-expense-by-service-type',
    'm2-maintenance-cost-pivot',
    'm3-repair-vs-maintenance',
    'm4-work-by-location',
    'm5-internal-external',
    'm6-location-summary'
  ]);

  function filterPanelOptionsFor(datasetId) {
    const fullMaint = [
      'dateRange',
      'units',
      'recordTypes',
      'locationCategories',
      'locationNames',
      'vendors',
      'drivers',
      'serviceTypesPick',
      'fleetTypes',
      'makes',
      'costRange',
      'sortBy'
    ];
    const gbSvc = [
      { value: 'service_type', label: 'Service type' },
      { value: 'record_type', label: 'Record type' },
      { value: 'vehicle', label: 'Vehicle' },
      { value: 'month', label: 'Month' }
    ];
    const gbMonth = [
      { value: 'month', label: 'Month' },
      { value: 'quarter', label: 'Quarter' },
      { value: 'year', label: 'Year' }
    ];
    const gbLoc = [
      { value: 'location', label: 'Location' },
      { value: 'location_type', label: 'Location type' },
      { value: 'vehicle', label: 'Vehicle' },
      { value: 'service_type', label: 'Service type' }
    ];
    const gbCostUnit = [
      { value: 'vehicle', label: 'Vehicle (unit)' },
      { value: 'make', label: 'Make' },
      { value: 'fleet_type', label: 'Fleet type' }
    ];
    const gbCostSvc = [
      { value: 'service_type', label: 'Service type' },
      { value: 'category', label: 'Category (rollup)' },
      { value: 'record_type', label: 'Record type' }
    ];
    const gbTirePos = [
      { value: 'position', label: 'Position' },
      { value: 'vehicle', label: 'Unit' },
      { value: 'date', label: 'Date' }
    ];
    const gbA1 = [
      { value: 'none', label: 'None (flat list)' },
      { value: 'vehicle', label: 'Vehicle (unit)' },
      { value: 'service_type', label: 'Service type' },
      { value: 'record_type', label: 'Record type' },
      { value: 'location', label: 'Location' },
      { value: 'vendor', label: 'Vendor' },
      { value: 'month', label: 'Month' }
    ];
    if (datasetId === 'm1-expense-by-service-type')
      return { datasetId, defaultMonths: 12, features: [...fullMaint, 'groupBy'], groupByOptions: gbSvc };
    if (datasetId === 'm2-maintenance-cost-pivot') return { datasetId, defaultMonths: 12, features: [...fullMaint] };
    if (datasetId === 'm3-repair-vs-maintenance')
      return { datasetId, defaultMonths: 12, features: [...fullMaint, 'groupBy'], groupByOptions: gbMonth };
    if (datasetId === 'm4-work-by-location')
      return { datasetId, defaultMonths: 12, features: [...fullMaint, 'groupBy'], groupByOptions: gbLoc };
    if (datasetId === 'm5-internal-external') return { datasetId, defaultMonths: 12, features: [...fullMaint] };
    if (datasetId === 'm6-location-summary')
      return {
        datasetId,
        defaultMonths: 12,
        features: ['dateRange', 'recordTypes', 'locationCategories', 'locationNames', 'makes', 'sortBy']
      };
    if (datasetId === 'a4-pm-schedule')
      return {
        datasetId,
        defaultMonths: 3,
        features: ['units', 'fleetTypes', 'makes', 'recordTypes', 'pmStatusPick', 'showOverduePm']
      };
    if (datasetId === 'a1-work-order-history')
      return { datasetId, defaultMonths: 3, features: [...fullMaint, 'defectsOnly', 'groupBy'], groupByOptions: gbA1 };
    if (datasetId === 'a2-cost-by-unit')
      return { datasetId, defaultMonths: 3, features: [...fullMaint, 'groupBy'], groupByOptions: gbCostUnit };
    if (datasetId === 'a3-cost-by-service-type')
      return { datasetId, defaultMonths: 3, features: [...fullMaint, 'groupBy'], groupByOptions: gbCostSvc };
    if (datasetId === 'a8-accident-collision')
      return { datasetId, defaultMonths: 3, features: [...fullMaint, 'accidentExtra'] };
    if (datasetId === 'a9-fleet-repair-monthly')
      return { datasetId, defaultMonths: 3, features: [...fullMaint, 'groupBy'], groupByOptions: gbMonth };
    if (datasetId === 'a5-tire-history' || datasetId === 'a6-air-bag-history' || datasetId === 'a11-parts-positions')
      return { datasetId, defaultMonths: 3, features: [...fullMaint, 'groupBy', 'partPositionsPick'], groupByOptions: gbTirePos };
    if (datasetId === 'a7-battery-history')
      return { datasetId, defaultMonths: 3, features: [...fullMaint, 'partPositionsPick'] };
    if (datasetId === 'a10-inspection-history')
      return { datasetId, defaultMonths: 3, features: [...fullMaint, 'groupBy'], groupByOptions: gbTirePos };
    return { datasetId, defaultMonths: 3, features: [...fullMaint] };
  }

  function sectionBorderFromRecordCategory(cat) {
    const k = String(cat || '').toLowerCase();
    const map = {
      pm_service: '#1a7a3c',
      maintenance: '#1557a0',
      repair: '#c5221f',
      inspection: '#6200ea',
      tire: '#f9ab00',
      air_bag: '#00897b',
      battery: '#e65100',
      accident: '#b71c1c',
      body: '#6a1b9a',
      other: '#6b7385'
    };
    return map[k] || '#1557a0';
  }

  function renderGroupedSections(sections) {
    const bar = (border, title, count, total, avg, bodyHtml, extraHead, secId) =>
      `<details open class="rep-grp-sec" id="${escapeHtml(secId)}" style="margin-bottom:10px;border:1px solid #e0e3eb;border-radius:8px;overflow:hidden;scroll-margin-top:72px">
        <summary style="list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f1f3f4;border-left:4px solid ${border}">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="width:10px;height:10px;border-radius:50%;background:${border};flex-shrink:0" aria-hidden="true"></span>
            <span style="font-weight:600;font-size:13px;color:#1a1f36">${escapeHtml(title)}</span>
            ${extraHead || ''}
            <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:#e8f0fe;color:#1557a0">${count} records</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
          <div style="text-align:right">
            <div style="font-size:14px;font-weight:500;color:#1a1f36">$${Number(total || 0).toFixed(2)}</div>
            <div style="font-size:11px;color:#6b7385">avg $${Number(avg || 0).toFixed(2)}</div>
          </div>
          <span class="rep-grp-chev" aria-hidden="true" style="font-size:12px;color:#6b7385">▼</span>
          </div>
        </summary>
        <div style="padding:8px">${bodyHtml}</div>
      </details>`;
    const colors = ['#1557a0', '#1a7a3c', '#c5221f', '#6200ea', '#f9ab00', '#00897b'];
    let i = 0;
    return (sections || [])
      .map(sec => {
        const border = sec.recordCategory ? sectionBorderFromRecordCategory(sec.recordCategory) : colors[i++ % colors.length];
        const cols = sec.columns || [];
        const rows = sec.rows || [];
        const body = rows.length ? renderSortableTable(cols, rows, maintRowClassFromRow) : '<p class="mini-note">No rows in this group.</p>';
        const mixRow =
          Array.isArray(sec.serviceTypeMix) && sec.serviceTypeMix.length
            ? `<div class="mini-note" style="margin:6px 0 8px">Service spend mix: ${sec.serviceTypeMix
                .map(x => `${escapeHtml(String(x.name))} $${Number(x.total || 0).toFixed(2)}`)
                .join(' · ')}</div>`
            : '';
        const pill =
          sec.categoryPill || sec.locationPill
            ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#ede7f6;color:#4527a0">${escapeHtml(
                String(sec.categoryPill || sec.locationPill || '')
              )}</span>`
            : '';
        const keys = cols.map(c => c.key);
        const subTot =
          rows.length && keys.some(k => /amount|total|cost|dollars|repair/i.test(k))
            ? (() => {
                const numKey = keys.find(k => /amount|total|cost|dollars|repair|actualrepair/i.test(k)) || keys[keys.length - 1];
                const st = rows.reduce((s, r) => s + (Number(r[numKey]) || 0), 0);
                return `<div class="mini-note" style="margin-top:6px;text-align:right;font-weight:600">Sub-total: $${st.toFixed(2)}</div>`;
              })()
            : '';
        const slug = 'rep-grp-' + String(sec.title || sec.key || 'sec')
          .replace(/[^\w.-]+/g, '-')
          .slice(0, 96);
        return bar(border, sec.title || sec.key, sec.recordCount ?? rows.length, sec.totalCost ?? 0, sec.avgCost ?? 0, mixRow + body + subTot, pill, slug);
      })
      .join('');
  }

  function renderSummaryCards(cards, clickable) {
    if (!cards || !cards.length) return '';
    const cells = cards
      .map((c, idx) => {
        const slug =
          'rep-grp-' +
          String(c.scrollKey || c.label || idx)
            .replace(/[^\w.-]+/g, '-')
            .slice(0, 96);
        const cursor = clickable ? 'cursor:pointer' : '';
        const valColor = c.costColor || '#1557a0';
        return `<div class="rep-grp-summary-card" data-scroll="${escapeHtml(slug)}" style="padding:10px;border:1px solid #e0e3eb;border-radius:8px;background:#fff;${cursor}">
          <div style="font-size:11px;color:#6b7385">${escapeHtml(c.label || '')}</div>
          <div style="font-weight:600;font-size:13px;margin-top:4px;color:${valColor}">${escapeHtml(c.value || '')}</div>
        </div>`;
      })
      .join('');
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px">${cells}</div>`;
  }

  function flattenGroupedSectionsForExport(sections) {
    let columns = null;
    for (const sec of sections || []) {
      const cols = sec.columns || [];
      if (cols.length) {
        columns = [{ key: '__section', label: 'Section' }, ...cols];
        break;
      }
    }
    if (!columns) columns = [{ key: '__section', label: 'Section' }];
    const keys = columns.map(c => c.key);
    const rows = [];
    for (const sec of sections || []) {
      const secTitle = sec.title || sec.key || 'Section';
      for (const r of sec.rows || []) {
        const row = { __section: secTitle };
        for (const k of keys) {
          if (k === '__section') continue;
          row[k] = r[k];
        }
        rows.push(row);
      }
    }
    return { columns, rows };
  }

  function flattenPivotForExport(columns, rows) {
    const cols = (columns || []).map(c => ({ key: c.key, label: c.label }));
    const out = (rows || []).map(r => {
      const o = {};
      for (const c of cols) o[c.key] = r[c.key];
      return o;
    });
    return { columns: cols, rows: out };
  }

  function flattenSplitForExport(meta) {
    const rows = [];
    const columns = [
      { key: '__side', label: 'Side' },
      { key: 'label', label: 'Service type / vendor' },
      { key: 'count', label: 'Count' },
      { key: 'totalCost', label: 'Total $' }
    ];
    for (const r of meta.internal?.rows || []) {
      rows.push({ __side: 'internal', label: r.serviceType, count: r.count, totalCost: r.totalCost });
    }
    for (const r of meta.external?.rows || []) {
      rows.push({ __side: 'external', label: r.vendor, count: r.count, totalCost: r.totalCost });
    }
    return { columns, rows };
  }

  function renderPivotTable(columns, rows, monthKeys) {
    const maxVal = Math.max(0.01, ...rows.flatMap(r => monthKeys.map(m => Number(r[m]) || 0)));
    const th = columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('');
    const tr = rows
      .map(r => {
        const tds = columns.map(c => {
          const k = c.key;
          if (monthKeys.includes(k)) {
            const v = Number(r[k]) || 0;
            const intensity = Math.min(1, v / maxVal);
            const bg = `rgba(21,87,160,${0.08 + intensity * 0.85})`;
            return `<td style="background:${bg};text-align:right">${escapeHtml(String(v))}</td>`;
          }
          return `<td>${escapeHtml(String(r[k] ?? ''))}</td>`;
        });
        return `<tr>${tds.join('')}</tr>`;
      })
      .join('');
    return `<table class="rep-dyn-table" style="min-width:520px;font-size:12px;width:100%"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  }

  async function repOpenDataset(datasetId, title) {
    const host = document.getElementById('repDynamicTableHost');
    const fl = document.getElementById('repDynamicFilters');
    const disc = document.getElementById('repDynamicDisclaimer');
    const qLink = document.getElementById('repDynamicQboLink');
    const badge = document.getElementById('repDynamicBadge');
    const ttl = document.getElementById('repDynamicTitle');
    const chart = document.getElementById('repDynamicChart');
    const tmap = document.getElementById('repDynamicTireMap');
    const tot = document.getElementById('repDynamicTotals');
    if (chart) {
      chart.classList.add('hidden');
      chart.innerHTML = '';
    }
    if (tmap) {
      tmap.classList.add('hidden');
      tmap.innerHTML = '';
    }
    if (tot) {
      tot.classList.add('hidden');
      tot.textContent = '';
    }
    if (qLink) qLink.classList.add('hidden');
    if (badge) {
      badge.textContent = ERP;
      badge.hidden = false;
    }
    const r0 = defaultRange();
    const datasetsWithOptionalPosition =
      datasetId === 'a5-tire-history' ||
      datasetId === 'a6-air-bag-history' ||
      datasetId === 'a10-inspection-history' ||
      datasetId === 'a11-parts-positions';
    const showPositionChips =
      datasetId === 'a5-tire-history' ||
      datasetId === 'a6-air-bag-history' ||
      datasetId === 'a11-parts-positions' ||
      datasetId === 'a7-battery-history';
    if (ttl) ttl.textContent = title || datasetId;
    const fpOpts = FILTER_PANEL_DATASETS.has(datasetId) ? filterPanelOptionsFor(datasetId) : null;
    const panelHasPosPick = !!(fpOpts && Array.isArray(fpOpts.features) && fpOpts.features.includes('partPositionsPick'));
    const appendLegacyPositionInput = datasetsWithOptionalPosition && (!fpOpts || !panelHasPosPick);
    if (fl) {
      if (window.ErpReportFilterPanel && fpOpts) {
        fl.innerHTML = '';
        window.ErpReportFilterPanel.mount(fl, fpOpts, {
          onApply: sp => run(sp),
          onReady: sp => run(sp)
        });
        if (appendLegacyPositionInput) {
          const wrap = document.createElement('div');
          wrap.style.marginTop = '8px';
          wrap.innerHTML =
            '<label class="qb-l">Position</label> <input type="text" class="qb-in" id="repDfPosition" placeholder="Optional filter" />';
          fl.appendChild(wrap);
        }
      } else {
        fl.innerHTML = `
        <div><label class="qb-l">Start</label><input type="date" class="qb-in" id="repDfStart" value="${r0.start}" /></div>
        <div><label class="qb-l">End</label><input type="date" class="qb-in" id="repDfEnd" value="${r0.end}" /></div>
        <div><label class="qb-l">Unit</label><input type="text" class="qb-in" id="repDfUnit" placeholder="Optional" /></div>
        ${datasetsWithOptionalPosition ? '<div><label class="qb-l">Position</label><input type="text" class="qb-in" id="repDfPosition" placeholder="Optional" /></div>' : ''}
        <div style="align-self:flex-end"><button type="button" class="btn" id="repDfRun">Run</button></div>
      `;
      }
    }
    if (disc) {
      disc.classList.add('hidden');
      disc.textContent = '';
    }
    if (host) host.innerHTML = '<p class="mini-note">Loading…</p>';

    let lastPanelSp = null;
    const run = async fromPanel => {
      const sp = fromPanel instanceof URLSearchParams ? new URLSearchParams(fromPanel.toString()) : new URLSearchParams();
      const pend = window.__repPendingExtraParams;
      if (pend && pend.datasetId === datasetId && pend.params && typeof pend.params === 'object') {
        window.__repPendingExtraParams = null;
        for (const [k, v] of Object.entries(pend.params)) {
          if (v == null) continue;
          if (Array.isArray(v)) v.forEach(x => sp.append(k, String(x)));
          else sp.set(k, String(v));
        }
      }
      if (fromPanel instanceof URLSearchParams) lastPanelSp = new URLSearchParams(sp.toString());
      if (!(fromPanel instanceof URLSearchParams)) {
        const s = document.getElementById('repDfStart')?.value || '';
        const e = document.getElementById('repDfEnd')?.value || '';
        const u = document.getElementById('repDfUnit')?.value || '';
        const p = document.getElementById('repDfPosition')?.value || '';
        if (s) sp.set('startDate', s);
        if (e) sp.set('endDate', e);
        if (u) sp.set('unit', u);
        if (p) sp.set('position', p);
      } else {
        const ta = fl?.querySelector('.erp-rfp-pos-lines');
        if (ta) {
          sp.delete('positions');
          sp.delete('position');
          ta.value.split('\n').forEach(line => {
            const t = String(line).trim();
            if (t) sp.append('positions', t);
          });
        } else {
          const p = document.getElementById('repDfPosition')?.value || '';
          if (p) sp.set('position', p);
        }
      }
      const rest = DATASET_REST[datasetId];
      const url = rest ? `${rest}?${sp.toString()}` : `/api/reports/dataset?id=${encodeURIComponent(datasetId)}&${sp.toString()}`;
      const data = await j(url);
      if (!data.ok && !(data.rows && data.rows.length)) throw new Error(data.error || data.meta?.error || 'Dataset failed');
      const disclaimer = data.meta?.disclaimer || data.disclaimer;
      if (disc && disclaimer) {
        disc.textContent = [disclaimer, data.meta?.error].filter(Boolean).join(' — ');
        disc.classList.remove('hidden');
      }
      if (host) {
        const layout = data.meta && data.meta.reportLayout;
        if (layout === 'grouped' && Array.isArray(data.meta.sections)) {
          if (!data.meta.sections.length) {
            host.innerHTML = '<p class="mini-note">No rows.</p>';
          } else {
            const groupCards = (data.meta.sections || []).map(sec => {
              const slug = slugifyRepSectionId(sec.title || sec.key || 'sec');
              const tot = Number(sec.totalCost) || 0;
              const cnt = Number(sec.recordCount) || (sec.rows && sec.rows.length) || 0;
              const costColor = tot > 7500 ? '#c62828' : '#1557a0';
              return {
                label: String(sec.title || sec.key || 'Group'),
                value: `${cnt} rec · $${tot.toFixed(2)}`,
                scrollKey: slug,
                costColor
              };
            });
            const metaCards = (data.meta.summaryCards || []).map(c => ({ label: c.label, value: c.value, scrollKey: '' }));
            const top = renderSummaryCards([...metaCards, ...groupCards], true);
            const secHtml = renderGroupedSections(data.meta.sections);
            const expandBar = `<div style="margin:8px 0">
            <button type="button" class="btn btn--sm" id="repExpandAll">Expand all sections</button>
            <button type="button" class="btn btn--sm" id="repCollapseAll" style="margin-left:6px">Collapse all sections</button>
          </div>`;
            host.innerHTML = top + expandBar + (secHtml || '<p class="mini-note">No rows.</p>');
            host.querySelectorAll('.rep-grp-summary-card[data-scroll]').forEach(el => {
              el.addEventListener('click', () => {
                const id = el.getAttribute('data-scroll');
                if (!id) return;
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              });
            });
            host.querySelectorAll('details.rep-grp-sec').forEach(d => {
              d.addEventListener('toggle', () => {
                const chev = d.querySelector('.rep-grp-chev');
                if (chev) chev.textContent = d.open ? '▼' : '▶';
              });
            });
            host.querySelector('#repExpandAll')?.addEventListener('click', () => {
              host.querySelectorAll('details.rep-grp-sec').forEach(d => {
                d.open = true;
              });
            });
            host.querySelector('#repCollapseAll')?.addEventListener('click', () => {
              host.querySelectorAll('details.rep-grp-sec').forEach(d => {
                d.open = false;
              });
            });
            bindSortable(host);
          }
        } else if (layout === 'pivot' && data.meta.pivotMonths) {
          const months = data.meta.pivotMonths;
          host.innerHTML = renderPivotTable(data.columns || [], data.rows || [], months);
          bindSortable(host);
        } else if (layout === 'split' && data.meta.internal && data.meta.external) {
          const left = renderSortableTable(
            [
              { key: 'serviceType', label: 'Service type' },
              { key: 'count', label: 'Count' },
              { key: 'totalCost', label: 'Total $' }
            ],
            data.meta.internal.rows || []
          );
          const right = renderSortableTable(
            [
              { key: 'vendor', label: 'Vendor' },
              { key: 'count', label: 'Count' },
              { key: 'totalCost', label: 'Total $' }
            ],
            data.meta.external.rows || []
          );
          const hint = data.meta?.inHouseHint
            ? `<p class="mini-note" style="margin:0 0 10px;max-width:920px">${escapeHtml(String(data.meta.inHouseHint))}</p>`
            : '';
          host.innerHTML =
            renderSummaryCards(data.meta.summaryCards || [], false) +
            hint +
            `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start">
              <div><h4 style="margin:0 0 6px;font-size:13px">Internal shop</h4>${left}</div>
              <div><h4 style="margin:0 0 6px;font-size:13px">External vendors</h4>${right}</div>
            </div>`;
          bindSortable(host);
        } else if (data.rows && data.rows.length) {
          if (datasetId === 'a4-pm-schedule') {
            host.innerHTML = renderPmScheduleTable(data.columns, data.rows, data.meta?.fleetAvgMilesPerMonth);
          } else {
            host.innerHTML = renderSortableTable(data.columns, data.rows, maintRowClassFromRow);
            if (datasetId === 'm6-location-summary' && data.columns && data.columns[0]?.key === 'locationName') {
              host.querySelectorAll('tbody tr').forEach(tr => {
                const cell = tr.querySelector('td');
                const name = (cell && cell.textContent ? cell.textContent : '').trim();
                if (!name || !cell) return;
                cell.style.cursor = 'pointer';
                cell.style.color = '#1557a0';
                cell.style.textDecoration = 'underline';
                cell.title = 'Open work by service location for this site';
                cell.addEventListener('click', () => {
                  window.__repPendingExtraParams = {
                    datasetId: 'm4-work-by-location',
                    params: { locations: [name] }
                  };
                  void repOpenDataset('m4-work-by-location', 'Work by service location');
                });
              });
            }
          }
          bindSortable(host);
        } else {
          host.innerHTML = '<p class="mini-note">No rows.</p>';
        }
      }
      if (data.meta && Array.isArray(data.meta.positions) && tmap && showPositionChips) {
        tmap.classList.remove('hidden');
        tmap.innerHTML =
          '<div class="mini-note" style="margin-bottom:6px">Filter by position</div><div class="rep-pos-chips">' +
          data.meta.positions
            .map(p => `<button type="button" class="chip">${escapeHtml(String(p))}</button>`)
            .join('') +
          '</div>';
        tmap.querySelectorAll('button.chip').forEach(btn => {
          btn.addEventListener('click', () => {
            const chip = (btn.textContent || '').trim();
            const ta = fl?.querySelector('.erp-rfp-pos-lines');
            const inp = document.getElementById('repDfPosition');
            if (ta) {
              const cur = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
              if (chip && !cur.includes(chip)) cur.push(chip);
              ta.value = cur.join('\n');
            } else if (inp) {
              inp.value = chip;
            }
            const merged =
              lastPanelSp instanceof URLSearchParams
                ? new URLSearchParams(lastPanelSp.toString())
                : new URLSearchParams();
            if (ta) {
              merged.delete('positions');
              merged.delete('position');
              ta.value.split('\n').forEach(line => {
                const t = String(line).trim();
                if (t) merged.append('positions', t);
              });
            } else if (inp?.value) merged.set('position', inp.value);
            run(merged).catch(err => {
              if (host) host.innerHTML = `<p class="mini-note" style="color:var(--color-semantic-error)">${escapeHtml(err.message)}</p>`;
            });
          });
        });
      }
      if (window.__repDynChart) {
        try {
          window.__repDynChart.destroy();
        } catch (_) {}
        window.__repDynChart = null;
      }
      if (datasetId === 'm3-repair-vs-maintenance' && data.meta?.chartStacked && window.Chart && chart && data.rows && data.rows.length) {
        chart.classList.remove('hidden');
        const benchPct = Number(data.meta.benchmarkRepairPct);
        const pctLabel = Number.isFinite(benchPct) ? benchPct : 30;
        chart.innerHTML = `<canvas height="260"></canvas><p class="mini-note" style="margin:6px 0 0">Dashed line: ${pctLabel}% of period total spend (repair benchmark band).</p>`;
        const canvas = chart.querySelector('canvas');
        const labels = data.rows.map(r => String(r.month ?? '—'));
        const series = data.meta.chartSeries || [];
        const barDatasets = series.map(s => ({
          type: 'bar',
          label: s.label,
          data: data.rows.map(r => Number(r[s.key]) || 0),
          backgroundColor: s.color || '#1557a0',
          stack: 's'
        }));
        const pct = (Number.isFinite(benchPct) ? benchPct : 30) / 100;
        const benchLine = {
          type: 'line',
          label: `${pctLabel}% of total (benchmark)`,
          data: data.rows.map(r => (Number(r.totalDollars) || 0) * pct),
          borderColor: '#6200ea',
          borderWidth: 2,
          borderDash: [6, 4],
          fill: false,
          pointRadius: 0,
          order: 99
        };
        window.__repDynChart = new Chart(canvas.getContext('2d'), {
          type: 'bar',
          data: { labels, datasets: [...barDatasets, benchLine] },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { stacked: true, grid: { color: '#eee' } },
              y: { stacked: true, grid: { color: '#eee' }, beginAtZero: true }
            },
            plugins: { legend: { position: 'bottom' } }
          }
        });
      } else if (data.meta?.hasChart && window.Chart && chart) {
        let labels = [];
        let values = [];
        if (data.meta.chartSource === 'sections' && Array.isArray(data.meta.sections)) {
          const pairs = data.meta.sections.slice(0, 18).map(s => ({
            lab: String(s.title ?? s.key ?? '—'),
            val: Number(s.totalCost) || 0
          }));
          pairs.sort((a, b) => b.val - a.val);
          labels = pairs.map(p => p.lab);
          values = pairs.map(p => p.val);
        } else if (data.rows && data.rows.length) {
          const xk = data.meta.chartXKey || 'unit';
          const yk = data.meta.chartYKey || 'totalDollars';
          labels = data.rows.slice(0, 16).map(r => String(r[xk] ?? '—'));
          values = data.rows.slice(0, 16).map(r => Number(r[yk]) || 0);
        }
        if (labels.length) {
          chart.classList.remove('hidden');
          chart.innerHTML = '<canvas height="240"></canvas>';
          const canvas = chart.querySelector('canvas');
          const type = data.meta.chartType === 'pie' ? 'pie' : data.meta.chartType === 'line' ? 'line' : 'bar';
          const horizBar =
            datasetId === 'm1-expense-by-service-type' &&
            type === 'bar' &&
            data.meta.chartSource === 'sections';
          const cfg =
            type === 'pie'
              ? {
                  type: 'pie',
                  data: {
                    labels,
                    datasets: [
                      {
                        data: values,
                        backgroundColor: ['#1557a0', '#2e7d32', '#6a1b9a', '#ef6c00', '#c62828', '#00838f', '#4527a0', '#558b2f']
                      }
                    ]
                  },
                  options: { plugins: { legend: { position: 'bottom' } } }
                }
              : {
                  type: type === 'line' ? 'line' : 'bar',
                  data: {
                    labels,
                    datasets: [
                      {
                        label: data.meta.chartYKey || 'total',
                        data: values,
                        backgroundColor: type === 'line' ? 'rgba(21,87,160,0.2)' : '#1557a0',
                        borderColor: '#1557a0',
                        borderWidth: type === 'line' ? 2 : 0,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4
                      }
                    ]
                  },
                  options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: horizBar ? 'y' : 'x',
                    scales: horizBar
                      ? {
                          x: { grid: { color: '#eee' }, beginAtZero: true },
                          y: { grid: { color: '#eee' }, ticks: { autoSkip: false, font: { size: 10 } } }
                        }
                      : {
                          x: { grid: { color: '#eee' } },
                          y: { grid: { color: '#eee' }, beginAtZero: true }
                        },
                    plugins: { legend: { display: false } }
                  }
                };
          const chartInst = new Chart(canvas.getContext('2d'), cfg);
          window.__repDynChart = chartInst;
          if (data.meta.chartSource === 'sections' && data.meta.reportLayout === 'grouped') {
            canvas.style.cursor = 'pointer';
            canvas.onclick = ev => {
              const pts = chartInst.getElementsAtEventForMode(ev, 'nearest', { intersect: true }, true);
              if (!pts || !pts.length) return;
              const i = pts[0].index;
              const lab = labels[i];
              if (!lab) return;
              const id = slugifyRepSectionId(lab);
              document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            };
          }
        }
      } else if (
        (datasetId === 'a2-cost-by-unit' || datasetId === 'a3-cost-by-service-type' || datasetId === 'd1-fuel-cost-by-unit') &&
        chart &&
        data.rows &&
        data.rows.length
      ) {
        chart.classList.remove('hidden');
        chart.innerHTML =
          '<p class="mini-note" style="margin:0 0 6px">Bar preview (log-scaled width).</p><div class="rep-bar-preview">' +
          data.rows
            .slice(0, 14)
            .map(r => {
              const label = r.unit || r.serviceType || r.driver || r.customer || '—';
              const val = Number(r.totalDollars ?? r.total ?? r.revenue ?? 0) || 0;
              const w = Math.min(100, Math.max(6, val > 0 ? Math.log10(val + 1) * 28 : 6));
              return `<div class="rep-bar-row"><span style="min-width:90px">${escapeHtml(String(label))}</span><span class="rep-bar-track"><span class="rep-bar-fill" style="width:${w}%"></span></span><span>$${val.toFixed(0)}</span></div>`;
            })
            .join('') +
          '</div>';
      }
      if (tot && data.totals) {
        tot.classList.remove('hidden');
        tot.textContent = 'Totals: ' + escapeHtml(JSON.stringify(data.totals));
      }
      const s = sp.get('startDate') || '';
      const e = sp.get('endDate') || '';
      const uu = sp.getAll('units');
      const u = uu.length ? uu.join(',') : sp.get('unit') || '';
      const layout = data.meta && data.meta.reportLayout;
      let exportColumns = data.columns || [];
      let exportRows = data.rows || [];
      if (layout === 'grouped' && Array.isArray(data.meta.sections) && data.meta.sections.length) {
        const flat = flattenGroupedSectionsForExport(data.meta.sections);
        exportColumns = flat.columns;
        exportRows = flat.rows;
      } else if (layout === 'pivot' && data.meta.pivotMonths && (data.rows || []).length) {
        const flat = flattenPivotForExport(data.columns, data.rows);
        exportColumns = flat.columns;
        exportRows = flat.rows;
      } else if (layout === 'split' && data.meta.internal && data.meta.external) {
        const flat = flattenSplitForExport(data.meta);
        exportColumns = flat.columns;
        exportRows = flat.rows;
      }
      window.__repDynState = {
        kind: 'dataset',
        datasetId,
        title: data.title || title,
        subtitle: [s, e].filter(Boolean).join(' → '),
        columns: exportColumns,
        rows: exportRows,
        totals: data.totals || {},
        startDate: s,
        endDate: e,
        unitTag: u,
        reportLayout: layout || 'tabular',
        groupedSections: layout === 'grouped' && Array.isArray(data.meta.sections) ? data.meta.sections : null,
        filtersApplied: searchParamsToFilterRecord(sp)
      };
      repSaveRecent(datasetId, data.title || title);
    };

    if (!fpOpts || !window.ErpReportFilterPanel) {
      document.getElementById('repDfRun')?.addEventListener('click', () => {
        run().catch(err => {
          if (host) host.innerHTML = `<p class="mini-note" style="color:var(--color-semantic-error)">${escapeHtml(err.message)}</p>`;
        });
      });
      await run().catch(err => {
        if (host) host.innerHTML = `<p class="mini-note" style="color:var(--color-semantic-error)">${escapeHtml(err.message)}</p>`;
      });
    }

    if (typeof openReportsTab === 'function') openReportsTab('rep-dynamic', null);
  }

  async function repOpenQbo(reportName, title) {
    const host = document.getElementById('repDynamicTableHost');
    const fl = document.getElementById('repDynamicFilters');
    const disc = document.getElementById('repDynamicDisclaimer');
    const qLink = document.getElementById('repDynamicQboLink');
    const badge = document.getElementById('repDynamicBadge');
    const ttl = document.getElementById('repDynamicTitle');
    if (badge) {
      badge.textContent = QBO;
      badge.hidden = false;
    }
    if (ttl) ttl.textContent = title || reportName;
    if (disc) {
      disc.textContent =
        'Data sourced from QuickBooks Online. Columns follow the QBO report layout; use View in QuickBooks for native drill-down.';
      disc.classList.remove('hidden');
    }
    const r0 = defaultRange();
    if (fl) {
      fl.innerHTML = `
        <div><label class="qb-l">Start date</label><input type="date" class="qb-in" id="repQbStart" value="${r0.start}" /></div>
        <div><label class="qb-l">End date</label><input type="date" class="qb-in" id="repQbEnd" value="${r0.end}" /></div>
        <div><label class="qb-l">Accounting</label>
          <select class="qb-in" id="repQbAcct"><option value="Accrual">Accrual</option><option value="Cash">Cash</option></select>
        </div>
        <div style="align-self:flex-end"><button type="button" class="btn" id="repQbRun">Run</button></div>
      `;
    }
    if (qLink) {
      qLink.classList.remove('hidden');
      qLink.href = 'https://app.qbo.intuit.com/app/reports';
    }
    if (host) host.innerHTML = '<p class="mini-note">Loading QuickBooks report…</p>';

    const run = async () => {
      const s = document.getElementById('repQbStart')?.value || '';
      const e = document.getElementById('repQbEnd')?.value || '';
      const acct = document.getElementById('repQbAcct')?.value || 'Accrual';
      const sp = new URLSearchParams();
      if (s) sp.set('start_date', s);
      if (e) sp.set('end_date', e);
      sp.set('accounting_method', acct);
      const data = await j('/api/reports/qbo/' + encodeURIComponent(reportName) + '?' + sp.toString());
      if (data.meta?.error) throw new Error(data.meta.error);
      if (data.qboViewUrl) qLink.href = data.qboViewUrl;
      let flat = { columns: data.columns || [], rows: data.rows || [] };
      if (!flat.rows.length) {
        const legacy = await j('/api/qbo/report/' + encodeURIComponent(reportName) + '?' + sp.toString());
        if (!legacy.ok) throw new Error(legacy.error || 'QBO report failed');
        if (legacy.viewUrl) qLink.href = legacy.viewUrl;
        flat = flattenQboReportForTable(legacy.report);
      }
      if (host) {
        host.innerHTML =
          flat.rows.length > 0
            ? renderSortableTable(flat.columns, flat.rows)
            : `<pre class="mini-note" style="white-space:pre-wrap;max-height:420px;overflow:auto">${escapeHtml(JSON.stringify(data.report, null, 2).slice(0, 12000))}</pre>`;
        bindSortable(host);
      }
      window.__repDynState = {
        kind: 'qbo',
        title: title || reportName,
        subtitle: `${s} → ${e} (${acct})`,
        columns: flat.columns,
        rows: flat.rows,
        totals: data.totals || {},
        startDate: s,
        endDate: e
      };
    };
    document.getElementById('repQbRun')?.addEventListener('click', () => {
      run().catch(err => {
        if (host) host.innerHTML = `<p class="mini-note" style="color:var(--color-semantic-error)">${escapeHtml(err.message)}</p>`;
      });
    });
    await run().catch(err => {
      if (host) host.innerHTML = `<p class="mini-note" style="color:var(--color-semantic-error)">${escapeHtml(err.message)}</p>`;
    });
    if (typeof openReportsTab === 'function') openReportsTab('rep-dynamic', null);
  }

  function repDotCfgAppendList(qs, key, raw) {
    const parts = String(raw || '')
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
    for (const p of parts) qs.append(key, p);
  }

  function repDotCfgBuildQuery() {
    const qs = new URLSearchParams();
    const s = document.getElementById('repDotCfgStart')?.value || '';
    const e = document.getElementById('repDotCfgEnd')?.value || '';
    if (s) qs.set('startDate', s);
    if (e) qs.set('endDate', e);
    const mode = document.querySelector('input[name="repDotCfgScope"]:checked')?.value || 'single';
    if (mode === 'fleet') {
      const ids = document.getElementById('repDotCfgUnitIds')?.value || '';
      if (ids.trim()) repDotCfgAppendList(qs, 'unitIds', ids);
      else qs.set('all', 'true');
    } else {
      const u = document.getElementById('repDotCfgUnit')?.value?.trim();
      if (u) qs.set('unitHint', u);
    }
    const gb = document.querySelector('input[name="repDotCfgGroupBy"]:checked')?.value || 'service_type';
    qs.set('groupBy', gb);
    const fmt = document.querySelector('input[name="repDotCfgFormat"]:checked')?.value || 'full';
    qs.set('reportFormat', fmt);
    document.querySelectorAll('.rep-dot-sec-cb:checked').forEach(cb => qs.append('sections', cb.value));
    repDotCfgAppendList(qs, 'recordTypes', document.getElementById('repDotCfgRecTypes')?.value);
    repDotCfgAppendList(qs, 'serviceTypes', document.getElementById('repDotCfgSvcTypes')?.value);
    repDotCfgAppendList(qs, 'locations', document.getElementById('repDotCfgLocs')?.value);
    repDotCfgAppendList(qs, 'vendors', document.getElementById('repDotCfgVendors')?.value);
    if (document.getElementById('repDotCfgDefects')?.checked) qs.set('defectsOnly', 'true');
    if (document.getElementById('repDotCfgPosted')?.checked) qs.set('postedQbo', 'y');
    if (document.getElementById('repDotCfgDotAcc')?.checked) qs.append('dotReportable', 'y');
    const ie = document.getElementById('repDotCfgIncludeEmpty');
    if (ie && !ie.checked) qs.set('includeEmpty', 'false');
    return qs;
  }

  function repOpenDotAuditConfigurator() {
    const host = document.getElementById('repDynamicTableHost');
    const fl = document.getElementById('repDynamicFilters');
    const ttl = document.getElementById('repDynamicTitle');
    if (ttl) ttl.textContent = 'DOT audit report configuration';
    if (fl) {
      fl.innerHTML = '';
      const r = defaultRange();
      const y = new Date();
      const yEnd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
      const y12 = new Date();
      y12.setMonth(y12.getMonth() - 12);
      const start12 = `${y12.getFullYear()}-${String(y12.getMonth() + 1).padStart(2, '0')}-${String(y12.getDate()).padStart(2, '0')}`;
      fl.innerHTML = `<div class="form-stack" style="max-width:720px;line-height:1.45">
        <div class="qb-l">Vehicle scope</div>
        <label style="font-size:12px"><input type="radio" name="repDotCfgScope" value="single" checked /> Single unit (PDF + JSON)</label>
        <label style="font-size:12px;margin-left:12px"><input type="radio" name="repDotCfgScope" value="fleet" /> Fleet audit (JSON only)</label>
        <label class="qb-l" style="margin-top:8px">Unit number</label>
        <input type="text" class="qb-in" id="repDotCfgUnit" placeholder="e.g. 101" />
        <label class="qb-l">Fleet unit ids (comma / newline) — optional</label>
        <textarea class="qb-memo" id="repDotCfgUnitIds" rows="2" placeholder="Leave blank + fleet scope = all units with work orders"></textarea>
        <div class="qb-l" style="margin-top:10px">Date range</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input type="date" class="qb-in" id="repDotCfgStart" value="${start12}" />
          <span class="mini-note">to</span>
          <input type="date" class="qb-in" id="repDotCfgEnd" value="${yEnd}" />
        </div>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
          ${['Last 12 months', 'Last 24 months', 'Last 3 years', 'Year to date', 'Custom']
            .map(
              lab =>
                `<button type="button" class="chip rep-dot-date-chip" data-preset="${lab.toLowerCase().replace(/\s+/g, '_')}">${lab}</button>`
            )
            .join('')}
        </div>
        <div class="qb-l" style="margin-top:10px">Sections to include</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;font-size:12px">
          <label><input type="checkbox" class="rep-dot-sec-cb" value="vehicle_info" checked /> Vehicle identification</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="annual_inspections" checked /> Annual inspections</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="pm_history" checked /> PM / preventive history</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="repair_history" checked /> Repair register (chronological)</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="work_orders_by_type" checked /> WO buckets by service type (4A–4H)</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="section4i_service_locations" checked /> Service locations (4I)</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="accident_history" checked /> Accident history</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="dvir_history" checked /> DVIR history</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="out_of_service" checked /> Out of service</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="tire_records" checked /> Tire records</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="section4_air_bag" checked /> Air bag history (4E)</label>
          <label><input type="checkbox" class="rep-dot-sec-cb" value="section4_battery" checked /> Battery history (4F)</label>
        </div>
        <div class="qb-l" style="margin-top:10px">Group work orders (PDF part 4 buckets)</div>
        <label style="font-size:12px"><input type="radio" name="repDotCfgGroupBy" value="service_type" checked /> By service type</label>
        <label style="font-size:12px;margin-left:10px"><input type="radio" name="repDotCfgGroupBy" value="date" /> Chronological (hide category buckets)</label>
        <div class="qb-l" style="margin-top:10px">Service filters (optional)</div>
        <span class="mini-note">Comma or newline separated lists → query params.</span>
        <label class="qb-l">Record types</label><input type="text" class="qb-in" id="repDotCfgRecTypes" placeholder="e.g. repair, pm_service" />
        <label class="qb-l">Service types</label><input type="text" class="qb-in" id="repDotCfgSvcTypes" placeholder="Oil change, Brakes…" />
        <label class="qb-l">Locations</label><input type="text" class="qb-in" id="repDotCfgLocs" placeholder="Shop name…" />
        <label class="qb-l">Vendors</label><input type="text" class="qb-in" id="repDotCfgVendors" placeholder="Vendor name…" />
        <div class="qb-l" style="margin-top:10px">Show only</div>
        <label style="font-size:12px"><input type="checkbox" id="repDotCfgDefects" /> Records with defects / issues</label>
        <label style="font-size:12px;margin-left:10px"><input type="checkbox" id="repDotCfgPosted" /> Posted to QuickBooks</label>
        <label style="font-size:12px;margin-left:10px"><input type="checkbox" id="repDotCfgDotAcc" /> DOT-reportable accidents only</label>
        <label style="font-size:12px;margin-left:10px"><input type="checkbox" id="repDotCfgIncludeEmpty" checked /> Include empty section shells</label>
        <div class="qb-l" style="margin-top:10px">Format</div>
        <label style="font-size:12px"><input type="radio" name="repDotCfgFormat" value="full" checked /> Full detail</label>
        <label style="font-size:12px;margin-left:10px"><input type="radio" name="repDotCfgFormat" value="summary" /> Summary</label>
        <label style="font-size:12px;margin-left:10px"><input type="radio" name="repDotCfgFormat" value="compliance" /> Compliance focus</label>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn" id="repDotCfgPreview">Preview JSON</button>
          <button type="button" class="btn" style="background:#1557a0;color:#fff;border-color:#1557a0" id="repDotCfgPreviewPdf">Preview PDF</button>
          <button type="button" class="btn" style="background:#1b5e20;color:#fff;border-color:#1b5e20" id="repDotCfgPdf">Generate PDF</button>
        </div>
      </div>`;
      const setDates = (start, end) => {
        const si = document.getElementById('repDotCfgStart');
        const ei = document.getElementById('repDotCfgEnd');
        if (si) si.value = start;
        if (ei) ei.value = end;
      };
      fl.querySelectorAll('.rep-dot-date-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const pr = btn.getAttribute('data-preset') || '';
          const end = new Date();
          const endS = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
          let st = new Date(end);
          if (pr === 'last_12_months') st.setMonth(st.getMonth() - 12);
          else if (pr === 'last_24_months') st.setMonth(st.getMonth() - 24);
          else if (pr === 'last_3_years') st.setFullYear(st.getFullYear() - 3);
          else if (pr === 'year_to_date') st = new Date(end.getFullYear(), 0, 1);
          else if (pr === 'custom') return;
          const startS = `${st.getFullYear()}-${String(st.getMonth() + 1).padStart(2, '0')}-${String(st.getDate()).padStart(2, '0')}`;
          setDates(startS, endS);
        });
      });
      document.getElementById('repDotCfgPreview')?.addEventListener('click', () => {
        const qs = repDotCfgBuildQuery();
        const mode = document.querySelector('input[name="repDotCfgScope"]:checked')?.value || 'single';
        if (mode === 'fleet') {
          window.open('/api/reports/dot/fleet-audit?' + qs.toString(), '_blank', 'noopener');
          return;
        }
        const u = document.getElementById('repDotCfgUnit')?.value?.trim();
        if (!u) return alert('Enter a unit.');
        window.open('/api/reports/dot/vehicle-audit/' + encodeURIComponent(u) + '?' + qs.toString(), '_blank', 'noopener');
      });
      document.getElementById('repDotCfgPdf')?.addEventListener('click', () => {
        const mode = document.querySelector('input[name="repDotCfgScope"]:checked')?.value || 'single';
        if (mode === 'fleet') return alert('PDF is per vehicle — choose single unit or open fleet JSON.');
        const u = document.getElementById('repDotCfgUnit')?.value?.trim();
        if (!u) return alert('Enter a unit.');
        const qs = repDotCfgBuildQuery();
        window.open('/api/reports/dot-audit/' + encodeURIComponent(u) + '/pdf?' + qs.toString(), '_blank', 'noopener');
      });
      document.getElementById('repDotCfgPreviewPdf')?.addEventListener('click', () => {
        const mode = document.querySelector('input[name="repDotCfgScope"]:checked')?.value || 'single';
        if (mode === 'fleet') return alert('PDF is per vehicle — choose single unit.');
        const u = document.getElementById('repDotCfgUnit')?.value?.trim();
        if (!u) return alert('Enter a unit.');
        const qs = repDotCfgBuildQuery();
        window.open('/api/reports/dot-audit/' + encodeURIComponent(u) + '/pdf?' + qs.toString(), '_blank', 'noopener');
      });
    }
    if (host)
      host.innerHTML =
        '<p class="mini-note">Configure filters, then <strong>Preview JSON</strong> (vehicle or fleet) or <strong>Generate PDF</strong> (single unit). Query params are forwarded to the audit builder.</p>';
    if (typeof openReportsTab === 'function') openReportsTab('rep-dynamic', null);
  }

  function repOpenDotPdf() {
    const u = prompt('Enter unit number (vehicle name) for DOT audit PDF:');
    if (!u) return;
    const r = defaultRange();
    const qs = `?startDate=${encodeURIComponent(r.start)}&endDate=${encodeURIComponent(r.end)}`;
    window.open('/api/reports/dot-audit/' + encodeURIComponent(u.trim()) + '/pdf' + qs, '_blank', 'noopener');
  }

  function renderCatalogGrid() {
    const grid = document.getElementById('repCatalogGrid');
    if (!grid) return;
    const items = REP_ITEMS.filter(x => x.cat === __repCat);
    const SUB_ORDER = ['Cost analysis', 'Service history', 'Location analysis', 'Other'];
    const cardHtml = it => {
      const kid = 'repk-' + String(it.title.replace(/[^\w]+/g, '-')).slice(0, 48);
      return `<button type="button" class="rep-catalog-card" id="${kid}" data-rep-title="${escapeHtml(it.title)}" data-rep-k="${escapeHtml(it.keywords)}" data-cat="${escapeHtml(it.cat)}">
          <span class="rep-catalog-card__src">${escapeHtml(it.source)}</span>
          <span class="rep-catalog-card__title">${escapeHtml(it.title)}</span>
          <span class="rep-catalog-card__desc">${escapeHtml(it.desc)}</span>
        </button>`;
    };
    if (__repCat === 'maintenance') {
      const bySub = {};
      for (const it of items) {
        const s = it.subsection || 'Other';
        if (!bySub[s]) bySub[s] = [];
        bySub[s].push(it);
      }
      const parts = [];
      for (const sub of SUB_ORDER) {
        const list = bySub[sub];
        if (!list || !list.length) continue;
        parts.push(
          `<div class="rep-catalog-sub" style="margin-bottom:14px">
            <h3 class="rep-catalog-sub__title" style="font-size:13px;margin:0 0 8px;color:#1a1f36">${escapeHtml(sub)}</h3>
            <div class="rep-catalog-subgrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${list.map(cardHtml).join('')}</div>
          </div>`
        );
        delete bySub[sub];
      }
      for (const sub of Object.keys(bySub).sort()) {
        const list = bySub[sub];
        if (!list.length) continue;
        parts.push(
          `<div class="rep-catalog-sub" style="margin-bottom:14px">
            <h3 class="rep-catalog-sub__title" style="font-size:13px;margin:0 0 8px;color:#1a1f36">${escapeHtml(sub)}</h3>
            <div class="rep-catalog-subgrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${list.map(cardHtml).join('')}</div>
          </div>`
        );
      }
      grid.innerHTML = parts.join('');
    } else {
      grid.innerHTML = items.map(cardHtml).join('');
    }
    grid.querySelectorAll('.rep-catalog-card').forEach(btn => {
      const t = btn.getAttribute('data-rep-title');
      const it = items.find(x => x.title === t);
      if (!it) return;
      btn.addEventListener('click', () => {
        if (it.custom === 'new') {
          if (typeof repReportsRoadmapMsg === 'function') repReportsRoadmapMsg('custom');
          return;
        }
        if (it.custom === 'dot-audit-config') {
          repOpenDotAuditConfigurator();
          return;
        }
        if (it.custom === 'integrity-dashboard') {
          if (typeof openReportsTabFromSidebar === 'function') openReportsTabFromSidebar('rep-integrity');
          else if (typeof openReportsTab === 'function') openReportsTab('rep-integrity', null);
          return;
        }
        if (it.custom === 'scheduled') {
          if (typeof repReportsRoadmapMsg === 'function') repReportsRoadmapMsg('scheduled');
          return;
        }
        if (it.legacy) {
          if (typeof openReportsTabFromSidebar === 'function') openReportsTabFromSidebar(it.legacy);
          return;
        }
        if (it.dataset === 'g2-driver-dot-audit') {
          const id = prompt('Driver id or name slug for DOT driver audit:');
          if (!id) return;
          window.open('/api/reports/dot/driver-audit/' + encodeURIComponent(id.trim()), '_blank', 'noopener');
          return;
        }
        if (it.dataset) {
          void repOpenDataset(it.dataset, it.title);
          return;
        }
        if (it.qbo) {
          void repOpenQbo(it.qbo, it.title);
          return;
        }
        if (it.dotPdf) repOpenDotPdf();
      });
    });
    const q = (document.getElementById('repToolbarSearch')?.value || '').trim().toLowerCase();
    if (q) {
      grid.querySelectorAll('.rep-catalog-card').forEach(c => {
        const t = (c.textContent || '').toLowerCase();
        const k = (c.getAttribute('data-rep-k') || '').toLowerCase();
        c.classList.toggle('rep-filter-hidden', !(t.includes(q) || k.includes(q)));
      });
    }
  }

  function repSwitchReportCategory(cat, btn) {
    __repCat = cat;
    document.querySelectorAll('#repCatTabs .rep-cat-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderCatalogGrid();
  }

  window.repInitReportsHub = function repInitReportsHub() {
    repHookFilterOnce();
    const tabs = document.getElementById('repCatTabs');
    if (!tabs || tabs.dataset.bound === '1') {
      renderCatalogGrid();
      return;
    }
    tabs.dataset.bound = '1';
    tabs.innerHTML = REP_CATS.map(
      (c, i) =>
        `<button type="button" role="tab" class="rep-cat-tab${i === 0 ? ' active' : ''}" data-cat="${c.id}" data-rep-k="${escapeHtml(c.label)} ${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`
    ).join('');
    tabs.querySelectorAll('.rep-cat-tab').forEach(b => {
      b.addEventListener('click', () => repSwitchReportCategory(b.getAttribute('data-cat'), b));
    });
    repSwitchReportCategory('overview', tabs.querySelector('.rep-cat-tab'));
  };

  window.repDynamicBack = repDynamicBack;
  window.repDynamicPrint = repDynamicPrint;
  window.repDynamicExport = repDynamicExport;
  window.repOpenDataset = repOpenDataset;
  window.repOpenQbo = repOpenQbo;
  window.repOpenDotAuditConfigurator = repOpenDotAuditConfigurator;

  function repHookFilterOnce() {
    if (window.__repFilterCatalogHooked) return;
    const origFilter = window.repFilterReports;
    if (typeof origFilter !== 'function') return;
    window.__repFilterCatalogHooked = true;
    const wrapped = function (q) {
      origFilter(q);
      const ql = String(q || '')
        .trim()
        .toLowerCase();
      const match = s => !ql || String(s || '').toLowerCase().includes(ql);
      document.querySelectorAll('#repCatTabs .rep-cat-tab').forEach(btn => {
        const lab = btn.textContent || '';
        const id = btn.getAttribute('data-cat') || '';
        const ok = match(lab) || match(id);
        btn.classList.toggle('rep-filter-hidden', ql.length > 0 && !ok);
      });
      document.querySelectorAll('#repCatalogGrid .rep-catalog-card').forEach(card => {
        const keys = (card.getAttribute('data-rep-k') || '').toLowerCase();
        const ok = match(card.textContent) || (keys && match(keys));
        card.classList.toggle('rep-filter-hidden', ql.length > 0 && !ok);
      });
    };
    window.repFilterReports = wrapped;
  }
})();

