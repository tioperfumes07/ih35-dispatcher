
import path from 'path';

/** Persist full ERP document (integrity alerts, thresholds, records, etc.). */
export function writeFullErpJson(erp) {
  const data = erp && typeof erp === 'object' ? erp : {};
  fs.mkdirSync(path.dirname(ERP_FILE), { recursive: true });
  fs.writeFileSync(ERP_FILE, JSON.stringify(data, null, 2));
}