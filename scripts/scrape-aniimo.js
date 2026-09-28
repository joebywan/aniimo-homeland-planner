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
const CATEGORIES = ["common", "prismana", "legendary", "boss"];

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

// The Aniilog page lists every species with a label such as "Grass · Stage 3", "Water · Stage 3 · Secret"
// or "Grass · Stage 4 · Prismana". The game's two Legendary Aniimo (Somniwing and Irisalis) are the only
// Stage 4 species, which is how legendaries are recognised.
function parseAniilog(html) {
  const entries = [];
  const seen = new Set();
  const pattern = /\\?"href\\?":\\?"([^"\\]+)\\?",\\?"name\\?":\\?"([^"\\]+)\\?",\\?"sub\\?":\\?"([^"\\]+)\\?"/g;
  for (const match of html.matchAll(pattern)) {
    const [, href, name, sub] = match;
    const slug = slugFromHref(href);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const stage = Number(sub.match(/Stage\s*(\d+)/i)?.[1] || 0);
    entries.push({ slug, name: decodeHtml(name), sub: decodeHtml(sub), stage, secret: /\bSecret\b/i.test(sub) });
  }
  return entries;
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

// category decides whether the planner offers an Aniimo by default:
//   common    – base and regional forms you can normally catch (on by default)
//   prismana  – Prismana forms (off unless the player ticks them)
//   legendary – Legendary species from the Aniilog (Stage 4), off unless ticked
//   boss      – BOSS forms and boss/NPC entities (template ID starting with 9), never on by default
// data/aniimo-overrides.json "categories" entries (species + optional form) win over all of this.
function assignCategories(records, legendarySpecies, overrides) {
  const report = { legendary: [], boss: [], overridden: [] };
  for (const record of records) {
    let category = "common";
    if (record.form === "BOSS" || record.kind === "boss" || /^9\d{6}$/.test(record.templateId || "")) category = "boss";
    else if (legendarySpecies.has(record.species)) category = "legendary";
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
    if (record.category === "boss") report.boss.push(`${record.name} (${record.form})`);
  }
  return report;
}

function sortRecords(records) {
  return records.sort((a, b) => {
    const speciesSort = (a.species || a.name).localeCompare(b.species || b.name);
    if (speciesSort) return speciesSort;
    const rank = (record) => (record.form === "Base" ? 0 : record.form === "Prismana" ? 2 : record.form === "BOSS" ? 3 : 1);
    const rankSort = rank(a) - rank(b);
    if (rankSort) return rankSort;
    const formSort = a.form.localeCompare(b.form);
    if (formSort) return formSort;
    return a.id.localeCompare(b.id);
  });
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
      boss: "BOSS forms and boss/NPC entities. Never used by default.",
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
          "A second list we compare against to catch mistakes, and to fill in any Prismana Aniimo missing from aniimo.gg.",
      },
      {
        name: "aniimo.gg – Aniilog",
        url: ANIILOG_URL,
        notes:
          "Which Aniimo are Legendary: the Aniilog labels Somniwing and Irisalis as Stage 4, the only Stage 4 species. Game8 and AniimoTools also list these two as the game's Legendary Aniimo.",
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
  const html = await fetchText(SOURCE_URL);
  const { records: workRecords, sectionSummaries } = parseAbilitySections(html);
  const abilityIcons = parseAbilityIcons(html);

  const includeInternal = process.env.INCLUDE_INTERNAL_VARIANTS === "1";
  const internal = workRecords.filter((record) => record.kind === "internal");
  const records = workRecords.filter((record) => includeInternal || record.kind !== "internal");
  const knownIds = new Set(workRecords.map((record) => record.id));

  const baseRecords = records.filter((record) => record.kind === "base");
  const { formRecords, failures } = await collectForms(baseRecords, knownIds);
  records.push(...formRecords);

  let hideout = { listed: 0, added: [], mismatches: [], error: null };
  try {
    hideout = { ...hideout, ...mergeHideoutPrismana(records, parseHideoutPrismana(await fetchWithRetry(HIDEOUT_URL))) };
  } catch (error) {
    hideout.error = String(error.message || error);
  }

  const overridesFile = fs.existsSync(OVERRIDES_JSON) ? JSON.parse(fs.readFileSync(OVERRIDES_JSON, "utf8")) : {};
  const overridesApplied = applyOverrides(records, overridesFile.overrides || []);

  let aniilog = { entries: [], error: null };
  try {
    aniilog.entries = parseAniilog(await fetchWithRetry(ANIILOG_URL));
  } catch (error) {
    aniilog.error = String(error.message || error);
  }
  const legendarySpecies = new Set(aniilog.entries.filter((entry) => entry.stage >= 4).map((entry) => entry.name));
  // Fallback when the Aniilog can't be read: the two Legendary Aniimo known at the time of writing.
  if (!legendarySpecies.size) ["Somniwing", "Irisalis"].forEach((name) => legendarySpecies.add(name));
  const categoryReport = assignCategories(records, legendarySpecies, overridesFile.categories || []);

  for (const record of records) {
    delete record.kind;
    delete record.templateId;
  }
  sortRecords(records);

  const scrape = {
    url: SOURCE_URL,
    sectionSummaries,
    recordCount: records.length,
    formPagesAdded: formRecords.length,
    internalVariantsExcluded: includeInternal ? [] : internal.map((record) => record.id).sort(),
    internalVariantsNote:
      "aniimo.gg lists 9-digit-ID copies of some Aniimo (tower climb, shrine puzzle, tutorial, NPC and test entities, per their internal editor names). They are not collectible forms and are excluded. Set INCLUDE_INTERNAL_VARIANTS=1 to keep them.",
    hideoutPrismana: hideout,
    legendarySpecies: [...legendarySpecies].sort(),
    legendarySource: aniilog.error ? `fallback list (Aniilog failed: ${aniilog.error})` : ANIILOG_URL,
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
  console.log(`Forms from species pages: ${formRecords.length}; internal variants excluded: ${scrape.internalVariantsExcluded.length}`);
  console.log(`Hideout Prismana listed: ${hideout.listed}; added: ${hideout.added.join(", ") || "none"}; mismatches: ${hideout.mismatches.length}`);
  if (hideout.error) console.warn(`Hideout cross-reference failed: ${hideout.error}`);
  console.log(`Overrides applied: ${overridesApplied.join(", ") || "none"}`);
  console.log(`Legendary species: ${scrape.legendarySpecies.join(", ")}; legendary records: ${categoryReport.legendary.join(", ") || "none"}`);
  console.log(`Boss records: ${categoryReport.boss.join(", ") || "none"}`);
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
  parseTemplateId,
  parseAbilitySections,
  parseFormLinks,
  parseHomelandWork,
  parseHideoutPrismana,
  applyOverrides,
};
