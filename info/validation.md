# Archive validation

The scaling processor regenerated all four parsed JSON files byte for byte from
the included raw Lua captures. The item splitter was exercised on the original
450932 capture and produced one record in one output file.

The database exporter checks source row counts within one read-only PostgreSQL
snapshot, then SQLite integrity. Verification checks hashes, tables, columns,
primary keys and counts. Boolean distributions are additionally compared against
the source. Conversion was tested for booleans/null, 64-bit integers, exact
numeric text, zero, JSON numeric text and binary values before export.

Each raw ZIP is checked for CRC integrity; raw/manifest.json records the SHA-256
of each archive and each original member. No repair or normalization is applied
to the raw bytes. The broken-save `.luax` is identified explicitly.

The numbered download parts were joined using the published unpack script.
Both databases were reconstructed from the release download files and their
SHA-256 hashes matched the verified snapshots. The documented item inspection
command and SQL examples also ran successfully.

No new in-game crawl was performed. A complete fresh PostgreSQL import was not
run during packaging. The source database was read only and the source project's
tracked files were unchanged. The optional base importer rejects populated tables.
