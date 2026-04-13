import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';
import { getPool, dbQuery } from '../lib/db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');

const pool = getPool();
if (!pool) {
  console.error('DATABASE_URL is missing.');
  process.exit(1);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

try {
  for (const name of files) {
    const sql = readFileSync(path.join(migrationsDir, name), 'utf8');
    await dbQuery(sql);
    console.log('OK —', name);
  }
  console.log('All migrations finished.');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await pool.end();
}
