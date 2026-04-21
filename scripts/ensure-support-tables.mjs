#!/usr/bin/env node
/**
 * One-off: CREATE IF NOT EXISTS for merge_log, dedupe, rename, fleet catalog, etc.
 * Same logic as server boot (`initializeDatabase`). Requires DATABASE_URL.
 *
 * Usage: npm run db:ensure-support
 */
import 'dotenv/config';
import { getPool } from '../lib/db.mjs';
import { ensureAppDatabaseObjects } from '../lib/ensure-app-database-objects.mjs';

const pool = getPool();
if (!pool) {
  console.error('DATABASE_URL is missing.');
  process.exit(1);
}

try {
  await ensureAppDatabaseObjects();
  console.log('Support tables ensured OK.');
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await pool.end();
}
