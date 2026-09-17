-- Read-side acceleration for builder/generated game-data screens.
-- These objects do not alter legacy AoWoW/AzerothCore source tables.

CREATE SCHEMA IF NOT EXISTS app;

CREATE INDEX IF NOT EXISTS aowow_coa_specs_builder_idx
  ON game.aowow_coa_specs ("classId", "specOrder", id)
  INCLUDE (name, "skillLineId", icon, "iconId");

CREATE INDEX IF NOT EXISTS aowow_character_advancement_id_idx
  ON game.aowow_character_advancement (id);

CREATE INDEX IF NOT EXISTS aowow_talent_tree_tabs_builder_idx
  ON game.aowow_talent_tree_tabs (
    "ownerClassId",
    "treeType",
    "ownerSpecId",
    "ownerSpecSkillId",
    "orderIndex",
    "tabTypeId"
  );

CREATE INDEX IF NOT EXISTS aowow_talent_tree_nodes_builder_idx
  ON game.aowow_talent_tree_nodes (
    "ownerClassId",
    "treeType",
    "ownerSpecId",
    "ownerSpecSkillId",
    "tabTypeId",
    row,
    col,
    id
  )
  INCLUDE ("spellId", "iconId");

CREATE OR REPLACE FUNCTION app.get_builder_options()
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH class_candidates AS (
    SELECT DISTINCT
      spec."classId" AS id,
      NULLIF(spec."className", '') AS name,
      cls."fileString" AS "fileString",
      0 AS source_rank
    FROM game.aowow_coa_specs spec
    LEFT JOIN game.aowow_classes cls ON cls.id = spec."classId"
    WHERE spec."classId" > 0

    UNION ALL

    SELECT DISTINCT
      tabs."ownerClassId" AS id,
      NULLIF(tabs."ownerClassName", '') AS name,
      cls."fileString" AS "fileString",
      1 AS source_rank
    FROM game.aowow_talent_tree_tabs tabs
    LEFT JOIN game.aowow_classes cls ON cls.id = tabs."ownerClassId"
    WHERE tabs."ownerClassId" > 0
  ),
  classes AS (
    SELECT DISTINCT ON (id)
      id,
      COALESCE(name, 'Class #' || id::text) AS name,
      CASE
        WHEN NULLIF("fileString", '') IS NULL THEN NULL
        ELSE 'classicon_' || lower("fileString")
      END AS icon
    FROM class_candidates
    ORDER BY id, source_rank, name NULLS LAST
  ),
  spec_candidates AS (
    SELECT
      spec.id,
      spec."classId",
      spec.name,
      spec."skillLineId",
      spec.icon,
      icon.name AS "iconName",
      spec."specOrder",
      0 AS source_rank
    FROM game.aowow_coa_specs spec
    LEFT JOIN game.aowow_icons icon ON icon.id = spec."iconId"
    WHERE spec."classId" > 0
      AND spec.id > 0

    UNION ALL

    SELECT DISTINCT
      tabs."ownerSpecId" AS id,
      tabs."ownerClassId" AS "classId",
      NULLIF(tabs."ownerSpecName", '') AS name,
      tabs."ownerSpecSkillId" AS "skillLineId",
      NULL::text AS icon,
      NULL::text AS "iconName",
      999999 AS "specOrder",
      1 AS source_rank
    FROM game.aowow_talent_tree_tabs tabs
    WHERE tabs."treeType" = 'spec'
      AND tabs."ownerClassId" > 0
      AND tabs."ownerSpecId" > 0
  ),
  specs AS (
    SELECT DISTINCT ON ("classId", id)
      id,
      "classId",
      COALESCE(name, 'Spec #' || id::text) AS name,
      COALESCE("skillLineId", 0) AS "skillLineId",
      COALESCE(NULLIF("iconName", ''), NULLIF(icon, '')) AS icon,
      "specOrder"
    FROM spec_candidates
    ORDER BY "classId", id, source_rank, "specOrder", name NULLS LAST
  )
  SELECT jsonb_build_object(
    'classes',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', name,
            'icon', icon
          )
          ORDER BY id
        )
        FROM classes
      ),
      '[]'::jsonb
    ),
    'specs',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', id,
            'classId', "classId",
            'name', name,
            'skillLineId', "skillLineId",
            'icon', icon
          )
          ORDER BY "classId", "specOrder", id
        )
        FROM specs
      ),
      '[]'::jsonb
    )
  );
$$;

CREATE OR REPLACE FUNCTION app.get_builder_talent_tree(
  p_class_id integer DEFAULT NULL,
  p_spec_id integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH options_payload AS (
    SELECT app.get_builder_options() AS payload
  ),
  classes AS (
    SELECT
      (item.value->>'id')::integer AS id
    FROM options_payload,
      jsonb_array_elements(payload->'classes') AS item(value)
  ),
  specs AS (
    SELECT
      (item.value->>'id')::integer AS id,
      (item.value->>'classId')::integer AS "classId",
      (item.value->>'skillLineId')::integer AS "skillLineId"
    FROM options_payload,
      jsonb_array_elements(payload->'specs') AS item(value)
  ),
  selected_class AS (
    SELECT COALESCE(p_class_id, (SELECT id FROM classes ORDER BY id LIMIT 1)) AS id
  ),
  selected_spec AS (
    SELECT
      specs.id,
      specs."skillLineId"
    FROM specs
    JOIN selected_class selected ON selected.id = specs."classId"
    ORDER BY
      CASE WHEN specs.id = p_spec_id THEN 0 ELSE 1 END,
      specs.id
    LIMIT 1
  ),
  tree_scope AS (
    SELECT
      selected_class.id AS "classId",
      selected_spec.id AS "specId",
      COALESCE(selected_spec."skillLineId", 0) AS "specSkillLineId"
    FROM selected_class
    LEFT JOIN selected_spec ON true
  ),
  tabs AS (
    SELECT
      tab.id,
      tab."treeKey",
      tab."treeType",
      tab."tabTypeId",
      tab."tabName",
      tab."ownerClassId",
      tab."ownerSpecId",
      tab."ownerSpecSkillId",
      tab."backgroundAtlas",
      tab."orderIndex"
    FROM game.aowow_talent_tree_tabs tab
    CROSS JOIN tree_scope scope
    WHERE tab."ownerClassId" = scope."classId"
      AND (
        tab."treeType" = 'class'
        OR tab."ownerSpecId" = COALESCE(scope."specId", 0)
        OR (
          scope."specSkillLineId" > 0
          AND tab."ownerSpecSkillId" = scope."specSkillLineId"
        )
      )
  ),
  nodes AS (
    SELECT
      node.id,
      node."treeKey",
      node."treeType",
      node."tabTypeId",
      node."tabName",
      node.type,
      node."parentId",
      node."groupId",
      COALESCE(NULLIF(spell.name_loc0, ''), NULLIF(node.name, ''), node."spellId"::text) AS name,
      node.row,
      node.col,
      node."maxRanks",
      node."spellId",
      COALESCE(NULLIF(spell.name_loc0, ''), NULLIF(node.name, ''), node."spellId"::text) AS "spellName",
      COALESCE(spell.rank_loc0, '') AS "spellRank",
      COALESCE(spell.description_loc0, '') AS description,
      COALESCE(spell.buff_loc0, '') AS buff,
      node.prerequisite,
      COALESCE(node."connectedNodeIds", '') AS "connectedNodeIds",
      COALESCE(node."requiredNodeIds", '') AS "requiredNodeIds",
      COALESCE(node."talentCost", 0) AS "talentCost",
      COALESCE(node."abilityEssenceCost", 0) AS "abilityEssenceCost",
      COALESCE(node."talentEssenceCost", 0) AS "talentEssenceCost",
      COALESCE(node."requiredAEInvestment", 0) AS "requiredAEInvestment",
      COALESCE(node."requiredTEInvestment", 0) AS "requiredTEInvestment",
      COALESCE(node."requiredTabAEInvestment", 0) AS "requiredTabAEInvestment",
      COALESCE(node."requiredTabTEInvestment", 0) AS "requiredTabTEInvestment",
      GREATEST(
        COALESCE(node."requiredLevel", 0),
        COALESCE(adv."levelRequired1", 0),
        COALESCE(adv."levelRequired2", 0),
        COALESCE(adv."levelRequired3", 0)
      ) AS "requiredLevel",
      COALESCE(node."minLevel", 0) AS "minLevel",
      COALESCE(node."choiceIndex", 0) AS "choiceIndex",
      COALESCE(node."nodeType", '') AS "nodeType",
      COALESCE(node.flags, 0) AS flags,
      COALESCE(node."isPassive", false) AS "isPassive",
      node.shape,
      icon.name AS "iconName",
      node.icon AS "iconPath",
      to_jsonb(spell.*) AS "spellData"
    FROM game.aowow_talent_tree_nodes node
    CROSS JOIN tree_scope scope
    LEFT JOIN game.aowow_icons icon ON icon.id = node."iconId"
    LEFT JOIN game.aowow_spell spell ON spell.id = node."spellId"
    LEFT JOIN game.aowow_character_advancement adv ON adv.id = node.id
    WHERE node."ownerClassId" = scope."classId"
      AND (
        node."treeType" = 'class'
        OR node."ownerSpecId" = COALESCE(scope."specId", 0)
        OR (
          scope."specSkillLineId" > 0
          AND node."ownerSpecSkillId" = scope."specSkillLineId"
        )
      )
  ),
  rank_rows AS (
    SELECT
      ranks."advancementId",
      ranks.rank,
      ranks."spellId",
      COALESCE(NULLIF(spell.name_loc0, ''), NULLIF(ranks."spellName", ''), ranks."spellId"::text) AS "spellName",
      icon.name AS "iconName",
      COALESCE(spell.description_loc0, '') AS description,
      COALESCE(spell.buff_loc0, '') AS buff,
      to_jsonb(spell.*) AS "spellData"
    FROM game.aowow_talent_tree_node_ranks ranks
    JOIN nodes node ON node.id = ranks."advancementId"
    LEFT JOIN game.aowow_spell spell ON spell.id = ranks."spellId"
    LEFT JOIN game.aowow_icons icon ON icon.id = ranks."iconId"
  ),
  node_payload AS (
    SELECT
      nodes.*,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'rank', rank_rows.rank,
              'spellId', rank_rows."spellId",
              'spellName', rank_rows."spellName",
              'iconName', rank_rows."iconName",
              'description', rank_rows.description,
              'buff', rank_rows.buff,
              'spellData', rank_rows."spellData"
            )
            ORDER BY rank_rows.rank
          )
          FROM rank_rows
          WHERE rank_rows."advancementId" = nodes.id
        ),
        '[]'::jsonb
      ) AS ranks
    FROM nodes
  )
  SELECT jsonb_build_object(
    'classId', (SELECT "classId" FROM tree_scope),
    'specId', (SELECT "specId" FROM tree_scope),
    'tabs',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', id,
            'treeKey', "treeKey",
            'treeType', "treeType",
            'tabTypeId', "tabTypeId",
            'tabName', "tabName",
            'ownerClassId', "ownerClassId",
            'ownerSpecId', "ownerSpecId",
            'ownerSpecSkillId', "ownerSpecSkillId",
            'backgroundAtlas', "backgroundAtlas"
          )
          ORDER BY "treeType", "orderIndex", "tabTypeId"
        )
        FROM tabs
      ),
      '[]'::jsonb
    ),
    'nodes',
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(node_payload) ORDER BY "treeType", "tabTypeId", row, col, id)
        FROM node_payload
      ),
      '[]'::jsonb
    )
  );
$$;

COMMENT ON FUNCTION app.get_builder_options() IS
  'Fast JSON payload for builder class/spec options from imported AoWoW/CoA game data.';

COMMENT ON FUNCTION app.get_builder_talent_tree(integer, integer) IS
  'Fast JSON payload for the builder tree; collapses tabs, nodes, ranks, icons, and spell data into one read.';
