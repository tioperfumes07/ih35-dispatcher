(function () {
  const BOARDS = [
    {
      id: 'fuel',
      label: 'Fuel & route planning',
      href: '/maintenance.html#fuel',
      links: [
        { label: 'ERP — Fuel tab', href: '/maintenance.html#fuel' },
        { label: 'Full-screen fuel planner', href: '/fuel.html' },
        { label: 'Company home', href: '/' }
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
        { label: 'Company home', href: '/' }
      ]
    },
    {
      id: 'safety',
      label: 'Safety & compliance',
      href: '/maintenance.html#safety',
      links: [
        { label: 'ERP — Safety (HOS)', href: '/maintenance.html#safety' },
        { label: 'Company home', href: '/' }
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
      href: '/maintenance.html#accounting',
      links: [
        { label: 'Accounting board', href: '/maintenance.html#accounting' },
        { label: 'Bank & expense matching', href: '/banking.html' },
        { label: 'Driver bill pay', href: '/maintenance.html#accounting-driver-bill-pay' },
        { label: 'Fuel bill (dedicated)', href: '/maintenance.html#accounting-fuel-bill-new' },
        { label: 'Fuel expense (dedicated)', href: '/maintenance.html#accounting-fuel-expense-new' },
        { label: 'Maintenance bill (dedicated)', href: '/maintenance.html#accounting-maintenance-bill-new' },
        { label: 'Maintenance expense (dedicated)', href: '/maintenance.html#accounting-maintenance-expense-new' },
        { label: 'Pay bills', href: '/maintenance.html#accounting-bill-pay' },
        { label: 'QuickBooks lists (live master)', href: '/maintenance.html#accounting' },
        { label: 'Settlement / P&L by load', href: '/maintenance.html#reports-settlement' },
        { label: 'Vendor / driver bill (dedicated)', href: '/maintenance.html#accounting-vendor-driver-bill-new' }
      ]
    },
    {
      id: 'lists',
      label: 'Lists & catalogs',
      href: '/maintenance.html#catalog',
      links: [
        { label: 'Fleet & Samsara writes', href: '/maintenance.html#catalog-fleet' },
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
        { label: 'Reports hub (TMS · maintenance · QuickBooks)', href: '/maintenance.html#reports' },
        { label: 'Accounting', href: '/maintenance.html#accounting' },
        { label: 'Company home', href: '/' }
      ]
    }
  ];

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
      BOARDS.map(
        b => `
      <div class="board-nav-item" data-board="${b.id}">
        <button type="button" class="board-nav-trigger" data-board="${b.id}" data-href="${b.href.replace(/"/g, '&quot;')}">${b.label}</button>
        <div class="board-nav-dd">
          ${b.links.map(l => `<a href="${l.href.replace(/"/g, '&quot;')}">${escapeNav(l.label)}</a>`).join('')}
        </div>
      </div>`
      ).join('') +
      '<span class="board-nav-hint">Double-click a name to go there · Single-click opens shortcuts</span>';

    inner.appendChild(strip);

    const wrap = document.createElement('div');
    wrap.className = 'board-nav-wrap';
    wrap.appendChild(inner);
    mountEl.replaceWith(wrap);

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
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
