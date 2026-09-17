> Historical Tavern note; commands and paths may describe the original app. Start with [the current guides](../README.md). Local personal paths have been generalized.

# AoWoW Reference For CoA Tavern

Research date: 2026-05-16

## Sources

- AzerothCore AoWoW source: <https://github.com/azerothcore/aowow>
- Live AoWoW-style WotLK database: <https://wowgaming.altervista.org/aowow/>
- Live landing page that links to the database: <https://wowgaming.altervista.org/> redirects to <https://wowgaming.github.io/>

Useful live examples:

- Spell detail: <https://wowgaming.altervista.org/aowow/?spell=17>
- Zone detail: <https://wowgaming.altervista.org/aowow/?zone=12>
- Spell list: <https://wowgaming.altervista.org/aowow/?spells>
- Zone list: <https://wowgaming.altervista.org/aowow/?zones>

## AoWoW Page Shape

AoWoW keeps one canonical route per game type and builds detail pages from type-specific PHP page classes plus templates:

- `pages/spell.php` and `template/pages/spell.tpl.php`
- `pages/zone.php` and `template/pages/zone.tpl.php`
- `includes/types/spell.class.php` and `includes/types/zone.class.php`

The important implementation detail is not the old visual skin. It is the data contract: each page resolves a base row, joins helper tables such as `aowow_icons`, builds an infobox, renders a dense record body, then adds related Listview tabs.

## Spell Page Contract

AoWoW spell pages show:

- Icon, name, rank, external links, and a tooltip-like spell summary.
- Infobox values such as level, class/race masks, source/training data, focus object, skill requirements, and staff/debug script fields when present.
- Cost and mechanics: power cost, range, cast time, cooldown, global cooldown, duration, school, dispel type, mechanic, stacks, required items/tools, and reagents.
- The localized description and buff text.
- Up to three effect blocks from Spell.dbc, including effect id, aura id, base points, die sides, scaling values, targets, radius, period, chain targets, created item, triggered spell, misc values, and multipliers.
- Attribute/flag links. AoWoW exposes these as searchable spell filters.
- Related tabs such as modified by, see also/ranks, shared cooldown, triggered spells, created items, and other entity relationships.

For CoA Tavern, spell detail pages should keep top-level routes like `/spell/17`, but the data should follow this contract. The current implementation reads the imported `game.aowow_spell` row, joins `game.aowow_icons` through `iconId`, shows all core/effect/flag fields, and groups related ranks, triggers, created items, and talent links when those rows exist.

## Zone Page Contract

AoWoW zone pages show:

- Zone name and infobox values: city/territory flags, level range, required/LFG/heroic levels, instance type, player cap, attunement/key data, expansion, parent map, and coordinates.
- A map pane when map assets and spawn data exist.
- Show-on-map data for creature spawns, object spawns, area triggers, quest starts/ends, and similar world relationships.
- Related tabs for NPCs, objects, quests, quest starter items, quest rewards, fishing loot, spells from `spell_area`, subzones, sounds/music, screenshots, videos, and comments.

For CoA Tavern, zone detail pages should keep routes like `/zone/12`, show the imported `game.aowow_zones` fields, list child zones from `parentArea`, show the parent zone when available, and surface spawn/map readiness. With only client DBC import loaded, world tables such as creatures, quests, objects, loot, and sounds may be empty; the page must make that visible instead of pretending the relationships exist.

## Icons

AoWoW resolves icons by name. Spell rows join `aowow_icons` on `iconId`; list data then emits icon names such as `spell_holy_powerwordshield`. The live site serves icon images at:

`https://wowgaming.altervista.org/aowow/static/images/wow/icons/medium/<icon-name>.jpg`

CoA Tavern stores/uses icon names and turns them into static local image URLs at render time. The Ascension client importer and `pnpm game:icons` extract referenced `Interface/Icons/*.blp` assets from MPQs into `public/game-icons/medium` as JPG files. Runtime pages should not scan MPQs or convert icons during requests. `NEXT_PUBLIC_AOWOW_ICON_BASE_URL`, `NEXT_PUBLIC_AOWOW_ICON_LOCAL_BASE_URL`, `AOWOW_ICON_LOCAL_DIR`, and `ASCENSION_ICON_OUT_DIR` can override those defaults.

## Menu Model

AoWoW database navigation is type-first. The practical group order to mirror is:

- Items: items, item sets, enchantments.
- Spells: spells, talents.
- Quests.
- NPCs: NPCs, pets.
- Objects.
- Zones: zones, factions, events.
- Character: classes, races, skills, professions, achievements, titles.
- More: currencies, icons, mails, sounds, emotes.

CoA Tavern should keep the top-level Next.js routes (`/items`, `/spells`, `/zones`, etc.) and use this grouping only for menu logic and database discovery.

## Current Data Gap

The Ascension client DBC import populates core helper tables such as `aowow_spell`, `aowow_zones`, `aowow_icons`, classes, races, skills, achievements, item sets, currencies, titles, mails, and sounds. It does not by itself populate world database tables such as creature templates, quest templates, gameobject templates, loot, or spawn rows. AoWoW's full relationship graph needs those world imports too.
