/**
 * IH35 ERP — shared UI helpers:
 * FIX 10 — async button busy + table pager (`erpWithBusy`, `erpPagerRender`, …).
 * Rule 22 — inline “?” help panels (`erpHelpTipToggle`); style in `erp-master-spec-2026.css`.
 * Rule 19 — toasts (`showToast`); host `#erpToastHost` + styles in `erp-master-spec-2026.css`.
 * `erpNotify` — toast-first replacement for `alert()` (inference for type when omitted); falls back to `alert` if toasts unavailable.
 * Rule 24 — `erpMountConnectionStrip(id)` reads `GET /api/qbo/status` into a one-line status strip (banking, settings, fuel).
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

  /**
   * Rule 24 — hydrate a host element with QuickBooks connection text (read-only status).
   * @param {string | HTMLElement} hostIdOrEl
   */
  async function erpMountConnectionStrip(hostIdOrEl) {
    const el =
      typeof hostIdOrEl === 'string' ? document.getElementById(hostIdOrEl) : hostIdOrEl;
    if (!el || !(el instanceof HTMLElement)) return;
    el.classList.add('erp-connection-strip');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.textContent = 'QuickBooks: checking…';
    el.classList.remove('erp-connection-strip--ok', 'erp-connection-strip--warn', 'erp-connection-strip--muted');
    try {
      const r = await fetch('/api/qbo/status', { headers: { Accept: 'application/json' } });
      const j = await r.json().catch(() => ({}));
      if (!j || typeof j !== 'object') {
        el.classList.add('erp-connection-strip--muted');
        el.textContent = 'QuickBooks: status unavailable.';
        return;
      }
      if (!j.configured) {
        el.classList.add('erp-connection-strip--warn');
        el.textContent = 'QuickBooks: not configured on server.';
        return;
      }
      if (j.connected) {
        el.classList.add('erp-connection-strip--ok');
        el.textContent =
          'QuickBooks: connected' + (j.companyName ? ' — ' + String(j.companyName) : '') + '.';
        return;
      }
      el.classList.add('erp-connection-strip--warn');
      el.textContent = 'QuickBooks: not connected — open Settings to authorize.';
    } catch (_) {
      el.classList.add('erp-connection-strip--muted');
      el.textContent = 'QuickBooks: could not load status.';
    }
  }

  global.erpMountConnectionStrip = erpMountConnectionStrip;
})(typeof window !== 'undefined' ? window : globalThis);
