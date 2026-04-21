/**
 * Accounting / ERP tables: optional column resize handles.
 * - bindToTable: attach to an existing <table> (legacy / primary integration path).
 * - useColumnResize(columnCount, defaultWidths?): count-based controller (second API; safe for programmatic use).
 */
(function (global) {
  'use strict';

  var MIN_W = 40;

  /**
   * Count-based column widths + drag resize (no React).
   * @param {number} columnCount
   * @param {(number|null|undefined)[]=} defaultWidths
   */
  function useColumnResize(columnCount, defaultWidths) {
    var n = Math.max(0, columnCount | 0);
    /** @type {(number|null)[]} */
    var widths = new Array(n).fill(null);
    if (defaultWidths && defaultWidths.length) {
      for (var i = 0; i < n; i++) {
        if (defaultWidths[i] != null && Number.isFinite(Number(defaultWidths[i]))) {
          widths[i] = Math.max(MIN_W, Number(defaultWidths[i]));
        }
      }
    }

    function setWidths(updater) {
      var next = typeof updater === 'function' ? updater(widths.slice()) : updater;
      if (!Array.isArray(next)) return;
      for (var j = 0; j < n; j++) {
        var v = next[j];
        if (v == null || !Number.isFinite(v)) widths[j] = null;
        else widths[j] = Math.max(MIN_W, v);
      }
    }

    function widthStyleFor(i) {
      var w = widths[i];
      if (w == null || !Number.isFinite(w)) return {};
      var px = Math.round(w) + 'px';
      return { width: px, minWidth: px, maxWidth: px };
    }

    /**
     * @param {number} colIndex
     * @param {MouseEvent} e
     * @param {() => void=} duringMove
     */
    function startResize(colIndex, e, duringMove) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      var idx = Number(colIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= n) return;
      var startX = e.clientX;
      var th = e.target && typeof e.target.closest === 'function' ? e.target.closest('th') : null;
      var startWidth = widths[idx] != null && Number.isFinite(widths[idx]) ? widths[idx] : null;
      if (startWidth == null && th) {
        var r = th.getBoundingClientRect();
        startWidth = r.width || th.offsetWidth;
      }
      if (startWidth == null || !Number.isFinite(startWidth)) startWidth = 100;

      function onMove(ev) {
        var nw = Math.max(MIN_W, startWidth + ev.clientX - startX);
        widths[idx] = nw;
        if (typeof duringMove === 'function') duringMove();
      }
      function onUp() {
        global.removeEventListener('mousemove', onMove);
        global.removeEventListener('mouseup', onUp);
      }
      global.addEventListener('mousemove', onMove);
      global.addEventListener('mouseup', onUp);
    }

    return { widths: widths, setWidths: setWidths, startResize: startResize, widthStyleFor: widthStyleFor };
  }

  /**
   * @param {HTMLTableElement|null} tableEl
   * @param {{ showHint?: boolean, minWidth?: number }=} options
   * @returns {() => void} dispose
   */
  function bindToTable(tableEl, options) {
    var opt = options || {};
    var showHint = opt.showHint !== false;
    var minW = opt.minWidth != null && Number.isFinite(opt.minWidth) ? Math.max(20, opt.minWidth) : MIN_W;
    if (!tableEl || tableEl.tagName !== 'TABLE') return function noop() {};
    if (typeof tableEl.__erpColResizeDispose === 'function') {
      try {
        tableEl.__erpColResizeDispose();
      } catch (_) {
        /* ignore */
      }
      tableEl.__erpColResizeDispose = null;
    }
    tableEl.setAttribute('data-erp-col-resize', '1');

    var thRow = tableEl.querySelector('thead tr');
    if (!thRow) {
      tableEl.removeAttribute('data-erp-col-resize');
      return function noop() {};
    }
    var ths = Array.prototype.slice.call(thRow.querySelectorAll('th'));
    var n = ths.length;
    if (!n) {
      tableEl.removeAttribute('data-erp-col-resize');
      return function noop() {};
    }

    tableEl.style.tableLayout = 'fixed';
    var measured = ths.map(function (th) {
      var r = th.getBoundingClientRect();
      return Math.max(minW, Math.round(r.width || th.offsetWidth || 80));
    });
    var ctrl = useColumnResize(n, measured);

    function applyCellStyles() {
      ths.forEach(function (th, i) {
        var st = ctrl.widthStyleFor(i);
        if (st.width) {
          th.style.width = st.width;
          th.style.minWidth = st.minWidth;
          th.style.maxWidth = st.maxWidth;
        }
      });
      var bodyRows = tableEl.querySelectorAll('tbody tr');
      for (var r = 0; r < bodyRows.length; r++) {
        var cells = bodyRows[r].querySelectorAll('td');
        for (var c = 0; c < cells.length && c < n; c++) {
          var st2 = ctrl.widthStyleFor(c);
          if (st2.width) {
            cells[c].style.width = st2.width;
            cells[c].style.minWidth = st2.minWidth;
            cells[c].style.maxWidth = st2.maxWidth;
          }
        }
      }
    }

    applyCellStyles();

    var cleaners = [];
    ths.forEach(function (th, i) {
      th.classList.add('erp-col-resize-th');
      var hit = document.createElement('span');
      hit.className = 'erp-col-resize-hit';
      hit.setAttribute('aria-hidden', 'true');
      hit.title = 'Drag to resize column';
      function down(ev) {
        ctrl.startResize(i, ev, applyCellStyles);
      }
      hit.addEventListener('mousedown', down);
      th.appendChild(hit);
      cleaners.push(function () {
        hit.removeEventListener('mousedown', down);
      });
    });

    var hintEl = null;
    if (showHint) {
      hintEl = document.createElement('div');
      hintEl.className = 'mini-note erp-col-resize-hint';
      hintEl.textContent = 'Drag column edges to resize';
      tableEl.insertAdjacentElement('afterend', hintEl);
    }

    var disposeFn = function dispose() {
      cleaners.forEach(function (fn) {
        fn();
      });
      if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
      ths.forEach(function (th) {
        th.classList.remove('erp-col-resize-th');
        var hits = th.querySelectorAll('.erp-col-resize-hit');
        for (var h = 0; h < hits.length; h++) hits[h].remove();
        th.style.width = '';
        th.style.minWidth = '';
        th.style.maxWidth = '';
      });
      var allTd = tableEl.querySelectorAll('tbody td');
      for (var t = 0; t < allTd.length; t++) {
        allTd[t].style.width = '';
        allTd[t].style.minWidth = '';
        allTd[t].style.maxWidth = '';
      }
      tableEl.style.tableLayout = '';
      tableEl.removeAttribute('data-erp-col-resize');
      tableEl.__erpColResizeDispose = null;
    };
    tableEl.__erpColResizeDispose = disposeFn;
    return disposeFn;
  }

  /**
   * Wire all accounting-style tables under root (idempotent per table).
   * @param {ParentNode|null} root
   */
  function wireTablesInRoot(root) {
    if (!root || !root.querySelectorAll) return;
    var sel = 'table.acct-board-mini-table, table.erp-dedupe-table';
    root.querySelectorAll(sel).forEach(function (tbl) {
      if (!tbl.querySelector('thead th')) return;
      bindToTable(tbl, { showHint: true });
    });
  }

  global.ErpColumnResize = {
    bindToTable: bindToTable,
    useColumnResize: useColumnResize,
    wireTablesInRoot: wireTablesInRoot
  };
})(typeof window !== 'undefined' ? window : globalThis);
