import { existsSync } from "node:fs";
import { Pool } from "pg";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const connectionString = process.env.GAME_DATABASE_URL || process.env.DATABASE_URL;
const limit = Math.min(Math.max(Number(process.argv[2] ?? 20), 1), 100);

async function main() {
  if (!connectionString) {
    throw new Error("GAME_DATABASE_URL or DATABASE_URL must be set.");
  }

  const pool = new Pool({ connectionString });

  try {
    const result = await pool.query<{
      id: string;
      type: string;
      status: string;
      source: string | null;
      started_at: Date | null;
      finished_at: Date | null;
      metadata: Record<string, unknown>;
      log_count: number;
    }>(
      `
        SELECT
          job.id,
          job.type,
          job.status,
          job.source,
          job.started_at,
          job.finished_at,
          job.metadata,
          COUNT(log.id)::int AS log_count
        FROM app.import_jobs job
        LEFT JOIN app.import_logs log ON log.job_id = job.id
        GROUP BY job.id
        ORDER BY COALESCE(job.started_at, job.created_at) DESC
        LIMIT $1
      `,
      [limit],
    );

    if (result.rows.length === 0) {
      console.log("No import history rows found.");
      return;
    }

    for (const row of result.rows) {
      const started = row.started_at?.toISOString() ?? "not-started";
      const finished = row.finished_at?.toISOString() ?? "not-finished";
      console.log(`${started} -> ${finished} | ${row.status.padEnd(7)} | ${row.type} | ${row.source ?? ""}`);
      console.log(`  id=${row.id} logs=${row.log_count} metadata=${JSON.stringify(row.metadata)}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
