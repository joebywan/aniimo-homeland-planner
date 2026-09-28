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
3. <https://backup.hideoutgacha.com/games/aniimo/homeland-abilities>: a cross-check for Prismana breeds. It fills in any Prismana form aniimo.gg does not list and records mismatches under `scrape.hideoutPrismana`.
4. `data/aniimo-overrides.json`: manual, user-confirmed values, merged last so they always win. Records are matched by `species` + `form`.
5. <https://aniimo.gg/aniilog/>: which species are Legendary. The Aniilog labels Somniwing and Irisalis as "Stage 4", the only Stage 4 species (Game8 and AniimoTools also name these two as the game's Legendary Aniimo). Somniwing has no Homeland work abilities, so only Irisalis appears in the data.

Each record gets a `category`, which decides whether the planner uses it by default:

| category | what | used by default |
| --- | --- | --- |
| `common` | Base and regional forms you can normally catch | yes |
| `prismana` | Prismana forms | only when "Include Prismana forms" (or the row) is ticked |
| `legendary` | Legendary species (Aniilog Stage 4) | only when "Include legendary Aniimo" (or the row) is ticked |
| `boss` | BOSS forms and boss/NPC entities (game template ID starting with 9, e.g. Irelia) | only if the row is ticked |

To correct a category by hand, add `{ "species": "...", "form": "...", "category": "..." }` to `categories` in `data/aniimo-overrides.json` (`form` is optional) and run `npm run refresh:data`.

The scraper also stores `abilityIcons`: for each of the 13 abilities, the in-game icon URL and circle colour from the ability section headers on <https://aniimo.gg/homeland/work/>. The app hotlinks these from `cdn.beskor.net`, like the Aniimo portraits, and falls back to a coloured two-letter dot if an icon can't load.

aniimo.gg also lists copies of some Aniimo under 9-digit IDs (for example `glynsera-101330001`). Their internal editor names show they are tower climb, shrine puzzle, tutorial, NPC and test entities, not collectible forms. The scraper leaves them out and lists their IDs in `scrape.internalVariantsExcluded`. To keep them, set `INCLUDE_INTERNAL_VARIANTS=1`.

### Buildings, crops and Homeland capacity (hand-curated)

- `data/buildings.json`: real facility names, the work ability each one needs, slots, unlock RV level and placement limits. Each entry has `source` and `verified` fields. `placementLimit` is the readable text ("1 from RV 4, 2 from RV 8, …"); `maxByRv` is the same limit as data (`[{ "rv": 4, "max": 1 }, …]`) and drives the building counts. Published sources only give the end points for Farmland, Woodland and Mine, so their in-between steps come from the RV upgrade requirements (to build RV N+1 the game asks you to place that many at RV N) and are marked `maxByRvVerified: false`. The Storage Unit has no `maxByRv`: the number of haulers is the player's choice.
- `data/crops.json`: Farmland and Woodland crops with grow times (`cycleMinutes`) and yields. The top-level `actionDurationSeconds` (6 s) is an estimate and is flagged `actionDurationVerified: false`.
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

Capability targets:

- Estimated Require values are treated as skill capability targets.
- The selected workforce must meet those targets even when there are no matching physical facilities.
- Physical staffing can require more bodies than a low Estimated Require target.

## Assumptions

- Farm/woodland action time comes from `data/crops.json` (currently an estimated 6 seconds per plot, flagged unverified); crop growth time is chosen in Settings.
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
- RV placement limits (`maxByRv`) and capacity from the RV level alone
- Intermittent sharing and overload
- Fewer-body preference
- Continuous plus intermittent exclusivity
- Estimated Require without physical jobs
- Physical job bodies exceeding a low capability target

## Privacy

No account, backend, analytics, or cloud persistence is used. Requirements, Available Aniimo choices, buildings, settings, and imported data remain in the browser unless exported manually. Ability icons and Aniimo portraits are loaded from aniimo.gg's image host (`cdn.beskor.net`).
