#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_JSON = path.join(ROOT, "data", "aniimo.json");
const OUTPUT_JS = path.join(ROOT, "data", "aniimo-data.js");
const OVERRIDES_JSON = path.join(ROOT, "data", "aniimo-overrides.json");
const SOURCE_URL = "https://aniimo.gg/homeland/work/";
const HIDEOUT_URL = "https://backup.hideoutgacha.com/games/aniimo/homeland-abilities";
const ANIILOG_URL = "https://aniimo.gg/aniilog/";
const CATEGORIES = ["common", "prismana", "legendary"];

const SKILLS = [
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

function fetchText(url) {
  if (typeof fetch === "function") {
    return fetch(url, {
      headers: {
        "user-agent": "aniimo-homeland-planner-data-refresh/1.0",
      },
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }
      return response.text();
    });
  }

  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "aniimo-homeland-planner-data-refresh/1.0" } }, (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Fetch failed: ${response.statusCode}`));
          response.resume();
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeWhitespace(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function emptySkills() {
  return Object.fromEntries(SKILLS.map((skill) => [skill, 0]));
}

function slugFromHref(href) {
  return href
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/aniimo\/(?:aniimo\/)?/i, "")
    .replace(/^\/+|\/+$/g, "");
}

// aniimo.gg slug conventions (derived from the shipped game IDs it exposes):
//   "glacy"            base species
//   "glacy-1004303"    7-digit ID: a collectible form (regional form, Prismana, ...)
//   "infergon-boss" / "tuckin-9020700"  boss entities (IDs starting with 9)
//   "glacy-100430001"  9-digit ID: internal encounter/NPC copy (tower climb,
//                      shrine puzzle, tutorial, test data, ...). These are not
//                      separate collectible forms, so they are excluded by default.
function classifySlug(name, slug) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes("boss") || slug.endsWith("-boss")) return "boss";
  const suffix = slug.match(/-(\d+)$/)?.[1];
  if (!suffix) return "base";
  if (suffix.length === 7 && suffix.startsWith("9")) return "boss";
  if (suffix.length === 7) return "form";
  return "internal";
}

function absolutizeImage(src) {
  if (!src) return "";
  if (/^https?:\/\//i.test(src)) return src;
  return `https://aniimo.gg${src.startsWith("/") ? "" : "/"}${src}`;
}

function newRecord({ id, name, species, form, image, source }) {
  return { id, name, species, form, image, skills: emptySkills(), source };
}

// Each ability section on the work page starts with a coloured circle holding the in-game ability
// icon (hotlinked from cdn.beskor.net), followed by the ability name.
function parseAbilityIcons(html) {
  const icons = {};
  const pattern =
    /<span[^>]*style="background:\s*(#[0-9a-fA-F]{3,8})"[^>]*>\s*<img[^>]*src="([^"]+)"[^>]*\/?>\s*<\/span>\s*<div class="min-w-0 flex-1">\s*<div class="font-display[^"]*">([A-Za-z]+)</g;
  for (const match of html.matchAll(pattern)) {
    const [, color, src, skill] = match;
    if (SKILLS.includes(skill) && !icons[skill]) icons[skill] = { icon: absolutizeImage(decodeHtml(src)), color: color.toLowerCase() };
  }
  const missing = SKILLS.filter((skill) => !icons[skill]);
  if (missing.length) throw new Error(`Could not find ability icons for: ${missing.join(", ")}`);
  // Keep the game's ability order.
  return Object.fromEntries(SKILLS.map((skill) => [skill, icons[skill]]));
}

// The Aniilog page (aniimo.gg/aniilog/) embeds one JSON object per species, for example
//   {"key":"1004300","href":"/aniimo/aniimo/glacy/","name":"Glacy","sub":"Ice / Water · Stage 3",
//    ...,"badge":"#015","hidden":false,"group":"Water",...}
// "badge" is the in-game Aniilog number ("#015", or "#10001" for special entries such as Irisalis), "Starter"
// for the two starters, or "Secret" for entries the released game does not number (datamined Aniimo from
// the betas or the next region, and the starters' battle transformations). "sub" carries the stage; the
// game's two Legendary Aniimo (Somniwing and Irisalis) are the only Stage 4 species.
function parseAniilog(html) {
  const text = html.replace(/\\"/g, '"');
  const entries = [];
  const seen = new Set();
  const pattern = /\{"key":"(\d+)","href":"([^"]+)","name":"([^"]+)","sub":"([^"]+)"((?:(?!"key":)[\s\S])*?)"badge":"([^"]*)","hidden":(true|false)/g;
  for (const match of text.matchAll(pattern)) {
    const [, templateId, href, name, sub, middle, badge, hidden] = match;
    const slug = slugFromHref(href);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const stage = Number(sub.match(/Stage\s*(\d+)/i)?.[1] || 0);
    const number = badge.match(/^#(\d+)$/)?.[1];
    entries.push({
      slug,
      templateId,
      name: decodeHtml(name),
      sub: decodeHtml(sub),
      stage,
      badge: decodeHtml(badge),
      dexNumber: number ? Number(number) : null,
      secret: badge === "Secret" || /\bSecret\b/i.test(sub),
      hidden: hidden === "true",
      image: absolutizeImage(middle.match(/"texture":"([^"]+)"/)?.[1] || ""),
    });
  }
  return entries;
}

// "glacy-1004303" -> "glacy", "infergon-boss" -> "infergon", "tuckin-prismana" -> "tuckin".
function speciesSlugOf(id) {
  return String(id).replace(/-(?:\d+|boss|prismana)$/i, "");
}

// Aniilog number as the game and aniimo.gg show it: "#001" (at least three digits).
function formatDex(number) {
  return `#${String(number).padStart(3, "0")}`;
}

// Species pages show the game's template ID ("1004300"). IDs starting with 9 are boss/NPC entities.
function parseTemplateId(html) {
  return html.match(/title="Template id[^"]*"[\s\S]{0,300}?<code[^>]*>(\d+)<\/code>/)?.[1] || "";
}

function parseAbilitySections(html) {
  const records = new Map();
  const sectionSummaries = [];

  for (const skill of SKILLS) {
    const headerPattern = new RegExp(`<div class="font-display[^"]*[^>]*>${skill}(?:\\s|<)`);
    const header = html.match(headerPattern);
    if (!header) {
      throw new Error(`Could not find section for skill: ${skill}`);
    }

    const headerIndex = header.index;
    const sectionStart = html.lastIndexOf("<section", headerIndex);
    const sectionEnd = html.indexOf("</section>", headerIndex);
    if (sectionStart === -1 || sectionEnd === -1) {
      throw new Error(`Could not find section bounds for skill: ${skill}`);
    }

    const section = html.slice(sectionStart, sectionEnd + "</section>".length);
    const expectedCount = Number(section.match(/<span class="shrink-0 text-\[12px\] text-dim">(\d+)/)?.[1] || 0);
    let parsedCount = 0;

    const cardPattern = /<a class="flex items-center[\s\S]*?href="([^"]+)"[\s\S]*?<\/a>/g;
    for (const cardMatch of section.matchAll(cardPattern)) {
      const [card, href] = cardMatch;
      const nameMatch = card.match(/<span class="min-w-0 flex-1 truncate text-\[12\.5px\] text-ink">([\s\S]*?)<\/span>/);
      const levelMatch = card.match(/Lv\s*<!-- -->\s*(\d+)/);
      if (!nameMatch || !levelMatch) continue;

      const id = slugFromHref(href);
      const rawName = normalizeWhitespace(nameMatch[1]);
      const level = Number(levelMatch[1]);
      const image = absolutizeImage(card.match(/src="([^"]*UI_PetHead[^"]+)"/)?.[1] || "");

      if (!records.has(id)) {
        const kind = classifySlug(rawName, id);
        const species = rawName.replace(/\s*BOSS$/i, "");
        const record = newRecord({
          id,
          name: kind === "boss" && !/boss/i.test(rawName) ? `${rawName} BOSS` : rawName,
          species,
          form: kind === "boss" ? "BOSS" : kind === "base" ? "Base" : `Variant ${id.match(/-(\d+)$/)[1]}`,
          image,
          source: { name: "Beskor Aniimo Homeland Work Abilities", url: SOURCE_URL },
        });
        record.kind = kind;
        records.set(id, record);
      }

      const record = records.get(id);
      record.skills[skill] = level;
      if (!record.image && image) record.image = image;
      parsedCount += 1;
    }

    if (expectedCount && parsedCount !== expectedCount) {
      throw new Error(`Expected ${expectedCount} ${skill} entries, parsed ${parsedCount}`);
    }

    sectionSummaries.push({ skill, expectedCount, parsedCount });
  }

  return { records: [...records.values()], sectionSummaries };
}

// Species page: the "Forms" strip links every collectible form with its in-game label.
function parseFormLinks(html) {
  const start = html.indexOf(">Forms</div>");
  if (start === -1) return [];
  const block = html.slice(start, start + 8000);
  const end = block.indexOf("</div></div>");
  const strip = end === -1 ? block : block.slice(0, end);
  const links = [];
  for (const match of strip.matchAll(/<a title="([^"]+)"[^>]*href="([^"]+)"[\s\S]*?(?:src="([^"]+)")?[^>]*>/g)) {
    const [, title, href, src] = match;
    links.push({ title: decodeHtml(title), slug: slugFromHref(href), image: absolutizeImage(src || "") });
  }
  return links;
}

// Aniimo page: the "Homeland Work" card lists each ability and level.
function parseHomelandWork(html) {
  const start = html.indexOf("Homeland Work<");
  if (start === -1) return null;
  const nextHeading = html.indexOf("<h2", start + 20);
  const block = html.slice(start, nextHeading === -1 ? start + 6000 : nextHeading);
  const skills = emptySkills();
  let found = 0;
  for (const match of block.matchAll(/text-ink">([A-Za-z]+)<\/span><span[^>]*>Lv\s*(?:<!-- -->)?\s*(\d+)/g)) {
    const [, skill, level] = match;
    if (skill in skills) {
      skills[skill] = Number(level);
      found += 1;
    }
  }
  return found ? skills : null;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchText(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

// Released Aniilog species that the work page does not list (e.g. Somniwing): read their own page.
async function collectMissingSpecies(aniilogEntries, knownIds) {
  const added = [];
  const failures = [];
  const missing = aniilogEntries.filter((entry) => entry.dexNumber !== null && !knownIds.has(entry.slug));
  await mapLimit(missing, 4, async (entry) => {
    const url = `https://aniimo.gg/aniimo/${entry.slug}/`;
    try {
      const html = await fetchWithRetry(url);
      const skills = parseHomelandWork(html);
      if (!skills) return;
      const record = newRecord({
        id: entry.slug,
        name: entry.name,
        species: entry.name,
        form: "Base",
        image: entry.image,
        source: { name: "Beskor Aniimo page", url },
      });
      record.skills = skills;
      record.kind = "base";
      knownIds.add(entry.slug);
      added.push(record);
    } catch (error) {
      failures.push({ url, error: String(error.message || error) });
    }
  });
  return { added, failures };
}

async function collectForms(baseRecords, knownIds) {
  const formRecords = [];
  const failures = [];

  const speciesPages = await mapLimit(baseRecords, 6, async (base) => {
    try {
      return { base, html: await fetchWithRetry(`https://aniimo.gg/aniimo/${base.id}/`) };
    } catch (error) {
      failures.push({ url: `https://aniimo.gg/aniimo/${base.id}/`, error: String(error.message || error) });
      return { base, html: "" };
    }
  });

  const pending = [];
  for (const { base, html } of speciesPages) {
    const templateId = parseTemplateId(html);
    if (templateId) base.templateId = templateId;
    for (const link of parseFormLinks(html)) {
      if (link.slug === base.id || knownIds.has(link.slug)) continue;
      if (classifySlug(base.name, link.slug) !== "form") continue;
      knownIds.add(link.slug);
      pending.push({ base, link });
    }
  }

  await mapLimit(pending, 6, async ({ base, link }) => {
    const url = `https://aniimo.gg/aniimo/${link.slug}/`;
    try {
      const skills = parseHomelandWork(await fetchWithRetry(url));
      if (!skills) return;
      const isPrismana = /^prismana/i.test(link.title);
      const record = newRecord({
        id: link.slug,
        name: isPrismana ? `Prismana ${base.species}` : base.species,
        species: base.species,
        form: isPrismana ? "Prismana" : link.title,
        image: link.image || base.image,
        source: { name: "Beskor Aniimo page", url },
      });
      record.skills = skills;
      formRecords.push(record);
    } catch (error) {
      failures.push({ url, error: String(error.message || error) });
    }
  });

  return { formRecords, failures };
}

// Hideout Guides lists Prismana breeds in its table (levels 3+ only).
function parseHideoutPrismana(html) {
  const rows = [];
  for (const match of html.matchAll(/<tr class="border-b[\s\S]*?<\/tr>/g)) {
    const row = match[0];
    if (!/uppercase tracking-wide[^>]*>Prismana</.test(row)) continue;
    const name = normalizeWhitespace(row.match(/text-sm text-white truncate">([^<]+)/)?.[1] || "");
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => normalizeWhitespace(cell[1]));
    if (!name || cells.length < SKILLS.length) continue;
    const skills = emptySkills();
    SKILLS.forEach((skill, index) => {
      const level = Number(cells[index]);
      if (Number.isFinite(level) && level > 0) skills[skill] = level;
    });
    rows.push({ name, skills });
  }
  return rows;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function mergeHideoutPrismana(records, hideoutRows) {
  const report = { listed: hideoutRows.length, added: [], mismatches: [] };
  for (const row of hideoutRows) {
    const existing = records.find((record) => record.species === row.name && record.form === "Prismana");
    if (existing) {
      // Hideout omits levels below 3, so only compare those.
      const diffs = SKILLS.filter((skill) => {
        const ours = existing.skills[skill] >= 3 ? existing.skills[skill] : 0;
        return ours !== row.skills[skill];
      });
      if (diffs.length) {
        report.mismatches.push({ name: row.name, skills: diffs.map((s) => `${s}: aniimo.gg ${existing.skills[s]} vs hideout ${row.skills[s]}`) });
      }
      continue;
    }
    const base = records.find((record) => record.species === row.name && record.form === "Base");
    records.push({
      id: `${base ? base.id : slugify(row.name)}-prismana`,
      name: `Prismana ${row.name}`,
      species: row.name,
      form: "Prismana",
      image: base?.image || "",
      skills: row.skills,
      source: { name: "Hideout Guides Aniimo Homeland Worker Abilities", url: HIDEOUT_URL },
      // aniimo.gg reads the shipped game files and its forms match the game's own list of 25 Prismana
      // Aniimo, so a Prismana form only Hideout lists is left out (see excludeUnobtainable).
      hideoutOnly: true,
    });
    report.added.push(row.name);
  }
  return report;
}

function applyOverrides(records, overrides) {
  const applied = [];
  for (const entry of overrides) {
    const form = entry.form || "Base";
    const skills = { ...emptySkills(), ...(entry.skills || {}) };
    let record = records.find((item) => item.species === entry.species && item.form === form);
    if (!record) {
      const base = records.find((item) => item.species === entry.species && item.form === "Base");
      record = {
        id: entry.id || `${base ? base.id : slugify(entry.species)}-${slugify(form)}`,
        name: form === "Prismana" ? `Prismana ${entry.species}` : entry.species,
        species: entry.species,
        form,
        image: entry.image || base?.image || "",
        skills: emptySkills(),
        source: {},
      };
      records.push(record);
    }
    if (entry.name) record.name = entry.name;
    record.skills = skills;
    record.source = { name: "Manual override (data/aniimo-overrides.json)", url: entry.sourceUrl || "", notes: entry.notes || "" };
    applied.push(`${record.name} (${record.form})`);
  }
  return applied;
}

function matchesEntry(record, entry) {
  if (entry.id) return record.id === entry.id;
  if (entry.species !== record.species) return false;
  return !entry.form || entry.form === record.form;
}

// Renames from data/aniimo-overrides.json "renames": { "from": "<species>", "to": "<species>", "reason" }.
// For placeholder names on aniimo.gg that the game shows differently. Applies to every form of the species.
function applyRenames(records, renames) {
  const applied = [];
  for (const entry of renames) {
    if (!entry || !entry.from || !entry.to) continue;
    for (const record of records) {
      if (record.species !== entry.from) continue;
      const before = record.name;
      record.species = entry.to;
      record.name = record.name.split(entry.from).join(entry.to);
      applied.push({ id: record.id, from: before, to: record.name, reason: entry.reason || "" });
    }
  }
  return applied;
}

// Only Aniimo a player can actually own are kept: each record's species must have a number in the released
// game's Aniilog (or be a starter). Everything else is removed and listed with the reason in
// scrape.excluded, so the list can be audited. Manual "exclusions" in data/aniimo-overrides.json
// ({ species, form?, id?, reason }) win and give their own reason.
function excludeUnobtainable(records, aniilogEntries, manualExclusions) {
  const bySlug = new Map(aniilogEntries.map((entry) => [entry.slug, entry]));
  const byName = new Map(aniilogEntries.map((entry) => [entry.name, entry]));
  const kept = [];
  const excluded = [];
  for (const record of records) {
    const entry = bySlug.get(speciesSlugOf(record.id)) || byName.get(record.species);
    const manual = manualExclusions.find((item) => item && matchesEntry(record, item));
    let reason = "";
    if (manual) {
      reason = manual.reason || "Excluded in data/aniimo-overrides.json.";
    } else if (record.kind === "boss" || record.form === "BOSS" || /^9\d{6}$/.test(record.templateId || "")) {
      reason =
        "Boss encounter, not a collectible Aniimo (aniimo.gg lists it as a boss form with a game ID starting with 9). Omega bosses can't be caught; an Alpha you catch is an ordinary member of its species.";
    } else if (!entry) {
      reason = "Not in the Aniilog, so not a collectible Aniimo (NPC, story or test entity).";
    } else if (entry.dexNumber === null) {
      reason = `The Aniilog lists ${entry.name} as "${entry.badge}" (${entry.sub}) with no Aniilog number: it is in the game files but not in the released game (datamined from the betas or an unreleased region).`;
    } else if (record.hideoutOnly) {
      reason =
        "Prismana form listed only by Hideout Guides. aniimo.gg (read from the shipped game files) has no such form, and its Prismana forms match the game's own count of 25.";
    }
    if (reason) {
      excluded.push({ id: record.id, name: record.name, form: record.form, aniilog: entry ? entry.badge : null, reason });
    } else {
      record.dexNumber = entry.dexNumber;
      record.dexLabel = entry.badge.startsWith("#") ? formatDex(entry.dexNumber) : entry.badge;
      kept.push(record);
    }
  }
  records.splice(0, records.length, ...kept);
  return excluded.sort((a, b) => a.id.localeCompare(b.id));
}

// category decides whether the planner offers an Aniimo by default:
//   common    – base and regional forms you can normally catch (on by default)
//   prismana  – Prismana forms (off unless the player ticks them)
//   legendary – Legendary species from the Aniilog (Stage 4), off unless ticked
// data/aniimo-overrides.json "categories" entries (species + optional form) win over all of this.
function assignCategories(records, legendarySpecies, overrides) {
  const report = { legendary: [], overridden: [] };
  for (const record of records) {
    let category = "common";
    if (legendarySpecies.has(record.species)) category = "legendary";
    else if (record.form === "Prismana") category = "prismana";
    record.category = category;
  }
  for (const entry of overrides) {
    if (!entry || !CATEGORIES.includes(entry.category)) continue;
    for (const record of records) {
      if (record.species !== entry.species) continue;
      if (entry.form && record.form !== entry.form) continue;
      record.category = entry.category;
      report.overridden.push(`${record.name} (${record.form}): ${entry.category}`);
    }
  }
  for (const record of records) {
    if (record.category === "legendary") report.legendary.push(`${record.name} (${record.form})`);
  }
  return report;
}

// Aniilog order: by number, each species' forms together (base, regional forms A–Z, then Prismana).
function formRank(record) {
  if (record.form === "Base") return 0;
  if (record.form === "Prismana") return 2;
  if (record.form === "Alpha") return 3;
  return 1;
}

function compareRecords(a, b) {
  return (
    a.dexNumber - b.dexNumber ||
    formRank(a) - formRank(b) ||
    a.form.localeCompare(b.form) ||
    a.id.localeCompare(b.id)
  );
}

function sortRecords(records) {
  return records.sort(compareRecords);
}

function buildPayload(records, scrape, abilityIcons) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    skills: SKILLS,
    // In-game ability icons as aniimo.gg shows them: a white glyph on a coloured circle.
    abilityIcons,
    categories: {
      common: "Base and regional forms you can normally catch. The planner uses these by default.",
      prismana: "Prismana forms. Only used when the player ticks them.",
      legendary: "Legendary Aniimo (the Aniilog's Stage 4 species). Only used when the player ticks them.",
    },
    // Shown to players under "About the data", so keep names and notes in plain English.
    sources: [
      {
        name: "aniimo.gg – Homeland work abilities",
        url: SOURCE_URL,
        notes:
          "Our main list of every Aniimo and its Homeland ability levels, including regional forms and Prismana, taken from the game's own files.",
      },
      {
        name: "Hideout Guides – Homeland worker abilities",
        url: HIDEOUT_URL,
        notes:
          "A second list we compare Prismana ability levels against to catch mistakes.",
      },
      {
        name: "aniimo.gg – Aniilog",
        url: ANIILOG_URL,
        notes:
          "The in-game Aniimo index. Gives each Aniimo its Aniilog number (#001 to #082, plus special numbers such as #10001 Irisalis) and decides which Aniimo are in the released game: entries marked \"Secret\" with no number (datamined or not yet released) are left out. Also marks the Legendary Aniimo: Somniwing and Irisalis are the only Stage 4 species.",
      },
      {
        name: "Player corrections",
        kind: "override",
        url: "data/aniimo-overrides.json",
        notes: "Corrections checked in-game by players. These replace the values above where they differ.",
      },
    ],
    scrape,
    aniimo: records,
  };
}

function stripGeneratedAt(payload) {
  const copy = JSON.parse(JSON.stringify(payload));
  delete copy.generatedAt;
  return copy;
}

function preserveTimestampWhenUnchanged(payload) {
  if (!fs.existsSync(OUTPUT_JSON)) return payload;

  try {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_JSON, "utf8"));
    const existingStable = JSON.stringify(stripGeneratedAt(existing));
    const nextStable = JSON.stringify(stripGeneratedAt(payload));
    if (existingStable === nextStable && existing.generatedAt) {
      return { ...payload, generatedAt: existing.generatedAt };
    }
  } catch {
    return payload;
  }

  return payload;
}

async function main() {
  const overridesFile = fs.existsSync(OVERRIDES_JSON) ? JSON.parse(fs.readFileSync(OVERRIDES_JSON, "utf8")) : {};

  // The Aniilog decides which Aniimo are in the released game, so without it nothing is written.
  const aniilogEntries = parseAniilog(await fetchWithRetry(ANIILOG_URL));
  if (aniilogEntries.filter((entry) => entry.dexNumber !== null).length < 50) {
    throw new Error(`Aniilog parse looks wrong: only ${aniilogEntries.length} entries`);
  }
  // Starters show "Starter" instead of a number; their hidden Aniilog numbers come from the overrides.
  const dexOverrides = [];
  for (const item of overridesFile.dexNumbers || []) {
    const entry = aniilogEntries.find((candidate) => candidate.name === item.species);
    if (!entry || !Number.isFinite(item.dexNumber)) continue;
    entry.dexNumber = item.dexNumber;
    dexOverrides.push({ species: item.species, dexNumber: item.dexNumber, label: entry.badge, source: item.source || "" });
  }

  const html = await fetchText(SOURCE_URL);
  const { records: workRecords, sectionSummaries } = parseAbilitySections(html);
  const abilityIcons = parseAbilityIcons(html);

  const includeInternal = process.env.INCLUDE_INTERNAL_VARIANTS === "1";
  const internal = workRecords.filter((record) => record.kind === "internal");
  const records = workRecords.filter((record) => includeInternal || record.kind !== "internal");
  const knownIds = new Set(workRecords.map((record) => record.id));

  const missing = await collectMissingSpecies(aniilogEntries, knownIds);
  records.push(...missing.added);

  const baseRecords = records.filter((record) => record.kind === "base");
  const { formRecords, failures } = await collectForms(baseRecords, knownIds);
  failures.push(...missing.failures);
  records.push(...formRecords);

  let hideout = { listed: 0, added: [], mismatches: [], error: null };
  try {
    hideout = { ...hideout, ...mergeHideoutPrismana(records, parseHideoutPrismana(await fetchWithRetry(HIDEOUT_URL))) };
  } catch (error) {
    hideout.error = String(error.message || error);
  }

  const overridesApplied = applyOverrides(records, overridesFile.overrides || []);
  const renamed = applyRenames(records, overridesFile.renames || []);
  const excluded = excludeUnobtainable(records, aniilogEntries, overridesFile.exclusions || []);

  const legendarySpecies = new Set(aniilogEntries.filter((entry) => entry.stage >= 4).map((entry) => entry.name));
  const categoryReport = assignCategories(records, legendarySpecies, overridesFile.categories || []);

  for (const record of records) {
    delete record.kind;
    delete record.templateId;
    delete record.hideoutOnly;
  }
  sortRecords(records);

  const scrape = {
    url: SOURCE_URL,
    sectionSummaries,
    recordCount: records.length,
    formPagesAdded: formRecords.length,
    speciesPagesAdded: missing.added.map((record) => record.name),
    internalVariantsExcluded: includeInternal ? [] : internal.map((record) => record.id).sort(),
    internalVariantsNote:
      "aniimo.gg lists 9-digit-ID copies of some Aniimo (tower climb, shrine puzzle, tutorial, NPC and test entities, per their internal editor names). They are not collectible forms and are excluded. Set INCLUDE_INTERNAL_VARIANTS=1 to keep them.",
    dexSource: `${ANIILOG_URL} (each entry's badge, e.g. "#015"; starters from data/aniimo-overrides.json dexNumbers)`,
    dexOverrides,
    aniilogUnnumbered: aniilogEntries
      .filter((entry) => entry.dexNumber === null)
      .map((entry) => `${entry.name} (${entry.sub})`),
    excluded,
    excludedNote:
      "Records removed because they are not Aniimo a player can own: not numbered in the released game's Aniilog, boss/NPC entities, or Prismana forms only one secondary source lists. Manual entries live in data/aniimo-overrides.json exclusions.",
    renamed,
    hideoutPrismana: hideout,
    legendarySpecies: [...legendarySpecies].sort(),
    legendarySource: ANIILOG_URL,
    categoryReport,
    overridesApplied,
    fetchFailures: failures,
  };

  const payload = preserveTimestampWhenUnchanged(buildPayload(records, scrape, abilityIcons));
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const js = `window.ANIIMO_DATA = ${json.replace(/<\/script/gi, "<\\/script")};\n`;

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, json);
  fs.writeFileSync(OUTPUT_JS, js);

  console.log(`Wrote ${records.length} Aniimo/forms to ${path.relative(ROOT, OUTPUT_JSON)}`);
  console.log(`Forms from species pages: ${formRecords.length}; species pages added: ${scrape.speciesPagesAdded.join(", ") || "none"}; internal variants excluded: ${scrape.internalVariantsExcluded.length}`);
  console.log(`Excluded (${excluded.length}): ${excluded.map((item) => item.name + (item.form === "Base" ? "" : ` (${item.form})`)).join(", ") || "none"}`);
  console.log(`Renamed: ${renamed.map((item) => `${item.from} -> ${item.to}`).join(", ") || "none"}`);
  console.log(`Hideout Prismana listed: ${hideout.listed}; Hideout-only: ${hideout.added.join(", ") || "none"}; mismatches: ${hideout.mismatches.length}`);
  if (hideout.error) console.warn(`Hideout cross-reference failed: ${hideout.error}`);
  console.log(`Overrides applied: ${overridesApplied.join(", ") || "none"}`);
  console.log(`Legendary species: ${scrape.legendarySpecies.join(", ")}; legendary records: ${categoryReport.legendary.join(", ") || "none"}`);
  if (failures.length) console.warn(`Fetch failures: ${failures.length}`, failures.slice(0, 5));
  for (const summary of sectionSummaries) {
    console.log(`${summary.skill}: ${summary.parsedCount}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  SKILLS,
  classifySlug,
  assignCategories,
  parseAbilityIcons,
  parseAniilog,
  speciesSlugOf,
  formatDex,
  excludeUnobtainable,
  applyRenames,
  compareRecords,
  parseTemplateId,
  parseAbilitySections,
  parseFormLinks,
  parseHomelandWork,
  parseHideoutPrismana,
  applyOverrides,
};
