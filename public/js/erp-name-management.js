/**
 * Vendor / driver / customer name management (QBO + Samsara + ERP).
 * Depends on maintenance.html: j, erpWriteHeaders, escapeHtml, openSection, openDedupeTool.
 */
(function () {
  const state = {
    kind: 'vendor',
    mountCatalog: false,
    list: [],
    loadedAt: null,
    selected: null,
    detail: null,
    search: '',
    filter: 'all',
    page: 1,
    pageSize: 50,
    realmId: null,
    samsaraDrivers: [],
    renameHistory: [],
    bulkRows: []
  };

  function nmHostEl() {
    return state.mountCatalog
      ? document.getElementById('erpNameMgmtRootCatalog')
      : document.getElementById('erpNameMgmtRoot');
  }

  function esc(s) {
    return typeof escapeHtml === 'function' ? escapeHtml(String(s ?? '')) : String(s ?? '');
  }

  async function nmFetch(url, opts) {
    if (typeof j === 'function') return j(url, opts || {});
    const t = localStorage.getItem('ih35_token');
    const wh = typeof erpWriteHeaders === 'function' ? erpWriteHeaders() : {};
    const r = await fetch(url, {
      ...opts,
      headers: { Accept: 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...wh, ...(opts && opts.headers) }
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: text.slice(0, 200) };
    }
    if (!r.ok) throw new Error(data.error || text.slice(0, 200));
    return data;
  }

  async function nmPost(url, body) {
    return nmFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  function endpointList() {
    if (state.kind === 'driver') return '/api/name-management/drivers';
    if (state.kind === 'customer') return '/api/name-management/customers';
    return '/api/name-management/vendors';
  }

  function listKey() {
    if (state.kind === 'driver') return 'drivers';
    if (state.kind === 'customer') return 'customers';
    return 'vendors';
  }

  async function refreshLists() {
    const url = endpointList() + '?refresh=1';
    const data = await nmFetch(url);
    state.list = data[listKey()] || [];
    state.loadedAt = data.loadedAt || null;
    try {
      const qb = await nmFetch('/api/qbo/status').catch(() => null);
      state.realmId = qb?.realmId || qb?.realm_id || null;
    } catch {
      state.realmId = null;
    }
  }

  function filteredList() {
    let rows = state.list.slice();
    const q = state.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(r => {
        const n = String(r.primaryName || r.qboName || r.erpName || '').toLowerCase();
        return n.includes(q);
      });
    }
    if (state.filter === 'mismatch') rows = rows.filter(r => r.nameMismatch);
    else if (state.filter === 'qbo') rows = rows.filter(r => state.kind === 'driver' && r.inQbo && !r.inSamsara);
    else if (state.filter === 'samsara') rows = rows.filter(r => state.kind === 'driver' && r.inSamsara && !r.inQbo);
    else if (state.filter === 'both') rows = rows.filter(r => state.kind === 'driver' && r.inQbo && r.inSamsara);
    else if (state.filter === 'erp') rows = rows.filter(r => r.inErp);
    return rows;
  }

  function paginatedRows() {
    const all = filteredList();
    const start = (state.page - 1) * state.pageSize;
    return { pageRows: all.slice(start, start + state.pageSize), total: all.length };
  }

  function qboVendorUrl(id) {
    const rid = state.realmId ? `&companyId=${encodeURIComponent(state.realmId)}` : '';
    return `https://app.qbo.intuit.com/app/vendordetail?nameId=${encodeURIComponent(id)}${rid}`;
  }

  function qboCustomerUrl(id) {
    const rid = state.realmId ? `&companyId=${encodeURIComponent(state.realmId)}` : '';
    return `https://app.qbo.intuit.com/app/customerdetail?nameId=${encodeURIComponent(id)}${rid}`;
  }

  async function loadDetail(row) {
    state.selected = row;
    state.detail = null;
    paint();
    const id = state.kind === 'driver' ? row.erpId : row.qboId;
    if (!id) return;
    const data = await nmFetch(`/api/name-management/record/${state.kind}/${encodeURIComponent(id)}`);
    state.detail = data.record || null;
    paint();
  }

  async function loadSamsaraDrivers() {
    try {
      const d = await nmFetch('/api/name-management/samsara-drivers');
      state.samsaraDrivers = d.drivers || [];
    } catch {
      state.samsaraDrivers = [];
    }
  }

  function paintList(host) {
    const { pageRows, total } = paginatedRows();
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;
    const rows = pageRows
      .map(r => {
        const id = state.kind === 'driver' ? r.erpId : r.qboId;
        const sel = state.selected && (state.kind === 'driver' ? state.selected.erpId : state.selected.qboId) === id;
        const letter = String(r.primaryName || '?').trim().charAt(0).toUpperCase();
        const mm = r.nameMismatch ? '<span style="color:#b06000;font-size:11px">⚠ Name mismatch</span>' : '';
        return `<div class="nm-list-item${sel ? ' nm-list-item--sel' : ''}" data-id="${esc(id)}">
          <div class="nm-av">${esc(letter)}</div>
          <div class="nm-list-mid">
            <div class="nm-list-title">${esc(r.primaryName || r.qboName)}</div>
            <div class="nm-badges">
              ${r.inQbo ? '<span class="nm-pill nm-pill--g">QBO</span>' : ''}
              ${state.kind === 'driver' && r.inSamsara ? '<span class="nm-pill nm-pill--gr">Samsara</span>' : ''}
              ${r.inErp ? '<span class="nm-pill nm-pill--b">ERP</span>' : ''}
            </div>
            ${mm}
          </div>
          ${r.nameMismatch ? '<div style="color:#b06000">⚠</div>' : ''}
        </div>`;
      })
      .join('');
    host.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <input type="search" class="nm-search" placeholder="Search…" value="${esc(state.search)}" data-nm-search />
        <button type="button" class="btn btn--small" data-nm-refresh>Refresh all lists</button>
      </div>
      <div class="nm-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${(
          state.kind === 'driver'
            ? ['all', 'mismatch', 'erp', 'qbo', 'samsara', 'both']
            : ['all', 'mismatch', 'erp']
        )
          .map(f => {
            const lab =
              f === 'mismatch'
                ? 'Has name mismatch'
                : f === 'all'
                  ? 'All'
                  : f === 'erp'
                    ? 'In ERP'
                    : f === 'qbo'
                      ? 'In QBO only'
                      : f === 'samsara'
                        ? 'In Samsara only'
                        : 'In both';
            return `<button type="button" class="btn btn--small${state.filter === f ? '' : ' btn--ghost'}" data-nm-filter="${f}">${lab}</button>`;
          })
          .join('')}
      </div>
      <div class="nm-list">${rows || '<div class="muted" style="padding:16px;text-align:center">No records.</div>'}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px">
        <button type="button" class="btn btn--small btn--ghost" data-nm-prev ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
        <span>Page ${state.page} of ${pages}</span>
        <button type="button" class="btn btn--small btn--ghost" data-nm-next ${state.page >= pages ? 'disabled' : ''}>Next</button>
      </div>`;
  }

  function paintDetail(host) {
    if (!state.selected) {
      host.innerHTML = '<p class="muted" style="text-align:center;padding:40px 12px;font-size:13px">Select a record from the list.</p>';
      return;
    }
    const d = state.detail;
    const row = state.selected;
    const canon = document.getElementById('nmCanonInput');
    const qboN = d?.qboName ?? row.qboName ?? '';
    const samN = d?.samsaraName ?? row.samsaraName ?? '';
    const erpN =
      state.kind === 'driver'
        ? d?.erpName ?? row.erpName ?? ''
        : d?.erpNameSample ?? row.erpNameSample ?? row.primaryName ?? '';
    const counts = d?.counts || row.counts || {};
    const wo = Number(counts.workOrders || 0) + Number(counts.workOrderLines || 0);
    const exp = Number(counts.records || 0) + Number(counts.apTransactions || 0);
    const bills = Number(counts.vendorBillPaymentRecords || 0);
    const fuel = Number(counts.fuelPurchases || 0) + Number(counts.fuelDrafts || 0);
    const erpLine = `Used in ~${wo} work order refs, ${exp} expense/AP refs, ${bills} bill-pay refs, ${fuel} fuel refs (approximate from ERP JSON).`;
    const mismatchNote =
      row.nameMismatch && d
        ? `<div style="margin-top:10px;background:#fef7e0;border-radius:6px;padding:10px 12px;font-size:12px">⚠ Name mismatch detected. Standardize below.</div>`
        : '';
    const linkBlock =
      state.kind === 'driver' && !row.samsaraId
        ? `<div style="margin-top:12px;padding:12px;border:1px solid #e0e3e8;border-radius:8px">
            <div style="font-weight:600;margin-bottom:6px">Link to Samsara driver</div>
            <select id="nmLinkSam" class="qb-in" style="max-width:100%;width:100%"></select>
            <button type="button" class="btn" style="margin-top:8px" id="nmLinkBtn">Save link</button>
          </div>`
        : '';
    host.innerHTML = `
      <div style="background:#fff;border:1px solid #e0e3e8;border-radius:8px;padding:16px;margin-bottom:14px">
        <div style="font-weight:600;margin-bottom:10px">Current names</div>
        <table class="erp-dedupe-table" style="width:100%;font-size:12px">
          <thead><tr><th>System</th><th>Name</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr><td>QuickBooks</td><td>${esc(qboN || '—')}</td><td>${qboN && erpN && qboN.trim() === erpN.trim() ? '✓' : '⚠'}</td><td>${
              row.qboId
                ? `<a href="${state.kind === 'customer' ? qboCustomerUrl(row.qboId) : qboVendorUrl(row.qboId)}" target="_blank" rel="noopener">Edit in QBO</a>`
                : '—'
            }</td></tr>
            ${
              state.kind === 'driver'
                ? `<tr><td>Samsara</td><td>${esc(samN || '—')}</td><td>${samN && erpN && samN.trim() === erpN.trim() ? '✓' : '⚠'}</td><td>${row.samsaraId ? `<a href="https://cloud.samsara.com/o/drivers/${encodeURIComponent(row.samsaraId)}" target="_blank" rel="noopener">View</a>` : 'Not linked'}</td></tr>`
                : ''
            }
            <tr><td>ERP</td><td>${esc(erpN || '—')}</td><td>—</td><td style="font-size:11px;color:#555">${esc(erpLine)}</td></tr>
          </tbody>
        </table>
        ${mismatchNote}
      </div>
      <div style="background:#fff;border:1px solid #e0e3e8;border-radius:8px;padding:16px;margin-bottom:14px">
        <div style="font-weight:600;margin-bottom:8px">Set the official name</div>
        <label class="qb-l">Official / canonical name</label>
        <input id="nmCanonInput" class="qb-in" style="height:36px;font-size:14px" value="${esc(qboN || row.primaryName || '')}" placeholder="Enter the correct official name" />
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0">
          ${qboN ? `<button type="button" class="btn btn--small btn--ghost" data-pick="qbo">Use QBO: ${esc(qboN)}</button>` : ''}
          ${state.kind === 'driver' && samN ? `<button type="button" class="btn btn--small btn--ghost" data-pick="sam">Use Samsara: ${esc(samN)}</button>` : ''}
          ${erpN ? `<button type="button" class="btn btn--small btn--ghost" data-pick="erp">Use ERP: ${esc(erpN)}</button>` : ''}
        </div>
        <div class="form-stack" style="margin:10px 0">
          <label><input type="checkbox" id="nmUpQbo" checked /> Update QuickBooks</label>
          ${state.kind === 'driver' && row.samsaraId ? `<label><input type="checkbox" id="nmUpSam" checked /> Update Samsara</label>` : ''}
          <label><input type="checkbox" id="nmUpErp" checked /> Update ERP JSON + driver row</label>
        </div>
        <div id="nmPreview" style="background:#f8f9fa;border-radius:6px;padding:10px 12px;font-size:11px;margin-bottom:10px">Preview updates as you type.</div>
        <button type="button" class="btn" style="width:100%;height:36px;background:#1b5e20;color:#fff;border:none;border-radius:6px" id="nmApplyBtn">Apply rename…</button>
      </div>
      ${linkBlock}
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-weight:600">Rename history (this record)</summary>
        <div id="nmRowHistory" class="mini-note" style="margin-top:8px">Loading…</div>
      </details>`;
    const inp = document.getElementById('nmCanonInput');
    if (inp) {
      inp.oninput = () => paintPreview();
      paintPreview();
    }
    host.querySelectorAll('[data-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-pick');
        const v = k === 'qbo' ? qboN : k === 'sam' ? samN : erpN;
        const el = document.getElementById('nmCanonInput');
        if (el) el.value = v;
        paintPreview();
      });
    });
    document.getElementById('nmApplyBtn')?.addEventListener('click', openConfirmModal);
    if (state.kind === 'driver' && !row.samsaraId) {
      const sel = document.getElementById('nmLinkSam');
      if (sel) {
        sel.innerHTML =
          `<option value="">— Select Samsara driver —</option>` +
          state.samsaraDrivers
            .map(s => `<option value="${esc(s.id)}">${esc(s.name)} (${esc(s.id)})</option>`)
            .join('');
      }
      document.getElementById('nmLinkBtn')?.addEventListener('click', async () => {
        const sid = document.getElementById('nmLinkSam')?.value || '';
        if (!sid) return alert('Select a Samsara driver.');
        await nmPost('/api/name-management/link', {
          erp_driver_id: row.erpId,
          samsara_driver_id: sid,
          qbo_vendor_id: row.qboId || null
        });
        await refreshLists();
        const nr = state.list.find(x => x.erpId === row.erpId);
        if (nr) await loadDetail(nr);
      });
    }
    void loadRowHistory();
  }

  function paintPreview() {
    const el = document.getElementById('nmPreview');
    if (!el || !state.selected) return;
    const row = state.selected;
    const nn = String(document.getElementById('nmCanonInput')?.value || '').trim();
    const qboOld = row.qboName || '';
    const samOld = row.samsaraName || '';
    const erpOld = state.kind === 'driver' ? row.erpName : row.erpNameSample || row.primaryName;
    const upQ = document.getElementById('nmUpQbo')?.checked;
    const upS = document.getElementById('nmUpSam')?.checked;
    const upE = document.getElementById('nmUpErp')?.checked;
    const lines = [];
    if (upQ) {
      lines.push(
        qboOld === nn
          ? `— QuickBooks: already "${esc(nn)}"`
          : `✓ QuickBooks: "${esc(qboOld)}" → "${esc(nn)}"`
      );
    }
    if (state.kind === 'driver' && upS && row.samsaraId) {
      lines.push(
        samOld === nn
          ? `— Samsara: already "${esc(nn)}"`
          : `✓ Samsara: "${esc(samOld)}" → "${esc(nn)}"`
      );
    }
    if (upE) lines.push('✓ ERP: JSON vendor/driver text fields + Postgres driver name (when applicable)');
    el.innerHTML = '<strong>Changes to be made</strong><br/>' + (lines.length ? lines.join('<br/>') : '—');
  }

  async function loadRowHistory() {
    const host = document.getElementById('nmRowHistory');
    if (!host || !state.selected) return;
    try {
      const id = state.kind === 'driver' ? state.selected.erpId : state.selected.qboId;
      const h = await nmFetch(`/api/name-management/rename-history?limit=30&type=${state.kind}`);
      const rows = (h.rows || []).filter(
        r => String(r.erp_id) === String(id) || String(r.qbo_id) === String(id)
      );
      host.innerHTML = rows.length
        ? `<table class="erp-dedupe-table"><thead><tr><th>When</th><th>Old</th><th>New</th><th>By</th></tr></thead><tbody>${rows
            .map(
              x =>
                `<tr><td>${esc(new Date(x.renamed_at).toLocaleString())}</td><td>${esc(x.old_name)}</td><td>${esc(x.new_name)}</td><td>${esc(x.renamed_by)}</td></tr>`
            )
            .join('')}</tbody></table>`
        : 'No renames logged for this id yet.';
    } catch {
      host.textContent = 'Could not load history.';
    }
  }

  function openConfirmModal() {
    const nn = String(document.getElementById('nmCanonInput')?.value || '').trim();
    if (nn.length < 2) return alert('Enter a name (2+ characters).');
    const row = state.selected;
    if (!row) return;
    const allSame =
      (row.qboName || '') === nn &&
      (state.kind !== 'driver' || (row.samsaraName || '') === nn) &&
      ((state.kind === 'driver' ? row.erpName : row.erpNameSample) || '') === nn;
    if (allSame) return alert('New name matches all sources — nothing to update.');
    const backdrop = document.createElement('div');
    backdrop.className = 'nm-modal-backdrop';
    backdrop.innerHTML = `
      <div class="nm-modal" role="dialog" aria-modal="true">
        <h3 style="margin:0 0 12px">Confirm rename</h3>
        <p class="mini-note">Record: <strong>${esc(row.primaryName)}</strong><br/>New name: <strong>${esc(nn)}</strong></p>
        <label style="display:block;margin:12px 0;font-size:13px"><input type="checkbox" id="nmConfirmAck" /> I confirm this rename should be applied across the selected systems.</label>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
          <button type="button" class="btn btn--ghost" data-cancel>Cancel</button>
          <button type="button" class="btn" style="background:#1b5e20;color:#fff" id="nmDoRename" disabled>Apply rename</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const ack = backdrop.querySelector('#nmConfirmAck');
    const go = backdrop.querySelector('#nmDoRename');
    ack.addEventListener('change', () => {
      go.disabled = !ack.checked;
    });
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => backdrop.remove());
    go.addEventListener('click', async () => {
      go.disabled = true;
      const body = {
        type: state.kind,
        erp_id: state.kind === 'driver' ? row.erpId : undefined,
        qbo_id: row.qboId || undefined,
        samsara_id: row.samsaraId || undefined,
        new_name: nn,
        update_qbo: document.getElementById('nmUpQbo')?.checked !== false,
        update_samsara: state.kind === 'driver' ? document.getElementById('nmUpSam')?.checked !== false : false,
        update_erp: document.getElementById('nmUpErp')?.checked !== false
      };
      try {
        const out = await nmPost('/api/name-management/rename', body);
        const parts = [];
        parts.push(out.qbo_updated ? 'QuickBooks: updated ✓' : `QuickBooks: ${out.qbo_error || 'skipped'}`);
        if (state.kind === 'driver') parts.push(out.samsara_updated ? 'Samsara: updated ✓' : `Samsara: ${out.samsara_error || 'skipped'}`);
        parts.push(`ERP rows touched: ${out.erp_records_updated}${out.erp_error ? ' — ' + out.erp_error : ' ✓'}`);
        alert(out.success ? 'Name update finished.\n\n' + parts.join('\n') : 'Completed with warnings.\n\n' + parts.join('\n'));
        backdrop.remove();
        await refreshLists();
        const id = state.kind === 'driver' ? row.erpId : row.qboId;
        const nr = state.list.find(x => (state.kind === 'driver' ? x.erpId : x.qboId) === id);
        if (nr) await loadDetail(nr);
        else {
          state.selected = null;
          state.detail = null;
          paint();
        }
      } catch (e) {
        alert('Rename failed: ' + (e.message || e));
        go.disabled = false;
      }
    });
  }

  function wire(host) {
    host.querySelector('[data-nm-search]')?.addEventListener('input', ev => {
      state.search = ev.target.value;
      state.page = 1;
      paintList(host.querySelector('.nm-layout-left'));
    });
    host.querySelector('[data-nm-refresh]')?.addEventListener('click', async () => {
      await refreshLists();
      paint();
    });
    host.querySelectorAll('[data-nm-filter]').forEach(b => {
      b.addEventListener('click', () => {
        state.filter = b.getAttribute('data-nm-filter');
        state.page = 1;
        paint();
      });
    });
    host.querySelector('[data-nm-prev]')?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page--;
        paint();
      }
    });
    host.querySelector('[data-nm-next]')?.addEventListener('click', () => {
      state.page++;
      paint();
    });
    host.querySelectorAll('.nm-list-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        const row = state.list.find(r => String(state.kind === 'driver' ? r.erpId : r.qboId) === String(id));
        if (row) void loadDetail(row);
      });
    });
  }

  function paint() {
    const host = nmHostEl();
    if (!host) return;
    const loaded = state.loadedAt ? new Date(state.loadedAt).toLocaleString() : '—';
    host.innerHTML = `
      <style>
        .nm-wrap{max-width:1200px;margin:0 auto;padding:12px 16px 32px;font-family:inherit}
        .nm-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
        .nm-seg{display:inline-flex;border:1px solid #d0d4da;border-radius:6px;overflow:hidden}
        .nm-seg button{border:none;background:#fff;padding:8px 14px;cursor:pointer;font-size:13px}
        .nm-seg button.nm-seg--on{background:#e8f0fe;font-weight:600}
        .nm-banner{background:#fef7e0;border:1px solid #f5c67f;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px}
        .nm-layout{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
        .nm-layout-left{flex:1 1 300px;min-width:280px;max-width:420px;border:1px solid #e0e3e8;border-radius:8px;background:#fff}
        .nm-layout-right{flex:2 1 400px;min-width:300px}
        .nm-search{width:100%;height:34px;border:1px solid #d0d4da;border-radius:4px;padding:0 10px;box-sizing:border-box}
        .nm-list{max-height:520px;overflow:auto}
        .nm-list-item{display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid #f1f3f4;cursor:pointer;gap:10px}
        .nm-list-item--sel{background:#e8f0fe;border-left:3px solid #1557a0}
        .nm-av{width:28px;height:28px;border-radius:50%;background:#e8f0fe;color:#1557a0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}
        .nm-list-title{font-size:13px;font-weight:500;color:#1a1f36}
        .nm-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
        .nm-pill{font-size:10px;padding:2px 6px;border-radius:10px}
        .nm-pill--g{background:#e6f4ea;color:#137333}
        .nm-pill--gr{background:#eceff1;color:#444}
        .nm-pill--b{background:#e8f0fe;color:#1557a0}
        .nm-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:12000}
        .nm-modal{width:min(500px,92vw);background:#fff;border-radius:10px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,.2)}
      </style>
      <div class="nm-wrap">
        <h1 style="font-size:22px;margin:0 0 4px">Vendor &amp; driver name management</h1>
        <p class="muted" style="margin:0 0 12px;font-size:13px">Keep names consistent across QuickBooks, Samsara, and ERP records.</p>
        <div class="nm-top">
          <div class="nm-seg">
            <button type="button" data-kind="vendor" class="${state.kind === 'vendor' ? 'nm-seg--on' : ''}">Vendors</button>
            <button type="button" data-kind="driver" class="${state.kind === 'driver' ? 'nm-seg--on' : ''}">Drivers</button>
            <button type="button" data-kind="customer" class="${state.kind === 'customer' ? 'nm-seg--on' : ''}">Customers</button>
          </div>
          <span class="mini-note">Last loaded: ${esc(loaded)}</span>
        </div>
        <div class="nm-banner">Renaming updates QuickBooks, Samsara (drivers when linked), and ERP JSON. You must confirm each rename in the dialog before anything changes.</div>
        <div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn--small btn--ghost" id="nmBulkBtn">Bulk standardize (mismatches)</button>
          <button type="button" class="btn btn--small btn--ghost" id="nmHistAllBtn">Full rename history</button>
        </div>
        <div class="nm-layout">
          <div class="nm-layout-left"></div>
          <div class="nm-layout-right"></div>
        </div>
      </div>`;
    const left = host.querySelector('.nm-layout-left');
    const right = host.querySelector('.nm-layout-right');
    paintList(left);
    paintDetail(right);
    host.querySelectorAll('[data-kind]').forEach(btn => {
      btn.addEventListener('click', async () => {
        state.kind = btn.getAttribute('data-kind');
<<<<<<< HEAD
        if (state.kind !== 'driver' && ['qbo', 'samsara', 'both'].includes(state.filter)) state.filter = 'all';
=======
>>>>>>> origin/2026-04-20-jzws
        state.page = 1;
        state.selected = null;
        state.detail = null;
        await refreshLists();
        if (state.kind === 'driver') await loadSamsaraDrivers();
        paint();
      });
    });
    document.getElementById('nmBulkBtn')?.addEventListener('click', openBulkModal);
    document.getElementById('nmHistAllBtn')?.addEventListener('click', openHistoryModal);
    wire(host);
  }

  async function openBulkModal() {
    const t = state.kind;
    const data = await nmFetch(`/api/name-management/mismatches?type=${encodeURIComponent(t)}`);
    state.bulkRows = data.records || [];
    const backdrop = document.createElement('div');
    backdrop.className = 'nm-modal-backdrop';
    const rows = state.bulkRows
      .map((r, i) => {
        const id = t === 'driver' ? r.erpId : r.qboId;
        const sug = r.primaryName || r.qboName || '';
        return `<tr data-i="${i}"><td><input type="checkbox" class="nm-bulk-cb" data-id="${esc(id)}" /></td>
          <td>${esc(r.primaryName)}</td><td>${esc(t)}</td>
          <td>${esc(r.qboName)}</td>
          <td>${t === 'driver' ? esc(r.samsaraName || '—') : '—'}</td>
          <td>${esc(r.erpName || r.erpNameSample || '')}</td>
          <td>${esc(sug)}</td>
          <td><input class="qb-in nm-bulk-name" style="min-width:140px" value="${esc(sug)}" /></td></tr>`;
      })
      .join('');
    backdrop.innerHTML = `
      <div class="nm-modal" style="width:min(1100px,94vw);max-height:88vh;overflow:auto">
        <h3 style="margin-top:0">Bulk name standardization</h3>
        <p class="mini-note">Up to 50 renames per request. Each row still requires confirmation in the API batch (checkboxes below).</p>
        <table class="erp-dedupe-table" style="font-size:11px"><thead>
          <tr><th><input type="checkbox" id="nmBulkAll" /></th><th>Record</th><th>Type</th><th>QBO</th><th>Samsara</th><th>ERP</th><th>Suggested</th><th>New name</th></tr>
        </thead><tbody>${rows || '<tr><td colspan="8">No mismatches.</td></tr>'}</tbody></table>
        <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px">
          <button type="button" class="btn btn--ghost" data-close>Close</button>
          <button type="button" class="btn" style="background:#1b5e20;color:#fff" id="nmBulkRun">Apply selected</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-close]').addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#nmBulkAll')?.addEventListener('change', ev => {
      backdrop.querySelectorAll('.nm-bulk-cb').forEach(c => {
        c.checked = ev.target.checked;
      });
    });
    backdrop.querySelector('#nmBulkRun')?.addEventListener('click', async () => {
      const trs = [...backdrop.querySelectorAll('tbody tr')];
      const renames = [];
      for (const tr of trs) {
        const cb = tr.querySelector('.nm-bulk-cb');
        if (!cb || !cb.checked) continue;
        const nm = tr.querySelector('.nm-bulk-name')?.value?.trim();
        if (!nm || nm.length < 2) continue;
        const id = cb.getAttribute('data-id');
        const r = state.bulkRows[Number(tr.getAttribute('data-i'))];
        renames.push({
          type: t,
          erp_id: t === 'driver' ? id : undefined,
          qbo_id: r.qboId || id,
          samsara_id: r.samsaraId || undefined,
          new_name: nm,
          update_qbo: true,
          update_samsara: t === 'driver',
          update_erp: true
        });
      }
      if (!renames.length) return alert('Select at least one row with a valid new name.');
      if (!window.confirm(`Apply ${renames.length} rename(s)? Each uses live QBO/Samsara/ERP writes.`)) return;
      const out = await nmPost('/api/name-management/bulk-rename', { renames });
      const okN = (out.results || []).filter(x => x.ok && x.success).length;
      alert(`Bulk rename finished. ${okN} / ${renames.length} reported full success. See server logs for details.`);
      backdrop.remove();
      await refreshLists();
      paint();
    });
  }

  async function openHistoryModal() {
    const data = await nmFetch('/api/name-management/rename-history?limit=200');
    const backdrop = document.createElement('div');
    backdrop.className = 'nm-modal-backdrop';
    backdrop.innerHTML = `
      <div class="nm-modal" style="width:min(900px,94vw);max-height:88vh;overflow:auto">
        <h3 style="margin-top:0">Rename history</h3>
        <p class="mini-note"><a href="/api/name-management/rename-history?format=xlsx" target="_blank" rel="noopener">Export Excel</a> (same filters as JSON in a follow-up).</p>
        <table class="erp-dedupe-table" style="font-size:11px"><thead>
          <tr><th>When</th><th>Type</th><th>Old</th><th>New</th><th>QBO</th><th>Sam</th><th>ERP#</th><th>By</th></tr>
        </thead><tbody>${(data.rows || [])
          .map(
            x =>
              `<tr><td>${esc(new Date(x.renamed_at).toLocaleString())}</td><td>${esc(x.record_type)}</td><td>${esc(x.old_name)}</td><td>${esc(x.new_name)}</td>
            <td>${x.qbo_updated ? '✓' : '✗'}</td><td>${x.samsara_updated ? '✓' : '✗'}</td><td>${esc(x.erp_records_updated)}</td><td>${esc(x.renamed_by)}</td></tr>`
          )
          .join('')}</tbody></table>
        <button type="button" class="btn" style="margin-top:12px" data-close>Close</button>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-close]').addEventListener('click', () => backdrop.remove());
  }

  window.erpNameMgmtInit = async function (opts) {
    state.mountCatalog = !!(opts && opts.catalog);
    const host = nmHostEl();
    if (!host) return;
    state.kind = 'vendor';
    state.page = 1;
    state.filter = 'all';
    state.search = '';
    await refreshLists();
    if (state.kind === 'driver') await loadSamsaraDrivers();
    paint();
  };

  window.openNameMgmtTool = function () {
    if (typeof openSection === 'function') openSection('name-mgmt', null);
    else window.location.hash = 'name-mgmt';
    setTimeout(() => {
      if (typeof window.erpNameMgmtInit === 'function') window.erpNameMgmtInit();
    }, 0);
  };
})();
