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

async function schemaMigrationsTableExists() {
  const { rows } = await dbQuery(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'schema_migrations'
    ) AS ok
  `);
  return !!rows[0]?.ok;
}

async function appliedFilenames() {
  const ok = await schemaMigrationsTableExists();
  if (!ok) return new Set();
  const { rows } = await dbQuery('SELECT filename FROM schema_migrations');
  return new Set((rows || []).map((r) => r.filename));
}

try {
  let applied = await appliedFilenames();

  for (const name of files) {
    if (applied.has(name)) {
      console.log('Skip (already applied) —', name);
      continue;
    }
    const sql = readFileSync(path.join(migrationsDir, name), 'utf8');
    await dbQuery(sql);
    console.log('OK —', name);
    applied = await appliedFilenames();
  }
  console.log('Migrations up to date.');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await pool.end();
}
