/**
 * IH35 ERP — shared UI helpers:
 * FIX 10 — async button busy + table pager (`erpWithBusy`, `erpPagerRender`, …).
 * Rule 22 — inline “?” help panels (`erpHelpTipToggle`); style in `erp-master-spec-2026.css`.
 * Rule 19 — toasts (`showToast`); host `#erpToastHost` + styles in `erp-master-spec-2026.css`.
 * `erpNotify` — toast-first replacement for `alert()` (inference for type when omitted); falls back to `alert` if toasts unavailable.
 * Rule 24 — `erpMountConnectionStrip(id)` reads `GET /api/qbo/status` and `GET /api/health` (read-only) into a two-row strip: QuickBooks + Samsara. Refreshes every five minutes while the page stays open. Non-2xx QBO status uses muted “could not load status.”
 */
(function (global) {
  'use strict';

  /**
   * @param {HTMLElement | null} el
   * @param {boolean} busy
   */
  function erpSetButtonBusy(el, busy) {
    if (!el || !(el instanceof HTMLElement)) return;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag !== 'button' && tag !== 'input') return;
    if (busy) {
      el.classList.add('erp-btn--busy');
      el.setAttribute('aria-busy', 'true');
      if (tag === 'button' || (tag === 'input' && el.type === 'submit')) el.disabled = true;
    } else {
      el.classList.remove('erp-btn--busy');
      el.removeAttribute('aria-busy');
      if (tag === 'button' || (tag === 'input' && el.type === 'submit')) el.disabled = false;
    }
  }

  /**
   * @param {HTMLElement | null} el
   * @param {() => Promise<unknown>} fn
   */
  async function erpWithBusy(el, fn) {
    erpSetButtonBusy(el, true);
    try {
      return await fn();
    } finally {
      erpSetButtonBusy(el, false);
    }
  }

  /**
   * @param {HTMLElement | null} host
   * @param {{ page: number; pageSize: number; total: number }} state
   * @param {(nextPage: number, newPageSize?: number) => void} onPageChange
   */
  function erpPagerRender(host, state, onPageChange) {
    if (!host) return;
    const total = Math.max(0, Number(state.total) || 0);
    const pageSize = Math.max(1, Number(state.pageSize) || 10);
    const page = Math.max(1, Number(state.page) || 1);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const cur = Math.min(page, pages);
    const start = total === 0 ? 0 : (cur - 1) * pageSize + 1;
    const end = Math.min(total, cur * pageSize);

    if (!total) {
      host.innerHTML = '';
      host.hidden = true;
      return;
    }

    host.hidden = false;
    host.classList.add('erp-pager');
    host.innerHTML =
      '<div class="erp-pager__meta" role="status">' +
      '<span class="erp-pager__range">' +
      start +
      '–' +
      end +
      ' of ' +
      total +
      '</span>' +
      '</div>' +
      '<div class="erp-pager__controls">' +
      '<label class="erp-pager__size"><span class="erp-pager__size-lbl">Rows</span>' +
      '<select class="erp-pager__size-sel" aria-label="Rows per page">' +
      [10, 25, 50, 100]
        .map(n => '<option value="' + n + '"' + (n === pageSize ? ' selected' : '') + '>' + n + '</option>')
        .join('') +
      '</select></label>' +
      '<button type="button" class="erp-pager__btn" data-erp-pager="prev"' +
      (cur <= 1 ? ' disabled' : '') +
      '>Previous</button>' +
      '<span class="erp-pager__page">Page ' +
      cur +
      ' / ' +
      pages +
      '</span>' +
      '<button type="button" class="erp-pager__btn" data-erp-pager="next"' +
      (cur >= pages ? ' disabled' : '') +
      '>Next</button>' +
      '</div>';

    const fire = p => {
      if (typeof onPageChange === 'function') onPageChange(p);
    };

    host.querySelector('[data-erp-pager="prev"]')?.addEventListener('click', () => fire(cur - 1));
    host.querySelector('[data-erp-pager="next"]')?.addEventListener('click', () => fire(cur + 1));
    const sel = host.querySelector('.erp-pager__size-sel');
    if (sel) {
      sel.addEventListener('change', () => {
        const n = Number(sel.value) || pageSize;
        if (typeof onPageChange === 'function') onPageChange(1, n);
      });
    }
  }

  /** @param {number} page 1-based @param {number} pageSize @param {number} total @returns {[number, number]} start,end exclusive end index for slice */
  function erpPagerSliceRange(page, pageSize, total) {
    const ps = Math.max(1, Math.floor(Number(pageSize)) || 10);
    const p = Math.max(1, Math.floor(Number(page)) || 1);
    const pages = Math.max(1, Math.ceil(Math.max(0, total) / ps));
    const cur = Math.min(p, pages);
    const start = (cur - 1) * ps;
    const end = Math.min(total, start + ps);
    return [start, end];
  }

  global.erpPagerSliceRange = erpPagerSliceRange;

  global.erpSetButtonBusy = erpSetButtonBusy;
  global.erpWithBusy = erpWithBusy;
  global.erpPagerRender = erpPagerRender;

  /** Rule 22 — toggle one inline help panel; closes others. */
  function erpHelpTipToggle(ev) {
    if (!ev) return;
    ev.stopPropagation();
    const btn = ev.currentTarget;
    const wrap = btn && btn.closest('.erp-help-tip');
    const panel = wrap && wrap.querySelector('.erp-help-tip__panel');
    if (!panel) return;
    const willOpen = !panel.classList.contains('is-open');
    document.querySelectorAll('.erp-help-tip__panel.is-open').forEach(p => {
      p.classList.remove('is-open');
      const w = p.closest('.erp-help-tip');
      const b = w && w.querySelector('.erp-help-tip__btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
    if (willOpen) {
      panel.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
    } else {
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  function closeAllErpHelpTips(returnFocusBtn) {
    document.querySelectorAll('.erp-help-tip__panel.is-open').forEach(p => {
      p.classList.remove('is-open');
      const w = p.closest('.erp-help-tip');
      const b = w && w.querySelector('.erp-help-tip__btn');
      if (b) b.setAttribute('aria-expanded', 'false');
      if (returnFocusBtn && b && typeof b.focus === 'function') b.focus();
    });
  }

  (function bindErpHelpTipDocumentListeners() {
    if (global.__erpHelpTipUiBound) return;
    global.__erpHelpTipUiBound = true;
    document.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('.erp-help-tip')) return;
      closeAllErpHelpTips(false);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      const open = document.querySelector('.erp-help-tip__panel.is-open');
      if (!open) return;
      closeAllErpHelpTips(true);
      ev.preventDefault();
    });
  })();

  global.erpHelpTipToggle = erpHelpTipToggle;

  /**
   * Rule 19 — global toast. Uses `#erpToastHost` if present; otherwise creates one on `document.body`.
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} [type]
   */
  function showToast(message, type) {
    const text = String(message || '').trim();
    if (!text) return;
    let host = document.getElementById('erpToastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'erpToastHost';
      host.className = 'erp-toast-host';
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const row = document.createElement('div');
    row.className = 'erp-toast';
    const dot = document.createElement('span');
    const t = String(type || 'success').toLowerCase();
    dot.className =
      'erp-toast__dot' +
      (t === 'error' ? ' erp-toast__dot--err' : '') +
      (t === 'warning' ? ' erp-toast__dot--warn' : '') +
      (t === 'info' ? ' erp-toast__dot--info' : '');
    const msg = document.createElement('div');
    msg.className = 'erp-toast__msg';
    msg.textContent = text;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'erp-toast__x';
    x.setAttribute('aria-label', 'Dismiss');
    x.textContent = '\u00d7';
    x.onclick = () => row.remove();
    row.appendChild(dot);
    row.appendChild(msg);
    row.appendChild(x);
    host.appendChild(row);
    const timer = global.setTimeout(() => {
      row.remove();
    }, 5000);
    row.addEventListener(
      'mouseenter',
      () => {
        global.clearTimeout(timer);
      },
      { once: true }
    );
  }

  global.showToast = showToast;

  /**
   * Non-blocking user feedback across ERP pages. Prefer `showToast`; use `alert` only if toast is unavailable.
   * When `type` is omitted, infers success / error / warning / info from message text (covers legacy `alert()` sites).
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} [type]
   */
  function erpNotify(message, type) {
    const text = String(message || '').trim();
    if (!text) return;
    let kind = String(type || '').trim().toLowerCase();
    if (kind !== 'success' && kind !== 'error' && kind !== 'warning' && kind !== 'info') {
      kind = '';
    }
    if (!kind) {
      const lower = text.toLowerCase();
      if (
        /\bfail|\berror\b|invalid |could not|cannot |unable to|undo failed|preview failed|posting failed|lookup failed|update failed|import failed|confirm import failed|refresh failed|not found|missing erp|missing quickbooks|qbo refresh failed|settlement lookup failed|choose the pay-from|does not match|cannot exceed|no unposted|no confirmed import|record saved, but quickbooks posting failed|this record has no unit/i.test(
          lower
        )
      ) {
        kind = 'error';
      } else if (
        /^select |^enter |^choose |^add |^keep |^pick |^paste |required\.?$|must |\bmissing\b|^no |\bat least one\b|\bat least two\b|each line|locked lines|numeric quickbooks|single vendor|vehicle id and|driver id and|unit is required|run preview|run a settlement|external shop|custom service type|invoice total greater|vendor invoice|work order|digits only|for this unit yet/i.test(
          lower
        )
      ) {
        kind = 'warning';
      } else if (
        /saved|created|updated|posted|removed|cleared|undone|added|success|complete|synced|attached|invoice created|mileages updated|vendor already existed|vehicle updated|driver updated|removed \d|imported|undo\.|tms load miles updated/i.test(
          lower
        )
      ) {
        kind = 'success';
      } else {
        kind = 'info';
      }
    }
    if (typeof global.showToast === 'function') {
      showToast(text, kind);
      return;
    }
    global.alert(text);
  }

  global.erpNotify = erpNotify;

  /** @type {Set<HTMLElement>} */
  const __erpStripHosts = new Set();
  if (!global.__erpStripPagehideBound) {
    global.__erpStripPagehideBound = true;
    window.addEventListener('pagehide', () => {
      __erpStripHosts.forEach(host => {
        if (host && host._erpStripTimer) {
          global.clearInterval(host._erpStripTimer);
          host._erpStripTimer = null;
        }
      });
      __erpStripHosts.clear();
    });
  }

  /**
   * Optional `#erpIntegrationDisconnectBanners` (e.g. maintenance shell): show when QBO is configured but not connected, or Samsara token is missing.
   * @param {boolean} rqOk
   * @param {boolean} rhOk
   * @param {object | null} qj
   * @param {object | null} hj
   */
  function syncOptionalDisconnectBanners(rqOk, rhOk, qj, hj) {
    const wrap = document.getElementById('erpIntegrationDisconnectBanners');
    const qb = document.getElementById('erpQboDisconnectBanner');
    const sb = document.getElementById('erpSamsaraDisconnectBanner');
    if (!wrap || !qb || !sb) return;
    while (qb.firstChild) qb.removeChild(qb.firstChild);
    while (sb.firstChild) sb.removeChild(sb.firstChild);
    qb.classList.add('hidden');
    sb.classList.add('hidden');
    let any = false;
    if (rqOk && qj && typeof qj === 'object' && qj.configured && !qj.connected) {
      qb.classList.remove('hidden');
      qb.appendChild(document.createTextNode('QuickBooks disconnected. '));
      const a = document.createElement('a');
      a.href = '/settings.html';
      a.textContent = 'Open Settings';
      qb.appendChild(a);
      any = true;
    }
    if (rhOk && hj && typeof hj === 'object' && !hj.hasSamsaraToken) {
      sb.classList.remove('hidden');
      sb.appendChild(document.createTextNode('Samsara API token is not set on this server. '));
      const a2 = document.createElement('a');
      a2.href = '/settings.html';
      a2.textContent = 'Open Settings';
      sb.appendChild(a2);
      any = true;
    }
    wrap.hidden = !any;
  }

  /**
   * Rule 24 — hydrate a host with QuickBooks + Samsara read-only status (two rows).
   * @param {string | HTMLElement} hostIdOrEl
   */
  async function erpMountConnectionStrip(hostIdOrEl) {
    const stripLoadFailed = 'QuickBooks: could not load status.';
    const el =
      typeof hostIdOrEl === 'string' ? document.getElementById(hostIdOrEl) : hostIdOrEl;
    if (!el || !(el instanceof HTMLElement)) return;
    __erpStripHosts.add(el);
    if (el._erpStripTimer) {
      global.clearInterval(el._erpStripTimer);
      el._erpStripTimer = null;
    }
    el.classList.add('erp-connection-strip', 'erp-connection-strip--rows');

    function appendRow(dotKind, lineText) {
      const row = document.createElement('div');
      row.className = 'erp-connection-strip__row';
      const dot = document.createElement('span');
      dot.className =
        'erp-connection-strip__dot' +
        (dotKind === 'ok' ? ' erp-connection-strip__dot--ok' : '') +
        (dotKind === 'warn' ? ' erp-connection-strip__dot--warn' : '') +
        (dotKind === 'bad' ? ' erp-connection-strip__dot--bad' : '');
      dot.setAttribute('aria-hidden', 'true');
      const msg = document.createElement('span');
      msg.textContent = lineText;
      row.appendChild(dot);
      row.appendChild(msg);
      el.appendChild(row);
    }

    async function paintStrip() {
      el.textContent = '';
      el.classList.remove('erp-connection-strip--ok', 'erp-connection-strip--warn', 'erp-connection-strip--muted');
      let worst = 0;
      try {
        const [rq, rh] = await Promise.all([
          fetch('/api/qbo/status', { headers: { Accept: 'application/json' } }),
          fetch('/api/health', { headers: { Accept: 'application/json' } })
        ]);
        const qj = rq.ok ? await rq.json().catch(() => ({})) : null;
        const hj = rh.ok ? await rh.json().catch(() => ({})) : null;

        if (!rq.ok) {
          appendRow('bad', stripLoadFailed);
          worst = 2;
        } else if (!qj || typeof qj !== 'object') {
          appendRow('bad', 'QuickBooks: status unavailable.');
          worst = 2;
        } else if (!qj.configured) {
          appendRow('warn', 'QuickBooks: not configured on server.');
          worst = Math.max(worst, 1);
        } else if (qj.connected) {
          const nm = qj.companyName ? String(qj.companyName) : '';
          appendRow('ok', 'QuickBooks: connected' + (nm ? ' — ' + nm : '') + '.');
        } else {
          appendRow('warn', 'QuickBooks: not connected — open Settings to authorize.');
          worst = Math.max(worst, 1);
        }

        if (!rh.ok) {
          appendRow('bad', 'Samsara: could not load health status.');
          worst = 2;
        } else if (!hj || typeof hj !== 'object') {
          appendRow('warn', 'Samsara: status unavailable.');
          worst = Math.max(worst, 1);
        } else if (!hj.hasSamsaraToken) {
          appendRow('warn', 'Samsara: API token not configured on server.');
          worst = Math.max(worst, 1);
        } else {
          const nVeh = Number(hj.samsaraVehicles);
          const tail =
            Number.isFinite(nVeh) && nVeh >= 0 ? ' Last snapshot vehicles: ' + nVeh + '.' : '';
          appendRow('ok', 'Samsara: token present on server.' + tail);
        }

        if (worst >= 2) el.classList.add('erp-connection-strip--muted');
        else if (worst === 1) el.classList.add('erp-connection-strip--warn');
        else el.classList.add('erp-connection-strip--ok');
        syncOptionalDisconnectBanners(rq.ok, rh.ok, qj, hj);
      } catch (_) {
        el.textContent = '';
        appendRow('bad', stripLoadFailed);
        appendRow('bad', 'Samsara: check failed.');
        el.classList.add('erp-connection-strip--muted');
        syncOptionalDisconnectBanners(false, false, null, null);
      }
    }

    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    await paintStrip();
    el._erpStripTimer = global.setInterval(() => {
      void paintStrip();
    }, 300000);
  }

  global.erpMountConnectionStrip = erpMountConnectionStrip;

  /**
   * Resizable + draggable modal shells (visual only). Persists geometry in localStorage.
   * Keys: `modal_size_[formtype]` — formtype from opts.storageKey (e.g. workorder, dedicated_fuel).
   */
  const __erpModalShellWired = new WeakSet();

  function erpClamp(n, lo, hi) {
    return Math.min(Math.max(n, lo), hi);
  }

  function erpReadModalRect(storageKey) {
    if (!storageKey || typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(`${'modal_size_'}${storageKey}`);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return null;
      const w = Number(o.width);
      const h = Number(o.height);
      const l = Number(o.left);
      const t = Number(o.top);
      if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
      const maxW = window.innerWidth * 0.95;
      const maxH = window.innerHeight * 0.95;
      return {
        width: erpClamp(w, 600, maxW),
        height: erpClamp(h, 500, maxH),
        left: Number.isFinite(l) ? erpClamp(l, 0, Math.max(0, window.innerWidth - 120)) : null,
        top: Number.isFinite(t) ? erpClamp(t, 0, Math.max(0, window.innerHeight - 120)) : null
      };
    } catch (_) {
      return null;
    }
  }

  function erpWriteModalRect(storageKey, shell) {
    if (!storageKey || !shell || typeof localStorage === 'undefined') return;
    try {
      const r = shell.getBoundingClientRect();
      const payload = {
        width: Math.round(r.width),
        height: Math.round(r.height),
        left: Math.round(r.left),
        top: Math.round(r.top)
      };
      localStorage.setItem(`${'modal_size_'}${storageKey}`, JSON.stringify(payload));
    } catch (_) {}
  }

  function erpRestoreModalRect(shell, storageKey) {
    if (!shell || !storageKey) return;
    const rect = erpReadModalRect(storageKey);
    if (!rect) return;
    shell.classList.add('erp-modal-shell--user-geometry');
    shell.style.position = 'fixed';
    shell.style.margin = '0';
    shell.style.boxSizing = 'border-box';
    shell.style.width = `${Math.round(rect.width)}px`;
    shell.style.height = `${Math.round(rect.height)}px`;
    if (rect.left != null && rect.top != null) {
      shell.style.left = `${Math.round(rect.left)}px`;
      shell.style.top = `${Math.round(rect.top)}px`;
      shell.style.right = 'auto';
      shell.style.bottom = 'auto';
    }
  }

  function erpWireResizableModalShell(shell, opts) {
    opts = opts || {};
    if (!shell || !(shell instanceof HTMLElement) || __erpModalShellWired.has(shell)) return;
    __erpModalShellWired.add(shell);

    const storageKey = opts.storageKey || 'generic';
    const dragRoot = typeof opts.dragRoot === 'string' ? shell.querySelector(opts.dragRoot) : opts.dragRoot;
    const minW = Number(opts.minW) > 0 ? Number(opts.minW) : 600;
    const minH = Number(opts.minH) > 0 ? Number(opts.minH) : 500;

    if (!dragRoot) return;

    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'erp-modal-resize-grip';
    grip.setAttribute('aria-label', 'Resize dialog');
    grip.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M11 1L1 11M8 1L1 8M11 4L4 11" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>';
    shell.style.position = shell.style.position || 'relative';
    shell.appendChild(grip);

    let mode = '';
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let startLeft = 0;
    let startTop = 0;

    function ensureFixedMetrics() {
      const r = shell.getBoundingClientRect();
      if (shell.style.position !== 'fixed') {
        shell.style.position = 'fixed';
        shell.style.left = `${Math.round(r.left)}px`;
        shell.style.top = `${Math.round(r.top)}px`;
        shell.style.width = `${Math.round(r.width)}px`;
        shell.style.height = `${Math.round(r.height)}px`;
        shell.style.margin = '0';
        shell.classList.add('erp-modal-shell--user-geometry');
      }
    }

    function onMove(ev) {
      if (!mode) return;
      const cx = ev.clientX;
      const cy = ev.clientY;
      if (mode === 'resize') {
        ensureFixedMetrics();
        const dw = cx - startX;
        const dh = cy - startY;
        const maxW = window.innerWidth * 0.95;
        const maxH = window.innerHeight * 0.95;
        const nw = erpClamp(startW + dw, minW, maxW);
        const nh = erpClamp(startH + dh, minH, maxH);
        shell.style.width = `${Math.round(nw)}px`;
        shell.style.height = `${Math.round(nh)}px`;
      } else if (mode === 'drag') {
        ensureFixedMetrics();
        const dx = cx - startX;
        const dy = cy - startY;
        const r = shell.getBoundingClientRect();
        const w = r.width;
        const h = r.height;
        let nl = startLeft + dx;
        let nt = startTop + dy;
        nl = erpClamp(nl, 0, Math.max(0, window.innerWidth - w));
        nt = erpClamp(nt, 0, Math.max(0, window.innerHeight - h));
        shell.style.left = `${Math.round(nl)}px`;
        shell.style.top = `${Math.round(nt)}px`;
      }
    }

    function onUp() {
      if (mode) {
        erpWriteModalRect(storageKey, shell);
        mode = '';
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }

    grip.addEventListener('mousedown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      ensureFixedMetrics();
      const r = shell.getBoundingClientRect();
      startX = ev.clientX;
      startY = ev.clientY;
      startW = r.width;
      startH = r.height;
      mode = 'resize';
      document.body.style.cursor = 'se-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    });

    dragRoot.addEventListener('mousedown', ev => {
      const t = ev.target;
      if (!t || !(t instanceof Element)) return;
      if (t.closest('button, a, input, select, textarea, [data-erp-no-drag]')) return;
      ev.preventDefault();
      ensureFixedMetrics();
      const r = shell.getBoundingClientRect();
      startX = ev.clientX;
      startY = ev.clientY;
      startLeft = r.left;
      startTop = r.top;
      mode = 'drag';
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    });
  }

  function erpInitResizableModals() {
    const ded = document.querySelector('#erpDedicatedFormModal .erp-dedicated-form-modal__shell');
    if (ded) {
      erpWireResizableModalShell(ded, {
        storageKey: 'dedicated_default',
        dragRoot: '.erp-dedicated-form-modal__bar',
        minW: 600,
        minH: 500
      });
    }
    const wo = document.querySelector('#maintWorkOrderModal .maint-workorder-fullmodal__shell');
    if (wo) {
      erpWireResizableModalShell(wo, {
        storageKey: 'workorder',
        dragRoot: '.maint-workorder-fullmodal__head',
        minW: 600,
        minH: 500
      });
    }
    const cat = document.querySelector('#maintCatModal .maint-modal.erp-qb-dialog');
    if (cat) {
      erpWireResizableModalShell(cat, {
        storageKey: 'maint_category',
        dragRoot: '.erp-qb-dialog__head',
        minW: 360,
        minH: 240
      });
    }
    const smallModals = document.querySelectorAll('.maint-modal-bg.on .maint-modal.erp-qb-dialog');
    smallModals.forEach(m => {
      if (m.closest('#maintCatModal')) return;
      if (m.closest('#maintWorkOrderModal')) return;
      erpWireResizableModalShell(m, {
        storageKey: 'maint_dialog',
        dragRoot: '.erp-qb-dialog__head',
        minW: 480,
        minH: 320
      });
    });
  }

  /** Call when opening a dedicated accounting form so size keys stay separate per surface. */
  function erpRestoreDedicatedModalGeometry(kind) {
    const shell = document.querySelector('#erpDedicatedFormModal .erp-dedicated-form-modal__shell');
    if (!shell) return;
    const map = { fuel: 'dedicated_fuel', ap: 'dedicated_ap', billpay: 'dedicated_billpay' };
    const key = map[String(kind || '').trim()] || 'dedicated_default';
    erpRestoreModalRect(shell, key);
  }

  global.erpInitResizableModals = erpInitResizableModals;
  global.erpRestoreDedicatedModalGeometry = erpRestoreDedicatedModalGeometry;
  global.erpWireResizableModalShell = erpWireResizableModalShell;
})(typeof window !== 'undefined' ? window : globalThis);
