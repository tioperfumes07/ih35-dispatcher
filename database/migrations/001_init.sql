-- First-time PostgreSQL setup. Run once against your Render (or local) database.
-- See project instructions: paste in Render SQL shell, or use: npm run db:migrate

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'dispatcher',
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

INSERT INTO schema_migrations (filename) VALUES ('001_init.sql') ON CONFLICT DO NOTHING;
