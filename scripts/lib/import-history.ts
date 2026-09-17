import { randomUUID } from "node:crypto";
import { Pool } from "pg";

type ImportStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

export type ImportRecorder = {
  id: string | null;
  log: (level: "INFO" | "WARN" | "ERROR", message: string, metadata?: Record<string, unknown>) => Promise<void>;
  finish: (status: ImportStatus, metadata?: Record<string, unknown>) => Promise<void>;
  close: () => Promise<void>;
};

const noopRecorder: ImportRecorder = {
  id: null,
  log: async () => {},
  finish: async () => {},
  close: async () => {},
};

async function hasImportTables(pool: Pool) {
  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'app'
          AND table_name = 'import_jobs'
      ) AS exists
    `,
  );

  return result.rows[0]?.exists === true;
}

function jsonValue(value: Record<string, unknown> = {}) {
  return JSON.stringify(value);
}

export async function startImportJob({
  connectionString,
  type,
  source,
  metadata = {},
}: {
  connectionString: string | undefined;
  type: string;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<ImportRecorder> {
  if (!connectionString) {
    return noopRecorder;
  }

  const pool = new Pool({ connectionString });

  try {
    if (!(await hasImportTables(pool))) {
      await pool.end();
      return noopRecorder;
    }

    const id = randomUUID();
    await pool.query(
      `
        INSERT INTO app.import_jobs (id, type, status, source, metadata, started_at)
        VALUES ($1, $2, 'RUNNING', $3, $4::jsonb, now())
      `,
      [id, type, source ?? null, jsonValue(metadata)],
    );

    return {
      id,
      log: async (level, message, logMetadata = {}) => {
        await pool.query(
          `
            INSERT INTO app.import_logs (id, job_id, level, message, metadata)
            VALUES ($1, $2, $3, $4, $5::jsonb)
          `,
          [randomUUID(), id, level, message, jsonValue(logMetadata)],
        );
      },
      finish: async (status, finishMetadata = {}) => {
        await pool.query(
          `
            UPDATE app.import_jobs
            SET status = $2,
                metadata = metadata || $3::jsonb,
                finished_at = now()
            WHERE id = $1
          `,
          [id, status, jsonValue(finishMetadata)],
        );
      },
      close: async () => {
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    console.warn("Import history disabled:", error);
    return noopRecorder;
  }
}
