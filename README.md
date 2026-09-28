# Aniimo Homeland Planner

A static workforce planner for Aniimo Homeland. It recommends which Aniimo bodies to assign based on:

- Estimated Require capability targets
- Your RV level (Aniimo spaces and how many of each building you can place)
- Built Homeland facilities
- The Available Aniimo pool: every commonly catchable Aniimo (base and regional forms), with Prismana forms and legendary Aniimo only when ticked
- Homeland skill levels
- Continuous worker slots versus shared intermittent work

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

Each record gets a `category`, which decides whether the planner uses it by default:

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

- `data/buildings.json`: real facility names, the work ability each one needs, slots, unlock RV level and placement limits. Each entry has `source` and `verified` fields. `placementLimit` is the readable text ("1 from RV 4, 2 from RV 8, …"); `maxByRv` is the same limit as data (`[{ "rv": 4, "max": 1 }, …]`) and drives the building counts. Published sources only give the end points for Farmland, Woodland and Mine, so their in-between steps come from the RV upgrade requirements (to build RV N+1 the game asks you to place that many at RV N) and are marked `maxByRvVerified: false`. Storage Units are not listed as buildings: they are only drop-off points for hauling Aniimo and have no worker of their own (confirmed in-game by a player). Hauling is covered by the Hauling figure in Estimated Require, and spare spaces can go to extra haulers.
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

Continuous work:

- Each active continuous worker slot consumes one physical Aniimo body.
- A multi-skill Aniimo assigned to one continuous job cannot fill another continuous job at the same time.
- Continuous jobs are matched by skill and minimum level from `data/buildings.json`.

Intermittent work:

- Farmland and Woodland are modeled as shared workloads.
- Load is calculated as `plots * action_seconds / cycle_seconds * overhead_multiplier`.
- One Aniimo can cover multiple intermittent skills only when the setting is enabled and combined load stays within the "keep farm helpers at most this busy" cap.
- Aniimo assigned to continuous work are not reused for intermittent work by default.

Over capacity:

- The RV capacity is one limit shared by production and the Homebuilding Zone, so spaces kept for the zone come off the top.
- If the full plan needs more Aniimo than that, the result headlines it (for example "Your buildings need 29 Aniimo (27 buildings + 2 farm helpers), but RV 9 has 26 spaces – 3 over.") and says whether Aniimo doubling up on farm steps could bring the number down.
- `planForCapacity` then builds a best plan that fits: Aniimo only there for ability points go first, then buildings are left idle – spare copies (the 5th Mine, the 2nd Well) before the only building of its kind – while every farm step stays covered. It starts from the full plan's team and only runs a second, size-capped search if that team misses Estimated Require points.
- The app shows the fitted plan by default when over capacity, with a switch to see the full plan. What's left out is summarised in grouped lines (`summarizeShortfalls`), e.g. "Left idle: Mine ×3" and "Short on: Water 2", and names any ability no Aniimo in the pool has, suggesting Prismana or legendary Aniimo when they would help.

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
- Available Aniimo pool filtering by category and explicit ticks
- Aniimo data: no excluded (unreleased, boss or NPC) names, every record has an Aniilog number, records sorted by it with forms grouped; the scraper's Aniilog parsing, exclusions and renames
- RV placement limits (`maxByRv`) and capacity from the RV level alone
- Intermittent sharing and overload
- Fewer-body preference
- Continuous plus intermittent exclusivity
- Estimated Require without physical jobs
- Physical job bodies exceeding a low capability target
- Over capacity: a real RV 9 setup fitted to 26 spaces (spare copies idled first, farm steps covered, grouped summary), the Homebuilding Zone reserve, and within-capacity plans left unchanged
- Grouped shortfalls and the Prismana suggestion for an ability missing from the pool

## Privacy

No account, backend, analytics, or cloud persistence is used. Requirements, Available Aniimo choices, buildings, settings, and imported data remain in the browser unless exported manually. Ability icons and Aniimo portraits are loaded from aniimo.gg's image host (`cdn.beskor.net`).
