-- Store parsed item tooltip effects without mutating AoWoW/AzerothCore game tables.

CREATE SCHEMA IF NOT EXISTS app;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS app.item_tooltip_effects (
  item_id integer NOT NULL,
  effect_index integer NOT NULL,
  effect_kind text NOT NULL,
  effect_label text NOT NULL,
  effect_text text NOT NULL,
  raw_line text NOT NULL,
  search_text text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, effect_index)
);

CREATE INDEX IF NOT EXISTS item_tooltip_effects_kind_idx
  ON app.item_tooltip_effects (effect_kind, item_id);

CREATE INDEX IF NOT EXISTS item_tooltip_effects_item_id_idx
  ON app.item_tooltip_effects (item_id);

CREATE INDEX IF NOT EXISTS item_tooltip_effects_search_trgm_idx
  ON app.item_tooltip_effects USING gin (search_text gin_trgm_ops);

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
  summaries AS (
    SELECT
      summary.*,
      COALESCE(item_effects.search_text, '') AS effect_search_text
    FROM app.game_entity_summary summary
    LEFT JOIN LATERAL (
      SELECT string_agg(effect.search_text, ' ') AS search_text
      FROM app.item_tooltip_effects effect
      WHERE summary.kind = 'items'
        AND effect.item_id = summary.id
    ) item_effects ON true
  ),
  candidates AS (
    SELECT
      summaries.*,
      CASE
        WHEN lower(summaries.name) = lower(input.q) THEN 1.0
        WHEN summaries.name ILIKE input.q || '%' THEN 0.88
        WHEN to_tsvector('simple', COALESCE(summaries.name, '') || ' ' || COALESCE(summaries.description, '') || ' ' || summaries.effect_search_text) @@ input.tsq
          THEN 0.75 + ts_rank_cd(to_tsvector('simple', COALESCE(summaries.name, '') || ' ' || COALESCE(summaries.description, '') || ' ' || summaries.effect_search_text), input.tsq)::double precision
        WHEN summaries.name ILIKE '%' || input.q || '%' THEN 0.65
        WHEN summaries.effect_search_text ILIKE '%' || input.q || '%' THEN 0.6
        ELSE 0.0
      END AS score
    FROM summaries
    CROSS JOIN input
    WHERE input.q <> ''
      AND app.is_visible_game_entity(summaries.kind, summaries.name)
      AND (
        to_tsvector('simple', COALESCE(summaries.name, '') || ' ' || COALESCE(summaries.description, '') || ' ' || summaries.effect_search_text) @@ input.tsq
        OR summaries.name ILIKE input.q || '%'
        OR summaries.name ILIKE '%' || input.q || '%'
        OR summaries.effect_search_text ILIKE '%' || input.q || '%'
      )
    ORDER BY score DESC, lower(summaries.name), summaries.id
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
