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
    mode: "theorycraft",
    cycleDurationMinutes: 20,
    cropId: "",
    overheadMultiplier: 1,
    maxUtilizationPercent: 50,
    allowIntermittentMultiSkill: true,
    beamWidth: 1000,
    maxSearchWorkers: 30,
  };

  // Settings that used to be user-editable but are now fixed game values or unlimited.
  const RETIRED_SETTINGS = ["theorycraftCopies", "actionDurationSeconds"];

  const DEFAULT_HOMELAND = {
    rvLevel: null,
    capacityOverride: null,
    homebuildingReserve: null,
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
    lastResult: null,
    running: false,
  };

  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    app.data.aniimo = await loadData("ANIIMO_DATA", "data/aniimo.json");
    app.data.buildings = await loadData("ANIIMO_BUILDINGS_DATA", "data/buildings.json");
    app.data.crops = await loadOptionalData("ANIIMO_CROPS_DATA", "data/crops.json");
    app.data.homeland = await loadOptionalData("ANIIMO_HOMELAND_DATA", "data/homeland.json");
    app.state = normalizeState(loadState());

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
      roster: {},
      buildingState: {},
      homeland: { ...DEFAULT_HOMELAND },
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

  function optionalCount(value, max) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.min(max, Math.floor(numeric));
  }

  function normalizeState(rawState) {
    const skills = app.data.aniimo.skills || Object.keys(ABILITY_META);
    const state = {
      ...defaultState(),
      ...rawState,
      requirements: { ...defaultRequirements(), ...(rawState.requirements || {}) },
      roster: { ...(rawState.roster || {}) },
      buildingState: { ...(rawState.buildingState || {}) },
      homeland: { ...DEFAULT_HOMELAND, ...(rawState.homeland || {}) },
      settings: { ...DEFAULT_SETTINGS, ...(rawState.settings || {}) },
    };

    const tab = LEGACY_TABS[state.activeTab] || state.activeTab;
    state.activeTab = TABS.includes(tab) ? tab : "requirements";

    for (const skill of skills) {
      state.requirements[skill] = safeNumber(state.requirements[skill], 0, 0, 999);
    }

    // A count of 0 means "not built". Older saves also had an on/off flag per building; a building that
    // was switched off is treated as not built, and the flag itself is dropped.
    for (const building of app.data.buildings.buildings || []) {
      const raw = state.buildingState[building.id];
      const saved = raw && typeof raw === "object" ? raw : {};
      const count = safeNumber(saved.count ?? building.defaultCount ?? 0, 0, 0, 999);
      state.buildingState[building.id] = { count: saved.enabled === false ? 0 : count };
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

    state.homeland = {
      rvLevel: optionalCount(state.homeland.rvLevel, 999),
      capacityOverride: optionalCount(state.homeland.capacityOverride, 999),
      homebuildingReserve: optionalCount(state.homeland.homebuildingReserve, 999),
    };

    for (const key of RETIRED_SETTINGS) delete state.settings[key];
    state.settings.cycleDurationMinutes = safeNumber(state.settings.cycleDurationMinutes, 20, 0.1, 10080);
    state.settings.cropId = typeof state.settings.cropId === "string" ? state.settings.cropId : "";
    state.settings.overheadMultiplier = safeNumber(state.settings.overheadMultiplier, 1, 0.1, 20);
    state.settings.maxUtilizationPercent = safeNumber(state.settings.maxUtilizationPercent, 50, 1, 100);
    state.settings.mode = state.settings.mode === "owned" ? "owned" : "theorycraft";
    state.settings.allowIntermittentMultiSkill = state.settings.allowIntermittentMultiSkill !== false;

    return state;
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
      const input = event.target.closest("[data-building-count]");
      if (!input) return;
      app.state.buildingState[input.dataset.buildingCount].count = safeNumber(input.value, 0, 0, 999);
      markDirty();
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
      const saved = ensureRoster(input.dataset.rosterQuantity);
      saved.quantity = safeNumber(input.value, 0, 0, 99);
      // Update the "Include in plan" box in place so typing doesn't lose focus.
      const checkbox = input.closest("tr")?.querySelector("[data-roster-use]");
      if (checkbox) {
        checkbox.disabled = saved.quantity <= 0;
        checkbox.checked = saved.quantity > 0 && !saved.excluded;
      }
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
      const modeButton = event.target.closest("[data-set-mode]");
      if (modeButton) {
        app.state.settings.mode = modeButton.dataset.setMode === "owned" ? "owned" : "theorycraft";
        markDirty();
        renderSettings();
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
      app.state.homeland.rvLevel = optionalCount(target.value, 999);
    } else if (target.id === "capacityOverride") {
      app.state.homeland.capacityOverride = optionalCount(target.value, 999);
    } else if (target.id === "homebuildingReserve") {
      app.state.homeland.homebuildingReserve = optionalCount(target.value, 999);
    } else {
      return;
    }
    // Capacity doesn't change the minimum workforce, only the spare-space advice, so keep the result.
    saveState();
    renderCapacityStatus();
    if (app.lastResult) renderSpareSpaces(app.lastResult);
  }

  function hasAnyRequirement() {
    return Object.values(app.state.requirements).some((value) => Number(value) > 0);
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
    renderModeNotice();
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
    renderModeNotice();
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

  function renderRequirements() {
    const tbody = document.querySelector("#requirementsTable tbody");
    tbody.innerHTML = app.data.aniimo.skills
      .map((skill) => {
        const value = app.state.requirements[skill] || 0;
        const id = `require-${escapeAttr(skill)}`;
        return `
          <tr>
            <th scope="row">
              <label class="ability-label" for="${id}">${abilityDot(skill, "small")}<span>${escapeHtml(skill)}</span></label>
            </th>
            <td class="numeric-col">
              <input class="requirement-input" id="${id}" data-requirement="${escapeAttr(skill)}" type="number" inputmode="numeric" min="0" max="999" step="1" value="${value}" />
            </td>
          </tr>
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
      'All requirements are 0. Type in the numbers from your in-game Estimated Require panel, or press "Try example" to try the planner out.';
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
    return window.AniimoOptimizer.resolveHomelandCapacity(
      getHomelandData(),
      app.state.homeland.rvLevel,
      app.state.homeland.capacityOverride
    );
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

    document.getElementById("capacityOverride").value = app.state.homeland.capacityOverride ?? "";
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
    if (info.source === "manual") {
      text = `Planning for ${info.capacity} Aniimo spaces (the number you typed in).`;
    } else if (info.source === "rvLevel") {
      const unverified = data && data.verified === false ? " This figure is community data and hasn't been fully confirmed." : "";
      text = `RV level ${info.level} has room for ${info.capacity} Aniimo.${unverified}`;
    } else if (info.level !== null && info.level !== undefined) {
      text = `We don't know yet how many Aniimo RV level ${info.level} holds. Optional: type your total into "Aniimo spaces available" to get spare-space suggestions.`;
    } else {
      text = "Optional: add your RV level so we can check the team fits and suggest uses for spare spaces.";
    }
    status.textContent = text;
    status.classList.toggle("is-unknown", !info.known);
  }

  function renderBuildings() {
    const tbody = document.querySelector("#buildingTable tbody");
    tbody.innerHTML = app.data.buildings.buildings
      .map((building) => {
        const state = app.state.buildingState[building.id];
        return `
          <tr class="${state.count > 0 ? "" : "is-unbuilt"}">
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
              </div>
            </td>
            <td class="type-text">${building.behavior === "continuous" ? "Full-time worker" : "Part-time farm work"}</td>
            <td class="work-model-text">${renderBuildingModel(building)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderBuildingModel(building) {
    if (building.behavior === "continuous") {
      const skills = (building.requirements || []).map((requirement) => {
        const level = Number(requirement.minLevel || 1);
        return `${escapeHtml(requirement.skill)}${level > 1 ? ` (level ${level}+)` : ""}`;
      });
      const slots = Number(building.slotsPerUnit || 1);
      const who = `${slots === 1 ? "One Aniimo" : `${slots} Aniimo`} with ${skills.join(" or ")}`;
      const note = building.countHelp ? ` <span class="pool-label">${escapeHtml(building.countHelp)}</span>` : "";
      return `${who}${note}`;
    }

    return (building.pools || [])
      .map((pool) => {
        const label = pool.label ? ` <span class="pool-label">${escapeHtml(pool.label)}</span>` : "";
        return `<span class="pool-item">${abilityDot(pool.skill, "small")} ${escapeHtml(pool.skill)}${label}</span>`;
      })
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
        const owned = Number(saved.quantity) > 0;
        const formLine = getFormLabel(entry);
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
                  <strong>${escapeHtml(entry.name)}</strong>
                  ${formLine ? `<span>${escapeHtml(formLine)}</span>` : ""}
                </div>
              </div>
            </td>
            <td>${skillChips(entry.skills)}</td>
            <td>
              <input class="use-checkbox" type="checkbox" data-roster-use="${escapeAttr(entry.id)}" ${owned && !saved.excluded ? "checked" : ""} ${owned ? "" : "disabled"} title="${owned ? "" : "Set a quantity first"}" aria-label="Include ${escapeAttr(getDisplayName(entry))} in plan" />
            </td>
          </tr>
        `;
      })
      .join("");

    wireImageFallback(tbody);
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
    document.querySelectorAll("input[name='mode']").forEach((input) => {
      input.checked = input.value === app.state.settings.mode;
    });

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

  function hasOwnedAniimo() {
    return Object.values(app.state.roster).some((entry) => Number(entry?.quantity) > 0);
  }

  // A gentle nudge for players who have filled in their roster but are still in planning mode.
  function renderModeNotice() {
    const notice = document.getElementById("modeNotice");
    if (!notice) return;
    if (app.state.settings.mode !== "theorycraft" || !hasOwnedAniimo()) {
      notice.classList.add("is-hidden");
      notice.innerHTML = "";
      return;
    }
    notice.classList.remove("is-hidden");
    notice.innerHTML = `
      <p>
        You've added Aniimo on the Roster tab, but the planner is set to also suggest Aniimo you don't own yet
        (planning ahead). Switch if you only want a team you can use right now.
      </p>
      <button type="button" class="secondary-button" data-set-mode="owned">Only use Aniimo I own</button>
    `;
  }

  function renderResultShell() {
    if (!app.lastResult) {
      document.getElementById("resultSummary").textContent =
        'Press "Optimise workforce" once you\'ve filled in Requirements, Homeland and Roster.';
      document.getElementById("missingPanel").classList.add("is-hidden");
      document.getElementById("capacityNotice").classList.add("is-hidden");
      document.getElementById("workerResults").className = "worker-results empty-state";
      document.getElementById("workerResults").textContent = "No recommendation yet.";
      document.querySelector("#coverageTable tbody").innerHTML = "";
      document.querySelector("#staffingTable tbody").innerHTML = "";
      document.getElementById("unusedResults").className = "unused-results empty-state";
      document.getElementById("unusedResults").textContent = "No recommendation yet.";
      document.getElementById("spareResults").className = "empty-state";
      document.getElementById("spareResults").textContent = "Run the optimiser to see suggestions.";
      return;
    }

    renderResults(app.lastResult);
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
      const result = window.AniimoOptimizer.optimizeWorkforce({
        aniimo: app.data.aniimo.aniimo,
        skills: app.data.aniimo.skills,
        requirements: app.state.requirements,
        roster: app.state.roster,
        buildings: app.data.buildings.buildings,
        buildingState: app.state.buildingState,
        settings: { ...app.state.settings, actionDurationSeconds: getActionDurationSeconds() },
      });
      app.lastResult = result;
      renderResults(result);
    } catch (error) {
      app.lastResult = null;
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

  function renderResults(result) {
    const count = result.selectedWorkers.length;
    const capacity = getCapacityInfo();
    let summary = result.feasible
      ? `This plan uses ${count} Aniimo – the smallest team the planner found.`
      : `Couldn't cover everything. The best attempt uses ${count} Aniimo – see what's missing below.`;
    if (capacity.known) {
      const free = capacity.capacity - count;
      summary +=
        free >= 0
          ? ` Your Homeland has room for ${capacity.capacity}, leaving ${free} spare.`
          : ` Your Homeland only has room for ${capacity.capacity}.`;
    }
    document.getElementById("resultSummary").textContent = summary;

    renderMissing(result);
    renderWorkerResults(result);
    renderCoverage(result);
    renderStaffing(result);
    renderUnused(result);
    renderSpareSpaces(result);
  }

  function renderMissing(result) {
    const panel = document.getElementById("missingPanel");
    if (result.feasible || !result.missing.length) {
      panel.classList.add("is-hidden");
      panel.innerHTML = "";
      return;
    }

    const hint =
      app.state.settings.mode === "owned"
        ? 'You may not own enough suitable Aniimo. Add more on the Roster tab, or switch Settings to "Also suggest Aniimo I don\'t own yet".'
        : "Try lowering a requirement or building count.";
    panel.classList.remove("is-hidden");
    panel.innerHTML = `
      <h3>Still missing</h3>
      <ul>${result.missing.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <p>${escapeHtml(hint)}</p>
    `;
  }

  function ownershipTag(worker) {
    if (app.state.settings.mode !== "theorycraft") return "";
    const owned = worker.owned !== false;
    return `<span class="own-tag ${owned ? "is-owned" : "is-unowned"}">${owned ? "Owned" : "Not owned yet"}</span>`;
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
              <h4>${escapeHtml(worker.displayName)}${worker.copy > 1 ? ` (copy ${worker.copy})` : ""} ${ownershipTag(worker)}</h4>
              <p><strong>Main job:</strong> ${escapeHtml(worker.primaryAssignment)}</p>
              ${
                worker.secondaryAssignments.length
                  ? `<ul class="assignment-list">${worker.secondaryAssignments.map((assignment) => `<li>${escapeHtml(assignment)}</li>`).join("")}</ul>`
                  : ""
              }
              <div class="worker-skill-row">${skillChips(worker.skills)}</div>
              <p>Why: ${escapeHtml(worker.reason)}</p>
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
            <td><span class="status-pill ${row.status === "OK" ? "ok" : "missing"}">${escapeHtml(row.status === "OK" ? "OK" : "Short")}</span></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderStaffing(result) {
    const tbody = document.querySelector("#staffingTable tbody");
    if (!result.physicalStaffing.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="work-model-text">No buildings need staff. Add some on the Homeland tab.</td></tr>`;
      return;
    }
    tbody.innerHTML = result.physicalStaffing
      .map((row) => {
        return `
          <tr>
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(row.needLabel)}</td>
            <td>${escapeHtml(row.assignedLabel)}</td>
            <td><span class="status-pill ${row.status === "OK" ? "ok" : "missing"}">${escapeHtml(row.status === "OK" ? "OK" : "Short")}</span></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderUnused(result) {
    const container = document.getElementById("unusedResults");
    container.className = "unused-results";
    const ownedUnused = result.unusedWorkers.filter((worker) => worker.owned !== false);

    if (!ownedUnused.length) {
      container.className = "unused-results empty-state";
      container.textContent = Object.values(app.state.roster).some((entry) => Number(entry.quantity) > 0)
        ? 'Every Aniimo you own (and ticked "Include in plan") is already in the plan.'
        : "You haven't added any Aniimo on the Roster tab yet.";
      return;
    }

    container.innerHTML = ownedUnused
      .slice(0, 80)
      .map((worker) => `<span class="unused-chip">${escapeHtml(displayWorker(worker))}${worker.copy > 1 ? ` (copy ${worker.copy})` : ""}</span>`)
      .join("");
  }

  function renderSpareSpaces(result) {
    const container = document.getElementById("spareResults");
    const notice = document.getElementById("capacityNotice");
    const capacity = getCapacityInfo();
    const zone = getZone();
    const plan = window.AniimoOptimizer.recommendSpareSpaces({
      result,
      capacity: capacity.capacity,
      homebuildingReserve: getHomebuildingReserve(),
      homebuildingZone: getHomelandData()?.homebuildingZone || { name: zone.name },
      skills: app.data.aniimo.skills,
      mode: app.state.settings.mode,
    });

    if (plan.overCapacity) {
      notice.classList.remove("is-hidden");
      notice.innerHTML = `
        <h3>Too many Aniimo for your Homeland</h3>
        <p>
          Your Homeland has room for <strong>${plan.capacity}</strong> Aniimo, but this plan needs
          <strong>${plan.used}</strong> – that's ${plan.overBy} too many. Raise your RV level, build fewer
          buildings, lower some requirements, or look for Aniimo with more abilities so fewer can do the work.
        </p>
      `;
    } else {
      notice.classList.add("is-hidden");
      notice.innerHTML = "";
    }

    if (!plan.capacityKnown) {
      container.className = "empty-state";
      container.innerHTML = `
        <div>
          <p>Tell us how many Aniimo your Homeland can hold to get ideas for any spare spaces.</p>
          <button type="button" class="secondary-button" data-goto-tab="homeland">Set RV level / spaces</button>
        </div>
      `;
      return;
    }

    if (plan.overCapacity) {
      container.className = "empty-state";
      container.textContent = "No spare spaces – the plan already needs more room than you have.";
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
              ${ownershipTag(entry)}
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
    renderAll();
  }

  function abilityDot(skill, size = "") {
    const meta = ABILITY_META[skill] || { abbr: String(skill).slice(0, 2), color: "#667085" };
    const className = size === "small" ? "ability-dot small" : "ability-dot";
    return `<span class="${className}" style="background:${meta.color}" title="${escapeAttr(skill)}" aria-hidden="true">${escapeHtml(meta.abbr)}</span>`;
  }

  function skillChips(skillMap) {
    const chips = app.data.aniimo.skills
      .filter((skill) => Number(skillMap?.[skill] || 0) > 0)
      .map((skill) => {
        return `<span class="skill-pill">${abilityDot(skill, "small")} ${escapeHtml(skill)} ${Number(skillMap[skill])}</span>`;
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
