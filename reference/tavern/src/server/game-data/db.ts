import { Pool } from "pg";
import { env } from "@/lib/env";

const globalForGameDb = globalThis as typeof globalThis & {
  gamePool?: Pool;
};

export function hasGameDatabase() {
  return Boolean(env.GAME_DATABASE_URL && env.GAME_DATABASE_URL.length > 0);
}

export function getGamePool() {
  if (!hasGameDatabase()) {
    return null;
  }

  if (!globalForGameDb.gamePool) {
    globalForGameDb.gamePool = new Pool({
      connectionString: env.GAME_DATABASE_URL,
      max: 10,
    });
  }

  return globalForGameDb.gamePool;
}

export function getGameSchema() {
  return env.GAME_DATABASE_SCHEMA || "game";
}
