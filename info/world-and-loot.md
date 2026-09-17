# World catalogs and loot

Client DBCs provide zones, factions, achievements, pets/families, currencies,
titles, mail templates, sounds and other catalogs. They do not supply a complete
server world database: quests, creature/object templates, spawn coordinates,
loot rules and scripts may be absent. Zero-row tables remain in the export so
the absence is visible. Consult [snapshot.md](snapshot.md) for actual counts.

The exported `aowow_mails` contains **game mail templates**, not private player
mail. Account/profile tables from both schemas are excluded.

## AtlasLoot

`scripts/import-atlasloot.ts` parses a local AtlasLoot addon tree into three
app-owned tables. It retains menu hierarchy, modules/expansions/categories,
pages/groups, positions, item/spell IDs, price/difficulty text and source Lua
file/line. Those rows are in `community-game.db`.

```sql
SELECT t.module, t.name, e.page_name, e.group_name,
       e.item_id, e.spell_id, e.price, e.source_file, e.source_line
FROM atlasloot_entries e
JOIN atlasloot_tables t ON t.id = e.table_id
WHERE e.item_id = 19019;
```

These are catalog associations from addon code, not measured drops or a world
server's loot tables. Preserve `entity_kind`: not every entry denotes an item.
Some entries reference another loot entry/group rather than a direct item.

The available raw AtlasLoot addon is in `raw-atlasloot.zip`. Preserve its original
files and attribution. The reference importer accepts `--addon=/path/to/AtlasLootAddon`.
The original import did not record an upstream commit, so current files may
produce different counts. Parsing has a `--dry-run` mode; import-history logging
can still write to `app.import_jobs` when those optional tables exist.

## Additional display-time data

Tavern includes an optional external item-page fallback in
`reference/tavern/src/server/game-data/exil-reference.ts`. Such runtime/cache
lookups are not necessarily persisted in PostgreSQL and are not represented as
a separate downloaded dataset here. The public export describes stored rows,
not every transient value that might have appeared in the app.
