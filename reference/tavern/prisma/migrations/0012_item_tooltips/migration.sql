-- Store raw AscensionScraper item tooltip payloads without mutating game tables.

CREATE SCHEMA IF NOT EXISTS app;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS app.item_tooltips (
  item_id integer PRIMARY KEY,
  tooltip_text text NOT NULL,
  tooltip_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  tooltip_captured boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'ascension-scraper',
  captured_at bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS item_tooltips_text_trgm_idx
  ON app.item_tooltips USING gin (tooltip_text gin_trgm_ops);
