# app.atlasloot_entries

SQLite file: `community-game.db`. Source object: table. Rows: **23,398**.

Primary key: `id`.

| Column | PostgreSQL type | SQLite type | Nullable |
| --- | --- | --- | --- |
| `id` | `bigint` | INTEGER | no |
| `table_id` | `text` | TEXT | no |
| `page_index` | `integer` | INTEGER | no |
| `page_name` | `text` | TEXT | no |
| `group_index` | `integer` | INTEGER | no |
| `group_name` | `text` | TEXT | yes |
| `position` | `integer` | INTEGER | no |
| `item_id` | `integer` | INTEGER | yes |
| `item_name` | `text` | TEXT | yes |
| `ref_loot_entry` | `integer` | INTEGER | yes |
| `group_id` | `integer` | INTEGER | yes |
| `min_difficulty` | `text` | TEXT | yes |
| `max_difficulty` | `text` | TEXT | yes |
| `price` | `text` | TEXT | yes |
| `description` | `text` | TEXT | yes |
| `metadata` | `jsonb` | TEXT | no |
| `source_file` | `text` | TEXT | no |
| `source_line` | `integer` | INTEGER | no |
| `entity_kind` | `text` | TEXT | no |
| `entity_id` | `integer` | INTEGER | no |
| `spell_id` | `integer` | INTEGER | yes |
| `icon` | `text` | TEXT | yes |

See [type conversions](sqlite-format.md) and [the research map](../README.md).
