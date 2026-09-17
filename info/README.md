# Research map

These guides describe the implementation and data inspected for this release.
[The generated snapshot report](snapshot.md) contains exact counts and findings
from the exported database. [The dictionary](schema/README.md) covers every
exported column; it records database types without pretending every field's
game meaning is known.

| Topic | Start here |
| --- | --- |
| Original collected files and downloads | [Raw collection overview](raw-files.md) |
| Get from client/capture to database | [Reproduction guide](pipeline/reproduce.md) |
| MPQ precedence and DBC decoding | [Client files](pipeline/client-files.md) |
| Original DBC record/header structure | [Binary DBC inventory](schema/dbc-files.md) |
| Crawl items and spells | [In-game scraping](pipeline/in-game-scraping.md) |
| Reconstruct an item | [Item logic](items/rebuilding-items.md) |
| Measured and inferred item scaling | [Scaling findings](items/scaling.md) |
| Spell, class and talent relationships | [Spells and talents](spells-and-talents.md) |
| Loot and missing world records | [World and loot](world-and-loot.md) |
| Understand the portable files | [SQLite format](schema/sqlite-format.md) |
| Trace source code and publication scope | [Provenance](provenance/README.md) |
| Follow up unresolved findings | [Known gaps](known-gaps.md) |
| Read older project notes | [Historical archive](archive/) |

The historical archive is context, not the current command reference. In
particular, its original 8,490-item scaling count predates the merged dataset;
some scraper path/shard descriptions and trainer-import claims are incomplete.
