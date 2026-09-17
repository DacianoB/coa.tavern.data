> Historical Tavern note; commands and paths may describe the original app. Start with [the current guides](../README.md). Local personal paths have been generalized.

# CoaExporter Pipeline Status

`CoaExporter` is no longer the recommended addon for full item/spell DB
scraping. It remains a character, wiki, mystic scroll, and CoA catalog helper.

For the builder, `CoaExporter` is the local client-runtime source for custom
CoA talent tree layout when static DBC coordinates are incomplete. In game, run
`/coae catalog talents`, reload/logout so SavedVariables are written, copy
`WTF/Account/<ACCOUNT>/SavedVariables/CoaExporter.lua` to
`output/CoaExporter.lua`, then run:

```bash
pnpm game:import-coa-talents
```

For database enrichment from in-game ID crawling, use:

```text
Inteface/Addons/AscensionScraper
docs/ascension-scraper-pipeline.md
```

Import command:

```bash
pnpm game:import-scraper
```

Drop raw `AscensionScraper.lua` SavedVariables files into `output/addon` first.
