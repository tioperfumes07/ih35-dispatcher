import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AUTH_SECRET = String(process.env.IH35_AUTH_SECRET || '').trim() || 'ih35-dev-change-me-in-production';

let usersFilePath = path.join(__dirname, '..', 'data', 'app-users.json');

export function setAuthUsersFilePath(p) {
  if (p && typeof p === 'string') usersFilePath = p;
}

function getUsersFile() {
  return usersFilePath;
}

function ensureUsersFile() {
  const fp = getUsersFile();
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, JSON.stringify({ users: [] }, null, 2));
  }
}

export function readUsersStore() {
  ensureUsersFile();
  try {
    const raw = fs.readFileSync(getUsersFile(), 'utf8');
    const j = JSON.parse(raw);
    if (!j || !Array.isArray(j.users)) return { users: [] };
    return j;
  } catch {
    return { users: [] };
  }
}

export function writeUsersStore(store) {
  ensureUsersFile();
  fs.writeFileSync(getUsersFile(), JSON.stringify(store, null, 2));
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const h = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(h, 'hex'));
  } catch {
    return false;
  }
}

export function signSessionToken(payload) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + 14 * 24 * 60 * 60 * 1000 }),
    'utf8'
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const raw = Buffer.from(body, 'base64url').toString('utf8');
    const p = JSON.parse(raw);
    if (p.exp && Number(p.exp) < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function authRequired() {
  if (String(process.env.IH35_REQUIRE_AUTH || '').trim() === '1') return true;
  const st = readUsersStore();
  return Array.isArray(st.users) && st.users.length > 0;
}
