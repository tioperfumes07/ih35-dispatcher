(function () {
  const BOARDS = [
    {
      id: 'fuel',
      label: 'Fuel & route planning',
      href: '/maintenance.html#fuel',
      links: [
        { label: 'Accounting — Fuel & DEF ledger', href: '/maintenance.html#accounting-fuel-ledger' },
        { label: 'ERP — Fuel tab', href: '/maintenance.html#fuel' },
        { label: 'Full-screen fuel planner', href: '/fuel.html' },
        { label: 'IH 35 Transportation LLC', href: '/' }
      ]
    },
    {
      id: 'maint',
      label: 'Maintenance center',
      href: '/maintenance.html#maintenance',
      links: [
        { label: 'Maintenance & service', href: '/maintenance.html#maintenance' },
        { label: 'Full ERP dashboard', href: '/maintenance.html' }
      ]
    },
    {
      id: 'loads',
      label: 'Loads & dispatch',
      href: '/dispatch.html',
      links: [
        { label: 'Loads board (full screen)', href: '/dispatch.html' },
        { label: 'ERP — Maintenance', href: '/maintenance.html#maintenance' },
        { label: 'IH 35 Transportation LLC', href: '/' }
      ]
    },
    {
      id: 'safety',
      label: 'Safety & compliance',
      href: '/maintenance.html#safety',
      links: [
        { label: 'ERP — Safety (HOS)', href: '/maintenance.html#safety' },
        { label: 'IH 35 Transportation LLC', href: '/' }
      ]
    },
    {
      id: 'track',
      label: 'Fleet tracking',
      href: '/maintenance.html#tracking',
      links: [
        { label: 'ERP — Tracking (map)', href: '/maintenance.html#tracking' },
        { label: 'Shop & maintenance (queues, rollups)', href: '/maintenance.html#tracking-shop' },
        { label: 'Open tracking in ERP', href: '/tracking.html' },
        { label: 'Fuel tab', href: '/maintenance.html#fuel' }
      ]
    },
    {
      id: 'acct',
      label: 'Accounting',
      href: '/maintenance.html#accounting-maintenance',
      links: [
        { label: 'Accounting board (KPIs)', href: '/maintenance.html#accounting-board' },
        { label: 'Expense history (log)', href: '/maintenance.html#accounting-expense-history' },
        { label: 'Bill history (log)', href: '/maintenance.html#accounting-bill-history' },
        { label: 'Saved maintenance expenses', href: '/maintenance.html#accounting-maintenance' },
        { label: 'Fuel & DEF ledger', href: '/maintenance.html#accounting-fuel-ledger' },
        { label: 'QBO rollback & imports', href: '/maintenance.html#accounting-rollback' },
        { label: 'QuickBooks live master', href: '/maintenance.html#accounting-qbo-master' },
        { label: 'Bank & expense matching', href: '/banking.html' },
        { label: 'Driver bill pay', href: '/maintenance.html#accounting-driver-bill-pay' },
        { label: 'Fuel bill (dedicated)', href: '/maintenance.html#accounting-fuel-bill-new' },
        { label: 'Fuel expense (dedicated)', href: '/maintenance.html#accounting-fuel-expense-new' },
        { label: 'Maintenance bill (dedicated)', href: '/maintenance.html#accounting-maintenance-bill-new' },
        { label: 'Maintenance expense (dedicated)', href: '/maintenance.html#accounting-maintenance-expense-new' },
        { label: 'Bill payment (composer)', href: '/maintenance.html#accounting-bill-pay' },
        { label: 'Bill payment history (tab)', href: '/maintenance.html#accounting-payment-history' },
        { label: 'Settlement / P&L by load', href: '/maintenance.html#reports-settlement' },
        { label: 'Driver bill (dedicated)', href: '/maintenance.html#accounting-driver-bill-new' },
        { label: 'Vendor bill (dedicated)', href: '/maintenance.html#accounting-vendor-bill-new' },
        { label: 'Repair bill (dedicated)', href: '/maintenance.html#accounting-repair-bill-new' },
        { label: 'Repair expense (dedicated)', href: '/maintenance.html#accounting-repair-expense-new' },
        { label: 'Vendor / driver bill (legacy)', href: '/maintenance.html#accounting-vendor-driver-bill-new' }
      ]
    },
    {
      id: 'lists',
      label: 'Lists & catalogs',
      href: '/maintenance.html#catalog',
      links: [
        { label: 'Fleet & Samsara writes', href: '/maintenance.html#catalog-fleet' },
        { label: 'Name management', href: '/maintenance.html#catalog-name-mgmt' },
        { label: 'Operational status', href: '/maintenance.html#catalog-operational' },
        { label: 'QuickBooks items & accounts', href: '/maintenance.html#catalog-qbo' },
        { label: 'Service types (database)', href: '/maintenance.html#catalog-service' },
        { label: 'Upload center', href: '/maintenance.html#uploads' },
        { label: 'Vendors & driver payees', href: '/maintenance.html#catalog-vendors' }
      ]
    },
    {
      id: 'reports',
      label: 'Reports',
      href: '/maintenance.html#reports',
      links: [
        { label: 'Accounting', href: '/maintenance.html#accounting' },
        { label: 'Form 425C — Monthly report', href: '/form-425c.html' },
        { label: 'IH 35 Transportation LLC', href: '/' },
        { label: 'Reports hub (TMS · maintenance · QuickBooks)', href: '/maintenance.html#reports' }
      ]
    }
  ];
  const UPDATE_BANNER_ID = 'ih35UpdateBanner';

  function showUpdateBanner() {
    if (!document.body || document.getElementById(UPDATE_BANNER_ID)) return;
    const banner = document.createElement('div');
    banner.id = UPDATE_BANNER_ID;
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;gap:12px;align-items:center;justify-content:center;' +
      'padding:8px 12px;background:#1a7f37;color:#fff;font-size:12px;line-height:1.3;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';
    banner.innerHTML =
      '<span>A new version is available.</span>' +
      '<button type="button" data-ih35-update-reload="1" style="height:24px;padding:0 12px;background:#fff;color:#1a7f37;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600">Reload now</button>' +
      '<button type="button" data-ih35-update-dismiss="1" aria-label="Dismiss update banner" style="background:none;border:none;color:#fff;cursor:pointer;font-size:15px;line-height:1">×</button>';
    banner.querySelector('[data-ih35-update-reload="1"]')?.addEventListener('click', function () {
      window.location.reload();
    });
    banner.querySelector('[data-ih35-update-dismiss="1"]')?.addEventListener('click', function () {
      banner.remove();
    });
    document.body.prepend(banner);
  }

  function bindUpdateBanner() {
    if (window.__IH35_UPDATE_AVAILABLE) showUpdateBanner();
    window.addEventListener('ih35:update-available', showUpdateBanner);
  }

  function closeAll() {
    document.querySelectorAll('.board-nav-item.open').forEach(el => el.classList.remove('open'));
  }

  function toggleItem(id) {
    const item = document.querySelector(`.board-nav-item[data-board="${id}"]`);
    if (!item) return;
    const wasOpen = item.classList.contains('open');
    closeAll();
    if (!wasOpen) item.classList.add('open');
  }

  function onDocClick(e) {
    const raw = e && e.target;
    const t = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement;
    if (!t || typeof t.closest !== 'function') closeAll();
    else if (!t.closest('.board-nav-wrap')) closeAll();
  }

  function normalizeHrefForCompare(raw) {
    try {
      const u = new URL(String(raw || ''), window.location.origin);
      return `${u.pathname}${u.hash || ''}`;
    } catch (_) {
      return String(raw || '');
    }
  }

  function mount() {
    const mountEl = document.getElementById('boardNavMount');
    if (!mountEl) return;

    const inner = document.createElement('div');
    inner.className = 'board-nav-inner';

    const stripToggle = document.createElement('button');
    stripToggle.type = 'button';
    stripToggle.className = 'board-nav-strip-toggle';
    stripToggle.setAttribute('aria-expanded', 'true');
    stripToggle.setAttribute('aria-controls', 'board-nav-strip');
    stripToggle.title = 'Collapse workspace navigation strip';
    stripToggle.textContent = '\u00ab';
    inner.appendChild(stripToggle);

    const strip = document.createElement('div');
    strip.id = 'board-nav-strip';
    strip.className = 'board-nav-strip';
    strip.innerHTML =
      BOARDS.map(b => {
        const links = [...b.links].sort((a, c) =>
          a.label.localeCompare(c.label, undefined, { sensitivity: 'base', numeric: true })
        );
        return `
      <div class="board-nav-item" data-board="${b.id}">
        <button type="button" class="board-nav-trigger" data-board="${b.id}" data-href="${b.href.replace(/"/g, '&quot;')}">${b.label}</button>
        <div class="board-nav-dd">
          ${links.map(l => `<a href="${l.href.replace(/"/g, '&quot;')}">${escapeNav(l.label)}</a>`).join('')}
        </div>
      </div>`;
      }).join('') +
      '<span class="board-nav-hint">Double-click a name to go there · Single-click opens shortcuts</span>';

    inner.appendChild(strip);

    const wrap = document.createElement('div');
    wrap.className = 'board-nav-wrap';
    wrap.appendChild(inner);
    mountEl.replaceWith(wrap);

    const applyActiveBoard = () => {
      const here = `${window.location.pathname}${window.location.hash || ''}`;
      const herePath = window.location.pathname;
      wrap.querySelectorAll('.board-nav-item').forEach((el) => el.classList.remove('active'));
      let best = null;
      let bestLen = -1;
      for (const b of BOARDS) {
        const target = normalizeHrefForCompare(b.href);
        const targetPath = target.split('#')[0] || '';
        if (!target) continue;
        const match =
          here === target ||
          (target.includes('#') && here.startsWith(target)) ||
          (!target.includes('#') && herePath === targetPath);
        if (!match) continue;
        if (target.length > bestLen) {
          best = b.id;
          bestLen = target.length;
        }
      }
      if (!best) return;
      const node = wrap.querySelector(`.board-nav-item[data-board="${best}"]`);
      if (node) node.classList.add('active');
    };
    applyActiveBoard();
    window.addEventListener('hashchange', applyActiveBoard);
    window.addEventListener('popstate', applyActiveBoard);

    stripToggle.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const collapsed = wrap.classList.toggle('board-nav-collapsed');
      stripToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      stripToggle.title = collapsed ? 'Expand workspace navigation strip' : 'Collapse workspace navigation strip';
      stripToggle.textContent = collapsed ? '\u00bb' : '\u00ab';
      try {
        localStorage.setItem('ih35_board_nav_collapsed', collapsed ? '1' : '0');
      } catch (_) {}
    });

    try {
      if (localStorage.getItem('ih35_board_nav_collapsed') === '1') {
        wrap.classList.add('board-nav-collapsed');
        stripToggle.setAttribute('aria-expanded', 'false');
        stripToggle.title = 'Expand workspace navigation strip';
        stripToggle.textContent = '\u00bb';
      }
    } catch (_) {}

    wrap.querySelectorAll('.board-nav-trigger').forEach(btn => {
      const id = btn.getAttribute('data-board');
      const href = btn.getAttribute('data-href');

      btn.addEventListener('click', ev => {
        ev.preventDefault();
        if (ev.detail >= 2) {
          window.location.href = href;
          return;
        }
        toggleItem(id);
      });
    });

    document.addEventListener('click', onDocClick);

  }

  function escapeNav(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  if (document.readyState === 'loading') {
    bindUpdateBanner();
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    bindUpdateBanner();
    mount();
  }
})();
