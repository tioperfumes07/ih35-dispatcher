import fs from 'fs';
import { ERP_FILE } from './data-dirs.mjs';

export function readMaintenanceJson() {
  if (!fs.existsSync(ERP_FILE)) {
    return { records: [], apTransactions: [], workOrders: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ERP_FILE, 'utf8'));
    return {
      records: Array.isArray(raw.records) ? raw.records : [],
      apTransactions: Array.isArray(raw.apTransactions) ? raw.apTransactions : [],
      workOrders: Array.isArray(raw.workOrders) ? raw.workOrders : []
    };
  } catch {
    return { records: [], apTransactions: [], workOrders: [] };
  }
}
