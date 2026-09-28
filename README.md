# Aniimo Homeland Planner

A static workforce planner for Aniimo Homeland. It recommends which Aniimo bodies to assign based on:

- Estimated Require capability targets
- Built Homeland facilities
- Owned roster quantities, or theorycraft candidates
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

aniimo.gg also lists copies of some Aniimo under 9-digit IDs (for example `glynsera-101330001`). Their internal editor names show they are tower climb, shrine puzzle, tutorial, NPC and test entities, not collectible forms. The scraper leaves them out and lists their IDs in `scrape.internalVariantsExcluded`. To keep them, set `INCLUDE_INTERNAL_VARIANTS=1`.

### Buildings, crops and Homeland capacity (hand-curated)

- `data/buildings.json`: real facility names, the work ability each one needs, slots, unlock RV level and placement limits. Each entry has `source` and `verified` fields.
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
- Aniimo capacity per RV level comes from `data/homeland.json`; Homebuilding Zone Aniimo are assumed to share the same RV spaces.
- Game mechanics and data may change. Verify against current in-game behavior.

## Tests

```bash
npm test
```

The tests cover:

- Multi-skill continuous double-counting
- Multiple owned copies
- Intermittent sharing and overload
- Fewer-body preference
- Continuous plus intermittent exclusivity
- Estimated Require without physical jobs
- Physical job bodies exceeding a low capability target

## Privacy

No account, backend, analytics, or cloud persistence is used. Requirements, roster, buildings, settings, and imported data remain in the browser unless exported manually.
