# Database downloads

Download `game.db.gz`, `community-game.db.gz` and `manifest.json` from the same
[GitHub release](https://github.com/DacianoB/coa.tavern.data/releases/latest) here.
Run `python scripts/unpack-data.py` from the repository root to verify SHA-256
hashes and decompress. Run `npm run data:verify` for full schema/count/integrity
checks. Large binaries are intentionally kept out of Git history.

The committed manifest describes the initial published snapshot. When downloading
a later release, use its manifest too. [SQLite format](../info/schema/sqlite-format.md)
documents type conversions and the boundary between game and derived data.
