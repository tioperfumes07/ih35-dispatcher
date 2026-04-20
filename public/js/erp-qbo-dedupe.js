/**
 * Vendor & customer deduplication workspace (QuickBooks).
 * Depends on maintenance.html: openSection, j, erpWriteHeaders, escapeHtml if present.
 */
(function () {
  const LS_SKIP = 'ih35_dedupe_skipped_groups';

  const state = {
    entity: 'vendor',
    tab: 'auto',
    loadedAt: null,
    realmId: null,
    duplicateGroups: [],
    visibleGroups: [],
    highN: 0,
    medN: 0,
    totalRecords: 0,
    loading: false,
    manual: { a: null, b: null, keep: 'a' },
    history: { rows: [], total: 0, page: 1, detail: null }
  };

  function money(n) {
    const x = Number(n) || 0;
    return '$' + x.toFixed(2);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return String(iso);
    }
  }

  function localSkippedSet() {
    try {
      const raw = localStorage.getItem(LS_SKIP) || '{}';
      const o = JSON.parse(raw);
      const arr = o[state.entity] || [];
      return new Set(arr.map(String));
    } catch {
      return new Set();
    }
  }

  function rememberLocalSkip(sig) {
    try {
      const raw = localStorage.getItem(LS_SKIP) || '{}';
      const o = JSON.parse(raw);
      if (!o[state.entity]) o[state.entity] = [];
      if (!o[state.entity].includes(sig)) o[state.entity].push(sig);
      localStorage.setItem(LS_SKIP, JSON.stringify(o));
    } catch {
      /* ignore */
    }
  }

  function filterGroupsByLocal(groups) {
    const loc = localSkippedSet();
    return (groups || []).filter(g => !loc.has(g.groupSignature));
  }

  function qboVendorUrl(id, realm) {
    const rid = realm ? `&companyId=${encodeURIComponent(realm)}` : '';
    return `https://app.qbo.intuit.com/app/vendordetail?nameId=${encodeURIComponent(id)}${rid}`;
  }

  function qboCustomerUrl(id, realm) {
    const rid = realm ? `&companyId=${encodeURIComponent(realm)}` : '';
    return `https://app.qbo.intuit.com/app/customerdetail?nameId=${encodeURIComponent(id)}${rid}`;
  }

  async function dedupePostJson(url, body) {
    const wh = typeof erpWriteHeaders === 'function' ? erpWriteHeaders() : {};
    return j(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...wh },
      body: JSON.stringify(body || {})
    });
  }

  async function dedupeDownload(url, filename) {
    const t = localStorage.getItem('ih35_token');
    const wh = typeof erpWriteHeaders === 'function' ? erpWriteHeaders() : {};
    const r = await fetch(url, { headers: { Accept: '*/*', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...wh } });
    if (!r.ok) throw new Error((await r.text()).slice(0, 200));
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'export.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function cellClass(vals) {
    const u = [...new Set(vals.map(v => String(v || '').trim()))];
    if (u.length <= 1) return 'erp-dedupe-cell--same';
    return 'erp-dedupe-cell--diff';
  }

  function renderMergeCard(group) {
    const recs = group.records || [];
    const cols = ['qboId', 'name', 'balance', 'phone', 'email', 'address', 'txn', 'active', 'created'];
    const conf = group.confidence === 'HIGH';
    const badge = conf
      ? '<span class="erp-dedupe-badge erp-dedupe-badge--high">● HIGH CONFIDENCE</span>'
      : '<span class="erp-dedupe-badge erp-dedupe-badge--med">◐ REVIEW NEEDED</span>';
    const addrFor = r =>
      [r.billAddr && r.billAddr.Line1, r.billAddr && r.billAddr.City].filter(Boolean).join(', ') || '—';
    const vals = name => recs.map(r => {
      if (name === 'balance') return money(r.balance);
      if (name === 'address') return addrFor(r);
      if (name === 'txn') return '—';
      if (name === 'active') return r.active === false ? 'Inactive' : 'Active';
      if (name === 'created') return fmtDate(r.created);
      return String(r[name] || '—');
    });
    const txnCounts = recs.map(() => '—');
    const rows = recs
      .map((r, ri) => {
        const rowBg = ri === 0 ? '#ffffff' : '#fafafa';
        const radioId = `dedupe_keep_${group.groupSignature}_${ri}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        return `<tr data-row="${ri}" style="background:${rowBg}">
        <td class="erp-dedupe-keepcell" style="vertical-align:top">
          <label style="cursor:pointer;display:block">
            <input type="radio" name="dedupe_keep_${String(group.groupSignature).replace(/[^a-zA-Z0-9]+/g, '_')}" value="${escapeAttr(
            r.qboId
          )}" id="${radioId}" />
            <div class="erp-dedupe-keeplbl" data-role="lbl"></div>
          </label>
        </td>
        <td class="${cellClass(recs.map(x => x.qboId))} mono">${escapeHtml(r.qboId)}</td>
        <td class="${cellClass(recs.map(x => x.name))}">${escapeHtml(r.name)}</td>
        <td class="${cellClass(recs.map(x => money(x.balance)))} num">${money(r.balance)}</td>
        <td class="${cellClass(recs.map(x => x.phone))}">${escapeHtml(r.phone || '—')}</td>
        <td class="${cellClass(recs.map(x => x.email))}">${escapeHtml(r.email || '—')}</td>
        <td class="${cellClass(recs.map(addrFor))}">${escapeHtml(addrFor(r))}</td>
        <td class="mono">${escapeHtml(txnCounts[ri])}</td>
        <td class="${cellClass(recs.map(x => (x.active === false ? 'Inactive' : 'Active')))}">${r.active === false ? 'Inactive' : 'Active'}</td>
        <td class="${cellClass(recs.map(x => fmtDate(x.created)))}">${escapeHtml(fmtDate(r.created))}</td>
      </tr>`;
      })
      .join('');
    return `<div class="erp-dedupe-card" data-sig="${escapeAttr(group.groupSignature)}">
      <div class="erp-dedupe-card__head">
        <div>
          ${badge}
          <div class="erp-dedupe-card__rule">Matched by: ${escapeHtml(group.matchedBy)}</div>
        </div>
        <button type="button" class="erp-dedupe-skip" data-action="skip">Skip this group</button>
      </div>
      <table class="erp-dedupe-table">
        <thead><tr>
          <th>Keep</th><th>QBO ID</th><th>Name</th><th class="num">Balance</th><th>Phone</th><th>Email</th><th>Address</th><th>Transactions</th><th>Active</th><th>Created</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="erp-dedupe-card__foot">
        <span class="erp-dedupe-foot-hint" data-role="pick-hint">Select which record to keep using the radio button above.</span>
        <div class="erp-dedupe-card__actions">
          <button type="button" class="erp-dedupe-btn erp-dedupe-btn--link" data-action="preview">Preview merge</button>
          <button type="button" class="erp-dedupe-btn erp-dedupe-btn--merge" disabled data-action="merge">Merge</button>
        </div>
      </div>
    </div>`;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function bindCardRadios(root) {
    root.querySelectorAll('.erp-dedupe-card').forEach(card => {
      const mergeBtn = card.querySelector('[data-action="merge"]');
      const hint = card.querySelector('[data-role="pick-hint"]');
      const radios = [...card.querySelectorAll('input[type="radio"]')];
      const sync = () => {
        const sel = radios.find(r => r.checked);
        mergeBtn.disabled = !sel;
        if (hint) hint.style.display = sel ? 'none' : '';
        radios.forEach((r, i) => {
          const tr = r.closest('tr');
          const lbl = r.parentElement.querySelector('[data-role="lbl"]');
          if (!tr || !lbl) return;
          if (r.checked) {
            tr.style.borderLeft = '3px solid #1557a0';
            lbl.textContent = 'KEEP';
            lbl.style.color = '#1557a0';
          } else {
            tr.style.borderLeft = '3px solid #e0e3e8';
            lbl.textContent = 'MERGE INTO ABOVE';
            lbl.style.color = '#6b7385';
          }
        });
      };
      radios.forEach(r => r.addEventListener('change', sync));
      sync();
    });
  }

  function paintAuto(host) {
    const groups = state.visibleGroups || [];
    const high = groups.filter(g => g.confidence === 'HIGH');
    const med = groups.filter(g => g.confidence === 'MEDIUM');
    host.innerHTML = `
      <div class="erp-dedupe-banner">⚠ Merges cannot be undone through this tool. Deactivated records can be manually reactivated in QuickBooks if needed.</div>
      <div class="erp-dedupe-sec erp-dedupe-sec--high">
        <div class="erp-dedupe-sec__h">● ${high.length} groups — likely the same ${state.entity}</div>
        ${high.map(g => renderMergeCard(g)).join('') || '<p class="mini-note">None</p>'}
      </div>
      <div class="erp-dedupe-sec erp-dedupe-sec--med">
        <div class="erp-dedupe-sec__h">◐ ${med.length} groups — possible duplicates, please review</div>
        ${med.map(g => renderMergeCard(g)).join('') || '<p class="mini-note">None</p>'}
      </div>`;
    bindCardRadios(host);
    host.querySelectorAll('[data-action="skip"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.erp-dedupe-card');
        const sig = card?.getAttribute('data-sig');
        const grp = state.duplicateGroups.find(g => g.groupSignature === sig);
        if (!grp) return;
        rememberLocalSkip(sig);
        try {
          await dedupePostJson('/api/deduplicate/skip', {
            recordType: state.entity,
            ids: grp.records.map(r => r.qboId)
          });
        } catch {
          /* local skip still applies */
        }
        card.remove();
      });
    });
    host.querySelectorAll('[data-action="preview"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.erp-dedupe-card');
        const sig = card?.getAttribute('data-sig');
        const grp = [...high, ...med].find(g => g.groupSignature === sig);
        const sel = card?.querySelector('input[type="radio"]:checked')?.value;
        if (!grp) return;
        const keep = grp.records.find(r => r.qboId === sel) || grp.records[0];
        const merge = grp.records.find(r => r.qboId !== keep.qboId) || grp.records[1];
        openPreviewModal(keep, merge);
      });
    });
    host.querySelectorAll('[data-action="merge"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.erp-dedupe-card');
        const sig = card?.getAttribute('data-sig');
        const grp = [...high, ...med].find(g => g.groupSignature === sig);
        const sel = card?.querySelector('input[type="radio"]:checked')?.value;
        if (!grp || !sel) return;
        const keep = grp.records.find(r => r.qboId === sel);
        const merge = grp.records.find(r => r.qboId !== sel);
        if (!keep || !merge) return;
        openConfirmModal(keep, merge, () => runMergeFlow(keep, merge, card));
      });
    });
  }

  function openPreviewModal(keep, merge) {
    const bal = (Number(keep.balance) || 0) + (Number(merge.balance) || 0);
    const html = `<div class="erp-dedupe-modal" id="erpDedupeModal">
      <div class="erp-dedupe-modal__card" style="max-width:560px">
        <h2 class="erp-dedupe-modal__title">Preview: How the merged record will look</h2>
        <div class="mini-note" style="margin-bottom:12px">
          <div><strong>Name:</strong> ${escapeHtml(keep.name)} (unchanged)</div>
          <div><strong>Phone:</strong> ${escapeHtml(keep.phone || merge.phone || '—')}</div>
          <div><strong>Email:</strong> ${escapeHtml(keep.email || merge.email || '—')}</div>
          <div><strong>Balance:</strong> ${money(keep.balance)} + ${money(merge.balance)} = ${money(bal)} combined</div>
        </div>
        <p class="mini-note" style="color:#6b7385">The kept record's name, ID, and QBO settings will be preserved. Only the transactions from the merged record will transfer over.</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button type="button" class="btn" data-close="1">Cancel preview</button>
          <button type="button" class="btn btn--primary" data-proceed="1">Proceed to merge</button>
        </div>
      </div></div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const m = document.getElementById('erpDedupeModal');
    m.querySelector('[data-close="1"]').onclick = () => m.remove();
    m.querySelector('[data-proceed="1"]').onclick = () => {
      m.remove();
      openConfirmModal(keep, merge, () => runMergeFlow(keep, merge, null));
    };
    m.addEventListener('click', ev => {
      if (ev.target === m) m.remove();
    });
  }

  function openConfirmModal(keep, merge, onConfirm) {
    const html = `<div class="erp-dedupe-modal" id="erpDedupeModal">
      <div class="erp-dedupe-modal__card" style="width:560px;padding:24px;border-radius:12px">
        <h2 class="erp-dedupe-modal__title" style="font-size:18px;font-weight:500;color:#1a1f36">Confirm merge</h2>
        <div class="erp-dedupe-warn">⚠ This action cannot be easily undone. The merged record will be removed from QuickBooks and all its transactions will be transferred to the kept record.</div>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
          <tr style="border-left:3px solid #1a7a3c"><td style="padding:10px"><span class="erp-dedupe-pill erp-dedupe-pill--ok">✓ KEEPING</span>
            <div>QBO ID: ${escapeHtml(keep.qboId)}</div><div><strong>${escapeHtml(keep.name)}</strong></div><div>Balance: ${money(keep.balance)}</div></td></tr>
          <tr style="border-left:3px solid #c5221f"><td style="padding:10px"><span class="erp-dedupe-pill erp-dedupe-pill--bad">✗ MERGING INTO ABOVE</span>
            <div>QBO ID: ${escapeHtml(merge.qboId)}</div><div><strong>${escapeHtml(merge.name)}</strong></div><div>Balance: ${money(merge.balance)}</div>
            <div class="mini-note">All transactions will transfer to the kept record.</div></td></tr>
        </table>
        <label style="display:flex;gap:8px;align-items:flex-start;margin:12px 0;font-size:13px">
          <input type="checkbox" id="erpDedupeConfirmCb" />
          <span>I understand this merge cannot be easily undone and I have verified the correct records.</span>
        </label>
        <div style="display:flex;justify-content:space-between;margin-top:16px">
          <button type="button" class="btn" data-close="1">Cancel</button>
          <button type="button" class="btn" id="erpDedupeMergeNow" style="background:#c5221f;color:#fff;border:none;padding:8px 16px;border-radius:6px" disabled>Merge now</button>
        </div>
      </div></div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const m = document.getElementById('erpDedupeModal');
    const cb = document.getElementById('erpDedupeConfirmCb');
    const go = document.getElementById('erpDedupeMergeNow');
    cb.addEventListener('change', () => {
      go.disabled = !cb.checked;
    });
    m.querySelector('[data-close="1"]').onclick = () => m.remove();
    go.onclick = async () => {
      if (!cb.checked) return;
      m.remove();
      await onConfirm();
    };
    m.addEventListener('click', ev => {
      if (ev.target === m) m.remove();
    });
  }

  async function runMergeFlow(keep, merge, cardEl) {
    const wrap = document.createElement('div');
    wrap.className = 'erp-dedupe-modal';
    wrap.id = 'erpDedupeProgress';
    wrap.innerHTML = `<div class="erp-dedupe-modal__card" style="width:420px;text-align:center">
      <div class="erp-dedupe-spinner"></div>
      <p style="margin-top:12px">Merging records in QuickBooks…</p>
      <ol style="text-align:left;font-size:12px;color:#6b7385;margin-top:12px" id="erpDedupeProgSteps"></ol>
    </div>`;
    document.body.appendChild(wrap);
    const steps = wrap.querySelector('#erpDedupeProgSteps');
    const addStep = (t, done) => {
      const li = document.createElement('li');
      li.textContent = (done ? '✓ ' : '… ') + t;
      steps.appendChild(li);
    };
    addStep('Verifying records in QBO', true);
    addStep('Transferring transactions', false);
    try {
      const path =
        state.entity === 'customer' ? '/api/deduplicate/merge/customers' : '/api/deduplicate/merge/vendors';
      const res = await dedupePostJson(path, { keepId: keep.qboId, mergeId: merge.qboId });
      addStep('Transferring transactions', true);
      addStep('Deactivating merged record', true);
      addStep('Updating ERP references', true);
      addStep('Logging merge action', true);
      wrap.remove();
      showResultOk(res, keep, merge);
      if (cardEl) cardEl.remove();
      await loadAuto(false);
    } catch (e) {
      wrap.remove();
      alert(String(e.message || e));
    }
  }

  function showResultOk(res, keep, merge) {
    const qboUrl =
      state.entity === 'customer'
        ? qboCustomerUrl(keep.qboId, state.realmId)
        : qboVendorUrl(keep.qboId, state.realmId);
    const html = `<div class="erp-dedupe-modal" id="erpDedupeModal"><div class="erp-dedupe-modal__card" style="max-width:480px">
      <div style="font-size:42px;color:#1a7a3c;text-align:center">✓</div>
      <h2 style="text-align:center">Merge complete</h2>
      <p class="mini-note">Kept: ${escapeHtml(keep.name)} (ID: ${escapeHtml(keep.qboId)})</p>
      <p class="mini-note">Merged: ${escapeHtml(merge.name)} → now inactive</p>
      <p class="mini-note">${Number(res.transactionsTransferred) || 0} transactions transferred · ${Number(res.erpRecordsUpdated) || 0} ERP records updated</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap">
        <a class="btn" href="${qboUrl}" target="_blank" rel="noopener">View kept record in QBO</a>
        <button type="button" class="btn btn--primary" data-close="1">Continue finding duplicates</button>
      </div>
    </div></div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const m = document.getElementById('erpDedupeModal');
    m.querySelector('[data-close="1"]').onclick = () => m.remove();
    m.addEventListener('click', ev => {
      if (ev.target === m) m.remove();
    });
  }

  async function loadAuto(showSpinner) {
    const status = document.getElementById('erpDedupeStatus');
    const host = document.getElementById('erpDedupeAutoHost');
    if (!host) return;
    state.loading = true;
    if (status && showSpinner)
      status.innerHTML =
        '<span class="erp-dedupe-spinner erp-dedupe-spinner--inline"></span> Loading from QuickBooks…';
    const bust = forceRefresh ? '?refresh=1' : '';
    const url =
      (state.entity === 'customer' ? '/api/deduplicate/customers' : '/api/deduplicate/vendors') + bust;
    const data = await j(url);
    state.duplicateGroups = data.duplicateGroups || [];
    state.visibleGroups = filterGroupsByLocal(state.duplicateGroups);
    state.highN = data.highConfidenceCount || 0;
    state.medN = data.mediumConfidenceCount || 0;
    state.totalRecords = (data.vendors || data.customers || []).length;
    state.loadedAt = data.loadedAt || new Date().toISOString();
    state.realmId = data.realmId || state.realmId;
    state.loading = false;
    if (status) {
      status.innerHTML = `Loaded <strong>${state.totalRecords}</strong> ${state.entity}s. Found <strong>${state.visibleGroups.length}</strong> potential duplicate groups (after skips).
        <span style="color:#c5221f">${state.highN} high confidence</span> ·
        <span style="color:#8a5200">${state.medN} review needed</span>.`;
    }
    const last = document.getElementById('erpDedupeLastLoaded');
    if (last) last.textContent = 'Last loaded: just now';
    paintAuto(host);
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.erp-dedupe-tab').forEach(b => {
      b.classList.toggle('erp-dedupe-tab--on', b.getAttribute('data-tab') === tab);
    });
    const a = document.getElementById('erpDedupePanelAuto');
    const m = document.getElementById('erpDedupePanelManual');
    const h = document.getElementById('erpDedupePanelHistory');
    if (a) a.style.display = tab === 'auto' ? 'block' : 'none';
    if (m) m.style.display = tab === 'manual' ? 'block' : 'none';
    if (h) h.style.display = tab === 'history' ? 'block' : 'none';
    if (tab === 'history') void loadHistory();
  }

  async function loadHistory() {
    const body = document.getElementById('erpDedupeHistBody');
    if (!body) return;
    body.innerHTML = '<span class="mini-note">Loading…</span>';
    try {
      const data = await j('/api/deduplicate/merge-history?page=1&pageSize=25');
      state.history.rows = data.rows || [];
      state.history.total = data.total || 0;
      body.innerHTML = `<table class="erp-dedupe-table"><thead><tr>
        <th>Date</th><th>Type</th><th>Kept</th><th>Merged</th><th>Txns</th><th>ERP</th><th>By</th><th>Status</th>
      </tr></thead><tbody>
        ${state.history.rows
          .map(
            r => `<tr data-id="${escapeAttr(String(r.id))}">
          <td>${escapeHtml(fmtDate(r.merged_at))}</td>
          <td>${escapeHtml(r.merge_type)}</td>
          <td>${escapeHtml(r.kept_name)} <span class="mini-note">(ID: ${escapeHtml(r.kept_qbo_id)})</span></td>
          <td><span style="text-decoration:line-through">${escapeHtml(r.merged_name)}</span> <span class="mini-note">(ID: ${escapeHtml(r.merged_qbo_id)})</span></td>
          <td class="num">${r.transactions_transferred}</td>
          <td class="num">${r.erp_records_updated}</td>
          <td>${escapeHtml(r.merged_by)}</td>
          <td>${escapeHtml(r.status)}</td>
        </tr>`
          )
          .join('')}
      </tbody></table>`;
      body.querySelectorAll('tr[data-id]').forEach(tr => {
        tr.addEventListener('click', async () => {
          const id = tr.getAttribute('data-id');
          const d = await j('/api/deduplicate/merge-log/' + encodeURIComponent(id));
          alert(JSON.stringify(d.row?.qbo_api_responses || {}, null, 2).slice(0, 4000));
        });
      });
    } catch (e) {
      body.innerHTML = `<span class="mini-note">${escapeHtml(e.message || String(e))}</span>`;
    }
  }

  function paintShell() {
    const root = document.getElementById('erpDedupeRoot');
    if (!root || root.getAttribute('data-ready') === '1') return;
    root.setAttribute('data-ready', '1');
    root.innerHTML = `
<style>
.erp-dedupe-top{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #e0e3e8;flex-wrap:wrap;gap:12px}
.erp-dedupe-seg{display:flex;border:1px solid #e0e3e8;border-radius:8px;overflow:hidden}
.erp-dedupe-seg button{border:none;background:#fff;padding:8px 14px;cursor:pointer;font-weight:500}
.erp-dedupe-seg button.on{background:#e8f0fe;color:#1557a0}
.erp-dedupe-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.erp-dedupe-status{padding:10px 0;font-size:13px;color:#1a1f36}
.erp-dedupe-tabs{display:flex;gap:4px;border-bottom:1px solid #e0e3e8;margin-top:8px}
.erp-dedupe-tab{border:none;background:transparent;padding:10px 14px;cursor:pointer;font-size:13px;color:#6b7385;border-bottom:2px solid transparent}
.erp-dedupe-tab--on{color:#1557a0;border-bottom-color:#1557a0;font-weight:600}
.erp-dedupe-banner{background:#fef7e0;border:1px solid #f5c67f;border-radius:8px;padding:10px 12px;margin:12px 0;font-size:12px;color:#5c4a00}
.erp-dedupe-sec{margin:16px 0}
.erp-dedupe-sec__h{padding:10px 12px;border-radius:8px 8px 0 0;font-weight:600;font-size:13px}
.erp-dedupe-sec--high .erp-dedupe-sec__h{background:#fce8e6;color:#c5221f}
.erp-dedupe-sec--med .erp-dedupe-sec__h{background:#fef7e0;color:#8a5200}
.erp-dedupe-card{background:#fff;border:1px solid #e0e3e8;border-radius:8px;padding:16px;margin-bottom:12px}
.erp-dedupe-card__head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px}
.erp-dedupe-badge{font-size:11px;font-weight:600;padding:4px 8px;border-radius:4px;display:inline-block}
.erp-dedupe-badge--high{background:#fce8e6;color:#c5221f}
.erp-dedupe-badge--med{background:#fef7e0;color:#8a5200}
.erp-dedupe-card__rule{font-size:11px;color:#6b7385;margin-top:4px}
.erp-dedupe-skip{border:none;background:none;color:#6b7385;font-size:11px;cursor:pointer;text-decoration:underline}
.erp-dedupe-table{width:100%;border-collapse:collapse;font-size:12px}
.erp-dedupe-table th,.erp-dedupe-table td{border-bottom:1px solid #e0e3e8;padding:8px 6px;text-align:left}
.erp-dedupe-table th{background:#f8f9fb;font-weight:600}
.erp-dedupe-cell--same{background:#e6f4ea}
.erp-dedupe-cell--diff{background:#fef7e0}
.erp-dedupe-keeplbl{font-size:9px;text-transform:uppercase;margin-top:4px}
.erp-dedupe-card__foot{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid #f1f3f4;flex-wrap:wrap;justify-content:space-between}
.erp-dedupe-foot-hint{font-size:11px;color:#6b7385}
.erp-dedupe-btn{border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer}
.erp-dedupe-btn--merge{background:#1a7a3c;color:#fff;border:none;height:32px;opacity:1}
.erp-dedupe-btn--merge:disabled{opacity:0.4;cursor:not-allowed}
.erp-dedupe-btn--link{border:none;background:none;color:#1557a0;font-size:11px}
.erp-dedupe-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:12000;padding:16px}
.erp-dedupe-modal__card{background:#fff;border-radius:12px;padding:20px;max-height:90vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,.12)}
.erp-dedupe-warn{background:#fef7e0;border:1px solid #f5c67f;border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:13px}
.erp-dedupe-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;margin-bottom:6px}
.erp-dedupe-pill--ok{background:#e6f4ea;color:#1a7a3c}
.erp-dedupe-pill--bad{background:#fce8e6;color:#c5221f}
.erp-dedupe-spinner{width:28px;height:28px;border:3px solid #e0e3e8;border-top-color:#1557a0;border-radius:50%;animation:erpDedSpin .8s linear infinite;margin:0 auto}
.erp-dedupe-spinner--inline{display:inline-block;vertical-align:middle;margin-right:8px;width:18px;height:18px;border-width:2px}
@keyframes erpDedSpin{to{transform:rotate(360deg)}}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#6b7385}
.num{text-align:right}
</style>
<h1 style="font-size:22px;font-weight:600;color:#1a1f36;margin:8px 0 4px">Vendor &amp; customer deduplication</h1>
<p class="mini-note" style="margin:0 0 12px">Find and merge duplicate records in QuickBooks to keep your books clean.</p>
<div class="erp-dedupe-top">
  <div class="erp-dedupe-seg" id="erpDedupeSeg">
    <button type="button" data-ent="vendor" class="on">Vendors</button>
    <button type="button" data-ent="customer">Customers</button>
  </div>
  <div class="erp-dedupe-actions">
    <button type="button" class="btn" id="erpDedupeRefresh">Refresh from QuickBooks</button>
    <button type="button" class="btn" id="erpDedupeExportDup">Export duplicates list</button>
    <div class="mini-note" id="erpDedupeLastLoaded" style="width:100%;text-align:right;margin:0">Last loaded: —</div>
  </div>
</div>
<div class="erp-dedupe-status" id="erpDedupeStatus"></div>
<div class="erp-dedupe-tabs">
  <button type="button" class="erp-dedupe-tab erp-dedupe-tab--on" data-tab="auto">Auto-detected duplicates</button>
  <button type="button" class="erp-dedupe-tab" data-tab="manual">Manual search</button>
  <button type="button" class="erp-dedupe-tab" data-tab="history">Merge history</button>
</div>
<div id="erpDedupePanelAuto" style="margin-top:12px">
  <div id="erpDedupeAutoHost"></div>
</div>
<div id="erpDedupePanelManual" style="display:none;margin-top:12px">
  <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
    <div style="flex:1;min-width:200px">
      <label class="qb-l">Search for record A</label>
      <input class="qb-in" id="erpDedupeSearchA" autocomplete="off" placeholder="Type name or id…" />
      <div id="erpDedupeDdA" class="mini-note"></div>
    </div>
    <button type="button" class="btn btn--small" id="erpDedupeSwap">Swap A and B</button>
    <div style="flex:1;min-width:200px">
      <label class="qb-l">Search for record B</label>
      <input class="qb-in" id="erpDedupeSearchB" autocomplete="off" />
      <div id="erpDedupeDdB" class="mini-note"></div>
    </div>
  </div>
  <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:260px;background:#fff;border:1px solid #e0e3e8;border-radius:8px;padding:16px;min-height:300px" id="erpDedupePanelRecA"></div>
    <div style="flex:1;min-width:260px;background:#fff;border:1px solid #e0e3e8;border-radius:8px;padding:16px;min-height:300px" id="erpDedupePanelRecB"></div>
  </div>
  <div style="margin-top:12px" id="erpDedupeManualCmp"></div>
  <button type="button" class="btn btn--primary" id="erpDedupeManualMerge" style="display:none;width:100%;margin-top:12px">Merge selected records</button>
</div>
<div id="erpDedupePanelHistory" style="display:none;margin-top:12px">
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <button type="button" class="btn" id="erpDedupeHistXlsx">Export history</button>
  </div>
  <div id="erpDedupeHistBody"></div>
</div>`;

    document.getElementById('erpDedupeSeg').addEventListener('click', ev => {
      const b = ev.target.closest('button[data-ent]');
      if (!b) return;
      state.entity = b.getAttribute('data-ent');
      [...document.querySelectorAll('#erpDedupeSeg button')].forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      void loadAuto(true);
    });
    document.getElementById('erpDedupeRefresh').onclick = () => loadAuto(true);
    document.getElementById('erpDedupeExportDup').onclick = () => {
      const q = state.entity === 'customer' ? 'customer' : 'vendor';
      void dedupeDownload(
        '/api/deduplicate/export-duplicates?type=' + encodeURIComponent(q),
        'duplicates-' + q + '.xlsx'
      ).catch(e => alert(e.message));
    };
    document.getElementById('erpDedupeHistXlsx').onclick = () => {
      void dedupeDownload('/api/deduplicate/merge-history?format=xlsx', 'merge-history.xlsx').catch(e => alert(e.message));
    };
    document.querySelectorAll('.erp-dedupe-tab').forEach(btn => {
      btn.addEventListener('click', () => setTab(btn.getAttribute('data-tab')));
    });
    wireManualSearch();
  }

  function wireManualSearch() {
    const sa = document.getElementById('erpDedupeSearchA');
    const sb = document.getElementById('erpDedupeSearchB');
    const tmo = { a: null, b: null };
    const run = (side, q) => {
      const path =
        state.entity === 'customer' ? '/api/deduplicate/search/customers' : '/api/deduplicate/search/vendors';
      j(path + '?q=' + encodeURIComponent(q)).then(d => {
        const list = d.vendors || d.customers || [];
        const host = document.getElementById(side === 'a' ? 'erpDedupeDdA' : 'erpDedupeDdB');
        host.innerHTML = list
          .slice(0, 8)
          .map(
            r =>
              `<div style="cursor:pointer;padding:4px 0;border-bottom:1px solid #eee" data-pick="${escapeAttr(
                r.qboId
              )}">${escapeHtml(r.qboId)} — ${escapeHtml(r.name)} — ${money(r.balance)}</div>`
          )
          .join('');
        host.querySelectorAll('[data-pick]').forEach(el => {
          el.addEventListener('click', () => void pickManual(side, el.getAttribute('data-pick')));
        });
      });
    };
    sa.addEventListener('input', () => {
      clearTimeout(tmo.a);
      tmo.a = setTimeout(() => run('a', sa.value.trim()), 200);
    });
    sb.addEventListener('input', () => {
      clearTimeout(tmo.b);
      tmo.b = setTimeout(() => run('b', sb.value.trim()), 200);
    });
    document.getElementById('erpDedupeSwap').onclick = () => {
      const t = state.manual.a;
      state.manual.a = state.manual.b;
      state.manual.b = t;
      paintManualPanels();
    };
    document.getElementById('erpDedupeManualMerge').onclick = () => {
      const keepRec = state.manual.keep === 'a' ? state.manual.a : state.manual.b;
      const mergeRec = state.manual.keep === 'a' ? state.manual.b : state.manual.a;
      if (!keepRec || !mergeRec) return;
      openConfirmModal(keepRec, mergeRec, () => runMergeFlow(keepRec, mergeRec, null));
    };
  }

  async function pickManual(side, id) {
    const path =
      state.entity === 'customer'
        ? '/api/deduplicate/customer/' + encodeURIComponent(id)
        : '/api/deduplicate/vendor/' + encodeURIComponent(id);
    const d = await j(path);
    const rec = d.vendor || d.customer;
    if (side === 'a') state.manual.a = rec;
    else state.manual.b = rec;
    paintManualPanels();
  }

  function paintManualPanels() {
    const pa = document.getElementById('erpDedupePanelRecA');
    const pb = document.getElementById('erpDedupePanelRecB');
    const render = (rec, side) => {
      if (!rec)
        return `<div style="color:#6b7385;font-size:12px;text-align:center;padding:40px 8px">Search for a ${state.entity} above to load their details here.</div>`;
      return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span class="mini-note">Record ${side.toUpperCase()}</span>
        <button type="button" class="btn btn--small" data-keep="${side}">KEEP THIS ONE</button>
      </div>
      <div style="font-size:14px;font-weight:500;color:#1a1f36">${escapeHtml(rec.name)}</div>
      <div class="mono" style="margin-top:6px">QBO ID: ${escapeHtml(rec.qboId)}</div>
      <div class="mini-note">Balance: ${money(rec.balance)}</div>
      <div class="mini-note">Phone: ${escapeHtml(rec.phone || '—')}</div>
      <div class="mini-note">Email: ${escapeHtml(rec.email || '—')}</div>`;
    };
    pa.innerHTML = render(state.manual.a, 'a');
    pb.innerHTML = render(state.manual.b, 'b');
    pa.querySelectorAll('[data-keep]').forEach(b => {
      b.onclick = () => {
        state.manual.keep = b.getAttribute('data-keep');
        paintManualPanels();
        paintManualCompare();
      };
    });
    pb.querySelectorAll('[data-keep]').forEach(b => {
      b.onclick = () => {
        state.manual.keep = b.getAttribute('data-keep');
        paintManualPanels();
        paintManualCompare();
      };
    });
    paintManualCompare();
  }

  function paintManualCompare() {
    const host = document.getElementById('erpDedupeManualCmp');
    const btn = document.getElementById('erpDedupeManualMerge');
    const A = state.manual.a;
    const B = state.manual.b;
    if (!A || !B) {
      host.innerHTML = '';
      btn.style.display = 'none';
      return;
    }
    const row = (label, va, vb) => {
      const m = String(va) === String(vb);
      return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(va)}</td><td>${escapeHtml(vb)}</td><td>${m ? '✓' : '✗'}</td></tr>`;
    };
    host.innerHTML = `<table class="erp-dedupe-table" style="max-width:640px"><thead><tr><th>Field</th><th>Record A</th><th>Record B</th><th>Match?</th></tr></thead><tbody>
      ${row('Name', A.name, B.name)}
      ${row('Phone', A.phone || '—', B.phone || '—')}
      ${row('Email', A.email || '—', B.email || '—')}
      ${row('Balance', money(A.balance), money(B.balance))}
    </tbody></table>`;
    btn.style.display = 'block';
    const keepA = state.manual.keep === 'a';
    btn.textContent = keepA ? 'Keep Record A, merge Record B into it' : 'Keep Record B, merge Record A into it';
  }

  window.erpDedupeInit = function () {
    paintShell();
    void loadAuto(true);
  };

  window.openDedupeTool = function () {
    if (typeof openSection === 'function') openSection('dedupe', null);
    else window.location.hash = 'dedupe';
  };
})();
