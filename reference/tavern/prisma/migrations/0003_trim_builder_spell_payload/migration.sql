-- Keep builder tree responses small by returning only spell fields used by
-- renderSpellText instead of serializing every aowow_spell column per node.

CREATE OR REPLACE FUNCTION app.builder_spell_text_payload(p_spell game.aowow_spell)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_spell IS NULL THEN NULL
    ELSE jsonb_strip_nulls(jsonb_build_object(
      'id', p_spell.id,
      'duration', p_spell.duration,
      'baseLevel', p_spell."baseLevel",
      'spellLevel', p_spell."spellLevel",
      'effect1RealPointsPerLevel', p_spell."effect1RealPointsPerLevel",
      'effect2RealPointsPerLevel', p_spell."effect2RealPointsPerLevel",
      'effect3RealPointsPerLevel', p_spell."effect3RealPointsPerLevel",
      'effect1DieSides', p_spell."effect1DieSides",
      'effect2DieSides', p_spell."effect2DieSides",
      'effect3DieSides', p_spell."effect3DieSides",
      'effect1BasePoints', p_spell."effect1BasePoints",
      'effect2BasePoints', p_spell."effect2BasePoints",
      'effect3BasePoints', p_spell."effect3BasePoints",
      'effect1RadiusMin', p_spell."effect1RadiusMin",
      'effect2RadiusMin', p_spell."effect2RadiusMin",
      'effect3RadiusMin', p_spell."effect3RadiusMin",
      'effect1RadiusMax', p_spell."effect1RadiusMax",
      'effect2RadiusMax', p_spell."effect2RadiusMax",
      'effect3RadiusMax', p_spell."effect3RadiusMax",
      'effect1Periode', p_spell."effect1Periode",
      'effect2Periode', p_spell."effect2Periode",
      'effect3Periode', p_spell."effect3Periode",
      'effect1PointsPerComboPoint', p_spell."effect1PointsPerComboPoint",
      'effect2PointsPerComboPoint', p_spell."effect2PointsPerComboPoint",
      'effect3PointsPerComboPoint', p_spell."effect3PointsPerComboPoint",
      'effect1ValueMultiplier', p_spell."effect1ValueMultiplier",
      'effect2ValueMultiplier', p_spell."effect2ValueMultiplier",
      'effect3ValueMultiplier', p_spell."effect3ValueMultiplier",
      'effect1DamageMultiplier', p_spell."effect1DamageMultiplier",
      'effect2DamageMultiplier', p_spell."effect2DamageMultiplier",
      'effect3DamageMultiplier', p_spell."effect3DamageMultiplier",
      'procChance', p_spell."procChance",
      'maxAffectedTargets', p_spell."maxAffectedTargets",
      'procCharges', p_spell."procCharges",
      'effect1MiscValue', p_spell."effect1MiscValue",
      'effect2MiscValue', p_spell."effect2MiscValue",
      'effect3MiscValue', p_spell."effect3MiscValue",
      'stackAmount', p_spell."stackAmount",
      'maxTargetLevel', p_spell."maxTargetLevel",
      'effect1ChainTarget', p_spell."effect1ChainTarget",
      'effect2ChainTarget', p_spell."effect2ChainTarget",
      'effect3ChainTarget', p_spell."effect3ChainTarget"
    ))
  END;
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
      app.builder_spell_text_payload(spell) AS "spellData"
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
      app.builder_spell_text_payload(spell) AS "spellData"
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

COMMENT ON FUNCTION app.builder_spell_text_payload(game.aowow_spell) IS
  'Minimal spell JSON used by builder tooltip text interpolation.';
