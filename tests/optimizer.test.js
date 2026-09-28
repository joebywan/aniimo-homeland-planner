const assert = require("assert");
const {
  DEFAULT_SKILLS,
  aniimoCategory,
  buildingLevelForRv,
  buildingMaxForRv,
  buildingRole,
  familyEligibility,
  filterAniimoPool,
  isInPool,
  poolStatus,
  describeCapacityPlan,
  optimizeWorkforce,
  personalityRecommendations,
  planForCapacity,
  planProcessorOptions,
  recommendSpareSpaces,
  resolveHomelandCapacity,
  summarizeShortfalls,
} = require("../optimizer");
const cropsData = require("../data/crops.json");
const buildingsData = require("../data/buildings.json");
const homelandData = require("../data/homeland.json");
const aniimoData = require("../data/aniimo.json");
const scraper = require("../scripts/scrape-aniimo.js");

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
    assert.ok(building.maxByRv, `${building.id} is missing maxByRv`);
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
  // Lower evolution stages a higher stage fully covers, and both starters (none chosen), are left out.
  assert.ok(pool.length > 90);
  assert.ok(pool.every((entry) => entry.category === "common"));
  assert.ok(!pool.some((entry) => /prismana|boss/i.test(entry.form) || entry.species === "Irisalis"));
  const legendary = aniimoData.aniimo.filter((entry) => entry.category === "legendary").map((entry) => entry.species);
  assert.ok(legendary.includes("Irisalis"));
  assert.ok(aniimoData.aniimo.filter((entry) => entry.form === "Prismana").every((entry) => entry.category === "prismana"));
  assert.equal(Object.keys(aniimoData.abilityIcons).join(","), DEFAULT_SKILLS.join(","), "an icon for every ability, in game order");
});

test("real data: only released Aniimo, no boss/NPC or datamined names", () => {
  const names = new Set(aniimoData.aniimo.map((entry) => entry.name));
  const species = new Set(aniimoData.aniimo.map((entry) => entry.species));
  const excludedNames = [
    "Butterfly Wing Sprite",
    "Forest Cloak Butterfly",
    "Leaf Hat Firefly",
    "Little Lightning Chirp",
    "Thunderfeather Sparrow",
    "Jabster",
    "Malangel",
    "Malevsera",
    "Irelia",
    "Floret",
    "Fennelun",
    "Soleon",
    "Coraliz",
    "Popapus",
    "Gachapus",
    "Infergon BOSS",
    "Tuckin BOSS",
    "Prismana Glameep",
    "Prismana Minespine",
    "Prismana Tuckin",
  ];
  for (const name of excludedNames) {
    assert.ok(!names.has(name) && !species.has(name), `${name} is not in the data`);
  }
  assert.ok(!aniimoData.aniimo.some((entry) => /boss/i.test(entry.name) || /boss/i.test(entry.form)));
  assert.ok(!aniimoData.aniimo.some((entry) => entry.category === "boss"));
  const excludedIds = new Set(aniimoData.scrape.excluded.map((item) => item.id));
  for (const id of ["irelia", "infergon-boss", "tuckin-9020700", "jabster", "forest-cloak-butterfly"]) {
    assert.ok(excludedIds.has(id), `${id} is recorded in scrape.excluded`);
  }
  assert.ok(aniimoData.scrape.excluded.every((item) => item.reason && item.reason.length > 20), "every exclusion has a reason");
  // Prismana Iris (the Aniimo from the Irelia quest) is kept; Tuckin evolves from Hummin, so it stays too.
  assert.ok(aniimoData.aniimo.some((entry) => entry.species === "Iris" && entry.form === "Prismana"));
  assert.ok(aniimoData.aniimo.some((entry) => entry.species === "Tuckin" && entry.form === "Mountain Form"));
  assert.ok(aniimoData.aniimo.some((entry) => entry.species === "Somniwing" && entry.category === "legendary"));
});

test("real data: every record has an Aniilog number and records are sorted by it", () => {
  const records = aniimoData.aniimo;
  assert.ok(records.every((entry) => Number.isInteger(entry.dexNumber) && entry.dexNumber > 0), "every record has dexNumber");
  assert.ok(records.every((entry) => typeof entry.dexLabel === "string" && entry.dexLabel), "every record has dexLabel");
  for (let index = 1; index < records.length; index += 1) {
    assert.ok(records[index - 1].dexNumber <= records[index].dexNumber, `${records[index].name} is in Aniilog order`);
    assert.ok(scraper.compareRecords(records[index - 1], records[index]) < 0, `${records[index].id} sorts after ${records[index - 1].id}`);
  }
  const glacy = records.filter((entry) => entry.species === "Glacy");
  assert.equal(glacy[0].dexLabel, "#015");
  assert.deepEqual(glacy.map((entry) => entry.form), ["Base", "Sea of Flowers Form", "Snowfield Form", "Prismana"], "base, regional forms, then Prismana");
  // A species' forms are all together.
  const seen = new Set();
  let previous = null;
  for (const entry of records) {
    if (entry.species !== previous) {
      assert.ok(!seen.has(entry.species), `${entry.species} forms are grouped`);
      seen.add(entry.species);
      previous = entry.species;
    }
  }
});

test("scraper: Aniilog badges give numbers; Secret entries, bosses and Hideout-only Prismana are excluded", () => {
  const html = [
    '{\\"key\\":\\"1004300\\",\\"href\\":\\"/aniimo/aniimo/glacy/\\",\\"name\\":\\"Glacy\\",\\"sub\\":\\"Ice / Water · Stage 3\\",\\"texture\\":\\"https://cdn.beskor.net/aniimo/icons/UI_PetHead_10043.webp\\",\\"badge\\":\\"#015\\",\\"hidden\\":false}',
    '{\\"key\\":\\"1040300\\",\\"href\\":\\"/aniimo/aniimo/jabster/\\",\\"name\\":\\"Jabster\\",\\"sub\\":\\"Water · Stage 3 · Secret\\",\\"badge\\":\\"Secret\\",\\"hidden\\":true}',
    '{\\"key\\":\\"1037100\\",\\"href\\":\\"/aniimo/aniimo/lunara/\\",\\"name\\":\\"Lunara\\",\\"sub\\":\\"Holy · Stage 1\\",\\"badge\\":\\"Starter\\",\\"hidden\\":false}',
  ].join(",");
  const entries = scraper.parseAniilog(html);
  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.dexNumber, entry.badge]),
    [["Glacy", 15, "#015"], ["Jabster", null, "Secret"], ["Lunara", null, "Starter"]],
  );
  assert.equal(entries[0].image, "https://cdn.beskor.net/aniimo/icons/UI_PetHead_10043.webp");
  assert.equal(scraper.formatDex(15), "#015");
  assert.equal(scraper.formatDex(10001), "#10001");
  entries[2].dexNumber = 99996; // from the overrides' dexNumbers

  const records = [
    { id: "glacy", name: "Glacy", species: "Glacy", form: "Base" },
    { id: "glacy-1004303", name: "Prismana Glacy", species: "Glacy", form: "Prismana" },
    { id: "glacy-prismana", name: "Prismana Glacy", species: "Glacy", form: "Prismana", hideoutOnly: true },
    { id: "glacy-boss", name: "Glacy BOSS", species: "Glacy", form: "BOSS", kind: "boss" },
    { id: "jabster", name: "Jabster", species: "Jabster", form: "Base" },
    { id: "irelia", name: "Irelia", species: "Irelia", form: "Base" },
    { id: "lunara", name: "Lunara", species: "Lunara", form: "Base" },
  ];
  const excluded = scraper.excludeUnobtainable(records, entries, [{ species: "Irelia", reason: "Story character." }]);
  assert.deepEqual(records.map((record) => [record.id, record.dexLabel]), [["glacy", "#015"], ["glacy-1004303", "#015"], ["lunara", "Starter"]]);
  assert.deepEqual(excluded.map((item) => item.id), ["glacy-boss", "glacy-prismana", "irelia", "jabster"]);
  assert.equal(excluded.find((item) => item.id === "irelia").reason, "Story character.");
  assert.match(excluded.find((item) => item.id === "jabster").reason, /Secret/);

  const renamed = scraper.applyRenames(
    [{ id: "x", name: "Prismana Old", species: "Old", form: "Prismana" }],
    [{ from: "Old", to: "New", reason: "placeholder name" }],
  );
  assert.deepEqual(renamed.map((item) => item.to), ["Prismana New"]);
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

// A player's real RV 9 Homeland: 57 buildings (20 Farmland, 10 Woodland), 26 Aniimo spaces. In-game the
// player runs it with about 20 Aniimo.
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
// The player chose Lunara as their starter (the only common Aniimo with Light besides Helion).
const playerInput = {
  aniimo: filterAniimoPool(aniimoData.aniimo, { starter: "Lunara" }),
  catalogue: aniimoData.aniimo,
  skills: aniimoData.skills,
  requirements: PLAYER_REQUIREMENTS,
  buildings: buildingsData.buildings,
  buildingState: Object.fromEntries(buildingsData.buildings.map((building) => [building.id, { count: PLAYER_COUNTS[building.id] || 0 }])),
  settings: { mode: "pool", actionDurationSeconds: 5, cycleDurationMinutes: 20, rvLevel: 9 },
};
const withLevel = (percent) => ({ ...playerInput, settings: { ...playerInput.settings, processorBusyPercent: percent } });
const fullCache = new Map();
function playerFullResult(percent = 100) {
  if (!fullCache.has(percent)) fullCache.set(percent, optimizeWorkforce(withLevel(percent)));
  return fullCache.get(percent);
}

test("roles: every building has a role, matching Hideout's groups and aniimo.gg's recipe data", () => {
  const expected = {
    primary: ["farmland", "woodland", "mine", "well", "dewy_house", "tidewhisper_sandcastle", "nimbus_bed", "starfall_hammock", "floral_windmill"],
    processor: [
      "carousel_mill", "crafting_table", "blazing_stove", "bouncy_brew_keg", "chimney_kiln", "claw_game_cooker", "joy_wheel_loom",
      "jukebox_dryer", "phonolfactory_table", "pickling_jar", "simmering_pot", "woodworking_bench", "aniipod_maker", "dance_pad_polisher",
    ],
    climate: ["cooling_unit", "heat_furnace", "sunlamp"],
    power: ["crackle_generator"],
  };
  for (const building of buildingsData.buildings) {
    assert.ok(["primary", "processor", "climate", "power"].includes(building.role), building.id);
    assert.ok(building.roleSource && building.roleSource.length > 10, `${building.id} has a role source`);
    assert.equal(buildingRole(building), building.role);
  }
  for (const [role, ids] of Object.entries(expected)) {
    for (const id of ids) assert.equal(buildingsData.buildings.find((building) => building.id === id)?.role, role, id);
  }
  assert.equal(buildingsData.buildings.length, Object.values(expected).flat().length);
});

test("personalities: every building's bonus matches AniimoTools, none for farms, climate or power", () => {
  const expected = {
    carousel_mill: "Tenacious", simmering_pot: "Tenacious", mine: "Playful", pickling_jar: "Playful", crafting_table: "Judicious",
    tidewhisper_sandcastle: "Judicious", nimbus_bed: "Judicious", well: "Faithful", joy_wheel_loom: "Faithful", starfall_hammock: "Faithful",
    claw_game_cooker: "Practical", chimney_kiln: "Practical", jukebox_dryer: "Nimble", blazing_stove: "Nimble", floral_windmill: "Nimble",
    bouncy_brew_keg: "Energetic", woodworking_bench: "Energetic", phonolfactory_table: "Instinctive", dewy_house: "Instinctive",
  };
  for (const building of buildingsData.buildings) {
    assert.equal(building.personalityBonus, expected[building.id] || null, building.id);
  }
  assert.equal(buildingsData.personalityBonusPercent, 20);
});

test("starters: only the chosen starter is in the pool; neither until one is chosen", () => {
  const starters = aniimoData.aniimo.filter((entry) => entry.starter).map((entry) => entry.species).sort();
  assert.deepEqual(starters, ["Helion", "Lunara"]);
  const names = (pool) => filterAniimoPool(aniimoData.aniimo, pool).filter((entry) => entry.starter).map((entry) => entry.species);
  assert.deepEqual(names({}), []);
  assert.deepEqual(names({ starter: "Lunara" }), ["Lunara"]);
  assert.deepEqual(names({ starter: "Helion" }), ["Helion"]);
  // A per-row tick can't bring back the other starter.
  assert.deepEqual(names({ starter: "Lunara", picks: { helion: true } }), ["Lunara"]);
  assert.equal(poolStatus(aniimoData.aniimo.find((entry) => entry.id === "helion"), { starter: "Lunara" }).reason, "otherStarter");
  // The optimiser never suggests the other starter.
  const lunaraOnly = optimizeWorkforce({ ...playerInput, aniimo: filterAniimoPool(aniimoData.aniimo, { starter: "Lunara" }) });
  assert.ok(!lunaraOnly.selectedWorkers.some((worker) => worker.species === "Helion"));
  // A player only has one starter: never two in a plan, never another one as a spare.
  assert.ok(lunaraOnly.selectedWorkers.filter((worker) => worker.species === "Lunara").length <= 1);
  assert.ok(!lunaraOnly.unusedWorkers.some((worker) => worker.species === "Lunara" && worker.copy > 1));
});

test("evolution: a lower stage fully covered by a higher stage of its line is left out, unless ticked", () => {
  const byId = new Map(aniimoData.aniimo.map((entry) => [entry.id, entry]));
  const emberpup = byId.get("emberpup");
  assert.equal(emberpup.evolutionLine, "Emberpup line");
  assert.equal(emberpup.stage, 1);
  assert.equal(emberpup.finalStage, 3);
  assert.equal(emberpup.tierName, "Lumin");
  assert.equal(byId.get("flameruff").tierName, "Gamma");
  assert.equal(byId.get("scorchhowl").tierName, "Nova");
  assert.equal(byId.get("somniwing").tierName, "Legendary");
  assert.equal(byId.get("lunara").tierName, "Lumin");
  // Lavazar is not covered by Minespine: they are on different branches of the Pebbling line.
  assert.ok(!(byId.get("lavazar").dominatedBy || []).includes("minespine"));
  assert.ok(emberpup.dominatedBy.includes("scorchhowl"));
  // Every dominated record really is covered in every ability by a higher stage of the same line.
  for (const entry of aniimoData.aniimo.filter((item) => item.dominatedBy)) {
    for (const id of entry.dominatedBy) {
      const higher = byId.get(id);
      assert.equal(higher.evolutionLine, entry.evolutionLine);
      assert.equal(higher.form, entry.form);
      assert.ok(higher.stage > entry.stage);
      assert.ok(DEFAULT_SKILLS.every((skill) => higher.skills[skill] >= entry.skills[skill]), `${id} covers ${entry.id}`);
    }
  }
  const pool = filterAniimoPool(aniimoData.aniimo, {});
  assert.ok(!pool.some((entry) => entry.id === "emberpup"));
  assert.ok(pool.some((entry) => entry.id === "scorchhowl"));
  assert.equal(poolStatus(emberpup, {}, byId).reason, "dominated");
  // A tick brings it back; so does leaving out every Aniimo that covers it.
  assert.ok(filterAniimoPool(aniimoData.aniimo, { picks: { emberpup: true } }).some((entry) => entry.id === "emberpup"));
  const noHigher = Object.fromEntries(emberpup.dominatedBy.map((id) => [id, false]));
  assert.ok(filterAniimoPool(aniimoData.aniimo, { picks: noHigher }).some((entry) => entry.id === "emberpup"));
  // A lower stage with an ability its higher stages lack stays in (none in today's data; see the scraper
  // test below for the rule).
  const kept = aniimoData.aniimo.filter((entry) => entry.category === "common" && entry.stage < entry.finalStage && !entry.dominatedBy && !entry.starter);
  for (const entry of kept) assert.ok(pool.some((item) => item.id === entry.id), entry.id);
  // The plan never uses a dominated Aniimo by default.
  const result = playerFullResult(50);
  assert.ok(!result.selectedWorkers.some((worker) => byId.get(worker.aniimoId).dominatedBy));
});

test("evolution: scraper parses the aniimo.gg Evolution tree; only an Aniimo's own evolutions can cover it", () => {
  // Pebbling branches: Lavazar -> Magmarex, and Geodeback -> Minespine.
  const card = (slug, name, stage) => `<a class="card" href="/aniimo/${slug}/"><img src="${slug}.webp"/><span class="n">${name}</span><span>Stage <!-- -->${stage}</span></a>`;
  const html =
    '<h2 class="x">Evolution<span class="y">Pebbling line</span></h2><div><div>' +
    card("pebbling", "Pebbling", 1) +
    "<div><div>" + card("lavazar", "Lavazar", 2) + "<div>" + card("magmarex", "Magmarex", 3) + "</div></div>" +
    "<div>" + card("geodeback", "Geodeback", 2) + "<div>" + card("minespine", "Minespine", 3) + "</div></div></div>" +
    '</div></div><h2>Family</h2><a href="/aniimo/other/"><span>Other</span>Stage 1</a>';
  const line = scraper.parseEvolutionLine(html);
  assert.equal(line.line, "Pebbling line");
  assert.deepEqual(
    line.members.map((member) => `${member.name}:${member.stage}<${member.parent || "-"}`),
    ["Pebbling:1<-", "Lavazar:2<pebbling", "Magmarex:3<lavazar", "Geodeback:2<pebbling", "Minespine:3<geodeback"]
  );
  const record = (id, species, form, values) => ({ id, species, form, category: "common", skills: skills(values) });
  const records = [
    record("pebbling", "Pebbling", "Base", { Earth: 1 }),
    record("lavazar", "Lavazar", "Base", { Earth: 1, Fire: 1 }),
    record("magmarex", "Magmarex", "Base", { Fire: 3 }),
    record("geodeback", "Geodeback", "Base", { Earth: 2 }),
    record("minespine", "Minespine", "Base", { Earth: 3, Fire: 2 }),
    record("pebbling-snow", "Pebbling", "Snowfield Form", { Earth: 1, Ice: 1 }),
  ];
  scraper.applyEvolution(records, [line], [{ name: "Pebbling", stage: 1 }]);
  scraper.markDominated(records);
  // Lavazar isn't covered by Minespine (another branch), nor by Magmarex (no Earth): it stays.
  assert.equal(records[1].dominatedBy, undefined);
  assert.deepEqual(records[0].dominatedBy, ["lavazar", "geodeback", "minespine"]);
  assert.deepEqual(records[3].dominatedBy, ["minespine"]);
  // A regional form is only compared with the same regional form of its evolutions.
  assert.equal(records[5].dominatedBy, undefined);
  assert.deepEqual(records.map((item) => item.tierName), ["Lumin", "Gamma", "Nova", "Gamma", "Nova", "Lumin"]);
  assert.equal(records[1].evolvesFrom, "Pebbling");
  assert.equal(records[1].finalStage, 3);
});

test("families: restricted buildings only get Aniimo of their families", () => {
  const dewyHouse = buildingsData.buildings.find((building) => building.id === "dewy_house");
  assert.deepEqual(dewyHouse.allowedSpecies, ["Fragrancier", "Dewy"]);
  const restricted = buildingsData.buildings.filter((building) => building.allowedSpecies).map((building) => building.id).sort();
  assert.deepEqual(restricted, ["dewy_house", "floral_windmill", "nimbus_bed", "starfall_hammock", "tidewhisper_sandcastle"]);
  // Player's plan: the Dewy House and Tidewhisper Sandcastle get eligible Aniimo only.
  const result = playerFullResult(50);
  const sandcastle = buildingsData.buildings.find((building) => building.id === "tidewhisper_sandcastle");
  for (const assignment of result.continuousAssignments) {
    const building = buildingsData.buildings.find((item) => item.id === assignment.job.buildingId);
    if (building.allowedSpecies) assert.ok(building.allowedSpecies.includes(assignment.worker.species), `${assignment.worker.species} at ${building.name}`);
  }
  assert.ok(result.continuousAssignments.some((item) => item.job.buildingId === "dewy_house"));
  assert.ok(result.continuousAssignments.some((item) => item.job.buildingId === sandcastle.id));

  // Synthetic: a Leisure Aniimo outside the family can't take the job, even with a higher level.
  const house = { ...continuousBuilding("house", "Leisure"), name: "Dewy House", role: "primary", allowedSpecies: ["Dewy"] };
  const outsider = { ...aniimo("big", "Big", { Leisure: 4 }), species: "Big" };
  const dewy = { ...aniimo("dewy", "Dewy", { Leisure: 1 }), species: "Dewy" };
  const withDewy = optimizeWorkforce({ aniimo: [outsider, dewy], skills: DEFAULT_SKILLS, requirements: skills({}), buildings: [house], buildingState: {}, settings: { mode: "pool" } });
  assert.equal(withDewy.feasible, true);
  assert.deepEqual(withDewy.continuousAssignments.map((item) => item.worker.species), ["Dewy"]);
  const without = optimizeWorkforce({ aniimo: [outsider], skills: DEFAULT_SKILLS, requirements: skills({}), buildings: [house], buildingState: {}, settings: { mode: "pool" } });
  assert.equal(without.feasible, false);
  const summary = summarizeShortfalls(without, { pool: [outsider], catalogue: [outsider, dewy], skills: DEFAULT_SKILLS });
  assert.ok(summary.lines.includes("No Aniimo in your pool can work the Dewy House – only Dewy can. Tick one on the Available Aniimo tab."), summary.lines.join(" | "));
});

test("facility levels: every building has max level by RV, matching the AniimoTools level tables", () => {
  const expected = {
    farmland: [1, 2, 5, 7, 9, 12, 16], woodland: [2, 4, 7, 11, 14, 18], mine: [3, 6, 9, 12, 15, 18],
    crafting_table: [3, 5, 7, 9, 12, 15, 18, 20], tidewhisper_sandcastle: [5, 8, 13], nimbus_bed: [10, 13, 16],
    dewy_house: [6, 11], starfall_hammock: [12], floral_windmill: [18], crackle_generator: [12, 14, 16, 18, 20],
  };
  for (const building of buildingsData.buildings) {
    const steps = building.maxLevelByRv;
    assert.ok(Array.isArray(steps) && steps.length, `${building.id} has maxLevelByRv`);
    assert.deepEqual(steps.map((step) => step.max), steps.map((_, index) => index + 1), `${building.id} levels go 1, 2, 3…`);
    assert.ok(steps.every((step, index) => index === 0 || step.rv > steps[index - 1].rv), `${building.id} RV rises`);
    assert.equal(steps[0].rv, building.unlockRv, `${building.id}: Level 1 unlocks when the building does`);
    assert.ok(building.maxLevelByRvSource?.length && typeof building.maxLevelByRvVerified === "boolean", building.id);
    if (expected[building.id]) assert.deepEqual(steps.map((step) => step.rv), expected[building.id], building.id);
  }
  const mine = buildingsData.buildings.find((building) => building.id === "mine");
  assert.deepEqual(buildingLevelForRv(mine, 9), { known: true, level: 3, rv: 9, maxLevel: 6, next: { level: 4, rv: 12 } });
  assert.equal(buildingLevelForRv(mine, 2).level, 0);
  assert.equal(buildingLevelForRv(mine, 20).next, null);
  assert.equal(buildingLevelForRv(mine, null).known, false);
  // Every family recipe says which facility level it needs.
  for (const building of buildingsData.buildings.filter((item) => item.familyRecipes)) {
    for (const recipe of building.familyRecipes) {
      assert.ok(Number.isInteger(recipe.level) && recipe.level >= 1, `${building.id} ${recipe.recipe}`);
      assert.ok(recipe.level <= building.maxLevelByRv.length, `${building.id} ${recipe.recipe} level exists`);
      assert.ok(Array.isArray(recipe.prerequisites) && recipe.family, `${building.id} ${recipe.recipe}`);
    }
  }
});

test("families: a recipe above the building's level for the RV is locked (Sherro family needs Sandcastle Lv 3)", () => {
  const sandcastle = buildingsData.buildings.find((building) => building.id === "tidewhisper_sandcastle");
  const nimbusBed = buildingsData.buildings.find((building) => building.id === "nimbus_bed");
  const susuta = ["Panpanta", "Piopiota", "Popota", "Susuta"];
  // RV 9 (the player's): Sandcastle Lv 2, so only the Susuta family.
  const rv9 = familyEligibility(sandcastle, { rvLevel: 9 });
  assert.deepEqual(rv9.species, susuta);
  assert.equal(rv9.level, 2);
  assert.deepEqual(rv9.recipes.map((recipe) => [recipe.family, recipe.status, recipe.unlockRv]), [["Susuta", "open", 5], ["Sherro", "level", 13]]);
  assert.deepEqual(familyEligibility(sandcastle, { rvLevel: 12 }).species, susuta);
  // RV 13: Lv 3, Pearl opens for the Sherro family.
  assert.deepEqual(familyEligibility(sandcastle, { rvLevel: 13 }).species, [...susuta, "Sherro", "Sheldon", "Shelly"]);
  // No RV level: every recipe's family (the older behaviour).
  assert.deepEqual(familyEligibility(sandcastle, {}).species, sandcastle.allowedSpecies);
  assert.deepEqual(familyEligibility(nimbusBed, { rvLevel: 13 }).species, ["Turbo", "Dreaple", "Nimbi"]);
  assert.deepEqual(familyEligibility(nimbusBed, { rvLevel: 16 }).species, ["Turbo", "Dreaple", "Nimbi", "Irisal", "Irisalis", "Iris"]);

  // The optimiser: only a Sherro in the pool, so at RV 9 nobody can work the Sandcastle; at RV 13 the Sherro can.
  const sherro = { ...aniimo("sherro", "Sherro", { Leisure: 3 }), species: "Sherro" };
  const input = {
    aniimo: [sherro],
    skills: DEFAULT_SKILLS,
    requirements: skills({}),
    buildings: [sandcastle],
    buildingState: { tidewhisper_sandcastle: { count: 1 } },
  };
  const at9 = optimizeWorkforce({ ...input, settings: { mode: "pool", rvLevel: 9 } });
  assert.equal(at9.feasible, false);
  assert.deepEqual(at9.continuousAssignments, []);
  const summary = summarizeShortfalls(at9, { pool: [sherro], catalogue: [sherro], skills: DEFAULT_SKILLS });
  assert.ok(summary.lines.some((line) => line.includes("only Panpanta, Piopiota, Popota or Susuta can")), summary.lines.join(" | "));
  const at13 = optimizeWorkforce({ ...input, settings: { mode: "pool", rvLevel: 13 } });
  assert.equal(at13.feasible, true);
  assert.deepEqual(at13.continuousAssignments.map((item) => item.worker.species), ["Sherro"]);
  // Without an RV level the union still applies.
  assert.equal(optimizeWorkforce({ ...input, settings: { mode: "pool" } }).feasible, true);

  // The player's RV 9 plan never puts the Sherro family on the Sandcastle.
  for (const percent of [50, 100]) {
    for (const item of playerFullResult(percent).continuousAssignments) {
      if (item.job.buildingId === "tidewhisper_sandcastle") assert.ok(susuta.includes(item.worker.species), item.worker.species);
    }
  }
});

test("families: a recipe that needs a missing climate building can't run (Floral Windmill without a Sunlamp)", () => {
  const windmill = buildingsData.buildings.find((building) => building.id === "floral_windmill");
  const buildings = buildingsData.buildings;
  const without = familyEligibility(windmill, { rvLevel: 18, buildingState: { floral_windmill: { count: 1 }, sunlamp: { count: 0 } }, buildings });
  assert.deepEqual(without.species, []);
  assert.deepEqual(without.recipes[0].missing, ["Sunlamp"]);
  const withLamp = familyEligibility(windmill, { rvLevel: 18, buildingState: { floral_windmill: { count: 1 }, sunlamp: { count: 1 } }, buildings });
  assert.deepEqual(withLamp.species, ["Somniwing", "Gracewing", "Flutternym"]);
  // No Sunlamp: the Windmill does no work, so it isn't staffed.
  const gracewing = { ...aniimo("grace", "Gracewing", { Leisure: 3 }), species: "Gracewing" };
  const result = optimizeWorkforce({
    aniimo: [gracewing],
    skills: DEFAULT_SKILLS,
    requirements: skills({}),
    buildings: [windmill, buildings.find((building) => building.id === "sunlamp")],
    buildingState: { floral_windmill: { count: 1 }, sunlamp: { count: 0 } },
    settings: { mode: "pool", rvLevel: 18 },
  });
  assert.deepEqual(result.continuousAssignments, []);
  // The Heat Furnace only speeds the Pearl recipe up, so it never blocks it.
  const sandcastle = buildings.find((building) => building.id === "tidewhisper_sandcastle");
  const noFurnace = familyEligibility(sandcastle, { rvLevel: 13, buildingState: { heat_furnace: { count: 0 } }, buildings });
  assert.ok(noFurnace.species.includes("Sherro"));
  assert.deepEqual(noFurnace.recipes[1].slower, ["Heat Furnace"]);
});

test("processors: part-time shares of one Aniimo, shared by Aniimo with the ability", () => {
  const cook = aniimo("cook", "Cook", { Fire: 2 });
  const processor = (id) => ({ ...continuousBuilding(id, "Fire"), role: "processor", personalityBonus: "Practical" });
  const input = {
    aniimo: [cook],
    skills: DEFAULT_SKILLS,
    requirements: skills({}),
    buildings: [processor("kiln"), processor("stove")],
    buildingState: {},
  };
  // Two Fire processors at 50% each: one Aniimo covers both.
  const half = optimizeWorkforce({ ...input, settings: { mode: "pool", processorBusyPercent: 50 } });
  assert.equal(half.feasible, true);
  assert.equal(half.selectedWorkers.length, 1);
  assert.equal(half.selectedWorkers[0].primaryAssignment, "Part-time processor worker (2 buildings)");
  assert.deepEqual(half.selectedWorkers[0].personalityTips.map((tip) => tip.personality), ["Practical", "Practical"]);
  // At 75% each they need 1.5 Aniimo, so 2.
  const most = optimizeWorkforce({ ...input, settings: { mode: "pool", processorBusyPercent: 75 } });
  assert.equal(most.selectedWorkers.length, 2);
  // A building's own busy % wins over the level.
  const own = optimizeWorkforce({
    ...input,
    buildingState: { kiln: { count: 1, busyPercent: 10 }, stove: { count: 1, busyPercent: 20 } },
    settings: { mode: "pool", processorBusyPercent: 100 },
  });
  assert.equal(own.selectedWorkers.length, 1);
  const rows = own.physicalStaffing.filter((row) => row.kind === "processor");
  assert.deepEqual(rows.map((row) => row.needLabel).sort(), ["10%", "20%"]);
});

test("processors: a farm helper's farm steps stay under the farm cap, processing fills the rest of the day", () => {
  const helper = aniimo("helper", "Helper", { Water: 2 });
  const input = {
    aniimo: [helper],
    skills: DEFAULT_SKILLS,
    requirements: skills({}),
    buildings: [
      intermittentBuilding("farm", [{ skill: "Water", jobsPerUnit: 1, label: "watering" }]),
      { ...continuousBuilding("keg", "Water"), role: "processor" },
    ],
    buildingState: { farm: { count: 48 }, keg: { count: 1 } },
  };
  // 48 plots × 5 s every 20 min = 20% farm work, plus a keg at 60%: 80% of one Aniimo's day.
  const result = optimizeWorkforce({ ...input, settings: { mode: "pool", processorBusyPercent: 60, maxUtilizationPercent: 50 } });
  assert.equal(result.feasible, true);
  assert.equal(result.selectedWorkers.length, 1);
  assert.equal(result.selectedWorkers[0].primaryAssignment, "Part-time: processors and farm steps (2 buildings)");
  // Farm steps alone above the cap need a second helper even though the day isn't full.
  const busyFarm = optimizeWorkforce({
    ...input,
    buildingState: { farm: { count: 144 }, keg: { count: 0 } },
    settings: { mode: "pool", maxUtilizationPercent: 50 },
  });
  assert.equal(busyFarm.selectedWorkers.length, 2);
});

test("processor options: player's RV 9 setup fits in 26 spaces, highest fitting level selected", () => {
  const started = Date.now();
  const options = planProcessorOptions({ ...playerInput, capacity: 26, homebuildingReserve: 0 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `options took ${elapsed} ms`);

  assert.deepEqual(options.options.map((option) => option.percent), [25, 50, 75, 100]);
  assert.equal(options.variesWithLevel, true);
  assert.equal(options.autoProcessors, 15);
  for (const option of options.options) {
    assert.equal(option.needed, option.plan.needed);
    assert.equal(option.fits, option.needed <= 26);
    assert.equal(option.spare, 26 - option.needed);
    // Full-time: 5 Mines, 2 Wells, Tidewhisper Sandcastle, Dewy House and the three climate buildings.
    assert.equal(option.plan.breakdown.buildings, 12);
  }
  assert.equal(options.options[0].fits, true, "25% fits in 26 spaces");
  // Needs grow with the busy level.
  for (let index = 1; index < options.options.length; index += 1) {
    assert.ok(options.options[index].needed >= options.options[index - 1].needed);
  }
  const highest = options.options.map((option) => option.fits).lastIndexOf(true);
  assert.equal(options.selectedIndex, highest);
  const selected = options.options[options.selectedIndex];
  assert.ok(options.maxFitPercent >= selected.percent);
  if (options.selectedIndex < options.options.length - 1) {
    assert.ok(options.maxFitPercent < options.options[options.selectedIndex + 1].percent);
    assert.equal(options.maxFitPercent % 5, 0);
  }

  // The selected plan covers every building, farm step and Estimated Require target.
  const plan = selected.plan;
  assert.equal(plan.overCapacity, false);
  assert.equal(plan.full.feasible, true);
  assert.ok(plan.full.selectedWorkers.length <= 26);
  assert.ok(plan.full.skillCoverage.every((row) => row.status === "OK"));
  assert.ok(plan.full.physicalStaffing.every((row) => row.status === "OK"));
  assert.ok(plan.full.physicalStaffing.some((row) => row.kind === "processor"));
  assert.ok(plan.full.physicalStaffing.some((row) => row.kind === "farm"));
  const text = describeCapacityPlan(plan, { rvLevel: 9, processorPercent: selected.percent });
  assert.match(text.headline, /^Your buildings need \d+ Aniimo with processors \d+% busy \(12 full-time \+ \d+ part-time\), and RV 9 has 26 spaces\.$/);
});

test("processor options: Homebuilding Zone spaces come out of the same limit", () => {
  const options = planProcessorOptions({ ...playerInput, capacity: 26, homebuildingReserve: 4 });
  assert.ok(options.options.every((option) => option.plan.budget === 22));
  const selected = options.options[options.selectedIndex];
  assert.ok(selected.fits);
  assert.ok(selected.needed <= 22);
  assert.match(describeCapacityPlan(selected.plan, { rvLevel: 9 }).headline, /4 kept for the Homebuilding Zone, leaving 22/);
});

test("processor options: when even the lowest level doesn't fit, its best plan that fits is shown", () => {
  const options = planProcessorOptions({ ...playerInput, capacity: 15, homebuildingReserve: 0 });
  assert.equal(options.noneFit, true);
  assert.equal(options.selectedIndex, 0);
  const plan = options.options[0].plan;
  assert.equal(plan.overCapacity, true);
  assert.ok(plan.fitted);
  assert.ok(plan.fitted.selectedWorkers.length <= 15);
  assert.ok(options.maxFitPercent === null || options.maxFitPercent < 25);
  // Only spare copies of full-time buildings are left idle.
  for (const job of plan.idleJobs) assert.ok(PLAYER_COUNTS[job.buildingId] > 1, job.buildingId);
});

test("processor options: no processors following the level gives a single plan", () => {
  const buildingState = { ...playerInput.buildingState };
  for (const building of buildingsData.buildings) {
    if (building.role === "processor") buildingState[building.id] = { ...buildingState[building.id], busyPercent: 30 };
  }
  const options = planProcessorOptions({ ...playerInput, buildingState, capacity: 26, homebuildingReserve: 0 });
  assert.equal(options.variesWithLevel, false);
  assert.equal(options.options.length, 1);
  assert.equal(options.options[0].percent, null);
  assert.equal(options.options[0].fits, true);
});

test("over capacity: at 100% busy the player's setup idles spare copies first", () => {
  const full = playerFullResult(100);
  const plan = planForCapacity({ ...withLevel(100), capacity: 24, homebuildingReserve: 0, fullResult: full });
  assert.equal(plan.breakdown.buildings, 12);
  assert.equal(plan.overCapacity, true);
  assert.equal(plan.needed, full.selectedWorkers.length);
  assert.equal(plan.overBy, plan.needed - 24);
  assert.ok(plan.minimumPossible <= plan.needed);
  const text = describeCapacityPlan(plan, { rvLevel: 9, processorPercent: 100 });
  assert.match(text.headline, /^Your buildings need \d+ Aniimo with processors 100% busy \(12 full-time \+ \d+ part-time\), but RV 9 has 24 spaces – \d+ over\.$/);

  const fitted = plan.fitted;
  assert.ok(fitted);
  assert.ok(fitted.selectedWorkers.length <= 24);
  assert.equal(fitted.unfilledFarmTasks.length, 0);
  const idle = new Map();
  for (const job of plan.idleJobs) idle.set(job.buildingId, (idle.get(job.buildingId) || 0) + 1);
  for (const [id, count] of idle) {
    assert.ok(PLAYER_COUNTS[id] > 1, `${id} is the only one of its kind`);
    assert.ok(count < PLAYER_COUNTS[id], `every ${id} left idle`);
  }
  const idleLine = plan.shortfalls.lines.find((line) => line.startsWith("Left idle: "));
  assert.ok(idleLine);
  assert.match(idleLine, /^Left idle: [A-Za-z ]+ ×\d+(, [A-Za-z ]+ ×\d+)*$/);
  assert.ok(plan.shortfalls.lines.length <= 4, plan.shortfalls.lines.join(" | "));
});

test("personalities to look for: ranked by work sped up, per building and ability", () => {
  const list = personalityRecommendations({ ...playerInput, settings: { processorBusyPercent: 50 } });
  const find = (personality, skill) => list.find((item) => item.personality === personality && item.skill === skill);
  assert.equal(list[0].personality, "Playful");
  assert.equal(list[0].skill, "Earth");
  assert.equal(list[0].weight, 5);
  const practical = find("Practical", "Fire");
  assert.deepEqual(practical.buildings.map((item) => item.name).sort(), ["Chimney Kiln", "Claw Game Cooker"]);
  assert.equal(practical.weight, 1);
  // Carousel Mill ×2 at 50% is one Aniimo's work.
  assert.equal(find("Tenacious", "Wind").buildings.find((item) => item.buildingId === "carousel_mill").weight, 1);
  // No personality speeds up farm plots, the Aniipod Maker or climate buildings.
  assert.ok(!list.some((item) => item.buildings.some((building) => ["farmland", "woodland", "aniipod_maker", "sunlamp"].includes(building.buildingId))));
  for (let index = 1; index < list.length; index += 1) assert.ok(list[index - 1].weight >= list[index].weight);
});

test("within capacity: the full plan is unchanged and no buildings are idled", () => {
  const full = playerFullResult(100);
  const plan = planForCapacity({ ...withLevel(100), capacity: 40, homebuildingReserve: 0, fullResult: full });
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

test("quality: among plans of the same size, stronger Aniimo win (full-time, part-time and requirement points)", () => {
  const weak = aniimo("aweak", "Aweak", { Fire: 2, Ice: 1 });
  const strong = aniimo("bstrong", "Bstrong", { Fire: 3 });
  const furnace = { ...continuousBuilding("furnace", "Fire"), role: "climate" };
  const base = { aniimo: [weak, strong], skills: DEFAULT_SKILLS, requirements: skills({}), buildingState: {} };
  // Owned mode (no quality pass, one of each): the search's pick is the weaker one.
  const owned = optimizeWorkforce({ ...base, roster: roster([["aweak", 1], ["bstrong", 1]]), buildings: [furnace], settings: { mode: "owned" } });
  assert.deepEqual(owned.selectedWorkers.map((worker) => worker.name), ["Aweak"]);
  // Pool mode: same headcount, the Fire 3 Aniimo takes the furnace.
  const full = optimizeWorkforce({ ...base, buildings: [furnace], settings: { mode: "pool" } });
  assert.equal(full.feasible, true);
  assert.deepEqual(full.selectedWorkers.map((worker) => worker.name), ["Bstrong"]);
  assert.deepEqual(full.continuousAssignments.map((item) => item.worker.name), ["Bstrong"]);
  // Part-time processor work goes to the higher level too.
  const kiln = { ...continuousBuilding("kiln", "Fire"), role: "processor" };
  const part = optimizeWorkforce({ ...base, buildings: [kiln], settings: { mode: "pool", processorBusyPercent: 50 } });
  assert.deepEqual(part.selectedWorkers.map((worker) => worker.name), ["Bstrong"]);
  // Same Earth level at the Mines, but one also brings the Grass point the requirements ask for: two of it.
  const bailite = aniimo("bailite", "Bailite", { Earth: 3, Hauling: 3 });
  const shrub = aniimo("shrubclaw", "Shrubclaw", { Grass: 2, Earth: 3, Hauling: 3 });
  const mines = optimizeWorkforce({
    aniimo: [bailite, shrub],
    skills: DEFAULT_SKILLS,
    requirements: skills({ Grass: 1 }),
    buildings: [continuousBuilding("mine", "Earth", 2)],
    buildingState: {},
    settings: { mode: "pool" },
  });
  assert.equal(mines.selectedWorkers.length, 2);
  assert.deepEqual(mines.selectedWorkers.map((worker) => worker.workerId).sort(), ["shrubclaw#1", "shrubclaw#2"]);
});

test("player's RV 9 plan: every building staffed by an eligible Aniimo, stronger picks, no one on two full-time jobs", () => {
  const options = planProcessorOptions({ ...playerInput, capacity: 26, homebuildingReserve: 0 });
  const byId = new Map(aniimoData.aniimo.map((entry) => [entry.id, entry]));
  const susuta = ["Panpanta", "Piopiota", "Popota", "Susuta"];
  for (const option of options.options) {
    // An option is never reported as fitting with something left unstaffed.
    if (option.fits) assert.equal(option.plan.full.feasible, true, `${option.percent}%`);
    const result = option.plan.full;
    assert.ok(result.physicalStaffing.every((row) => row.status === "OK"), `${option.percent}%`);
    // Full-time workers hold exactly one building and do no part-time work.
    const fullTimeIds = result.continuousAssignments.map((item) => item.worker.workerId);
    assert.equal(new Set(fullTimeIds).size, fullTimeIds.length, `${option.percent}%: a worker on two full-time buildings`);
    const partTimeIds = new Set(result.intermittentAssignments.map((item) => item.worker.workerId));
    assert.ok(fullTimeIds.every((id) => !partTimeIds.has(id)), `${option.percent}%: a full-time worker also doing part-time work`);
    for (const worker of result.selectedWorkers) {
      if (worker.work.fullTime) assert.equal(worker.work.partTime.length, 0, worker.displayName);
    }
    assert.equal(new Set(result.selectedWorkers.map((worker) => worker.workerId)).size, result.selectedWorkers.length);
  }

  const selected = options.options[options.selectedIndex];
  assert.equal(selected.fits, true);
  const result = selected.plan.full;
  const workerAt = (buildingId) => result.continuousAssignments.filter((item) => item.job.buildingId === buildingId).map((item) => item.worker);
  // Tidewhisper Sandcastle: a Susuta-line Aniimo (Level 2 at RV 9).
  const sand = workerAt("tidewhisper_sandcastle");
  assert.equal(sand.length, 1);
  assert.ok(susuta.includes(sand[0].species), sand[0].species);
  // Dewy House: a Fragrancier (the Dewy stage is covered by it), and the Perfumery processor still has someone
  // else – so the plan has a second Fragrancier (or another Perfumery Aniimo).
  const dewy = workerAt("dewy_house");
  assert.equal(dewy.length, 1);
  assert.equal(dewy[0].species, "Fragrancier");
  const perfumers = result.intermittentAssignments.filter((item) => item.tasks.some((task) => task.buildingId === "phonolfactory_table"));
  assert.ok(perfumers.length >= 1 && perfumers.every((item) => item.worker.workerId !== dewy[0].workerId));
  assert.ok(result.selectedWorkers.filter((worker) => worker.species === "Fragrancier").length >= 2);

  // Quality: no full-time worker is outclassed at its own building by a pool Aniimo that also keeps
  // every Estimated Require target – e.g. no Squashel (Fire 2) on the Heat Furnace, no Cornet (Water 2) at a
  // Well, and Mines go to Earth 3 Aniimo that also bring Grass (Shrubclaw) rather than Bailite or Bouldus.
  const names = result.selectedWorkers.map((worker) => worker.name);
  for (const name of ["Squashel", "Cornet", "Bailite", "Bouldus"]) assert.ok(!names.includes(name), `${name} in ${names.join(", ")}`);
  for (const item of result.continuousAssignments) {
    const skill = item.job.requirements[0].skill;
    const best = Math.max(
      ...playerInput.aniimo.filter((entry) => !item.job.allowedSpecies || item.job.allowedSpecies.includes(entry.species)).map((entry) => entry.skills[skill] || 0)
    );
    assert.equal(item.worker.skills[skill], best, `${item.worker.displayName} at ${item.job.label}`);
  }
  assert.ok(result.selectedWorkers.every((worker) => !byId.get(worker.aniimoId).dominatedBy));
});

test("processor options: a plan with room but an unstaffable building is never reported as fitting", () => {
  // No Susuta-line Aniimo in the pool: the Sandcastle can't be staffed at RV 9.
  const noSusuta = playerInput.aniimo.filter((entry) => !["Panpanta", "Piopiota", "Popota", "Susuta"].includes(entry.species));
  const options = planProcessorOptions({ ...playerInput, aniimo: noSusuta, capacity: 40, homebuildingReserve: 0 });
  assert.ok(options.options.every((option) => option.fits === false && option.complete === false));
  assert.equal(options.incomplete, true);
  assert.equal(options.noneFit, false);
  const plan = options.options[options.selectedIndex].plan;
  assert.ok(plan.fullShortfalls.lines.some((line) => line.includes("Tidewhisper Sandcastle")), plan.fullShortfalls.lines.join(" | "));
});
