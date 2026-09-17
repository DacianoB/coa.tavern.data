-- Tune the read models introduced in 0005 after testing against production-size data.

CREATE INDEX IF NOT EXISTS game_entity_summary_kind_category_name_idx
  ON app.game_entity_summary (kind, category, lower(name), id);

CREATE INDEX IF NOT EXISTS game_entity_summary_kind_id_name_idx
  ON app.game_entity_summary (kind, id, lower(name));

CREATE INDEX IF NOT EXISTS game_entity_summary_search_vector_idx
  ON app.game_entity_summary USING gin (
    to_tsvector('simple', COALESCE(name, '') || ' ' || COALESCE(description, ''))
  );

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
