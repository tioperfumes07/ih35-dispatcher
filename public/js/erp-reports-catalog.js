/**
 * Reports hub: 8 category tabs + card grid + dataset / QBO viewer (#rep-dynamic).
 * Depends on maintenance inline helpers: j(), escapeHtml(), openReportsTab(), erpNotify().
 */
(function () {
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

  /** @type {{cat:string,title:string,desc:string,source:string,keywords:string,dataset?:string,qbo?:string,legacy?:string,dotPdf?:boolean,fleetPdf?:boolean}[]} */
  const REP_ITEMS = [];

  function add(cat, title, desc, source, keywords, extra = {}) {
    REP_ITEMS.push({ cat, title, desc, source, keywords: keywords.toLowerCase(), ...extra });
  }

  add('overview', 'Executive overview', 'Metric board + Refresh reports', ERP, 'overview dashboard executive', { legacy: 'rep-overview' });
  add('overview', 'TMS loads', 'Postgres pipeline counts', ERP, 'tms loads trips', { legacy: 'rep-tms' });
  add('overview', 'Settlement / P&L by load', 'Per-load rollup when TMS on', ERP, 'settlement pnl profit', { legacy: 'rep-settlement' });
  add('overview', 'Team & security', 'Sign-in posture', ERP, 'team security users', { legacy: 'rep-team' });

  add('maintenance', 'Work order history', 'Filters + totals', ERP, 'work order history wo', { dataset: 'a1-work-order-history' });
  add('maintenance', 'Cost by unit', 'Bar + table', ERP, 'cost unit spend', { dataset: 'a2-cost-by-unit' });
  add('maintenance', 'Cost by service type', 'Pie + table', ERP, 'service type spend', { dataset: 'a3-cost-by-service-type' });
  add('maintenance', 'PM schedule', 'Miles-based status colors', ERP, 'pm preventive schedule', { dataset: 'a4-pm-schedule' });
  add('maintenance', 'Tire history', 'Position map filter', ERP, 'tire position', { dataset: 'a5-tire-history' });
  add('maintenance', 'Air bag history', 'Position map', ERP, 'air bag suspension', { dataset: 'a6-air-bag-history' });
  add('maintenance', 'Battery history', 'Parts + cost', ERP, 'battery', { dataset: 'a7-battery-history' });
  add('maintenance', 'Accident / collision', 'Fault + insurance fields', ERP, 'accident collision police', { dataset: 'a8-accident-collision' });
  add('maintenance', 'Fleet repair summary (monthly)', 'Spend by month', ERP, 'monthly repair fleet', { dataset: 'a9-fleet-repair-monthly' });
  add('maintenance', 'Spend by unit (legacy)', 'Original summary table', ERP, 'spend unit maintenance', { legacy: 'rep-maint' });
  add('maintenance', 'Detailed (parts / positions)', 'Line-level export', ERP, 'parts positions tires', { legacy: 'rep-maint-detail' });

  const QBO_MAP = [
    ['b1', 'ProfitAndLoss', 'Profit & Loss', 'profit loss p&l'],
    ['b2', 'BalanceSheet', 'Balance Sheet', 'balance sheet'],
    ['b3', 'CashFlow', 'Cash Flow Statement', 'cash flow'],
    ['b4', 'AgedPayables', 'Accounts Payable Aging', 'ap aging payable'],
    ['b5', 'VendorBalance', 'Vendor balance summary', 'vendor balance'],
    ['b11', 'TrialBalance', 'Trial Balance', 'trial balance'],
    ['b12', 'GeneralLedgerDetail', 'General Ledger', 'general ledger gl'],
    ['b13', 'Check', 'Check detail', 'check detail'],
    ['b14', 'OpenInvoices', 'Open invoices', 'open invoices ar'],
    ['b15', 'AgedReceivables', 'Accounts receivable aging', 'ar aging receivable'],
    ['b16', 'CustomerSales', 'Sales by customer', 'sales customer revenue']
  ];
  for (const [id, report, title, kw] of QBO_MAP) {
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
  add('dot', 'DOT fleet overview', 'Compliance matrix', ERP, 'dot fleet overview', { dataset: 'f-dot-fleet-overview' });
  add('dot', 'Driver qualification (DOT)', '391 file status', ERP, 'driver qualification dot', { dataset: 'g1-driver-qualification' });
  add('dot', 'Driver DOT audit file', 'Per-driver packet (shell)', ERP, 'driver dot audit', { dataset: 'g2-driver-dot-audit' });
  add('dot', 'Drug & alcohol testing log', 'FMCSA program', ERP, 'drug alcohol testing', { dataset: 'g3-drug-alcohol-testing' });
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

  function repDynamicBack() {
    if (typeof openReportsTab === 'function') {
      const b = document.querySelector('#section-reports .subtab[onclick*="rep-overview"]');
      openReportsTab('rep-overview', b);
    }
  }

  function repDynamicPrint() {
    window.print();
  }

  async function repDynamicExport(format) {
    const st = window.__repDynState;
    if (!st || !st.columns || !st.rows) return;
    try {
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
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
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

  function renderSortableTable(columns, rows) {
    const keys = columns.map(c => c.key);
    const th = columns.map(c => `<th data-k="${escapeHtml(c.key)}">${escapeHtml(c.label)}</th>`).join('');
    const tr = (rows || [])
      .map(
        r =>
          `<tr>${keys.map(k => `<td>${escapeHtml(String(r[k] ?? ''))}</td>`).join('')}</tr>`
      )
      .join('');
    return `<table class="rep-dyn-table" style="min-width:520px;font-size:12px;width:100%"><thead><tr>${th}</tr></thead><tbody>${tr || ''}</tbody></table>`;
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
        const arr = Array.from(tbody.querySelectorAll('tr'));
        const idx = keysIndex(tbl, k);
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
  function keysIndex(tbl, k) {
    const heads = [...tbl.querySelectorAll('thead th[data-k]')];
    return heads.findIndex(h => h.getAttribute('data-k') === k);
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
    if (ttl) ttl.textContent = title || datasetId;
    if (fl) {
      fl.innerHTML = `
        <div><label class="qb-l">Start</label><input type="date" class="qb-in" id="repDfStart" value="${r0.start}" /></div>
        <div><label class="qb-l">End</label><input type="date" class="qb-in" id="repDfEnd" value="${r0.end}" /></div>
        <div><label class="qb-l">Unit</label><input type="text" class="qb-in" id="repDfUnit" placeholder="Optional" /></div>
        <div style="align-self:flex-end"><button type="button" class="btn" id="repDfRun">Run</button></div>
      `;
    }
    if (disc) {
      disc.classList.add('hidden');
      disc.textContent = '';
    }
    if (host) host.innerHTML = '<p class="mini-note">Loading…</p>';

    const run = async () => {
      const sp = new URLSearchParams();
      sp.set('id', datasetId);
      const s = document.getElementById('repDfStart')?.value || '';
      const e = document.getElementById('repDfEnd')?.value || '';
      const u = document.getElementById('repDfUnit')?.value || '';
      if (s) sp.set('startDate', s);
      if (e) sp.set('endDate', e);
      if (u) sp.set('unit', u);
      const data = await j('/api/reports/dataset?' + sp.toString());
      if (!data.ok) throw new Error(data.error || 'Dataset failed');
      if (disc && data.disclaimer) {
        disc.textContent = data.disclaimer;
        disc.classList.remove('hidden');
      }
      if (host) {
        host.innerHTML = data.rows && data.rows.length ? renderSortableTable(data.columns, data.rows) : '<p class="mini-note">No rows.</p>';
        bindSortable(host);
      }
      if (data.meta && Array.isArray(data.meta.positions) && tmap && (datasetId === 'a5-tire-history' || datasetId === 'a6-air-bag-history')) {
        tmap.classList.remove('hidden');
        tmap.innerHTML =
          '<div class="mini-note" style="margin-bottom:6px">Positions</div><div class="rep-pos-chips">' +
          data.meta.positions
            .map(
              p =>
                `<button type="button" class="chip${u && String(p).toLowerCase() === String(u).toLowerCase() ? ' active' : ''}" data-pos="${escapeHtml(p)}">${escapeHtml(p)}</button>`
            )
            .join('') +
          '</div>';
        tmap.querySelectorAll('button.chip').forEach(btn => {
          btn.addEventListener('click', () => {
            const inp = document.getElementById('repDfUnit');
            if (datasetId === 'a5-tire-history' || datasetId === 'a6-air-bag-history') {
              const posInput = document.getElementById('repDfPosition');
              if (posInput) posInput.value = btn.getAttribute('data-pos') || '';
            }
            run().catch(err => {
              if (host) host.innerHTML = `<p class="mini-note" style="color:var(--color-semantic-error)">${escapeHtml(err.message)}</p>`;
            });
          });
        });
      }
      if ((datasetId === 'a2-cost-by-unit' || datasetId === 'a3-cost-by-service-type' || datasetId === 'd1-fuel-cost-by-unit') && chart && data.rows && data.rows.length) {
        chart.classList.remove('hidden');
        chart.innerHTML =
          '<p class="mini-note" style="margin:0 0 6px">Bar chart preview (values in table; full charting roadmap).</p><div class="rep-bar-preview">' +
          data.rows
            .slice(0, 12)
            .map(r => {
              const label = r.unit || r.serviceType || r.driver || r.customer || '—';
              const val = Number(r.totalDollars ?? r.total ?? r.revenue ?? 0) || 0;
              const w = Math.min(100, Math.max(4, val > 0 ? Math.log10(val + 1) * 25 : 4));
              return `<div class="rep-bar-row"><span>${escapeHtml(String(label))}</span><span class="rep-bar-fill" style="width:${w}%"></span><span>$${val.toFixed(0)}</span></div>`;
            })
            .join('') +
          '</div>';
      }
      if (tot && data.totals) {
        tot.classList.remove('hidden');
        tot.textContent = `Totals: ${JSON.stringify(data.totals)}`;
      }
      window.__repDynState = {
        kind: 'dataset',
        datasetId,
        title: data.title || title,
        subtitle: [s, e].filter(Boolean).join(' → '),
        columns: data.columns || [],
        rows: data.rows || [],
        startDate: s,
        endDate: e,
        unitTag: u
      };
    };

    document.getElementById('repDfRun')?.addEventListener('click', () => {
      run().catch(err => {
        if (host) host.innerHTML = `<p class="mini-note" style="color:var(--color-semantic-error)">${escapeHtml(err.message)}</p>`;
      });
    });
    await run().catch(err => {
      if (host) host.innerHTML = `<p class="mini-note" style="color:var(--color-semantic-error)">${escapeHtml(err.message)}</p>`;
    });

    if (datasetId === 'a5-tire-history' || datasetId === 'a6-air-bag-history') {
      const posRow = document.createElement('div');
      posRow.innerHTML = '<label class="qb-l">Position filter</label><input type="text" class="qb-in" id="repDfPosition" placeholder="From map chips" />';
      fl?.appendChild(posRow);
      const origRun = run;
      const run2 = async () => {
        const sp = new URLSearchParams();
        sp.set('id', datasetId);
        const s = document.getElementById('repDfStart')?.value || '';
        const e = document.getElementById('repDfEnd')?.value || '';
        const u = document.getElementById('repDfUnit')?.value || '';
        const p = document.getElementById('repDfPosition')?.value || '';
        if (s) sp.set('startDate', s);
        if (e) sp.set('endDate', e);
        if (u) sp.set('unit', u);
        if (p) sp.set('position', p);
        const data = await j('/api/reports/dataset?' + sp.toString());
        if (!data.ok) throw new Error(data.error || 'Dataset failed');
        if (host) {
          host.innerHTML = data.rows && data.rows.length ? renderSortableTable(data.columns, data.rows) : '<p class="mini-note">No rows.</p>';
          bindSortable(host);
        }
        window.__repDynState = {
          kind: 'dataset',
          datasetId,
          title: data.title || title,
          columns: data.columns || [],
          rows: data.rows || [],
          startDate: s,
          endDate: e,
          unitTag: u
        };
      };
      document.getElementById('repDfRun')?.replaceWith(document.getElementById('repDfRun'));
      document.getElementById('repDfRun')?.addEventListener('click', () => {
        run2().catch(err => {
          if (host) host.innerHTML = `<p class="mini-note" style="color:var(--color-semantic-error)">${escapeHtml(err.message)}</p>`;
        });
      });
      await run2().catch(() => {});
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
        'Data sourced from QuickBooks Online. Amounts and columns match your QBO company file.';
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
      const data = await j('/api/qbo/report/' + encodeURIComponent(reportName) + '?' + sp.toString());
      if (!data.ok) throw new Error(data.error || 'QBO report failed');
      if (data.viewUrl) qLink.href = data.viewUrl;
      const flat = flattenQboReportForTable(data.report);
      if (host) {
        host.innerHTML = flat.rows.length ? renderSortableTable(flat.columns, flat.rows) : `<pre class="mini-note" style="white-space:pre-wrap">${escapeHtml(JSON.stringify(data.report, null, 2).slice(0, 8000))}</pre>`;
        bindSortable(host);
      }
      window.__repDynState = {
        kind: 'qbo',
        title: title || reportName,
        subtitle: `${s} → ${e} (${acct})`,
        columns: flat.columns,
        rows: flat.rows,
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

  function flattenQboReportForTable(report) {
    const columns = [];
    const rows = [];
    try {
      const cols = report?.Columns?.Column;
      const colArr = Array.isArray(cols) ? cols : cols ? [cols] : [];
      for (const c of colArr) {
        const t = c?.ColTitle || c?.MetaData?.[0]?.Name || c?.group || 'Col';
        columns.push({ key: 'c' + columns.length, label: String(t) });
      }
      const walk = (node, row) => {
        if (!node) return;
        if (node.Header && node.Header.ColData) {
          const cds = Array.isArray(node.Header.ColData) ? node.Header.ColData : [node.Header.ColData];
          cds.forEach((cd, i) => {
            row['c' + i] = cd?.value ?? '';
          });
        }
        if (node.Rows && node.Rows.Row) {
          const rs = Array.isArray(node.Rows.Row) ? node.Rows.Row : [node.Rows.Row];
          for (const sub of rs) {
            if (sub.type === 'Section') walk(sub, { ...row });
            else if (sub.ColData) {
              const out = { ...row };
              const cds = Array.isArray(sub.ColData) ? sub.ColData : [sub.ColData];
              cds.forEach((cd, i) => {
                out['c' + i] = cd?.value ?? '';
              });
              rows.push(out);
            } else walk(sub, { ...row });
          }
        }
      };
      walk({ Rows: report?.Rows }, {});
      if (!columns.length) {
        columns.push({ key: 'json', label: 'Report (raw)' });
        rows.push({ json: 'See JSON below or widen date range.' });
      }
    } catch (_) {
      columns.push({ key: 'v', label: 'Value' });
      rows.push({ v: 'Could not flatten QBO columns — see QBO UI.' });
    }
    return { columns: columns.length ? columns : [{ key: 'a', label: 'A' }], rows };
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
    grid.innerHTML = items
      .map(it => {
        const kid = `repk-${it.title.replace(/[^\w]+/g, '-').slice(0, 40)}`;
        return `<button type="button" class="rep-catalog-card" id="${kid}" data-rep-k="${escapeHtml(it.keywords)}" data-cat="${escapeHtml(it.cat)}">
          <span class="rep-catalog-card__src">${escapeHtml(it.source)}</span>
          <span class="rep-catalog-card__title">${escapeHtml(it.title)}</span>
          <span class="rep-catalog-card__desc">${escapeHtml(it.desc)}</span>
        </button>`;
      })
      .join('');
    grid.querySelectorAll('.rep-catalog-card').forEach((btn, i) => {
      const it = items[i];
      btn.addEventListener('click', () => {
        if (it.custom === 'new') {
          if (typeof repReportsRoadmapMsg === 'function') repReportsRoadmapMsg('custom');
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
    const tabs = document.getElementById('repCatTabs');
    if (!tabs || tabs.dataset.bound === '1') {
      renderCatalogGrid();
      return;
    }
    tabs.dataset.bound = '1';
    tabs.innerHTML = REP_CATS.map(
      (c, i) =>
        `<button type="button" role="tab" class="rep-cat-tab${i === 0 ? ' active' : ''}" data-cat="${c.id}" data-rep-k="${c.label} ${c.id} reports">${escapeHtml(c.label)}</button>`
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

  const origFilter = window.repFilterReports;
  if (typeof origFilter === 'function') {
    window.repFilterReports = function (q) {
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
  }
})();
