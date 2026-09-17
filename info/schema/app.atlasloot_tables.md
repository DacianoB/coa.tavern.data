# app.atlasloot_tables

SQLite file: `community-game.db`. Source object: table. Rows: **279**.

Primary key: `id`.

| Column | PostgreSQL type | SQLite type | Nullable |
| --- | --- | --- | --- |
| `id` | `text` | TEXT | no |
| `module` | `text` | TEXT | no |
| `expansion` | `text` | TEXT | no |
| `category` | `text` | TEXT | no |
| `name` | `text` | TEXT | no |
| `display_name` | `text` | TEXT | yes |
| `type` | `text` | TEXT | yes |
| `map` | `text` | TEXT | yes |
| `source_file` | `text` | TEXT | no |
| `source_line` | `integer` | INTEGER | no |
| `sort_order` | `integer` | INTEGER | no |
| `metadata` | `jsonb` | TEXT | no |
| `created_at` | `timestamp with time zone` | TEXT | no |
| `updated_at` | `timestamp with time zone` | TEXT | no |

See [type conversions](sqlite-format.md) and [the research map](../README.md).
