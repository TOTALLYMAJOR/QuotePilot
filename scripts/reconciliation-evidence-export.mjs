#!/usr/bin/env node
// Commercial Truth Loop evidence exporter.
//
// Reads authoritative QuotePilot records and writes a canonical evidence
// bundle plus an evidence-coverage report. Read-only: it opens no write path,
// and it refuses to fabricate any evidence a producer cannot supply.
//
//   node scripts/reconciliation-evidence-export.mjs \
//     --source <sources.json> --evaluated-at <ISO> \
//     --out <bundle.json> --coverage-out <coverage.json>
//
// `--source` supplies already-read documents as JSON. A Firestore-backed
// source is a separate, separately reviewed step; keeping the read behind this
// seam is what lets the projection be tested against the real writer modules
// without a database.

import fs from "node:fs";
import path from "node:path";

import { exportBundle } from "../evidence/src/exporterCore.mjs";
import { canonicalJson } from "../evidence/src/canonical.mjs";
import { coverageReport, renderCoverageText } from "../evidence/src/coverage.mjs";
import { producerRegistry, guarded } from "../evidence/src/producers/index.mjs";
import { createPayoutProducer } from "../evidence/src/producers/payoutProducer.mjs";
import { createFeeScheduleProducer } from "../evidence/src/producers/feeScheduleProducer.mjs";
import { createConsumptionProducer } from "../evidence/src/producers/consumptionProducer.mjs";
import { missing } from "../evidence/src/availability.mjs";

const USAGE = `Usage: reconciliation-evidence-export.mjs [options]

  --source <file>        JSON file of already-read source documents (required)
  --evaluated-at <ISO>   Evaluation instant (required; never read from a clock)
  --out <file>           Write the evidence bundle here (default: stdout)
  --coverage-out <file>  Write the coverage report JSON here
  --coverage             Print the coverage report as text
  --help                 Show this message
`;

function parseArgs(argv) {
  const options = {
    source: "",
    evaluatedAt: "",
    out: "",
    coverageOut: "",
    coverage: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} requires a value.`);
      }
      index += 1;
      return value;
    };
    switch (flag) {
      case "--source": options.source = next(); break;
      case "--evaluated-at": options.evaluatedAt = next(); break;
      case "--out": options.out = next(); break;
      case "--coverage-out": options.coverageOut = next(); break;
      case "--coverage": options.coverage = true; break;
      case "--help": case "-h": process.stdout.write(USAGE); process.exit(0); break;
      default: throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!options.source) throw new Error("--source is required.");
  // The evaluation instant is an input, never a clock read: two runs over the
  // same source state must produce the same bytes.
  if (!options.evaluatedAt) throw new Error("--evaluated-at is required.");
  if (Number.isNaN(Date.parse(options.evaluatedAt))) {
    throw new Error("--evaluated-at must be an ISO-8601 timestamp.");
  }
  return options;
}

export function buildProducers(sourceDocument = {}) {
  const organizationSettings = sourceDocument.organizationSettings || {};
  const consumptionRecords = sourceDocument.actualConsumption || {};
  return producerRegistry([
    // No settlement source is passed, so this stays inert behind the Connect
    // stopping point. See evidence/src/producers/payoutProducer.mjs.
    guarded(createPayoutProducer(), { missing }),
    guarded(
      createFeeScheduleProducer({
        readOrganizationSettings: (organizationId) =>
          organizationSettings[organizationId] || null
      }),
      { missing }
    ),
    guarded(
      createConsumptionProducer({
        readConsumption: (record) => consumptionRecords[record.quoteId] || null
      }),
      { missing }
    )
  ]);
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return 2;
  }

  let sourceDocument;
  try {
    sourceDocument = JSON.parse(fs.readFileSync(path.resolve(options.source), "utf8"));
  } catch (error) {
    process.stderr.write(`Source could not be read: ${error.message}\n`);
    return 2;
  }

  const sources = Array.isArray(sourceDocument.records) ? sourceDocument.records : [];
  const producers = buildProducers(sourceDocument);

  let bundle;
  try {
    bundle = exportBundle(
      sources.map((record) => ({
        ...record,
        organizationSettings:
          (sourceDocument.organizationSettings || {})[record.quote?.organizationId] || null
      })),
      { evaluatedAtISO: options.evaluatedAt, producers }
    );
  } catch (error) {
    process.stderr.write(`Export failed: ${error.message}\n`);
    return 2;
  }

  const rendered = `${canonicalJson(bundle)}\n`;
  if (options.out) fs.writeFileSync(path.resolve(options.out), rendered, "utf8");
  else if (!options.coverage) process.stdout.write(rendered);

  if (options.coverage || options.coverageOut) {
    const report = coverageReport(bundle);
    if (options.coverageOut) {
      fs.writeFileSync(
        path.resolve(options.coverageOut),
        `${canonicalJson(report)}\n`,
        "utf8"
      );
    }
    if (options.coverage) process.stdout.write(renderCoverageText(report));
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}

export { main, parseArgs };
