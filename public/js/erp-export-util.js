/**
 * Shared client-side report export (CSV / Excel via SheetJS CDN / PDF via server).
 * Requires: global XLSX (cdn.jsdelivr.net) for Excel; authFetchHeaders() optional.
 */
(function () {
  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function stamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  }
  /** Matches server `formatIsoDateShortPlain` / `printDocuments.js` (used when global not on page). */
  function formatIsoDateShortPlainInline(iso) {
    if (typeof window.formatIsoDateShortPlain === 'function') return window.formatIsoDateShortPlain(iso);
    const raw = String(iso == null ? '' : iso).trim();
    const s = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return raw || '';
    try {
      const d = new Date(s + 'T12:00:00');
      if (!Number.isFinite(d.getTime())) return s;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
      return s;
    }
  }

  /** ISO / US-style calendar values → short locale label for CSV & Excel; pass through otherwise. */
  function formatExportCell(value) {
    if (value == null || value === '') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return value;
    const raw = String(value).trim();
    if (!raw) return '';
    const isoM = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T|[\s+-]|$)/);
    if (isoM) return formatIsoDateShortPlainInline(isoM[1]);
    const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s|$)/);
    if (us) {
      const mo = parseInt(us[1], 10);
      const da = parseInt(us[2], 10);
      let yr = parseInt(us[3], 10);
      if (yr < 100) yr += yr >= 70 ? 1900 : 2000;
      const u = new Date(Date.UTC(yr, mo - 1, da));
      if (Number.isNaN(u.getTime())) return raw;
      if (u.getUTCFullYear() !== yr || u.getUTCMonth() !== mo - 1 || u.getUTCDate() !== da) return raw;
      return formatIsoDateShortPlainInline(u.toISOString().slice(0, 10));
    }
    return raw;
  }

  function generatedLabel() {
    const iso = new Date().toISOString();
    const datePart = formatIsoDateShortPlainInline(iso);
    const t = new Date(iso);
    const tm =
      typeof t.toLocaleTimeString === 'function'
        ? t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : '';
    if (datePart && tm) return `${datePart} · ${tm}`;
    return datePart || iso;
  }
  function escCsv(v) {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function smartReportBasename(reportData, options, ext) {
    const title = String(reportData.title || options.filename || 'Report');
    const filt = options.filtersApplied || reportData.filters || {};
    if (typeof window.generateFilename === 'function') {
      try {
        return window.generateFilename('report', { reportName: title, unitFilter: filt.unit, startDate: filt.startDate, endDate: filt.endDate }, ext);
      } catch (_) {}
    }
    return `${(options.filename || title).replace(/[^\w.-]+/g, '_')}.${ext}`;
  }

  async function exportPdfServer(reportData, options) {
    const headers = { 'Content-Type': 'application/json', ...(typeof authFetchHeaders === 'function' ? authFetchHeaders() : {}) };
    const title = String(reportData.title || options.filename || 'Report');
    const r = await fetch('/api/reports/export/pdf', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        reportType: title,
        companyName: options.companyName || 'IH 35 Transportation LLC',
        filters: options.filtersApplied || reportData.filters || {},
        data: reportData
      })
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = smartReportBasename(reportData, options, 'pdf');
    a.click();
    URL.revokeObjectURL(url);
  }

  window.ErpExportUtil = {
    /**
     * @param {'excel'|'csv'|'pdf'} format
     * @param {{ title?: string, columns?: {key:string,label:string,type?:string}[], rows?: object[], totals?: object, filters?: object }} reportData
     */
    async exportReport(format, reportData, options = {}) {
      const fmt = String(format || 'csv').toLowerCase();
      const title = String(reportData.title || options.filename || 'Report');
      const columns = Array.isArray(reportData.columns) ? reportData.columns : [];
      const rows = Array.isArray(reportData.rows) ? reportData.rows : [];
      const keys = columns.map(c => c.key || c.label).filter(Boolean);
      const labels = columns.map(c => String(c.label || c.key || ''));
      const baseName = (options.filename || title).replace(/[^\w.-]+/g, '_');
      const csvName =
        typeof window.generateFilename === 'function'
          ? window.generateFilename('report', { reportName: title, ...(options.filtersApplied || reportData.filters || {}) }, 'csv')
          : `${baseName}_${stamp()}.csv`;
      const xlsxName =
        typeof window.generateFilename === 'function'
          ? window.generateFilename('report', { reportName: title, ...(options.filtersApplied || reportData.filters || {}) }, 'xlsx')
          : `${baseName}_${stamp()}.xlsx`;

      if (fmt === 'pdf') {
        await exportPdfServer({ ...reportData, title }, options);
        return;
      }

      if (fmt === 'csv') {
        const lines = [labels.map(escCsv).join(',')];
        for (const row of rows) lines.push(keys.map(k => escCsv(formatExportCell(row[k]))).join(','));
        if (reportData.totals && Object.keys(reportData.totals).length) {
          lines.push(
            keys.map((k, i) => (i === 0 ? 'Totals' : escCsv(formatExportCell(reportData.totals[k] ?? '')))).join(',')
          );
        }
        const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = csvName;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      if (fmt === 'excel' || fmt === 'xlsx') {
        if (!window.XLSX) throw new Error('Excel export requires the XLSX script (see maintenance.html).');
        const XLSX = window.XLSX;
        const wb = XLSX.utils.book_new();
        const grouped = Array.isArray(reportData.groupedSections) ? reportData.groupedSections : null;
        if (grouped && grouped.length) {
          for (const sec of grouped) {
            const secTitle = String(sec.title || sec.key || 'Section').slice(0, 28) || 'Section';
            const scols = sec.columns || columns;
            const skeys = scols.map(c => c.key || c.label).filter(Boolean);
            const slabels = scols.map(c => String(c.label || c.key || ''));
            const srows = Array.isArray(sec.rows) ? sec.rows : [];
            const secHdr = [
              [options.companyName || 'IH 35 Transportation LLC'],
              [title + ' — ' + secTitle],
              [`Date range: ${options.dateRange || ''}`],
              [`Filters: ${JSON.stringify(options.filtersApplied || reportData.filters || {})}`],
              [`Generated: ${generatedLabel()}`],
              [],
              slabels
            ];
            const secDataRows = srows.map(row => skeys.map(k => formatExportCell(row[k])));
            const aoa = secHdr.concat(secDataRows);
            const sheetName = secTitle.replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet';
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
          }
        } else {
          const hdr = [
            [options.companyName || 'IH 35 Transportation LLC'],
            [title],
            [`Date range: ${options.dateRange || ''}`],
            [`Filters: ${JSON.stringify(options.filtersApplied || reportData.filters || {})}`],
            [`Generated: ${generatedLabel()}`],
            [],
            labels
          ];
          const dataRows = rows.map(row => keys.map(k => formatExportCell(row[k])));
          const totalRow = keys.map((k, i) => (i === 0 ? 'Totals' : formatExportCell(reportData.totals?.[k] ?? '')));
          const aoa = hdr.concat(dataRows).concat(reportData.totals && Object.keys(reportData.totals).length ? [totalRow] : []);
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          try {
            ws['!views'] = [{ state: 'frozen', ySplit: 6, topLeftCell: 'A7', activeCell: 'A7' }];
          } catch (_) {}
          XLSX.utils.book_append_sheet(wb, ws, 'Report data');
        }
        const totAoa = [['Metric', 'Value']].concat(
          Object.entries(reportData.totals || {}).map(([k, v]) => [k, formatExportCell(v)])
        );
        if (reportData.totals && Object.keys(reportData.totals).length) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(totAoa), 'Totals summary');
        }
        const filt = Object.entries(options.filtersApplied || reportData.filters || {}).map(([k, v]) => [
          k,
          formatExportCell(v)
        ]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Filter', 'Value']].concat(filt)), 'Filters applied');
        XLSX.writeFile(wb, xlsxName);
        return;
      }

      throw new Error('Unsupported export format: ' + fmt);
    }
  };
})();
