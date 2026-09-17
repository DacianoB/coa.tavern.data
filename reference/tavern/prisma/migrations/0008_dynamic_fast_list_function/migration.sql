-- Dynamic, whitelisted list query so PostgreSQL can use sort/filter indexes.

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
  v_where := 'kind = ' || quote_literal(p_kind);

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
