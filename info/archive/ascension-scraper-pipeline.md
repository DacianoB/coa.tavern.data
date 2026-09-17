> Historical Tavern note; commands and paths may describe the original app. Start with [the current guides](../README.md). Local personal paths have been generalized.

# AscensionScraper DB Pipeline

Use `AscensionScraper` for full in-game crawling. `CoaExporter` is still useful
for character/wiki exports, but the DB enrichment path is now
`AscensionScraperDB files in output/addon -> pnpm game:import-scraper -> game.aowow_*`.

This preserves the existing database basis:

- No Prisma game-data models are added.
- No destructive migration is run against `game`.
- No AoWoW/AzerothCore table or column is renamed.
- Data is written only into existing `game.aowow_items` and
  `game.aowow_spell` columns.
- Missing rows may be inserted into those existing legacy tables; disable that
  with `ASCENSION_SCRAPER_INSERT_MISSING=0`.

`AscensionScraper` does not currently import builder talent layout metadata such
as `aowow_talent_tree_nodes.row` or `aowow_talent_tree_nodes.col`. The current
builder base data comes from `pnpm game:import-ascension`, which extracts
`DBFilesClient/CharacterAdvancement*.dbc` plus client `Interface/*.lua` files.
Use `app.import_jobs` and the `game.aowow_talent_tree_nodes.source` column to
check whether a local row came from the base client import or a later overlay.
Barbarian layout was not recovered from `AscensionScraper`; it was matched from
the local Ascension CoA builder JSON payload at
`<local-builder-export>/ascension-coa-voljin.json`
and applied only to `ownerClassId = 12`, leaving its talent rows marked with
`source = 'coa_builder_json'`.

## 1. Import MPQ/DBC First

Run the normal client import first so IDs, icons, classes, specs, talents, and
base DBC rows exist before the in-game scrape enriches them:

```bash
pnpm game:import-ascension
pnpm game:icons
pnpm game:check
```

## 2. Install The Addon

Copy the addon folder to WoW:

```text
<wow>/Interface/AddOns/AscensionScraper/AscensionScraper.toc
```

Enable `AscensionScraper` on the character select addon screen. Enable
`AscensionScraperAuto` too when you want automated KnownItems tooltip chunks.
Then enter the world and run:

```text
/reload
/scrap status
```

## 3. Crawl IDs In Game

Open the UI:

```text
/scrap
```

Recommended baseline crawl:

```text
/scrap items 1 999999 10
/scrap spells 1 999999 100
```

The default end ID is high because Ascension uses high custom IDs. Use smaller
ranges when testing:

```text
/scrap items 1 5000 10
/scrap spells 1 5000 100
```

Useful enrichment passes:

```text
/scrap spellbook
/scrap trainer
/scrap item 19019
/scrap spell 133
/scrap export
```

Run `/scrap spellbook` on characters/classes that expose different custom
spellbooks. For `/scrap trainer`, open the trainer window first, then run the
command. Trainer data can add level, cost, skill, rank, and prerequisite info
when the client exposes it.

`/scrap export` prints the handoff summary in game: where the SavedVariables
file lands and which repo import command to run.

Progress and tuning:

```text
/scrap status
/scrap stop
/scrap throttle 4
/scrap interval 0.05
/scrap progress on
/scrap progress off
/scrap itemprobe off
/scrap gapskip off
```

Items depend on the client/server item cache. If an item is queued, keep the
character online briefly and let `GET_ITEM_INFO_RECEIVED` fill it. By default,
item instant probing is disabled: IDs missing from `GetItemInfoInstant` are
still tooltip-probed and queued, which is slower but better for exhaustive
custom-item crawls. Use `/scrap itemprobe on` only for faster exploratory scans
where skipping server-only or tooltip-only IDs is acceptable.

Adaptive gap skipping is disabled by default so exhaustive item crawls advance
one ID at a time. You can still enable it for faster exploratory scans. After
consecutive missing item IDs, the scanner advances by 1, then 2, then 3, up to
the configured max skip. When it lands on an existing item, it backs up by the
configured backtrack amount and scans densely again so nearby records are not
skipped:

```text
/scrap gapskip 10 20
```

Use `/scrap gapskip off` for exhaustive one-ID-at-a-time scans.

### Automated KnownItems Tooltip Pass

After generating `KnownItems.lua` with `pnpm game:addon-known-items` or
`pnpm game:addon-missing-items`, the companion addon can run the tooltip pass
without manually starting every chunk:

```text
/scrapauto known
```

Defaults are equivalent to batch `25`, mode `missing`, chunk size `20000`, and
offset `1`. `AscensionScraperAuto` starts `/scrap known` chunks through the main
scraper, waits for pending item-cache callbacks to drain, moves the completed
records into the next load-on-demand `AscensionScraperShard###DB`, clears the
main item table, reloads the UI so WoW writes that shard file, and resumes at
the next offset after reload. Use `/scrapauto status`, `/scrapauto stop`, and
`/scrapauto resume` as needed.

### Single SavedVariables File

The scraper writes one SavedVariables artifact:

```text
<wow>/WTF/Account/<ACCOUNT>/SavedVariables/AscensionScraper.lua
```

Sharding is not part of the current workflow. Keep `AscensionScraper` enabled,
run the crawl, then use `/scrap save` to force WoW to write that one file. If
`AscensionScraperAuto` is running, it writes load-on-demand shard files such as
`AscensionScraperShard001.lua` instead of building one huge
`AscensionScraper.lua`.

## 4. Force SavedVariables To Disk

WoW does not write addon data to arbitrary files immediately. Force a write:

```text
/scrap save
```

That reloads the UI. A normal `/reload`, logout, or game exit also writes the
file.

The saved file is:

```text
<wow>/WTF/Account/<ACCOUNT>/SavedVariables/AscensionScraper.lua
```

Examples:

```text
C:\Games\Ascension\WTF\Account\MYACCOUNT\SavedVariables\AscensionScraper.lua
C:\Program Files\Ascension Launcher\resources\client\WTF\Account\MYACCOUNT\SavedVariables\AscensionScraper.lua
```

## 5. Stage SavedVariables Files

Copy one or many SavedVariables Lua files into this repo:

```powershell
New-Item -ItemType Directory -Force "output\addon"
Copy-Item "<wow>\WTF\Account\<ACCOUNT>\SavedVariables\AscensionScraper.lua" "output\addon\account-main.lua"
```

For multiple separated scrapes, give each file a unique name:

```text
output/addon/items-part-1.lua
output/addon/items-part-2.lua
output/addon/spells-warrior.lua
output/addon/spells-mage.lua
output/addon/trainer-paladin.lua
```

The importer recursively reads every `.lua` file under `output/addon` and
merges them. Later files in alphabetical path order override earlier records
with the same ID, so use clear names when you intentionally rescrape a range.

Do not paste only part of a table. Each file should be a raw WoW file with this
top-level assignment:

```lua
AscensionScraperDB = {
  items = {},
  spells = {},
  spellbook = {},
  trainerServices = {},
}
```

JSON is also accepted if you have already converted the table.

## 6. Import Into The Current DB

Run:

```bash
pnpm game:import-scraper
```

Create a timestamped plain SQL backup first, then import:

```bash
pnpm game:import-scraper -- --backup
```

Create only the backup without importing:

```bash
pnpm game:backup
pnpm game:import-scraper -- --backup-only
```

Backups are written to `output/db-backups` by default. Override the path when
needed:

```bash
pnpm game:backup -- --backup-file output/db-backups/before-big-import.sql
pnpm game:import-scraper -- --backup --backup-dir output/db-backups
```

Equivalent explicit commands:

```bash
pnpm game:import-scraper output/addon
pnpm game:import-ascension-scraper output/addon
```

A single file still works when needed:

```bash
pnpm game:import-scraper output/addon/items-part-1.lua
```

Default behavior:

- Fills empty values and placeholder names such as `Item #123`.
- Inserts missing rows into existing `game.aowow_items` and
  `game.aowow_spell` tables when possible.
- Skips columns that do not exist in your current AoWoW-compatible schema.
- Logs import history to `app.import_jobs` / `app.import_logs` when those app
  tables exist.

Useful options:

```powershell
$env:ASCENSION_SCRAPER_OVERWRITE="1"
pnpm game:import-scraper
```

```powershell
$env:ASCENSION_SCRAPER_INSERT_MISSING="0"
pnpm game:import-scraper
```

Use overwrite only when the live client data should replace existing DB text.

## 7. Verify

```bash
pnpm game:check
pnpm typecheck
pnpm lint
pnpm dev
```

Then inspect known touched pages:

```text
/item/<id>
/spell/<id>
```

## What Gets Imported

Items:

- Name -> `aowow_items.name_loc0`
- Tooltip text -> `description_loc0` or compatible tooltip columns if present
- Quality, item level, required level, stack size, vendor price
- Icon ID when the scraped icon exists in `aowow_icons`
- Item class/subclass from `GetItemInfoInstant` when columns exist

Spells:

- Name -> `aowow_spell.name_loc0`
- Rank/subtext -> `rank_loc0`
- Parsed description -> `description_loc0`
- Tooltip text/style JSON only when compatible columns already exist
- School mask, cast time, duration, power type/cost, cooldown, GCD, stack
  amount, required level
- Icon ID when the scraped icon exists in `aowow_icons`

Tooltip color/style data is preserved in the staged SavedVariables artifact.
It is imported only if the current DB already has compatible tooltip JSON/text
columns. This avoids changing the game schema while still keeping the richer
scrape available for future non-destructive views or helper tables.

## Emergency Addon Import

If WoW refuses to load a large SavedVariables file, `AscensionScraper` supports
an import bridge:

1. Paste data into:

   ```text
   <wow>/Interface/AddOns/AscensionScraper/Import.lua
   ```

2. Use this variable name:

   ```lua
   AscensionScraperImportDB = {
     items = {},
     spells = {},
     spellbook = {},
     trainerServices = {},
   }
   ```

3. Temporarily add `Import.lua` to `AscensionScraper.toc`, reload the game, then
   run:

   ```text
   /reload
   /scrap debug
   /scrap import
   /scrap status
   /scrap save
   ```

4. Clear `Import.lua` after the merge is safely saved.
