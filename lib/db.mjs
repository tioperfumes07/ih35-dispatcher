import pg from 'pg';

function connectionString() {
  return process.env.DATABASE_URL?.trim() || '';
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
