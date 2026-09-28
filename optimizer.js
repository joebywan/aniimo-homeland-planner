(function attachOptimizer(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.AniimoOptimizer = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function buildOptimizer() {
  const DEFAULT_SKILLS = [
    "Fire",
    "Grass",
    "Water",
    "Earth",
    "Lightning",
    "Ice",
    "Wind",
    "Dark",
    "Light",
    "Hauling",
    "Artisanship",
    "Leisure",
    "Perfumery",
  ];

  // mode "pool": every Aniimo passed in is available with as many copies as needed (the planner's
  // "Available Aniimo" pool). mode "owned": limited to roster quantities (kept for library use and tests).
  // "theorycraft" is the old name for "pool".
  const DEFAULT_SETTINGS = {
    mode: "pool",
    actionDurationSeconds: 5,
    cycleDurationMinutes: 20,
    overheadMultiplier: 1,
    maxUtilizationPercent: 50,
    allowIntermittentMultiSkill: true,
    // How much of the time each processor building (role "processor") is busy, as a share of one Aniimo.
    // A building can override it with buildingState[id].busyPercent.
    processorBusyPercent: 100,
    beamWidth: 1000,
    maxSearchWorkers: 30,
    theorycraftCandidateLimit: 80,
  };

  const DEFAULT_HOMEBUILDING_ZONE_NAME = "Homebuilding Zone";

  // The processor busy levels offered as options, and how much of one Aniimo's day part-time work may
  // fill in total. Farm steps are also held to the "keep farm helpers at most this busy" cap
  // (maxUtilizationPercent); processor work can fill the rest of a worker's day.
  const PROCESSOR_LEVELS = [25, 50, 75, 100];
  const WORKER_DAY = 1;
  // Processor work is handed out in pieces of at most half an Aniimo's day, so one Aniimo can split
  // its time between two processors, or between farm steps and a processor.
  const PROCESSOR_CHUNK = 0.5;
  const ROLES = ["primary", "processor", "climate", "power"];

  // A building's role. Data records carry `role`; older data falls back to its behaviour.
  function buildingRole(building) {
    if (ROLES.includes(building?.role)) return building.role;
    return "primary";
  }

  // Processors only work while their inputs last, so they are part-time. Everything else with a full-time
  // slot (primary producers such as Mines and Wells, climate buildings and generators) holds its Aniimo.
  function isPartTimeProcessor(building) {
    return building?.behavior === "continuous" && buildingRole(building) === "processor";
  }

  function farmCapOf(settings) {
    return clampNumber(settings.maxUtilizationPercent, 50, 1, 100) / 100;
  }

  // The most one Aniimo can take of a part-time task: farm steps up to the farm-helper cap, processor
  // work up to a full day.
  function taskCapacity(task, settings) {
    return task.kind === "processor" ? WORKER_DAY : farmCapOf(settings);
  }

  // Fewest Aniimo holding each ability that the part-time work could need: enough for the farm steps
  // at the farm cap, and enough for all farm and processor work of that ability in a full day each.
  function partTimeNeedBySkill(model, settings) {
    const farmCap = farmCapOf(settings);
    const bySkill = new Map();
    for (const task of model.intermittentTasks) {
      const entry = bySkill.get(task.skill) || { farm: 0, processor: 0 };
      if (task.kind === "processor") entry.processor += task.load;
      else entry.farm += task.load;
      bySkill.set(task.skill, entry);
    }
    const needs = new Map();
    for (const [skill, entry] of bySkill) {
      needs.set(
        skill,
        Math.max(Math.ceil(entry.farm / farmCap - 0.000001), Math.ceil((entry.farm + entry.processor) / WORKER_DAY - 0.000001))
      );
    }
    return needs;
  }

  function busyShare(building, saved, settings) {
    const override = saved?.busyPercent;
    const percent =
      override !== null && override !== undefined && override !== "" && Number.isFinite(Number(override))
        ? Number(override)
        : settings.processorBusyPercent;
    return clampNumber(percent, 100, 0, 100) / 100;
  }

  function clampNumber(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  function cloneSkillMap(skills, source) {
    return Object.fromEntries(skills.map((skill) => [skill, Number(source?.[skill] || 0)]));
  }

  function emptySkillMap(skills) {
    return Object.fromEntries(skills.map((skill) => [skill, 0]));
  }

  function totalSkillPower(worker, skills) {
    return skills.reduce((sum, skill) => sum + Number(worker.skills?.[skill] || 0), 0);
  }

  function displayWorkerName(worker) {
    if (!worker.form || worker.form === "Base" || worker.name.includes(worker.form)) return worker.name;
    return `${worker.name} (${worker.form})`;
  }

  // In pool mode Aniimo are treated as unlimited. To keep the search
  // fast we only generate as many copies of a form as could ever be useful: the number of bodies
  // that the skills it has could possibly fill, capped at the search depth.
  function planningCopyCap(entry, model, requirements, settings, skills) {
    // A player only ever has one starter.
    if (entry?.starter) return 1;
    const maxWorkers = Math.floor(clampNumber(settings.maxSearchWorkers, DEFAULT_SETTINGS.maxSearchWorkers, 1, 80));
    const partTime = partTimeNeedBySkill(model, settings);
    let best = 0;

    for (const skill of skills) {
      const level = Number(entry.skills?.[skill] || 0);
      if (level <= 0) continue;
      let bodies = 0;
      for (const job of model.continuousJobs) {
        if (!speciesAllowed(entry, job)) continue;
        if ((job.requirements || []).some((req) => req.skill === skill && level >= Number(req.minLevel || 1))) {
          bodies += 1;
        }
      }
      bodies += partTime.get(skill) || 0;
      bodies += Math.ceil(Number(requirements?.[skill] || 0) / level);
      best = Math.max(best, bodies);
    }

    return Math.max(1, Math.min(maxWorkers, best));
  }

  function isOwnedMode(settings) {
    return settings?.mode === "owned";
  }

  // "boss" only appears in data from before boss/NPC entities were removed from the Aniimo list (for example
  // an old imported file); such records stay out unless ticked.
  const CATEGORIES = ["common", "prismana", "legendary", "boss"];

  // Which group an Aniimo belongs to. Data records carry `category`; older data falls back to the form.
  function aniimoCategory(entry) {
    if (CATEGORIES.includes(entry?.category)) return entry.category;
    if (entry?.form === "BOSS") return "boss";
    if (entry?.form === "Prismana") return "prismana";
    return "common";
  }

  // pool: { includePrismana, includeLegendary, starter, picks: { [id]: true | false } }.
  // - Starters: a player only has one (Lunara or Helion). Only the chosen one can be in the pool; until one
  //   is chosen, neither is (a per-row tick can't override this).
  // - A per-row tick otherwise always wins.
  // - Common Aniimo are in, Prismana and legendary follow their toggles, anything else (old "boss" records)
  //   is out.
  // - A lower evolution stage that a higher stage of its line fully covers (dominatedBy) is out, unless none
  //   of those higher stages is in the pool. That check needs `lookup` (id -> record); without it the lower
  //   stage is simply left out.
  function poolStatus(entry, pool, lookup) {
    if (entry?.starter) {
      if (!pool?.starter) return { inPool: false, reason: "starterUnchosen" };
      if (pool.starter !== entry.species) return { inPool: false, reason: "otherStarter" };
    }
    const pick = pool?.picks?.[entry?.id];
    if (pick === true || pick === false) return { inPool: pick, reason: "pick" };
    const category = aniimoCategory(entry);
    let inPool = false;
    if (category === "common") inPool = true;
    else if (category === "prismana") inPool = Boolean(pool?.includePrismana);
    else if (category === "legendary") inPool = Boolean(pool?.includeLegendary);
    if (!inPool) return { inPool: false, reason: "category" };
    const dominators = Array.isArray(entry?.dominatedBy) ? entry.dominatedBy : [];
    if (dominators.length) {
      const coveredBy = lookup
        ? dominators.map((id) => lookup.get(id)).filter((other) => other && poolStatus(other, pool, lookup).inPool)
        : dominators;
      if (coveredBy.length) return { inPool: false, reason: "dominated", coveredBy };
    }
    return { inPool: true, reason: "default" };
  }

  function isInPool(entry, pool, lookup) {
    return poolStatus(entry, pool, lookup).inPool;
  }

  function filterAniimoPool(aniimo, pool) {
    const lookup = new Map((aniimo || []).map((entry) => [entry.id, entry]));
    return (aniimo || []).filter((entry) => isInPool(entry, pool, lookup));
  }

  function buildWorkers(aniimo, roster, settings, skills, copyCapFor) {
    const workers = [];
    const owned = isOwnedMode(settings);

    for (const entry of aniimo) {
      const ownedState = (owned && roster?.[entry.id]) || {};
      if (ownedState.excluded) continue;

      // A player only ever has one starter, so it is never duplicated.
      const ownedMax = entry.starter ? 1 : 99;
      const ownedQuantity = owned ? Math.floor(clampNumber(ownedState.quantity, 0, 0, ownedMax)) : 0;
      const poolCopies = owned ? 0 : entry.starter ? 1 : copyCapFor ? copyCapFor(entry) : 1;
      const quantity = Math.max(ownedQuantity, poolCopies);

      for (let copy = 1; copy <= quantity; copy += 1) {
        workers.push(makeWorker(entry, copy, skills, owned ? copy <= ownedQuantity : true));
      }
    }

    return workers;
  }

  function makeWorker(entry, copy, skills, owned = true) {
    return {
      workerId: `${entry.id}#${copy}`,
      aniimoId: entry.id,
      copy,
      name: entry.name,
      form: entry.form,
      image: entry.image || "",
      category: aniimoCategory(entry),
      species: entry.species || entry.name,
      stage: Number(entry.stage) || 1,
      finalStage: Number(entry.finalStage) || Number(entry.stage) || 1,
      tierName: entry.tierName || "",
      starter: Boolean(entry.starter),
      // Only meaningful in owned mode; pool Aniimo are all available.
      owned: owned !== false,
      skills: cloneSkillMap(skills, entry.skills),
      totalSkill: skills.reduce((sum, skill) => sum + Number(entry.skills?.[skill] || 0), 0),
    };
  }

  function getBuildingState(building, state) {
    const saved = state?.[building.id] || {};
    return {
      enabled: saved.enabled ?? building.defaultEnabled ?? true,
      count: Math.floor(clampNumber(saved.count ?? building.defaultCount ?? 0, 0, 0, 999)),
      busyPercent: saved.busyPercent ?? null,
    };
  }

  function buildWorkModel(buildings, buildingState, settings) {
    const continuousJobs = [];
    const intermittentByKey = new Map();
    const actionSeconds = clampNumber(settings.actionDurationSeconds, 5, 0.1, 3600);
    const cycleSeconds = clampNumber(settings.cycleDurationMinutes, 20, 0.1, 10080) * 60;
    const overhead = clampNumber(settings.overheadMultiplier, 1, 0.1, 20);

    const inactiveBuildings = [];
    for (const building of buildings || []) {
      const state = getBuildingState(building, buildingState);
      if (!state.enabled || state.count <= 0) continue;
      // Family-only buildings: only the families of recipes open at the building's assumed level.
      const family = familyEligibility(building, { rvLevel: settings.rvLevel, buildingState, buildings });
      const allowedSpecies = family ? family.species : null;
      if (family && !allowedSpecies.length) {
        // No recipe can run (every one is above the level, or needs a missing climate building): nothing to staff.
        inactiveBuildings.push({ buildingId: building.id, name: building.name, count: state.count, recipes: family.recipes });
        continue;
      }

      if (isPartTimeProcessor(building)) {
        // Part-time processor: a share of one Aniimo per building, shared by every Aniimo with the ability.
        const share = busyShare(building, state, settings);
        const slots = Math.max(1, Number(building.slotsPerUnit || 1));
        const requirement = (building.requirements || [])[0] || { skill: "Hauling", minLevel: 1 };
        const key = `${building.id}:${requirement.skill}`;
        intermittentByKey.set(key, {
          id: key,
          kind: "processor",
          buildingId: building.id,
          buildingName: building.name,
          skill: requirement.skill,
          minLevel: Number(requirement.minLevel || 1),
          count: state.count,
          busyPercent: Math.round(share * 100),
          label: `${building.name}${state.count > 1 ? ` ×${state.count}` : ""}`,
          personalityBonus: building.personalityBonus || null,
          allowedSpecies,
          load: state.count * slots * share,
        });
        continue;
      }

      if (building.behavior === "continuous") {
        const slots = Math.max(1, Number(building.slotsPerUnit || 1));
        for (let unit = 1; unit <= state.count; unit += 1) {
          for (let slot = 1; slot <= slots; slot += 1) {
            continuousJobs.push({
              id: `${building.id}:${unit}:${slot}`,
              buildingId: building.id,
              name: building.name,
              label: `${building.name} ${slots > 1 ? `${unit}.${slot}` : state.count > 1 ? `${unit}` : ""}`.trim(),
              role: buildingRole(building),
              personalityBonus: building.personalityBonus || null,
              allowedSpecies,
              requirements: building.requirements || [],
            });
          }
        }
      }

      if (building.behavior === "intermittent") {
        for (const pool of building.pools || []) {
          const poolActionSeconds = Number(pool.actionDurationSeconds || building.actionDurationSeconds || actionSeconds);
          const poolCycleSeconds =
            Number(pool.cycleDurationSeconds || building.cycleDurationSeconds || cycleSeconds) || cycleSeconds;
          const jobsPerUnit = Number(pool.jobsPerUnit || 1);
          const load = (state.count * jobsPerUnit * poolActionSeconds * overhead) / poolCycleSeconds;
          const key = `${building.id}:${pool.skill}`;

          intermittentByKey.set(key, {
            id: key,
            kind: "farm",
            buildingId: building.id,
            buildingName: building.name,
            skill: pool.skill,
            label: `${building.name} ${pool.label || pool.skill}`,
            load: (intermittentByKey.get(key)?.load || 0) + load,
          });
        }
      }
    }

    return {
      continuousJobs,
      intermittentTasks: [...intermittentByKey.values()].filter((task) => task.load > 0.0001),
      inactiveBuildings,
    };
  }

  // Buildings some families only can work (e.g. the Dewy House: Fragrancier or Dewy). Any form counts.
  function speciesAllowed(worker, job) {
    const allowed = job?.allowedSpecies;
    if (!Array.isArray(allowed) || !allowed.length) return true;
    return allowed.includes(worker?.species || worker?.name);
  }

  function workerCanDoJob(worker, job) {
    if (!speciesAllowed(worker, job)) return false;
    return (job.requirements || []).some((requirement) => {
      return Number(worker.skills?.[requirement.skill] || 0) >= Number(requirement.minLevel || 1);
    });
  }

  function jobMatchLevel(worker, job) {
    let best = 0;
    for (const requirement of job.requirements || []) {
      best = Math.max(best, Number(worker.skills?.[requirement.skill] || 0));
    }
    return best;
  }

  function assignContinuous(selectedWorkers, continuousJobs) {
    if (!continuousJobs.length) {
      return { ok: true, assignments: [], busyWorkerIds: new Set(), unfilled: [] };
    }

    const specialisation = new Map(
      selectedWorkers.map((worker) => [worker.workerId, countMatchingContinuousSkills(worker, continuousJobs)])
    );
    const power = new Map(selectedWorkers.map((worker) => [worker.workerId, totalSkillPower(worker, DEFAULT_SKILLS)]));
    const jobs = continuousJobs
      .map((job) => ({
        job,
        candidates: selectedWorkers
          .filter((worker) => workerCanDoJob(worker, job))
          .sort((a, b) => {
            return (
              specialisation.get(a.workerId) - specialisation.get(b.workerId) ||
              jobMatchLevel(a, job) - jobMatchLevel(b, job) ||
              power.get(a.workerId) - power.get(b.workerId) ||
              a.workerId.localeCompare(b.workerId)
            );
          }),
      }))
      .sort((a, b) => a.candidates.length - b.candidates.length || a.job.label.localeCompare(b.job.label));

    if (jobs.some((job) => job.candidates.length === 0)) {
      return {
        ok: false,
        assignments: [],
        busyWorkerIds: new Set(),
        unfilled: jobs.filter((job) => job.candidates.length === 0).map((job) => job.job),
      };
    }

    // Maximum bipartite matching (augmenting paths). Jobs with the fewest options go first and each job
    // tries its preferred Aniimo first (the most specialised, lowest-level one that fits), so the
    // matching keeps versatile Aniimo free where it can, and it always finds a full assignment if one
    // exists.
    const jobByWorker = new Map();
    const workerByJob = new Map();
    function augment(jobIndex, visited) {
      for (const worker of jobs[jobIndex].candidates) {
        if (visited.has(worker.workerId)) continue;
        visited.add(worker.workerId);
        const holder = jobByWorker.get(worker.workerId);
        if (holder === undefined || augment(holder, visited)) {
          jobByWorker.set(worker.workerId, jobIndex);
          workerByJob.set(jobIndex, worker);
          return true;
        }
      }
      return false;
    }
    let matched = 0;
    for (let index = 0; index < jobs.length; index += 1) {
      if (augment(index, new Set())) matched += 1;
    }
    const assignments = new Map();
    for (const [jobIndex, worker] of workerByJob) {
      const { job } = jobs[jobIndex];
      assignments.set(job.id, { job, worker });
    }

    const ok = matched === jobs.length;
    if (!ok) {
      return {
        ok: false,
        assignments: [...assignments.values()],
        busyWorkerIds: new Set([...assignments.values()].map((assignment) => assignment.worker.workerId)),
        unfilled: continuousJobs.filter((job) => !assignments.has(job.id)),
      };
    }

    return {
      ok: true,
      assignments: [...assignments.values()].sort((a, b) => a.job.label.localeCompare(b.job.label)),
      busyWorkerIds: new Set([...assignments.values()].map((assignment) => assignment.worker.workerId)),
      unfilled: [],
    };
  }

  function countMatchingContinuousSkills(worker, jobs) {
    const matchedSkills = new Set();
    for (const job of jobs) {
      for (const requirement of job.requirements || []) {
        if (Number(worker.skills?.[requirement.skill] || 0) >= Number(requirement.minLevel || 1)) {
          matchedSkills.add(requirement.skill);
        }
      }
    }
    return matchedSkills.size;
  }

  function splitIntermittentTasks(tasks, maxLoad) {
    const chunks = [];
    for (const task of tasks) {
      let remaining = task.load;
      let part = 1;
      const size = task.kind === "processor" ? Math.min(PROCESSOR_CHUNK, WORKER_DAY) : maxLoad;
      while (remaining > 0.0001) {
        const load = Math.min(size, remaining);
        chunks.push({
          ...task,
          chunkId: `${task.id}:${part}`,
          part,
          load,
        });
        remaining -= load;
        part += 1;
      }
    }
    return chunks;
  }

  function assignIntermittent(selectedWorkers, intermittentTasks, busyWorkerIds, settings) {
    if (!intermittentTasks.length) {
      return { ok: true, assignments: [], unfilled: [], workerLoads: new Map() };
    }

    const maxLoad = farmCapOf(settings);
    const allowMultiSkill = settings.allowIntermittentMultiSkill !== false;
    const available = selectedWorkers.filter((worker) => !busyWorkerIds.has(worker.workerId));
    // Part-time work can be split freely between Aniimo, so it is a flow problem: exact and fast. Only the
    // "one farm ability per helper" setting needs the step-by-step search below.
    if (allowMultiSkill) return assignPartTimeFlow(available, intermittentTasks, maxLoad);
    const chunks = splitIntermittentTasks(intermittentTasks, maxLoad)
      .map((chunk) => ({
        ...chunk,
        candidates: available.filter(
          (worker) => speciesAllowed(worker, chunk) && Number(worker.skills?.[chunk.skill] || 0) >= Math.max(1, Number(chunk.minLevel || 1))
        ),
      }))
      .sort((a, b) => a.candidates.length - b.candidates.length || b.load - a.load || a.label.localeCompare(b.label));

    if (chunks.some((chunk) => chunk.candidates.length === 0)) {
      return {
        ok: false,
        assignments: [],
        unfilled: chunks.filter((chunk) => chunk.candidates.length === 0),
        workerLoads: new Map(),
      };
    }

    const loadState = new Map();
    for (const worker of available) {
      loadState.set(worker.workerId, { worker, total: 0, farm: 0, skills: new Set(), farmSkills: new Set(), chunks: [] });
    }

    let explored = 0;
    const maxStates = 120000;

    // A worker's farm steps stay within the farm-helper cap; processor work can fill the rest of the day.
    function canTake(workerState, chunk) {
      if (workerState.total + chunk.load > WORKER_DAY + 0.000001) return false;
      if (chunk.kind === "processor") return true;
      if (workerState.farm + chunk.load > maxLoad + 0.000001) return false;
      if (!allowMultiSkill && workerState.farmSkills.size > 0 && !workerState.farmSkills.has(chunk.skill)) return false;
      return true;
    }

    function backtrack(index) {
      explored += 1;
      if (explored > maxStates) return false;
      if (index >= chunks.length) return true;

      const chunk = chunks[index];
      const candidates = chunk.candidates
        .slice()
        .sort((a, b) => {
          const aState = loadState.get(a.workerId);
          const bState = loadState.get(b.workerId);
          return (
            b.skills[chunk.skill] - a.skills[chunk.skill] ||
            aState.total - bState.total ||
            a.workerId.localeCompare(b.workerId)
          );
        });

      for (const worker of candidates) {
        const workerState = loadState.get(worker.workerId);
        if (!canTake(workerState, chunk)) continue;

        const isFarm = chunk.kind !== "processor";
        workerState.total += chunk.load;
        if (isFarm) workerState.farm += chunk.load;
        workerState.skills.add(chunk.skill);
        if (isFarm) workerState.farmSkills.add(chunk.skill);
        workerState.chunks.push(chunk);

        if (backtrack(index + 1)) return true;

        workerState.total -= chunk.load;
        if (isFarm) workerState.farm -= chunk.load;
        workerState.chunks.pop();
        workerState.skills = new Set(workerState.chunks.map((item) => item.skill));
        workerState.farmSkills = new Set(workerState.chunks.filter((item) => item.kind !== "processor").map((item) => item.skill));
      }

      return false;
    }

    const ok = backtrack(0);
    if (!ok) {
      return {
        ok: false,
        assignments: summarizeIntermittent(loadState),
        unfilled: chunks,
        workerLoads: loadState,
      };
    }

    return {
      ok: true,
      assignments: summarizeIntermittent(loadState),
      unfilled: [],
      workerLoads: loadState,
    };
  }

  // Max flow: source -> task (its load) -> Aniimo with the ability -> sink (one day each). Farm steps pass
  // through a per-Aniimo farm node capped at the farm-helper limit; processor work goes straight to the
  // Aniimo, so processing can fill the rest of the day.
  function assignPartTimeFlow(available, tasks, farmCap, valueOnly = false) {
    const EPS = 1e-9;
    const graph = [];
    const addNode = () => graph.push([]) - 1;
    const addEdge = (from, to, cap) => {
      const forward = { to, cap, flow: 0, rev: null };
      const backward = { to: from, cap: 0, flow: 0, rev: forward };
      forward.rev = backward;
      graph[from].push(forward);
      graph[to].push(backward);
      return forward;
    };
    const source = addNode();
    const sink = addNode();
    const taskNodes = tasks.map((task) => {
      const node = addNode();
      addEdge(source, node, task.load);
      return node;
    });
    const workerNodes = available.map(() => {
      const main = addNode();
      const farm = addNode();
      addEdge(farm, main, farmCap);
      addEdge(main, sink, WORKER_DAY);
      return { main, farm };
    });
    const links = [];
    tasks.forEach((task, taskIndex) => {
      const minLevel = Math.max(1, Number(task.minLevel || 1));
      const order = available
        .map((worker, workerIndex) => ({ worker, workerIndex, level: Number(worker.skills?.[task.skill] || 0) }))
        .filter((item) => item.level >= minLevel && speciesAllowed(item.worker, task))
        .sort((a, b) => b.level - a.level || a.worker.workerId.localeCompare(b.worker.workerId));
      for (const item of order) {
        const nodes = workerNodes[item.workerIndex];
        const edge = addEdge(taskNodes[taskIndex], task.kind === "processor" ? nodes.main : nodes.farm, task.load);
        links.push({ edge, task, workerIndex: item.workerIndex });
      }
    });

    // Dinic's algorithm.
    const level = new Array(graph.length);
    const iter = new Array(graph.length);
    function bfs() {
      level.fill(-1);
      level[source] = 0;
      const queue = [source];
      for (let head = 0; head < queue.length; head += 1) {
        const node = queue[head];
        for (const edge of graph[node]) {
          if (edge.cap - edge.flow > EPS && level[edge.to] < 0) {
            level[edge.to] = level[node] + 1;
            queue.push(edge.to);
          }
        }
      }
      return level[sink] >= 0;
    }
    function dfs(node, pushed) {
      if (node === sink) return pushed;
      for (; iter[node] < graph[node].length; iter[node] += 1) {
        const edge = graph[node][iter[node]];
        const room = edge.cap - edge.flow;
        if (room <= EPS || level[edge.to] !== level[node] + 1) continue;
        const sent = dfs(edge.to, Math.min(pushed, room));
        if (sent > EPS) {
          edge.flow += sent;
          edge.rev.flow -= sent;
          return sent;
        }
      }
      return 0;
    }
    const total = tasks.reduce((sum, task) => sum + task.load, 0);
    let flow = 0;
    while (flow < total - 1e-7 && bfs()) {
      iter.fill(0);
      let sent;
      while ((sent = dfs(source, Infinity)) > EPS) flow += sent;
    }
    if (valueOnly) return { ok: flow >= total - 1e-6, flow, total };

    const loadState = new Map();
    for (const worker of available) {
      loadState.set(worker.workerId, { worker, total: 0, farm: 0, skills: new Set(), farmSkills: new Set(), chunks: [] });
    }
    const placed = new Map();
    for (const link of links) {
      const amount = link.edge.flow;
      if (amount <= 1e-7) continue;
      const state = loadState.get(available[link.workerIndex].workerId);
      state.total += amount;
      if (link.task.kind !== "processor") {
        state.farm += amount;
        state.farmSkills.add(link.task.skill);
      }
      state.skills.add(link.task.skill);
      state.chunks.push({ ...link.task, chunkId: `${link.task.id}:${link.workerIndex}`, load: amount });
      placed.set(link.task.id, (placed.get(link.task.id) || 0) + amount);
    }
    const unfilled = tasks
      .filter((task) => (placed.get(task.id) || 0) < task.load - 1e-6)
      .map((task) => ({ ...task, chunkId: `${task.id}:short`, load: task.load - (placed.get(task.id) || 0) }));
    return {
      ok: unfilled.length === 0,
      assignments: summarizeIntermittent(loadState),
      unfilled,
      workerLoads: loadState,
    };
  }

  // The same part-time network as assignPartTimeFlow, but among all ways to cover the work it picks the one
  // that gives each piece of work to the Aniimo with the highest level in that ability (min-cost max flow,
  // cost = -level per share of a day). Only used to polish a team that is already known to cover the work.
  function assignPartTimeBest(available, tasks, farmCap) {
    const EPS = 1e-9;
    const graph = [];
    const addNode = () => graph.push([]) - 1;
    const addEdge = (from, to, cap, cost) => {
      const forward = { to, cap, cost, flow: 0, rev: null };
      const backward = { to: from, cap: 0, cost: -cost, flow: 0, rev: forward };
      forward.rev = backward;
      graph[from].push(forward);
      graph[to].push(backward);
      return forward;
    };
    const source = addNode();
    const sink = addNode();
    const taskNodes = tasks.map((task) => {
      const node = addNode();
      addEdge(source, node, task.load, 0);
      return node;
    });
    const workerNodes = available.map(() => {
      const main = addNode();
      const farm = addNode();
      addEdge(farm, main, farmCap, 0);
      addEdge(main, sink, WORKER_DAY, 0);
      return { main, farm };
    });
    const links = [];
    tasks.forEach((task, taskIndex) => {
      const minLevel = Math.max(1, Number(task.minLevel || 1));
      available.forEach((worker, workerIndex) => {
        const level = Number(worker.skills?.[task.skill] || 0);
        if (level < minLevel || !speciesAllowed(worker, task)) return;
        const nodes = workerNodes[workerIndex];
        const edge = addEdge(taskNodes[taskIndex], task.kind === "processor" ? nodes.main : nodes.farm, task.load, -level);
        links.push({ edge, task, workerIndex });
      });
    });

    const total = tasks.reduce((sum, task) => sum + task.load, 0);
    let flow = 0;
    // Successive shortest paths (Bellman-Ford: costs are negative).
    for (let guard = 0; guard < 5000 && flow < total - 1e-7; guard += 1) {
      const dist = new Array(graph.length).fill(Infinity);
      const prevEdge = new Array(graph.length).fill(null);
      const inQueue = new Array(graph.length).fill(false);
      dist[source] = 0;
      const queue = [source];
      inQueue[source] = true;
      let relaxations = 0;
      while (queue.length && relaxations < 200000) {
        const node = queue.shift();
        inQueue[node] = false;
        for (const edge of graph[node]) {
          if (edge.cap - edge.flow <= EPS) continue;
          const next = dist[node] + edge.cost;
          if (next < dist[edge.to] - 1e-12) {
            relaxations += 1;
            dist[edge.to] = next;
            prevEdge[edge.to] = edge;
            if (!inQueue[edge.to]) {
              inQueue[edge.to] = true;
              queue.push(edge.to);
            }
          }
        }
      }
      if (dist[sink] === Infinity) break;
      let pushed = Infinity;
      for (let node = sink; node !== source; node = prevEdge[node].rev.to) {
        const edge = prevEdge[node];
        pushed = Math.min(pushed, edge.cap - edge.flow);
      }
      if (!(pushed > EPS)) break;
      for (let node = sink; node !== source; node = prevEdge[node].rev.to) {
        const edge = prevEdge[node];
        edge.flow += pushed;
        edge.rev.flow -= pushed;
      }
      flow += pushed;
    }
    if (flow < total - 1e-6) return null;

    const loadState = new Map();
    for (const worker of available) {
      loadState.set(worker.workerId, { worker, total: 0, farm: 0, skills: new Set(), farmSkills: new Set(), chunks: [] });
    }
    for (const link of links) {
      const amount = link.edge.flow;
      if (amount <= 1e-7) continue;
      const state = loadState.get(available[link.workerIndex].workerId);
      state.total += amount;
      if (link.task.kind !== "processor") {
        state.farm += amount;
        state.farmSkills.add(link.task.skill);
      }
      state.skills.add(link.task.skill);
      state.chunks.push({ ...link.task, chunkId: `${link.task.id}:${link.workerIndex}`, load: amount });
    }
    return { ok: true, assignments: summarizeIntermittent(loadState), unfilled: [], workerLoads: loadState };
  }

  function summarizeIntermittent(loadState) {
    const assignments = [];
    for (const state of loadState.values()) {
      if (!state.chunks.length) continue;
      const bySkill = new Map();
      for (const chunk of state.chunks) {
        const key = `${chunk.buildingId}:${chunk.skill}`;
        const current = bySkill.get(key) || {
          kind: chunk.kind || "farm",
          buildingId: chunk.buildingId,
          buildingName: chunk.buildingName,
          skill: chunk.skill,
          label: chunk.label,
          personalityBonus: chunk.personalityBonus || null,
          load: 0,
        };
        current.load += chunk.load;
        bySkill.set(key, current);
      }

      assignments.push({
        worker: state.worker,
        totalLoad: state.total,
        tasks: [...bySkill.values()].sort((a, b) => a.label.localeCompare(b.label)),
      });
    }

    return assignments.sort((a, b) => displayWorkerName(a.worker).localeCompare(displayWorkerName(b.worker)));
  }

  function addSkills(base, worker, skills) {
    const next = { ...base };
    for (const skill of skills) {
      next[skill] += Number(worker.skills?.[skill] || 0);
    }
    return next;
  }

  function computeSkillCoverage(totals, requirements, skills) {
    return skills.map((skill) => {
      const required = Number(requirements?.[skill] || 0);
      const available = Number(totals?.[skill] || 0);
      return {
        skill,
        required,
        available,
        status: available >= required ? "OK" : "Missing",
        missing: Math.max(0, required - available),
        surplus: Math.max(0, available - required),
      };
    });
  }

  function skillTargetsMet(totals, requirements, skills) {
    return skills.every((skill) => Number(totals?.[skill] || 0) >= Number(requirements?.[skill] || 0));
  }

  function relevantSkillSet(requirements, model) {
    const relevant = new Set();
    for (const [skill, required] of Object.entries(requirements || {})) {
      if (Number(required) > 0) relevant.add(skill);
    }
    for (const job of model.continuousJobs) {
      for (const requirement of job.requirements || []) relevant.add(requirement.skill);
    }
    for (const task of model.intermittentTasks) relevant.add(task.skill);
    return relevant;
  }

  function scoreCandidate(worker, relevantSkills, model, requirements) {
    let score = 0;
    let matched = 0;
    for (const skill of relevantSkills) {
      const level = Number(worker.skills?.[skill] || 0);
      if (!level) continue;
      matched += 1;
      score += Math.min(level, Math.max(1, Number(requirements?.[skill] || 0))) * 8;
    }

    for (const job of model.continuousJobs) {
      if (workerCanDoJob(worker, job)) score += 12;
    }

    for (const task of model.intermittentTasks) {
      if (Number(worker.skills?.[task.skill] || 0) > 0) score += 8;
    }

    if (matched > 1) score += matched * 4;
    return score;
  }

  function sortAndFilterCandidates(workers, relevantSkills, model, requirements) {
    return workers
      .map((worker) => ({
        worker,
        // Later copies of the same form are progressively less likely to be needed, so they rank
        // lower. This lets a strong form's second copy appear before a weak form's first copy.
        // Lower evolution stages rank a little lower than the final stage of their line.
        score:
          (scoreCandidate(worker, relevantSkills, model, requirements) / Math.max(1, Number(worker.copy || 1))) *
          (1 - 0.04 * Math.max(0, Number(worker.finalStage || 1) - Number(worker.stage || 1))),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        return (
          b.score - a.score ||
          b.worker.totalSkill - a.worker.totalSkill ||
          displayWorkerName(a.worker).localeCompare(displayWorkerName(b.worker)) ||
          a.worker.workerId.localeCompare(b.worker.workerId)
        );
      })
      .map((item) => item.worker);
  }

  function orderCopies(candidates) {
    const copiesByForm = new Map();
    for (const worker of candidates) {
      const list = copiesByForm.get(worker.aniimoId) || [];
      list.push(worker);
      copiesByForm.set(worker.aniimoId, list);
    }
    for (const list of copiesByForm.values()) list.sort((a, b) => a.copy - b.copy);
    const cursor = new Map();
    return candidates.map((worker) => {
      const index = cursor.get(worker.aniimoId) || 0;
      cursor.set(worker.aniimoId, index + 1);
      return copiesByForm.get(worker.aniimoId)[index];
    });
  }

  // Precomputed per-candidate vectors so each search state can be scored from running counters instead
  // of re-scanning every selected Aniimo against every job.
  function buildSearchContext(candidates, requirements, skills, model, settings) {
    const groups = continuousJobGroups(model);
    // Part-time work (farm steps and processors) is counted per ability: how many Aniimo with it are
    // needed to share that ability's work.
    // Aniimo in single-ability full-time jobs can't also do part-time work, so an ability's holders must
    // cover both.
    const tasks = [...partTimeNeedBySkill(model, settings)].map(([skill, need]) => {
      let fullTime = 0;
      for (const group of groups) {
        const requirements = group.job.requirements || [];
        if (requirements.length === 1 && requirements[0].skill === skill) fullTime += group.count;
      }
      return { skill, need: need + fullTime };
    });
    const partTimeTotal = Math.ceil(model.intermittentTasks.reduce((sum, task) => sum + task.load, 0) / WORKER_DAY - 0.000001);
    const jobSkillSet = new Set();
    for (const group of groups) for (const requirement of group.job.requirements || []) jobSkillSet.add(requirement.skill);
    for (const task of tasks) jobSkillSet.add(task.skill);
    const jobSkills = [...jobSkillSet].sort();
    const neededBySkill = jobSkills.map(
      (skill) =>
        groups
          .filter((group) => (group.job.requirements || []).some((requirement) => requirement.skill === skill))
          .reduce((sum, group) => sum + group.count, 0) +
        tasks.filter((task) => task.skill === skill).reduce((sum, task) => sum + task.need, 0)
    );
    return {
      skills,
      weights: settings.maxTeamSize ? CAPPED_WEIGHTS : DEFAULT_WEIGHTS,
      required: skills.map((skill) => Number(requirements?.[skill] || 0)),
      groups,
      tasks,
      jobSkills,
      neededBySkill,
      continuousCount: model.continuousJobs.length,
      partTimeTotal,
      vectors: candidates.map((worker) => {
        const group = groups.map((item) => (workerCanDoJob(worker, item.job) ? 1 : 0));
        const task = tasks.map((item) => (Number(worker.skills?.[item.skill] || 0) > 0 ? 1 : 0));
        const levels = skills.map((skill) => Number(worker.skills?.[skill] || 0));
        return {
          group,
          task,
          hold: jobSkills.map((skill) => (Number(worker.skills?.[skill] || 0) > 0 ? 1 : 0)),
          // Sparse copies for quick child scoring.
          skillIdx: levels.map((level, index) => (level > 0 ? index : -1)).filter((index) => index >= 0),
          levels,
          groupIdx: group.map((value, index) => (value ? index : -1)).filter((index) => index >= 0),
          taskIdx: task.map((value, index) => (value ? index : -1)).filter((index) => index >= 0),
          skillMask: levels.reduce((mask, level, index) => (level > 0 ? mask | (1 << index) : mask), 0),
        };
      }),
    };
  }

  // How much each shortfall costs a search state. Normally missing requirement points weigh most. With a
  // team-size cap (the "best plan that fits" search) keeping buildings and farm steps staffed comes first,
  // and requirement points are filled with whatever spaces are left.
  const DEFAULT_WEIGHTS = { deficit: 1000, continuous: 700, intermittent: 500, surplus: 9 };
  const CAPPED_WEIGHTS = { deficit: 1000, continuous: 100000, intermittent: 60000, surplus: 9 };

  // Score parts of a state: requirement deficit/surplus, summed job-group shortage and farm shortage.
  function scoreParts(state, context) {
    let deficit = 0;
    let surplus = 0;
    context.skills.forEach((skill, index) => {
      const available = Number(state.totals?.[skill] || 0);
      deficit += Math.max(0, context.required[index] - available);
      surplus += Math.max(0, available - context.required[index]);
    });
    let groupShort = 0;
    context.groups.forEach((group, index) => {
      groupShort += Math.max(0, group.count - state.counters.groupCompat[index]);
    });
    let intermittent = 0;
    context.tasks.forEach((task, index) => {
      intermittent += Math.max(0, task.need - state.counters.taskCompat[index]);
    });
    return { deficit, surplus, groupShort, intermittent };
  }

  function combineScore(parts, size, context) {
    const continuous = Math.max(parts.groupShort, context.continuousCount - size);
    const weights = context.weights;
    return (
      parts.deficit * weights.deficit +
      continuous * weights.continuous +
      parts.intermittent * weights.intermittent +
      parts.surplus * weights.surplus
    );
  }

  // Score of the state plus candidate `index`, computed from the parent's parts without building it.
  function childParts(state, index, context) {
    const vector = context.vectors[index];
    let { deficit, surplus, groupShort, intermittent } = state.parts;
    for (const skillIndex of vector.skillIdx) {
      const skill = context.skills[skillIndex];
      const before = Number(state.totals[skill] || 0);
      const after = before + vector.levels[skillIndex];
      const required = context.required[skillIndex];
      deficit += Math.max(0, required - after) - Math.max(0, required - before);
      surplus += Math.max(0, after - required) - Math.max(0, before - required);
    }
    for (const groupIndex of vector.groupIdx) {
      if (state.counters.groupCompat[groupIndex] < context.groups[groupIndex].count) groupShort -= 1;
    }
    for (const taskIndex of vector.taskIdx) {
      if (state.counters.taskCompat[taskIndex] < context.tasks[taskIndex].need) intermittent -= 1;
    }
    return { deficit, surplus, groupShort, intermittent };
  }

  // Bit mask of the abilities that would help (see unmetNeedSkills); 0 means anything may be tried.
  function unmetNeedMask(state, context) {
    const need = unmetNeedSkills(state, context);
    if (!need) return 0;
    return need.reduce((mask, skill) => {
      const index = context.skills.indexOf(skill);
      return index >= 0 ? mask | (1 << index) : mask;
    }, 0);
  }

  function emptyCounters(context) {
    return {
      groupCompat: context.groups.map(() => 0),
      taskCompat: context.tasks.map(() => 0),
      holds: context.jobSkills.map(() => 0),
    };
  }

  function addCounters(counters, vector) {
    return {
      groupCompat: counters.groupCompat.map((value, index) => value + vector.group[index]),
      taskCompat: counters.taskCompat.map((value, index) => value + vector.task[index]),
      holds: counters.holds.map((value, index) => value + vector.hold[index]),
    };
  }

  // Shortfalls a state still has: full-time job groups without enough Aniimo (each job needs its own
  // Aniimo, so five Mines need five Earth Aniimo, not one) and farm tasks without enough helpers.
  function stateShortage(state, context) {
    let continuous = 0;
    context.groups.forEach((group, index) => {
      continuous += Math.max(0, group.count - state.counters.groupCompat[index]);
    });
    continuous = Math.max(continuous, context.continuousCount - state.indices.length);
    let intermittent = 0;
    context.tasks.forEach((task, index) => {
      intermittent += Math.max(0, task.need - state.counters.taskCompat[index]);
    });
    // Enough Aniimo outside the full-time jobs for all part-time work.
    intermittent = Math.max(intermittent, context.partTimeTotal - (state.indices.length - context.continuousCount));
    return { continuous, intermittent };
  }

  function approximateStateScore(state, context) {
    let deficit = 0;
    let surplus = 0;
    context.skills.forEach((skill, index) => {
      const available = Number(state.totals?.[skill] || 0);
      deficit += Math.max(0, context.required[index] - available);
      surplus += Math.max(0, available - context.required[index]);
    });
    const shortage = stateShortage(state, context);
    const weights = context.weights;
    return (
      deficit * weights.deficit +
      shortage.continuous * weights.continuous +
      shortage.intermittent * weights.intermittent +
      surplus * weights.surplus
    );
  }

  // Abilities that would help a state still short of something: requirement points not yet reached,
  // full-time job groups without enough Aniimo, and farm tasks without enough helpers. Returns null when
  // nothing is obviously short (then any Aniimo may be tried, e.g. to satisfy the exact assignment).
  function unmetNeedSkills(state, context) {
    const need = new Set();
    context.skills.forEach((skill, index) => {
      if (Number(state.totals?.[skill] || 0) < context.required[index]) need.add(skill);
    });
    context.groups.forEach((group, index) => {
      if (state.counters.groupCompat[index] < group.count) {
        for (const requirement of group.job.requirements || []) need.add(requirement.skill);
      }
    });
    context.tasks.forEach((task, index) => {
      if (state.counters.taskCompat[index] < task.need) need.add(task.skill);
    });
    return need.size ? [...need] : null;
  }

  // Full-time jobs grouped by identical requirements (cached on the model).
  function continuousJobGroups(model) {
    if (model._jobGroups) return model._jobGroups;
    const groups = new Map();
    for (const job of model.continuousJobs) {
      const key =
        (job.requirements || [])
          .map((requirement) => `${requirement.skill}:${Number(requirement.minLevel || 1)}`)
          .sort()
          .join("|") + (job.allowedSpecies ? `|only:${job.allowedSpecies.join(",")}` : "");
      const group = groups.get(key) || { job, count: 0 };
      group.count += 1;
      groups.set(key, group);
    }
    Object.defineProperty(model, "_jobGroups", { value: [...groups.values()], enumerable: false });
    return model._jobGroups;
  }

  // The search only looks at a limited list of candidates. Taking just the top scorers can leave out
  // every Aniimo with a rarely needed ability (e.g. Light), so first reserve enough of the best holders
  // of each needed ability, then fill the rest of the list by score.
  function pickCandidates(sorted, relevantSkills, model, requirements, settings, limit) {
    if (sorted.length <= limit) return sorted;
    const partTime = partTimeNeedBySkill(model, settings);
    const chosen = new Set();
    for (const skill of relevantSkills) {
      let bodies = 0;
      for (const job of model.continuousJobs) {
        if ((job.requirements || []).some((requirement) => requirement.skill === skill)) bodies += 1;
      }
      bodies += partTime.get(skill) || 0;
      const holders = sorted.filter((worker) => Number(worker.skills?.[skill] || 0) > 0);
      let points = 0;
      let taken = 0;
      for (const worker of holders) {
        // Enough holders for the jobs and the requirement points, plus a few alternatives.
        if (taken >= bodies + 3 && points >= Number(requirements?.[skill] || 0) + 3) break;
        chosen.add(worker);
        taken += 1;
        points += Number(worker.skills[skill] || 0);
      }
    }
    // Buildings only some families can work: keep enough of those Aniimo too.
    for (const group of continuousJobGroups(model)) {
      if (!group.job.allowedSpecies) continue;
      const eligible = sorted.filter((worker) => workerCanDoJob(worker, group.job));
      eligible.slice(0, group.count + 2).forEach((worker) => chosen.add(worker));
    }
    for (const worker of sorted) {
      if (chosen.size >= limit) break;
      chosen.add(worker);
    }
    // Keep score order; a copy is only useful if the earlier copies are also in the list.
    const kept = sorted.filter((worker) => chosen.has(worker));
    const keptIds = new Set(kept.map((worker) => worker.workerId));
    return kept.filter((worker) => worker.copy <= 1 || keptIds.has(`${worker.aniimoId}#${worker.copy - 1}`));
  }

  // States with the same (capped) ability totals and the same number of holders per job ability are
  // treated as equivalent, which also removes the same set reached in a different order.
  function stateKey(state, context) {
    const skillPart = context.skills
      .map((skill, index) => Math.min(Number(state.totals?.[skill] || 0), context.required[index] + 4))
      .join(",");
    const countPart = state.counters.holds
      .map((count, index) => Math.min(count, context.neededBySkill[index] + 2))
      .join(",");
    return `${skillPart}|${countPart}|${state.indices.length}`;
  }

  // fixedContinuous: an assignment of the full-time jobs to keep (used when extending a plan).
  function validateSelection(state, candidates, requirements, skills, model, settings, fixedContinuous = null) {
    const selectedWorkers = state.indices.map((index) => candidates[index]);
    const skillCoverage = computeSkillCoverage(state.totals, requirements, skills);
    const targetsOk = skillTargetsMet(state.totals, requirements, skills);
    const continuous = fixedContinuous || assignContinuous(selectedWorkers, model.continuousJobs);
    // Even when a full-time job is left without an Aniimo, the farm steps are still checked with the
    // Aniimo that are left, so the report shows which farm steps are really short.
    const intermittent = assignIntermittent(selectedWorkers, model.intermittentTasks, continuous.busyWorkerIds, settings);

    return {
      ok: targetsOk && continuous.ok && intermittent.ok,
      selectedWorkers,
      skillCoverage,
      continuous,
      intermittent,
      missing: buildMissing(skillCoverage, continuous, intermittent),
    };
  }

  function buildMissing(skillCoverage, continuous, intermittent) {
    const missing = [];
    for (const row of skillCoverage) {
      if (row.missing > 0) {
        missing.push(`${row.skill}: ${row.missing} more ability point${row.missing === 1 ? "" : "s"} needed`);
      }
    }
    for (const job of continuous.unfilled || []) {
      const skills = (job.requirements || []).map((requirement) => requirement.skill).join("/");
      missing.push(`${job.label}: needs 1 more Aniimo with ${skills}`);
    }
    for (const task of intermittent.unfilled || []) {
      missing.push(`${task.label}: not enough ${task.skill} helpers to keep up`);
    }
    return missing;
  }

  function solutionSort(a, b, skills) {
    const wasteA = a.skillCoverage.reduce((sum, row) => sum + row.surplus, 0);
    const wasteB = b.skillCoverage.reduce((sum, row) => sum + row.surplus, 0);
    const powerA = a.selectedWorkers.reduce((sum, worker) => sum + totalSkillPower(worker, skills), 0);
    const powerB = b.selectedWorkers.reduce((sum, worker) => sum + totalSkillPower(worker, skills), 0);
    return wasteA - wasteB || powerB - powerA;
  }

  function formatPercent(value) {
    return `${Math.round(value * 100)}%`;
  }

  function decorateSelectedWorkers(result, requirements, skills) {
    const continuousByWorker = new Map();
    for (const assignment of result.continuous.assignments || []) {
      continuousByWorker.set(assignment.worker.workerId, assignment.job);
    }

    const intermittentByWorker = new Map();
    for (const assignment of result.intermittent.assignments || []) {
      intermittentByWorker.set(assignment.worker.workerId, assignment);
    }

    return result.selectedWorkers.map((worker) => {
      const continuousJob = continuousByWorker.get(worker.workerId);
      const intermittent = intermittentByWorker.get(worker.workerId);
      const contributingSkills = skills
        .filter((skill) => Number(requirements?.[skill] || 0) > 0 && Number(worker.skills?.[skill] || 0) > 0)
        .map((skill) => `${skill} ${worker.skills[skill]}`);

      let primaryAssignment = "Boosts your requirement totals";
      const secondaryAssignments = [];
      const partTimeTasks = intermittent ? intermittent.tasks : [];
      const doesProcessing = partTimeTasks.some((task) => task.kind === "processor");
      const doesFarm = partTimeTasks.some((task) => task.kind !== "processor");

      // Where this Aniimo works, one entry per building: a full-time building holds it all day (never
      // more than one); part-time work lists each building with its share of the day.
      const partTimeByBuilding = new Map();
      for (const task of partTimeTasks) {
        const entry = partTimeByBuilding.get(task.buildingId) || { buildingId: task.buildingId, name: task.buildingName, kind: task.kind || "farm", load: 0 };
        entry.load += task.load;
        partTimeByBuilding.set(task.buildingId, entry);
      }
      const partTime = [...partTimeByBuilding.values()].sort((a, b) => b.load - a.load || a.name.localeCompare(b.name));
      const buildingWord = (count) => `${count} building${count === 1 ? "" : "s"}`;
      if (continuousJob) {
        primaryAssignment = continuousJob.label;
      } else if (doesProcessing && doesFarm) {
        primaryAssignment = `Part-time: processors and farm steps (${buildingWord(partTime.length)})`;
      } else if (doesProcessing) {
        primaryAssignment = `Part-time processor worker (${buildingWord(partTime.length)})`;
      } else if (intermittent) {
        primaryAssignment = "Farm helper";
      }

      // Personalities are random on each Aniimo, and only speed up work at their matching building.
      const personalityTips = [];
      if (continuousJob?.personalityBonus) {
        personalityTips.push({ building: continuousJob.name, personality: continuousJob.personalityBonus, skill: (continuousJob.requirements || [])[0]?.skill || "" });
      }
      for (const task of partTimeTasks) {
        if (task.personalityBonus) personalityTips.push({ building: task.buildingName, personality: task.personalityBonus, skill: task.skill });
      }

      if (intermittent) {
        secondaryAssignments.push(
          ...partTimeTasks.map((task) => `${task.label} – ${formatPercent(task.load)} of the day`)
        );
      }

      const reasonParts = [];
      if (continuousJob) reasonParts.push(`works ${continuousJob.label} full time`);
      if (intermittent) {
        const what = doesProcessing && doesFarm ? "processing and farm jobs" : doesProcessing ? "processing" : "farm jobs";
        reasonParts.push(`busy about ${formatPercent(intermittent.totalLoad)} of the day on ${what}`);
      }
      if (contributingSkills.length) reasonParts.push(`adds ${contributingSkills.join(", ")}`);
      if (!reasonParts.length) reasonParts.push("needed to reach your requirement targets");

      return {
        ...worker,
        displayName: displayWorkerName(worker),
        primaryAssignment,
        secondaryAssignments,
        work: {
          fullTime: continuousJob ? { buildingId: continuousJob.buildingId, name: continuousJob.name, label: continuousJob.label } : null,
          partTime,
          partTimeLoad: intermittent ? intermittent.totalLoad : 0,
        },
        personalityTips,
        contributingSkills,
        reason: reasonParts.join("; "),
      };
    });
  }

  function summarizePhysicalStaffing(model, continuous, intermittent) {
    const rows = [];
    const continuousGroups = new Map();
    for (const job of model.continuousJobs) {
      const key = `${job.buildingId}:${(job.requirements || []).map((requirement) => requirement.skill).join("/")}`;
      const current = continuousGroups.get(key) || {
        label: job.name,
        buildingId: job.buildingId,
        need: 0,
        assigned: 0,
        type: "Continuous",
        kind: job.role || "primary",
        personalityBonus: job.personalityBonus || null,
      };
      current.need += 1;
      continuousGroups.set(key, current);
    }
    for (const assignment of continuous.assignments || []) {
      const job = assignment.job;
      const key = `${job.buildingId}:${(job.requirements || []).map((requirement) => requirement.skill).join("/")}`;
      const current = continuousGroups.get(key);
      if (current) current.assigned += 1;
    }
    for (const group of continuousGroups.values()) {
      rows.push({
        ...group,
        needLabel: `${group.need} Aniimo`,
        assignedLabel: `${group.assigned} Aniimo`,
        status: group.assigned >= group.need ? "OK" : "Missing",
      });
    }

    for (const task of model.intermittentTasks) {
      const assigned = (intermittent.assignments || []).reduce((sum, assignment) => {
        return (
          sum +
          assignment.tasks
            .filter((item) => item.buildingId === task.buildingId && item.skill === task.skill)
            .reduce((taskSum, item) => taskSum + item.load, 0)
        );
      }, 0);

      rows.push({
        label: task.kind === "processor" ? `${task.label} (${task.busyPercent}% busy)` : task.label,
        buildingId: task.buildingId,
        type: "Intermittent",
        kind: task.kind || "farm",
        personalityBonus: task.personalityBonus || null,
        need: task.load,
        assigned,
        needLabel: formatPercent(task.load),
        assignedLabel: formatPercent(assigned),
        status: assigned + 0.0001 >= task.load ? "OK" : "Missing",
      });
    }

    const kindOrder = (row) => (row.kind === "farm" ? 1 : 0);
    return rows.sort((a, b) => a.type.localeCompare(b.type) || kindOrder(a) - kindOrder(b) || a.label.localeCompare(b.label));
  }

  function buildPartialResult(state, candidates, allWorkers, requirements, skills, model, settings) {
    const result = validateSelection(state, candidates, requirements, skills, model, settings);
    return finalizeResult(false, result, state, candidates, allWorkers, requirements, skills, model, settings, {
      note: "No complete solution was found inside the current search limit.",
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Plan quality. The search finds the fewest Aniimo; among teams of that size this pass prefers stronger
  // ones. For each Aniimo in the plan it looks for any Aniimo in the pool (unlimited copies) that can do
  // exactly the same work – the same full-time building, or the same part-time shares – without dropping
  // any Estimated Require total below its target, and swaps it in when that is better on, in order:
  //   1. work quality: the level of the ability used at its full-time building, or the sum over its
  //      part-time work of share of the day × ability level;
  //   2. points towards the Estimated Require abilities (more headroom);
  //   3. how many of the plan's needed abilities it has;
  //   4. total ability points.
  // Part-time work is first handed to the highest-level Aniimo that can take it (min-cost flow). It repeats
  // until nothing improves. The team size and every assignment stay valid throughout.
  function workerQualityKey(worker, work, requirements, relevant, skills) {
    let workScore = 0;
    if (work.job) workScore += jobMatchLevel(worker, work.job);
    for (const task of work.tasks) workScore += task.load * Number(worker.skills?.[task.skill] || 0);
    let points = 0;
    let coverage = 0;
    for (const skill of skills) {
      const level = Number(worker.skills?.[skill] || 0);
      if (level <= 0) continue;
      if (Number(requirements?.[skill] || 0) > 0) points += level;
      if (relevant.has(skill)) coverage += 1;
    }
    return [workScore, points, coverage, totalSkillPower(worker, skills)];
  }

  function compareQualityKeys(a, b) {
    for (let index = 0; index < a.length; index += 1) {
      const difference = a[index] - b[index];
      if (Math.abs(difference) > 1e-9) return difference;
    }
    return 0;
  }

  function planWorkQuality(result, skills) {
    let score = 0;
    for (const assignment of result.continuous?.assignments || []) score += jobMatchLevel(assignment.worker, assignment.job);
    for (const assignment of result.intermittent?.assignments || []) {
      for (const task of assignment.tasks) score += task.load * Number(assignment.worker.skills?.[task.skill] || 0);
    }
    return score;
  }

  function improvePlanQuality(result, allWorkers, requirements, skills, model, settings) {
    if (isOwnedMode(settings) || !result.ok || !result.selectedWorkers.length) return result;
    const templates = new Map();
    for (const worker of allWorkers) {
      if (!templates.has(worker.aniimoId) || worker.copy < templates.get(worker.aniimoId).copy) templates.set(worker.aniimoId, worker);
    }
    const pool = [...templates.values()];
    const relevant = relevantSkillSet(requirements, model);
    const taskInfo = new Map(model.intermittentTasks.map((task) => [`${task.buildingId}:${task.skill}`, task]));
    const farmCap = farmCapOf(settings);

    let selected = result.selectedWorkers.slice();
    const jobOf = new Map((result.continuous.assignments || []).map((item) => [item.worker.workerId, item.job]));
    let intermittent = result.intermittent;
    let serial = 0;

    const totals = emptySkillMap(skills);
    for (const worker of selected) for (const skill of skills) totals[skill] += Number(worker.skills?.[skill] || 0);

    for (let round = 0; round < 6; round += 1) {
      let changed = false;
      // Hand part-time work to the highest-level Aniimo that can take it.
      if (model.intermittentTasks.length) {
        const free = selected.filter((worker) => !jobOf.has(worker.workerId));
        const best = assignPartTimeBest(free, model.intermittentTasks, farmCap);
        if (best) intermittent = best;
      }
      const tasksOf = new Map((intermittent.assignments || []).map((item) => [item.worker.workerId, item.tasks]));

      for (let slot = 0; slot < selected.length; slot += 1) {
        const current = selected[slot];
        const work = { job: jobOf.get(current.workerId) || null, tasks: tasksOf.get(current.workerId) || [] };
        const canDo = (worker) => {
          if (work.job && !workerCanDoJob(worker, work.job)) return false;
          for (const task of work.tasks) {
            const info = taskInfo.get(`${task.buildingId}:${task.skill}`) || task;
            if (Number(worker.skills?.[task.skill] || 0) < Math.max(1, Number(info.minLevel || 1))) return false;
            if (!speciesAllowed(worker, info)) return false;
          }
          // Never let an Estimated Require total fall below its target (or below where it already is).
          for (const skill of skills) {
            const after = totals[skill] - Number(current.skills?.[skill] || 0) + Number(worker.skills?.[skill] || 0);
            if (after < Math.min(Number(requirements?.[skill] || 0), totals[skill])) return false;
          }
          return true;
        };
        let bestKey = workerQualityKey(current, work, requirements, relevant, skills);
        let bestWorker = null;
        for (const candidate of pool) {
          if (candidate.aniimoId === current.aniimoId) continue;
          // A player only has one starter: never bring in a second.
          if (candidate.starter && selected.some((worker) => worker.aniimoId === candidate.aniimoId)) continue;
          const key = workerQualityKey(candidate, work, requirements, relevant, skills);
          if (compareQualityKeys(key, bestKey) <= 0) continue;
          if (!canDo(candidate)) continue;
          bestKey = key;
          bestWorker = candidate;
        }
        if (!bestWorker) continue;
        serial += 1;
        const replacement = { ...bestWorker, workerId: `${bestWorker.aniimoId}#swap${serial}`, copy: 1000 + serial };
        for (const skill of skills) {
          totals[skill] += Number(replacement.skills?.[skill] || 0) - Number(current.skills?.[skill] || 0);
        }
        selected[slot] = replacement;
        if (work.job) {
          jobOf.delete(current.workerId);
          jobOf.set(replacement.workerId, work.job);
        }
        intermittent = {
          ...intermittent,
          assignments: (intermittent.assignments || []).map((item) =>
            item.worker.workerId === current.workerId ? { ...item, worker: replacement } : item
          ),
        };
        tasksOf.set(replacement.workerId, work.tasks);
        changed = true;
      }
      if (!changed) break;
    }

    // Number copies of each form 1, 2, 3… in plan order.
    const copyCount = new Map();
    const renamed = new Map();
    selected = selected.map((worker) => {
      const copy = (copyCount.get(worker.aniimoId) || 0) + 1;
      copyCount.set(worker.aniimoId, copy);
      const next = { ...worker, workerId: `${worker.aniimoId}#${copy}`, copy };
      renamed.set(worker.workerId, next);
      return next;
    });
    const rename = (worker) => renamed.get(worker.workerId) || worker;
    const continuousAssignments = [];
    for (const [workerId, job] of jobOf) continuousAssignments.push({ job, worker: renamed.get(workerId) });
    continuousAssignments.sort((a, b) => a.job.label.localeCompare(b.job.label));
    const continuous = {
      ...result.continuous,
      assignments: continuousAssignments,
      busyWorkerIds: new Set(continuousAssignments.map((item) => item.worker.workerId)),
    };
    const newIntermittent = {
      ...intermittent,
      assignments: (intermittent.assignments || [])
        .map((item) => ({ ...item, worker: rename(item.worker) }))
        .sort((a, b) => displayWorkerName(a.worker).localeCompare(displayWorkerName(b.worker))),
      workerLoads: undefined,
    };
    const skillCoverage = computeSkillCoverage(totals, requirements, skills);
    return {
      ...result,
      ok: result.ok && skillTargetsMet(totals, requirements, skills),
      selectedWorkers: selected,
      skillCoverage,
      continuous,
      intermittent: newIntermittent,
      missing: buildMissing(skillCoverage, continuous, newIntermittent),
    };
  }

  // Personalities speed up work at one building each, so a part-time Aniimo is easiest to find a good
  // personality for when its work sits at buildings wanting the same one. Aniimo that do processor work
  // with the same ability at the same level are interchangeable there, so their shares of that work are
  // re-dealt: buildings grouped by personality (the most work first), each Aniimo filled in turn up to the
  // share it already had. Every Aniimo's day, every building's total and every farm step stay the same.
  function concentratePersonalities(intermittent) {
    const assignments = intermittent?.assignments || [];
    if (assignments.length < 2) return intermittent;
    const EPS = 1e-6;
    const next = assignments.map((item) => ({ ...item, tasks: item.tasks.slice() }));
    const bySkill = new Map();
    next.forEach((item, index) => {
      for (const task of item.tasks) {
        if (task.kind !== "processor") continue;
        const key = `${task.skill}|${Number(item.worker.skills?.[task.skill] || 0)}`;
        if (!bySkill.has(key)) bySkill.set(key, new Set());
        bySkill.get(key).add(index);
      }
    });
    for (const [key, indexSet] of bySkill) {
      const indices = [...indexSet];
      if (indices.length < 2) continue;
      const skill = key.split("|")[0];
      const isShared = (task) => task.kind === "processor" && task.skill === skill;
      const byBuilding = new Map();
      const capacity = new Map();
      for (const index of indices) {
        let load = 0;
        for (const task of next[index].tasks.filter(isShared)) {
          const entry = byBuilding.get(task.buildingId) || { template: task, load: 0 };
          entry.load += task.load;
          byBuilding.set(task.buildingId, entry);
          load += task.load;
        }
        capacity.set(index, load);
      }
      // Every Aniimo must be able to work every one of these buildings (family-only ones may not be shared).
      const entries = [...byBuilding.values()];
      if (!indices.every((index) => entries.every((entry) => speciesAllowed(next[index].worker, entry.template)))) continue;
      const personalityLoad = new Map();
      for (const entry of entries) {
        const name = entry.template.personalityBonus || "";
        personalityLoad.set(name, (personalityLoad.get(name) || 0) + entry.load);
      }
      entries.sort((a, b) => {
        const pa = a.template.personalityBonus || "";
        const pb = b.template.personalityBonus || "";
        if (pa !== pb) {
          if (!pa || !pb) return pa ? -1 : 1;
          return personalityLoad.get(pb) - personalityLoad.get(pa) || pa.localeCompare(pb);
        }
        return b.load - a.load || a.template.buildingName.localeCompare(b.template.buildingName);
      });
      const order = indices.slice().sort((a, b) => capacity.get(b) - capacity.get(a) || a - b);
      const dealt = new Map(order.map((index) => [index, []]));
      let cursor = 0;
      let left = entries.length ? entries[0].load : 0;
      for (const index of order) {
        let room = capacity.get(index);
        while (room > EPS && cursor < entries.length) {
          const take = Math.min(room, left);
          if (take > EPS) {
            const template = entries[cursor].template;
            dealt.get(index).push({ ...template, chunkId: `${template.id || `${template.buildingId}:${template.skill}`}:c${index}`, load: take });
          }
          room -= take;
          left -= take;
          if (left <= EPS) {
            cursor += 1;
            left = cursor < entries.length ? entries[cursor].load : 0;
          }
        }
      }
      for (const index of order) {
        next[index].tasks = next[index].tasks.filter((task) => !isShared(task)).concat(dealt.get(index));
      }
    }
    return { ...intermittent, assignments: next };
  }

  function finalizeResult(feasible, result, state, candidates, allWorkers, requirements, skills, model, settings, diagnostics) {
    // The team as the search left it, before the quality pass: a higher processor level is built from it
    // (the search's team shares part-time work more flexibly, so it needs no more Aniimo).
    const searchTeam = result.selectedWorkers.slice();
    if (feasible && result.ok) result = improvePlanQuality(result, allWorkers, requirements, skills, model, settings);
    if (result.intermittent?.assignments?.length) result = { ...result, intermittent: concentratePersonalities(result.intermittent) };
    const selectedIds = new Set(result.selectedWorkers.map((worker) => worker.workerId));
    const selectedForms = new Set(result.selectedWorkers.map((worker) => worker.aniimoId));
    // A player only has one starter, so one already in the plan is never spare.
    const unusedWorkers = allWorkers.filter(
      (worker) => !selectedIds.has(worker.workerId) && !(worker.starter && selectedForms.has(worker.aniimoId))
    );
    if (!isOwnedMode(settings)) {
      // Pool Aniimo are unlimited, so another copy of every form in the plan is always available (e.g.
      // as a backup), even if the search only generated as many copies as the jobs could use.
      const unusedForms = new Set(unusedWorkers.map((worker) => worker.aniimoId));
      const lastCopy = new Map();
      for (const worker of allWorkers) {
        if (!lastCopy.has(worker.aniimoId) || lastCopy.get(worker.aniimoId).copy < worker.copy) lastCopy.set(worker.aniimoId, worker);
      }
      for (const [aniimoId, worker] of lastCopy) {
        if (unusedForms.has(aniimoId) || worker.starter) continue;
        const copy = worker.copy + 1;
        unusedWorkers.push({ ...worker, workerId: `${aniimoId}#${copy}`, copy });
      }
    }
    const selectedWorkers = decorateSelectedWorkers(result, requirements, skills);

    const output = {
      feasible,
      selectedWorkers,
      unusedWorkers,
      skillCoverage: result.skillCoverage,
      physicalStaffing: summarizePhysicalStaffing(model, result.continuous, result.intermittent),
      continuousAssignments: result.continuous.assignments || [],
      intermittentAssignments: result.intermittent.assignments || [],
      missing: result.missing,
      unfilledJobs: result.continuous.unfilled || [],
      unfilledFarmTasks: result.intermittent.ok ? [] : uniqueFarmTasks(result.intermittent.unfilled || []),
      diagnostics: {
        selectedCount: selectedWorkers.length,
        candidateCount: candidates.length,
        totalAvailableWorkers: allWorkers.length,
        continuousJobCount: model.continuousJobs.length,
        intermittentTaskCount: model.intermittentTasks.length,
        searchWorkers: state.indices.length,
        settings,
        ...diagnostics,
      },
    };
    Object.defineProperty(output, "searchTeam", { value: searchTeam, enumerable: false });
    return output;
  }

  // Farm chunks that couldn't be placed, merged back to one entry per farm task.
  function uniqueFarmTasks(chunks) {
    const byId = new Map();
    for (const chunk of chunks) {
      if (!byId.has(chunk.id)) {
        byId.set(chunk.id, { id: chunk.id, buildingId: chunk.buildingId, buildingName: chunk.buildingName, skill: chunk.skill, label: chunk.label });
      }
    }
    return [...byId.values()];
  }

  // The beam search is a heuristic, so the plan it finds can occasionally carry an Aniimo it doesn't
  // need. Try leaving each one out (weakest first, later copies before earlier ones) and keep any
  // smaller team that still covers everything.
  function dropRedundantWorkers(winning, state, candidates, requirements, skills, model, settings) {
    let best = { winning, state };
    let improved = true;
    while (improved && best.state.indices.length > 1) {
      improved = false;
      const order = best.state.indices
        .slice()
        .sort(
          (a, b) =>
            candidates[b].copy - candidates[a].copy ||
            totalSkillPower(candidates[a], skills) - totalSkillPower(candidates[b], skills)
        );
      for (const drop of order) {
        const worker = candidates[drop];
        const indices = best.state.indices.filter((index) => index !== drop);
        // Keep copies numbered from 1: only drop the highest copy of a form still in the team.
        if (indices.some((index) => candidates[index].aniimoId === worker.aniimoId && candidates[index].copy > worker.copy)) continue;
        const totals = emptySkillMap(skills);
        for (const index of indices) for (const skill of skills) totals[skill] += Number(candidates[index].skills?.[skill] || 0);
        if (!skillTargetsMet(totals, requirements, skills)) continue;
        const trial = { indices, last: Math.max(...indices), totals };
        const validation = validateSelection(trial, candidates, requirements, skills, model, settings);
        if (validation.ok) {
          best = { winning: validation, state: trial };
          improved = true;
          break;
        }
      }
    }
    return best;
  }

  function optimizeWorkforce(input) {
    const skills = input.skills || DEFAULT_SKILLS;
    const requirements = cloneSkillMap(skills, input.requirements || {});
    const settings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
    const model = buildWorkModel(input.buildings || [], input.buildingState || {}, settings);
    const allWorkers = buildWorkers(input.aniimo || [], input.roster || {}, settings, skills, (entry) =>
      planningCopyCap(entry, model, requirements, settings, skills)
    );
    const relevantSkills = relevantSkillSet(requirements, model);
    let candidates = sortAndFilterCandidates(allWorkers, relevantSkills, model, requirements);

    if (!isOwnedMode(settings)) {
      // Big Homelands need more distinct Aniimo than the usual list holds.
      const base = Math.max(20, Math.min(160, Number(settings.theorycraftCandidateLimit || 80)));
      const limit = Math.min(200, Math.max(base, model.continuousJobs.length + model.intermittentTasks.length + 40));
      candidates = pickCandidates(candidates, relevantSkills, model, requirements, settings, limit);
    }
    // Keep copies of the same form in ascending order so the index-ordered search picks #1 before #2.
    candidates = orderCopies(candidates);

    const context = buildSearchContext(candidates, requirements, skills, model, settings);
    const emptyState = {
      indices: [],
      last: -1,
      totals: emptySkillMap(skills),
      counters: emptyCounters(context),
    };

    if (!candidates.length) {
      const emptyResult = validateSelection(emptyState, candidates, requirements, skills, model, settings);
      return finalizeResult(emptyResult.ok, emptyResult, emptyState, candidates, allWorkers, requirements, skills, model, settings, {
        note: "No relevant Aniimo workers are available.",
      });
    }

    // Every full-time job needs its own Aniimo, so search at least that deep (plus room for farm helpers
    // and requirement points), even when the setting asks for fewer.
    let maxDepth = Math.min(
      candidates.length,
      100,
      Math.max(
        Math.floor(clampNumber(settings.maxSearchWorkers, DEFAULT_SETTINGS.maxSearchWorkers, 1, 80)),
        model.continuousJobs.length + model.intermittentTasks.length + 4
      )
    );
    // "Best plan that fits": never look at teams bigger than the spaces available.
    const teamCap = positiveIntegerOrNull(settings.maxTeamSize);
    if (teamCap !== null) maxDepth = Math.min(maxDepth, teamCap);
    const beamWidth = Math.floor(clampNumber(settings.beamWidth, DEFAULT_SETTINGS.beamWidth, 100, 20000));
    const indexByWorkerId = new Map(candidates.map((worker, index) => [worker.workerId, index]));
    const previousCopyIndex = candidates.map((worker) => {
      if (worker.copy <= 1) return -1;
      const index = indexByWorkerId.get(`${worker.aniimoId}#${worker.copy - 1}`);
      return index === undefined ? -1 : index;
    });
    let beam = [emptyState];
    let bestPartial = emptyState;
    let bestPartialScore = Infinity;

    // A team the search found, then completed by adding part-time Aniimo (see repairPartTime).
    let repaired = null;
    const finishRepaired = () => {
      const { winning, state } = dropRedundantWorkers(repaired.validation, repaired.state, candidates, requirements, skills, model, settings);
      return finalizeResult(true, winning, state, candidates, allWorkers, requirements, skills, model, settings, {
        note: "Beam search team completed with part-time Aniimo.",
      });
    };

    for (let depth = 0; depth <= maxDepth; depth += 1) {
      const solutions = [];
      let repairTried = false;

      for (const state of beam) {
        const stateScore = state.score ?? approximateStateScore(state, context);
        if (stateScore < bestPartialScore) {
          bestPartialScore = stateScore;
          bestPartial = state;
        }

        // Full staffing validation is expensive; it can only pass once the skill targets are met and
        // every job group has enough compatible Aniimo.
        if (!skillTargetsMet(state.totals, requirements, skills)) continue;
        const shortage = stateShortage(state, context);
        if (shortage.continuous > 0 || shortage.intermittent > 0) continue;
        const validation = validateSelection(state, candidates, requirements, skills, model, settings);
        if (validation.ok) {
          solutions.push(validation);
        } else if (!repaired && !repairTried && validation.continuous.ok && !validation.intermittent.ok) {
          // The quick checks can't see every clash (e.g. the only Perfumery Aniimo is also the only one
          // allowed in the Dewy House), so complete the best such team by adding part-time Aniimo.
          repairTried = true;
          repaired = repairPartTime(state, validation, candidates, requirements, skills, model, settings);
        }
      }

      if (solutions.length) {
        solutions.sort((a, b) => solutionSort(a, b, skills));
        let winning = solutions[0];
        let state = beam.find((candidateState) => {
          const ids = candidateState.indices.map((index) => candidates[index]).map((worker) => worker.workerId).join("|");
          const solutionIds = winning.selectedWorkers.map((worker) => worker.workerId).join("|");
          return ids === solutionIds;
        }) || beam[0];
        ({ winning, state } = dropRedundantWorkers(winning, state, candidates, requirements, skills, model, settings));

        return finalizeResult(true, winning, state, candidates, allWorkers, requirements, skills, model, settings, {
          note: "Solution found with beam search.",
        });
      }

      // A completed team no bigger than anything the next depth could find: use it.
      if (repaired && repaired.state.indices.length <= depth + 1) return finishRepaired();
      if (depth === maxDepth) break;

      const nextStates = [];
      for (const state of beam) {
        // Only add Aniimo that help with something still missing. Any unselected candidate can be added
        // (not just later ones in the list); the same set reached in a different order is removed by
        // the state key below.
        if (!state.parts) state.parts = scoreParts(state, context);
        const helpfulMask = unmetNeedMask(state, context);
        const chosen = new Set(state.indices);
        const size = state.indices.length + 1;
        for (let index = 0; index < candidates.length; index += 1) {
          if (chosen.has(index)) continue;
          // Copies are interchangeable: only allow copy #n once copy #n-1 is already selected.
          const previous = previousCopyIndex[index];
          if (previous >= 0 && !chosen.has(previous)) continue;
          if (helpfulMask && !(context.vectors[index].skillMask & helpfulMask)) continue;
          const parts = childParts(state, index, context);
          // Children are only built in full if they make it into the next beam.
          nextStates.push({ parent: state, index, parts, score: combineScore(parts, size, context), size });
        }
      }

      nextStates.sort((a, b) => a.score - b.score || a.size - b.size);

      const seen = new Set();
      beam = [];
      for (const child of nextStates) {
        const { parent, index } = child;
        const state = {
          indices: parent.indices.concat(index),
          last: index,
          totals: addSkills(parent.totals, candidates[index], skills),
          counters: addCounters(parent.counters, context.vectors[index]),
          parts: child.parts,
          score: child.score,
        };
        const key = stateKey(state, context);
        if (seen.has(key)) continue;
        seen.add(key);
        beam.push(state);
        if (beam.length >= beamWidth) break;
      }
    }

    if (repaired) return finishRepaired();
    return buildPartialResult(bestPartial, candidates, allWorkers, requirements, skills, model, settings);
  }

  // Adds part-time Aniimo to a team whose full-time jobs are staffed but whose part-time work isn't fully
  // covered, each time the candidate that takes on the most extra part-time work (max flow). Returns
  // { state, validation } or null if a few extra Aniimo don't cover it.
  function repairPartTime(state, validation, candidates, requirements, skills, model, settings) {
    const farmCap = farmCapOf(settings);
    const busy = validation.continuous.busyWorkerIds;
    const indices = state.indices.slice();
    const chosen = new Set(indices);
    const free = indices.map((index) => candidates[index]).filter((worker) => !busy.has(worker.workerId));
    const tasks = model.intermittentTasks;
    const selectedIds = new Set(indices.map((index) => candidates[index].workerId));
    let current = assignPartTimeFlow(free, tasks, farmCap, true);
    for (let step = 0; step < 4 && !current.ok; step += 1) {
      let best = null;
      for (let index = 0; index < candidates.length; index += 1) {
        if (chosen.has(index)) continue;
        const worker = candidates[index];
        if (worker.copy > 1 && !selectedIds.has(`${worker.aniimoId}#${worker.copy - 1}`)) continue;
        const value = assignPartTimeFlow(free.concat(worker), tasks, farmCap, true);
        const gain = value.flow - current.flow;
        if (gain <= 1e-6) continue;
        if (!best || gain > best.gain + 1e-9) best = { index, worker, value, gain };
      }
      if (!best) return null;
      indices.push(best.index);
      chosen.add(best.index);
      selectedIds.add(best.worker.workerId);
      free.push(best.worker);
      current = best.value;
    }
    if (!current.ok) return null;
    const totals = emptySkillMap(skills);
    for (const index of indices) for (const skill of skills) totals[skill] += Number(candidates[index].skills?.[skill] || 0);
    const next = { indices, last: Math.max(...indices), totals };
    const checked = validateSelection(next, candidates, requirements, skills, model, settings, validation.continuous);
    return checked.ok ? { state: next, validation: checked } : null;
  }

  function positiveIntegerOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.floor(numeric);
  }

  // Works out how many Aniimo the homeland can hold from the RV level alone (the game doesn't let
  // players change it), using the (optional, possibly incomplete) homeland data file.
  function resolveHomelandCapacity(homelandData, rvLevel) {
    const level = positiveIntegerOrNull(rvLevel);
    const levels = Array.isArray(homelandData?.rvLevels) ? homelandData.rvLevels : [];
    const entry = level === null ? null : levels.find((item) => Number(item?.level) === level);
    const fromData = positiveIntegerOrNull(entry?.aniimoCapacity);
    if (fromData !== null && fromData > 0) {
      return { capacity: fromData, source: "rvLevel", known: true, level };
    }

    return { capacity: null, source: "unknown", known: false, level };
  }

  // Structured placement limit: building.maxByRv = [{ rv, max }, ...]. Returns
  //   { limited: false, locked } when the building has no limit data (no limit known),
  //   { limited: true, known: false } when no RV level is chosen,
  //   { limited: true, known: true, max, locked, unlockRv } otherwise (max 0 and locked before unlock).
  function buildingMaxForRv(building, rvLevel) {
    const steps = (Array.isArray(building?.maxByRv) ? building.maxByRv : [])
      .map((step) => ({ rv: Number(step?.rv), max: Number(step?.max) }))
      .filter((step) => Number.isFinite(step.rv) && Number.isFinite(step.max) && step.max >= 0)
      .sort((a, b) => a.rv - b.rv);
    const level = positiveIntegerOrNull(rvLevel);
    if (!steps.length) {
      const unlockRv = Number(building?.unlockRv) || 0;
      return { limited: false, locked: level !== null && level >= 1 && level < unlockRv, unlockRv };
    }
    const unlockRv = Math.max(steps[0].rv, Number(building.unlockRv) || 0);
    if (level === null || level < 1) return { limited: true, known: false, unlockRv };
    if (level < unlockRv) return { limited: true, known: true, max: 0, locked: true, unlockRv };
    let max = 0;
    for (const step of steps) if (step.rv <= level) max = step.max;
    return { limited: true, known: true, max: Math.floor(max), locked: false, unlockRv };
  }

  // Highest facility level (upgrade) a building can have at an RV level: building.maxLevelByRv = [{ rv, max }].
  // Returns { known: false } without data or without an RV level; otherwise { known: true, level, rv, maxLevel,
  // next } where level is 0 before the building unlocks and next is the next upgrade ({ level, rv }) or null.
  function buildingLevelForRv(building, rvLevel) {
    const steps = (Array.isArray(building?.maxLevelByRv) ? building.maxLevelByRv : [])
      .map((step) => ({ rv: Number(step?.rv), max: Number(step?.max) }))
      .filter((step) => Number.isFinite(step.rv) && Number.isFinite(step.max) && step.max >= 0)
      .sort((a, b) => a.rv - b.rv || a.max - b.max);
    const rv = positiveIntegerOrNull(rvLevel);
    const maxLevel = steps.reduce((best, step) => Math.max(best, step.max), 0) || null;
    if (!steps.length || rv === null || rv < 1) return { known: false, level: null, rv, maxLevel };
    let level = 0;
    for (const step of steps) if (step.rv <= rv) level = Math.max(level, step.max);
    const upcoming = steps.find((step) => step.rv > rv && step.max > level);
    return { known: true, level, rv, maxLevel, next: upcoming ? { level: upcoming.max, rv: upcoming.rv } : null };
  }

  // Which families can work a family-only building. The building is assumed to be at the highest level the
  // RV level allows, so a recipe above that level (e.g. the Sandcastle's Level 3 Pearl for the Sherro family)
  // is locked. A recipe whose climate building is required ("no work without it") is blocked when the plan
  // has none of that building. Without an RV level every recipe counts (the older behaviour).
  //   options: { rvLevel, buildingState, buildings } (buildings lets defaults count when a state is missing)
  // Returns null for a building anyone can work; otherwise { species, recipes, levelKnown, level, rv }, where
  // each recipe has { recipe, level, species, status: "open" | "level" | "prerequisite", unlockRv, missing }.
  function familyEligibility(building, options = {}) {
    const union = Array.isArray(building?.allowedSpecies) && building.allowedSpecies.length ? building.allowedSpecies : null;
    if (!union) return null;
    const recipes = Array.isArray(building.familyRecipes) && building.familyRecipes.length
      ? building.familyRecipes
      : [{ recipe: building.name, level: 1, species: union }];
    const levelInfo = buildingLevelForRv(building, options.rvLevel);
    const state = options.buildingState || null;
    const levelSteps = Array.isArray(building.maxLevelByRv) ? building.maxLevelByRv : [];
    const rows = recipes.map((recipe) => {
      const level = Math.max(1, Number(recipe.level) || 1);
      const unlockStep = levelSteps
        .filter((step) => Number(step?.max) >= level)
        .sort((a, b) => Number(a.rv) - Number(b.rv))[0];
      const row = {
        recipe: recipe.recipe,
        family: recipe.family || (Array.isArray(recipe.species) ? recipe.species[0] : ""),
        level,
        species: Array.isArray(recipe.species) ? recipe.species : [],
        unlockRv: unlockStep ? Number(unlockStep.rv) : null,
        status: "open",
        missing: [],
        slower: [],
      };
      for (const need of recipe.prerequisites || []) {
        if (!need?.buildingId) continue;
        const other = (options.buildings || []).find((item) => item?.id === need.buildingId) || { id: need.buildingId, defaultCount: 0 };
        const built = state ? getBuildingState(other, state) : null;
        const has = !built || (built.enabled && built.count > 0);
        if (has) continue;
        if (need.effect === "required") row.missing.push(need.name || need.buildingId);
        else row.slower.push(need.name || need.buildingId);
      }
      if (levelInfo.known && level > levelInfo.level) row.status = "level";
      else if (row.missing.length) row.status = "prerequisite";
      return row;
    });
    const species = [];
    for (const row of rows) if (row.status === "open") for (const name of row.species) if (!species.includes(name)) species.push(name);
    return { species, recipes: rows, levelKnown: levelInfo.known, level: levelInfo.level, rv: levelInfo.rv };
  }

  function spareEntry(worker, reason, extra = {}) {
    return {
      workerId: worker.workerId,
      aniimoId: worker.aniimoId,
      copy: worker.copy,
      name: worker.name,
      form: worker.form,
      displayName: displayWorkerName(worker),
      image: worker.image || "",
      category: worker.category,
      owned: worker.owned !== false,
      skills: worker.skills,
      reason,
      ...extra,
    };
  }

  // Suggests how to use homeland spaces left over after the minimum workforce.
  // input: { result, capacity, homebuildingReserve, homebuildingZone, requirements, skills, mode }
  function recommendSpareSpaces(input) {
    const skills = input.skills || DEFAULT_SKILLS;
    const result = input.result || { selectedWorkers: [], unusedWorkers: [], skillCoverage: [] };
    const selected = result.selectedWorkers || [];
    const capacity = positiveIntegerOrNull(input.capacity);
    const zone = input.homebuildingZone || {};
    const zoneName = String(zone.name || "").trim() || DEFAULT_HOMEBUILDING_ZONE_NAME;
    const preferredSkills = (Array.isArray(zone.preferredSkills) ? zone.preferredSkills : []).filter((skill) =>
      skills.includes(skill)
    );
    const used = selected.length;

    const base = {
      capacity,
      used,
      free: 0,
      capacityKnown: capacity !== null && capacity > 0,
      overCapacity: false,
      overBy: 0,
      homebuilding: { name: zoneName, requested: 0, reserved: 0, preferredSkills, suggestions: [] },
      backups: [],
      haulers: [],
      unfilled: 0,
      fragileSkills: [],
    };

    // Skills the plan depends on: requirement targets plus skills used by assigned jobs.
    const neededSkills = new Set();
    for (const row of result.skillCoverage || []) {
      if (Number(row.required) > 0) neededSkills.add(row.skill);
    }
    for (const assignment of result.continuousAssignments || []) {
      for (const requirement of assignment.job?.requirements || []) neededSkills.add(requirement.skill);
    }
    for (const assignment of result.intermittentAssignments || []) {
      for (const task of assignment.tasks || []) neededSkills.add(task.skill);
    }

    const coverageBySkill = new Map((result.skillCoverage || []).map((row) => [row.skill, row]));
    const fragileSkills = [];
    for (const skill of skills) {
      if (!neededSkills.has(skill)) continue;
      const holders = selected.filter((worker) => Number(worker.skills?.[skill] || 0) > 0).length;
      const row = coverageBySkill.get(skill);
      const noHeadroom = row && Number(row.required) > 0 && Number(row.surplus) <= 0;
      if (holders <= 1 || noHeadroom) {
        fragileSkills.push({
          skill,
          holders,
          required: Number(row?.required || 0),
          reason: holders <= 1 ? "single" : "noHeadroom",
        });
      }
    }
    fragileSkills.sort(
      (a, b) =>
        (a.reason === "single" ? 0 : 1) - (b.reason === "single" ? 0 : 1) ||
        b.required - a.required ||
        skills.indexOf(a.skill) - skills.indexOf(b.skill)
    );
    base.fragileSkills = fragileSkills;

    if (!base.capacityKnown) return base;

    if (used > capacity) {
      return { ...base, overCapacity: true, overBy: used - capacity };
    }

    const free = capacity - used;
    base.free = free;
    if (free === 0) return base;

    // Spare Aniimo to suggest. In owned mode only owned copies; in pool mode (the default) any Aniimo
    // in the player's available pool, suggesting each form at most once to keep the advice readable.
    const ownedMode = input.mode === "owned";
    // A player only has one starter, so never suggest another copy of one (as a backup, hauler or
    // Homebuilding Zone pick).
    const selectedForms = new Set(selected.map((worker) => worker.aniimoId));
    const pool = (result.unusedWorkers || [])
      .filter((worker) => !ownedMode || worker.owned !== false)
      .filter((worker) => !worker.starter || (!selectedForms.has(worker.aniimoId) && Number(worker.copy || 1) <= 1))
      .slice()
      .sort((a, b) => Number(b.owned !== false) - Number(a.owned !== false));
    const taken = new Set();
    const takenForms = new Set();
    const available = () =>
      pool.filter((worker) => !taken.has(worker.workerId) && (ownedMode || !takenForms.has(worker.aniimoId)));
    const take = (worker) => {
      taken.add(worker.workerId);
      takenForms.add(worker.aniimoId);
    };
    let remaining = free;

    // (c) Homebuilding zone: the player decides how many spaces to reserve.
    const requested = positiveIntegerOrNull(input.homebuildingReserve) ?? 0;
    const reserve = Math.min(requested, remaining);
    base.homebuilding.requested = requested;
    base.homebuilding.reserved = reserve;
    const preferredScore = (worker) =>
      preferredSkills.reduce((sum, skill) => sum + Number(worker.skills?.[skill] || 0), 0);
    const spareScore = (worker) =>
      totalSkillPower(worker, skills) + Number(worker.skills?.Hauling || 0) * 3;
    for (let slot = 0; slot < reserve; slot += 1) {
      const options = available();
      if (!options.length) break;
      let pick;
      if (preferredSkills.length) {
        const preferred = options
          .filter((worker) => preferredScore(worker) > 0)
          .sort((a, b) => Number(b.owned !== false) - Number(a.owned !== false) || preferredScore(b) - preferredScore(a));
        pick = preferred[0];
      }
      if (!pick) {
        // Any spare Aniimo works; choose the one least useful for other work.
        pick = options
          .filter((worker) => worker.owned !== false)
          .sort((a, b) => Number(b.owned !== false) - Number(a.owned !== false) || spareScore(a) - spareScore(b))[0];
      }
      if (!pick) break;
      take(pick);
      base.homebuilding.suggestions.push(
        spareEntry(
          pick,
          preferredSkills.length && preferredScore(pick) > 0
            ? `Suits the ${zoneName} (${preferredSkills.filter((skill) => pick.skills?.[skill] > 0).join(", ")})`
            : `Earns Bud Tickets in the ${zoneName}`
        )
      );
    }
    remaining = free - base.homebuilding.suggestions.length;
    // Spaces the player reserved stay reserved even if no Aniimo is suggested for them.
    remaining = Math.min(remaining, free - reserve);

    // (b) Backups for skills held by a single Aniimo or with no spare points.
    const backedUp = new Set();
    for (const fragile of fragileSkills) {
      if (remaining <= 0) break;
      if (backedUp.has(fragile.skill)) continue;
      const pick = available()
        .filter((worker) => Number(worker.skills?.[fragile.skill] || 0) > 0)
        .sort((a, b) => {
          const coversA = fragileSkills.filter((item) => Number(a.skills?.[item.skill] || 0) > 0).length;
          const coversB = fragileSkills.filter((item) => Number(b.skills?.[item.skill] || 0) > 0).length;
          return (
            Number(b.owned !== false) - Number(a.owned !== false) ||
            Number(b.skills[fragile.skill]) - Number(a.skills[fragile.skill]) ||
            coversB - coversA
          );
        })[0];
      if (!pick) continue;
      take(pick);
      remaining -= 1;
      const covers = fragileSkills
        .filter((item) => !backedUp.has(item.skill) && Number(pick.skills?.[item.skill] || 0) > 0)
        .map((item) => item.skill);
      covers.forEach((skill) => backedUp.add(skill));
      base.backups.push(
        spareEntry(
          pick,
          fragile.reason === "single"
            ? `Backup for ${covers.join(", ")} (only one Aniimo in your plan has ${fragile.skill})`
            : `Backup for ${covers.join(", ")} (no spare ${fragile.skill} points)`,
          { skills: pick.skills, covers }
        )
      );
    }

    // (a) Extra haulers with whatever is left.
    const haulers = available()
      .filter((worker) => Number(worker.skills?.Hauling || 0) > 0)
      .sort(
        (a, b) =>
          Number(b.owned !== false) - Number(a.owned !== false) ||
          Number(b.skills.Hauling) - Number(a.skills.Hauling) ||
          displayWorkerName(a).localeCompare(displayWorkerName(b))
      );
    const seenForms = new Set();
    for (const worker of haulers) {
      if (remaining <= 0) break;
      if (seenForms.has(worker.aniimoId)) continue;
      seenForms.add(worker.aniimoId);
      take(worker);
      remaining -= 1;
      base.haulers.push(spareEntry(worker, `Hauling ${worker.skills.Hauling}: moves goods between buildings faster`));
    }

    base.unfilled = Math.max(0, remaining);
    return base;
  }

  // ---------------------------------------------------------------------------------------------
  // Over-capacity planning. Every non-farm building needs its own Aniimo while it produces, and the
  // RV capacity is one limit shared by production and the Homebuilding Zone. When the full plan needs
  // more Aniimo than that, work out a "best plan that fits": leave some buildings idle (spare copies of a
  // building before the only one of its kind), keep every farm step covered, and get as close to the
  // Estimated Require totals as the remaining spaces allow.

  // Fewest farm helpers the farm steps could ever need with this pool: enough helper time for the total
  // farm load, and enough helpers that every farm ability is held by someone.
  function farmHelperLowerBound(model, pool, settings) {
    const tasks = (model.intermittentTasks || []).filter((task) => task.kind !== "processor");
    if (!tasks.length) return { helpers: 0, maxFarmSkillsPerAniimo: 0, farmSkills: [] };
    const maxLoad = clampNumber(settings.maxUtilizationPercent, 50, 1, 100) / 100;
    const loadBySkill = new Map();
    for (const task of tasks) loadBySkill.set(task.skill, (loadBySkill.get(task.skill) || 0) + task.load);
    const farmSkills = [...loadBySkill.keys()];
    let maxCover = 0;
    for (const entry of pool || []) {
      const cover = farmSkills.filter((skill) => Number(entry.skills?.[skill] || 0) > 0).length;
      maxCover = Math.max(maxCover, cover);
    }
    if (maxCover === 0) return { helpers: Infinity, maxFarmSkillsPerAniimo: 0, farmSkills };
    let helpers;
    if (settings.allowIntermittentMultiSkill === false) {
      helpers = [...loadBySkill.values()].reduce((sum, load) => sum + Math.ceil(load / maxLoad - 0.000001), 0);
    } else {
      const total = [...loadBySkill.values()].reduce((sum, load) => sum + load, 0);
      const perSkill = Math.max(...[...loadBySkill.values()].map((load) => Math.ceil(load / maxLoad - 0.000001)));
      helpers = Math.max(Math.ceil(total / maxLoad - 0.000001), perSkill, Math.ceil(farmSkills.length / maxCover));
    }
    return { helpers, maxFarmSkillsPerAniimo: maxCover, farmSkills };
  }

  // Fewest part-time Aniimo (farm helpers and processor workers) the part-time work could ever need: the
  // farm helpers above, and enough whole days for all farm and processor work together.
  function partTimeLowerBound(model, pool, settings) {
    const farm = farmHelperLowerBound(model, pool, settings);
    const tasks = model.intermittentTasks || [];
    if (!tasks.length) return 0;
    if (!Number.isFinite(farm.helpers)) return Infinity;
    const total = tasks.reduce((sum, task) => sum + task.load, 0);
    const bySkill = partTimeNeedBySkill(model, settings);
    return Math.max(farm.helpers, Math.ceil(total / WORKER_DAY - 0.000001), ...bySkill.values());
  }

  // Splits a plan into full-time building workers, part-time workers (farm helpers and processor workers)
  // and Aniimo only there for ability points.
  function teamBreakdown(result) {
    const continuousIds = new Set((result.continuousAssignments || []).map((item) => item.worker.workerId));
    const farmIds = new Set(
      (result.intermittentAssignments || []).map((item) => item.worker.workerId).filter((id) => !continuousIds.has(id))
    );
    const total = (result.selectedWorkers || []).length;
    return {
      total,
      buildings: continuousIds.size,
      farmHelpers: farmIds.size,
      boosters: Math.max(0, total - continuousIds.size - farmIds.size),
      continuousIds,
      farmIds,
    };
  }

  function sumDeficit(totals, requirements, skills) {
    return skills.reduce((sum, skill) => sum + Math.max(0, Number(requirements[skill] || 0) - Number(totals[skill] || 0)), 0);
  }

  // Picks `toIdle` full-time jobs to switch off, starting from the full plan's team: jobs that couldn't be
  // staffed anyway, then spare copies of a building (a 2nd Well, the 5th Mine), then buildings you only
  // have one of. Within a tier it drops the job whose Aniimo adds the least to the requirement totals.
  function chooseIdleJobs(model, full, requirements, skills, toIdle) {
    const workerByJob = new Map((full.continuousAssignments || []).map((item) => [item.job.id, item.worker]));
    const active = new Map();
    for (const job of model.continuousJobs) active.set(job.buildingId, (active.get(job.buildingId) || 0) + 1);
    const remainingJobs = new Set(model.continuousJobs.map((job) => job.id));
    const team = new Map();
    for (const item of full.continuousAssignments || []) team.set(item.worker.workerId, item.worker);
    const farmIds = teamBreakdown(full).farmIds;
    for (const worker of full.selectedWorkers || []) if (farmIds.has(worker.workerId)) team.set(worker.workerId, worker);
    const totals = emptySkillMap(skills);
    for (const worker of team.values()) for (const skill of skills) totals[skill] += Number(worker.skills?.[skill] || 0);

    const idled = [];
    for (let step = 0; step < toIdle; step += 1) {
      let best = null;
      for (const job of model.continuousJobs) {
        if (!remainingJobs.has(job.id)) continue;
        const worker = workerByJob.get(job.id) || null;
        const count = active.get(job.buildingId) || 0;
        const tier = worker ? (count > 1 ? 1 : 2) : 0;
        let loss = 0;
        if (worker) {
          const after = { ...totals };
          for (const skill of skills) after[skill] -= Number(worker.skills?.[skill] || 0);
          loss = sumDeficit(after, requirements, skills) - sumDeficit(totals, requirements, skills);
        }
        const power = worker ? totalSkillPower(worker, skills) : 0;
        const key = [tier, loss, -count, power];
        const better = !best || compareKeys(key, best.key) < 0;
        if (better) best = { job, worker, key };
      }
      if (!best) break;
      remainingJobs.delete(best.job.id);
      active.set(best.job.buildingId, active.get(best.job.buildingId) - 1);
      if (best.worker) {
        team.delete(best.worker.workerId);
        for (const skill of skills) totals[skill] -= Number(best.worker.skills?.[skill] || 0);
      }
      idled.push(best.job);
    }
    return { idled, team: [...team.values()] };
  }

  function compareKeys(a, b) {
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
    return 0;
  }

  // Groups identical items into "Name ×count" entries, keeping first-seen order.
  function groupByName(items, nameOf) {
    const groups = new Map();
    for (const item of items) {
      const name = nameOf(item);
      const group = groups.get(name) || { name, count: 0, items: [] };
      group.count += 1;
      group.items.push(item);
      groups.set(name, group);
    }
    return [...groups.values()];
  }

  function formatGroups(groups) {
    return groups.map((group) => `${group.name} ×${group.count}`).join(", ");
  }

  function evaluateTeam(team, context) {
    const { candidatesFor, requirements, skills, model, settings, allWorkers } = context;
    const candidates = candidatesFor(team);
    const totals = emptySkillMap(skills);
    for (const worker of candidates) for (const skill of skills) totals[skill] += Number(worker.skills?.[skill] || 0);
    const state = { indices: candidates.map((_, index) => index), totals };
    const validation = validateSelection(state, candidates, requirements, skills, model, settings);
    return finalizeResult(validation.ok, validation, state, candidates, allWorkers, requirements, skills, model, settings, {
      note: "Full plan's team with the idle buildings' Aniimo taken out.",
    });
  }

  function planQuality(result) {
    const unstaffed = (result.unfilledJobs || []).length + (result.unfilledFarmTasks || []).length;
    const deficit = (result.skillCoverage || []).reduce((sum, row) => sum + Number(row.missing || 0), 0);
    return { unstaffed, deficit, size: (result.selectedWorkers || []).length };
  }

  function compareQuality(a, b) {
    return a.unstaffed - b.unstaffed || a.deficit - b.deficit || a.size - b.size;
  }

  // Compact, grouped description of what a plan still lacks. Never one line per building copy.
  // options: { pool, catalogue, skills, idleJobs }
  function summarizeShortfalls(result, options = {}) {
    const skills = options.skills || DEFAULT_SKILLS;
    const pool = options.pool || [];
    const catalogue = options.catalogue || pool;
    const idle = groupByName(options.idleJobs || [], (job) => job.name).map((group) => ({
      name: group.name,
      buildingId: group.items[0].buildingId,
      count: group.count,
    }));
    const unstaffed = groupByName(result.unfilledJobs || [], (job) => job.name).map((group) => ({
      name: group.name,
      buildingId: group.items[0].buildingId,
      count: group.count,
      skills: (group.items[0].requirements || []).map((requirement) => requirement.skill),
      requirements: group.items[0].requirements || [],
      allowedSpecies: group.items[0].allowedSpecies || null,
    }));
    const farmSkills = [];
    for (const task of result.unfilledFarmTasks || []) if (!farmSkills.includes(task.skill)) farmSkills.push(task.skill);
    const short = (result.skillCoverage || [])
      .filter((row) => Number(row.missing) > 0)
      .map((row) => ({ skill: row.skill, missing: Number(row.missing) }));

    // Abilities nobody in the pool has at all (or not at the level a building needs).
    const hasAbility = (list, skill, minLevel = 1) => list.some((entry) => Number(entry.skills?.[skill] || 0) >= minLevel);
    const needs = new Map();
    const addNeed = (skill, minLevel = 1) => needs.set(skill, Math.min(needs.get(skill) ?? Infinity, minLevel));
    // Buildings only some families can work, with none of those Aniimo in the pool.
    const noFamily = [];
    for (const group of unstaffed) {
      if (!group.allowedSpecies) continue;
      const canWork = (entry) =>
        speciesAllowed(entry, group) &&
        group.requirements.some((requirement) => Number(entry.skills?.[requirement.skill] || 0) >= Number(requirement.minLevel || 1));
      if (pool.some(canWork)) continue;
      noFamily.push({ name: group.name, buildingId: group.buildingId, allowedSpecies: group.allowedSpecies, elsewhere: catalogue.filter(canWork).length });
    }
    for (const group of unstaffed) {
      if (group.allowedSpecies) continue;
      // A job the pool can't do at all: every accepted ability is missing.
      const doable = group.requirements.some((requirement) => hasAbility(pool, requirement.skill, Number(requirement.minLevel || 1)));
      if (!doable) for (const requirement of group.requirements) addNeed(requirement.skill, Number(requirement.minLevel || 1));
    }
    for (const skill of farmSkills) addNeed(skill);
    for (const row of short) addNeed(row.skill);
    const noAbility = [];
    for (const [skill, minLevel] of needs) {
      if (hasAbility(pool, skill, minLevel)) continue;
      const elsewhere = catalogue.filter((entry) => Number(entry.skills?.[skill] || 0) >= minLevel);
      noAbility.push({
        skill,
        minLevel,
        prismana: elsewhere.some((entry) => aniimoCategory(entry) === "prismana"),
        legendary: elsewhere.some((entry) => aniimoCategory(entry) === "legendary"),
        otherCount: elsewhere.length,
      });
    }
    noAbility.sort((a, b) => skills.indexOf(a.skill) - skills.indexOf(b.skill));

    const lines = [];
    if (idle.length) lines.push(`Left idle: ${formatGroups(idle)}`);
    if (unstaffed.length) lines.push(`No Aniimo for: ${formatGroups(unstaffed)}`);
    for (const item of noFamily) {
      const names = item.allowedSpecies.length > 1
        ? `${item.allowedSpecies.slice(0, -1).join(", ")} or ${item.allowedSpecies[item.allowedSpecies.length - 1]}`
        : item.allowedSpecies[0];
      lines.push(
        `No Aniimo in your pool can work the ${item.name} – only ${names} can.${item.elsewhere ? " Tick one on the Available Aniimo tab." : ""}`
      );
    }
    if (farmSkills.length) lines.push(`Part-time jobs short of Aniimo: ${farmSkills.join(", ")}`);
    if (short.length) lines.push(`Short on: ${short.map((row) => `${row.skill} ${row.missing}`).join(", ")}`);
    for (const item of noAbility) {
      const level = item.minLevel > 1 ? ` at level ${item.minLevel}+` : "";
      let hint = "";
      if (item.prismana && item.legendary) hint = " Ticking Prismana forms or legendary Aniimo on the Available Aniimo tab would help.";
      else if (item.prismana) hint = " Ticking Prismana forms on the Available Aniimo tab would help.";
      else if (item.legendary) hint = " Ticking legendary Aniimo on the Available Aniimo tab would help.";
      else if (item.otherCount) hint = " Tick one that has it on the Available Aniimo tab.";
      lines.push(`No Aniimo in your pool has ${item.skill}${level}.${hint}`);
    }
    return { idle, unstaffed, farmSkills, short, noAbility, noFamily, lines, ok: !lines.length };
  }

  // input: the optimizeWorkforce input plus
  //   capacity (RV Aniimo spaces), homebuildingReserve (spaces kept for the Homebuilding Zone),
  //   catalogue (every Aniimo, to suggest ticking Prismana/legendary), fullResult (optional, reused).
  // Returns the full plan, whether it fits, the headline numbers, and (when over) the best plan that fits.
  function planForCapacity(input) {
    const skills = input.skills || DEFAULT_SKILLS;
    const requirements = cloneSkillMap(skills, input.requirements || {});
    const settings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
    delete settings.maxTeamSize;
    const pool = input.aniimo || [];
    const catalogue = input.catalogue || pool;
    const full = input.fullResult || optimizeWorkforce({ ...input, settings });
    const model = buildWorkModel(input.buildings || [], input.buildingState || {}, settings);
    const breakdown = teamBreakdown(full);
    const farmBound = farmHelperLowerBound(model, pool, settings);
    const partTimeBound = partTimeLowerBound(model, pool, settings);
    const capacity = positiveIntegerOrNull(input.capacity);
    const capacityKnown = capacity !== null && capacity > 0;
    const reserve = capacityKnown ? Math.min(capacity, positiveIntegerOrNull(input.homebuildingReserve) ?? 0) : 0;
    const budget = capacityKnown ? capacity - reserve : null;
    const buildingJobs = model.continuousJobs.length;
    const farmHelpersNeeded = Math.max(breakdown.farmHelpers, full.unfilledFarmTasks?.length ? partTimeBound : 0);
    const needed = Math.max(breakdown.total, buildingJobs + (Number.isFinite(farmHelpersNeeded) ? farmHelpersNeeded : 0));
    const minimumPossible = buildingJobs + (Number.isFinite(partTimeBound) ? partTimeBound : 0);

    const base = {
      full,
      fitted: null,
      capacity,
      capacityKnown,
      reserve,
      budget,
      needed,
      overCapacity: false,
      overBy: 0,
      breakdown: {
        buildings: buildingJobs,
        // Part-time workers: farm helpers and processor workers (the old name is kept for callers).
        farmHelpers: farmHelpersNeeded,
        partTime: farmHelpersNeeded,
        boosters: breakdown.boosters,
        processorLoad: model.intermittentTasks.filter((task) => task.kind === "processor").reduce((sum, task) => sum + task.load, 0),
      },
      minimumPossible,
      farmBound,
      partTimeBound,
      idleJobs: [],
      fullShortfalls: summarizeShortfalls(full, { pool, catalogue, skills }),
      shortfalls: null,
    };
    base.shortfalls = base.fullShortfalls;

    if (!capacityKnown || needed <= budget) return base;

    base.overCapacity = true;
    base.overBy = needed - budget;
    // Options that don't fit are only compared, so the (slower) best plan that fits can be skipped.
    if (input.computeFitted === false) return base;
    if (budget <= 0) {
      base.fitted = null;
      return base;
    }

    // Aniimo that are only there for ability points go first; then buildings are left idle.
    const farmKeep = Number.isFinite(farmHelpersNeeded) ? farmHelpersNeeded : 0;
    const toIdle = Math.min(buildingJobs, Math.max(0, buildingJobs + Math.min(farmKeep, budget) - budget));
    const { idled, team } = chooseIdleJobs(model, full, requirements, skills, toIdle);
    const idledByBuilding = new Map();
    for (const job of idled) idledByBuilding.set(job.buildingId, (idledByBuilding.get(job.buildingId) || 0) + 1);
    const reducedState = {};
    for (const building of input.buildings || []) {
      const state = getBuildingState(building, input.buildingState || {});
      reducedState[building.id] = {
        enabled: state.enabled,
        count: Math.max(0, state.count - (idledByBuilding.get(building.id) || 0)),
      };
    }
    const reducedModel = buildWorkModel(input.buildings || [], reducedState, settings);

    // Option 1: the full plan's team minus the idle buildings' Aniimo (instant).
    const allWorkers = buildWorkers(pool, input.roster || {}, settings, skills, (entry) =>
      planningCopyCap(entry, model, requirements, settings, skills)
    );
    const greedy = evaluateTeam(team.slice(0, budget), {
      candidatesFor: (list) => list,
      requirements,
      skills,
      model: reducedModel,
      settings,
      allWorkers,
    });
    let fitted = greedy;
    // Option 2: a fresh search capped at the available spaces, only needed when option 1 misses
    // requirement points or leaves something unstaffed.
    const greedyQuality = planQuality(greedy);
    if (greedyQuality.unstaffed > 0 || greedyQuality.deficit > 0) {
      const searched = optimizeWorkforce({
        ...input,
        buildingState: reducedState,
        settings: { ...settings, maxTeamSize: budget, beamWidth: Math.min(Number(settings.beamWidth) || 1000, 600) },
      });
      if (searched.selectedWorkers.length <= budget && compareQuality(planQuality(searched), greedyQuality) < 0) {
        fitted = searched;
      }
    }
    fitted.diagnostics = { ...fitted.diagnostics, fittedToCapacity: budget };
    base.fitted = fitted;
    base.idleJobs = idled;
    base.shortfalls = summarizeShortfalls(fitted, { pool, catalogue, skills, idleJobs: idled });
    return base;
  }

  // Plain-English headline for a planForCapacity result. options: { rvLevel, zoneName }
  function describeCapacityPlan(plan, options = {}) {
    const zoneName = options.zoneName || DEFAULT_HOMEBUILDING_ZONE_NAME;
    const s = (count, word, pluralWord = `${word}s`) => `${count} ${count === 1 ? word : pluralWord}`;
    const parts = [`${plan.breakdown.buildings} full-time`];
    if (plan.breakdown.farmHelpers) parts.push(`${plan.breakdown.farmHelpers} part-time`);
    if (plan.breakdown.boosters) parts.push(`${plan.breakdown.boosters} for ability totals`);
    const home = options.rvLevel ? `RV ${options.rvLevel}` : "your Homeland";
    const level = Number.isFinite(options.processorPercent) ? ` with processors ${options.processorPercent}% busy` : "";
    let spaces = `${home} has ${s(plan.capacity, "space")}`;
    if (plan.reserve) spaces += `, ${plan.reserve} kept for the ${zoneName}, leaving ${plan.budget}`;
    if (!plan.overCapacity) {
      return {
        headline: `Your buildings need ${s(plan.needed, "Aniimo", "Aniimo")}${level} (${parts.join(" + ")}), and ${spaces}.`,
        minimum: "",
      };
    }
    const headline = `Your buildings need ${s(plan.needed, "Aniimo", "Aniimo")}${level} (${parts.join(" + ")}), but ${spaces} – ${plan.overBy} over.`;
    let minimum = "";
    if (plan.breakdown.farmHelpers > 0 && Number.isFinite(plan.partTimeBound)) {
      const least = plan.minimumPossible;
      const leastOver = least - plan.budget;
      if (least < plan.needed) {
        minimum = `If Aniimo with several abilities shared the part-time work perfectly, the least possible would be ${least}${
          leastOver > 0 ? ` – still ${leastOver} over` : ""
        }.`;
      } else {
        minimum = "That's already the least possible: full-time producers, climate buildings and generators each need their own Aniimo.";
      }
    } else if (plan.breakdown.buildings > plan.budget) {
      minimum = "Full-time producers, climate buildings and generators each need their own Aniimo.";
    }
    return { headline, minimum };
  }

  // Builds the plan for a higher processor busy level from a plan at a lower one. Full-time jobs and
  // Estimated Require targets don't depend on the level, so the lower plan's team is kept and part-time
  // Aniimo are added one at a time, each time the one that takes on the most extra part-time work (a max
  // flow). Much faster than a new search, which matters when several levels are compared.
  function extendPlanToLevel(input, base) {
    const skills = input.skills || DEFAULT_SKILLS;
    const requirements = cloneSkillMap(skills, input.requirements || {});
    const settings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
    const model = buildWorkModel(input.buildings || [], input.buildingState || {}, settings);
    const farmCap = farmCapOf(settings);
    const owned = isOwnedMode(settings);
    const team = (base.searchTeam || base.selectedWorkers || []).slice();
    const continuous = assignContinuous(team, model.continuousJobs);
    const free = team.filter((worker) => !continuous.busyWorkerIds.has(worker.workerId));
    const tasks = model.intermittentTasks;
    const flowOf = (list) => assignPartTimeFlow(list, tasks, farmCap, true);
    let current = flowOf(free);
    const taskSkills = [...new Set(tasks.map((task) => task.skill))];
    const forms = (input.aniimo || []).filter((entry) => {
      if (owned && input.roster?.[entry.id]?.excluded) return false;
      return taskSkills.some((skill) => Number(entry.skills?.[skill] || 0) > 0);
    });
    const nextCopy = new Map();
    for (const worker of team) nextCopy.set(worker.aniimoId, Math.max(nextCopy.get(worker.aniimoId) || 1, Number(worker.copy || 1) + 1));
    // A player only ever has one starter.
    const quantityOf = (entry) =>
      owned ? Math.floor(clampNumber(input.roster?.[entry.id]?.quantity, 0, 0, entry.starter ? 1 : 99)) : entry.starter ? 1 : Infinity;
    const taskFit = (worker) => taskSkills.reduce((sum, skill) => sum + Number(worker.skills?.[skill] || 0), 0);

    let guard = 0;
    while (!current.ok && guard < 80) {
      guard += 1;
      let best = null;
      for (const entry of forms) {
        const copy = nextCopy.get(entry.id) || 1;
        if (copy > quantityOf(entry)) continue;
        const worker = makeWorker(entry, copy, skills, true);
        const value = flowOf(free.concat(worker));
        const gain = value.flow - current.flow;
        if (gain <= 1e-6) continue;
        const key = [-gain, -taskFit(worker), worker.totalSkill];
        if (!best || compareKeys(key, best.key) < 0) best = { worker, value, key };
      }
      if (!best) break;
      team.push(best.worker);
      free.push(best.worker);
      nextCopy.set(best.worker.aniimoId, best.worker.copy + 1);
      current = best.value;
    }

    // Leave out any part-time Aniimo the plan no longer needs (latest and weakest first).
    const totalsOf = (list) => {
      const totals = emptySkillMap(skills);
      for (const worker of list) for (const skill of skills) totals[skill] += Number(worker.skills?.[skill] || 0);
      return totals;
    };
    if (current.ok) {
      const order = free.slice().reverse();
      for (const worker of order) {
        if (team.some((other) => other.aniimoId === worker.aniimoId && other.copy > worker.copy)) continue;
        const withoutFree = free.filter((item) => item !== worker);
        const withoutTeam = team.filter((item) => item !== worker);
        if (!skillTargetsMet(totalsOf(withoutTeam), requirements, skills)) continue;
        if (!flowOf(withoutFree).ok) continue;
        free.splice(free.indexOf(worker), 1);
        team.splice(team.indexOf(worker), 1);
      }
    }

    const state = { indices: team.map((_, index) => index), totals: totalsOf(team) };
    // Keep the full-time assignment the part-time work was planned around.
    const validation = validateSelection(state, team, requirements, skills, model, settings, continuous);
    const allWorkers = buildWorkers(input.aniimo || [], input.roster || {}, settings, skills, (entry) =>
      planningCopyCap(entry, model, requirements, settings, skills)
    );
    return finalizeResult(validation.ok, validation, state, team, allWorkers, requirements, skills, model, settings, {
      note: "Lower busy level's team with part-time Aniimo added.",
      extendedFrom: base.diagnostics?.settings?.processorBusyPercent ?? null,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Processor busy options. Processors only work while their inputs last, so the plan is worked out at
  // several busy levels (25%, 50%, 75%, 100% of one Aniimo per processor). The highest level that fits
  // the RV spaces is selected, and the most that fits is found to about 5%.

  const OPTION_STEP = 5;

  function normaliseLevels(levels) {
    const list = (Array.isArray(levels) && levels.length ? levels : PROCESSOR_LEVELS)
      .map((value) => Math.round(Number(value)))
      .filter((value) => Number.isFinite(value) && value >= 1 && value <= 100);
    return [...new Set(list)].sort((a, b) => a - b);
  }

  // Processors built and following the option level (no busy % of their own).
  function autoProcessorCount(buildings, buildingState) {
    let count = 0;
    for (const building of buildings || []) {
      if (!isPartTimeProcessor(building)) continue;
      const state = getBuildingState(building, buildingState);
      if (!state.enabled || state.count <= 0) continue;
      const override = state.busyPercent;
      if (override === null || override === undefined || override === "" || !Number.isFinite(Number(override))) count += state.count;
    }
    return count;
  }

  // input: the planForCapacity input plus
  //   levels (default 25/50/75/100) and fallbackAniimo (optional smaller pool, e.g. common Aniimo only,
  //   also tried at each level; the smaller team wins, so ticking Prismana never makes a plan worse).
  // Returns { options: [{ percent, plan, needed, fits, spare }], selectedIndex, maxFitPercent, ... }.
  function planProcessorOptions(input) {
    const settings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
    delete settings.maxTeamSize;
    const levels = normaliseLevels(input.levels);
    const cache = new Map();
    const started = Date.now();
    let runs = 0;

    function run(percent, computeFitted) {
      const key = percent === null ? "own" : String(percent);
      let entry = cache.get(key);
      const levelSettings = percent === null ? settings : { ...settings, processorBusyPercent: percent };
      if (!entry) {
        runs += 1;
        // Reuse the nearest lower level's plan when there is one: only part-time Aniimo need adding.
        let lower = null;
        if (percent !== null) {
          for (const [otherKey, other] of cache) {
            const otherPercent = Number(otherKey);
            if (Number.isFinite(otherPercent) && otherPercent < percent && (!lower || otherPercent > lower.percent)) {
              lower = { percent: otherPercent, entry: other };
            }
          }
        }
        if (lower) {
          const result = extendPlanToLevel({ ...input, aniimo: lower.entry.pool, settings: levelSettings }, lower.entry.result);
          entry = { result, pool: lower.entry.pool, plan: null, fitted: false };
          cache.set(key, entry);
        }
      }
      if (!entry) {
        let pool = input.aniimo || [];
        let result = optimizeWorkforce({ ...input, aniimo: pool, settings: levelSettings });
        const fallback = input.fallbackAniimo;
        if (Array.isArray(fallback) && fallback.length && fallback.length < pool.length) {
          const alternative = optimizeWorkforce({ ...input, aniimo: fallback, settings: levelSettings });
          const better =
            (alternative.feasible && !result.feasible) ||
            (alternative.feasible === result.feasible && alternative.selectedWorkers.length < result.selectedWorkers.length);
          if (better) {
            result = alternative;
            pool = fallback;
          }
        }
        entry = { result, pool, plan: null, fitted: false };
        cache.set(key, entry);
      }
      if (!entry.plan || (computeFitted && !entry.fitted && entry.plan.overCapacity)) {
        entry.plan = planForCapacity({
          ...input,
          aniimo: entry.pool,
          settings: levelSettings,
          fullResult: entry.result,
          computeFitted,
        });
        entry.fitted = computeFitted;
      }
      const plan = entry.plan;
      // An option only "fits" when its plan also staffs everything: a plan that leaves a building,
      // farm step or processor without an Aniimo (or misses a target) is never reported as complete.
      const underCapacity = plan.capacityKnown ? !plan.overCapacity : null;
      const complete = Boolean(plan.full.feasible);
      return {
        percent,
        plan,
        needed: plan.needed,
        complete,
        underCapacity,
        fits: underCapacity === null ? null : underCapacity && complete,
        spare: plan.capacityKnown ? plan.budget - plan.needed : null,
      };
    }

    // Most that fits between a level that fits (lo) and one that doesn't (hi), in 5% steps.
    function searchMaxFit(lo, hi) {
      const steps = [];
      for (let value = Math.floor(lo / OPTION_STEP) * OPTION_STEP + OPTION_STEP; value < hi; value += OPTION_STEP) {
        if (value > lo) steps.push(value);
      }
      let low = 0;
      let high = steps.length - 1;
      let best = lo;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (run(steps[middle], false).fits) {
          best = steps[middle];
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      return best;
    }

    const autoProcessors = autoProcessorCount(input.buildings, input.buildingState);
    const base = {
      levels,
      autoProcessors,
      variesWithLevel: autoProcessors > 0,
      options: [],
      selectedIndex: 0,
      maxFitPercent: null,
      noneFit: false,
      allFit: false,
      incomplete: false,
      capacityKnown: false,
    };

    if (!autoProcessors) {
      // Nothing follows the option level (no processors, or every one has its own busy %): one plan.
      const only = run(null, true);
      base.options = [only];
      base.capacityKnown = only.plan.capacityKnown;
      base.noneFit = only.underCapacity === false;
      base.incomplete = only.underCapacity === true && !only.complete;
      base.allFit = only.fits === true;
      base.diagnostics = { runs, ms: Date.now() - started };
      return base;
    }

    base.options = levels.map((percent) => run(percent, false));
    base.capacityKnown = base.options[0].plan.capacityKnown;
    if (!base.capacityKnown) {
      base.selectedIndex = base.options.length - 1;
      base.options[base.selectedIndex] = run(levels[base.selectedIndex], true);
      base.diagnostics = { runs, ms: Date.now() - started };
      return base;
    }

    let highest = -1;
    base.options.forEach((option, index) => {
      if (option.fits) highest = index;
    });
    const highestUnder = base.options.map((option) => option.underCapacity).lastIndexOf(true);
    if (highest < 0 && highestUnder >= 0) {
      // Room enough, but the Available Aniimo can't staff everything at any level (e.g. nobody of a
      // family-only building's families): show the highest level with room, and what it's missing.
      base.incomplete = true;
      base.selectedIndex = highestUnder;
      base.options[highestUnder] = run(levels[highestUnder], true);
    } else if (highest >= 0) {
      base.selectedIndex = highest;
      base.allFit = highest === levels.length - 1;
      base.maxFitPercent = base.allFit ? levels[highest] : searchMaxFit(levels[highest], levels[highest + 1]);
    } else {
      // Even the lowest level doesn't fit: show its best plan that fits, and how low processors would need to go.
      base.noneFit = true;
      base.selectedIndex = 0;
      base.options[0] = run(levels[0], true);
      // With processors idle (0%) the plan may still not fit; otherwise search between 0% and the lowest level,
      // building each step on the 0% plan.
      base.maxFitPercent = run(0, false).fits ? searchMaxFit(0, levels[0]) : null;
    }
    base.diagnostics = { runs, ms: Date.now() - started };
    return base;
  }

  // Personalities worth looking for: each building's matching personality (20% faster there), grouped by
  // personality and ability and ranked by how much of your work they speed up (1 per full-time building,
  // a processor's busy share, nothing for farm plots). Personalities are random on each Aniimo, so this
  // never names species. input: { buildings, buildingState, settings }
  function personalityRecommendations(input) {
    const settings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
    const model = buildWorkModel(input.buildings || [], input.buildingState || {}, settings);
    const groups = new Map();
    const add = (personality, skill, buildingId, name, weight, kind) => {
      if (!personality || !skill) return;
      const key = `${personality}|${skill}`;
      const group = groups.get(key) || { personality, skill, weight: 0, buildings: [] };
      group.weight += weight;
      let building = group.buildings.find((item) => item.buildingId === buildingId);
      if (!building) {
        building = { buildingId, name, count: 0, weight: 0, kind };
        group.buildings.push(building);
      }
      building.count += kind === "processor" ? 0 : 1;
      building.weight += weight;
      groups.set(key, group);
    };
    for (const job of model.continuousJobs) {
      add(job.personalityBonus, (job.requirements || [])[0]?.skill, job.buildingId, job.name, 1, "full-time");
    }
    for (const task of model.intermittentTasks) {
      if (task.kind !== "processor") continue;
      add(task.personalityBonus, task.skill, task.buildingId, task.buildingName, task.load, "processor");
      const group = groups.get(`${task.personalityBonus}|${task.skill}`);
      const building = group?.buildings.find((item) => item.buildingId === task.buildingId);
      if (building) building.count = task.count;
    }
    return [...groups.values()]
      .map((group) => ({ ...group, buildings: group.buildings.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)) }))
      .filter((group) => group.weight > 0.0001)
      .sort((a, b) => b.weight - a.weight || a.personality.localeCompare(b.personality) || a.skill.localeCompare(b.skill));
  }

  // ---------------------------------------------------------------------------------------------
  // "Choose these": the plan as requirements rather than exact picks. Each Aniimo in the plan gets a role
  // requirement – the abilities it must have for the plan to stay valid:
  //   • the ability it uses at its full-time building, at the level the plan relies on (its own level,
  //     which the quality pass made the best the pool offers), and each ability its part-time work uses
  //     (processors at its own level; farm steps at level 1, as a farm action takes the same time at any level);
  //   • any extra ability an Estimated Require target leans on: one whose loss – swapping this Aniimo for
  //     one with only its job abilities – would drop a target below what you asked for; and, if the
  //     recommended Aniimo together would still leave a target short, the Aniimo with the most of it keep it;
  //   • family-only buildings: only the species allowed there.
  // Aniimo with the same requirement share a recommendation: the best tier of pool Aniimo that meet it,
  // ranked by the must-have level, then Hauling (always useful for carrying stock), then other abilities
  // this plan uses or targets, then total points; identical ability profiles are listed together, with
  // shorter fallback tiers after. Each Aniimo also gets a target personality – the one wanted where it does
  // most of its work – and lines are split by it, since that is what you hunt for.
  //   result: an optimiser result (selectedWorkers, continuousAssignments, intermittentAssignments,
  //           skillCoverage); pool: the Available Aniimo entries; options: { skills }
  // Returns { lines: [...] }; the lines' counts add up to the plan size.
  function summariseRecommendations(result, pool, options = {}) {
    const skills = options.skills || DEFAULT_SKILLS;
    const selected = result?.selectedWorkers || [];
    const level = (entry, skill) => Number(entry?.skills?.[skill] || 0);
    const skillOrder = (a, b) => skills.indexOf(a) - skills.indexOf(b);
    const jobOf = new Map((result?.continuousAssignments || []).map((item) => [item.worker.workerId, item.job]));
    const tasksOf = new Map((result?.intermittentAssignments || []).map((item) => [item.worker.workerId, item.tasks || []]));
    const required = new Map((result?.skillCoverage || []).map((row) => [row.skill, Number(row.required || 0)]));
    const target = (skill) => required.get(skill) || 0;
    const planTotals = new Map(skills.map((skill) => [skill, selected.reduce((sum, worker) => sum + level(worker, skill), 0)]));

    // How much the plan uses each ability: its target plus the work that needs it.
    const demand = new Map(skills.map((skill) => [skill, target(skill)]));
    const addDemand = (skill, amount) => {
      if (skill) demand.set(skill, (demand.get(skill) || 0) + amount);
    };
    for (const job of jobOf.values()) for (const requirement of job.requirements || []) addDemand(requirement.skill, 1);
    for (const tasks of tasksOf.values()) for (const task of tasks) addDemand(task.skill, Number(task.load || 0));

    // 1. Each Aniimo's job abilities, family limits and work per building.
    const roles = selected.map((worker, index) => {
      const essential = new Map();
      const need = (skill, value) => essential.set(skill, Math.max(essential.get(skill) || 0, value));
      const familyBuildings = [];
      let species = null;
      const limit = (allowed, name) => {
        if (!Array.isArray(allowed) || !allowed.length) return;
        species = species ? species.filter((item) => allowed.includes(item)) : allowed.slice();
        if (!familyBuildings.includes(name)) familyBuildings.push(name);
      };
      const work = new Map();
      const addWork = (name, personality, load) => {
        const entry = work.get(name) || { name, personality: personality || "", load: 0 };
        entry.load += load;
        work.set(name, entry);
      };
      const job = jobOf.get(worker.workerId);
      if (job) {
        const used = (job.requirements || [])
          .filter((requirement) => level(worker, requirement.skill) >= Number(requirement.minLevel || 1))
          .sort((a, b) => level(worker, b.skill) - level(worker, a.skill))[0];
        if (used) need(used.skill, level(worker, used.skill));
        limit(job.allowedSpecies, job.name);
        addWork(job.name, job.personalityBonus, 1);
      }
      const farmOnly = new Set();
      for (const task of tasksOf.get(worker.workerId) || []) {
        if (task.kind !== "processor" && !essential.has(task.skill)) farmOnly.add(task.skill);
        if (task.kind === "processor") farmOnly.delete(task.skill);
        need(task.skill, task.kind === "processor" ? level(worker, task.skill) : Math.max(1, Number(task.minLevel || 1)));
        limit(task.allowedSpecies, task.buildingName);
        addWork(task.buildingName, task.personalityBonus, Number(task.load || 0));
      }
      return { worker, index, essential, forTarget: new Set(), farmOnly, species, familyBuildings, work };
    });

    // 1b. Farm steps are small shared loads: a worker's farm-step ability is only a must-have if nobody
    // else in the team could take its share. Check with the part-time flow: this worker without that
    // ability, every part-time Aniimo keeping its processor work as it is (only farm steps move), within
    // the farm-helper cap and the rest of each one's day, using only must-have abilities. Dropped abilities
    // stay dropped for later checks.
    const settings = { ...DEFAULT_SETTINGS, ...(result?.diagnostics?.settings || {}), ...(options.settings || {}) };
    const farmCap = farmCapOf(settings);
    const farmTasks = new Map();
    for (const tasks of tasksOf.values()) {
      for (const task of tasks) {
        if (task.kind === "processor") continue;
        const key = `${task.buildingId}:${task.skill}`;
        const entry = farmTasks.get(key) || { ...task, id: key, load: 0 };
        entry.load += Number(task.load || 0);
        farmTasks.set(key, entry);
      }
    }
    const teamFarmSkills = [...new Set([...farmTasks.values()].map((task) => task.skill))].sort(skillOrder);
    if (farmTasks.size) {
      const partTimers = roles.filter((role) => !jobOf.has(role.worker.workerId));
      const dropped = new Map(partTimers.map((role) => [role.index, new Set()]));
      const farmStillFits = () => {
        const tasks = [...farmTasks.values()];
        const available = partTimers.map((role) => {
          const fixed = `__processor_${role.index}`;
          // Judged on what each Aniimo is required to have (not its bonus abilities), so any Aniimo meeting
          // the lines below can still cover the farm steps.
          const skillsNow = { ...Object.fromEntries(role.essential), [fixed]: 1 };
          for (const skill of dropped.get(role.index)) delete skillsNow[skill];
          const load = (tasksOf.get(role.worker.workerId) || []).filter((task) => task.kind === "processor").reduce((sum, task) => sum + Number(task.load || 0), 0);
          if (load > 0) tasks.push({ id: fixed, kind: "processor", skill: fixed, minLevel: 1, load });
          return { ...role.worker, skills: skillsNow };
        });
        return assignPartTimeFlow(available, tasks, farmCap, true).ok;
      };
      for (const role of partTimers) {
        for (const skill of [...role.farmOnly]) {
          dropped.get(role.index).add(skill);
          if (farmStillFits()) {
            role.essential.delete(skill);
            role.farmOnly.delete(skill);
          } else {
            dropped.get(role.index).delete(skill);
          }
        }
      }
    }
    const teamFarmCovered = teamFarmSkills.filter((skill) => !roles.some((role) => role.farmOnly.has(skill)));

    // 2a. Extras a single swap would lose a target over.
    for (const role of roles) {
      for (const skill of skills) {
        const extra = level(role.worker, skill) - (role.essential.get(skill) || 0);
        if (extra <= 0 || target(skill) <= 0) continue;
        if (planTotals.get(skill) - extra < target(skill)) {
          role.essential.set(skill, level(role.worker, skill));
          role.farmOnly.delete(skill);
          role.forTarget.add(skill);
        }
      }
    }

    const poolEntries = (pool || []).slice();
    const formsBySpecies = new Map();
    for (const entry of poolEntries) {
      const name = entry.species || entry.name;
      if (!formsBySpecies.has(name)) formsBySpecies.set(name, []);
      formsBySpecies.get(name).push(entry);
    }
    const requirementKey = (role) =>
      [
        [...role.essential].sort((a, b) => skillOrder(a[0], b[0])).map(([skill, value]) => `${skill}${value}${role.forTarget.has(skill) ? "*" : ""}`).join("+"),
        role.species ? role.species.slice().sort().join("/") : "",
      ].join("|");
    const profileOf = (entry) => new Map(skills.map((skill) => [skill, level(entry, skill)]));

    // The pool Aniimo meeting a requirement, as tiers of identical ability profiles, best first.
    function tiersFor(role, examples) {
      const essential = role.essential;
      const allowed = role.species;
      const meets = (entry) =>
        (!allowed || allowed.includes(entry.species || entry.name)) && [...essential].every(([skill, value]) => level(entry, skill) >= value);
      const candidates = poolEntries.filter(meets);
      for (const worker of examples) {
        if (!candidates.some((entry) => entry.id === worker.aniimoId)) candidates.push({ ...worker, id: worker.aniimoId });
      }
      const rank = (entry) => {
        let must = 0;
        let useful = 0;
        let weighted = 0;
        for (const skill of skills) {
          const value = level(entry, skill);
          if (essential.has(skill)) must += value;
          else if (skill !== "Hauling" && value > 0 && (demand.get(skill) || 0) > 0) {
            useful += value;
            weighted += value * demand.get(skill);
          }
        }
        return [must, level(entry, "Hauling"), useful, weighted, totalSkillPower(entry, skills)];
      };
      const tierMap = new Map();
      for (const entry of candidates) {
        const key = skills.map((skill) => level(entry, skill)).join(",");
        if (!tierMap.has(key)) tierMap.set(key, { entries: [], rank: rank(entry), profile: profileOf(entry) });
        tierMap.get(key).entries.push(entry);
      }
      return { candidates, tiers: [...tierMap.values()].sort((a, b) => compareQualityKeys(b.rank, a.rank)) };
    }

    // 2b. If everyone took the recommended (best-tier) Aniimo, would every target still be met? If not,
    // the Aniimo holding the most of a short ability keep it as a must-have.
    const bestProfile = new Map();
    const refreshBest = () => {
      const byKey = new Map();
      for (const role of roles) {
        const key = requirementKey(role);
        if (!byKey.has(key)) byKey.set(key, tiersFor(role, roles.filter((other) => requirementKey(other) === key).map((other) => other.worker)).tiers[0]);
        bestProfile.set(role.index, byKey.get(key)?.profile || profileOf(role.worker));
      }
    };
    refreshBest();
    for (const skill of skills) {
      if (target(skill) <= 0) continue;
      let covered = roles.reduce((sum, role) => sum + (bestProfile.get(role.index).get(skill) || 0), 0);
      if (covered >= target(skill)) continue;
      const holders = roles
        .filter((role) => level(role.worker, skill) > (bestProfile.get(role.index).get(skill) || 0))
        .sort((a, b) => level(b.worker, skill) - level(a.worker, skill) || a.index - b.index);
      for (const role of holders) {
        if (covered >= target(skill)) break;
        covered += level(role.worker, skill) - (bestProfile.get(role.index).get(skill) || 0);
        role.essential.set(skill, level(role.worker, skill));
        role.farmOnly.delete(skill);
        role.forTarget.add(skill);
      }
    }

    // 3. Each Aniimo's target personality: the one wanted where it does most of its work.
    for (const role of roles) {
      const byPersonality = new Map();
      for (const item of role.work.values()) {
        const entry = byPersonality.get(item.personality) || { personality: item.personality, load: 0, top: 0 };
        entry.load += item.load;
        entry.top = Math.max(entry.top, item.load);
        byPersonality.set(item.personality, entry);
      }
      const best = [...byPersonality.values()].sort(
        (a, b) => b.load - a.load || b.top - a.top || (a.personality ? 0 : 1) - (b.personality ? 0 : 1) || a.personality.localeCompare(b.personality)
      )[0];
      role.personality = best ? best.personality : "";
    }

    // 4. Requirement groups, then one line per target personality within each.
    const groups = new Map();
    for (const role of roles) {
      const key = requirementKey(role);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(role);
    }
    const abilityList = (map) =>
      [...map].filter(([, value]) => value > 0).sort((a, b) => skillOrder(a[0], b[0])).map(([skill, value]) => `${skill} ${value}`).join(", ");
    const joinOr = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`);

    const lines = [];
    let groupOrder = 0;
    for (const members of groups.values()) {
      const first = members[0];
      const essential = first.essential;
      const allowed = first.species;
      const { candidates, tiers } = tiersFor(first, members.map((role) => role.worker));

      // Names for a tier, collapsing forms: "Flamerion (any form)", "Scorchhowl (other forms)".
      const named = new Set();
      const tierNames = (entries) => {
        const bySpecies = new Map();
        for (const entry of entries) {
          const name = entry.species || entry.name;
          if (!bySpecies.has(name)) bySpecies.set(name, []);
          bySpecies.get(name).push(entry);
        }
        const names = [];
        for (const [name, forms] of [...bySpecies].sort((a, b) => a[0].localeCompare(b[0]))) {
          const all = formsBySpecies.get(name) || forms;
          const earlier = all.filter((entry) => named.has(entry.id));
          if (forms.length >= all.length) names.push(all.length > 1 ? `${name} (any form)` : displayWorkerName(forms[0]));
          else if (earlier.length && earlier.length + forms.length >= all.length) names.push(`${name} (other forms)`);
          else if (forms.length === 1) names.push(displayWorkerName(forms[0]));
          else names.push(`${name} (${forms.map((entry) => entry.form || "Base").join(", ")})`);
        }
        for (const entry of entries) named.add(entry.id);
        return names;
      };
      const best = tiers[0];
      const headlineNames = tierNames(best.entries);
      const bonus = new Map([...best.profile].filter(([skill, value]) => value > 0 && !essential.has(skill)));
      // A fallback that would leave a target short if it replaced one of these Aniimo isn't offered.
      const keepsTargets = (profile) =>
        members.every((role) =>
          skills.every((skill) => target(skill) <= 0 || planTotals.get(skill) - level(role.worker, skill) + (profile.get(skill) || 0) >= target(skill))
        );
      const fallbacks = tiers
        .slice(1)
        .filter((tier) => keepsTargets(tier.profile))
        .map((tier) => ({
          names: tierNames(tier.entries),
          abilities: abilityList(tier.profile),
          mustOnly: [...tier.profile].every(([skill, value]) => value <= 0 || essential.has(skill)),
          aniimoIds: tier.entries.map((entry) => entry.id),
        }));

      // Why a specific species is named.
      let reason = null;
      const speciesNames = [...new Set(candidates.map((entry) => entry.species || entry.name))];
      if (allowed) {
        const line = candidates.find((entry) => entry.evolutionLine)?.evolutionLine;
        const family = speciesNames.length === 1 ? speciesNames[0] : line ? line.replace(/ line$/, "") : allowed[0];
        reason = `Only the ${family} family can work the ${first.familyBuildings.join(" and ")}.`;
      } else if (speciesNames.length === 1) {
        reason = `Only ${speciesNames[0]} has ${abilityList(essential)} among your Available Aniimo.`;
      }

      const essentialText = [...essential].sort((a, b) => skillOrder(a[0], b[0])).map(([skill, value]) => `${skill} ${value}`).join(" + ");
      const targetNotes = [
        ...[...first.forTarget].sort(skillOrder).map((skill) => `${skill} ${essential.get(skill)} needed for the ${skill} target`),
        ...[...first.farmOnly].sort(skillOrder).map((skill) => `${skill} for farm steps`),
      ];
      const abilitiesText = [
        `${essentialText} essential${targetNotes.length ? ` (${targetNotes.join("; ")})` : ""}`,
        bonus.size ? `${abilityList(bonus)} bonus` : "",
      ].filter(Boolean).join(" · ");
      const shownFallbacks = fallbacks.slice(0, 4);
      const fallbackParts = shownFallbacks.map((tier) => (tier.mustOnly ? `${essentialText} only: ${tier.names.join(", ")}` : `${tier.names.join(", ")} — ${tier.abilities}`));
      if (fallbacks.length > shownFallbacks.length) fallbackParts.push(`+${fallbacks.length - shownFallbacks.length} more`);

      const byPersonality = new Map();
      for (const role of members) {
        if (!byPersonality.has(role.personality)) byPersonality.set(role.personality, []);
        byPersonality.get(role.personality).push(role);
      }
      const groupIndex = groupOrder;
      groupOrder += 1;
      for (const [personality, split] of byPersonality) {
        // Where they work: full-time buildings, then part-time ones by share of the day.
        const fullTime = new Map();
        const partTime = new Map();
        let boosters = 0;
        const personalityBuildings = new Map();
        for (const role of split) {
          const job = jobOf.get(role.worker.workerId);
          if (job) fullTime.set(job.name, (fullTime.get(job.name) || 0) + 1);
          for (const task of tasksOf.get(role.worker.workerId) || []) {
            partTime.set(task.buildingName, (partTime.get(task.buildingName) || 0) + Number(task.load || 0));
          }
          if (!role.work.size) boosters += 1;
          for (const item of role.work.values()) {
            if (item.personality === personality) personalityBuildings.set(item.name, (personalityBuildings.get(item.name) || 0) + item.load);
          }
        }
        const partTimeNames = [...partTime].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
        const jobParts = [...fullTime].map(([name, count]) => `${name}${count > 1 ? ` ×${count}` : ""}`);
        if (partTimeNames.length) jobParts.push(`part-time: ${partTimeNames.join(", ")}`);
        if (boosters) jobParts.push("ability points for your targets");
        const buildings = [...personalityBuildings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
        const personalityText = personality
          ? `look for ${personality} — ${buildings.join(", ")}`
          : buildings.length
            ? `no personality bonus — ${buildings.join(", ")}`
            : "no personality bonus";

        lines.push({
          count: split.length,
          essential: [...essential].sort((a, b) => skillOrder(a[0], b[0])).map(([skill, value]) => ({ skill, level: value, forTarget: first.forTarget.has(skill), farmSteps: first.farmOnly.has(skill) })),
          species: allowed ? allowed.slice() : null,
          reason,
          headline: { names: headlineNames, aniimoIds: best.entries.map((entry) => entry.id), abilities: abilityList(best.profile) },
          bonus: [...bonus].sort((a, b) => skillOrder(a[0], b[0])).map(([skill, value]) => ({ skill, level: value })),
          fallbacks,
          personality: personality || null,
          personalityBuildings: buildings,
          jobs: { fullTime: [...fullTime].map(([name, count]) => ({ name, count })), partTime: partTimeNames, boosters },
          examples: split.map((role) => role.worker),
          group: groupIndex,
          groupCount: members.length,
          firstIndex: split[0].index,
          text: {
            headline: `${split.length}× ${joinOr(headlineNames)}`,
            personality: personalityText,
            abilities: abilitiesText,
            jobs: jobParts.join(" · "),
            alsoFine: fallbackParts.length ? `Also fine: ${fallbackParts.join(" · ")}` : "",
            examples: `e.g. ${[...new Set(split.map((role) => displayWorkerName(role.worker)))].join(", ")}`,
          },
        });
      }
    }

    // Requirement groups stay together: full-time groups first, bigger groups first, then plan order;
    // within a group, the most Aniimo first.
    const groupFirst = new Map();
    for (const line of lines) {
      const current = groupFirst.get(line.group);
      if (!current) groupFirst.set(line.group, { fullTime: line.jobs.fullTime.length > 0, count: line.groupCount, index: line.firstIndex });
      else {
        current.fullTime = current.fullTime || line.jobs.fullTime.length > 0;
        current.index = Math.min(current.index, line.firstIndex);
      }
    }
    lines.sort((a, b) => {
      const ga = groupFirst.get(a.group);
      const gb = groupFirst.get(b.group);
      return (
        (gb.fullTime ? 1 : 0) - (ga.fullTime ? 1 : 0) ||
        gb.count - ga.count ||
        ga.index - gb.index ||
        b.count - a.count ||
        (a.personality ? 0 : 1) - (b.personality ? 0 : 1) ||
        a.firstIndex - b.firstIndex
      );
    });
    const farmNote = teamFarmCovered.length
      ? `Farm steps (${teamFarmCovered.join(", ")}) need no extra ability: the team already covers them.`
      : "";
    return { lines, farmSteps: { skills: teamFarmSkills, covered: teamFarmCovered, note: farmNote } };
  }

  return {
    DEFAULT_SKILLS,
    DEFAULT_SETTINGS,
    DEFAULT_HOMEBUILDING_ZONE_NAME,
    aniimoCategory,
    assignContinuous,
    assignIntermittent,
    buildWorkModel,
    buildingLevelForRv,
    buildingMaxForRv,
    buildingRole,
    describeCapacityPlan,
    familyEligibility,
    farmHelperLowerBound,
    filterAniimoPool,
    isInPool,
    poolStatus,
    optimizeWorkforce,
    personalityRecommendations,
    planForCapacity,
    planProcessorOptions,
    PROCESSOR_LEVELS,
    planningCopyCap,
    recommendSpareSpaces,
    resolveHomelandCapacity,
    summariseRecommendations,
    summarizeShortfalls,
  };
});
