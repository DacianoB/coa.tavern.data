import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type Options = {
  inputDir: string;
  referencePath: string;
  outputDir: string;
};

type PlainItems = Record<string, Record<string, string>>;
type MutableItems = Map<number, Map<number, string>>;
type ScalingRow = Record<number, number>;
type ProgressValue = string | number | boolean | null;
type Progress = Record<string, ProgressValue>;
type ReferenceMatch = {
  itemId: string;
  row: ScalingRow;
};
type ReferenceColumn = {
  itemId: string;
  column: number;
};
type RuleTuple = [
  column: number,
  referenceItemId: number,
  referenceColumn: number,
  meanAbsoluteError: number,
  maxAbsoluteError: number,
  validationSamples: number,
];

const defaultInputDir = path.join(
  "Inteface",
  "Addons",
  "Scaledump",
  "Scalesdumpes",
);
const defaultReferencePath = "Scaledump.lua";
const defaultOutputDir = path.join("src", "data");

const schema = [
  "RequiredLevel",
  "SellPrice",
  "ItemArmor",
  "ItemArmorReborn",
  "ItemBlock",
  "ItemDamageMin0",
  "ItemDamageMax0",
  "ItemDamageMin1",
  "ItemDamageMax1",
  "ItemHolyRes",
  "ItemFireRes",
  "ItemNatureRes",
  "ItemFrostRes",
  "ItemShadowRes",
  "ItemArcaneRes",
  "RandomProperty",
  "ItemStatsType0",
  "ItemStatsValue0",
  "ItemStatsType1",
  "ItemStatsValue1",
  "ItemStatsType2",
  "ItemStatsValue2",
  "ItemStatsType3",
  "ItemStatsValue3",
  "ItemStatsType4",
  "ItemStatsValue4",
  "ItemStatsType5",
  "ItemStatsValue5",
  "ItemStatsType6",
  "ItemStatsValue6",
  "ItemStatsType7",
  "ItemStatsValue7",
  "ItemStatsType8",
  "ItemStatsValue8",
  "ItemStatsType9",
  "ItemStatsValue9",
];

const statMask = {
  0: "Mana",
  1: "Health",
  3: "Agility",
  4: "Strength",
  5: "Intellect",
  6: "Spirit",
  7: "Stamina",
  12: "Defense Rating",
  13: "Dodge Rating",
  14: "Parry Rating",
  15: "Block Rating",
  31: "Hit Rating",
  32: "Crit Rating",
  35: "Resilience Rating",
  36: "Haste Rating",
  37: "Expertise Rating",
  38: "Attack Power",
  39: "Ranged Attack Power",
  44: "Armor Penetration Rating",
  45: "Spell Power",
  48: "Block Value",
} satisfies Record<number, string>;

const anchorLevels = [1, 15, 30, 45, 60];
const allLevels = Array.from({ length: 60 }, (_, index) => index + 1);
const categoricalScalingColumns = new Set([
  16, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35,
]);
const statTypeColumns = new Set([17, 19, 21, 23, 25, 27, 29, 31, 33, 35]);
const numericStatValueColumns = new Set([
  18, 20, 22, 24, 26, 28, 30, 32, 34, 36,
]);
const structuralMaskColumns = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const decodedRows = new Map<string, ScalingRow>();

function parseArgs(args: string[]): Options {
  const options: Options = {
    inputDir: defaultInputDir,
    referencePath: defaultReferencePath,
    outputDir: defaultOutputDir,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input" || arg === "--input-dir") {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a path value.`);
      options.inputDir = value;
      index += 1;
      continue;
    }
    if (arg === "--reference") {
      const value = args[index + 1];
      if (!value) throw new Error("--reference requires a path value.");
      options.referencePath = value;
      index += 1;
      continue;
    }
    if (arg === "--out" || arg === "--output-dir") {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a path value.`);
      options.outputDir = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage:",
          "  pnpm game:scaledump",
          "  pnpm game:scaledump -- --input Inteface/Addons/Scaledump/Scalesdumpes",
          "",
          "Options:",
          "  --input PATH       Folder containing sparse ScaleDumpDB Lua dumps.",
          "  --reference PATH   Dense 1-60 reference Lua dump. Default: Scaledump.lua",
          "  --out PATH         Output folder. Default: src/data",
        ].join("\n"),
      );
      process.exit(0);
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function stableRelativePath(filePath: string) {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");
}

function decodeLuaValue(raw: string): ProgressValue {
  const trimmed = raw.trim().replace(/,$/, "");
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePackedRow(packed: string) {
  const values = new Map<number, number>();
  for (const part of packed.split(";")) {
    const [columnRaw, valueRaw] = part.split("=");
    const column = Number(columnRaw);
    const value = Number(valueRaw);
    if (
      Number.isInteger(column) &&
      column >= 1 &&
      column <= schema.length &&
      Number.isFinite(value) &&
      value !== 0
    ) {
      values.set(column, value);
    }
  }

  return [...values.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([column, value]) => `${column}=${value}`)
    .join(";");
}

function decodePackedRow(packed: string) {
  const cached = decodedRows.get(packed);
  if (cached) return cached;

  const row: ScalingRow = {};
  for (const part of packed.split(";")) {
    const [columnRaw, valueRaw] = part.split("=");
    const column = Number(columnRaw);
    const value = Number(valueRaw);
    if (Number.isInteger(column) && Number.isFinite(value)) {
      row[column] = value;
    }
  }

  decodedRows.set(packed, row);
  return row;
}

function packDenseRow(values: number[]) {
  const packed: string[] = [];
  for (let column = 1; column <= schema.length; column += 1) {
    const value = values[column] ?? 0;
    if (value !== 0) packed.push(`${column}=${value}`);
  }
  return packed.join(";");
}

async function findSparseDumpFiles(inputDir: string) {
  const entries = await readdir(inputDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".lua"))
      .map(async (entry) => {
        const filePath = path.join(inputDir, entry.name);
        const fileStat = await stat(filePath);
        return { filePath, mtimeMs: fileStat.mtimeMs, size: fileStat.size };
      }),
  );

  return files.sort((left, right) =>
    left.mtimeMs === right.mtimeMs
      ? left.filePath.localeCompare(right.filePath)
      : left.mtimeMs - right.mtimeMs,
  );
}

async function parseSparseDump(filePath: string) {
  const text = await readFile(filePath, "utf8");
  const items: MutableItems = new Map();
  const progress: Progress = {};
  let inItems = false;
  let inProgress = false;
  let currentItemId: number | null = null;
  let rowCount = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!inItems && line.includes('["items"] = {')) {
      inItems = true;
      continue;
    }
    if (!inProgress && line.includes('["progress"] = {')) {
      inProgress = true;
      continue;
    }

    if (inProgress) {
      if (/^\s*},?\s*$/.test(line)) {
        inProgress = false;
        continue;
      }
      const progressMatch = line.match(/^\s*\["([^"]+)"\]\s*=\s*(.+?)\s*,?\s*$/);
      if (progressMatch) {
        progress[progressMatch[1] ?? ""] = decodeLuaValue(progressMatch[2] ?? "");
      }
      continue;
    }

    if (!inItems) continue;

    if (currentItemId === null) {
      const itemMatch = line.match(/^\s*\[(\d+)\]\s*=\s*{\s*$/);
      if (itemMatch) {
        currentItemId = Number(itemMatch[1]);
        items.set(currentItemId, new Map());
        continue;
      }
      if (/^\s*},?\s*$/.test(line)) inItems = false;
      continue;
    }

    const rowMatch = line.match(/^\s*\["L(\d+)"\]\s*=\s*"([^"]*)"\s*,?\s*$/);
    if (rowMatch) {
      const level = Number(rowMatch[1]);
      const row = normalizePackedRow(rowMatch[2] ?? "");
      if (row) {
        items.get(currentItemId)?.set(level, row);
        rowCount += 1;
      }
      continue;
    }

    if (/^\s*},?\s*$/.test(line)) {
      currentItemId = null;
    }
  }

  return { items, progress, rowCount };
}

async function parseDenseReference(filePath: string) {
  const text = await readFile(filePath, "utf8");
  const items: PlainItems = {};
  const levels = new Set<number>();
  let inItems = false;
  let currentItemId: number | null = null;
  let currentRow: number[] | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (!inItems && line.includes('["items"] = {')) {
      inItems = true;
      continue;
    }
    if (!inItems) continue;

    if (currentItemId === null) {
      const itemMatch = line.match(/^\s*\[(\d+)\]\s*=\s*{\s*$/);
      if (itemMatch) {
        currentItemId = Number(itemMatch[1]);
        items[String(currentItemId)] = {};
        continue;
      }
      if (/^\s*},?\s*$/.test(line)) inItems = false;
      continue;
    }

    if (currentRow === null) {
      if (/^\s*{\s*$/.test(line)) {
        currentRow = [];
        continue;
      }
      if (/^\s*},?\s*$/.test(line)) {
        currentItemId = null;
      }
      continue;
    }

    const valueMatch = line.match(/^\s*(-?\d+)\s*,\s*--\s*\[(\d+)\]\s*$/);
    if (valueMatch) {
      currentRow[Number(valueMatch[2])] = Number(valueMatch[1]);
      continue;
    }

    const rowEndMatch = line.match(/^\s*},\s*--\s*\[(\d+)\]\s*$/);
    if (rowEndMatch) {
      const level = Number(rowEndMatch[1]);
      const packed = packDenseRow(currentRow);
      if (packed) {
        levels.add(level);
        items[String(currentItemId)][String(level)] = packed;
      }
      currentRow = null;
    }
  }

  return {
    source: stableRelativePath(filePath),
    format: "ScaleDumpDB dense packed GetScalingItemStats reference rows",
    levels: [...levels].sort((left, right) => left - right),
    anchorLevels,
    itemCount: Object.keys(items).length,
    items: sortPlainItems(items),
  };
}

function setMutableRow(
  target: MutableItems,
  itemId: number,
  level: number,
  row: string,
) {
  let levels = target.get(itemId);
  if (!levels) {
    levels = new Map();
    target.set(itemId, levels);
  }
  levels.set(level, row);
}

function sortPlainItems(items: PlainItems) {
  const sorted: PlainItems = {};
  for (const itemId of Object.keys(items).sort((left, right) => Number(left) - Number(right))) {
    const levels = items[itemId] ?? {};
    sorted[itemId] = {};
    for (const level of Object.keys(levels).sort((left, right) => Number(left) - Number(right))) {
      const row = levels[level];
      if (row) sorted[itemId][level] = row;
    }
  }
  return sorted;
}

function mutableItemsToPlain(items: MutableItems) {
  const plain: PlainItems = {};
  for (const [itemId, levels] of [...items.entries()].sort((left, right) => left[0] - right[0])) {
    plain[String(itemId)] = {};
    for (const [level, row] of [...levels.entries()].sort((left, right) => left[0] - right[0])) {
      plain[String(itemId)][String(level)] = row;
    }
  }
  return plain;
}

function countPlainRows(items: PlainItems) {
  let rows = 0;
  for (const levels of Object.values(items)) rows += Object.keys(levels).length;
  return rows;
}

function plainLevels(items: PlainItems) {
  const levels = new Set<number>();
  for (const rows of Object.values(items)) {
    for (const level of Object.keys(rows)) levels.add(Number(level));
  }
  return [...levels].sort((left, right) => left - right);
}

async function mergeSparseDumps(files: Awaited<ReturnType<typeof findSparseDumpFiles>>) {
  const merged: MutableItems = new Map();
  const rowSources = new Map<string, string>();
  const sourceFiles: string[] = [];
  const latestProgress: Progress = {};
  const stats = {
    sourceFileCount: files.length,
    inputRows: 0,
    uniqueItemLevelRows: 0,
    identicalDuplicates: 0,
    conflictsOverwrittenByNewerFile: 0,
  };

  for (const file of files) {
    const parsed = await parseSparseDump(file.filePath);
    sourceFiles.push(stableRelativePath(file.filePath));
    stats.inputRows += parsed.rowCount;
    Object.assign(latestProgress, parsed.progress);

    for (const [itemId, levels] of parsed.items) {
      for (const [level, row] of levels) {
        const existing = merged.get(itemId)?.get(level);
        const key = `${itemId}:${level}`;
        if (existing === undefined) {
          setMutableRow(merged, itemId, level, row);
          rowSources.set(key, file.filePath);
          continue;
        }
        if (existing === row) {
          stats.identicalDuplicates += 1;
          continue;
        }
        stats.conflictsOverwrittenByNewerFile += 1;
        setMutableRow(merged, itemId, level, row);
        rowSources.set(key, file.filePath);
      }
    }
  }

  const plainItems = mutableItemsToPlain(merged);
  stats.uniqueItemLevelRows = countPlainRows(plainItems);

  return {
    source: stableRelativePath(path.resolve(files[0]?.filePath ?? defaultInputDir, "..")),
    sourceFiles,
    progress: latestProgress,
    stats,
    items: plainItems,
  };
}

function buildCompactResults(items: PlainItems, sourceFiles: string[], stats: object) {
  const rows: string[] = [];
  const rowIndexes = new Map<string, number>();
  const compactItems: Record<string, number[]> = {};

  function rowIndex(row: string) {
    const existing = rowIndexes.get(row);
    if (existing !== undefined) return existing;
    const created = rows.length;
    rows.push(row);
    rowIndexes.set(row, created);
    return created;
  }

  for (const [itemId, levels] of Object.entries(sortPlainItems(items))) {
    const compactLevels: number[] = [];
    for (const [level, row] of Object.entries(levels)) {
      compactLevels.push(Number(level), rowIndex(row));
    }
    compactItems[itemId] = compactLevels;
  }

  return {
    source: defaultInputDir.replaceAll(path.sep, "/"),
    sourceFiles,
    format: "ScaleDumpDB compact deduped row dictionary",
    schema,
    statMask,
    levels: plainLevels(items),
    rowCount: countPlainRows(items),
    uniqueRowCount: rows.length,
    stats,
    rows,
    items: compactItems,
  };
}

function rowsForItem(items: PlainItems, itemId: string) {
  const rows: Record<number, ScalingRow> = {};
  for (const [level, packed] of Object.entries(items[itemId] ?? {})) {
    rows[Number(level)] = decodePackedRow(packed);
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
    .join(",");
}

function maskKeys(row: ScalingRow) {
  const orderedStats = statTypeList(row).join(",");
  const sortedStats = statTypeList(row)
    .sort((left, right) => left - right)
    .join(",");
  const fieldMask = structuralMask(row);

  return {
    fullOrdered: `${fieldMask}|${orderedStats}`,
    fullSorted: `${fieldMask}|${sortedStats}`,
    ordered: orderedStats,
    sorted: sortedStats,
  };
}

function pushReferenceMatch(
  map: Map<string, ReferenceMatch[]>,
  key: string,
  match: ReferenceMatch,
) {
  const matches = map.get(key) ?? [];
  matches.push(match);
  map.set(key, matches);
}

function uniqueReferenceMatches(matches: ReferenceMatch[]) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    if (seen.has(match.itemId)) return false;
    seen.add(match.itemId);
    return true;
  });
}

function buildReferenceMaskIndexes(referenceItems: PlainItems) {
  const indexes = {
    fullOrdered: new Map<string, ReferenceMatch[]>(),
    fullSorted: new Map<string, ReferenceMatch[]>(),
    ordered: new Map<string, ReferenceMatch[]>(),
    sorted: new Map<string, ReferenceMatch[]>(),
  };

  for (const itemId of Object.keys(referenceItems)) {
    const row = mergedScalingRow(rowsForItem(referenceItems, itemId));
    const keys = maskKeys(row);
    const match = { itemId, row };
    pushReferenceMatch(indexes.fullOrdered, keys.fullOrdered, match);
    pushReferenceMatch(indexes.fullSorted, keys.fullSorted, match);
    pushReferenceMatch(indexes.ordered, keys.ordered, match);
    pushReferenceMatch(indexes.sorted, keys.sorted, match);
  }

  return indexes;
}

function referenceMatchesForRow(
  row: ScalingRow,
  indexes: ReturnType<typeof buildReferenceMaskIndexes>,
) {
  const keys = maskKeys(row);
  return uniqueReferenceMatches([
    ...(indexes.fullOrdered.get(keys.fullOrdered) ?? []),
    ...(indexes.fullSorted.get(keys.fullSorted) ?? []),
    ...(indexes.ordered.get(keys.ordered) ?? []),
    ...(indexes.sorted.get(keys.sorted) ?? []),
  ]);
}

function candidateReferenceColumns(
  column: number,
  targetRow: ScalingRow,
  matches: ReferenceMatch[],
) {
  const candidates: ReferenceColumn[] = [];
  const seen = new Set<string>();

  function push(candidate: ReferenceColumn) {
    const key = `${candidate.itemId}:${candidate.column}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  }

  if (numericStatValueColumns.has(column)) {
    const statType = targetRow[column - 1] ?? 0;
    if (!statType) return candidates;

    for (const match of matches) {
      for (const typeColumn of statTypeColumns) {
        if (match.row[typeColumn] === statType) {
          push({ itemId: match.itemId, column: typeColumn + 1 });
        }
      }
    }
    return candidates;
  }

  for (const match of matches) {
    if ((match.row[column] ?? 0) !== 0) {
      push({ itemId: match.itemId, column });
    }
  }

  return candidates;
}

function referenceWeight(
  referenceItems: PlainItems,
  referenceColumn: ReferenceColumn,
  lower: number,
  upper: number,
  level: number,
) {
  const rows = referenceItems[referenceColumn.itemId];
  const lowerPacked = rows?.[String(lower)];
  const upperPacked = rows?.[String(upper)];
  const targetPacked = rows?.[String(level)];
  if (!lowerPacked || !upperPacked || !targetPacked) return null;

  const lowerValue = decodePackedRow(lowerPacked)[referenceColumn.column] ?? 0;
  const upperValue = decodePackedRow(upperPacked)[referenceColumn.column] ?? 0;
  const targetValue = decodePackedRow(targetPacked)[referenceColumn.column] ?? 0;
  if (upperValue === lowerValue) return null;

  return (targetValue - lowerValue) / (upperValue - lowerValue);
}

function evaluateReferenceColumn(
  referenceItems: PlainItems,
  targetRows: Record<number, ScalingRow>,
  levels: number[],
  targetColumn: number,
  referenceColumn: ReferenceColumn,
) {
  let totalError = 0;
  let maxError = 0;
  let samples = 0;

  for (let index = 1; index < levels.length - 1; index += 1) {
    const lower = levels[index - 1];
    const level = levels[index];
    const upper = levels[index + 1];
    if (lower === undefined || level === undefined || upper === undefined) continue;

    const lowerValue = targetRows[lower]?.[targetColumn] ?? 0;
    const upperValue = targetRows[upper]?.[targetColumn] ?? 0;
    const actualValue = targetRows[level]?.[targetColumn] ?? 0;
    let predictedValue: number | null = null;

    if (lowerValue === upperValue) {
      predictedValue = lowerValue;
    } else {
      const weight = referenceWeight(referenceItems, referenceColumn, lower, upper, level);
      if (weight !== null) {
        predictedValue = Math.round(lowerValue + (upperValue - lowerValue) * weight);
      }
    }

    if (predictedValue === null) continue;

    const error = Math.abs(predictedValue - actualValue);
    totalError += error;
    maxError = Math.max(maxError, error);
    samples += 1;
  }

  return {
    meanAbsoluteError: samples > 0 ? totalError / samples : 0,
    maxError,
    samples,
  };
}

function betterRule(
  left: ReturnType<typeof evaluateReferenceColumn> | null,
  right: ReturnType<typeof evaluateReferenceColumn>,
) {
  if (!left) return true;
  if (right.samples > 0 && left.samples === 0) return true;
  if (right.samples === 0 && left.samples > 0) return false;
  if (right.meanAbsoluteError !== left.meanAbsoluteError) {
    return right.meanAbsoluteError < left.meanAbsoluteError;
  }
  if (right.maxError !== left.maxError) return right.maxError < left.maxError;
  return right.samples > left.samples;
}

function metric(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : 0;
}

function buildScalingRules(items: PlainItems, referenceItems: PlainItems) {
  const referenceIndexes = buildReferenceMaskIndexes(referenceItems);
  const itemColumnRules: Record<string, RuleTuple[]> = {};
  const stats = {
    itemCount: Object.keys(items).length,
    referenceItemCount: Object.keys(referenceItems).length,
    itemsWithReferenceMatches: 0,
    itemsWithRules: 0,
    ruleCount: 0,
    scoredRuleCount: 0,
  };

  for (const itemId of Object.keys(items).sort((left, right) => Number(left) - Number(right))) {
    const targetRows = rowsForItem(items, itemId);
    const levels = Object.keys(targetRows)
      .map((level) => Number(level))
      .filter((level) => Number.isInteger(level))
      .sort((left, right) => left - right);
    if (levels.length < 2) continue;

    const targetRow = mergedScalingRow(targetRows);
    const matches = referenceMatchesForRow(targetRow, referenceIndexes);
    if (matches.length === 0) continue;
    stats.itemsWithReferenceMatches += 1;

    const rules: RuleTuple[] = [];
    for (let column = 1; column <= schema.length; column += 1) {
      if (categoricalScalingColumns.has(column)) continue;
      if (!levels.some((level) => (targetRows[level]?.[column] ?? 0) !== 0)) {
        continue;
      }

      const candidates = candidateReferenceColumns(column, targetRow, matches);
      if (candidates.length === 0) continue;

      let bestColumn = candidates[0];
      let bestScore: ReturnType<typeof evaluateReferenceColumn> | null = null;
      for (const candidate of candidates) {
        const score = evaluateReferenceColumn(
          referenceItems,
          targetRows,
          levels,
          column,
          candidate,
        );
        if (betterRule(bestScore, score)) {
          bestScore = score;
          bestColumn = candidate;
        }
      }

      if (!bestColumn || !bestScore) continue;
      rules.push([
        column,
        Number(bestColumn.itemId),
        bestColumn.column,
        metric(bestScore.meanAbsoluteError),
        metric(bestScore.maxError),
        bestScore.samples,
      ]);
      stats.ruleCount += 1;
      if (bestScore.samples > 0) stats.scoredRuleCount += 1;
    }

    if (rules.length > 0) {
      itemColumnRules[itemId] = rules;
      stats.itemsWithRules += 1;
    }
  }

  return {
    format: "precomputed ScaleDump interpolation reference-column rules",
    legend: {
      itemColumnRules:
        "[targetColumn, referenceItemId, referenceColumn, meanAbsoluteError, maxAbsoluteError, validationSamples]",
    },
    anchorLevels,
    categoricalScalingColumns: [...categoricalScalingColumns],
    statTypeColumns: [...statTypeColumns],
    numericStatValueColumns: [...numericStatValueColumns],
    structuralMaskColumns,
    stats,
    itemColumnRules,
  };
}

async function writeJson(filePath: string, data: unknown) {
  await writeFile(filePath, `${JSON.stringify(data)}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputDir = path.resolve(options.inputDir);
  const referencePath = path.resolve(options.referencePath);
  const outputDir = path.resolve(options.outputDir);
  const files = await findSparseDumpFiles(inputDir);

  if (files.length === 0) {
    throw new Error(`No .lua sparse dump files found in ${inputDir}`);
  }

  console.log(`Reading ${files.length} sparse dump file(s) from ${stableRelativePath(inputDir)}`);
  const merged = await mergeSparseDumps(files);
  console.log(
    `Merged ${merged.stats.inputRows} input rows into ${merged.stats.uniqueItemLevelRows} item-level rows`,
  );
  if (merged.stats.identicalDuplicates || merged.stats.conflictsOverwrittenByNewerFile) {
    console.log(
      `Dedupe: ${merged.stats.identicalDuplicates} identical duplicate row(s), ${merged.stats.conflictsOverwrittenByNewerFile} newer conflict overwrite(s)`,
    );
  }

  console.log(`Parsing dense reference from ${stableRelativePath(referencePath)}`);
  const reference = await parseDenseReference(referencePath);
  const rules = buildScalingRules(merged.items, reference.items);
  const compact = buildCompactResults(merged.items, merged.sourceFiles, merged.stats);

  await mkdir(outputDir, { recursive: true });
  await writeJson(path.join(outputDir, "scaledump-results.json"), {
    source: merged.source,
    sourceFiles: merged.sourceFiles,
    format: "ScaleDumpDB sparse packed GetScalingItemStats rows",
    schema,
    statMask,
    progress: merged.progress,
    levels: plainLevels(merged.items),
    itemCount: Object.keys(merged.items).length,
    rowCount: countPlainRows(merged.items),
    stats: merged.stats,
    items: merged.items,
  });
  await writeJson(path.join(outputDir, "scaledump-compact.json"), compact);
  await writeJson(path.join(outputDir, "scaledump-reference.json"), reference);
  await writeJson(path.join(outputDir, "scaledump-rules.json"), rules);

  console.log(
    [
      `Wrote ${stableRelativePath(path.join(outputDir, "scaledump-results.json"))}`,
      `Wrote ${stableRelativePath(path.join(outputDir, "scaledump-compact.json"))}`,
      `Wrote ${stableRelativePath(path.join(outputDir, "scaledump-reference.json"))}`,
      `Wrote ${stableRelativePath(path.join(outputDir, "scaledump-rules.json"))}`,
      `Rules: ${rules.stats.ruleCount} column rule(s), ${rules.stats.scoredRuleCount} scored by anchor leave-one-out validation`,
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
