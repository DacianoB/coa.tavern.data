# ScaleDump Guide

## What The Addon Captures

`ScaleDump.lua` calls the client API:

```lua
GetScalingItemStats(itemID, level)
```

The second argument is the target scaling level. The result is a table keyed by
the schema names in `ScaleDumpDB.schema`.

The current `Scaledump_results.lua` scan was run in `anchors15` mode, so almost
every saved item has only these known levels:

```text
1, 15, 30, 45, 60
```

## Running The Addon

`/scaledump` defaults to:

```text
/scaledump 1 anchors15 50 1
```

That starts at known-item index `1`, scans levels `1,15,30,45,60`, does up to
`50` API calls per frame, and includes item IDs from `1` upward. In non-`one`
scan modes, each item also scans its own default item level from
`GetItemLevelInstant(itemID)` when that level is not already in the level list.

The scan stops after `6000` newly saved scalable items as a manual checkpoint.
Use `/scaleresume` to continue from that exact in-memory progress without
starting over. Reconnect only if the heartbeat/canary fails or the server starts
returning bad data again.

Progress also stores `lastScalingIndex` / `last_scalling_index` and
`lastScalingItemID` / `last_scalling_item_id`, which point to the last known-ID
index and item ID that actually produced scaling data.

The optional fifth argument overrides the saved-item run cap:

```text
/scaledump 1 anchors15 50 1 3000
/scaledump 1 anchors15 50 1 0
```

Use `0` only when you deliberately want no per-run cap.

Many non-scaling items return `nil`, so the addon does not treat every `nil` as
a failure. Instead it sends an invisible addon-message heartbeat to your own
character every `1000` scaling API calls and waits for the server to echo it
back. If that roundtrip times out, the addon stops before it keeps recording
false skips. `/reload` is not enough for that state; log out/reconnect, then
use `/scaleresume`.

Use `/scaleping` before a long run to confirm the heartbeat works on the
current server. It should print `ScaleDump heartbeat OK.` shortly after sending.

The addon also keeps a same-API canary as a secondary check by periodically
probing known scalable item `8124` at level `30`.

Current result summary:

```text
known IDs scanned: 559994
saved scalable items: 8490
skipped items: 551504
errors: 0
levels: 1, 15, 30, 45, 60
partial item: 2075716 only has L30
```

The root-level `Scaledump.lua` file is a dense reference scan. It contains 100
reference items with all levels `1..60`. Those 100 items also exist in
`Scaledump_results.lua`, and their anchor rows match exactly at
`1, 15, 30, 45, 60`, so the dense file is compatible with the raw anchor dump.

## Result Format

The saved variable stores sparse packed rows:

```lua
ScaleDumpDB.items[itemID]["L30"] = "1=27;2=673;3=123;4=53;17=6;18=5"
```

Each `N=value` pair means:

```text
N = one-based schema column index
value = non-zero value returned by GetScalingItemStats
```

Missing columns are zero. Negative values are valid and must be kept.

## Schema

The addon schema is:

```text
1  RequiredLevel
2  SellPrice
3  ItemArmor
4  ItemArmorReborn
5  ItemBlock
6  ItemDamageMin0
7  ItemDamageMax0
8  ItemDamageMin1
9  ItemDamageMax1
10 ItemHolyRes
11 ItemFireRes
12 ItemNatureRes
13 ItemFrostRes
14 ItemShadowRes
15 ItemArcaneRes
16 RandomProperty
17 ItemStatsType0
18 ItemStatsValue0
19 ItemStatsType1
20 ItemStatsValue1
21 ItemStatsType2
22 ItemStatsValue2
23 ItemStatsType3
24 ItemStatsValue3
25 ItemStatsType4
26 ItemStatsValue4
27 ItemStatsType5
28 ItemStatsValue5
29 ItemStatsType6
30 ItemStatsValue6
31 ItemStatsType7
32 ItemStatsValue7
33 ItemStatsType8
34 ItemStatsValue8
35 ItemStatsType9
36 ItemStatsValue9
```

Stat type IDs seen in the dump use the WoW item stat IDs. Examples:

```text
3  Agility
4  Strength
5  Intellect
6  Spirit
7  Stamina
12 Defense Rating
13 Dodge Rating
14 Parry Rating
15 Block Rating
31 Hit Rating
32 Crit Rating
35 Resilience Rating
36 Haste Rating
37 Expertise Rating
38 Attack Power
39 Ranged Attack Power
43 Mana per 5 sec
44 Armor Penetration Rating
45 Spell Power
48 Block Value
```

## Current App Policy

For now, the app treats `Scaledump_results.lua` as the source of truth.

The generated file is:

```text
src/data/scaledump-results.json
```

Runtime behavior:

```text
Only item IDs present in Scaledump_results are scalable.
Dumped anchor levels use the exact packed row.
Dense reference items use their exact 1..60 rows.
Other dumped items can use interpolated levels between their anchors.
```

The generated files are:

```text
src/data/scaledump-results.json
src/data/scaledump-reference.json
```

## Interpolation Formula

For a requested level `L` between two dumped anchors `A` and `B`, each numeric
column is calculated with reference-mask weights:

```text
weight = (reference[L] - reference[A]) / (reference[B] - reference[A])
value  = round(anchorValue[A] + (anchorValue[B] - anchorValue[A]) * weight)
```

The app chooses reference rows by the item stat/type mask, not by a generic
linear fit. If no compatible reference mask exists for a column, that column
does not use linear interpolation; it falls back to the nearest captured anchor
value.

Categorical columns are not interpolated as numbers:

```text
RandomProperty
ItemStatsType0..ItemStatsType9
```

Those use the nearest anchor/category value while the paired stat value columns
are interpolated numerically.

## Future Database Shape

When the format stabilizes, store this outside the client bundle. A safe first
shape is an app-schema table, not a destructive change to the game schema:

```sql
app.item_scaling_dumps
  item_id integer not null
  level integer not null
  packed text not null
  source text not null
  captured_at timestamptz not null
  primary key (item_id, level, source)
```

Then expose it through `src/server/game-data` as derived game data. Keep the raw
AoWoW/AzerothCore item tables unchanged.
