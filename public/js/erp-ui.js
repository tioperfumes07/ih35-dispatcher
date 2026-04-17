/**
 * IH35 ERP — shared UI helpers (FIX 10: async button busy + table pager).
 * Include after DOM-ready scripts that call these, or before inline handlers that reference window.*.
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
})(typeof window !== 'undefined' ? window : globalThis);
