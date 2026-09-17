-- Precomputed list totals so category pages only fetch their current page.

DROP MATERIALIZED VIEW IF EXISTS app.game_entity_counts CASCADE;

CREATE MATERIALIZED VIEW app.game_entity_counts AS
SELECT kind, ''::text AS filter_key, COUNT(*)::integer AS total
FROM app.game_entity_summary
WHERE kind <> 'classes' OR id >= 12
GROUP BY kind

UNION ALL
SELECT 'classes', 'custom', COUNT(*)::integer
FROM app.game_entity_summary
WHERE kind = 'classes' AND id >= 12

UNION ALL
SELECT 'classes', 'normal', COUNT(*)::integer
FROM app.game_entity_summary
WHERE kind = 'classes' AND id < 12 AND id <> 10

UNION ALL
SELECT 'items', filter_key, COUNT(*)::integer
FROM (
  SELECT CASE category
    WHEN '0' THEN 'consumables'
    WHEN '1' THEN 'containers'
    WHEN '2' THEN 'weapons'
    WHEN '3' THEN 'gems'
    WHEN '4' THEN 'armor'
    WHEN '7' THEN 'trade-goods'
    WHEN '12' THEN 'quest-items'
    WHEN '16' THEN 'glyphs'
    ELSE '__other__'
  END AS filter_key
  FROM app.game_entity_summary
  WHERE kind = 'items'
) item_counts
GROUP BY filter_key

UNION ALL
SELECT 'skills', filter_key, COUNT(*)::integer
FROM (
  SELECT CASE category
    WHEN '6' THEN 'proficiencies'
    WHEN '7' THEN 'specializations'
    WHEN '8' THEN 'armor'
    WHEN '9' THEN 'secondary'
    WHEN '10' THEN 'languages'
    ELSE '__other__'
  END AS filter_key
  FROM app.game_entity_summary
  WHERE kind = 'skills'
    AND (
      category <> '7'
      OR (name <> '' AND name NOT ILIKE '!%' AND name NOT ILIKE 'Pet -%')
    )
) skill_counts
GROUP BY filter_key

UNION ALL
SELECT 'spells', 'active', COUNT(*)::integer
FROM app.game_entity_summary
WHERE kind = 'spells'
  AND (
    COALESCE(owner_class_ids, '{}'::integer[]) = '{}'::integer[]
    OR NOT (owner_class_ids && ARRAY[1,2,3,4,5,6,7,8,9,10,11])
    OR owner_class_ids && ARRAY[12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]
  )
  AND ((COALESCE((metadata->>'attributes0')::integer, 0) & 64) = 0)

UNION ALL
SELECT 'spells', 'passive', COUNT(*)::integer
FROM app.game_entity_summary
WHERE kind = 'spells'
  AND (
    COALESCE(owner_class_ids, '{}'::integer[]) = '{}'::integer[]
    OR NOT (owner_class_ids && ARRAY[1,2,3,4,5,6,7,8,9,10,11])
    OR owner_class_ids && ARRAY[12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]
  )
  AND ((COALESCE((metadata->>'attributes0')::integer, 0) & 64) <> 0)

UNION ALL
SELECT 'spells', school.filter_key, COUNT(*)::integer
FROM app.game_entity_summary summary
JOIN (VALUES
  ('school-physical'::text, 1),
  ('school-holy', 2),
  ('school-fire', 4),
  ('school-nature', 8),
  ('school-frost', 16),
  ('school-shadow', 32),
  ('school-arcane', 64)
) AS school(filter_key, mask)
  ON ((COALESCE((summary.metadata->>'schoolMask')::integer, 0) & school.mask) <> 0)
WHERE summary.kind = 'spells'
  AND (
    COALESCE(summary.owner_class_ids, '{}'::integer[]) = '{}'::integer[]
    OR NOT (summary.owner_class_ids && ARRAY[1,2,3,4,5,6,7,8,9,10,11])
    OR summary.owner_class_ids && ARRAY[12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]
  )
GROUP BY school.filter_key

UNION ALL
SELECT 'spells', 'class-' || class_id::text, COUNT(*)::integer
FROM app.game_entity_summary summary
JOIN generate_series(12, 32) class_id ON summary.owner_class_ids @> ARRAY[class_id]
WHERE summary.kind = 'spells'
GROUP BY class_id;

CREATE UNIQUE INDEX game_entity_counts_kind_filter_idx
  ON app.game_entity_counts (kind, filter_key);

CREATE OR REPLACE FUNCTION app.refresh_game_read_models()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW app.resolved_class_specs;
  REFRESH MATERIALIZED VIEW app.item_spell_links;
  REFRESH MATERIALIZED VIEW app.itemset_spell_links;
  REFRESH MATERIALIZED VIEW app.enchantment_spell_links;
  REFRESH MATERIALIZED VIEW app.spell_trigger_links;
  REFRESH MATERIALIZED VIEW app.spell_teach_links;
  REFRESH MATERIALIZED VIEW app.spell_created_item_links;
  REFRESH MATERIALIZED VIEW app.game_entity_summary;
  REFRESH MATERIALIZED VIEW app.game_entity_counts;
  ANALYZE app.resolved_class_specs;
  ANALYZE app.item_spell_links;
  ANALYZE app.itemset_spell_links;
  ANALYZE app.enchantment_spell_links;
  ANALYZE app.spell_trigger_links;
  ANALYZE app.spell_teach_links;
  ANALYZE app.spell_created_item_links;
  ANALYZE app.game_entity_summary;
  ANALYZE app.game_entity_counts;
END;
$$;

CREATE OR REPLACE FUNCTION app.list_game_entities(
  p_kind text,
  p_query text DEFAULT '',
  p_category text DEFAULT '',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_sort text DEFAULT 'name',
  p_direction text DEFAULT 'asc'
)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH params AS (
    SELECT
      COALESCE(NULLIF(trim(p_query), ''), '') AS query,
      COALESCE(NULLIF(trim(p_category), ''), '') AS category,
      GREATEST(COALESCE(p_page, 1), 1) AS page,
      GREATEST(1, LEAST(COALESCE(p_page_size, 25), 100)) AS page_size,
      CASE WHEN p_sort = 'id' THEN 'id' ELSE 'name' END AS sort,
      CASE WHEN p_direction = 'desc' THEN 'desc' ELSE 'asc' END AS direction
  ),
  page_rows AS (
    SELECT summary.*
    FROM app.game_entity_summary summary
    CROSS JOIN params
    WHERE summary.kind = p_kind
      AND (
        params.query = ''
        OR summary.name ILIKE '%' || params.query || '%'
        OR summary.description ILIKE '%' || params.query || '%'
      )
      AND (
        p_kind <> 'items'
        OR params.category = ''
        OR summary.category = CASE params.category
          WHEN 'consumables' THEN '0'
          WHEN 'containers' THEN '1'
          WHEN 'weapons' THEN '2'
          WHEN 'gems' THEN '3'
          WHEN 'armor' THEN '4'
          WHEN 'trade-goods' THEN '7'
          WHEN 'quest-items' THEN '12'
          WHEN 'glyphs' THEN '16'
          ELSE summary.category
        END
      )
      AND (
        p_kind <> 'skills'
        OR params.category = ''
        OR (
          summary.category = CASE params.category
            WHEN 'proficiencies' THEN '6'
            WHEN 'specializations' THEN '7'
            WHEN 'armor' THEN '8'
            WHEN 'secondary' THEN '9'
            WHEN 'languages' THEN '10'
            ELSE summary.category
          END
          AND (
            params.category <> 'specializations'
            OR (
              summary.name <> ''
              AND summary.name NOT ILIKE '!%'
              AND summary.name NOT ILIKE 'Pet -%'
            )
          )
        )
      )
      AND (
        p_kind <> 'classes'
        OR (
          CASE params.category
            WHEN 'normal' THEN summary.id < 12 AND summary.id <> 10
            WHEN 'custom' THEN summary.id >= 12
            ELSE summary.id >= 12
          END
        )
      )
      AND (
        p_kind <> 'spells'
        OR (
          (
            COALESCE(summary.owner_class_ids, '{}'::integer[]) = '{}'::integer[]
            OR NOT (summary.owner_class_ids && ARRAY[1,2,3,4,5,6,7,8,9,10,11])
            OR summary.owner_class_ids && ARRAY[12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]
          )
          AND (
            params.category = ''
            OR (params.category = 'passive' AND ((COALESCE((summary.metadata->>'attributes0')::integer, 0) & 64) <> 0))
            OR (params.category = 'active' AND ((COALESCE((summary.metadata->>'attributes0')::integer, 0) & 64) = 0))
            OR (params.category = 'school-physical' AND ((COALESCE((summary.metadata->>'schoolMask')::integer, 0) & 1) <> 0))
            OR (params.category = 'school-holy' AND ((COALESCE((summary.metadata->>'schoolMask')::integer, 0) & 2) <> 0))
            OR (params.category = 'school-fire' AND ((COALESCE((summary.metadata->>'schoolMask')::integer, 0) & 4) <> 0))
            OR (params.category = 'school-nature' AND ((COALESCE((summary.metadata->>'schoolMask')::integer, 0) & 8) <> 0))
            OR (params.category = 'school-frost' AND ((COALESCE((summary.metadata->>'schoolMask')::integer, 0) & 16) <> 0))
            OR (params.category = 'school-shadow' AND ((COALESCE((summary.metadata->>'schoolMask')::integer, 0) & 32) <> 0))
            OR (params.category = 'school-arcane' AND ((COALESCE((summary.metadata->>'schoolMask')::integer, 0) & 64) <> 0))
            OR (
              params.category ~ '^class-[0-9]+$'
              AND substring(params.category from 7)::integer >= 12
              AND summary.owner_class_ids @> ARRAY[substring(params.category from 7)::integer]
            )
          )
        )
      )
    ORDER BY
      CASE WHEN (SELECT sort FROM params) = 'id' AND (SELECT direction FROM params) = 'asc' THEN summary.id END ASC,
      CASE WHEN (SELECT sort FROM params) = 'id' AND (SELECT direction FROM params) = 'desc' THEN summary.id END DESC,
      CASE WHEN (SELECT sort FROM params) = 'name' AND (SELECT direction FROM params) = 'asc' THEN lower(summary.name) END ASC,
      CASE WHEN (SELECT sort FROM params) = 'name' AND (SELECT direction FROM params) = 'desc' THEN lower(summary.name) END DESC,
      summary.id ASC
    LIMIT (SELECT page_size FROM params)
    OFFSET ((SELECT page FROM params) - 1) * (SELECT page_size FROM params)
  ),
  precomputed_total AS (
    SELECT counts.total
    FROM app.game_entity_counts counts
    CROSS JOIN params
    WHERE params.query = ''
      AND counts.kind = p_kind
      AND counts.filter_key = params.category
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'items',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'kind', kind,
            'id', id,
            'name', name,
            'description', description,
            'category', category,
            'icon', icon,
            'sourceTable', source_table,
            'metadata', metadata
          )
        )
        FROM page_rows
      ),
      '[]'::jsonb
    ),
    'total',
      COALESCE(
        (SELECT total FROM precomputed_total),
        ((SELECT page FROM params) - 1) * (SELECT page_size FROM params)
          + (SELECT COUNT(*) FROM page_rows)
          + CASE WHEN (SELECT COUNT(*) FROM page_rows) = (SELECT page_size FROM params) THEN 1 ELSE 0 END
      ),
    'page', (SELECT page FROM params),
    'pageSize', (SELECT page_size FROM params)
  );
$$;

COMMENT ON MATERIALIZED VIEW app.game_entity_counts IS
  'Precomputed totals for common list filters; refreshed with app.refresh_game_read_models().';
