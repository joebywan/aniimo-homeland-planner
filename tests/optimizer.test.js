const assert = require("assert");
const { DEFAULT_SKILLS, optimizeWorkforce } = require("../optimizer");

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
  assert.ok(result.missing.some((item) => item.includes("body")));
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
