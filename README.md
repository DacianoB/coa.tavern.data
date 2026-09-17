# coa.tavern.data

A public archive of the data collected for CoA Tavern: **raw files, database
snapshots, their structure, and the findings behind them**.

**[Download all data](https://github.com/DacianoB/coa.tavern.data/releases/latest)** |
**[Research and explanations](info/README.md)** | **[Database structure](info/schema/README.md)**

No application is required. Download the files and open the databases with any
SQLite viewer, inspect the raw Lua/DBC files, or read the Markdown documentation.

## How the data was collected

Base tables, Lua definitions and icons were extracted from the Ascension client's
MPQ archives. In-game addons queried item/spell APIs and tooltips, waited for
cached responses, and saved the captures as Lua SavedVariables on reload/logout.
Import scripts parsed and merged those captures into AoWoW-compatible PostgreSQL
tables; this archive shares the original files, table structure and SQLite exports.
See [the capture process](info/pipeline/in-game-scraping.md).

## What was found about item scaling

ScaleDump called `GetScalingItemStats(itemID, level)` at levels **1, 15, 30, 45
and 60**, plus an item's default level when needed. The merged captures contain
**11,829 items and 62,225 measured item/level rows**. Another **100 reference
items were measured at every level from 1 to 60**, providing observed curves
for reconstructing values between sparse measurements.

Reconstruction uses exact measurements first, then compatible reference curves
to estimate individual numeric fields between anchors. It produced **25,069
field rules for 5,652 items**; recorded validation errors describe how well each
rule fits available measurements. Stat IDs are categorical, missing fields in a
captured row mean zero, and missing rows remain unknown. Reborn armor also needs
separate handling: item 5016 at level 60 has raw armor 226 but displayed Reborn
armor 54. Estimates and fallback values remain distinguishable from captures.

Read [the scaling findings, formula and limitations](info/items/scaling.md), or
inspect [the measured data and rules](data/scaling/).

## What is shared

The initial snapshot contains **93 tables**, including **559,994 item records**,
**204,535 spell records** and **473,340 stored tooltips**. The two compressed
databases total about **212 MB to download / 7.23 GB unpacked**. See the
[snapshot findings](info/snapshot.md) for exact counts, coverage and checksums.

| Location / download | Contents |
| --- | --- |
| `game.db.gz` | All selected legacy game tables: items, spells, talents, classes, races, zones and other catalogs |
| `community-game.db.gz` | Stored tooltips, parsed effects, item versions, set/spell links and AtlasLoot relationships |
| `manifest.json` | Complete DB table/column structure, original types, keys, row counts and hashes |
| `raw-savedvariables.zip` | Original item scrape Lua files, including the separately identified broken-save `.luax` |
| `raw-client-dbc.zip` | 38 extracted client DBC files in their original binary format |
| `raw-client-lua.zip` | Extracted client UI/constants/talent Lua and related files |
| `raw-scaling.zip` | Original sparse and dense ScaleDump captures |
| `raw-atlasloot.zip` | The available AtlasLoot source tables/addon files and game-data cache |
| `raw-icons.zip` | Extracted game icons and icon-name lists |
| `raw/manifest.json` | Every raw archive member's original path, byte size and SHA-256 |
| `data/scaling/` | Parsed scaling measurements, dense reference data and inferred rules |
| `info/` | Findings, field mappings, scraping methods, limitations and full data dictionary |
| `info/schema/postgresql-structure.json` | Original PostgreSQL columns/defaults, constraints, indexes and view definitions |
| `scripts/`, `Inteface/Addons/`, `reference/` | Original extraction/import/addon logic and relevant SQL/query references |

Large raw archives and databases are attached to the release, keeping Git useful
for browsing the documentation and smaller data files. Original relative paths
are preserved inside each ZIP. The `.luax` broken save is retained as evidence;
it is not silently repaired or presented as a valid import.

## Open the database files

Download both `.db.gz` files and their matching `manifest.json` from the same
release into `data/`. Decompress with your archive utility, or verify/decompress
with Python 3.11+:

```bash
python scripts/unpack-data.py
```

Open `game.db` or `community-game.db` in a SQLite viewer. See
[SQL examples](examples/items.sql) and [the item reconstruction notes](info/items/rebuilding-items.md).
An optional Python command prints all recorded evidence for one item:

```bash
python scripts/inspect-item.py 5016
```

## Understand how the data was collected

Start with [the research map](info/README.md) and
[the collection/import/export pipeline](info/pipeline/reproduce.md).
The repository preserves the extraction scripts as documentation and optional
research tools. Node dependencies are only needed if you choose to rerun those
tools; there is no website, server, build process or application to launch.

The original database is PostgreSQL; these `.db` downloads are portable SQLite
snapshots. Raw client `.dbc` files and addon `.lua` captures are also provided.
Measured, inferred, placeholder and missing values are distinguished in the notes.

Personal/community accounts, credentials, character logs and mixed private
backups are excluded. Original code/docs use MIT; third-party game content and
addon material retain their attribution in [NOTICE.md](NOTICE.md).
