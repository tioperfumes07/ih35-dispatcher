/**
 * IH35 ERP — shared UI helpers:
 * FIX 10 — async button busy + table pager (`erpWithBusy`, `erpPagerRender`, …).
 * Rule 22 — inline “?” help panels (`erpHelpTipToggle`); style in `erp-master-spec-2026.css`.
 * Rule 19 — toasts (`showToast`); host `#erpToastHost` + styles in `erp-master-spec-2026.css`.
 * `erpNotify` — toast-first replacement for `alert()` (inference for type when omitted); falls back to `alert` if toasts unavailable.
 * Maintenance / Accounting driver integrity strips (`erpRefreshApDriverIntegrityStrip`, `erpRefreshApHeaderDriverIntegrityStrip`, `erpRefreshFuelDriverIntegrityStrip`) live in `maintenance.html`; they share `erpFleetMergeIntegrityApiAlerts` → `localStorage['fleet:integrity-alerts']`.
 * Rule 24 — `erpMountConnectionStrip(id)` reads `GET /api/qbo/status` and `GET /api/health` (read-only). When both integrations look healthy, one compact line is shown. Refreshes every 12 minutes while the page stays open. Non-2xx QBO status uses muted “could not load status.”
 */
(function (global) {
  'use strict';

  var ERP_UPDATE_EVENT = 'ih35:update-available';

  function erpCurrentBuildVersion() {
    try {
      var v = document.documentElement.getAttribute('data-build-version');
      return v ? String(v).trim() : '';
    } catch (_) {
      return '';
    }
  }

  function erpMarkUpdateAvailable(nextVersion) {
    try {
      global.__IH35_UPDATE_AVAILABLE = true;
      global.__IH35_UPDATE_VERSION = String(nextVersion || '').trim();
      global.dispatchEvent(
        new CustomEvent(ERP_UPDATE_EVENT, {
          detail: { version: global.__IH35_UPDATE_VERSION },
        }),
      );
    } catch (_) {}
  }

  function erpStartBuildVersionWatcher() {
    var current = erpCurrentBuildVersion();
    if (!current || typeof fetch !== 'function') return;
    var intervalMs = 5 * 60 * 1000;
    var ticking = false;

    async function tick() {
      if (ticking) return;
      ticking = true;
      try {
        var r = await fetch('/health?t=' + Date.now(), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!r.ok) return;
        var j = await r.json();
        var next = j && j.version ? String(j.version).trim() : '';
        if (!next || next === current) return;
        erpMarkUpdateAvailable(next);
      } catch (_) {
        // Ignore transient network errors; keep polling.
      } finally {
        ticking = false;
      }
    }

    void tick();
    global.setInterval(function () {
      void tick();
    }, intervalMs);
  }

  global.erpCurrentBuildVersion = erpCurrentBuildVersion;
  global.erpStartBuildVersionWatcher = erpStartBuildVersionWatcher;
  erpStartBuildVersionWatcher();

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
  const __erpToastDedupe = new Map();
  const MAX_ERP_TOASTS = 3;
  const ERP_TOAST_DEDUPE_MS = 2800;

  function showToast(message, type) {
    const text = String(message || '').trim();
    if (!text) return;
    const t = String(type || 'success').toLowerCase();
    const dedupeKey = t + '\u0000' + text;
    const prev = __erpToastDedupe.get(dedupeKey);
    const now = Date.now();
    if (prev && now - prev < ERP_TOAST_DEDUPE_MS) return;
    __erpToastDedupe.set(dedupeKey, now);
    for (const [k, ts] of __erpToastDedupe) {
      if (now - ts > 60000) __erpToastDedupe.delete(k);
    }

    let host = document.getElementById('erpToastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'erpToastHost';
      host.className = 'erp-toast-host';
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    while (host.childElementCount >= MAX_ERP_TOASTS) {
      host.removeChild(host.firstChild);
    }

    const row = document.createElement('div');
    row.className = 'erp-toast';
    const dot = document.createElement('span');
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

    const ttl =
      t === 'error' ? 4000 : t === 'warning' ? 4500 : t === 'info' ? 3800 : 3200;
    let timer = global.setTimeout(() => {
      row.remove();
    }, ttl);
    row.addEventListener('mouseenter', () => {
      global.clearTimeout(timer);
    });
    row.addEventListener('mouseleave', () => {
      timer = global.setTimeout(() => {
        row.remove();
      }, Math.min(6000, ttl));
    });
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
   * Optional topbar badge (`#erpBuildRefBadge`) to show active deploy/build ref.
   * @param {string} runtimeRef
   * @param {string} healthRef
   * @param {'ok'|'warn'|'muted'} tone
   */
  function syncBuildRefBadge(runtimeRef, healthRef, tone) {
    const el = document.getElementById('erpBuildRefBadge');
    if (!el) return;
    const run = String(runtimeRef || '').trim();
    const health = String(healthRef || '').trim();
    const shown = health || run;
    el.classList.remove('topbar-buildref--ok', 'topbar-buildref--warn', 'topbar-buildref--muted');
    if (!shown) {
      el.textContent = 'Build ref: —';
      el.classList.add('topbar-buildref--muted');
      return;
    }
    el.textContent = 'Build ref: ' + shown;
    el.classList.add(
      tone === 'warn' ? 'topbar-buildref--warn' : tone === 'ok' ? 'topbar-buildref--ok' : 'topbar-buildref--muted',
    );
  }

  function formatSeenAt(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  }

  function recordBuildRefSeen(ref, source) {
    const buildRef = String(ref || '').trim();
    if (!buildRef || typeof localStorage === 'undefined') return null;
    const nowIso = new Date().toISOString();
    const key = 'ih35:build-ref-history';
    try {
      const raw = localStorage.getItem(key);
      const history = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(history) ? history : [];
      const next = arr.filter((x) => x && x.ref !== buildRef).slice(0, 24);
      next.unshift({ ref: buildRef, source: String(source || 'unknown'), seenAt: nowIso });
      localStorage.setItem(key, JSON.stringify(next.slice(0, 25)));
      return nowIso;
    } catch (_) {
      return nowIso;
    }
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

    function runForcedRefresh(expectedRef) {
      try {
        const u = new URL(global.location.href);
        u.searchParams.set('ih35_refresh', String(Date.now()));
        if (expectedRef) u.searchParams.set('ih35_ref', String(expectedRef));
        global.location.replace(u.toString());
      } catch (_) {
        global.location.reload();
      }
    }

    function appendRefreshActionRow(expectedRef) {
      const row = document.createElement('div');
      row.className = 'erp-connection-strip__row';
      const dot = document.createElement('span');
      dot.className = 'erp-connection-strip__dot erp-connection-strip__dot--warn';
      dot.setAttribute('aria-hidden', 'true');
      const msg = document.createElement('span');
      msg.textContent = 'Update detected:';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'erp-connection-strip__refresh-btn';
      btn.textContent = 'Force refresh now';
      btn.addEventListener('click', () => runForcedRefresh(expectedRef));
      row.appendChild(dot);
      row.appendChild(msg);
      row.appendChild(btn);
      el.appendChild(row);
    }

    async function paintStrip() {
      el.textContent = '';
      el.classList.remove(
        'erp-connection-strip--ok',
        'erp-connection-strip--warn',
        'erp-connection-strip--muted',
        'erp-connection-strip--compact'
      );
      let worst = 0;
      try {
        const [rq, rh] = await Promise.all([
          fetch('/api/qbo/status', { headers: { Accept: 'application/json' } }),
          fetch('/api/health', { headers: { Accept: 'application/json' } })
        ]);
        const qj = rq.ok ? await rq.json().catch(() => ({})) : null;
        const hj = rh.ok ? await rh.json().catch(() => ({})) : null;

        /** @type {{ kind: 'ok'|'warn'|'bad', text: string, sev: number } | null} */
        let qRow = null;
        if (!rq.ok) {
          qRow = { kind: 'bad', text: stripLoadFailed, sev: 2 };
        } else if (!qj || typeof qj !== 'object') {
          qRow = { kind: 'bad', text: 'QuickBooks: status unavailable.', sev: 2 };
        } else if (!qj.configured) {
          qRow = { kind: 'warn', text: 'QuickBooks: not configured on server.', sev: 1 };
        } else if (qj.connected) {
          const err = typeof qj.lastRefreshError === 'string' ? qj.lastRefreshError.trim() : '';
          if (err) {
            const short = err.length > 120 ? err.slice(0, 117) + '…' : err;
            qRow = {
              kind: 'warn',
              text:
                'QuickBooks: last error — ' +
                short +
                ' (Test connection or re-authorize).',
              sev: 1
            };
          } else {
            const nm = qj.companyName ? String(qj.companyName) : '';
            qRow = {
              kind: 'ok',
              text: 'QuickBooks connected' + (nm ? ' — ' + nm : '') + '.',
              sev: 0
            };
          }
        } else {
          qRow = { kind: 'warn', text: 'QuickBooks: not connected — open Settings to authorize.', sev: 1 };
        }

        const parseVehicleCount = value => {
          if (value === null || value === undefined || value === '') return null;
          const n = Number(value);
          return Number.isFinite(n) && n >= 0 ? n : null;
        };

        /** @type {{ kind: 'ok'|'warn'|'bad', text: string, sev: number } | null} */
        let sRow = null;
        if (!rh.ok) {
          sRow = { kind: 'bad', text: 'Samsara: could not load health status.', sev: 2 };
        } else if (!hj || typeof hj !== 'object') {
          sRow = { kind: 'warn', text: 'Samsara: status unavailable.', sev: 1 };
        } else if (!hj.hasSamsaraToken) {
          sRow = { kind: 'warn', text: 'Samsara: API token not configured on server.', sev: 1 };
        } else {
          const nVeh = parseVehicleCount(hj.samsaraVehicles);
          const tail =
            nVeh !== null ? ' · last snapshot: ' + nVeh + ' vehicles' : '';
          sRow = { kind: 'ok', text: 'Samsara token on server' + tail + '.', sev: 0 };
        }

        worst = Math.max(qRow ? qRow.sev : 0, sRow ? sRow.sev : 0);
        const compactOk =
          worst === 0 && qRow && sRow && qRow.kind === 'ok' && sRow.kind === 'ok' && qj && hj;
        if (compactOk) {
          el.classList.add('erp-connection-strip--compact');
          const nm = qj.companyName ? String(qj.companyName) : '';
          const nVeh = parseVehicleCount(hj.samsaraVehicles);
          const veh =
            nVeh !== null ? ' · Samsara snapshot: ' + nVeh + ' vehicles' : ' · Samsara: token OK';
          appendRow('ok', 'Integrations · QuickBooks connected' + (nm ? ' — ' + nm : '') + veh + '.');
        } else {
          if (qRow) appendRow(qRow.kind, qRow.text);
          if (sRow) appendRow(sRow.kind, sRow.text);
        }

        const runtimeRef =
          typeof global.__IH35_DEPLOY_REF === 'string' ? String(global.__IH35_DEPLOY_REF).trim() : '';
        const healthRef = hj && typeof hj.version === 'string' ? String(hj.version).trim() : '';
        if (runtimeRef || healthRef) {
          const sameRef = runtimeRef && healthRef && runtimeRef === healthRef;
          const shownRef = healthRef || runtimeRef;
          const seenAtIso = recordBuildRefSeen(shownRef, healthRef ? 'health' : 'runtime');
          const seenAtText = formatSeenAt(seenAtIso);
          const prevMismatch = Number(el._erpRefMismatchCount || 0);
          const nextMismatch = sameRef ? 0 : prevMismatch + 1;
          el._erpRefMismatchCount = nextMismatch;
          appendRow(
            sameRef ? 'ok' : 'warn',
            'Build ref: ' +
              shownRef +
              (seenAtText ? ' · seen ' + seenAtText : '') +
              (sameRef ? '' : ' (refresh if this does not match expected deploy)')
          );
          if (!sameRef && nextMismatch >= 2) {
            appendRefreshActionRow(healthRef || shownRef);
            if (!global.__erpRefMismatchNotified) {
              global.__erpRefMismatchNotified = true;
              if (typeof showToast === 'function') {
                showToast('New version detected. Reload this page to apply updates.', 'warning');
              }
            }
            if (healthRef) {
              try {
                erpMarkUpdateAvailable(healthRef);
              } catch (_) {
                /* ignore */
              }
            }
          }
          syncBuildRefBadge(runtimeRef, healthRef, sameRef ? 'ok' : 'warn');
        } else {
          el._erpRefMismatchCount = 0;
          syncBuildRefBadge('', '', 'muted');
        }
        if (worst >= 2) el.classList.add('erp-connection-strip--muted');
        else if (worst === 1) el.classList.add('erp-connection-strip--warn');
        else el.classList.add('erp-connection-strip--ok');
        syncOptionalDisconnectBanners(rq.ok, rh.ok, qj, hj);
      } catch (_) {
        el.textContent = '';
        appendRow('bad', stripLoadFailed);
        appendRow('bad', 'Samsara: check failed.');
        syncBuildRefBadge('', '', 'muted');
        el.classList.add('erp-connection-strip--muted');
        syncOptionalDisconnectBanners(false, false, null, null);
      }
    }

    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    await paintStrip();
    el._erpStripTimer = global.setInterval(() => {
      void paintStrip();
    }, 720000);
  }

  global.erpMountConnectionStrip = erpMountConnectionStrip;

  /**
   * Resizable + draggable modal shells (visual only). Persists geometry in localStorage.
   * Keys: `modal_size_[formtype]` ({ width, height }), `modal_pos_[formtype]` ({ left, top }).
   */
  const __erpModalShellWired = new WeakSet();

  function erpClamp(n, lo, hi) {
    return Math.min(Math.max(n, lo), hi);
  }

  function erpReadModalRect(storageKey, mins) {
    if (!storageKey || typeof localStorage === 'undefined') return null;
    const minW = Number(mins && mins.minW) > 0 ? Number(mins.minW) : 520;
    const minH = Number(mins && mins.minH) > 0 ? Number(mins.minH) : 400;
    try {
      const rawSize = localStorage.getItem(`${'modal_size_'}${storageKey}`);
      const rawPos = localStorage.getItem(`${'modal_pos_'}${storageKey}`);
      let w;
      let h;
      let l;
      let t;
      if (rawSize) {
        const o = JSON.parse(rawSize);
        if (o && typeof o === 'object') {
          w = Number(o.width);
          h = Number(o.height);
          if (rawPos == null && (Number.isFinite(Number(o.left)) || Number.isFinite(Number(o.top)))) {
            l = Number(o.left);
            t = Number(o.top);
          }
        }
      }
      if (rawPos) {
        const o = JSON.parse(rawPos);
        if (o && typeof o === 'object') {
          l = Number(o.left);
          t = Number(o.top);
        }
      }
      if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
      const maxW = window.innerWidth * 0.95;
      const maxH = window.innerHeight * 0.95;
      const width = erpClamp(w, minW, maxW);
      const height = erpClamp(h, minH, maxH);
      let left = Number.isFinite(l) ? l : null;
      let top = Number.isFinite(t) ? t : null;
      if (left != null)
        left = erpClamp(left, 0, Math.max(0, window.innerWidth - Math.min(width, window.innerWidth)));
      if (top != null)
        top = erpClamp(top, 0, Math.max(0, window.innerHeight - Math.min(height, window.innerHeight)));
      if (left != null && (left + width > window.innerWidth || left < 0)) left = null;
      if (top != null && (top + height > window.innerHeight || top < 0)) top = null;
      return { width, height, left, top };
    } catch (_) {
      return null;
    }
  }

  function erpWriteModalRect(storageKey, shell) {
    if (!storageKey || !shell || typeof localStorage === 'undefined') return;
    try {
      const r = shell.getBoundingClientRect();
      const sizePayload = {
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
      const posPayload = {
        left: Math.round(r.left),
        top: Math.round(r.top)
      };
      localStorage.setItem(`${'modal_size_'}${storageKey}`, JSON.stringify(sizePayload));
      localStorage.setItem(`${'modal_pos_'}${storageKey}`, JSON.stringify(posPayload));
    } catch (_) {}
  }

  function erpRestoreModalRect(shell, storageKey, mins) {
    if (!shell || !storageKey) return;
    const rect = erpReadModalRect(storageKey, mins);
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
    const minW = Number(opts.minW) > 0 ? Number(opts.minW) : 520;
    const minH = Number(opts.minH) > 0 ? Number(opts.minH) : 400;

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
      if (t.closest('button, a, input, select, textarea, [data-erp-no-drag], .erp-mb-modal__chrome')) return;
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
        minW: 520,
        minH: 400
      });
    }
    const wo = document.querySelector('#maintWorkOrderModal .maint-workorder-fullmodal__shell');
    if (wo) {
      erpWireResizableModalShell(wo, {
        storageKey: 'workorder',
        dragRoot: '.maint-workorder-fullmodal__head',
        minW: 520,
        minH: 400
      });
    }
    const cat = document.querySelector('#maintCatModal .maint-modal.erp-qb-dialog');
    if (cat) {
      erpWireResizableModalShell(cat, {
        storageKey: 'maint_category',
        dragRoot: '.erp-qb-dialog__head',
        minW: 520,
        minH: 400
      });
    }
    const mbDlg = document.querySelector('#erpMultiBillsModal .erp-mb-modal__dialog');
    if (mbDlg) {
      erpWireResizableModalShell(mbDlg, {
        storageKey: 'multi_bills',
        dragRoot: '.erp-mb-modal__head',
        minW: 520,
        minH: 400
      });
    }
    document.querySelectorAll('#shopQueueAddModal .maint-modal.erp-qb-dialog').forEach(m => {
      erpWireResizableModalShell(m, {
        storageKey: 'shop_queue',
        dragRoot: '.erp-qb-dialog__head',
        minW: 520,
        minH: 400
      });
    });
    document.querySelectorAll('#shopDelayModal .maint-modal.erp-qb-dialog').forEach(m => {
      erpWireResizableModalShell(m, {
        storageKey: 'shop_delay',
        dragRoot: '.erp-qb-dialog__head',
        minW: 520,
        minH: 400
      });
    });
    if (typeof global.erpModalChromeAttachMissingFullscreenToggles === 'function') {
      global.erpModalChromeAttachMissingFullscreenToggles(document);
    }
  }

  /** Call when opening a dedicated accounting form so size keys stay separate per surface. */
  function erpRestoreDedicatedModalGeometry(kind) {
    const shell = document.querySelector('#erpDedicatedFormModal .erp-dedicated-form-modal__shell');
    if (!shell) return;
    const map = {
      fuel: 'dedicated_fuel',
      ap: 'dedicated_ap',
      billpay: 'dedicated_billpay',
      ledger: 'dedicated_ledger'
    };
    const key = map[String(kind || '').trim()] || 'dedicated_default';
    erpRestoreModalRect(shell, key, { minW: 520, minH: 400 });
  }

  /** Packet 3 — column resize + tab order + DOM→Excel (SheetJS on maintenance.html via CDN). */
  var __erpColResizeHandles = new WeakMap();

  function erpInitColumnResize(table) {
    if (!table || !(table instanceof HTMLTableElement)) return;
    var prev = __erpColResizeHandles.get(table);
    if (prev) {
      prev.forEach(function (h) {
        try {
          h.remove();
        } catch (_) {}
      });
    }
    var handles = [];
    var ths = table.querySelectorAll('thead tr:last-child th');
    if (!ths.length) ths = table.querySelectorAll('tr:first-child th');
    if (ths.length < 2) {
      __erpColResizeHandles.set(table, handles);
      return;
    }
    ths.forEach(function (th) {
      th.style.position = 'relative';
      var handle = document.createElement('div');
      handle.className = 'erp-col-resize-handle';
      handle.setAttribute('role', 'presentation');
      handle.style.cssText =
        'position:absolute;right:0;top:0;bottom:0;width:5px;cursor:col-resize;z-index:1';
      handle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var startX = e.clientX;
        var startW = th.offsetWidth;
        function onMove(ev) {
          th.style.width = Math.max(40, startW + ev.clientX - startX) + 'px';
          th.style.minWidth = th.style.width;
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      th.appendChild(handle);
      handles.push(handle);
    });
    __erpColResizeHandles.set(table, handles);
  }

  function erpWireTableTabOrder(table) {
    if (!table || !(table instanceof HTMLTableElement)) return;
    var sel =
      'tbody input:not([type="hidden"]):not([disabled]), tbody select:not([disabled]), tbody textarea:not([disabled]), tbody button:not([disabled])';
    var cells = table.querySelectorAll(sel);
    var i = 1;
    cells.forEach(function (el) {
      if (!(el instanceof HTMLElement)) return;
      if (el.closest('[data-skip-tab-order]')) return;
      if (el.getAttribute('tabindex') === '-1') return;
      if (el.hasAttribute('data-fr-preserve-tabindex')) return;
      el.tabIndex = i++;
    });
  }

  function erpExportDomTableToXlsx(table, baseFileName) {
    var XLSX = global.XLSX;
    if (!XLSX || !table) return;
    var day = new Date().toISOString().slice(0, 10);
    var safe = String(baseFileName || 'Export').replace(/[^\w.-]+/g, '_');
    var ws = XLSX.utils.table_to_sheet(table, { raw: true });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Export');
    XLSX.writeFile(wb, safe + '-' + day + '.xlsx');
  }

  /**
   * Re-run after dynamic table renders (e.g. loadAll). Idempotent per table element.
   * @param {ParentNode | null} [root]
   */
  function erpInitFleetTableChrome(root) {
    var el = root && root.querySelectorAll ? root : document.body;
    el.querySelectorAll('table').forEach(function (table) {
      if (!(table instanceof HTMLTableElement)) return;
      if (table.closest('[data-erp-no-table-chrome]')) return;
      var thCount = table.querySelectorAll('thead th').length;
      if (!thCount) return;
      if (thCount < 2) return;
      erpInitColumnResize(table);
      erpWireTableTabOrder(table);
    });
  }

  global.erpInitResizableModals = erpInitResizableModals;
  global.erpRestoreDedicatedModalGeometry = erpRestoreDedicatedModalGeometry;
  global.erpWireResizableModalShell = erpWireResizableModalShell;
  global.erpRestoreModalRect = erpRestoreModalRect;
  global.erpInitColumnResize = erpInitColumnResize;
  global.erpWireTableTabOrder = erpWireTableTabOrder;
  global.erpExportDomTableToXlsx = erpExportDomTableToXlsx;
  global.erpInitFleetTableChrome = erpInitFleetTableChrome;

  /**
   * Reports now render in-shell only; legacy iframe loader kept as no-op.
   */
  function erpEnsureFleetReportsHubIframe() {
    return;
  }

  global.erpEnsureFleetReportsHubIframe = erpEnsureFleetReportsHubIframe;

  /**
   * Reports section no longer exposes iframe fallback controls.
   * Kept for backward compatibility with old onclick handlers.
   */
  function erpToggleFleetReportsHubEmbed() {
    return false;
  }

  global.erpToggleFleetReportsHubEmbed = erpToggleFleetReportsHubEmbed;

  /**
   * Select an in-shell reports category tab (e.g. "compliance" for Form 425C card).
   */
  function erpNavigateFleetReportsHubTab(tabId) {
    var t = String(tabId || 'overview').trim() || 'overview';
    if (typeof window.repInitReportsHub === 'function') {
      try {
        window.repInitReportsHub();
      } catch (_) {}
    }
    var shell = document.getElementById('erpReportsCatalogShell');
    if (shell) {
      shell.classList.remove('hidden');
      shell.hidden = false;
    }
    var tabs = document.getElementById('repCatTabs');
    if (!tabs) return false;
    var btn = tabs.querySelector('.rep-cat-tab[data-cat="' + t + '"]');
    if (!btn && t !== 'overview') btn = tabs.querySelector('.rep-cat-tab[data-cat="overview"]');
    if (!btn || !(btn instanceof HTMLElement)) return false;
    btn.click();
    return true;
  }

  global.erpNavigateFleetReportsHubTab = erpNavigateFleetReportsHubTab;

  /** Same localStorage key as apps/fleet-reports-hub (`postIntegrityCheck.ts`). */
  var ERP_FLEET_INTEGRITY_LS_KEY = 'fleet:integrity-alerts';
  var ERP_FLEET_INTEGRITY_CHANGED_EVENT = 'fleet-integrity-alerts-changed';

  function erpFleetHubCategory(cat) {
    var c = String(cat || 'maintenance').toLowerCase();
    if (
      c === 'tires' ||
      c === 'drivers' ||
      c === 'accidents' ||
      c === 'fuel' ||
      c === 'maintenance' ||
      c === 'predictive'
    )
      return c;
    return 'maintenance';
  }

  function erpFleetHubSeverity(sev) {
    var u = String(sev || '').toUpperCase();
    return u === 'RED' ? 'red' : 'amber';
  }

  function erpFleetApiRowToHubAlert(a) {
    if (!a || typeof a !== 'object') return null;
    var typ = String(a.alertType || a.type || 'M1').trim();
    var code = /^[A-Za-z][0-9]$/.test(typ.slice(0, 2)) ? typ.slice(0, 2).toUpperCase() : 'M1';
    var sev = erpFleetHubSeverity(a.severity);
    var cat = erpFleetHubCategory(a.category);
    var msg = String(a.message || a.shortTitle || '').trim() || 'Integrity alert';
    var id0 = a.id != null ? String(a.id).trim() : '';
    var id = id0 || code + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    return {
      id: id,
      checkCode: code,
      category: cat,
      severity: sev,
      title: String(a.shortTitle || typ || 'Alert'),
      message: msg,
      triggeringRecords: [{ id: '1', label: msg, unit: a.unitId || undefined }],
      createdAt: String(a.createdAt || a.triggeredDate || new Date().toISOString()),
    };
  }

  /** Merge POST /api/integrity/check rows into the hub-compatible store (TMS + ERP parity). */
  function erpFleetMergeIntegrityApiAlerts(rows) {
    if (!rows || !rows.length) return;
    var mapped = rows.map(erpFleetApiRowToHubAlert).filter(Boolean);
    if (!mapped.length) return;
    var existing = [];
    try {
      existing = JSON.parse(global.localStorage.getItem(ERP_FLEET_INTEGRITY_LS_KEY) || '[]');
    } catch (_) {
      existing = [];
    }
    if (!Array.isArray(existing)) existing = [];
    var next = mapped.concat(existing).slice(0, 200);
    try {
      global.localStorage.setItem(ERP_FLEET_INTEGRITY_LS_KEY, JSON.stringify(next));
    } catch (_) {
      return;
    }
    try {
      global.dispatchEvent(new CustomEvent(ERP_FLEET_INTEGRITY_CHANGED_EVENT));
    } catch (_) {}
  }

  global.ERP_FLEET_INTEGRITY_LS_KEY = ERP_FLEET_INTEGRITY_LS_KEY;
  global.ERP_FLEET_INTEGRITY_CHANGED_EVENT = ERP_FLEET_INTEGRITY_CHANGED_EVENT;
  global.erpFleetMergeIntegrityApiAlerts = erpFleetMergeIntegrityApiAlerts;

  /**
   * Open the canonical hub FuelTransactionForm (new tab). Used from fuel.html and ERP helpers.
   * @param {'fuel-bill'|'fuel-expense'|'def-bill'|'fuel-def-combined'} type
   */
  function erpOpenFuelTransactionHub(type) {
    var t = String(type || 'fuel-bill').trim() || 'fuel-bill';
    var hubBase =
      typeof global.__IH35_FLEET_HUB_BASE === 'string' && global.__IH35_FLEET_HUB_BASE
        ? global.__IH35_FLEET_HUB_BASE
        : '';
    var deployRef = '';
    try {
      deployRef = typeof global.__IH35_DEPLOY_REF === 'string' ? String(global.__IH35_DEPLOY_REF).trim() : '';
    } catch (_) {
      deployRef = '';
    }
    var deploySuffix = deployRef ? '&v=' + encodeURIComponent(deployRef) : '';
    var base = String(hubBase || '').replace(/\/+$/, '');
    base = base.replace(/\/fleet-reports(?:\/fleet-reports)+$/, '/fleet-reports');
    var path = '/fleet-reports/index.html';
    if (base === '/fleet-reports' || /\/fleet-reports$/.test(base)) path = '/index.html';
    var url = base + path + '?erpFuelModal=1&fuelTxnType=' + encodeURIComponent(t) + deploySuffix;
    try {
      global.open(url, '_blank', 'noopener,noreferrer');
    } catch (_) {}
  }
  global.erpOpenFuelTransactionHub = erpOpenFuelTransactionHub;

  /**
   * Reports section: hide noisy legacy catalog tools by default; allow expand-on-demand.
   */
  function erpToggleLegacyReportsCatalog(btn) {
    var shell = document.getElementById('erpReportsCatalogShell');
    if (!shell) return false;
    var hidden = shell.classList.contains('hidden') || shell.hidden;
    if (hidden) {
      shell.classList.remove('hidden');
      shell.hidden = false;
    } else {
      shell.classList.add('hidden');
      shell.hidden = true;
    }
    if (btn && btn instanceof HTMLElement) {
      btn.setAttribute('aria-expanded', hidden ? 'true' : 'false');
      btn.textContent = hidden ? 'Hide legacy reports tools' : 'Show legacy reports tools';
    }
    return hidden;
  }

  global.erpToggleLegacyReportsCatalog = erpToggleLegacyReportsCatalog;
})(typeof window !== 'undefined' ? window : globalThis);
