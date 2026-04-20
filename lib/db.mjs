import pg from 'pg';

let _warnedExampleDatabaseUrl = false;

function connectionString() {
  const raw = process.env.DATABASE_URL?.trim() || '';
  if (!raw) return '';
  // `.env.example` uses literal `...@HOST:5432/...` — not a real hostname (ENOTFOUND HOST).
  if (raw.includes('@HOST:') || raw.includes('@host:')) {
    if (!_warnedExampleDatabaseUrl) {
      _warnedExampleDatabaseUrl = true;
      console.warn(
        '[db] DATABASE_URL still uses the example host "HOST" from .env.example. ' +
          'Replace USER/PASSWORD/HOST/DATABASE with your real Postgres URL, or delete DATABASE_URL to run without Postgres.'
      );
    }
    return '';
  }
  return raw;
}

function sslOption(url) {
  if (!url) return undefined;
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  if (process.env.DATABASE_SSL === 'false') return false;
  return { rejectUnauthorized: false };
}

let _pool = null;

export function getPool() {
  const url = connectionString();
  if (!url) return null;
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: url,
      ssl: sslOption(url),
      max: Number(process.env.PG_POOL_MAX || 10),
    });
  }
  return _pool;
}

export async function dbQuery(text, params) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL is not set');
  return p.query(text, params);
}
