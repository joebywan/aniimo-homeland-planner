# Aniimo Homeland Planner

A static workforce planner for Aniimo Homeland. It recommends which Aniimo bodies to assign based on:

- Estimated Require capability targets
- Your RV level (Aniimo spaces and how many of each building you can place)
- Built Homeland facilities
- The Available Aniimo pool: every commonly catchable Aniimo (base and regional forms), with Prismana forms and legendary Aniimo only when ticked
- Homeland skill levels
- Full-time buildings versus part-time processors and farm steps, compared at several processor busy levels
- The personality that works fastest at each building

The app has no backend. Browser state is stored in `localStorage`, and configuration can be exported/imported as JSON.

## Run Locally

Open `index.html` directly, or serve the folder:

```bash
npm run serve
```

Then open <http://127.0.0.1:4173/>.

## GitHub Pages

Use a normal static Pages deployment:

1. Push this folder to a repository.
2. In GitHub, open `Settings -> Pages`.
3. Set source to `Deploy from a branch`.
4. Select `main` and `/root`.
5. Save.

The `.nojekyll` file keeps Pages from applying Jekyll processing.

## Data

### Aniimo work abilities (generated)

`npm run refresh:data` runs `scripts/scrape-aniimo.js`, which builds `data/aniimo.json` and `data/aniimo-data.js` from:

1. <https://aniimo.gg/homeland/work/>: every Aniimo and its Homeland work ability levels.
2. Each species page on aniimo.gg (for example <https://aniimo.gg/aniimo/glacy/>): the Forms strip gives the real form names (regional forms such as "Snowfield Form" and "Nighttime Form", and Prismana). Each form page adds its own ability levels. Prismana forms are stored as `name: "Prismana <Species>"`, `form: "Prismana"`.
3. <https://backup.hideoutgacha.com/games/aniimo/homeland-abilities>: a cross-check for Prismana ability levels. Mismatches are recorded under `scrape.hideoutPrismana`. A Prismana form only Hideout lists is not kept (aniimo.gg's Prismana forms match the game's own count of 25).
4. `data/aniimo-overrides.json`: manual, user-confirmed values, merged last so they always win. Records are matched by `species` + `form`. It also holds `dexNumbers`, `exclusions` and `renames` (below).
5. <https://aniimo.gg/aniilog/>: the in-game Aniilog. It decides which Aniimo are in the released game, gives each one its number, and marks the Legendary Aniimo (Somniwing and Irisalis are the only Stage 4 species). If the Aniilog can't be read, the refresh stops without writing anything. Released species the work page leaves out (Somniwing) are read from their own page.

#### Aniilog numbers and sort order

Every record has `dexNumber` (the Aniilog number) and `dexLabel` (how it is shown). The number comes from each Aniilog entry's badge on aniimo.gg: `#001` to `#082`, plus special numbers `#10001` Irisalis, `#10002` Dazmand, `#10003` Fulmintis and `#11001` Sparkelf. The starters Lunara and Helion show "Starter" in the Aniilog; their hidden numbers (99996 and 99998, from <https://aniimotools.dev/guides/starters/>) are in `dexNumbers` in the overrides, so they sort last. Records are sorted by number, with each species' forms together: base, regional forms (A to Z), then Prismana. The Available Aniimo tab shows the label before the name ("#015 Glacy"), and typing `15` or `#015` in its search box finds that Aniimo.

#### What is left out, and why

Only Aniimo a player can own are kept. Everything removed is listed with its reason in `scrape.excluded` (9-digit internal copies are in `scrape.internalVariantsExcluded`, and every unnumbered Aniilog entry in `scrape.aniilogUnnumbered`):

- **Aniilog "Secret" entries with no number.** They are in the game files but not in the released game: Little Lightning Chirp, Thunderfeather Sparrow, Leaf Hat Firefly, Forest Cloak Butterfly and Butterfly Wing Sprite (English machine names for datamined species), Jabster, Malangel, Malevsera, Coraliz, Popapus and Gachapus (Popapus and Gachapus lived in the closed beta's Whisperwake Isles, a region not in the game yet). Forest Cloak Butterfly is its own species (game ID 1008200), not Flutternym (#028, 1023100). When one of these gets an Aniilog number, the next refresh adds it automatically.
- **Boss and NPC entities.** "Infergon BOSS" and "Tuckin BOSS" are the Omega Infergon and Omega Tuckin bosses: Omega bosses can't be caught. (An Alpha you catch is an ordinary member of its species, so there are no separate Alpha records.) Irelia is a story character; the Aniimo you get after her quest is Prismana Iris, which is kept. Floret is a Budclaw quest NPC.
- **Starter transformations.** Fennelun and Soleon are Lunara's and Helion's temporary battle forms, not separate Aniimo.
- **Hideout-only Prismana forms.** Prismana Glameep, Prismana Minespine and Prismana Tuckin appear only on Hideout Guides, not in the game data.

Tuckin stays: you get it (and its Mountain Form) by evolving Hummin after beating Omega Tuckin (aniimo.gg's evolution data; Game8 says it can't be caught in the wild).

To leave out another record, add `{ "species": "...", "form": "...", "reason": "..." }` (or `{ "id": "...", "reason": "..." }`) to `exclusions`. To fix a placeholder name, add `{ "from": "...", "to": "...", "reason": "..." }` to `renames` (none are needed at the moment). Renames are listed in `scrape.renamed`.

#### Evolution stages, lower stages and starters

- The Evolution section of each species page on aniimo.gg gives the evolution tree (who evolves into whom, with branches such as Pebbling → Lavazar → Magmarex and Pebbling → Geodeback → Minespine) and each stage number. Every record gets `stage`, `finalStage` (the highest stage it can reach) and, in a line, `evolutionLine` and `evolvesFrom`.
- `tierName` is the game's stage name from the stage number: 1 Lumin, 2 Gamma, 3 Nova, 4 Legendary (official wiki, <https://wiki.aniimo.com/>). Some lines skip Gamma (Cozite, stage 1 → Bailite, stage 3). The Available Aniimo tab shows it as a badge.
- `dominatedBy` lists the Aniimo a record can evolve into (its own descendants only, in the same form: base with base, a regional form with the same regional form, Prismana with Prismana) that have every Homeland ability at least as high. These lower stages are left out of the planner's pool unless ticked, or unless every Aniimo that covers them is left out. The optimiser also ranks lower stages slightly below the last stage of their line.
- `starter: true` marks Lunara and Helion (from `starters` in `data/aniimo-overrides.json`). A player only has one (confirmed by a player): the Available Aniimo tab asks which, and only that one can be suggested. Until one is chosen neither is. They are the only common Aniimo with Light, which the Sunlamp needs.



| category | what | used by default |
| --- | --- | --- |
| `common` | Base and regional forms you can normally catch, and the starters | yes |
| `prismana` | Prismana forms | only when "Include Prismana forms" (or the row) is ticked |
| `legendary` | Legendary species (Aniilog Stage 4: Somniwing and Irisalis) | only when "Include legendary Aniimo" (or the row) is ticked |

Older saves may have ticks for removed records (for example the old "boss" rows); they are dropped when the save loads.

To correct a category by hand, add `{ "species": "...", "form": "...", "category": "..." }` to `categories` in `data/aniimo-overrides.json` (`form` is optional) and run `npm run refresh:data`.

The scraper also stores `abilityIcons`: for each of the 13 abilities, the in-game icon URL and circle colour from the ability section headers on <https://aniimo.gg/homeland/work/>. The app hotlinks these from `cdn.beskor.net`, like the Aniimo portraits, and falls back to a coloured two-letter dot if an icon can't load.

aniimo.gg also lists copies of some Aniimo under 9-digit IDs (for example `glynsera-101330001`). Their internal editor names show they are tower climb, shrine puzzle, tutorial, NPC and test entities, not collectible forms. The scraper leaves them out and lists their IDs in `scrape.internalVariantsExcluded`. To keep them, set `INCLUDE_INTERNAL_VARIANTS=1`.

### Buildings, crops and Homeland capacity (hand-curated)

- `data/buildings.json`: real facility names, each one's `role` (primary, processor, climate or power, with `roleSource`) and `personalityBonus`, the work ability each one needs, slots, unlock RV level and placement limits. Each entry has `source` and `verified` fields. `placementLimit` is the readable text ("1 from RV 4, 2 from RV 8, …"); `maxByRv` is the same limit as data (`[{ "rv": 4, "max": 1 }, …]`) and drives the building counts. Published sources only give the end points for Farmland, Woodland and Mine, so their in-between steps come from the RV upgrade requirements (to build RV N+1 the game asks you to place that many at RV N) and are marked `maxByRvVerified: false`. Storage Units are not listed as buildings: they are only drop-off points for hauling Aniimo and have no worker of their own (confirmed in-game by a player). Hauling is covered by the Hauling figure in Estimated Require, and spare spaces can go to extra haulers.
- `data/crops.json`: Farmland and Woodland crops with grow times (`cycleMinutes`) and yields. The top-level `actionDurationSeconds` (5 s per loosen, plant, water or harvest action) was confirmed in-game by a player and is flagged `actionDurationVerified: true`.
- `data/homeland.json`: Aniimo capacity for each RV level and details of the Homebuilding Zone.

Sources: <https://aniimo.gg/homeland/rv/>, <https://aniimo.gg/homeland/furniture/functional-facilities/>, <https://aniimo.gg/homeland/plots/>, <https://aniimotools.dev/systems/homeland/stations/> and <https://aniimotools.dev/systems/homeland/rv-levels/>.

After editing any of these JSON files, regenerate the JS wrappers:

```bash
node scripts/wrap-data.js
```

The JS wrappers let the app work when opened from `file://`, since some browsers block local JSON `fetch`.

## Weekly Refresh

`.github/workflows/refresh-aniimo-data.yml` runs every Monday and can also be triggered manually. It:

1. Runs `node scripts/scrape-aniimo.js`.
2. Checks whether `data/aniimo.json` or `data/aniimo-data.js` changed.
3. Commits and pushes refreshed data only when there is a real diff.

If GitHub Pages is configured from `main` and `/root`, those commits will refresh the deployed app.

## Optimiser Model

Candidates:

- The optimiser picks from the Available Aniimo pool, with as many copies of each Aniimo as it needs.
- By default the pool is every `common` Aniimo. Prismana forms and legendary Aniimo join when their toggle is ticked; a per-row tick always wins, so you can add one Prismana form or leave out one common Aniimo.
- Spare-space suggestions (backups, extra haulers, Homebuilding Zone) also come from the pool.

Buildings:

- Choosing an RV level fills every building count with the most you can place at that level (`maxByRv`). Buildings not unlocked yet show "Unlocks at RV X" with a count of 0.
- Counts can be lowered, never raised above the max. When the RV level changes, counts that were at the old max follow the new max; counts you lowered yourself are kept (and only lowered if the new max is smaller). "Set all to max" resets every count to the max.
- Aniimo spaces come from the RV level only (`data/homeland.json`).

Building roles (`role` in `data/buildings.json`, each with a `roleSource`):

- Your Aniimo are a pool that moves between buildings; a building only stops while no Aniimo is free to work it (Hideout's Homeland Optimizer models it the same way).
- `primary` – makes goods from nothing (aniimo.gg "Materials Production", every recipe says "No inputs"): Mine, Well, and the Leisure buildings Dewy House, Tidewhisper Sandcastle, Nimbus Bed, Starfall Hammock and Floral Windmill. Each holds one Aniimo full time ("Full-time producer"). Farmland and Woodland are also primary but keep the shared plot model below.
- `processor` – turns other goods into products (aniimo.gg "Materials Processing" and "Item Production"): Carousel Mill, Crafting Table, Blazing Stove, Bouncy Brew Keg, Chimney Kiln, Claw Game Cooker, Joy Wheel Loom, Jukebox Dryer, Phonolfactory Table, Pickling Jar, Simmering Pot, Woodworking Bench, Aniipod Maker and Dance Pad Polisher. They only work while inputs last, so each needs a share of one Aniimo ("Part-time processor").
- `climate` – Cooling Unit, Heat Furnace, Sunlamp: each holds an Aniimo that does no other work.
- `power` – Crackle Generator: it has one Aniimo slot (aniimo.gg) and only makes power "once an Aniimo with Lightning works it" (AniimoTools), so it also holds a full-time Aniimo. Running other facilities on power in E-mode (RV 12+) is not modelled.

Full-time work:

- Each full-time job (primary, climate, power) takes one Aniimo that does nothing else.
- Jobs are matched by ability and minimum level from `data/buildings.json`.

Part-time work (processors and farm steps):

- Farmland and Woodland: load = `plots * action_seconds / cycle_seconds * overhead_multiplier` per step.
- Processors: load = `count * busy %`. The busy % is the option level (below) unless the building has its own busy % on the Homeland tab.
- Part-time work is shared by every Aniimo with the ability and can be split between Aniimo, so it is assigned as a max flow: each Aniimo can take up to a full day of part-time work, of which farm steps may fill at most the "keep farm helpers at most this busy" cap (default 50%). The cap protects farm timing; processor work can fill the rest of a helper's day. With "one farm ability per helper" turned off in Settings, a step-by-step search is used instead.
- Aniimo in full-time jobs are never given part-time work.

Busy-level options:

- `planProcessorOptions` works the plan out with processors 25%, 50%, 75% and 100% busy, and the Optimise tab shows them as a table (busy level, Aniimo needed, fits in your spaces, spare spaces). The highest level that fits is selected; click another to see its plan.
- It also finds the most that fits, to about 5% ("Your spaces allow processors to run up to about 90% of the time").
- Only the lowest level runs the full search. Each higher level starts from the plan one level down (full-time jobs and Estimated Require targets don't change) and adds part-time Aniimo one at a time, each time the one that takes on the most extra work, then drops any that are no longer needed. The whole table takes about 1 s for a 57-building RV 9 Homeland.
- If every processor has its own busy %, there is only one plan.

Families:

- Some buildings can only be worked by certain species, whatever their level (`allowedSpecies` in `data/buildings.json`, from the "Family only" recipes on the AniimoTools station pages). Dewy House: Fragrancier or Dewy; Tidewhisper Sandcastle: Panpanta, Piopiota, Popota or Susuta (Sea Salt), and Sherro, Sheldon or Shelly (the Level 3 Pearl recipe) – both confirmed in-game by a player. Nimbus Bed: Turbo, Dreaple, Nimbi (Wool) and Irisal, Irisalis, Iris (Level 3 Petals); Starfall Hammock: Stellarys or Celestis; Floral Windmill: Somniwing, Gracewing or Flutternym – from AniimoTools only, marked `allowedSpeciesVerified: false` and "(unconfirmed)" on the Homeland tab. `familyRecipes` says which family works which recipe, the facility `level` it needs and any climate building it relies on (`prerequisites`: Pearl is 80% speed without a Heat Furnace, Star 80% without a Cooling Unit, Scales does no work without a Sunlamp). With an RV level chosen, the planner assumes each building is upgraded to the highest level that RV allows (`maxLevelByRv`, from the AniimoTools level tables, matched by aniimo.gg and Hideout) and only lets the families of recipes at or below that level work there – at RV 9 the Sandcastle is Lv 2, so the Sherro family (Pearl, Lv 3 from RV 13) can't work it yet. A Floral Windmill with no Sunlamp placed isn't staffed. Without an RV level every recipe's family is allowed. The Homeland tab shows each building's assumed level ("Lv 2 (max for RV 9)").
- The optimiser only assigns those Aniimo there. If none is in the pool, the summary says so ("No Aniimo in your pool can work the Dewy House – only Fragrancier or Dewy can.").
- When a team's full-time jobs are covered but a clash hides a part-time shortfall (e.g. the only Perfumery Aniimo, Fragrancier, is also the only one allowed in the Dewy House), the search completes the team by adding the part-time Aniimo that takes on the most work.

Personalities:

- Each building's `personalityBonus` is the personality that works 20% faster there (AniimoTools station pages). Personalities are random on each Aniimo you catch, not fixed per species (confirmed in-game by a player), so the planner recommends a personality per building and ability ("a Practical Fire Aniimo for the Chimney Kiln"), never a species.
- "Personalities to look for" groups them by personality and ability, ranked by how much work they speed up: 1 per full-time building, the busy share for a processor. Farm plots, the Aniipod Maker, Dance Pad Polisher, climate buildings and the generator have no bonus. Because Aniimo roam, a personality only helps at its own building.

Over capacity:

- The RV capacity is one limit shared by production and the Homebuilding Zone, so spaces kept for the zone come off the top.
- With part-time processors this is rare. If even the lowest busy level doesn't fit, the result says so (and how busy processors could be, or that even idle processors don't fit), then `planForCapacity` builds a best plan that fits: Aniimo only there for ability points go first, then full-time buildings are left idle – spare copies (the 5th Mine, the 2nd Well) before the only building of its kind – while every part-time job stays covered.
- What's left out is summarised in grouped lines (`summarizeShortfalls`), e.g. "Left idle: Mine ×2" and "Short on: Water 2", and names any ability no Aniimo in the pool has, suggesting Prismana or legendary Aniimo when they would help.

Capability targets:

- Estimated Require values are treated as skill capability targets.
- The selected workforce must meet those targets even when there are no matching physical facilities.
- Physical staffing can require more bodies than a low Estimated Require target.

## Assumptions

- Farm/woodland action time comes from `data/crops.json` (about 5 seconds per action, confirmed in-game by a player); crop growth time is chosen in Settings.
- Walking between plots is represented by the "Walking time allowance" advanced setting.
- Facilities come from `data/buildings.json`, sourced from aniimo.gg and aniimotools.dev; entries marked `verified: false` (e.g. hauler count) are estimates.
- Aniimo capacity per RV level comes from `data/homeland.json`; this is one shared limit across the Homebuilding Zone and all production areas (confirmed in-game).
- Game mechanics and data may change. Verify against current in-game behavior.

## Tests

```bash
npm test
```

The tests cover:

- Multi-skill continuous double-counting
- Multiple copies (owned mode, kept as a library option) and unlimited copies (pool mode)
- Available Aniimo pool filtering by category and explicit ticks; only the chosen starter; lower evolution stages covered by their own evolutions left out unless ticked, and the scraper's evolution tree parsing
- Family-only buildings get eligible Aniimo only, and a missing family is reported
- Aniimo data: no excluded (unreleased, boss or NPC) names, every record has an Aniilog number, records sorted by it with forms grouped; the scraper's Aniilog parsing, exclusions and renames
- RV placement limits (`maxByRv`), facility levels by RV (`maxLevelByRv`) and capacity from the RV level alone
- Intermittent sharing and overload; processors as shares of one Aniimo, per-building busy %, and farm steps capped while processing fills the rest of the day
- Building roles and personality bonuses in the data
- Fewer-body preference
- Continuous plus intermittent exclusivity
- Estimated Require without physical jobs
- Physical job bodies exceeding a low capability target
- Busy-level options for a real RV 9 setup (26 spaces): the options table, 25% fitting, the highest fitting level selected, the most that fits, speed; the Homebuilding Zone reserve; the lowest level not fitting; one plan when every processor has its own busy %
- Over capacity at 100% busy (spare copies idled first, part-time jobs covered, grouped summary), and within-capacity plans left unchanged
- Personalities to look for, ranked by work sped up
- Grouped shortfalls and the Prismana suggestion for an ability missing from the pool

## Privacy

No account, backend, analytics, or cloud persistence is used. Requirements, Available Aniimo choices, buildings, settings, and imported data remain in the browser unless exported manually. Ability icons and Aniimo portraits are loaded from aniimo.gg's image host (`cdn.beskor.net`).
