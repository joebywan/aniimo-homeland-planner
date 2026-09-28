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

  const DEFAULT_SETTINGS = {
    mode: "owned",
    theorycraftCopies: 1,
    actionDurationSeconds: 5,
    cycleDurationMinutes: 20,
    overheadMultiplier: 1,
    maxUtilizationPercent: 50,
    allowIntermittentMultiSkill: true,
    beamWidth: 1000,
    maxSearchWorkers: 30,
  };

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

  function buildWorkers(aniimo, roster, settings, skills) {
    const workers = [];
    const theorycraftCopies = Math.floor(clampNumber(settings.theorycraftCopies, 1, 1, 9));

    for (const entry of aniimo) {
      const ownedState = roster?.[entry.id] || {};
      if (ownedState.excluded) continue;

      const ownedQuantity = Math.floor(clampNumber(ownedState.quantity, 0, 0, 99));
      const quantity =
        settings.mode === "theorycraft" ? Math.max(ownedQuantity, theorycraftCopies) : ownedQuantity;

      for (let copy = 1; copy <= quantity; copy += 1) {
        workers.push({
          workerId: `${entry.id}#${copy}`,
          aniimoId: entry.id,
          copy,
          name: entry.name,
          form: entry.form,
          image: entry.image || "",
          skills: cloneSkillMap(skills, entry.skills),
          totalSkill: skills.reduce((sum, skill) => sum + Number(entry.skills?.[skill] || 0), 0),
        });
      }
    }

    return workers;
  }

  function getBuildingState(building, state) {
    const saved = state?.[building.id] || {};
    return {
      enabled: saved.enabled ?? building.defaultEnabled ?? true,
      count: Math.floor(clampNumber(saved.count ?? building.defaultCount ?? 0, 0, 0, 999)),
    };
  }

  function buildWorkModel(buildings, buildingState, settings) {
    const continuousJobs = [];
    const intermittentByKey = new Map();
    const actionSeconds = clampNumber(settings.actionDurationSeconds, 5, 0.1, 3600);
    const cycleSeconds = clampNumber(settings.cycleDurationMinutes, 20, 0.1, 10080) * 60;
    const overhead = clampNumber(settings.overheadMultiplier, 1, 0.1, 20);

    for (const building of buildings || []) {
      const state = getBuildingState(building, buildingState);
      if (!state.enabled || state.count <= 0) continue;

      if (building.behavior === "continuous") {
        const slots = Math.max(1, Number(building.slotsPerUnit || 1));
        for (let unit = 1; unit <= state.count; unit += 1) {
          for (let slot = 1; slot <= slots; slot += 1) {
            continuousJobs.push({
              id: `${building.id}:${unit}:${slot}`,
              buildingId: building.id,
              name: building.name,
              label: `${building.name} ${state.count > 1 || slots > 1 ? `${unit}.${slot}` : ""}`.trim(),
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
    };
  }

  function workerCanDoJob(worker, job) {
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

    const jobs = continuousJobs
      .map((job) => ({
        job,
        candidates: selectedWorkers
          .filter((worker) => workerCanDoJob(worker, job))
          .sort((a, b) => {
            const aSpecialization = countMatchingContinuousSkills(a, continuousJobs);
            const bSpecialization = countMatchingContinuousSkills(b, continuousJobs);
            return (
              aSpecialization - bSpecialization ||
              jobMatchLevel(a, job) - jobMatchLevel(b, job) ||
              totalSkillPower(a, DEFAULT_SKILLS) - totalSkillPower(b, DEFAULT_SKILLS) ||
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

    const used = new Set();
    const assignments = new Map();
    let explored = 0;
    const maxStates = 100000;

    function backtrack(index) {
      explored += 1;
      if (explored > maxStates) return false;
      if (index >= jobs.length) return true;

      const { job, candidates } = jobs[index];
      for (const worker of candidates) {
        if (used.has(worker.workerId)) continue;
        used.add(worker.workerId);
        assignments.set(job.id, { job, worker });
        if (backtrack(index + 1)) return true;
        assignments.delete(job.id);
        used.delete(worker.workerId);
      }

      return false;
    }

    const ok = backtrack(0);
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
      while (remaining > 0.0001) {
        const load = Math.min(maxLoad, remaining);
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

    const maxLoad = clampNumber(settings.maxUtilizationPercent, 50, 1, 100) / 100;
    const allowMultiSkill = settings.allowIntermittentMultiSkill !== false;
    const available = selectedWorkers.filter((worker) => !busyWorkerIds.has(worker.workerId));
    const chunks = splitIntermittentTasks(intermittentTasks, maxLoad)
      .map((chunk) => ({
        ...chunk,
        candidates: available.filter((worker) => Number(worker.skills?.[chunk.skill] || 0) > 0),
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
      loadState.set(worker.workerId, { worker, total: 0, skills: new Set(), chunks: [] });
    }

    let explored = 0;
    const maxStates = 120000;

    function canTake(workerState, chunk) {
      if (workerState.total + chunk.load > maxLoad + 0.000001) return false;
      if (!allowMultiSkill && workerState.skills.size > 0 && !workerState.skills.has(chunk.skill)) return false;
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

        workerState.total += chunk.load;
        workerState.skills.add(chunk.skill);
        workerState.chunks.push(chunk);

        if (backtrack(index + 1)) return true;

        workerState.total -= chunk.load;
        workerState.chunks.pop();
        workerState.skills = new Set(workerState.chunks.map((item) => item.skill));
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

  function summarizeIntermittent(loadState) {
    const assignments = [];
    for (const state of loadState.values()) {
      if (!state.chunks.length) continue;
      const bySkill = new Map();
      for (const chunk of state.chunks) {
        const key = `${chunk.buildingId}:${chunk.skill}`;
        const current = bySkill.get(key) || {
          buildingId: chunk.buildingId,
          buildingName: chunk.buildingName,
          skill: chunk.skill,
          label: chunk.label,
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
        score: scoreCandidate(worker, relevantSkills, model, requirements),
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

  function approximateStateScore(state, candidates, requirements, skills, model, settings) {
    let deficit = 0;
    let surplus = 0;
    for (const skill of skills) {
      const required = Number(requirements?.[skill] || 0);
      const available = Number(state.totals?.[skill] || 0);
      deficit += Math.max(0, required - available);
      surplus += Math.max(0, available - required);
    }

    const selected = state.indices.map((index) => candidates[index]);
    let continuousShortage = 0;
    for (const job of model.continuousJobs) {
      const compatible = selected.filter((worker) => workerCanDoJob(worker, job)).length;
      if (!compatible) continuousShortage += 1;
    }

    const maxLoad = clampNumber(settings.maxUtilizationPercent, 50, 1, 100) / 100;
    let intermittentShortage = 0;
    for (const task of model.intermittentTasks) {
      const compatible = selected.filter((worker) => Number(worker.skills?.[task.skill] || 0) > 0).length;
      intermittentShortage += Math.max(0, Math.ceil(task.load / maxLoad) - compatible);
    }

    return deficit * 1000 + continuousShortage * 700 + intermittentShortage * 500 + surplus * 9;
  }

  function stateKey(state, candidates, requirements, skills, model, settings) {
    const skillPart = skills
      .map((skill) => {
        const cap = Number(requirements?.[skill] || 0) + 4;
        return Math.min(Number(state.totals?.[skill] || 0), cap);
      })
      .join(",");

    const jobSkills = new Set();
    for (const job of model.continuousJobs) {
      for (const requirement of job.requirements || []) jobSkills.add(requirement.skill);
    }
    for (const task of model.intermittentTasks) jobSkills.add(task.skill);

    const selected = state.indices.map((index) => candidates[index]);
    const countPart = [...jobSkills]
      .sort()
      .map((skill) => {
        const needed =
          model.continuousJobs.filter((job) => (job.requirements || []).some((requirement) => requirement.skill === skill))
            .length + model.intermittentTasks.filter((task) => task.skill === skill).length;
        const count = selected.filter((worker) => Number(worker.skills?.[skill] || 0) > 0).length;
        return `${skill}:${Math.min(count, needed + 2)}`;
      })
      .join(",");

    return `${skillPart}|${countPart}|${state.indices.length}`;
  }

  function validateSelection(state, candidates, requirements, skills, model, settings) {
    const selectedWorkers = state.indices.map((index) => candidates[index]);
    const skillCoverage = computeSkillCoverage(state.totals, requirements, skills);
    const targetsOk = skillTargetsMet(state.totals, requirements, skills);
    const continuous = assignContinuous(selectedWorkers, model.continuousJobs);
    const intermittent = continuous.ok
      ? assignIntermittent(selectedWorkers, model.intermittentTasks, continuous.busyWorkerIds, settings)
      : { ok: false, assignments: [], unfilled: model.intermittentTasks, workerLoads: new Map() };

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
      if (row.missing > 0) missing.push(`${row.skill}: ${row.missing} skill point${row.missing === 1 ? "" : "s"}`);
    }
    for (const job of continuous.unfilled || []) {
      const skills = (job.requirements || []).map((requirement) => requirement.skill).join("/");
      missing.push(`${job.label}: 1 ${skills} body`);
    }
    for (const task of intermittent.unfilled || []) {
      missing.push(`${task.label}: shared ${task.skill} worker load`);
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

      let primaryAssignment = "Capability reserve";
      const secondaryAssignments = [];

      if (continuousJob) {
        primaryAssignment = continuousJob.label;
      }

      if (intermittent) {
        const taskLabels = intermittent.tasks.map((task) => `${task.skill} ${formatPercent(task.load)}`);
        if (primaryAssignment === "Capability reserve") {
          primaryAssignment = "Shared workload pool";
        }
        secondaryAssignments.push(...taskLabels);
      }

      const reasonParts = [];
      if (continuousJob) reasonParts.push(`fills ${continuousJob.label}`);
      if (intermittent) reasonParts.push(`covers ${formatPercent(intermittent.totalLoad)} shared load`);
      if (contributingSkills.length) reasonParts.push(`adds ${contributingSkills.join(", ")}`);
      if (!reasonParts.length) reasonParts.push("keeps estimated requirement coverage complete");

      return {
        ...worker,
        displayName: displayWorkerName(worker),
        primaryAssignment,
        secondaryAssignments,
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
        need: 0,
        assigned: 0,
        type: "Continuous",
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
        needLabel: `${group.need} body${group.need === 1 ? "" : "ies"}`,
        assignedLabel: `${group.assigned}`,
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
        label: task.label,
        type: "Intermittent",
        need: task.load,
        assigned,
        needLabel: formatPercent(task.load),
        assignedLabel: formatPercent(assigned),
        status: assigned + 0.0001 >= task.load ? "OK" : "Missing",
      });
    }

    return rows.sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
  }

  function buildPartialResult(state, candidates, allWorkers, requirements, skills, model, settings) {
    const result = validateSelection(state, candidates, requirements, skills, model, settings);
    return finalizeResult(false, result, state, candidates, allWorkers, requirements, skills, model, settings, {
      note: "No complete solution was found inside the current search limit.",
    });
  }

  function finalizeResult(feasible, result, state, candidates, allWorkers, requirements, skills, model, settings, diagnostics) {
    const selectedIds = new Set(result.selectedWorkers.map((worker) => worker.workerId));
    const unusedWorkers = allWorkers.filter((worker) => !selectedIds.has(worker.workerId));
    const selectedWorkers = decorateSelectedWorkers(result, requirements, skills);

    return {
      feasible,
      selectedWorkers,
      unusedWorkers,
      skillCoverage: result.skillCoverage,
      physicalStaffing: summarizePhysicalStaffing(model, result.continuous, result.intermittent),
      continuousAssignments: result.continuous.assignments || [],
      intermittentAssignments: result.intermittent.assignments || [],
      missing: result.missing,
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
  }

  function optimizeWorkforce(input) {
    const skills = input.skills || DEFAULT_SKILLS;
    const requirements = cloneSkillMap(skills, input.requirements || {});
    const settings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
    const model = buildWorkModel(input.buildings || [], input.buildingState || {}, settings);
    const allWorkers = buildWorkers(input.aniimo || [], input.roster || {}, settings, skills);
    const relevantSkills = relevantSkillSet(requirements, model);
    let candidates = sortAndFilterCandidates(allWorkers, relevantSkills, model, requirements);

    if (settings.mode === "theorycraft") {
      candidates = candidates.slice(0, Math.max(20, Math.min(120, Number(settings.theorycraftCandidateLimit || 80))));
    }

    const emptyState = {
      indices: [],
      last: -1,
      totals: emptySkillMap(skills),
    };

    if (!candidates.length) {
      const emptyResult = validateSelection(emptyState, candidates, requirements, skills, model, settings);
      return finalizeResult(emptyResult.ok, emptyResult, emptyState, candidates, allWorkers, requirements, skills, model, settings, {
        note: "No relevant Aniimo workers are available.",
      });
    }

    const maxDepth = Math.min(
      candidates.length,
      Math.floor(clampNumber(settings.maxSearchWorkers, DEFAULT_SETTINGS.maxSearchWorkers, 1, 80))
    );
    const beamWidth = Math.floor(clampNumber(settings.beamWidth, DEFAULT_SETTINGS.beamWidth, 100, 20000));
    let beam = [emptyState];
    let bestPartial = emptyState;
    let bestPartialScore = Infinity;

    for (let depth = 0; depth <= maxDepth; depth += 1) {
      const solutions = [];

      for (const state of beam) {
        const stateScore = approximateStateScore(state, candidates, requirements, skills, model, settings);
        if (stateScore < bestPartialScore) {
          bestPartialScore = stateScore;
          bestPartial = state;
        }

        const validation = validateSelection(state, candidates, requirements, skills, model, settings);
        if (validation.ok) {
          solutions.push(validation);
        }
      }

      if (solutions.length) {
        solutions.sort((a, b) => solutionSort(a, b, skills));
        const winning = solutions[0];
        const state = beam.find((candidateState) => {
          const ids = candidateState.indices.map((index) => candidates[index]).map((worker) => worker.workerId).join("|");
          const solutionIds = winning.selectedWorkers.map((worker) => worker.workerId).join("|");
          return ids === solutionIds;
        }) || beam[0];

        return finalizeResult(true, winning, state, candidates, allWorkers, requirements, skills, model, settings, {
          note: "Solution found with beam search.",
        });
      }

      if (depth === maxDepth) break;

      const nextStates = [];
      for (const state of beam) {
        for (let index = state.last + 1; index < candidates.length; index += 1) {
          const worker = candidates[index];
          nextStates.push({
            indices: state.indices.concat(index),
            last: index,
            totals: addSkills(state.totals, worker, skills),
          });
        }
      }

      nextStates.sort((a, b) => {
        return (
          approximateStateScore(a, candidates, requirements, skills, model, settings) -
            approximateStateScore(b, candidates, requirements, skills, model, settings) ||
          a.indices.length - b.indices.length
        );
      });

      const seen = new Set();
      beam = [];
      for (const state of nextStates) {
        const key = stateKey(state, candidates, requirements, skills, model, settings);
        if (seen.has(key)) continue;
        seen.add(key);
        beam.push(state);
        if (beam.length >= beamWidth) break;
      }
    }

    return buildPartialResult(bestPartial, candidates, allWorkers, requirements, skills, model, settings);
  }

  return {
    DEFAULT_SKILLS,
    DEFAULT_SETTINGS,
    assignContinuous,
    assignIntermittent,
    buildWorkModel,
    optimizeWorkforce,
  };
});
