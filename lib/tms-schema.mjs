import { getPool, dbQuery } from './db.mjs';

/**
 * Ensures TMS tables have columns from migrations 003–007 when DATABASE_URL is set.
 * Safe to run repeatedly (IF NOT EXISTS).
 */
export async function ensureTmsSchema() {
  const pool = getPool();
  if (!pool) return;

  const stmts = [
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_customer_id TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_customer_name TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC(12, 2)`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_driver_vendor_id TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_driver_vendor_name TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_linehaul_item_id TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS invoice_extra_lines JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE load_stops ADD COLUMN IF NOT EXISTS qbo_item_id TEXT`,
    `ALTER TABLE load_stops ADD COLUMN IF NOT EXISTS qbo_account_id TEXT`
  ];

  try {
    for (const sql of stmts) {
      await dbQuery(sql);
    }
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS load_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        load_id UUID NOT NULL REFERENCES loads (id) ON DELETE CASCADE,
        doc_type TEXT NOT NULL DEFAULT 'other',
        original_name TEXT NOT NULL DEFAULT '',
        stored_path TEXT NOT NULL,
        mime_type TEXT,
        byte_size BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await dbQuery(
      `CREATE INDEX IF NOT EXISTS idx_load_documents_load_id ON load_documents (load_id)`
    );
    console.log('[tms] schema ensure: loads / load_stops / load_documents OK');
  } catch (err) {
    console.error('[tms] schema ensure failed:', err?.message || err);
  }
}
