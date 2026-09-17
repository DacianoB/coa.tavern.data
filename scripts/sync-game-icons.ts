import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const DEFAULT_ASCENSION_DATA_DIR =
  "C:\\Program Files\\Ascension Launcher\\resources\\ascension_ptr\\Data";
const connectionString = process.env.GAME_DATABASE_URL || process.env.DATABASE_URL;
const targetSchema = process.env.GAME_DATABASE_SCHEMA || "game";
const dataDir = process.env.ASCENSION_DATA_DIR || process.argv[2] || DEFAULT_ASCENSION_DATA_DIR;
const locale = process.env.ASCENSION_LOCALE || "enUS";
const iconOutDir = process.env.ASCENSION_ICON_OUT_DIR || path.join("public", "game-icons", "medium");
const workDir = path.join(".tmp", "ascension-icons", locale);
const iconListFile = path.join(workDir, "icons.txt");

function quoteIdent(identifier: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function normalizeIconName(icon: string) {
  return icon
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.(jpg|jpeg|png|webp|blp)$/i, "")
    .toLowerCase() ?? "";
}

async function iconNamesFromDatabase() {
  if (!connectionString) {
    throw new Error("GAME_DATABASE_URL or DATABASE_URL must be set.");
  }

  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query<{ name: string }>(
      `SELECT DISTINCT name FROM ${quoteIdent(targetSchema)}.aowow_icons WHERE name IS NOT NULL AND name <> '' ORDER BY name`,
    );

    return result.rows.map((row) => normalizeIconName(row.name)).filter(Boolean);
  } finally {
    await pool.end();
  }
}

async function main() {
  const iconNames = Array.from(new Set(await iconNamesFromDatabase())).sort();
  if (iconNames.length === 0) {
    console.log("No icon names found in aowow_icons.");
    return;
  }

  mkdirSync(workDir, { recursive: true });
  mkdirSync(iconOutDir, { recursive: true });
  writeFileSync(iconListFile, `${iconNames.join("\n")}\n`, "utf-8");

  console.log(`Syncing ${iconNames.length} icons into ${iconOutDir}`);
  const result = spawnSync("python", [
    path.join("scripts", "extract-ascension-mpq.py"),
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
    throw new Error(`Icon sync failed with exit code ${result.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
