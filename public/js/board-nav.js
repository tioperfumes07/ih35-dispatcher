(function () {
  const BOARDS = [
    {
      id: 'tms',
      label: 'TMS–Dispatch',
      href: '/dispatch.html',
      links: [
        { label: 'Loads & dispatch board', href: '/dispatch.html' },
        { label: 'Operations hub', href: '/' }
      ]
    },
    {
      id: 'fuel',
      label: 'Fuel Route Planner',
      href: '/fuel.html',
      links: [
        { label: 'Fuel & route planner', href: '/fuel.html' },
        { label: 'Operations hub', href: '/' }
      ]
    },
    {
      id: 'maint',
      label: 'Maintenance Board',
      href: '/maintenance.html#maintenance',
      links: [
        { label: 'Maintenance & service', href: '/maintenance.html#maintenance' },
        { label: 'Full ERP dashboard', href: '/maintenance.html' }
      ]
    },
    {
      id: 'safety',
      label: 'Safety Board',
      href: '/safety.html',
      links: [
        { label: 'Safety overview', href: '/safety.html' },
        { label: 'Operations hub', href: '/' }
      ]
    },
    {
      id: 'track',
      label: 'Vehicle Tracking',
      href: '/tracking.html',
      links: [
        { label: 'Live fleet map (Samsara)', href: '/tracking.html' },
        { label: 'Tracking inside ERP', href: '/maintenance.html#tracking' },
        { label: 'Fuel board (map)', href: '/fuel.html' }
      ]
    },
    {
      id: 'acct',
      label: 'Accounting',
      href: '/maintenance.html#accounting',
      links: [
        { label: 'Expenses & work orders', href: '/maintenance.html#accounting' },
        { label: 'Settlement / P&L by load', href: '/maintenance.html#accounting-settlement' },
        { label: 'QBO master data', href: '/maintenance.html#accounting' }
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
      '<span class="board-nav-hint">Double-click a board name to open · Single-click for menu</span>';

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
