import { Pool } from "pg";
import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const url = process.env.GAME_DATABASE_URL;
const schema = process.env.GAME_DATABASE_SCHEMA || "game";

const requiredTables = [
  "aowow_items",
  "aowow_itemset",
  "aowow_itemenchantment",
  "aowow_spell",
  "aowow_talents",
  "aowow_talent_tree_tabs",
  "aowow_talent_tree_nodes",
  "aowow_talent_tree_node_ranks",
  "aowow_quests",
  "aowow_creature",
  "aowow_objects",
  "aowow_zones",
  "aowow_factions",
  "aowow_achievement",
  "aowow_classes",
  "aowow_races",
  "aowow_skillline",
  "aowow_pet",
  "aowow_emotes",
  "aowow_currencies",
  "aowow_events",
  "aowow_titles",
  "aowow_icons",
  "aowow_mails",
  "aowow_sounds",
];

async function main() {
  if (!url) {
    console.log("GAME_DATABASE_URL is not configured. The app will use the temporary mock adapter.");
    return;
  }

  const pool = new Pool({ connectionString: url });
  const result = await pool.query<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_name = ANY($2)
    `,
    [schema, requiredTables],
  );
  await pool.end();

  const present = new Set(result.rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !present.has(table));

  if (missing.length > 0) {
    console.log(`Connected to game database schema "${schema}", but ${missing.length} tables are missing:`);
    for (const table of missing) {
      console.log(`- ${table}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Game database schema "${schema}" contains the required AoWoW-style tables.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
