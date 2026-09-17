> Historical Tavern note; commands and paths may describe the original app. Start with [the current guides](../README.md). Local personal paths have been generalized.

# Game Data Boundary

CoA Tavern treats AoWoW/AzerothCore-compatible game data as the source of truth.

The first supported local deployment layout is one PostgreSQL database with separate schemas:

- `game`: imported/generated AoWoW-style tables such as `aowow_items`, `aowow_spell`, `aowow_quests`, `aowow_creature`, `aowow_icons`, and helper/link tables.
- `app`: CoA Tavern-owned community tables such as users, profiles, builds, build versions, likes, bookmarks, comments, import jobs, and import logs.

This is Option A from the project brief. It is simpler for local development and Coolify because one PostgreSQL service, backup policy, and connection secret can cover both logical data areas while still keeping ownership boundaries clear.

## AoWoW/AzerothCore Compatibility

AoWoW's setup model imports its own `setup/db_structure.sql`, reads from an AzerothCore world database, extracts DBC/interface/icon data, and generates helper tables/search data. CoA Tavern does not replace that model.

Rules for this app:

- Do not create destructive Prisma migrations against the `game` schema.
- Do not rename legacy game tables or columns.
- Use `prisma db pull` only for introspection/reference when a real game database is available.
- Put complex game queries in `src/server/game-data`.
- Prefer SQL views on top of `game` if the UI needs a simpler read model.
- Keep app/community migrations in the `app` schema only.

## Temporary Mock Adapter

When `GAME_DATABASE_URL` is empty, the repositories return clearly marked mock records so the UI can be developed without a local AoWoW import. The mock adapter is not a schema replacement.

Configure real game data with:

```bash
GAME_DATABASE_URL="postgresql://user:pass@host:5432/coatavern"
GAME_DATABASE_SCHEMA="game"
pnpm tsx scripts/check-game-db.ts
```

For the full local refresh with a terminal progress dashboard, use:

```bash
pnpm game:update
pnpm game:update -- --execute
```

See `docs/game-data-updater.md` for stage controls and input paths.

The Ascension client importer also extracts referenced `Interface/Icons/*.blp` files from the client MPQs, converts them to JPG, and writes them to `public/game-icons/medium`. Page rendering reads those files directly as static assets; it does not scan MPQs or convert icons during requests. Run `pnpm game:icons` after loading or changing `aowow_icons` to sync the icon directory without reimporting game rows. Set `ASCENSION_EXTRACT_ICONS=0` to skip icon sync during import, or set `ASCENSION_ICON_OUT_DIR`/`AOWOW_ICON_LOCAL_DIR` if the generated icon directory is mounted somewhere else.

## Ascension Class And Spec Sources

The custom class/spec data is split between client Lua UI files and client MPQ `DBFilesClient` files, not in Prisma models:

- `ChrClasses.dbc`: playable class rows and class tokens.
- `Interface/SharedXML/SharedConstants.lua`: CoA class order, localized spec names, spec icons, and primary stat metadata. These records enrich class pages and category 7 SkillLine specialization views.
- `Interface/FrameXML/Constants.lua`: base class tree order plus `SPEC_SWAP_SPELLS`, the saved-spec/loadout swap spell ids used by the UI.
- `Interface/SharedXML/AtlasInfo.lua`: CoA spec thumbnail and talent background atlas names.
- `ChrSpecs.dbc`: raw specialization spell links where present; useful as fallback metadata, but not the source of truth for CoA spec names.
- `CharacterAdvancement.dbc`: Dragonflight-style class/spec tree nodes, ranks, coordinates, prerequisites, icons, and spell ids.
- `CharacterAdvancementClassTypes.dbc` and `CharacterAdvancementTabTypes.dbc`: class/tab ownership labels used to resolve tree nodes back to classes and SkillLine specs.
- `SkillLineAbility.dbc`: trainer/skill-line ability links, spell ids, class/race masks, acquire method, and minimum skill rank.

`pnpm game:import-ascension` imports those into helper tables under the `game` schema: `aowow_coa_specs`, `aowow_specialization_slots`, `aowow_chr_specs`, `aowow_character_advancement`, `aowow_character_advancement_class_types`, `aowow_character_advancement_tab_types`, `aowow_talent_tree_tabs`, `aowow_talent_tree_nodes`, `aowow_talent_tree_node_ranks`, `aowow_skill_line_abilities`, and `aowow_spell_owners`. These are imported game-data helper tables used by `src/server/game-data`; they are not Prisma app/community models.

### Talent Layout Provenance

The builder's base talent information comes from the Ascension client files extracted by `pnpm game:import-ascension`:

- `DBFilesClient/CharacterAdvancement.dbc` supplies advancement ids, rank spell ids, raw `row`/`col`, parent/group ids, icons, and prerequisites.
- `DBFilesClient/CharacterAdvancementClassTypes.dbc` and `DBFilesClient/CharacterAdvancementTabTypes.dbc` resolve class/tab ownership.
- `Interface/SharedXML/SharedConstants.lua`, `Interface/FrameXML/Constants.lua`, `Interface/SharedXML/AtlasInfo.lua`, and `Interface/FrameXML/Data/CharacterAdvancement.lua` supply class/spec names, order, icons, atlas names, and client-side class token remaps.

You can verify what last touched the local helper rows with:

```sql
select source, "ownerClassId", "ownerClassName", count(*)
from game.aowow_talent_tree_nodes
group by source, "ownerClassId", "ownerClassName"
order by "ownerClassId", source;
```

In the current local database, `app.import_jobs` shows `game:import-ascension` created `11900` talent nodes from `C:\Program Files\Ascension Launcher\resources\ascension_ptr\Data`. It also shows later `game:import-coa-builder` and `game:import-coa-talents` jobs. The row-level `source` column is the quickest way to see which importer last supplied layout metadata for a given class.

`AscensionScraper` currently enriches item/spell/trainer records only. It does not currently write talent tree `row`/`col` into `aowow_talent_tree_nodes`.

Barbarian was recovered from the same local Ascension CoA builder payload used by the earlier `game:import-coa-builder` job:

```text
<local-builder-export>/ascension-coa-voljin.json
```

That file identifies its source as `https://api.ascension.gg/api/v3/builder/coa` and contains Barbarian entries under `talents.entriesByTab` keys `12:31`, `12:32`, `12:33`, and `12:87`. Matching by advancement id found `161` Barbarian JSON nodes and `161` database nodes, with no missing ids, tab mismatches, or spell mismatches. The local overlay then updated only `ownerClassId = 12`, setting `row = y`, `col = x`, connected node ids, required node ids, rank spells, costs, unlock requirements, icons, and related node metadata. Those rows now have `source = 'coa_builder_json'`, and the recovery was recorded in `app.import_jobs` as `game:import-coa-builder-barbarian-overlay`.

Use this query to verify Barbarian layout coverage:

```sql
select
  node."tabTypeId",
  node."tabName",
  node.source,
  count(*)::int as nodes,
  count(*) filter (where node.row is not null and node.col is not null)::int as placed,
  count(*) filter (where coalesce(node."connectedNodeIds", '') <> '')::int as connected
from game.aowow_talent_tree_nodes node
where node."ownerClassId" = 12
group by node."tabTypeId", node."tabName", node.source
order by node."tabTypeId";
```

Expected local result after the overlay:

| Tab | Name | Nodes | Placed | Connected |
| --- | --- | ---: | ---: | ---: |
| 31 | Brutality | 39 | 39 | 37 |
| 32 | Tactics | 38 | 38 | 36 |
| 33 | Ancestry | 43 | 43 | 41 |
| 87 | Class | 41 | 41 | 38 |

Some custom Dragonflight-style CoA trees expose their final layout through the in-game `C_CharacterAdvancement` API even when the static DBC decode lands `row=0` and `col=0`. The local `CoaExporter` addon can catalog those entries from the game client with `/coae catalog talents`, including `PositionX`/`PositionY` or `Column`/`Row`, `ConnectedNodes`, requirements, costs, and choice metadata. Copy the resulting SavedVariables file into `output/CoaExporter.lua`, then run:

```bash
pnpm game:import-coa-talents
```

That command overlays the client-runtime talent layout onto `aowow_talent_tree_nodes` without using another builder database.

## Builder Talent Data

Talent builder data should stay as cross-reference helper tables, not as extra columns on `aowow_spell`. Every talent rank is still a spell, but the tree identity, owner class/spec, row, column, parent/group links, choice grouping, AE/TE costs, requirements, and rank ordering are UI placement/rule metadata. Keeping that metadata in helper tables avoids polluting spell rows and lets the importer rebuild the builder read model without changing legacy AoWoW/AzerothCore tables.

Current builder tables:

- `game.aowow_talent_tree_tabs`: class/spec tree tabs and ownership.
- `game.aowow_talent_tree_nodes`: one talent node per `CharacterAdvancement` entry, with position, tree key, max ranks, first spell id, and raw prerequisite metadata.
- `game.aowow_talent_tree_node_ranks`: one row per rank spell, keyed back to the node and spell id.

This is generated during `pnpm game:import-ascension`, so it does not add work to the item/spell scrape pipeline. When custom-tree DBC coordinates are incomplete, `pnpm game:import-coa-talents` updates those same helper rows from the local client addon catalog. The `/builder` route reads these tables through `src/server/game-data/build-planner.ts` and joins each talent spell to `game.aowow_spell` for the same tooltip text used by the rest of the app.

The client-file `CharacterAdvancement.dbc` import provides the base rows, ranks, owners, spell ids, parent/group metadata, and raw prerequisites. The local client SavedVariables overlay provides the final Dragonflight-style layout, connected-node rules, requirements, AE/TE costs, and unlock metadata when the DBC fields are not enough. Do not create a second application source of truth for builder data; any one-off recovery from a local Ascension builder payload, such as the Barbarian `coa_builder_json` overlay above, must be matched back to existing `aowow_talent_tree_nodes` ids and recorded in `app.import_jobs`.

## Import History

The import commands write best-effort history rows into `app.import_jobs` and `app.import_logs` when the app schema is present:

```bash
pnpm game:history
pnpm game:history 50
```

Use this to answer when the client files were last synced, whether a scrape import succeeded, and what source path or metadata was used.

SkillLine categories are exposed through `/skills` filters instead of separate spec routes:

- Category 6: proficiencies such as axes, defense, and daggers.
- Category 7: class and specialization skill lines, excluding `Pet -` rows in the specialization filter.
- Category 8: armor skills.
- Category 9: racials and secondary skills such as First Aid and Fishing.
- Category 10: languages.
- Category 11: professions, exposed as `/professions`.

## Expected Core Tables

The current repository layer expects these AoWoW table names where available:

`aowow_items`, `aowow_itemset`, `aowow_itemenchantment`, `aowow_spell`, `aowow_talents`, `aowow_talent_tree_tabs`, `aowow_talent_tree_nodes`, `aowow_talent_tree_node_ranks`, `aowow_quests`, `aowow_creature`, `aowow_objects`, `aowow_zones`, `aowow_factions`, `aowow_achievement`, `aowow_classes`, `aowow_races`, `aowow_skillline`, `aowow_pet`, `aowow_emotes`, `aowow_currencies`, `aowow_events`, `aowow_titles`, `aowow_icons`, `aowow_mails`, and `aowow_sounds`.
