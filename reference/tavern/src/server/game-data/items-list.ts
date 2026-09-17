import { getEntityDetailSlug } from '@/lib/entities';
import {
  armorSubclassNames,
  inventoryTypeNames,
  itemClassNames,
  itemQualityColors,
  itemQualityNames
} from '@/lib/game-data-display';
import { cacheJson } from '@/lib/redis';
import {
  getGamePool,
  getGameSchema,
  hasGameDatabase
} from '@/server/game-data/db';
import { getMockEntities } from '@/server/game-data/mock-data';
import { iconNameToUrl } from '@/server/game-data/icon-url';
import type {
  GameEntitySummary,
  PaginatedGameEntities
} from '@/server/game-data/types';
import {
  hiddenItemNameFragmentsArraySql,
  hiddenItemNamesArraySql,
  isVisibleGameEntityName
} from '@/server/game-data/visibility';

export type ItemListingSort =
  | 'default'
  | 'stat'
  | 'total'
  | 'density'
  | 'ilvl'
  | 'req'
  | 'slot'
  | 'class'
  | 'name'
  | 'weighted'
  | 'id';

export type WeightedStatFilter = {
  stat: string;
  weight: number;
  min?: number;
  max?: number;
};

type ItemListingFilterValue = string | string[] | undefined;

export type ItemListingInput = {
  page?: number;
  pageSize?: number;
  query?: string;
  itemIds?: number[];
  type?: ItemListingFilterValue;
  quality?: ItemListingFilterValue;
  slot?: ItemListingFilterValue;
  stat?: ItemListingFilterValue;
  minItemLevel?: number;
  maxItemLevel?: number;
  minRequiredLevel?: number;
  maxRequiredLevel?: number;
  sort?: string;
  direction?: string;
  weights?: WeightedStatFilter[];
  weightedTotalMin?: number;
  weightedTotalMax?: number;
};

export type ItemListingResult = PaginatedGameEntities & {
  selectedStat: string;
  selectedStats: string[];
  hasMore: boolean;
};

export const DEFAULT_ITEM_MAX_REQUIRED_LEVEL = 60;

type ItemRow = {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  class: number;
  subClass: number;
  slot: number;
  quality: number;
  itemLevel: number;
  requiredLevel: number;
  statTotal: number;
  selectedStatValue: number;
  weightedScore: number;
};

const hiddenItemNamesSql = hiddenItemNamesArraySql();
const hiddenItemNameFragmentsSql = hiddenItemNameFragmentsArraySql();

const weaponSubclassNames: Record<number, string> = {
  0: '1H Axe',
  1: '2H Axe',
  2: 'Bow',
  3: 'Gun',
  4: '1H Mace',
  5: '2H Mace',
  6: 'Polearm',
  7: '1H Sword',
  8: '2H Sword',
  10: 'Staff',
  13: 'Fist Weapon',
  14: 'Miscellaneous',
  15: 'Dagger',
  16: 'Thrown',
  18: 'Crossbow',
  19: 'Wand',
  20: 'Fishing Pole'
};

const slotValueToIds: Record<string, number[]> = {
  head: [1],
  neck: [2],
  shoulder: [3],
  cloak: [16],
  chest: [5],
  robe: [20],
  wrist: [9],
  hand: [10],
  waist: [6],
  legs: [7],
  feet: [8],
  finger: [11],
  trinket: [12],
  weapon: [13],
  two_hand: [17],
  main_hand: [21],
  off_hand: [22],
  holdable: [23],
  ranged: [15],
  ranged_right: [26],
  thrown: [25],
  shield: [14],
  relic: [28],
  bag: [18]
};

const slotIdToValue = new Map(
  Object.entries(slotValueToIds).flatMap(([slot, ids]) =>
    ids.map((id) => [id, slot] as const)
  )
);

const statTypeIds: Record<string, number[]> = {
  stamina: [7],
  intellect: [5],
  agility: [3],
  strength: [4],
  spirit: [6],
  spellPower: [41, 42, 45],
  attackPower: [38],
  rangedAttackPower: [39],
  critRating: [19, 20, 21, 32],
  hitRating: [16, 17, 18, 31],
  hasteRating: [28, 29, 30, 36],
  armorPenetration: [44],
  defenseRating: [12],
  dodgeRating: [13],
  mp5: [43],
  expertiseRating: [37],
  parryRating: [14],
  spellPenetration: [47],
  blockRating: [15],
  armor: []
};

const itemStatLabels: Record<string, string> = {
  stamina: 'stamina',
  intellect: 'intellect',
  agility: 'agility',
  strength: 'strength',
  spellPower: 'spellPower',
  spirit: 'spirit',
  attackPower: 'attackPower',
  critRating: 'critRating',
  hitRating: 'hitRating',
  hasteRating: 'hasteRating',
  armorPenetration: 'armorPenetration',
  defenseRating: 'defenseRating',
  dodgeRating: 'dodgeRating',
  mp5: 'mp5',
  expertiseRating: 'expertiseRating',
  parryRating: 'parryRating',
  spellPenetration: 'spellPenetration',
  blockRating: 'blockRating',
  armor: 'armor',
  rangedAttackPower: 'rangedAttackPower'
};

export const itemStatOptions = Object.keys(itemStatLabels).map((value) => ({
  value,
  label: itemStatLabels[value] ?? value
}));

export const itemSlotOptions = Object.keys(slotValueToIds).map((value) => ({
  value,
  label: value
}));

export const itemQualityOptions = Object.entries(itemQualityNames).map(
  ([value, label]) => ({
    value,
    label,
    color: itemQualityColors[Number(value)]
  })
);

export const itemTypeOptionGroups = [
  {
    label: 'Armor',
    options: [
      ['4', 'All armor'],
      ['4:leather_lo', 'Leather and lower'],
      ['4:mail_lo', 'Mail and lower'],
      ['4:mail_hi', 'Mail and higher'],
      ['4-1', 'Cloth'],
      ['4-2', 'Leather'],
      ['4-3', 'Mail'],
      ['4-4', 'Plate'],
      ['4-6', 'Shield'],
      ['4-7', 'Libram'],
      ['4-8', 'Idol'],
      ['4-9', 'Totem'],
      ['4-10', 'Sigil']
    ]
  },
  {
    label: 'Weapon',
    options: [
      ['2', 'All weapons'],
      ['2:one_hand', 'All 1H'],
      ['2:two_hand', 'All 2H'],
      ['2:ranged', 'All ranged'],
      ['2:melee', 'All melee'],
      ['2-15', 'Dagger'],
      ['2-7', '1H Sword'],
      ['2-8', '2H Sword'],
      ['2-4', '1H Mace'],
      ['2-5', '2H Mace'],
      ['2-0', '1H Axe'],
      ['2-1', '2H Axe'],
      ['2-13', 'Fist Weapon'],
      ['2-6', 'Polearm'],
      ['2-10', 'Staff'],
      ['2-2', 'Bow'],
      ['2-3', 'Gun'],
      ['2-18', 'Crossbow'],
      ['2-19', 'Wand'],
      ['2-16', 'Thrown'],
      ['2-20', 'Fishing Pole']
    ]
  },
  {
    label: 'Other',
    options: [
      ['0', 'Consumable'],
      ['3', 'Gem'],
      ['5', 'Reagent'],
      ['6', 'Projectile'],
      ['7', 'Trade Goods'],
      ['9', 'Recipe'],
      ['11', 'Quiver'],
      ['12', 'Quest'],
      ['13', 'Key'],
      ['1', 'Container'],
      ['15', 'Miscellaneous'],
      ['16', 'Glyph']
    ]
  }
] as const;

function quoteIdentifier(identifier: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function normalizedInt(value: number | undefined, min: number, max: number) {
  if (!Number.isFinite(value)) return undefined;
  const integer = Math.trunc(Number(value));
  return integer >= min && integer <= max ? integer : undefined;
}

function stringValues(value: ItemListingFilterValue) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry && array.indexOf(entry) === index);
}

function normalizeInput(input: ItemListingInput) {
  const sortValues = new Set<ItemListingSort>([
    'default',
    'stat',
    'total',
    'density',
    'ilvl',
    'req',
    'slot',
    'class',
    'name',
    'weighted',
    'id'
  ]);
  const sort = sortValues.has(input.sort as ItemListingSort)
    ? (input.sort as ItemListingSort)
    : 'default';
  const stats = stringValues(input.stat).filter((stat) => statTypeIds[stat]);
  const qualities = stringValues(input.quality)
    .map((quality) => normalizedInt(Number(quality), 0, 7))
    .filter((quality): quality is number => quality !== undefined);
  const slots = stringValues(input.slot).filter((slot) => slotValueToIds[slot]);

  return {
    page: normalizedInt(input.page, 1, 100000) ?? 1,
    pageSize: normalizedInt(input.pageSize, 1, 100) ?? 50,
    query: input.query?.trim() ?? '',
    itemIds: (input.itemIds ?? [])
      .map((itemId) => normalizedInt(itemId, 1, 2147483647))
      .filter((itemId): itemId is number => itemId !== undefined),
    types: stringValues(input.type),
    qualities,
    slots,
    stats,
    stat: stats[0] ?? '',
    minItemLevel: normalizedInt(input.minItemLevel, 0, 500),
    maxItemLevel: normalizedInt(input.maxItemLevel, 0, 500),
    minRequiredLevel: normalizedInt(input.minRequiredLevel, 0, 255),
    maxRequiredLevel:
      normalizedInt(input.maxRequiredLevel, 0, 255) ??
      DEFAULT_ITEM_MAX_REQUIRED_LEVEL,
    sort,
    direction: input.direction === 'asc' ? 'asc' : input.direction === 'desc' ? 'desc' : '',
    weights: (input.weights ?? []).filter(
      (weight) =>
        statTypeIds[weight.stat] &&
        Number.isFinite(weight.weight) &&
        weight.weight !== 0
    ),
    weightedTotalMin: Number.isFinite(input.weightedTotalMin)
      ? input.weightedTotalMin
      : undefined,
    weightedTotalMax: Number.isFinite(input.weightedTotalMax)
      ? input.weightedTotalMax
      : undefined
  };
}

function idsSql(ids: number[]) {
  return ids.join(', ');
}

function statValueExpression(stat: string) {
  if (stat === 'armor') {
    return 'GREATEST(COALESCE(t.armor, 0), 0)';
  }

  const ids = statTypeIds[stat];
  if (!ids?.length) return '0';
  const idList = idsSql(ids);
  const parts = Array.from({ length: 10 }, (_, index) => {
    const slot = index + 1;
    return `CASE WHEN t."statType${slot}" IN (${idList}) THEN GREATEST(COALESCE(t."statValue${slot}", 0), 0) ELSE 0 END`;
  });
  return `(${parts.join(' + ')})`;
}

function selectedStatsExpression(stats: string[]) {
  if (stats.length === 0) return '0';
  return `(${stats.map((stat) => statValueExpression(stat)).join(' + ')})`;
}

function totalStatsExpression() {
  return `(${Array.from({ length: 10 }, (_, index) => {
    const slot = index + 1;
    return `GREATEST(COALESCE(t."statValue${slot}", 0), 0)`;
  }).join(' + ')})`;
}

function weightedExpression(weights: WeightedStatFilter[]) {
  if (weights.length === 0) return '0';
  return `(${weights
    .map((weight) => {
      const coefficient = Number(weight.weight.toFixed(4));
      return `(${statValueExpression(weight.stat)} * ${coefficient})`;
    })
    .join(' + ')})`;
}

function itemTypeWhere(type: string) {
  if (!type) return '';

  const categoryAliases: Record<string, string> = {
    weapons: '2',
    armor: '4',
    containers: '1',
    consumables: '0',
    gems: '3',
    glyphs: '16',
    'trade-goods': '7',
    'quest-items': '12'
  };
  const normalizedType = categoryAliases[type] ?? type;
  const groupClauses: Record<string, string> = {
    '4:leather_lo': 't.class = 4 AND t."subClass" IN (1, 2)',
    '4:mail_lo': 't.class = 4 AND t."subClass" IN (1, 2, 3)',
    '4:mail_hi': 't.class = 4 AND t."subClass" IN (3, 4)',
    '2:one_hand': 't.class = 2 AND (t."subClass" IN (0, 4, 7, 13, 15) OR t.slot IN (13, 21))',
    '2:two_hand': 't.class = 2 AND (t."subClass" IN (1, 5, 6, 8, 10) OR t.slot = 17)',
    '2:ranged': 't.class = 2 AND (t."subClass" IN (2, 3, 16, 18, 19) OR t.slot IN (15, 25, 26))',
    '2:melee': 't.class = 2 AND t."subClass" NOT IN (2, 3, 16, 18, 19)'
  };
  if (groupClauses[normalizedType]) {
    return groupClauses[normalizedType];
  }

  const classAndSubclass = normalizedType.match(/^(\d+)-(\d+)$/);
  if (classAndSubclass) {
    const itemClass = Number(classAndSubclass[1]);
    const subclass = Number(classAndSubclass[2]);
    return Number.isInteger(itemClass) && Number.isInteger(subclass)
      ? `t.class = ${itemClass} AND t."subClass" = ${subclass}`
      : '';
  }

  const itemClass = Number(normalizedType);
  return Number.isInteger(itemClass) && itemClass >= 0 && itemClass <= 20
    ? `t.class = ${itemClass}`
    : '';
}

function normalizeItemRow(row: ItemRow): GameEntitySummary {
  return {
    id: Number(row.id),
    kind: 'items',
    slug: getEntityDetailSlug('items', row.id),
    name: row.name || `Item #${row.id}`,
    description: row.description ?? null,
    category: String(row.class ?? ''),
    icon: iconNameToUrl(row.icon ?? 'inv_misc_questionmark'),
    metadata: {
      class: Number(row.class ?? 0),
      subClass: Number(row.subClass ?? 0),
      slot: Number(row.slot ?? 0),
      quality: Number(row.quality ?? 0),
      itemLevel: Number(row.itemLevel ?? 0),
      requiredLevel: Number(row.requiredLevel ?? 0),
      statTotal: Number(row.statTotal ?? 0),
      selectedStatValue: Number(row.selectedStatValue ?? 0),
      weightedScore: Number(row.weightedScore ?? 0)
    },
    sourceTable: 'aowow_items'
  };
}

function itemTypeLabel(itemClass: number, subclass: number) {
  if (itemClass === 2) return weaponSubclassNames[subclass] ?? 'Weapon';
  if (itemClass === 4) return armorSubclassNames[subclass] ?? 'Armor';
  return itemClassNames[itemClass] ?? 'Miscellaneous';
}

export function itemListingFields(item: GameEntitySummary) {
  const metadata = item.metadata;
  const itemClass = Number(metadata.class ?? 0);
  const subclass = Number(metadata.subClass ?? 0);
  const slotId = Number(metadata.slot ?? 0);
  const quality = Number(metadata.quality ?? 0);
  const itemLevel = Number(metadata.itemLevel ?? 0);
  const requiredLevel = Number(metadata.requiredLevel ?? 0);
  const statTotal = Number(metadata.statTotal ?? 0);
  const selectedStatValue = Number(metadata.selectedStatValue ?? 0);
  const weightedScore = Number(metadata.weightedScore ?? 0);

  return {
    quality,
    qualityColor: itemQualityColors[quality] ?? itemQualityColors[1],
    slot: slotIdToValue.get(slotId) ?? inventoryTypeNames[slotId]?.toLowerCase() ?? '',
    type: itemTypeLabel(itemClass, subclass),
    itemLevel,
    requiredLevel,
    statTotal,
    selectedStatValue,
    weightedScore
  };
}

function mockResult(input: ReturnType<typeof normalizeInput>): ItemListingResult {
  const all = getMockEntities('items')
    .filter((item) => isVisibleGameEntityName('items', item.name))
    .filter((item) =>
      input.itemIds.length > 0 ? input.itemIds.includes(item.id) : true
    )
    .filter((item) =>
      input.query
        ? item.name.toLowerCase().includes(input.query.toLowerCase())
        : true
    );
  const offset = (input.page - 1) * input.pageSize;

  return {
    items: all.slice(offset, offset + input.pageSize),
    total: all.length,
    page: input.page,
    pageSize: input.pageSize,
    adapter: 'mock',
    selectedStat: input.stat,
    selectedStats: input.stats,
    hasMore: offset + input.pageSize < all.length
  };
}

export async function listItemsForListing(
  rawInput: ItemListingInput = {}
): Promise<ItemListingResult> {
  const input = normalizeInput(rawInput);
  const pool = getGamePool();

  if (rawInput.itemIds && input.itemIds.length === 0) {
    return {
      items: [],
      total: 0,
      page: input.page,
      pageSize: input.pageSize,
      adapter: hasGameDatabase() && pool ? 'postgres' : 'mock',
      selectedStat: input.stat,
      selectedStats: input.stats,
      hasMore: false
    };
  }

  if (!hasGameDatabase() || !pool) {
    return mockResult(input);
  }

  return cacheJson(`game:items:listing:v4:${JSON.stringify(input)}`, 60, async () => {
    const schema = quoteIdentifier(getGameSchema());
    const params: unknown[] = [];
    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const clauses = [
      `btrim(CAST(t.name_loc0 AS text)) <> ALL (${hiddenItemNamesSql})`,
      `NOT EXISTS (
        SELECT 1
        FROM unnest(${hiddenItemNameFragmentsSql}) hidden_name(fragment)
        WHERE btrim(CAST(t.name_loc0 AS text)) ILIKE '%' || hidden_name.fragment || '%'
      )`
    ];
    const selectedStatExpr = selectedStatsExpression(input.stats);
    const statTotalExpr = totalStatsExpression();
    const weightedScoreExpr = weightedExpression(input.weights);
    const typeClauses = input.types.map(itemTypeWhere).filter(Boolean);
    const slotIds = Array.from(
      new Set(input.slots.flatMap((slot) => slotValueToIds[slot] ?? []))
    );

    if (input.query) {
      clauses.push(
        `concat_ws(' ', t.name_loc0, t.description_loc0, item_effects.search_text) ILIKE ${addParam(`%${input.query}%`)}`
      );
    }
    if (input.itemIds.length > 0) {
      clauses.push(`t.id = ANY (${addParam(input.itemIds)}::int[])`);
    }
    if (typeClauses.length > 0) {
      clauses.push(`(${typeClauses.map((clause) => `(${clause})`).join(' OR ')})`);
    }
    if (input.qualities.length > 0) {
      clauses.push(`t.quality = ANY (${addParam(input.qualities)}::int[])`);
    }
    if (slotIds.length > 0) clauses.push(`t.slot IN (${idsSql(slotIds)})`);
    if (input.stats.length > 0) clauses.push(`${selectedStatExpr} > 0`);
    if (input.minItemLevel !== undefined) {
      clauses.push(`t."itemLevel" >= ${addParam(input.minItemLevel)}`);
    }
    if (input.maxItemLevel !== undefined) {
      clauses.push(`t."itemLevel" <= ${addParam(input.maxItemLevel)}`);
    }
    if (input.minRequiredLevel !== undefined) {
      clauses.push(`t."requiredLevel" >= ${addParam(input.minRequiredLevel)}`);
    }
    if (input.maxRequiredLevel !== undefined) {
      clauses.push(`t."requiredLevel" <= ${addParam(input.maxRequiredLevel)}`);
    }
    for (const weight of input.weights) {
      const valueExpr = statValueExpression(weight.stat);
      if (weight.min !== undefined && Number.isFinite(weight.min)) {
        clauses.push(`${valueExpr} >= ${addParam(weight.min)}`);
      }
      if (weight.max !== undefined && Number.isFinite(weight.max)) {
        clauses.push(`${valueExpr} <= ${addParam(weight.max)}`);
      }
    }
    if (input.weightedTotalMin !== undefined) {
      clauses.push(`${weightedScoreExpr} >= ${addParam(input.weightedTotalMin)}`);
    }
    if (input.weightedTotalMax !== undefined) {
      clauses.push(`${weightedScoreExpr} <= ${addParam(input.weightedTotalMax)}`);
    }

    const where = `WHERE ${clauses.join(' AND ')}`;
    const explicitDirection =
      input.direction === 'asc' ? 'ASC' : input.direction === 'desc' ? 'DESC' : '';
    const defaultDirection = explicitDirection || 'DESC';
    const orderBy: Record<ItemListingSort, string> = {
      default: 't.quality DESC, t."itemLevel" DESC, lower(t.name_loc0) ASC',
      stat: `${selectedStatExpr} ${defaultDirection}, t.quality DESC, t."itemLevel" DESC`,
      total: `${statTotalExpr} ${defaultDirection}, t.quality DESC, t."itemLevel" DESC`,
      density: `CASE WHEN t."itemLevel" > 0 THEN (${statTotalExpr})::numeric / t."itemLevel" ELSE 0 END ${defaultDirection}, t.quality DESC`,
      ilvl: `t."itemLevel" ${defaultDirection}, t.quality DESC`,
      req: `t."requiredLevel" ${defaultDirection}, t."itemLevel" DESC`,
      slot: `t.slot ${explicitDirection || 'ASC'}, lower(t.name_loc0) ASC`,
      class: `t.class ${explicitDirection || 'ASC'}, t."subClass" ${explicitDirection || 'ASC'}, lower(t.name_loc0) ASC`,
      name: `lower(t.name_loc0) ${explicitDirection || 'ASC'}`,
      weighted: `${weightedScoreExpr} ${defaultDirection}, t.quality DESC, t."itemLevel" DESC`,
      id: `t.id ${explicitDirection || 'ASC'}`
    };
    const offset = (input.page - 1) * input.pageSize;
    const values = [...params, input.pageSize + 1, offset];
    const limitParam = `$${params.length + 1}`;
    const offsetParam = `$${params.length + 2}`;
    const itemEffectsJoin = input.query
      ? `
      LEFT JOIN LATERAL (
        SELECT string_agg(effect.search_text, ' ') AS search_text
        FROM app.item_tooltip_effects effect
        WHERE effect.item_id = t.id
      ) item_effects ON true`
      : '';

    const listSql = `
      SELECT
        t.id,
        t.name_loc0 AS name,
        t.description_loc0 AS description,
        icon.name AS icon,
        t.class,
        t."subClass",
        t.slot,
        t.quality,
        t."itemLevel",
        t."requiredLevel",
        ${statTotalExpr}::int AS "statTotal",
        ${selectedStatExpr}::int AS "selectedStatValue",
        ${weightedScoreExpr}::float8 AS "weightedScore"
      FROM ${schema}.aowow_items t
      LEFT JOIN ${schema}.aowow_icons icon ON icon.id = t."iconId"
      ${itemEffectsJoin}
      ${where}
      ORDER BY ${orderBy[input.sort]}, t.id ASC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `;
    const itemsResult = await pool.query<ItemRow>(listSql, values);
    const rows = itemsResult.rows.slice(0, input.pageSize);
    const hasMore = itemsResult.rows.length > input.pageSize;

    return {
      items: rows.map(normalizeItemRow),
      total: offset + rows.length + (hasMore ? 1 : 0),
      page: input.page,
      pageSize: input.pageSize,
      adapter: 'postgres' as const,
      selectedStat: input.stat,
      selectedStats: input.stats,
      hasMore
    };
  });
}
