/**
 * Fuel / DEF transaction UI — dual implementation (same behavior contract):
 *
 * 1. **Production ERP (vanilla)** — `public/maintenance.html` `#erpFuelManualDocShellPanel` +
 *    `public/js/erp-fuel-transaction-form.js` (`erpApplyFuelTransactionType`, vendor address hydrate, etc.).
 * 2. **Fleet reports hub (React)** — full modal shell:
 *    `apps/fleet-reports-hub/src/components/fuel/FuelTransactionForm.tsx`
 *
 * Theme: use existing CSS variables only; do not introduce new palette tokens.
 *
 * This file keeps the shared TypeScript contract at repo root for imports/docs.
 */
export type FuelTransactionType = 'fuel-bill' | 'fuel-expense' | 'def-bill' | 'fuel-def-combined';

export type FuelTransactionFormProps = {
  transactionType: FuelTransactionType;
};
