# game.aowow_spawns

SQLite file: `game.db`. Source object: table. Rows: **0**.

Primary key: `guid`, `type`, `floor`.

| Column | PostgreSQL type | SQLite type | Nullable |
| --- | --- | --- | --- |
| `guid` | `integer` | INTEGER | no |
| `type` | `smallint` | INTEGER | no |
| `typeId` | `integer` | INTEGER | no |
| `respawn` | `integer` | INTEGER | no |
| `spawnMask` | `smallint` | INTEGER | no |
| `phaseMask` | `smallint` | INTEGER | no |
| `areaId` | `smallint` | INTEGER | no |
| `floor` | `smallint` | INTEGER | no |
| `posX` | `real` | REAL | no |
| `posY` | `real` | REAL | no |
| `pathId` | `integer` | INTEGER | no |

See [type conversions](sqlite-format.md) and [the research map](../README.md).
