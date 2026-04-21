
 * Merge audit + skip list only — must succeed before any QBO merge INSERT.
 * Kept separate so a failure in rename/integrity DDL can never block these tables.
const MERGE_AUDIT_DDL = [
  `CREATE UNIQUE INDEX IF NOT EXISTS dedup_skipped_unique_group ON dedup_skipped (record_type, group_signature)`
];
/**
 * Remaining core support DDL (rename, links, integrity, schedules, migrations).
 * Applied best-effort per statement so one failure does not roll back merge_log (already committed).
 */
const OTHER_CORE_DEDUPE_DDL = [
  await runDdlList(MERGE_AUDIT_DDL);

  for (const sql of OTHER_CORE_DEDUPE_DDL) {
    const trimmed = stripLeadingComments(sql);
    if (!trimmed) continue;
    try {
      await dbQuery(trimmed);
    } catch (err) {
      console.error('[db] non-fatal support DDL:', err?.message || err);
    }
  }

  try {
    await seedDefaultSettings();
  } catch (err) {
    console.error('[db] company_settings seed:', err?.message || err);
  }
  const mergeCritical = new Set(['merge_log', 'dedup_skipped']);
  const fatalMissing = missing.filter(n => mergeCritical.has(n));
  const softMissing = missing.filter(n => !mergeCritical.has(n));
  const fleetMissing = softMissing.filter(n => FLEET_CATALOG_TABLE_NAMES.has(n));
  const otherSoft = softMissing.filter(n => !FLEET_CATALOG_TABLE_NAMES.has(n));

  if (otherSoft.length) {
    console.error(
      '[db] Some support tables are missing (QBO merge still works if merge_log exists):',
      otherSoft.join(', ')
  if (fleetMissing.length) {
      '[db] Fleet catalog tables missing:',
      fleetMissing.join(', '),
      '— enable pgcrypto or fix fleet DDL errors above.'
    );
  }
  if (fatalMissing.length) {
    throw new Error(
      `[db] Merge audit tables missing after initialization: ${fatalMissing.join(', ')}. Fix database permissions or errors above.`
    '[db] Core support tables ready (merge_log + dedupe required; rename/integrity/schedules best-effort' +
      (missing.length ? `; still missing: ${missing.join(', ')}` : '; all ten support names present') +
/**
 * Server boot guard: Postgres + IF NOT EXISTS for all app support objects (merge audit first).
 * Idempotent; never drops or ALTERs existing tables.
 */
  console.log('[DB] Checking required tables (Postgres, CREATE IF NOT EXISTS only)…');