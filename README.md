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

Primary data is generated from:

- <https://aniimo.gg/homeland/work/>

Cross-reference and category references:

- <https://backup.hideoutgacha.com/games/aniimo/homeland-abilities>
- <https://aniimo.io/en/guide/homeland>

Run:

```bash
npm run refresh:data
```

This regenerates:

- `data/aniimo.json`
- `data/aniimo-data.js`

The JS wrapper exists so the app can still work when opened from `file://` in browsers that block local JSON `fetch`.

## Weekly Refresh

`.github/workflows/refresh-aniimo-data.yml` runs every Monday and can also be triggered manually. It:

1. Runs `node scripts/scrape-aniimo.js`.
2. Checks whether `data/aniimo.json` or `data/aniimo-data.js` changed.
3. Commits and pushes refreshed data only when there is a real diff.

If GitHub Pages is configured from `main` and `/root`, those commits will refresh the deployed app.

## Optimizer Model

Continuous work:

- Each active continuous worker slot consumes one physical Aniimo body.
- A multi-skill Aniimo assigned to one continuous job cannot fill another continuous job at the same time.
- Continuous jobs are matched by skill and minimum level from `data/buildings.json`.

Intermittent work:

- Farmland and Woodland are modeled as shared workloads.
- Load is calculated as `plots * action_seconds / cycle_seconds * overhead_multiplier`.
- One Aniimo can cover multiple intermittent skills only when the setting is enabled and combined load stays within the utilization cap.
- Aniimo assigned to continuous work are not reused for intermittent work by default.

Capability targets:

- Estimated Require values are treated as skill capability targets.
- The selected workforce must meet those targets even when there are no matching physical facilities.
- Physical staffing can require more bodies than a low Estimated Require target.

## Assumptions

- Farmland and Woodland default to a representative 5 second action and 20 minute cycle.
- Travel/pathfinding is represented by an editable overhead multiplier.
- Facility counts and continuous job requirements are a starter model and should be updated as exact game data improves.
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
