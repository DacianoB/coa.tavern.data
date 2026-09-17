import { existsSync, readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { startImportJob } from "./lib/import-history";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

type ScrapeLine = {
  index?: number;
  left?: string;
  right?: string;
  leftColor?: string;
  rightColor?: string;
};

type ScrapeRecord = {
  id?: number;
  name?: string;
  rank?: string;
  quality?: number;
  itemLevel?: number;
  requiredLevel?: number;
  icon?: string;
  tooltip?: {
    plain?: string;
    lines?: ScrapeLine[];
  };
};

type ScrapePayload = {
  items?: Record<string, ScrapeRecord>;
  spells?: Record<string, ScrapeRecord>;
};

type ImportStats = {
  seen: number;
  updated: number;
  missing: number;
  skipped: number;
};

const connectionString = process.env.GAME_DATABASE_URL || process.env.DATABASE_URL;
const targetSchema = process.env.GAME_DATABASE_SCHEMA || "game";
const inputPath = process.argv[2] || "output/coa-exporter-scrape.json";
const overwrite = process.env.COA_SCRAPE_OVERWRITE === "1";

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

function isEmptyDbValue(value: unknown) {
  return value === null || value === undefined || value === "" || value === 0;
}

function isPlaceholderName(value: unknown, id: number, kind: "item" | "spell") {
  const text = stringValue(value);
  if (!text) return true;
  const label = kind === "item" ? "Item" : "Spell";
  return text === `${label} #${id}`;
}

function normalizeIconName(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.(jpg|jpeg|png|webp|blp)$/i, "")
    .toLowerCase() ?? "";
}

function shouldSetText(current: unknown, incoming: string) {
  return incoming !== "" && (overwrite || isEmptyDbValue(current));
}

function shouldSetNumber(current: unknown, incoming: number) {
  return incoming > 0 && (overwrite || isEmptyDbValue(current));
}

async function tableColumns(client: PoolClient, tableName: string) {
  const result = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
    `,
    [targetSchema, tableName],
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
    [targetSchema, tableName],
  );

  return result.rows[0]?.exists === true;
}

async function iconIdByName(client: PoolClient) {
  if (!(await tableExists(client, "aowow_icons"))) return new Map<string, number>();

  const columns = await tableColumns(client, "aowow_icons");
  if (!columns.has("id") || !columns.has("name")) return new Map<string, number>();

  const result = await client.query<{ id: number; name: string }>(
    `SELECT id, name FROM ${quoteIdent(targetSchema)}.aowow_icons WHERE name IS NOT NULL AND name <> ''`,
  );

  return new Map(
    result.rows.map((row) => [normalizeIconName(row.name), numberValue(row.id)]),
  );
}

async function updateRow(
  client: PoolClient,
  tableName: string,
  id: number,
  updates: Record<string, string | number>,
) {
  const entries = Object.entries(updates);
  if (entries.length === 0) return false;

  const setSql = entries
    .map(([column], index) => `${quoteIdent(column)} = $${index + 1}`)
    .join(", ");
  const values = entries.map(([, value]) => value);

  await client.query(
    `UPDATE ${quoteIdent(targetSchema)}.${quoteIdent(tableName)}
     SET ${setSql}
     WHERE id = $${values.length + 1}`,
    [...values, id],
  );

  return true;
}

async function importItems(
  client: PoolClient,
  payload: ScrapePayload,
  icons: Map<string, number>,
) {
  const stats: ImportStats = { seen: 0, updated: 0, missing: 0, skipped: 0 };
  if (!(await tableExists(client, "aowow_items"))) return stats;

  const columns = await tableColumns(client, "aowow_items");
  if (!columns.has("id")) return stats;

  for (const [key, record] of Object.entries(payload.items ?? {})) {
    const id = numberValue(record.id ?? key);
    if (id <= 0) continue;
    stats.seen += 1;

    const currentResult = await client.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdent(targetSchema)}.aowow_items WHERE id = $1`,
      [id],
    );
    const current = currentResult.rows[0];
    if (!current) {
      stats.missing += 1;
      continue;
    }

    const updates: Record<string, string | number> = {};
    const name = stringValue(record.name);
    const tooltip = stringValue(record.tooltip?.plain);
    const iconKey = normalizeIconName(stringValue(record.icon));
    const iconId = iconKey ? icons.get(iconKey) ?? 0 : 0;

    if (
      columns.has("name_loc0") &&
      name &&
      (overwrite || isPlaceholderName(current.name_loc0, id, "item"))
    ) {
      updates.name_loc0 = name;
    }
    if (columns.has("description_loc0") && shouldSetText(current.description_loc0, tooltip)) {
      updates.description_loc0 = tooltip;
    }
    if (columns.has("quality") && shouldSetNumber(current.quality, numberValue(record.quality))) {
      updates.quality = numberValue(record.quality);
    }
    if (columns.has("itemLevel") && shouldSetNumber(current.itemLevel, numberValue(record.itemLevel))) {
      updates.itemLevel = numberValue(record.itemLevel);
    }
    if (
      columns.has("requiredLevel") &&
      shouldSetNumber(current.requiredLevel, numberValue(record.requiredLevel))
    ) {
      updates.requiredLevel = numberValue(record.requiredLevel);
    }
    if (columns.has("iconId") && iconId > 0 && shouldSetNumber(current.iconId, iconId)) {
      updates.iconId = iconId;
    }

    if (await updateRow(client, "aowow_items", id, updates)) {
      stats.updated += 1;
    } else {
      stats.skipped += 1;
    }
  }

  return stats;
}

async function importSpells(
  client: PoolClient,
  payload: ScrapePayload,
  icons: Map<string, number>,
) {
  const stats: ImportStats = { seen: 0, updated: 0, missing: 0, skipped: 0 };
  if (!(await tableExists(client, "aowow_spell"))) return stats;

  const columns = await tableColumns(client, "aowow_spell");
  if (!columns.has("id")) return stats;

  for (const [key, record] of Object.entries(payload.spells ?? {})) {
    const id = numberValue(record.id ?? key);
    if (id <= 0) continue;
    stats.seen += 1;

    const currentResult = await client.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdent(targetSchema)}.aowow_spell WHERE id = $1`,
      [id],
    );
    const current = currentResult.rows[0];
    if (!current) {
      stats.missing += 1;
      continue;
    }

    const updates: Record<string, string | number> = {};
    const name = stringValue(record.name);
    const rank = stringValue(record.rank);
    const tooltip = stringValue(record.tooltip?.plain);
    const iconKey = normalizeIconName(stringValue(record.icon));
    const iconId = iconKey ? icons.get(iconKey) ?? 0 : 0;

    if (
      columns.has("name_loc0") &&
      name &&
      (overwrite || isPlaceholderName(current.name_loc0, id, "spell"))
    ) {
      updates.name_loc0 = name;
    }
    if (columns.has("rank_loc0") && shouldSetText(current.rank_loc0, rank)) {
      updates.rank_loc0 = rank;
    }
    if (columns.has("description_loc0") && shouldSetText(current.description_loc0, tooltip)) {
      updates.description_loc0 = tooltip;
    } else if (columns.has("buff_loc0") && shouldSetText(current.buff_loc0, tooltip)) {
      updates.buff_loc0 = tooltip;
    }
    if (columns.has("iconId") && iconId > 0 && shouldSetNumber(current.iconId, iconId)) {
      updates.iconId = iconId;
    }

    if (await updateRow(client, "aowow_spell", id, updates)) {
      stats.updated += 1;
    } else {
      stats.skipped += 1;
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

  const history = await startImportJob({
    connectionString,
    type: "game:import-coa-scrape",
    source: inputPath,
    metadata: { targetSchema, overwrite },
  });

  const payload = JSON.parse(readFileSync(inputPath, "utf-8")) as ScrapePayload;
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await history.log("INFO", "Starting CoaExporter scrape import.", {
      items: Object.keys(payload.items ?? {}).length,
      spells: Object.keys(payload.spells ?? {}).length,
    });
    await client.query("BEGIN");
    const icons = await iconIdByName(client);
    const itemStats = await importItems(client, payload, icons);
    const spellStats = await importSpells(client, payload, icons);
    await client.query("COMMIT");
    await history.finish("SUCCESS", { itemStats, spellStats });

    console.log(`Imported CoaExporter scrape into schema "${targetSchema}".`);
    console.log(`Items: seen=${itemStats.seen} updated=${itemStats.updated} missing=${itemStats.missing} skipped=${itemStats.skipped}`);
    console.log(`Spells: seen=${spellStats.seen} updated=${spellStats.updated} missing=${spellStats.missing} skipped=${spellStats.skipped}`);
    console.log(`Overwrite mode: ${overwrite ? "on" : "off"}`);
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    await history.log("ERROR", "CoaExporter scrape import failed.", { error: message });
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
