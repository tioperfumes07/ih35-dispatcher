import fs from 'fs';
import path from 'path';
import { ERP_FILE } from './data-dirs.mjs';

export function readMaintenanceJson() {
  if (!fs.existsSync(ERP_FILE)) {
    return { records: [], apTransactions: [], workOrders: [], qboCache: { items: [], customers: [] } };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ERP_FILE, 'utf8'));
    return {
      records: Array.isArray(raw.records) ? raw.records : [],
      apTransactions: Array.isArray(raw.apTransactions) ? raw.apTransactions : [],
      workOrders: Array.isArray(raw.workOrders) ? raw.workOrders : [],
      qboCache: raw.qboCache && typeof raw.qboCache === 'object' ? raw.qboCache : { items: [], customers: [] }
    };
  } catch {
    return { records: [], apTransactions: [], workOrders: [], qboCache: { items: [], customers: [] } };
  }
}

/** Full ERP JSON for PDFs and read-only tools (same file as server `readErp`). */
export function readFullErpJson() {
  if (!fs.existsSync(ERP_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ERP_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Persist full ERP document (integrity alerts, thresholds, records, etc.). */
export function writeFullErpJson(erp) {
  const data = erp && typeof erp === 'object' ? erp : {};
  fs.mkdirSync(path.dirname(ERP_FILE), { recursive: true });
  fs.writeFileSync(ERP_FILE, JSON.stringify(data, null, 2));
}
