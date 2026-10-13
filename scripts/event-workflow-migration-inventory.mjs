#!/usr/bin/env node
// Offline only. Reads explicitly supplied JSON and emits an advisory JSON report.
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const { buildInventory } = createRequire(import.meta.url)("./event-workflow-migration-inventory-core.cjs");
export { buildInventory };
export function runInventoryCli(argv = process.argv.slice(2), output = process.stdout) {
  if (argv.length !== 2 || argv[0] !== "--input" || !argv[1]) throw new Error("Usage: node scripts/event-workflow-migration-inventory.mjs --input <offline-proof.json>");
  const info = statSync(argv[1]);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error("Inventory requires a regular offline JSON file no larger than 16 MiB.");
  const report = buildInventory(JSON.parse(readFileSync(argv[1], "utf8")));
  output.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try { runInventoryCli(); } catch { process.stderr.write("Inventory input did not verify. No changes were applied.\n"); process.exitCode = 1; }
}
