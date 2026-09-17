import type {
  DetailField,
  DetailRow,
  DetailSection
} from '@/server/game-data/types';
import { getEntityDetailPath } from '@/lib/entities';

type Row = Record<string, unknown>;

const SCHOOL_BITS: Array<[number, string]> = [
  [0x01, 'Physical'],
  [0x02, 'Holy'],
  [0x04, 'Fire'],
  [0x08, 'Nature'],
  [0x10, 'Frost'],
  [0x20, 'Shadow'],
  [0x40, 'Arcane']
];

const POWER_TYPES: Record<number, string> = {
  [-2]: 'Health',
  [-1]: 'Ammo',
  0: 'Mana',
  1: 'Rage',
  2: 'Focus',
  3: 'Energy',
  4: 'Happiness',
  5: 'Runes',
  6: 'Runic Power',
  [-41]: 'Pyrite',
  [-61]: 'Steam Pressure',
  [-101]: 'Heat',
  [-121]: 'Ooze',
  [-141]: 'Blood Power',
  [-142]: 'Wrath'
};

const DAMAGE_CLASSES: Record<number, string> = {
  0: 'None',
  1: 'Magic',
  2: 'Melee',
  3: 'Ranged'
};

const DISPEL_TYPES: Record<number, string> = {
  0: 'n/a',
  1: 'Magic',
  2: 'Curse',
  3: 'Disease',
  4: 'Poison',
  5: 'Stealth',
  6: 'Invisibility',
  7: 'All',
  8: 'Spe NPC only',
  9: 'Enrage'
};

const MECHANICS: Record<number, string> = {
  0: 'n/a',
  1: 'Charm',
  2: 'Disoriented',
  3: 'Disarm',
  4: 'Distract',
  5: 'Fear',
  6: 'Grip',
  7: 'Root',
  8: 'Slow Attack',
  9: 'Silence',
  10: 'Sleep',
  11: 'Snare',
  12: 'Stun',
  13: 'Freeze',
  14: 'Knockout',
  15: 'Bleed',
  16: 'Bandage',
  17: 'Polymorph',
  18: 'Banish',
  19: 'Shield',
  20: 'Shackle',
  21: 'Mount',
  22: 'Infected',
  23: 'Turn',
  24: 'Horror',
  25: 'Invulnerability',
  26: 'Interrupt',
  27: 'Daze',
  28: 'Discovery',
  29: 'Immune Shield',
  30: 'Sapped',
  31: 'Enraged'
};

const EFFECT_NAMES: Record<number, string> = {
  1: 'Instakill',
  2: 'School Damage',
  3: 'Dummy',
  5: 'Teleport Units',
  6: 'Apply Aura',
  8: 'Drain Power',
  9: 'Drain Health',
  10: 'Heal',
  16: 'Complete Quest',
  17: 'Weapon Damage - No School',
  24: 'Create Item',
  28: 'Summon',
  30: 'Give Power',
  31: 'Weapon Damage - %',
  33: 'Open Lock',
  36: 'Learn Spell',
  38: 'Dispel',
  39: 'Learn Language',
  44: 'Learn Skill Step',
  47: 'Trade Skill',
  53: 'Enchant Item Permanent',
  54: 'Enchant Item Temporary',
  56: 'Summon Pet',
  57: 'Learn Spell - Pet',
  59: 'Open Item and Fast Loot',
  63: 'Modify Threat - Flat',
  64: 'Trigger Spell',
  74: 'Apply Glyph',
  77: 'Script Effect',
  86: 'Activate Object',
  90: 'Kill Credit',
  92: 'Enchant Held Item',
  95: 'Skinning',
  96: 'Charge',
  98: 'Knock Back',
  99: 'Disenchant',
  101: 'Feed Pet',
  103: 'Give Reputation',
  108: 'Dispel Mechanic',
  113: 'Resurrect with Flat Health',
  118: 'Learn Skill',
  126: 'Spell Steal',
  127: 'Prospect',
  131: 'Play Sound',
  132: 'Play Music',
  133: 'Unlearn Specialization',
  134: 'Kill Credit 2',
  136: 'Heal for % of Total Health',
  137: 'Give % of Total Power',
  140: 'Force Cast',
  141: 'Force Spell Cast with Value',
  142: 'Trigger Spell with Value',
  146: 'Activate Rune',
  151: 'Trigger Spell 2',
  155: 'Dual Wield 2H Weapons',
  157: 'Create Tradeskill Item',
  158: 'Milling',
  164: 'Remove Aura',
  167: 'Update Player Phase'
};

const AURA_NAMES: Record<number, string> = {
  1: 'Bind Sight',
  2: 'Possess',
  3: 'Periodic Damage - Flat',
  4: 'Dummy',
  5: 'Confuse',
  6: 'Charm',
  7: 'Fear',
  8: 'Periodic Heal',
  10: 'Mod Threat',
  11: 'Taunt',
  12: 'Stun',
  13: 'Mod Damage Done - Flat',
  14: 'Mod Damage Taken - Flat',
  15: 'Damage Shield',
  16: 'Stealth',
  18: 'Invisibility',
  21: 'Regenerate Power - %',
  22: 'Mod Resistance - Flat',
  23: 'Periodically Trigger Spell',
  24: 'Periodically Give Power',
  26: 'Root',
  27: 'Silence',
  31: 'Increase Run Speed %',
  32: 'Mod Mounted Speed %',
  33: 'Decrease Run Speed %',
  35: 'Mod Maximum Power - Flat',
  36: 'Shapeshift',
  37: 'Spell Effect Immunity',
  38: 'Spell Aura Immunity',
  39: 'Spell School Immunity',
  40: 'Damage Immunity',
  42: 'Proc Trigger Spell',
  43: 'Proc Trigger Damage',
  44: 'Track Creatures',
  45: 'Track Resources',
  49: 'Mod Dodge %',
  53: 'Periodically Drain Health',
  56: 'Transform',
  57: 'Mod Spell Crit Chance',
  58: 'Increase Swim Speed %',
  59: 'Mod Damage Done Versus Creature',
  61: 'Mod Size %',
  62: 'Periodically Transfer Health',
  63: 'Periodic Transfer Power',
  64: 'Periodic Drain Power',
  65: 'Mod Spell Haste % (not stacking)',
  67: 'Disarm',
  69: 'Mod Absorb School Damage',
  73: 'Mod Spell School Power Cost - Flat',
  77: 'Mechanic Immunity',
  78: 'Mounted',
  79: 'Mod Damage Done - %',
  80: 'Mod Stat - %',
  81: 'Split Damage - %',
  82: 'Underwater Breathing',
  87: 'Mod Damage Taken - %',
  89: 'Periodic Damage - %',
  95: 'Mod Attack Power - Flat',
  99: 'Mod Ranged Damage Taken - %',
  101: 'Mod Resistance - %',
  107: 'Add Modifier - Flat',
  108: 'Add Modifier - %',
  109: 'Proc Spell on Target',
  112: 'Override Class Script',
  118: 'Mod Healing Taken - %',
  121: 'Beast Lore',
  123: 'Mod Target Resistance - Flat',
  129: 'Increase Run Speed % - Stacking',
  130: 'Increase Mounted Speed % - Stacking',
  135: 'Mod Healing Done - Flat',
  136: 'Mod Healing Done - %',
  137: 'Mod Stat - %',
  138: 'Mod Melee Haste %',
  139: 'Force Reputation',
  140: 'Mod Ranged Haste %',
  142: 'Mod Base Resistance - %',
  144: 'Safe Fall',
  145: 'Increase Pet Talent Points',
  146: 'Allow Exotic Pets Taming',
  147: 'Mechanic Immunity Mask',
  148: 'Retain Combo Points',
  149: 'Reduce Pushback Time %',
  151: 'Track Stealthed',
  153: 'Split Damage - Flat',
  160: 'Mod AoE Avoidance',
  163: 'Mod Melee Critical Damage %',
  174: 'Mod Spell Power by % of Stat',
  175: 'Mod Healing Power by % of Stat',
  178: 'Mod Debuff Resistance - %',
  188: 'Mod Rating',
  189: 'Mod Reputation Gained %',
  193: 'Mod Target School Absorb %',
  195: 'Mod Cooldowns',
  199: 'Mod Spell Hit Chance',
  201: 'Can Fly',
  206: 'Mod Vehicle Flight Speed %',
  207: 'Mod Mounted Flight Speed %',
  216: 'Mod Spell Haste %',
  218: 'Mod Mana Regeneration by % of Stat',
  219: 'Mod Combat Rating by % of Stat',
  226: 'Periodic Dummy',
  227: 'Periodically Trigger Spell with Value',
  230: 'Proc Trigger Spell with Value',
  232: 'Control Vehicle',
  236: 'Mod Damage Done Versus Aura State',
  271: 'Mod Damage From Caster'
};

const MOD_AURAS = [107, 108, 106, 129, 193, 214, 215, 216, 220, 221, 222, 236];
const TRIGGER_EFFECTS = [3, 32, 64, 101, 140, 141, 142, 151, 152, 160, 164];
const TRIGGER_AURAS = [4, 23, 42, 109, 226, 227, 230, 232, 235];
const TEACH_EFFECTS = [36, 57];
const ITEM_CREATE_EFFECTS = [24, 34, 66, 157];
const DIRECT_SCALING_EFFECTS = [2, 7, 8, 9, 62, 136];
const PERIODIC_SCALING_AURAS = [3, 8, 53];
const AREA_TARGETS = [
  7, 8, 15, 16, 20, 24, 30, 31, 33, 34, 37, 54, 56, 59, 104, 108
];
const DISPLAY_PLAYER_LEVEL = Number(
  process.env.GAME_DATA_DISPLAY_PLAYER_LEVEL ?? 80
);

const RADIUS_BY_ID: Record<number, number> = {
  7: 2,
  8: 5,
  9: 20,
  10: 30,
  11: 45,
  12: 100,
  13: 10,
  14: 8,
  15: 3,
  16: 1,
  17: 13,
  18: 15,
  19: 18,
  20: 25,
  21: 35,
  22: 200,
  23: 40,
  24: 65,
  25: 70,
  26: 4,
  27: 50
};

const WEAPON_SUBCLASS_NAMES: Array<[number, string]> = [
  [0, 'Axe'],
  [1, 'Two-Handed Axe'],
  [2, 'Bow'],
  [3, 'Gun'],
  [4, 'Mace'],
  [5, 'Two-Handed Mace'],
  [6, 'Polearm'],
  [7, 'Sword'],
  [8, 'Two-Handed Sword'],
  [10, 'Staff'],
  [13, 'Fist Weapon'],
  [15, 'Dagger'],
  [16, 'Thrown'],
  [17, 'Spear'],
  [18, 'Crossbow'],
  [19, 'Wand'],
  [20, 'Fishing Pole']
];

const CUSTOM_FAMILY_SKILLS: Record<number, { id: number; name: string }> = {};

const CUSTOM_CATEGORY_SKILLS: Record<number, { id: number; name: string }> = {
  940: { id: 48, name: 'Voodoo' },
  925: { id: 51, name: 'Shadowhunting' }
};

const CUSTOM_SPEC_SKILLS: Record<number, { id: number; name: string }> = {
  48: { id: 48, name: 'Voodoo' },
  49: { id: 49, name: 'Brewing' },
  51: { id: 51, name: 'Shadowhunting' }
};

export {
  ITEM_CREATE_EFFECTS,
  MOD_AURAS,
  TEACH_EFFECTS,
  TRIGGER_AURAS,
  TRIGGER_EFFECTS
};

export function numberValue(row: Row, key: string) {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 0.0001) return '0';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatCoefficient(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function labelFor(
  map: Record<number, string>,
  value: number,
  fallback: string
) {
  return map[value] ?? `${fallback} ${value}`;
}

export function schoolNames(mask: number) {
  const names = SCHOOL_BITS.filter(([bit]) => (mask & bit) !== 0).map(
    ([, name]) => name
  );
  return names.length ? names.join(', ') : 'n/a';
}

function schoolCategoryHref(mask: number) {
  const match = SCHOOL_BITS.find(([bit]) => bit === mask);
  return match
    ? `/spells?category=school-${match[1].toLowerCase()}`
    : undefined;
}

export function formatMs(ms: number, zero = 'n/a') {
  if (!ms || ms < 0) return zero;
  if (ms < 1000) return `${ms} ms`;
  if (ms % 60000 === 0) return `${ms / 60000} min`;
  if (ms % 1000 === 0) return `${ms / 1000} sec`;
  return `${(ms / 1000).toFixed(1)} sec`;
}

export function hasSpellFlag27(row: Row) {
  return (numberValue(row, 'attributes1') & 0x00000004) !== 0;
}

export function isPassiveSpell(row: Row) {
  return (numberValue(row, 'attributes0') & 0x00000040) !== 0;
}

export function formatSpellCastTime(row: Row, withCastSuffix = false) {
  if (isPassiveSpell(row)) {
    return '';
  }

  if (hasSpellFlag27(row)) {
    const duration = formatMs(numberValue(row, 'duration'), '');
    return duration ? `Channeled (${duration})` : 'Channeled';
  }

  const castTime = formatMs(numberValue(row, 'castTime'), 'Instant');
  return withCastSuffix ? `${castTime} cast` : castTime;
}

export function formatPowerCost(row: Row) {
  const powerType = numberValue(row, 'powerType');
  const name = POWER_TYPES[powerType] ?? `Power ${powerType}`;
  const percent = numberValue(row, 'powerCostPercent');
  const perSecond = numberValue(row, 'powerPerSecond');
  const perLevel = numberValue(row, 'powerCostPerLevel');
  let cost = numberValue(row, 'powerCost');

  if (powerType === 1 || powerType === 6) {
    cost /= 10;
  }

  if (percent > 0) {
    return `${percent}% of base ${name}`;
  }

  const parts: string[] = [];
  if (cost > 0) parts.push(`${cost} ${name}`);
  if (perSecond > 0) parts.push(`${perSecond} per sec`);
  if (perLevel > 0) parts.push(`${perLevel} per level`);
  return parts.length ? parts.join(', plus ') : null; //last edit
}

function refsFromRow(row: Row): Record<string, Row> {
  const raw = row.__spellRefsJson;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Row>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function spellRowFor(row: Row, id?: string) {
  if (!id) return row;
  return refsFromRow(row)[id] ?? row;
}

function displayLevel(row: Row) {
  const configured =
    Number.isFinite(DISPLAY_PLAYER_LEVEL) && DISPLAY_PLAYER_LEVEL > 0
      ? DISPLAY_PLAYER_LEVEL
      : 80;
  return Math.max(
    configured,
    numberValue(row, 'baseLevel'),
    numberValue(row, 'spellLevel')
  );
}

function levelBonus(row: Row, index: number) {
  return (
    numberValue(row, `effect${index}RealPointsPerLevel`) * displayLevel(row)
  );
}

export function formatRange(row: Row) {
  const min =
    numberValue(row, 'rangeMinHostile') || numberValue(row, 'rangeMinFriend');
  const max =
    numberValue(row, 'rangeMaxHostile') || numberValue(row, 'rangeMaxFriend');
  if (max === 5) return `Melee Range`;
  if (max === 50000) return null;
  if (max > 0) return `${min > 0 ? `${min} - ` : ''}${max} yd range`;
  return null;
}

export function equippedItemRequirement(row: Row) {
  const itemClass = numberValue(row, 'equippedItemClass');
  const subclassMask = numberValue(row, 'equippedItemSubClassMask');
  if (itemClass !== 2 || subclassMask <= 0) return '';

  const names = WEAPON_SUBCLASS_NAMES.filter(
    ([bit]) => (subclassMask & (1 << bit)) !== 0
  ).map(([, name]) => name);
  return names.length ? names.join(' or ') : 'Weapon';
}

export function customSkillForSpell(row: Row) {
  const ownerSpecName =
    typeof row.ownerSpecName === 'string' ? row.ownerSpecName.trim() : '';
  if (ownerSpecName) {
    const ownerSpecSkillId = numberValue(row, 'ownerSpecSkillId');
    const knownSpec = CUSTOM_SPEC_SKILLS[ownerSpecSkillId];
    return {
      id: ownerSpecSkillId || numberValue(row, 'ownerSpecId'),
      name: knownSpec?.name ?? ownerSpecName
    };
  }

  const ownerSpecSkill =
    CUSTOM_SPEC_SKILLS[numberValue(row, 'ownerSpecSkillId')];
  if (ownerSpecSkill) return ownerSpecSkill;

  const primarySkill = CUSTOM_SPEC_SKILLS[numberValue(row, 'skillLine1')];
  if (primarySkill) return primarySkill;

  const categorySkill = CUSTOM_CATEGORY_SKILLS[numberValue(row, 'category')];
  if (categorySkill) return categorySkill;
  return CUSTOM_FAMILY_SKILLS[numberValue(row, 'spellFamilyId')] ?? null;
}

function baseAmountRange(row: Row, index: number) {
  const min = baseMinAmount(row, index);
  const max = baseMaxAmount(row, index);
  return min !== max
    ? `${formatNumber(min)} to ${formatNumber(max)}`
    : formatNumber(max);
}

function scaledAmountRange(row: Row, index: number) {
  const level = levelBonus(row, index);
  const min = baseMinAmount(row, index) + level;
  const max = baseMaxAmount(row, index) + level;
  return min !== max
    ? `${formatNumber(min)} to ${formatNumber(max)}`
    : formatNumber(max);
}

function baseMinAmount(row: Row, index: number) {
  const base = numberValue(row, `effect${index}BasePoints`);
  const dieSides = numberValue(row, `effect${index}DieSides`);
  return dieSides ? base + 1 : base;
}

function baseMaxAmount(row: Row, index: number) {
  const base = numberValue(row, `effect${index}BasePoints`);
  const dieSides = numberValue(row, `effect${index}DieSides`);
  return base + dieSides;
}

function scaledMinAmount(row: Row, index: number) {
  return baseMinAmount(row, index) + levelBonus(row, index);
}

function scaledMaxAmount(row: Row, index: number) {
  return baseMaxAmount(row, index) + levelBonus(row, index);
}

function totalPeriodicAmount(row: Row, index: number) {
  const tickCount = ticks(row, index);
  return {
    min: scaledMinAmount(row, index) * tickCount,
    max: scaledMaxAmount(row, index) * tickCount
  };
}

function radiusValue(row: Row, index: number) {
  const radiusId =
    numberValue(row, `effect${index}RadiusMax`) ||
    numberValue(row, `effect${index}RadiusMin`);
  return RADIUS_BY_ID[radiusId] ?? radiusId;
}

function ticks(row: Row, index: number) {
  const period = numberValue(row, `effect${index}Periode`);
  const duration = numberValue(row, 'duration');
  return period > 0 && duration > 0
    ? Math.max(1, Math.floor(duration / period))
    : 1;
}

export function renderSpellText(row: Row, text: string) {
  let output = text;

  output = output.replace(
    /\$([*/+\-])(\d+);(\d*)([a-z])([123]?)/gi,
    (_, op, opArg, spellId, variable, rawIndex) =>
      formatSpellVariable(row, {
        spellId,
        variable,
        index: Number(rawIndex || 1),
        op,
        opArg: Number(opArg)
      })
  );

  return output
    .replace(/\|c[0-9a-f]{8}/gi, '')
    .replace(/\|r/g, '')
    .replace(/@ext:([\s\S]*?):ext@/gi, '$1')
    .replace(/\$\?s\d+\[([\s\S]*?)\]\[([\s\S]*?)\]/g, '$1')
    .replace(/\$\{([^{}]+)\}/g, (_, expression) =>
      formatNumber(evaluateSpellExpression(row, String(expression)))
    )
    .replace(/\$(\d*)ppl([123])/gi, (_, spellId, rawIndex) =>
      formatSpellVariable(row, {
        spellId,
        variable: 'ppl',
        index: Number(rawIndex)
      })
    )
    .replace(/\$(\d*)([a-z])([123]?)\b/gi, (_, spellId, variable, rawIndex) =>
      formatSpellVariable(row, {
        spellId,
        variable,
        index: Number(rawIndex || 1)
      })
    )
    .replace(/\$d/g, formatMs(numberValue(row, 'duration'), '0 sec'))
    .replace(/\s+/g, ' ')
    .trim();
}

function applyOperator(value: number, op?: string, opArg?: number) {
  if (!op || !Number.isFinite(opArg)) return value;
  const amount = opArg ?? 0;
  if (op === '+') return value + amount;
  if (op === '-') return value - amount;
  if (op === '*') return value * amount;
  if (op === '/') return amount === 0 ? 0 : value / amount;
  return value;
}

function formatSpellVariable(
  row: Row,
  options: {
    spellId?: string;
    variable: string;
    index: number;
    op?: string;
    opArg?: number;
  }
) {
  const target = spellRowFor(row, options.spellId);
  const variable = options.variable.toLowerCase();
  const index = options.index || 1;

  if (variable === 'd')
    return formatMs(
      applyOperator(numberValue(target, 'duration'), options.op, options.opArg),
      '0 sec'
    );
  if (variable === 't') {
    const period = applyOperator(
      numberValue(target, `effect${index}Periode`) / 1000,
      options.op,
      options.opArg
    );
    return formatNumber(period);
  }
  if (variable === 'a')
    return formatNumber(
      applyOperator(radiusValue(target, index), options.op, options.opArg)
    );
  if (variable === 'b')
    return formatNumber(
      applyOperator(
        numberValue(target, `effect${index}PointsPerComboPoint`),
        options.op,
        options.opArg
      )
    );
  if (variable === 'e')
    return formatNumber(
      applyOperator(
        numberValue(target, `effect${index}ValueMultiplier`),
        options.op,
        options.opArg
      )
    );
  if (variable === 'f')
    return formatNumber(
      applyOperator(
        numberValue(target, `effect${index}DamageMultiplier`),
        options.op,
        options.opArg
      )
    );
  if (variable === 'h')
    return formatNumber(
      applyOperator(
        numberValue(target, 'procChance'),
        options.op,
        options.opArg
      )
    );
  if (variable === 'i')
    return formatNumber(
      applyOperator(
        numberValue(target, 'maxAffectedTargets'),
        options.op,
        options.opArg
      )
    );
  if (variable === 'm' || variable === 'w')
    return formatNumber(
      applyOperator(scaledMinAmount(target, index), options.op, options.opArg)
    );
  if (variable === 'n')
    return formatNumber(
      applyOperator(
        numberValue(target, 'procCharges'),
        options.op,
        options.opArg
      )
    );
  if (variable === 'o') {
    const total = totalPeriodicAmount(target, index);
    const min = applyOperator(total.min, options.op, options.opArg);
    const max = applyOperator(total.max, options.op, options.opArg);
    return min !== max
      ? `${formatNumber(min)} to ${formatNumber(max)}`
      : formatNumber(min);
  }
  if (variable === 'q')
    return formatNumber(
      applyOperator(
        numberValue(target, `effect${index}MiscValue`),
        options.op,
        options.opArg
      )
    );
  if (variable === 'r')
    return formatNumber(
      applyOperator(
        numberValue(target, 'rangeMaxHostile') ||
          numberValue(target, 'rangeMaxFriend'),
        options.op,
        options.opArg
      )
    );
  if (variable === 's') {
    const value = options.spellId
      ? scaledAmountRange(target, index)
      : baseAmountRange(target, index);
    if (!options.op) return value;
    const min = applyOperator(
      scaledMinAmount(target, index),
      options.op,
      options.opArg
    );
    const max = applyOperator(
      scaledMaxAmount(target, index),
      options.op,
      options.opArg
    );
    return min !== max
      ? `${formatNumber(min)} to ${formatNumber(max)}`
      : formatNumber(min);
  }
  if (variable === 'u')
    return formatNumber(
      applyOperator(
        numberValue(target, 'stackAmount'),
        options.op,
        options.opArg
      )
    );
  if (variable === 'v')
    return formatNumber(
      applyOperator(
        numberValue(target, 'maxTargetLevel'),
        options.op,
        options.opArg
      )
    );
  if (variable === 'x')
    return formatNumber(
      applyOperator(
        numberValue(target, `effect${index}ChainTarget`),
        options.op,
        options.opArg
      )
    );

  return `$${options.spellId ?? ''}${options.variable}${options.index || ''}`;
}

function evaluateSpellExpression(row: Row, expression: string) {
  const source = expression.replace(
    /\$([A-Za-z]\w*|\d+[A-Za-z]\w*)/g,
    (_, token) => {
      return String(spellVariableValue(row, String(token)));
    }
  );
  return parseArithmetic(source);
}

function spellVariableValue(row: Row, token: string) {
  const match = token.match(/^(\d+)?([A-Za-z]+)(\d*)$/);
  if (!match) return 0;

  const [, spellId, rawKey, rawIndex] = match;
  const target = spellRowFor(row, spellId);
  const key = rawKey.toLowerCase();
  const index = rawIndex ? Number(rawIndex) : 0;

  if (key === 'pl') return displayLevel(target);
  if (key === 'm' || key === 's' || key === 'w')
    return index ? scaledMinAmount(target, index) : 0;
  if (key === 'ppl') return index ? levelBonus(target, index) : 0;
  if (key === 'a') return index ? radiusValue(target, index) : 0;
  if (key === 'o') return index ? totalPeriodicAmount(target, index).min : 0;
  if (key === 'rap' || key === 'ap' || key === 'sp' || key === 'sps') return 0;
  return 0;
}

function parseArithmetic(source: string) {
  const tokens = source.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  let offset = 0;

  const peek = () => tokens[offset];
  const consume = () => tokens[offset++];

  const parseFactor = (): number => {
    const token = consume();
    if (!token) return 0;
    if (token === '+') return parseFactor();
    if (token === '-') return -parseFactor();
    if (token === '(') {
      const value = parseExpression();
      if (peek() === ')') consume();
      return value;
    }
    const value = Number(token);
    return Number.isFinite(value) ? value : 0;
  };

  const parseTerm = (): number => {
    let value = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const operator = consume();
      const right = parseFactor();
      value =
        operator === '*' ? value * right : right === 0 ? 0 : value / right;
    }
    return value;
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const operator = consume();
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };

  return parseExpression();
}

function isChanneled(row: Row) {
  const attributes1 = numberValue(row, 'attributes1');
  return (
    hasSpellFlag27(row) ||
    (attributes1 & 0x00000040) !== 0 ||
    (attributes1 & 0x00004000) !== 0
  );
}

function castingTimeForBonus(row: Row, asDot: boolean) {
  let castingTime = isChanneled(row)
    ? numberValue(row, 'duration')
    : numberValue(row, 'castTime');
  if (!castingTime) castingTime = 3500;
  if (castingTime > 7000) castingTime = 7000;
  if (castingTime < 1500) castingTime = 1500;
  if (asDot && !isChanneled(row)) castingTime = 3500;

  let overTime = 0;
  let extraEffects = 0;
  let hasDirect = false;
  let isArea = false;

  for (let index = 1; index <= 3; index++) {
    const effectId = numberValue(row, `effect${index}Id`);
    const auraId = numberValue(row, `effect${index}AuraId`);

    if (DIRECT_SCALING_EFFECTS.includes(effectId)) {
      hasDirect = true;
    } else if (PERIODIC_SCALING_AURAS.includes(auraId)) {
      overTime = numberValue(row, 'duration') || overTime;
    } else if (auraId) {
      extraEffects++;
    }

    if (
      AREA_TARGETS.includes(
        numberValue(row, `effect${index}ImplicitTargetA`)
      ) ||
      AREA_TARGETS.includes(numberValue(row, `effect${index}ImplicitTargetB`))
    ) {
      isArea = true;
    }
  }

  if (overTime > 0 && castingTime > 0 && hasDirect) {
    let originalCastTime = numberValue(row, 'castTime');
    if (numberValue(row, 'attributes0') & 0x00000002) originalCastTime += 500;
    if (originalCastTime > 7000) originalCastTime = 7000;
    if (originalCastTime < 1500) originalCastTime = 1500;

    const dotPortion =
      overTime / 15000 / (overTime / 15000 + originalCastTime / 3500);
    castingTime = asDot
      ? castingTime * dotPortion
      : castingTime * (1 - dotPortion);
  }

  if (isArea) castingTime /= 2;
  castingTime -= extraEffects * 175;
  return Math.max(0, castingTime);
}

function hasDirectScaling(row: Row) {
  return [1, 2, 3].some((index) =>
    DIRECT_SCALING_EFFECTS.includes(numberValue(row, `effect${index}Id`))
  );
}

function hasPeriodicScaling(row: Row) {
  return [1, 2, 3].some((index) =>
    PERIODIC_SCALING_AURAS.includes(numberValue(row, `effect${index}AuraId`))
  );
}

export function scalingFields(row: Row): DetailField[] {
  const fields: DetailField[] = [];
  const formulaFields = formulaScalingFields(row);
  if (formulaFields.length > 0) return formulaFields;

  const directOverride = Math.max(
    numberValue(row, 'effect1BonusMultiplier'),
    numberValue(row, 'effect2BonusMultiplier'),
    numberValue(row, 'effect3BonusMultiplier')
  );
  const damageClass = numberValue(row, 'damageClass');
  const schoolMask = numberValue(row, 'schoolMask');

  if (directOverride > 0) {
    fields.push({
      label: 'Direct spell power',
      value: `+${(directOverride * 100).toFixed(2)}%`
    });
  } else if (damageClass !== 0 && schoolMask !== 1 && hasDirectScaling(row)) {
    fields.push({
      label: 'Direct spell power',
      value: `+${((castingTimeForBonus(row, false) / 3500) * 100).toFixed(2)}% (estimated)`
    });
  }

  if (hasPeriodicScaling(row)) {
    const duration = Math.min(numberValue(row, 'duration') || 0, 30000);
    const dotFactor = duration > 0 && !isChanneled(row) ? duration / 15000 : 1;
    const dotCoefficient = (castingTimeForBonus(row, true) / 3500) * dotFactor;
    if (dotCoefficient > 0) {
      fields.push({
        label: 'Periodic spell power',
        value: `+${(dotCoefficient * 100).toFixed(2)}% per tick (estimated)`
      });
    }
  }

  return fields;
}

function formulaScalingFields(row: Row): DetailField[] {
  const text = `${typeof row.description_loc0 === 'string' ? row.description_loc0 : ''} ${
    typeof row.buff_loc0 === 'string' ? row.buff_loc0 : ''
  }`;
  const firstFormula = text.match(/\$\{([^{}]+)\}/)?.[1] ?? '';
  if (!firstFormula) return [];

  const fields: DetailField[] = [];
  const rap = coefficientFor(firstFormula, 'RAP');
  if (rap > 0)
    fields.push({
      label: 'Ranged Attack Power',
      value: `x${formatCoefficient(rap)}`
    });

  const sp =
    coefficientFor(firstFormula, 'SP') || coefficientFor(firstFormula, 'sps');
  if (sp > 0 && rap === 0)
    fields.push({ label: 'Spell Power', value: `x${formatCoefficient(sp)}` });

  const level = numberValue(row, 'effect1RealPointsPerLevel');
  if (level > 0)
    fields.push({ label: 'Level', value: `+${formatCoefficient(level)}/lvl` });

  const combo = numberValue(row, 'effect1PointsPerComboPoint');
  if (combo > 0)
    fields.push({
      label: 'Combo Points',
      value: `+${formatCoefficient(combo)}/CP`
    });

  return fields;
}

function coefficientFor(expression: string, variable: string) {
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\$${escaped}\\s*\\*\\s*([0-9]*\\.?[0-9]+)`, 'i'),
    new RegExp(`([0-9]*\\.?[0-9]+)\\s*\\*\\s*\\$${escaped}`, 'i')
  ];
  for (const pattern of patterns) {
    const match = expression.match(pattern);
    if (match) return Number(match[1]) || 0;
  }
  return expression.match(new RegExp(`\\$${escaped}\\b`, 'i')) ? 1 : 0;
}

export function effectRows(row: Row): DetailRow[] {
  const rows: DetailRow[] = [];

  for (const index of [1, 2, 3]) {
    const effectId = numberValue(row, `effect${index}Id`);
    const auraId = numberValue(row, `effect${index}AuraId`);
    if (!effectId) continue;

    const effectName = labelFor(EFFECT_NAMES, effectId, 'Effect');
    const auraName = auraId ? labelFor(AURA_NAMES, auraId, 'Aura') : '';
    const fields: DetailField[] = [
      {
        label: 'Description',
        value: auraName ? `${effectName}: ${auraName}` : effectName
      }
    ];

    const amount = scaledAmountRange(row, index);
    if (amount !== '-1') fields.push({ label: 'Value', value: amount });

    const period = numberValue(row, `effect${index}Periode`);
    if (period > 0) fields.push({ label: 'Interval', value: formatMs(period) });

    const radius = radiusValue(row, index);
    if (radius > 0) fields.push({ label: 'Radius', value: `${radius} yd` });

    const mechanic = numberValue(row, `effect${index}Mechanic`);
    if (mechanic > 0)
      fields.push({
        label: 'Mechanic',
        value: labelFor(MECHANICS, mechanic, 'Mechanic')
      });

    const triggerSpell = numberValue(row, `effect${index}TriggerSpell`);
    if (triggerSpell > 0)
      fields.push({
        label: 'Triggers spell',
        value: triggerSpell,
        href: getEntityDetailPath('spells', triggerSpell)
      });

    const createdItem = numberValue(row, `effect${index}CreateItemId`);
    if (createdItem > 0)
      fields.push({
        label: 'Creates item',
        value: createdItem,
        href: getEntityDetailPath('items', createdItem)
      });

    rows.push({ label: `Effect #${index}`, fields });
  }

  return rows;
}

export function attributeFields(row: Row): DetailField[] {
  const fields: DetailField[] = [];
  const attrs0 = numberValue(row, 'attributes0');
  const attrs1 = numberValue(row, 'attributes1');
  const attrs2 = numberValue(row, 'attributes2');
  const attrs3 = numberValue(row, 'attributes3');
  const attrs4 = numberValue(row, 'attributes4');
  const attrs5 = numberValue(row, 'attributes5');

  const add = (id: number, label: string, active: boolean) => {
    if (active)
      fields.push({ label: 'Flag', value: label, href: `/spells?flag=${id}` });
  };

  add(33, 'Castable in combat', (attrs0 & 0x10000000) === 0);
  add(34, 'Chance to critically hit', (attrs2 & 0x20000000) === 0);
  add(35, 'Chance to miss', (attrs3 & 0x00040000) === 0);
  add(50, 'Passive spell', isPassiveSpell(row));
  add(27, 'Channeled', (attrs1 & 0x00000004) !== 0);
  add(66, 'Channeled 2', (attrs1 & 0x00000040) !== 0);
  add(47, 'Disregards school immunity', (attrs1 & 0x00010000) !== 0);
  add(
    48,
    'Requires a ranged weapon',
    numberValue(row, 'equippedItemClass') === 2 &&
      (numberValue(row, 'equippedItemSubClassMask') & 0x0004000c) !== 0
  );
  add(49, 'On next swing (players)', (attrs0 & 0x00000004) !== 0);
  add(52, 'On next swing (npcs)', (attrs0 & 0x00000400) !== 0);
  add(53, 'Can only be used during daytime', (attrs0 & 0x00001000) !== 0);
  add(54, 'Can only be used during nighttime', (attrs0 & 0x00002000) !== 0);
  add(55, 'Can only be used indoors', (attrs0 & 0x00004000) !== 0);
  add(56, 'Can only be used outdoors', (attrs0 & 0x00008000) !== 0);
  add(58, 'Spell damage depends on caster level', (attrs0 & 0x00080000) !== 0);
  add(59, 'Stops auto-attack', (attrs0 & 0x00100000) !== 0);
  add(60, 'Cannot be dodged, parried or blocked', (attrs0 & 0x00200000) !== 0);
  add(61, 'Can be used while dead', (attrs0 & 0x00800000) !== 0);
  add(62, 'Can be used while mounted', (attrs0 & 0x01000000) !== 0);
  add(63, 'Starts cooldown after aura fades', (attrs0 & 0x02000000) !== 0);
  add(64, 'Can be used while sitting', (attrs0 & 0x08000000) !== 0);
  add(65, 'Uses all power', (attrs1 & 0x00000002) !== 0);
  add(67, 'Cannot be reflected', (attrs1 & 0x00000080) !== 0);
  add(68, 'Does not break stealth', (attrs1 & 0x00000020) !== 0);
  add(70, 'The target cannot be in combat', (attrs1 & 0x00000100) !== 0);
  add(71, 'Generates no threat', (attrs1 & 0x00000400) !== 0);
  add(72, 'Pickpocket spell', (attrs1 & 0x00001000) !== 0);
  add(73, 'Remove auras on immunity', (attrs1 & 0x00008000) !== 0);
  add(75, 'Requires untapped target', (attrs2 & 0x00000040) !== 0);
  add(77, 'Does not require shapeshift', (attrs2 & 0x00080000) !== 0);
  add(78, 'Food/Drink buff', (attrs2 & 0x80000000) !== 0);
  add(79, 'Can only target the player', (attrs3 & 0x00000100) !== 0);
  add(80, 'Requires main hand weapon', (attrs3 & 0x00000400) !== 0);
  add(81, 'Does not engage target', (attrs3 & 0x00020000) !== 0);
  add(82, 'Requires a wand', (attrs3 & 0x00400000) !== 0);
  add(83, 'Requires an off-hand weapon', (attrs3 & 0x01000000) !== 0);
  add(84, 'Does not appear in log', (attrs4 & 0x00000004) !== 0);
  add(85, 'Continues while logged out', (attrs4 & 0x00000004) !== 0);
  add(87, 'Starts ticking at aura application', (attrs5 & 0x00000200) !== 0);
  add(88, 'Usable while confused', (attrs5 & 0x00040000) !== 0);
  add(89, 'Usable while feared', (attrs5 & 0x00020000) !== 0);
  add(
    90,
    'Only usable in arena',
    (numberValue(row, 'attributes6') & 0x00000002) !== 0
  );
  add(
    91,
    'Cannot be used in a raid',
    (numberValue(row, 'attributes6') & 0x00000800) !== 0
  );
  add(93, 'Totem', (numberValue(row, 'attributes7') & 0x00000020) !== 0);

  return fields;
}

export function buildReadableSpellSections(row: Row): DetailSection[] {
  const scaling = scalingFields(row);

  return [
    {
      id: 'spell-details',
      title: 'Spell Details',
      fields: [
        { label: 'Cost', value: formatPowerCost(row) },
        { label: 'Range', value: formatRange(row) },
        ...(isPassiveSpell(row)
          ? []
          : [
              {
                label: 'Cast time',
                value: formatSpellCastTime(row)
              }
            ]),
        {
          label: 'Cooldown',
          value: formatMs(
            numberValue(row, 'recoveryTime') ||
              numberValue(row, 'recoveryCategory')
          )
        },
        {
          label: 'GCD',
          value: formatMs(numberValue(row, 'startRecoveryTime'), '0s')
        },
        { label: 'Duration', value: formatMs(numberValue(row, 'duration')) },
        {
          label: 'School',
          value: schoolNames(numberValue(row, 'schoolMask')),
          href: schoolCategoryHref(numberValue(row, 'schoolMask'))
        },
        {
          label: 'Mechanic',
          value: labelFor(MECHANICS, numberValue(row, 'mechanic'), 'Mechanic')
        },
        {
          label: 'Dispel type',
          value: labelFor(
            DISPEL_TYPES,
            numberValue(row, 'dispelType'),
            'Dispel'
          )
        },
        {
          label: 'Damage class',
          value: labelFor(
            DAMAGE_CLASSES,
            numberValue(row, 'damageClass'),
            'Damage class'
          )
        },
        ...(equippedItemRequirement(row)
          ? [{ label: 'Requires', value: equippedItemRequirement(row) }]
          : []),
        ...(customSkillForSpell(row)
          ? [
              {
                label: 'Skill',
                value: customSkillForSpell(row)?.name ?? '',
                href: getEntityDetailPath('skills', customSkillForSpell(row)?.id ?? 0)
              }
            ]
          : []),

        {
          label: 'Required level',
          value:
            numberValue(row, 'baseLevel') ||
            numberValue(row, 'spellLevel') ||
            'n/a'
        }
        // {
        //   label: 'Flags',
        //   value: attributeFields(row).map((field) => field.value)
        // }
        // { label: "Spell level", value: numberValue(row, "spellLevel") || "n/a" },
      ]
    },
    ...(scaling.length
      ? [
          {
            id: 'spell-scaling',
            title: 'Scaling',
            fields: scaling
          }
        ]
      : []),
    {
      id: 'spell-effects',
      title: 'Effects',
      rows: effectRows(row)
    },
    {
      id: 'spell-flags',
      title: 'Flags',
      fields: attributeFields(row)
    }
    // {
    //   id: 'spell-raw-flags',
    //   title: 'Raw Masks',
    //   description: 'Raw AoWoW/AzerothCore masks kept for staff verification.',
    //   fields: [
    //     {
    //       label: 'Attributes 0',
    //       value: `0x${numberValue(row, 'attributes0').toString(16).padStart(8, '0')}`
    //     },
    //     {
    //       label: 'Attributes 1',
    //       value: `0x${numberValue(row, 'attributes1').toString(16).padStart(8, '0')}`
    //     },
    //     {
    //       label: 'Attributes 2',
    //       value: `0x${numberValue(row, 'attributes2').toString(16).padStart(8, '0')}`
    //     },
    //     {
    //       label: 'Attributes 3',
    //       value: `0x${numberValue(row, 'attributes3').toString(16).padStart(8, '0')}`
    //     },
    //     { label: 'Family', value: numberValue(row, 'spellFamilyId') || 'n/a' },
    //     {
    //       label: 'Family flags 1',
    //       value: `0x${numberValue(row, 'spellFamilyFlags1').toString(16).padStart(8, '0')}`
    //     },
    //     {
    //       label: 'Family flags 2',
    //       value: `0x${numberValue(row, 'spellFamilyFlags2').toString(16).padStart(8, '0')}`
    //     },
    //     {
    //       label: 'Family flags 3',
    //       value: `0x${numberValue(row, 'spellFamilyFlags3').toString(16).padStart(8, '0')}`
    //     }
    //   ]
    // }
  ].filter((section) => section.fields?.length || section.rows?.length);
}
