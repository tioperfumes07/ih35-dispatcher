/**
 * Fuel / DEF transaction form — type contract for the vanilla ERP UI.
 * Runtime DOM and behavior: `public/js/erp-fuel-transaction-form.js` + `#erpFuelManualDocShellPanel` in `public/maintenance.html`.
 */
export type FuelTransactionType = 'fuel-bill' | 'fuel-expense' | 'def-bill' | 'fuel-def-combined';

export interface FuelTransactionFormProps {
  transactionType: FuelTransactionType;
}
