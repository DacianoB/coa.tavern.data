import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { backupGameDatabase } from './lib/game-db-backup';
import { startImportJob } from './lib/import-history';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

type LuaObject = Record<string, unknown>;

type ScraperRecord = {
  id?: number | string;
  name?: string;
  rank?: string;
  subtext?: string;
  link?: string;
  icon?: string;
  texture?: string;
  quality?: number | string;
  itemLevel?: number | string;
  requiredLevel?: number | string;
  level_required?: number | string;
  itemClass?: string;
  itemSubClass?: string;
  maxStack?: number | string;
  equipSlot?: string;
  vendorPrice?: number | string;
  tooltip?: string | { plain?: string; lines?: unknown };
  tooltipLines?: unknown;
  description?: string;
  apiDescription?: string;
  tooltipDescription?: string;
  capturedAt?: number | string;
  school_mask?: number | string;
  schoolMask?: number | string;
  castTime?: number | string;
  duration?: number | string;
  baseDuration?: number | string;
  cooldown?: number | string | false;
  baseCooldown?: number | string;
  gcdCooldown?: number | string;
  resource_type?: number | string;
  resourceType?: number | string;
  resource_cost?: number | string;
  resourceCost?: number | string;
  minRange?: number | string;
  maxRange?: number | string;
  passive?: boolean;
  instant?: {
    itemId?: number | string | LuaObject;
    classId?: number | string;
    classID?: number | string;
    subClassId?: number | string;
    subclassID?: number | string;
    equipLoc?: string;
    inventoryType?: number | string;
    icon?: string;
    quality?: number | string;
    itemLevel?: number | string;
    description?: string;
    pvePower?: number | string;
    pvpPower?: number | string;
  };
  itemStats?: Record<string, number | string>;
};

type ScraperPayload = {
  items?: Record<string, ScraperRecord>;
  spells?: Record<string, ScraperRecord>;
  spellbook?: Record<string, ScraperRecord>;
  trainerServices?: Record<string, unknown>;
};

type ImportStats = {
  seen: number;
  updated: number;
  inserted: number;
  missing: number;
  skipped: number;
};

const connectionString =
  process.env.GAME_DATABASE_URL || process.env.DATABASE_URL;
const targetSchema = process.env.GAME_DATABASE_SCHEMA || 'game';
const importArgs = parseImportArgs(process.argv.slice(2));
const inputPath =
  importArgs.inputPath ||
  process.env.ASCENSION_SCRAPER_INPUT ||
  path.join('output', 'addon', 'tooltip-split');
const overwrite = process.env.ASCENSION_SCRAPER_OVERWRITE === '1';
const insertMissing = process.env.ASCENSION_SCRAPER_INSERT_MISSING !== '0';
const maxDirectInputBytes = 500_000_000;

function parseImportArgs(args: string[]) {
  let inputPath: string | undefined;
  let backupBeforeImport =
    process.env.ASCENSION_SCRAPER_BACKUP === '1' ||
    process.env.GAME_DB_BACKUP_BEFORE_IMPORT === '1';
  let backupOnly = false;
  let backupFile: string | undefined;
  let backupDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--backup') {
      backupBeforeImport = true;
      continue;
    }
    if (arg === '--backup-only') {
      backupBeforeImport = true;
      backupOnly = true;
      continue;
    }
    if (arg === '--backup-file') {
      backupFile = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--backup-file=')) {
      backupFile = arg.slice('--backup-file='.length);
      continue;
    }
    if (arg === '--backup-dir') {
      backupDir = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--backup-dir=')) {
      backupDir = arg.slice('--backup-dir='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    inputPath = arg;
  }

  return {
    inputPath,
    backupBeforeImport,
    backupOnly,
    backupFile,
    backupDir
  };
}

function quoteIdent(identifier: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isEmptyDbValue(value: unknown) {
  return value === null || value === undefined || value === '' || value === 0;
}

function isPlaceholderName(value: unknown, id: number, kind: 'item' | 'spell') {
  const text = stringValue(value);
  if (!text) return true;
  const label = kind === 'item' ? 'Item' : 'Spell';
  return text === `${label} #${id}`;
}

function normalizeIconName(value: string) {
  return (
    value
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.(jpg|jpeg|png|webp|blp)$/i, '')
      .toLowerCase() ?? ''
  );
}

function tooltipLinesText(value: unknown) {
  const rawLines = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => Number(left) - Number(right))
          .map(([, line]) => line)
      : [];
  const lines = rawLines
    .map((line) => {
      if (typeof line === 'string') return line.trim();
      if (!line || typeof line !== 'object') return '';

      const entry = line as Record<string, unknown>;
      const text = stringValue(entry.text);
      const left = stringValue(entry.left);
      const right = stringValue(entry.right);

      if (text) return text;
      if (left && right) return `${left}\t${right}`;
      return left || right;
    })
    .filter(Boolean);

  return lines.join('\n').trim();
}

function tooltipText(record: ScraperRecord) {
  if (typeof record.tooltip === 'string') return record.tooltip.trim();
  if (record.tooltip && typeof record.tooltip === 'object') {
    return (
      stringValue(record.tooltip.plain) ||
      tooltipLinesText(record.tooltip.lines)
    );
  }
  return tooltipLinesText(record.tooltipLines);
}

function isCharacterSpecificItemTooltipLine(line: string) {
  return (
    /^You've collected this appearance\.?$/i.test(line) ||
    /^You have collected this appearance\.?$/i.test(line) ||
    /^You haven't collected this appearance\.?$/i.test(line) ||
    /^You have not collected this appearance\.?$/i.test(line)
  );
}

function isAddonDebugItemTooltipLine(line: string) {
  const plain = line
    .replace(/\|c[0-9a-f]{8}/gi, '')
    .replace(/\|r/gi, '')
    .trim();
  return /^ID\s+\d+$/i.test(plain);
}

function itemTooltipText(record: ScraperRecord) {
  return itemTooltipContentLines(record).join('\n').trim();
}

function itemTooltipContentLines(record: ScraperRecord) {
  return tooltipText(record)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !isCharacterSpecificItemTooltipLine(line) &&
        !isAddonDebugItemTooltipLine(line)
    )
    .map(cleanTooltipLine);
}

function itemTooltipLines(record: ScraperRecord) {
  const raw = record.tooltipLines;
  if (!raw) return raw;

  const entries = Array.isArray(raw)
    ? raw
    : typeof raw === 'object'
      ? Object.fromEntries(
          Object.entries(raw as Record<string, unknown>).filter(([, line]) => {
            if (!line || typeof line !== 'object') return true;
            const entry = line as Record<string, unknown>;
            const text = stringValue(entry.text) || stringValue(entry.left);
            return (
              !isCharacterSpecificItemTooltipLine(text) &&
              !isAddonDebugItemTooltipLine(text)
            );
          })
        )
      : raw;

  if (!Array.isArray(entries)) return entries;

  return entries.filter((line) => {
    if (!line || typeof line !== 'object') return true;
    const entry = line as Record<string, unknown>;
    const text = stringValue(entry.text) || stringValue(entry.left);
    return (
      !isCharacterSpecificItemTooltipLine(text) &&
      !isAddonDebugItemTooltipLine(text)
    );
  });
}

function instantData(record: ScraperRecord) {
  const instant = record.instant;
  if (!instant || typeof instant !== 'object') return {};
  if (instant.itemId && typeof instant.itemId === 'object') {
    return instant.itemId as LuaObject;
  }
  return instant as LuaObject;
}

function instantString(record: ScraperRecord, key: string) {
  return stringValue(instantData(record)[key]);
}

function instantNumber(record: ScraperRecord, ...keys: string[]) {
  const data = instantData(record);
  for (const key of keys) {
    const value = numberValue(data[key]);
    if (value > 0) return value;
  }
  return 0;
}

function cleanDescription(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanItemFlavorText(value: string) {
  return cleanDescription(value).replace(/^"(.+)"$/, '$1');
}

const ITEM_DESCRIPTION_SOURCE_PREFIXES = ['Worldforged'];

function isDifficultySourceText(value: string) {
  return /^(Normal|Heroic|Mythic|Ascended)(?:\s+(?:\+?\d{1,2}|[A-Z][\w' -]*))?$/i.test(
    value.trim()
  );
}

function encodedItemDescription(source: string, flavor: string) {
  const cleanSource = cleanItemFlavorText(source);
  const cleanFlavor = cleanItemFlavorText(flavor);
  if (cleanSource && cleanFlavor) return `@${cleanSource}@${cleanFlavor}`;
  if (cleanSource) return `@${cleanSource}@`;
  return cleanFlavor;
}

function isSourceOnlyItemDescription(value: string) {
  return /^@[^@]+@$/.test(value.trim());
}

function encodedDescriptionParts(value: string) {
  const text = cleanDescription(value);
  const encoded = text.match(/^@([^@]+)@([\s\S]*)$/);
  if (encoded) {
    return {
      source: cleanItemFlavorText(encoded[1] ?? ''),
      flavor: cleanItemFlavorText(encoded[2] ?? '')
    };
  }

  for (const source of ITEM_DESCRIPTION_SOURCE_PREFIXES) {
    if (text.toLowerCase() === source.toLowerCase()) {
      return { source, flavor: '' };
    }

    if (text.toLowerCase().startsWith(`${source.toLowerCase()} `)) {
      return {
        source,
        flavor: cleanItemFlavorText(text.slice(source.length).trim())
      };
    }
  }

  if (isDifficultySourceText(text)) {
    return { source: cleanItemFlavorText(text), flavor: '' };
  }

  return null;
}

function normalizeItemDescription(value: string) {
  const parts = encodedDescriptionParts(value);
  return parts
    ? encodedItemDescription(parts.source, parts.flavor)
    : cleanDescription(value);
}

function isTooltipStructureLine(line: string) {
  return (
    /^Binds when\b/i.test(line) ||
    /^Binds to\b/i.test(line) ||
    /^Soulbound$/i.test(line) ||
    /^Unique\b/i.test(line) ||
    /^Quest Item$/i.test(line) ||
    /^(One-Hand|Two-Hand|Main Hand|Off Hand|Held In Off-hand|Head|Neck|Shoulder|Chest|Waist|Legs|Feet|Wrist|Hands|Finger|Trinket|Back|Ranged|Thrown|Relic|Shirt|Tabard)\b/i.test(
      line
    ) ||
    /^\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s+\S*\s*Damage\b/i.test(line) ||
    /^\(\d+(?:\.\d+)?\s+damage per second\)$/i.test(line) ||
    /^\+\d+\s+\S+/i.test(line) ||
    /^Requires\b/i.test(line) ||
    /^Item Level\b/i.test(line) ||
    /^(Equip|Use|Chance on hit):/i.test(line) ||
    /^Sell Price:/i.test(line)
  );
}

function itemTooltipStructureScore(value: string) {
  return [
    /\bBinds when\b/i,
    /\bBinds to\b/i,
    /\bSoulbound\b/i,
    /\bRequires Level\b/i,
    /\bItem Level\b/i,
    /\bEquip:/i,
    /\bUse:/i,
    /\bChance on hit:/i,
    /\bSell Price:/i,
    /\+\d+\s+(?:Agility|Strength|Intellect|Spirit|Stamina)\b/i,
    /\b(?:Head|Neck|Shoulder|Chest|Waist|Legs|Feet|Wrist|Hands|Finger|Trinket|Back|Ranged|One-Hand|Two-Hand)\b/i
  ].filter((pattern) => pattern.test(value)).length;
}

function isCopiedTooltipDescription(value: string, itemName = '') {
  const text = cleanDescription(value);
  if (!text) return false;

  const lines = text.split(/\r?\n/).map(cleanTooltipLine).filter(Boolean);
  if (lines.length > 1 && lines.some(isTooltipStructureLine)) return true;

  const startsWithName =
    itemName && text.toLowerCase().startsWith(itemName.toLowerCase());
  const score = itemTooltipStructureScore(text);
  return Boolean((startsWithName && score >= 2) || score >= 3);
}

function itemTooltipDescription(record: ScraperRecord) {
  const lines = itemTooltipContentLines(record);
  if (lines.length === 0) return '';

  const withoutName =
    stringValue(record.name) &&
    lines[0]?.toLowerCase() === stringValue(record.name).toLowerCase()
      ? lines.slice(1)
      : lines;
  const firstStructureIndex = withoutName.findIndex(isTooltipStructureLine);
  const introLines =
    firstStructureIndex >= 0
      ? withoutName.slice(0, firstStructureIndex)
      : withoutName;
  const quotedFlavor = withoutName
    .filter((line) => /^".+"$/.test(line))
    .map(cleanItemFlavorText)
    .filter(Boolean);
  if (introLines.length > 0) {
    return encodedItemDescription(
      introLines[0],
      introLines.slice(1).join('\n') || quotedFlavor.join('\n')
    );
  }

  return quotedFlavor.join('\n');
}

function isTooltipPayloadDescription(value: string) {
  return isCopiedTooltipDescription(value);
}

function isLegacyPlainSourceDescription(
  currentValue: string,
  nextValue: string
) {
  const currentParts = encodedDescriptionParts(currentValue);
  const nextParts = encodedDescriptionParts(nextValue);
  return Boolean(
    currentParts &&
    nextParts &&
    currentValue.trim() !== nextValue.trim() &&
    currentParts.source.toLowerCase() === nextParts.source.toLowerCase() &&
    currentParts.flavor.toLowerCase() === nextParts.flavor.toLowerCase()
  );
}

function itemDescription(record: ScraperRecord) {
  const explicitDescription = stringValue(record.description);
  const instantDescription = instantString(record, 'description');
  const tooltipDescription = itemTooltipDescription(record);
  const sourceDescription = explicitDescription || instantDescription;
  const usableSourceDescription = isCopiedTooltipDescription(
    sourceDescription,
    stringValue(record.name)
  )
    ? ''
    : sourceDescription;
  const fallbackDescription =
    isSourceOnlyItemDescription(usableSourceDescription) && tooltipDescription
      ? tooltipDescription
      : usableSourceDescription;

  return normalizeItemDescription(fallbackDescription || tooltipDescription);
}

function spellDescription(record: ScraperRecord) {
  return (
    stringValue(record.description) ||
    stringValue(record.tooltipDescription) ||
    stringValue(record.apiDescription) ||
    tooltipText(record)
  );
}

type ParsedTooltipEffectKind = 'equip' | 'use' | 'chance_on_hit' | 'set';

type ParsedTooltipEffect = {
  kind: ParsedTooltipEffectKind;
  label: string;
  text: string;
  line: string;
};

type ParsedItemTooltip = {
  bonding?: number;
  damageMin?: number;
  damageMax?: number;
  delayMs?: number;
  requiredLevel?: number;
  itemLevel?: number;
  sellPrice?: number;
  stats: Record<string, number>;
  effects: ParsedTooltipEffect[];
};

const ITEM_STAT_TYPES: Record<string, number> = {
  ITEM_MOD_MANA_SHORT: 0,
  ITEM_MOD_HEALTH_SHORT: 1,
  ITEM_MOD_AGILITY_SHORT: 3,
  ITEM_MOD_STRENGTH_SHORT: 4,
  ITEM_MOD_INTELLECT_SHORT: 5,
  ITEM_MOD_SPIRIT_SHORT: 6,
  ITEM_MOD_STAMINA_SHORT: 7,
  ITEM_MOD_DEFENSE_SKILL_RATING_SHORT: 12,
  ITEM_MOD_DODGE_RATING_SHORT: 13,
  ITEM_MOD_PARRY_RATING_SHORT: 14,
  ITEM_MOD_BLOCK_RATING_SHORT: 15,
  ITEM_MOD_HIT_MELEE_RATING_SHORT: 16,
  ITEM_MOD_HIT_RANGED_RATING_SHORT: 17,
  ITEM_MOD_HIT_SPELL_RATING_SHORT: 18,
  ITEM_MOD_CRIT_MELEE_RATING_SHORT: 19,
  ITEM_MOD_CRIT_RANGED_RATING_SHORT: 20,
  ITEM_MOD_CRIT_SPELL_RATING_SHORT: 21,
  ITEM_MOD_HIT_RATING_SHORT: 31,
  ITEM_MOD_CRIT_RATING_SHORT: 32,
  ITEM_MOD_RESILIENCE_RATING_SHORT: 35,
  ITEM_MOD_HASTE_RATING_SHORT: 36,
  ITEM_MOD_EXPERTISE_RATING_SHORT: 37,
  ITEM_MOD_ATTACK_POWER_SHORT: 38,
  ITEM_MOD_RANGED_ATTACK_POWER_SHORT: 39,
  ITEM_MOD_MANA_REGENERATION_SHORT: 43,
  ITEM_MOD_ARMOR_PENETRATION_RATING_SHORT: 44,
  ITEM_MOD_SPELL_POWER_SHORT: 45,
  ITEM_MOD_HEALTH_REGEN_SHORT: 46,
  ITEM_MOD_SPELL_PENETRATION_SHORT: 47,
  ITEM_MOD_BLOCK_VALUE_SHORT: 48
};

const TOOLTIP_PRIMARY_STAT_TYPES: Record<string, keyof typeof ITEM_STAT_TYPES> =
  {
    agility: 'ITEM_MOD_AGILITY_SHORT',
    strength: 'ITEM_MOD_STRENGTH_SHORT',
    intellect: 'ITEM_MOD_INTELLECT_SHORT',
    spirit: 'ITEM_MOD_SPIRIT_SHORT',
    stamina: 'ITEM_MOD_STAMINA_SHORT'
  };

const TOOLTIP_EQUIP_STAT_PATTERNS: Array<{
  key: keyof typeof ITEM_STAT_TYPES;
  pattern: RegExp;
}> = [
  { key: 'ITEM_MOD_ATTACK_POWER_SHORT', pattern: /\battack power by (\d+)/i },
  {
    key: 'ITEM_MOD_RANGED_ATTACK_POWER_SHORT',
    pattern: /\branged attack power by (\d+)/i
  },
  {
    key: 'ITEM_MOD_ARMOR_PENETRATION_RATING_SHORT',
    pattern: /\barmor penetration rating by (\d+)/i
  },
  { key: 'ITEM_MOD_SPELL_POWER_SHORT', pattern: /\bspell power by (\d+)/i },
  { key: 'ITEM_MOD_HIT_RATING_SHORT', pattern: /\bhit rating by (\d+)/i },
  {
    key: 'ITEM_MOD_CRIT_RATING_SHORT',
    pattern: /\bcritical strike rating by (\d+)/i
  },
  { key: 'ITEM_MOD_HASTE_RATING_SHORT', pattern: /\bhaste rating by (\d+)/i },
  {
    key: 'ITEM_MOD_EXPERTISE_RATING_SHORT',
    pattern: /\bexpertise rating by (\d+)/i
  },
  { key: 'ITEM_MOD_DODGE_RATING_SHORT', pattern: /\bdodge rating by (\d+)/i },
  { key: 'ITEM_MOD_PARRY_RATING_SHORT', pattern: /\bparry rating by (\d+)/i },
  { key: 'ITEM_MOD_BLOCK_RATING_SHORT', pattern: /\bblock rating by (\d+)/i },
  { key: 'ITEM_MOD_BLOCK_VALUE_SHORT', pattern: /\bblock value .* by (\d+)/i },
  {
    key: 'ITEM_MOD_DEFENSE_SKILL_RATING_SHORT',
    pattern: /\bdefense rating by (\d+)/i
  },
  {
    key: 'ITEM_MOD_RESILIENCE_RATING_SHORT',
    pattern: /\bresilience rating by (\d+)/i
  },
  {
    key: 'ITEM_MOD_MANA_REGENERATION_SHORT',
    pattern: /\bmana regeneration by (\d+)/i
  },
  {
    key: 'ITEM_MOD_HEALTH_REGEN_SHORT',
    pattern: /\bhealth regeneration by (\d+)/i
  },
  {
    key: 'ITEM_MOD_SPELL_PENETRATION_SHORT',
    pattern: /\bspell penetration by (\d+)/i
  }
];

const INVENTORY_TYPE_BY_EQUIP_SLOT: Record<string, number> = {
  INVTYPE_HEAD: 1,
  INVTYPE_NECK: 2,
  INVTYPE_SHOULDER: 3,
  INVTYPE_BODY: 4,
  INVTYPE_CHEST: 5,
  INVTYPE_ROBE: 20,
  INVTYPE_WAIST: 6,
  INVTYPE_LEGS: 7,
  INVTYPE_FEET: 8,
  INVTYPE_WRIST: 9,
  INVTYPE_HAND: 10,
  INVTYPE_FINGER: 11,
  INVTYPE_TRINKET: 12,
  INVTYPE_WEAPON: 13,
  INVTYPE_SHIELD: 14,
  INVTYPE_RANGED: 15,
  INVTYPE_CLOAK: 16,
  INVTYPE_2HWEAPON: 17,
  INVTYPE_BAG: 18,
  INVTYPE_TABARD: 19,
  INVTYPE_WEAPONMAINHAND: 21,
  INVTYPE_WEAPONOFFHAND: 22,
  INVTYPE_HOLDABLE: 23,
  INVTYPE_AMMO: 24,
  INVTYPE_THROWN: 25,
  INVTYPE_RANGEDRIGHT: 26,
  INVTYPE_QUIVER: 27,
  INVTYPE_RELIC: 28
};

function cleanTooltipLine(value: string) {
  return cleanDescription(value.replace(/\t+/g, ' '));
}

function tooltipMoneyValue(text: string) {
  const match = text.match(
    /\bSell Price:\s*(?:(\d+)\s*g)?\s*(?:(\d+)\s*s)?\s*(?:(\d+)\s*c)?/i
  );
  if (!match) return 0;

  return (
    numberValue(match[1]) * 10000 +
    numberValue(match[2]) * 100 +
    numberValue(match[3])
  );
}

function addTooltipStat(
  stats: Record<string, number>,
  key: keyof typeof ITEM_STAT_TYPES,
  value: number
) {
  if (value <= 0) return;
  stats[key] = Math.max(stats[key] ?? 0, value);
}

function applyTooltipStatPatterns(stats: Record<string, number>, line: string) {
  for (const entry of TOOLTIP_EQUIP_STAT_PATTERNS) {
    const match = line.match(entry.pattern);
    if (match) addTooltipStat(stats, entry.key, numberValue(match[1]));
  }
}

function tooltipEffectKind(label: string): ParsedTooltipEffectKind {
  const normalized = label.toLowerCase();
  if (normalized === 'equip') return 'equip';
  if (normalized === 'use') return 'use';
  if (normalized.startsWith('set')) return 'set';
  return 'chance_on_hit';
}

function tooltipEffectLabel(label: string) {
  const trimmed = label.trim();
  if (/^chance on hit$/i.test(trimmed)) return 'Chance on hit';
  if (/^equip$/i.test(trimmed)) return 'Equip';
  if (/^use$/i.test(trimmed)) return 'Use';
  if (/^set/i.test(trimmed)) return trimmed.replace(/^set/i, 'Set');
  return trimmed;
}

function parseItemTooltip(record: ScraperRecord): ParsedItemTooltip {
  const parsed: ParsedItemTooltip = { stats: {}, effects: [] };
  const text = itemTooltipText(record);
  if (!text) return parsed;

  const lines = text.split(/\r?\n/).map(cleanTooltipLine).filter(Boolean);

  for (const line of lines) {
    if (/^Binds when picked up$/i.test(line) || /^Soulbound$/i.test(line)) {
      parsed.bonding = 1;
    } else if (/^Binds when equipped$/i.test(line)) {
      parsed.bonding = 2;
    } else if (/^Binds when used$/i.test(line)) {
      parsed.bonding = 3;
    } else if (/^Quest Item$/i.test(line)) {
      parsed.bonding = 4;
    }

    const damage = line.match(
      /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s+Damage\s+Speed\s+(\d+(?:\.\d+)?)/i
    );
    if (damage) {
      parsed.damageMin = numberValue(damage[1]);
      parsed.damageMax = numberValue(damage[2]);
      parsed.delayMs = Math.round(numberValue(damage[3]) * 1000);
    }

    const requiredLevel = line.match(/^Requires Level\s+(\d+)/i);
    if (requiredLevel) parsed.requiredLevel = numberValue(requiredLevel[1]);

    const itemLevel = line.match(/^Item Level\s+(\d+)/i);
    if (itemLevel) parsed.itemLevel = numberValue(itemLevel[1]);

    const primaryStat = line.match(
      /^\+(\d+)\s+(Agility|Strength|Intellect|Spirit|Stamina)$/i
    );
    if (primaryStat) {
      const key = TOOLTIP_PRIMARY_STAT_TYPES[primaryStat[2].toLowerCase()];
      if (key) addTooltipStat(parsed.stats, key, numberValue(primaryStat[1]));
    }

    const effect = line.match(
      /^(Equip|Use|Chance on hit|Set(?:\s*\([^)]+\))?):\s*(.+)$/i
    );
    if (effect) {
      const label = tooltipEffectLabel(effect[1]);
      const kind = tooltipEffectKind(label);
      const effectText = effect[2].trim();
      parsed.effects.push({
        kind,
        label,
        text: effectText,
        line: `${label}: ${effectText}`
      });
      applyTooltipStatPatterns(parsed.stats, effectText);
    }
  }

  parsed.sellPrice = tooltipMoneyValue(text);
  return parsed;
}

function shouldSetText(current: unknown, incoming: string) {
  return incoming !== '' && (overwrite || isEmptyDbValue(current));
}

function shouldSetNumber(current: unknown, incoming: number) {
  return incoming > 0 && (overwrite || isEmptyDbValue(current));
}

function asJson(value: unknown) {
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}

function emptyImportStats(): ImportStats {
  return {
    seen: 0,
    updated: 0,
    inserted: 0,
    missing: 0,
    skipped: 0
  };
}

function addImportStats(total: ImportStats, next: ImportStats) {
  total.seen += next.seen;
  total.updated += next.updated;
  total.inserted += next.inserted;
  total.missing += next.missing;
  total.skipped += next.skipped;
}

function isScraperRecord(value: unknown): value is ScraperRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

class LuaTableParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse() {
    this.skipSpace();
    const save = this.index;
    const ident = this.readIdentifier();
    this.skipSpace();
    if (ident && this.peek() === '=') {
      this.index += 1;
      return this.parseValue();
    }

    this.index = save;
    return this.parseValue();
  }

  private parseValue(): unknown {
    this.skipSpace();
    const char = this.peek();

    if (char === '{') return this.parseTable();
    if (char === '"' || char === "'") return this.parseString();
    if (char === '-' || /\d/.test(char)) return this.parseNumber();

    const ident = this.readIdentifier();
    if (ident === 'true') return true;
    if (ident === 'false') return false;
    if (ident === 'nil') return null;
    if (ident) return ident;

    throw new Error(`Unexpected Lua token near offset ${this.index}`);
  }

  private parseTable(): LuaObject {
    this.expect('{');
    const out: LuaObject = {};
    let arrayIndex = 1;

    while (true) {
      this.skipSpace();
      if (this.peek() === '}') {
        this.index += 1;
        break;
      }

      let key: string | number | null = null;
      let value: unknown;

      if (this.peek() === '[') {
        this.index += 1;
        key = this.parseValue() as string | number;
        this.skipSpace();
        this.expect(']');
        this.skipSpace();
        this.expect('=');
        value = this.parseValue();
      } else {
        const save = this.index;
        const ident = this.readIdentifier();
        this.skipSpace();
        if (ident && this.peek() === '=') {
          this.index += 1;
          key = ident;
          value = this.parseValue();
        } else {
          this.index = save;
          key = arrayIndex;
          arrayIndex += 1;
          value = this.parseValue();
        }
      }

      if (key !== null && value !== undefined) {
        out[String(key)] = value;
      }

      this.skipSpace();
      if (this.peek() === ',' || this.peek() === ';') {
        this.index += 1;
      }
    }

    return out;
  }

  private parseString() {
    const quote = this.peek();
    this.index += 1;
    let out = '';

    while (this.index < this.source.length) {
      const char = this.source[this.index++];
      if (char === quote) break;
      if (char === '\\') {
        const next = this.source[this.index++];
        if (next === 'n') out += '\n';
        else if (next === 'r') out += '\r';
        else if (next === 't') out += '\t';
        else if (next === '\\' || next === '"' || next === "'") out += next;
        else out += next ?? '';
      } else {
        out += char;
      }
    }

    return out;
  }

  private parseNumber() {
    const match = this.source
      .slice(this.index)
      .match(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!match) throw new Error(`Invalid Lua number near offset ${this.index}`);
    this.index += match[0].length;
    return Number(match[0]);
  }

  private readIdentifier() {
    const match = this.source
      .slice(this.index)
      .match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!match) return '';
    this.index += match[0].length;
    return match[0];
  }

  private skipSpace() {
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      const next = this.source[this.index + 1];

      if (/\s/.test(char)) {
        this.index += 1;
        continue;
      }

      if (char === '-' && next === '-') {
        this.index += 2;
        if (
          this.source[this.index] === '[' &&
          this.source[this.index + 1] === '['
        ) {
          this.index += 2;
          const end = this.source.indexOf(']]', this.index);
          this.index = end >= 0 ? end + 2 : this.source.length;
        } else {
          while (
            this.index < this.source.length &&
            !/[\r\n]/.test(this.source[this.index])
          ) {
            this.index += 1;
          }
        }
        continue;
      }

      break;
    }
  }

  private peek() {
    return this.source[this.index] ?? '';
  }

  private expect(char: string) {
    this.skipSpace();
    if (this.peek() !== char) {
      throw new Error(`Expected "${char}" near offset ${this.index}`);
    }
    this.index += 1;
  }
}

function parseInput(path: string): ScraperPayload {
  const size = statSync(path).size;
  if (size > maxDirectInputBytes) {
    throw new Error(
      `Input file is too large to parse directly (${size} bytes): ${path}. ` +
        `Split it first with: pnpm game:split-scraper "${path}"`
    );
  }

  const raw = readFileSync(path, 'utf-8')
    .replace(/^\uFEFF/, '')
    .trim();
  const parsed = raw.startsWith('{')
    ? JSON.parse(raw)
    : new LuaTableParser(raw).parse();

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Scraper input did not contain an object.');
  }

  const root = parsed as LuaObject;
  const namedPayload = Object.entries(root).find(
    ([key, value]) =>
      /^AscensionScraper(?:Shard\d{3})?DB$/.test(key) &&
      value &&
      typeof value === 'object'
  )?.[1] as ScraperPayload | undefined;
  const payload =
    root.AscensionScraperDB && typeof root.AscensionScraperDB === 'object'
      ? (root.AscensionScraperDB as ScraperPayload)
      : (namedPayload ?? (root as ScraperPayload));

  return {
    items: payload.items ?? {},
    spells: payload.spells ?? {},
    spellbook: payload.spellbook ?? {},
    trainerServices: payload.trainerServices ?? {}
  };
}

function addonInputFiles(input: string) {
  const resolved = path.resolve(input);
  const stat = statSync(resolved);
  if (stat.isFile()) return [resolved];
  if (!stat.isDirectory()) {
    throw new Error(`Input is neither a file nor a directory: ${input}`);
  }

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lua')) {
        files.push(entryPath);
      }
    }
  };
  walk(resolved);
  files.sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error(`No .lua files found in ${input}`);
  }

  return files;
}

async function tableColumns(client: PoolClient, tableName: string) {
  const result = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
    `,
    [targetSchema, tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
}

async function tableExists(client: PoolClient, tableName: string) {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = $2
      ) AS exists
    `,
    [targetSchema, tableName]
  );

  return result.rows[0]?.exists === true;
}

async function iconIdByName(client: PoolClient) {
  if (!(await tableExists(client, 'aowow_icons')))
    return new Map<string, number>();

  const columns = await tableColumns(client, 'aowow_icons');
  if (!columns.has('id') || !columns.has('name'))
    return new Map<string, number>();

  const result = await client.query<{ id: number; name: string }>(
    `SELECT id, name FROM ${quoteIdent(targetSchema)}.aowow_icons WHERE name IS NOT NULL AND name <> ''`
  );

  return new Map(
    result.rows.map((row) => [normalizeIconName(row.name), numberValue(row.id)])
  );
}

async function writeRow(
  client: PoolClient,
  tableName: string,
  id: number,
  updates: Record<string, string | number>,
  current: Record<string, unknown> | null
) {
  const entries = Object.entries(updates);
  if (entries.length === 0) return 'skipped' as const;

  if (current) {
    const setSql = entries
      .map(([column], index) => `${quoteIdent(column)} = $${index + 1}`)
      .join(', ');
    const values = entries.map(([, value]) => value);

    await client.query(
      `UPDATE ${quoteIdent(targetSchema)}.${quoteIdent(tableName)}
       SET ${setSql}
       WHERE id = $${values.length + 1}`,
      [...values, id]
    );
    return 'updated' as const;
  }

  if (!insertMissing) return 'missing' as const;

  const insertValues = { id, ...updates };
  const insertEntries = Object.entries(insertValues);
  const columnsSql = insertEntries
    .map(([column]) => quoteIdent(column))
    .join(', ');
  const placeholders = insertEntries
    .map((_, index) => `$${index + 1}`)
    .join(', ');
  await client.query(
    `INSERT INTO ${quoteIdent(targetSchema)}.${quoteIdent(tableName)} (${columnsSql})
     VALUES (${placeholders})
     ON CONFLICT (id) DO NOTHING`,
    insertEntries.map(([, value]) => value)
  );
  return 'inserted' as const;
}

function setText(
  updates: Record<string, string | number>,
  columns: Set<string>,
  current: Record<string, unknown> | null,
  column: string,
  value: string
) {
  if (!columns.has(column) || !value) return;
  if (!current || shouldSetText(current[column], value))
    updates[column] = value;
}

function setRicherText(
  updates: Record<string, string | number>,
  columns: Set<string>,
  current: Record<string, unknown> | null,
  column: string,
  value: string
) {
  if (!columns.has(column) || !value) return;
  if (!current) {
    updates[column] = value;
    return;
  }

  const currentValue = stringValue(current[column]);
  if (overwrite || !currentValue || value.length > currentValue.length) {
    updates[column] = value;
  }
}

function setNumber(
  updates: Record<string, string | number>,
  columns: Set<string>,
  current: Record<string, unknown> | null,
  column: string,
  value: number
) {
  if (!columns.has(column) || value <= 0) return;
  if (!current || shouldSetNumber(current[column], value))
    updates[column] = value;
}

function setTooltipNumber(
  updates: Record<string, string | number>,
  columns: Set<string>,
  current: Record<string, unknown> | null,
  column: string,
  value: number,
  defaultMax = 0
) {
  if (!columns.has(column) || value <= 0) return;
  if (!current) {
    updates[column] = value;
    return;
  }

  const currentValue = numberValue(current[column]);
  if (
    overwrite ||
    currentValue <= 0 ||
    (defaultMax > 0 && currentValue <= defaultMax && currentValue !== value)
  ) {
    updates[column] = value;
  }
}

function setLocalizedDescription(
  updates: Record<string, string | number>,
  columns: Set<string>,
  current: Record<string, unknown> | null,
  value: string
) {
  for (const column of [
    'description',
    'description_loc0',
    'description_loc2',
    'description_loc3',
    'description_loc4',
    'description_loc6',
    'description_loc8'
  ]) {
    setText(updates, columns, current, column, value);
  }
}

function setItemLocalizedDescription(
  updates: Record<string, string | number>,
  columns: Set<string>,
  current: Record<string, unknown> | null,
  value: string
) {
  for (const column of [
    'description',
    'description_loc0',
    'description_loc2',
    'description_loc3',
    'description_loc4',
    'description_loc6',
    'description_loc8'
  ]) {
    if (!columns.has(column)) continue;
    const currentValue = stringValue(current?.[column]);
    if (!value && currentValue && isTooltipPayloadDescription(currentValue)) {
      updates[column] = '';
      continue;
    }
    if (!value) continue;
    if (
      !current ||
      shouldSetText(currentValue, value) ||
      isTooltipPayloadDescription(currentValue) ||
      isLegacyPlainSourceDescription(currentValue, value) ||
      /You've collected this appearance|You have collected this appearance|You haven't collected this appearance|You have not collected this appearance|\bID\s+\d+\b/i.test(
        currentValue.replace(/\|c[0-9a-f]{8}/gi, '').replace(/\|r/gi, '')
      )
    ) {
      updates[column] = value;
    }
  }
}

function setItemStats(
  updates: Record<string, string | number>,
  columns: Set<string>,
  current: Record<string, unknown> | null,
  stats: Record<string, number | string> | undefined
) {
  const pairs = Object.entries(stats ?? {})
    .map(([key, value]) => ({
      type: ITEM_STAT_TYPES[key],
      value: Math.round(numberValue(value))
    }))
    .filter((entry) => entry.type !== undefined && entry.value !== 0)
    .slice(0, 10);

  for (let index = 0; index < pairs.length; index += 1) {
    const slot = index + 1;
    setNumber(updates, columns, current, `statType${slot}`, pairs[index].type);
    setNumber(
      updates,
      columns,
      current,
      `statValue${slot}`,
      pairs[index].value
    );
  }

  setNumber(
    updates,
    columns,
    current,
    'pvePower',
    numberValue(stats?.PVE_POWER)
  );
  setNumber(
    updates,
    columns,
    current,
    'pvpPower',
    numberValue(stats?.PVP_POWER)
  );
}

function applyWriteResult(
  stats: ImportStats,
  result: Awaited<ReturnType<typeof writeRow>>
) {
  if (result === 'updated') stats.updated += 1;
  else if (result === 'inserted') stats.inserted += 1;
  else if (result === 'missing') stats.missing += 1;
  else stats.skipped += 1;
}

async function currentRow(client: PoolClient, tableName: string, id: number) {
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdent(targetSchema)}.${quoteIdent(tableName)} WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function getGinTrgmOperatorClass(client: PoolClient) {
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Could not create pg_trgm extension; tooltip trigram index will be skipped: ${message}`
    );
  }

  const result = await client.query<{ schema_name: string }>(`
    SELECT namespace.nspname AS schema_name
    FROM pg_opclass operator_class
    JOIN pg_am access_method ON access_method.oid = operator_class.opcmethod
    JOIN pg_namespace namespace ON namespace.oid = operator_class.opcnamespace
    WHERE operator_class.opcname = 'gin_trgm_ops'
      AND access_method.amname = 'gin'
    ORDER BY
      CASE
        WHEN namespace.nspname = ANY(current_schemas(false)) THEN 0
        WHEN namespace.nspname = 'public' THEN 1
        ELSE 2
      END,
      namespace.nspname
    LIMIT 1
  `);

  const schemaName = result.rows[0]?.schema_name;
  return schemaName
    ? `${quoteIdent(schemaName)}.${quoteIdent('gin_trgm_ops')}`
    : null;
}

async function ensureAppItemTooltipEffects(client: PoolClient) {
  await client.query('CREATE SCHEMA IF NOT EXISTS app');
  const trgmOperatorClass = await getGinTrgmOperatorClass(client);
  await client.query(`
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
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS item_tooltip_effects_kind_idx
      ON app.item_tooltip_effects (effect_kind, item_id)
  `);
  if (trgmOperatorClass) {
    await client.query(`
      CREATE INDEX IF NOT EXISTS item_tooltip_effects_search_trgm_idx
        ON app.item_tooltip_effects USING gin (search_text ${trgmOperatorClass})
    `);
  } else {
    console.warn(
      'Skipping item_tooltip_effects_search_trgm_idx because gin_trgm_ops is unavailable.'
    );
  }
}

async function ensureAppItemTooltips(client: PoolClient) {
  await client.query('CREATE SCHEMA IF NOT EXISTS app');
  const trgmOperatorClass = await getGinTrgmOperatorClass(client);
  await client.query(`
    CREATE TABLE IF NOT EXISTS app.item_tooltips (
      item_id integer PRIMARY KEY,
      tooltip_text text NOT NULL,
      tooltip_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
      tooltip_captured boolean NOT NULL DEFAULT true,
      source text NOT NULL DEFAULT 'ascension-scraper',
      captured_at bigint,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  if (trgmOperatorClass) {
    await client.query(`
      CREATE INDEX IF NOT EXISTS item_tooltips_text_trgm_idx
        ON app.item_tooltips USING gin (tooltip_text ${trgmOperatorClass})
    `);
  } else {
    console.warn(
      'Skipping item_tooltips_text_trgm_idx because gin_trgm_ops is unavailable.'
    );
  }
}

async function replaceItemTooltipEffects(
  client: PoolClient,
  itemId: number,
  effects: ParsedTooltipEffect[]
) {
  await client.query(
    'DELETE FROM app.item_tooltip_effects WHERE item_id = $1',
    [itemId]
  );

  if (effects.length === 0) return;

  const values: unknown[] = [];
  const rowsSql = effects.map((effect, index) => {
    const offset = index * 7;
    values.push(
      itemId,
      index + 1,
      effect.kind,
      effect.label,
      effect.text,
      effect.line,
      `${effect.label} ${effect.text}`
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
  });

  await client.query(
    `
      INSERT INTO app.item_tooltip_effects (
        item_id,
        effect_index,
        effect_kind,
        effect_label,
        effect_text,
        raw_line,
        search_text
      )
      VALUES ${rowsSql.join(', ')}
      ON CONFLICT (item_id, effect_index) DO UPDATE SET
        effect_kind = EXCLUDED.effect_kind,
        effect_label = EXCLUDED.effect_label,
        effect_text = EXCLUDED.effect_text,
        raw_line = EXCLUDED.raw_line,
        search_text = EXCLUDED.search_text,
        updated_at = now()
    `,
    values
  );
}

async function upsertItemTooltip(
  client: PoolClient,
  itemId: number,
  record: ScraperRecord,
  tooltip: string,
  tooltipLines: unknown
) {
  if (!tooltip) return;

  await client.query(
    `
      INSERT INTO app.item_tooltips (
        item_id,
        tooltip_text,
        tooltip_lines,
        tooltip_captured,
        source,
        captured_at
      )
      VALUES ($1, $2, $3::jsonb, $4, $5, $6)
      ON CONFLICT (item_id) DO UPDATE SET
        tooltip_text = EXCLUDED.tooltip_text,
        tooltip_lines = EXCLUDED.tooltip_lines,
        tooltip_captured = EXCLUDED.tooltip_captured,
        source = EXCLUDED.source,
        captured_at = EXCLUDED.captured_at,
        updated_at = now()
      WHERE
        app.item_tooltips.tooltip_text IS NULL
        OR length(EXCLUDED.tooltip_text) >= length(app.item_tooltips.tooltip_text)
    `,
    [
      itemId,
      tooltip,
      asJson(tooltipLines || []),
      true,
      'ascension-scraper',
      numberValue(record.capturedAt)
    ]
  );
}

async function importItems(
  client: PoolClient,
  payload: ScraperPayload,
  icons: Map<string, number>
) {
  const stats: ImportStats = {
    seen: 0,
    updated: 0,
    inserted: 0,
    missing: 0,
    skipped: 0
  };
  if (!(await tableExists(client, 'aowow_items'))) return stats;

  const columns = await tableColumns(client, 'aowow_items');
  if (!columns.has('id')) return stats;

  for (const [key, record] of Object.entries(payload.items ?? {})) {
    if (!isScraperRecord(record)) {
      stats.skipped += 1;
      continue;
    }
    const id = numberValue(record.id ?? key);
    if (id <= 0) continue;
    stats.seen += 1;

    const current = await currentRow(client, 'aowow_items', id);
    const updates: Record<string, string | number> = {};
    const name = stringValue(record.name);
    const tooltip = itemTooltipText(record);
    const tooltipLines = itemTooltipLines(record);
    const parsedTooltip = parseItemTooltip(record);
    const description = itemDescription(record);
    const iconKey = normalizeIconName(
      stringValue(record.icon) || instantString(record, 'icon')
    );
    const iconId = iconKey ? (icons.get(iconKey) ?? 0) : 0;
    const itemStats = {
      ...(record.itemStats ?? {}),
      ...parsedTooltip.stats
    };

    if (
      columns.has('name_loc0') &&
      name &&
      (!current ||
        overwrite ||
        isPlaceholderName(current.name_loc0, id, 'item'))
    ) {
      updates.name_loc0 = name;
    }

    setItemLocalizedDescription(updates, columns, current, description);
    setNumber(
      updates,
      columns,
      current,
      'quality',
      numberValue(record.quality) || instantNumber(record, 'quality')
    );
    setNumber(
      updates,
      columns,
      current,
      'itemLevel',
      numberValue(record.itemLevel) ||
        instantNumber(record, 'itemLevel') ||
        numberValue(parsedTooltip.itemLevel)
    );
    setNumber(
      updates,
      columns,
      current,
      'requiredLevel',
      numberValue(record.requiredLevel) ||
        numberValue(parsedTooltip.requiredLevel)
    );
    setNumber(
      updates,
      columns,
      current,
      'stackable',
      numberValue(record.maxStack)
    );
    setNumber(
      updates,
      columns,
      current,
      'buyPrice',
      numberValue(record.vendorPrice) || numberValue(parsedTooltip.sellPrice)
    );
    setNumber(
      updates,
      columns,
      current,
      'sellPrice',
      numberValue(record.vendorPrice) || numberValue(parsedTooltip.sellPrice)
    );
    setNumber(updates, columns, current, 'iconId', iconId);
    setNumber(
      updates,
      columns,
      current,
      'class',
      instantNumber(record, 'classId', 'classID')
    );
    setNumber(
      updates,
      columns,
      current,
      'classBak',
      instantNumber(record, 'classId', 'classID')
    );
    setNumber(
      updates,
      columns,
      current,
      'subClass',
      instantNumber(record, 'subClassId', 'subclassID')
    );
    setNumber(
      updates,
      columns,
      current,
      'subClassBak',
      instantNumber(record, 'subClassId', 'subclassID')
    );
    setNumber(
      updates,
      columns,
      current,
      'slot',
      INVENTORY_TYPE_BY_EQUIP_SLOT[stringValue(record.equipSlot)] ||
        instantNumber(record, 'inventoryType')
    );
    setNumber(
      updates,
      columns,
      current,
      'slotBak',
      INVENTORY_TYPE_BY_EQUIP_SLOT[stringValue(record.equipSlot)] ||
        instantNumber(record, 'inventoryType')
    );
    setNumber(
      updates,
      columns,
      current,
      'bonding',
      numberValue(parsedTooltip.bonding)
    );
    setTooltipNumber(
      updates,
      columns,
      current,
      'dmgMin1',
      numberValue(parsedTooltip.damageMin)
    );
    setTooltipNumber(
      updates,
      columns,
      current,
      'dmgMax1',
      numberValue(parsedTooltip.damageMax)
    );
    setTooltipNumber(
      updates,
      columns,
      current,
      'delay',
      numberValue(parsedTooltip.delayMs),
      1000
    );
    setItemStats(updates, columns, current, itemStats);

    setRicherText(updates, columns, current, 'tooltip', tooltip);
    setRicherText(
      updates,
      columns,
      current,
      'tooltipLines',
      asJson(tooltipLines)
    );
    setRicherText(
      updates,
      columns,
      current,
      'tooltip_lines',
      asJson(tooltipLines)
    );
    setRicherText(
      updates,
      columns,
      current,
      'tooltipJson',
      asJson(tooltipLines)
    );

    const writeResult = await writeRow(
      client,
      'aowow_items',
      id,
      updates,
      current
    );
    if (writeResult !== 'missing' && tooltip) {
      await upsertItemTooltip(client, id, record, tooltip, tooltipLines);
      await replaceItemTooltipEffects(client, id, parsedTooltip.effects);
    }
    applyWriteResult(stats, writeResult);
  }

  return stats;
}

async function importSpells(
  client: PoolClient,
  payload: ScraperPayload,
  icons: Map<string, number>
) {
  const stats: ImportStats = {
    seen: 0,
    updated: 0,
    inserted: 0,
    missing: 0,
    skipped: 0
  };
  if (!(await tableExists(client, 'aowow_spell'))) return stats;

  const columns = await tableColumns(client, 'aowow_spell');
  if (!columns.has('id')) return stats;

  for (const [key, record] of Object.entries(payload.spells ?? {})) {
    if (!isScraperRecord(record)) {
      stats.skipped += 1;
      continue;
    }
    const id = numberValue(record.id ?? key);
    if (id <= 0) continue;
    stats.seen += 1;

    const current = await currentRow(client, 'aowow_spell', id);
    const updates: Record<string, string | number> = {};
    const name = stringValue(record.name);
    const rank = stringValue(record.rank) || stringValue(record.subtext);
    const description = spellDescription(record);
    const fullTooltip = tooltipText(record);
    const iconKey = normalizeIconName(
      stringValue(record.icon) || stringValue(record.texture)
    );
    const iconId = iconKey ? (icons.get(iconKey) ?? 0) : 0;

    if (
      columns.has('name_loc0') &&
      name &&
      (!current ||
        overwrite ||
        isPlaceholderName(current.name_loc0, id, 'spell'))
    ) {
      updates.name_loc0 = name;
    }

    setText(updates, columns, current, 'rank_loc0', rank);
    setLocalizedDescription(updates, columns, current, description);
    setText(
      updates,
      columns,
      current,
      'buff_loc0',
      stringValue(record.tooltipDescription)
    );
    setNumber(updates, columns, current, 'iconId', iconId);
    setNumber(
      updates,
      columns,
      current,
      'schoolMask',
      numberValue(record.schoolMask ?? record.school_mask)
    );
    setNumber(
      updates,
      columns,
      current,
      'castTime',
      numberValue(record.castTime)
    );
    setNumber(
      updates,
      columns,
      current,
      'duration',
      numberValue(record.duration ?? record.baseDuration)
    );
    setNumber(
      updates,
      columns,
      current,
      'powerType',
      numberValue(record.resourceType ?? record.resource_type)
    );
    setNumber(
      updates,
      columns,
      current,
      'powerCost',
      numberValue(record.resourceCost ?? record.resource_cost)
    );
    setNumber(
      updates,
      columns,
      current,
      'recoveryTime',
      numberValue(record.baseCooldown ?? record.cooldown)
    );
    setNumber(
      updates,
      columns,
      current,
      'startRecoveryTime',
      numberValue(record.gcdCooldown)
    );
    setNumber(
      updates,
      columns,
      current,
      'stackAmount',
      numberValue(record.maxStack)
    );
    setNumber(
      updates,
      columns,
      current,
      'spellLevel',
      numberValue(record.requiredLevel ?? record.level_required)
    );
    setNumber(
      updates,
      columns,
      current,
      'baseLevel',
      numberValue(record.requiredLevel ?? record.level_required)
    );
    setNumber(
      updates,
      columns,
      current,
      'requiredLevel',
      numberValue(record.requiredLevel ?? record.level_required)
    );
    setRicherText(updates, columns, current, 'tooltip', fullTooltip);
    setRicherText(
      updates,
      columns,
      current,
      'tooltipLines',
      asJson(record.tooltipLines)
    );
    setRicherText(
      updates,
      columns,
      current,
      'tooltip_lines',
      asJson(record.tooltipLines)
    );
    setRicherText(
      updates,
      columns,
      current,
      'tooltipJson',
      asJson(record.tooltipLines)
    );

    applyWriteResult(
      stats,
      await writeRow(client, 'aowow_spell', id, updates, current)
    );
  }

  return stats;
}

async function main() {
  if (!connectionString) {
    throw new Error('GAME_DATABASE_URL or DATABASE_URL must be set.');
  }

  if (importArgs.backupBeforeImport) {
    await backupGameDatabase({
      connectionString,
      outputDir: importArgs.backupDir,
      outputFile: importArgs.backupFile
    });
  }

  if (importArgs.backupOnly) {
    return;
  }

  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const files = addonInputFiles(inputPath);
  const oversizedFiles = files.filter(
    (file) => statSync(file).size > maxDirectInputBytes
  );
  if (oversizedFiles.length > 0) {
    const list = oversizedFiles
      .map(
        (file) =>
          `- ${path.relative(process.cwd(), file) || file} (${statSync(file).size} bytes)`
      )
      .join('\n');
    throw new Error(
      `Some scraper input files are too large to parse directly:\n${list}\n` +
        `Split them first with: pnpm game:split-scraper "${inputPath}" "${inputPath}-split" 5000\n` +
        `Then import the split output: pnpm game:import-scraper "${inputPath}-split"`
    );
  }

  console.log(`AscensionScraper import source: ${path.resolve(inputPath)}`);
  console.log(`Loaded ${files.length} .lua file(s).`);
  for (const file of files) {
    console.log(`- ${path.relative(process.cwd(), file) || file}`);
  }
  console.log(
    `Target schema: ${targetSchema}; overwrite=${overwrite ? 'on' : 'off'}; insertMissing=${insertMissing ? 'on' : 'off'}`
  );

  const history = await startImportJob({
    connectionString,
    type: 'game:import-ascension-scraper',
    source: inputPath,
    metadata: {
      targetSchema,
      overwrite,
      insertMissing,
      sourceFiles: files,
      fileCount: files.length,
      streaming: true
    }
  });

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await history.log('INFO', 'Starting AscensionScraper import.', {
      sourceFiles: files
    });
    const icons = await iconIdByName(client);
    await ensureAppItemTooltips(client);
    await ensureAppItemTooltipEffects(client);
    const totalItemStats = emptyImportStats();
    const totalSpellStats = emptyImportStats();
    let itemCount = 0;
    let spellCount = 0;
    let spellbookCount = 0;
    let trainerCount = 0;

    for (const [index, file] of files.entries()) {
      const relativeFile = path.relative(process.cwd(), file) || file;
      console.log(`Parsing ${index + 1}/${files.length}: ${relativeFile}`);
      const payload = parseInput(file);
      const fileItemCount = Object.keys(payload.items ?? {}).length;
      const fileSpellCount = Object.keys(payload.spells ?? {}).length;
      const fileSpellbookCount = Object.keys(payload.spellbook ?? {}).length;
      const fileTrainerCount = Object.keys(
        payload.trainerServices ?? {}
      ).length;
      itemCount += fileItemCount;
      spellCount += fileSpellCount;
      spellbookCount += fileSpellbookCount;
      trainerCount += fileTrainerCount;
      console.log(
        `Records: items=${fileItemCount} spells=${fileSpellCount} spellbook=${fileSpellbookCount} trainerServices=${fileTrainerCount}`
      );

      await client.query('BEGIN');
      transactionOpen = true;
      const itemStats = await importItems(client, payload, icons);
      const spellStats = await importSpells(client, payload, icons);
      await client.query('COMMIT');
      transactionOpen = false;

      addImportStats(totalItemStats, itemStats);
      addImportStats(totalSpellStats, spellStats);
      console.log(
        `Items done: seen=${itemStats.seen} updated=${itemStats.updated} inserted=${itemStats.inserted} missing=${itemStats.missing} skipped=${itemStats.skipped}`
      );
      console.log(
        `Spells done: seen=${spellStats.seen} updated=${spellStats.updated} inserted=${spellStats.inserted} missing=${spellStats.missing} skipped=${spellStats.skipped}`
      );
    }

    await history.finish('SUCCESS', {
      items: itemCount,
      spells: spellCount,
      spellbook: spellbookCount,
      trainerServices: trainerCount,
      itemStats: totalItemStats,
      spellStats: totalSpellStats
    });

    console.log(
      `Imported AscensionScraper data into schema "${targetSchema}".`
    );
    console.log(`Source files: ${files.length}`);
    console.log(
      `Items: seen=${totalItemStats.seen} updated=${totalItemStats.updated} inserted=${totalItemStats.inserted} missing=${totalItemStats.missing} skipped=${totalItemStats.skipped}`
    );
    console.log(
      `Spells: seen=${totalSpellStats.seen} updated=${totalSpellStats.updated} inserted=${totalSpellStats.inserted} missing=${totalSpellStats.missing} skipped=${totalSpellStats.skipped}`
    );
    console.log(`Overwrite mode: ${overwrite ? 'on' : 'off'}`);
    console.log(`Insert missing rows: ${insertMissing ? 'on' : 'off'}`);
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    await history.log('ERROR', 'AscensionScraper import failed.', {
      error: message
    });
    await history.finish('FAILED', { error: message });
    throw error;
  } finally {
    client.release();
    await pool.end();
    await history.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
