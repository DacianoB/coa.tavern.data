# Raw collected files

Download the six `raw-*.zip` attachments from the
[release](https://github.com/DacianoB/coa.tavern.data/releases/latest).
The ZIP files preserve the original repository-relative paths and original file
bytes. See [manifest.json](manifest.json) for archive/member sizes and SHA-256.

- `raw-savedvariables.zip`: six complete-named `.lua` scrape files and the
  original broken-save `.luax`. File existence is not proof every record imported.
- `raw-client-dbc.zip`: 38 binary DBC files, including extra discovered tables
  beyond the base importer's configured list.
- `raw-client-lua.zip`: extracted UI/constants/character-advancement source files,
  preserving the different extraction folders instead of merging away variants.
- `raw-scaling.zip`: root dense reference, original sparse results and three
  incremental sparse captures.
- `raw-atlasloot.zip`: the local addon source and game-data cache. Unrelated
  personal UI/filter settings are excluded.
- `raw-icons.zip`: the extracted images and original icon-name lists.

The binaries are release attachments, not Git LFS pointers. Use any ZIP utility.
Do not execute SavedVariables as programs; inspect them as data. Extraction/import
methods and known incomplete or broken files are documented under `info/`.

These are the extracted files found in the authorized source repository. Full
installed MPQ archives elsewhere on the computer were not copied.

Filenames are preserved even when a range looks mistyped. Use the file's own
progress/record IDs to establish coverage; do not infer completeness from a
filename. Verify all archive members with `python scripts/verify-raw.py` after
downloading the ZIP files into `raw/` alongside the matching manifest.
