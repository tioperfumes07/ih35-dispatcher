import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSIST_DIR = '/var/data';
const LOCAL_DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_DIR = fs.existsSync(PERSIST_DIR) ? PERSIST_DIR : LOCAL_DATA_DIR;
const ERP_FILE = path.join(DATA_DIR, 'maintenance.json');

/** Map QBO customer id → { name, companyName } from cached QuickBooks sync (erp.json). */
export function readQboCustomerLookup() {
  try {
    const raw = JSON.parse(fs.readFileSync(ERP_FILE, 'utf8'));
    const customers = raw?.qboCache?.customers || [];
    const map = new Map();
    for (const c of customers) {
      if (c?.qboId != null) map.set(String(c.qboId), c);
    }
    return map;
  } catch {
    return new Map();
  }
}
