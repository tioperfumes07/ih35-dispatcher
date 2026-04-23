/**
 * Lightweight searchable list for inputs backed by a <datalist> or <select>.
 * Escape closes; Enter picks first match; Tab picks and advances.
 */
(function (global) {
  'use strict';

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .trim();
  }

  function optsFromDatalist(input) {
    const id = input.getAttribute('list');
    if (!id) return [];
    const dl = document.getElementById(id);
    if (!dl) return [];
    return Array.from(dl.querySelectorAll('option'))
      .map(o => ({ value: o.value, label: o.label || o.value }))
      .filter(o => o.value);
  }

  function filterOpts(all, q) {
    const n = norm(q);
    if (!n) return all.slice(0, 80);
    return all.filter(o => norm(o.label).includes(n) || norm(o.value).includes(n)).slice(0, 80);
  }

  function attachFloatingList(input, getAllOpts) {
    if (!input || input.dataset.erpScomboBound === '1') return;
    input.dataset.erpScomboBound = '1';
    const wrap = document.createElement('div');
    wrap.className = 'erp-scombo-wrap';
    const parent = input.parentNode;
    if (parent && !input.closest('.erp-scombo-wrap')) {
      parent.insertBefore(wrap, input);
      wrap.appendChild(input);
    }
    const list = document.createElement('div');
    list.className = 'erp-scombo-list hidden';
    list.setAttribute('role', 'listbox');
    wrap.appendChild(list);
    let ix = -1;

    function hide() {
      list.classList.add('hidden');
      list.innerHTML = '';
      ix = -1;
    }

    function render(q) {
      const all = getAllOpts();
      const rows = filterOpts(all, q);
      if (!rows.length) {
        hide();
        return;
      }
      list._erpScomboRows = rows;
      list.innerHTML = rows
        .map(
          (o, i) =>
            `<button type="button" class="erp-scombo-item" role="option" data-ix="${i}">${String(o.label)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')}</button>`
        )
        .join('');
      list.classList.remove('hidden');
    }

    list.addEventListener('mousedown', ev => {
      const b = ev.target && ev.target.closest && ev.target.closest('button.erp-scombo-item');
      if (!b) return;
      ev.preventDefault();
      const ix = Number(b.getAttribute('data-ix'));
      const row = Array.isArray(list._erpScomboRows) ? list._erpScomboRows[ix] : null;
      input.value = row ? String(row.value != null ? row.value : row.label || '') : String(b.textContent || '').trim();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      hide();
    });

    input.addEventListener('input', () => render(input.value));
    input.addEventListener('focus', () => render(input.value));
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') {
        hide();
        return;
      }
      if (!list.classList.contains('hidden') && ev.key === 'Enter') {
        const first = list.querySelector('button.erp-scombo-item');
        if (first) {
          ev.preventDefault();
          first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
      }
    });
    document.addEventListener('click', ev => {
      if (!wrap.contains(ev.target)) hide();
    });
  }

  global.erpSearchableCombo = {
    attachFloatingList,
    optionsFromInputList: inp => optsFromDatalist(inp)
  };
})(typeof window !== 'undefined' ? window : globalThis);
