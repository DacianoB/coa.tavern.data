# Published snapshot findings

Export started at **2026-09-17T18:39:48.398Z** (UTC). This is the export time, not a claim that the game was scraped at that time.

The release contains **93 tables** with **2,964,669 rows**, including empty tables. Rows across related tables are not unique game entities.

## Main datasets

| Dataset | Exact rows |
| --- | ---: |
| `game.aowow_items` | 559,994 |
| `game.aowow_spell` | 204,535 |
| `app.item_tooltips` | 473,340 |
| `app.item_tooltip_effects` | 700,635 |
| `app.item_versions` | 559,994 |
| `game.aowow_talent_tree_nodes` | 11,900 |
| `game.aowow_talent_tree_node_ranks` | 16,400 |
| `app.atlasloot_entries` | 23,398 |

## Coverage checks

These counts are computed from the released SQLite files. The query is included so the finding can be reproduced.

**Items with placeholder or blank names: 9,726.**

```sql
SELECT count(*) FROM aowow_items WHERE name_loc0 IS NULL OR trim(name_loc0)='' OR name_loc0='Item #' || id;
```

**Items without any stored tooltip row: 86,654.**

```sql
SELECT count(*) FROM aowow_items i LEFT JOIN derived.item_tooltips t ON t.item_id=i.id WHERE t.item_id IS NULL;
```

**Stored tooltip rows without a matching item: 0.**

```sql
SELECT count(*) FROM derived.item_tooltips t LEFT JOIN aowow_items i ON i.id=t.item_id WHERE i.id IS NULL;
```

**Parsed effect rows without a matching item: 0.**

```sql
SELECT count(*) FROM derived.item_tooltip_effects t LEFT JOIN aowow_items i ON i.id=t.item_id WHERE i.id IS NULL;
```

**Named items with iconId=0 or a missing icon reference: 0.**

```sql
SELECT count(*) FROM aowow_items i LEFT JOIN aowow_icons icon ON icon.id=i.iconId WHERE i.name_loc0 IS NOT NULL AND trim(i.name_loc0)<>'' AND i.name_loc0 <> 'Item #' || i.id AND (i.iconId=0 OR icon.id IS NULL);
```

## Talent source markers

| Source | Class ID | Nodes |
| --- | ---: | ---: |
| `coa_exporter_catalog` | 1 | 601 |
| `coa_exporter_catalog` | 2 | 528 |
| `coa_exporter_catalog` | 3 | 608 |
| `coa_exporter_catalog` | 4 | 542 |
| `coa_exporter_catalog` | 5 | 504 |
| `coa_exporter_catalog` | 6 | 430 |
| `coa_exporter_catalog` | 7 | 629 |
| `coa_exporter_catalog` | 8 | 618 |
| `coa_exporter_catalog` | 9 | 614 |
| `coa_exporter_catalog` | 10 | 2,555 |
| `coa_exporter_catalog` | 11 | 656 |
| `coa_builder_json` | 12 | 161 |
| `coa_exporter_catalog` | 13 | 160 |
| `coa_exporter_catalog` | 14 | 158 |
| `coa_exporter_catalog` | 15 | 191 |
| `coa_exporter_catalog` | 16 | 156 |
| `coa_exporter_catalog` | 17 | 156 |
| `coa_exporter_catalog` | 18 | 162 |
| `coa_exporter_catalog` | 19 | 157 |
| `coa_exporter_catalog` | 20 | 208 |
| `coa_exporter_catalog` | 21 | 164 |
| `coa_exporter_catalog` | 22 | 157 |
| `coa_exporter_catalog` | 23 | 160 |
| `coa_exporter_catalog` | 24 | 159 |
| `coa_exporter_catalog` | 25 | 197 |
| `coa_exporter_catalog` | 26 | 192 |
| `coa_exporter_catalog` | 27 | 202 |
| `coa_exporter_catalog` | 28 | 158 |
| `coa_exporter_catalog` | 29 | 201 |
| `coa_exporter_catalog` | 30 | 153 |
| `coa_exporter_catalog` | 31 | 203 |
| `coa_exporter_catalog` | 32 | 160 |

## Empty exported tables

Empty means no rows in this snapshot, not that the corresponding game feature does not exist.

- `game.aowow_achievementcriteria`
- `game.aowow_areatrigger`
- `game.aowow_creature`
- `game.aowow_creature_sounds`
- `game.aowow_creature_waypoints`
- `game.aowow_declinedword`
- `game.aowow_declinedwordcases`
- `game.aowow_emotes_aliasses`
- `game.aowow_emotes_sounds`
- `game.aowow_events`
- `game.aowow_factiontemplate`
- `game.aowow_glyphproperties`
- `game.aowow_holidays`
- `game.aowow_item_stats`
- `game.aowow_itemenchantmentcondition`
- `game.aowow_itemextendedcost`
- `game.aowow_itemlimitcategory`
- `game.aowow_itemrandomenchant`
- `game.aowow_itemrandomproppoints`
- `game.aowow_items_sounds`
- `game.aowow_lock`
- `game.aowow_loot_link`
- `game.aowow_objects`
- `game.aowow_quests`
- `game.aowow_quests_startend`
- `game.aowow_races_sounds`
- `game.aowow_scalingstatdistribution`
- `game.aowow_scalingstatvalues`
- `game.aowow_screeneffect_sounds`
- `game.aowow_shapeshiftforms`
- `game.aowow_sounds_files`
- `game.aowow_source`
- `game.aowow_spawns`
- `game.aowow_spawns_override`
- `game.aowow_spell_sounds`
- `game.aowow_spelldifficulty`
- `game.aowow_spellfocusobject`
- `game.aowow_spelloverride`
- `game.aowow_spellvariables`
- `game.aowow_taxinodes`
- `game.aowow_taxipath`
- `game.aowow_totemcategory`
- `game.aowow_zones_sounds`
- `app.item_spell_links`

## Missing source tables

None.

## Files and checksums

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `game.db` | 321,925,120 | `ee562ff72ad8adad77d5aaf6fc9103ec3e706c5598d28dfaf8ebc887a4a30cb9` |
| `game.db.gz` | 38,195,155 | `84dec0f9573c5be99f298b41d501ddd1a27d09dc11988fbb12be5687e7492d11` |
| `community-game.db` | 6,907,219,968 | `4d2e56eee43176f984a1aa27b548149319f6a779e98fa56ac34aa5d7d3613ac9` |
| `community-game.db.gz` | 173,600,566 | `22d4f742ebd920c69d133c623261086493d18573357364a5bc0640d55052448b` |
| `community-game.db.gz.part01` | 25,165,824 | `35c8eaf7f208ea5b65cd842c9edc784167a550bc03c6583ac96a9f4ed02c870e` |
| `community-game.db.gz.part02` | 25,165,824 | `0c842b91a93dd99b84fd6646f1ede1c932d3b826f92097f855cd5d200d100eb0` |
| `community-game.db.gz.part03` | 25,165,824 | `9f14cac3f0f26858638002f026a748dc550de6aeea486b6a173b16a373938944` |
| `community-game.db.gz.part04` | 25,165,824 | `d5d2114b99690011b43ced4aaedb5e76ed00f374284750b0a79366ddb2e8e385` |
| `community-game.db.gz.part05` | 25,165,824 | `53b3dfc237cd47cc4ea13a306ee8c9547a6b007634e71949dfbcc58585e50f9e` |
| `community-game.db.gz.part06` | 25,165,824 | `b99789fdc186f4a70cfbe6221aee67e4bac32d91b4a689b5e3db7752aae0bee0` |
| `community-game.db.gz.part07` | 22,605,622 | `892d3b3206d32e03ee84bdbeb7b99fe5a7b82cbd860e200bfc73cd2e5068f493` |

The large helper gzip is downloaded as numbered byte parts; the whole-gzip hash above verifies the reconstructed file. `scripts/unpack-data.py` joins and verifies the parts automatically.


See [the complete dictionary](schema/README.md), [manifest](../data/manifest.json), and [known limitations](known-gaps.md).
