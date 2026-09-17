import scaledumpResults from '@/data/scaledump-results.json';
import scaledumpReference from '@/data/scaledump-reference.json';
import scaledumpRules from '@/data/scaledump-rules.json';
import type {
  GameEntityDetail,
  GameEntitySummary
} from '@/server/game-data/types';

export const ITEM_SCALING_MIN_LEVEL = 1;
export const ITEM_SCALING_MAX_LEVEL = 60;

type Metadata = Record<string, string | number | boolean | null>;

type ScaleDumpData = {
  schema: string[];
  items: Record<string, Record<string, string>>;
};

type ScaleDumpReferenceData = {
  levels: number[];
  anchorLevels: number[];
  items: Record<string, Record<string, string>>;
};

type ScaleDumpRuleTuple = [
  column: number,
  referenceItemId: number,
  referenceColumn: number,
  meanAbsoluteError: number,
  maxAbsoluteError: number,
  validationSamples: number
];

type ScaleDumpRulesData = {
  itemColumnRules?: Record<string, ScaleDumpRuleTuple[]>;
};

type ScalingRow = Record<number, number>;

type ReferenceMatch = {
  itemId: string;
  row: ScalingRow;
};

type ReferenceColumn = {
  itemId: string;
  column: number;
};

const scaleDump = scaledumpResults as ScaleDumpData;
const scaleDumpItems = scaleDump.items;
const scaleDumpReference = scaledumpReference as ScaleDumpReferenceData;
const scaleDumpReferenceItems = scaleDumpReference.items;
const scaleDumpAnchorLevels = scaleDumpReference.anchorLevels;
const scaleDumpRules = scaledumpRules as unknown as ScaleDumpRulesData;
const scaleDumpItemColumnRules = scaleDumpRules.itemColumnRules ?? {};

const categoricalScalingColumns = new Set([
  16, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35
]);

const statTypeColumns = new Set([17, 19, 21, 23, 25, 27, 29, 31, 33, 35]);

const numericStatValueColumns = new Set([
  18, 20, 22, 24, 26, 28, 30, 32, 34, 36
]);

const structuralMaskColumns = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function numberValue(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function metadataNumber(
  entity: GameEntitySummary | GameEntityDetail,
  keys: string[]
) {
  for (const key of keys) {
    const value = numberValue(entity.metadata[key]);
    if (value) return value;
  }
  return 0;
}

export function itemBaseScalingLevel(
  entity: GameEntitySummary | GameEntityDetail
) {
  return metadataNumber(entity, ['itemLevel', 'ItemLevel']);
}

export function knownItemScalingLevels(
  entityOrItemId: GameEntitySummary | GameEntityDetail | number
) {
  const itemId =
    typeof entityOrItemId === 'number' ? entityOrItemId : entityOrItemId.id;
  return Object.keys(scaleDumpItems[String(itemId)] ?? {})
    .map((level) => Number(level))
    .filter((level) => Number.isInteger(level))
    .sort((left, right) => left - right);
}

export function availableItemScalingLevels(
  entityOrItemId: GameEntitySummary | GameEntityDetail | number
) {
  const itemId =
    typeof entityOrItemId === 'number' ? entityOrItemId : entityOrItemId.id;
  const exactReferenceLevels = Object.keys(
    scaleDumpReferenceItems[String(itemId)] ?? {}
  )
    .map((level) => Number(level))
    .filter((level) => Number.isInteger(level))
    .sort((left, right) => left - right);

  if (exactReferenceLevels.length > 0) return exactReferenceLevels;

  const knownLevels = knownItemScalingLevels(itemId);
  if (knownLevels.length < 2) return knownLevels;

  const minLevel = Math.max(ITEM_SCALING_MIN_LEVEL, knownLevels[0] ?? 0);
  const maxLevel = Math.min(
    ITEM_SCALING_MAX_LEVEL,
    knownLevels[knownLevels.length - 1] ?? 0
  );

  return Array.from(
    { length: maxLevel - minLevel + 1 },
    (_, index) => minLevel + index
  );
}

export function nearestKnownItemScalingLevel(
  entityOrItemId: GameEntitySummary | GameEntityDetail | number,
  preferredLevel: number
) {
  const levels = knownItemScalingLevels(entityOrItemId);
  if (levels.length === 0) return 0;

  return levels.reduce((nearest, level) =>
    Math.abs(level - preferredLevel) < Math.abs(nearest - preferredLevel)
      ? level
      : nearest
  );
}

export function nearestAvailableItemScalingLevel(
  entityOrItemId: GameEntitySummary | GameEntityDetail | number,
  preferredLevel: number
) {
  const levels = availableItemScalingLevels(entityOrItemId);
  if (levels.length === 0) return 0;

  return levels.reduce((nearest, level) =>
    Math.abs(level - preferredLevel) < Math.abs(nearest - preferredLevel)
      ? level
      : nearest
  );
}

export function isDynamicallyScalableItem(
  entity: GameEntitySummary | GameEntityDetail
) {
  return (
    entity.kind === 'items' && availableItemScalingLevels(entity).length > 0
  );
}

export function defaultItemScalingLevel(
  entity: GameEntitySummary | GameEntityDetail
) {
  const baseItemLevel = itemBaseScalingLevel(entity);
  if (!baseItemLevel || !isDynamicallyScalableItem(entity)) return 0;

  return nearestAvailableItemScalingLevel(entity, baseItemLevel);
}

export function scaleItemNumber(
  value: unknown,
  fromItemLevel: number,
  toItemLevel: number,
  growth: number
) {
  const numericValue = numberValue(value);
  if (!numericValue || fromItemLevel === toItemLevel) return numericValue;

  const ratio = Math.pow(growth, toItemLevel - fromItemLevel);
  const sign = numericValue < 0 ? -1 : 1;
  const scaled = Math.round(Math.abs(numericValue) * ratio);
  return sign * Math.max(1, scaled);
}

const decodedRows = new Map<string, Record<number, number>>();
const referenceMaskIndexes = {
  fullOrdered: new Map<string, ReferenceMatch[]>(),
  fullSorted: new Map<string, ReferenceMatch[]>(),
  ordered: new Map<string, ReferenceMatch[]>(),
  sorted: new Map<string, ReferenceMatch[]>()
};
const referenceMaskIndexesBuilt = { value: false };
const selectedReferenceMatches = new Map<number, ReferenceMatch[]>();
const selectedReferenceColumns = new Map<string, ReferenceColumn | null>();

function packedRow(itemId: number, itemLevel: number) {
  return scaleDumpItems[String(itemId)]?.[String(itemLevel)] ?? null;
}

function packedReferenceRow(itemId: number, itemLevel: number) {
  return scaleDumpReferenceItems[String(itemId)]?.[String(itemLevel)] ?? null;
}

function decodePackedRow(packed: string) {
  const cached = decodedRows.get(packed);
  if (cached) return cached;

  const row: Record<number, number> = {};
  for (const part of packed.split(';')) {
    const [column, value] = part.split('=');
    const columnIndex = Number(column);
    const numericValue = Number(value);
    if (Number.isInteger(columnIndex) && Number.isFinite(numericValue)) {
      row[columnIndex] = numericValue;
    }
  }

  decodedRows.set(packed, row);
  return row;
}

function clampItemLevel(itemLevel: number) {
  if (!Number.isFinite(itemLevel)) return ITEM_SCALING_MIN_LEVEL;
  return Math.min(
    ITEM_SCALING_MAX_LEVEL,
    Math.max(ITEM_SCALING_MIN_LEVEL, Math.trunc(itemLevel))
  );
}

function anchorRowsForItem(itemId: number) {
  const rows: Record<number, ScalingRow> = {};

  for (const level of scaleDumpAnchorLevels) {
    const packed = packedRow(itemId, level);
    if (packed) rows[level] = decodePackedRow(packed);
  }

  return rows;
}

function mergedScalingRow(rows: Record<number, ScalingRow>) {
  const merged: ScalingRow = {};
  const levels = Object.keys(rows)
    .map((level) => Number(level))
    .filter((level) => Number.isInteger(level))
    .sort((left, right) => right - left);

  for (const level of levels) {
    for (const [column, value] of Object.entries(rows[level] ?? {})) {
      const columnIndex = Number(column);
      if (merged[columnIndex] === undefined && value !== 0) {
        merged[columnIndex] = value;
      }
    }
  }

  return merged;
}

function referenceRowsForItem(itemId: string) {
  const rows: Record<number, ScalingRow> = {};
  for (const [level, packed] of Object.entries(
    scaleDumpReferenceItems[itemId] ?? {}
  )) {
    rows[Number(level)] = decodePackedRow(packed);
  }
  return rows;
}

function statTypeList(row: ScalingRow) {
  const stats: number[] = [];
  for (const column of statTypeColumns) {
    const statType = row[column] ?? 0;
    if (statType) stats.push(statType);
  }
  return stats;
}

function structuralMask(row: ScalingRow) {
  return structuralMaskColumns
    .filter((column) => (row[column] ?? 0) !== 0)
    .join(',');
}

function maskKeys(row: ScalingRow) {
  const orderedStats = statTypeList(row).join(',');
  const sortedStats = statTypeList(row)
    .sort((left, right) => left - right)
    .join(',');
  const fieldMask = structuralMask(row);

  return {
    fullOrdered: `${fieldMask}|${orderedStats}`,
    fullSorted: `${fieldMask}|${sortedStats}`,
    ordered: orderedStats,
    sorted: sortedStats
  };
}

function pushReferenceMatch(
  map: Map<string, ReferenceMatch[]>,
  key: string,
  match: ReferenceMatch
) {
  const matches = map.get(key) ?? [];
  matches.push(match);
  map.set(key, matches);
}

function buildReferenceMaskIndexes() {
  if (referenceMaskIndexesBuilt.value) return;

  for (const [itemId] of Object.entries(scaleDumpReferenceItems)) {
    const row = mergedScalingRow(referenceRowsForItem(itemId));
    const match = { itemId, row };
    const keys = maskKeys(row);

    pushReferenceMatch(referenceMaskIndexes.fullOrdered, keys.fullOrdered, match);
    pushReferenceMatch(referenceMaskIndexes.fullSorted, keys.fullSorted, match);
    pushReferenceMatch(referenceMaskIndexes.ordered, keys.ordered, match);
    pushReferenceMatch(referenceMaskIndexes.sorted, keys.sorted, match);
  }

  referenceMaskIndexesBuilt.value = true;
}

function uniqueReferenceMatches(matches: ReferenceMatch[]) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    if (seen.has(match.itemId)) return false;
    seen.add(match.itemId);
    return true;
  });
}

function referenceMatchesForItem(itemId: number) {
  const cached = selectedReferenceMatches.get(itemId);
  if (cached) return cached;

  buildReferenceMaskIndexes();

  const row = mergedScalingRow(anchorRowsForItem(itemId));
  const keys = maskKeys(row);
  const matches = uniqueReferenceMatches([
    ...(referenceMaskIndexes.fullOrdered.get(keys.fullOrdered) ?? []),
    ...(referenceMaskIndexes.fullSorted.get(keys.fullSorted) ?? []),
    ...(referenceMaskIndexes.ordered.get(keys.ordered) ?? []),
    ...(referenceMaskIndexes.sorted.get(keys.sorted) ?? [])
  ]);

  selectedReferenceMatches.set(itemId, matches);
  return matches;
}

function precomputedReferenceColumnFor(itemId: number, column: number) {
  const rule = scaleDumpItemColumnRules[String(itemId)]?.find(
    ([ruleColumn]) => ruleColumn === column
  );
  if (!rule) return null;

  return {
    itemId: String(rule[1]),
    column: rule[2]
  };
}

function referenceColumnFor(itemId: number, column: number) {
  const cacheKey = `${itemId}:${column}`;
  if (selectedReferenceColumns.has(cacheKey)) {
    return selectedReferenceColumns.get(cacheKey) ?? null;
  }

  const precomputedReferenceColumn = precomputedReferenceColumnFor(
    itemId,
    column
  );
  if (precomputedReferenceColumn) {
    selectedReferenceColumns.set(cacheKey, precomputedReferenceColumn);
    return precomputedReferenceColumn;
  }

  const targetRow = mergedScalingRow(anchorRowsForItem(itemId));
  const matches = referenceMatchesForItem(itemId);
  let referenceColumn: ReferenceColumn | null = null;

  if (numericStatValueColumns.has(column)) {
    const statType = targetRow[column - 1] ?? 0;
    const match = matches.find((candidate) =>
      [...statTypeColumns].some(
        (typeColumn) => candidate.row[typeColumn] === statType
      )
    );
    const typeColumn = match
      ? [...statTypeColumns].find(
          (candidateColumn) => match.row[candidateColumn] === statType
        )
      : undefined;

    if (match && typeColumn !== undefined) {
      referenceColumn = {
        itemId: match.itemId,
        column: typeColumn + 1
      };
    }
  } else {
    const match =
      matches.find((candidate) => (candidate.row[column] ?? 0) !== 0) ??
      matches[0];
    if (match) {
      referenceColumn = {
        itemId: match.itemId,
        column
      };
    }
  }

  selectedReferenceColumns.set(cacheKey, referenceColumn);
  return referenceColumn;
}

function boundingAnchorLevels(itemId: number, itemLevel: number) {
  const levels = knownItemScalingLevels(itemId);
  const lower = levels
    .slice()
    .reverse()
    .find((level) => level <= itemLevel);
  const upper = levels.find((level) => level >= itemLevel);

  if (lower === undefined || upper === undefined) return null;
  return { lower, upper };
}

function nearestAnchorRow(itemId: number, itemLevel: number) {
  const nearestLevel = nearestKnownItemScalingLevel(itemId, itemLevel);
  if (!nearestLevel) return null;

  const packed = packedRow(itemId, nearestLevel);
  return packed ? { row: decodePackedRow(packed), level: nearestLevel } : null;
}

function referenceWeight(
  referenceColumn: ReferenceColumn | null,
  lower: number,
  upper: number,
  itemLevel: number
) {
  if (!referenceColumn) return null;

  const lowerPacked = packedReferenceRow(Number(referenceColumn.itemId), lower);
  const upperPacked = packedReferenceRow(Number(referenceColumn.itemId), upper);
  const targetPacked = packedReferenceRow(
    Number(referenceColumn.itemId),
    itemLevel
  );
  if (!lowerPacked || !upperPacked || !targetPacked) return null;

  const lowerValue = decodePackedRow(lowerPacked)[referenceColumn.column] ?? 0;
  const upperValue = decodePackedRow(upperPacked)[referenceColumn.column] ?? 0;
  const targetValue = decodePackedRow(targetPacked)[referenceColumn.column] ?? 0;
  if (upperValue === lowerValue) return null;

  return (targetValue - lowerValue) / (upperValue - lowerValue);
}

function nearestAnchorValue(
  lower: number,
  upper: number,
  itemLevel: number,
  lowerValue: number,
  upperValue: number
) {
  return itemLevel - lower <= upper - itemLevel ? lowerValue : upperValue;
}

function interpolateNumber(
  itemId: number,
  column: number,
  lower: number,
  upper: number,
  itemLevel: number,
  lowerValue: number,
  upperValue: number
) {
  if (lowerValue === upperValue) return lowerValue;

  const weight = referenceWeight(
    referenceColumnFor(itemId, column),
    lower,
    upper,
    itemLevel
  );

  if (weight === null) {
    return nearestAnchorValue(
      lower,
      upper,
      itemLevel,
      lowerValue,
      upperValue
    );
  }

  return Math.round(lowerValue + (upperValue - lowerValue) * weight);
}

function categoricalValue(
  column: number,
  lowerRow: ScalingRow,
  upperRow: ScalingRow,
  lower: number,
  upper: number,
  itemLevel: number
) {
  const lowerValue = lowerRow[column] ?? 0;
  const upperValue = upperRow[column] ?? 0;
  if (lowerValue === upperValue) return lowerValue;

  if (statTypeColumns.has(column)) {
    const statValueColumn = column + 1;
    const lowerStatValue = lowerRow[statValueColumn] ?? 0;
    const upperStatValue = upperRow[statValueColumn] ?? 0;
    if (lowerStatValue && !upperStatValue) return lowerValue;
    if (upperStatValue && !lowerStatValue) return upperValue;
  }

  return itemLevel - lower <= upper - itemLevel ? lowerValue : upperValue;
}

function interpolatedRow(itemId: number, itemLevel: number) {
  const bounds = boundingAnchorLevels(itemId, itemLevel);
  if (!bounds) return nearestAnchorRow(itemId, itemLevel);

  if (bounds.lower === bounds.upper) {
    const packed = packedRow(itemId, bounds.lower);
    return packed
      ? { row: decodePackedRow(packed), level: bounds.lower }
      : nearestAnchorRow(itemId, itemLevel);
  }

  const lowerPacked = packedRow(itemId, bounds.lower);
  const upperPacked = packedRow(itemId, bounds.upper);
  if (!lowerPacked || !upperPacked) return nearestAnchorRow(itemId, itemLevel);

  const lowerRow = decodePackedRow(lowerPacked);
  const upperRow = decodePackedRow(upperPacked);
  const row: ScalingRow = {};

  for (let column = 1; column <= 36; column += 1) {
    if (categoricalScalingColumns.has(column)) {
      row[column] = categoricalValue(
        column,
        lowerRow,
        upperRow,
        bounds.lower,
        bounds.upper,
        itemLevel
      );
      continue;
    }

    row[column] = interpolateNumber(
      itemId,
      column,
      bounds.lower,
      bounds.upper,
      itemLevel,
      lowerRow[column] ?? 0,
      upperRow[column] ?? 0
    );
  }

  return { row, level: itemLevel };
}

function scalingRowForLevel(itemId: number, itemLevel: number) {
  const level = clampItemLevel(itemLevel);
  const exactPacked = packedRow(itemId, level);
  if (exactPacked) {
    return {
      row: decodePackedRow(exactPacked),
      level,
      source: 'scaledump-results'
    };
  }

  const referencePacked = packedReferenceRow(itemId, level);
  if (referencePacked) {
    return {
      row: decodePackedRow(referencePacked),
      level,
      source: 'scaledump-reference'
    };
  }

  const interpolated = interpolatedRow(itemId, level);
  if (!interpolated) return null;

  return {
    ...interpolated,
    source:
      interpolated.level === level
        ? 'scaledump-interpolated'
        : 'scaledump-results'
  };
}

function clearScaledMetadata(metadata: Metadata) {
  for (const key of [
    'requiredLevel',
    'RequiredLevel',
    'sellPrice',
    'SellPrice',
    'armor',
    'Armor',
    'itemArmor',
    'ItemArmor',
    'armorReborn',
    'ItemArmorReborn',
    'block',
    'dmgMin1',
    'dmgMax1',
    'dmgMin2',
    'dmgMax2',
    'resHoly',
    'resFire',
    'resNature',
    'resFrost',
    'resShadow',
    'resArcane',
    'randomProperty'
  ]) {
    metadata[key] = 0;
  }

  for (let index = 1; index <= 10; index += 1) {
    metadata[`statType${index}`] = 0;
    metadata[`statValue${index}`] = 0;
  }
}

function setIfPresent(
  metadata: Metadata,
  row: Record<number, number>,
  column: number,
  keys: string[]
) {
  const value = row[column] ?? 0;
  for (const key of keys) {
    metadata[key] = value;
  }
}

function applyPackedScalingRow(metadata: Metadata, row: Record<number, number>) {
  clearScaledMetadata(metadata);
  const itemArmor = row[3] ?? 0;
  const rebornArmor = row[4] ?? 0;
  const displayArmor = rebornArmor || itemArmor;

  setIfPresent(metadata, row, 1, ['requiredLevel', 'RequiredLevel']);
  setIfPresent(metadata, row, 2, ['sellPrice', 'SellPrice']);
  metadata.armor = displayArmor;
  metadata.Armor = displayArmor;
  metadata.itemArmor = itemArmor;
  metadata.ItemArmor = itemArmor;
  metadata.armorReborn = rebornArmor;
  metadata.ItemArmorReborn = rebornArmor;
  setIfPresent(metadata, row, 5, ['block']);
  setIfPresent(metadata, row, 6, ['dmgMin1']);
  setIfPresent(metadata, row, 7, ['dmgMax1']);
  setIfPresent(metadata, row, 8, ['dmgMin2']);
  setIfPresent(metadata, row, 9, ['dmgMax2']);
  setIfPresent(metadata, row, 10, ['resHoly']);
  setIfPresent(metadata, row, 11, ['resFire']);
  setIfPresent(metadata, row, 12, ['resNature']);
  setIfPresent(metadata, row, 13, ['resFrost']);
  setIfPresent(metadata, row, 14, ['resShadow']);
  setIfPresent(metadata, row, 15, ['resArcane']);
  setIfPresent(metadata, row, 16, ['randomProperty']);

  for (let index = 0; index < 10; index += 1) {
    const statSlot = index + 1;
    metadata[`statType${statSlot}`] = row[17 + index * 2] ?? 0;
    metadata[`statValue${statSlot}`] = row[18 + index * 2] ?? 0;
  }
}

export function scaleItemEntityLevel<
  T extends GameEntitySummary | GameEntityDetail
>(entity: T, itemLevel: number): T {
  const scalingRow = scalingRowForLevel(entity.id, itemLevel);
  if (!scalingRow) return entity;

  const metadata = { ...entity.metadata };
  applyPackedScalingRow(metadata, scalingRow.row);
  metadata.itemLevel = scalingRow.level;
  metadata.ItemLevel = scalingRow.level;
  metadata.__itemScalingSource = scalingRow.source;

  return {
    ...entity,
    metadata
  };
}
