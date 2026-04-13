import fs from 'fs';
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
