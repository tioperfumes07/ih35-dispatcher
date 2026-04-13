import pg from 'pg';

const connectionString = process.env.DATABASE_URL?.trim();

function sslOption(url) {
  if (!url) return undefined;
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  if (process.env.DATABASE_SSL === 'false') return false;
  return { rejectUnauthorized: false };
}

export const pool = connectionString
  ? new pg.Pool({
      connectionString,
      ssl: sslOption(connectionString),
      max: Number(process.env.PG_POOL_MAX || 10),
    })
  : null;

export async function dbQuery(text, params) {
  if (!pool) throw new Error('DATABASE_URL is not set');
  return pool.query(text, params);
}
