import { entityDefinitions, getEntityDetailSlug, type EntityKind } from "@/lib/entities";
import { cacheJson } from "@/lib/redis";
import { getGamePool } from "@/server/game-data/db";
import { iconNameToUrl } from "@/server/game-data/icon-url";
import { listGameEntities } from "@/server/game-data/repository";
import type { SearchResult } from "@/server/game-data/types";
import { isVisibleGameEntityName } from "@/server/game-data/visibility";

async function searchIndexedGameData(
  query: string,
  limit: number,
): Promise<SearchResult[] | null> {
  const pool = getGamePool();
  if (!pool) {
    return null;
  }

  const normalized = query.trim();
  const result = await pool.query<{
    kind: EntityKind;
    id: number;
    name: string;
    description: string | null;
    category: string | null;
    icon: string | null;
    source_table: string;
    metadata: Record<string, unknown> | null;
    score: number;
  }>(
    `
      SELECT kind, id, name, description, category, icon, source_table, metadata, score
      FROM app.search_game_data($1::text, $2::int)
    `,
    [normalized, limit * 4],
  );

  return result.rows
    .filter((row) => isVisibleGameEntityName(row.kind, row.name))
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      slug: getEntityDetailSlug(row.kind, row.id),
      name: row.name,
      description: row.description,
      category: row.category,
      icon: iconNameToUrl(row.icon),
      metadata: Object.fromEntries(
        Object.entries(row.metadata ?? {}).filter(
          (
            entry
          ): entry is [string, string | number | boolean | null] => {
            const [, value] = entry;
            return (
              value === null ||
              ["string", "number", "boolean"].includes(typeof value)
            );
          },
        ),
      ),
      sourceTable: row.source_table,
      score: row.score,
    }));
}

export async function searchGameData(query: string, limit = 5): Promise<SearchResult[]> {
  const normalized = query.trim();
  if (!normalized) {
    return [];
  }

  return cacheJson(`game:search:${normalized.toLowerCase()}:${limit}`, 120, async () => {
  try {
    const indexed = await searchIndexedGameData(normalized, limit);
    if (indexed) {
      return indexed;
    }
  } catch {
    // Fall back to live table search if the app-schema helper is unavailable.
  }

  const searches = await Promise.all(
    entityDefinitions.map(async (definition) => {
      const result = await listGameEntities(definition.kind as EntityKind, {
        query: normalized,
        page: 1,
        pageSize: limit,
      });

      return result.items.map((item) => ({
        ...item,
        score: item.name.toLowerCase() === query.toLowerCase() ? 1 : 0.5,
      }));
    }),
  );

  return searches.flat().slice(0, limit * 4);
  });
}
