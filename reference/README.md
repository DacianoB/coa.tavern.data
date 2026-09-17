# Original Tavern query and SQL references

These are source excerpts for understanding how the application joined,
interpreted, displayed, filtered and indexed the imported data. They are not a
standalone runtime package: imports into the full application are intentionally
preserved. Start with `tavern/src/server/game-data/repository.ts` for item
versions, set matching, spell and entity relationship queries.

The SQL files are historical derived read-model migrations. They can depend on
the complete original migration chain, extensions and functions. Do not execute
them as an arbitrary batch against a database. The release already includes
selected materialized results in `community-game.db`.

Runnable data tools are under the repository-root `scripts/` directory; the
standalone scaling implementation is under `src/lib/`.
