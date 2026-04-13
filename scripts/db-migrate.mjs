import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';
import { getPool, dbQuery } from '../lib/db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '..', 'database', 'migrations', '001_init.sql');

const pool = getPool();
if (!pool) {
  console.error('DATABASE_URL is missing.');
  process.exit(1);
}

try {
  const sql = readFileSync(sqlPath, 'utf8');
  await dbQuery(sql);
  console.log('OK — ran database/migrations/001_init.sql (idempotent; safe to run again).');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await pool.end();
}
