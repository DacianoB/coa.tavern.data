# game.aowow_objects

SQLite file: `game.db`. Source object: table. Rows: **0**.

Primary key: `id`.

| Column | PostgreSQL type | SQLite type | Nullable |
| --- | --- | --- | --- |
| `id` | `integer` | INTEGER | no |
| `type` | `smallint` | INTEGER | no |
| `typeCat` | `smallint` | INTEGER | no |
| `event` | `smallint` | INTEGER | no |
| `displayId` | `integer` | INTEGER | no |
| `name_loc0` | `character varying(100)` | TEXT | yes |
| `name_loc2` | `character varying(100)` | TEXT | yes |
| `name_loc3` | `character varying(100)` | TEXT | yes |
| `name_loc4` | `character varying(100)` | TEXT | yes |
| `name_loc6` | `character varying(100)` | TEXT | yes |
| `name_loc8` | `character varying(100)` | TEXT | yes |
| `faction` | `smallint` | INTEGER | no |
| `flags` | `integer` | INTEGER | no |
| `cuFlags` | `integer` | INTEGER | no |
| `lootId` | `integer` | INTEGER | no |
| `lockId` | `smallint` | INTEGER | no |
| `reqSkill` | `smallint` | INTEGER | no |
| `pageTextId` | `smallint` | INTEGER | no |
| `linkedTrap` | `integer` | INTEGER | no |
| `reqQuest` | `integer` | INTEGER | no |
| `spellFocusId` | `smallint` | INTEGER | no |
| `onUseSpell` | `integer` | INTEGER | no |
| `onSuccessSpell` | `integer` | INTEGER | no |
| `auraSpell` | `integer` | INTEGER | no |
| `triggeredSpell` | `integer` | INTEGER | no |
| `miscInfo` | `character varying(128)` | TEXT | no |
| `ScriptOrAI` | `character varying(64)` | TEXT | no |

See [type conversions](sqlite-format.md) and [the research map](../README.md).
