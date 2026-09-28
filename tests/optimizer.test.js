const assert = require("assert");
const {
  DEFAULT_SKILLS,
  aniimoCategory,
  buildingMaxForRv,
  filterAniimoPool,
  isInPool,
  describeCapacityPlan,
  optimizeWorkforce,
  planForCapacity,
  recommendSpareSpaces,
  resolveHomelandCapacity,
  summarizeShortfalls,
} = require("../optimizer");
const cropsData = require("../data/crops.json");
const buildingsData = require("../data/buildings.json");
const homelandData = require("../data/homeland.json");
const aniimoData = require("../data/aniimo.json");

function skills(values) {
  return Object.fromEntries(DEFAULT_SKILLS.map((skill) => [skill, Number(values[skill] || 0)]));
}

function aniimo(id, name, values) {
  return {
    id,
    name,
    form: "Base",
    image: "",
    skills: skills(values),
  };
}

function roster(entries) {
  return Object.fromEntries(entries.map(([id, quantity]) => [id, { quantity, excluded: false }]));
}

function continuousBuilding(id, skill, count = 1) {
  return {
    id,
    name: `${skill} continuous job`,
    behavior: "continuous",
    defaultEnabled: true,
    defaultCount: count,
    slotsPerUnit: 1,
    requirements: [{ skill, minLevel: 1 }],
  };
}

function intermittentBuilding(id, pools) {
  return {
    id,
    name: `${id} shared work`,
    behavior: "intermittent",
    defaultEnabled: true,
    defaultCount: 1,
    pools,
  };
}

function optimize({ workers, owned, buildings = [], requirements = {}, settings = {} }) {
  return optimizeWorkforce({
    aniimo: workers,
    skills: DEFAULT_SKILLS,
    requirements: skills(requirements),
    roster: roster(owned),
    buildings,
    buildingState: {},
    settings: {
      mode: "owned",
      actionDurationSeconds: 5,
      cycleDurationMinutes: 20,
      overheadMultiplier: 1,
      maxUtilizationPercent: 50,
      allowIntermittentMultiSkill: true,
      beamWidth: 1000,
      maxSearchWorkers: 10,
      ...settings,
    },
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test("multi-skill continuous worker is not double counted", () => {
  const result = optimize({
    workers: [aniimo("a", "Aniimo A", { Fire: 4, Water: 4 })],
    owned: [["a", 1]],
    buildings: [continuousBuilding("fire", "Fire"), continuousBuilding("water", "Water")],
  });

  assert.equal(result.feasible, false);
  assert.ok(result.missing.some((item) => item.includes("needs 1 more Aniimo")));
});

test("two copies can fill two simultaneous continuous jobs", () => {
  const result = optimize({
    workers: [aniimo("a", "Aniimo A", { Fire: 4, Water: 4 })],
    owned: [["a", 2]],
    buildings: [continuousBuilding("fire", "Fire"), continuousBuilding("water", "Water")],
  });

  assert.equal(result.feasible, true);
  assert.equal(result.selectedWorkers.length, 2);
});

test("one worker can share small intermittent Grass and Water loads", () => {
  const result = optimize({
    workers: [aniimo("a", "Aniimo A", { Grass: 3, Water: 3 })],
    owned: [["a", 1]],
    buildings: [
      intermittentBuilding("farm", [
        { skill: "Grass", jobsPerUnit: 1, actionDurationSeconds: 6, cycleDurationSeconds: 60 },
        { skill: "Water", jobsPerUnit: 1, actionDurationSeconds: 6, cycleDurationSeconds: 60 },
      ]),
    ],
  });

  assert.equal(result.feasible, true);
  assert.equal(result.selectedWorkers.length, 1);
});

test("one worker cannot share overloaded intermittent skills", () => {
  const result = optimize({
    workers: [aniimo("a", "Aniimo A", { Grass: 3, Water: 3 })],
    owned: [["a", 1]],
    buildings: [
      intermittentBuilding("farm", [
        { skill: "Grass", jobsPerUnit: 1, actionDurationSeconds: 18, cycleDurationSeconds: 60 },
        { skill: "Water", jobsPerUnit: 1, actionDurationSeconds: 18, cycleDurationSeconds: 60 },
      ]),
    ],
  });

  assert.equal(result.feasible, false);
});

test("prefer one multi-skill intermittent worker over two specialists", () => {
  const result = optimize({
    workers: [
      aniimo("a", "Aniimo A", { Grass: 4, Water: 4 }),
      aniimo("b", "Aniimo B", { Grass: 3 }),
      aniimo("c", "Aniimo C", { Water: 3 }),
    ],
    owned: [
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ],
    buildings: [
      intermittentBuilding("farm", [
        { skill: "Grass", jobsPerUnit: 1, actionDurationSeconds: 6, cycleDurationSeconds: 60 },
        { skill: "Water", jobsPerUnit: 1, actionDurationSeconds: 6, cycleDurationSeconds: 60 },
      ]),
    ],
  });

  assert.equal(result.feasible, true);
  assert.equal(result.selectedWorkers.length, 1);
  assert.equal(result.selectedWorkers[0].aniimoId, "a");
});

test("continuous worker is not reused for intermittent work", () => {
  const result = optimize({
    workers: [
      aniimo("a", "Aniimo A", { Fire: 4, Grass: 4 }),
      aniimo("b", "Aniimo B", { Grass: 3 }),
    ],
    owned: [
      ["a", 1],
      ["b", 1],
    ],
    buildings: [
      continuousBuilding("fire", "Fire"),
      intermittentBuilding("farm", [
        { skill: "Grass", jobsPerUnit: 1, actionDurationSeconds: 6, cycleDurationSeconds: 60 },
      ]),
    ],
  });

  assert.equal(result.feasible, true);
  assert.equal(result.selectedWorkers.length, 2);
  const fireWorker = result.selectedWorkers.find((worker) => worker.aniimoId === "a");
  assert.ok(fireWorker.primaryAssignment.includes("Fire continuous job"));
});

test("estimated requirement with no physical job still selects capability", () => {
  const result = optimize({
    workers: [
      aniimo("a", "Aniimo A", { Water: 4 }),
      aniimo("b", "Aniimo B", { Water: 4 }),
    ],
    owned: [
      ["a", 1],
      ["b", 1],
    ],
    requirements: { Water: 8 },
  });

  assert.equal(result.feasible, true);
  assert.equal(result.selectedWorkers.length, 2);
});

test("physical jobs can exceed a low capability target", () => {
  const result = optimize({
    workers: [
      aniimo("a", "Aniimo A", { Fire: 1 }),
      aniimo("b", "Aniimo B", { Fire: 1 }),
      aniimo("c", "Aniimo C", { Fire: 1 }),
    ],
    owned: [
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ],
    requirements: { Fire: 1 },
    buildings: [continuousBuilding("fire", "Fire", 3)],
  });

  assert.equal(result.feasible, true);
  assert.equal(result.selectedWorkers.length, 3);
});

test("pool mode treats every Aniimo as unlimited copies", () => {
  const result = optimize({
    workers: [aniimo("a", "Aniimo A", { Fire: 2 }), aniimo("b", "Aniimo B", { Water: 1 })],
    owned: [],
    buildings: [continuousBuilding("fire", "Fire", 4)],
    settings: { mode: "pool" },
  });

  assert.equal(result.feasible, true);
  assert.equal(result.selectedWorkers.length, 4);
  assert.ok(result.selectedWorkers.every((worker) => worker.aniimoId === "a"));
  assert.deepEqual(
    result.selectedWorkers.map((worker) => worker.copy).sort(),
    [1, 2, 3, 4],
    "copies are numbered from 1 without gaps"
  );
});

test("legacy theorycraft mode behaves like pool mode and ignores theorycraftCopies", () => {
  const result = optimize({
    workers: [aniimo("a", "Aniimo A", { Water: 4 })],
    owned: [],
    requirements: { Water: 12 },
    settings: { mode: "theorycraft", theorycraftCopies: 1 },
  });

  assert.equal(result.feasible, true);
  assert.equal(result.selectedWorkers.length, 3);
});

test("owned mode still limits to owned copies", () => {
  const result = optimize({
    workers: [aniimo("a", "Aniimo A", { Fire: 2 })],
    owned: [["a", 2]],
    buildings: [continuousBuilding("fire", "Fire", 3)],
  });

  assert.equal(result.feasible, false);
});

test("capacity comes from the RV level only; a legacy manual number is ignored", () => {
  const data = { rvLevels: [{ level: 1, aniimoCapacity: 6 }, { level: 2, aniimoCapacity: null }] };
  assert.equal(resolveHomelandCapacity(data, 1).capacity, 6);
  assert.equal(resolveHomelandCapacity(data, 1, 9).capacity, 6, "third (old override) argument is ignored");
  assert.equal(resolveHomelandCapacity(data, 2).known, false);
  assert.equal(resolveHomelandCapacity(undefined, 3).known, false);
  assert.equal(resolveHomelandCapacity(undefined, null, 12).known, false);
  assert.equal(resolveHomelandCapacity(homelandData, 9).capacity, 26);
  assert.equal(resolveHomelandCapacity(homelandData, 20).capacity, 45);
  assert.equal(resolveHomelandCapacity(homelandData, 1).known, false, "RV 1 has no Aniimo spaces");
});

test("building max follows the maxByRv steps and locks before unlock", () => {
  const well = { id: "well", unlockRv: 4, maxByRv: [{ rv: 4, max: 1 }, { rv: 8, max: 2 }, { rv: 14, max: 3 }, { rv: 19, max: 4 }] };
  assert.deepEqual(buildingMaxForRv(well, 3), { limited: true, known: true, max: 0, locked: true, unlockRv: 4 });
  assert.equal(buildingMaxForRv(well, 4).max, 1);
  assert.equal(buildingMaxForRv(well, 7).max, 1);
  assert.equal(buildingMaxForRv(well, 8).max, 2);
  assert.equal(buildingMaxForRv(well, 13).max, 2);
  assert.equal(buildingMaxForRv(well, 20).max, 4);
  assert.equal(buildingMaxForRv(well, null).known, false);
  assert.equal(buildingMaxForRv({ id: "storage" }, 9).limited, false, "no maxByRv means no limit");
});

test("every building's maxByRv matches its placementLimit text", () => {
  for (const building of buildingsData.buildings) {
    if (!building.maxByRv) {
      assert.equal(building.id, "storage_hauling", `${building.id} is missing maxByRv`);
      continue;
    }
    const steps = [...String(building.placementLimit).matchAll(/(\d+)\s+from\s+RV\s*(\d+)/gi)].map((m) => ({
      rv: Number(m[2]),
      max: Number(m[1]),
    }));
    assert.ok(steps.length, `${building.id} placementLimit has steps`);
    for (const step of steps) {
      assert.equal(buildingMaxForRv(building, step.rv).max, step.max, `${building.id} at RV ${step.rv}`);
    }
    if (building.unlockRv > 1) {
      assert.equal(buildingMaxForRv(building, building.unlockRv - 1).max, 0, `${building.id} locked before RV ${building.unlockRv}`);
    }
    const maxes = building.maxByRv.map((step) => step.max);
    assert.deepEqual(maxes, [...maxes].sort((a, b) => a - b), `${building.id} steps never go down`);
  }
  const at9 = Object.fromEntries(buildingsData.buildings.map((b) => [b.id, buildingMaxForRv(b, 9)]));
  assert.equal(at9.farmland.max, 20);
  assert.equal(at9.woodland.max, 10);
  assert.equal(at9.mine.max, 5);
  assert.equal(at9.carousel_mill.max, 2);
  assert.equal(at9.nimbus_bed.locked, true);
});

test("pool: common in by default, Prismana/legendary/BOSS out, explicit ticks win", () => {
  const entries = [
    { id: "c", name: "Common", form: "Base", category: "common" },
    { id: "r", name: "Regional", form: "Snowfield Form", category: "common" },
    { id: "p", name: "Prismana X", form: "Prismana", category: "prismana" },
    { id: "l", name: "Legend", form: "Base", category: "legendary" },
    { id: "b", name: "Big BOSS", form: "BOSS", category: "boss" },
    { id: "old", name: "Old Prismana", form: "Prismana" },
  ];
  const ids = (pool) => filterAniimoPool(entries, pool).map((entry) => entry.id);
  assert.deepEqual(ids({}), ["c", "r"]);
  assert.deepEqual(ids({ includePrismana: true }), ["c", "r", "p", "old"]);
  assert.deepEqual(ids({ includeLegendary: true }), ["c", "r", "l"]);
  assert.deepEqual(ids({ picks: { p: true, c: false } }), ["r", "p"]);
  assert.deepEqual(ids({ includePrismana: true, picks: { p: false, b: true } }), ["c", "r", "b", "old"]);
  assert.equal(aniimoCategory(entries[5]), "prismana", "records without category fall back to the form");
  assert.equal(isInPool(entries[4], { includePrismana: true, includeLegendary: true }), false, "BOSS never by default");
});

test("real data: default pool has no Prismana, legendary or BOSS records", () => {
  const pool = filterAniimoPool(aniimoData.aniimo, {});
  assert.ok(pool.length > 150);
  assert.ok(pool.every((entry) => entry.category === "common"));
  assert.ok(!pool.some((entry) => /prismana|boss/i.test(entry.form) || entry.species === "Irisalis"));
  const legendary = aniimoData.aniimo.filter((entry) => entry.category === "legendary").map((entry) => entry.species);
  assert.ok(legendary.includes("Irisalis"));
  assert.ok(aniimoData.aniimo.filter((entry) => entry.form === "Prismana").every((entry) => entry.category === "prismana"));
  assert.equal(Object.keys(aniimoData.abilityIcons).join(","), DEFAULT_SKILLS.join(","), "an icon for every ability, in game order");
});

test("pool mode: optimiser only picks from the filtered pool", () => {
  const workers = [
    { ...aniimo("prism", "Prismana Star", { Fire: 5, Water: 5 }), form: "Prismana", category: "prismana" },
    { ...aniimo("fire", "Fire Pup", { Fire: 2 }), category: "common" },
    { ...aniimo("water", "Water Pup", { Water: 2 }), category: "common" },
  ];
  const run = (pool) =>
    optimizeWorkforce({
      aniimo: filterAniimoPool(workers, pool),
      skills: DEFAULT_SKILLS,
      requirements: skills({ Fire: 4, Water: 4 }),
      buildings: [],
      buildingState: {},
      settings: { mode: "pool", maxSearchWorkers: 10 },
    });
  const common = run({});
  assert.equal(common.feasible, true);
  assert.ok(common.selectedWorkers.every((worker) => worker.category === "common"));
  assert.equal(common.selectedWorkers.length, 4);
  const withPrismana = run({ includePrismana: true });
  assert.equal(withPrismana.selectedWorkers.length, 1);
  assert.equal(withPrismana.selectedWorkers[0].aniimoId, "prism");
});

function spareScenario() {
  const workers = [
    aniimo("fire", "Fire Worker", { Fire: 3 }),
    aniimo("water", "Water Worker", { Water: 2 }),
    aniimo("hauler1", "Big Hauler", { Hauling: 4 }),
    aniimo("hauler2", "Small Hauler", { Hauling: 1 }),
    aniimo("fire2", "Fire Backup", { Fire: 2, Hauling: 2 }),
    aniimo("plain", "Plain Aniimo", { Leisure: 1 }),
  ];
  const result = optimize({
    workers,
    owned: workers.map((worker) => [worker.id, 1]),
    requirements: { Fire: 3, Water: 2 },
  });
  return result;
}

test("spare spaces: backups for single-cover skills, then haulers", () => {
  const result = spareScenario();
  assert.equal(result.feasible, true);
  assert.equal(result.selectedWorkers.length, 2);

  const plan = recommendSpareSpaces({ result, capacity: 5, homebuildingReserve: 0, skills: DEFAULT_SKILLS, mode: "owned" });
  assert.equal(plan.free, 3);
  assert.equal(plan.overCapacity, false);
  assert.ok(plan.fragileSkills.some((item) => item.skill === "Fire"));
  assert.ok(plan.backups.some((item) => item.aniimoId === "fire2" && item.covers.includes("Fire")));
  assert.equal(plan.haulers[0].aniimoId, "hauler1");
  assert.equal(plan.backups.length + plan.haulers.length + plan.unfilled, 3);
});

test("spare spaces: homebuilding reserve uses preferred skills first", () => {
  const result = spareScenario();
  const plan = recommendSpareSpaces({
    result,
    capacity: 4,
    homebuildingReserve: 1,
    homebuildingZone: { name: "Craft Corner", preferredSkills: ["Leisure"] },
    skills: DEFAULT_SKILLS,
    mode: "owned",
  });
  assert.equal(plan.homebuilding.name, "Craft Corner");
  assert.equal(plan.homebuilding.reserved, 1);
  assert.equal(plan.homebuilding.suggestions[0].aniimoId, "plain");
  assert.equal(plan.backups.length + plan.haulers.length + plan.unfilled, 1);
});

test("spare spaces: default zone name and reserve never exceeds free spaces", () => {
  const result = spareScenario();
  const plan = recommendSpareSpaces({ result, capacity: 3, homebuildingReserve: 5, skills: DEFAULT_SKILLS, mode: "owned" });
  assert.equal(plan.homebuilding.name, "Homebuilding Zone");
  assert.equal(plan.free, 1);
  assert.equal(plan.homebuilding.reserved, 1);
  assert.equal(plan.backups.length + plan.haulers.length, 0);
});

test("spare spaces: warns when minimum workforce exceeds capacity", () => {
  const result = spareScenario();
  const plan = recommendSpareSpaces({ result, capacity: 1, skills: DEFAULT_SKILLS, mode: "owned" });
  assert.equal(plan.overCapacity, true);
  assert.equal(plan.overBy, 1);
  assert.equal(plan.free, 0);
  assert.equal(plan.haulers.length, 0);
});

test("spare spaces: unknown capacity returns no suggestions", () => {
  const result = spareScenario();
  const plan = recommendSpareSpaces({ result, capacity: null, skills: DEFAULT_SKILLS, mode: "owned" });
  assert.equal(plan.capacityKnown, false);
  assert.equal(plan.haulers.length, 0);
});

test("spare spaces: pool mode suggests from the pool, one of each form per list", () => {
  const workers = [aniimo("fire", "Fire Worker", { Fire: 3 }), aniimo("hauler", "Big Hauler", { Hauling: 4 })];
  const result = optimizeWorkforce({
    aniimo: workers,
    skills: DEFAULT_SKILLS,
    requirements: skills({ Fire: 3 }),
    buildings: [],
    buildingState: {},
    settings: { mode: "pool", maxSearchWorkers: 10 },
  });
  assert.equal(result.selectedWorkers.length, 1);
  const plan = recommendSpareSpaces({ result, capacity: 10, skills: DEFAULT_SKILLS, mode: "pool" });
  assert.equal(plan.haulers.filter((item) => item.aniimoId === "hauler").length, 1);
  assert.ok(plan.backups.some((item) => item.aniimoId === "fire"));
});

test("spare spaces: owned mode never suggests unowned Aniimo", () => {
  const result = spareScenario();
  result.unusedWorkers.push({ ...result.unusedWorkers[0], workerId: "ghost#1", aniimoId: "ghost", owned: false, skills: skills({ Hauling: 9 }) });
  const plan = recommendSpareSpaces({ result, capacity: 10, skills: DEFAULT_SKILLS, mode: "owned" });
  assert.ok(plan.haulers.every((item) => item.aniimoId !== "ghost"));
});

test("crop data: farm action time is the player-confirmed 5 seconds", () => {
  assert.equal(cropsData.actionDurationSeconds, 5);
  assert.equal(cropsData.actionDurationVerified, true);
  assert.ok(cropsData.crops.every((crop) => crop.actionDurationSeconds === undefined || crop.actionDurationSeconds === 5));
});

// A player's real RV 9 Homeland: 27 full-time buildings plus Farmland/Woodland, 26 Aniimo spaces.
const PLAYER_COUNTS = {
  farmland: 20, woodland: 10, carousel_mill: 2, dance_pad_polisher: 1, mine: 5, crafting_table: 1, aniipod_maker: 1,
  well: 2, claw_game_cooker: 1, jukebox_dryer: 1, simmering_pot: 1, tidewhisper_sandcastle: 1, bouncy_brew_keg: 1,
  chimney_kiln: 1, woodworking_bench: 1, phonolfactory_table: 1, dewy_house: 1, joy_wheel_loom: 1, heat_furnace: 1,
  cooling_unit: 1, blazing_stove: 1, pickling_jar: 1, sunlamp: 1,
};
const PLAYER_REQUIREMENTS = {
  Fire: 5, Grass: 5, Water: 8, Earth: 8, Lightning: 2, Ice: 0, Wind: 1, Dark: 5, Light: 1, Hauling: 5, Artisanship: 2,
  Leisure: 2, Perfumery: 1,
};
const playerInput = {
  aniimo: filterAniimoPool(aniimoData.aniimo, {}),
  catalogue: aniimoData.aniimo,
  skills: aniimoData.skills,
  requirements: PLAYER_REQUIREMENTS,
  buildings: buildingsData.buildings,
  buildingState: Object.fromEntries(buildingsData.buildings.map((building) => [building.id, { count: PLAYER_COUNTS[building.id] || 0 }])),
  settings: { mode: "pool", actionDurationSeconds: 5, cycleDurationMinutes: 20 },
};
let playerFull = null;
function playerFullResult() {
  if (!playerFull) playerFull = optimizeWorkforce(playerInput);
  return playerFull;
}

test("over capacity: player's RV 9 setup gets a best plan that fits in 26 spaces", () => {
  const started = Date.now();
  const full = playerFullResult();
  const plan = planForCapacity({ ...playerInput, capacity: 26, homebuildingReserve: 0, fullResult: full });
  assert.ok(Date.now() - started < 5000, "should stay fast");

  // Full plan: 27 buildings each need their own Aniimo, plus farm helpers.
  assert.equal(plan.breakdown.buildings, 27);
  assert.ok(plan.breakdown.farmHelpers >= 1);
  assert.equal(plan.overCapacity, true);
  assert.equal(plan.needed, full.selectedWorkers.length);
  assert.equal(plan.overBy, plan.needed - 26);
  assert.ok(plan.minimumPossible <= plan.needed);
  const text = describeCapacityPlan(plan, { rvLevel: 9 });
  assert.match(text.headline, /^Your buildings need \d+ Aniimo \(27 buildings \+ \d farm helpers?\), but RV 9 has 26 spaces – \d+ over\.$/);
  assert.ok(text.minimum.length > 0);

  // Fitted plan: no more than 26 Aniimo, every farm step covered, remaining buildings staffed.
  const fitted = plan.fitted;
  assert.ok(fitted);
  assert.ok(fitted.selectedWorkers.length <= 26);
  assert.equal(fitted.unfilledFarmTasks.length, 0);
  assert.equal(fitted.unfilledJobs.length, 0);
  assert.ok(fitted.physicalStaffing.filter((row) => row.type === "Intermittent").every((row) => row.status === "OK"));
  assert.ok(fitted.physicalStaffing.some((row) => row.type === "Intermittent"));

  // Only spare copies are left idle: Mines, the 2nd Carousel Mill or the 2nd Well, never the only one.
  const idle = new Map();
  for (const job of plan.idleJobs) idle.set(job.buildingId, (idle.get(job.buildingId) || 0) + 1);
  assert.equal(plan.idleJobs.length, plan.needed - 26);
  for (const [id, count] of idle) {
    assert.ok(PLAYER_COUNTS[id] > 1, `${id} is the only one of its kind`);
    assert.ok(count < PLAYER_COUNTS[id], `every ${id} left idle`);
  }

  // Grouped summary: one entry per building type, never one line per copy.
  const summary = plan.shortfalls;
  assert.equal(summary.idle.reduce((sum, group) => sum + group.count, 0), plan.idleJobs.length);
  assert.equal(new Set(summary.idle.map((group) => group.name)).size, summary.idle.length);
  const idleLine = summary.lines.find((line) => line.startsWith("Left idle: "));
  assert.ok(idleLine);
  assert.match(idleLine, /^Left idle: [A-Za-z ]+ ×\d+(, [A-Za-z ]+ ×\d+)*$/);
  assert.ok(summary.lines.length <= 4, summary.lines.join(" | "));
  // Totals shortfalls, if any, are one "Short on" line.
  assert.ok(summary.lines.filter((line) => line.startsWith("Short on")).length <= 1);
});

test("over capacity: Homebuilding Zone spaces come out of the same limit", () => {
  const plan = planForCapacity({ ...playerInput, capacity: 26, homebuildingReserve: 4, fullResult: playerFullResult() });
  assert.equal(plan.budget, 22);
  assert.ok(plan.fitted.selectedWorkers.length <= 22);
  assert.equal(plan.fitted.unfilledFarmTasks.length, 0);
  assert.match(describeCapacityPlan(plan, { rvLevel: 9 }).headline, /4 kept for the Homebuilding Zone, leaving 22/);
});

test("within capacity: the full plan is unchanged and no buildings are idled", () => {
  const full = playerFullResult();
  const plan = planForCapacity({ ...playerInput, capacity: 40, homebuildingReserve: 0, fullResult: full });
  assert.equal(plan.overCapacity, false);
  assert.equal(plan.fitted, null);
  assert.equal(plan.full, full);
  assert.equal(plan.idleJobs.length, 0);
  assert.ok(plan.shortfalls.ok);

  const small = optimize({
    workers: [aniimo("a", "Aniimo A", { Fire: 4 })],
    owned: [["a", 2]],
    buildings: [continuousBuilding("fire", "Fire", 2)],
  });
  const smallPlan = planForCapacity({
    aniimo: [aniimo("a", "Aniimo A", { Fire: 4 })],
    skills: DEFAULT_SKILLS,
    requirements: skills({}),
    buildings: [continuousBuilding("fire", "Fire", 2)],
    buildingState: {},
    settings: { mode: "pool" },
    capacity: 2,
  });
  assert.equal(smallPlan.overCapacity, false);
  assert.equal(smallPlan.full.selectedWorkers.length, small.selectedWorkers.length);
});

test("over capacity: synthetic duplicates are idled before single buildings", () => {
  const workers = [aniimo("earth", "Digger", { Earth: 2 }), aniimo("fire", "Cook", { Fire: 2 })];
  const plan = planForCapacity({
    aniimo: workers,
    skills: DEFAULT_SKILLS,
    requirements: skills({}),
    buildings: [continuousBuilding("mine", "Earth", 3), continuousBuilding("stove", "Fire", 1)],
    buildingState: {},
    settings: { mode: "pool" },
    capacity: 2,
  });
  assert.equal(plan.overBy, 2);
  assert.deepEqual(plan.shortfalls.lines, ["Left idle: Earth continuous job ×2"]);
  assert.equal(plan.fitted.selectedWorkers.length, 2);
  assert.ok(plan.fitted.continuousAssignments.some((item) => item.job.buildingId === "stove"));
});

test("shortfalls: missing jobs are grouped and a missing ability suggests ticking Prismana", () => {
  const common = aniimo("fire", "Cook", { Fire: 2 });
  const prismana = { ...aniimo("glow", "Prismana Glow", { Light: 2 }), form: "Prismana", category: "prismana" };
  const result = optimizeWorkforce({
    aniimo: [common],
    skills: DEFAULT_SKILLS,
    requirements: skills({ Light: 1 }),
    buildings: [continuousBuilding("lamp", "Light", 3)],
    buildingState: {},
    settings: { mode: "pool" },
  });
  assert.equal(result.feasible, false);
  const summary = summarizeShortfalls(result, { pool: [common], catalogue: [common, prismana], skills: DEFAULT_SKILLS });
  assert.deepEqual(summary.unstaffed.map((group) => [group.name, group.count]), [["Light continuous job", 3]]);
  assert.ok(summary.lines.includes("No Aniimo for: Light continuous job ×3"));
  assert.ok(summary.lines.includes("Short on: Light 1"));
  assert.equal(summary.noAbility.length, 1);
  assert.equal(summary.noAbility[0].skill, "Light");
  assert.ok(summary.lines.some((line) => /No Aniimo in your pool has Light\. Ticking Prismana forms/.test(line)));
  assert.ok(summary.lines.length <= 3);
});
