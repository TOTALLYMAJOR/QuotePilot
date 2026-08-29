// Schema and revision drift detection.
//
// The exporter refuses to guess. If a source document declares a schema
// version this exporter was not written against, the section is exported as
// `schema_drift` rather than read with current-shape assumptions. Reading an
// unknown shape optimistically is how a reconciler starts reporting confident
// numbers about fields that no longer mean what it thinks.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CONTRACT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/truthloop-evidence-contract.json"
);

let cachedContract = null;

export function evidenceContract() {
  if (!cachedContract) {
    cachedContract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
  }
  return cachedContract;
}

/** @returns {{ known: boolean, expected: Array, received: string|number }} */
export function checkSourceSchema(sourceName, received) {
  const known = evidenceContract().knownSourceSchemaVersions[sourceName];
  if (!Array.isArray(known)) {
    return { known: false, expected: [], received, unknownSource: true };
  }
  return {
    known: known.some((value) => String(value) === String(received)),
    expected: known,
    received,
    unknownSource: false
  };
}

export function driftDetail(sourceName, check) {
  if (check.unknownSource) {
    return `Source ${sourceName} is not declared in the evidence contract.`;
  }
  return (
    `Source ${sourceName} declares schema ${String(check.received) || "(none)"}; `
    + `this exporter knows ${check.expected.join(", ")}.`
  );
}
