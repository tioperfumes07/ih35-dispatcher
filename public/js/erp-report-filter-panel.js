/**
 * Reusable maintenance / DOT report filter panel (read-only query params).
 * Mount with: window.ErpReportFilterPanel.mount(hostEl, options, callbacks)
 */
(function () {
  const CHIP =
    'display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;padding:3px 10px;font-size:11px;border-radius:20px;' +
    'background:#e8f0fe;color:#1557a0;border:1px solid #c5d9f7';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function ymd(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function addMonths(d, n) {
    const x = new Date(d);
    x.setMonth(x.getMonth() + n);
    return x;
  }
  function rangeFromPreset(preset, defaultMonths) {
    const end = new Date();
    let start = addMonths(end, -defaultMonths);
    const p = String(preset || '').toLowerCase();
    if (p === 'today') start = new Date(end);
    else if (p === 'this_week') {
      start = new Date(end);
      start.setDate(end.getDate() - end.getDay());
    } else if (p === 'this_month') start = new Date(end.getFullYear(), end.getMonth(), 1);
    else if (p === 'last_month') {
      start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
      const e = new Date(end.getFullYear(), end.getMonth(), 0);
      return { start: ymd(start), end: ymd(e) };
    } else if (p === 'last_3_months') start = addMonths(end, -3);
    else if (p === 'last_6_months') start = addMonths(end, -6);
    else if (p === 'last_year' || p === 'last_12_months') start = addMonths(end, -12);
    else if (p === 'ytd') start = new Date(end.getFullYear(), 0, 1);
    else if (p === 'all_time') start = new Date(2000, 0, 1);
    else if (p === 'custom') return null;
    return { start: ymd(start), end: ymd(end) };
  }

  const RECORD_TYPES = [
    { id: 'pm_service', label: 'PM service' },
    { id: 'maintenance', label: 'Maintenance' },
    { id: 'repair', label: 'Repair' },
    { id: 'inspection', label: 'Inspection' },
    { id: 'tire', label: 'Tire service' },
    { id: 'air_bag', label: 'Air bag service' },
    { id: 'battery', label: 'Battery service' },
    { id: 'accident', label: 'Accident / collision' },
    { id: 'body', label: 'Body work' },
    { id: 'other', label: 'Other' }
  ];

  const LOC_CATS = [
    { id: 'internal', label: 'Internal shop' },
    { id: 'external', label: 'External shop / vendor' },
    { id: 'roadside', label: 'Roadside repair' },
    { id: 'mobile', label: 'Mobile mechanic' },
    { id: 'dealer', label: 'Dealer / OEM service' },
    { id: 'other', label: 'Other' }
  ];

  function parseList(str) {
    return String(str || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  function mount(host, opts, cb) {
    const datasetId = opts.datasetId || '';
    const defaultMonths = opts.defaultMonths != null ? Number(opts.defaultMonths) : 3;
    const show = new Set(opts.features || []);
    const end = new Date();
    const start = addMonths(end, -defaultMonths);
    const id = 'erpRfp_' + Math.random().toString(36).slice(2);

    const html = `
<div class="erp-rfp" id="${id}" data-collapsed="0" style="border:1px solid #dadce0;border-radius:8px;background:#fff;margin-bottom:10px">
  <div class="erp-rfp__head" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;cursor:pointer;background:#f8f9fb;border-radius:8px 8px 0 0">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <strong style="font-size:13px">Filters</strong>
      <span class="erp-rfp__badge" style="font-size:11px;padding:2px 8px;border-radius:10px;background:#e8eaed;color:#3c4043">0 active</span>
      <span class="erp-rfp__chev" aria-hidden="true">▼</span>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button type="button" class="btn btn--sm erp-rfp-reset" style="font-size:11px">Reset all</button>
    </div>
  </div>
  <div class="erp-rfp__chips" style="padding:6px 10px;border-bottom:1px solid #eee;min-height:28px"></div>
  <div class="erp-rfp__body" style="padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px 14px">
    ${
      show.has('dateRange')
        ? `<div style="grid-column:1/-1">
        <label class="qb-l">Date range</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <span class="mini-note">From</span><input type="date" class="qb-in erp-rfp-start" value="${ymd(start)}" />
          <span class="mini-note">To</span><input type="date" class="qb-in erp-rfp-end" value="${ymd(end)}" />
        </div>
        <div class="erp-rfp-quick" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
          ${['Today', 'This week', 'This month', 'Last month', 'Last 3 months', 'Last 6 months', 'Last year', 'Year to date', 'All time', 'Custom']
            .map(
              lab =>
                `<button type="button" class="chip erp-rfp-chip" data-preset="${lab.toLowerCase().replace(/\s+/g, '_')}">${lab}</button>`
            )
            .join('')}
        </div>
      </div>`
        : ''
    }
    ${
      show.has('units')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Unit / vehicle</div>
        <label><input type="radio" name="${id}_um" class="erp-rfp-unitm" value="all" checked /> All units</label>
        <label style="margin-left:10px"><input type="radio" name="${id}_um" class="erp-rfp-unitm" value="pick" /> Select specific units</label>
        <div class="erp-rfp-units-wrap hidden" style="margin-top:6px">
          <input type="text" class="qb-in erp-rfp-unit-search" placeholder="Search units…" style="max-width:260px" />
          <div class="erp-rfp-unit-list mini-note" style="max-height:140px;overflow:auto;margin-top:6px;border:1px solid #eee;padding:6px;border-radius:6px"></div>
          <div style="margin-top:6px"><label><input type="checkbox" class="erp-rfp-unit-all" /> Select all</label>
          <button type="button" class="btn btn--sm erp-rfp-unit-clear" style="margin-left:8px;font-size:11px">Clear all</button>
          <span class="erp-rfp-unit-count mini-note" style="margin-left:8px"></span></div>
        </div>
      </div>`
        : ''
    }
    ${
      show.has('recordTypes')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Record type</div>
        <label style="margin-right:10px"><input type="checkbox" class="erp-rfp-rt-all" checked /> All</label>
        <div class="erp-rfp-rt" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
          ${RECORD_TYPES.map(
            t => `<label style="font-size:12px"><input type="checkbox" class="erp-rfp-rt-cb" value="${t.id}" checked /> ${t.label}</label>`
          ).join('')}
        </div>
      </div>`
        : ''
    }
    ${
      show.has('locationCategories')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Service location category</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${LOC_CATS.map(
            t => `<label style="font-size:12px"><input type="checkbox" class="erp-rfp-lc-cb" value="${t.id}" /> ${t.label}</label>`
          ).join('')}
        </div>
      </div>`
        : ''
    }
    ${
      show.has('vendors')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Vendor (from work orders)</div>
        <input type="text" class="qb-in erp-rfp-vendor-search" placeholder="Search vendors…" style="max-width:280px" />
        <div class="erp-rfp-vendor-list mini-note" style="max-height:120px;overflow:auto;margin-top:6px;border:1px solid #eee;padding:6px;border-radius:6px"></div>
        <div style="margin-top:6px"><button type="button" class="btn btn--sm erp-rfp-vendor-clear" style="font-size:11px">Clear vendors</button>
        <span class="erp-rfp-vendor-count mini-note" style="margin-left:8px"></span></div>
      </div>`
        : ''
    }
    ${
      show.has('drivers')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Driver (from work orders)</div>
        <input type="text" class="qb-in erp-rfp-driver-search" placeholder="Search drivers…" style="max-width:280px" />
        <div class="erp-rfp-driver-list mini-note" style="max-height:120px;overflow:auto;margin-top:6px;border:1px solid #eee;padding:6px;border-radius:6px"></div>
        <div style="margin-top:6px"><button type="button" class="btn btn--sm erp-rfp-driver-clear" style="font-size:11px">Clear drivers</button>
        <span class="erp-rfp-driver-count mini-note" style="margin-left:8px"></span></div>
      </div>`
        : ''
    }
    ${
      show.has('serviceTypesPick')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Service type (from catalog / lines)</div>
        <input type="text" class="qb-in erp-rfp-svc-search" placeholder="Search service types…" style="max-width:280px" />
        <div class="erp-rfp-svc-list mini-note" style="max-height:120px;overflow:auto;margin-top:6px;border:1px solid #eee;padding:6px;border-radius:6px"></div>
        <div style="margin-top:6px"><button type="button" class="btn btn--sm erp-rfp-svc-clear" style="font-size:11px">Clear service types</button>
        <span class="erp-rfp-svc-count mini-note" style="margin-left:8px"></span></div>
      </div>`
        : ''
    }
    ${
      show.has('groupBy')
        ? `<div>
        <div class="qb-l">Group results by</div>
        <select class="qb-in erp-rfp-groupby" style="max-width:100%">
          ${(opts.groupByOptions || [])
            .map(o => `<option value="${o.value}">${o.label}</option>`)
            .join('')}
        </select>
      </div>`
        : ''
    }
    ${
      show.has('sortBy')
        ? `<div>
        <div class="qb-l">Sort by</div>
        <select class="qb-in erp-rfp-sortby">
          <option value="date">Date</option>
          <option value="unit">Unit</option>
          <option value="cost">Cost</option>
          <option value="service">Service type</option>
        </select>
        <select class="qb-in erp-rfp-sortdir" style="margin-top:4px">
          <option value="desc">Newest / high → low</option>
          <option value="asc">Oldest / low → high</option>
        </select>
      </div>`
        : ''
    }
    ${
      show.has('costRange')
        ? `<div>
        <div class="qb-l">Cost range</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input type="number" class="qb-in erp-rfp-cmin" placeholder="Min $" style="max-width:110px" step="0.01" />
          <span>—</span>
          <input type="number" class="qb-in erp-rfp-cmax" placeholder="Max $" style="max-width:110px" step="0.01" />
        </div>
      </div>`
        : ''
    }
    ${
      show.has('showOverduePm')
        ? `<div>
        <label style="font-size:12px"><input type="checkbox" class="erp-rfp-overdue" /> Show only overdue (PM)</label>
        <div style="margin-top:6px"><span class="mini-note">Due within (miles)</span>
        <input type="number" class="qb-in erp-rfp-duemiles" placeholder="e.g. 500" style="max-width:100px;margin-left:6px" /></div>
      </div>`
        : ''
    }
    <div style="grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px">
      <button type="button" class="btn erp-rfp-apply" style="background:#1b5e20;color:#fff;border-color:#1b5e20">Apply filters</button>
      <span class="erp-rfp-spin hidden mini-note">Loading…</span>
    </div>
  </div>
</div>`;
    host.innerHTML = html;
    const root = host.querySelector('#' + id);
    const state = {
      unitPick: new Set(),
      allUnits: []
    };

    function setCollapsed(c) {
      root.dataset.collapsed = c ? '1' : '0';
      const body = root.querySelector('.erp-rfp__body');
      const chev = root.querySelector('.erp-rfp__chev');
      if (body) body.classList.toggle('hidden', !!c);
      if (chev) chev.textContent = c ? '▶' : '▼';
    }

    function collectParams() {
      const sp = new URLSearchParams();
      if (show.has('dateRange')) {
        const s = root.querySelector('.erp-rfp-start')?.value || '';
        const e = root.querySelector('.erp-rfp-end')?.value || '';
        if (s) sp.set('startDate', s);
        if (e) sp.set('endDate', e);
      }
      if (show.has('units')) {
        const mode = root.querySelector('.erp-rfp-unitm:checked')?.value || 'all';
        if (mode === 'pick') {
          for (const u of state.unitPick) sp.append('units', u);
        }
      }
      if (show.has('recordTypes')) {
        const allRt = root.querySelector('.erp-rfp-rt-all')?.checked;
        if (!allRt) {
          root.querySelectorAll('.erp-rfp-rt-cb:checked').forEach(cb => sp.append('recordTypes', cb.value));
        }
      }
      if (show.has('locationCategories')) {
        root.querySelectorAll('.erp-rfp-lc-cb:checked').forEach(cb => sp.append('locationCategories', cb.value));
      }
      if (show.has('groupBy')) {
        const g = root.querySelector('.erp-rfp-groupby')?.value || '';
        if (g) sp.set('groupBy', g);
      }
      if (show.has('sortBy')) {
        sp.set('sortBy', root.querySelector('.erp-rfp-sortby')?.value || 'date');
        sp.set('sortDir', root.querySelector('.erp-rfp-sortdir')?.value || 'desc');
      }
      if (show.has('costRange')) {
        const mn = root.querySelector('.erp-rfp-cmin')?.value;
        const mx = root.querySelector('.erp-rfp-cmax')?.value;
        if (mn) sp.set('costMin', mn);
        if (mx) sp.set('costMax', mx);
      }
      if (show.has('showOverduePm')) {
        if (root.querySelector('.erp-rfp-overdue')?.checked) sp.set('showOverdue', 'true');
        const dm = root.querySelector('.erp-rfp-duemiles')?.value;
        if (dm) sp.set('dueWithinMiles', dm);
      }
      return sp;
    }

    function activeCount() {
      let n = 0;
      const sp = collectParams();
      const skip = new Set(['sortBy', 'sortDir', 'groupBy']);
      sp.forEach((v, k) => {
        if (!skip.has(k)) n++;
      });
      if (show.has('recordTypes') && !root.querySelector('.erp-rfp-rt-all')?.checked) n += 0;
      return sp.toString() ? sp.toString().split('&').filter(x => !x.startsWith('sort')).length : 0;
    }

    function paintChips() {
      const sp = collectParams();
      const hostChips = root.querySelector('.erp-rfp__chips');
      const badge = root.querySelector('.erp-rfp__badge');
      if (badge) badge.textContent = `${activeCount()} active`;
      if (!hostChips) return;
      const parts = [];
      sp.forEach((val, key) => {
        if (key === 'sortBy' || key === 'sortDir') return;
        parts.push(`<span style="${CHIP}">${key}: ${String(val).slice(0, 40)}</span>`);
      });
      hostChips.innerHTML = parts.length ? parts.join('') : '<span class="mini-note">No filters outside defaults</span>';
    }

    function bindUnits() {
      const wrap = root.querySelector('.erp-rfp-units-wrap');
      const list = root.querySelector('.erp-rfp-unit-list');
      const search = root.querySelector('.erp-rfp-unit-search');
      if (!wrap || !list) return;
      fetch('/api/reports/filters/fleet-units', { headers: typeof authFetchHeaders === 'function' ? authFetchHeaders() : {} })
        .then(r => r.json())
        .then(data => {
          state.allUnits = data.units || [];
          function renderList(q) {
            const ql = String(q || '').trim().toLowerCase();
            const rows = state.allUnits.filter(u => !ql || String(u.label || u.unit).toLowerCase().includes(ql));
            list.innerHTML = rows
              .map(
                u =>
                  `<label style="display:block;font-size:12px;margin:2px 0"><input type="checkbox" class="erp-rfp-unit-cb" value="${String(u.unit).replace(/"/g, '&quot;')}" /> ${String(u.label || u.unit)}</label>`
              )
              .join('');
            list.querySelectorAll('.erp-rfp-unit-cb').forEach(cb => {
              cb.checked = state.unitPick.has(cb.value);
              cb.addEventListener('change', () => {
                if (cb.checked) state.unitPick.add(cb.value);
                else state.unitPick.delete(cb.value);
                paintUnitCount();
                paintChips();
              });
            });
          }
          function paintUnitCount() {
            const c = root.querySelector('.erp-rfp-unit-count');
            if (c) c.textContent = `${state.unitPick.size} units selected`;
          }
          renderList('');
          search.addEventListener('input', () => renderList(search.value));
          root.querySelector('.erp-rfp-unitm')?.addEventListener('change', () => {
            const mode = root.querySelector('.erp-rfp-unitm:checked')?.value;
            wrap.classList.toggle('hidden', mode !== 'pick');
          });
          root.querySelector('.erp-rfp-unit-all')?.addEventListener('change', ev => {
            if (ev.target.checked) {
              state.allUnits.forEach(u => state.unitPick.add(u.unit));
            } else state.unitPick.clear();
            renderList(search.value);
            paintUnitCount();
            paintChips();
          });
          root.querySelector('.erp-rfp-unit-clear')?.addEventListener('click', () => {
            state.unitPick.clear();
            renderList(search.value);
            paintUnitCount();
            paintChips();
          });
        })
        .catch(() => {
          list.textContent = 'Could not load units.';
        });
    }

    root.querySelector('.erp-rfp__head')?.addEventListener('click', () => setCollapsed(root.dataset.collapsed !== '1'));
    root.querySelectorAll('.erp-rfp-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const pr = btn.getAttribute('data-preset') || '';
        const r = rangeFromPreset(pr, defaultMonths);
        if (!r) return;
        const si = root.querySelector('.erp-rfp-start');
        const ei = root.querySelector('.erp-rfp-end');
        if (si) si.value = r.start;
        if (ei) ei.value = r.end;
        paintChips();
      });
    });
    root.querySelector('.erp-rfp-reset')?.addEventListener('click', () => {
      host.innerHTML = '';
      mount(host, opts, cb);
      if (cb.onReset) cb.onReset();
    });
    root.querySelector('.erp-rfp-rt-all')?.addEventListener('change', e => {
      const on = e.target.checked;
      root.querySelectorAll('.erp-rfp-rt-cb').forEach(cb => {
        cb.checked = on;
      });
      paintChips();
    });
    root.querySelectorAll('.erp-rfp-rt-cb').forEach(cb =>
      cb.addEventListener('change', () => {
        const allOn = [...root.querySelectorAll('.erp-rfp-rt-cb')].every(x => x.checked);
        const rtAll = root.querySelector('.erp-rfp-rt-all');
        if (rtAll) rtAll.checked = allOn;
        paintChips();
      })
    );
    root.querySelectorAll('.erp-rfp-start, .erp-rfp-end, .erp-rfp-cmin, .erp-rfp-cmax, .erp-rfp-lc-cb').forEach(el =>
      el.addEventListener('input', paintChips)
    );
    root.querySelectorAll('.erp-rfp-start, .erp-rfp-end, .erp-rfp-cmin, .erp-rfp-cmax, .erp-rfp-lc-cb').forEach(el =>
      el.addEventListener('change', paintChips)
    );

    if (show.has('units')) bindUnits();
    paintChips();
    if (cb.onReady) {
      setTimeout(() => {
        try {
          cb.onReady(collectParams());
        } catch (_) {}
      }, 0);
    }

    root.querySelector('.erp-rfp-apply')?.addEventListener('click', () => {
      const spin = root.querySelector('.erp-rfp-spin');
      spin?.classList.remove('hidden');
      const sp = collectParams();
      Promise.resolve(cb.onApply(sp))
        .catch(() => {})
        .finally(() => spin?.classList.add('hidden'));
    });

    if (cb.onReady) cb.onReady(collectParams);
  }

  window.ErpReportFilterPanel = { mount };
})();
