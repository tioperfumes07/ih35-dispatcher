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
        { label: 'Expenses & work orders', href: '/maintenance.html#accounting' },
        { label: 'Settlement / P&L by load', href: '/maintenance.html#reports-settlement' },
        { label: 'QuickBooks lists (live master)', href: '/maintenance.html#accounting' },
        { label: 'Bank & expense matching', href: '/banking.html' }
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
    if (!e.target.closest('.board-nav-wrap')) closeAll();
  }

  function mount() {
    const mountEl = document.getElementById('boardNavMount');
    if (!mountEl) return;

    const inner = document.createElement('div');
    inner.className = 'board-nav-inner';
    inner.innerHTML =
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

    const wrap = document.createElement('div');
    wrap.className = 'board-nav-wrap';
    wrap.appendChild(inner);
    mountEl.replaceWith(wrap);

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
