/**
 * Normalize tabular report payloads to the standard ERP report JSON contract.
 */

function inferType(key) {
  const k = String(key || '').toLowerCase();
  if (k.includes('pct') || k.includes('percent') || k.endsWith('%')) return 'percent';
  if (
    k.includes('amount') ||
    k.includes('total') ||
    k.includes('revenue') ||
    k.includes('cost') ||
    k.includes('dollars') ||
    k.includes('spent') ||
    k.includes('price') ||
    k.includes('damage') ||
    k.includes('repair') ||
    k.includes('gal') ||
    k === 'gross' ||
    k === 'net' ||
    k === 'deductions'
  )
    return 'currency';
  if (k.includes('date') || k === 'month' || k === 'datetime' || k.includes('time')) return 'date';
  if (k.includes('count') || k.includes('hours') || k.includes('miles') || k.includes('gallons') || k.includes('loads'))
    return 'number';
  return 'string';
}

export function wrapStandardReport(raw, { filters = {}, path = '' } = {}) {
  const generatedAt = new Date().toISOString();
  if (!raw || raw.ok === false) {
    return {
      title: raw?.title || 'Report',
      generatedAt,
      filters: { ...filters },
      columns: [],
      rows: [],
      totals: {},
      meta: { totalRows: 0, hasChart: false, chartType: null, error: raw?.error || 'Unknown error', path }
    };
  }
  const columns = (raw.columns || []).map(c => ({
    key: c.key,
    label: c.label || c.key,
    type: c.type || inferType(c.key)
  }));
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const totals = raw.totals && typeof raw.totals === 'object' ? { ...raw.totals } : {};
  const baseMeta = raw.meta && typeof raw.meta === 'object' ? { ...raw.meta } : {};
  const meta = {
    ...baseMeta,
    totalRows: rows.length,
    hasChart: Boolean(baseMeta.hasChart),
    chartType: baseMeta.chartType || null,
    chartXKey: baseMeta.chartXKey || null,
    chartYKey: baseMeta.chartYKey || null,
    chartLabelKey: baseMeta.chartLabelKey || null,
    disclaimer: raw.disclaimer || baseMeta.disclaimer || null,
    positions: baseMeta.positions || null,
    path
  };
  return {
    title: raw.title || 'Report',
    generatedAt,
    filters: { ...filters },
    columns,
    rows,
    totals,
    meta
  };
}
