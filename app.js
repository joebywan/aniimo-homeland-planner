(function initPlanner() {
  const STORAGE_KEY = "aniimoHomelandPlanner:v1";
  const FALLBACK_MARK = "assets/aniimo-mark.svg";

  const ABILITY_META = {
    Fire: { abbr: "Fi", color: "#df4b4d" },
    Grass: { abbr: "Gr", color: "#43a061" },
    Water: { abbr: "Wa", color: "#258ee7" },
    Earth: { abbr: "Ea", color: "#a78f60" },
    Lightning: { abbr: "Lt", color: "#d7b51d" },
    Ice: { abbr: "Ic", color: "#51bdd1" },
    Wind: { abbr: "Wi", color: "#4fb7a3" },
    Dark: { abbr: "Da", color: "#7650a8" },
    Light: { abbr: "Li", color: "#e39b31" },
    Hauling: { abbr: "Ha", color: "#6685c7" },
    Artisanship: { abbr: "Ar", color: "#68a952" },
    Leisure: { abbr: "Le", color: "#db6d8b" },
    Perfumery: { abbr: "Pe", color: "#aa71cf" },
  };

  const SCREENSHOT_REQUIREMENTS = {
    Fire: 5,
    Grass: 5,
    Water: 8,
    Earth: 8,
    Lightning: 2,
    Ice: 0,
    Wind: 1,
    Dark: 5,
    Light: 1,
    Hauling: 5,
    Artisanship: 2,
    Leisure: 2,
    Perfumery: 1,
  };

  const DEFAULT_SETTINGS = {
    mode: "theorycraft",
    theorycraftCopies: 1,
    actionDurationSeconds: 5,
    cycleDurationMinutes: 20,
    overheadMultiplier: 1,
    maxUtilizationPercent: 50,
    allowIntermittentMultiSkill: true,
    beamWidth: 1000,
    maxSearchWorkers: 30,
  };

  const app = {
    data: {
      aniimo: null,
      buildings: null,
      crops: null,
    },
    state: null,
    filters: {
      rosterSearch: "",
      skillFilter: "All",
    },
    lastResult: null,
  };

  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    app.data.aniimo = await loadData("ANIIMO_DATA", "data/aniimo.json");
    app.data.buildings = await loadData("ANIIMO_BUILDINGS_DATA", "data/buildings.json");
    app.data.crops = await loadData("ANIIMO_CROPS_DATA", "data/crops.json");
    app.state = normalizeState(loadState());

    bindEvents();
    renderAll();
  }

  async function loadData(globalName, url) {
    if (window[globalName]) return window[globalName];
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response.json();
  }

  function defaultState() {
    return {
      activeTab: "requirements",
      requirements: { ...SCREENSHOT_REQUIREMENTS },
      roster: {},
      buildingState: {},
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return { ...defaultState(), ...JSON.parse(raw) };
    } catch {
      return defaultState();
    }
  }

  function normalizeState(rawState) {
    const skills = app.data.aniimo.skills || Object.keys(ABILITY_META);
    const state = {
      ...defaultState(),
      ...rawState,
      requirements: { ...SCREENSHOT_REQUIREMENTS, ...(rawState.requirements || {}) },
      roster: { ...(rawState.roster || {}) },
      buildingState: { ...(rawState.buildingState || {}) },
      settings: { ...DEFAULT_SETTINGS, ...(rawState.settings || {}) },
    };

    for (const skill of skills) {
      state.requirements[skill] = safeNumber(state.requirements[skill], 0, 0, 999);
    }

    for (const building of app.data.buildings.buildings || []) {
      const saved = state.buildingState[building.id] || {};
      state.buildingState[building.id] = {
        enabled: saved.enabled ?? building.defaultEnabled ?? true,
        count: safeNumber(saved.count ?? building.defaultCount ?? 0, 0, 0, 999),
      };
    }

    for (const entry of app.data.aniimo.aniimo || []) {
      const saved = state.roster[entry.id];
      if (saved) {
        state.roster[entry.id] = {
          quantity: safeNumber(saved.quantity, 0, 0, 99),
          excluded: Boolean(saved.excluded),
        };
      }
    }

    state.settings.theorycraftCopies = safeNumber(state.settings.theorycraftCopies, 1, 1, 9);
    state.settings.actionDurationSeconds = safeNumber(state.settings.actionDurationSeconds, 5, 0.1, 3600);
    state.settings.cycleDurationMinutes = safeNumber(state.settings.cycleDurationMinutes, 20, 0.1, 10080);
    state.settings.overheadMultiplier = safeNumber(state.settings.overheadMultiplier, 1, 0.1, 20);
    state.settings.maxUtilizationPercent = safeNumber(state.settings.maxUtilizationPercent, 50, 1, 100);
    state.settings.mode = state.settings.mode === "owned" ? "owned" : "theorycraft";
    state.settings.allowIntermittentMultiSkill = state.settings.allowIntermittentMultiSkill !== false;

    return state;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state));
  }

  function safeNumber(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  function bindEvents() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => activateTab(button.dataset.tab));
    });

    document.getElementById("requirementsGrid").addEventListener("input", (event) => {
      const input = event.target.closest("[data-requirement]");
      if (!input) return;
      app.state.requirements[input.dataset.requirement] = safeNumber(input.value, 0, 0, 999);
      markDirty();
    });

    document.getElementById("loadExampleButton").addEventListener("click", () => {
      app.state.requirements = { ...SCREENSHOT_REQUIREMENTS };
      markDirty();
      renderRequirements();
    });

    document.getElementById("buildingTable").addEventListener("input", (event) => {
      const input = event.target.closest("[data-building-count]");
      if (!input) return;
      app.state.buildingState[input.dataset.buildingCount].count = safeNumber(input.value, 0, 0, 999);
      markDirty();
    });

    document.getElementById("buildingTable").addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-building-enabled]");
      if (!checkbox) return;
      app.state.buildingState[checkbox.dataset.buildingEnabled].enabled = checkbox.checked;
      markDirty();
      renderBuildings();
    });

    document.getElementById("buildingTable").addEventListener("click", (event) => {
      const button = event.target.closest("[data-building-step]");
      if (!button) return;
      const id = button.dataset.buildingStep;
      const delta = Number(button.dataset.delta);
      const current = app.state.buildingState[id].count;
      app.state.buildingState[id].count = safeNumber(current + delta, 0, 0, 999);
      markDirty();
      renderBuildings();
    });

    document.getElementById("rosterSearch").addEventListener("input", (event) => {
      app.filters.rosterSearch = event.target.value.trim().toLowerCase();
      renderRoster();
    });

    document.getElementById("skillFilter").addEventListener("change", (event) => {
      app.filters.skillFilter = event.target.value;
      renderRoster();
    });

    document.getElementById("rosterTable").addEventListener("input", (event) => {
      const input = event.target.closest("[data-roster-quantity]");
      if (!input) return;
      ensureRoster(input.dataset.rosterQuantity).quantity = safeNumber(input.value, 0, 0, 99);
      markDirty();
    });

    document.getElementById("rosterTable").addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-roster-use]");
      if (!checkbox) return;
      ensureRoster(checkbox.dataset.rosterUse).excluded = !checkbox.checked;
      markDirty();
      renderRoster();
    });

    document.getElementById("rosterTable").addEventListener("click", (event) => {
      const button = event.target.closest("[data-roster-step]");
      if (!button) return;
      const id = button.dataset.rosterStep;
      const delta = Number(button.dataset.delta);
      const saved = ensureRoster(id);
      saved.quantity = safeNumber(saved.quantity + delta, 0, 0, 99);
      markDirty();
      renderRoster();
    });

    document.querySelectorAll("input[name='mode']").forEach((input) => {
      input.addEventListener("change", () => {
        app.state.settings.mode = input.value;
        markDirty();
      });
    });

    bindSettingInput("theorycraftCopies", 1, 1, 9);
    bindSettingInput("actionDurationSeconds", 5, 0.1, 3600);
    bindSettingInput("cycleDurationMinutes", 20, 0.1, 10080);
    bindSettingInput("overheadMultiplier", 1, 0.1, 20);
    bindSettingInput("maxUtilizationPercent", 50, 1, 100);

    document.getElementById("allowIntermittentMultiSkill").addEventListener("change", (event) => {
      app.state.settings.allowIntermittentMultiSkill = event.target.checked;
      markDirty();
    });

    document.getElementById("optimizeButton").addEventListener("click", runOptimization);
    document.getElementById("exportButton").addEventListener("click", exportConfiguration);
    document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFile").click());
    document.getElementById("importFile").addEventListener("change", importConfiguration);
    document.getElementById("resetButton").addEventListener("click", resetConfiguration);
  }

  function bindSettingInput(id, fallback, min, max) {
    document.getElementById(id).addEventListener("input", (event) => {
      app.state.settings[id] = safeNumber(event.target.value, fallback, min, max);
      markDirty();
    });
  }

  function ensureRoster(id) {
    if (!app.state.roster[id]) {
      app.state.roster[id] = { quantity: 0, excluded: false };
    }
    return app.state.roster[id];
  }

  function markDirty() {
    app.lastResult = null;
    saveState();
    renderResultShell();
  }

  function activateTab(tab) {
    app.state.activeTab = tab;
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.id === `tab-${tab}`);
    });
    saveState();
  }

  function renderAll() {
    renderDataStatus();
    renderSkillFilter();
    renderRequirements();
    renderBuildings();
    renderRoster();
    renderSettings();
    renderSources();
    renderResultShell();
    activateTab(app.state.activeTab || "requirements");
  }

  function renderDataStatus() {
    const generated = app.data.aniimo.generatedAt ? new Date(app.data.aniimo.generatedAt) : null;
    const generatedText = generated ? generated.toLocaleDateString(undefined, { dateStyle: "medium" }) : "unknown date";
    document.getElementById("dataStatus").textContent =
      `${app.data.aniimo.scrape?.recordCount || app.data.aniimo.aniimo.length} Aniimo/forms loaded. Data refreshed ${generatedText}.`;
  }

  function renderSkillFilter() {
    const select = document.getElementById("skillFilter");
    select.innerHTML = `<option value="All">All skills</option>${app.data.aniimo.skills
      .map((skill) => `<option value="${escapeHtml(skill)}">${escapeHtml(skill)}</option>`)
      .join("")}`;
  }

  function renderRequirements() {
    const grid = document.getElementById("requirementsGrid");
    grid.innerHTML = app.data.aniimo.skills
      .map((skill) => {
        const value = app.state.requirements[skill] || 0;
        return `
          <div class="ability-input">
            ${abilityDot(skill)}
            <label for="require-${escapeAttr(skill)}">${escapeHtml(skill)}</label>
            <input id="require-${escapeAttr(skill)}" data-requirement="${escapeAttr(skill)}" type="number" min="0" max="999" step="1" value="${value}" />
          </div>
        `;
      })
      .join("");
  }

  function renderBuildings() {
    const tbody = document.querySelector("#buildingTable tbody");
    tbody.innerHTML = app.data.buildings.buildings
      .map((building) => {
        const state = app.state.buildingState[building.id];
        return `
          <tr>
            <td>
              <input class="enabled-checkbox" type="checkbox" data-building-enabled="${escapeAttr(building.id)}" ${state.enabled ? "checked" : ""} aria-label="Enable ${escapeAttr(building.name)}" />
            </td>
            <td>
              <div class="stepper">
                <button type="button" class="icon-button" data-building-step="${escapeAttr(building.id)}" data-delta="-1" title="Decrease ${escapeAttr(building.name)}">-</button>
                <input class="count-input" type="number" min="0" max="999" step="1" data-building-count="${escapeAttr(building.id)}" value="${state.count}" aria-label="${escapeAttr(building.name)} count" />
                <button type="button" class="icon-button" data-building-step="${escapeAttr(building.id)}" data-delta="1" title="Increase ${escapeAttr(building.name)}">+</button>
              </div>
            </td>
            <td>
              <div class="building-name">
                <strong>${escapeHtml(building.name)}</strong>
                <span class="type-pill">${escapeHtml(building.countLabel || "count")}</span>
              </div>
            </td>
            <td><span class="type-pill">${building.behavior === "continuous" ? "Continuous" : "Intermittent"}</span></td>
            <td class="work-model-text">${renderBuildingModel(building)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderBuildingModel(building) {
    if (building.behavior === "continuous") {
      const skills = (building.requirements || []).map((requirement) => {
        return `${escapeHtml(requirement.skill)} Lv ${Number(requirement.minLevel || 1)}`;
      });
      return `${Number(building.slotsPerUnit || 1)} body per ${escapeHtml(building.countLabel || "unit")}: ${skills.join(" or ")}`;
    }

    return (building.pools || [])
      .map((pool) => `${abilityDot(pool.skill, "small")} ${escapeHtml(pool.skill)}`)
      .join(" ");
  }

  function renderRoster() {
    const tbody = document.querySelector("#rosterTable tbody");
    const query = app.filters.rosterSearch;
    const skillFilter = app.filters.skillFilter;
    const rows = app.data.aniimo.aniimo.filter((entry) => {
      const displayName = getDisplayName(entry).toLowerCase();
      const skillNames = Object.keys(entry.skills || {})
        .filter((skill) => Number(entry.skills[skill]) > 0)
        .join(" ")
        .toLowerCase();
      const matchesQuery = !query || displayName.includes(query) || skillNames.includes(query);
      const matchesSkill = skillFilter === "All" || Number(entry.skills?.[skillFilter] || 0) > 0;
      return matchesQuery && matchesSkill;
    });

    tbody.innerHTML = rows
      .map((entry) => {
        const saved = app.state.roster[entry.id] || { quantity: 0, excluded: false };
        return `
          <tr>
            <td>
              <div class="stepper">
                <button type="button" class="icon-button" data-roster-step="${escapeAttr(entry.id)}" data-delta="-1" title="Decrease ${escapeAttr(getDisplayName(entry))}">-</button>
                <input class="quantity-input" type="number" min="0" max="99" step="1" data-roster-quantity="${escapeAttr(entry.id)}" value="${saved.quantity || 0}" aria-label="${escapeAttr(getDisplayName(entry))} quantity" />
                <button type="button" class="icon-button" data-roster-step="${escapeAttr(entry.id)}" data-delta="1" title="Increase ${escapeAttr(getDisplayName(entry))}">+</button>
              </div>
            </td>
            <td>
              <div class="aniimo-name">
                <img class="aniimo-head" src="${escapeAttr(entry.image || FALLBACK_MARK)}" alt="" />
                <div class="aniimo-title">
                  <strong>${escapeHtml(getDisplayName(entry))}</strong>
                  <span>${escapeHtml(entry.id)}</span>
                </div>
              </div>
            </td>
            <td>${skillChips(entry.skills)}</td>
            <td>
              <input class="use-checkbox" type="checkbox" data-roster-use="${escapeAttr(entry.id)}" ${saved.excluded ? "" : "checked"} aria-label="Use ${escapeAttr(getDisplayName(entry))}" />
            </td>
          </tr>
        `;
      })
      .join("");

    wireImageFallback(tbody);
  }

  function renderSettings() {
    document.querySelectorAll("input[name='mode']").forEach((input) => {
      input.checked = input.value === app.state.settings.mode;
    });

    for (const id of [
      "theorycraftCopies",
      "actionDurationSeconds",
      "cycleDurationMinutes",
      "overheadMultiplier",
      "maxUtilizationPercent",
    ]) {
      document.getElementById(id).value = app.state.settings[id];
    }

    document.getElementById("allowIntermittentMultiSkill").checked =
      app.state.settings.allowIntermittentMultiSkill !== false;
  }

  function renderSources() {
    const sources = app.data.aniimo.sources || [];
    document.getElementById("sourceList").innerHTML = sources
      .map((source) => {
        return `
          <div class="source-item">
            <a href="${escapeAttr(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a>
            <p>${escapeHtml(source.notes || "")}</p>
          </div>
        `;
      })
      .join("");
  }

  function renderResultShell() {
    if (!app.lastResult) {
      document.getElementById("resultSummary").textContent = "Run the optimizer after setting requirements, buildings, and roster.";
      document.getElementById("missingPanel").classList.add("is-hidden");
      document.getElementById("workerResults").className = "worker-results empty-state";
      document.getElementById("workerResults").textContent = "No recommendation yet.";
      document.querySelector("#coverageTable tbody").innerHTML = "";
      document.querySelector("#staffingTable tbody").innerHTML = "";
      document.getElementById("unusedResults").className = "unused-results empty-state";
      document.getElementById("unusedResults").textContent = "No owned Aniimo loaded.";
      return;
    }

    renderResults(app.lastResult);
  }

  function runOptimization() {
    app.lastResult = window.AniimoOptimizer.optimizeWorkforce({
      aniimo: app.data.aniimo.aniimo,
      skills: app.data.aniimo.skills,
      requirements: app.state.requirements,
      roster: app.state.roster,
      buildings: app.data.buildings.buildings,
      buildingState: app.state.buildingState,
      settings: app.state.settings,
    });

    renderResults(app.lastResult);
    activateTab("optimize");
  }

  function renderResults(result) {
    document.getElementById("resultSummary").textContent = result.feasible
      ? `Recommended workforce: ${result.selectedWorkers.length} Aniimo.`
      : `No complete workforce found. Best partial workforce: ${result.selectedWorkers.length} Aniimo.`;

    renderMissing(result);
    renderWorkerResults(result);
    renderCoverage(result);
    renderStaffing(result);
    renderUnused(result);
  }

  function renderMissing(result) {
    const panel = document.getElementById("missingPanel");
    if (result.feasible || !result.missing.length) {
      panel.classList.add("is-hidden");
      panel.innerHTML = "";
      return;
    }

    panel.classList.remove("is-hidden");
    panel.innerHTML = `
      <h3>Missing</h3>
      <ul>${result.missing.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    `;
  }

  function renderWorkerResults(result) {
    const container = document.getElementById("workerResults");
    container.className = "worker-results";
    if (!result.selectedWorkers.length) {
      container.className = "worker-results empty-state";
      container.textContent = "No workforce selected.";
      return;
    }

    container.innerHTML = result.selectedWorkers
      .map((worker) => {
        return `
          <article class="worker-card">
            <img class="aniimo-head" src="${escapeAttr(worker.image || FALLBACK_MARK)}" alt="" />
            <div>
              <h4>${escapeHtml(worker.displayName)} #${worker.copy}</h4>
              <p><strong>Primary:</strong> ${escapeHtml(worker.primaryAssignment)}</p>
              <div class="assignment-line">
                ${worker.secondaryAssignments.map((assignment) => `<span class="assignment-chip">${escapeHtml(assignment)}</span>`).join("")}
              </div>
              <div class="worker-skill-row">${skillChips(worker.skills)}</div>
              <p>${escapeHtml(worker.reason)}</p>
            </div>
          </article>
        `;
      })
      .join("");

    wireImageFallback(container);
  }

  function renderCoverage(result) {
    document.querySelector("#coverageTable tbody").innerHTML = result.skillCoverage
      .map((row) => {
        return `
          <tr>
            <td>${abilityDot(row.skill, "small")} ${escapeHtml(row.skill)}</td>
            <td>${row.required}</td>
            <td>${row.available}</td>
            <td><span class="status-pill ${row.status === "OK" ? "ok" : "missing"}">${escapeHtml(row.status)}</span></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderStaffing(result) {
    document.querySelector("#staffingTable tbody").innerHTML = result.physicalStaffing
      .map((row) => {
        return `
          <tr>
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(row.needLabel)}</td>
            <td>${escapeHtml(row.assignedLabel)}</td>
            <td><span class="status-pill ${row.status === "OK" ? "ok" : "missing"}">${escapeHtml(row.status)}</span></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderUnused(result) {
    const container = document.getElementById("unusedResults");
    container.className = "unused-results";

    if (app.state.settings.mode === "theorycraft") {
      const ownedUnused = result.unusedWorkers.filter((worker) => Number(app.state.roster[worker.aniimoId]?.quantity || 0) > 0);
      if (!ownedUnused.length) {
        container.className = "unused-results empty-state";
        container.textContent = "Theorycraft candidates are not listed as unused.";
        return;
      }
      container.innerHTML = ownedUnused.map((worker) => `<span class="unused-chip">${escapeHtml(worker.name)} #${worker.copy}</span>`).join("");
      return;
    }

    if (!result.unusedWorkers.length) {
      container.className = "unused-results empty-state";
      container.textContent = "No unused owned Aniimo in the active roster.";
      return;
    }

    container.innerHTML = result.unusedWorkers
      .slice(0, 80)
      .map((worker) => `<span class="unused-chip">${escapeHtml(displayWorker(worker))} #${worker.copy}</span>`)
      .join("");
  }

  function exportConfiguration() {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      app: "Aniimo Homeland Planner",
      state: app.state,
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "aniimo-homeland-planner-config.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importConfiguration(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const payload = JSON.parse(await file.text());
      const importedState = payload.state || payload;
      app.state = normalizeState(importedState);
      app.lastResult = null;
      saveState();
      renderAll();
    } catch (error) {
      window.alert(`Import failed: ${error.message}`);
    }
  }

  function resetConfiguration() {
    if (!window.confirm("Reset local Aniimo Homeland Planner data?")) return;
    localStorage.removeItem(STORAGE_KEY);
    app.state = normalizeState(defaultState());
    app.lastResult = null;
    renderAll();
  }

  function abilityDot(skill, size = "") {
    const meta = ABILITY_META[skill] || { abbr: skill.slice(0, 2), color: "#667085" };
    const className = size === "small" ? "ability-dot small" : "ability-dot";
    return `<span class="${className}" style="background:${meta.color}" title="${escapeAttr(skill)}">${escapeHtml(meta.abbr)}</span>`;
  }

  function skillChips(skillMap) {
    const chips = app.data.aniimo.skills
      .filter((skill) => Number(skillMap?.[skill] || 0) > 0)
      .map((skill) => {
        return `<span class="skill-pill">${abilityDot(skill, "small")} ${escapeHtml(skill)} ${Number(skillMap[skill])}</span>`;
      });
    return chips.length ? `<div class="skill-list">${chips.join("")}</div>` : `<span class="work-model-text">None</span>`;
  }

  function getDisplayName(entry) {
    if (!entry.form || entry.form === "Base" || entry.name.includes(entry.form)) return entry.name;
    return `${entry.name} (${entry.form})`;
  }

  function displayWorker(worker) {
    if (!worker.form || worker.form === "Base" || worker.name.includes(worker.form)) return worker.name;
    return `${worker.name} (${worker.form})`;
  }

  function wireImageFallback(container) {
    container.querySelectorAll("img.aniimo-head").forEach((image) => {
      image.addEventListener(
        "error",
        () => {
          image.src = FALLBACK_MARK;
        },
        { once: true }
      );
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
