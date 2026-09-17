import { existsSync } from "node:fs";
import { backupGameDatabase } from "./lib/game-db-backup";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

function optionValue(args: string[], name: string) {
  const exactIndex = args.indexOf(name);
  if (exactIndex >= 0) return args[exactIndex + 1];

  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const connectionString = process.env.GAME_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("GAME_DATABASE_URL or DATABASE_URL must be set.");
  }

  await backupGameDatabase({
    connectionString,
    outputDir: optionValue(process.argv.slice(2), "--backup-dir"),
    outputFile: optionValue(process.argv.slice(2), "--backup-file"),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
