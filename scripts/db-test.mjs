import 'dotenv/config';
import { pool, dbQuery } from '../lib/db.mjs';

if (!pool) {
  console.error('DATABASE_URL is missing. Add it to .env (see .env.example).');
  process.exit(1);
}

try {
  const { rows } = await dbQuery('SELECT now() AS server_time, current_database() AS database');
  console.log('OK — connected:', rows[0]);

  const tables = await dbQuery(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  console.log('Public tables:', tables.rows.map((r) => r.tablename).join(', ') || '(none)');
} catch (err) {
  console.error('Connection failed:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
