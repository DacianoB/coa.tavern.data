import { unstable_noStore as noStore } from "next/cache";
import { cacheJson } from "@/lib/redis";
import { getGamePool, getGameSchema, hasGameDatabase } from "@/server/game-data/db";
import { iconNameToUrl } from "@/server/game-data/icon-url";

type Primitive = string | number | boolean | null;

export type BuilderClassOption = {
  id: number;
  name: string;
  icon: string | null;
};

export type BuilderSpecOption = {
  id: number;
  classId: number;
  name: string;
  skillLineId: number;
  icon: string | null;
};

export type BuilderTalentRank = {
  rank: number;
  spellId: number;
  spellName: string;
  icon: string | null;
  description: string;
  buff: string;
  spell: Record<string, Primitive>;
};

export type BuilderClassSpell = {
  id: number;
  name: string;
  rank: string;
  icon: string | null;
  description: string;
  buff: string;
  requiredLevel: number;
  treeType: "class" | "spec";
  source: string;
  sourceId: number;
  isPassive: boolean;
};

export type BuilderTalentNode = {
  id: number;
  treeKey: string;
  treeType: "class" | "spec";
  tabTypeId: number;
  tabName: string;
  type: string;
  parentId: number;
  groupId: number;
  name: string;
  icon: string | null;
  row: number;
  col: number;
  maxRanks: number;
  spellId: number;
  spellName: string;
  spellRank: string;
  description: string;
  buff: string;
  prerequisite: string;
  connectedNodeIds: string;
  requiredNodeIds: string;
  talentCost: number;
  abilityEssenceCost: number;
  talentEssenceCost: number;
  requiredAEInvestment: number;
  requiredTEInvestment: number;
  requiredTabAEInvestment: number;
  requiredTabTEInvestment: number;
  requiredLevel: number;
  minLevel: number;
  choiceIndex: number;
  nodeType: string;
  flags: number;
  isPassive: boolean;
  shape: string;
  ranks: BuilderTalentRank[];
  spell: Record<string, Primitive>;
};

export type BuilderTalentTab = {
  id: string;
  treeKey: string;
  treeType: "class" | "spec";
  tabTypeId: number;
  tabName: string;
  ownerClassId: number;
  ownerSpecId: number;
  ownerSpecSkillId: number;
  backgroundAtlas: string;
};

export type BuilderOptions = {
  classes: BuilderClassOption[];
  specs: BuilderSpecOption[];
};

export type BuilderTalentTree = {
  classId: number | null;
  specId: number | null;
  tabs: BuilderTalentTab[];
  nodes: BuilderTalentNode[];
  adapter: "postgres" | "mock";
};

export type BuilderTalentSpecMatch = BuilderSpecOption & {
  matchedTalentIds: number[];
  matchedTalentCount: number;
};

type BuilderOptionsFunctionPayload = {
  classes?: Array<{
    id: number;
    name: string | null;
    icon: string | null;
  }>;
  specs?: Array<{
    id: number;
    classId: number;
    name: string | null;
    skillLineId: number | null;
    icon: string | null;
  }>;
};

type BuilderTalentTreeFunctionPayload = {
  classId: number | null;
  specId: number | null;
  tabs?: BuilderTalentTab[];
  nodes?: Array<
    Omit<BuilderTalentNode, "icon" | "ranks" | "spell"> & {
      iconName?: string | null;
      iconPath?: string | null;
      spellData?: Record<string, Primitive> | null;
      ranks?: Array<
        Omit<BuilderTalentRank, "icon" | "spell"> & {
          iconName?: string | null;
          spellData?: Record<string, Primitive> | null;
        }
      >;
    }
  >;
};

let builderOptionsFunctionAvailable: boolean | null = null;
let builderTreeFunctionAvailable: boolean | null = null;

function quoteIdentifier(identifier: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function normalizeSpellRow(value: unknown): Record<string, Primitive> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Primitive] => {
      const [, fieldValue] = entry;
      return fieldValue === null || ["string", "number", "boolean"].includes(typeof fieldValue);
    }),
  );
}

function normalizeTreeType(value: string): "class" | "spec" {
  return value === "class" ? "class" : "spec";
}

async function getBuilderOptionsFromFunction(): Promise<BuilderOptions | null> {
  const pool = getGamePool();
  if (!pool || builderOptionsFunctionAvailable === false) {
    return null;
  }

  try {
    const result = await pool.query<{ payload: BuilderOptionsFunctionPayload }>(
      `SELECT app.get_builder_options() AS payload`,
    );
    const payload = result.rows[0]?.payload;
    builderOptionsFunctionAvailable = true;

    return {
      classes: (payload?.classes ?? [])
        .map((row) => ({
          id: row.id,
          name: row.name || `Class #${row.id}`,
          icon: iconNameToUrl(row.icon),
        }))
        .sort((first, second) => first.id - second.id),
      specs: (payload?.specs ?? [])
        .map((row) => ({
          id: row.id,
          classId: row.classId,
          name: row.name || `Spec #${row.id}`,
          skillLineId: row.skillLineId ?? 0,
          icon: iconNameToUrl(row.icon),
        }))
        .sort((first, second) => first.classId - second.classId || first.id - second.id),
    };
  } catch {
    builderOptionsFunctionAvailable = false;
    return null;
  }
}

async function getBuilderTalentTreeFromFunction(input: {
  classId?: number;
  specId?: number;
}): Promise<BuilderTalentTree | null> {
  const pool = getGamePool();
  if (!pool || builderTreeFunctionAvailable === false) {
    return null;
  }

  try {
    const result = await pool.query<{ payload: BuilderTalentTreeFunctionPayload }>(
      `SELECT app.get_builder_talent_tree($1::int, $2::int) AS payload`,
      [input.classId ?? null, input.specId ?? null],
    );
    const payload = result.rows[0]?.payload;
    builderTreeFunctionAvailable = true;

    return {
      classId: payload?.classId ?? null,
      specId: payload?.specId ?? null,
      tabs: (payload?.tabs ?? []).map((tab) => ({
        ...tab,
        treeType: normalizeTreeType(tab.treeType),
      })),
      nodes: (payload?.nodes ?? []).map((node) => ({
        ...node,
        treeType: normalizeTreeType(node.treeType),
        icon: iconNameToUrl(node.iconName ?? node.iconPath),
        description: node.description ?? "",
        buff: node.buff ?? "",
        spell: normalizeSpellRow(node.spellData),
        ranks: (node.ranks ?? []).map((rank) => ({
          rank: rank.rank,
          spellId: rank.spellId,
          spellName: rank.spellName,
          icon: iconNameToUrl(rank.iconName),
          description: rank.description,
          buff: rank.buff,
          spell: normalizeSpellRow(rank.spellData),
        })),
      })),
      adapter: "postgres",
    };
  } catch {
    builderTreeFunctionAvailable = false;
    return null;
  }
}

async function tableExists(tableName: string) {
  const pool = getGamePool();
  if (!pool) {
    return false;
  }

  const result = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = $2
      ) AS exists
    `,
    [getGameSchema(), tableName],
  );

  return result.rows[0]?.exists === true;
}

async function tableColumns(tableName: string) {
  const pool = getGamePool();
  if (!pool) {
    return new Set<string>();
  }

  const result = await pool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
    `,
    [getGameSchema(), tableName],
  );

  return new Set(result.rows.map((row) => row.column_name));
}

export async function getBuilderOptions(): Promise<BuilderOptions> {
  noStore();
  const pool = getGamePool();
  if (!hasGameDatabase() || !pool) {
    return { classes: [], specs: [] };
  }

  return cacheJson(`game:${getGameSchema()}:builder-options`, 300, async () => {
    const functionResult = await getBuilderOptionsFromFunction();
    if (functionResult) {
      return functionResult;
    }

    const schema = quoteIdentifier(getGameSchema());
    const hasSpecs = await tableExists("aowow_coa_specs");
    const hasTabs = await tableExists("aowow_talent_tree_tabs");
    const classes = new Map<number, BuilderClassOption>();
    const specs = new Map<string, BuilderSpecOption>();

    const addClass = (row: { id: number; name: string | null; fileString?: string | null }) => {
      if (!row.id || row.id <= 0 || classes.has(row.id)) {
        return;
      }

      classes.set(row.id, {
        id: row.id,
        name: row.name || `Class #${row.id}`,
        icon: row.fileString ? iconNameToUrl(`classicon_${row.fileString}`) : null,
      });
    };

    const addSpec = (row: {
      id: number;
      classId: number;
      name: string | null;
      skillLineId: number | null;
      icon?: string | null;
      iconName?: string | null;
    }) => {
      if (!row.id || row.id <= 0 || !row.classId || row.classId <= 0) {
        return;
      }

      const key = `${row.classId}:${row.id}`;
      if (specs.has(key)) {
        return;
      }

      specs.set(key, {
        id: row.id,
        classId: row.classId,
        name: row.name || `Spec #${row.id}`,
        skillLineId: row.skillLineId ?? 0,
        icon: iconNameToUrl(row.iconName ?? row.icon),
      });
    };

    if (hasSpecs) {
      const classResult = await pool.query<{
        id: number;
        name: string | null;
        fileString: string | null;
      }>(
        `
        SELECT DISTINCT
          spec."classId" AS id,
          NULLIF(spec."className", '') AS name,
          cls."fileString"
        FROM ${schema}.aowow_coa_specs spec
        LEFT JOIN ${schema}.aowow_classes cls ON cls.id = spec."classId"
        WHERE spec."classId" > 0
        ORDER BY spec."classId"
      `,
      );

      for (const row of classResult.rows) {
        addClass(row);
      }

      const specResult = await pool.query<{
        id: number;
        classId: number;
        name: string | null;
        skillLineId: number | null;
        icon: string | null;
        iconName: string | null;
      }>(
        `
        SELECT
          spec.id,
          spec."classId",
          spec.name,
          spec."skillLineId",
          spec.icon,
          icon.name AS "iconName"
        FROM ${schema}.aowow_coa_specs spec
        LEFT JOIN ${schema}.aowow_icons icon ON icon.id = spec."iconId"
        WHERE spec."classId" > 0
        ORDER BY spec."classId", spec."specOrder", spec.id
      `,
      );

      for (const row of specResult.rows) {
        addSpec(row);
      }
    }

    if (!hasTabs) {
      return {
        classes: Array.from(classes.values()).sort((first, second) => first.id - second.id),
        specs: Array.from(specs.values()).sort(
          (first, second) => first.classId - second.classId || first.id - second.id,
        ),
      };
    }

    const [classResult, specResult] = await Promise.all([
      pool.query<{ id: number; name: string | null; fileString: string | null }>(`
      SELECT DISTINCT
        tabs."ownerClassId" AS id,
        NULLIF(tabs."ownerClassName", '') AS name,
        cls."fileString"
      FROM ${schema}.aowow_talent_tree_tabs tabs
      LEFT JOIN ${schema}.aowow_classes cls ON cls.id = tabs."ownerClassId"
      WHERE tabs."ownerClassId" > 0
      ORDER BY tabs."ownerClassId"
    `),
    pool.query<{ id: number; classId: number; name: string | null; skillLineId: number | null }>(`
      SELECT DISTINCT
        tabs."ownerSpecId" AS id,
        tabs."ownerClassId" AS "classId",
        NULLIF(tabs."ownerSpecName", '') AS name,
        tabs."ownerSpecSkillId" AS "skillLineId"
      FROM ${schema}.aowow_talent_tree_tabs tabs
      WHERE tabs."treeType" = 'spec'
        AND tabs."ownerClassId" > 0
        AND tabs."ownerSpecId" > 0
      ORDER BY tabs."ownerClassId", tabs."ownerSpecId"
    `),
    ]);

    for (const row of classResult.rows) {
      addClass(row);
    }

    for (const row of specResult.rows) {
      addSpec(row);
    }

    return {
      classes: Array.from(classes.values()).sort((first, second) => first.id - second.id),
      specs: Array.from(specs.values()).sort(
        (first, second) => first.classId - second.classId || first.id - second.id,
      ),
    };
  });
}

export async function getBuilderTalentTree(input: {
  classId?: number;
  specId?: number;
}): Promise<BuilderTalentTree> {
  noStore();
  const pool = getGamePool();
  if (!hasGameDatabase() || !pool) {
    return { classId: input.classId ?? null, specId: input.specId ?? null, tabs: [], nodes: [], adapter: "mock" };
  }

  const cacheKey = `game:${getGameSchema()}:builder-tree:${input.classId ?? "default"}:${input.specId ?? "default"}`;
  return cacheJson(cacheKey, 300, async () => {
    const functionResult = await getBuilderTalentTreeFromFunction(input);
    if (functionResult) {
      return functionResult;
    }

    if (!(await tableExists("aowow_talent_tree_nodes"))) {
      return { classId: input.classId ?? null, specId: input.specId ?? null, tabs: [], nodes: [], adapter: "mock" };
    }

    const options = await getBuilderOptions();
    const selectedClassId = input.classId ?? options.classes[0]?.id ?? null;
    const selectedSpec =
      options.specs.find((spec) => spec.id === input.specId && spec.classId === selectedClassId) ??
      options.specs.find((spec) => spec.classId === selectedClassId) ??
      null;

    if (!selectedClassId) {
      return { classId: null, specId: null, tabs: [], nodes: [], adapter: "postgres" };
    }

    const schema = quoteIdentifier(getGameSchema());
    const selectedSpecSkillLineId = selectedSpec?.skillLineId ?? 0;
    const params = selectedSpecSkillLineId > 0
      ? [selectedClassId, selectedSpec?.id ?? 0, selectedSpecSkillLineId]
      : [selectedClassId, selectedSpec?.id ?? 0];
    const specSkillPredicate = selectedSpecSkillLineId > 0
      ? (alias = "") => `OR ${alias}"ownerSpecSkillId" = $3`
      : () => "";
    const treePredicate = (alias = "") => `
    ${alias}"ownerClassId" = $1
    AND (
      ${alias}"treeType" = 'class'
      OR ${alias}"ownerSpecId" = $2
      ${specSkillPredicate(alias)}
    )
  `;

    const tabResult = await pool.query<BuilderTalentTab>(
      `
      SELECT
        id,
        "treeKey",
        "treeType",
        "tabTypeId",
        "tabName",
        "ownerClassId",
        "ownerSpecId",
        "ownerSpecSkillId",
        "backgroundAtlas"
      FROM ${schema}.aowow_talent_tree_tabs
      WHERE ${treePredicate()}
      ORDER BY "treeType", "orderIndex", "tabTypeId"
    `,
      params,
    );

    const nodeColumns = await tableColumns("aowow_talent_tree_nodes");
    const nodeTextColumn = (column: string) => (
      nodeColumns.has(column) ? `COALESCE(node.${quoteIdentifier(column)}, '')` : "''"
    );
    const nodeIntColumn = (column: string) => (
      nodeColumns.has(column) ? `COALESCE(node.${quoteIdentifier(column)}, 0)` : "0"
    );
    const hasAdvancement = await tableExists("aowow_character_advancement");
    const requiredLevelExpression = hasAdvancement
      ? `GREATEST(${nodeIntColumn("requiredLevel")}, COALESCE(adv."levelRequired1", 0), COALESCE(adv."levelRequired2", 0), COALESCE(adv."levelRequired3", 0))`
      : nodeIntColumn("requiredLevel");
    const advancementJoin = hasAdvancement
      ? `LEFT JOIN ${schema}.aowow_character_advancement adv ON adv.id = node.id`
      : "";

    const nodeResult = await pool.query<
      Omit<BuilderTalentNode, "icon" | "ranks" | "spell"> & {
        iconName: string | null;
        iconPath: string | null;
        description: string | null;
        buff: string | null;
        spellData: Record<string, Primitive> | null;
      }
    >(
      `
      SELECT
        node.id,
        node."treeKey",
        node."treeType",
        node."tabTypeId",
        node."tabName",
        node.type,
        node."parentId",
        node."groupId",
        COALESCE(NULLIF(spell.name_loc0, ''), NULLIF(node.name, ''), node."spellId"::text) AS name,
        node.row,
        node.col,
        node."maxRanks",
        node."spellId",
        COALESCE(NULLIF(spell.name_loc0, ''), NULLIF(node.name, ''), node."spellId"::text) AS "spellName",
        COALESCE(spell.rank_loc0, '') AS "spellRank",
        COALESCE(spell.description_loc0, '') AS description,
        COALESCE(spell.buff_loc0, '') AS buff,
        node.prerequisite,
        ${nodeTextColumn("connectedNodeIds")} AS "connectedNodeIds",
        ${nodeTextColumn("requiredNodeIds")} AS "requiredNodeIds",
        ${nodeIntColumn("talentCost")} AS "talentCost",
        ${nodeIntColumn("abilityEssenceCost")} AS "abilityEssenceCost",
        ${nodeIntColumn("talentEssenceCost")} AS "talentEssenceCost",
        ${nodeIntColumn("requiredAEInvestment")} AS "requiredAEInvestment",
        ${nodeIntColumn("requiredTEInvestment")} AS "requiredTEInvestment",
        ${nodeIntColumn("requiredTabAEInvestment")} AS "requiredTabAEInvestment",
        ${nodeIntColumn("requiredTabTEInvestment")} AS "requiredTabTEInvestment",
        ${requiredLevelExpression} AS "requiredLevel",
        ${nodeIntColumn("minLevel")} AS "minLevel",
        ${nodeIntColumn("choiceIndex")} AS "choiceIndex",
        ${nodeTextColumn("nodeType")} AS "nodeType",
        ${nodeIntColumn("flags")} AS flags,
        ${nodeColumns.has("isPassive") ? `COALESCE(node.${quoteIdentifier("isPassive")}, false)` : "false"} AS "isPassive",
        node.shape,
        icon.name AS "iconName",
        node.icon AS "iconPath",
        to_jsonb(spell.*) AS "spellData"
      FROM ${schema}.aowow_talent_tree_nodes node
      LEFT JOIN ${schema}.aowow_icons icon ON icon.id = node."iconId"
      LEFT JOIN ${schema}.aowow_spell spell ON spell.id = node."spellId"
      ${advancementJoin}
      WHERE ${treePredicate("node.")}
      ORDER BY node."treeType", node."tabTypeId", node.row, node.col, node.id
    `,
      params,
    );

    const ids = nodeResult.rows.map((node) => node.id);
    const rankRows = ids.length
      ? (
        await pool.query<
          BuilderTalentRank & {
            advancementId: number;
            iconName: string | null;
            spellData: Record<string, Primitive> | null;
          }
        >(
          `
            SELECT
              ranks."advancementId",
              ranks.rank,
              ranks."spellId",
              COALESCE(NULLIF(spell.name_loc0, ''), NULLIF(ranks."spellName", ''), ranks."spellId"::text) AS "spellName",
              icon.name AS "iconName",
              COALESCE(spell.description_loc0, '') AS description,
              COALESCE(spell.buff_loc0, '') AS buff,
              to_jsonb(spell.*) AS "spellData"
            FROM ${schema}.aowow_talent_tree_node_ranks ranks
            LEFT JOIN ${schema}.aowow_spell spell ON spell.id = ranks."spellId"
            LEFT JOIN ${schema}.aowow_icons icon ON icon.id = ranks."iconId"
            WHERE ranks."advancementId" = ANY($1::int[])
            ORDER BY ranks."advancementId", ranks.rank
          `,
          [ids],
        )
      ).rows
      : [];

    const ranksByNode = new Map<number, BuilderTalentRank[]>();
    for (const rank of rankRows) {
      ranksByNode.set(rank.advancementId, [
        ...(ranksByNode.get(rank.advancementId) ?? []),
        {
          rank: rank.rank,
          spellId: rank.spellId,
          spellName: rank.spellName,
          icon: iconNameToUrl(rank.iconName),
          description: rank.description,
          buff: rank.buff,
          spell: normalizeSpellRow(rank.spellData),
        },
      ]);
    }

    return {
      classId: selectedClassId,
      specId: selectedSpec?.id ?? null,
      tabs: tabResult.rows.map((tab) => ({
        ...tab,
        treeType: tab.treeType === "class" ? "class" : "spec",
      })),
      nodes: nodeResult.rows.map((node) => ({
        ...node,
        treeType: node.treeType === "class" ? "class" : "spec",
        icon: iconNameToUrl(node.iconName ?? node.iconPath),
        description: node.description ?? "",
        buff: node.buff ?? "",
        spell: normalizeSpellRow(node.spellData),
        ranks: ranksByNode.get(node.id) ?? [],
      })),
      adapter: "postgres",
    };
  });
}

export async function getBuilderTalentSpecMatches(input: {
  classId?: number;
  talentIds?: number[];
}): Promise<BuilderTalentSpecMatch[]> {
  noStore();
  const pool = getGamePool();
  if (!hasGameDatabase() || !pool || !input.classId) {
    return [];
  }

  const talentIds = Array.from(
    new Set(
      (input.talentIds ?? [])
        .map((id) => Math.trunc(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );
  if (talentIds.length === 0 || !(await tableExists("aowow_talent_tree_nodes"))) {
    return [];
  }

  const schema = quoteIdentifier(getGameSchema());
  const hasSpecs = await tableExists("aowow_coa_specs");
  const hasIcons = await tableExists("aowow_icons");
  const iconJoin = hasSpecs && hasIcons
    ? `LEFT JOIN ${schema}.aowow_icons icon ON icon.id = spec."iconId"`
    : "";
  const iconSelect = hasSpecs && hasIcons ? `icon.name AS "iconName"` : `NULL::text AS "iconName"`;

  if (hasSpecs) {
    const result = await pool.query<{
      id: number;
      classId: number;
      name: string | null;
      skillLineId: number | null;
      icon: string | null;
      iconName: string | null;
      matchedTalentIds: number[];
      matchedTalentCount: number;
    }>(
      `
        SELECT
          spec.id,
          spec."classId",
          spec.name,
          spec."skillLineId",
          spec.icon,
          ${iconSelect},
          array_agg(DISTINCT node.id ORDER BY node.id) AS "matchedTalentIds",
          COUNT(DISTINCT node.id)::int AS "matchedTalentCount"
        FROM ${schema}.aowow_talent_tree_nodes node
        JOIN ${schema}.aowow_coa_specs spec
          ON spec."classId" = node."ownerClassId"
         AND (
           (node."ownerSpecId" > 0 AND spec.id = node."ownerSpecId")
           OR (
             node."ownerSpecSkillId" > 0
             AND spec."skillLineId" = node."ownerSpecSkillId"
           )
         )
        ${iconJoin}
        WHERE node.id = ANY($2::int[])
          AND node."treeType" = 'spec'
          AND node."ownerClassId" = $1
        GROUP BY spec.id, spec."classId", spec.name, spec."skillLineId", spec.icon${hasSpecs && hasIcons ? ", icon.name" : ""}
        ORDER BY "matchedTalentCount" DESC, spec.id
      `,
      [input.classId, talentIds],
    );

    return result.rows.map((row) => ({
      id: row.id,
      classId: row.classId,
      name: row.name || `Spec #${row.id}`,
      skillLineId: row.skillLineId ?? 0,
      icon: iconNameToUrl(row.iconName ?? row.icon),
      matchedTalentIds: row.matchedTalentIds,
      matchedTalentCount: row.matchedTalentCount,
    }));
  }

  const result = await pool.query<{
    id: number;
    classId: number;
    name: string | null;
    skillLineId: number | null;
    matchedTalentIds: number[];
    matchedTalentCount: number;
  }>(
    `
      SELECT
        node."ownerSpecId" AS id,
        node."ownerClassId" AS "classId",
        NULLIF(node."ownerSpecName", '') AS name,
        node."ownerSpecSkillId" AS "skillLineId",
        array_agg(DISTINCT node.id ORDER BY node.id) AS "matchedTalentIds",
        COUNT(DISTINCT node.id)::int AS "matchedTalentCount"
      FROM ${schema}.aowow_talent_tree_nodes node
      WHERE node.id = ANY($2::int[])
        AND node."treeType" = 'spec'
        AND node."ownerClassId" = $1
        AND node."ownerSpecId" > 0
      GROUP BY node."ownerSpecId", node."ownerClassId", node."ownerSpecName", node."ownerSpecSkillId"
      ORDER BY "matchedTalentCount" DESC, node."ownerSpecId"
    `,
    [input.classId, talentIds],
  );

  return result.rows.map((row) => ({
    id: row.id,
    classId: row.classId,
    name: row.name || `Spec #${row.id}`,
    skillLineId: row.skillLineId ?? 0,
    icon: null,
    matchedTalentIds: row.matchedTalentIds,
    matchedTalentCount: row.matchedTalentCount,
  }));
}

function spellLevelFrom(row: {
  learnedAt: number;
  spellLevel: number;
  baseLevel: number;
  levelRequired1: number;
  levelRequired2: number;
  levelRequired3: number;
}) {
  const candidates = [
    row.learnedAt,
    row.spellLevel,
    row.baseLevel,
    row.levelRequired1,
    row.levelRequired2,
    row.levelRequired3,
  ].filter((value) => Number.isFinite(value) && value > 0);

  return candidates.length ? Math.max(...candidates) : 1;
}

function spellIsPassive(row: {
  attributes0: number;
  rank: string | null;
  description: string | null;
  buff: string | null;
}) {
  const text = `${row.rank ?? ""} ${row.description ?? ""} ${row.buff ?? ""}`;
  return (row.attributes0 & 64) !== 0 || /\bpassive\b/i.test(text);
}

export async function getBuilderClassSpells(input: {
  classId?: number;
  specId?: number;
}): Promise<BuilderClassSpell[]> {
  noStore();
  const pool = getGamePool();
  if (!hasGameDatabase() || !pool || !input.classId) {
    return [];
  }

  const cacheKey = `game:${getGameSchema()}:builder-spells:${input.classId}:${input.specId ?? "default"}`;
  return cacheJson(cacheKey, 300, async () => {
    if (!(await tableExists("aowow_spell_owners")) || !(await tableExists("aowow_spell"))) {
      return [];
    }

    const schema = quoteIdentifier(getGameSchema());
    const hasSpecs = await tableExists("aowow_coa_specs");
    const selectedSpec = input.specId && hasSpecs
      ? (
        await pool.query<{ id: number; skillLineId: number }>(
          `
            SELECT id, COALESCE("skillLineId", 0) AS "skillLineId"
            FROM ${schema}.aowow_coa_specs
            WHERE "classId" = $1 AND id = $2
            LIMIT 1
          `,
          [input.classId, input.specId],
        )
      ).rows[0]
      : null;
    const selectedSpecSkillLineId = selectedSpec?.skillLineId ?? 0;
    const params =
      selectedSpecSkillLineId > 0
        ? [input.classId, selectedSpec?.id ?? 0, selectedSpecSkillLineId]
        : [input.classId, selectedSpec?.id ?? 0];
    const specSkillPredicate =
      selectedSpecSkillLineId > 0
        ? `OR owner."ownerSpecSkillId" = $3 OR owner."skillLineId" = $3`
        : "";
    const hasAdvancement = await tableExists("aowow_character_advancement");
    const advancementJoin = hasAdvancement
      ? `LEFT JOIN ${schema}.aowow_character_advancement adv ON adv.id = owner."sourceId"`
      : "";
    const advancementLevelSelect = hasAdvancement
      ? `
        COALESCE(adv."levelRequired1", 0) AS "levelRequired1",
        COALESCE(adv."levelRequired2", 0) AS "levelRequired2",
        COALESCE(adv."levelRequired3", 0) AS "levelRequired3",
      `
      : `
        0 AS "levelRequired1",
        0 AS "levelRequired2",
        0 AS "levelRequired3",
      `;

    const result = await pool.query<{
      id: number;
      name: string;
      rank: string | null;
      iconName: string | null;
      description: string | null;
      buff: string | null;
      learnedAt: number;
      spellLevel: number;
      baseLevel: number;
      levelRequired1: number;
      levelRequired2: number;
      levelRequired3: number;
      ownerSpecId: number;
      ownerSpecSkillId: number;
      skillLineId: number;
      source: string;
      sourceId: number;
      attributes0: number;
    }>(
      `
        WITH selected_owners AS (
          SELECT DISTINCT ON ("spellId", source, "sourceId", "sourceRank")
            *
          FROM ${schema}.aowow_spell_owners
          WHERE "spellId" > 0
            AND "ownerClassId" = $1
            AND (
              COALESCE("ownerSpecId", 0) = 0
              OR "ownerSpecId" = $2
              ${specSkillPredicate.replaceAll("owner.", "")}
            )
          ORDER BY "spellId", source, "sourceId", "sourceRank"
          LIMIT 500
        )
        SELECT
          spell.id,
          COALESCE(NULLIF(spell.name_loc0, ''), spell.id::text) AS name,
          COALESCE(spell.rank_loc0, '') AS rank,
          icon.name AS "iconName",
          COALESCE(spell.description_loc0, '') AS description,
          COALESCE(spell.buff_loc0, '') AS buff,
          COALESCE(spell."learnedAt", 0) AS "learnedAt",
          COALESCE(spell."spellLevel", 0) AS "spellLevel",
          COALESCE(spell."baseLevel", 0) AS "baseLevel",
          ${advancementLevelSelect}
          COALESCE(owner."ownerSpecId", 0) AS "ownerSpecId",
          COALESCE(owner."ownerSpecSkillId", 0) AS "ownerSpecSkillId",
          COALESCE(owner."skillLineId", 0) AS "skillLineId",
          COALESCE(owner.source, '') AS source,
          COALESCE(owner."sourceId", 0) AS "sourceId",
          COALESCE(spell.attributes0, 0) AS "attributes0"
        FROM selected_owners owner
        JOIN ${schema}.aowow_spell spell ON spell.id = owner."spellId"
        LEFT JOIN ${schema}.aowow_icons icon ON icon.id = spell."iconId"
        ${advancementJoin}
        WHERE COALESCE(spell.name_loc0, '') <> ''
      `,
      params,
    );

    const bySpellId = new Map<number, BuilderClassSpell>();

    for (const row of result.rows) {
      const current = bySpellId.get(row.id);
      const requiredLevel = spellLevelFrom(row);
      const isSpecSpell =
        row.ownerSpecId === selectedSpec?.id ||
        (selectedSpecSkillLineId > 0 &&
          (row.ownerSpecSkillId === selectedSpecSkillLineId || row.skillLineId === selectedSpecSkillLineId));
      const spell: BuilderClassSpell = {
        id: row.id,
        name: row.name,
        rank: row.rank ?? "",
        icon: iconNameToUrl(row.iconName),
        description: row.description ?? "",
        buff: row.buff ?? "",
        requiredLevel,
        treeType: isSpecSpell ? "spec" : "class",
        source: row.source,
        sourceId: row.sourceId,
        isPassive: spellIsPassive(row),
      };

      if (
        !current ||
        spell.requiredLevel < current.requiredLevel ||
        (spell.requiredLevel === current.requiredLevel && spell.treeType === "spec")
      ) {
        bySpellId.set(row.id, spell);
      }
    }

    return Array.from(bySpellId.values()).sort(
      (first, second) =>
        first.requiredLevel - second.requiredLevel ||
        (first.treeType === "class" ? 0 : 1) - (second.treeType === "class" ? 0 : 1) ||
        first.name.localeCompare(second.name) ||
        first.id - second.id,
    );
  });
}
