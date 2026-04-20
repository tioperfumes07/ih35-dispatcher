/**
 * Flatten QuickBooks Online report JSON (Rows/ColData) into columns + rows for the standard report envelope.
 */

function walkRows(rowNode, out) {
  if (!rowNode) return;
  const list = Array.isArray(rowNode) ? rowNode : [rowNode];
  for (const row of list) {
    if (row.ColData) {
      const cds = Array.isArray(row.ColData) ? row.ColData : [row.ColData];
      const obj = {};
      cds.forEach((cd, i) => {
        obj[`c${i}`] = cd?.value ?? '';
      });
      out.push(obj);
    }
    if (row.Rows && row.Rows.Row) walkRows(row.Rows.Row, out);
  }
}

export function flattenQboReportToStandard(report, reportName) {
  const rows = [];
  if (report?.Rows?.Row) walkRows(report.Rows.Row, rows);
  const ncols = rows.reduce((m, r) => Math.max(m, Object.keys(r).filter(k => k.startsWith('c')).length), 0);
  const cols = report?.Columns?.Column;
  const colTitles = Array.isArray(cols) ? cols.map((c, i) => String(c?.ColTitle || c?.MetaData?.[0]?.Value || `Column ${i + 1}`)) : [];
  const columns = [];
  for (let i = 0; i < Math.max(ncols, colTitles.length || 0, 1); i++) {
    const key = `c${i}`;
    columns.push({ key, label: colTitles[i] || `Column ${i + 1}`, type: 'string' });
  }
  if (!columns.length) columns.push({ key: 'c0', label: 'Data', type: 'string' });
  return {
    ok: true,
    title: `QuickBooks — ${reportName}`,
    columns,
    rows,
    totals: {},
    meta: { totalRows: rows.length, hasChart: false, source: 'qbo' }
  };
}
