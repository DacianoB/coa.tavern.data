-- Derive item -> item set links from captured in-game tooltip headers.
-- This keeps tooltip-only relationships in the app schema without mutating legacy game tables.

CREATE SCHEMA IF NOT EXISTS app;

DROP MATERIALIZED VIEW IF EXISTS app.itemset_item_links;
DROP MATERIALIZED VIEW IF EXISTS app.item_versions;

CREATE MATERIALIZED VIEW app.item_versions AS
SELECT
  item.id::integer AS item_id,
  item.name_loc0 AS item_name,
  regexp_replace(item.name_loc0, '^(Bloodforged\s+)+', '', 'i') AS base_item_name,
  (item.name_loc0 ~* '^Bloodforged\s+') AS is_bloodforged,
  item."itemLevel" AS item_level,
  item."requiredLevel" AS required_level
FROM game.aowow_items item
WHERE item.name_loc0 <> ''
  AND item.name_loc0 NOT ILIKE '!%';

CREATE UNIQUE INDEX item_versions_item_id_idx
  ON app.item_versions (item_id);

CREATE INDEX item_versions_base_name_idx
  ON app.item_versions (base_item_name, item_level, required_level, item_id);

CREATE MATERIALIZED VIEW app.itemset_item_links AS
SELECT
  itemset.id::integer AS itemset_id,
  tooltip.item_id::integer AS item_id,
  set_match.matches[1] AS set_name,
  regexp_replace(item.name_loc0, '^(Bloodforged\s+)+', '', 'i') AS base_item_name,
  set_match.matches[2]::integer AS equipped_count,
  set_match.matches[3]::integer AS total_count,
  tooltip.captured_at,
  'item_tooltips'::text AS source
FROM app.item_tooltips tooltip
JOIN game.aowow_items item
  ON item.id = tooltip.item_id
CROSS JOIN LATERAL regexp_match(
  tooltip.tooltip_text,
  '^(.+) \(([0-9]+)/([0-9]+)\)$',
  'm'
) AS set_match(matches)
JOIN game.aowow_itemset itemset
  ON lower(itemset.name_loc0) = lower(set_match.matches[1]);

CREATE UNIQUE INDEX itemset_item_links_unique_idx
  ON app.itemset_item_links (itemset_id, item_id);

CREATE INDEX itemset_item_links_item_idx
  ON app.itemset_item_links (item_id, itemset_id);

CREATE INDEX itemset_item_links_name_idx
  ON app.itemset_item_links (lower(set_name), lower(base_item_name), item_id);

COMMENT ON MATERIALIZED VIEW app.itemset_item_links IS
  'Tooltip-derived item set membership links from captured item tooltip set headers. Bloodforged item names are normalized to base_item_name so they behave as item versions, not extra set pieces.';

COMMENT ON MATERIALIZED VIEW app.item_versions IS
  'Item version lookup helper. Bloodforged prefixes are normalized so variants can be loaded by base item name without live expression scans.';
