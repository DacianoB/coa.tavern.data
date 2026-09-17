import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

type BackupOptions = {
  connectionString: string;
  outputDir?: string;
  outputFile?: string;
};

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function defaultOutputFile(outputDir: string) {
  return path.join(outputDir, `coatavern-db-${timestamp()}.sql`);
}

function pgDumpConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("schema");
    return url.toString();
  } catch {
    return connectionString;
  }
}

export async function backupGameDatabase({
  connectionString,
  outputDir = process.env.GAME_BACKUP_DIR || path.join("output", "db-backups"),
  outputFile = process.env.GAME_BACKUP_FILE,
}: BackupOptions) {
  const resolvedOutputFile = path.resolve(outputFile || defaultOutputFile(outputDir));
  mkdirSync(path.dirname(resolvedOutputFile), { recursive: true });

  const args = [
    "--dbname",
    pgDumpConnectionString(connectionString),
    "--file",
    resolvedOutputFile,
    "--format",
    "plain",
    "--no-owner",
    "--no-privileges",
  ];

  console.log(`Creating PostgreSQL SQL backup: ${resolvedOutputFile}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("pg_dump", args, {
      stdio: ["ignore", "inherit", "pipe"],
      shell: false,
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to start pg_dump. Install PostgreSQL client tools and make sure pg_dump is on PATH. ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`pg_dump failed with exit code ${code}.${stderr ? `\n${stderr}` : ""}`));
    });
  });

  console.log(`Backup written: ${resolvedOutputFile}`);
  return resolvedOutputFile;
}
