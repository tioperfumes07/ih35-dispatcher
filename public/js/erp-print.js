/**
 * @deprecated Implementation moved to `/src/utils/printDocuments.js`.
 * maintenance.html loads that file directly. This stub avoids 404s if an old HTML references erp-print.js alone.
 */
(function () {
  if (typeof window.generatePrintWindow === 'function') return;
  console.warn('erp-print.js: load /src/utils/printDocuments.js for print support.');
})();
