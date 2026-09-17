import {
  classCategoryFilters,
  entityDefinitions,
  entityByKind,
  getEntityDetailPath,
  getEntityDetailSlug,
  getEntityDefinition,
  itemCategoryFilters,
  skillCategoryFilters,
  spellSchoolFilters,
  type EntityKind
} from '@/lib/entities';
import { gameClassFromId } from '@/lib/game-class-colors';
import {
  classRelationsFromMetadata,
  creatureRankNames,
  creatureTypeNames,
  firstNumberMeta,
  firstStringMeta,
  itemBindingNames,
  itemQualityNames,
  itemSlotFromMetadata,
  itemTypePartsFromMetadata,
  kindLabel,
  levelRangeFromMetadata,
  powerTypeNames,
  raceRelationsFromMetadata,
  skillCategoryLabels as displaySkillCategoryLabels,
  territoryNames,
  zoneTypeNames
} from '@/lib/game-data-display';
import { cacheJson } from '@/lib/redis';
import { logger } from '@/lib/logger';
import {
  getGamePool,
  getGameSchema,
  hasGameDatabase
} from '@/server/game-data/db';
import { getMockEntities } from '@/server/game-data/mock-data';
import {
  hiddenItemNameFragmentsArraySql,
  hiddenItemNamesArraySql,
  isVisibleGameEntityName
} from '@/server/game-data/visibility';
import type {
  DetailField,
  DetailSection,
  GameEntityDetail,
  GameEntitySummary,
  PaginatedGameEntities,
  PaginationInput,
  RelatedEntityGroup
} from '@/server/game-data/types';
import {
  buildReadableSpellSections,
  ITEM_CREATE_EFFECTS,
  MOD_AURAS,
  renderSpellText,
  TEACH_EFFECTS,
  TRIGGER_AURAS,
  TRIGGER_EFFECTS
} from '@/server/game-data/spell-decoding';
import { iconNameToUrl } from '@/server/game-data/icon-url';
import { getExilItemReference } from '@/server/game-data/exil-reference';

const defaultIconNameByKind: Partial<Record<EntityKind, string>> = {
  items: 'inv_misc_bag_10',
  'item-sets': 'inv_chest_chain_15',
  enchantments: 'spell_holy_greaterheal',
  spells: 'inv_misc_questionmark',
  talents: 'ability_marksmanship',
  quests: 'inv_misc_note_01',
  npcs: 'inv_misc_head_human_01',
  objects: 'inv_crate_05',
  zones: 'inv_misc_map_01',
  factions: 'inv_bannerpvp_02',
  achievements: 'achievement_general',
  classes: 'inv_misc_groupneedmore',
  races: 'achievement_character_human_male',
  skills: 'trade_engineering',
  professions: 'trade_blacksmithing',
  pets: 'ability_hunter_pet_wolf',
  emotes: 'spell_holy_silence',
  currencies: 'inv_misc_coin_01',
  events: 'inv_misc_calendar_01',
  titles: 'inv_misc_ribbon_01',
  icons: 'inv_misc_questionmark',
  mails: 'inv_letter_15',
  sounds: 'inv_misc_note_05'
};

let summaryFunctionsAvailable: boolean | null = null;
let readModelsAvailable: boolean | null = null;
let itemSetItemLinksAvailable: boolean | null = null;
let itemVersionsAvailable: boolean | null = null;

const hiddenItemNamesSql = hiddenItemNamesArraySql();
const hiddenItemNameFragmentsSql = hiddenItemNameFragmentsArraySql();

type SummaryFunctionRow = {
  kind: EntityKind;
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  source_table?: string;
  sourceTable?: string;
  metadata?: Record<string, unknown> | null;
};

type ListFunctionPayload = {
  items?: SummaryFunctionRow[];
  total?: number;
  page?: number;
  pageSize?: number;
};

function quoteIdentifier(identifier: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function visibleItemNameClause(kind: EntityKind, nameSql: string) {
  return kind === 'items'
    ? [
        `btrim(CAST(${nameSql} AS text)) <> ALL (${hiddenItemNamesSql})`,
        `NOT EXISTS (
          SELECT 1
          FROM unnest(${hiddenItemNameFragmentsSql}) hidden_name(fragment)
          WHERE btrim(CAST(${nameSql} AS text)) ILIKE '%' || hidden_name.fragment || '%'
        )`
      ]
    : [];
}

function visibleSummaryNameClause(kindSql: string, nameSql: string) {
  return `(
    ${kindSql} <> 'items'
    OR (
      btrim(CAST(${nameSql} AS text)) <> ALL (${hiddenItemNamesSql})
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(${hiddenItemNameFragmentsSql}) hidden_name(fragment)
        WHERE btrim(CAST(${nameSql} AS text)) ILIKE '%' || hidden_name.fragment || '%'
      )
    )
  )`;
}

function normalizeRow(
  kind: EntityKind,
  sourceTable: string,
  row: Record<string, unknown>
): GameEntitySummary {
  const id = Number(row.id ?? row.entry ?? 0);
  const name =
    typeof row.name === 'string' && row.name.length > 0
      ? row.name
      : `${entityByKind.get(kind)?.singular ?? 'Record'} #${id}`;
  const metadata = rawMetadata(row);
  const ownerClassFileString =
    typeof row.ownerClassFileString === 'string'
      ? row.ownerClassFileString
      : '';
  const ownerSpecIcon =
    typeof row.ownerSpecIcon === 'string' ? row.ownerSpecIcon : '';

  if (ownerClassFileString) {
    metadata.ownerClassIcon = `/game-icons/medium/classicon_${ownerClassFileString.toLowerCase()}.jpg`;
  }

  if (ownerSpecIcon) {
    metadata.ownerSpecIcon = iconNameToUrl(ownerSpecIcon);
  }

  return {
    id,
    kind,
    slug: getEntityDetailSlug(kind, id),
    name,
    description: typeof row.description === 'string' ? row.description : null,
    category:
      typeof row.category === 'string' || typeof row.category === 'number'
        ? String(row.category)
        : null,
    icon:
      kind === 'classes' && typeof row.fileString === 'string' && row.fileString
        ? `/game-icons/medium/classicon_${row.fileString.toLowerCase()}.jpg`
        : iconNameToUrl(
            typeof row.icon === 'string'
              ? row.icon
              : defaultIconNameByKind[kind]
          ),
    metadata,
    sourceTable
  };
}

function normalizeSummaryFunctionRow(row: SummaryFunctionRow): GameEntitySummary {
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (Object.fromEntries(
          Object.entries(row.metadata).filter((entry): entry is [string, string | number | boolean | null] => {
            const [, value] = entry;
            return value === null || ['string', 'number', 'boolean'].includes(typeof value);
          })
        ) as Record<string, string | number | boolean | null>)
      : {};
  const sourceTable =
    row.sourceTable ??
    row.source_table ??
    entityByKind.get(row.kind)?.table ??
    'game_entity_summary';

  return {
    id: Number(row.id),
    kind: row.kind,
    slug: getEntityDetailSlug(row.kind, row.id),
    name: row.name || `${entityByKind.get(row.kind)?.singular ?? 'Record'} #${row.id}`,
    description: row.description ?? null,
    category: row.category == null ? null : String(row.category),
    icon: iconNameToUrl(row.icon ?? defaultIconNameByKind[row.kind]),
    metadata,
    sourceTable
  };
}

async function hasReadModels() {
  if (readModelsAvailable !== null) {
    return readModelsAvailable;
  }

  const pool = getGamePool();
  if (!pool) {
    readModelsAvailable = false;
    return false;
  }

  try {
    const result = await pool.query<{ exists: boolean }>(
      `
        SELECT
          to_regclass('app.game_entity_summary') IS NOT NULL
          AND to_regclass('app.item_spell_links') IS NOT NULL
          AND to_regclass('app.spell_trigger_links') IS NOT NULL AS exists
      `
    );
    readModelsAvailable = result.rows[0]?.exists === true;
  } catch {
    readModelsAvailable = false;
  }

  return readModelsAvailable;
}

async function hasItemSetItemLinks() {
  if (itemSetItemLinksAvailable !== null) {
    return itemSetItemLinksAvailable;
  }

  const pool = getGamePool();
  if (!pool) {
    itemSetItemLinksAvailable = false;
    return false;
  }

  try {
    const result = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('app.itemset_item_links') IS NOT NULL AS exists`
    );
    itemSetItemLinksAvailable = result.rows[0]?.exists === true;
  } catch {
    itemSetItemLinksAvailable = false;
  }

  return itemSetItemLinksAvailable;
}

async function hasItemVersions() {
  if (itemVersionsAvailable !== null) {
    return itemVersionsAvailable;
  }

  const pool = getGamePool();
  if (!pool) {
    itemVersionsAvailable = false;
    return false;
  }

  try {
    const result = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('app.item_versions') IS NOT NULL AS exists`
    );
    itemVersionsAvailable = result.rows[0]?.exists === true;
  } catch {
    itemVersionsAvailable = false;
  }

  return itemVersionsAvailable;
}

async function listGameEntitiesFromFunction(
  kind: EntityKind,
  input: Required<PaginationInput>
): Promise<PaginatedGameEntities | null> {
  if (summaryFunctionsAvailable === false) {
    return null;
  }

  const pool = getGamePool();
  if (!pool) {
    return null;
  }

  try {
    const result = await pool.query<{ payload: ListFunctionPayload }>(
      `
        SELECT app.list_game_entities(
          $1::text,
          $2::text,
          $3::text,
          $4::int,
          $5::int,
          $6::text,
          $7::text
        ) AS payload
      `,
      [
        kind,
        input.query,
        input.category,
        input.page,
        input.pageSize,
        input.sort,
        input.direction
      ]
    );
    const payload = result.rows[0]?.payload;
    summaryFunctionsAvailable = true;
    const items = (payload?.items ?? []).filter((item) =>
      isVisibleGameEntityName(kind, item.name ?? '')
    );

    return {
      items: items.map((item) =>
        normalizeSummaryFunctionRow({ ...item, kind })
      ),
      total: payload?.total ?? 0,
      page: payload?.page ?? input.page,
      pageSize: payload?.pageSize ?? input.pageSize,
      adapter: 'postgres'
    };
  } catch {
    summaryFunctionsAvailable = false;
    return null;
  }
}

function summaryIdsFromWhere(whereSql: string, values: unknown[]) {
  const normalized = whereSql.replace(/\s+/g, ' ').trim();

  if (
    (normalized === 't.id = ANY($1::int[])' ||
      normalized === 't."Id" = ANY($1::int[])') &&
    Array.isArray(values[0])
  ) {
    return (values[0] as unknown[])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  if (
    (normalized === 't.id = $1' || normalized === 't."Id" = $1') &&
    Number.isInteger(Number(values[0]))
  ) {
    return [Number(values[0])];
  }

  return null;
}

async function querySummariesByIdsFromFunction(
  kind: EntityKind,
  ids: number[],
  limit: number
) {
  if (ids.length === 0 || summaryFunctionsAvailable === false) {
    return null;
  }

  const pool = getGamePool();
  if (!pool) {
    return null;
  }

  try {
    const result = await pool.query<SummaryFunctionRow>(
      `
        SELECT kind, id, name, description, category, icon, source_table, metadata
        FROM app.get_game_summaries($1::text, $2::int[], $3::int)
      `,
      [kind, ids, limit]
    );
    summaryFunctionsAvailable = true;
    return result.rows
      .filter((row) => isVisibleGameEntityName(kind, row.name ?? ''))
      .map((row) => normalizeSummaryFunctionRow(row));
  } catch {
    summaryFunctionsAvailable = false;
    return null;
  }
}

const columnCache = new Map<string, Set<string>>();

async function getTableColumns(schemaName: string, tableName: string) {
  const cacheKey = `${schemaName}.${tableName}`;
  const cached = columnCache.get(cacheKey);
  const pool = getGamePool();

  if (cached || !pool) {
    return cached ?? new Set<string>();
  }

  const result = await pool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
    `,
    [schemaName, tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  columnCache.set(cacheKey, columns);
  return columns;
}

function columnExpression(
  columns: Set<string>,
  candidates: string[],
  fallback: string,
  alias = ''
) {
  const column = candidates.find((candidate) => columns.has(candidate));
  return column ? `${alias}${quoteIdentifier(column)}` : fallback;
}

function iconExpression(
  schema: string,
  tableAlias: string,
  columns: Set<string>
) {
  const prefix = `${tableAlias}.`;

  if (columns.has('name') && columns.has('cuFlags')) {
    return `${prefix}"name"`;
  }

  if (columns.has('iconString')) {
    return `${prefix}"iconString"`;
  }

  if (columns.has('icon')) {
    return `${prefix}"icon"`;
  }

  if (columns.has('iconId')) {
    return `(SELECT icon."name" FROM ${schema}.aowow_icons icon WHERE icon.id = ${prefix}"iconId" LIMIT 1)`;
  }

  return 'NULL::text';
}

function categoryExpression(columns: Set<string>, alias = '') {
  return columnExpression(
    columns,
    ['category', 'typeCat', 'class', 'faction'],
    'NULL::text',
    alias
  );
}

function listMetadataColumnNames(kind: EntityKind) {
  const common = [
    'rank',
    'rank_loc0',
    'rank_enUS',
    'level',
    'minLevel',
    'maxLevel',
    'baseLevel',
    'spellLevel',
    'reqClassMask',
    'classMask',
    'allowableClass',
    'requiredLevel',
    'MinLevel',
    'QuestLevel',
    'type',
    'rank',
    'typeCat',
    'categoryId'
  ];

  const byKind: Partial<Record<EntityKind, string[]>> = {
    items: [
      'class',
      'subclass',
      'subClass',
      'inventoryType',
      'InventoryType',
      'slot',
      'quality',
      'Quality',
      'bonding',
      'Bonding',
      'itemset',
      'itemSet',
      'itemSetId',
      'itemLevel',
      'ItemLevel',
      'requiredLevel',
      'RequiredLevel',
      'reqClassMask',
      'allowableClass'
    ],
    spells: [
      'schoolMask',
      'spellFamilyId',
      'rank_loc0',
      'rank',
      'rank_enUS',
      'baseLevel',
      'spellLevel',
      'level',
      'reqClassMask',
      'classMask',
      'allowableClass'
    ],
    talents: [
      'schoolMask',
      'spellFamilyId',
      'rank_loc0',
      'rank',
      'rank_enUS',
      'baseLevel',
      'spellLevel',
      'level',
      'reqClassMask',
      'classMask',
      'allowableClass'
    ],
    quests: ['level', 'QuestLevel', 'requiredLevel', 'MinLevel'],
    npcs: ['minLevel', 'maxLevel', 'type', 'rank'],
    pets: ['minLevel', 'maxLevel', 'type', 'rank'],
    zones: ['minLevel', 'maxLevel', 'levelReq', 'type', 'faction'],
    classes: ['fileString', 'powerType', 'expansion'],
    races: ['fileString', 'side', 'expansion'],
    skills: ['categoryId', 'typeCat', 'description_loc0'],
    professions: ['categoryId', 'typeCat', 'description_loc0']
  };

  return [...new Set([...(byKind[kind] ?? common), ...common])];
}

function listMetadataSelect(kind: EntityKind, columns: Set<string>) {
  return listMetadataColumnNames(kind)
    .filter((column) => columns.has(column))
    .map((column) => `t.${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`)
    .join(',\n      ');
}

async function estimateTableRows(schemaName: string, tableName: string) {
  const pool = getGamePool();
  if (!pool) {
    return 0;
  }

  return cacheJson(`game:${schemaName}:${tableName}:estimated-rows`, 300, async () => {
    const result = await pool.query<{ total: string | number }>(
      `
        SELECT
          CASE
            WHEN stats.n_live_tup > 0 THEN stats.n_live_tup::bigint
            WHEN cls.reltuples > 0 THEN cls.reltuples::bigint
            ELSE 0
          END AS total
        FROM pg_class cls
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        LEFT JOIN pg_stat_all_tables stats ON stats.relid = cls.oid
        WHERE ns.nspname = $1 AND cls.relname = $2
        LIMIT 1
      `,
      [schemaName, tableName]
    );

    return Number(result.rows[0]?.total ?? 0);
  });
}

const skillCategoryLabels = new Map<number, string>([
  [6, 'Proficiency'],
  [7, 'Specialization'],
  [8, 'Armor'],
  [9, 'Racial / Secondary'],
  [10, 'Language'],
  [11, 'Profession']
]);

function skillCategoryId(value: string) {
  const normalized = value.trim().toLowerCase();
  const fromFilter = skillCategoryFilters.find(
    (filter) => filter.key === normalized
  );
  if (fromFilter) {
    return fromFilter.categoryId;
  }

  const numeric = Number(normalized);
  return Number.isInteger(numeric) ? numeric : 0;
}

function skillCategoryLabel(value: number) {
  return (
    skillCategoryLabels.get(value) ?? (value > 0 ? `Category ${value}` : '')
  );
}

function skillCategoryClauses(
  kind: EntityKind,
  input: Required<PaginationInput>,
  columns: Set<string>
) {
  if (!columns.has('categoryId')) {
    return [];
  }

  if (kind === 'professions') {
    return [`t."categoryId" = 11`];
  }

  if (kind !== 'skills') {
    return [];
  }

  const categoryId = skillCategoryId(input.category);
  if (!categoryId) {
    return [];
  }

  const clauses = [`t."categoryId" = ${categoryId}`];
  if (categoryId === 7 && columns.has('name_loc0')) {
    clauses.push(`t."name_loc0" <> ''`);
    clauses.push(`t."name_loc0" NOT ILIKE '!%'`);
    clauses.push(`t."name_loc0" NOT ILIKE 'Pet -%'`);
  }
  return clauses;
}

function itemCategoryClauses(
  kind: EntityKind,
  input: Required<PaginationInput>,
  columns: Set<string>
) {
  if (kind !== 'items' || !columns.has('class')) {
    return [];
  }

  const filter = itemCategoryFilters.find(
    (item) => item.key === input.category
  );
  return filter ? [`t.class = ${filter.classId}`] : [];
}

function classCategoryClauses(
  kind: EntityKind,
  input: Required<PaginationInput>,
  columns: Set<string>
) {
  if (kind !== 'classes' || !columns.has('id')) {
    return [];
  }

  const filter = classCategoryFilters.find(
    (item) => item.key === input.category
  );
  if (!filter) {
    return [`t.id >= 12`];
  }

  return filter.key === 'custom'
    ? [`t.id >= 12`]
    : [`t.id < 12 AND t.id <> 10`];
}

function spellCategoryClauses(
  kind: EntityKind,
  input: Required<PaginationInput>,
  columns: Set<string>,
  schema: string
) {
  if (kind !== 'spells') {
    return [];
  }

  const classId = Number(input.category.replace(/^class-/, ''));
  if (Number.isInteger(classId) && classId > 0 && classId < 12) {
    return ['FALSE'];
  }

  if (input.category === 'passive' && columns.has('attributes0')) {
    return [`(t."attributes0" & 64) <> 0`];
  }

  if (input.category === 'active' && columns.has('attributes0')) {
    return [`(t."attributes0" & 64) = 0`];
  }

  const school = spellSchoolFilters.find(
    (filter) => input.category === `school-${filter.key}`
  );
  if (school && columns.has('schoolMask')) {
    return [`(t."schoolMask" & ${school.mask}) <> 0`];
  }

  if (Number.isInteger(classId) && classId > 0) {
    return [
      `EXISTS (
        SELECT 1
        FROM ${schema}.aowow_spell_owners owner_map
        WHERE owner_map."spellId" = t.id AND owner_map."ownerClassId" = ${classId}
      )`
    ];
  }

  return [];
}

function visibleSpellClauses(
  kind: EntityKind,
  ownerColumns: Set<string>,
  legacyOwnerColumns: Set<string>,
  schema: string
) {
  if (kind !== 'spells') {
    return [];
  }

  if (hasSpellOwnerColumns(ownerColumns)) {
    return [
      `(
        NOT EXISTS (
          SELECT 1
          FROM ${schema}.aowow_spell_owners owner_map
          WHERE owner_map."spellId" = t.id
            AND owner_map."ownerClassId" BETWEEN 1 AND 11
        )
        OR EXISTS (
          SELECT 1
          FROM ${schema}.aowow_spell_owners owner_map
          WHERE owner_map."spellId" = t.id
            AND owner_map."ownerClassId" >= 12
        )
      )`
    ];
  }

  if (hasLegacySpellOwnerColumns(legacyOwnerColumns)) {
    return [
      `(
        NOT EXISTS (
          SELECT 1
          FROM ${schema}.aowow_character_advancement adv
          WHERE t.id IN (
            adv."spellId",
            adv."rank2SpellId",
            adv."rank3SpellId",
            adv."rank4SpellId",
            adv."rank5SpellId"
          )
            AND adv."ownerClassId" BETWEEN 1 AND 11
        )
        OR EXISTS (
          SELECT 1
          FROM ${schema}.aowow_character_advancement adv
          WHERE t.id IN (
            adv."spellId",
            adv."rank2SpellId",
            adv."rank3SpellId",
            adv."rank4SpellId",
            adv."rank5SpellId"
          )
            AND adv."ownerClassId" >= 12
        )
      )`
    ];
  }

  return [];
}

function hasSpellOwnerColumns(columns: Set<string>) {
  return (
    columns.has('spellId') &&
    columns.has('ownerClassId') &&
    columns.has('ownerClassName') &&
    columns.has('ownerSpecId') &&
    columns.has('ownerSpecName') &&
    columns.has('ownerSpecSkillId')
  );
}

function hasLegacySpellOwnerColumns(columns: Set<string>) {
  return (
    columns.has('spellId') &&
    columns.has('rank2SpellId') &&
    columns.has('rank3SpellId') &&
    columns.has('rank4SpellId') &&
    columns.has('rank5SpellId') &&
    columns.has('ownerClassId') &&
    columns.has('ownerClassName') &&
    columns.has('ownerSpecId') &&
    columns.has('ownerSpecName') &&
    columns.has('ownerSpecSkillId')
  );
}

function spellOwnerSelect(enabled: boolean) {
  return enabled
    ? `,
      owner."ownerClassId" AS "ownerClassId",
      owner."ownerClassName" AS "ownerClassName",
      owner."ownerClassFileString" AS "ownerClassFileString",
      owner."ownerSpecId" AS "ownerSpecId",
      owner."ownerSpecName" AS "ownerSpecName",
      owner."ownerSpecSkillId" AS "ownerSpecSkillId",
      owner."ownerSpecIcon" AS "ownerSpecIcon"`
    : '';
}

function spellOwnerJoin(schema: string, enabled: boolean) {
  return enabled
    ? `
      LEFT JOIN LATERAL (
        SELECT
          MIN(NULLIF(owner_map."ownerClassId", 0)) AS "ownerClassId",
          string_agg(DISTINCT NULLIF(owner_map."ownerClassName", ''), ', ') AS "ownerClassName",
          MIN(NULLIF(owner_class."fileString", '')) AS "ownerClassFileString",
          MIN(NULLIF(owner_map."ownerSpecId", 0)) AS "ownerSpecId",
          string_agg(DISTINCT NULLIF(owner_map."ownerSpecName", ''), ', ') AS "ownerSpecName",
          MIN(NULLIF(owner_map."ownerSpecSkillId", 0)) AS "ownerSpecSkillId",
          MIN(NULLIF(spec_icon."name", '')) AS "ownerSpecIcon"
        FROM ${schema}.aowow_spell_owners owner_map
        LEFT JOIN ${schema}.aowow_classes owner_class
          ON owner_class.id = owner_map."ownerClassId"
        LEFT JOIN ${schema}.aowow_skillline owner_spec
          ON owner_spec."Id" = owner_map."ownerSpecSkillId"
        LEFT JOIN ${schema}.aowow_icons spec_icon
          ON spec_icon.id = owner_spec."iconId"
        WHERE owner_map."spellId" = t.id
          AND owner_map."ownerClassId" > 0
          AND (
            NOT EXISTS (
              SELECT 1
              FROM ${schema}.aowow_spell_owners custom_owner
              WHERE custom_owner."spellId" = t.id
                AND custom_owner."ownerClassId" >= 12
            )
            OR owner_map."ownerClassId" >= 12
          )
      ) owner ON true`
    : '';
}

function legacySpellOwnerJoin(schema: string, enabled: boolean) {
  return enabled
    ? `
      LEFT JOIN LATERAL (
        SELECT
          MIN(NULLIF(adv."ownerClassId", 0)) AS "ownerClassId",
          string_agg(DISTINCT NULLIF(adv."ownerClassName", ''), ', ') AS "ownerClassName",
          MIN(NULLIF(owner_class."fileString", '')) AS "ownerClassFileString",
          MIN(NULLIF(adv."ownerSpecId", 0)) AS "ownerSpecId",
          string_agg(DISTINCT NULLIF(adv."ownerSpecName", ''), ', ') AS "ownerSpecName",
          MIN(NULLIF(adv."ownerSpecSkillId", 0)) AS "ownerSpecSkillId",
          MIN(NULLIF(spec_icon."name", '')) AS "ownerSpecIcon"
        FROM ${schema}.aowow_character_advancement adv
        LEFT JOIN ${schema}.aowow_classes owner_class
          ON owner_class.id = adv."ownerClassId"
        LEFT JOIN ${schema}.aowow_skillline owner_spec
          ON owner_spec."Id" = adv."ownerSpecSkillId"
        LEFT JOIN ${schema}.aowow_icons spec_icon
          ON spec_icon.id = owner_spec."iconId"
        WHERE t.id IN (
          adv."spellId",
          adv."rank2SpellId",
          adv."rank3SpellId",
          adv."rank4SpellId",
          adv."rank5SpellId"
        )
          AND adv."ownerClassId" > 0
          AND (
            NOT EXISTS (
              SELECT 1
              FROM ${schema}.aowow_character_advancement custom_owner
              WHERE t.id IN (
                custom_owner."spellId",
                custom_owner."rank2SpellId",
                custom_owner."rank3SpellId",
                custom_owner."rank4SpellId",
                custom_owner."rank5SpellId"
              )
                AND custom_owner."ownerClassId" >= 12
            )
            OR adv."ownerClassId" >= 12
          )
      ) owner ON true`
    : '';
}

function skillSpecOwnerSelect(enabled: boolean) {
  return enabled
    ? `,
      spec_owner."classId" AS "classId",
      spec_owner."className" AS "className",
      spec_owner."classToken" AS "classToken",
      spec_owner."classFileString" AS "ownerClassFileString"`
    : '';
}

function skillSpecOwnerJoin(schema: string, enabled: boolean, idExpr: string) {
  return enabled
    ? `
      LEFT JOIN LATERAL (
        SELECT
          resolved."classId" AS "classId",
          resolved."className" AS "className",
          resolved."classToken" AS "classToken",
          COALESCE(NULLIF(owner_class."fileString", ''), resolved."classToken") AS "classFileString"
        FROM (
          SELECT
            spec."classId",
            spec."className",
            spec."classToken",
            spec."specOrder",
            0 AS source_rank
          FROM ${schema}.aowow_coa_specs spec
          WHERE spec."skillLineId" = ${idExpr}
            AND spec."skillLineId" > 0
            AND spec."classId" > 0
            AND NOT (
              spec."classId" >= 12
              AND EXISTS (
                SELECT 1
                FROM ${schema}.aowow_chr_specs chr_override
                WHERE chr_override."specToken" = spec."specToken"
                  AND chr_override."skillLineId" > 0
                  AND chr_override."skillLineId" <> spec."skillLineId"
                  AND (
                    chr_override."classId" = spec."classId"
                    OR chr_override."classToken" = spec."classToken"
                    OR chr_override."classFileString" = spec."classToken"
                  )
              )
            )
          UNION ALL
          SELECT
            spec."classId",
            spec."className",
            spec."classToken",
            spec."specOrder",
            1 AS source_rank
          FROM ${schema}.aowow_chr_specs chr
          JOIN ${schema}.aowow_coa_specs spec ON spec."specToken" = chr."specToken"
          WHERE chr."skillLineId" = ${idExpr}
            AND chr."skillLineId" > 0
            AND spec."classId" > 0
            AND (
              chr."classId" = spec."classId"
              OR chr."classId" = 0
              OR chr."classToken" = spec."classToken"
              OR chr."classFileString" = spec."classToken"
            )
          UNION ALL
          SELECT
            chr."classId",
            chr."className",
            COALESCE(NULLIF(chr."classFileString", ''), chr."classToken") AS "classToken",
            chr."orderIndex" AS "specOrder",
            2 AS source_rank
          FROM ${schema}.aowow_chr_specs chr
          WHERE chr."skillLineId" = ${idExpr}
            AND chr."skillLineId" > 0
            AND chr."classId" >= 12
            AND NOT EXISTS (
              SELECT 1
              FROM ${schema}.aowow_coa_specs spec
              WHERE spec."classId" = chr."classId"
                AND spec."specToken" = chr."specToken"
            )
        ) resolved
        LEFT JOIN ${schema}.aowow_classes owner_class
          ON owner_class.id = resolved."classId"
        ORDER BY (resolved."classId" >= 12) DESC, resolved.source_rank ASC, resolved."classId" ASC, resolved."specOrder" ASC
        LIMIT 1
      ) spec_owner ON true`
    : '';
}

function isPrimitive(
  value: unknown
): value is string | number | boolean | null {
  return (
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
  );
}

function rawMetadata(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key, value]) => !key.startsWith('__') && isPrimitive(value))
      .map(([key, value]) => [key, value])
  ) as Record<string, string | number | boolean | null>;
}

function spellReferenceIds(row: Record<string, unknown>) {
  const ids = new Set<number>();
  const texts = [row.description_loc0, row.buff_loc0].filter(
    (value): value is string => typeof value === 'string'
  );

  for (const text of texts) {
    for (const match of text.matchAll(/\$(\d+)(?:m|s|ppl|a)\d+/gi)) {
      ids.add(Number(match[1]));
    }
    for (const match of text.matchAll(/\$(\d+)[a-z]\d*/gi)) {
      ids.add(Number(match[1]));
    }
    for (const match of text.matchAll(/\$[*/+\-]\d+;(\d+)[a-z]\d*/gi)) {
      ids.add(Number(match[1]));
    }
    for (const match of text.matchAll(/\$\?s(\d+)\[/gi)) {
      ids.add(Number(match[1]));
    }
  }

  for (const index of [1, 2, 3]) {
    const triggerSpell = numberValue(row, `effect${index}TriggerSpell`);
    if (triggerSpell > 0) ids.add(triggerSpell);
  }

  ids.delete(numberValue(row, 'id'));
  return [...ids].filter((value) => Number.isFinite(value) && value > 0);
}

async function enrichSpellReferences(row: Record<string, unknown>) {
  const ids = spellReferenceIds(row);
  const pool = getGamePool();
  if (ids.length === 0 || !pool) return row;

  const schema = quoteIdentifier(getGameSchema());
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ${schema}.aowow_spell WHERE id = ANY($1::int[])`,
    [ids]
  );
  const refs = Object.fromEntries(
    result.rows.map((item) => [String(item.id), rawMetadata(item)])
  );
  return { ...row, __spellRefsJson: JSON.stringify(refs) };
}

function itemSpellReferenceIds(row: Record<string, unknown>) {
  const ids = new Set<number>();

  for (let index = 1; index <= 5; index += 1) {
    const spellId = numberValue(row, `spellId${index}`);
    if (spellId > 0) ids.add(spellId);
  }

  return [...ids];
}

type ParsedItemSetBlock = {
  name: string;
  count: number;
  total: number;
  pieces: string[];
  bonuses: Array<{ required: number; text: string }>;
};

type ItemSetInfo = ParsedItemSetBlock & {
  id: number;
  pieceIds: number[];
};

function cleanTooltipLine(value: string) {
  return value
    .replace(/\|c[0-9a-f]{8}/gi, '')
    .replace(/\|r/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeSqlLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function baseItemName(value: string) {
  return value.replace(/^(?:Bloodforged\s+)+/i, '').trim();
}

function baseItemNameSql(expression: string) {
  return `regexp_replace(CAST(${expression} AS text), '^(Bloodforged\\s+)+', '', 'i')`;
}

function isBloodforgedNameSql(expression: string) {
  return `CAST(${expression} AS text) ~* '^Bloodforged\\s+'`;
}

function baseOrBloodforgedNameSql(expression: string, parameter: string) {
  return `(
    CAST(${expression} AS text) = ${parameter}
    OR CAST(${expression} AS text) = 'Bloodforged ' || ${parameter}
  )`;
}

function parseItemSetTooltipBlock(value: string): ParsedItemSetBlock | null {
  const lines = value
    .split(/\r?\n/)
    .map(cleanTooltipLine)
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) =>
    /^.+\s+\(\d+\/\d+\)$/.test(line)
  );

  if (headerIndex < 0) {
    return null;
  }

  const header = lines[headerIndex] ?? '';
  const headerMatch = header.match(/^(.+?)\s+\((\d+)\/(\d+)\)$/);
  if (!headerMatch) {
    return null;
  }

  const pieces: string[] = [];
  const bonuses: Array<{ required: number; text: string }> = [];
  let readingBonuses = false;

  for (const line of lines.slice(headerIndex + 1)) {
    if (/^Sell Price:/i.test(line) || /^.+\s+\(\d+\/\d+\)$/.test(line)) {
      break;
    }

    const bonusMatch = line.match(/^\((\d+)\)\s+Set:\s*(.+)$/i);
    if (bonusMatch) {
      readingBonuses = true;
      const required = Number(bonusMatch[1]);
      bonuses.push({
        required: Number.isFinite(required) ? required : 0,
        text: line
      });
      continue;
    }

    if (readingBonuses) {
      break;
    }

    if (!/^(Equip|Use|Chance on hit|Requires|Item Level):?/i.test(line)) {
      pieces.push(line);
    }
  }

  if (pieces.length === 0 && bonuses.length === 0) {
    return null;
  }

  return {
    name: headerMatch[1]?.trim() ?? '',
    count: Number(headerMatch[2] ?? 0),
    total: Number(headerMatch[3] ?? 0),
    pieces,
    bonuses
  };
}

function itemSetIdsFromRow(row: Record<string, unknown>) {
  const ids: number[] = [];
  for (let index = 1; index <= 10; index += 1) {
    const id = numberValue(row, `item${index}`);
    if (id > 0) ids.push(id);
  }
  return ids;
}

function itemSetBonusesFromRow(row: Record<string, unknown>) {
  const bonuses: Array<{ required: number; spellId: number; text: string }> = [];
  for (let index = 1; index <= 8; index += 1) {
    const spellId = numberValue(row, `spell${index}`);
    const required = numberValue(row, `bonus${index}`);
    if (spellId > 0 && required > 0) {
      bonuses.push({ required, spellId, text: '' });
    }
  }
  return bonuses;
}

async function itemSetBlockFromVersionTooltip(row: Record<string, unknown>) {
  const pool = getGamePool();
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const baseName = baseItemName(name);
  if (!pool || !baseName) {
    return null;
  }

  const schema = quoteIdentifier(getGameSchema());
  const result = await pool.query<{ tooltip_text: string }>(
    `
      SELECT tooltip.tooltip_text
      FROM ${schema}.aowow_items item
      JOIN app.item_tooltips tooltip
        ON tooltip.item_id = item.id
      WHERE ${baseOrBloodforgedNameSql('item.name_loc0', '$1')}
        AND COALESCE(substring(tooltip.tooltip_text from '([^\\n]+) \\([0-9]+/[0-9]+\\)'), '') <> ''
        AND ${visibleItemNameClause('items', 'item.name_loc0').join(' AND ')}
      ORDER BY
        ${isBloodforgedNameSql('item.name_loc0')} ASC,
        item."itemLevel" NULLS LAST,
        item.id
      LIMIT 1
    `,
    [baseName]
  );

  const tooltipText = result.rows[0]?.tooltip_text;
  return tooltipText ? parseItemSetTooltipBlock(tooltipText) : null;
}

async function resolveItemSetPieces(
  pieceNames: string[],
  fallbackIds: number[]
) {
  if (fallbackIds.length > 0) {
    return [...new Set(fallbackIds)];
  }

  const pool = getGamePool();
  if (!pool || pieceNames.length === 0) {
    return [];
  }

  const schema = quoteIdentifier(getGameSchema());
  const result = await pool.query<{ id: number; ord: number }>(
    `
      WITH names(name, ord) AS (
        SELECT *
        FROM unnest($1::text[]) WITH ORDINALITY
      )
      SELECT DISTINCT ON (names.ord)
        item.id,
        names.ord::int AS ord
      FROM names
      JOIN ${schema}.aowow_items item
        ON (
          item.name_loc0 = names.name
          OR item.name_loc0 = 'Bloodforged ' || names.name
        )
      WHERE ${visibleItemNameClause('items', 'item.name_loc0').join(' AND ')}
      ORDER BY
        names.ord,
        ${isBloodforgedNameSql('item.name_loc0')} ASC,
        item."itemLevel" NULLS LAST,
        item.id
    `,
    [pieceNames]
  );

  return result.rows.map((row) => row.id);
}

async function itemSetTooltipItemIds(setName: string, limit = 240) {
  const pool = getGamePool();
  if (!pool || !setName) {
    return [];
  }

  if (await hasItemSetItemLinks()) {
    try {
      const result = await pool.query<{ id: number }>(
        `
          WITH candidates AS (
            SELECT
              candidate.id,
              ${baseItemNameSql('candidate.name_loc0')} AS base_name,
              ${isBloodforgedNameSql('candidate.name_loc0')} AS is_bloodforged,
              candidate.slot,
              candidate."itemLevel" AS item_level
            FROM app.itemset_item_links link
            JOIN ${quoteIdentifier(getGameSchema())}.aowow_items item
              ON item.id = link.item_id
            JOIN ${quoteIdentifier(getGameSchema())}.aowow_items candidate
              ON (
                candidate.name_loc0 = ${baseItemNameSql('item.name_loc0')}
                OR candidate.name_loc0 = 'Bloodforged ' || ${baseItemNameSql('item.name_loc0')}
              )
            WHERE lower(link.set_name) = lower($1)
              AND ${visibleItemNameClause('items', 'candidate.name_loc0').join(' AND ')}
          ),
          canonical AS (
            SELECT DISTINCT ON (lower(base_name))
              id,
              base_name,
              slot,
              item_level
            FROM candidates
            ORDER BY
              lower(base_name),
              is_bloodforged ASC,
              item_level NULLS LAST,
              id
          )
          SELECT id
          FROM canonical
          ORDER BY
            slot NULLS LAST,
            lower(base_name),
            item_level NULLS LAST,
            id
          LIMIT $2
        `,
        [setName, limit]
      );

      return result.rows.map((row) => row.id);
    } catch {
      itemSetItemLinksAvailable = false;
    }
  }

  const schema = quoteIdentifier(getGameSchema());
  const result = await pool.query<{ id: number }>(
    `
      WITH candidates AS (
        SELECT
          candidate.id,
          ${baseItemNameSql('candidate.name_loc0')} AS base_name,
          ${isBloodforgedNameSql('candidate.name_loc0')} AS is_bloodforged,
          candidate.slot,
          candidate."itemLevel" AS item_level
        FROM app.item_tooltips tooltip
        JOIN ${schema}.aowow_items item
          ON item.id = tooltip.item_id
        JOIN ${schema}.aowow_items candidate
          ON (
            candidate.name_loc0 = ${baseItemNameSql('item.name_loc0')}
            OR candidate.name_loc0 = 'Bloodforged ' || ${baseItemNameSql('item.name_loc0')}
          )
        WHERE tooltip.tooltip_text ILIKE $3 ESCAPE '\\'
          AND lower(COALESCE(substring(tooltip.tooltip_text from '([^\\n]+) \\([0-9]+/[0-9]+\\)'), '')) = lower($1)
          AND ${visibleItemNameClause('items', 'candidate.name_loc0').join(' AND ')}
      ),
      canonical AS (
        SELECT DISTINCT ON (lower(base_name))
          id,
          base_name,
          slot,
          item_level
        FROM candidates
        ORDER BY
          lower(base_name),
          is_bloodforged ASC,
          item_level NULLS LAST,
          id
      )
      SELECT id
      FROM canonical
      ORDER BY
        slot NULLS LAST,
        lower(base_name),
        item_level NULLS LAST,
        id
      LIMIT $2
    `,
    [setName, limit, `%${escapeSqlLikePattern(setName)} (%/%`]
  );

  return result.rows.map((row) => row.id);
}

async function itemSetInfo(
  row: Record<string, unknown>,
  tooltipText?: string
): Promise<ItemSetInfo | null> {
  const pool = getGamePool();
  if (!pool) {
    return null;
  }

  const parsed =
    (tooltipText ? parseItemSetTooltipBlock(tooltipText) : null) ??
    (await itemSetBlockFromVersionTooltip(row));
  const explicitItemSetId = numberValue(row, 'itemset');
  const schema = quoteIdentifier(getGameSchema());
  const values: unknown[] = [];
  const where = explicitItemSetId > 0
    ? 'itemset.id = $1'
    : parsed?.name
      ? 'lower(itemset.name_loc0) = lower($1)'
      : '';

  if (!where) {
    return null;
  }

  values.push(explicitItemSetId > 0 ? explicitItemSetId : parsed?.name);
  const resolvedPiecesPromise = parsed?.pieces.length
    ? resolveItemSetPieces(parsed.pieces, [])
    : Promise.resolve<number[]>([]);
  const result = await pool.query<Record<string, unknown>>(
    `
      SELECT *
      FROM ${schema}.aowow_itemset itemset
      WHERE ${where}
      ORDER BY itemset.id
      LIMIT 1
    `,
    values
  );
  const itemSet = result.rows[0];

  if (!itemSet) {
    return null;
  }

  const fallbackIds = itemSetIdsFromRow(itemSet);
  const resolvedPieces = await resolvedPiecesPromise;
  const pieceIds = resolvedPieces.length
    ? resolvedPieces
    : await resolveItemSetPieces([], fallbackIds);
  const setName =
    parsed?.name ||
    (typeof itemSet.name_loc0 === 'string' ? itemSet.name_loc0 : '');
  const allTooltipItemIds = pieceIds.length
    ? []
    : await itemSetTooltipItemIds(setName);
  const bonuses = parsed?.bonuses.length
    ? parsed.bonuses
    : itemSetBonusesFromRow(itemSet).map((bonus) => ({
        required: bonus.required,
        text: `(${bonus.required}) Set: Spell #${bonus.spellId}`
      }));

  return {
    id: numberValue(itemSet, 'id'),
    name: setName,
    count: parsed?.count ?? 0,
    total: parsed?.total || pieceIds.length || allTooltipItemIds.length,
    pieces: parsed?.pieces ?? [],
    bonuses,
    pieceIds: pieceIds.length ? pieceIds : allTooltipItemIds
  };
}

function itemSummaryVersionSortValue(item: GameEntitySummary) {
  return (
    firstNumberMeta(item.metadata, ['itemLevel', 'ItemLevel']) * 10000 +
    firstNumberMeta(item.metadata, ['requiredLevel', 'RequiredLevel']) * 100 +
    item.id
  );
}

function sortItemVersions(items: GameEntitySummary[]) {
  return [...items].sort(
    (left, right) =>
      itemSummaryVersionSortValue(left) - itemSummaryVersionSortValue(right)
  );
}

async function queryItemVersionsByBaseName(
  currentItemId: number,
  baseName: string,
  limit = 240
) {
  const definition = getEntityDefinition('items');
  const pool = getGamePool();
  if (!definition || !pool || !baseName) {
    return [];
  }

  if ((await hasItemVersions()) && (await hasReadModels())) {
    try {
      const result = await pool.query<SummaryFunctionRow>(
        `
          SELECT
            summary.kind,
            summary.id,
            summary.name,
            summary.description,
            summary.category,
            summary.icon,
            summary.source_table,
            summary.metadata
          FROM app.item_versions version
          JOIN app.game_entity_summary summary
            ON summary.kind = 'items'
            AND summary.id = version.item_id
          WHERE version.item_id <> $1
            AND version.base_item_name = $2
            AND ${visibleSummaryNameClause('summary.kind', 'summary.name')}
          ORDER BY
            version.item_level NULLS LAST,
            version.required_level NULLS LAST,
            version.item_id
          LIMIT $3
        `,
        [currentItemId, baseName, limit]
      );

      return result.rows.map((row) => normalizeSummaryFunctionRow(row));
    } catch {
      itemVersionsAvailable = false;
    }
  }

  const schemaName = getGameSchema();
  const schema = quoteIdentifier(schemaName);
  const columns = await getTableColumns(schemaName, definition.table);
  const idExpr = columnExpression(columns, ['id', 'Id', 'entry'], '', 't.');
  if (!idExpr) {
    return [];
  }

  const nameExpr = columnExpression(
    columns,
    ['name_loc0', 'name'],
    `${idExpr}::text`,
    't.'
  );
  const descriptionExpr = columnExpression(
    columns,
    ['description_loc0', 'description'],
    'NULL::text',
    't.'
  );
  const categoryExpr = categoryExpression(columns, 't.');
  const iconExpr = iconExpression(schema, 't', columns);
  const itemLevelExpr = columns.has('itemLevel')
    ? 't."itemLevel"'
    : columns.has('ItemLevel')
      ? 't."ItemLevel"'
      : '0';
  const requiredLevelExpr = columns.has('requiredLevel')
    ? 't."requiredLevel"'
    : columns.has('RequiredLevel')
      ? 't."RequiredLevel"'
      : '0';

  const result = await pool.query<Record<string, unknown>>(
    `
      SELECT
        t.*,
        ${idExpr} AS id,
        CAST(COALESCE(${nameExpr}, ${idExpr}::text) AS text) AS name,
        CAST(${descriptionExpr} AS text) AS description,
        CAST(${categoryExpr} AS text) AS category,
        CAST(${iconExpr} AS text) AS icon
      FROM ${schema}.${quoteIdentifier(definition.table)} t
      WHERE ${idExpr} <> $1
        AND ${baseOrBloodforgedNameSql(nameExpr, '$2')}
        ${visibleItemNameClause('items', nameExpr).map((clause) => `AND ${clause}`).join('\n        ')}
      ORDER BY
        ${itemLevelExpr} NULLS LAST,
        ${requiredLevelExpr} NULLS LAST,
        ${idExpr}
      LIMIT $3
    `,
    [currentItemId, baseName, limit]
  );

  return result.rows.map((item) =>
    normalizeRow('items', definition.table, item)
  );
}

async function enrichItemSpellReferences(row: Record<string, unknown>) {
  const ids = itemSpellReferenceIds(row);
  const pool = getGamePool();
  if (ids.length === 0 || !pool) return row;

  const schema = quoteIdentifier(getGameSchema());
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ${schema}.aowow_spell WHERE id = ANY($1::int[])`,
    [ids]
  );
  const refs = Object.fromEntries(
    result.rows.map((item) => [String(item.id), rawMetadata(item)])
  );
  return { ...row, __itemSpellRefsJson: JSON.stringify(refs) };
}

async function itemTooltipEffects(itemId: number) {
  const pool = getGamePool();
  if (!pool) return [];

  const columns = await getTableColumns('app', 'item_tooltip_effects');
  if (
    !columns.has('item_id') ||
    !columns.has('effect_kind') ||
    !columns.has('effect_label') ||
    !columns.has('effect_text') ||
    !columns.has('raw_line')
  ) {
    return [];
  }

  const result = await pool.query<{
    effect_kind: string;
    effect_label: string;
    effect_text: string;
    raw_line: string;
  }>(
    `
      SELECT effect_kind, effect_label, effect_text, raw_line
      FROM app.item_tooltip_effects
      WHERE item_id = $1
      ORDER BY effect_index
    `,
    [itemId]
  );

  return result.rows.map((row) => ({
    kind: row.effect_kind,
    label: row.effect_label,
    text: row.effect_text,
    line: row.raw_line
  }));
}

async function itemTooltipSnapshot(itemId: number) {
  const pool = getGamePool();
  if (!pool) return null;

  const columns = await getTableColumns('app', 'item_tooltips');
  if (
    !columns.has('item_id') ||
    !columns.has('tooltip_text') ||
    !columns.has('tooltip_lines')
  ) {
    return null;
  }

  const result = await pool.query<{
    tooltip_text: string;
    tooltip_lines: unknown;
    tooltip_captured?: boolean;
    captured_at?: string | number | null;
  }>(
    `
      SELECT tooltip_text, tooltip_lines, tooltip_captured, captured_at
      FROM app.item_tooltips
      WHERE item_id = $1
      LIMIT 1
    `,
    [itemId]
  );

  return result.rows[0] ?? null;
}

async function cachedItemExtras(row: Record<string, unknown>, itemId: number) {
  if (Object.hasOwn(row, '__itemExtrasPromise')) {
    return row.__itemExtrasPromise as Promise<void>;
  }

  const promise = (async () => {
    const pool = getGamePool();
    if (!pool) {
      row.__itemTooltipSnapshot = null;
      row.__itemTooltipEffects = [];
      return;
    }

    const [tooltipColumns, effectColumns] = await Promise.all([
      getTableColumns('app', 'item_tooltips'),
      getTableColumns('app', 'item_tooltip_effects')
    ]);
    const canLoadTooltip =
      tooltipColumns.has('item_id') &&
      tooltipColumns.has('tooltip_text') &&
      tooltipColumns.has('tooltip_lines');
    const canLoadEffects =
      effectColumns.has('item_id') &&
      effectColumns.has('effect_kind') &&
      effectColumns.has('effect_label') &&
      effectColumns.has('effect_text') &&
      effectColumns.has('raw_line');

    if (!canLoadTooltip && !canLoadEffects) {
      row.__itemTooltipSnapshot = null;
      row.__itemTooltipEffects = [];
      return;
    }

    const result = await pool.query<{
      tooltip_text: string | null;
      tooltip_lines: unknown;
      tooltip_captured?: boolean | null;
      captured_at?: string | number | null;
      effects: Array<{
        kind: string;
        label: string;
        text: string;
        line: string;
      }> | null;
    }>(
      `
        SELECT
          ${
            canLoadTooltip
              ? `tooltip.tooltip_text, tooltip.tooltip_lines, tooltip.tooltip_captured, tooltip.captured_at`
              : `NULL::text AS tooltip_text, NULL::jsonb AS tooltip_lines, NULL::boolean AS tooltip_captured, NULL::bigint AS captured_at`
          },
          ${
            canLoadEffects
              ? `COALESCE(effect_rows.effects, '[]'::jsonb)`
              : `'[]'::jsonb`
          } AS effects
        FROM (VALUES ($1::int)) item(id)
        ${
          canLoadTooltip
            ? `LEFT JOIN app.item_tooltips tooltip ON tooltip.item_id = item.id`
            : ''
        }
        ${
          canLoadEffects
            ? `LEFT JOIN LATERAL (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'kind', effect.effect_kind,
                    'label', effect.effect_label,
                    'text', effect.effect_text,
                    'line', effect.raw_line
                  )
                  ORDER BY effect.effect_index
                ) AS effects
                FROM app.item_tooltip_effects effect
                WHERE effect.item_id = item.id
              ) effect_rows ON true`
            : ''
        }
        LIMIT 1
      `,
      [itemId]
    );
    const data = result.rows[0];

    row.__itemTooltipSnapshot =
      data?.tooltip_text && canLoadTooltip
        ? {
            tooltip_text: data.tooltip_text,
            tooltip_lines: data.tooltip_lines,
            tooltip_captured: data.tooltip_captured ?? undefined,
            captured_at: data.captured_at ?? null
          }
        : null;
    row.__itemTooltipEffects = Array.isArray(data?.effects)
      ? data.effects
      : [];
  })();

  row.__itemExtrasPromise = promise;
  return promise;
}

async function cachedItemTooltipSnapshot(
  row: Record<string, unknown>,
  itemId: number
) {
  if (
    !Object.hasOwn(row, '__itemTooltipSnapshot') &&
    Object.hasOwn(row, '__itemExtrasPromise')
  ) {
    await (row.__itemExtrasPromise as Promise<void>);
  }

  if (!Object.hasOwn(row, '__itemTooltipSnapshot')) {
    row.__itemTooltipSnapshot = await itemTooltipSnapshot(itemId);
  }

  return row.__itemTooltipSnapshot as Awaited<
    ReturnType<typeof itemTooltipSnapshot>
  >;
}

async function cachedItemSetInfo(
  row: Record<string, unknown>,
  tooltipText?: string
) {
  if (!Object.hasOwn(row, '__itemSetInfo')) {
    row.__itemSetInfo = await itemSetInfo(row, tooltipText);
  }

  return row.__itemSetInfo as ItemSetInfo | null;
}

async function cachedItemTooltipEffects(
  row: Record<string, unknown>,
  itemId: number
) {
  if (
    !Object.hasOwn(row, '__itemTooltipEffects') &&
    Object.hasOwn(row, '__itemExtrasPromise')
  ) {
    await (row.__itemExtrasPromise as Promise<void>);
  }

  if (!Object.hasOwn(row, '__itemTooltipEffects')) {
    row.__itemTooltipEffects = await itemTooltipEffects(itemId);
  }

  return row.__itemTooltipEffects as Awaited<
    ReturnType<typeof itemTooltipEffects>
  >;
}

function labelize(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return isPrimitive(value) ? value : null;
}

function numberValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function signedClassMaskBit(classId: number) {
  const mask = classId > 0 ? 2 ** (classId - 1) : 0;
  return mask > 0x7fffffff ? mask - 0x100000000 : mask;
}

function field(
  row: Record<string, unknown>,
  key: string,
  label = labelize(key)
): DetailField {
  return { label, value: readValue(row, key) };
}

function compactFields(fields: DetailField[]) {
  return fields.filter((item) => item.value !== null && item.value !== '');
}

function compactReadableFields(fields: DetailField[]) {
  return fields.filter(
    (item) =>
      item.value !== null &&
      item.value !== '' &&
      item.value !== 0 &&
      item.value !== 'n/a' &&
      item.value !== 'None'
  );
}

function linkedRelationField(
  label: string,
  relations: Array<{ id: number; name: string }>,
  basePath: string,
  unrestricted = 'Any'
): DetailField {
  if (relations.length === 1) {
    return {
      label,
      value: relations[0].name,
      href: `${basePath}/${relations[0].id}`
    };
  }

  if (relations.length > 1) {
    return {
      label: `${label}s`,
      value: relations.map((item) => item.name).join(', ')
    };
  }

  return { label, value: unrestricted };
}

function buildZoneSections(
  row: Record<string, unknown>,
  spawnCounts: DetailField[]
): DetailSection[] {
  const metadata = rawMetadata(row);
  const zoneType = firstNumberMeta(metadata, ['type']);
  const territory = firstNumberMeta(metadata, ['faction']);
  return [
    {
      id: 'zone-core',
      title: 'Zone',
      fields: compactReadableFields([
        { label: 'Level Range', value: levelRangeFromMetadata(metadata) },
        { label: 'Territory', value: territoryNames[territory] ?? '' },
        { label: 'Instance Type', value: zoneTypeNames[zoneType] ?? '' },
        {
          label: 'Player Cap',
          value: firstNumberMeta(metadata, ['maxPlayer']) || null
        },
        {
          label: 'Expansion',
          value: firstNumberMeta(metadata, ['expansion']) || 'Classic'
        }
      ])
    },
    {
      id: 'zone-levels',
      title: 'Levels And Entry',
      fields: compactReadableFields([
        {
          label: 'Required Level',
          value: firstNumberMeta(metadata, ['levelReq']) || null
        },
        {
          label: 'LFG Level',
          value: firstNumberMeta(metadata, ['levelReqLFG']) || null
        },
        {
          label: 'Heroic Level',
          value: firstNumberMeta(metadata, ['levelHeroic']) || null
        },
        {
          label: 'Normal Item Level',
          value: firstNumberMeta(metadata, ['itemLevelReqN']) || null
        },
        {
          label: 'Heroic Item Level',
          value: firstNumberMeta(metadata, ['itemLevelReqH']) || null
        },
        field(row, 'attunementsN', 'Normal Attunement'),
        field(row, 'attunementsH', 'Heroic Attunement')
      ])
    },
    {
      id: 'zone-map',
      title: 'Map And Spawn Data',
      fields: compactReadableFields([...spawnCounts])
    }
  ];
}

async function classDataCounts(classId: number): Promise<DetailField[]> {
  const pool = getGamePool();
  if (!pool) return [];

  const schema = quoteIdentifier(getGameSchema());
  try {
    const result = await pool.query<{
      specs: number;
      tree_nodes: number;
      skill_abilities: number;
      owned_spells: number;
      talents: number;
    }>(
      `
        SELECT
          (
            SELECT COUNT(DISTINCT id)::int
            FROM (
              SELECT COALESCE(
                CASE WHEN spec."classId" >= 12 THEN NULLIF(chr."skillLineId", 0) END,
                NULLIF(spec."skillLineId", 0),
                NULLIF(chr."skillLineId", 0),
                spec.id
              ) AS id
              FROM ${schema}.aowow_coa_specs spec
              LEFT JOIN ${schema}.aowow_chr_specs chr
                ON chr."specToken" = spec."specToken"
                AND chr."skillLineId" > 0
                AND (
                  chr."classId" = spec."classId"
                  OR chr."classId" = 0
                  OR chr."classToken" = spec."classToken"
                  OR chr."classFileString" = spec."classToken"
                )
              WHERE spec."classId" = $1
              UNION
              SELECT chr."skillLineId" AS id
              FROM ${schema}.aowow_chr_specs chr
              WHERE chr."classId" = $1
                AND chr."skillLineId" > 0
                AND NOT EXISTS (
                  SELECT 1
                  FROM ${schema}.aowow_coa_specs spec
                  WHERE spec."classId" = chr."classId"
                    AND spec."specToken" = chr."specToken"
              )
            ) ids
          ) AS specs,
          (SELECT COUNT(*)::int FROM ${schema}.aowow_character_advancement WHERE "ownerClassId" = $1) AS tree_nodes,
          (SELECT COUNT(*)::int FROM ${schema}.aowow_skill_line_abilities WHERE "ownerClassId" = $1) AS skill_abilities,
          (SELECT COUNT(DISTINCT "spellId")::int FROM ${schema}.aowow_spell_owners WHERE "ownerClassId" = $1) AS owned_spells,
          (SELECT COUNT(*)::int FROM ${schema}.aowow_talents WHERE class = $1) AS talents
      `,
      [classId]
    );
    const counts = result.rows[0];
    return [
      { label: 'Specializations', value: counts?.specs ?? 0 },
      { label: 'Advancement tree nodes', value: counts?.tree_nodes ?? 0 },
      { label: 'Skill-line abilities', value: counts?.skill_abilities ?? 0 },
      { label: 'Owned spells', value: counts?.owned_spells ?? 0 },
      { label: 'Talents', value: counts?.talents ?? 0 }
    ];
  } catch {
    return [];
  }
}

async function classSpecRows(classId: number): Promise<DetailSection[]> {
  const pool = getGamePool();
  if (!pool) return [];

  const schema = quoteIdentifier(getGameSchema());
  const classColor = gameClassFromId(classId)?.color;
  try {
    const result = await pool.query<Record<string, unknown>>(
      `
        WITH resolved_specs AS (
          SELECT
            spec.id,
            spec.name AS "clientName",
            spec."specToken",
            spec."primaryStat",
            COALESCE(
              CASE WHEN spec."classId" >= 12 THEN NULLIF(chr."skillLineId", 0) END,
              NULLIF(spec."skillLineId", 0),
              NULLIF(chr."skillLineId", 0),
              0
            ) AS "skillLineId",
            COALESCE(
              CASE WHEN spec."classId" >= 12 THEN NULLIF(chr."skillLineName", '') END,
              NULLIF(spec."skillLineName", ''),
              NULLIF(chr."skillLineName", ''),
              ''
            ) AS "skillLineName",
            spec."thumbnailAtlas",
            spec."backgroundAtlas",
            spec."specOrder"
          FROM ${schema}.aowow_coa_specs spec
          LEFT JOIN LATERAL (
            SELECT
              chr.name,
              chr."skillLineId",
              chr."skillLineName"
            FROM ${schema}.aowow_chr_specs chr
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
          WHERE spec."classId" = $1
          UNION ALL
          SELECT
            chr.id,
            chr.name AS "clientName",
            chr."specToken",
            '' AS "primaryStat",
            chr."skillLineId",
            chr."skillLineName",
            '' AS "thumbnailAtlas",
            '' AS "backgroundAtlas",
            chr."orderIndex" AS "specOrder"
          FROM ${schema}.aowow_chr_specs chr
          WHERE chr."classId" = $1
            AND chr."skillLineId" > 0
            AND NOT EXISTS (
              SELECT 1
              FROM ${schema}.aowow_coa_specs spec
              WHERE spec."classId" = chr."classId"
                AND spec."specToken" = chr."specToken"
            )
        )
        SELECT
          resolved."clientName",
          resolved."specToken",
          resolved."primaryStat",
          resolved."skillLineId",
          resolved."skillLineName",
          resolved."thumbnailAtlas",
          resolved."backgroundAtlas",
          resolved."specOrder"
        FROM resolved_specs resolved
        ORDER BY resolved."specOrder"
      `,
      [classId]
    );

    if (result.rows.length === 0) {
      return [];
    }

    return [
      {
        id: 'class-specializations',
        title: 'Specializations',
        description:
          'Client Lua CoA specs linked back to SkillLine category 7 when a skill line exists.',
        rows: result.rows.map((item) => {
          const skillLineName =
            typeof item.skillLineName === 'string' ? item.skillLineName : '';
          const clientName =
            typeof item.clientName === 'string' ? item.clientName : '';
          return {
            label: skillLineName || clientName,
            fields: compactFields([
              {
                label: 'Client spec',
                value:
                  clientName && clientName !== skillLineName ? clientName : ''
              },
              {
                label: 'Token',
                value: typeof item.specToken === 'string' ? item.specToken : ''
              },
              {
                label: 'Primary stat',
                value:
                  typeof item.primaryStat === 'string' ? item.primaryStat : ''
              },
              {
                label: 'Skill',
                value:
                  skillLineName || numberValue(item, 'skillLineId') || null,
                href:
                  numberValue(item, 'skillLineId') > 0
                    ? getEntityDetailPath('skills', numberValue(item, 'skillLineId'))
                    : undefined,
                color: classColor
              },
              {
                label: 'Thumbnail',
                value:
                  typeof item.thumbnailAtlas === 'string'
                    ? item.thumbnailAtlas
                    : ''
              },
              {
                label: 'Background',
                value:
                  typeof item.backgroundAtlas === 'string'
                    ? item.backgroundAtlas
                    : ''
              }
            ])
          };
        })
      }
    ];
  } catch {
    return [];
  }
}

function buildSkillSections(row: Record<string, unknown>): DetailSection[] {
  const metadata = rawMetadata(row);
  const categoryId =
    numberValue(row, 'categoryId') || numberValue(row, 'typeCat');
  const className = firstStringMeta(metadata, ['className']);
  const classId = firstNumberMeta(metadata, ['classId']);
  return [
    {
      id: 'skill-core',
      title: 'Skill Line',
      fields: compactReadableFields([
        {
          label: 'Category',
          value:
            displaySkillCategoryLabels[categoryId] ??
            skillCategoryLabel(categoryId)
        },
        className
          ? { label: 'Class', value: className, href: getEntityDetailPath('classes', classId) }
          : { label: 'Class', value: '' },
        field(row, 'description_loc0', 'Description')
      ])
    }
  ];
}

async function itemSetBonusRows(row: Record<string, unknown>) {
  const pool = getGamePool();
  const schema = quoteIdentifier(getGameSchema());
  const bonusRows = itemSetBonusesFromRow(row);
  if (!pool || bonusRows.length === 0) {
    return [];
  }

  const spellIds = bonusRows.map((bonus) => bonus.spellId);
  const result = await pool.query<Record<string, unknown>>(
    `
      SELECT *
      FROM ${schema}.aowow_spell
      WHERE id = ANY($1::int[])
    `,
    [spellIds]
  );
  const spells = new Map(result.rows.map((spell) => [numberValue(spell, 'id'), spell]));

  return bonusRows.map((bonus) => {
    const spell = spells.get(bonus.spellId);
    const name = spell
      ? typeof spell.name_loc0 === 'string' && spell.name_loc0
        ? spell.name_loc0
        : `Spell #${bonus.spellId}`
      : `Spell #${bonus.spellId}`;
    const description =
      spell && typeof spell.description_loc0 === 'string'
        ? renderSpellText(rawMetadata(spell), spell.description_loc0)
        : '';

    return {
      label: `(${bonus.required}) Set`,
      fields: compactReadableFields([
        {
          label: 'Bonus',
          value: description || name,
          href: getEntityDetailPath('spells', bonus.spellId)
        },
        {
          label: 'Required Pieces',
          value: bonus.required
        }
      ])
    };
  });
}

async function buildItemSetSections(row: Record<string, unknown>): Promise<DetailSection[]> {
  const itemIds = itemSetIdsFromRow(row);
  const setName = typeof row.name === 'string'
    ? row.name
    : typeof row.name_loc0 === 'string'
      ? row.name_loc0
      : '';
  const tooltipItemIds = itemIds.length ? [] : await itemSetTooltipItemIds(setName);
  const bonusRows = await itemSetBonusRows(row);

  return [
    {
      id: 'itemset-overview',
      title: 'Item Set',
      fields: compactReadableFields([
        { label: 'Set ID', value: numberValue(row, 'id') || null },
        {
          label: 'Known Items',
          value: itemIds.length || tooltipItemIds.length || null
        },
        {
          label: 'Source',
          value: itemIds.length
            ? 'ItemSet.dbc item columns'
            : tooltipItemIds.length
              ? 'Captured item tooltips'
              : ''
        }
      ])
    },
    ...(bonusRows.length
      ? [
          {
            id: 'itemset-bonuses',
            title: 'Set Bonuses',
            rows: bonusRows
          }
        ]
      : [])
  ];
}

function buildReadableOverviewFields(
  kind: EntityKind,
  row: Record<string, unknown>
): DetailField[] {
  const metadata = rawMetadata(row);
  const classField = linkedRelationField(
    'Class',
    classRelationsFromMetadata(metadata),
    '/classes'
  );
  const raceField = linkedRelationField(
    'Race',
    raceRelationsFromMetadata(metadata),
    '/races'
  );

  if (kind === 'items') {
    const quality = firstNumberMeta(metadata, ['quality', 'Quality']);
    const binding = firstNumberMeta(metadata, ['bonding', 'Bonding']);
    return compactReadableFields([
      { label: 'Type', value: itemTypePartsFromMetadata(metadata).join(' / ') },
      { label: 'Slot', value: itemSlotFromMetadata(metadata) },
      { label: 'Quality', value: itemQualityNames[quality] ?? '' },
      {
        label: 'Item Level',
        value: firstNumberMeta(metadata, ['itemLevel', 'ItemLevel']) || null
      },
      {
        label: 'Requires Level',
        value:
          firstNumberMeta(metadata, ['requiredLevel', 'RequiredLevel']) || null
      },
      { label: 'Binding', value: itemBindingNames[binding] ?? '' },
      classField,
      raceField
    ]);
  }

  if (kind === 'quests') {
    return compactReadableFields([
      {
        label: 'Level',
        value: firstNumberMeta(metadata, ['level', 'QuestLevel']) || null
      },
      {
        label: 'Requires Level',
        value: firstNumberMeta(metadata, ['requiredLevel', 'MinLevel']) || null
      },
      classField,
      raceField,
      field(row, 'description_loc0', 'Description')
    ]);
  }

  if (kind === 'npcs' || kind === 'pets') {
    const type = firstNumberMeta(metadata, ['type']);
    const rank = firstNumberMeta(metadata, ['rank']);
    return compactReadableFields([
      { label: 'Level', value: levelRangeFromMetadata(metadata) },
      { label: 'Creature Type', value: creatureTypeNames[type] ?? '' },
      { label: 'Rank', value: creatureRankNames[rank] ?? '' },
      field(row, 'description_loc0', 'Description')
    ]);
  }

  if (kind === 'classes') {
    const powerType = numberValue(row, 'powerType');
    return compactReadableFields([
      field(row, 'fileString', 'Token'),
      { label: 'Power', value: powerTypeNames[powerType] ?? '' },
      linkedRelationField(
        'Race',
        raceRelationsFromMetadata(metadata),
        '/races'
      ),
      {
        label: 'Expansion',
        value: firstNumberMeta(metadata, ['expansion']) || 'Classic'
      }
    ]);
  }

  return compactReadableFields([
    { label: 'Type', value: kindLabel(kind) },
    field(row, 'description_loc0', 'Description'),
    field(row, 'text_loc0', 'Text')
  ]);
}

async function queryPostgresList(
  kind: EntityKind,
  input: Required<PaginationInput>
): Promise<PaginatedGameEntities> {
  const definition = getEntityDefinition(kind);
  const pool = getGamePool();

  if (!definition || !pool) {
    throw new Error('Game database is not configured.');
  }

  const schemaName = getGameSchema();
  const columns = await getTableColumns(schemaName, definition.table);
  const schema = quoteIdentifier(schemaName);
  const ownerColumns =
    kind === 'spells'
      ? await getTableColumns(schemaName, 'aowow_spell_owners')
      : new Set<string>();
  const legacyOwnerColumns =
    kind === 'spells'
      ? await getTableColumns(schemaName, 'aowow_character_advancement')
      : new Set<string>();
  const includeSpellOwner =
    kind === 'spells' && hasSpellOwnerColumns(ownerColumns);
  const includeLegacySpellOwner =
    kind === 'spells' &&
    !includeSpellOwner &&
    hasLegacySpellOwnerColumns(legacyOwnerColumns);
  const spellOwnerEnabled = includeSpellOwner || includeLegacySpellOwner;
  const spellOwnerJoinSql = includeSpellOwner
    ? spellOwnerJoin(schema, true)
    : legacySpellOwnerJoin(schema, includeLegacySpellOwner);
  const idExpr = columnExpression(columns, ['id', 'Id', 'entry'], '', 't.');

  if (!idExpr) {
    throw new Error(
      `${definition.table} does not expose an id or entry column.`
    );
  }

  const includeSkillSpecOwner = kind === 'skills' || kind === 'professions';
  const skillSpecOwnerJoinSql = skillSpecOwnerJoin(
    schema,
    includeSkillSpecOwner,
    idExpr
  );
  const nameExpr = columnExpression(
    columns,
    [
      'name_loc0',
      'name',
      'spellName',
      'ownerSpecName',
      'ownerClassName',
      'male_loc0',
      'subject_loc0',
      'cmd',
      'description',
      'fileString',
      'cuFlags'
    ],
    `${idExpr}::text`,
    't.'
  );
  const descriptionExpr = columnExpression(
    columns,
    ['description_loc0', 'description', 'text_loc0', 'buff_loc0'],
    'NULL::text',
    't.'
  );
  const categoryExpr = categoryExpression(columns, 't.');
  const iconExpr = iconExpression(schema, 't', columns);
  const itemEffectColumns =
    kind === 'items'
      ? await getTableColumns('app', 'item_tooltip_effects')
      : new Set<string>();
  const includeItemTooltipEffects =
    kind === 'items' &&
    itemEffectColumns.has('item_id') &&
    itemEffectColumns.has('search_text');
  const itemEffectJoinSql = includeItemTooltipEffects
    ? `
      LEFT JOIN LATERAL (
        SELECT string_agg(effect.search_text, ' ') AS search_text
        FROM app.item_tooltip_effects effect
        WHERE effect.item_id = ${idExpr}::int
      ) item_effects ON true`
    : '';
  const querySearchExpr = includeItemTooltipEffects
    ? `concat_ws(' ', CAST(${nameExpr} AS text), CAST(${descriptionExpr} AS text), item_effects.search_text)`
    : `CAST(${nameExpr} AS text)`;
  const table = quoteIdentifier(definition.table);
  const offset = (input.page - 1) * input.pageSize;
  const filterValues: unknown[] = [];
  const clauses = [
    ...visibleItemNameClause(kind, nameExpr),
    ...skillCategoryClauses(kind, input, columns),
    ...itemCategoryClauses(kind, input, columns),
    ...classCategoryClauses(kind, input, columns),
    ...visibleSpellClauses(kind, ownerColumns, legacyOwnerColumns, schema),
    ...spellCategoryClauses(kind, input, columns, schema)
  ];
  if (input.query) {
    filterValues.push(`%${input.query}%`);
    clauses.push(`${querySearchExpr} ILIKE $${filterValues.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const values = [...filterValues, input.pageSize, offset];
  const countValues = filterValues;
  const limitIndex = filterValues.length + 1;
  const offsetIndex = filterValues.length + 2;
  const useIdOrder =
    input.sort === 'id' || Boolean(input.query) || kind === 'spells';
  const orderBy = useIdOrder ? idExpr : nameExpr;
  const direction = input.direction === 'desc' ? 'DESC' : 'ASC';
  const metadataSelect = listMetadataSelect(kind, columns);
  const canUseEstimatedCount =
    !input.query && !input.category && kind !== 'professions';

  const listSql = `
    SELECT
      ${metadataSelect ? `${metadataSelect},` : ''}
      ${idExpr} AS id,
      CAST(COALESCE(${nameExpr}, ${idExpr}::text) AS text) AS name,
      CAST(${descriptionExpr} AS text) AS description,
      CAST(${categoryExpr} AS text) AS category,
      CAST(${iconExpr} AS text) AS icon
      ${skillSpecOwnerSelect(includeSkillSpecOwner)}
      ${spellOwnerSelect(spellOwnerEnabled)}
    FROM ${schema}.${table} t
    ${skillSpecOwnerJoinSql}
    ${spellOwnerJoinSql}
    ${itemEffectJoinSql}
    ${where}
    ORDER BY ${orderBy} ${direction}, ${idExpr} ${direction}
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
  `;

  const countSql = `SELECT COUNT(*)::int AS total FROM ${schema}.${table} t ${itemEffectJoinSql} ${where}`;
  const [itemsResult, total] = await Promise.all([
    pool.query<Record<string, unknown>>(listSql, values),
    canUseEstimatedCount
      ? estimateTableRows(schemaName, definition.table)
      : input.query
        ? Promise.resolve(0)
        : pool
            .query<{ total: number }>(countSql, countValues)
            .then((result) => result.rows[0]?.total ?? 0)
  ]);
  const queryTotal =
    input.query && total === 0
      ? offset + itemsResult.rows.length + (itemsResult.rows.length === input.pageSize ? 1 : 0)
      : total;

  return {
    items: itemsResult.rows.map((row) =>
      normalizeRow(kind, definition.table, row)
    ),
    total: queryTotal,
    page: input.page,
    pageSize: input.pageSize,
    adapter: 'postgres'
  };
}

async function queryPostgresDetail(
  kind: EntityKind,
  id: number
): Promise<GameEntityDetail> {
  const definition = getEntityDefinition(kind);
  const pool = getGamePool();

  if (!definition || !pool) {
    throw new Error('Game database is not configured.');
  }

  const schemaName = getGameSchema();
  const columns = await getTableColumns(schemaName, definition.table);
  const schema = quoteIdentifier(schemaName);
  const ownerColumns =
    kind === 'spells'
      ? await getTableColumns(schemaName, 'aowow_spell_owners')
      : new Set<string>();
  const legacyOwnerColumns =
    kind === 'spells'
      ? await getTableColumns(schemaName, 'aowow_character_advancement')
      : new Set<string>();
  const includeSpellOwner =
    kind === 'spells' && hasSpellOwnerColumns(ownerColumns);
  const includeLegacySpellOwner =
    kind === 'spells' &&
    !includeSpellOwner &&
    hasLegacySpellOwnerColumns(legacyOwnerColumns);
  const spellOwnerEnabled = includeSpellOwner || includeLegacySpellOwner;
  const spellOwnerJoinSql = includeSpellOwner
    ? spellOwnerJoin(schema, true)
    : legacySpellOwnerJoin(schema, includeLegacySpellOwner);
  const idExpr = columnExpression(columns, ['id', 'Id', 'entry'], '', 't.');

  if (!idExpr) {
    throw new Error(
      `${definition.table} does not expose an id or entry column.`
    );
  }

  const includeSkillSpecOwner = kind === 'skills' || kind === 'professions';
  const skillSpecOwnerJoinSql = skillSpecOwnerJoin(
    schema,
    includeSkillSpecOwner,
    idExpr
  );
  const nameExpr = columnExpression(
    columns,
    [
      'name_loc0',
      'name',
      'spellName',
      'ownerSpecName',
      'ownerClassName',
      'male_loc0',
      'subject_loc0',
      'cmd',
      'description',
      'fileString',
      'cuFlags'
    ],
    `${idExpr}::text`,
    't.'
  );
  const descriptionExpr = columnExpression(
    columns,
    ['description_loc0', 'description', 'text_loc0', 'buff_loc0'],
    'NULL::text',
    't.'
  );
  const categoryExpr = categoryExpression(columns, 't.');
  const iconExpr = iconExpression(schema, 't', columns);
  const extraSelect =
    kind === 'spells'
      ? `,
        range."name_loc0" AS "rangeName",
        range."rangeMinHostile" AS "rangeMinHostile",
        range."rangeMinFriend" AS "rangeMinFriend",
        range."rangeMaxHostile" AS "rangeMaxHostile",
        range."rangeMaxFriend" AS "rangeMaxFriend"
        ${spellOwnerSelect(spellOwnerEnabled)}`
      : skillSpecOwnerSelect(includeSkillSpecOwner);
  const extraJoin =
    kind === 'spells'
      ? `LEFT JOIN ${schema}.aowow_spellrange range ON range.id = t."rangeId"
        ${spellOwnerJoinSql}`
      : skillSpecOwnerJoinSql;
  const table = quoteIdentifier(definition.table);
  const result = await pool.query<Record<string, unknown>>(
    `
      SELECT
        t.*,
        ${idExpr} AS id,
        CAST(COALESCE(${nameExpr}, ${idExpr}::text) AS text) AS name,
        CAST(${descriptionExpr} AS text) AS description,
        CAST(${categoryExpr} AS text) AS category,
        CAST(${iconExpr} AS text) AS icon
        ${extraSelect}
      FROM ${schema}.${table} t
      ${extraJoin}
      WHERE ${idExpr} = $1
      LIMIT 1
    `,
    [id]
  );

  let row = result.rows[0];
  if (!row) {
    throw new Error(`${definition.singular} ${id} was not found.`);
  }
  if (kind === 'spells') {
    row = await enrichSpellReferences(row);
  }
  if (kind === 'items') {
    row = await enrichItemSpellReferences(row);
  }

  if (kind === 'items') {
    void cachedItemExtras(row, id);
  }
  const itemEffectsPromise =
    kind === 'items' ? cachedItemTooltipEffects(row, id) : null;
  const [sections, relatedGroups] = await Promise.all([
    buildDetailSections(kind, row),
    buildRelatedGroups(kind, row)
  ]);
  const related = relatedGroups.flatMap((group) => group.items).slice(0, 12);
  const metadata = rawMetadata(row);
  if (kind === 'spells' && typeof row.__spellRefsJson === 'string') {
    metadata.__spellRefsJson = row.__spellRefsJson;
  }
  if (kind === 'items' && typeof row.__itemSpellRefsJson === 'string') {
    metadata.__itemSpellRefsJson = row.__itemSpellRefsJson;
  }
  if (kind === 'items') {
    const tooltip = await cachedItemTooltipSnapshot(row, id);
    if (tooltip) {
      metadata.tooltip = tooltip.tooltip_text;
      metadata.__itemTooltipLinesJson = JSON.stringify(
        tooltip.tooltip_lines ?? []
      );
      metadata.__itemTooltipCaptured = tooltip.tooltip_captured === false ? false : true;
      if (tooltip.captured_at !== null && tooltip.captured_at !== undefined) {
        metadata.__itemTooltipCapturedAt = Number(tooltip.captured_at);
      }
    }
    const itemSet = await cachedItemSetInfo(row, tooltip?.tooltip_text);
    if (itemSet) {
      metadata.__itemSetJson = JSON.stringify(itemSet);
      metadata.itemset = itemSet.id || metadata.itemset || null;
    }
    const effects = itemEffectsPromise ? await itemEffectsPromise : [];
    if (effects.length > 0) {
      metadata.__itemTooltipEffectsJson = JSON.stringify(effects);
    }
    const exilReference = await getExilItemReference(id);
    if (exilReference) {
      metadata.__itemScalingReferenceJson = JSON.stringify(exilReference);
    }
  }

  return {
    ...normalizeRow(kind, definition.table, row),
    metadata,
    sections,
    related,
    relatedGroups,
    debug: {
      adapter: 'postgres',
      schema: getGameSchema(),
      sourceTable: definition.table
    }
  };
}

async function querySummaries(
  kind: EntityKind,
  whereSql: string,
  values: unknown[],
  limit = 25
): Promise<GameEntitySummary[]> {
  const definition = getEntityDefinition(kind);
  const pool = getGamePool();
  if (!definition || !pool) {
    return [];
  }

  const summaryIds = summaryIdsFromWhere(whereSql, values);
  if (summaryIds) {
    const functionRows = await querySummariesByIdsFromFunction(
      kind,
      summaryIds,
      limit
    );
    if (functionRows) {
      return functionRows;
    }
  }

  const schemaName = getGameSchema();
  const schema = quoteIdentifier(schemaName);
  const table = quoteIdentifier(definition.table);
  const columns = await getTableColumns(schemaName, definition.table);
  const ownerColumns =
    kind === 'spells'
      ? await getTableColumns(schemaName, 'aowow_spell_owners')
      : new Set<string>();
  const legacyOwnerColumns =
    kind === 'spells'
      ? await getTableColumns(schemaName, 'aowow_character_advancement')
      : new Set<string>();
  const includeSpellOwner =
    kind === 'spells' && hasSpellOwnerColumns(ownerColumns);
  const includeLegacySpellOwner =
    kind === 'spells' &&
    !includeSpellOwner &&
    hasLegacySpellOwnerColumns(legacyOwnerColumns);
  const spellOwnerEnabled = includeSpellOwner || includeLegacySpellOwner;
  const spellOwnerJoinSql = includeSpellOwner
    ? spellOwnerJoin(schema, true)
    : legacySpellOwnerJoin(schema, includeLegacySpellOwner);
  const idExpr = columnExpression(columns, ['id', 'Id', 'entry'], '', 't.');
  if (!idExpr) {
    return [];
  }

  if (await hasReadModels()) {
    try {
      const limitIndex = values.length + 1;
      const kindIndex = values.length + 2;
      const result = await pool.query<SummaryFunctionRow>(
        `
          WITH ids AS (
            SELECT DISTINCT ${idExpr}::int AS id
            FROM ${schema}.${table} t
            WHERE ${whereSql}
            ORDER BY id ASC
            LIMIT $${limitIndex}
          )
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
          JOIN ids ON ids.id = summary.id
          WHERE summary.kind = $${kindIndex}
            AND ${visibleSummaryNameClause('summary.kind', 'summary.name')}
          ORDER BY lower(summary.name), summary.id
        `,
        [...values, limit, kind]
      );

      return result.rows.map((row) => normalizeSummaryFunctionRow(row));
    } catch {
      readModelsAvailable = false;
    }
  }

  const includeSkillSpecOwner = kind === 'skills' || kind === 'professions';
  const skillSpecOwnerJoinSql = skillSpecOwnerJoin(
    schema,
    includeSkillSpecOwner,
    idExpr
  );
  const nameExpr = columnExpression(
    columns,
    [
      'name_loc0',
      'name',
      'spellName',
      'ownerSpecName',
      'ownerClassName',
      'male_loc0',
      'subject_loc0',
      'cmd',
      'description',
      'fileString',
      'cuFlags'
    ],
    `${idExpr}::text`,
    't.'
  );
  const descriptionExpr = columnExpression(
    columns,
    ['description_loc0', 'description', 'text_loc0', 'buff_loc0'],
    'NULL::text',
    't.'
  );
  const categoryExpr = categoryExpression(columns, 't.');
  const iconExpr = iconExpression(schema, 't', columns);
  const result = await pool.query<Record<string, unknown>>(
    `
      SELECT
        t.*,
        ${idExpr} AS id,
        CAST(COALESCE(${nameExpr}, ${idExpr}::text) AS text) AS name,
        CAST(${descriptionExpr} AS text) AS description,
        CAST(${categoryExpr} AS text) AS category,
        CAST(${iconExpr} AS text) AS icon
        ${skillSpecOwnerSelect(includeSkillSpecOwner)}
        ${spellOwnerSelect(spellOwnerEnabled)}
      FROM ${schema}.${table} t
      ${skillSpecOwnerJoinSql}
      ${spellOwnerJoinSql}
      WHERE (${whereSql})
        ${visibleItemNameClause(kind, nameExpr).map((clause) => `AND ${clause}`).join('\n        ')}
      ORDER BY name ASC, id ASC
      LIMIT $${values.length + 1}
    `,
    [...values, limit]
  );

  return result.rows.map((item) => normalizeRow(kind, definition.table, item));
}

async function buildDetailSections(
  kind: EntityKind,
  row: Record<string, unknown>
) {
  if (kind === 'spells') {
    return buildReadableSpellSections(row);
  }

  if (kind === 'zones') {
    return buildZoneSections(
      row,
      await zoneSpawnCounts(numberValue(row, 'id'))
    );
  }

  if (kind === 'classes') {
    return [
      {
        id: 'class-core',
        title: 'Class',
        fields: compactReadableFields([
          ...buildReadableOverviewFields(kind, row),
          ...(await classDataCounts(numberValue(row, 'id')))
        ])
      },
      ...(await classSpecRows(numberValue(row, 'id')))
    ];
  }

  if (kind === 'skills' || kind === 'professions') {
    return buildSkillSections(row);
  }

  if (kind === 'item-sets') {
    return buildItemSetSections(row);
  }

  return [
    {
      id: 'record-overview',
      title: 'Record Details',
      fields: buildReadableOverviewFields(kind, row)
    }
  ];
}

async function buildRelatedGroups(
  kind: EntityKind,
  row: Record<string, unknown>
): Promise<RelatedEntityGroup[]> {
  if (kind === 'items') {
    return itemRelatedGroups(row);
  }

  if (kind === 'item-sets') {
    return itemSetRelatedGroups(row);
  }

  if (kind === 'spells') {
    return spellRelatedGroups(row);
  }

  if (kind === 'zones') {
    return zoneRelatedGroups(row);
  }

  if (kind === 'classes') {
    return classRelatedGroups(row);
  }

  if (kind === 'skills' || kind === 'professions') {
    return skillRelatedGroups(row);
  }

  return [];
}

async function itemRelatedGroups(
  row: Record<string, unknown>
): Promise<RelatedEntityGroup[]> {
  const id = numberValue(row, 'id');
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const versionBaseName = baseItemName(name);
  const pool = getGamePool();

  if (!pool || !name) {
    return [];
  }

  const schemaName = getGameSchema();
  const columns = await getTableColumns(schemaName, 'aowow_items');
  const idExpr = columnExpression(columns, ['id', 'Id', 'entry'], '', 't.');

  if (!idExpr) {
    return [];
  }

  const tooltip = await cachedItemTooltipSnapshot(row, id);
  const [setInfo, versionItems] = await Promise.all([
    cachedItemSetInfo(row, tooltip?.tooltip_text),
    queryItemVersionsByBaseName(id, versionBaseName, 240)
  ]);
  const setItems = setInfo?.pieceIds.length
    ? await querySummaries(
        'items',
        `${idExpr} = ANY($1::int[])`,
        [setInfo.pieceIds],
        120
      )
    : [];
  const setOrder = new Map(
    (setInfo?.pieceIds ?? []).map((itemId, index) => [itemId, index])
  );
  const currentSummary = normalizeRow('items', 'aowow_items', row);
  const baseVersion = sortItemVersions([currentSummary, ...versionItems])[0];

  const groups: RelatedEntityGroup[] = [
    {
      id: 'set-items',
      label: 'Set Items',
      description: setInfo?.name
        ? `Pieces in ${setInfo.name}.`
        : 'Pieces in this item set.',
      items: setItems.sort(
        (left, right) =>
          (setOrder.get(left.id) ?? 0) - (setOrder.get(right.id) ?? 0)
      )
    },
    {
      id: 'base-version',
      label: 'Base Version',
      description: 'Lowest item level version of this item.',
      items: baseVersion ? [baseVersion] : []
    },
    {
      id: 'item-versions',
      label: 'Versions',
      description:
        'Items with the same base item name, including Bloodforged variants.',
      items: versionItems
    }
  ];

  return groups.filter((group) => group.items.length > 0);
}

async function itemSetRelatedGroups(
  row: Record<string, unknown>
): Promise<RelatedEntityGroup[]> {
  const id = numberValue(row, 'id');
  const name =
    typeof row.name === 'string'
      ? row.name.trim()
      : typeof row.name_loc0 === 'string'
        ? row.name_loc0.trim()
        : '';
  const directItemIds = itemSetIdsFromRow(row);
  const tooltipItemIds = directItemIds.length
    ? []
    : await itemSetTooltipItemIds(name);
  const itemIds = directItemIds.length ? directItemIds : tooltipItemIds;
  const itemOrder = new Map(itemIds.map((itemId, index) => [itemId, index]));
  const bonusSpellIds = itemSetBonusesFromRow(row).map((bonus) => bonus.spellId);
  const [setItems, bonusSpells, sameNamedSets] = await Promise.all([
    itemIds.length
      ? querySummaries('items', `t.id = ANY($1::int[])`, [itemIds], 240)
      : Promise.resolve([]),
    bonusSpellIds.length
      ? querySummaries('spells', `t.id = ANY($1::int[])`, [bonusSpellIds], 40)
      : Promise.resolve([]),
    id > 0 && name
      ? querySummaries(
          'item-sets',
          `t.id <> $1 AND lower(t.name_loc0) = lower($2)`,
          [id, name],
          40
        )
      : Promise.resolve([])
  ]);

  const groups: RelatedEntityGroup[] = [
    {
      id: 'set-items',
      label: 'Set Items',
      description: directItemIds.length
        ? 'Pieces listed by the item set data.'
        : 'Pieces resolved from captured item tooltips.',
      items: setItems.sort(
            (left, right) =>
              (itemOrder.get(left.id) ?? 0) - (itemOrder.get(right.id) ?? 0)
          )
    },
    {
      id: 'set-bonus-spells',
      label: 'Set Bonus Spells',
      description: 'Spells triggered by this item set threshold.',
      items: bonusSpells
    }
  ];

  if (id > 0 && name) {
    groups.push({
      id: 'same-name-itemsets',
      label: 'Same Named Sets',
      description: 'Other item set rows with the same display name.',
      items: sameNamedSets
    });
  }

  return groups.filter((group) => group.items.length > 0);
}

async function classRelatedGroups(
  row: Record<string, unknown>
): Promise<RelatedEntityGroup[]> {
  const classId = numberValue(row, 'id');
  const className = typeof row.name === 'string' ? row.name : '';
  const classMask = signedClassMaskBit(classId);
  const pool = getGamePool();
  const schema = quoteIdentifier(getGameSchema());
  const specSkillIdsPromise = pool
    ? pool.query<{ id: number }>(
          `
          SELECT DISTINCT id
          FROM (
            SELECT spec."skillLineId" AS id
            FROM ${schema}.aowow_coa_specs spec
            WHERE spec."classId" = $1
              AND spec."skillLineId" > 0
              AND NOT (
                spec."classId" >= 12
                AND EXISTS (
                  SELECT 1
                  FROM ${schema}.aowow_chr_specs chr_override
                  WHERE chr_override."specToken" = spec."specToken"
                    AND chr_override."skillLineId" > 0
                    AND chr_override."skillLineId" <> spec."skillLineId"
                    AND (
                      chr_override."classId" = spec."classId"
                      OR chr_override."classToken" = spec."classToken"
                      OR chr_override."classFileString" = spec."classToken"
                    )
                )
              )
            UNION
            SELECT chr."skillLineId" AS id
            FROM ${schema}.aowow_chr_specs chr
            JOIN ${schema}.aowow_coa_specs spec ON spec."specToken" = chr."specToken"
            WHERE spec."classId" = $1
              AND chr."skillLineId" > 0
              AND (
                chr."classId" = spec."classId"
                OR chr."classId" = 0
                OR chr."classToken" = spec."classToken"
                OR chr."classFileString" = spec."classToken"
              )
            UNION
            SELECT chr."skillLineId" AS id
            FROM ${schema}.aowow_chr_specs chr
            WHERE chr."classId" = $1
              AND chr."skillLineId" > 0
              AND NOT EXISTS (
                SELECT 1
                FROM ${schema}.aowow_coa_specs spec
                WHERE spec."classId" = chr."classId"
                  AND spec."specToken" = chr."specToken"
              )
            UNION
            SELECT skill."Id" AS id
            FROM ${schema}.aowow_skillline skill
            WHERE skill."categoryId" = 7 AND lower(skill."name_loc0") = lower($2)
          ) ids
          ORDER BY id
          LIMIT 80
        `,
          [classId, className]
        ).then((result) => result.rows.map((item) => item.id))
    : Promise.resolve([]);
  const ownedSpellIdsPromise = pool
    ? pool.query<{ id: number }>(
          `
          SELECT DISTINCT owner_map."spellId" AS id
          FROM ${schema}.aowow_spell_owners owner_map
          WHERE owner_map."ownerClassId" = $1 AND owner_map."spellId" > 0
          ORDER BY id
          LIMIT 120
        `,
          [classId]
        ).then((result) => result.rows.map((item) => item.id))
    : Promise.resolve([]);
  const trainerSpellIdsPromise = pool
    ? pool.query<{ id: number }>(
          `
          SELECT DISTINCT ability."spellId" AS id
          FROM ${schema}.aowow_skill_line_abilities ability
          WHERE ability."spellId" > 0
            AND (ability."ownerClassId" = $1 OR (ability."classMask" & $2) <> 0)
          ORDER BY id
          LIMIT 120
        `,
          [classId, classMask]
        ).then((result) => result.rows.map((item) => item.id))
    : Promise.resolve([]);
  const talentIdsPromise = pool
    ? pool.query<{ id: number }>(
          `
          SELECT DISTINCT talent.id
          FROM ${schema}.aowow_talents talent
          WHERE talent.class = $1
          ORDER BY talent.id
          LIMIT 120
        `,
          [classId]
        ).then((result) => result.rows.map((item) => item.id))
    : Promise.resolve([]);
  const [specSkillIds, ownedSpellIds, trainerSpellIds, talentIds] =
    await Promise.all([
      specSkillIdsPromise,
      ownedSpellIdsPromise,
      trainerSpellIdsPromise,
      talentIdsPromise
    ]);
  const [specSkills, ownedSpells, trainerSpells, talents] = await Promise.all([
    specSkillIds.length
      ? querySummaries('skills', `t."Id" = ANY($1::int[])`, [specSkillIds], 80)
      : Promise.resolve([]),
    ownedSpellIds.length
      ? querySummaries('spells', `t.id = ANY($1::int[])`, [ownedSpellIds], 80)
      : Promise.resolve([]),
    trainerSpellIds.length
      ? querySummaries('spells', `t.id = ANY($1::int[])`, [trainerSpellIds], 80)
      : Promise.resolve([]),
    talentIds.length
      ? querySummaries('talents', `t.id = ANY($1::int[])`, [talentIds], 80)
      : Promise.resolve([])
  ]);
  const groups: RelatedEntityGroup[] = [
    {
      id: 'specialization-skills',
      label: 'Specialization ',
      description: 'Specialization and references',
      items: specSkills
    },
    {
      id: 'owned-spells',
      label: 'Class Spells',
      description: 'Spells owned by this class',
      items: ownedSpells
    },
    {
      id: 'trainer-spells',
      label: 'Trainer / Skill-Line Spells',
      description: 'Spells linked to this class mask or owner class.',
      items: trainerSpells
    },
    {
      id: 'talents',
      label: 'Talents',
      description: 'Legacy Talent.dbc rows for this class where available.',
      items: talents
    }
  ];

  return groups.filter((group) => group.items.length > 0);
}

async function skillRelatedGroups(
  row: Record<string, unknown>
): Promise<RelatedEntityGroup[]> {
  const skillLineId = numberValue(row, 'Id') || numberValue(row, 'id');
  const groups: RelatedEntityGroup[] = [];

  if (skillLineId > 0) {
    const pool = getGamePool();
    const schema = quoteIdentifier(getGameSchema());
    const spellIds = pool
      ? (
          await pool.query<{ id: number }>(
            `
            SELECT DISTINCT id
            FROM (
              SELECT ability."spellId" AS id
              FROM ${schema}.aowow_skill_line_abilities ability
              WHERE ability."skillLineId" = $1 AND ability."spellId" > 0
              UNION
              SELECT owner_map."spellId" AS id
              FROM ${schema}.aowow_spell_owners owner_map
              WHERE owner_map."ownerSpecSkillId" = $1 AND owner_map."spellId" > 0
            ) ids
            ORDER BY id
            LIMIT 120
          `,
            [skillLineId]
          )
        ).rows.map((item) => item.id)
      : [];
    const classIds = pool
      ? (
          await pool.query<{ id: number }>(
            `
            SELECT DISTINCT id
            FROM (
              SELECT spec."classId" AS id
              FROM ${schema}.aowow_coa_specs spec
              WHERE spec."skillLineId" = $1
                AND spec."classId" > 0
                AND NOT (
                  spec."classId" >= 12
                  AND EXISTS (
                    SELECT 1
                    FROM ${schema}.aowow_chr_specs chr_override
                    WHERE chr_override."specToken" = spec."specToken"
                      AND chr_override."skillLineId" > 0
                      AND chr_override."skillLineId" <> spec."skillLineId"
                      AND (
                        chr_override."classId" = spec."classId"
                        OR chr_override."classToken" = spec."classToken"
                        OR chr_override."classFileString" = spec."classToken"
                      )
                  )
                )
              UNION
              SELECT spec."classId" AS id
              FROM ${schema}.aowow_chr_specs chr
              JOIN ${schema}.aowow_coa_specs spec ON spec."specToken" = chr."specToken"
              WHERE chr."skillLineId" = $1
                AND chr."skillLineId" > 0
                AND spec."classId" > 0
                AND (
                  chr."classId" = spec."classId"
                  OR chr."classId" = 0
                  OR chr."classToken" = spec."classToken"
                  OR chr."classFileString" = spec."classToken"
                )
            ) ids
            ORDER BY id
            LIMIT 40
          `,
            [skillLineId]
          )
        ).rows.map((item) => item.id)
      : [];
    groups.push(
      {
        id: 'skill-spells',
        label: 'Skill Spells',
        description:
          'Spells linked to this SkillLine through SkillLineAbility or imported spell ownership.',
        items: spellIds.length
          ? await querySummaries(
              'spells',
              `t.id = ANY($1::int[])`,
              [spellIds],
              80
            )
          : []
      },
      {
        id: 'classes',
        label: 'Classes',
        description:
          'Classes whose Lua spec metadata points at this SkillLine.',
        items: classIds.length
          ? await querySummaries(
              'classes',
              `t.id = ANY($1::int[])`,
              [classIds],
              40
            )
          : []
      }
    );
  }

  return groups.filter((group) => group.items.length > 0);
}

async function spellRelatedGroups(
  row: Record<string, unknown>
): Promise<RelatedEntityGroup[]> {
  const useReadModels = await hasReadModels();
  const id = numberValue(row, 'id');
  const name = typeof row.name === 'string' ? row.name : '';
  const rank = typeof row.rank_loc0 === 'string' ? row.rank_loc0 : '';
  const family = numberValue(row, 'spellFamilyId');
  const familyMasks = [
    numberValue(row, 'spellFamilyFlags1'),
    numberValue(row, 'spellFamilyFlags2'),
    numberValue(row, 'spellFamilyFlags3')
  ];
  const triggerIds = [1, 2, 3]
    .filter((index) => {
      const effect = numberValue(row, `effect${index}Id`);
      const aura = numberValue(row, `effect${index}AuraId`);
      return TRIGGER_EFFECTS.includes(effect) || TRIGGER_AURAS.includes(aura);
    })
    .map((index) => numberValue(row, `effect${index}TriggerSpell`))
    .filter((value) => value > 0);
  const taughtIds = [1, 2, 3]
    .filter((index) =>
      TEACH_EFFECTS.includes(numberValue(row, `effect${index}Id`))
    )
    .map((index) => numberValue(row, `effect${index}TriggerSpell`))
    .filter((value) => value > 0);
  const createdItemIds = [1, 2, 3]
    .filter((index) =>
      ITEM_CREATE_EFFECTS.includes(numberValue(row, `effect${index}Id`))
    )
    .map((index) => numberValue(row, `effect${index}CreateItemId`))
    .filter((value) => value > 0);

  const groups: RelatedEntityGroup[] = [];

  if (name) {
    const schema = quoteIdentifier(getGameSchema());
    groups.push({
      id: 'spell-ranks',
      label: 'Ranks',
      description: 'Other ranks of this spell.',
      items: await querySummaries(
        'spells',
        `
          t.id IN (
            SELECT MIN(rank_spell.id)
            FROM ${schema}.aowow_spell rank_spell
            WHERE rank_spell.id <> $1
              AND rank_spell.name_loc0 = $2
              AND NULLIF(rank_spell.rank_loc0, '') IS NOT NULL
              AND rank_spell.rank_loc0 ~ '^Rank [0-9]+$'
              AND ($5 = '' OR rank_spell.rank_loc0 <> $5)
              AND rank_spell."schoolMask" = $3
              AND (
                $4 = 0
                OR rank_spell."spellFamilyId" = $4
                OR rank_spell."spellFamilyId" = 0
              )
            GROUP BY rank_spell.rank_loc0
          )
        `,
        [id, name, numberValue(row, 'schoolMask'), family, rank],
        20
      )
    });
  }

  if (family > 0) {
    const modifiesValues: unknown[] = [id, family];
    const modifiesClauses = [1, 2, 3]
      .filter((index) =>
        MOD_AURAS.includes(numberValue(row, `effect${index}AuraId`))
      )
      .map((index) => {
        const masks = [
          numberValue(row, `effect${index}SpellClassMaskA`),
          numberValue(row, `effect${index}SpellClassMaskB`),
          numberValue(row, `effect${index}SpellClassMaskC`)
        ];
        const maskClauses = masks
          .map((mask, maskIndex) => {
            if (!mask) return '';
            modifiesValues.push(mask);
            return `(t."spellFamilyFlags${maskIndex + 1}" & $${modifiesValues.length}) <> 0`;
          })
          .filter(Boolean);
        return maskClauses.length ? `(${maskClauses.join(' OR ')})` : '';
      })
      .filter(Boolean);

    if (modifiesClauses.length > 0) {
      groups.push({
        id: 'modifies',
        label: 'Modifies',
        description:
          "Spells matched by this spell's modifier aura masks, following AoWoW's spell-family relationship logic.",
        items: await querySummaries(
          'spells',
          `t.id <> $1 AND t."spellFamilyId" = $2 AND (${modifiesClauses.join(' OR ')})`,
          modifiesValues,
          60
        )
      });
    }

    if (familyMasks.some((value) => value > 0)) {
      groups.push({
        id: 'modified-by',
        label: 'Modified By',
        description:
          "Spells whose modifier aura masks overlap this spell's family flags.",
        items: await querySummaries(
          'spells',
          `
            t.id <> $1
            AND t."spellFamilyId" = $2
            AND (
              (t."effect1AuraId" = ANY($3::int[]) AND ((t."effect1SpellClassMaskA" & $4) <> 0 OR (t."effect1SpellClassMaskB" & $5) <> 0 OR (t."effect1SpellClassMaskC" & $6) <> 0))
              OR (t."effect2AuraId" = ANY($3::int[]) AND ((t."effect2SpellClassMaskA" & $4) <> 0 OR (t."effect2SpellClassMaskB" & $5) <> 0 OR (t."effect2SpellClassMaskC" & $6) <> 0))
              OR (t."effect3AuraId" = ANY($3::int[]) AND ((t."effect3SpellClassMaskA" & $4) <> 0 OR (t."effect3SpellClassMaskB" & $5) <> 0 OR (t."effect3SpellClassMaskC" & $6) <> 0))
            )
          `,
          [id, family, MOD_AURAS, ...familyMasks],
          60
        )
      });
    }
  }

  if (name) {
    groups.push({
      id: 'see-also',
      label: 'See Also',
      description:
        "Same-name spells with matching school and effect layout, like AoWoW's variant tab.",
      items: await querySummaries(
        'spells',
        `
          t.id <> $1
          AND t.name_loc0 = $2
          AND t."schoolMask" = $3
          AND t."effect1Id" = $4
          AND t."effect2Id" = $5
          AND t."effect3Id" = $6
        `,
        [
          id,
          name,
          numberValue(row, 'schoolMask'),
          numberValue(row, 'effect1Id'),
          numberValue(row, 'effect2Id'),
          numberValue(row, 'effect3Id')
        ],
        40
      )
    });
  }

  const category = numberValue(row, 'category');
  const recoveryCategory = numberValue(row, 'recoveryCategory');
  if (category > 0 && recoveryCategory > 0) {
    groups.push({
      id: 'shared-cooldown',
      label: 'Shared Cooldown',
      description: 'Spells in the same cooldown category.',
      items: await querySummaries(
        'spells',
        `t.id <> $1 AND t.category = $2 AND t."recoveryCategory" > 0 ${family > 0 ? `AND t."spellFamilyId" = $3` : ''}`,
        family > 0 ? [id, category, family] : [id, category],
        40
      )
    });
  }

  if (triggerIds.length > 0) {
    groups.push({
      id: 'triggered-spells',
      label: 'Triggered Spells',
      items: await querySummaries(
        'spells',
        `t.id = ANY($1::int[])`,
        [triggerIds],
        20
      )
    });
  }

  groups.push({
    id: 'triggered-by',
    label: 'Triggered By',
    description:
      'Spells that trigger this spell from one of their effect slots.',
    items: await querySummaries(
      'spells',
      useReadModels
        ? `
        t.id IN (
          SELECT link.source_spell_id
          FROM app.spell_trigger_links link
          WHERE link.target_spell_id = $1
            AND (link.effect_id = ANY($2::int[]) OR link.aura_id = ANY($3::int[]))
        )
      `
        : `
        (t."effect1TriggerSpell" = $1 AND (t."effect1Id" = ANY($2::int[]) OR t."effect1AuraId" = ANY($3::int[])))
        OR (t."effect2TriggerSpell" = $1 AND (t."effect2Id" = ANY($2::int[]) OR t."effect2AuraId" = ANY($3::int[])))
        OR (t."effect3TriggerSpell" = $1 AND (t."effect3Id" = ANY($2::int[]) OR t."effect3AuraId" = ANY($3::int[])))
      `,
      [id, TRIGGER_EFFECTS, TRIGGER_AURAS],
      40
    )
  });

  if (taughtIds.length > 0) {
    groups.push({
      id: 'teaches-spell',
      label: 'Teaches',
      items: await querySummaries(
        'spells',
        `t.id = ANY($1::int[])`,
        [taughtIds],
        20
      )
    });
  }

  groups.push({
    id: 'taught-by-spell',
    label: 'Taught By Spell',
    items: await querySummaries(
      'spells',
      useReadModels
        ? `
        t.id IN (
          SELECT link.source_spell_id
          FROM app.spell_teach_links link
          WHERE link.target_spell_id = $1
        )
      `
        : `
        (t."effect1TriggerSpell" = $1 AND t."effect1Id" = ANY($2::int[]))
        OR (t."effect2TriggerSpell" = $1 AND t."effect2Id" = ANY($2::int[]))
        OR (t."effect3TriggerSpell" = $1 AND t."effect3Id" = ANY($2::int[]))
      `,
      useReadModels ? [id] : [id, TEACH_EFFECTS],
      40
    )
  });

  if (createdItemIds.length > 0) {
    groups.push({
      id: 'created-items',
      label: 'Created Items',
      items: await querySummaries(
        'items',
        `t.id = ANY($1::int[])`,
        [createdItemIds],
        20
      )
    });
  }

  groups.push({
    id: 'used-by-item',
    label: 'Used By Items',
    description: 'Items whose spell slots point to this spell.',
    items: await querySummaries(
      'items',
      useReadModels
        ? `
        t.id IN (
          SELECT link.item_id
          FROM app.item_spell_links link
          WHERE link.spell_id = $1
        )
      `
        : `
        t."spellId1" = $1 OR t."spellId2" = $1 OR t."spellId3" = $1 OR t."spellId4" = $1 OR t."spellId5" = $1
      `,
      [id],
      40
    )
  });

  groups.push({
    id: 'used-by-itemset',
    label: 'Used By Item Sets',
    items: await querySummaries(
      'item-sets',
      useReadModels
        ? `
        t.id IN (
          SELECT link.itemset_id
          FROM app.itemset_spell_links link
          WHERE link.spell_id = $1
        )
      `
        : `
        t.spell1 = $1 OR t.spell2 = $1 OR t.spell3 = $1 OR t.spell4 = $1
        OR t.spell5 = $1 OR t.spell6 = $1 OR t.spell7 = $1 OR t.spell8 = $1
      `,
      [id],
      40
    )
  });

  groups.push({
    id: 'enchantments',
    label: 'Enchantments',
    items: await querySummaries(
      'enchantments',
      useReadModels
        ? `
        t.id IN (
          SELECT link.enchantment_id
          FROM app.enchantment_spell_links link
          WHERE link.spell_id = $1
        )
      `
        : `
        (t.type1 = ANY($2::int[]) AND t.object1 = $1)
        OR (t.type2 = ANY($2::int[]) AND t.object2 = $1)
        OR (t.type3 = ANY($2::int[]) AND t.object3 = $1)
      `,
      useReadModels ? [id] : [id, [1, 3, 7]],
      40
    )
  });

  groups.push({
    id: 'talent-links',
    label: 'Talent Links',
    description: 'Talent rows that directly point at this spell rank.',
    items: await querySummaries('talents', `t.spell = $1`, [id], 20)
  });

  return groups.filter((group) => group.items.length > 0);
}

async function zoneRelatedGroups(
  row: Record<string, unknown>
): Promise<RelatedEntityGroup[]> {
  const id = numberValue(row, 'id');
  const parentArea = numberValue(row, 'parentArea');
  const groups: RelatedEntityGroup[] = [
    {
      id: 'subzones',
      label: 'Subzones',
      description: "Child AreaTable rows, matching AoWoW's zone tab.",
      items: await querySummaries(
        'zones',
        `t."parentArea" = $1 AND t.id <> $1`,
        [id],
        60
      )
    }
  ];

  if (parentArea > 0) {
    groups.push({
      id: 'parent-zone',
      label: 'Parent Zone',
      items: await querySummaries('zones', 't.id = $1', [parentArea], 1)
    });
  }

  return groups.filter((group) => group.items.length > 0);
}

async function zoneSpawnCounts(zoneId: number): Promise<DetailField[]> {
  const pool = getGamePool();
  if (!pool) {
    return [];
  }

  const schema = quoteIdentifier(getGameSchema());
  const result = await pool.query<{ type: number; count: number }>(
    `
      SELECT type::int, COUNT(*)::int AS count
      FROM ${schema}.aowow_spawns
      WHERE "areaId" = $1
      GROUP BY type
      ORDER BY type
    `,
    [zoneId]
  );

  if (result.rows.length === 0) {
    return [
      { label: 'Loaded spawns', value: 'No aowow_spawns rows for this zone' }
    ];
  }

  return result.rows.map((item) => ({
    label: `Spawn type ${item.type}`,
    value: item.count
  }));
}

function normalizeInput(
  input: Partial<PaginationInput>
): Required<PaginationInput> {
  return {
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 25,
    query: input.query ?? '',
    category: input.category ?? '',
    sort: input.sort ?? 'name',
    direction: input.direction ?? 'asc'
  };
}

export async function listGameEntities(
  kind: EntityKind,
  input: Partial<PaginationInput> = {}
): Promise<PaginatedGameEntities> {
  const normalized = normalizeInput(input);
  const definition = getEntityDefinition(kind);

  if (!definition || !hasGameDatabase()) {
    const all = getMockEntities(kind).filter((item) =>
      normalized.query
        ? item.name.toLowerCase().includes(normalized.query.toLowerCase())
        : true
    );

    return {
      items: all.slice(
        (normalized.page - 1) * normalized.pageSize,
        normalized.page * normalized.pageSize
      ),
      total: all.length,
      page: normalized.page,
      pageSize: normalized.pageSize,
      adapter: 'mock'
    };
  }

  return cacheJson(
    `game:${kind}:list:v2:${JSON.stringify(normalized)}`,
    60,
    async () => {
      try {
        const functionResult = await listGameEntitiesFromFunction(kind, normalized);
        if (functionResult) {
          return functionResult;
        }

        return await queryPostgresList(kind, normalized);
      } catch (error) {
        logger.warn({ error, kind }, 'Falling back to mock game-data adapter.');
        const all = getMockEntities(kind);
        return {
          items: all,
          total: all.length,
          page: normalized.page,
          pageSize: normalized.pageSize,
          adapter: 'mock' as const
        };
      }
    }
  );
}

export async function listGameEntityStats(): Promise<
  Array<{
    kind: EntityKind;
    total: number;
    adapter: 'postgres' | 'mock';
  }>
> {
  if (!hasGameDatabase()) {
    return entityDefinitions.map((entity) => ({
      kind: entity.kind,
      total: getMockEntities(entity.kind).length,
      adapter: 'mock' as const
    }));
  }

  const pool = getGamePool();
  if (!pool) {
    return [];
  }

  const schemaName = getGameSchema();

  return cacheJson(`game:${schemaName}:entity-stats`, 300, async () => {
    if (summaryFunctionsAvailable !== false) {
      try {
        const functionStats = await pool.query<{
          kind: EntityKind;
          total: number;
        }>(`SELECT kind, total FROM app.get_entity_stats()`);
        summaryFunctionsAvailable = true;
        const totals = new Map(
          functionStats.rows.map((row) => [row.kind, Number(row.total)])
        );
        return entityDefinitions.map((entity) => ({
          kind: entity.kind,
          total: totals.get(entity.kind) ?? 0,
          adapter: 'postgres' as const
        }));
      } catch {
        summaryFunctionsAvailable = false;
      }
    }

    const tableNames = [...new Set(entityDefinitions.map((entity) => entity.table))];
    const statsResult = await pool.query<{
      table_name: string;
      total: string | number;
    }>(
      `
        SELECT
          cls.relname AS table_name,
          CASE
            WHEN stats.n_live_tup > 0 THEN stats.n_live_tup::bigint
            WHEN cls.reltuples > 0 THEN cls.reltuples::bigint
            ELSE 0
          END AS total
        FROM pg_class cls
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        LEFT JOIN pg_stat_all_tables stats ON stats.relid = cls.oid
        WHERE ns.nspname = $1 AND cls.relname = ANY($2::text[])
      `,
      [schemaName, tableNames]
    );
    const tableTotals = new Map(
      statsResult.rows.map((row) => [row.table_name, Number(row.total)])
    );
    const itemColumns = await getTableColumns(schemaName, 'aowow_items');
    const itemNameExpr = columnExpression(
      itemColumns,
      ['name_loc0', 'name'],
      't.id::text',
      't.'
    );
    const itemTotal =
      itemColumns.size > 0
        ? await pool
            .query<{ total: number }>(
              `
                SELECT COUNT(*)::int AS total
                FROM ${quoteIdentifier(schemaName)}.aowow_items t
                WHERE ${visibleItemNameClause('items', itemNameExpr).join(' AND ')}
              `
            )
            .then((result) => result.rows[0]?.total ?? 0)
        : (tableTotals.get('aowow_items') ?? 0);
    const skillColumns = await getTableColumns(schemaName, 'aowow_skillline');
    const professionTotal =
      skillColumns.has('categoryId')
        ? await pool
            .query<{ total: number }>(
              `SELECT COUNT(*)::int AS total FROM ${quoteIdentifier(schemaName)}.aowow_skillline WHERE "categoryId" = 11`
            )
            .then((result) => result.rows[0]?.total ?? 0)
        : (tableTotals.get('aowow_skillline') ?? 0);

    return entityDefinitions.map((entity) => ({
      kind: entity.kind,
      total:
        entity.kind === 'professions'
          ? professionTotal
          : entity.kind === 'items'
            ? itemTotal
          : (tableTotals.get(entity.table) ?? 0),
      adapter: 'postgres' as const
    }));
  });
}

export async function getGameEntity(
  kind: EntityKind,
  id: number
): Promise<GameEntityDetail | null> {
  const definition = getEntityDefinition(kind);

  if (!definition || !hasGameDatabase()) {
    const mock = getMockEntities(kind).find((item) => item.id === id);
    if (!mock) {
      return null;
    }

    return {
      ...mock,
      metadata: {
        id,
        source: definition?.table ?? 'mock',
        compatibility: 'Temporary mock only'
      },
      sections: [
        {
          id: 'mock-overview',
          title: 'Mock Record',
          description:
            'Temporary development scaffold until game data is configured.',
          fields: [
            { label: 'ID', value: id },
            { label: 'Source', value: definition?.table ?? 'mock' }
          ]
        }
      ],
      related: getMockEntities(kind)
        .filter((item) => item.id !== id)
        .slice(0, 3),
      relatedGroups: [
        {
          id: 'mock-related',
          label: 'Related',
          items: getMockEntities(kind)
            .filter((item) => item.id !== id)
            .slice(0, 3)
        }
      ],
      debug: {
        adapter: 'mock',
        schema: 'mock',
        sourceTable: definition?.table ?? 'mock'
      }
    };
  }

  return cacheJson(`game:${kind}:${id}:detail:v5`, 300, async () => {
    try {
      return await queryPostgresDetail(kind, id);
    } catch (error) {
      logger.warn({ error, kind, id }, 'Game entity detail lookup failed.');
      return null;
    }
  });
}

export function createEntityRepository(kind: EntityKind) {
  return {
    list: (input?: PaginationInput) => listGameEntities(kind, input),
    byId: (id: number) => getGameEntity(kind, id)
  };
}
