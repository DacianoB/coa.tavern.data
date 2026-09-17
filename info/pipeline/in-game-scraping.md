# In-game capture and SavedVariables

Copy `Inteface/Addons/AscensionScraper` into your client's
`Interface/AddOns/AscensionScraper`. The repository's `Inteface` spelling is
historical; the installed game folder must be `Interface/AddOns`.

Enable it, enter the world, then try a small range:

```text
/scrap status
/scrap items 1 5000 10
/scrap spells 1 5000 100
/scrap item 19019
/scrap spell 133
/scrap save
```

Expand ranges for high custom IDs after checking results. An ID range is not a
count of valid items. A missing response may mean missing cache data, a delayed
server response or an invalid ID; it is not proof that the item never existed.

`GetItemInfo` and tooltip queries depend on client/server caching. The addon
queues records and waits for callbacks such as `GET_ITEM_INFO_RECEIVED`. Keep
the character online while pending requests drain. Instant probing and gap
skipping are off by default; enabling either makes an exploratory scan faster
but can miss custom or isolated records. See the addon's command list for tuning.

`/scrap save` reloads the UI so WoW writes SavedVariables. `/reload`, logout and
game exit also write them. The main file is:

```text
<client>/WTF/Account/<ACCOUNT>/SavedVariables/AscensionScraper.lua
```

Keep original files locally and give distinct captures distinct filenames.
Complete input tables use `AscensionScraperDB` and `items`/`spells` records.
Don't upload an entire account directory or unrelated SavedVariables.

## Automated tooltip chunks

Install `AscensionScraperAuto` and all 30 included
`AscensionScraperShard001` ... `AscensionScraperShard030` folders too. Generate
the known-ID list using your source database/captures:

```bash
npm run game:addon-known-items
```

Copy the regenerated `KnownItems.lua` into the installed main addon, then run:

```text
/scrapauto known
/scrapauto status
/scrapauto stop
/scrapauto resume
```

The default controller uses batch 25, missing mode and 20,000 entries per chunk.
It drains pending requests, moves completed items to a load-on-demand shard,
clears the main item table, reloads to save, then resumes. Copy the resulting
`AscensionScraperShard*.lua` files into your local staging directory and split
or import them explicitly. Main-only scans and automated sharded scans are two
different supported paths; older notes saying sharding is unused are outdated.

## Parsing and merge caveats

The importer handles files in sorted path order. Each record goes through
field-specific fill/overwrite rules; it is **not** an unconditional last-file-wins
merge. Tooltip snapshots replace earlier text only when the new text is at least
as long (or existing text is null); longer does not necessarily mean newer or
more correct. Parsed effects have a separate replacement path. Inspect the
tooltip and effect sources together when a new capture disagrees with old data.

`/scrap spellbook` and `/scrap trainer` are capture helpers, but this importer
currently only counts the separate `spellbook` and `trainerServices` collections;
its write calls import `items` and `spells`. Do not claim dedicated trainer
requirements/costs were imported just because the capture contains them.

The item splitter is line/indentation based, not a general Lua parser. Use the
format emitted by these addons, retain the original capture, and compare input
and output record counts. `.luax` broken-save files are not automatically imported.
