# Rebuilding an item from the evidence

Start with `python scripts/inspect-item.py 5016`. This prints the exact legacy
row, captured tooltip, parsed effects, and measured scaling rows without filling
in missing values. [examples/items.sql](../../examples/items.sql) shows the joins.

## Sources have different jobs

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| `game.db:aowow_items` | Current imported item record, original ID and legacy fields | Every field is measured; zero/default fields may mean not recovered |
| `community-game.db:item_tooltips` | Stored tooltip text/style and capture timestamp where available | Complete server-side mechanics or a full capture history |
| `item_tooltip_effects` | Parsed Use/Equip/Proc-style effect lines | A verified spell ID for every free-text effect |
| `aowow_spell`, item/spell link helpers | Known effect/spell/item links | Unseen server scripts or complete proc conditions |
| `data/scaling/scaledump-results.json` | Exact captured `GetScalingItemStats` rows | Every item at every level |
| `scaledump-rules.json` | A fitted reference-column rule with error metrics | Exact server scaling formulas |
| AtlasLoot entries | Addon catalog/source associations | Observed drops, authoritative loot rates or spawn data |

## Field mapping used by the importer

The executable mapping is in `importItems`, `parseItemTooltip`, `setItemStats`,
and their setters in [import-ascension-scraper.ts](../../scripts/import-ascension-scraper.ts).

| Capture field | Legacy destination / transformation |
| --- | --- |
| `name` | `name_loc0`, replacing missing names or `Item #<id>`; overwrite option can replace real text |
| `quality`, `itemLevel`, `requiredLevel` | Same-named fields, with instant/parsed tooltip fallbacks |
| `maxStack` | `stackable` |
| `vendorPrice`, parsed sell price | Currently written to **both** `buyPrice` and `sellPrice`; buy price is not independently measured |
| `instant.classId`, `instant.subClassId` | `class`/`classBak`, `subClass`/`subClassBak` |
| `equipSlot`, instant inventory type | `slot`/`slotBak` via inventory mapping |
| `icon` / instant icon | Normalized basename lookup in `aowow_icons`; unresolved icon becomes no valid link |
| Tooltip damage and speed | `dmgMin1`, `dmgMax1`, `delay` (milliseconds) through specialized numeric setters |
| API stats + parsed tooltip stats | First ten supported nonzero stat pairs in `statType1..10` / `statValue1..10`; parsed keys take precedence |
| Tooltip binding text | `bonding` |
| Source/flavor description | Normalized description in existing locale columns |
| Cleaned tooltip and styled lines | `app.item_tooltips`; compatible legacy tooltip fields where present |
| Parsed effect labels/text | `app.item_tooltip_effects`, independent of spell-ID slots |

The importer strips character-specific appearance collection lines and addon
`ID <number>` debug lines. Formatting/color data is retained in stored tooltip
lines. Description parsing separates flavor/source text from a whole copied
tooltip. Preserve the captured text when evaluating parser changes.

`setNumber` and related helpers are legacy enrichment heuristics. They commonly
treat zero as empty and ignore zero updates. This can be wrong for legitimate
zero-valued enum fields. The public export itself preserves zero and negative
values exactly; don't mistake preservation of the database for proof that an
earlier import captured every zero correctly.

## A practical reconstruction sequence

1. Load by exact item ID; preserve that ID and the original names/case of columns.
2. Join the icon by `iconId`. Keep class, subclass, slot, quality and display data.
3. Inspect the tooltip snapshot and capture time. Compare parsed stats/effects to
   the raw text; missing tooltip is an evidence gap, not an empty item.
4. Check `spellId1..5` and relationship tables. Keep unlinked effect text as text
   instead of inventing a matching spell. Inspect linked spells' effect/trigger
   fields, and watch for incomplete radius/timing mappings.
5. If the item has ScaleDump observations, use exact measured rows at measured
   levels. At intermediate levels explicitly label inferred/fallback values.
6. Resolve set membership through `itemset_item_links`, set thresholds/spell
   links, then tooltip evidence. Record which route produced the result.
7. Keep unknown server behavior separate: drop rate, proc chance, cooldown,
   stacking, scripts and scaling curves need independent evidence.

## Versions and sets are partly reconstructed

Tavern groups item versions by a base name that strips repeated leading
`Bloodforged ` prefixes. It sorts versions by item level and uses the lowest-level
row as the base. That is a display/reconstruction heuristic, not a proven shared
server template. Do not merge different IDs merely because names match.

Set membership can come from direct imported item slots, derived helper links,
or a tooltip block like `Set Name (0/8)`. Name-based fallback resolves pieces and
variants, so ambiguous same-name records need manual verification. The original
queries are in `reference/tavern/src/server/game-data/repository.ts` around
`baseItemName`, `parseItemSetTooltipBlock`, `resolveItemSetPieces`, and
`queryItemVersionsByBaseName`.

SQLite snapshots retain placeholder/test records, even when Tavern's UI hides
them. UI visibility filters are not evidence that an item was absent from the
client. See `reference/tavern/src/server/game-data/visibility.ts`.
