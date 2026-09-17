> Historical Tavern note; commands and paths may describe the original app. Start with [the current guides](../README.md). Local personal paths have been generalized.

# Game Data Updater

`pnpm game:update` is the one-pass local updater for CoA Tavern game data. It
does not run automatically; default mode renders a visual plan only.

```bash
pnpm game:update
pnpm game:update -- --execute
```

The updater wraps the existing safe import scripts instead of inventing new game
tables or Prisma models. It keeps game data under the AoWoW/AzerothCore-style
`game` schema and app-owned helper data under `app`.

## What It Runs

Default stages:

- `schema`: creates/verifies compatible AoWoW helper tables with `CREATE IF NOT EXISTS`.
- `backup`: writes a plain SQL `pg_dump` to `output/db-backups`.
- `mpq`: extracts Ascension MPQ/DBC/Lua data and imports base client rows.
- `icons`: extracts referenced icon BLPs into `public/game-icons/medium`.
- `split-tooltips`: uses existing split files, or splits raw staged tooltip Lua files when needed.
- `tooltips`: imports staged AscensionScraper item/spell tooltip data.
- `coa-talents`: overlays `output/CoaExporter.lua` talent layout when present.
- `scale`: rebuilds `src/data/scaledump-*.json` from ScaleDump addon output.
- `atlasloot`: imports AtlasLoot addon tables into app-owned tables.
- `search`: refreshes `app.game_search_index`.
- `check`: verifies the expected AoWoW-style tables.

The updater cannot crawl new in-game tooltips by itself. Run the
`AscensionScraper` addon in game first, copy the SavedVariables Lua output into
`output/addon/tooltip` or `output/addon/tooltip-split`, then run the updater.

## Useful Commands

```bash
# Plan only, no writes
pnpm game:update

# Full update
pnpm game:update -- --execute

# Just MPQ/client files, icons, scaling, and search
pnpm game:update -- --execute --only mpq,icons,scale,search

# Rebuild tooltip split chunks before importing
pnpm game:update -- --execute --force-split

# Import tooltips without overwriting existing richer DB text
pnpm game:update -- --execute --no-overwrite-tooltips

# Skip slow optional stages
pnpm game:update -- --execute --skip atlasloot,scale

# Generate KnownItems.lua for another missing-tooltip in-game pass
pnpm game:update -- --execute --include-known-items
```

## Key Inputs

- `--ascension-data-dir PATH`: Ascension client `Data` folder.
- `--scraper-source PATH`: raw tooltip SavedVariables folder for splitting.
- `--scraper-input PATH`: split tooltip folder/file to import.
- `--scale-input PATH`: sparse ScaleDump files.
- `--scale-reference PATH`: dense reference dump, default `Scaledump.lua`.
- `--coa-talents-input PATH`: CoaExporter SavedVariables file.
- `--atlasloot-addon PATH`: AtlasLoot addon folder.

The updater requires `GAME_DATABASE_URL` or `DATABASE_URL` for database-backed
stages. Use `--only scale` for a file-only ScaleDump rebuild.
