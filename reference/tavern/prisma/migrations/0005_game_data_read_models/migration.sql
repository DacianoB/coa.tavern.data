-- Broad read-side acceleration for game-data pages.
-- Non-destructive: adds app-schema read models/functions and additive indexes.

CREATE SCHEMA IF NOT EXISTS app;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS aowow_items_name_trgm_idx
  ON game.aowow_items USING gin (name_loc0 gin_trgm_ops);
CREATE INDEX IF NOT EXISTS aowow_items_class_id_idx
  ON game.aowow_items (class, id);
CREATE INDEX IF NOT EXISTS aowow_items_spell1_idx ON game.aowow_items ("spellId1") WHERE "spellId1" > 0;
CREATE INDEX IF NOT EXISTS aowow_items_spell2_idx ON game.aowow_items ("spellId2") WHERE "spellId2" > 0;
CREATE INDEX IF NOT EXISTS aowow_items_spell3_idx ON game.aowow_items ("spellId3") WHERE "spellId3" > 0;
CREATE INDEX IF NOT EXISTS aowow_items_spell4_idx ON game.aowow_items ("spellId4") WHERE "spellId4" > 0;
CREATE INDEX IF NOT EXISTS aowow_items_spell5_idx ON game.aowow_items ("spellId5") WHERE "spellId5" > 0;

CREATE INDEX IF NOT EXISTS aowow_spell_name_trgm_idx
  ON game.aowow_spell USING gin (name_loc0 gin_trgm_ops);
CREATE INDEX IF NOT EXISTS aowow_spell_name_rank_family_idx
  ON game.aowow_spell (name_loc0, rank_loc0, "schoolMask", "spellFamilyId");
CREATE INDEX IF NOT EXISTS aowow_spell_family_idx
  ON game.aowow_spell ("spellFamilyId", id);
CREATE INDEX IF NOT EXISTS aowow_spell_trigger1_idx ON game.aowow_spell ("effect1TriggerSpell") WHERE "effect1TriggerSpell" > 0;
CREATE INDEX IF NOT EXISTS aowow_spell_trigger2_idx ON game.aowow_spell ("effect2TriggerSpell") WHERE "effect2TriggerSpell" > 0;
CREATE INDEX IF NOT EXISTS aowow_spell_trigger3_idx ON game.aowow_spell ("effect3TriggerSpell") WHERE "effect3TriggerSpell" > 0;
CREATE INDEX IF NOT EXISTS aowow_spell_cooldown_idx
  ON game.aowow_spell (category, "recoveryCategory", "spellFamilyId") WHERE "recoveryCategory" > 0;

CREATE INDEX IF NOT EXISTS aowow_talents_spell_idx
  ON game.aowow_talents (spell);
CREATE INDEX IF NOT EXISTS aowow_itemenchantment_object1_idx ON game.aowow_itemenchantment (object1) WHERE object1 > 0;
CREATE INDEX IF NOT EXISTS aowow_itemenchantment_object2_idx ON game.aowow_itemenchantment (object2) WHERE object2 > 0;
CREATE INDEX IF NOT EXISTS aowow_itemenchantment_object3_idx ON game.aowow_itemenchantment (object3) WHERE object3 > 0;

DROP MATERIALIZED VIEW IF EXISTS app.game_entity_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS app.item_spell_links CASCADE;
DROP MATERIALIZED VIEW IF EXISTS app.itemset_spell_links CASCADE;
DROP MATERIALIZED VIEW IF EXISTS app.enchantment_spell_links CASCADE;
DROP MATERIALIZED VIEW IF EXISTS app.spell_trigger_links CASCADE;
DROP MATERIALIZED VIEW IF EXISTS app.spell_teach_links CASCADE;
DROP MATERIALIZED VIEW IF EXISTS app.spell_created_item_links CASCADE;
DROP MATERIALIZED VIEW IF EXISTS app.resolved_class_specs CASCADE;

CREATE MATERIALIZED VIEW app.resolved_class_specs AS
WITH resolved AS (
  SELECT
    spec.id AS spec_id,
    spec."classId" AS class_id,
    spec."className" AS class_name,
    spec."classToken" AS class_token,
    spec."specToken" AS spec_token,
    spec.name AS spec_name,
    spec."specOrder" AS spec_order,
    spec."primaryStat" AS primary_stat,
    COALESCE(
      CASE WHEN spec."classId" >= 12 THEN NULLIF(chr."skillLineId", 0) END,
      NULLIF(spec."skillLineId", 0),
      NULLIF(chr."skillLineId", 0),
      0
    ) AS skill_line_id,
    COALESCE(
      CASE WHEN spec."classId" >= 12 THEN NULLIF(chr."skillLineName", '') END,
      NULLIF(spec."skillLineName", ''),
      NULLIF(chr."skillLineName", ''),
      ''
    ) AS skill_line_name,
    spec."thumbnailAtlas" AS thumbnail_atlas,
    spec."backgroundAtlas" AS background_atlas,
    cls."fileString" AS class_file_string,
    0 AS source_rank
  FROM game.aowow_coa_specs spec
  LEFT JOIN LATERAL (
    SELECT chr."skillLineId", chr."skillLineName"
    FROM game.aowow_chr_specs chr
    WHERE chr."specToken" = spec."specToken"
      AND chr."skillLineId" > 0
      AND (
        chr."classId" = spec."classId"
        OR chr."classId" = 0
        OR chr."classToken" = spec."classToken"
        OR chr."classFileString" = spec."classToken"
      )
    ORDER BY (chr."classId" = spec."classId") DESC, chr."orderIndex" ASC, chr.id ASC
    LIMIT 1
  ) chr ON true
  LEFT JOIN game.aowow_classes cls ON cls.id = spec."classId"
  WHERE spec."classId" > 0

  UNION ALL

  SELECT
    chr.id AS spec_id,
    chr."classId" AS class_id,
    chr."className" AS class_name,
    COALESCE(NULLIF(chr."classFileString", ''), chr."classToken") AS class_token,
    chr."specToken" AS spec_token,
    chr.name AS spec_name,
    chr."orderIndex" AS spec_order,
    '' AS primary_stat,
    chr."skillLineId" AS skill_line_id,
    chr."skillLineName" AS skill_line_name,
    '' AS thumbnail_atlas,
    '' AS background_atlas,
    cls."fileString" AS class_file_string,
    1 AS source_rank
  FROM game.aowow_chr_specs chr
  LEFT JOIN game.aowow_classes cls ON cls.id = chr."classId"
  WHERE chr."classId" > 0
    AND chr."skillLineId" > 0
    AND NOT EXISTS (
      SELECT 1
      FROM game.aowow_coa_specs spec
      WHERE spec."classId" = chr."classId"
        AND spec."specToken" = chr."specToken"
    )
)
SELECT DISTINCT ON (class_id, spec_token, skill_line_id)
  spec_id,
  class_id,
  class_name,
  class_token,
  spec_token,
  spec_name,
  spec_order,
  primary_stat,
  skill_line_id,
  skill_line_name,
  thumbnail_atlas,
  background_atlas,
  class_file_string,
  source_rank
FROM resolved
ORDER BY class_id, spec_token, skill_line_id, source_rank, spec_order, spec_id;

CREATE UNIQUE INDEX resolved_class_specs_unique_idx
  ON app.resolved_class_specs (class_id, spec_token, skill_line_id);
CREATE INDEX resolved_class_specs_class_idx
  ON app.resolved_class_specs (class_id, spec_order, spec_id);
CREATE INDEX resolved_class_specs_skill_idx
  ON app.resolved_class_specs (skill_line_id, class_id);

CREATE MATERIALIZED VIEW app.item_spell_links AS
SELECT id AS item_id, "spellId1" AS spell_id, 1 AS slot FROM game.aowow_items WHERE "spellId1" > 0
UNION ALL SELECT id, "spellId2", 2 FROM game.aowow_items WHERE "spellId2" > 0
UNION ALL SELECT id, "spellId3", 3 FROM game.aowow_items WHERE "spellId3" > 0
UNION ALL SELECT id, "spellId4", 4 FROM game.aowow_items WHERE "spellId4" > 0
UNION ALL SELECT id, "spellId5", 5 FROM game.aowow_items WHERE "spellId5" > 0;
CREATE UNIQUE INDEX item_spell_links_unique_idx ON app.item_spell_links (item_id, spell_id, slot);
CREATE INDEX item_spell_links_spell_idx ON app.item_spell_links (spell_id, item_id);

CREATE MATERIALIZED VIEW app.itemset_spell_links AS
SELECT id AS itemset_id, spell1 AS spell_id, 1 AS slot FROM game.aowow_itemset WHERE spell1 > 0
UNION ALL SELECT id, spell2, 2 FROM game.aowow_itemset WHERE spell2 > 0
UNION ALL SELECT id, spell3, 3 FROM game.aowow_itemset WHERE spell3 > 0
UNION ALL SELECT id, spell4, 4 FROM game.aowow_itemset WHERE spell4 > 0
UNION ALL SELECT id, spell5, 5 FROM game.aowow_itemset WHERE spell5 > 0
UNION ALL SELECT id, spell6, 6 FROM game.aowow_itemset WHERE spell6 > 0
UNION ALL SELECT id, spell7, 7 FROM game.aowow_itemset WHERE spell7 > 0
UNION ALL SELECT id, spell8, 8 FROM game.aowow_itemset WHERE spell8 > 0;
CREATE UNIQUE INDEX itemset_spell_links_unique_idx ON app.itemset_spell_links (itemset_id, spell_id, slot);
CREATE INDEX itemset_spell_links_spell_idx ON app.itemset_spell_links (spell_id, itemset_id);

CREATE MATERIALIZED VIEW app.enchantment_spell_links AS
SELECT id AS enchantment_id, object1 AS spell_id, type1 AS enchant_type, 1 AS slot
FROM game.aowow_itemenchantment WHERE type1 IN (1, 3, 7) AND object1 > 0
UNION ALL
SELECT id, object2, type2, 2
FROM game.aowow_itemenchantment WHERE type2 IN (1, 3, 7) AND object2 > 0
UNION ALL
SELECT id, object3, type3, 3
FROM game.aowow_itemenchantment WHERE type3 IN (1, 3, 7) AND object3 > 0;
CREATE UNIQUE INDEX enchantment_spell_links_unique_idx ON app.enchantment_spell_links (enchantment_id, spell_id, slot);
CREATE INDEX enchantment_spell_links_spell_idx ON app.enchantment_spell_links (spell_id, enchantment_id);

CREATE MATERIALIZED VIEW app.spell_trigger_links AS
SELECT id AS source_spell_id, "effect1TriggerSpell" AS target_spell_id, 1 AS effect_index, "effect1Id" AS effect_id, "effect1AuraId" AS aura_id
FROM game.aowow_spell WHERE "effect1TriggerSpell" > 0
UNION ALL
SELECT id, "effect2TriggerSpell", 2, "effect2Id", "effect2AuraId" FROM game.aowow_spell WHERE "effect2TriggerSpell" > 0
UNION ALL
SELECT id, "effect3TriggerSpell", 3, "effect3Id", "effect3AuraId" FROM game.aowow_spell WHERE "effect3TriggerSpell" > 0;
CREATE UNIQUE INDEX spell_trigger_links_unique_idx ON app.spell_trigger_links (source_spell_id, target_spell_id, effect_index);
CREATE INDEX spell_trigger_links_target_idx ON app.spell_trigger_links (target_spell_id, source_spell_id);

CREATE MATERIALIZED VIEW app.spell_teach_links AS
SELECT source_spell_id, target_spell_id, effect_index
FROM app.spell_trigger_links
WHERE effect_id IN (36, 57);
CREATE UNIQUE INDEX spell_teach_links_unique_idx ON app.spell_teach_links (source_spell_id, target_spell_id, effect_index);
CREATE INDEX spell_teach_links_target_idx ON app.spell_teach_links (target_spell_id, source_spell_id);

CREATE MATERIALIZED VIEW app.spell_created_item_links AS
SELECT id AS source_spell_id, "effect1CreateItemId" AS item_id, 1 AS effect_index
FROM game.aowow_spell WHERE "effect1CreateItemId" > 0
UNION ALL
SELECT id, "effect2CreateItemId", 2 FROM game.aowow_spell WHERE "effect2CreateItemId" > 0
UNION ALL
SELECT id, "effect3CreateItemId", 3 FROM game.aowow_spell WHERE "effect3CreateItemId" > 0;
CREATE UNIQUE INDEX spell_created_item_links_unique_idx ON app.spell_created_item_links (source_spell_id, item_id, effect_index);
CREATE INDEX spell_created_item_links_item_idx ON app.spell_created_item_links (item_id, source_spell_id);

CREATE MATERIALIZED VIEW app.game_entity_summary AS
WITH spell_owner_agg AS (
  SELECT
    "spellId" AS spell_id,
    array_agg(DISTINCT "ownerClassId" ORDER BY "ownerClassId") FILTER (WHERE "ownerClassId" > 0) AS owner_class_ids,
    MIN(NULLIF(cls."fileString", '')) FILTER (WHERE owner."ownerClassId" > 0) AS owner_class_file_string,
    MIN(NULLIF(spec_icon.name, '')) FILTER (WHERE owner."ownerSpecSkillId" > 0) AS owner_spec_icon
  FROM game.aowow_spell_owners owner
  LEFT JOIN game.aowow_classes cls ON cls.id = owner."ownerClassId"
  LEFT JOIN game.aowow_skillline skill ON skill."Id" = owner."ownerSpecSkillId"
  LEFT JOIN game.aowow_icons spec_icon ON spec_icon.id = skill."iconId"
  GROUP BY "spellId"
),
skill_owner_agg AS (
  SELECT DISTINCT ON (skill_line_id)
    skill_line_id,
    class_id,
    class_name,
    class_token,
    class_file_string
  FROM app.resolved_class_specs
  WHERE skill_line_id > 0
  ORDER BY skill_line_id, (class_id >= 12) DESC, source_rank, class_id, spec_order
)
SELECT
  'items'::text AS kind,
  item.id::int AS id,
  COALESCE(NULLIF(item.name_loc0, ''), item.id::text) AS name,
  NULLIF(item.description_loc0, '') AS description,
  item.class::text AS category,
  icon.name AS icon,
  'aowow_items'::text AS source_table,
  jsonb_strip_nulls(jsonb_build_object(
    'class', item.class,
    'subClass', item."subClass",
    'slot', item.slot,
    'quality', item.quality,
    'bonding', item.bonding,
    'itemLevel', item."itemLevel",
    'requiredLevel', item."requiredLevel",
    'reqClassMask', item."requiredClass"
  )) AS metadata,
  NULL::integer[] AS owner_class_ids
FROM game.aowow_items item
LEFT JOIN game.aowow_icons icon ON icon.id = item."iconId"

UNION ALL
SELECT 'item-sets', itemset.id, COALESCE(NULLIF(itemset.name_loc0, ''), itemset.id::text), NULLIF(itemset."bonusText_loc0", ''), itemset.type::text, NULL::text, 'aowow_itemset',
  jsonb_strip_nulls(jsonb_build_object('minLevel', itemset."minLevel", 'maxLevel', itemset."maxLevel", 'reqLevel', itemset."reqLevel", 'classMask', itemset."classMask", 'quality', itemset.quality, 'type', itemset.type)),
  NULL::integer[]
FROM game.aowow_itemset itemset

UNION ALL
SELECT 'enchantments', ench.id, COALESCE(NULLIF(ench.name_loc0, ''), ench.id::text), NULL::text, ench."skillLine"::text, 'spell_holy_greaterheal', 'aowow_itemenchantment',
  jsonb_strip_nulls(jsonb_build_object('skillLine', ench."skillLine", 'skillLevel', ench."skillLevel", 'requiredLevel', ench."requiredLevel", 'type1', ench.type1, 'type2', ench.type2, 'type3', ench.type3)),
  NULL::integer[]
FROM game.aowow_itemenchantment ench

UNION ALL
SELECT 'spells', spell.id, COALESCE(NULLIF(spell.name_loc0, ''), spell.id::text), NULLIF(spell.description_loc0, ''), spell."typeCat"::text, icon.name, 'aowow_spell',
  jsonb_strip_nulls(jsonb_build_object(
    'schoolMask', spell."schoolMask",
    'spellFamilyId', spell."spellFamilyId",
    'rank_loc0', spell.rank_loc0,
    'baseLevel', spell."baseLevel",
    'spellLevel', spell."spellLevel",
    'attributes0', spell.attributes0,
    'ownerClassFileString', owner.owner_class_file_string,
    'ownerSpecIcon', owner.owner_spec_icon
  )),
  owner.owner_class_ids
FROM game.aowow_spell spell
LEFT JOIN game.aowow_icons icon ON icon.id = spell."iconId"
LEFT JOIN spell_owner_agg owner ON owner.spell_id = spell.id

UNION ALL
SELECT
  kind,
  id,
  name,
  description,
  category,
  icon,
  source_table,
  metadata,
  owner_class_ids
FROM (
  SELECT DISTINCT ON (talent.id)
    'talents'::text AS kind,
    talent.id::int AS id,
    COALESCE(NULLIF(spell.name_loc0, ''), 'Talent #' || talent.id::text) AS name,
    NULLIF(spell.description_loc0, '') AS description,
    talent.class::text AS category,
    icon.name AS icon,
    'aowow_talents'::text AS source_table,
    jsonb_strip_nulls(jsonb_build_object('class', talent.class, 'tab', talent.tab, 'row', talent.row, 'col', talent.col, 'spell', talent.spell, 'rank', talent.rank, 'schoolMask', spell."schoolMask", 'spellFamilyId', spell."spellFamilyId")) AS metadata,
    NULL::integer[] AS owner_class_ids
  FROM game.aowow_talents talent
  LEFT JOIN game.aowow_spell spell ON spell.id = talent.spell
  LEFT JOIN game.aowow_icons icon ON icon.id = spell."iconId"
  ORDER BY talent.id, talent.rank, talent.spell
) talent_summary

UNION ALL
SELECT 'quests', quest.id, COALESCE(NULLIF(quest.name_loc0, ''), quest.id::text), NULLIF(quest.objectives_loc0, ''), quest."zoneOrSort"::text, 'inv_misc_note_01', 'aowow_quests',
  jsonb_strip_nulls(jsonb_build_object('level', quest.level, 'minLevel', quest."minLevel", 'maxLevel', quest."maxLevel", 'requiredLevel', quest."minLevel", 'QuestLevel', quest.level)),
  NULL::integer[]
FROM game.aowow_quests quest

UNION ALL
SELECT 'npcs', npc.id, COALESCE(NULLIF(npc.name_loc0, ''), npc.id::text), NULLIF(npc.subname_loc0, ''), npc.type::text, npc."iconString", 'aowow_creature',
  jsonb_strip_nulls(jsonb_build_object('minLevel', npc."minLevel", 'maxLevel', npc."maxLevel", 'type', npc.type, 'rank', npc.rank)),
  NULL::integer[]
FROM game.aowow_creature npc

UNION ALL
SELECT 'objects', obj.id, COALESCE(NULLIF(obj.name_loc0, ''), obj.id::text), NULL::text, obj."typeCat"::text, 'inv_crate_05', 'aowow_objects',
  jsonb_strip_nulls(jsonb_build_object('type', obj.type, 'typeCat', obj."typeCat", 'faction', obj.faction)),
  NULL::integer[]
FROM game.aowow_objects obj

UNION ALL
SELECT 'zones', zone.id, COALESCE(NULLIF(zone.name_loc0, ''), zone.id::text), NULL::text, zone.category::text, 'inv_misc_map_01', 'aowow_zones',
  jsonb_strip_nulls(jsonb_build_object('minLevel', zone."levelMin", 'maxLevel', zone."levelMax", 'levelReq', zone."levelReq", 'type', zone.type, 'faction', zone.faction, 'parentArea', zone."parentArea")),
  NULL::integer[]
FROM game.aowow_zones zone

UNION ALL
SELECT 'factions', faction.id, COALESCE(NULLIF(faction.name_loc0, ''), faction.id::text), NULL::text, faction.side::text, 'inv_bannerpvp_02', 'aowow_factions',
  jsonb_strip_nulls(jsonb_build_object('faction', faction.side, 'parentFactionId', faction."parentFactionId", 'repIdx', faction."repIdx")),
  NULL::integer[]
FROM game.aowow_factions faction

UNION ALL
SELECT 'achievements', achievement.id, COALESCE(NULLIF(achievement.name_loc0, ''), achievement.id::text), NULLIF(achievement.description_loc0, ''), achievement.category::text, icon.name, 'aowow_achievement',
  jsonb_strip_nulls(jsonb_build_object('categoryId', achievement.category, 'points', achievement.points, 'faction', achievement.faction)),
  NULL::integer[]
FROM game.aowow_achievement achievement
LEFT JOIN game.aowow_icons icon ON icon.id = achievement."iconId"

UNION ALL
SELECT 'classes', cls.id, COALESCE(NULLIF(cls.name_loc0, ''), cls.id::text), NULL::text, NULL::text, 'classicon_' || lower(cls."fileString"), 'aowow_classes',
  jsonb_strip_nulls(jsonb_build_object('fileString', cls."fileString", 'powerType', cls."powerType", 'expansion', cls.expansion)),
  NULL::integer[]
FROM game.aowow_classes cls

UNION ALL
SELECT 'races', race.id, COALESCE(NULLIF(race.name_loc0, ''), race.id::text), NULL::text, race.side::text, 'achievement_character_human_male', 'aowow_races',
  jsonb_strip_nulls(jsonb_build_object('fileString', race."fileString", 'side', race.side, 'expansion', race.expansion, 'classMask', race."classMask")),
  NULL::integer[]
FROM game.aowow_races race

UNION ALL
SELECT 'skills', skill."Id", COALESCE(NULLIF(skill.name_loc0, ''), skill."Id"::text), NULLIF(skill.description_loc0, ''), skill."categoryId"::text, icon.name, 'aowow_skillline',
  jsonb_strip_nulls(jsonb_build_object('categoryId', skill."categoryId", 'typeCat', skill."typeCat", 'description_loc0', skill.description_loc0, 'ownerClassFileString', owner.class_file_string)),
  NULL::integer[]
FROM game.aowow_skillline skill
LEFT JOIN game.aowow_icons icon ON icon.id = skill."iconId"
LEFT JOIN skill_owner_agg owner ON owner.skill_line_id = skill."Id"

UNION ALL
SELECT 'professions', skill."Id", COALESCE(NULLIF(skill.name_loc0, ''), skill."Id"::text), NULLIF(skill.description_loc0, ''), skill."categoryId"::text, icon.name, 'aowow_skillline',
  jsonb_strip_nulls(jsonb_build_object('categoryId', skill."categoryId", 'typeCat', skill."typeCat", 'description_loc0', skill.description_loc0)),
  NULL::integer[]
FROM game.aowow_skillline skill
LEFT JOIN game.aowow_icons icon ON icon.id = skill."iconId"
WHERE skill."categoryId" = 11

UNION ALL
SELECT 'pets', pet.id, COALESCE(NULLIF(pet.name_loc0, ''), pet.id::text), NULL::text, pet.category::text, icon.name, 'aowow_pet',
  jsonb_strip_nulls(jsonb_build_object('minLevel', pet."minLevel", 'maxLevel', pet."maxLevel", 'type', pet.type, 'categoryId', pet.category)),
  NULL::integer[]
FROM game.aowow_pet pet
LEFT JOIN game.aowow_icons icon ON icon.id = pet."iconId"

UNION ALL
SELECT 'emotes', emote.id, COALESCE(NULLIF(emote.cmd, ''), emote.id::text), NULLIF(emote."extToNone_loc0", ''), NULL::text, 'spell_holy_silence', 'aowow_emotes',
  jsonb_strip_nulls(jsonb_build_object('isAnimated', emote."isAnimated", 'flags', emote.flags)),
  NULL::integer[]
FROM game.aowow_emotes emote

UNION ALL
SELECT 'currencies', currency.id, COALESCE(NULLIF(currency.name_loc0, ''), currency.id::text), NULLIF(currency.description_loc0, ''), currency.category::text, icon.name, 'aowow_currencies',
  jsonb_strip_nulls(jsonb_build_object('categoryId', currency.category, 'itemId', currency."itemId")),
  NULL::integer[]
FROM game.aowow_currencies currency
LEFT JOIN game.aowow_icons icon ON icon.id = currency."iconId"

UNION ALL
SELECT 'events', event.id, COALESCE(NULLIF(event.description, ''), 'Event #' || event.id::text), NULLIF(event.description, ''), NULL::text, 'inv_misc_calendar_01', 'aowow_events',
  jsonb_strip_nulls(jsonb_build_object('holidayId', event."holidayId", 'startTime', event."startTime", 'endTime', event."endTime")),
  NULL::integer[]
FROM game.aowow_events event

UNION ALL
SELECT 'titles', title.id, COALESCE(NULLIF(title.male_loc0, ''), NULLIF(title.female_loc0, ''), title.id::text), NULL::text, title.category::text, 'inv_misc_ribbon_01', 'aowow_titles',
  jsonb_strip_nulls(jsonb_build_object('categoryId', title.category, 'gender', title.gender, 'side', title.side, 'expansion', title.expansion)),
  NULL::integer[]
FROM game.aowow_titles title

UNION ALL
SELECT 'icons', icon.id, COALESCE(NULLIF(icon.name, ''), icon.id::text), NULL::text, NULL::text, icon.name, 'aowow_icons',
  '{}'::jsonb,
  NULL::integer[]
FROM game.aowow_icons icon

UNION ALL
SELECT 'mails', mail.id, COALESCE(NULLIF(mail.subject_loc0, ''), mail.id::text), NULLIF(mail.text_loc0, ''), NULL::text, 'inv_letter_15', 'aowow_mails',
  jsonb_strip_nulls(jsonb_build_object('attachment', mail.attachment)),
  NULL::integer[]
FROM game.aowow_mails mail

UNION ALL
SELECT 'sounds', sound.id, COALESCE(NULLIF(sound.name, ''), sound.id::text), NULL::text, sound.cat::text, 'inv_misc_note_05', 'aowow_sounds',
  jsonb_strip_nulls(jsonb_build_object('cat', sound.cat, 'flags', sound.flags)),
  NULL::integer[]
FROM game.aowow_sounds sound;

CREATE UNIQUE INDEX game_entity_summary_kind_id_idx
  ON app.game_entity_summary (kind, id);
CREATE INDEX game_entity_summary_kind_name_idx
  ON app.game_entity_summary (kind, lower(name), id);
CREATE INDEX game_entity_summary_kind_category_idx
  ON app.game_entity_summary (kind, category, id);
CREATE INDEX game_entity_summary_name_trgm_idx
  ON app.game_entity_summary USING gin (name gin_trgm_ops);
CREATE INDEX game_entity_summary_description_trgm_idx
  ON app.game_entity_summary USING gin (description gin_trgm_ops)
  WHERE description IS NOT NULL;
CREATE INDEX game_entity_summary_owner_class_ids_idx
  ON app.game_entity_summary USING gin (owner_class_ids)
  WHERE kind = 'spells';

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
  ANALYZE app.resolved_class_specs;
  ANALYZE app.item_spell_links;
  ANALYZE app.itemset_spell_links;
  ANALYZE app.enchantment_spell_links;
  ANALYZE app.spell_trigger_links;
  ANALYZE app.spell_teach_links;
  ANALYZE app.spell_created_item_links;
  ANALYZE app.game_entity_summary;
END;
$$;

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
    SELECT trim(COALESCE(p_query, '')) AS q
  )
  SELECT
    summary.kind,
    summary.id,
    summary.name,
    summary.description,
    summary.category,
    summary.icon,
    summary.source_table,
    summary.metadata,
    CASE
      WHEN lower(summary.name) = lower(input.q) THEN 1.0
      WHEN summary.name ILIKE input.q || '%' THEN 0.88
      WHEN summary.name ILIKE '%' || input.q || '%' THEN 0.72
      ELSE GREATEST(similarity(summary.name, input.q), similarity(COALESCE(summary.description, ''), input.q)) * 0.6
    END AS score
  FROM app.game_entity_summary summary
  CROSS JOIN input
  WHERE input.q <> ''
    AND (
      summary.name ILIKE '%' || input.q || '%'
      OR summary.description ILIKE '%' || input.q || '%'
      OR similarity(summary.name, input.q) > 0.18
    )
  ORDER BY score DESC, lower(summary.name), summary.id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200));
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
  filtered AS (
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
  ),
  counted AS (
    SELECT COUNT(*)::integer AS total FROM filtered
  ),
  page_rows AS (
    SELECT filtered.*
    FROM filtered
    CROSS JOIN params
    ORDER BY
      CASE WHEN params.sort = 'id' AND params.direction = 'asc' THEN filtered.id END ASC,
      CASE WHEN params.sort = 'id' AND params.direction = 'desc' THEN filtered.id END DESC,
      CASE WHEN params.sort = 'name' AND params.direction = 'asc' THEN lower(filtered.name) END ASC,
      CASE WHEN params.sort = 'name' AND params.direction = 'desc' THEN lower(filtered.name) END DESC,
      filtered.id ASC
    LIMIT (SELECT page_size FROM params)
    OFFSET ((SELECT page FROM params) - 1) * (SELECT page_size FROM params)
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
    'total', (SELECT total FROM counted),
    'page', (SELECT page FROM params),
    'pageSize', (SELECT page_size FROM params)
  );
$$;

CREATE OR REPLACE FUNCTION app.get_entity_stats()
RETURNS TABLE(kind text, total integer)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT summary.kind, COUNT(*)::integer AS total
  FROM app.game_entity_summary summary
  GROUP BY summary.kind
  ORDER BY summary.kind;
$$;

COMMENT ON MATERIALIZED VIEW app.game_entity_summary IS
  'Flattened game entity cards for fast list/search/related summary reads.';
COMMENT ON MATERIALIZED VIEW app.item_spell_links IS
  'Exploded item spell slots for fast spell -> item relationship lookups.';
COMMENT ON MATERIALIZED VIEW app.itemset_spell_links IS
  'Exploded item set spell slots for fast spell -> item set relationship lookups.';
COMMENT ON MATERIALIZED VIEW app.enchantment_spell_links IS
  'Exploded enchantment spell object slots for fast spell -> enchantment relationship lookups.';
COMMENT ON MATERIALIZED VIEW app.resolved_class_specs IS
  'Resolved class/spec/SkillLine ownership metadata reused by class, skill, and builder reads.';
