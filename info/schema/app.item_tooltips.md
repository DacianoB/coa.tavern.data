# app.item_tooltips

SQLite file: `community-game.db`. Source object: table. Rows: **473,340**.

Primary key: `item_id`.

| Column | PostgreSQL type | SQLite type | Nullable |
| --- | --- | --- | --- |
| `item_id` | `integer` | INTEGER | no |
| `tooltip_text` | `text` | TEXT | no |
| `tooltip_lines` | `jsonb` | TEXT | no |
| `tooltip_captured` | `boolean` | INTEGER | no |
| `source` | `text` | TEXT | no |
| `captured_at` | `bigint` | INTEGER | yes |
| `metadata` | `jsonb` | TEXT | no |
| `created_at` | `timestamp with time zone` | TEXT | no |
| `updated_at` | `timestamp with time zone` | TEXT | no |

See [type conversions](sqlite-format.md) and [the research map](../README.md).
