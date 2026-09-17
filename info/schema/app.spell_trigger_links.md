# app.spell_trigger_links

SQLite file: `community-game.db`. Source object: materialized view. Rows: **47,052**.

Primary key: none recorded.

| Column | PostgreSQL type | SQLite type | Nullable |
| --- | --- | --- | --- |
| `source_spell_id` | `integer` | INTEGER | yes |
| `target_spell_id` | `integer` | INTEGER | yes |
| `effect_index` | `integer` | INTEGER | yes |
| `effect_id` | `integer` | INTEGER | yes |
| `aura_id` | `integer` | INTEGER | yes |

See [type conversions](sqlite-format.md) and [the research map](../README.md).
