CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.atlasloot_tables (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  expansion TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  type TEXT,
  map TEXT,
  source_file TEXT NOT NULL,
  source_line INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.atlasloot_table_paths (
  id BIGSERIAL PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES app.atlasloot_tables(id) ON DELETE CASCADE,
  expansion TEXT NOT NULL,
  category TEXT NOT NULL,
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS app.atlasloot_entries (
  id BIGSERIAL PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES app.atlasloot_tables(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  page_name TEXT NOT NULL,
  group_index INTEGER NOT NULL,
  group_name TEXT,
  position INTEGER NOT NULL,
  entity_kind TEXT NOT NULL DEFAULT 'items',
  entity_id INTEGER NOT NULL DEFAULT 0,
  item_id INTEGER,
  spell_id INTEGER,
  item_name TEXT,
  icon TEXT,
  ref_loot_entry INTEGER,
  group_id INTEGER,
  min_difficulty TEXT,
  max_difficulty TEXT,
  price TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT NOT NULL,
  source_line INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS atlasloot_tables_module_idx
  ON app.atlasloot_tables (module, sort_order);

CREATE INDEX IF NOT EXISTS atlasloot_table_paths_tree_idx
  ON app.atlasloot_table_paths (expansion, category, section, sort_order);

CREATE INDEX IF NOT EXISTS atlasloot_table_paths_table_idx
  ON app.atlasloot_table_paths (table_id);

CREATE INDEX IF NOT EXISTS atlasloot_entries_table_page_idx
  ON app.atlasloot_entries (table_id, page_index, group_index, position);

CREATE INDEX IF NOT EXISTS atlasloot_entries_item_idx
  ON app.atlasloot_entries (item_id);

CREATE INDEX IF NOT EXISTS atlasloot_entries_entity_idx
  ON app.atlasloot_entries (entity_kind, entity_id);

CREATE INDEX IF NOT EXISTS atlasloot_entries_search_idx
  ON app.atlasloot_entries
  USING gin (to_tsvector('simple', COALESCE(item_name, '') || ' ' || COALESCE(page_name, '') || ' ' || COALESCE(group_name, '')));
