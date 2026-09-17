import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { startImportJob } from "./lib/import-history";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

type AtlasMenu = {
  key: string;
  module: string;
  name: string;
  displayName: string | null;
  type: string | null;
  map: string | null;
  pages: string[];
};

type AtlasPath = {
  tableId: string;
  expansion: string;
  category: string;
  section: string;
  label: string;
  sortOrder: number;
  metadata?: Record<string, unknown>;
};

type AtlasTable = {
  id: string;
  module: string;
  expansion: string;
  category: string;
  name: string;
  displayName: string | null;
  type: string | null;
  map: string | null;
  sourceFile: string;
  sourceLine: number;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

type AtlasEntry = {
  tableId: string;
  pageIndex: number;
  pageName: string;
  groupIndex: number;
  groupName: string | null;
  position: number;
  entityKind: "items" | "spells";
  entityId: number;
  itemId: number | null;
  spellId: number | null;
  itemName: string | null;
  icon: string | null;
  refLootEntry: number | null;
  groupId: number | null;
  minDifficulty: string | null;
  maxDifficulty: string | null;
  price: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  sourceFile: string;
  sourceLine: number;
};

type ParsedAtlasLoot = {
  tables: AtlasTable[];
  paths: AtlasPath[];
  entries: AtlasEntry[];
  files: number;
  digest: string;
};

const moduleExpansion: Record<string, string> = {
  AtlasLoot_OriginalWoW: "Classic",
  AtlasLoot_Crafting_OriginalWoW: "Classic",
  AtlasLoot_BurningCrusade: "Burning Crusade",
  AtlasLoot_Crafting_TBC: "Burning Crusade",
  AtlasLoot_WrathoftheLichKing: "Wrath of the Lich King",
  AtlasLoot_Crafting_Wrath: "Wrath of the Lich King",
  AtlasLoot_WorldEvents: "World Events",
  AtlasLoot_Vanity: "Vanity",
};

const luaIdentifierLabels: Record<string, string> = {
  ALCHEMY: "Alchemy",
  ARMORSMITH: "Armorsmith",
  AXESMITH: "Axesmith",
  BLACKSMITHING: "Blacksmithing",
  COOKING: "Cooking",
  DRAGONSCALE: "Dragonscale",
  ELEMENTAL: "Elemental",
  ENCHANTING: "Enchanting",
  ENGINEERING: "Engineering",
  FIRSTAID: "First Aid",
  GNOMISH: "Gnomish",
  GOBLIN: "Goblin",
  HAMMERSMITH: "Hammersmith",
  JEWELCRAFTING: "Jewelcrafting",
  LEATHERWORKING: "Leatherworking",
  MINING: "Mining",
  MOONCLOTH: "Mooncloth",
  SHADOWEAVE: "Shadoweave",
  SPELLFIRE: "Spellfire",
  SWORDSMITH: "Swordsmith",
  TAILORING: "Tailoring",
  TRIBAL: "Tribal",
  WEAPONSMITH: "Weaponsmith",
};

function appConnectionString() {
  const raw =
    process.env.DATABASE_URL ??
    "postgresql://coatavern:coatavern@localhost:5432/coatavern?schema=app";
  const url = new URL(raw);
  url.searchParams.delete("schema");
  return url.toString();
}

function addonPathFromArgs() {
  const arg = process.argv.find((value) => value.startsWith("--addon="));
  return path.resolve(arg?.slice("--addon=".length) ?? "AtlasLootAddon");
}

function isDryRun() {
  return process.argv.includes("--dry-run");
}

function walkLuaFiles(root: string) {
  const files: string[] = [];

  function walk(current: string) {
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".lua")) {
        files.push(fullPath);
      }
    }
  }

  walk(root);
  return files.sort();
}

function stripLineComment(line: string) {
  let inString = false;
  let quote = "";
  for (let index = 0; index < line.length - 1; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (inString) {
      if (char === "\\" && next) {
        index += 1;
        continue;
      }
      if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "-" && next === "-") {
      return line.slice(0, index);
    }
  }
  return line;
}

function countBraces(line: string) {
  const clean = stripLineComment(line);
  let inString = false;
  let quote = "";
  let delta = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    const next = clean[index + 1];
    if (inString) {
      if (char === "\\" && next) {
        index += 1;
        continue;
      }
      if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "{") delta += 1;
    if (char === "}") delta -= 1;
  }
  return delta;
}

function findBalancedBlock(content: string, openBraceIndex: number) {
  let depth = 0;
  let inString = false;
  let quote = "";
  let line = content.slice(0, openBraceIndex).split(/\r?\n/).length;

  for (let index = openBraceIndex; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === "\n") line += 1;

    if (inString) {
      if (char === "\\" && next) {
        index += 1;
        continue;
      }
      if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      const newline = content.indexOf("\n", index + 2);
      if (newline === -1) break;
      index = newline - 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          block: content.slice(openBraceIndex, index + 1),
          endIndex: index + 1,
          startLine: content.slice(0, openBraceIndex).split(/\r?\n/).length,
          endLine: line,
        };
      }
    }
  }

  return null;
}

function luaStrings(value: string) {
  return [...value.matchAll(/"((?:\\"|[^"])*)"/g)].map((match) =>
    match[1].replace(/\\"/g, "\""),
  );
}

function cleanLuaText(value: string | null | undefined) {
  if (!value) return "";
  return luaStrings(value)
    .join("")
    .replace(/\|c[0-9a-f]{8}/gi, "")
    .replace(/\|r/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLuaIdentifier(value: string | null | undefined) {
  const clean = (value ?? "")
    .replace(/[{},]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const identifier = clean.match(/^[A-Z][A-Z0-9_]*$/)?.[0];
  return identifier ? luaIdentifierLabels[identifier] ?? null : null;
}

function keyString(block: string, key: string) {
  const match = block.match(new RegExp(`\\b${key}\\s*=\\s*([^,\\n]+)`));
  return cleanLuaText(match?.[1]) || cleanLuaIdentifier(match?.[1]) || "";
}

function keyNumber(line: string, key: string) {
  const match = line.match(new RegExp(`\\b${key}\\s*=\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

function keyText(line: string, key: string) {
  const match = line.match(new RegExp(`\\b${key}\\s*=\\s*([^,}]+)`));
  const text = cleanLuaText(match?.[1]);
  return text || cleanLuaIdentifier(match?.[1]) || null;
}

function pageNameFromLines(lines: string[], index: number) {
  const inlineName = keyText(stripLineComment(lines[index]).trim(), "Name");
  if (inlineName) return inlineName;

  for (let lookahead = index + 1; lookahead < Math.min(index + 8, lines.length); lookahead += 1) {
    const clean = stripLineComment(lines[lookahead]).trim();
    if (clean.includes("itemID") || clean.includes("spellID")) break;
    const name = keyText(clean, "Name");
    if (name) return name;
  }

  return null;
}

function relative(root: string, file: string) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function expansionFromKey(collectionKey: string, module: string) {
  if (collectionKey.endsWith("CLASSIC")) return "Classic";
  if (collectionKey.endsWith("TBC")) return "Burning Crusade";
  if (collectionKey.endsWith("WRATH")) return "Wrath of the Lich King";
  return moduleExpansion[module] ?? "Other";
}

function categoryFromCollectionKey(collectionKey: string) {
  return collectionKey
    .replace(/(CLASSIC|TBC|WRATH)$/, "")
    .replace(/^PVP$/, "PvP Rewards")
    .replace(/^WorldEvents$/, "World Events")
    .replace(/^Collections$/, "Sets/Collections")
    .replace(/^Dungeons and Raids$/, "Dungeons and Raids")
    .replace(/^MysticEnchants$/, "Mystic Enchants")
    .replace(/^Worldforged$/, "Worldforged");
}

function categoryFromType(type: string | null, module: string) {
  if (module.includes("Crafting") || type?.includes("Crafting")) return "Crafting";
  if (type?.includes("Dungeon") || type?.includes("Raid")) return "Dungeons and Raids";
  if (type?.includes("PVP") || type?.includes("PvP")) return "PvP Rewards";
  if (module === "AtlasLoot_WorldEvents") return "World Events";
  if (module === "AtlasLoot_Vanity") return "Vanity";
  return "Sets/Collections";
}

function parseMenus(addonRoot: string, files: string[]) {
  const menus = new Map<string, AtlasMenu>();
  const menuFiles = files.filter((file) => file.includes(`${path.sep}AtlasLoot${path.sep}UI${path.sep}Menus`));

  for (const file of menuFiles) {
    const content = readFileSync(file, "utf8");
    const regex = /\["([^"]+)"\]\s*=\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) {
      const open = content.indexOf("{", match.index);
      const found = findBalancedBlock(content, open);
      if (!found) continue;

      const key = match[1];
      const block = found.block;
      const moduleName = keyString(block, "Module");
      const name = keyString(block, "Name") || key;
      const displayName = keyString(block, "DisplayName") || null;
      const type = keyString(block, "Type") || null;
      const map = keyString(block, "Map") || null;
      const pages = block
        .split(/\r?\n/)
        .map((line) => {
          const clean = stripLineComment(line).trim();
          if (!clean.startsWith("{") || clean.includes("=")) return "";
          const strings = luaStrings(clean);
          if (strings.length) return strings.join("").trim();
          const identifier = clean.match(/^\{\s*([A-Z][A-Z0-9_]*)\s*,/)?.[1];
          return identifier ? luaIdentifierLabels[identifier] ?? "" : "";
        })
        .filter(Boolean);

      menus.set(key, {
        key,
        module: moduleName,
        name,
        displayName,
        type,
        map,
        pages,
      });
      regex.lastIndex = found.endIndex;
    }
  }

  return menus;
}

function parseCollectionPaths(files: string[]) {
  const paths: AtlasPath[] = [];
  const menuFile = files.find((file) => file.endsWith(`${path.sep}AtlasLoot${path.sep}UI${path.sep}Menus.lua`));
  if (!menuFile) return paths;

  const content = readFileSync(menuFile, "utf8");
  const regex = /collection(?:\["([^"]+)"\]|\.([A-Za-z0-9_ ]+))\s*=\s*\{/g;
  let match: RegExpExecArray | null;
  let order = 0;

  while ((match = regex.exec(content))) {
    const collectionKey = match[1] ?? match[2];
    const open = content.indexOf("{", match.index);
    const found = findBalancedBlock(content, open);
    if (!found) continue;

    const block = found.block;
    const moduleName = keyString(block, "Module");
    const expansion = expansionFromKey(collectionKey, moduleName);
    const category = categoryFromCollectionKey(collectionKey);
    let section = category;

    for (const line of block.split(/\r?\n/)) {
      const clean = stripLineComment(line).trim();
      if (!clean.startsWith("{")) continue;
      const strings = luaStrings(clean);
      const tableId = strings[0];
      if (!tableId || tableId === "Module") continue;
      const header = keyText(clean, "Header");
      if (header) section = header.replace(/:$/, "");
      paths.push({
        tableId,
        expansion,
        category,
        section,
        label: strings[2] ?? strings[0],
        sortOrder: order,
        metadata: header ? { header } : {},
      });
      order += 1;
    }

    regex.lastIndex = found.endIndex;
  }

  return paths;
}

function parseEntryMetadata(line: string) {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of line.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*({[^}]*}|"[^"]*"|\d+)/g)) {
    if (key === "itemID" || key === "spellID") continue;
    if (/^\d+$/.test(value)) {
      metadata[key] = Number(value);
    } else if (value.startsWith("{")) {
      metadata[key] = luaStrings(value);
    } else {
      metadata[key] = cleanLuaText(value);
    }
  }
  return metadata;
}

function parseDataBlock({
  addonRoot,
  file,
  key,
  block,
  startLine,
  sortOrder,
  menu,
}: {
  addonRoot: string;
  file: string;
  key: string;
  block: string;
  startLine: number;
  sortOrder: number;
  menu?: AtlasMenu;
}) {
  const sourceFile = relative(addonRoot, file);
  const moduleName = keyString(block, "Module") || menu?.module || "AtlasLoot";
  const type = keyString(block, "Type") || menu?.type || null;
  const map = keyString(block, "Map") || menu?.map || null;
  const name = menu?.name || keyString(block, "Name") || key;
  const displayName = menu?.displayName || keyString(block, "DisplayName") || null;
  const expansion = moduleExpansion[moduleName] ?? "Other";
  const category = categoryFromType(type, moduleName);
  const table: AtlasTable = {
    id: key,
    module: moduleName,
    expansion,
    category,
    name,
    displayName,
    type,
    map,
    sourceFile,
    sourceLine: startLine,
    sortOrder,
    metadata: {
      addonTable: key,
    },
  };
  const entries: AtlasEntry[] = [];
  const lines = block.split(/\r?\n/);
  let depth = 0;
  let pageIndex = 0;
  let pageName = "";
  let groupIndex = 0;
  let groupName: string | null = null;
  let position = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const clean = stripLineComment(line).trim();
    const before = depth;

    const hasLootEntity = clean.includes("itemID") || clean.includes("spellID");

    if (before === 1 && clean.startsWith("{")) {
      pageIndex += 1;
      pageName = pageNameFromLines(lines, index) || menu?.pages[pageIndex - 1] || `${name} ${pageIndex}`;
      groupIndex = 0;
      groupName = null;
      position = 0;
    } else if (before === 2 && clean.startsWith("{") && !hasLootEntity) {
      groupIndex += 1;
      groupName = null;
      position = 0;
    } else if (before >= 3 && clean.startsWith("{") && !hasLootEntity) {
      const header = keyText(clean, "name");
      if (header) groupName = header;
    }

    if (hasLootEntity) {
      const itemId = keyNumber(clean, "itemID");
      const spellId = keyNumber(clean, "spellID");
      const entityId = itemId ?? spellId;
      if (entityId) {
        position += 1;
        const comment = line.match(/--\s*(.+)$/)?.[1]?.trim() ?? null;
        entries.push({
          tableId: key,
          pageIndex: pageIndex || 1,
          pageName: pageName || name,
          groupIndex: groupIndex || 1,
          groupName,
          position,
          entityKind: itemId ? "items" : "spells",
          entityId,
          itemId,
          spellId,
          itemName: comment,
          icon: keyText(clean, "icon"),
          refLootEntry: keyNumber(clean, "refLootEntry"),
          groupId: keyNumber(clean, "groupID"),
          minDifficulty: keyText(clean, "minDifficulty"),
          maxDifficulty: keyText(clean, "maxDifficulty"),
          price: keyText(clean, "price"),
          description: keyText(clean, "desc") ?? keyText(clean, "rep"),
          metadata: parseEntryMetadata(clean),
          sourceFile,
          sourceLine: startLine + index,
        });
      }
    }

    depth += countBraces(line);
  }

  return { table, entries };
}

export function parseAtlasLoot(addonRoot: string): ParsedAtlasLoot {
  const files = walkLuaFiles(addonRoot);
  const menus = parseMenus(addonRoot, files);
  const rawPaths = parseCollectionPaths(files);
  const tables = new Map<string, AtlasTable>();
  const entries: AtlasEntry[] = [];
  const digest = createHash("sha256");
  let sortOrder = 0;

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    digest.update(relative(addonRoot, file));
    digest.update(content);
    const regex = /AtlasLoot_Data\["([^"]+)"\]\s*=\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) {
      const key = match[1];
      const open = content.indexOf("{", match.index);
      const found = findBalancedBlock(content, open);
      if (!found) continue;

      const parsed = parseDataBlock({
        addonRoot,
        file,
        key,
        block: found.block,
        startLine: found.startLine,
        sortOrder,
        menu: menus.get(key),
      });
      tables.set(parsed.table.id, parsed.table);
      entries.push(...parsed.entries);
      sortOrder += 1;
      regex.lastIndex = found.endIndex;
    }
  }

  const paths = rawPaths
    .filter((item) => tables.has(item.tableId))
    .map((item) => ({
      ...item,
      label: menus.get(item.tableId)?.displayName || menus.get(item.tableId)?.name || item.label,
    }));

  for (const table of tables.values()) {
    if (paths.some((item) => item.tableId === table.id)) continue;
    paths.push({
      tableId: table.id,
      expansion: table.expansion,
      category: table.category,
      section: table.type ?? table.category,
      label: table.displayName || table.name,
      sortOrder: table.sortOrder + 100000,
    });
  }

  return {
    tables: [...tables.values()],
    paths,
    entries,
    files: files.length,
    digest: digest.digest("hex"),
  };
}

async function ensureTables(pool: Pool) {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS app;
    CREATE TABLE IF NOT EXISTS app.atlasloot_tables (
      id TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      expansion TEXT NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      display_name TEXT,
      type TEXT,
      map TEXT,
      source_file TEXT NOT NULL,
      source_line INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app.atlasloot_table_paths (
      id BIGSERIAL PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES app.atlasloot_tables(id) ON DELETE CASCADE,
      expansion TEXT NOT NULL,
      category TEXT NOT NULL,
      section TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS app.atlasloot_entries (
      id BIGSERIAL PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES app.atlasloot_tables(id) ON DELETE CASCADE,
      page_index INTEGER NOT NULL,
      page_name TEXT NOT NULL,
      group_index INTEGER NOT NULL,
      group_name TEXT,
      position INTEGER NOT NULL,
      entity_kind TEXT NOT NULL DEFAULT 'items',
      entity_id INTEGER NOT NULL DEFAULT 0,
      item_id INTEGER,
      spell_id INTEGER,
      item_name TEXT,
      icon TEXT,
      ref_loot_entry INTEGER,
      group_id INTEGER,
      min_difficulty TEXT,
      max_difficulty TEXT,
      price TEXT,
      description TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_file TEXT NOT NULL,
      source_line INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS atlasloot_tables_module_idx ON app.atlasloot_tables (module, sort_order);
    CREATE INDEX IF NOT EXISTS atlasloot_table_paths_tree_idx ON app.atlasloot_table_paths (expansion, category, section, sort_order);
    CREATE INDEX IF NOT EXISTS atlasloot_table_paths_table_idx ON app.atlasloot_table_paths (table_id);
    CREATE INDEX IF NOT EXISTS atlasloot_entries_table_page_idx ON app.atlasloot_entries (table_id, page_index, group_index, position);
    CREATE INDEX IF NOT EXISTS atlasloot_entries_item_idx ON app.atlasloot_entries (item_id);
  `);
  await pool.query(`
    ALTER TABLE app.atlasloot_entries
      ADD COLUMN IF NOT EXISTS entity_kind TEXT NOT NULL DEFAULT 'items',
      ADD COLUMN IF NOT EXISTS entity_id INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS spell_id INTEGER,
      ADD COLUMN IF NOT EXISTS icon TEXT;
    ALTER TABLE app.atlasloot_entries
      ALTER COLUMN item_id DROP NOT NULL;
    UPDATE app.atlasloot_entries
      SET entity_kind = COALESCE(NULLIF(entity_kind, ''), 'items'),
          entity_id = CASE WHEN entity_id = 0 THEN COALESCE(item_id, spell_id, 0) ELSE entity_id END;
    CREATE INDEX IF NOT EXISTS atlasloot_entries_entity_idx ON app.atlasloot_entries (entity_kind, entity_id);
  `);
}

async function insertBatch(pool: Pool, sqlPrefix: string, rows: unknown[][], columnsPerRow: number) {
  const batchSize = 500;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = batch.flat();
    const placeholders = batch
      .map((_, rowIndex) => {
        const base = rowIndex * columnsPerRow;
        return `(${Array.from({ length: columnsPerRow }, (_value, columnIndex) => `$${base + columnIndex + 1}`).join(", ")})`;
      })
      .join(", ");
    await pool.query(`${sqlPrefix} ${placeholders}`, values);
  }
}

async function importAtlasLoot(parsed: ParsedAtlasLoot, connectionString: string) {
  const pool = new Pool({ connectionString });
  try {
    await ensureTables(pool);
    await pool.query("BEGIN");
    await pool.query("TRUNCATE app.atlasloot_entries, app.atlasloot_table_paths, app.atlasloot_tables RESTART IDENTITY");

    await insertBatch(
      pool,
      `INSERT INTO app.atlasloot_tables
      (id, module, expansion, category, name, display_name, type, map, source_file, source_line, sort_order, metadata)
      VALUES`,
      parsed.tables.map((table) => [
        table.id,
        table.module,
        table.expansion,
        table.category,
        table.name,
        table.displayName,
        table.type,
        table.map,
        table.sourceFile,
        table.sourceLine,
        table.sortOrder,
        JSON.stringify(table.metadata),
      ]),
      12,
    );

    await insertBatch(
      pool,
      `INSERT INTO app.atlasloot_table_paths
      (table_id, expansion, category, section, label, sort_order, metadata)
      VALUES`,
      parsed.paths.map((item) => [
        item.tableId,
        item.expansion,
        item.category,
        item.section,
        item.label,
        item.sortOrder,
        JSON.stringify(item.metadata ?? {}),
      ]),
      7,
    );

    await insertBatch(
      pool,
      `INSERT INTO app.atlasloot_entries
      (table_id, page_index, page_name, group_index, group_name, position, entity_kind, entity_id, item_id, spell_id, item_name, icon, ref_loot_entry, group_id, min_difficulty, max_difficulty, price, description, metadata, source_file, source_line)
      VALUES`,
      parsed.entries.map((entry) => [
        entry.tableId,
        entry.pageIndex,
        entry.pageName,
        entry.groupIndex,
        entry.groupName,
        entry.position,
        entry.entityKind,
        entry.entityId,
        entry.itemId,
        entry.spellId,
        entry.itemName,
        entry.icon,
        entry.refLootEntry,
        entry.groupId,
        entry.minDifficulty,
        entry.maxDifficulty,
        entry.price,
        entry.description,
        JSON.stringify(entry.metadata),
        entry.sourceFile,
        entry.sourceLine,
      ]),
      21,
    );

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
}

async function main() {
  const addonRoot = addonPathFromArgs();
  if (!existsSync(addonRoot)) {
    throw new Error(`AtlasLoot addon folder not found: ${addonRoot}`);
  }

  const parsed = parseAtlasLoot(addonRoot);
  const source = path.relative(process.cwd(), addonRoot);
  const connectionString = appConnectionString();
  const recorder = await startImportJob({
    connectionString,
    type: "ATLASLOOT",
    source,
    metadata: {
      files: parsed.files,
      tables: parsed.tables.length,
      entries: parsed.entries.length,
      digest: parsed.digest,
    },
  });

  try {
    if (!isDryRun()) {
      await importAtlasLoot(parsed, connectionString);
    }
    await recorder.log("INFO", isDryRun() ? "Parsed AtlasLoot data." : "Imported AtlasLoot data.", {
      tables: parsed.tables.length,
      paths: parsed.paths.length,
      entries: parsed.entries.length,
    });
    await recorder.finish("SUCCESS", {
      dryRun: isDryRun(),
      files: parsed.files,
      tables: parsed.tables.length,
      paths: parsed.paths.length,
      entries: parsed.entries.length,
      digest: parsed.digest,
    });
    console.log(
      `${isDryRun() ? "Parsed" : "Imported"} AtlasLoot: ${parsed.tables.length} tables, ${parsed.paths.length} paths, ${parsed.entries.length} entries from ${parsed.files} Lua files.`,
    );
  } catch (error) {
    await recorder.log("ERROR", "AtlasLoot import failed.", {
      error: error instanceof Error ? error.message : String(error),
    });
    await recorder.finish("FAILED");
    throw error;
  } finally {
    await recorder.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
