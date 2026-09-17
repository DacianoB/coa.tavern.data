import { z } from "zod";
import type { EntityKind } from "@/lib/entities";

export const paginationInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  query: z.string().trim().optional(),
  category: z.string().trim().optional(),
  sort: z.enum(["name", "id"]).default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

export type PaginationInput = z.infer<typeof paginationInputSchema>;

export const gameEntitySummarySchema = z.object({
  id: z.number(),
  kind: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  icon: z.string().nullable(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  sourceTable: z.string(),
});

export const gameEntityDetailSchema = gameEntitySummarySchema.extend({
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  sections: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        fields: z
          .array(
            z.object({
              label: z.string(),
              value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
              href: z.string().optional(),
              color: z.string().optional(),
            }),
          )
          .default([]),
        rows: z
          .array(
            z.object({
              label: z.string().optional(),
              fields: z.array(
                z.object({
                  label: z.string(),
                  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
                  href: z.string().optional(),
                  color: z.string().optional(),
                }),
              ),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  related: z.array(gameEntitySummarySchema),
  relatedGroups: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string().optional(),
        items: z.array(gameEntitySummarySchema),
      }),
    )
    .default([]),
  debug: z.object({
    adapter: z.enum(["postgres", "mock"]),
    schema: z.string(),
    sourceTable: z.string(),
  }),
});

export const paginatedGameEntitySchema = z.object({
  items: z.array(gameEntitySummarySchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  adapter: z.enum(["postgres", "mock"]),
});

export type GameEntitySummary = {
  id: number;
  kind: EntityKind;
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  metadata: Record<string, string | number | boolean | null>;
  sourceTable: string;
};

export type GameEntityDetail = GameEntitySummary & {
  metadata: Record<string, string | number | boolean | null>;
  sections: DetailSection[];
  related: GameEntitySummary[];
  relatedGroups: RelatedEntityGroup[];
  debug: {
    adapter: "postgres" | "mock";
    schema: string;
    sourceTable: string;
  };
};

export type PaginatedGameEntities = {
  items: GameEntitySummary[];
  total: number;
  page: number;
  pageSize: number;
  adapter: "postgres" | "mock";
};

export type SearchResult = GameEntitySummary & {
  score?: number;
};

export type DetailValue = string | number | boolean | null;

export type DetailField = {
  label: string;
  value: DetailValue;
  href?: string;
  color?: string;
};

export type DetailRow = {
  label?: string;
  fields: DetailField[];
};

export type DetailSection = {
  id: string;
  title: string;
  description?: string;
  fields?: DetailField[];
  rows?: DetailRow[];
};

export type RelatedEntityGroup = {
  id: string;
  label: string;
  description?: string;
  items: GameEntitySummary[];
};
