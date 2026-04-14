/**
 * Relay → QuickBooks category labels (from QB-Relay Expense Conversion Template, Engine!F).
 * Keep in one module so preview, export, and API stay aligned.
 */

export function relayLineLabel(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'diesel') return 'Diesel';
  if (k === 'def') return 'DEF';
  if (k === 'reefer' || k === 'reefer_2') return 'Reefer';
  if (k === 'def_forecourt') return 'DEF';
  if (k === 'relay_fee') return 'Relay fee';
  return String(kind || 'Fuel');
}

/** Relay export column grouping — matches spreadsheet volume_* / total_price_* headers. */
export function relaySpreadsheetCategory(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'diesel') return 'Diesel — volume diesel / total_price diesel';
  if (k === 'def') return 'DEF — volume def / total_price def';
  if (k === 'reefer') return 'Reefer — volume reefer / total_price reefer';
  if (k === 'reefer_2') return 'Reefer 2 — volume reefer_2 / total_price reefer_2';
  if (k === 'def_forecourt') return 'DEF forecourt — volume def_forecourt / total_price def_forecourt';
  if (k === 'relay_fee') return 'Fee — fee';
  return 'Fuel';
}

/** QuickBooks Item/Category naming (Engine!F formula). */
export function relayQuickBooksCategory({ kind, productsText = '' }) {
  const k = String(kind || '').toLowerCase();
  const products = String(productsText || '');
  const isCatScales = /cat\s*scales?/i.test(products);

  if (isCatScales) {
    if (k === 'relay_fee') return 'Bank Charges:BC-Relay Diesel Code Fee';
    return 'Scale Expense:OTR-Scale Expense';
  }

  if (k === 'def' || k === 'def_forecourt') return 'Fuel Expenses:Fuel-DEF-Diesel Exhaust Fluid';
  if (k === 'diesel') return 'Fuel Expenses:Fuel-Truck Diesel';
  if (k === 'reefer' || k === 'reefer_2') return 'Fuel Expenses:Fuel-Reefer-Diesel';
  if (k === 'relay_fee') return 'Bank Charges:BC-Relay Diesel Code Fee';
  return 'Fuel Expenses:Fuel-Truck Diesel';
}
