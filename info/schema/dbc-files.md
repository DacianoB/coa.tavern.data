# Original extracted DBC inventory

These headers were read from the original binary files shared in `raw-client-dbc.zip`. A WDBC header establishes the physical record layout, not the meaning of every field. The interpreted field maps are in `scripts/import-ascension-client-data.ts`.

| File | Records | Fields per record | Record bytes | String block bytes |
| --- | ---: | ---: | ---: | ---: |
| `Achievement.dbc` | 22,331 | 62 | 248 | 1,440,259 |
| `Achievement_Category.dbc` | 237 | 20 | 80 | 2,369 |
| `AreaTable.dbc` | 2,787 | 36 | 144 | 39,990 |
| `ChallengeSpells.dbc` | 7,700 | 10 | 40 | 0 |
| `CharacterAdvancement.dbc` | 11,911 | 179 | 692 | 220,004 |
| `CharacterAdvancementCategories.dbc` | 51 | 39 | 156 | 4,814 |
| `CharacterAdvancementClassTypes.dbc` | 46 | 23 | 92 | 627 |
| `CharacterAdvancementEssence.dbc` | 5,600 | 9 | 36 | 0 |
| `CharacterAdvancementTabTypes.dbc` | 94 | 19 | 76 | 910 |
| `CharBaseInfo.dbc` | 205 | 2 | 2 | 0 |
| `CharTitles.dbc` | 190 | 37 | 148 | 3,079 |
| `ChrClasses.dbc` | 32 | 60 | 240 | 594 |
| `ChrRaces.dbc` | 41 | 69 | 276 | 668 |
| `ChrSpecs.dbc` | 101 | 65 | 260 | 12,837 |
| `CreatureFamily.dbc` | 394 | 28 | 112 | 9,256 |
| `CurrencyTypes.dbc` | 69 | 4 | 16 | 0 |
| `Emotes.dbc` | 466 | 7 | 28 | 9,535 |
| `Faction.dbc` | 412 | 57 | 228 | 17,874 |
| `Item.dbc` | 559,994 | 8 | 32 | 0 |
| `ItemDisplayInfo.dbc` | 127,254 | 25 | 100 | 3,558,218 |
| `ItemSet.dbc` | 2,346 | 53 | 212 | 41,444 |
| `MailTemplate.dbc` | 208 | 35 | 140 | 35,439 |
| `SkillLine.dbc` | 871 | 56 | 224 | 14,843 |
| `SkillLineAbility.dbc` | 38,342 | 14 | 56 | 0 |
| `SkillRaceClassInfo.dbc` | 228 | 8 | 32 | 0 |
| `SoundEntries.dbc` | 28,020 | 30 | 120 | 1,702,327 |
| `Spell.dbc` | 204,535 | 234 | 936 | 12,956,600 |
| `SpellCastTimes.dbc` | 71 | 4 | 16 | 0 |
| `SpellCategory.dbc` | 5,020 | 2 | 8 | 0 |
| `SpellDuration.dbc` | 866 | 4 | 16 | 0 |
| `SpellIcon.dbc` | 15,755 | 2 | 8 | 632,882 |
| `SpellItemEnchantment.dbc` | 18,023 | 38 | 152 | 314,912 |
| `SpellRange.dbc` | 322 | 40 | 160 | 3,690 |
| `SpellSpellSuggestions.dbc` | 353,193 | 4 | 16 | 0 |
| `SpellTags.dbc` | 471,557 | 3 | 12 | 0 |
| `SpellTagTypes.dbc` | 755 | 61 | 244 | 52,636 |
| `Talent.dbc` | 2,384 | 23 | 92 | 0 |
| `TalentTab.dbc` | 37 | 24 | 96 | 886 |

The raw archive includes discovered DBCs not yet decoded by the importer (for example spell tags and extra advancement metadata). These remain available for further research rather than being discarded.
