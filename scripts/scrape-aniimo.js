#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_JSON = path.join(ROOT, "data", "aniimo.json");
const OUTPUT_JS = path.join(ROOT, "data", "aniimo-data.js");
const SOURCE_URL = "https://aniimo.gg/homeland/work/";

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

function formFromSlug(name, slug) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes("boss") || slug.endsWith("-boss")) {
    return "BOSS";
  }

  const suffix = slug.match(/-(\d{6,})$/);
  if (suffix) {
    return `Variant ${suffix[1]}`;
  }

  return "Base";
}

function absolutizeImage(src) {
  if (!src) return "";
  if (/^https?:\/\//i.test(src)) return src;
  return `https://aniimo.gg${src.startsWith("/") ? "" : "/"}${src}`;
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
      const name = normalizeWhitespace(nameMatch[1]);
      const level = Number(levelMatch[1]);
      const image = absolutizeImage(card.match(/src="([^"]*UI_PetHead[^"]+)"/)?.[1] || "");

      if (!records.has(id)) {
        records.set(id, {
          id,
          name,
          form: formFromSlug(name, id),
          image,
          skills: emptySkills(),
          source: {
            name: "Beskor Aniimo Homeland Work Abilities",
            url: SOURCE_URL,
          },
        });
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

  return {
    records: [...records.values()].sort((a, b) => {
      const nameSort = a.name.localeCompare(b.name);
      if (nameSort) return nameSort;
      const formSort = a.form.localeCompare(b.form);
      if (formSort) return formSort;
      return a.id.localeCompare(b.id);
    }),
    sectionSummaries,
  };
}

function buildPayload(records, sectionSummaries) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    skills: SKILLS,
    sources: [
      {
        name: "Beskor Aniimo Homeland Work Abilities",
        url: SOURCE_URL,
        notes:
          "Primary normalized source. The page is static-rendered and lists the 13 Homeland work abilities with linked Aniimo and ability levels.",
      },
      {
        name: "Hideout Guides Aniimo Homeland Worker Abilities",
        url: "https://backup.hideoutgacha.com/games/aniimo/homeland-abilities",
        notes:
          "Cross-reference source for level 3+ workers and Prismana entries; not used as the primary scrape because it omits lower-level workers.",
      },
      {
        name: "Aniimo Homeland Guide",
        url: "https://aniimo.io/en/guide/homeland",
        notes: "Reference for the 13 ability categories and plain-language job descriptions.",
      },
    ],
    scrape: {
      url: SOURCE_URL,
      sectionSummaries,
      recordCount: records.length,
    },
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
  const { records, sectionSummaries } = parseAbilitySections(html);
  const payload = preserveTimestampWhenUnchanged(buildPayload(records, sectionSummaries));
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const js = `window.ANIIMO_DATA = ${json.replace(/<\/script/gi, "<\\/script")};\n`;

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, json);
  fs.writeFileSync(OUTPUT_JS, js);

  console.log(`Wrote ${records.length} Aniimo/forms to ${path.relative(ROOT, OUTPUT_JSON)}`);
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
  parseAbilitySections,
};
