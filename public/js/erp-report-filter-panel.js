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

  /** Rough catalog grouping for service-type picker (read-only UI). */
  const SERVICE_CATEGORY_GROUPS = [
    {
      id: 'engine',
      label: 'Engine / fluids',
      keys: ['oil', 'lubric', 'filter', 'coolant', 'valve', 'dpf', 'fuel', 'air filter', 'steering', 'differential']
    },
    {
      id: 'brakes',
      label: 'Brakes',
      keys: ['brake']
    },
    {
      id: 'tires',
      label: 'Tires / wheels',
      keys: ['tire', 'wheel', 'alignment']
    },
    {
      id: 'inspection',
      label: 'Inspections',
      keys: ['inspection', 'dot']
    },
    {
      id: 'reefer',
      label: 'Reefer / liftgate',
      keys: ['reefer', 'liftgate']
    },
    {
      id: 'other',
      label: 'Other services',
      keys: []
    }
  ];

  const FLEET_TYPES = [
    { id: 'trucks', label: 'Trucks (tractor-trailers)' },
    { id: 'ref_vans', label: 'Refrigerated vans' },
    { id: 'flatbeds', label: 'Flatbeds' },
    { id: 'dry_vans', label: 'Dry vans' },
    { id: 'company_vehicles', label: 'Company vehicles' }
  ];

  const MAKE_OPTS = [
    { id: 'mack', label: 'Mack' },
    { id: 'freightliner', label: 'Freightliner' },
    { id: 'peterbilt', label: 'Peterbilt' },
    { id: 'volvo', label: 'Volvo' },
    { id: 'all others', label: 'All others' }
  ];

  function spToObject(sp) {
    const o = {};
    sp.forEach((v, k) => {
      if (!o[k]) o[k] = [];
      o[k].push(v);
    });
    for (const k of Object.keys(o)) o[k].sort();
    return o;
  }

  function spObjectEqual(a, b) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      const va = (a[k] || []).join('\x1e');
      const vb = (b[k] || []).join('\x1e');
      if (va !== vb) return false;
    }
    return true;
  }

  function escapeAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function mount(host, opts, cb) {
    const defaultMonths = opts.defaultMonths != null ? Number(opts.defaultMonths) : 3;
    const show = new Set(opts.features || []);
    const end = new Date();
    const start = addMonths(end, -defaultMonths);
    const id = 'erpRfp_' + Math.random().toString(36).slice(2);

    const svcGroupedHtml = SERVICE_CATEGORY_GROUPS.map(
      g => `<div class="erp-rfp-svcgrp" data-grp="${g.id}" style="margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap">
          <strong style="font-size:11px;color:#1a1f36">${g.label}</strong>
          <button type="button" class="btn btn--sm erp-rfp-svcgrp-all" data-grp="${g.id}" style="font-size:10px">Select all in category</button>
        </div>
        <div class="erp-rfp-svcgrp-list mini-note" data-grp-list="${g.id}" style="max-height:100px;overflow:auto;margin-top:4px;border:1px solid #eee;padding:4px 6px;border-radius:6px"></div>
      </div>`
    ).join('');

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
  <div class="erp-rfp__body" style="padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px 14px">
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
        <div class="qb-l">Service location</div>
        <label style="display:block;margin-bottom:6px;font-size:12px"><input type="checkbox" class="erp-rfp-lc-all" checked /> All locations (categories)</label>
        <div class="erp-rfp-lc-grid" style="display:flex;flex-wrap:wrap;gap:6px">
          ${LOC_CATS.map(
            t => `<label style="font-size:12px"><input type="checkbox" class="erp-rfp-lc-cb" value="${t.id}" checked /> ${t.label}</label>`
          ).join('')}
        </div>
      </div>`
        : ''
    }
    ${
      show.has('locationNames')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Specific location names</div>
        <input type="text" class="qb-in erp-rfp-locnm-search" placeholder="Search locations…" style="max-width:280px" />
        <div class="erp-rfp-locnm-list mini-note" style="max-height:120px;overflow:auto;margin-top:6px;border:1px solid #eee;padding:6px;border-radius:6px"></div>
        <div style="margin-top:6px"><button type="button" class="btn btn--sm erp-rfp-locnm-clear" style="font-size:11px">Clear locations</button>
        <span class="erp-rfp-locnm-count mini-note" style="margin-left:8px"></span></div>
      </div>`
        : ''
    }
    ${
      show.has('fleetTypes')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Fleet type</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${FLEET_TYPES.map(
            t => `<label style="font-size:12px"><input type="checkbox" class="erp-rfp-ft-cb" value="${t.id}" checked /> ${t.label}</label>`
          ).join('')}
        </div>
      </div>`
        : ''
    }
    ${
      show.has('makes')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Vehicle make</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${MAKE_OPTS.map(
            t => `<label style="font-size:12px"><input type="checkbox" class="erp-rfp-mk-cb" value="${t.id}" checked /> ${t.label}</label>`
          ).join('')}
        </div>
      </div>`
        : ''
    }
    ${
      show.has('vendors')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Vendor</div>
        <label><input type="radio" name="${id}_vm" class="erp-rfp-vendm" value="all" checked /> All vendors</label>
        <label style="margin-left:10px"><input type="radio" name="${id}_vm" class="erp-rfp-vendm" value="pick" /> Select specific vendors</label>
        <div class="erp-rfp-vendor-wrap hidden" style="margin-top:6px">
        <input type="text" class="qb-in erp-rfp-vendor-search" placeholder="Search vendors…" style="max-width:280px" />
        <div class="erp-rfp-vendor-list mini-note" style="max-height:120px;overflow:auto;margin-top:6px;border:1px solid #eee;padding:6px;border-radius:6px"></div>
        <div style="margin-top:6px"><button type="button" class="btn btn--sm erp-rfp-vendor-clear" style="font-size:11px">Clear vendors</button>
        <span class="erp-rfp-vendor-count mini-note" style="margin-left:8px"></span></div>
        </div>
      </div>`
        : ''
    }
    ${
      show.has('drivers')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Driver</div>
        <label><input type="radio" name="${id}_dm" class="erp-rfp-drivm" value="all" checked /> All drivers</label>
        <label style="margin-left:10px"><input type="radio" name="${id}_dm" class="erp-rfp-drivm" value="pick" /> Select specific drivers</label>
        <div class="erp-rfp-driver-wrap hidden" style="margin-top:6px">
        <input type="text" class="qb-in erp-rfp-driver-search" placeholder="Search drivers…" style="max-width:280px" />
        <div class="erp-rfp-driver-list mini-note" style="max-height:120px;overflow:auto;margin-top:6px;border:1px solid #eee;padding:6px;border-radius:6px"></div>
        <div style="margin-top:6px"><button type="button" class="btn btn--sm erp-rfp-driver-clear" style="font-size:11px">Clear drivers</button>
        <span class="erp-rfp-driver-count mini-note" style="margin-left:8px"></span></div>
        </div>
      </div>`
        : ''
    }
    ${
      show.has('serviceTypesPick')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Service type</div>
        <label><input type="radio" name="${id}_sm" class="erp-rfp-svcm" value="all" checked /> All service types</label>
        <label style="margin-left:10px"><input type="radio" name="${id}_sm" class="erp-rfp-svcm" value="pick" /> Select specific types</label>
        <div class="erp-rfp-svc-wrap hidden" style="margin-top:8px">
        <div style="margin-bottom:6px"><button type="button" class="btn btn--sm erp-rfp-svc-alltop" style="font-size:11px">Select all</button>
        <button type="button" class="btn btn--sm erp-rfp-svc-clear" style="margin-left:6px;font-size:11px">Clear service types</button>
        <span class="erp-rfp-svc-count mini-note" style="margin-left:8px"></span></div>
        <input type="text" class="qb-in erp-rfp-svc-search" placeholder="Search across groups…" style="max-width:280px" />
        ${svcGroupedHtml}
        </div>
      </div>`
        : ''
    }
    ${
      show.has('accidentExtra')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">Accident filters</div>
        <div class="mini-note" style="margin-bottom:4px">Fault</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-af-cb" value="at_fault" /> At fault</label>
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-af-cb" value="not_at_fault" /> Not at fault</label>
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-af-cb" value="unknown" /> Unknown</label>
        </div>
        <div class="mini-note" style="margin:8px 0 4px">DOT reportable</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-dot-cb" value="y" /> Yes</label>
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-dot-cb" value="n" /> No</label>
        </div>
        <div class="mini-note" style="margin:8px 0 4px">Insurance claim</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-ins-cb" value="has" /> Has claim</label>
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-ins-cb" value="no" /> No claim</label>
        </div>
      </div>`
        : ''
    }
    ${
      show.has('defectsOnly')
        ? `<div>
        <label class="qb-l" style="display:block">Issues</label>
        <label style="font-size:12px"><input type="checkbox" class="erp-rfp-defonly" value="1" /> Records with defects / issues found</label>
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
          <option value="location">Location</option>
          <option value="vendor">Vendor</option>
        </select>
        <select class="qb-in erp-rfp-sortdir" style="margin-top:4px">
          <option value="desc">Newest / Z→A / high → low</option>
          <option value="asc">Oldest / A→Z / low → high</option>
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
      show.has('pmStatusPick')
        ? `<div style="grid-column:1/-1">
        <div class="qb-l">PM status (row color)</div>
        <label style="font-size:12px"><input type="checkbox" class="erp-rfp-pmst-all" checked /> All statuses</label>
        <div class="erp-rfp-pmst" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-pmst-cb" value="red" checked /> Overdue</label>
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-pmst-cb" value="amber" checked /> Due soon</label>
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-pmst-cb" value="blue" checked /> Upcoming</label>
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-pmst-cb" value="green" checked /> OK</label>
          <label style="font-size:12px"><input type="checkbox" class="erp-rfp-pmst-cb" value="gray" checked /> No PM / unknown miles</label>
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
      allUnits: [],
      vendorPick: new Set(),
      allVendors: [],
      driverPick: new Set(),
      allDrivers: [],
      serviceTypePick: new Set(),
      allServiceTypes: [],
      locationNamePick: new Set(),
      allLocationNames: []
    };

    let baselineObj = {};

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
        const allLc = root.querySelector('.erp-rfp-lc-all')?.checked;
        if (!allLc) {
          root.querySelectorAll('.erp-rfp-lc-cb:checked').forEach(cb => sp.append('locationCategories', cb.value));
        }
      }
      if (show.has('locationNames')) {
        for (const loc of state.locationNamePick) sp.append('locations', loc);
      }
      if (show.has('fleetTypes')) {
        const allFt = [...root.querySelectorAll('.erp-rfp-ft-cb')].every(x => x.checked);
        if (!allFt) {
          root.querySelectorAll('.erp-rfp-ft-cb:checked').forEach(cb => sp.append('fleetTypes', cb.value));
        }
      }
      if (show.has('makes')) {
        const allMk = [...root.querySelectorAll('.erp-rfp-mk-cb')].every(x => x.checked);
        if (!allMk) {
          root.querySelectorAll('.erp-rfp-mk-cb:checked').forEach(cb => sp.append('makes', cb.value));
        }
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
      if (show.has('pmStatusPick')) {
        const pmAll = root.querySelector('.erp-rfp-pmst-all')?.checked;
        if (!pmAll) {
          root.querySelectorAll('.erp-rfp-pmst-cb:checked').forEach(cb => sp.append('pmStatus', cb.value));
        }
      }
      if (show.has('showOverduePm')) {
        if (root.querySelector('.erp-rfp-overdue')?.checked) sp.set('showOverdue', 'true');
        const dm = root.querySelector('.erp-rfp-duemiles')?.value;
        if (dm) sp.set('dueWithinMiles', dm);
      }
      if (show.has('vendors')) {
        const vm = root.querySelector('.erp-rfp-vendm:checked')?.value || 'all';
        if (vm === 'pick') {
          for (const v of state.vendorPick) sp.append('vendors', v);
        }
      }
      if (show.has('drivers')) {
        const dm = root.querySelector('.erp-rfp-drivm:checked')?.value || 'all';
        if (dm === 'pick') {
          for (const d of state.driverPick) sp.append('drivers', d);
        }
      }
      if (show.has('serviceTypesPick')) {
        const sm = root.querySelector('.erp-rfp-svcm:checked')?.value || 'all';
        if (sm === 'pick') {
          for (const s of state.serviceTypePick) sp.append('serviceTypes', s);
        }
      }
      if (show.has('accidentExtra')) {
        root.querySelectorAll('.erp-rfp-af-cb:checked').forEach(cb => sp.append('accidentFault', cb.value));
        root.querySelectorAll('.erp-rfp-dot-cb:checked').forEach(cb => sp.append('dotReportable', cb.value));
        root.querySelectorAll('.erp-rfp-ins-cb:checked').forEach(cb => sp.append('insuranceClaim', cb.value));
      }
      if (show.has('defectsOnly') && root.querySelector('.erp-rfp-defonly')?.checked) {
        sp.set('defectsOnly', 'true');
      }
      return sp;
    }

    function diffParamCount(cur) {
      const a = spToObject(cur);
      const b = baselineObj;
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      let n = 0;
      for (const k of keys) {
        const va = (a[k] || []).join('\x1e');
        const vb = (b[k] || []).join('\x1e');
        if (va !== vb) n++;
      }
      return n;
    }

    function chipLabel(key, val) {
      const pretty = {
        startDate: 'From',
        endDate: 'To',
        recordTypes: 'Record type',
        locationCategories: 'Location category',
        locations: 'Location',
        fleetTypes: 'Fleet type',
        makes: 'Make',
        vendors: 'Vendor',
        drivers: 'Driver',
        serviceTypes: 'Service type',
        groupBy: 'Group by',
        costMin: 'Min $',
        costMax: 'Max $',
        showOverdue: 'PM overdue only',
        dueWithinMiles: 'Due within mi',
        accidentFault: 'Fault',
        dotReportable: 'DOT reportable',
        insuranceClaim: 'Insurance',
        defectsOnly: 'Defects only',
        pmStatus: 'PM status'
      };
      const lab = pretty[key] || key;
      return `${lab}: ${String(val).slice(0, 48)}`;
    }

    function paintChips() {
      const sp = collectParams();
      const hostChips = root.querySelector('.erp-rfp__chips');
      const badge = root.querySelector('.erp-rfp__badge');
      const n = diffParamCount(sp);
      if (badge) badge.textContent = `${n} active`;
      if (!hostChips) return;
      const cur = spToObject(sp);
      const parts = [];
      for (const key of Object.keys(cur).sort()) {
        if (key === 'sortBy' || key === 'sortDir') continue;
        const baseVals = baselineObj[key] || [];
        const vals = cur[key] || [];
        const same = baseVals.join('\x1e') === vals.join('\x1e');
        if (same) continue;
        for (const val of vals) {
          const escK = escapeAttr(key);
          const escV = escapeAttr(val);
          parts.push(
            `<span class="erp-rfp-chip-rem" data-k="${escK}" data-v="${escV}" style="${CHIP};cursor:pointer" title="Remove">${chipLabel(
              key,
              val
            )} <span aria-hidden="true" style="font-weight:700">×</span></span>`
          );
        }
      }
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
          root.querySelectorAll('.erp-rfp-unitm').forEach(r =>
            r.addEventListener('change', () => {
              const mode = root.querySelector('.erp-rfp-unitm:checked')?.value;
              wrap.classList.toggle('hidden', mode !== 'pick');
              paintChips();
            })
          );
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

    function bindMultiPicker({ showKey, url, listKey, statePick, allKey, listSel, searchSel, countSel, clearSel, esc, wrapSel, modeSel, modePick }) {
      if (!show.has(showKey)) return;
      const list = root.querySelector(listSel);
      const search = root.querySelector(searchSel);
      const countEl = root.querySelector(countSel);
      const wrap = wrapSel ? root.querySelector(wrapSel) : null;
      if (!list) return;
      const headers = typeof authFetchHeaders === 'function' ? authFetchHeaders() : {};
      fetch(url, { headers })
        .then(r => r.json())
        .then(data => {
          state[allKey] = data[listKey] || [];
          function paintCount() {
            if (countEl) countEl.textContent = `${state[statePick].size} selected`;
          }
          function renderList(q) {
            const ql = String(q || '').trim().toLowerCase();
            const rows = state[allKey].filter(v => !ql || String(v).toLowerCase().includes(ql));
            list.innerHTML = rows
              .map(
                v =>
                  `<label style="display:block;font-size:12px;margin:2px 0"><input type="checkbox" class="erp-rfp-${esc}-cb" value="${String(v).replace(/"/g, '&quot;')}" /> ${String(v)}</label>`
              )
              .join('');
            list.querySelectorAll(`.erp-rfp-${esc}-cb`).forEach(cb => {
              cb.checked = state[statePick].has(cb.value);
              cb.addEventListener('change', () => {
                if (cb.checked) state[statePick].add(cb.value);
                else state[statePick].delete(cb.value);
                paintCount();
                paintChips();
              });
            });
          }
          renderList('');
          search?.addEventListener('input', () => renderList(search.value));
          root.querySelector(clearSel)?.addEventListener('click', () => {
            state[statePick].clear();
            renderList(search?.value || '');
            paintCount();
            paintChips();
          });
          if (wrap && modeSel) {
            root.querySelectorAll(modeSel).forEach(r =>
              r.addEventListener('change', () => {
                const mode = root.querySelector(`${modeSel}:checked`)?.value;
                wrap.classList.toggle('hidden', mode !== modePick);
                paintChips();
              })
            );
          }
          paintCount();
        })
        .catch(() => {
          list.textContent = 'Could not load list.';
        });
    }

    function classifyService(s) {
      const low = String(s || '').toLowerCase();
      for (const g of SERVICE_CATEGORY_GROUPS) {
        if (g.id === 'other') continue;
        for (const k of g.keys) {
          if (low.includes(k)) return g.id;
        }
      }
      return 'other';
    }

    function bindGroupedServices() {
      if (!show.has('serviceTypesPick')) return;
      const headers = typeof authFetchHeaders === 'function' ? authFetchHeaders() : {};
      fetch('/api/reports/filters/service-types-used', { headers })
        .then(r => r.json())
        .then(data => {
          state.allServiceTypes = data.serviceTypes || [];
          const search = root.querySelector('.erp-rfp-svc-search');
          function distribute(filterQ) {
            const ql = String(filterQ || '').trim().toLowerCase();
            const lists = {};
            for (const g of SERVICE_CATEGORY_GROUPS) lists[g.id] = [];
            for (const s of state.allServiceTypes) {
              if (ql && !String(s).toLowerCase().includes(ql)) continue;
              lists[classifyService(s)].push(s);
            }
            for (const g of SERVICE_CATEGORY_GROUPS) {
              const hostList = root.querySelector(`[data-grp-list="${g.id}"]`);
              if (!hostList) continue;
              const rows = lists[g.id] || [];
              hostList.innerHTML = rows
                .map(
                  v =>
                    `<label style="display:block;font-size:12px;margin:2px 0"><input type="checkbox" class="erp-rfp-svc-cb" value="${String(v).replace(/"/g, '&quot;')}" /> ${String(v)}</label>`
                )
                .join('');
              hostList.querySelectorAll('.erp-rfp-svc-cb').forEach(cb => {
                cb.checked = state.serviceTypePick.has(cb.value);
                cb.addEventListener('change', () => {
                  if (cb.checked) state.serviceTypePick.add(cb.value);
                  else state.serviceTypePick.delete(cb.value);
                  paintSvcCount();
                  paintChips();
                });
              });
            }
          }
          function paintSvcCount() {
            const c = root.querySelector('.erp-rfp-svc-count');
            if (c) c.textContent = `${state.serviceTypePick.size} service types selected`;
          }
          distribute('');
          search?.addEventListener('input', () => distribute(search.value));
          root.querySelector('.erp-rfp-svc-alltop')?.addEventListener('click', () => {
            state.allServiceTypes.forEach(s => state.serviceTypePick.add(s));
            distribute(search?.value || '');
            paintSvcCount();
            paintChips();
          });
          root.querySelector('.erp-rfp-svc-clear')?.addEventListener('click', () => {
            state.serviceTypePick.clear();
            distribute(search?.value || '');
            paintSvcCount();
            paintChips();
          });
          root.querySelectorAll('.erp-rfp-svcgrp-all').forEach(btn => {
            btn.addEventListener('click', () => {
              const gid = btn.getAttribute('data-grp');
              const hostList = root.querySelector(`[data-grp-list="${gid}"]`);
              hostList?.querySelectorAll('.erp-rfp-svc-cb').forEach(cb => {
                state.serviceTypePick.add(cb.value);
                cb.checked = true;
              });
              paintSvcCount();
              paintChips();
            });
          });
          root.querySelectorAll('.erp-rfp-svcm').forEach(r =>
            r.addEventListener('change', () => {
              const mode = root.querySelector('.erp-rfp-svcm:checked')?.value;
              root.querySelector('.erp-rfp-svc-wrap')?.classList.toggle('hidden', mode !== 'pick');
              paintChips();
            })
          );
          paintSvcCount();
        })
        .catch(() => {
          const w = root.querySelector('.erp-rfp-svc-wrap');
          if (w) w.textContent = 'Could not load service types.';
        });
    }

    function bindLocationNames() {
      if (!show.has('locationNames')) return;
      const list = root.querySelector('.erp-rfp-locnm-list');
      const search = root.querySelector('.erp-rfp-locnm-search');
      if (!list) return;
      const flat = [];
      const headers = typeof authFetchHeaders === 'function' ? authFetchHeaders() : {};
      fetch('/api/reports/filters/service-locations', { headers })
        .then(r => r.json())
        .then(data => {
          const by = data.locationsByType || {};
          for (const arr of Object.values(by)) {
            for (const nm of arr || []) {
              if (nm && !flat.includes(nm)) flat.push(nm);
            }
          }
          state.allLocationNames = flat.sort((a, b) => a.localeCompare(b));
          function render(q) {
            const ql = String(q || '').trim().toLowerCase();
            const rows = state.allLocationNames.filter(v => !ql || String(v).toLowerCase().includes(ql));
            list.innerHTML = rows
              .map(
                v =>
                  `<label style="display:block;font-size:12px;margin:2px 0"><input type="checkbox" class="erp-rfp-locnm-cb" value="${String(v).replace(/"/g, '&quot;')}" /> ${String(v)}</label>`
              )
              .join('');
            list.querySelectorAll('.erp-rfp-locnm-cb').forEach(cb => {
              cb.checked = state.locationNamePick.has(cb.value);
              cb.addEventListener('change', () => {
                if (cb.checked) state.locationNamePick.add(cb.value);
                else state.locationNamePick.delete(cb.value);
                const c = root.querySelector('.erp-rfp-locnm-count');
                if (c) c.textContent = `${state.locationNamePick.size} locations selected`;
                paintChips();
              });
            });
          }
          render('');
          search?.addEventListener('input', () => render(search.value));
          root.querySelector('.erp-rfp-locnm-clear')?.addEventListener('click', () => {
            state.locationNamePick.clear();
            render(search?.value || '');
            paintChips();
          });
        })
        .catch(() => {
          list.textContent = 'Could not load locations.';
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
    root.querySelector('.erp-rfp-lc-all')?.addEventListener('change', e => {
      const on = e.target.checked;
      root.querySelectorAll('.erp-rfp-lc-cb').forEach(cb => {
        cb.checked = on;
      });
      paintChips();
    });
    root.querySelectorAll('.erp-rfp-lc-cb').forEach(cb =>
      cb.addEventListener('change', () => {
        const allOn = [...root.querySelectorAll('.erp-rfp-lc-cb')].every(x => x.checked);
        const lcAll = root.querySelector('.erp-rfp-lc-all');
        if (lcAll) lcAll.checked = allOn;
        paintChips();
      })
    );
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
    root.querySelectorAll('.erp-rfp-ft-cb, .erp-rfp-mk-cb').forEach(el => el.addEventListener('change', paintChips));
    root.querySelectorAll('.erp-rfp-start, .erp-rfp-end, .erp-rfp-cmin, .erp-rfp-cmax').forEach(el => {
      el.addEventListener('input', paintChips);
      el.addEventListener('change', paintChips);
    });
    root.querySelectorAll('.erp-rfp-sortby, .erp-rfp-sortdir, .erp-rfp-groupby').forEach(el => el.addEventListener('change', paintChips));
    root.querySelectorAll('.erp-rfp-af-cb, .erp-rfp-dot-cb, .erp-rfp-ins-cb, .erp-rfp-defonly').forEach(el =>
      el.addEventListener('change', paintChips)
    );
    root.querySelector('.erp-rfp-pmst-all')?.addEventListener('change', e => {
      const on = e.target.checked;
      root.querySelectorAll('.erp-rfp-pmst-cb').forEach(cb => {
        cb.checked = on;
      });
      paintChips();
    });
    root.querySelectorAll('.erp-rfp-pmst-cb').forEach(cb =>
      cb.addEventListener('change', () => {
        const allOn = [...root.querySelectorAll('.erp-rfp-pmst-cb')].every(x => x.checked);
        const pa = root.querySelector('.erp-rfp-pmst-all');
        if (pa) pa.checked = allOn;
        paintChips();
      })
    );

    root.querySelector('.erp-rfp__chips')?.addEventListener('click', ev => {
      const t = ev.target.closest('.erp-rfp-chip-rem');
      if (!t) return;
      const k = t.getAttribute('data-k');
      const v = t.getAttribute('data-v');
      if (k === 'startDate') {
        const el = root.querySelector('.erp-rfp-start');
        if (el) el.value = (baselineObj.startDate && baselineObj.startDate[0]) || '';
      } else if (k === 'endDate') {
        const el = root.querySelector('.erp-rfp-end');
        if (el) el.value = (baselineObj.endDate && baselineObj.endDate[0]) || '';
      } else if (k === 'recordTypes') {
        root.querySelector('.erp-rfp-rt-all') && (root.querySelector('.erp-rfp-rt-all').checked = true);
        root.querySelectorAll('.erp-rfp-rt-cb').forEach(cb => {
          cb.checked = true;
        });
      } else if (k === 'locationCategories') {
        const lcAll = root.querySelector('.erp-rfp-lc-all');
        if (lcAll) lcAll.checked = true;
        root.querySelectorAll('.erp-rfp-lc-cb').forEach(cb => {
          cb.checked = true;
        });
      } else if (k === 'locations') {
        state.locationNamePick.delete(v);
        root.querySelectorAll('.erp-rfp-locnm-cb').forEach(cb => {
          if (cb.value === v) cb.checked = false;
        });
        const c = root.querySelector('.erp-rfp-locnm-count');
        if (c) c.textContent = `${state.locationNamePick.size} locations selected`;
      } else if (k === 'fleetTypes') {
        root.querySelectorAll('.erp-rfp-ft-cb').forEach(cb => {
          if (cb.value === v) cb.checked = true;
        });
      } else if (k === 'makes') {
        root.querySelectorAll('.erp-rfp-mk-cb').forEach(cb => {
          if (cb.value === v) cb.checked = true;
        });
      } else if (k === 'vendors') {
        state.vendorPick.delete(v);
        root.querySelectorAll('.erp-rfp-vendor-cb').forEach(cb => {
          if (cb.value === v) cb.checked = false;
        });
        const c = root.querySelector('.erp-rfp-vendor-count');
        if (c) c.textContent = `${state.vendorPick.size} selected`;
      } else if (k === 'drivers') {
        state.driverPick.delete(v);
        root.querySelectorAll('.erp-rfp-driver-cb').forEach(cb => {
          if (cb.value === v) cb.checked = false;
        });
        const c = root.querySelector('.erp-rfp-driver-count');
        if (c) c.textContent = `${state.driverPick.size} selected`;
      } else if (k === 'serviceTypes') {
        state.serviceTypePick.delete(v);
        root.querySelectorAll('.erp-rfp-svc-cb').forEach(cb => {
          if (cb.value === v) cb.checked = false;
        });
        const c = root.querySelector('.erp-rfp-svc-count');
        if (c) c.textContent = `${state.serviceTypePick.size} service types selected`;
      } else if (k === 'groupBy') {
        const sel = root.querySelector('.erp-rfp-groupby');
        if (sel && baselineObj.groupBy && baselineObj.groupBy[0]) sel.value = baselineObj.groupBy[0];
      } else if (k === 'costMin' || k === 'costMax') {
        const el = root.querySelector(k === 'costMin' ? '.erp-rfp-cmin' : '.erp-rfp-cmax');
        if (el) el.value = '';
      } else if (k === 'showOverdue' || k === 'dueWithinMiles') {
        const o = root.querySelector('.erp-rfp-overdue');
        if (o) o.checked = false;
        const dm = root.querySelector('.erp-rfp-duemiles');
        if (dm) dm.value = '';
      } else if (k === 'pmStatus') {
        root.querySelectorAll('.erp-rfp-pmst-cb').forEach(cb => {
          if (cb.value === v) cb.checked = false;
        });
        const pa = root.querySelector('.erp-rfp-pmst-all');
        if (pa) pa.checked = false;
      } else if (k === 'accidentFault') {
        root.querySelectorAll('.erp-rfp-af-cb').forEach(cb => {
          if (cb.value === v) cb.checked = false;
        });
      } else if (k === 'dotReportable') {
        root.querySelectorAll('.erp-rfp-dot-cb').forEach(cb => {
          if (cb.value === v) cb.checked = false;
        });
      } else if (k === 'insuranceClaim') {
        root.querySelectorAll('.erp-rfp-ins-cb').forEach(cb => {
          if (cb.value === v) cb.checked = false;
        });
      } else if (k === 'defectsOnly') {
        const d = root.querySelector('.erp-rfp-defonly');
        if (d) d.checked = false;
      }
      paintChips();
    });

    if (show.has('units')) bindUnits();
    bindMultiPicker({
      showKey: 'vendors',
      url: '/api/reports/filters/vendors-used',
      listKey: 'vendors',
      statePick: 'vendorPick',
      allKey: 'allVendors',
      listSel: '.erp-rfp-vendor-list',
      searchSel: '.erp-rfp-vendor-search',
      countSel: '.erp-rfp-vendor-count',
      clearSel: '.erp-rfp-vendor-clear',
      esc: 'vendor',
      wrapSel: '.erp-rfp-vendor-wrap',
      modeSel: '.erp-rfp-vendm',
      modePick: 'pick'
    });
    bindMultiPicker({
      showKey: 'drivers',
      url: '/api/reports/filters/drivers-used',
      listKey: 'drivers',
      statePick: 'driverPick',
      allKey: 'allDrivers',
      listSel: '.erp-rfp-driver-list',
      searchSel: '.erp-rfp-driver-search',
      countSel: '.erp-rfp-driver-count',
      clearSel: '.erp-rfp-driver-clear',
      esc: 'driver',
      wrapSel: '.erp-rfp-driver-wrap',
      modeSel: '.erp-rfp-drivm',
      modePick: 'pick'
    });
    bindGroupedServices();
    bindLocationNames();

    baselineObj = spToObject(collectParams());
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
  }

  window.ErpReportFilterPanel = { mount };
})();
