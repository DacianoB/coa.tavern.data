# app.itemset_item_links

SQLite file: `community-game.db`. Source object: materialized view. Rows: **138,563**.

Primary key: none recorded.

| Column | PostgreSQL type | SQLite type | Nullable |
| --- | --- | --- | --- |
| `itemset_id` | `integer` | INTEGER | yes |
| `item_id` | `integer` | INTEGER | yes |
| `set_name` | `text` | TEXT | yes |
| `base_item_name` | `text` | TEXT | yes |
| `equipped_count` | `integer` | INTEGER | yes |
| `total_count` | `integer` | INTEGER | yes |
| `captured_at` | `bigint` | INTEGER | yes |
| `source` | `text` | TEXT | yes |

See [type conversions](sqlite-format.md) and [the research map](../README.md).
