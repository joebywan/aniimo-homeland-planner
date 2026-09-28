#!/usr/bin/env node
// Regenerates the file:// friendly JS wrappers for the hand-curated data files.
// Usage: node scripts/wrap-data.js
const fs = require("fs");
const path = require("path");

const DATA = path.resolve(__dirname, "..", "data");
const FILES = [
  ["buildings.json", "buildings-data.js", "ANIIMO_BUILDINGS_DATA"],
  ["crops.json", "crops-data.js", "ANIIMO_CROPS_DATA"],
  ["homeland.json", "homeland-data.js", "ANIIMO_HOMELAND_DATA"],
];

for (const [jsonName, jsName, globalName] of FILES) {
  const source = path.join(DATA, jsonName);
  if (!fs.existsSync(source)) continue;
  const json = `${JSON.stringify(JSON.parse(fs.readFileSync(source, "utf8")), null, 2)}\n`;
  const js = `window.${globalName} = ${json.trimEnd().replace(/<\/script/gi, "<\\/script")};\n`;
  fs.writeFileSync(path.join(DATA, jsName), js);
  console.log(`Wrote data/${jsName}`);
}
