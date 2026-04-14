import { getPool, dbQuery } from './db.mjs';

/**
 * Ensures TMS tables have columns from migrations 003–007 when DATABASE_URL is set.
 * Safe to run repeatedly (IF NOT EXISTS).
 */
export async function ensureTmsSchema() {
  const pool = getPool();
  if (!pool) return;

  try {
    const { rows } = await dbQuery(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'loads'
      ) AS ok`
    );
    if (!rows[0]?.ok) {
      console.log('[tms] schema ensure skipped (no public.loads — run npm run db:migrate for TMS)');
      return;
    }
  } catch (err) {
    console.error('[tms] schema ensure (precheck) failed:', err?.message || err);
    return;
  }

  const stmts = [
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_customer_id TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_customer_name TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC(12, 2)`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_driver_vendor_id TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_driver_vendor_name TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_linehaul_item_id TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS invoice_extra_lines JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS qbo_invoice_id TEXT`,
    `ALTER TABLE loads ADD COLUMN IF NOT EXISTS customer_wo_number TEXT`,
    `ALTER TABLE load_stops ADD COLUMN IF NOT EXISTS qbo_item_id TEXT`,
    `ALTER TABLE load_stops ADD COLUMN IF NOT EXISTS qbo_account_id TEXT`,
    `ALTER TABLE load_documents ADD COLUMN IF NOT EXISTS qbo_attachable_id TEXT`,
    `ALTER TABLE load_documents ADD COLUMN IF NOT EXISTS qbo_sync_error TEXT`,
    `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cdl_number TEXT`,
    `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cdl_state TEXT`,
    `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS cdl_expiry DATE`,
    `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS med_cert_expiry DATE`,
    `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hire_date DATE`,
    `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS samsara_driver_id TEXT`,
    `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS compliance_notes TEXT`,
    `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS samsara_vehicle_id TEXT`,
    `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS asset_category TEXT`,
    `ALTER TABLE trailers ADD COLUMN IF NOT EXISTS samsara_vehicle_id TEXT`,
    `ALTER TABLE trailers ADD COLUMN IF NOT EXISTS asset_category TEXT`
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
