# Portable SQLite snapshot format

[postgresql-structure.json](postgresql-structure.json) preserves the inspected
source column types/defaults, constraints, indexes and view definitions. It also
includes definitions for redundant game summary/search read models whose cached
rows are not separately copied. This is structural documentation, not a migration
to execute blindly: some definitions reference functions or excluded import metadata.

The source database is PostgreSQL with `game` and `app` namespaces. The new `.db`
files are SQLite **exports**, not original game client files. `.dbc`, addon
SavedVariables `.lua`, PostgreSQL and SQLite are distinct formats.

| PostgreSQL source | SQLite file |
| --- | --- |
| Allowlisted `game.*` | `game.db`, original table/column names |
| Allowlisted `app.*` game helpers | `community-game.db`, original table/column names |

Use `ATTACH DATABASE 'data/community-game.db' AS derived` to join the files.
SQLite has no PostgreSQL `game` schema unless you explicitly attach using that
alias. Do not rename the legacy source schema to accommodate the export.

## Numbered download parts

The initial release distributes `community-game.db.gz` as seven consecutive
byte parts, `community-game.db.gz.part01` through `.part07`. Each is at most
24 MiB. Download all parts and the matching manifest into `data/`, then run
`python scripts/unpack-data.py`. It checks each part, joins them in manifest
order, verifies the original gzip hash, and decompresses the complete database.
Individual parts are not independently decompressible archives.

The manifest's optional `compressedParts` array records each part's filename,
byte count and SHA-256. `compressedFile` and `compressedSha256` still describe
the reconstructed gzip. Splitting changes download packaging, not any database
bytes. The separate `game.db.gz` remains a single download.

The publication used `python scripts/package-download-parts.py` after export.
This preserves the complete local gzip and adds parts for compressed files over
100 MiB. Numbered parts were used because the large single-file upload repeatedly
slowed or retried. Raw collection ZIPs are independent archives, not these parts.

## Values and types

- `smallint`, `integer`, `bigint`, `oid` become INTEGER; integer text is parsed
  through BigInt, not a JavaScript floating-point round trip.
- Boolean becomes INTEGER 0/1. Null stays null.
- `real` / `double precision` become REAL; non-finite values cause export failure.
- Exact `numeric` values become TEXT to preserve decimal precision.
- JSON/JSONB, arrays, date/time and other types remain PostgreSQL text, including
  array literals. JSON fields can be read with SQLite JSON functions or a JSON
  parser. Timestamps are exported with the PostgreSQL session in UTC.
- `bytea` becomes a BLOB. String case, negative numbers and zero are preserved.

The manifest lists both original PostgreSQL type and SQLite affinity for every
column, and the original primary key. Primary keys and NOT NULL constraints are
recreated; foreign keys, defaults, sequences, secondary indexes, functions and
live view semantics are not. Materialized views (such as item versions) become
plain snapshot tables. This is a portable research dataset, not a full database
backup or a one-command restoration of the Tavern application.

SQLite preserves names but resolves identifiers case-insensitively. There are
no conflicting names in the verified snapshot. Quote identifiers when moving
camel-case columns back to PostgreSQL.

## Consistency and provenance

Both files are generated within one PostgreSQL repeatable-read read-only
transaction. Rows stream without a source-side sort; row order has no semantic
meaning and SQLite primary keys still identify the records. Source counts are compared while that snapshot is open. The source
repository commit identifies the copied logic, not a guarantee that every row
was created by that exact commit. Some rows were imported earlier, and some
overlays have incomplete original provenance.

The manifest records exported and missing tables, excluded tables, counts and
SHA-256 hashes. An empty exported table and an absent source table are different
states. Release file hashes establish that your files match this release; a
fresh export can have different hashes after timestamps, source data, PostgreSQL
text formatting or SQLite layout change.

## Querying

The snapshot recreates primary keys but not every performance index. For repeated
exploratory scans you can make your own working copy and add indexes there.
Keep the downloaded files unchanged if you want checksum verification to pass.

Do not use SQLite's numeric coercion of TEXT decimals for exact financial-style
precision. Game consumers should explicitly parse types from the manifest.
Likewise, some large integers require BigInt-aware readers outside Python/SQLite.
