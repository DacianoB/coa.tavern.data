# Findings and unresolved questions

These are observed limitations in the inspected source/data, not claims about
every version of the game. Each has an implementation or data reference.

| Finding | Evidence | Useful next contribution |
| --- | --- | --- |
| DBC-only items start with placeholder names | `import-ascension-client-data.ts`, item mapping | Capture missing names/tooltips with exact IDs |
| Vendor sell price currently feeds both price columns | `import-ascension-scraper.ts`, `importItems` | Capture independent purchase price and correct mapping with evidence |
| Zero values may be treated as missing during enrichment | Importer `setNumber` family | Review valid zero enum/stat cases with captured examples |
| Tooltip and parsed-effect freshness use different rules | `upsertItemTooltip` vs `replaceItemTooltipEffects` | Record capture version/hash and resolve conflicts together |
| Localized tooltip parsers are pattern-dependent | `parseItemTooltip`, stat/effect regexes | Add measured multilingual fixtures before claiming locale coverage |
| More than ten stats can be truncated | `setItemStats(...).slice(0,10)` | Preserve overflow evidence in an app-owned helper |
| Free-text effects often lack exact spell links | Effects table and legacy spell slots | Verify ID links in game; do not match by prose alone |
| Some effect radius fields contain client radius IDs | DBC spell mapping | Extract radius table and distinguish radius IDs from actual ranges |
| Trainer/spellbook collections are counted, not fully imported | Scraper main loop and `importSpells` | Add explicit field mappings and verify required skills/costs |
| Scaling is partial and interpolation is an estimate | ScaleDump rows/rule validation metrics | Dense scans at unmeasured levels and independent holdouts |
| Scaling merge order uses filesystem mtime | `findSparseDumpFiles` | Explicit capture sequence/hash metadata for future merges |
| Bloodforged version grouping is name based | `baseItemName`, item_versions | Verify families without conflating distinct item IDs |
| Set membership may come from tooltip/name fallback | Repository set resolvers; helper SQL | Confirm exact piece IDs and threshold spells |
| World/server tables are incomplete | Snapshot empty-table list | Authorized world exports or documented observations |
| AtlasLoot is catalog evidence, not drop probability | Importer and source-file/line fields | Distinguish addon source associations from observed loot |
| Builder overlay provenance is incomplete | Talent `source`; historical notes | Recover/share the original builder payload and exact transform |
| Whole-record/per-field import history is incomplete | Only some rows have source/capture fields | Add non-destructive provenance helpers outside legacy tables |
| Some read models can lag their source | Materialized views copied as stored | Compare source rows before treating derived output as authoritative |

Full installed MPQ archives, mixed private backup dumps, personal account data
and community records are outside the publication. Raw item captures, extracted
DBC/Lua files, icons, scaling captures and AtlasLoot game data are included as
raw archives. The database snapshot contains only what was actually stored;
the raw files may contain additional fields or records that earlier importers
ignored. The broken-save `.luax` is retained for future recovery research.
