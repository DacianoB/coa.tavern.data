import { existsSync, readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { startImportJob } from "./lib/import-history";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

type LuaObject = Record<string, unknown>;

type TalentRecord = {
  advId?: number | string;
  name?: string;
  spellId?: number | string;
  icon?: string;
  tier?: number | string;
  col?: number | string;
  rank?: number | string;
  reqs?: number | string;
  children?: number | string;
  cost?: number | string;
  aeCost?: number | string;
  teCost?: number | string;
  requiredAEInvestment?: number | string;
  requiredTEInvestment?: number | string;
  requiredTabAEInvestment?: number | string;
  requiredTabTEInvestment?: number | string;
  type?: string;
  nodeType?: string;
  flags?: number | string;
  requiredLevel?: number | string;
  isPassive?: boolean;
  isClass?: boolean;
  allSpells?: unknown;
  minLevel?: number | string;
  choiceIndex?: number | string;
  groupID?: number | string;
  description?: string;
  flavorText?: string;
  category?: string;
  unlockCondition?: string;
};

type ParsedTalent = TalentRecord & {
  className: string;
  tabName: string;
};

type ClassRow = {
  id: number;
  name: string;
  fileString?: string;
};

type SpecRow = {
  id: number;
  classId: number;
  className: string;
  name: string;
  skillLineId: number;
};

type ExistingNode = {
  id: number;
  treeKey: string;
  treeType: "class" | "spec";
  ownerClassId: number;
  ownerClassName: string;
  ownerSpecId: number;
  ownerSpecName: string;
  ownerSpecSkillId: number;
  tabTypeId: number;
  tabName: string;
};

type ImportStats = {
  seen: number;
  updated: number;
  inserted: number;
  skipped: number;
  missingClass: number;
};

const connectionString = process.env.GAME_DATABASE_URL || process.env.DATABASE_URL;
const targetSchema = process.env.GAME_DATABASE_SCHEMA || "game";
const inputPath =
  process.argv[2] ||
  process.env.COA_EXPORTER_TALENTS_INPUT ||
  "output/CoaExporter.lua";

function quoteIdent(identifier: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeLookup(value: unknown) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseIdList(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => Math.trunc(numberValue(item)))
      .filter((item) => item > 0)
      .sort((first, second) => first - second)
      .join(",");
  }

  if (value && typeof value === "object") {
    return Object.values(value)
      .map((item) => Math.trunc(numberValue(item)))
      .filter((item) => item > 0)
      .sort((first, second) => first - second)
      .join(",");
  }

  return "";
}

function arrayValues(value: unknown) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as LuaObject)
    .sort(([first], [second]) => Number(first) - Number(second))
    .map(([, item]) => item);
}

function allSpellIds(record: TalentRecord) {
  const values = arrayValues(record.allSpells)
    .map((item) => Math.trunc(numberValue(item)))
    .filter((item) => item > 0);
  const spellId = Math.trunc(numberValue(record.spellId));
  if (values.length === 0 && spellId > 0) {
    values.push(spellId);
  }
  return Array.from(new Set(values)).join(",");
}

function iconName(value: unknown) {
  return stringValue(value)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.(jpg|jpeg|png|webp|blp)$/i, "")
    .toLowerCase() ?? "";
}

class LuaTableParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse() {
    this.skipSpace();
    const out: LuaObject = {};

    while (this.index < this.source.length) {
      this.skipSpace();
      const save = this.index;
      const ident = this.readIdentifier();
      this.skipSpace();

      if (ident && this.peek() === "=") {
        this.index += 1;
        out[ident] = this.parseValue();
      } else {
        this.index = save;
        return this.parseValue();
      }

      this.skipSpace();
      if (this.peek() === "," || this.peek() === ";") {
        this.index += 1;
      }
    }

    return out;
  }

  private parseValue(): unknown {
    this.skipSpace();
    const char = this.peek();

    if (char === "{") return this.parseTable();
    if (char === "\"" || char === "'") return this.parseString();
    if (char === "-" || /\d/.test(char)) return this.parseNumber();

    const ident = this.readIdentifier();
    if (ident === "true") return true;
    if (ident === "false") return false;
    if (ident === "nil") return null;
    if (ident) return ident;

    throw new Error(`Unexpected Lua token near offset ${this.index}`);
  }

  private parseTable(): LuaObject {
    this.expect("{");
    const out: LuaObject = {};
    let arrayIndex = 1;

    while (true) {
      this.skipSpace();
      if (this.peek() === "}") {
        this.index += 1;
        break;
      }

      let key: string | number | null = null;
      let value: unknown;

      if (this.peek() === "[") {
        this.index += 1;
        key = this.parseValue() as string | number;
        this.skipSpace();
        this.expect("]");
        this.skipSpace();
        this.expect("=");
        value = this.parseValue();
      } else {
        const save = this.index;
        const ident = this.readIdentifier();
        this.skipSpace();
        if (ident && this.peek() === "=") {
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
      if (this.peek() === "," || this.peek() === ";") {
        this.index += 1;
      }
    }

    return out;
  }

  private parseString() {
    const quote = this.peek();
    this.index += 1;
    let out = "";

    while (this.index < this.source.length) {
      const char = this.source[this.index++];
      if (char === quote) break;
      if (char === "\\") {
        const next = this.source[this.index++];
        if (next === "n") out += "\n";
        else if (next === "r") out += "\r";
        else if (next === "t") out += "\t";
        else if (next === "\\" || next === "\"" || next === "'") out += next;
        else out += next ?? "";
      } else {
        out += char;
      }
    }

    return out;
  }

  private parseNumber() {
    const match = this.source.slice(this.index).match(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!match) throw new Error(`Invalid Lua number near offset ${this.index}`);
    this.index += match[0].length;
    return Number(match[0]);
  }

  private readIdentifier() {
    const match = this.source.slice(this.index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!match) return "";
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

      if (char === "-" && next === "-") {
        this.index += 2;
        if (this.source[this.index] === "[" && this.source[this.index + 1] === "[") {
          this.index += 2;
          const end = this.source.indexOf("]]", this.index);
          this.index = end >= 0 ? end + 2 : this.source.length;
        } else {
          while (this.index < this.source.length && !/[\r\n]/.test(this.source[this.index])) {
            this.index += 1;
          }
        }
        continue;
      }

      break;
    }
  }

  private peek() {
    return this.source[this.index] ?? "";
  }

  private expect(char: string) {
    this.skipSpace();
    if (this.peek() !== char) {
      throw new Error(`Expected "${char}" near offset ${this.index}`);
    }
    this.index += 1;
  }
}

function parseInput(path: string) {
  const raw = readFileSync(path, "utf-8").replace(/^\uFEFF/, "").trim();
  const parsed = raw.startsWith("{")
    ? JSON.parse(raw)
    : new LuaTableParser(raw).parse();

  if (!parsed || typeof parsed !== "object") {
    throw new Error("CoaExporter talent input did not contain an object.");
  }

  const root = parsed as LuaObject;
  const catalog =
    root.CoaExporterCatalog && typeof root.CoaExporterCatalog === "object"
      ? (root.CoaExporterCatalog as LuaObject)
      : root;
  const talentsRoot = catalog.talents;
  if (!talentsRoot || typeof talentsRoot !== "object") {
    throw new Error("CoaExporterCatalog.talents was not found in the input.");
  }

  const records: ParsedTalent[] = [];
  for (const [className, tabs] of Object.entries(talentsRoot as LuaObject)) {
    if (!tabs || typeof tabs !== "object") continue;
    for (const [tabName, tabPayload] of Object.entries(tabs as LuaObject)) {
      if (!tabPayload || typeof tabPayload !== "object") continue;
      const nodeList = (tabPayload as LuaObject).talents;
      for (const value of arrayValues(nodeList)) {
        if (!value || typeof value !== "object") continue;
        records.push({
          ...(value as TalentRecord),
          className,
          tabName,
        });
      }
    }
  }

  return {
    records,
    meta: {
      catalogMeta: catalog._meta,
      talentsMeta: catalog.talentsMeta,
    },
  };
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
    [targetSchema, tableName],
  );

  return result.rows[0]?.exists === true;
}

async function ensureTalentColumns(client: PoolClient) {
  const schema = quoteIdent(targetSchema);
  const additions: Array<[string, string]> = [
    ["connectedNodeIds", "text NOT NULL DEFAULT ''"],
    ["requiredNodeIds", "text NOT NULL DEFAULT ''"],
    ["talentCost", "integer NOT NULL DEFAULT 0"],
    ["abilityEssenceCost", "integer NOT NULL DEFAULT 0"],
    ["talentEssenceCost", "integer NOT NULL DEFAULT 0"],
    ["requiredAEInvestment", "integer NOT NULL DEFAULT 0"],
    ["requiredTEInvestment", "integer NOT NULL DEFAULT 0"],
    ["requiredTabAEInvestment", "integer NOT NULL DEFAULT 0"],
    ["requiredTabTEInvestment", "integer NOT NULL DEFAULT 0"],
    ["requiredLevel", "integer NOT NULL DEFAULT 0"],
    ["minLevel", "integer NOT NULL DEFAULT 0"],
    ["choiceIndex", "integer NOT NULL DEFAULT 0"],
    ["nodeType", "text NOT NULL DEFAULT ''"],
    ["flags", "integer NOT NULL DEFAULT 0"],
    ["isPassive", "boolean NOT NULL DEFAULT false"],
    ["clientDescription", "text NOT NULL DEFAULT ''"],
    ["clientFlavorText", "text NOT NULL DEFAULT ''"],
    ["clientCategory", "text NOT NULL DEFAULT ''"],
    ["unlockCondition", "text NOT NULL DEFAULT ''"],
  ];

  for (const [column, definition] of additions) {
    await client.query(`
      ALTER TABLE ${schema}.aowow_talent_tree_nodes
      ADD COLUMN IF NOT EXISTS ${quoteIdent(column)} ${definition}
    `);
  }

  await client.query(`
    CREATE INDEX IF NOT EXISTS aowow_talent_tree_nodes_connected_idx
    ON ${schema}.aowow_talent_tree_nodes ("connectedNodeIds")
  `);
}

async function classesByName(client: PoolClient) {
  const result = await client.query<ClassRow>(
    `
      SELECT id, COALESCE(NULLIF(name_loc0, ''), id::text) AS name, "fileString"
      FROM ${quoteIdent(targetSchema)}.aowow_classes
      WHERE id > 0
    `,
  );

  const classes = new Map<string, ClassRow>();
  for (const row of result.rows) {
    classes.set(normalizeLookup(row.name), row);
    if (row.fileString) {
      classes.set(normalizeLookup(row.fileString), row);
    }
  }

  if (await tableExists(client, "aowow_character_advancement_class_types")) {
    const typeResult = await client.query<{
      token: string;
      name: string;
      classId: number;
      className: string;
      classToken: string;
    }>(
      `
        SELECT token, name, "classId", "className", "classToken"
        FROM ${quoteIdent(targetSchema)}.aowow_character_advancement_class_types
        WHERE "classId" > 0
      `,
    );

    for (const row of typeResult.rows) {
      const classRow = result.rows.find((item) => item.id === row.classId);
      if (!classRow) continue;
      classes.set(normalizeLookup(row.token), classRow);
      classes.set(normalizeLookup(row.name), classRow);
      classes.set(normalizeLookup(row.className), classRow);
      classes.set(normalizeLookup(row.classToken), classRow);
    }
  }

  return classes;
}

async function specsByClassAndName(client: PoolClient) {
  if (!(await tableExists(client, "aowow_coa_specs"))) {
    return new Map<string, SpecRow>();
  }

  const result = await client.query<SpecRow>(
    `
      SELECT
        id,
        "classId",
        "className",
        name,
        "skillLineId"
      FROM ${quoteIdent(targetSchema)}.aowow_coa_specs
      WHERE "classId" > 0
    `,
  );

  return new Map(result.rows.map((row) => [`${row.classId}:${normalizeLookup(row.name)}`, row]));
}

async function iconsByName(client: PoolClient) {
  if (!(await tableExists(client, "aowow_icons"))) {
    return new Map<string, number>();
  }

  const result = await client.query<{ id: number; name: string }>(
    `SELECT id, name FROM ${quoteIdent(targetSchema)}.aowow_icons WHERE name IS NOT NULL AND name <> ''`,
  );

  return new Map(result.rows.map((row) => [iconName(row.name), row.id]));
}

async function existingNode(client: PoolClient, advId: number) {
  const result = await client.query<ExistingNode>(
    `
      SELECT
        id,
        "treeKey",
        "treeType",
        "ownerClassId",
        "ownerClassName",
        "ownerSpecId",
        "ownerSpecName",
        "ownerSpecSkillId",
        "tabTypeId",
        "tabName"
      FROM ${quoteIdent(targetSchema)}.aowow_talent_tree_nodes
      WHERE id = $1
      LIMIT 1
    `,
    [advId],
  );

  return result.rows[0] ?? null;
}

function isClassTree(record: ParsedTalent) {
  if (record.isClass === true) return true;
  const tab = normalizeLookup(record.tabName);
  const cls = normalizeLookup(record.className);
  return tab === "class" || tab === "general" || tab === cls || tab === `${cls}class`;
}

async function ensureTab(
  client: PoolClient,
  record: ParsedTalent,
  classRow: ClassRow,
  specRow: SpecRow | undefined,
  existing: ExistingNode | null,
) {
  const treeType = isClassTree(record) ? "class" : "spec";
  const ownerSpecId = treeType === "spec" ? (specRow?.id ?? existing?.ownerSpecId ?? 0) : 0;
  const ownerSpecName = treeType === "spec" ? (specRow?.name ?? existing?.ownerSpecName ?? record.tabName) : "";
  const ownerSpecSkillId = treeType === "spec" ? (specRow?.skillLineId ?? existing?.ownerSpecSkillId ?? 0) : 0;
  const tabTypeId = existing?.tabTypeId ?? (ownerSpecSkillId || ownerSpecId || 0);
  const treeKey = existing?.treeKey ?? (
    treeType === "class"
      ? `class:${classRow.id}`
      : `spec:${classRow.id}:${ownerSpecSkillId || ownerSpecId || normalizeLookup(record.tabName)}`
  );
  const tabId = `${treeKey}:${tabTypeId}`;

  const countResult = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM ${quoteIdent(targetSchema)}.aowow_talent_tree_tabs
      WHERE id = $1
    `,
    [tabId],
  );

  if (Number(countResult.rows[0]?.count ?? 0) > 0) {
    await client.query(
      `
        UPDATE ${quoteIdent(targetSchema)}.aowow_talent_tree_tabs
        SET
          "treeKey" = $2,
          "treeType" = $3,
          "ownerClassId" = $4,
          "ownerClassName" = $5,
          "ownerSpecId" = $6,
          "ownerSpecName" = $7,
          "ownerSpecSkillId" = $8,
          "tabTypeId" = $9,
          "tabName" = $10,
          source = 'coa_exporter_catalog'
        WHERE id = $1
      `,
      [tabId, treeKey, treeType, classRow.id, classRow.name, ownerSpecId, ownerSpecName, ownerSpecSkillId, tabTypeId, record.tabName],
    );
  } else {
    await client.query(
      `
        INSERT INTO ${quoteIdent(targetSchema)}.aowow_talent_tree_tabs (
          id,
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
          source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, '', 'coa_exporter_catalog')
      `,
      [tabId, treeKey, treeType, classRow.id, classRow.name, ownerSpecId, ownerSpecName, ownerSpecSkillId, tabTypeId, record.tabName],
    );
  }

  return { treeKey, treeType, ownerSpecId, ownerSpecName, ownerSpecSkillId, tabTypeId };
}

async function importTalents(client: PoolClient, records: ParsedTalent[]) {
  const stats: ImportStats = { seen: 0, updated: 0, inserted: 0, skipped: 0, missingClass: 0 };
  const classes = await classesByName(client);
  const specs = await specsByClassAndName(client);
  const icons = await iconsByName(client);

  for (const record of records) {
    const advId = Math.trunc(numberValue(record.advId));
    if (advId <= 0) {
      stats.skipped += 1;
      continue;
    }
    stats.seen += 1;

    const classRow = classes.get(normalizeLookup(record.className));
    if (!classRow) {
      stats.missingClass += 1;
      continue;
    }

    const existing = await existingNode(client, advId);
    const specRow = specs.get(`${classRow.id}:${normalizeLookup(record.tabName)}`);
    const tab = await ensureTab(client, record, classRow, specRow, existing);
    const iconKey = iconName(record.icon);
    const iconId = iconKey ? icons.get(iconKey) ?? 0 : 0;
    const spellIds = allSpellIds(record);
    const spellId = Math.trunc(numberValue(record.spellId)) || numberValue(spellIds.split(",")[0]);
    const name = stringValue(record.name) || `Talent #${advId}`;
    const maxRanks = Math.max(1, Math.trunc(numberValue(record.rank)) || 1);
    const connectedNodeIds = parseIdList(record.children);
    const requiredNodeIds = parseIdList(record.reqs);

    if (existing) {
      await client.query(
        `
          UPDATE ${quoteIdent(targetSchema)}.aowow_talent_tree_nodes
          SET
            "treeKey" = $2,
            "treeType" = $3,
            "ownerClassId" = $4,
            "ownerClassName" = $5,
            "ownerSpecId" = $6,
            "ownerSpecName" = $7,
            "ownerSpecSkillId" = $8,
            "tabTypeId" = $9,
            "tabName" = $10,
            row = $11,
            col = $12,
            name = $13,
            icon = COALESCE(NULLIF($14, ''), icon),
            "iconId" = CASE WHEN $15 > 0 THEN $15 ELSE "iconId" END,
            "maxRanks" = $16,
            "spellId" = CASE WHEN $17 > 0 THEN $17 ELSE "spellId" END,
            "allSpellIds" = COALESCE(NULLIF($18, ''), "allSpellIds"),
            "connectedNodeIds" = $19,
            "requiredNodeIds" = $20,
            "talentCost" = $21,
            "abilityEssenceCost" = $22,
            "talentEssenceCost" = $23,
            "requiredAEInvestment" = $24,
            "requiredTEInvestment" = $25,
            "requiredTabAEInvestment" = $26,
            "requiredTabTEInvestment" = $27,
            "requiredLevel" = $28,
            "minLevel" = $29,
            "choiceIndex" = $30,
            "nodeType" = $31,
            flags = $32,
            "isPassive" = $33,
            "groupId" = CASE WHEN $34 > 0 THEN $34 ELSE "groupId" END,
            "clientDescription" = $35,
            "clientFlavorText" = $36,
            "clientCategory" = $37,
            "unlockCondition" = $38,
            source = 'coa_exporter_catalog'
          WHERE id = $1
        `,
        [
          advId,
          tab.treeKey,
          tab.treeType,
          classRow.id,
          classRow.name,
          tab.ownerSpecId,
          tab.ownerSpecName,
          tab.ownerSpecSkillId,
          tab.tabTypeId,
          record.tabName,
          Math.trunc(numberValue(record.tier)),
          Math.trunc(numberValue(record.col)),
          name,
          stringValue(record.icon),
          iconId,
          maxRanks,
          spellId,
          spellIds,
          connectedNodeIds,
          requiredNodeIds,
          Math.trunc(numberValue(record.cost)),
          Math.trunc(numberValue(record.aeCost)),
          Math.trunc(numberValue(record.teCost)),
          Math.trunc(numberValue(record.requiredAEInvestment)),
          Math.trunc(numberValue(record.requiredTEInvestment)),
          Math.trunc(numberValue(record.requiredTabAEInvestment)),
          Math.trunc(numberValue(record.requiredTabTEInvestment)),
          Math.trunc(numberValue(record.requiredLevel)),
          Math.trunc(numberValue(record.minLevel)),
          Math.trunc(numberValue(record.choiceIndex)),
          stringValue(record.nodeType),
          Math.trunc(numberValue(record.flags)),
          record.isPassive === true,
          Math.trunc(numberValue(record.groupID)),
          stringValue(record.description),
          stringValue(record.flavorText),
          stringValue(record.category),
          stringValue(record.unlockCondition),
        ],
      );
      stats.updated += 1;
    } else {
      await client.query(
        `
          INSERT INTO ${quoteIdent(targetSchema)}.aowow_talent_tree_nodes (
            id,
            "treeKey",
            "treeType",
            "ownerClassId",
            "ownerClassName",
            "ownerSpecId",
            "ownerSpecName",
            "ownerSpecSkillId",
            "tabTypeId",
            "tabName",
            type,
            "parentId",
            "groupId",
            row,
            col,
            name,
            icon,
            "iconId",
            "maxRanks",
            "spellId",
            "allSpellIds",
            prerequisite,
            anchor,
            color,
            shape,
            source,
            "connectedNodeIds",
            "requiredNodeIds",
            "talentCost",
            "abilityEssenceCost",
            "talentEssenceCost",
            "requiredAEInvestment",
            "requiredTEInvestment",
            "requiredTabAEInvestment",
            "requiredTabTEInvestment",
            "requiredLevel",
            "minLevel",
            "choiceIndex",
            "nodeType",
            flags,
            "isPassive",
            "clientDescription",
            "clientFlavorText",
            "clientCategory",
            "unlockCondition"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, 0, $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, '', '', '', 'coa_exporter_catalog',
            $22, $23, $24, $25, $26, $27, $28, $29, $30, $31,
            $32, $33, $34, $35, $36, $37, $38
          )
        `,
        [
          advId,
          tab.treeKey,
          tab.treeType,
          classRow.id,
          classRow.name,
          tab.ownerSpecId,
          tab.ownerSpecName,
          tab.ownerSpecSkillId,
          tab.tabTypeId,
          record.tabName,
          stringValue(record.type) || "Talent",
          Math.trunc(numberValue(record.groupID)),
          Math.trunc(numberValue(record.tier)),
          Math.trunc(numberValue(record.col)),
          name,
          stringValue(record.icon),
          iconId,
          maxRanks,
          spellId,
          spellIds,
          requiredNodeIds,
          connectedNodeIds,
          requiredNodeIds,
          Math.trunc(numberValue(record.cost)),
          Math.trunc(numberValue(record.aeCost)),
          Math.trunc(numberValue(record.teCost)),
          Math.trunc(numberValue(record.requiredAEInvestment)),
          Math.trunc(numberValue(record.requiredTEInvestment)),
          Math.trunc(numberValue(record.requiredTabAEInvestment)),
          Math.trunc(numberValue(record.requiredTabTEInvestment)),
          Math.trunc(numberValue(record.requiredLevel)),
          Math.trunc(numberValue(record.minLevel)),
          Math.trunc(numberValue(record.choiceIndex)),
          stringValue(record.nodeType),
          Math.trunc(numberValue(record.flags)),
          record.isPassive === true,
          stringValue(record.description),
          stringValue(record.flavorText),
          stringValue(record.category),
          stringValue(record.unlockCondition),
        ],
      );
      stats.inserted += 1;
    }
  }

  return stats;
}

async function main() {
  if (!connectionString) {
    throw new Error("GAME_DATABASE_URL or DATABASE_URL must be set.");
  }
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const parsed = parseInput(inputPath);
  const history = await startImportJob({
    connectionString,
    type: "game:import-coa-talents",
    source: inputPath,
    metadata: { targetSchema, records: parsed.records.length, ...parsed.meta },
  });

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await history.log("INFO", "Starting CoaExporter talent layout import.", {
      records: parsed.records.length,
      targetSchema,
    });

    await client.query("BEGIN");
    if (!(await tableExists(client, "aowow_talent_tree_nodes")) || !(await tableExists(client, "aowow_talent_tree_tabs"))) {
      throw new Error("Run pnpm game:import-ascension before importing CoaExporter talents.");
    }
    await ensureTalentColumns(client);
    const stats = await importTalents(client, parsed.records);
    await client.query("COMMIT");

    await history.finish("SUCCESS", stats);
    console.log(`Imported CoaExporter talents into schema "${targetSchema}".`);
    console.log(`Talents: seen=${stats.seen} updated=${stats.updated} inserted=${stats.inserted} missingClass=${stats.missingClass} skipped=${stats.skipped}`);
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    await history.log("ERROR", "CoaExporter talent import failed.", { error: message });
    await history.finish("FAILED", { error: message });
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
