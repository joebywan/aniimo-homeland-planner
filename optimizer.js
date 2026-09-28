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
    actionDurationSeconds: 5,
    cycleDurationMinutes: 20,
    overheadMultiplier: 1,
    maxUtilizationPercent: 50,
    allowIntermittentMultiSkill: true,
    beamWidth: 1000,
    maxSearchWorkers: 30,
    theorycraftCandidateLimit: 80,
  };

  const DEFAULT_HOMEBUILDING_ZONE_NAME = "Homebuilding Zone";

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

  // In planning ("theorycraft") mode unowned Aniimo are treated as unlimited. To keep the search
  // fast we only generate as many copies of a form as could ever be useful: the number of bodies
  // that the skills it has could possibly fill, capped at the search depth.
  function planningCopyCap(entry, model, requirements, settings, skills) {
    const maxWorkers = Math.floor(clampNumber(settings.maxSearchWorkers, DEFAULT_SETTINGS.maxSearchWorkers, 1, 80));
    const maxLoad = clampNumber(settings.maxUtilizationPercent, 50, 1, 100) / 100;
    let best = 0;

    for (const skill of skills) {
      const level = Number(entry.skills?.[skill] || 0);
      if (level <= 0) continue;
      let bodies = 0;
      for (const job of model.continuousJobs) {
        if ((job.requirements || []).some((req) => req.skill === skill && level >= Number(req.minLevel || 1))) {
          bodies += 1;
        }
      }
      for (const task of model.intermittentTasks) {
        if (task.skill === skill) bodies += Math.ceil(task.load / maxLoad - 0.000001);
      }
      bodies += Math.ceil(Number(requirements?.[skill] || 0) / level);
      best = Math.max(best, bodies);
    }

    return Math.max(1, Math.min(maxWorkers, best));
  }

  function buildWorkers(aniimo, roster, settings, skills, copyCapFor) {
    const workers = [];

    for (const entry of aniimo) {
      const ownedState = roster?.[entry.id] || {};
      if (ownedState.excluded) continue;

      const ownedQuantity = Math.floor(clampNumber(ownedState.quantity, 0, 0, 99));
      const planningCopies = settings.mode === "theorycraft" ? (copyCapFor ? copyCapFor(entry) : 1) : 0;
      const quantity = Math.max(ownedQuantity, planningCopies);

      for (let copy = 1; copy <= quantity; copy += 1) {
        workers.push({
          workerId: `${entry.id}#${copy}`,
          aniimoId: entry.id,
          copy,
          name: entry.name,
          form: entry.form,
          image: entry.image || "",
          owned: copy <= ownedQuantity,
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
              label: `${building.name} ${slots > 1 ? `${unit}.${slot}` : state.count > 1 ? `${unit}` : ""}`.trim(),
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
        // Later copies of the same form are progressively less likely to be needed, so they rank
        // lower. This lets a strong form's second copy appear before a weak form's first copy.
        score: scoreCandidate(worker, relevantSkills, model, requirements) / Math.max(1, Number(worker.copy || 1)),
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

      if (continuousJob) {
        primaryAssignment = continuousJob.label;
      } else if (intermittent) {
        primaryAssignment = "Farm helper";
      }

      if (intermittent) {
        secondaryAssignments.push(
          ...intermittent.tasks.map((task) => `${task.label} – ${formatPercent(task.load)} of the day`)
        );
      }

      const reasonParts = [];
      if (continuousJob) reasonParts.push(`works ${continuousJob.label} full time`);
      if (intermittent) reasonParts.push(`busy about ${formatPercent(intermittent.totalLoad)} of the day on farm jobs`);
      if (contributingSkills.length) reasonParts.push(`adds ${contributingSkills.join(", ")}`);
      if (!reasonParts.length) reasonParts.push("needed to reach your requirement targets");

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
    const allWorkers = buildWorkers(input.aniimo || [], input.roster || {}, settings, skills, (entry) =>
      planningCopyCap(entry, model, requirements, settings, skills)
    );
    const relevantSkills = relevantSkillSet(requirements, model);
    let candidates = sortAndFilterCandidates(allWorkers, relevantSkills, model, requirements);

    if (settings.mode === "theorycraft") {
      candidates = candidates.slice(0, Math.max(20, Math.min(120, Number(settings.theorycraftCandidateLimit || 80))));
    }
    // Keep copies of the same form in ascending order so the index-ordered search picks #1 before #2.
    candidates = orderCopies(candidates);

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
    const indexByWorkerId = new Map(candidates.map((worker, index) => [worker.workerId, index]));
    const previousCopyIndex = candidates.map((worker) => {
      if (worker.copy <= 1) return -1;
      const index = indexByWorkerId.get(`${worker.aniimoId}#${worker.copy - 1}`);
      return index === undefined ? -1 : index;
    });
    let beam = [emptyState];
    let bestPartial = emptyState;
    let bestPartialScore = Infinity;

    for (let depth = 0; depth <= maxDepth; depth += 1) {
      const solutions = [];

      for (const state of beam) {
        const stateScore =
          state.score ?? approximateStateScore(state, candidates, requirements, skills, model, settings);
        if (stateScore < bestPartialScore) {
          bestPartialScore = stateScore;
          bestPartial = state;
        }

        // Full staffing validation is expensive; it can only pass once the skill targets are met.
        if (!skillTargetsMet(state.totals, requirements, skills)) continue;
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
          // Copies are interchangeable: only allow copy #n once copy #n-1 is already selected.
          const previous = previousCopyIndex[index];
          if (previous >= 0 && !state.indices.includes(previous)) continue;
          nextStates.push({
            indices: state.indices.concat(index),
            last: index,
            totals: addSkills(state.totals, worker, skills),
          });
        }
      }

      for (const state of nextStates) {
        state.score = approximateStateScore(state, candidates, requirements, skills, model, settings);
      }
      nextStates.sort((a, b) => a.score - b.score || a.indices.length - b.indices.length);

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

  function positiveIntegerOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.floor(numeric);
  }

  // Works out how many Aniimo the homeland can hold. A manual number always wins; otherwise the
  // RV level is looked up in the (optional, possibly incomplete) homeland data file.
  function resolveHomelandCapacity(homelandData, rvLevel, manualCapacity) {
    const manual = positiveIntegerOrNull(manualCapacity);
    if (manual !== null && manual > 0) {
      return { capacity: manual, source: "manual", known: true };
    }

    const level = positiveIntegerOrNull(rvLevel);
    const levels = Array.isArray(homelandData?.rvLevels) ? homelandData.rvLevels : [];
    const entry = level === null ? null : levels.find((item) => Number(item?.level) === level);
    const fromData = positiveIntegerOrNull(entry?.aniimoCapacity);
    if (fromData !== null && fromData > 0) {
      return { capacity: fromData, source: "rvLevel", known: true, level };
    }

    return { capacity: null, source: "unknown", known: false, level };
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

    // Pool of spare Aniimo. Owned Aniimo come first; in planning mode unowned ones follow.
    const pool = (result.unusedWorkers || [])
      .filter((worker) => input.mode === "theorycraft" || worker.owned !== false)
      .slice()
      .sort((a, b) => Number(b.owned !== false) - Number(a.owned !== false));
    const taken = new Set();
    // Only one copy of each unowned form per suggestion list keeps the advice readable.
    const available = () => pool.filter((worker) => !taken.has(worker.workerId));
    const take = (worker) => taken.add(worker.workerId);
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
        // Unowned Aniimo are only worth catching for the zone if they suit it, so stick to owned ones.
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
    const seenUnownedForms = new Set();
    for (const worker of haulers) {
      if (remaining <= 0) break;
      if (worker.owned === false) {
        if (seenUnownedForms.has(worker.aniimoId)) continue;
        seenUnownedForms.add(worker.aniimoId);
      }
      take(worker);
      remaining -= 1;
      base.haulers.push(spareEntry(worker, `Hauling ${worker.skills.Hauling}: moves goods between buildings faster`));
    }

    base.unfilled = Math.max(0, remaining);
    return base;
  }

  return {
    DEFAULT_SKILLS,
    DEFAULT_SETTINGS,
    DEFAULT_HOMEBUILDING_ZONE_NAME,
    assignContinuous,
    assignIntermittent,
    buildWorkModel,
    optimizeWorkforce,
    planningCopyCap,
    recommendSpareSpaces,
    resolveHomelandCapacity,
  };
});
