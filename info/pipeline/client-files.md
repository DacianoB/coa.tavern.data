# MPQ and DBC findings

Implementation: [extract-ascension-mpq.py](../../scripts/extract-ascension-mpq.py)
and [import-ascension-client-data.ts](../../scripts/import-ascension-client-data.ts).

The extractor scans the configured Data directory and locale subdirectory. Its
`archive_priority` orders base root archives, base locale archives, standard root
patches (`patch`, `patch-2`, `patch-3`), locale patches, then custom root patches.
Names use natural numeric ordering. The last successfully read matching file wins.
Record the client version and archive hashes when making a new capture: filenames
alone do not establish that two clients had the same data.

DBC extraction accepts the `WDBC` header. The importer contains per-file field
definitions rather than assuming all client builds share a universal layout.
Field codes distinguish signed/unsigned integers, floats, string offsets, bytes,
and skipped fields. Localized string blocks expand into legacy `*_locN` columns.
Custom CharacterAdvancement layouts are defined by numbered columns. A client
patch can change these layouts; a readable binary header is not enough to prove
every decoded field is correct.

Important mappings:

| Source | Output / contribution |
| --- | --- |
| `Item.dbc` + `ItemDisplayInfo.dbc` | Item IDs, class/subclass, slot, display/model and icon; base names are `Item #<id>` placeholders |
| `Spell.dbc`, cast-time/duration/range tables | Spell descriptions, effects, attributes, costs and timing |
| `SpellIcon.dbc` + item display icons | Normalized `aowow_icons` names and local icon assets |
| `ItemSet.dbc`, `SpellItemEnchantment.dbc` | Sets, thresholds, enchantment data |
| `ChrClasses`, `ChrRaces`, `SkillLine`, `SkillLineAbility` | Class/race/skill labels and ownership links |
| `CharacterAdvancement*` + client Lua constants | Talent nodes, ranks, class/spec ownership and layout baseline |
| `AreaTable`, `Faction`, achievements, currencies, titles, mail, sound DBCs | Supporting game catalogs, not a server world database |

Icons are normalized to lower-case basenames, stripped of directory/extension,
and joined through `iconId`. BLP images are converted to JPEG ahead of runtime.
Extracted DBC, client Lua and image assets are provided as separate raw release
archives. Full installed MPQ files are not included; run the extractor against
your own client if you need to repeat extraction from the archive source.

There are important incomplete mappings in the current importer. For example,
it assigns effect radius IDs into fields named `effectNRadiusMin`; these must
not automatically be interpreted as measured yards. Some item-set item slots
are initialized to zero, then reconstructed by helper links/tooltips. See
[known gaps](../known-gaps.md) before building server mechanics from these rows.
