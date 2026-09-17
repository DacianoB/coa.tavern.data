# Item scaling findings

Code: [ScaleDump addon](../../Inteface/Addons/Scaledump/ScaleDump.lua),
[processor](../../scripts/process-scaledump.ts),
[runtime reconstruction](../../reference/tavern/src/lib/item-scaling.ts).

The client API is `GetScalingItemStats(itemID, level)`. The addon queries known
IDs, normally at levels 1, 15, 30, 45 and 60, and also the item's default item
level when it is not already covered. Some measured rows therefore exceed level
60. The current runtime reconstruction restricts requested display levels to
1..60; the public raw data preserves those higher-level measurements.

The current merged files contain **11,829 items and 62,225 unique measured
item/level rows** from three sparse captures. There were 151,995 input rows,
89,770 identical duplicates and zero conflicting overwrites. The dense reference
has **100 items at levels 1..60**. Earlier notes describing 8,490 items cover an
older single capture, not this merged set.

## Capturing

Install `Inteface/Addons/Scaledump` as `Interface/AddOns/Scaledump` and use:

```text
/scaleping
/scaledump 1 anchors15 50 1
/scaleresume
```

The addon checkpoints after 6,000 newly saved scalable items by default. It uses
an addon-message heartbeat every 1,000 calls and item 8124 at level 30 as a
same-API canary. These detect stalled responses, not proof of database completeness.
On heartbeat failure, reconnect before resuming. Reload/logout to persist results.
See the included [original guide](../../Inteface/Addons/Scaledump/guide.md) for
all options, treating its older result counts as historical.

## Packed rows

```lua
ScaleDumpDB.items[itemID]["L30"] = "1=27;2=673;3=123;4=53;17=6;18=5"
```

Columns are **one-based**; absent columns are zero within a captured row.
An absent item/level row is unknown, not a zero row. Negative values are valid.
The exact 36-column schema is included in `scaledump-results.json`.

| Columns | Meaning |
| --- | --- |
| 1, 2 | RequiredLevel, SellPrice |
| 3, 4, 5 | ItemArmor, ItemArmorReborn, ItemBlock |
| 6..9 | Two damage min/max pairs |
| 10..15 | Holy, Fire, Nature, Frost, Shadow, Arcane resistances |
| 16 | RandomProperty |
| 17/18 through 35/36 | Ten stat type/value pairs |

The JSON dictionary has descriptive names for many stat IDs; an ID absent from
that dictionary is not invalid. Keep the numeric ID. For example, historical
captures/documentation include 43 (mana regeneration) even though the processor's
`statMask` label map does not name it.

## Exact rows before inference

`scalingRowForLevel` first tries the measured sparse row, then an exact dense
reference row for the same item, then interpolation between measured bounds.
The public data does not expand guesses into fake measured rows.

For a numeric column between anchor levels A and B:

```text
weight = (reference[L] - reference[A]) / (reference[B] - reference[A])
value  = round(anchor[A] + (anchor[B] - anchor[A]) * weight)
```

Reference matching considers stat types and structural masks. The generated
rule tuple is `[targetColumn, referenceItemId, referenceColumn, meanAbsoluteError,
maxAbsoluteError, validationSamples]`. There are 25,069 rules for 5,652 items;
25,011 rules have leave-one-anchor-out validation samples. Those errors measure
fit to available anchors, not accuracy at every unobserved level.

If no compatible reference column can supply a weight, reconstruction falls
back to a captured anchor rather than a generic linear curve. RandomProperty
and stat-type columns are categorical; they are not interpolated numerically.
Stat-type handling also checks whether a paired stat value exists at each bound.

The runtime marks rows with `scaledump-results`, `scaledump-reference` or
`scaledump-interpolated`. An interpolated row may still contain some per-column
nearest-anchor fallbacks; the row label does not imply every column was fitted.

## Armor and metadata

For display, nonzero ItemArmorReborn takes precedence over ItemArmor. Both raw
values are retained. For item 5016 at level 60 the current regression fixture
expects displayed/Reborn armor 54 and raw ItemArmor 226. Reconstruction clears
old scaling-related metadata before applying a new row so stale stats do not
survive when a measured field becomes zero.

## Rebuilding the JSON

```bash
npm run game:scaledump -- --out output/scaling-rebuilt
```

The included sparse files are the processor's default input; root `Scaledump.lua`
is the dense reference. Files are sorted by mtime and then path. Git does not
preserve mtimes, so for new conflicting captures record explicit capture order
and restore that order before merging. Included captures have no conflicts;
generated progress metadata still describes the last processed file, not totals
for all captures. Compare `items`, counts and rules rather than interpreting a
single capture's progress counters as merged statistics.
