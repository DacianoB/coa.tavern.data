-- Extend item visibility filtering from exact placeholder names to common hidden-name fragments.

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

REFRESH MATERIALIZED VIEW app.game_entity_counts;
ANALYZE app.game_entity_counts;
