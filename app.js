(function initPlanner() {
  const STORAGE_KEY = "aniimoHomelandPlanner:v1";
  const FALLBACK_MARK = "assets/aniimo-mark.svg";
  const TABS = ["requirements", "homeland", "roster", "optimise", "settings"];
  const LEGACY_TABS = { optimize: "optimise" };
  const DEFAULT_ACTION_SECONDS = 5;
  const DEFAULT_ZONE_NAME = "Homebuilding Zone";

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

  // Sample numbers from one player's in-game "Estimated Require" panel, used by "Try example".
  const EXAMPLE_REQUIREMENTS = {
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
    cycleDurationMinutes: 20,
    cropId: "",
    overheadMultiplier: 1,
    maxUtilizationPercent: 50,
    allowIntermittentMultiSkill: true,
    beamWidth: 1000,
    maxSearchWorkers: 30,
  };

  // Settings that used to be user-editable but are now fixed game values or unlimited.
  // "mode" (owned vs planning ahead) was dropped when the roster became the Available Aniimo pool.
  const RETIRED_SETTINGS = ["theorycraftCopies", "actionDurationSeconds", "mode"];

  // Aniimo spaces come from the RV level only (the game doesn't let players change them), so the old
  // "capacityOverride" value is dropped when a saved state is loaded.
  const DEFAULT_HOMELAND = {
    rvLevel: null,
    homebuildingReserve: null,
  };

  // Which Aniimo the optimiser may use. Common Aniimo are in by default; Prismana and legendary ones
  // only when ticked. picks holds per-row ticks that differ from those defaults.
  const DEFAULT_POOL = {
    includePrismana: false,
    includeLegendary: false,
    picks: {},
  };

  const CATEGORY_BADGES = {
    prismana: "Prismana",
    legendary: "Legendary",
    boss: "Boss",
  };

  const app = {
    data: {
      aniimo: null,
      buildings: null,
      crops: null,
      homeland: null,
    },
    state: null,
    filters: {
      rosterSearch: "",
      skillFilter: "All",
    },
    failedIcons: new Set(),
    buildingNotice: "",
    // lastPlan: planForCapacity output (full plan plus, when over capacity, the best plan that fits).
    // lastResult: the plan currently shown. planView: "fitted" or "full" when over capacity.
    lastPlan: null,
    lastResult: null,
    // lastOptions: planProcessorOptions output (the plan at each processor busy level); optionIndex: shown one.
    lastOptions: null,
    optionIndex: 0,
    planView: "fitted",
    running: false,
  };

  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    app.data.aniimo = await loadData("ANIIMO_DATA", "data/aniimo.json");
    app.data.buildings = await loadData("ANIIMO_BUILDINGS_DATA", "data/buildings.json");
    app.data.crops = await loadOptionalData("ANIIMO_CROPS_DATA", "data/crops.json");
    app.data.homeland = await loadOptionalData("ANIIMO_HOMELAND_DATA", "data/homeland.json");
    app.state = normalizeState(loadState());

    watchAbilityIconErrors();
    bindEvents();
    trackHeaderHeight();
    renderAll();
  }

  // The tab bar sticks just below the header, whose height changes with wrapping text and buttons.
  function trackHeaderHeight() {
    const header = document.querySelector(".app-header");
    if (!header) return;
    const update = () => document.documentElement.style.setProperty("--header-height", `${Math.ceil(header.offsetHeight)}px`);
    update();
    if (typeof ResizeObserver === "function") new ResizeObserver(update).observe(header);
    else window.addEventListener("resize", update);
  }

  async function loadData(globalName, url) {
    if (window[globalName]) return window[globalName];
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response.json();
  }

  // Optional data files may be missing (or blocked when opened via file://); the app works without them.
  async function loadOptionalData(globalName, url) {
    if (window[globalName]) return window[globalName];
    // Browsers block fetch() for file:// pages, so only the <script> copy can be used there.
    if (window.location.protocol === "file:") return null;
    try {
      const data = await loadData(globalName, url);
      return data && typeof data === "object" ? data : null;
    } catch {
      return null;
    }
  }

  function defaultRequirements() {
    const skills = app.data.aniimo?.skills || Object.keys(ABILITY_META);
    return Object.fromEntries(skills.map((skill) => [skill, 0]));
  }

  function defaultState() {
    return {
      activeTab: "requirements",
      requirements: defaultRequirements(),
      pool: { ...DEFAULT_POOL, picks: {} },
      buildingState: {},
      homeland: { ...DEFAULT_HOMELAND },
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      // normalizeState fills in defaults; merging them here would hide which keys an old save lacks
      // (e.g. no "pool" yet, so its roster should be migrated).
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : defaultState();
    } catch {
      return defaultState();
    }
  }

  function optionalCount(value, max) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.min(max, Math.floor(numeric));
  }

  function normalizeState(rawState) {
    const skills = app.data.aniimo.skills || Object.keys(ABILITY_META);
    const raw = rawState && typeof rawState === "object" ? rawState : {};
    const state = {
      ...defaultState(),
      ...raw,
      requirements: { ...defaultRequirements(), ...(raw.requirements || {}) },
      buildingState: { ...(raw.buildingState || {}) },
      homeland: { ...DEFAULT_HOMELAND, ...(raw.homeland || {}) },
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
    };

    const tab = LEGACY_TABS[state.activeTab] || state.activeTab;
    state.activeTab = TABS.includes(tab) ? tab : "requirements";

    for (const skill of skills) {
      state.requirements[skill] = safeNumber(state.requirements[skill], 0, 0, 999);
    }

    state.homeland = {
      rvLevel: optionalCount(state.homeland.rvLevel, 999),
      homebuildingReserve: optionalCount(state.homeland.homebuildingReserve, 999),
    };

    state.pool = normalizePool(raw.pool, raw.roster);
    // The old owned-quantity roster is replaced by the pool.
    delete state.roster;

    // A count of 0 means "not built". Older saves also had an on/off flag per building; a building that
    // was switched off is treated as not built, and the flag itself is dropped. "auto" marks a count that
    // follows the RV level's maximum; older saves have no flag, so their counts are kept as typed.
    for (const building of app.data.buildings.buildings || []) {
      const saved = state.buildingState[building.id];
      const hasSaved = saved && typeof saved === "object" && saved.count !== undefined;
      const limit = getBuildingLimit(building, state.homeland.rvLevel);
      let count = hasSaved ? safeNumber(saved.count, 0, 0, 999) : 0;
      if (hasSaved && saved.enabled === false) count = 0;
      let auto = limit.limited ? (hasSaved ? saved.auto === true : true) : false;
      if (limit.limited && limit.known) {
        if (auto || limit.locked) {
          count = limit.max;
          auto = true;
        } else {
          count = Math.min(count, limit.max);
        }
      } else if (limit.limited && auto) {
        count = 0;
      } else if (!limit.limited && !hasSaved) {
        count = safeNumber(building.defaultCount ?? 0, 0, 0, 999);
      }
      if (limit.locked) count = 0;
      state.buildingState[building.id] = withBusy({ count: Math.floor(count), auto }, hasSaved ? saved.busyPercent : null, building);
    }

    for (const key of RETIRED_SETTINGS) delete state.settings[key];
    state.settings.cycleDurationMinutes = safeNumber(state.settings.cycleDurationMinutes, 20, 0.1, 10080);
    state.settings.cropId = typeof state.settings.cropId === "string" ? state.settings.cropId : "";
    state.settings.overheadMultiplier = safeNumber(state.settings.overheadMultiplier, 1, 0.1, 20);
    state.settings.maxUtilizationPercent = safeNumber(state.settings.maxUtilizationPercent, 50, 1, 100);
    state.settings.allowIntermittentMultiSkill = state.settings.allowIntermittentMultiSkill !== false;

    return state;
  }

  // Older saves have a roster of owned quantities instead of a pool. Common Aniimo are in the pool
  // anyway; a Prismana or legendary Aniimo the player owned (and didn't untick) becomes an explicit tick.
  function normalizePool(rawPool, legacyRoster) {
    const known = new Set((app.data.aniimo.aniimo || []).map((entry) => entry.id));
    const pool = { ...DEFAULT_POOL, picks: {} };
    if (rawPool && typeof rawPool === "object") {
      pool.includePrismana = rawPool.includePrismana === true;
      pool.includeLegendary = rawPool.includeLegendary === true;
      for (const [id, value] of Object.entries(rawPool.picks || {})) {
        if (known.has(id) && typeof value === "boolean") pool.picks[id] = value;
      }
      return pool;
    }
    if (legacyRoster && typeof legacyRoster === "object") {
      for (const entry of app.data.aniimo.aniimo || []) {
        const saved = legacyRoster[entry.id];
        if (!saved || typeof saved !== "object") continue;
        if (Number(saved.quantity) > 0 && !saved.excluded && aniimoCategory(entry) !== "common") {
          pool.picks[entry.id] = true;
        }
      }
    }
    return pool;
  }

  function aniimoCategory(entry) {
    return window.AniimoOptimizer.aniimoCategory(entry);
  }

  function isInPool(entry) {
    return window.AniimoOptimizer.isInPool(entry, app.state.pool);
  }

  function getBuildingLimit(building, rvLevel = app.state?.homeland?.rvLevel) {
    return window.AniimoOptimizer.buildingMaxForRv(building, rvLevel);
  }

  // Highest count the input allows: the RV max when known, otherwise no real limit.
  function buildingInputMax(building) {
    const limit = getBuildingLimit(building);
    if (limit.locked) return 0;
    return limit.limited && limit.known ? limit.max : 999;
  }

  // A processor's own busy % (null = follow the option chosen on the Optimise tab). Older saves have none.
  function normaliseBusyPercent(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.round(Math.min(100, Math.max(0, numeric)));
  }

  function isProcessor(building) {
    return window.AniimoOptimizer.buildingRole(building) === "processor" && building.behavior === "continuous";
  }

  // Keeps a processor's busy % when its count changes.
  function withBusy(entry, busyPercent, building) {
    const busy = building && isProcessor(building) ? normaliseBusyPercent(busyPercent) : null;
    return busy === null ? entry : { ...entry, busyPercent: busy };
  }

  function setBuildingCount(building, value) {
    const limit = getBuildingLimit(building);
    const count = Math.floor(safeNumber(value, 0, 0, buildingInputMax(building)));
    const previous = app.state.buildingState[building.id] || {};
    app.state.buildingState[building.id] = withBusy(
      {
        count,
        // A count set to the max keeps following the RV level; anything else is the player's choice.
        auto: Boolean(limit.limited && limit.known && count === limit.max),
      },
      previous.busyPercent,
      building
    );
    return count;
  }

  // Changing RV level: counts that followed the old max (or were set to it) move to the new max; counts
  // the player lowered themselves are kept, but never above the new max. Returns what changed.
  function applyRvChange(oldLevel, newLevel) {
    const summary = { raised: 0, lowered: 0, kept: 0, locked: 0 };
    for (const building of app.data.buildings.buildings || []) {
      const saved = app.state.buildingState[building.id] || { count: 0, auto: true };
      const before = saved.count;
      const oldLimit = getBuildingLimit(building, oldLevel);
      const newLimit = getBuildingLimit(building, newLevel);
      if (!newLimit.limited) {
        if (newLimit.locked) saved.count = 0;
        app.state.buildingState[building.id] = withBusy({ count: saved.count, auto: false }, saved.busyPercent, building);
        continue;
      }
      const followed = saved.auto || (oldLimit.known && before === oldLimit.max);
      let count = before;
      let auto = followed;
      if (newLimit.known) {
        if (newLimit.locked) {
          count = 0;
          auto = true;
        } else if (followed) {
          count = newLimit.max;
        } else {
          count = Math.min(before, newLimit.max);
        }
      } else if (followed) {
        count = 0;
      }
      app.state.buildingState[building.id] = withBusy({ count, auto }, saved.busyPercent, building);
      if (newLimit.locked && before > 0) summary.locked += 1;
      else if (count > before) summary.raised += 1;
      else if (count < before) summary.lowered += 1;
      else if (!followed && newLimit.known && count < newLimit.max) summary.kept += 1;
    }
    return summary;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state));
    } catch {
      // Storage can be unavailable (private mode, file:// in some browsers); the planner still works.
    }
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

    document.getElementById("requirementsTable").addEventListener("input", (event) => {
      const input = event.target.closest("[data-requirement]");
      if (!input) return;
      app.state.requirements[input.dataset.requirement] = safeNumber(input.value, 0, 0, 999);
      markDirty();
      renderRequirementsHint();
    });

    document.getElementById("fillExampleButton").addEventListener("click", () => {
      if (hasAnyRequirement() && !window.confirm("Replace your requirement numbers with the example values?")) return;
      app.state.requirements = { ...defaultRequirements(), ...EXAMPLE_REQUIREMENTS };
      markDirty();
      renderRequirements();
    });

    document.getElementById("clearRequirementsButton").addEventListener("click", () => {
      if (hasAnyRequirement() && !window.confirm("Set every requirement to 0?")) return;
      app.state.requirements = defaultRequirements();
      markDirty();
      renderRequirements();
    });

    document.querySelector(".capacity-card").addEventListener("input", handleHomelandInput);
    document.querySelector(".capacity-card").addEventListener("change", handleHomelandInput);

    document.getElementById("buildingTable").addEventListener("input", (event) => {
      const busyInput = event.target.closest("[data-building-busy]");
      if (busyInput) {
        const building = getBuilding(busyInput.dataset.buildingBusy);
        if (!building) return;
        const saved = app.state.buildingState[building.id];
        const busy = normaliseBusyPercent(busyInput.value);
        const next = { count: saved.count, auto: saved.auto };
        app.state.buildingState[building.id] = withBusy(next, busy, building);
        busyInput.closest("tr")?.classList.toggle("has-own-busy", busy !== null);
        markDirty();
        return;
      }
      const input = event.target.closest("[data-building-count]");
      if (!input) return;
      const building = getBuilding(input.dataset.buildingCount);
      if (!building) return;
      if (input.value === "") return;
      const count = setBuildingCount(building, input.value);
      if (Number(input.value) !== count) input.value = count;
      updateBuildingRow(input.closest("tr"), building);
      app.buildingNotice = "";
      markDirty();
      renderBuildingToolbar();
    });

    document.getElementById("buildingTable").addEventListener("change", (event) => {
      const busyInput = event.target.closest("[data-building-busy]");
      if (busyInput) {
        const busy = app.state.buildingState[busyInput.dataset.buildingBusy]?.busyPercent;
        busyInput.value = busy ?? "";
        return;
      }
      const input = event.target.closest("[data-building-count]");
      if (!input) return;
      const building = getBuilding(input.dataset.buildingCount);
      if (building) input.value = app.state.buildingState[building.id].count;
    });

    document.getElementById("buildingTable").addEventListener("click", (event) => {
      const button = event.target.closest("[data-building-step]");
      if (!button) return;
      const building = getBuilding(button.dataset.buildingStep);
      if (!building) return;
      const delta = Number(button.dataset.delta);
      setBuildingCount(building, app.state.buildingState[building.id].count + delta);
      app.buildingNotice = "";
      markDirty();
      renderBuildings();
    });

    document.getElementById("buildingToolbar").addEventListener("click", (event) => {
      if (!event.target.closest("#setAllMaxButton")) return;
      setAllBuildingsToMax();
    });

    document.getElementById("rosterSearch").addEventListener("input", (event) => {
      app.filters.rosterSearch = event.target.value.trim().toLowerCase();
      renderRoster();
    });

    document.getElementById("skillFilter").addEventListener("change", (event) => {
      app.filters.skillFilter = event.target.value;
      renderRoster();
    });

    document.getElementById("rosterTable").addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-pool-pick]");
      if (!checkbox) return;
      const entry = getAniimo(checkbox.dataset.poolPick);
      if (!entry) return;
      const id = entry.id;
      delete app.state.pool.picks[id];
      // Only remember a tick that differs from what the toggles above would give.
      if (isInPool(entry) !== checkbox.checked) app.state.pool.picks[id] = checkbox.checked;
      checkbox.closest("tr")?.classList.toggle("is-excluded", !checkbox.checked);
      markDirty();
      renderPoolSummary();
    });

    document.querySelector(".pool-toggles").addEventListener("change", (event) => {
      const input = event.target.closest("[data-pool-toggle]");
      if (!input) return;
      const category = input.dataset.poolToggle;
      app.state.pool[category === "prismana" ? "includePrismana" : "includeLegendary"] = input.checked;
      // The toggle sets every Aniimo in that group, so earlier per-row ticks for the group are cleared.
      for (const entry of app.data.aniimo.aniimo) {
        if (aniimoCategory(entry) === category) delete app.state.pool.picks[entry.id];
      }
      markDirty();
      renderRoster();
    });

    document.getElementById("cycleDurationMinutes").addEventListener("input", (event) => {
      app.state.settings.cycleDurationMinutes = safeNumber(event.target.value, 20, 0.1, 10080);
      app.state.settings.cropId = "";
      document.getElementById("cropSelect").value = "";
      markDirty();
    });

    document.getElementById("cropSelect").addEventListener("change", (event) => {
      const crop = getCrops().find((item) => item.id === event.target.value);
      app.state.settings.cropId = crop ? crop.id : "";
      const minutes = cropMinutes(crop);
      if (minutes !== null) {
        app.state.settings.cycleDurationMinutes = safeNumber(minutes, 20, 0.1, 10080);
        document.getElementById("cycleDurationMinutes").value = app.state.settings.cycleDurationMinutes;
      }
      renderCropNote();
      markDirty();
    });

    document.getElementById("overheadMultiplier").addEventListener("change", (event) => {
      app.state.settings.overheadMultiplier = safeNumber(event.target.value, 1, 0.1, 20);
      markDirty();
    });

    document.getElementById("maxUtilizationPercent").addEventListener("input", (event) => {
      app.state.settings.maxUtilizationPercent = safeNumber(event.target.value, 50, 1, 100);
      markDirty();
    });

    document.getElementById("allowIntermittentMultiSkill").addEventListener("change", (event) => {
      app.state.settings.allowIntermittentMultiSkill = event.target.checked;
      markDirty();
    });

    document.getElementById("tab-optimise").addEventListener("click", (event) => {
      const link = event.target.closest("[data-goto-tab]");
      if (link) activateTab(link.dataset.gotoTab);
      const optionRow = event.target.closest("[data-option-index]");
      if (optionRow && app.lastOptions) {
        const index = Number(optionRow.dataset.optionIndex);
        const option = app.lastOptions.options[index];
        if (option) {
          app.optionIndex = index;
          app.lastPlan = option.plan;
          app.planView = "fitted";
          renderResults();
          document.querySelector(`[data-option-index="${index}"] .option-button`)?.focus();
        }
        return;
      }
      const viewButton = event.target.closest("[data-plan-view]");
      if (viewButton && app.lastPlan) {
        app.planView = viewButton.dataset.planView === "full" ? "full" : "fitted";
        renderResults();
      }
    });

    document.getElementById("optimiseButton").addEventListener("click", runOptimisation);
    document.getElementById("exportButton").addEventListener("click", exportConfiguration);
    document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFile").click());
    document.getElementById("importFile").addEventListener("change", importConfiguration);
    document.getElementById("resetButton").addEventListener("click", resetConfiguration);
  }

  function handleHomelandInput(event) {
    const target = event.target;
    if (target.id === "rvLevel") {
      // A <select> fires both input and change; only act once per real change.
      const level = optionalCount(target.value, 999);
      if (level === app.state.homeland.rvLevel) return;
      const oldLevel = app.state.homeland.rvLevel;
      app.state.homeland.rvLevel = level;
      const summary = applyRvChange(oldLevel, level);
      app.buildingNotice = describeRvChange(level, summary);
      markDirty();
      renderCapacityStatus();
      renderBuildings();
      return;
    } else if (target.id === "homebuildingReserve") {
      const reserve = optionalCount(target.value, 999);
      if (reserve === app.state.homeland.homebuildingReserve) return;
      app.state.homeland.homebuildingReserve = reserve;
    } else {
      return;
    }
    // The zone's spaces come out of the same RV limit, so they change the best plan that fits.
    markDirty();
    renderCapacityStatus();
  }

  function hasAnyRequirement() {
    return Object.values(app.state.requirements).some((value) => Number(value) > 0);
  }

  function getBuilding(id) {
    return (app.data.buildings.buildings || []).find((building) => building.id === id) || null;
  }

  function getAniimo(id) {
    return (app.data.aniimo.aniimo || []).find((entry) => entry.id === id) || null;
  }

  function describeRvChange(level, summary) {
    if (level === null) return "RV level cleared. Building counts that followed the old maximum are set to 0.";
    const parts = [];
    if (summary.raised) parts.push(`${summary.raised} raised to the new maximum`);
    if (summary.lowered) parts.push(`${summary.lowered} lowered to fit`);
    if (summary.locked) parts.push(`${summary.locked} not unlocked yet at this level`);
    if (summary.kept) parts.push(`${summary.kept} you set lower yourself kept as they were`);
    return parts.length ? `RV ${level}: building counts updated – ${parts.join(", ")}.` : "";
  }

  function setAllBuildingsToMax() {
    const level = app.state.homeland.rvLevel;
    if (level === null) return;
    let changed = 0;
    for (const building of app.data.buildings.buildings || []) {
      const limit = getBuildingLimit(building);
      if (!limit.limited || !limit.known) continue;
      if (app.state.buildingState[building.id].count !== limit.max) changed += 1;
      app.state.buildingState[building.id] = withBusy({ count: limit.max, auto: true }, app.state.buildingState[building.id].busyPercent, building);
    }
    app.buildingNotice = changed
      ? `Set ${changed} building${plural(changed)} to the most you can place at RV ${level}.`
      : `Every building is already at the most you can place at RV ${level}.`;
    markDirty();
    renderBuildings();
  }

  function markDirty() {
    app.lastResult = null;
    app.lastPlan = null;
    app.lastOptions = null;
    saveState();
    renderResultShell();
  }

  function activateTab(requestedTab) {
    const tab = TABS.includes(requestedTab) ? requestedTab : "requirements";
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
    renderHomelandCapacity();
    renderBuildings();
    renderRoster();
    renderSettings();
    renderSources();
    renderResultShell();
    activateTab(app.state.activeTab || "requirements");
  }

  function renderDataStatus() {
    const generated = app.data.aniimo.generatedAt ? new Date(app.data.aniimo.generatedAt) : null;
    const generatedText =
      generated && !Number.isNaN(generated.getTime())
        ? generated.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
        : "unknown date";
    const count = app.data.aniimo.scrape?.recordCount || app.data.aniimo.aniimo.length;
    document.getElementById("dataStatus").textContent =
      `${count} Aniimo (including regional and Prismana forms) · data updated ${generatedText}`;
  }

  function renderSkillFilter() {
    const select = document.getElementById("skillFilter");
    select.innerHTML = `<option value="All">All abilities</option>${app.data.aniimo.skills
      .map((skill) => `<option value="${escapeHtml(skill)}">${escapeHtml(skill)}</option>`)
      .join("")}`;
  }

  // Mirrors the in-game Ability Distribution panel: one column per ability, icon and name on top and the
  // number underneath, in the game's order.
  function renderRequirements() {
    const grid = document.getElementById("requirementsTable");
    grid.innerHTML = app.data.aniimo.skills
      .map((skill) => {
        const value = app.state.requirements[skill] || 0;
        const id = `require-${escapeAttr(skill)}`;
        return `
          <div class="ability-cell">
            <label class="ability-cell-head" for="${id}">
              ${abilityIcon(skill)}
              <span class="ability-cell-name">${escapeHtml(skill)}</span>
            </label>
            <input class="requirement-input" id="${id}" data-requirement="${escapeAttr(skill)}" type="number" inputmode="numeric" min="0" max="999" step="1" value="${value}" />
          </div>
        `;
      })
      .join("");
    renderRequirementsHint();
  }

  function renderRequirementsHint() {
    const hint = document.getElementById("requirementsHint");
    if (hasAnyRequirement()) {
      hint.classList.add("is-hidden");
      hint.textContent = "";
      return;
    }
    hint.classList.remove("is-hidden");
    hint.textContent =
      'All requirements are 0. Type in the numbers from your in-game Estimated Require panel (Aniimo menu, then the ! next to Ability Distribution), or press "Try example" to try the planner out.';
  }

  function getHomelandData() {
    const data = app.data.homeland;
    return data && typeof data === "object" ? data : null;
  }

  function getZone() {
    const zone = getHomelandData()?.homebuildingZone || {};
    const name = typeof zone.name === "string" && zone.name.trim() ? zone.name.trim() : DEFAULT_ZONE_NAME;
    const capacity = optionalCount(zone.capacity, 999);
    const preferredSkills = Array.isArray(zone.preferredSkills) ? zone.preferredSkills.filter((skill) => typeof skill === "string") : [];
    return { name, capacity, preferredSkills, notes: typeof zone.notes === "string" ? zone.notes : "" };
  }

  function getRvLevels() {
    const levels = getHomelandData()?.rvLevels;
    if (!Array.isArray(levels)) return [];
    return levels
      .filter((item) => item && Number.isFinite(Number(item.level)))
      .map((item) => ({ level: Math.floor(Number(item.level)), capacity: optionalCount(item.aniimoCapacity, 999), notes: item.notes || "" }))
      .sort((a, b) => a.level - b.level);
  }

  function getCapacityInfo() {
    return window.AniimoOptimizer.resolveHomelandCapacity(getHomelandData(), app.state.homeland.rvLevel);
  }

  function getHomebuildingReserve() {
    const saved = app.state.homeland.homebuildingReserve;
    if (saved !== null && saved !== undefined) return saved;
    return getZone().capacity ?? 0;
  }

  function renderHomelandCapacity() {
    const levels = getRvLevels();
    const current = app.state.homeland.rvLevel;
    const control = document.getElementById("rvLevelControl");
    if (levels.length) {
      const known = levels.some((item) => item.level === current);
      const options = levels
        .map((item) => {
          let suffix = "";
          if (item.capacity === 0) suffix = " – no Aniimo spaces yet";
          else if (item.capacity) suffix = ` – room for ${item.capacity} Aniimo`;
          return `<option value="${item.level}" ${item.level === current ? "selected" : ""}>Level ${item.level}${escapeHtml(suffix)}</option>`;
        })
        .join("");
      const custom = current !== null && !known ? `<option value="${current}" selected>Level ${current}</option>` : "";
      control.innerHTML = `<select id="rvLevel"><option value="">Choose your RV level</option>${options}${custom}</select>`;
    } else {
      control.innerHTML = `<input type="number" id="rvLevel" min="1" max="999" step="1" placeholder="e.g. 3" value="${current ?? ""}" />`;
    }

    const zone = getZone();
    document.getElementById("homebuildingReserveLabel").textContent = `Spaces for the ${zone.name}`;
    const preferred = zone.preferredSkills.length ? ` Aniimo with ${zone.preferredSkills.join(", ")} suit it best.` : "";
    document.getElementById("homebuildingReserveHelp").textContent =
      `Aniimo in the ${zone.name} earn Bud Tickets, which buy decorative furniture.${preferred} These come out of your total Aniimo spaces. Set to 0 if you don't want to keep any spaces for it.`;
    document.getElementById("homebuildingReserve").value = getHomebuildingReserve();
    renderCapacityStatus();
  }

  function renderCapacityStatus() {
    const info = getCapacityInfo();
    const data = getHomelandData();
    const status = document.getElementById("capacityStatus");
    let text;
    if (info.source === "rvLevel") {
      const unverified = data && data.verified === false ? " This figure is community data and hasn't been fully confirmed." : "";
      text = `RV level ${info.level} has room for ${info.capacity} Aniimo.${unverified}`;
    } else if (info.level !== null && info.level !== undefined) {
      const level = getRvLevels().find((item) => item.level === info.level);
      text =
        level && level.capacity === 0
          ? `RV level ${info.level} has no Aniimo spaces yet – Aniimo helpers unlock at RV 2.`
          : `We don't know yet how many Aniimo RV level ${info.level} holds, so spare-space suggestions are off.`;
    } else {
      text = "Choose your RV level. It sets how many Aniimo fit in your Homeland and how many of each building you can place.";
    }
    status.textContent = text;
    status.classList.toggle("is-unknown", !info.known);
  }

  function renderBuildings() {
    renderBuildingToolbar();
    const tbody = document.querySelector("#buildingTable tbody");
    tbody.innerHTML = app.data.buildings.buildings
      .map((building) => {
        const label = escapeAttr(building.name);
        return `
          <tr data-building-row="${escapeAttr(building.id)}">
            <td class="count-cell">
              <div class="stepper">
                <button type="button" class="icon-button" data-building-step="${escapeAttr(building.id)}" data-delta="-1" title="Decrease ${label}" aria-label="Decrease ${label}">-</button>
                <input class="count-input" type="number" min="0" step="1" data-building-count="${escapeAttr(building.id)}" aria-label="${label} count" />
                <button type="button" class="icon-button" data-building-step="${escapeAttr(building.id)}" data-delta="1" title="Increase ${label}" aria-label="Increase ${label}">+</button>
              </div>
              <small class="count-limit"></small>
            </td>
            <td>
              <div class="building-name">
                <strong>${escapeHtml(building.name)}</strong>
              </div>
            </td>
            <td class="type-text">${renderBuildingType(building)}</td>
            <td class="work-model-text">${renderBuildingModel(building)}</td>
            <td class="personality-cell">${renderPersonality(building)}</td>
          </tr>
        `;
      })
      .join("");
    tbody.querySelectorAll("tr[data-building-row]").forEach((row) => updateBuildingRow(row, getBuilding(row.dataset.buildingRow)));
  }

  const ROLE_LABELS = {
    primary: "Full-time producer",
    processor: "Part-time processor",
    climate: "Climate – full-time",
    power: "Power – full-time",
  };

  function renderBuildingType(building) {
    if (building.behavior !== "continuous") return "Part-time farm work";
    const role = window.AniimoOptimizer.buildingRole(building);
    const label = escapeHtml(ROLE_LABELS[role] || "Full-time producer");
    if (!isProcessor(building)) return label;
    const busy = app.state.buildingState[building.id]?.busyPercent;
    return `
      ${label}
      <label class="busy-control" title="How much of the time this building is busy. Leave blank to use the option you pick on the Optimise tab.">
        <span>Busy</span>
        <input type="number" min="0" max="100" step="5" placeholder="auto" value="${busy ?? ""}" data-building-busy="${escapeAttr(building.id)}" aria-label="${escapeAttr(building.name)} busy % (blank = auto)" />
        <span>%</span>
      </label>
    `;
  }

  function personalityPercent() {
    return Number(app.data.buildings?.personalityBonusPercent) || 20;
  }

  function renderPersonality(building) {
    if (!building.personalityBonus) return `<span class="muted" title="No personality works faster here">–</span>`;
    return `<span class="personality-tag" title="Aniimo with the ${escapeAttr(building.personalityBonus)} personality work ${personalityPercent()}% faster here">${escapeHtml(building.personalityBonus)}</span> <small class="personality-bonus">+${personalityPercent()}%</small>`;
  }

  // Updates one row's count, limit note and locked state without re-rendering (keeps focus while typing).
  function updateBuildingRow(row, building) {
    if (!row || !building) return;
    const state = app.state.buildingState[building.id];
    const limit = getBuildingLimit(building);
    const max = buildingInputMax(building);
    const input = row.querySelector("[data-building-count]");
    const note = row.querySelector(".count-limit");
    if (document.activeElement !== input || Number(input.value) !== state.count) input.value = state.count;
    input.max = String(max);
    input.disabled = Boolean(limit.locked);
    row.querySelector('[data-delta="-1"]').disabled = Boolean(limit.locked) || state.count <= 0;
    row.querySelector('[data-delta="1"]').disabled = Boolean(limit.locked) || state.count >= max;
    row.classList.toggle("is-locked", Boolean(limit.locked));
    row.classList.toggle("is-unbuilt", !limit.locked && state.count <= 0);
    let text = "";
    if (limit.locked) text = `Unlocks at RV ${limit.unlockRv}`;
    else if (limit.limited && limit.known) text = `max ${limit.max}${building.maxByRvVerified === false ? "*" : ""}`;
    else if (limit.limited) text = limit.unlockRv > 1 ? `from RV ${limit.unlockRv}` : "";
    else text = "your choice";
    note.textContent = text;
    note.title =
      building.maxByRvVerified === false && !limit.locked
        ? building.maxByRvNotes || "Not yet confirmed in-game."
        : building.placementLimit
          ? `How many you can place: ${building.placementLimit}`
          : "";
  }

  function renderBuildingToolbar() {
    const toolbar = document.getElementById("buildingToolbar");
    if (!toolbar) return;
    const level = app.state.homeland.rvLevel;
    const known = level !== null;
    let below = 0;
    if (known) {
      for (const building of app.data.buildings.buildings || []) {
        const limit = getBuildingLimit(building);
        if (limit.limited && limit.known && app.state.buildingState[building.id].count < limit.max) below += 1;
      }
    }
    const message = app.buildingNotice
      ? app.buildingNotice
      : !known
        ? "Choose your RV level above and each count fills in with the most you can place at that level."
        : below
          ? `${below} building${plural(below)} ${below === 1 ? "is" : "are"} below the most you can place at RV ${level}.`
          : `Counts are the most you can place at RV ${level}. Lower any you haven't built.`;
    toolbar.innerHTML = `
      <p class="toolbar-note${known ? "" : " is-prompt"}" role="status">${escapeHtml(message)}</p>
      <button type="button" class="secondary-button" id="setAllMaxButton" ${known ? "" : "disabled"}>
        ${known ? `Set all to max for RV ${level}` : "Set all to max for my RV level"}
      </button>
    `;
  }

  // Every row uses the same layout: ability icon + name (+ the farm step), then a short note.
  function renderBuildingModel(building) {
    let items;
    let note;
    if (building.behavior === "continuous") {
      items = (building.requirements || []).map((requirement) => {
        const level = Number(requirement.minLevel || 1);
        return workItem(requirement.skill, level > 1 ? `Lv ${level}+` : "");
      });
      const slots = Number(building.slotsPerUnit || 1);
      const role = window.AniimoOptimizer.buildingRole(building);
      const skillsText = (building.requirements || []).map((requirement) => requirement.skill).join("/");
      if (role === "processor") note = `Only busy while it has inputs; any ${skillsText} Aniimo can take a turn`;
      else if (role === "climate") note = "Holds 1 Aniimo that does no other work";
      else if (role === "power") note = "Holds 1 Aniimo that does no other work; powers E-mode";
      else note = `${slots} Aniimo per ${building.countLabel === "facilities" || !building.countLabel ? "facility" : building.countLabel.replace(/s$/, "")}, making goods from nothing, full time`;
    } else {
      items = (building.pools || []).map((pool) => workItem(pool.skill, pool.label || ""));
      note = `Shared: each step takes about ${getActionDurationSeconds()} s per plot, so one Aniimo per step covers many plots`;
    }
    const joiner = building.behavior === "continuous" ? '<span class="work-or">or</span>' : "";
    return `<div class="work-list">${items.join(joiner)}</div><span class="work-note">${escapeHtml(note)}</span>`;
  }

  function workItem(skill, label) {
    const extra = label ? ` <span class="pool-label">${escapeHtml(label)}</span>` : "";
    return `<span class="work-item">${abilityIcon(skill, "small")}<span class="work-skill">${escapeHtml(skill)}</span>${extra}</span>`;
  }

  function categoryBadge(entryOrCategory) {
    const category = typeof entryOrCategory === "string" ? entryOrCategory : aniimoCategory(entryOrCategory);
    const label = CATEGORY_BADGES[category];
    return label ? `<span class="category-badge is-${category}">${escapeHtml(label)}</span>` : "";
  }

  function renderPoolSummary() {
    const all = app.data.aniimo.aniimo || [];
    const inPool = all.filter((entry) => isInPool(entry)).length;
    const counts = { prismana: 0, legendary: 0 };
    for (const entry of all) {
      const category = aniimoCategory(entry);
      if (category in counts) counts[category] += 1;
    }
    document.getElementById("poolSummary").textContent = `${inPool} of ${all.length} Aniimo available to the planner.`;
    document.getElementById("includePrismana").checked = app.state.pool.includePrismana;
    document.getElementById("includeLegendary").checked = app.state.pool.includeLegendary;
    document.getElementById("prismanaCount").textContent = `${counts.prismana} forms`;
    document.getElementById("legendaryCount").textContent = `${counts.legendary} Aniimo`;
  }

  function renderRoster() {
    renderPoolSummary();
    const tbody = document.querySelector("#rosterTable tbody");
    const query = app.filters.rosterSearch;
    const skillFilter = app.filters.skillFilter;
    // Typing "12" or "#012" finds Aniilog #012.
    const dexQuery = query.match(/^#?(\d+)$/);
    const rows = sortByDex(app.data.aniimo.aniimo).filter((entry) => {
      const displayName = getDisplayName(entry).toLowerCase();
      const skillNames = Object.keys(entry.skills || {})
        .filter((skill) => Number(entry.skills[skill]) > 0)
        .join(" ")
        .toLowerCase();
      const category = (CATEGORY_BADGES[aniimoCategory(entry)] || "").toLowerCase();
      const matchesQuery = dexQuery
        ? Number(entry.dexNumber) === Number(dexQuery[1])
        : !query || displayName.includes(query) || skillNames.includes(query) || (category && category.includes(query));
      const matchesSkill = skillFilter === "All" || Number(entry.skills?.[skillFilter] || 0) > 0;
      return matchesQuery && matchesSkill;
    });

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="work-model-text">No Aniimo match your search.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((entry) => {
        const included = isInPool(entry);
        const formLine = getFormLabel(entry);
        const name = getDisplayName(entry);
        return `
          <tr class="${included ? "" : "is-excluded"}">
            <td class="use-col">
              <input class="use-checkbox" type="checkbox" id="pool-${escapeAttr(entry.id)}" data-pool-pick="${escapeAttr(entry.id)}" ${included ? "checked" : ""} aria-label="Let the planner use ${escapeAttr(name)}" />
            </td>
            <td>
              <label class="aniimo-name" for="pool-${escapeAttr(entry.id)}">
                <img class="aniimo-head" src="${escapeAttr(entry.image || FALLBACK_MARK)}" alt="" loading="lazy" />
                <span class="aniimo-title">
                  <strong>${dexTag(entry)}${escapeHtml(entry.name)} ${categoryBadge(entry)}</strong>
                  ${formLine ? `<span>${escapeHtml(formLine)}</span>` : ""}
                </span>
              </label>
            </td>
            <td>${skillChips(entry.skills)}</td>
          </tr>
        `;
      })
      .join("");

    wireImageFallback(tbody);
  }

  // Aniilog order (the data is already sorted; this keeps imported or older data in order too). Stable, so
  // each species' forms stay in their data order: base, regional forms, Prismana.
  function sortByDex(entries) {
    const dex = (entry) => (Number.isFinite(Number(entry.dexNumber)) && entry.dexNumber !== null ? Number(entry.dexNumber) : Infinity);
    return [...(entries || [])].sort((a, b) => dex(a) - dex(b));
  }

  // "#012" as the game's Aniilog shows it ("Starter" for the two starters).
  function dexLabel(entry) {
    if (entry.dexLabel) return entry.dexLabel;
    const number = Number(entry.dexNumber);
    return entry.dexNumber !== null && entry.dexNumber !== undefined && Number.isFinite(number) ? `#${String(number).padStart(3, "0")}` : "";
  }

  function dexTag(entry) {
    const label = dexLabel(entry);
    return label ? `<span class="dex-number">${escapeHtml(label)}</span> ` : "";
  }

  // All crops with an id. A crop whose growth time isn't known (no positive cycleMinutes, or
  // cycleVerified: false) is still listed, but shown as "(time unknown)" and never fills in minutes.
  function getCrops() {
    const crops = app.data.crops?.crops;
    if (!Array.isArray(crops)) return [];
    return crops.filter((crop) => crop && crop.id);
  }

  function cropMinutes(crop) {
    if (!crop || crop.cycleVerified === false) return null;
    const minutes = Number(crop.cycleMinutes);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }

  function cropOptionLabel(crop) {
    const minutes = cropMinutes(crop);
    const time = minutes === null ? "time unknown" : `${minutes} min`;
    const extra = crop.optionNote ? `, ${crop.optionNote}` : "";
    return `${crop.name || crop.id} (${time}${extra})`;
  }

  // Seconds an Aniimo spends on one farm action. A fixed game value, read from the crop data.
  function getActionDurationSeconds() {
    const crops = app.data.crops || {};
    const selected = getCrops().find((crop) => crop.id === app.state.settings.cropId);
    const candidates = [selected?.actionDurationSeconds, crops.actionDurationSeconds, crops.crops?.[0]?.actionDurationSeconds];
    for (const value of candidates) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
    return DEFAULT_ACTION_SECONDS;
  }

  function renderSettings() {
    document.getElementById("cycleDurationMinutes").value = app.state.settings.cycleDurationMinutes;
    document.getElementById("maxUtilizationPercent").value = app.state.settings.maxUtilizationPercent;

    const crops = getCrops();
    const cropWrap = document.getElementById("cropSelectWrap");
    const cropSelect = document.getElementById("cropSelect");
    if (crops.length >= 2) {
      cropWrap.classList.remove("is-hidden");
      const groups = new Map();
      for (const crop of crops) {
        const group = crop.facility || "Other";
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(crop);
      }
      const option = (crop) => {
        const selected = crop.id === app.state.settings.cropId ? "selected" : "";
        return `<option value="${escapeAttr(crop.id)}" ${selected}>${escapeHtml(cropOptionLabel(crop))}</option>`;
      };
      const body =
        groups.size > 1
          ? [...groups].map(([name, items]) => `<optgroup label="${escapeAttr(name)}">${items.map(option).join("")}</optgroup>`).join("")
          : crops.map(option).join("");
      cropSelect.innerHTML = `<option value="">Choose a crop…</option>${body}`;
    } else {
      cropWrap.classList.add("is-hidden");
      cropSelect.innerHTML = "";
    }
    renderCropNote();

    const overhead = document.getElementById("overheadMultiplier");
    overhead.querySelectorAll("[data-custom]").forEach((option) => option.remove());
    const value = Number(app.state.settings.overheadMultiplier);
    const match = [...overhead.options].find((option) => Number(option.value) === value);
    if (!match) {
      overhead.insertAdjacentHTML(
        "beforeend",
        `<option value="${escapeAttr(value)}" data-custom>Custom – ${escapeHtml(value)}× the normal time</option>`
      );
    }
    overhead.value = String(match ? match.value : value);

    document.getElementById("allowIntermittentMultiSkill").checked =
      app.state.settings.allowIntermittentMultiSkill !== false;
  }

  function renderCropNote() {
    const note = document.getElementById("cropNote");
    if (!note) return;
    const crops = getCrops();
    const selected = crops.find((crop) => crop.id === app.state.settings.cropId);
    const parts = [];
    if (selected && cropMinutes(selected) === null) {
      parts.push(`The growth time for ${selected.name || selected.id} hasn't been confirmed yet, so type the minutes yourself.`);
    }
    if (crops.some((crop) => /^quick /i.test(crop.name || ""))) {
      parts.push(
        '"Quick" crops come from the RV Ecological Module. They give a much bigger harvest, but can take longer to grow than the normal crop.'
      );
    }
    note.textContent = parts.join(" ");
    note.classList.toggle("is-hidden", !parts.length);
  }

  // Sources are grouped by topic and shown in the "About the data" section at the bottom of the page.
  function renderSources() {
    const groups = [
      ["Aniimo and their abilities", app.data.aniimo.sources],
      ["Buildings", app.data.buildings?.sources],
      ["Crops", app.data.crops?.sources],
      ["RV levels and the Homebuilding Zone", getHomelandData()?.sources],
    ];
    document.getElementById("sourceList").innerHTML = groups
      .map(([title, list]) => {
        const items = (Array.isArray(list) ? list : []).filter((source) => source && source.name);
        if (!items.length) return "";
        return `
          <section class="source-group">
            <h3>${escapeHtml(title)}</h3>
            <div class="source-items">${items.map(renderSourceItem).join("")}</div>
          </section>
        `;
      })
      .join("");
  }

  function renderSourceItem(source) {
    const isOverride = source.kind === "override" || /overrides\.json$/i.test(String(source.url || ""));
    const url = /^https?:\/\//i.test(String(source.url || "")) ? source.url : "";
    const notes = source.notes ? `<p>${escapeHtml(source.notes)}</p>` : "";
    if (isOverride) {
      return `
        <div class="source-item is-override">
          <span class="source-badge">Checked in-game</span>
          <strong>${escapeHtml(source.name)}</strong>
          ${notes}
        </div>
      `;
    }
    const title = url
      ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}<span class="visually-hidden"> (opens in a new tab)</span></a>`
      : `<strong>${escapeHtml(source.name)}</strong>`;
    return `<div class="source-item">${title}${notes}</div>`;
  }

  function renderResultShell() {
    if (!app.lastPlan) {
      document.getElementById("resultSummary").textContent =
        'Press "Optimise workforce" once you\'ve filled in Requirements and Homeland.';
      document.getElementById("missingPanel").classList.add("is-hidden");
      document.getElementById("capacityNotice").classList.add("is-hidden");
      document.getElementById("optionsPanel").classList.add("is-hidden");
      document.getElementById("personalityResults").className = "empty-state";
      document.getElementById("personalityResults").textContent = "Run the optimiser to see suggestions.";
      document.getElementById("workerResults").className = "worker-results empty-state";
      document.getElementById("workerResults").textContent = "No recommendation yet.";
      document.querySelector("#coverageTable tbody").innerHTML = "";
      document.querySelector("#staffingTable tbody").innerHTML = "";
      document.getElementById("spareResults").className = "empty-state";
      document.getElementById("spareResults").textContent = "Run the optimiser to see suggestions.";
      return;
    }

    renderResults();
  }

  function waitForPaint() {
    // Two animation frames guarantee the overlay has been painted before the heavy, synchronous
    // search blocks the page. The timeout covers background tabs, where frames are paused.
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        setTimeout(resolve, 0);
      };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 250);
    });
  }

  function setCalculating(isCalculating) {
    const button = document.getElementById("optimiseButton");
    const overlay = document.getElementById("calculatingOverlay");
    button.disabled = isCalculating;
    button.setAttribute("aria-busy", String(isCalculating));
    button.textContent = isCalculating ? "Calculating…" : "Optimise workforce";
    overlay.classList.toggle("is-hidden", !isCalculating);
    document.getElementById("tab-optimise").classList.toggle("is-calculating", isCalculating);
  }

  async function runOptimisation() {
    if (app.running) return;
    app.running = true;
    activateTab("optimise");
    setCalculating(true);

    try {
      await waitForPaint();
      const pool = window.AniimoOptimizer.filterAniimoPool(app.data.aniimo.aniimo, app.state.pool);
      // The search is a heuristic, and a bigger pool can occasionally lead it to a slightly bigger team.
      // Ticking Prismana or legendary Aniimo should never make the plan worse, so the optimiser also tries
      // without them and keeps whichever team is smaller.
      const commonOnly = pool.filter((entry) => aniimoCategory(entry) === "common");
      const capacity = getCapacityInfo();
      // The plan at several processor busy levels; the highest level that fits the RV spaces is selected.
      app.lastOptions = window.AniimoOptimizer.planProcessorOptions({
        aniimo: pool,
        fallbackAniimo: commonOnly.length && commonOnly.length < pool.length ? commonOnly : null,
        catalogue: app.data.aniimo.aniimo,
        skills: app.data.aniimo.skills,
        requirements: app.state.requirements,
        buildings: app.data.buildings.buildings,
        buildingState: app.state.buildingState,
        settings: { ...app.state.settings, mode: "pool", actionDurationSeconds: getActionDurationSeconds() },
        capacity: capacity.known ? capacity.capacity : null,
        homebuildingReserve: getHomebuildingReserve(),
      });
      app.optionIndex = app.lastOptions.selectedIndex;
      app.lastPlan = app.lastOptions.options[app.optionIndex].plan;
      app.planView = "fitted";
      renderResults();
    } catch (error) {
      app.lastPlan = null;
      app.lastResult = null;
      app.lastOptions = null;
      renderResultShell();
      const panel = document.getElementById("missingPanel");
      panel.classList.remove("is-hidden");
      panel.innerHTML = `
        <h3>Something went wrong</h3>
        <p>The optimiser stopped with an error: ${escapeHtml(error?.message || error)}. Try again, or check your numbers.</p>
      `;
    } finally {
      setCalculating(false);
      app.running = false;
    }
  }

  // The plan on screen: the best plan that fits when over capacity (unless the full plan is chosen).
  function currentView(plan) {
    return plan.overCapacity && plan.fitted && app.planView !== "full" ? "fitted" : "full";
  }

  function currentOption() {
    return app.lastOptions?.options?.[app.optionIndex] || null;
  }

  // "with processors 75% busy", or "" when the plan doesn't depend on a level.
  function levelText(option) {
    return option && Number.isFinite(option.percent) ? ` with processors ${option.percent}% busy` : "";
  }

  function renderResults() {
    const plan = app.lastPlan;
    if (!plan) return;
    const option = currentOption();
    const view = currentView(plan);
    const result = view === "fitted" ? plan.fitted : plan.full;
    app.lastResult = result;
    const count = result.selectedWorkers.length;
    const level = levelText(option);
    let summary;
    if (plan.overCapacity && view === "fitted") {
      summary = `Showing the best plan for your ${plan.budget} space${plural(plan.budget)}${level}: ${count} Aniimo.`;
    } else if (plan.overCapacity) {
      summary = `Showing the full plan${level}: ${count} Aniimo – ${plan.overBy} more than you have room for.`;
    } else {
      summary = result.feasible
        ? `This plan uses ${count} Aniimo${level} – the smallest team the planner found.`
        : `Couldn't cover everything. The best attempt uses ${count} Aniimo${level} – see what's missing below.`;
      if (plan.capacityKnown) {
        const free = plan.capacity - count;
        summary += ` Your Homeland has room for ${plan.capacity}, leaving ${free} spare.`;
      }
    }
    document.getElementById("resultSummary").textContent = summary;
    document.getElementById("workforceHelp").textContent =
      view === "fitted"
        ? "The best team that fits your Aniimo spaces, chosen from your Available Aniimo. Buildings left idle get no Aniimo."
        : "The smallest group of Aniimo that covers your requirements and buildings, chosen from your Available Aniimo. Part-time Aniimo move between the buildings listed.";

    renderOptions();
    renderCapacityNotice(plan, view);
    renderMissing(plan, view);
    renderWorkerResults(result);
    renderCoverage(result);
    renderStaffing(result, view === "fitted" ? plan.shortfalls.idle : []);
    renderPersonalities(option);
    renderSpareSpaces(result);
  }

  const HIDEOUT_OPTIMIZER_URL = "https://www.hideoutgacha.com/games/aniimo/homeland-optimizer";

  function hideoutLine() {
    return `<p class="options-link">For what each building should make, see <a href="${HIDEOUT_OPTIMIZER_URL}" target="_blank" rel="noopener noreferrer">Hideout's Homeland Optimizer<span class="visually-hidden"> (opens in a new tab)</span></a>.</p>`;
  }

  // The processor busy options as a compact comparison table; clicking a row shows that plan.
  function renderOptions() {
    const panel = document.getElementById("optionsPanel");
    const options = app.lastOptions;
    if (!options) {
      panel.classList.add("is-hidden");
      panel.innerHTML = "";
      return;
    }
    panel.classList.remove("is-hidden");
    const own = ownBusyCount();
    const ownNote = own
      ? ` ${own} processor${plural(own)} use${own === 1 ? "s" : ""} ${own === 1 ? "its" : "their"} own busy % from the <button type="button" class="link-button" data-goto-tab="homeland">Homeland tab</button>.`
      : "";
    if (!options.variesWithLevel) {
      const hasProcessors = (app.data.buildings.buildings || []).some(
        (building) => isProcessor(building) && app.state.buildingState[building.id]?.count > 0
      );
      panel.innerHTML = `
        <h3 id="optionsTitle">Processor busy levels</h3>
        <p class="panel-help">${hasProcessors ? `Every processor uses its own busy % from the Homeland tab, so there is one plan.` : "You have no processors built, so there is one plan."}</p>
        ${hideoutLine()}
      `;
      return;
    }
    const plan0 = options.options[0].plan;
    const spacesLabel = plan0.capacityKnown ? `Fits in your ${plan0.budget} space${plural(plan0.budget)}?` : "Fits?";
    const bestIndex = options.options.map((option) => option.fits).lastIndexOf(true);
    const rows = options.options
      .map((option, index) => {
        const selected = index === app.optionIndex;
        const fitsText =
          option.fits === null ? "Set your RV level" : option.fits ? "Yes" : `No – ${option.needed - option.plan.budget} over`;
        const spare = option.fits ? String(option.spare) : "–";
        const badge = index === bestIndex ? ' <span class="best-badge">Best fit</span>' : "";
        return `
          <tr class="option-row${selected ? " is-selected" : ""}${option.fits === false ? " is-over" : ""}" data-option-index="${index}">
            <td><button type="button" class="option-button" aria-pressed="${selected}">${option.percent}%</button>${badge}</td>
            <td>${option.needed}</td>
            <td><span class="status-pill ${option.fits === false ? "missing" : option.fits ? "ok" : "idle"}">${escapeHtml(fitsText)}</span></td>
            <td>${spare}</td>
          </tr>
        `;
      })
      .join("");
    panel.innerHTML = `
      <h3 id="optionsTitle">How busy are your processors?</h3>
      <p class="panel-help">
        Processors (mills, kitchens, looms, crafting) only work while they have inputs, so each needs only part of
        one Aniimo's day. Here is the plan at a few busy levels; pick one to see its full plan.${ownNote}
      </p>
      <div class="table-shell compact">
        <table class="data-table compact-table options-table">
          <thead>
            <tr>
              <th>Processors busy</th>
              <th>Aniimo needed</th>
              <th>${escapeHtml(spacesLabel)}</th>
              <th>Spare spaces</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="options-max">${escapeHtml(maxFitText(options))}</p>
      ${hideoutLine()}
    `;
  }

  function ownBusyCount() {
    return (app.data.buildings.buildings || []).filter((building) => {
      const saved = app.state.buildingState[building.id];
      return isProcessor(building) && saved?.count > 0 && saved.busyPercent !== undefined && saved.busyPercent !== null;
    }).length;
  }

  function maxFitText(options) {
    if (!options.capacityKnown) return "Choose your RV level on the Homeland tab to see which busy levels fit your spaces.";
    const budget = options.options[0].plan.budget;
    if (options.allFit) return `Your spaces allow processors to run full time (${options.maxFitPercent}%).`;
    if (!options.noneFit) return `Your spaces allow processors to run up to about ${options.maxFitPercent}% of the time.`;
    const lowest = options.options[0].percent;
    if (options.maxFitPercent === null) {
      return `Even at ${lowest}% busy this doesn't fit – even with processors idle, your full-time buildings, farm steps and Estimated Require targets need more than your ${budget} spaces. Below is the best plan that fits.`;
    }
    if (options.maxFitPercent === 0) {
      return `Even at ${lowest}% busy this doesn't fit – your other work fills your ${budget} spaces, leaving almost no time for processors. Below is the best plan that fits.`;
    }
    return `Even at ${lowest}% busy this doesn't fit – your spaces only allow processors to run about ${options.maxFitPercent}% of the time. Below is the best plan that fits.`;
  }

  // Personalities worth looking for, grouped by personality and ability, most useful first.
  function renderPersonalities(option) {
    const container = document.getElementById("personalityResults");
    const list = window.AniimoOptimizer.personalityRecommendations({
      buildings: app.data.buildings.buildings,
      buildingState: app.state.buildingState,
      settings: option && Number.isFinite(option.percent) ? { processorBusyPercent: option.percent } : {},
    });
    if (!list.length) {
      container.className = "empty-state";
      container.textContent = "None of your buildings has a personality that works faster there.";
      return;
    }
    container.className = "";
    container.innerHTML = `<ul class="personality-list">${list
      .map((item) => {
        const buildings = item.buildings.map((building) => `${building.name}${building.count > 1 ? ` ×${building.count}` : ""}`).join(", ");
        const work = Math.round(item.weight * 100) / 100;
        return `
          <li>
            <span class="personality-tag">${escapeHtml(item.personality)}</span>
            <span class="work-item">${abilityIcon(item.skill, "small")}<span class="work-skill">${escapeHtml(item.skill)}</span></span>
            <span class="personality-buildings">– ${escapeHtml(buildings)}</span>
            <small class="personality-weight">${escapeHtml(`${work} Aniimo's work`)}</small>
          </li>
        `;
      })
      .join("")}</ul>`;
  }

  function capacityHeadline(plan) {
    const option = currentOption();
    return window.AniimoOptimizer.describeCapacityPlan(plan, {
      rvLevel: app.state.homeland.rvLevel,
      zoneName: getZone().name,
      processorPercent: option && Number.isFinite(option.percent) ? option.percent : undefined,
    });
  }

  function renderCapacityNotice(plan, view) {
    const notice = document.getElementById("capacityNotice");
    if (!plan.overCapacity) {
      notice.classList.add("is-hidden");
      notice.innerHTML = "";
      return;
    }
    const text = capacityHeadline(plan);
    const fittedSize = plan.fitted ? plan.fitted.selectedWorkers.length : 0;
    const options = app.lastOptions;
    let fittedBody;
    if (plan.budget <= 0) {
      fittedBody = `<p>There are no spaces left for production Aniimo. Lower the spaces kept for the ${escapeHtml(getZone().name)} on the <button type="button" class="link-button" data-goto-tab="homeland">Homeland tab</button>.</p>`;
    } else if (!plan.fitted) {
      // A busy level the player picked that doesn't fit: point back to the ones that do.
      fittedBody = options?.options.some((option) => option.fits)
        ? "<p>Pick a lower busy level above to fit your spaces.</p>"
        : "";
    } else {
      const lines = plan.shortfalls.lines.map((line) => `<li>${escapeHtml(line)}</li>`);
      const farmTasks = plan.fitted.physicalStaffing.filter((row) => row.type === "Intermittent");
      if (farmTasks.length && !plan.shortfalls.farmSkills.length) lines.push("<li>Every part-time job is covered.</li>");
      if (!plan.shortfalls.short.length && !plan.shortfalls.noAbility.length) lines.push("<li>Estimated Require totals are still met.</li>");
      fittedBody = `
        <p><strong>Best plan that fits: ${fittedSize} Aniimo.</strong> The rest of your buildings stay idle until you have more room.</p>
        <ul class="shortfall-list">${lines.join("")}</ul>
      `;
    }
    const toggle = plan.fitted
      ? `
        <div class="plan-switch" role="group" aria-label="Which plan to show">
          <button type="button" class="plan-switch-button${view === "fitted" ? " is-active" : ""}" data-plan-view="fitted" aria-pressed="${view === "fitted"}">Best plan for ${plan.budget} space${plural(plan.budget)}</button>
          <button type="button" class="plan-switch-button${view === "full" ? " is-active" : ""}" data-plan-view="full" aria-pressed="${view === "full"}">Full plan (${plan.full.selectedWorkers.length} Aniimo)</button>
        </div>
      `
      : "";
    const lead = options?.noneFit && plan.fitted ? "<p><strong>Even the lowest busy level doesn't fit.</strong></p>" : "";
    notice.classList.remove("is-hidden");
    notice.innerHTML = `
      <h3>Doesn't fit your Aniimo spaces</h3>
      ${lead}
      <p>${escapeHtml(text.headline)}${text.minimum ? ` ${escapeHtml(text.minimum)}` : ""}</p>
      ${fittedBody}
      ${toggle}
    `;
  }

  // What the shown plan still lacks, as a short grouped list (never one line per building copy).
  function renderMissing(plan, view) {
    const panel = document.getElementById("missingPanel");
    const shortfalls = view === "fitted" ? null : plan.fullShortfalls;
    // The best plan that fits lists its own gaps in the capacity notice above.
    if (!shortfalls || shortfalls.ok) {
      panel.classList.add("is-hidden");
      panel.innerHTML = "";
      return;
    }
    const hint = shortfalls.noAbility.length
      ? "Or lower that building count or requirement."
      : "Try lowering a requirement or building count, or let the planner use more Aniimo on the Available Aniimo tab (for example Prismana forms).";
    panel.classList.remove("is-hidden");
    panel.innerHTML = `
      <h3>Still missing</h3>
      <ul class="shortfall-list">${shortfalls.lines.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <p>${escapeHtml(hint)}</p>
    `;
  }

  function renderWorkerResults(result) {
    const container = document.getElementById("workerResults");
    container.className = "worker-results";
    if (!result.selectedWorkers.length) {
      container.className = "worker-results empty-state";
      container.textContent = "No Aniimo needed – all requirements are 0 and no buildings need staff.";
      return;
    }

    container.innerHTML = result.selectedWorkers
      .map((worker) => {
        return `
          <article class="worker-card">
            <img class="aniimo-head" src="${escapeAttr(worker.image || FALLBACK_MARK)}" alt="" />
            <div>
              <h4>${escapeHtml(worker.displayName)}${worker.copy > 1 ? ` (copy ${worker.copy})` : ""} ${categoryBadge(worker.category || worker)}</h4>
              <p><strong>Main job:</strong> ${escapeHtml(worker.primaryAssignment)}</p>
              ${
                worker.secondaryAssignments.length
                  ? `<ul class="assignment-list">${worker.secondaryAssignments.map((assignment) => `<li>${escapeHtml(assignment)}</li>`).join("")}</ul>`
                  : ""
              }
              ${personalityTipLine(worker)}
              <div class="worker-skill-row">${skillChips(worker.skills)}</div>
              <p>Why: ${escapeHtml(worker.reason)}</p>
            </div>
          </article>
        `;
      })
      .join("");

    wireImageFallback(container);
  }

  // "Best personality: Practical (+20% at the Chimney Kiln)", grouped when a part-time Aniimo has several.
  function personalityTipLine(worker) {
    const tips = worker.personalityTips || [];
    if (!tips.length) return "";
    const byPersonality = new Map();
    for (const tip of tips) {
      const list = byPersonality.get(tip.personality) || [];
      if (!list.includes(tip.building)) list.push(tip.building);
      byPersonality.set(tip.personality, list);
    }
    const parts = [...byPersonality].map(
      ([personality, buildings]) => `<strong>${escapeHtml(personality)}</strong> (+${personalityPercent()}% at the ${escapeHtml(buildings.join(", "))})`
    );
    const label = parts.length > 1 ? "Best personalities" : "Best personality";
    return `<p class="personality-tip">${label}: ${parts.join("; ")}</p>`;
  }

  function renderCoverage(result) {
    document.querySelector("#coverageTable tbody").innerHTML = result.skillCoverage
      .map((row) => {
        return `
          <tr>
            <td><span class="work-item">${abilityIcon(row.skill, "small")}<span class="work-skill">${escapeHtml(row.skill)}</span></span></td>
            <td>${row.required}</td>
            <td>${row.available}</td>
            <td><span class="status-pill ${row.status === "OK" ? "ok" : "missing"}">${escapeHtml(row.status === "OK" ? "OK" : "Short")}</span></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderStaffing(result, idle = []) {
    const tbody = document.querySelector("#staffingTable tbody");
    if (!result.physicalStaffing.length && !idle.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="work-model-text">No buildings need staff. Add some on the Homeland tab.</td></tr>`;
      return;
    }
    tbody.innerHTML = result.physicalStaffing
      .map((row) => {
        return `
          <tr>
            <td>${escapeHtml(row.label)}${
              row.personalityBonus
                ? ` <small class="personality-bonus" title="Best personality for this building">${escapeHtml(row.personalityBonus)} +${personalityPercent()}%</small>`
                : ""
            }</td>
            <td>${escapeHtml(row.needLabel)}</td>
            <td>${escapeHtml(row.assignedLabel)}</td>
            <td><span class="status-pill ${row.status === "OK" ? "ok" : "missing"}">${escapeHtml(row.status === "OK" ? "OK" : "Short")}</span></td>
          </tr>
        `;
      })
      .join("") +
      idle
        .map(
          (group) => `
          <tr class="is-idle">
            <td>${escapeHtml(group.name)} (left idle)</td>
            <td>${group.count} Aniimo</td>
            <td>0 Aniimo</td>
            <td><span class="status-pill idle">Idle</span></td>
          </tr>
        `
        )
        .join("");
  }

  function renderSpareSpaces(result) {
    const container = document.getElementById("spareResults");
    const capacity = getCapacityInfo();
    const zone = getZone();
    const plan = window.AniimoOptimizer.recommendSpareSpaces({
      result,
      capacity: capacity.capacity,
      homebuildingReserve: getHomebuildingReserve(),
      homebuildingZone: getHomelandData()?.homebuildingZone || { name: zone.name },
      skills: app.data.aniimo.skills,
      mode: "pool",
    });

    if (!plan.capacityKnown) {
      container.className = "empty-state";
      container.innerHTML = `
        <div>
          <p>Choose your RV level so the planner knows how many Aniimo your Homeland holds and can suggest uses for spare spaces.</p>
          <button type="button" class="secondary-button" data-goto-tab="homeland">Set your RV level</button>
        </div>
      `;
      return;
    }

    if (plan.overCapacity) {
      container.className = "empty-state";
      container.textContent = app.lastPlan?.fitted
        ? "No spare spaces – this plan needs more room than you have. Switch to the best plan that fits above."
        : "No spare spaces – this plan needs more room than you have. Pick a busy level that fits above.";
      return;
    }

    if (plan.free === 0) {
      container.className = "empty-state";
      container.textContent = "No spare spaces – the recommended workforce fills your Homeland exactly.";
      return;
    }

    container.className = "spare-results";
    const groups = [];

    const zoneIntro = `Aniimo in the ${plan.homebuilding.name} earn Bud Tickets you can spend on decorative furniture.`;
    let zoneBody;
    if (!plan.homebuilding.reserved) {
      zoneBody = `<p class="spare-note">No spaces reserved. Set "Spaces for the ${escapeHtml(plan.homebuilding.name)}" on the <button type="button" class="link-button" data-goto-tab="homeland">Homeland tab</button> to keep some.</p>`;
    } else if (!plan.homebuilding.suggestions.length) {
      zoneBody = `<p class="spare-note">${plan.homebuilding.reserved} space${plural(plan.homebuilding.reserved)} reserved. Any Aniimo you're not using can go here.</p>`;
    } else {
      const leftover = plan.homebuilding.reserved - plan.homebuilding.suggestions.length;
      zoneBody =
        spareList(plan.homebuilding.suggestions) +
        (leftover > 0 ? `<p class="spare-note">${leftover} more reserved space${plural(leftover)} – no other spare Aniimo to suggest.</p>` : "");
    }
    groups.push(spareGroup(`${capitalise(plan.homebuilding.name)} (${plan.homebuilding.reserved} reserved)`, zoneIntro, zoneBody));

    let backupBody;
    if (plan.backups.length) {
      backupBody = spareList(plan.backups);
    } else if (!plan.fragileSkills.length) {
      backupBody = `<p class="spare-note">Nothing needed – every ability in your plan is shared by at least two Aniimo with points to spare.</p>`;
    } else {
      const skillsText = plan.fragileSkills.map((item) => item.skill).join(", ");
      backupBody = `<p class="spare-note">These abilities rely on a single Aniimo or have no spare points: ${escapeHtml(skillsText)}. ${
        plan.homebuilding.reserved >= plan.free ? "All spare spaces are reserved for the zone." : "No spare Aniimo has them."
      }</p>`;
    }
    groups.push(
      spareGroup(
        "Backups",
        "If an Aniimo is busy, resting or swapped out, a backup keeps that job running.",
        backupBody
      )
    );

    const haulerBody = plan.haulers.length
      ? spareList(plan.haulers)
      : `<p class="spare-note">${plan.free - plan.homebuilding.reserved - plan.backups.length > 0 ? "No spare Aniimo with Hauling." : "No spaces left after the suggestions above."}</p>`;
    groups.push(spareGroup("Extra haulers", "More haulers carry goods between buildings faster, so production flows better.", haulerBody));

    container.innerHTML = `
      <p class="spare-summary">
        <strong>${plan.capacity}</strong> spaces − <strong>${plan.used}</strong> in the workforce =
        <strong>${plan.free}</strong> spare.
        ${plan.unfilled > 0 ? ` ${plan.unfilled} space${plural(plan.unfilled)} left over with nothing useful to suggest.` : ""}
      </p>
      <div class="spare-groups">${groups.join("")}</div>
    `;
    wireImageFallback(container);
  }

  function spareGroup(title, intro, body) {
    return `
      <section class="spare-group">
        <h4>${escapeHtml(title)}</h4>
        <p class="spare-intro">${escapeHtml(intro)}</p>
        ${body}
      </section>
    `;
  }

  function spareList(entries) {
    const inPlan = new Set((app.lastResult?.selectedWorkers || []).map((worker) => worker.aniimoId));
    return `<ul class="spare-list">${entries
      .map((entry) => {
        const another = inPlan.has(entry.aniimoId) ? " (another one)" : "";
        return `
          <li class="spare-item">
            <img class="aniimo-head" src="${escapeAttr(entry.image || FALLBACK_MARK)}" alt="" />
            <div>
              <strong>${escapeHtml(entry.displayName)}${escapeHtml(another)}</strong>
              ${categoryBadge(entry.category || entry)}
              <p>${escapeHtml(entry.reason)}</p>
            </div>
          </li>
        `;
      })
      .join("")}</ul>`;
  }

  function plural(count) {
    return count === 1 ? "" : "s";
  }

  function capitalise(text) {
    const value = String(text);
    return value.charAt(0).toUpperCase() + value.slice(1);
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
      app.lastPlan = null;
      saveState();
      renderAll();
    } catch (error) {
      window.alert(`Import failed: ${error.message}`);
    }
  }

  function resetConfiguration() {
    if (!window.confirm("Start over? This clears everything you've entered on this device.")) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
    app.state = normalizeState(defaultState());
    app.lastResult = null;
    app.lastPlan = null;
    renderAll();
  }

  function abilityMeta(skill) {
    const fallback = ABILITY_META[skill] || { abbr: String(skill).slice(0, 2), color: "#667085" };
    const fromData = app.data.aniimo?.abilityIcons?.[skill] || {};
    const color = /^#[0-9a-f]{3,8}$/i.test(String(fromData.color || "")) ? fromData.color : fallback.color;
    const icon = /^https:\/\//i.test(String(fromData.icon || "")) ? fromData.icon : "";
    return { abbr: fallback.abbr, color, icon };
  }

  // The in-game ability icon (hotlinked like the Aniimo portraits) on its coloured circle. If the image
  // can't load, the circle shows the ability's two-letter abbreviation instead.
  function abilityIcon(skill, size = "") {
    const meta = abilityMeta(skill);
    const useImage = meta.icon && !app.failedIcons.has(meta.icon);
    const classes = ["ability-icon", size === "small" ? "small" : "", useImage ? "has-img" : ""].filter(Boolean).join(" ");
    const image = useImage ? `<img class="ability-img" src="${escapeAttr(meta.icon)}" alt="" decoding="async" />` : "";
    return `<span class="${classes}" style="background:${meta.color}" title="${escapeAttr(skill)}" aria-hidden="true">${image}<span class="ability-abbr">${escapeHtml(meta.abbr)}</span></span>`;
  }

  // One capturing listener covers every ability icon, including ones that fail before a per-image
  // listener could be attached.
  function watchAbilityIconErrors() {
    document.addEventListener(
      "error",
      (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.classList.contains("ability-img")) return;
        app.failedIcons.add(image.getAttribute("src"));
        image.parentElement?.classList.remove("has-img");
        image.remove();
      },
      true
    );
  }

  function skillChips(skillMap) {
    const chips = app.data.aniimo.skills
      .filter((skill) => Number(skillMap?.[skill] || 0) > 0)
      .map((skill) => {
        return `<span class="skill-pill">${abilityIcon(skill, "small")} ${escapeHtml(skill)} ${Number(skillMap[skill])}</span>`;
      });
    return chips.length ? `<div class="skill-list">${chips.join("")}</div>` : `<span class="work-model-text">None</span>`;
  }

  // Form name to show under the Aniimo's name, when it isn't already part of the name.
  function getFormLabel(entry) {
    if (!entry.form || entry.form === "Base" || String(entry.name).includes(entry.form)) return "";
    return entry.form;
  }

  function getDisplayName(entry) {
    if (!entry.form || entry.form === "Base" || entry.name.includes(entry.form)) return entry.name;
    return `${entry.name} (${entry.form})`;
  }

  function displayWorker(worker) {
    return getDisplayName(worker);
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
