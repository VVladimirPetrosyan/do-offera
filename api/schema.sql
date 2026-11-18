-- do-offera cloud draft: one table, keyed by a random 16-hex device code.
-- Run once on a fresh Neon database (Neon SQL editor or psql).
CREATE TABLE IF NOT EXISTS drafts (
  device_code TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
