# game.aowow_coa_builder_entries

SQLite file: `game.db`. Source object: table. Rows: **3,612**.

Primary key: `entry_id`.

| Column | PostgreSQL type | SQLite type | Nullable |
| --- | --- | --- | --- |
| `entry_id` | `integer` | INTEGER | no |
| `class_id` | `integer` | INTEGER | no |
| `tab_id` | `integer` | INTEGER | no |
| `tab_key` | `text` | TEXT | no |
| `name` | `text` | TEXT | no |
| `flags` | `integer` | INTEGER | no |
| `group_id` | `integer` | INTEGER | no |
| `ae_cost` | `integer` | INTEGER | no |
| `te_cost` | `integer` | INTEGER | no |
| `spell_id` | `integer` | INTEGER | no |
| `icon_path` | `text` | TEXT | no |
| `node_type` | `text` | TEXT | no |
| `req_tab_ae` | `integer` | INTEGER | no |
| `req_tab_te` | `integer` | INTEGER | no |
| `entry_type` | `text` | TEXT | no |
| `is_passive` | `integer` | INTEGER | no |
| `max_points` | `integer` | INTEGER | no |
| `sort_order` | `integer` | INTEGER | no |
| `description` | `text` | TEXT | no |
| `required_level` | `integer` | INTEGER | no |
| `is_starting_node` | `integer` | INTEGER | no |
| `x` | `numeric` | TEXT | no |
| `y` | `numeric` | TEXT | no |
| `spell_ids` | `jsonb` | TEXT | no |
| `required_ids` | `jsonb` | TEXT | no |
| `connected_node_ids` | `jsonb` | TEXT | no |
| `rank_descriptions` | `jsonb` | TEXT | no |
| `raw_json` | `jsonb` | TEXT | no |
| `source_import_id` | `integer` | INTEGER | yes |

See [type conversions](sqlite-format.md) and [the research map](../README.md).
