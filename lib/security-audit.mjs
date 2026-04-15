import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let auditFilePath = path.join(__dirname, '..', 'data', 'security-audit.log');

export function setSecurityAuditFilePath(p) {
  if (p && typeof p === 'string') auditFilePath = p;
}

function ensureDir() {
  const dir = path.dirname(auditFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Append one JSON line (SOC-style trail for ERP: logins, write actions).
 * Never log secrets, passwords, or full bearer tokens.
 */
export function appendSecurityAudit(entry) {
  try {
    ensureDir();
    const line =
      JSON.stringify({
        at: new Date().toISOString(),
        ...entry
      }) + '\n';
    fs.appendFileSync(auditFilePath, line, { encoding: 'utf8' });
  } catch (e) {
    console.error('[security-audit]', e?.message || e);
  }
}

export function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xf) return xf.slice(0, 64);
  const rip = req.socket?.remoteAddress || req.ip || '';
  return String(rip).slice(0, 64);
}
