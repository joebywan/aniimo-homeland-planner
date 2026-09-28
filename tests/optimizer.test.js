const assert = require("assert");
const { DEFAULT_SKILLS, optimizeWorkforce, recommendSpareSpaces, resolveHomelandCapacity } = require("../optimizer");

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

test("planning mode treats unowned Aniimo as unlimited copies", () => {
  const result = optimize({
    workers: [aniimo("a", "Aniimo A", { Fire: 2 }), aniimo("b", "Aniimo B", { Water: 1 })],
    owned: [],
    buildings: [continuousBuilding("fire", "Fire", 4)],
    settings: { mode: "theorycraft" },
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

test("planning mode ignores legacy theorycraftCopies setting", () => {
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

test("capacity resolves from manual override, then RV level data, else unknown", () => {
  const data = { rvLevels: [{ level: 1, aniimoCapacity: 6 }, { level: 2, aniimoCapacity: null }] };
  assert.deepEqual(resolveHomelandCapacity(data, 1, null).capacity, 6);
  assert.equal(resolveHomelandCapacity(data, 1, 9).capacity, 9);
  assert.equal(resolveHomelandCapacity(data, 2, "").known, false);
  assert.equal(resolveHomelandCapacity(undefined, 3, null).known, false);
  assert.equal(resolveHomelandCapacity(undefined, null, 12).capacity, 12);
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
  assert.equal(plan.homebuilding.name, "homebuilding zone");
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

test("spare spaces: owned mode never suggests unowned Aniimo", () => {
  const result = spareScenario();
  result.unusedWorkers.push({ ...result.unusedWorkers[0], workerId: "ghost#1", aniimoId: "ghost", owned: false, skills: skills({ Hauling: 9 }) });
  const plan = recommendSpareSpaces({ result, capacity: 10, skills: DEFAULT_SKILLS, mode: "owned" });
  assert.ok(plan.haulers.every((item) => item.aniimoId !== "ghost"));
});
