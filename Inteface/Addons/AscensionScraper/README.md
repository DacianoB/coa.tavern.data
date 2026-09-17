# AscensionScraper

Project Ascension / WoW addon that scans item and spell IDs into a SavedVariables database.

For CoA Tavern, this is the canonical in-game DB scraper. Use it for full
item/spell crawling and import its SavedVariables with:

```bash
pnpm game:import-scraper
```

The full CoA Tavern pipeline is documented at:

```text
docs/ascension-scraper-pipeline.md
```

## Install

Copy this folder:

```text
addons/AscensionScraper
```

into your game addon directory:

```text
Interface/AddOns/AscensionScraper
```

Then enable `AscensionScraper` on the character select addon screen.

## Emergency Import

If WoW refuses to load your normal SavedVariables file even though it is full of
data, use the optional import file:

```text
Interface/AddOns/AscensionScraper/Import.lua
```

Paste your copied database into that file as:

```lua
AscensionScraperImportDB = {
  spells = {
    -- pasted spell records
  },
  items = {
    -- pasted item records
  },
  spellbook = {
  },
  trainerServices = {
  },
}
```

Then in game:

```text
/reload
/scrap status
/scrap save
```

On reload, the addon merges `AscensionScraperImportDB` into the live
`AscensionScraperDB` and prints how many records were imported. `/scrap save`
then forces WoW to write the merged database to the real SavedVariables file.

If `/scrap status` still shows zero after reload, run:

```text
/scrap debug
/scrap import
/scrap status
```

`/scrap debug` tells you whether WoW actually loaded
`AscensionScraperImportDB` from `Import.lua`. If it says the import variable is
missing, the game is not reading that `Import.lua`, the file has a Lua syntax
error, or the pasted variable name is not exactly `AscensionScraperImportDB`.

After the import is safely saved, clear `Import.lua` again or leave only its
comments. Otherwise the same import will be loaded again on future reloads.

## Commands

```text
/scrap
/scrap ui
/scrap items
/scrap spells
/scrap items 1 999999 10
/scrap spells 1 999999 100
/scrap spellbook
/scrap trainer
/scrap export
/scrap import
/scrap debug
/scrap item 19019
/scrap spell 133
/scrap status
/scrap stop
/scrap progress on
/scrap throttle 4
/scrap interval 0.05
/scrap reset items
/scrap reset spells
/scrap reset all
/scrap tooltips
/scrap save
```

`/scrap items` and `/scrap spells` resume from the last saved progress unless you pass a start ID.

`/scrap` opens the full in-game interface with start/stop/save/reset buttons, range fields, and settings toggles.

Use the known-ID tooltip pass after you have staged one or more SavedVariables
files in `output/addon`:

```bash
pnpm game:addon-known-items
```

To generate only IDs that are not already present in the staged tooltip scrape
folders (`output/addon/tooltip` and `output/addon/tooltip-split`), use:

```bash
pnpm game:addon-missing-items
```

That writes `KnownItems.lua` for the addon. Copy/sync the addon into WoW, reload
the UI, then run:

```text
/scrap known 25 all 1 25000
```

This scans only the generated known item IDs, forces item tooltip capture, and
updates `AscensionScraperDB.items` with richer tooltip text/lines. Use
`/scrap known 25 missing` to only recapture IDs that are missing tooltip text in
the current SavedVariables file.

For large known-ID sets, keep the last two arguments and run in chunks:

```text
/scrap known 25 all 1 25000
/scrap save
/scrap known 25 all 25001 25000
/scrap save
```

Or enable the companion `AscensionScraperAuto` addon and let it do the chunking
and save/reload cycle:

```text
/scrapauto known
```

By default it runs missing-tooltip KnownItems chunks of `20000` IDs with batch
`25`, moves each completed chunk into a load-on-demand
`AscensionScraperShard###DB`, clears the main item table, reloads so WoW writes
that shard file, and then continues at the next offset after reload. Use
`/scrapauto status`, `/scrapauto stop`, and `/scrapauto resume` to control it.

`/scrap spellbook` stores every visible spellbook ability for the current character. This is the best scrape for known spells because it can also save spellbook tab, spellbook slot, passive state, player class context, and tooltip text from the spellbook entry.

`/scrap trainer` reads the currently open trainer window and enriches matching spell records with trainer-only metadata. Use it after opening a class trainer on each class you want to collect. It parses the trainer tooltip `ID ...` line when available, saves normalized trainer services as `trainerServices["Spell Name"].ranks[1]`, and updates matching `spells[id]` records with fields such as `trainer_learned`, `trainerLevelReq`, `trainerCost`, `trainerAbilityReqs`, `trainerSkillReq`, `trainerStepReq`, `spell_required`, and `spell_required_names`.

`/scrap export` prints the CoA Tavern handoff: run `/scrap save`, copy the
SavedVariables file into `output/addon` with any unique `.lua` name, then run
`pnpm game:import-scraper`.

The default ranges are `1 -> 999999` because Ascension uses high custom IDs.

## Where The Data Saves

WoW addons cannot write arbitrary JSON files or folders. The data is saved by WoW as a SavedVariables Lua file when you logout, exit the game, or run `/reload`.

Typical path:

```text
WTF/Account/<ACCOUNT>/SavedVariables/AscensionScraper.lua
```

For this project, copy SavedVariables files into:

```text
output/addon/
```

You can place multiple separated scrapes there, for example:

```text
output/addon/items-part-1.lua
output/addon/spells-part-1.lua
output/addon/trainer-warrior.lua
```

Use that folder as the source for DB import. This is the default, so no path is
needed:

```bash
pnpm game:import-scraper
```

Important: the addon saves a Lua SavedVariables table, not strict JSON. The
CoA Tavern importer accepts the raw Lua file directly. It may look like:

```lua
AscensionScraperDB = {
  items = {},
  spells = {},
  spellbook = {},
}
```

That is fine as a manual staging convention, but importer code must parse/convert the Lua-shaped table before treating it as JSON. After normalization, the same data should become a real JSON object with `items`, `spells`, and `spellbook` at the top level.

Data shape:

```lua
AscensionScraperDB = {
  items = {
    [123] = {
      id = 123,
      name = "...",
      link = "...",
      tooltip = "...",
    },
  },
  spells = {
    [133] = {
      id = 133,
      name = "Fireball",
      tooltip = "...",
      tooltipLines = {
        {
          left = "...",
          right = "...",
          text = "...",
          leftColor = { 1, 1, 1, 1 },
          leftColorHex = "ffffffff",
          leftStyle = {
            color = { 1, 1, 1, 1 },
            colorHex = "ffffffff",
            font = "...",
            fontSize = 12,
            fontFlags = "OUTLINE",
            justifyH = "LEFT",
            justifyV = "MIDDLE",
            shadowOffset = { 1, -1 },
            shadowColor = { 0, 0, 0, 1 },
            shadowColorHex = "ff000000",
          },
        },
      },
      tooltipForceShift = true,
      description = "...",
      level_required = 1,
      requiredLevel = 1,
      spell_required = nil,
      requiredClassText = "Mage",
      requirements = { "Requires Mage" },
      resource = "mana",
      resource_cost = 30,
      resource_type = 0,
      school = "Fire",
      school_mask = 4,
      schoolSource = "tooltip",
      powerText = "30 Mana",
      rangeText = "30 yd range",
      castTime = 2000,
      minRange = 0,
      maxRange = 30,
      castText = "2 sec cast",
      cooldown = 0,
      baseCooldown = 0,
      gcdCooldown = 1500,
      duration = 0,
      baseDuration = 0,
      charges = 0,
      maxCharges = nil,
      maxStack = 0,
      cooldownText = "8 sec cooldown",
      knownById = true,
      caKnown = true,
      passive = false,
      levelLearned = 1,
      source = "spellbook",
      spellBookTabName = "Mage",
      spellBookIndex = 12,
    },
  },
  spellbook = {
    [133] = {
      id = 133,
      name = "Fireball",
      tabName = "Mage",
      spellBookIndex = 12,
    },
  },
  trainerServices = {
    ["Spirit Glaive"] = {
      name = "Spirit Glaive",
      skillLine = "Shadowhunting",
      icon = "Interface\\Icons\\nhi_shadowglaive_Border",
      ranks = {
        [1] = {
          id = 680905,
          learnedSpellId = 680905,
          learned_spell_id = 680905,
          spellId = 680905,
          name = "Spirit Glaive",
          rank = "Rank 1",
          rankIndex = 1,
          serviceType = "available",
          level_required = 10,
          cost = 12345,
          skillLine = "Shadowhunting",
          icon = "Interface\\Icons\\nhi_shadowglaive_Border",
          description = "...",
          spell_required = {
            [1] = "Shadowhunting 1",
          },
          skillReq = {
            name = "Shadowhunting",
            current = 1,
            required = 1,
          },
          abilityReqs = {
            [1] = {
              name = "Spirit Glaive",
              rank = "Rank 0",
              text = "Spirit Glaive (Rank 0)",
              resolvedSpellIds = {
                [1] = 680904,
              },
            },
          },
          spellRequiredIds = {
            [1] = 680904,
          },
          spellRequiredNames = {
            [1] = "Spirit Glaive (Rank 0)",
          },
        },
      },
    },
  },
}
```

## Notes

Items depend on the client/server item cache. The addon queues uncached item IDs and retries them shortly after the server responds. For exhaustive crawls, keep `/scrap itemprobe off` so IDs missing from `GetItemInfoInstant` still get tooltip-probed.

If the scan causes stutter, lower the batch size:

```text
/scrap items 1 999999 5
```

You can also lower the per-frame work budget:

```text
/scrap throttle 2
```

For faster spell sweeps, reduce the delay between batches:

```text
/scrap interval 0
/scrap throttle 8
/scrap spells 1 9999999 1000
```

If the client stutters, lower `throttle` first.

The progress window is enabled by default. It can be dragged with left click.

```text
/scrap progress on
/scrap progress off
```

Tooltip capture is always on. Completeness matters more than speed for this addon, so every stored item/spell tries to save the raw tooltip string plus structured tooltip lines.

Tooltip reads temporarily force `IsShiftKeyDown()` and `IsModifierKeyDown()` to true so Ascension tooltips that normally say `Hold SHIFT for More Information` are captured in their expanded form. Stored records include `tooltipForceShift = true` to make that behavior explicit.

Structured tooltip line entries preserve text styling for later UI replication:

- `leftColor` / `rightColor`, RGBA floats from the left and right tooltip font strings
- `leftColorHex` / `rightColorHex`, WoW-style ARGB hex strings such as `ffffd100`
- `leftStyle` / `rightStyle`, including color, font path, font size, font flags, justification, and shadow color/offset when the client exposes them

```text
/scrap tooltips
```

Old bare entries will stay bare until you rescrape them. Use `/scrap reset spells` before a fresh spell sweep, or use `/scrap spell <id>` for one spell.

For class/level requirements, the addon saves every field the client exposes. Arbitrary spell IDs often only expose `GetSpellInfo` plus the hyperlink tooltip. `/scrap spellbook` usually gives richer context for spells your character can see.

Ascension's `GetSpellInfo(spellID)` currently exposes spell mechanics in this order:

```lua
name, rank, icon, resourceCost, isFunnel, resourceType, castTime, minRange, maxRange = GetSpellInfo(spellID)
```

The addon stores normalized database-friendly fields from that:

- `resource`, for example `"mana"`, `"rage"`, `"energy"`, or `"power_<id>"` for unknown custom power types
- `resource_cost`, for example `27`
- `tooltip`, `tooltipLines`, `tooltipCaptured`, `tooltipForceShift`; the line data includes text colors and font-string styling metadata
- `school`; read from `GetSpellSchool` if available, otherwise inferred from tooltip text like `Fire Damage` or `Shadow Resistance`
- `school_mask` / `schoolMask`; numeric school mask when known, for example `4` for Fire or `32` for Shadow
- `schoolSource`; `"api"` when captured from the client API, `"tooltip"` when inferred from tooltip text
- `schoolCandidates`; ordered schools found in the tooltip when inference was needed
- `castTime`, in milliseconds; instant casts should be `0`
- `minRange`; melee/false becomes `0`
- `maxRange`
- `cooldown`; real base cooldown in milliseconds, `0` for GCD-only, `false` when `GetSpellBaseCooldown` reports no base cooldown and no GCD
- `duration` / `baseDuration`; value from `GetSpellBaseDuration`, in milliseconds when the client exposes it
- `charges` / `maxCharges`; values from `GetSpellCharges`
- `maxStack`; value from `GetSpellMaxStack`
- `known`, `knownById`, and `caKnown`; values from `IsSpellKnown`, `IsSpellIDKnown`, and Ascension's `CA_IsSpellKnown`
- `passive`; uses spellbook passive state when scanning the spellbook, otherwise falls back to `IsPassiveSpellID`

`playerClassName` and `playerClassFile` are intentionally not stored because they describe the character doing the scrape, not the spell itself.

`level_required` is taken from tooltip text like `Requires Level 10` when available, falling back to `GetSpellLevelLearned` if the client exposes it. `spell_required` is currently `nil` unless a future importer can resolve requirement names to spell IDs. The only direct requirement-ID API found so far is trainer-scoped, so it is not reliable for scanning every spell in the game.

`GameTooltip_GetSpellCastReqText(spellID)` is intentionally not used. On this client it expects an internal tooltip entry table and errors when called with a numeric spell ID.

Trainer requirements are collected separately with `/scrap trainer`. Because WoW exposes trainer requirement APIs by trainer service index instead of global spell ID, you must open the trainer first. The addon groups trainer data by ability name and numeric rank: `trainerServices["Reclamation"].ranks[7]`. Numeric rank keys and numeric requirement-list keys are intentional so WoW writes ranks in order. It tries to match trainer rows to spell IDs by trainer tooltip `ID ...`, trainer spell link, and finally existing scraped spell name/rank. If a prerequisite ability only returns text like `Reclamation (Rank 6)`, the addon splits that into `name = "Reclamation"` and `rank = "Rank 6"`, stores `spellRequiredNames`, and stores IDs in `spellRequiredIds` when the prerequisite can be matched to an already scraped spell. Each rank also gets a flattened ordered `spell_required` list combining ability prerequisites plus skill/step requirements like `Voodoo 1`.
