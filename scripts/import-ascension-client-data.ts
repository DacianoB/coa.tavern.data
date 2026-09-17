import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Pool, type PoolClient } from "pg";
import { startImportJob } from "./lib/import-history";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

type DbcValue = number | string | null;
type DbcRow = Record<string, DbcValue>;
type Field = { name: string; type: "i" | "u" | "f" | "s" | "b" | "x" | "X" };
type ColumnInfo = {
  column_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
};

const DEFAULT_ASCENSION_DATA_DIR =
  "C:\\Program Files\\Ascension Launcher\\resources\\ascension_ptr\\Data";
const locale = process.env.ASCENSION_LOCALE || "enUS";
const dataDir = process.env.ASCENSION_DATA_DIR || process.argv[2] || DEFAULT_ASCENSION_DATA_DIR;
const workDir = path.join(process.cwd(), ".tmp", "ascension-mpqdata", locale, "DBFilesClient");
const luaWorkDir = path.join(process.cwd(), ".tmp", "ascension-mpqdata", "InterfaceLua");
const iconListFile = path.join(process.cwd(), ".tmp", "ascension-mpqdata", locale, "icons.txt");
const iconOutDir = process.env.ASCENSION_ICON_OUT_DIR || path.join(process.cwd(), "public", "game-icons", "medium");
const connectionString = process.env.GAME_DATABASE_URL || process.env.DATABASE_URL;
const targetSchema = process.env.GAME_DATABASE_SCHEMA || "game";

const dbcFiles = [
  "Achievement.dbc",
  "Achievement_Category.dbc",
  "AreaTable.dbc",
  "CharBaseInfo.dbc",
  "CharacterAdvancement.dbc",
  "CharacterAdvancementClassTypes.dbc",
  "CharacterAdvancementTabTypes.dbc",
  "CharTitles.dbc",
  "ChrClasses.dbc",
  "ChrSpecs.dbc",
  "ChrRaces.dbc",
  "CreatureFamily.dbc",
  "CurrencyTypes.dbc",
  "Emotes.dbc",
  "Faction.dbc",
  "Item.dbc",
  "ItemDisplayInfo.dbc",
  "ItemSet.dbc",
  "MailTemplate.dbc",
  "SkillLine.dbc",
  "SkillLineAbility.dbc",
  "SkillRaceClassInfo.dbc",
  "SoundEntries.dbc",
  "Spell.dbc",
  "SpellCastTimes.dbc",
  "SpellDuration.dbc",
  "SpellIcon.dbc",
  "SpellRange.dbc",
  "SpellItemEnchantment.dbc",
  "Talent.dbc",
  "TalentTab.dbc",
];

const luaFiles = [
  "Interface\\FrameXML\\Constants.lua",
  "Interface\\FrameXML\\Data\\CharacterAdvancement.lua",
  "Interface\\FrameXML\\Util\\CharacterAdvancementUtil.lua",
  "Interface\\FrameXML\\Util\\SpecializationUtil.lua",
  "Interface\\SharedXML\\AtlasInfo.lua",
  "Interface\\SharedXML\\Enum.lua",
  "Interface\\SharedXML\\SharedConstants.lua",
  "Interface\\SharedXML\\Util\\ClassInfoUtil.lua",
  "Interface\\AddOns\\AscensionUI\\CharacterAdvancement\\CASpecListMixin.lua",
  "Interface\\AddOns\\Ascension_CoATalents\\Templates\\CoASpecChoiceMixin.lua",
];

const locTypes = "sxsssxsxsxxxxxxxx".split("") as Array<Field["type"]>;
const xLocTypes = "xxxxxxxxxxxxxxxxx".split("") as Array<Field["type"]>;

function fields(definition: Array<[string, string]>) {
  const result: Field[] = [];

  for (const [name, type] of definition) {
    if (type === "LOC" || type === "X_LOC") {
      const types = type === "LOC" ? locTypes : xLocTypes;
      for (let index = 0; index < types.length; index += 1) {
        const fieldType = types[index];
        result.push({
          name: fieldType === "s" ? `${name}_loc${index}` : `${name}_${index}`,
          type: fieldType,
        });
      }
    } else {
      result.push({ name, type: type as Field["type"] });
    }
  }

  return result;
}

function numberedFields(count: number, named: Record<number, [string, string]>) {
  const result: Field[] = [];

  for (let index = 0; index < count; index += 1) {
    const definition = named[index];
    result.push(definition ? { name: definition[0], type: definition[1] as Field["type"] } : { name: `unused${index}`, type: "x" });
  }

  return result;
}

const defs: Record<string, Field[]> = {
  Achievement: fields([
    ["id", "i"], ["faction", "i"], ["map", "i"], ["previous", "i"], ["name", "LOC"],
    ["description", "LOC"], ["category", "i"], ["points", "i"], ["orderInGroup", "i"],
    ["flags", "i"], ["iconId", "i"], ["reward", "LOC"], ["reqCriteriaCount", "i"],
    ["refAchievement", "i"],
  ]),
  Achievement_Category: fields([
    ["id", "i"], ["parentCategory", "i"], ["unused", "X_LOC"], ["unused3", "x"],
  ]),
  AreaTable: fields([
    ["id", "i"], ["mapId", "i"], ["areaTable", "i"], ["areaBit", "x"], ["flags", "i"],
    ["soundProviderPref", "x"], ["soundProviderPrefWater", "x"], ["soundAmbience", "i"],
    ["zoneMusic", "i"], ["zoneIntroMusic", "i"], ["explorationLevel", "x"], ["name", "LOC"],
    ["factionGroupMask", "i"], ["liquidType1", "x"], ["liquidType2", "x"], ["liquidType3", "x"],
    ["liquidType4", "x"], ["minElevation", "x"], ["ambientMultiplier", "x"], ["lightId", "x"],
  ]),
  CharBaseInfo: fields([["raceId", "b"], ["classId", "b"]]),
  CharacterAdvancementClassTypes: numberedFields(23, {
    0: ["id", "i"],
    1: ["token", "s"],
    2: ["classId", "i"],
    6: ["name", "s"],
  }),
  CharacterAdvancementTabTypes: numberedFields(19, {
    0: ["id", "i"],
    1: ["name", "s"],
    2: ["label", "s"],
  }),
  CharacterAdvancement: numberedFields(179, {
    0: ["id", "i"],
    1: ["type", "s"],
    2: ["parentId", "i"],
    3: ["groupId", "i"],
    5: ["spellId", "i"],
    6: ["rank2SpellId", "i"],
    7: ["rank3SpellId", "i"],
    8: ["rank4SpellId", "i"],
    9: ["rank5SpellId", "i"],
    26: ["levelRequired1", "i"],
    27: ["levelRequired2", "i"],
    28: ["levelRequired3", "i"],
    30: ["row", "i"],
    31: ["col", "i"],
    32: ["classTypeId", "i"],
    33: ["tabTypeId", "i"],
    47: ["name", "s"],
    64: ["icon", "s"],
    100: ["prerequisite", "s"],
    151: ["anchor", "s"],
    152: ["color", "s"],
    153: ["shape", "s"],
    171: ["unused171", "X"],
    172: ["unused172", "X"],
    173: ["unused173", "X"],
    174: ["unused174", "X"],
    175: ["unused175", "X"],
    176: ["unused176", "X"],
    177: ["unused177", "X"],
    178: ["unused178", "X"],
  }),
  CharTitles: fields([["id", "i"], ["unused1", "x"], ["male", "LOC"], ["female", "LOC"], ["bitIdx", "i"]]),
  ChrClasses: fields([
    ["id", "i"], ["unused1", "x"], ["powerType", "i"], ["unused3", "x"], ["name", "LOC"],
    ["unused5", "X_LOC"], ["unused6", "X_LOC"], ["fileString", "s"], ["unused8", "x"],
    ["flags", "i"], ["unused10", "x"], ["expansion", "i"],
  ]),
  ChrSpecs: numberedFields(65, {
    0: ["id", "i"],
    1: ["classToken", "s"],
    2: ["specToken", "s"],
    3: ["icon", "s"],
    24: ["primarySpellId", "i"],
    25: ["secondarySpellId", "i"],
    27: ["passiveSpellId", "i"],
    28: ["advancementId", "i"],
    29: ["name", "s"],
    46: ["description", "s"],
    63: ["orderIndex", "i"],
    64: ["role", "i"],
  }),
  ChrRaces: fields([
    ["id", "i"], ["flags", "i"], ["factionId", "i"], ["unused3", "x"], ["unused4", "x"],
    ["unused5", "x"], ["unused6", "x"], ["baseLanguage", "i"], ["unused8", "x"], ["unused9", "x"],
    ["unused10", "x"], ["fileString", "s"], ["unused12", "x"], ["side", "i"], ["name", "LOC"],
    ["unused15", "X_LOC"], ["unused16", "X_LOC"], ["unused17", "x"], ["unused18", "x"],
    ["unused19", "x"], ["expansion", "i"],
  ]),
  CreatureFamily: fields([
    ["id", "i"], ["unused1", "x"], ["unused2", "x"], ["unused3", "x"], ["unused4", "x"],
    ["skillLine1", "i"], ["unused6", "x"], ["petFoodMask", "i"], ["petTalentType", "i"],
    ["categoryEnumID", "i"], ["name", "LOC"], ["iconString", "s"],
  ]),
  CurrencyTypes: fields([["id", "i"], ["itemId", "i"], ["category", "i"], ["bitIdx", "i"]]),
  Emotes: fields([
    ["id", "i"], ["name", "s"], ["animationId", "i"], ["flags", "i"], ["state", "i"],
    ["stateParam", "i"], ["soundId", "i"],
  ]),
  Faction: fields([
    ["id", "i"], ["repIdx", "i"], ["baseRepRaceMask1", "i"], ["baseRepRaceMask2", "i"],
    ["baseRepRaceMask3", "i"], ["baseRepRaceMask4", "i"], ["baseRepClassMask1", "i"],
    ["baseRepClassMask2", "i"], ["baseRepClassMask3", "i"], ["baseRepClassMask4", "i"],
    ["baseRepValue1", "i"], ["baseRepValue2", "i"], ["baseRepValue3", "i"], ["baseRepValue4", "i"],
    ["repFlags1", "i"], ["unused15", "x"], ["unused16", "x"], ["unused17", "x"],
    ["parentFaction", "i"], ["spilloverRateIn", "f"], ["spilloverRateOut", "f"],
    ["spilloverMaxRank", "i"], ["unused22", "x"], ["name", "LOC"], ["unused24", "X_LOC"],
  ]),
  Item: fields([
    ["id", "i"], ["classId", "i"], ["subClassId", "i"], ["soundOverride", "i"], ["material", "i"],
    ["displayInfoId", "i"], ["inventoryType", "i"], ["sheatheType", "i"],
  ]),
  ItemDisplayInfo: fields([
    ["id", "i"], ["leftModelName", "s"], ["rightModelName", "s"], ["unused3", "x"], ["unused4", "x"],
    ["inventoryIcon1", "s"], ["unused6", "x"], ["unused7", "x"], ["unused8", "x"], ["unused9", "x"],
    ["unused10", "x"], ["spellVisualId", "i"], ["groupSoundId", "i"], ["unused13", "x"],
    ["unused14", "x"], ["unused15", "x"], ["unused16", "x"], ["unused17", "x"], ["unused18", "x"],
    ["unused19", "x"], ["unused20", "x"], ["unused21", "x"], ["unused22", "x"], ["unused23", "x"],
    ["unused24", "x"],
  ]),
  ItemSet: fields([
    ["id", "i"], ["name", "LOC"], ["unused2", "X_LOC"], ["spellId1", "i"], ["spellId2", "i"],
    ["spellId3", "i"], ["spellId4", "i"], ["spellId5", "i"], ["spellId6", "i"], ["spellId7", "i"],
    ["spellId8", "i"], ["itemCount1", "i"], ["itemCount2", "i"], ["itemCount3", "i"],
    ["itemCount4", "i"], ["itemCount5", "i"], ["itemCount6", "i"], ["itemCount7", "i"],
    ["itemCount8", "i"], ["reqSkillId", "i"], ["reqSkillLevel", "i"],
  ]),
  MailTemplate: fields([["id", "i"], ["subject", "LOC"], ["text", "LOC"]]),
  SkillLine: fields([
    ["Id", "i"], ["categoryId", "i"], ["unused2", "x"], ["name", "LOC"], ["description", "LOC"],
    ["spellIconId", "i"], ["alternateVerb", "LOC"], ["canLink", "i"],
  ]),
  SkillLineAbility: fields([
    ["id", "i"], ["skillLineId", "i"], ["spellId", "i"], ["raceMask", "i"], ["classMask", "i"],
    ["excludeRaceMask", "i"], ["excludeClassMask", "i"], ["minSkillLineRank", "i"], ["supercededBySpell", "i"],
    ["acquireMethod", "i"], ["trivialSkillLineRankHigh", "i"], ["trivialSkillLineRankLow", "i"],
    ["characterPoints1", "i"], ["characterPoints2", "i"],
  ]),
  SkillRaceClassInfo: fields([
    ["id", "i"], ["skillLineId", "i"], ["raceMask", "i"], ["classMask", "i"], ["flags", "i"],
    ["minLevel", "i"], ["skillTierId", "i"], ["skillCostIndex", "i"],
  ]),
  SoundEntries: fields([
    ["id", "i"], ["type", "i"], ["name", "s"], ["file1", "s"], ["file2", "s"], ["file3", "s"],
    ["file4", "s"], ["file5", "s"], ["file6", "s"], ["file7", "s"], ["file8", "s"], ["file9", "s"],
    ["file10", "s"], ["unused13", "x"], ["unused14", "x"], ["unused15", "x"], ["unused16", "x"],
    ["unused17", "x"], ["unused18", "x"], ["unused19", "x"], ["unused20", "x"], ["unused21", "x"],
    ["unused22", "x"], ["path", "s"], ["unused24", "x"], ["flags", "i"], ["unused26", "x"],
    ["unused27", "x"], ["unused28", "x"], ["unused29", "x"],
  ]),
  SpellCastTimes: fields([["id", "i"], ["baseTime", "i"], ["unused2", "x"], ["unused3", "x"]]),
  SpellDuration: fields([["id", "i"], ["baseTime", "i"], ["unused2", "x"], ["unused3", "x"]]),
  SpellIcon: fields([["id", "i"], ["iconPath", "s"]]),
  SpellRange: fields([
    ["id", "i"], ["rangeMinHostile", "f"], ["rangeMinFriend", "f"], ["rangeMaxHostile", "f"],
    ["rangeMaxFriend", "f"], ["rangeType", "i"], ["name", "LOC"], ["shortName", "X_LOC"],
  ]),
  SpellItemEnchantment: fields([
    ["id", "i"], ["charges", "i"], ["type1", "i"], ["type2", "i"], ["type3", "i"],
    ["amount1", "i"], ["amount2", "i"], ["amount3", "i"], ["unused8", "x"], ["unused9", "x"],
    ["unused10", "x"], ["object1", "i"], ["object2", "i"], ["object3", "i"], ["name", "LOC"],
    ["unused15", "x"], ["unused16", "x"], ["unused17", "x"], ["conditionId", "i"],
    ["skillLine", "i"], ["skillLevel", "i"], ["requiredLevel", "i"],
  ]),
  Talent: fields([
    ["id", "i"], ["tabId", "i"], ["row", "i"], ["column", "i"], ["rank1", "i"], ["rank2", "i"],
    ["rank3", "i"], ["rank4", "i"], ["rank5", "i"], ["unused9", "x"], ["unused10", "x"],
    ["unused11", "x"], ["unused12", "x"], ["reqTalent", "i"], ["unused14", "x"], ["unused15", "x"],
    ["reqRank", "i"], ["unused17", "x"], ["unused18", "x"], ["talentSpell", "i"],
    ["unused20", "x"], ["petCategory1", "i"], ["petCategory2", "i"],
  ]),
  TalentTab: fields([
    ["id", "i"], ["name", "LOC"], ["iconId", "i"], ["raceMask", "i"], ["classMask", "i"],
    ["creatureFamilyMask", "i"], ["tabNumber", "i"], ["textureFile", "s"],
  ]),
};

defs.Spell = fields([
  ["id", "i"], ["category", "i"], ["dispelType", "i"], ["mechanic", "i"],
  ["attributes0", "u"], ["attributes1", "u"], ["attributes2", "u"], ["attributes3", "u"],
  ["attributes4", "u"], ["attributes5", "u"], ["attributes6", "u"], ["attributes7", "u"],
  ["stanceMask", "i"], ["unused13", "x"], ["stanceMaskNot", "i"], ["unused15", "x"],
  ["targets", "i"], ["unused17", "x"], ["spellFocus", "i"], ["unused19", "x"], ["unused20", "x"],
  ["unused21", "x"], ["unused22", "x"], ["unused23", "x"], ["unused24", "x"], ["unused25", "x"],
  ["unused26", "x"], ["unused27", "x"], ["castTimeId", "i"], ["recoveryTime", "i"],
  ["recoveryTimeCategory", "i"], ["unused31", "x"], ["unused32", "x"], ["unused33", "x"],
  ["unused34", "x"], ["procChance", "i"], ["procCharges", "i"], ["maxLevel", "i"], ["baseLevel", "i"],
  ["spellLevel", "i"], ["durationId", "i"], ["powerType", "i"], ["powerCost", "i"],
  ["powerCostPerLevel", "i"], ["powerPerSecond", "i"], ["powerPerSecondPerLevel", "i"], ["rangeId", "i"],
  ["unused47", "x"], ["unused48", "x"], ["stackAmount", "i"], ["tool1", "i"], ["tool2", "i"],
  ["reagent1", "i"], ["reagent2", "i"], ["reagent3", "i"], ["reagent4", "i"], ["reagent5", "i"],
  ["reagent6", "i"], ["reagent7", "i"], ["reagent8", "i"], ["reagentCount1", "i"],
  ["reagentCount2", "i"], ["reagentCount3", "i"], ["reagentCount4", "i"], ["reagentCount5", "i"],
  ["reagentCount6", "i"], ["reagentCount7", "i"], ["reagentCount8", "i"], ["equippedItemClass", "i"],
  ["equippedItemSubClassMask", "i"], ["equippedItemInventoryTypeMask", "i"], ["effect1Id", "i"],
  ["effect2Id", "i"], ["effect3Id", "i"], ["effect1DieSides", "i"], ["effect2DieSides", "i"],
  ["effect3DieSides", "i"], ["effect1RealPointsPerLevel", "f"], ["effect2RealPointsPerLevel", "f"],
  ["effect3RealPointsPerLevel", "f"], ["effect1BasePoints", "i"], ["effect2BasePoints", "i"],
  ["effect3BasePoints", "i"], ["effect1Mechanic", "i"], ["effect2Mechanic", "i"], ["effect3Mechanic", "i"],
  ["effect1ImplicitTargetA", "i"], ["effect2ImplicitTargetA", "i"], ["effect3ImplicitTargetA", "i"],
  ["effect1ImplicitTargetB", "i"], ["effect2ImplicitTargetB", "i"], ["effect3ImplicitTargetB", "i"],
  ["effect1RadiusId", "i"], ["effect2RadiusId", "i"], ["effect3RadiusId", "i"], ["effect1AuraId", "i"],
  ["effect2AuraId", "i"], ["effect3AuraId", "i"], ["effect1Periode", "i"], ["effect2Periode", "i"],
  ["effect3Periode", "i"], ["effect1ValueMultiplier", "f"], ["effect2ValueMultiplier", "f"],
  ["effect3ValueMultiplier", "f"], ["effect1ChainTarget", "i"], ["effect2ChainTarget", "i"],
  ["effect3ChainTarget", "i"], ["effect1CreateItemId", "i"], ["effect2CreateItemId", "i"],
  ["effect3CreateItemId", "i"], ["effect1MiscValue", "i"], ["effect2MiscValue", "i"],
  ["effect3MiscValue", "i"], ["effect1MiscValueB", "i"], ["effect2MiscValueB", "i"],
  ["effect3MiscValueB", "i"], ["effect1TriggerSpell", "i"], ["effect2TriggerSpell", "i"],
  ["effect3TriggerSpell", "i"], ["effect1PointsPerComboPoint", "f"], ["effect2PointsPerComboPoint", "f"],
  ["effect3PointsPerComboPoint", "f"], ["effect1SpellClassMaskA", "i"], ["effect1SpellClassMaskB", "i"],
  ["effect1SpellClassMaskC", "i"], ["effect2SpellClassMaskA", "i"], ["effect2SpellClassMaskB", "i"],
  ["effect2SpellClassMaskC", "i"], ["effect3SpellClassMaskA", "i"], ["effect3SpellClassMaskB", "i"],
  ["effect3SpellClassMaskC", "i"], ["spellVisualId1", "i"], ["spellVisualId2", "i"], ["iconId", "i"],
  ["iconIdActive", "i"], ["unused135", "x"], ["name", "LOC"], ["rank", "LOC"], ["description", "LOC"],
  ["buff", "LOC"], ["powerCostPercent", "i"], ["startRecoveryCategory", "i"], ["startRecoveryTime", "i"],
  ["maxTargetLevel", "i"], ["spellFamilyId", "i"], ["spellFamilyFlags1", "i"], ["spellFamilyFlags2", "i"],
  ["spellFamilyFlags3", "i"], ["maxAffectedTargets", "i"], ["damageClass", "i"], ["unused150", "x"],
  ["unused151", "x"], ["effect1DamageMultiplier", "f"], ["effect2DamageMultiplier", "f"],
  ["effect3DamageMultiplier", "f"], ["unused155", "x"], ["unused156", "x"], ["unused157", "x"],
  ["toolCategory1", "i"], ["toolCategory2", "i"], ["unused160", "x"], ["schoolMask", "i"],
  ["runeCostId", "i"], ["unused163", "x"], ["powerDisplayId", "i"], ["effect1BonusMultiplier", "f"],
  ["effect2BonusMultiplier", "f"], ["effect3BonusMultiplier", "f"], ["spellDescriptionVariable", "i"],
  ["spellDifficulty", "i"],
]);

function quoteIdent(identifier: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function extractDbcFiles() {
  mkdirSync(workDir, { recursive: true });
  const script = path.join(process.cwd(), "scripts", "extract-ascension-mpq.py");
  const result = spawnSync("python", [
    script,
    "--data-dir",
    dataDir,
    "--out-dir",
    workDir,
    "--locale",
    locale,
    "--files",
    ...dbcFiles,
  ], { encoding: "utf-8", stdio: "pipe" });

  if (result.stdout.trim()) {
    console.log(result.stdout.trim());
  }
  if (result.stderr.trim()) {
    console.warn(result.stderr.trim());
  }
  if (result.status !== 0) {
    throw new Error(`MPQ extraction failed with exit code ${result.status}`);
  }
}

function extractLuaFiles() {
  mkdirSync(luaWorkDir, { recursive: true });
  const script = path.join(process.cwd(), "scripts", "extract-ascension-mpq.py");
  const result = spawnSync("python", [
    script,
    "--data-dir",
    dataDir,
    "--out-dir",
    luaWorkDir,
    "--locale",
    locale,
    "--raw-files",
    ...luaFiles,
  ], { encoding: "utf-8", stdio: "pipe" });

  if (result.stdout.trim()) {
    console.log(result.stdout.trim());
  }
  if (result.stderr.trim()) {
    console.warn(result.stderr.trim());
  }
  if (result.status !== 0) {
    throw new Error(`Lua extraction failed with exit code ${result.status}`);
  }
}

function extractIconFiles(iconNames: string[]) {
  const uniqueIconNames = Array.from(new Set(iconNames.filter(Boolean).map((name) => name.toLowerCase()))).sort();
  if (uniqueIconNames.length === 0 || process.env.ASCENSION_EXTRACT_ICONS === "0") {
    return;
  }

  mkdirSync(path.dirname(iconListFile), { recursive: true });
  mkdirSync(iconOutDir, { recursive: true });
  writeFileSync(iconListFile, `${uniqueIconNames.join("\n")}\n`, "utf-8");

  const script = path.join(process.cwd(), "scripts", "extract-ascension-mpq.py");
  const result = spawnSync("python", [
    script,
    "--data-dir",
    dataDir,
    "--out-dir",
    workDir,
    "--locale",
    locale,
    "--icon-list-file",
    iconListFile,
    "--icons-out-dir",
    iconOutDir,
  ], { encoding: "utf-8", stdio: "pipe" });

  if (result.stdout.trim()) {
    console.log(result.stdout.trim());
  }
  if (result.stderr.trim()) {
    console.warn(result.stderr.trim());
  }
  if (result.status !== 0) {
    throw new Error(`Icon extraction failed with exit code ${result.status}`);
  }
}

function readCString(block: Buffer, offset: number) {
  if (offset <= 0 || offset >= block.length) {
    return "";
  }

  const end = block.indexOf(0, offset);
  return block.toString("utf8", offset, end === -1 ? block.length : end);
}

function dbcPath(name: string) {
  return path.join(workDir, name.endsWith(".dbc") ? name : `${name}.dbc`);
}

function readDbc(name: string) {
  const file = dbcPath(name);
  if (!existsSync(file)) {
    return [];
  }

  const key = name.replace(/\.dbc$/i, "");
  const definition = defs[key];
  if (!definition) {
    throw new Error(`No DBC definition registered for ${key}.`);
  }

  const data = readFileSync(file);
  if (data.toString("ascii", 0, 4) !== "WDBC") {
    throw new Error(`${name} is not a WDBC file.`);
  }

  const rowCount = data.readUInt32LE(4);
  const fieldCount = data.readUInt32LE(8);
  const recordSize = data.readUInt32LE(12);
  const stringBlockSize = data.readUInt32LE(16);
  const expectedSize = definition.reduce((sum, field) => sum + (field.type === "b" || field.type === "X" ? 1 : 4), 0);

  if (fieldCount !== definition.length || recordSize !== expectedSize) {
    throw new Error(`${name} shape mismatch: DBC has ${fieldCount} fields/${recordSize} bytes, importer expects ${definition.length}/${expectedSize}.`);
  }

  const rows: DbcRow[] = [];
  const recordsOffset = 20;
  const strings = data.subarray(recordsOffset + rowCount * recordSize, recordsOffset + rowCount * recordSize + stringBlockSize);

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row: DbcRow = {};
    let offset = recordsOffset + rowIndex * recordSize;

    for (const field of definition) {
      if (field.type === "x") {
        offset += 4;
        continue;
      }
      if (field.type === "X") {
        offset += 1;
        continue;
      }

      if (field.type === "b") {
        row[field.name] = data.readUInt8(offset);
        offset += 1;
      } else if (field.type === "f") {
        row[field.name] = Number(data.readFloatLE(offset).toFixed(4));
        offset += 4;
      } else if (field.type === "s") {
        row[field.name] = readCString(strings, data.readUInt32LE(offset));
        offset += 4;
      } else if (field.type === "u") {
        const unsigned = data.readUInt32LE(offset);
        row[field.name] = unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
        offset += 4;
      } else {
        row[field.name] = data.readInt32LE(offset);
        offset += 4;
      }
    }

    rows.push(row);
  }

  return rows;
}

function byId(rows: DbcRow[]) {
  return new Map(rows.map((row) => [Number(row.id ?? row.Id), row]));
}

function basenameIcon(value: DbcValue) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").pop()?.replace(/\.(blp|png)$/i, "").toLowerCase() ?? "";
}

function numberValue(value: DbcValue) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function maskBit(id: number) {
  if (id <= 0 || id > 32) {
    return 0;
  }

  const bit = 2 ** (id - 1);
  return bit > 0x7fffffff ? bit - 0x100000000 : bit;
}

function stringValue(value: DbcValue) {
  return typeof value === "string" ? value : "";
}

function normalizeLookup(value: DbcValue) {
  return stringValue(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function titleFromToken(value: DbcValue) {
  return stringValue(value)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function loc(row: DbcRow, prefix: string, id?: number) {
  const value = stringValue(row[`${prefix}_loc0`]);
  return value || (id ? `${prefix === "name" ? "Record" : prefix} #${id}` : "");
}

function localizedName(row: DbcRow, prefix: string, fallback = "") {
  for (const suffix of ["loc0", "loc2", "loc3", "loc4", "loc6", "loc8"]) {
    const value = stringValue(row[`${prefix}_${suffix}`]);
    if (value) {
      return value;
    }
  }

  return fallback;
}

function stripLuaComments(source: string) {
  return source.replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--.*$/gm, "");
}

function luaPath(relativePath: string) {
  return path.join(luaWorkDir, ...relativePath.split("\\"));
}

function readLua(relativePath: string) {
  const file = luaPath(relativePath);
  return existsSync(file) ? readFileSync(file, "utf-8") : "";
}

function extractLuaTable(source: string, name: string) {
  const stripped = stripLuaComments(source);
  const match = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*\\{`).exec(stripped);
  if (!match) {
    return "";
  }

  const start = match.index + match[0].lastIndexOf("{");
  let depth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let index = start; index < stripped.length; index += 1) {
    const char = stripped[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return stripped.slice(start + 1, index);
      }
    }
  }

  return "";
}

function parseStringArray(block: string) {
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function parseNumberArray(block: string) {
  return [...block.matchAll(/\b\d+\b/g)].map((match) => Number(match[0]));
}

function parseKeyStringMap(block: string) {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/\["([^"]+)"\]\s*=\s*"([^"]*)"/g)) {
    map.set(match[1], match[2]);
  }
  return map;
}

function parseKeyPrimaryStatMap(block: string) {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/\["([^"]+)"\]\s*=\s*Enum\.PrimaryStat\.([A-Za-z]+)/g)) {
    map.set(match[1], match[2]);
  }
  return map;
}

function parseKeyNumberMap(block: string) {
  const map = new Map<string, number>();
  for (const match of block.matchAll(/\b([A-Z][A-Z0-9_]*)\s*=\s*(0x[0-9a-fA-F]+|\d+)/g)) {
    map.set(match[1], Number.parseInt(match[2], match[2].startsWith("0x") ? 16 : 10));
  }
  return map;
}

function parseNestedStringMap(block: string) {
  const map = new Map<string, Map<string, string>>();
  for (const match of block.matchAll(/\["([^"]+)"\]\s*=\s*\{([\s\S]*?)\}/g)) {
    map.set(match[1], parseKeyStringMap(match[2]));
  }
  return map;
}

function parseNestedStringArrayMap(block: string) {
  const map = new Map<string, string[]>();
  for (const match of block.matchAll(/\["([^"]+)"\]\s*=\s*\{([\s\S]*?)\}/g)) {
    map.set(match[1], parseStringArray(match[2]));
  }
  return map;
}

function parseAtlasMap(source: string, prefix: "spec-thumbnail" | "talents-background") {
  const map = new Map<string, string>();
  const pattern = new RegExp(`\\["(${prefix}-([a-z0-9]+)-([a-z0-9]+))"\\]`, "gi");
  for (const match of source.matchAll(pattern)) {
    map.set(`${match[2].toUpperCase()}:${match[3].toUpperCase()}`, match[1]);
  }
  return map;
}

function buildLuaClientData() {
  const constants = readLua("Interface\\FrameXML\\Constants.lua");
  const sharedConstants = readLua("Interface\\SharedXML\\SharedConstants.lua");
  const enumLua = readLua("Interface\\SharedXML\\Enum.lua");
  const atlasInfo = readLua("Interface\\SharedXML\\AtlasInfo.lua");
  const advancementData = readLua("Interface\\FrameXML\\Data\\CharacterAdvancement.lua");

  const classIds = parseKeyNumberMap(extractLuaTable(enumLua, "Enum.Class"));
  const classMasks = parseKeyNumberMap(extractLuaTable(enumLua, "Enum.ClassMask"));
  const classAliases = new Map<string, string>();
  for (const [rawName, classToken] of parseKeyStringMap(advancementData)) {
    if (classIds.has(classToken) && rawName !== "General" && !rawName.startsWith("Reborn")) {
      classAliases.set(classToken, titleFromToken(rawName));
    }
  }

  return {
    classOrder: parseStringArray(extractLuaTable(sharedConstants, "CLASS_SORT_ORDER")),
    baseClassSpecOrder: parseNestedStringArrayMap(extractLuaTable(constants, "CHARACTER_ADVANCEMENT_CLASS_SPEC_ORDER")),
    localizedSpecs: parseNestedStringMap(extractLuaTable(sharedConstants, "LOCALIZED_CLASS_SPEC_NAMES")),
    specIcons: parseKeyStringMap(extractLuaTable(sharedConstants, "SPEC_ICONS")),
    classPrimaryStat: parseKeyPrimaryStatMap(extractLuaTable(sharedConstants, "CLASS_PRIMARY_STAT")),
    specPrimaryStat: parseKeyPrimaryStatMap(extractLuaTable(sharedConstants, "SPEC_PRIMARY_STAT")),
    classIds,
    classMasks,
    classAliases,
    specSwapSpellIds: parseNumberArray(extractLuaTable(constants, "SPEC_SWAP_SPELLS")),
    thumbnails: parseAtlasMap(atlasInfo, "spec-thumbnail"),
    backgrounds: parseAtlasMap(atlasInfo, "talents-background"),
  };
}

function ownerRow(
  spellId: number,
  owner: DbcRow | undefined,
  source: string,
  extra: DbcRow = {},
) {
  if (!spellId || !owner || !numberValue(owner.ownerClassId ?? owner.classId)) {
    return null;
  }

  return {
    spellId,
    ownerClassId: numberValue(owner.ownerClassId ?? owner.classId),
    ownerClassName: stringValue(owner.ownerClassName ?? owner.className),
    ownerSpecId: numberValue(owner.ownerSpecId ?? owner.id),
    ownerSpecName: stringValue(owner.ownerSpecName ?? owner.name),
    ownerSpecSkillId: numberValue(owner.ownerSpecSkillId ?? owner.skillLineId),
    source,
    ...extra,
  };
}

async function getColumns(client: PoolClient, table: string) {
  const result = await client.query<ColumnInfo>(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [targetSchema, table],
  );

  if (result.rowCount === 0) {
    throw new Error(`Missing target table ${targetSchema}.${table}. Run pnpm game:schema first.`);
  }

  return result.rows;
}

function defaultFor(column: ColumnInfo): DbcValue {
  if (column.is_nullable === "YES") {
    return null;
  }
  if (["character varying", "text"].includes(column.data_type)) {
    return "";
  }
  if (column.data_type === "real" || column.data_type === "double precision" || column.data_type === "numeric") {
    return 0;
  }

  return 0;
}

function coerceForColumn(value: DbcValue | undefined, column: ColumnInfo | undefined): DbcValue {
  const next = value ?? (column ? defaultFor(column) : null);
  if (!column || typeof next !== "number") {
    return next;
  }

  if (["smallint", "integer", "bigint"].includes(column.data_type)) {
    return Math.trunc(next);
  }

  return next;
}

async function insertRows(client: PoolClient, table: string, rows: DbcRow[], desiredColumns: string[]) {
  if (rows.length === 0) {
    return;
  }

  const allColumns = await getColumns(client, table);
  const columnNames = new Set(allColumns.map((column) => column.column_name));
  const required = allColumns
    .filter((column) => column.is_nullable === "NO" && column.column_default === null)
    .map((column) => column.column_name);
  const columns = Array.from(new Set([...required, ...desiredColumns])).filter((column) => columnNames.has(column));
  const columnInfo = new Map(allColumns.map((column) => [column.column_name, column]));
  const maxRows = Math.max(1, Math.floor(60000 / columns.length));

  for (let start = 0; start < rows.length; start += maxRows) {
    const chunk = rows.slice(start, start + maxRows);
    const values: DbcValue[] = [];
    const groups = chunk.map((row, rowIndex) => {
      const placeholders = columns.map((column, columnIndex) => {
        const info = columnInfo.get(column);
        values.push(coerceForColumn(row[column], info));
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(", ")})`;
    });

    await client.query(
      `INSERT INTO ${quoteIdent(targetSchema)}.${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) VALUES ${groups.join(", ")}`,
      values,
    );
  }

  console.log(`${table}: ${rows.length}`);
}

async function ensureAscensionHelperTables(client: PoolClient) {
  const schema = quoteIdent(targetSchema);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_character_advancement_class_types (
      id integer NOT NULL,
      token text NOT NULL DEFAULT '',
      "rawClassId" integer NOT NULL DEFAULT 0,
      name text NOT NULL DEFAULT '',
      "classId" integer NOT NULL DEFAULT 0,
      "className" text NOT NULL DEFAULT '',
      "classToken" text NOT NULL DEFAULT ''
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_character_advancement_tab_types (
      id integer NOT NULL,
      name text NOT NULL DEFAULT '',
      label text NOT NULL DEFAULT '',
      "ownerClassId" integer NOT NULL DEFAULT 0,
      "ownerClassName" text NOT NULL DEFAULT '',
      "ownerSpecId" integer NOT NULL DEFAULT 0,
      "ownerSpecName" text NOT NULL DEFAULT '',
      "ownerSpecSkillId" integer NOT NULL DEFAULT 0
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_chr_specs (
      id integer NOT NULL,
      "classId" integer NOT NULL DEFAULT 0,
      "className" text NOT NULL DEFAULT '',
      "classFileString" text NOT NULL DEFAULT '',
      "classToken" text NOT NULL DEFAULT '',
      "specToken" text NOT NULL DEFAULT '',
      name text NOT NULL DEFAULT '',
      description text NOT NULL DEFAULT '',
      icon text NOT NULL DEFAULT '',
      "iconId" integer NOT NULL DEFAULT 0,
      "primarySpellId" integer NOT NULL DEFAULT 0,
      "primarySpellName" text NOT NULL DEFAULT '',
      "secondarySpellId" integer NOT NULL DEFAULT 0,
      "secondarySpellName" text NOT NULL DEFAULT '',
      "passiveSpellId" integer NOT NULL DEFAULT 0,
      "passiveSpellName" text NOT NULL DEFAULT '',
      "advancementId" integer NOT NULL DEFAULT 0,
      "skillLineId" integer NOT NULL DEFAULT 0,
      "skillLineName" text NOT NULL DEFAULT '',
      "orderIndex" integer NOT NULL DEFAULT 0,
      role integer NOT NULL DEFAULT 0
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_coa_specs (
      id integer NOT NULL,
      "classId" integer NOT NULL DEFAULT 0,
      "classToken" text NOT NULL DEFAULT '',
      "className" text NOT NULL DEFAULT '',
      "classMask" bigint NOT NULL DEFAULT 0,
      "classOrder" integer NOT NULL DEFAULT 0,
      "specToken" text NOT NULL DEFAULT '',
      name text NOT NULL DEFAULT '',
      "specOrder" integer NOT NULL DEFAULT 0,
      "primaryStat" text NOT NULL DEFAULT '',
      icon text NOT NULL DEFAULT '',
      "iconId" integer NOT NULL DEFAULT 0,
      "skillLineId" integer NOT NULL DEFAULT 0,
      "skillLineName" text NOT NULL DEFAULT '',
      "thumbnailAtlas" text NOT NULL DEFAULT '',
      "backgroundAtlas" text NOT NULL DEFAULT '',
      source text NOT NULL DEFAULT ''
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_specialization_slots (
      id integer NOT NULL,
      "spellId" integer NOT NULL DEFAULT 0,
      "spellName" text NOT NULL DEFAULT '',
      "iconId" integer NOT NULL DEFAULT 0,
      source text NOT NULL DEFAULT ''
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_character_advancement (
      id integer NOT NULL,
      type text NOT NULL DEFAULT '',
      "parentId" integer NOT NULL DEFAULT 0,
      "groupId" integer NOT NULL DEFAULT 0,
      "spellId" integer NOT NULL DEFAULT 0,
      "rank2SpellId" integer NOT NULL DEFAULT 0,
      "rank3SpellId" integer NOT NULL DEFAULT 0,
      "rank4SpellId" integer NOT NULL DEFAULT 0,
      "rank5SpellId" integer NOT NULL DEFAULT 0,
      name text NOT NULL DEFAULT '',
      icon text NOT NULL DEFAULT '',
      prerequisite text NOT NULL DEFAULT '',
      "levelRequired1" integer NOT NULL DEFAULT 0,
      "levelRequired2" integer NOT NULL DEFAULT 0,
      "levelRequired3" integer NOT NULL DEFAULT 0,
      row integer NOT NULL DEFAULT 0,
      col integer NOT NULL DEFAULT 0,
      "classTypeId" integer NOT NULL DEFAULT 0,
      "tabTypeId" integer NOT NULL DEFAULT 0,
      "tabName" text NOT NULL DEFAULT '',
      anchor text NOT NULL DEFAULT '',
      color text NOT NULL DEFAULT '',
      shape text NOT NULL DEFAULT '',
      "ownerClassId" integer NOT NULL DEFAULT 0,
      "ownerClassName" text NOT NULL DEFAULT '',
      "ownerSpecId" integer NOT NULL DEFAULT 0,
      "ownerSpecName" text NOT NULL DEFAULT '',
      "ownerSpecSkillId" integer NOT NULL DEFAULT 0
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_talent_tree_tabs (
      id text NOT NULL,
      "treeKey" text NOT NULL DEFAULT '',
      "treeType" text NOT NULL DEFAULT '',
      "ownerClassId" integer NOT NULL DEFAULT 0,
      "ownerClassName" text NOT NULL DEFAULT '',
      "ownerSpecId" integer NOT NULL DEFAULT 0,
      "ownerSpecName" text NOT NULL DEFAULT '',
      "ownerSpecSkillId" integer NOT NULL DEFAULT 0,
      "tabTypeId" integer NOT NULL DEFAULT 0,
      "tabName" text NOT NULL DEFAULT '',
      "orderIndex" integer NOT NULL DEFAULT 0,
      "backgroundAtlas" text NOT NULL DEFAULT '',
      source text NOT NULL DEFAULT ''
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_talent_tree_nodes (
      id integer NOT NULL,
      "treeKey" text NOT NULL DEFAULT '',
      "treeType" text NOT NULL DEFAULT '',
      "ownerClassId" integer NOT NULL DEFAULT 0,
      "ownerClassName" text NOT NULL DEFAULT '',
      "ownerSpecId" integer NOT NULL DEFAULT 0,
      "ownerSpecName" text NOT NULL DEFAULT '',
      "ownerSpecSkillId" integer NOT NULL DEFAULT 0,
      "tabTypeId" integer NOT NULL DEFAULT 0,
      "tabName" text NOT NULL DEFAULT '',
      type text NOT NULL DEFAULT '',
      "parentId" integer NOT NULL DEFAULT 0,
      "groupId" integer NOT NULL DEFAULT 0,
      row integer NOT NULL DEFAULT 0,
      col integer NOT NULL DEFAULT 0,
      name text NOT NULL DEFAULT '',
      icon text NOT NULL DEFAULT '',
      "iconId" integer NOT NULL DEFAULT 0,
      "maxRanks" integer NOT NULL DEFAULT 0,
      "spellId" integer NOT NULL DEFAULT 0,
      "allSpellIds" text NOT NULL DEFAULT '',
      prerequisite text NOT NULL DEFAULT '',
      anchor text NOT NULL DEFAULT '',
      color text NOT NULL DEFAULT '',
      shape text NOT NULL DEFAULT '',
      source text NOT NULL DEFAULT ''
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_talent_tree_node_ranks (
      id text NOT NULL,
      "advancementId" integer NOT NULL DEFAULT 0,
      rank integer NOT NULL DEFAULT 0,
      "spellId" integer NOT NULL DEFAULT 0,
      "spellName" text NOT NULL DEFAULT '',
      "iconId" integer NOT NULL DEFAULT 0,
      "treeKey" text NOT NULL DEFAULT '',
      "treeType" text NOT NULL DEFAULT '',
      "ownerClassId" integer NOT NULL DEFAULT 0,
      "ownerSpecId" integer NOT NULL DEFAULT 0,
      "ownerSpecSkillId" integer NOT NULL DEFAULT 0,
      "tabTypeId" integer NOT NULL DEFAULT 0
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_skill_line_abilities (
      id integer NOT NULL,
      "skillLineId" integer NOT NULL DEFAULT 0,
      "skillLineName" text NOT NULL DEFAULT '',
      "spellId" integer NOT NULL DEFAULT 0,
      "spellName" text NOT NULL DEFAULT '',
      "iconId" integer NOT NULL DEFAULT 0,
      "raceMask" integer NOT NULL DEFAULT 0,
      "classMask" integer NOT NULL DEFAULT 0,
      "excludeRaceMask" integer NOT NULL DEFAULT 0,
      "excludeClassMask" integer NOT NULL DEFAULT 0,
      "minSkillLineRank" integer NOT NULL DEFAULT 0,
      "supercededBySpell" integer NOT NULL DEFAULT 0,
      "acquireMethod" integer NOT NULL DEFAULT 0,
      "trivialSkillLineRankHigh" integer NOT NULL DEFAULT 0,
      "trivialSkillLineRankLow" integer NOT NULL DEFAULT 0,
      "characterPoints1" integer NOT NULL DEFAULT 0,
      "characterPoints2" integer NOT NULL DEFAULT 0,
      "ownerClassId" integer NOT NULL DEFAULT 0,
      "ownerClassName" text NOT NULL DEFAULT '',
      "ownerSpecId" integer NOT NULL DEFAULT 0,
      "ownerSpecName" text NOT NULL DEFAULT '',
      "ownerSpecSkillId" integer NOT NULL DEFAULT 0
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.aowow_spell_owners (
      "spellId" integer NOT NULL DEFAULT 0,
      "ownerClassId" integer NOT NULL DEFAULT 0,
      "ownerClassName" text NOT NULL DEFAULT '',
      "ownerSpecId" integer NOT NULL DEFAULT 0,
      "ownerSpecName" text NOT NULL DEFAULT '',
      "ownerSpecSkillId" integer NOT NULL DEFAULT 0,
      "sourceId" integer NOT NULL DEFAULT 0,
      "sourceRank" integer NOT NULL DEFAULT 0,
      "skillLineId" integer NOT NULL DEFAULT 0,
      "acquireMethod" integer NOT NULL DEFAULT 0,
      "minSkillLineRank" integer NOT NULL DEFAULT 0,
      "raceMask" integer NOT NULL DEFAULT 0,
      "classMask" integer NOT NULL DEFAULT 0,
      source text NOT NULL DEFAULT ''
    );
  `);

  const additiveColumns: Array<[string, string, string]> = [
    ["aowow_chr_specs", "classFileString", "text NOT NULL DEFAULT ''"],
    ["aowow_chr_specs", "iconId", "integer NOT NULL DEFAULT 0"],
    ["aowow_chr_specs", "primarySpellName", "text NOT NULL DEFAULT ''"],
    ["aowow_chr_specs", "secondarySpellName", "text NOT NULL DEFAULT ''"],
    ["aowow_chr_specs", "passiveSpellName", "text NOT NULL DEFAULT ''"],
    ["aowow_chr_specs", "skillLineName", "text NOT NULL DEFAULT ''"],
    ["aowow_coa_specs", "classMask", "bigint NOT NULL DEFAULT 0"],
    ["aowow_coa_specs", "classOrder", "integer NOT NULL DEFAULT 0"],
    ["aowow_coa_specs", "primaryStat", "text NOT NULL DEFAULT ''"],
    ["aowow_coa_specs", "iconId", "integer NOT NULL DEFAULT 0"],
    ["aowow_coa_specs", "skillLineId", "integer NOT NULL DEFAULT 0"],
    ["aowow_coa_specs", "skillLineName", "text NOT NULL DEFAULT ''"],
    ["aowow_coa_specs", "thumbnailAtlas", "text NOT NULL DEFAULT ''"],
    ["aowow_coa_specs", "backgroundAtlas", "text NOT NULL DEFAULT ''"],
    ["aowow_specialization_slots", "spellName", "text NOT NULL DEFAULT ''"],
    ["aowow_specialization_slots", "iconId", "integer NOT NULL DEFAULT 0"],
    ["aowow_specialization_slots", "source", "text NOT NULL DEFAULT ''"],
    ["aowow_spell_owners", "sourceId", "integer NOT NULL DEFAULT 0"],
    ["aowow_spell_owners", "sourceRank", "integer NOT NULL DEFAULT 0"],
    ["aowow_spell_owners", "skillLineId", "integer NOT NULL DEFAULT 0"],
    ["aowow_spell_owners", "acquireMethod", "integer NOT NULL DEFAULT 0"],
    ["aowow_spell_owners", "minSkillLineRank", "integer NOT NULL DEFAULT 0"],
    ["aowow_spell_owners", "raceMask", "integer NOT NULL DEFAULT 0"],
    ["aowow_spell_owners", "classMask", "integer NOT NULL DEFAULT 0"],
    ["aowow_talent_tree_tabs", "backgroundAtlas", "text NOT NULL DEFAULT ''"],
    ["aowow_talent_tree_nodes", "iconId", "integer NOT NULL DEFAULT 0"],
    ["aowow_talent_tree_nodes", "allSpellIds", "text NOT NULL DEFAULT ''"],
    ["aowow_talent_tree_node_ranks", "spellName", "text NOT NULL DEFAULT ''"],
    ["aowow_talent_tree_node_ranks", "iconId", "integer NOT NULL DEFAULT 0"],
  ];

  for (const [table, column, definition] of additiveColumns) {
    await client.query(`
      ALTER TABLE ${schema}.${quoteIdent(table)}
      ADD COLUMN IF NOT EXISTS ${quoteIdent(column)} ${definition}
    `);
  }

  const indexes = [
    `CREATE INDEX IF NOT EXISTS aowow_chr_specs_class_idx ON ${schema}.aowow_chr_specs ("classId")`,
    `CREATE INDEX IF NOT EXISTS aowow_chr_specs_skill_idx ON ${schema}.aowow_chr_specs ("skillLineId")`,
    `CREATE INDEX IF NOT EXISTS aowow_coa_specs_class_idx ON ${schema}.aowow_coa_specs ("classId")`,
    `CREATE INDEX IF NOT EXISTS aowow_coa_specs_skill_idx ON ${schema}.aowow_coa_specs ("skillLineId")`,
    `CREATE INDEX IF NOT EXISTS aowow_specialization_slots_spell_idx ON ${schema}.aowow_specialization_slots ("spellId")`,
    `CREATE INDEX IF NOT EXISTS aowow_character_advancement_owner_idx ON ${schema}.aowow_character_advancement ("ownerClassId", "ownerSpecId")`,
    `CREATE INDEX IF NOT EXISTS aowow_character_advancement_spell_idx ON ${schema}.aowow_character_advancement ("spellId")`,
    `CREATE INDEX IF NOT EXISTS aowow_talent_tree_tabs_owner_idx ON ${schema}.aowow_talent_tree_tabs ("ownerClassId", "ownerSpecId")`,
    `CREATE INDEX IF NOT EXISTS aowow_talent_tree_nodes_tree_idx ON ${schema}.aowow_talent_tree_nodes ("treeKey", row, col)`,
    `CREATE INDEX IF NOT EXISTS aowow_talent_tree_nodes_spell_idx ON ${schema}.aowow_talent_tree_nodes ("spellId")`,
    `CREATE INDEX IF NOT EXISTS aowow_talent_tree_node_ranks_spell_idx ON ${schema}.aowow_talent_tree_node_ranks ("spellId")`,
    `CREATE INDEX IF NOT EXISTS aowow_talent_tree_node_ranks_node_idx ON ${schema}.aowow_talent_tree_node_ranks ("advancementId", rank)`,
    `CREATE INDEX IF NOT EXISTS aowow_skill_line_abilities_owner_idx ON ${schema}.aowow_skill_line_abilities ("ownerClassId", "ownerSpecId")`,
    `CREATE INDEX IF NOT EXISTS aowow_skill_line_abilities_spell_idx ON ${schema}.aowow_skill_line_abilities ("spellId")`,
    `CREATE INDEX IF NOT EXISTS aowow_spell_owners_spell_idx ON ${schema}.aowow_spell_owners ("spellId")`,
    `CREATE INDEX IF NOT EXISTS aowow_spell_owners_owner_idx ON ${schema}.aowow_spell_owners ("ownerClassId", "ownerSpecId")`,
  ];

  for (const indexSql of indexes) {
    await client.query(indexSql);
  }
}

async function requireEmptyTables(client: PoolClient, tables: string[]) {
  // The standalone research package only bootstraps empty databases.
  // Lock against concurrent inserts before checking; never delete prior overlays.
  await client.query(`LOCK TABLE ${tables.map((table) => `${quoteIdent(targetSchema)}.${quoteIdent(table)}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
  for (const table of tables) {
    const result = await client.query(`SELECT 1 FROM ${quoteIdent(targetSchema)}.${quoteIdent(table)} LIMIT 1`);
    if (result.rowCount) {
      throw new Error(`Refusing to replace populated table ${targetSchema}.${table}. Use a new research database for a base client import.`);
    }
  }
}

async function widenAscensionColumns(client: PoolClient, tables: string[]) {
  const smallints = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = ANY($2)
       AND data_type = 'smallint'
     ORDER BY table_name, ordinal_position`,
    [targetSchema, tables],
  );

  for (const row of smallints.rows) {
    await client.query(
      `ALTER TABLE ${quoteIdent(targetSchema)}.${quoteIdent(row.table_name)}
       ALTER COLUMN ${quoteIdent(row.column_name)} TYPE integer`,
    );
  }

  const varchars = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = ANY($2)
       AND data_type = 'character varying'
     ORDER BY table_name, ordinal_position`,
    [targetSchema, tables],
  );

  for (const row of varchars.rows) {
    await client.query(
      `ALTER TABLE ${quoteIdent(targetSchema)}.${quoteIdent(row.table_name)}
       ALTER COLUMN ${quoteIdent(row.column_name)} TYPE text`,
    );
  }

  if (smallints.rowCount || varchars.rowCount) {
    console.log(
      `Widened ${smallints.rowCount} smallint and ${varchars.rowCount} varchar columns for Ascension client data.`,
    );
  }
}

function passthrough(row: DbcRow, names: string[]) {
  const result: DbcRow = {};
  for (const name of names) {
    result[name] = row[name] ?? 0;
  }
  return result;
}

const talentRankFields = ["spellId", "rank2SpellId", "rank3SpellId", "rank4SpellId", "rank5SpellId"] as const;

function isClassTalentTree(row: DbcRow) {
  const tabName = normalizeLookup(row.tabName);
  const className = normalizeLookup(row.ownerClassName);
  return (
    tabName === "class" ||
    tabName === "general" ||
    (className !== "" && (tabName === className || tabName === `${className}class`)) ||
    (!numberValue(row.ownerSpecId) && !numberValue(row.ownerSpecSkillId))
  );
}

function talentTreeKey(row: DbcRow) {
  const classId = numberValue(row.ownerClassId);
  if (isClassTalentTree(row)) {
    return `class:${classId}`;
  }

  return `spec:${classId}:${numberValue(row.ownerSpecSkillId) || numberValue(row.ownerSpecId) || numberValue(row.tabTypeId)}`;
}

function buildTalentTreeTables(
  advancementRows: DbcRow[],
  iconIdByName: Map<string, number>,
  spellName: (spellId: number) => string,
  spellIconId: (spellId: number) => number,
) {
  const tabRowsById = new Map<string, DbcRow>();
  const nodeRows: DbcRow[] = [];
  const rankRows: DbcRow[] = [];

  for (const row of advancementRows) {
    const classId = numberValue(row.ownerClassId);
    if (!classId) {
      continue;
    }

    const rankSpellIds = talentRankFields
      .map((field) => numberValue(row[field]))
      .filter((spellId) => spellId > 0);
    const firstSpellId = rankSpellIds[0] ?? 0;
    const treeType = isClassTalentTree(row) ? "class" : "spec";
    const treeKey = talentTreeKey(row);
    const tabId = `${treeKey}:${numberValue(row.tabTypeId)}`;

    if (!tabRowsById.has(tabId)) {
      tabRowsById.set(tabId, {
        id: tabId,
        treeKey,
        treeType,
        ownerClassId: classId,
        ownerClassName: stringValue(row.ownerClassName),
        ownerSpecId: treeType === "spec" ? numberValue(row.ownerSpecId) : 0,
        ownerSpecName: treeType === "spec" ? stringValue(row.ownerSpecName) : "",
        ownerSpecSkillId: treeType === "spec" ? numberValue(row.ownerSpecSkillId) : 0,
        tabTypeId: numberValue(row.tabTypeId),
        tabName: stringValue(row.tabName),
        orderIndex: numberValue(row.tabTypeId),
        backgroundAtlas: "",
        source: "character_advancement",
      });
    }

    const iconName = basenameIcon(row.icon);
    const iconId = (iconName ? iconIdByName.get(iconName.toLowerCase()) ?? 0 : 0) || spellIconId(firstSpellId);
    nodeRows.push({
      id: numberValue(row.id),
      treeKey,
      treeType,
      ownerClassId: classId,
      ownerClassName: stringValue(row.ownerClassName),
      ownerSpecId: treeType === "spec" ? numberValue(row.ownerSpecId) : 0,
      ownerSpecName: treeType === "spec" ? stringValue(row.ownerSpecName) : "",
      ownerSpecSkillId: treeType === "spec" ? numberValue(row.ownerSpecSkillId) : 0,
      tabTypeId: numberValue(row.tabTypeId),
      tabName: stringValue(row.tabName),
      type: stringValue(row.type),
      parentId: numberValue(row.parentId),
      groupId: numberValue(row.groupId),
      row: numberValue(row.row),
      col: numberValue(row.col),
      name: stringValue(row.name) || spellName(firstSpellId),
      icon: stringValue(row.icon),
      iconId,
      maxRanks: rankSpellIds.length || 1,
      spellId: firstSpellId,
      allSpellIds: rankSpellIds.join(","),
      prerequisite: stringValue(row.prerequisite),
      anchor: stringValue(row.anchor),
      color: stringValue(row.color),
      shape: stringValue(row.shape),
      source: "character_advancement",
    });

    for (let index = 0; index < rankSpellIds.length; index += 1) {
      const spellId = rankSpellIds[index];
      rankRows.push({
        id: `${numberValue(row.id)}:${index + 1}`,
        advancementId: numberValue(row.id),
        rank: index + 1,
        spellId,
        spellName: spellName(spellId),
        iconId: spellIconId(spellId),
        treeKey,
        treeType,
        ownerClassId: classId,
        ownerSpecId: treeType === "spec" ? numberValue(row.ownerSpecId) : 0,
        ownerSpecSkillId: treeType === "spec" ? numberValue(row.ownerSpecSkillId) : 0,
        tabTypeId: numberValue(row.tabTypeId),
      });
    }
  }

  return {
    tabRows: [...tabRowsById.values()],
    nodeRows,
    rankRows,
  };
}

async function main() {
  if (!connectionString) {
    throw new Error("GAME_DATABASE_URL or DATABASE_URL must be set.");
  }

  const history = await startImportJob({
    connectionString,
    type: "game:import-ascension",
    source: dataDir,
    metadata: {
      locale,
      targetSchema,
      dataDir,
      extractIcons: process.env.ASCENSION_EXTRACT_ICONS === "0" ? false : true,
    },
  });

  try {
    console.log(`Extracting Ascension client DBCs from ${dataDir}`);
    await history.log("INFO", "Starting Ascension client data import.", { dataDir, locale, targetSchema });
    extractDbcFiles();
    console.log(`Extracting Ascension client Lua from ${dataDir}`);
    extractLuaFiles();
    const luaData = buildLuaClientData();

  const ach = readDbc("Achievement");
  const achCat = readDbc("Achievement_Category");
  const areas = readDbc("AreaTable");
  const charBaseInfo = readDbc("CharBaseInfo");
  const characterAdvancement = readDbc("CharacterAdvancement");
  const characterAdvancementClassTypes = byId(readDbc("CharacterAdvancementClassTypes"));
  const characterAdvancementTabTypes = byId(readDbc("CharacterAdvancementTabTypes"));
  const classes = readDbc("ChrClasses");
  const chrSpecs = readDbc("ChrSpecs");
  const races = readDbc("ChrRaces");
  const titles = readDbc("CharTitles");
  const creatureFamilies = readDbc("CreatureFamily");
  const currencies = readDbc("CurrencyTypes");
  const emotes = readDbc("Emotes");
  const factions = readDbc("Faction");
  const items = readDbc("Item");
  const itemDisplays = byId(readDbc("ItemDisplayInfo"));
  const itemSets = readDbc("ItemSet");
  const mails = readDbc("MailTemplate");
  const skills = readDbc("SkillLine");
  const skillLineAbilities = readDbc("SkillLineAbility");
  const sounds = readDbc("SoundEntries");
  const spells = readDbc("Spell");
  const spellCastTimes = byId(readDbc("SpellCastTimes"));
  const spellDurations = byId(readDbc("SpellDuration"));
  const spellIcons = readDbc("SpellIcon");
  const spellRanges = readDbc("SpellRange");
  const enchants = readDbc("SpellItemEnchantment");
  const talents = readDbc("Talent");
  const talentTabs = byId(readDbc("TalentTab"));
  const iconRows = spellIcons.map((row) => ({
    id: row.id,
    name: basenameIcon(row.iconPath),
  }));
  const iconIdByName = new Map(iconRows.map((row) => [String(row.name).toLowerCase(), numberValue(row.id)]));
  let nextIconId = Math.max(0, ...iconRows.map((row) => numberValue(row.id))) + 1;
  for (const icon of luaData.specIcons.values()) {
    const iconName = basenameIcon(icon);
    if (!iconName) {
      continue;
    }

    const key = iconName.toLowerCase();
    if (iconIdByName.has(key)) {
      continue;
    }

    iconIdByName.set(key, nextIconId);
    iconRows.push({ id: nextIconId, name: iconName });
    nextIconId += 1;
  }
  const spellById = byId(spells);
  const skillLineById = byId(skills);
  const classRows = classes.map((row) => {
    const id = numberValue(row.id);
    const token = stringValue(row.fileString);
    const fallbackName = titleFromToken(token) || `Class #${id}`;
    return {
      id,
      token,
      name: localizedName(row, "name", fallbackName),
    };
  });
  const classById = new Map(classRows.map((row) => [row.id, row]));
  const classByToken = new Map(classRows.map((row) => [normalizeLookup(row.token), row]));
  const classByName = new Map(classRows.map((row) => [normalizeLookup(row.name), row]));
  const resolveClass = (classId: number, token: DbcValue, name: DbcValue) => {
    const tokenMatch = classByToken.get(normalizeLookup(token));
    const nameMatch = classByName.get(normalizeLookup(name));
    const idMatch = classById.get(classId);

    if (tokenMatch) return tokenMatch;
    if (nameMatch && (!idMatch || classId === 10 || idMatch.name === "Hero" || nameMatch.id === classId)) return nameMatch;
    return idMatch ?? (classId > 0 ? { id: classId, token: "", name: stringValue(name) || `Class #${classId}` } : undefined);
  };
  const skillLineByName = new Map(
    skills
      .map((row) => [normalizeLookup(localizedName(row, "name", `Skill #${numberValue(row.Id)}`)), numberValue(row.Id)] as const)
      .filter(([name]) => Boolean(name)),
  );
  const spellName = (spellId: number) => {
    const spell = spellById.get(spellId);
    return spell ? localizedName(spell, "name", `Spell #${spellId}`) : "";
  };
  const spellIconId = (spellId: number) => numberValue(spellById.get(spellId)?.iconId ?? 0);
  const specRows: DbcRow[] = chrSpecs.map((row): DbcRow => {
    const classInfo = resolveClass(0, row.classToken, row.classToken);
    const specName = stringValue(row.name) || stringValue(row.specToken);
    const skillLineId = skillLineByName.get(normalizeLookup(specName)) ?? 0;

    return {
      ...row,
      classId: classInfo?.id ?? 0,
      className: classInfo?.name ?? "",
      classFileString: classInfo?.token ?? "",
      iconId: iconIdByName.get(basenameIcon(row.icon)) ?? 0,
      primarySpellName: spellName(numberValue(row.primarySpellId)),
      secondarySpellName: spellName(numberValue(row.secondarySpellId)),
      passiveSpellName: spellName(numberValue(row.passiveSpellId)),
      skillLineId,
      skillLineName: skillLineId ? localizedName(skillLineById.get(skillLineId) ?? {}, "name", specName) : "",
    };
  });
  const dbcSpecByClassAndName = new Map<string, DbcRow>();
  for (const spec of specRows) {
    const classId = numberValue(spec.classId);
    for (const value of [spec.name, spec.specToken]) {
      const key = `${classId}:${normalizeLookup(value)}`;
      if (classId && key !== `${classId}:`) {
        dbcSpecByClassAndName.set(key, spec);
      }
    }
  }
  const classOrderIndex = new Map(luaData.classOrder.map((classToken, index) => [classToken, index + 1]));
  const luaSpecRows: DbcRow[] = [];
  for (const [classToken, specsByToken] of luaData.localizedSpecs) {
    const classId = luaData.classIds.get(classToken) ?? resolveClass(0, classToken, classToken)?.id ?? 0;
    const classInfo = resolveClass(classId, classToken, luaData.classAliases.get(classToken) ?? classToken);
    const orderedSpecTokens = luaData.baseClassSpecOrder.get(classToken) ?? [...specsByToken.keys()];
    const orderedSet = new Set(orderedSpecTokens);
    const remainingSpecTokens = [...specsByToken.keys()].filter((token) => !orderedSet.has(token));

    for (const [index, specToken] of [...orderedSpecTokens, ...remainingSpecTokens].entries()) {
      const specName = specsByToken.get(specToken) ?? titleFromToken(specToken);
      const key = `${classToken}:${specToken}`;
      const dbcSpec = dbcSpecByClassAndName.get(`${classId}:${normalizeLookup(specName)}`)
        ?? dbcSpecByClassAndName.get(`${classId}:${normalizeLookup(specToken)}`);
      const icon = luaData.specIcons.get(specToken) || stringValue(dbcSpec?.icon ?? "");
      const classSpecificSkillLineId = numberValue(dbcSpec?.skillLineId ?? 0);
      const nameMatchedSkillLineId = skillLineByName.get(normalizeLookup(specName)) ?? 0;
      const skillLineId =
        classId >= 12
          ? classSpecificSkillLineId || nameMatchedSkillLineId
          : nameMatchedSkillLineId || classSpecificSkillLineId;

      luaSpecRows.push({
        id: classId * 100 + index + 1,
        classId,
        classToken,
        className: classInfo?.name || luaData.classAliases.get(classToken) || titleFromToken(classToken),
        classMask: luaData.classMasks.get(classToken) ?? maskBit(classId),
        classOrder: classOrderIndex.get(classToken) ?? 0,
        specToken,
        name: specName,
        specOrder: index + 1,
        primaryStat: luaData.specPrimaryStat.get(specToken) || luaData.classPrimaryStat.get(classToken) || "",
        icon,
        iconId: iconIdByName.get(basenameIcon(icon)) ?? numberValue(dbcSpec?.iconId ?? 0),
        skillLineId,
        skillLineName: skillLineId ? localizedName(skillLineById.get(skillLineId) ?? {}, "name", specName) : "",
        thumbnailAtlas: luaData.thumbnails.get(key) ?? "",
        backgroundAtlas: luaData.backgrounds.get(key) ?? "",
        source: "lua:LOCALIZED_CLASS_SPEC_NAMES",
      });
    }
  }
  const luaSpecKeys = new Set(luaSpecRows.map((row) => `${numberValue(row.classId)}:${stringValue(row.specToken)}`));
  for (const spec of specRows) {
    const classId = numberValue(spec.classId);
    const specToken = stringValue(spec.specToken);
    const skillLineId = numberValue(spec.skillLineId);
    const key = `${classId}:${specToken}`;
    if (classId < 12 || !specToken || !skillLineId || luaSpecKeys.has(key)) {
      continue;
    }

    const classInfo = resolveClass(classId, spec.classFileString || spec.classToken, spec.className);
    const classToken = classInfo?.token || stringValue(spec.classFileString || spec.classToken);
    const icon = stringValue(spec.icon);
    luaSpecRows.push({
      id: classId * 100 + 50 + numberValue(spec.orderIndex),
      classId,
      classToken,
      className: classInfo?.name || stringValue(spec.className),
      classMask: luaData.classMasks.get(classToken) ?? maskBit(classId),
      classOrder: classOrderIndex.get(classToken) ?? 0,
      specToken,
      name: stringValue(spec.name),
      specOrder: numberValue(spec.orderIndex),
      primaryStat: luaData.specPrimaryStat.get(specToken) || luaData.classPrimaryStat.get(classToken) || "",
      icon,
      iconId: numberValue(spec.iconId) || iconIdByName.get(basenameIcon(icon)) || 0,
      skillLineId,
      skillLineName: stringValue(spec.skillLineName) || localizedName(skillLineById.get(skillLineId) ?? {}, "name", stringValue(spec.name)),
      thumbnailAtlas: "",
      backgroundAtlas: "",
      source: "dbc:ChrSpecialization",
    });
    luaSpecKeys.add(key);
  }
  const luaSpecByClassAndName = new Map<string, DbcRow>();
  for (const spec of luaSpecRows) {
    const classId = numberValue(spec.classId);
    for (const value of [spec.name, spec.specToken]) {
      const key = `${classId}:${normalizeLookup(value)}`;
      if (classId && key !== `${classId}:`) {
        luaSpecByClassAndName.set(key, spec);
      }
    }
  }
  const specByAdvancementId = new Map(
    specRows
      .filter((row) => numberValue(row.advancementId) > 0)
      .map((row) => [numberValue(row.advancementId), row]),
  );
  const specBySkillLineId = new Map(
    luaSpecRows
      .filter((row) => numberValue(row.skillLineId) > 0)
      .map((row) => [numberValue(row.skillLineId), row]),
  );
  const specializationSlotRows: DbcRow[] = luaData.specSwapSpellIds.map((spellId, index) => ({
    id: index + 1,
    spellId,
    spellName: spellName(spellId),
    iconId: spellIconId(spellId),
    source: "lua:SPEC_SWAP_SPELLS",
  }));
  const childrenByParent = new Map<number, DbcRow[]>();
  for (const row of characterAdvancement) {
    const parentId = numberValue(row.parentId);
    if (!parentId) {
      continue;
    }

    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), row]);
  }
  const ownerByAdvancementId = new Map<number, DbcRow>();
  for (const [rootId, spec] of specByAdvancementId) {
    const queue = [rootId];
    ownerByAdvancementId.set(rootId, spec);

    for (let index = 0; index < queue.length; index += 1) {
      const parentId = queue[index];
      for (const child of childrenByParent.get(parentId) ?? []) {
        const childId = numberValue(child.id);
        if (ownerByAdvancementId.has(childId)) {
          continue;
        }

        ownerByAdvancementId.set(childId, spec);
        queue.push(childId);
      }
    }
  }

  const classTypeRows: DbcRow[] = [...characterAdvancementClassTypes.values()].map((row) => {
    const classInfo = resolveClass(numberValue(row.classId), row.token, row.name);
    return {
      ...row,
      rawClassId: numberValue(row.classId),
      classId: classInfo?.id ?? 0,
      className: classInfo?.name ?? stringValue(row.name),
      classToken: classInfo?.token ?? "",
    };
  });
  const classTypeById = new Map(classTypeRows.map((row) => [numberValue(row.id), row]));
  const resolveSpecForTab = (classId: number, tabType: DbcRow | undefined) => {
    if (!classId || !tabType) {
      return undefined;
    }

    return (
      luaSpecByClassAndName.get(`${classId}:${normalizeLookup(tabType.name)}`) ??
      luaSpecByClassAndName.get(`${classId}:${normalizeLookup(tabType.label)}`)
    );
  };
  const advancementRows: DbcRow[] = characterAdvancement.map((row) => {
    const classType = classTypeById.get(numberValue(row.classTypeId));
    const tabType = characterAdvancementTabTypes.get(numberValue(row.tabTypeId));
    const ownerFromTree = ownerByAdvancementId.get(numberValue(row.id));
    const classId = numberValue(ownerFromTree?.classId ?? 0) || numberValue(classType?.classId ?? 0);
    const spec = resolveSpecForTab(classId, tabType) ?? ownerFromTree;
    const ownerSpecName = stringValue(spec?.name ?? "") || stringValue(tabType?.name ?? "");

    return {
      ...row,
      tabName: stringValue(tabType?.name ?? ""),
      ownerClassId: numberValue(spec?.classId ?? 0) || classId,
      ownerClassName: stringValue(spec?.className ?? "") || stringValue(classType?.className ?? ""),
      ownerSpecId: numberValue(spec?.id ?? 0),
      ownerSpecName,
      ownerSpecSkillId: numberValue(spec?.skillLineId ?? 0) || (ownerSpecName ? skillLineByName.get(normalizeLookup(ownerSpecName)) ?? 0 : 0),
    };
  });
  const talentTreeTables = buildTalentTreeTables(advancementRows, iconIdByName, spellName, spellIconId);
  const tabTypeRows: DbcRow[] = [...characterAdvancementTabTypes.values()].map((row) => {
    const ownedAdvancement = advancementRows.find((advancement) => numberValue(advancement.tabTypeId) === numberValue(row.id));

    return {
      ...row,
      ownerClassId: numberValue(ownedAdvancement?.ownerClassId ?? 0),
      ownerClassName: stringValue(ownedAdvancement?.ownerClassName ?? ""),
      ownerSpecId: numberValue(ownedAdvancement?.ownerSpecId ?? 0),
      ownerSpecName: stringValue(ownedAdvancement?.ownerSpecName ?? ""),
      ownerSpecSkillId: numberValue(ownedAdvancement?.ownerSpecSkillId ?? 0),
    };
  });
  const classBySingleMask = new Map(
    classRows
      .map((row) => [maskBit(row.id), row] as const)
      .filter(([mask]) => mask !== 0),
  );
  const skillAbilityRows: DbcRow[] = skillLineAbilities.map((row) => {
    const skillLineId = numberValue(row.skillLineId);
    const skillLine = skillLineById.get(skillLineId);
    const skillLineName = localizedName(skillLine ?? {}, "name", "");
    const spec = specBySkillLineId.get(skillLineId);
    const classFromMask = classBySingleMask.get(numberValue(row.classMask));
    const classFromSkill = classByName.get(normalizeLookup(skillLineName));
    const ownerClassId = numberValue(spec?.classId ?? 0) || classFromMask?.id || classFromSkill?.id || 0;
    const ownerClassName = stringValue(spec?.className ?? "") || classFromMask?.name || classFromSkill?.name || "";
    const spellId = numberValue(row.spellId);

    return {
      ...row,
      skillLineName,
      spellName: spellName(spellId),
      iconId: spellIconId(spellId),
      ownerClassId,
      ownerClassName,
      ownerSpecId: numberValue(spec?.id ?? 0),
      ownerSpecName: stringValue(spec?.name ?? ""),
      ownerSpecSkillId: numberValue(spec?.skillLineId ?? 0),
    };
  });
  const spellOwnerRowsByKey = new Map<string, DbcRow>();
  const addSpellOwner = (row: DbcRow | null) => {
    if (!row) {
      return;
    }

    const key = [
      numberValue(row.spellId),
      numberValue(row.ownerClassId),
      numberValue(row.ownerSpecId),
      stringValue(row.source),
      numberValue(row.sourceId),
      numberValue(row.sourceRank),
    ].join(":");
    spellOwnerRowsByKey.set(key, row);
  };

  for (const spec of specRows) {
    addSpellOwner(ownerRow(numberValue(spec.primarySpellId), spec, "chr_specs:primary", { sourceId: spec.id }));
    addSpellOwner(ownerRow(numberValue(spec.secondarySpellId), spec, "chr_specs:secondary", { sourceId: spec.id }));
    addSpellOwner(ownerRow(numberValue(spec.passiveSpellId), spec, "chr_specs:passive", { sourceId: spec.id }));
  }

  for (const row of advancementRows) {
    const rankFields = ["spellId", "rank2SpellId", "rank3SpellId", "rank4SpellId", "rank5SpellId"];
    for (let rankIndex = 0; rankIndex < rankFields.length; rankIndex += 1) {
      addSpellOwner(ownerRow(numberValue(row[rankFields[rankIndex]]), row, "character_advancement", {
        sourceId: row.id,
        sourceRank: rankIndex + 1,
      }));
    }
  }

  for (const row of skillAbilityRows) {
    addSpellOwner(ownerRow(numberValue(row.spellId), row, "skill_line_ability", {
      sourceId: row.id,
      skillLineId: row.skillLineId,
      acquireMethod: row.acquireMethod,
      minSkillLineRank: row.minSkillLineRank,
      raceMask: row.raceMask,
      classMask: row.classMask,
    }));
  }
  const spellOwnerRows = [...spellOwnerRowsByKey.values()];

  const raceMaskByClass = new Map<number, number>();
  const classMaskByRace = new Map<number, number>();
  for (const row of charBaseInfo) {
    const raceId = numberValue(row.raceId);
    const classId = numberValue(row.classId);
    raceMaskByClass.set(classId, (raceMaskByClass.get(classId) ?? 0) + maskBit(raceId));
    classMaskByRace.set(raceId, (classMaskByRace.get(raceId) ?? 0) + maskBit(classId));
  }

  for (const display of itemDisplays.values()) {
    const iconName = basenameIcon(display.inventoryIcon1);
    if (!iconName) {
      continue;
    }

    const key = iconName.toLowerCase();
    if (iconIdByName.has(key)) {
      continue;
    }

    iconIdByName.set(key, nextIconId);
    iconRows.push({ id: nextIconId, name: iconName });
    nextIconId += 1;
  }
  extractIconFiles(iconRows.map((row) => String(row.name)));

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const tables = [
    "aowow_achievement",
    "aowow_achievementcategory",
    "aowow_character_advancement",
    "aowow_character_advancement_class_types",
    "aowow_character_advancement_tab_types",
    "aowow_classes",
    "aowow_coa_specs",
    "aowow_chr_specs",
    "aowow_currencies",
    "aowow_emotes",
    "aowow_factions",
    "aowow_icons",
    "aowow_itemenchantment",
    "aowow_items",
    "aowow_itemset",
    "aowow_mails",
    "aowow_pet",
    "aowow_races",
    "aowow_skill_line_abilities",
    "aowow_skillline",
    "aowow_sounds",
    "aowow_specialization_slots",
    "aowow_spell",
    "aowow_spell_owners",
    "aowow_spellrange",
    "aowow_talents",
    "aowow_talent_tree_node_ranks",
    "aowow_talent_tree_nodes",
    "aowow_talent_tree_tabs",
    "aowow_titles",
    "aowow_zones",
  ];

  try {
    await client.query("BEGIN");
    await ensureAscensionHelperTables(client);
    await widenAscensionColumns(client, tables);
    await requireEmptyTables(client, tables);

    await insertRows(client, "aowow_icons", iconRows, ["id", "name"]);
    await insertRows(client, "aowow_classes", classes.map((row) => ({
      ...row,
      name_loc0: localizedName(row, "name", titleFromToken(row.fileString) || `Class #${row.id}`),
      raceMask: raceMaskByClass.get(numberValue(row.id)) ?? 0,
    })), ["fileString", "name_loc0", "name_loc2", "name_loc3", "name_loc4", "name_loc6", "name_loc8", "powerType", "raceMask", "flags", "expansion"]);
    await insertRows(client, "aowow_character_advancement_class_types", classTypeRows, [
      "id",
      "token",
      "rawClassId",
      "name",
      "classId",
      "className",
      "classToken",
    ]);
    await insertRows(client, "aowow_character_advancement_tab_types", tabTypeRows, [
      "id",
      "name",
      "label",
      "ownerClassId",
      "ownerClassName",
      "ownerSpecId",
      "ownerSpecName",
      "ownerSpecSkillId",
    ]);
    await insertRows(client, "aowow_chr_specs", specRows, [
      "id",
      "classId",
      "className",
      "classFileString",
      "classToken",
      "specToken",
      "name",
      "description",
      "icon",
      "iconId",
      "primarySpellId",
      "primarySpellName",
      "secondarySpellId",
      "secondarySpellName",
      "passiveSpellId",
      "passiveSpellName",
      "advancementId",
      "skillLineId",
      "skillLineName",
      "orderIndex",
      "role",
    ]);
    await insertRows(client, "aowow_coa_specs", luaSpecRows, [
      "id",
      "classId",
      "classToken",
      "className",
      "classMask",
      "classOrder",
      "specToken",
      "name",
      "specOrder",
      "primaryStat",
      "icon",
      "iconId",
      "skillLineId",
      "skillLineName",
      "thumbnailAtlas",
      "backgroundAtlas",
      "source",
    ]);
    await insertRows(client, "aowow_specialization_slots", specializationSlotRows, [
      "id",
      "spellId",
      "spellName",
      "iconId",
      "source",
    ]);
    await insertRows(client, "aowow_character_advancement", advancementRows, [
      "id",
      "type",
      "parentId",
      "groupId",
      "spellId",
      "rank2SpellId",
      "rank3SpellId",
      "rank4SpellId",
      "rank5SpellId",
      "name",
      "icon",
      "prerequisite",
      "levelRequired1",
      "levelRequired2",
      "levelRequired3",
      "row",
      "col",
      "classTypeId",
      "tabTypeId",
      "tabName",
      "anchor",
      "color",
      "shape",
      "ownerClassId",
      "ownerClassName",
      "ownerSpecId",
      "ownerSpecName",
      "ownerSpecSkillId",
    ]);
    await insertRows(client, "aowow_talent_tree_tabs", talentTreeTables.tabRows, [
      "id",
      "treeKey",
      "treeType",
      "ownerClassId",
      "ownerClassName",
      "ownerSpecId",
      "ownerSpecName",
      "ownerSpecSkillId",
      "tabTypeId",
      "tabName",
      "orderIndex",
      "backgroundAtlas",
      "source",
    ]);
    await insertRows(client, "aowow_talent_tree_nodes", talentTreeTables.nodeRows, [
      "id",
      "treeKey",
      "treeType",
      "ownerClassId",
      "ownerClassName",
      "ownerSpecId",
      "ownerSpecName",
      "ownerSpecSkillId",
      "tabTypeId",
      "tabName",
      "type",
      "parentId",
      "groupId",
      "row",
      "col",
      "name",
      "icon",
      "iconId",
      "maxRanks",
      "spellId",
      "allSpellIds",
      "prerequisite",
      "anchor",
      "color",
      "shape",
      "source",
    ]);
    await insertRows(client, "aowow_talent_tree_node_ranks", talentTreeTables.rankRows, [
      "id",
      "advancementId",
      "rank",
      "spellId",
      "spellName",
      "iconId",
      "treeKey",
      "treeType",
      "ownerClassId",
      "ownerSpecId",
      "ownerSpecSkillId",
      "tabTypeId",
    ]);
    await insertRows(client, "aowow_skill_line_abilities", skillAbilityRows, [
      "id",
      "skillLineId",
      "skillLineName",
      "spellId",
      "spellName",
      "iconId",
      "raceMask",
      "classMask",
      "excludeRaceMask",
      "excludeClassMask",
      "minSkillLineRank",
      "supercededBySpell",
      "acquireMethod",
      "trivialSkillLineRankHigh",
      "trivialSkillLineRankLow",
      "characterPoints1",
      "characterPoints2",
      "ownerClassId",
      "ownerClassName",
      "ownerSpecId",
      "ownerSpecName",
      "ownerSpecSkillId",
    ]);
    await insertRows(client, "aowow_spell_owners", spellOwnerRows, [
      "spellId",
      "ownerClassId",
      "ownerClassName",
      "ownerSpecId",
      "ownerSpecName",
      "ownerSpecSkillId",
      "sourceId",
      "sourceRank",
      "skillLineId",
      "acquireMethod",
      "minSkillLineRank",
      "raceMask",
      "classMask",
      "source",
    ]);
    await insertRows(client, "aowow_races", races.map((row) => ({
      ...row,
      classMask: classMaskByRace.get(numberValue(row.id)) ?? 0,
      startAreaId: 0,
      leader: 0,
      side: numberValue(row.side) === 2 ? 0 : numberValue(row.side) + 1,
    })), ["classMask", "flags", "factionId", "baseLanguage", "side", "fileString", "name_loc0", "name_loc2", "name_loc3", "name_loc4", "name_loc6", "name_loc8", "expansion"]);
    await insertRows(client, "aowow_talents", talents.flatMap((talent) => {
      const tab = talentTabs.get(numberValue(talent.tabId));
      const out: DbcRow[] = [];
      for (let rank = 1; rank <= 5; rank += 1) {
        const spell = numberValue(talent[`rank${rank}`]);
        if (spell) {
          out.push({
            id: numberValue(talent.id),
            class: tab && numberValue(tab.classMask) ? Math.log2(numberValue(tab.classMask)) + 1 : 0,
            petTypeMask: numberValue(tab?.creatureFamilyMask ?? 0),
            tab: tab && numberValue(tab.creatureFamilyMask) ? Math.log2(numberValue(tab.creatureFamilyMask)) : numberValue(tab?.tabNumber ?? 0),
            row: talent.row,
            col: talent.column,
            spell,
            rank,
          });
        }
      }
      return out;
    }), ["id", "class", "petTypeMask", "tab", "row", "col", "spell", "rank"]);
    await insertRows(client, "aowow_spell", spells.map((row) => {
      const cast = spellCastTimes.get(numberValue(row.castTimeId));
      const duration = spellDurations.get(numberValue(row.durationId));
      return {
        ...row,
        typeCat: 0,
        spellFocusObject: row.spellFocus,
        castTime: numberValue(cast?.baseTime ?? 0),
        recoveryCategory: row.recoveryTimeCategory,
        duration: numberValue(duration?.baseTime ?? 0),
        powerGainRunicPower: 0,
        powerCostRunes: 0,
        effect1RadiusMin: row.effect1RadiusId,
        effect2RadiusMin: row.effect2RadiusId,
        effect3RadiusMin: row.effect3RadiusId,
        iconIdBak: row.iconIdActive,
        spellVisualId: row.spellVisualId1,
        rankNo: 0,
        talentLevel: 0,
        procCustom: 0,
        procCooldown: 0,
        trainingCost: 0,
        spellDescriptionVariableId: row.spellDescriptionVariable,
      };
    }), [
      ...Object.keys(passthrough(spells[0] ?? {}, [])),
      "name_loc0", "name_loc2", "name_loc3", "name_loc4", "name_loc6", "name_loc8",
      "rank_loc0", "rank_loc2", "rank_loc3", "rank_loc4", "rank_loc6", "rank_loc8",
      "description_loc0", "description_loc2", "description_loc3", "description_loc4", "description_loc6", "description_loc8",
      "buff_loc0", "buff_loc2", "buff_loc3", "buff_loc4", "buff_loc6", "buff_loc8",
      "duration", "iconId", "iconIdBak", "spellVisualId",
    ]);
    await insertRows(client, "aowow_spellrange", spellRanges, [
      "id",
      "rangeMinHostile",
      "rangeMinFriend",
      "rangeMaxHostile",
      "rangeMaxFriend",
      "rangeType",
      "name_loc0",
      "name_loc2",
      "name_loc3",
      "name_loc4",
      "name_loc6",
      "name_loc8",
    ]);
    await insertRows(client, "aowow_items", items.map((row) => {
      const display = itemDisplays.get(numberValue(row.displayInfoId));
      const iconName = basenameIcon(display?.inventoryIcon1 ?? null);
      return {
        id: row.id,
        class: row.classId,
        classBak: row.classId,
        subClass: row.subClassId,
        subClassBak: row.subClassId,
        soundOverrideSubclass: row.soundOverride,
        subSubClass: 0,
        name_loc0: `Item #${row.id}`,
        iconId: iconName ? (iconIdByName.get(iconName.toLowerCase()) ?? 0) : 0,
        displayId: row.displayInfoId,
        slot: row.inventoryType,
        slotBak: row.inventoryType,
        model: stringValue(display?.leftModelName ?? null),
        repairPrice: 0,
        eventId: 0,
        gemEnchantmentId: 0,
      };
    }), ["id", "class", "subClass", "name_loc0", "iconId", "displayId", "slotBak"]);
    await insertRows(client, "aowow_itemset", itemSets.map((row) => ({
      ...row,
      refSetId: 0,
      item1: 0,
      item2: 0,
      item3: 0,
      item4: 0,
      item5: 0,
      item6: 0,
      item7: 0,
      item8: 0,
      item9: 0,
      item10: 0,
      spell1: row.spellId1,
      spell2: row.spellId2,
      spell3: row.spellId3,
      spell4: row.spellId4,
      spell5: row.spellId5,
      spell6: row.spellId6,
      spell7: row.spellId7,
      spell8: row.spellId8,
      bonus1: row.itemCount1,
      bonus2: row.itemCount2,
      bonus3: row.itemCount3,
      bonus4: row.itemCount4,
      bonus5: row.itemCount5,
      bonus6: row.itemCount6,
      bonus7: row.itemCount7,
      bonus8: row.itemCount8,
      skillId: row.reqSkillId,
      skillLevel: row.reqSkillLevel,
    })), ["id", "name_loc0", "name_loc2", "name_loc3", "name_loc4", "name_loc6", "name_loc8", "spell1", "spell2", "spell3", "spell4", "spell5", "spell6", "spell7", "spell8", "bonus1", "bonus2", "bonus3", "bonus4", "bonus5", "bonus6", "bonus7", "bonus8", "skillId", "skillLevel"]);
    await insertRows(client, "aowow_itemenchantment", enchants, ["id", "charges", "type1", "type2", "type3", "amount1", "amount2", "amount3", "object1", "object2", "object3", "name_loc0", "name_loc2", "name_loc3", "name_loc4", "name_loc6", "name_loc8", "conditionId", "skillLine", "skillLevel", "requiredLevel"]);
    await insertRows(client, "aowow_skillline", skills.map((row) => ({ ...row, typeCat: row.categoryId, iconId: row.spellIconId, professionMask: 0, recipeSubClass: 0, specializations: "" })), ["Id", "typeCat", "categoryId", "name_loc0", "name_loc2", "name_loc3", "name_loc4", "name_loc6", "name_loc8", "description_loc0", "description_loc2", "description_loc3", "description_loc4", "description_loc6", "description_loc8", "iconId"]);
    await insertRows(client, "aowow_achievementcategory", achCat.map((row) => ({ id: row.id, parentCat: row.parentCategory, parentCat2: 0 })), ["id", "parentCat", "parentCat2"]);
    await insertRows(client, "aowow_achievement", ach.map((row) => ({ ...row, category: row.category, iconIdBak: row.iconId })), ["id", "faction", "map", "category", "points", "orderInGroup", "flags", "iconId", "iconIdBak", "reqCriteriaCount", "refAchievement", "name_loc0", "name_loc2", "name_loc3", "name_loc4", "name_loc6", "name_loc8", "description_loc0", "description_loc2", "description_loc3", "description_loc4", "description_loc6", "description_loc8", "reward_loc0", "reward_loc2", "reward_loc3", "reward_loc4", "reward_loc6", "reward_loc8"]);
    await insertRows(client, "aowow_zones", areas.map((row) => ({ ...row, parentArea: row.areaTable, category: row.areaTable, faction: row.factionGroupMask, expansion: 0, type: 0, maxPlayer: 0, itemLevelReqN: 0, itemLevelReqH: 0, levelReq: 0, levelReqLFG: 0, levelHeroic: 0, levelMin: 0, levelMax: 0, attunementsN: "", attunementsH: "", parentMapId: 0, parentX: 0, parentY: 0 })), ["id", "mapId", "mapIdBak", "parentArea", "category", "flags", "faction", "name_loc0", "name_loc2", "name_loc3", "name_loc4", "name_loc6", "name_loc8"]);
    await insertRows(client, "aowow_factions", factions.map((row) => ({ ...row, parentFactionId: row.parentFaction, side: 0, expansion: 0, qmNpcIds: "", templateIds: "", baseRepValue4: row.baseRepValue4, baseRepValue3: row.baseRepValue3 })), ["id", "repIdx", "baseRepRaceMask1", "baseRepRaceMask2", "baseRepRaceMask3", "baseRepRaceMask4", "baseRepClassMask1", "baseRepClassMask2", "baseRepClassMask3", "baseRepClassMask4", "baseRepValue1", "baseRepValue2", "baseRepValue3", "baseRepValue4", "parentFactionId", "spilloverRateIn", "spilloverRateOut", "spilloverMaxRank", "name_loc0", "name_loc2", "name_loc3", "name_loc4", "name_loc6", "name_loc8"]);
    await insertRows(client, "aowow_pet", creatureFamilies.map((row) => ({ id: row.id, category: row.categoryEnumID, minLevel: 1, maxLevel: 80, foodMask: row.petFoodMask, type: row.petTalentType, exotic: 0, expansion: 0, name_loc0: loc(row, "name", numberValue(row.id)), name_loc2: row.name_loc2, name_loc3: row.name_loc3, name_loc4: row.name_loc4, name_loc6: row.name_loc6, name_loc8: row.name_loc8, skillLineId: row.skillLine1, spellId1: 0, spellId2: 0, spellId3: 0, spellId4: 0, armor: 0, damage: 0, health: 0 })), ["id", "category", "minLevel", "maxLevel", "foodMask", "type", "exotic", "expansion", "name_loc0", "name_loc2", "name_loc3", "name_loc4", "name_loc6", "name_loc8", "skillLineId"]);
    await insertRows(client, "aowow_emotes", emotes.map((row) => ({ id: row.id, cmd: row.name, flags: row.flags, isAnimated: numberValue(row.animationId) ? 1 : 0, soundId: row.soundId, state: row.state, stateParam: row.stateParam })), ["id", "cmd", "flags", "isAnimated", "soundId", "state", "stateParam"]);
    await insertRows(client, "aowow_currencies", currencies.map((row) => ({ ...row, name_loc0: `Currency #${row.id}` })), ["id", "category", "itemId", "name_loc0"]);
    await insertRows(client, "aowow_titles", titles.map((row) => ({ ...row, category: 0, gender: 0, side: 0, expansion: 0, src12Ext: 0, eventId: 0 })), ["id", "category", "gender", "side", "expansion", "src12Ext", "eventId", "bitIdx", "male_loc0", "male_loc2", "male_loc3", "male_loc4", "male_loc6", "male_loc8", "female_loc0", "female_loc2", "female_loc3", "female_loc4", "female_loc6", "female_loc8"]);
    await insertRows(client, "aowow_mails", mails, ["id", "subject_loc0", "subject_loc2", "subject_loc3", "subject_loc4", "subject_loc6", "subject_loc8", "text_loc0", "text_loc2", "text_loc3", "text_loc4", "text_loc6", "text_loc8"]);
    await insertRows(client, "aowow_sounds", sounds.map((row) => ({ id: row.id, cat: row.type, name: stringValue(row.name) || `Sound #${row.id}`, flags: row.flags })), ["id", "cat", "name", "flags"]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

    await history.finish("SUCCESS", {
      tables: tables.length,
      spells: spells.length,
      talentTreeNodes: talentTreeTables.nodeRows.length,
      talentTreeRanks: talentTreeTables.rankRows.length,
    });
    console.log("Ascension client data import completed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await history.log("ERROR", "Ascension client data import failed.", { error: message });
    await history.finish("FAILED", { error: message });
    throw error;
  } finally {
    await history.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
