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
  function generatedLabel() {
    const iso = new Date().toISOString();
    if (typeof window.formatIsoDateShortPlain === 'function') {
      const datePart = window.formatIsoDateShortPlain(iso);
      const t = new Date(iso);
      const tm =
        typeof t.toLocaleTimeString === 'function'
          ? t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
          : '';
      return tm ? `${datePart} · ${tm}` : datePart;
    }
    return iso;
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
        for (const row of rows) lines.push(keys.map(k => escCsv(row[k])).join(','));
        if (reportData.totals && Object.keys(reportData.totals).length) {
          lines.push(keys.map((k, i) => (i === 0 ? 'Totals' : escCsv(reportData.totals[k] ?? ''))).join(','));
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
        const hdr = [
          [options.companyName || 'IH 35 Transportation LLC'],
          [title],
          [`Date range: ${options.dateRange || ''}`],
          [`Filters: ${JSON.stringify(options.filtersApplied || reportData.filters || {})}`],
          [`Generated: ${generatedLabel()}`],
          [],
          labels
        ];
        const dataRows = rows.map(row => keys.map(k => row[k]));
        const totalRow = keys.map((k, i) => (i === 0 ? 'Totals' : reportData.totals?.[k] ?? ''));
        const aoa = hdr.concat(dataRows).concat(reportData.totals && Object.keys(reportData.totals).length ? [totalRow] : []);
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        try {
          ws['!views'] = [{ state: 'frozen', ySplit: 6, topLeftCell: 'A7', activeCell: 'A7' }];
        } catch (_) {}
        XLSX.utils.book_append_sheet(wb, ws, 'Report data');
        const totAoa = [['Metric', 'Value']].concat(Object.entries(reportData.totals || {}).map(([k, v]) => [k, v]));
        if (reportData.totals && Object.keys(reportData.totals).length) {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(totAoa), 'Totals summary');
        }
        const filt = Object.entries(options.filtersApplied || reportData.filters || {}).map(([k, v]) => [k, v]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Filter', 'Value']].concat(filt)), 'Filters applied');
        XLSX.writeFile(wb, xlsxName);
        return;
      }

      throw new Error('Unsupported export format: ' + fmt);
    }
  };
})();
