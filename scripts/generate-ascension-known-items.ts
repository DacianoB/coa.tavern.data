import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { Pool } from "pg";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

type GeneratorMode = "all" | "missing-tooltips";

type Options = {
  inputPath: string;
  outputPath: string;
  mode: GeneratorMode;
  tooltipPaths: string[];
};

const defaultInputPath = path.join("output", "addon");
const defaultOutputPath = path.join("Inteface", "Addons", "AscensionScraper", "KnownItems.lua");
const defaultTooltipPaths = [
  // path.join("output", "addon", "tooltip"),
  path.join("output", "addon", "tooltip-split"),
];
const connectionString = process.env.GAME_DATABASE_URL || process.env.DATABASE_URL;
const targetSchema = process.env.GAME_DATABASE_SCHEMA || "game";

function parseArgs(args: string[]): Options {
  const positionals: string[] = [];
  const tooltipPaths: string[] = [];
  let mode: GeneratorMode = "all";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--missing-tooltips" || arg === "--missing-items") {
      mode = "missing-tooltips";
      continue;
    }
    if (arg === "--all") {
      mode = "all";
      continue;
    }
    if (arg === "--tooltip-path") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--tooltip-path requires a path value.");
      }
      tooltipPaths.push(value);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage:",
          "  pnpm game:addon-known-items [inputPath] [outputPath]",
          "  pnpm game:addon-known-items --missing-tooltips [inputPath] [outputPath]",
          "",
          "Options:",
          "  --missing-tooltips  Generate only IDs not found in tooltip scrape folders.",
          "  --tooltip-path PATH  Tooltip folder/file to subtract. Can be repeated.",
        ].join("\n"),
      );
      process.exit(0);
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  return {
    inputPath: positionals[0] || defaultInputPath,
    outputPath: positionals[1] || defaultOutputPath,
    mode,
    tooltipPaths: tooltipPaths.length > 0 ? tooltipPaths : defaultTooltipPaths,
  };
}

const options = parseArgs(process.argv.slice(2));

function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function indentWidth(value: string) {
  let width = 0;
  for (const char of value) {
    width += char === "\t" ? 2 : 1;
  }
  return width;
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
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".lua")) {
        files.push(entryPath);
      }
    }
  };
  walk(resolved);
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function existingAddonInputFiles(input: string) {
  if (!existsSync(input)) return [];
  return addonInputFiles(input);
}

async function collectItemIds(file: string, ids: Set<number>) {
  const reader = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let inItems = false;
  let itemsIndent = 0;
  let itemIndent = 0;

  for await (const line of reader) {
    const topLevelItems = line.match(/^(\s*)\["items"\]\s*=\s*\{/);
    if (!inItems && topLevelItems) {
      const width = indentWidth(topLevelItems[1] ?? "");
      if (width <= 2) {
        inItems = true;
        itemsIndent = width;
        itemIndent = width + 2;
      }
      continue;
    }

    if (!inItems) continue;

    const indent = line.match(/^(\s*)/)?.[1] ?? "";
    const width = indentWidth(indent);
    if (width <= itemsIndent && /^\s*\}/.test(line)) {
      inItems = false;
      continue;
    }

    if (width === itemIndent) {
      const item = line.match(/^\s*\[(\d+)\]\s*=\s*\{/);
      if (item) {
        const id = Number(item[1]);
        if (Number.isInteger(id) && id > 0) ids.add(id);
      }
      continue;
    }

    const inlineId = line.match(/^\s*\["(?:id|itemId)"\]\s*=\s*(\d+)\s*,?/);
    if (inlineId) {
      const id = Number(inlineId[1]);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
  }
}

async function collectDatabaseItemIds(ids: Set<number>) {
  if (!connectionString) {
    return null;
  }

  const pool = new Pool({ connectionString });
  try {
    const tableExists = await pool.query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = $1
            AND table_name = 'aowow_items'
        ) AS exists
      `,
      [targetSchema],
    );

    if (!tableExists.rows[0]?.exists) {
      return { count: 0, skipped: `table ${targetSchema}.aowow_items was not found` };
    }

    const countResult = await pool.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM ${quoteIdent(targetSchema)}.aowow_items
        WHERE id > 0
      `,
    );

    let lastId = 0;
    const chunkSize = 100_000;
    while (true) {
      const result = await pool.query<{ id: number }>(
        `
          SELECT id
          FROM ${quoteIdent(targetSchema)}.aowow_items
          WHERE id > $1
          ORDER BY id
          LIMIT ${chunkSize}
        `,
        [lastId],
      );

      if (result.rows.length === 0) break;

      for (const row of result.rows) {
        const id = Number(row.id);
        if (Number.isInteger(id) && id > 0) {
          ids.add(id);
          lastId = id;
        }
      }
    }

    return { count: Number(countResult.rows[0]?.total ?? 0) };
  } finally {
    await pool.end();
  }
}

function luaString(value: string) {
  return JSON.stringify(value);
}

function renderKnownItems(
  ids: number[],
  files: string[],
  databaseSource: string | null,
  mode: GeneratorMode,
  excludedTooltipFiles: string[],
) {
  const chunkSize = 500;
  const lines = [
    "-- Auto-generated by pnpm game:addon-known-items.",
    `-- Mode: ${mode}`,
    "-- Source files:",
    ...files.map((file) => `-- - ${path.relative(process.cwd(), file).replace(/\\/g, "/")}`),
    ...(databaseSource ? ["-- Source database:", `-- - ${databaseSource}`] : []),
    ...(excludedTooltipFiles.length > 0
      ? [
          "-- Excluded tooltip sources:",
          ...excludedTooltipFiles.map((file) => `-- - ${path.relative(process.cwd(), file).replace(/\\/g, "/")}`),
        ]
      : []),
    `AscensionScraperKnownItemIDCount = ${ids.length}`,
    "AscensionScraperKnownItemIDChunks = {",
  ];

  for (let index = 0; index < ids.length; index += chunkSize) {
    lines.push(`  ${luaString(ids.slice(index, index + chunkSize).join(","))},`);
  }

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

async function main() {
  if (!existsSync(options.inputPath)) {
    throw new Error(`Input not found: ${options.inputPath}`);
  }

  const files = addonInputFiles(options.inputPath);
  if (files.length === 0) {
    throw new Error(`No .lua files found in ${options.inputPath}`);
  }

  const ids = new Set<number>();
  for (const file of files) {
    await collectItemIds(file, ids);
  }

  const databaseResult = await collectDatabaseItemIds(ids);
  const databaseSource =
    databaseResult && !("skipped" in databaseResult)
      ? `${targetSchema}.aowow_items (${databaseResult.count} row(s))`
      : null;

  const fullCount = ids.size;
  const excludedTooltipIds = new Set<number>();
  const excludedTooltipFiles =
    options.mode === "missing-tooltips"
      ? options.tooltipPaths.flatMap((tooltipPath) => existingAddonInputFiles(tooltipPath))
      : [];

  for (const file of excludedTooltipFiles) {
    await collectItemIds(file, excludedTooltipIds);
  }

  if (options.mode === "missing-tooltips") {
    for (const id of excludedTooltipIds) {
      ids.delete(id);
    }
  }

  const sorted = [...ids].sort((left, right) => left - right);
  writeFileSync(
    options.outputPath,
    renderKnownItems(sorted, files, databaseSource, options.mode, excludedTooltipFiles),
  );

  console.log(`Wrote ${sorted.length} known item ID(s) to ${options.outputPath}`);
  if (options.mode === "missing-tooltips") {
    console.log(`Filtered from ${fullCount} known item ID(s).`);
    console.log(`Excluded ${excludedTooltipIds.size} item ID(s) from ${excludedTooltipFiles.length} tooltip file(s).`);
  }
  if (databaseResult && "skipped" in databaseResult) {
    console.log(`Skipped database item IDs: ${databaseResult.skipped}.`);
  } else if (!connectionString) {
    console.log("Skipped database item IDs: GAME_DATABASE_URL or DATABASE_URL is not configured.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
