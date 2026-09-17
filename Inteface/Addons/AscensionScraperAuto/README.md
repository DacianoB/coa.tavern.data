# AscensionScraperAuto

Small controller addon for `AscensionScraper`.

It does not store item records itself. It reads the same generated
`KnownItems.lua` globals loaded by `AscensionScraper`, starts known-item tooltip
scans in chunks, reloads the UI after each chunk so WoW writes SavedVariables,
and resumes after reload until the known-item list is done.

## Install

Copy the scraper, automation addon, and shard addon folders into the Ascension
client:

```text
Interface/AddOns/AscensionScraper
Interface/AddOns/AscensionScraperAuto
Interface/AddOns/AscensionScraperShard001
...
Interface/AddOns/AscensionScraperShard030
```

Enable `AscensionScraper` and `AscensionScraperAuto` on the character select
addon screen. The shard addons are load-on-demand SavedVariables holders; keep
them enabled, but they will only load one at a time while a chunk is being
saved.

## Use

Generate/sync `KnownItems.lua` first:

```bash
pnpm game:addon-missing-items
```

Then in game:

```text
/scrapauto known
```

Defaults:

```text
/scrapauto known 25 missing 20000 1
```

That means: batch `25`, scan only missing tooltip records, use `20000`
KnownItems entries per chunk, start at offset `1`.

The default chunk size stays below the observed client instability point around
30k tooltip-heavy records in memory. For about 500k IDs, the default produces
roughly 25 shard files.

Useful commands:

```text
/scrapauto status
/scrapauto stop
/scrapauto resume
/scrapauto known 25 all 25000 1
```

When automation finishes, copy the shard SavedVariables files:

```text
WTF/Account/<ACCOUNT>/SavedVariables/AscensionScraperShard*.lua
```

into:

```text
output/addon/
```

Then import:

```bash
pnpm game:import-scraper
```
