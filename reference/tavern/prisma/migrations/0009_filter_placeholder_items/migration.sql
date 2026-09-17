-- Keep placeholder item names out of list/search/read counts without mutating game.aowow_items.

CREATE OR REPLACE FUNCTION app.is_visible_game_entity(
  p_kind text,
  p_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    p_kind <> 'items'
    OR (
      btrim(COALESCE(p_name, '')) <> ALL (ARRAY[
        '[MISSING ITEM NAME]',
        '***No Name***',
        '***Name Not Available***',
        '****No Name****'
      ])
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          'DNT',
          'DEPRECATED',
          '[DEP]',
          '[UNUSED]'
        ]) hidden_name(fragment)
        WHERE btrim(COALESCE(p_name, '')) ILIKE '%' || hidden_name.fragment || '%'
      )
    );
$$;

COMMENT ON FUNCTION app.is_visible_game_entity(text, text) IS
  'Read-side visibility predicate for game entities; hides placeholder item names while preserving source game tables.';

DROP MATERIALIZED VIEW IF EXISTS app.game_entity_counts CASCADE;

CREATE MATERIALIZED VIEW app.game_entity_counts AS
SELECT kind, ''::text AS filter_key, COUNT(*)::integer AS total
FROM app.game_entity_summary
WHERE app.is_visible_game_entity(kind, name)
  AND (kind <> 'classes' OR id >= 12)
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
    AND app.is_visible_game_entity(kind, name)
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

COMMENT ON MATERIALIZED VIEW app.game_entity_counts IS
  'Precomputed totals for common list filters; refreshed with app.refresh_game_read_models().';

CREATE OR REPLACE FUNCTION app.get_game_summaries(
  p_kind text,
  p_ids integer[],
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  kind text,
  id integer,
  name text,
  description text,
  category text,
  icon text,
  source_table text,
  metadata jsonb
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    summary.kind,
    summary.id,
    summary.name,
    summary.description,
    summary.category,
    summary.icon,
    summary.source_table,
    summary.metadata
  FROM app.game_entity_summary summary
  WHERE summary.kind = p_kind
    AND summary.id = ANY(p_ids)
    AND app.is_visible_game_entity(summary.kind, summary.name)
  ORDER BY lower(summary.name), summary.id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
$$;

CREATE OR REPLACE FUNCTION app.search_game_data(
  p_query text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  kind text,
  id integer,
  name text,
  description text,
  category text,
  icon text,
  source_table text,
  metadata jsonb,
  score double precision
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH input AS (
    SELECT
      trim(COALESCE(p_query, '')) AS q,
      plainto_tsquery('simple', trim(COALESCE(p_query, ''))) AS tsq
  ),
  candidates AS (
    SELECT
      summary.*,
      CASE
        WHEN lower(summary.name) = lower(input.q) THEN 1.0
        WHEN summary.name ILIKE input.q || '%' THEN 0.88
        WHEN to_tsvector('simple', COALESCE(summary.name, '') || ' ' || COALESCE(summary.description, '')) @@ input.tsq
          THEN 0.75 + ts_rank_cd(to_tsvector('simple', COALESCE(summary.name, '') || ' ' || COALESCE(summary.description, '')), input.tsq)::double precision
        WHEN summary.name ILIKE '%' || input.q || '%' THEN 0.65
        ELSE 0.0
      END AS score
    FROM app.game_entity_summary summary
    CROSS JOIN input
    WHERE input.q <> ''
      AND app.is_visible_game_entity(summary.kind, summary.name)
      AND (
        to_tsvector('simple', COALESCE(summary.name, '') || ' ' || COALESCE(summary.description, '')) @@ input.tsq
        OR summary.name ILIKE input.q || '%'
        OR summary.name ILIKE '%' || input.q || '%'
      )
    ORDER BY score DESC, lower(summary.name), summary.id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200))
  )
  SELECT
    candidates.kind,
    candidates.id,
    candidates.name,
    candidates.description,
    candidates.category,
    candidates.icon,
    candidates.source_table,
    candidates.metadata,
    candidates.score
  FROM candidates
  ORDER BY candidates.score DESC, lower(candidates.name), candidates.id;
$$;

CREATE OR REPLACE FUNCTION app.get_entity_stats()
RETURNS TABLE(kind text, total integer)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT summary.kind, COUNT(*)::integer AS total
  FROM app.game_entity_summary summary
  WHERE app.is_visible_game_entity(summary.kind, summary.name)
  GROUP BY summary.kind
  ORDER BY summary.kind;
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
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_query text := COALESCE(NULLIF(trim(p_query), ''), '');
  v_category text := COALESCE(NULLIF(trim(p_category), ''), '');
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_page_size integer := GREATEST(1, LEAST(COALESCE(p_page_size, 25), 100));
  v_offset integer;
  v_where text;
  v_order text;
  v_items jsonb;
  v_total integer;
  v_filter_key text;
  v_item_category text;
  v_class_id integer;
BEGIN
  v_offset := (v_page - 1) * v_page_size;
  v_where := 'kind = ' || quote_literal(p_kind) || ' AND app.is_visible_game_entity(kind, name)';

  IF v_query <> '' THEN
    v_where := v_where || ' AND (name ILIKE ' || quote_literal('%' || v_query || '%') ||
      ' OR description ILIKE ' || quote_literal('%' || v_query || '%') || ')';
  END IF;

  IF p_kind = 'items' AND v_category <> '' THEN
    v_item_category := CASE v_category
      WHEN 'consumables' THEN '0'
      WHEN 'containers' THEN '1'
      WHEN 'weapons' THEN '2'
      WHEN 'gems' THEN '3'
      WHEN 'armor' THEN '4'
      WHEN 'trade-goods' THEN '7'
      WHEN 'quest-items' THEN '12'
      WHEN 'glyphs' THEN '16'
      ELSE NULL
    END;
    IF v_item_category IS NOT NULL THEN
      v_where := v_where || ' AND category = ' || quote_literal(v_item_category);
    END IF;
  ELSIF p_kind = 'skills' AND v_category <> '' THEN
    v_item_category := CASE v_category
      WHEN 'proficiencies' THEN '6'
      WHEN 'specializations' THEN '7'
      WHEN 'armor' THEN '8'
      WHEN 'secondary' THEN '9'
      WHEN 'languages' THEN '10'
      ELSE NULL
    END;
    IF v_item_category IS NOT NULL THEN
      v_where := v_where || ' AND category = ' || quote_literal(v_item_category);
      IF v_category = 'specializations' THEN
        v_where := v_where || ' AND name <> '''' AND name NOT ILIKE ''!%'' AND name NOT ILIKE ''Pet -%''';
      END IF;
    END IF;
  ELSIF p_kind = 'classes' THEN
    IF v_category = 'normal' THEN
      v_where := v_where || ' AND id < 12 AND id <> 10';
    ELSE
      v_where := v_where || ' AND id >= 12';
    END IF;
  ELSIF p_kind = 'spells' THEN
    v_where := v_where || ' AND (COALESCE(owner_class_ids, ''{}''::integer[]) = ''{}''::integer[] OR NOT (owner_class_ids && ARRAY[1,2,3,4,5,6,7,8,9,10,11]) OR owner_class_ids && ARRAY[12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32])';
    IF v_category = 'passive' THEN
      v_where := v_where || ' AND ((COALESCE((metadata->>''attributes0'')::integer, 0) & 64) <> 0)';
    ELSIF v_category = 'active' THEN
      v_where := v_where || ' AND ((COALESCE((metadata->>''attributes0'')::integer, 0) & 64) = 0)';
    ELSIF v_category = 'school-physical' THEN
      v_where := v_where || ' AND ((COALESCE((metadata->>''schoolMask'')::integer, 0) & 1) <> 0)';
    ELSIF v_category = 'school-holy' THEN
      v_where := v_where || ' AND ((COALESCE((metadata->>''schoolMask'')::integer, 0) & 2) <> 0)';
    ELSIF v_category = 'school-fire' THEN
      v_where := v_where || ' AND ((COALESCE((metadata->>''schoolMask'')::integer, 0) & 4) <> 0)';
    ELSIF v_category = 'school-nature' THEN
      v_where := v_where || ' AND ((COALESCE((metadata->>''schoolMask'')::integer, 0) & 8) <> 0)';
    ELSIF v_category = 'school-frost' THEN
      v_where := v_where || ' AND ((COALESCE((metadata->>''schoolMask'')::integer, 0) & 16) <> 0)';
    ELSIF v_category = 'school-shadow' THEN
      v_where := v_where || ' AND ((COALESCE((metadata->>''schoolMask'')::integer, 0) & 32) <> 0)';
    ELSIF v_category = 'school-arcane' THEN
      v_where := v_where || ' AND ((COALESCE((metadata->>''schoolMask'')::integer, 0) & 64) <> 0)';
    ELSIF v_category ~ '^class-[0-9]+$' THEN
      v_class_id := substring(v_category from 7)::integer;
      IF v_class_id >= 12 THEN
        v_where := v_where || ' AND owner_class_ids @> ARRAY[' || v_class_id || ']';
      ELSE
        v_where := v_where || ' AND false';
      END IF;
    END IF;
  END IF;

  v_order := CASE
    WHEN p_sort = 'id' AND p_direction = 'desc' THEN 'id DESC'
    WHEN p_sort = 'id' THEN 'id ASC'
    WHEN p_direction = 'desc' THEN 'lower(name) DESC, id DESC'
    ELSE 'lower(name) ASC, id ASC'
  END;

  EXECUTE
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(' ||
    quote_literal('kind') || ', kind, ' ||
    quote_literal('id') || ', id, ' ||
    quote_literal('name') || ', name, ' ||
    quote_literal('description') || ', description, ' ||
    quote_literal('category') || ', category, ' ||
    quote_literal('icon') || ', icon, ' ||
    quote_literal('sourceTable') || ', source_table, ' ||
    quote_literal('metadata') || ', metadata)), ''[]''::jsonb) ' ||
    'FROM (SELECT kind, id, name, description, category, icon, source_table, metadata ' ||
    'FROM app.game_entity_summary WHERE ' || v_where ||
    ' ORDER BY ' || v_order ||
    ' LIMIT ' || v_page_size ||
    ' OFFSET ' || v_offset || ') page_rows'
    INTO v_items;

  v_filter_key := v_category;
  IF v_query = '' THEN
    SELECT counts.total INTO v_total
    FROM app.game_entity_counts counts
    WHERE counts.kind = p_kind AND counts.filter_key = v_filter_key
    LIMIT 1;
  END IF;

  IF v_total IS NULL THEN
    v_total := v_offset + jsonb_array_length(v_items) + CASE WHEN jsonb_array_length(v_items) = v_page_size THEN 1 ELSE 0 END;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size
  );
END;
$$;

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
