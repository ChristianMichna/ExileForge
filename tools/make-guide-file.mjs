#!/usr/bin/env node
// Wraps a published guide and its stored PoB results into an Astrolabe guide file.
// Usage: node tools/make-guide-file.mjs <guide.json> <results.json> <out.json>
// results.json: object keyed by calcId (or an array of results with calcId).
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [guidePath, resultsPath, outPath] = process.argv.slice(2);
if (!guidePath || !resultsPath || !outPath) {
  console.error("Usage: node tools/make-guide-file.mjs <guide.json> <results.json> <out.json>");
  process.exit(2);
}
if ([guidePath, resultsPath].includes(outPath)) {
  console.error("The output file must not be one of the inputs.");
  process.exit(2);
}
const contracts = await import(pathToFileURL(resolve("packages/contracts/dist/index.js")).href);
const guide = JSON.parse(readFileSync(guidePath, "utf8"));
const raw = JSON.parse(readFileSync(resultsPath, "utf8"));
const results = Array.isArray(raw) ? Object.fromEntries(raw.map((r) => [r.calcId, r])) : raw;
const file = { format: contracts.GUIDE_FILE_FORMAT, version: 1, guide, results };
const parsed = contracts.GuideFile.safeParse(file);
if (!parsed.success) {
  console.error("Not a valid guide file:");
  for (const issue of parsed.error.issues.slice(0, 10))
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
writeFileSync(outPath, JSON.stringify(parsed.data));
console.log(`Wrote ${outPath} (${Object.keys(results).length} results)`);
