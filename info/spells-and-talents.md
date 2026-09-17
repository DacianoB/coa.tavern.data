# Spells, classes and talent layouts

`aowow_spell` is primarily decoded from client DBCs and then enriched with names,
descriptions and runtime information captured by AscensionScraper. Preserve
locale fields, rank text, effects, attributes, school masks, power types, costs,
cast time, duration and cooldown separately. A tooltip is a presentation of some
of those fields, not a complete definition of the spell's execution.

The importer exposes the field layouts in `scripts/import-ascension-client-data.ts`
and scrape mappings in `scripts/import-ascension-scraper.ts`. Original rendering
and relationship logic is preserved in
`reference/tavern/src/server/game-data/spell-decoding.ts` and `repository.ts`.
Spell effects can point to triggered spells, created items, auras and target
selectors. The snapshot includes derived trigger, teaching, created-item and
enchantment links where the database contained them. Do not assume an empty link
table means the game has no such relationships.

## Class/spec ownership

The custom class/spec model combines multiple sources:

- `ChrClasses.dbc` gives class IDs/tokens.
- `SharedConstants.lua` gives CoA class order, localized spec names, icons and
  primary-stat metadata.
- `Constants.lua` adds tree order and saved-spec/loadout swap spells.
- `AtlasInfo.lua` supplies spec thumbnail and talent-background atlas names.
- `ChrSpecs.dbc` contributes spell links; it is not the sole authority for CoA
  specialization names.
- `SkillLineAbility.dbc` links spells to skill lines, acquire method, class/race
  masks and minimum skill rank.

This feeds `aowow_coa_specs`, `aowow_specialization_slots`, `aowow_chr_specs`,
`aowow_skill_line_abilities`, and `aowow_spell_owners` rather than replacement
application models.

## Talent layout provenance

`CharacterAdvancement.dbc` supplies node IDs, rank spells, raw row/column,
parent/group IDs and prerequisites. Its ClassTypes and TabTypes companions and
client Lua resolve ownership. The client-runtime CoaExporter overlay adds layout,
connected/required nodes, AE/TE costs and unlock conditions when DBC values are
incomplete. Nodes retain a `source` marker.

```sql
SELECT source, ownerClassId, ownerClassName, count(*) AS nodes
FROM aowow_talent_tree_nodes
GROUP BY source, ownerClassId, ownerClassName
ORDER BY ownerClassId, source;
```

Some Barbarian (ownerClassId 12) rows were recovered using a local CoA builder
JSON and marked `coa_builder_json`. The original builder payload and the one-off
recovery script are not in the inspected Tavern tree. The exported node/builder
tables preserve the available results; that historical step is not fully
reproducible from source here. The snapshot report inventories the actual source
markers instead of assuming every class used the same route.

`AscensionScraper` does not write talent tree row/column layout. Separate trainer
and spellbook collections are counted by its current importer but are not a
complete trainer-table import. See the capture guide for that distinction.
