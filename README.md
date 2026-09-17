# coa.tavern.data

A public archive of the data collected for CoA Tavern: **raw files, database
snapshots, their structure, and the findings behind them**.

**[Download all data](https://github.com/DacianoB/coa.tavern.data/releases/latest)** ?
**[Research and explanations](info/README.md)** ? **[Database structure](info/schema/README.md)**

No application is required. Download the files and open the databases with any
SQLite viewer, inspect the raw Lua/DBC files, or read the Markdown documentation.

## What is shared

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
