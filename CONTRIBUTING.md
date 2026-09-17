# Contributing

Open an issue or pull request with the item/spell IDs, client/realm/version and
locale, capture method, observed result and expected result. Include the smallest
game-data-only evidence needed to reproduce it. Remove character/account names,
credentials, unrelated SavedVariables and local personal paths.

For a finding, add a Markdown file under `info/` with:

1. The question and IDs/client build examined.
2. Evidence: file hash, capture time, SQL or code function, and raw values.
3. Reproduction steps and field interpretation.
4. What is measured, inferred, missing or still ambiguous.
5. Validation against an independent item/capture where possible.

Preserve original IDs, schema names and column names. Add derived relationships
separately; don't invent replacement game models or destructive migrations.
Never present interpolation, name matching or placeholder defaults as recovered
server logic. Keep raw evidence alongside corrected interpretation when practical.

For new DB snapshots, run `npm run data:verify -- <snapshot-directory>` using
the optional archive tools and include the manifest. For raw files, preserve
original bytes and paths and record checksums, capture method and client version.
Do not add application scaffolding. Large data files belong in releases rather
than Git history. Never commit credentials or mixed private backups.

Contributions of original code/docs use MIT. Do not apply MIT to third-party
game content or code merely because it appears in a capture; preserve attribution.
