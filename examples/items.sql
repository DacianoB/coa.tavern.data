-- Run from repository root: sqlite3 data/game.db < examples/items.sql
-- Open both database files from the SAME release.
ATTACH DATABASE 'data/community-game.db' AS derived;

-- Exact base record, normalized icon and captured tooltip.
SELECT i.id, i.name_loc0, i.quality, i.itemLevel, i.requiredLevel,
       icon.name AS icon_name, tip.tooltip_text, tip.captured_at
FROM aowow_items i
LEFT JOIN aowow_icons icon ON icon.id = i.iconId
LEFT JOIN derived.item_tooltips tip ON tip.item_id = i.id
WHERE i.id = 5016;

-- Parsed effect text is evidence, not an automatically verified spell ID.
SELECT effect_kind, effect_label, effect_text, raw_line
FROM derived.item_tooltip_effects
WHERE item_id = 19019 ORDER BY effect_index;

-- Find existing items without stored tooltip captures.
SELECT i.id, i.name_loc0
FROM aowow_items i
LEFT JOIN derived.item_tooltips tip ON tip.item_id = i.id
WHERE tip.item_id IS NULL
ORDER BY i.id LIMIT 25;

-- Preserve both rows when names look like related item versions.
SELECT * FROM derived.item_versions WHERE item_id = 5016;

-- Catalog source, not an observed loot probability.
SELECT t.module, t.name, e.page_name, e.item_id, e.source_file, e.source_line
FROM derived.atlasloot_entries e
JOIN derived.atlasloot_tables t ON t.id = e.table_id
WHERE e.item_id = 19019;
