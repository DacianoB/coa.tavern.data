# game.aowow_coa_builder_realms

SQLite file: `game.db`. Source object: table. Rows: **1**.

Primary key: `id`.

| Column | PostgreSQL type | SQLite type | Nullable |
| --- | --- | --- | --- |
| `id` | `integer` | INTEGER | no |
| `slug` | `text` | TEXT | no |
| `name` | `text` | TEXT | no |
| `max_level` | `integer` | INTEGER | no |
| `schema_version` | `jsonb` | TEXT | no |
| `source_import_id` | `integer` | INTEGER | yes |

See [type conversions](sqlite-format.md) and [the research map](../README.md).
