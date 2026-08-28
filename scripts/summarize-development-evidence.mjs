import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_DIR = path.join(".cache", "development-evidence");
export const EVIDENCE_CLASSES = ["source", "local", "ci", "hosted", "provider", "production", "human", "outcome"];

function parseArgs(argv) {
  const parsed = {
    dir: DEFAULT_DIR,
    json: false,
    limit: 10
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--dir" || token === "--limit") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
      index += 1;
      if (token === "--dir") parsed.dir = value;
      else parsed.limit = Number(value);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isInteger(parsed.limit) || parsed.limit < 1 || parsed.limit > 100) {
    throw new Error("--limit must be an integer between 1 and 100.");
  }

  return parsed;
}

function emptyCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function increment(counts, key) {
  const normalized = key || "unknown";
  counts[normalized] = (counts[normalized] || 0) + 1;
}

export function readRecords(dir) {
  if (!fs.existsSync(dir)) return { records: [], invalidRecords: [] };

  const files = fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => path.join(dir, file));

  const records = [];
  const invalidRecords = [];
  for (const file of files) {
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      records.push({ file, record });
    } catch (error) {
      invalidRecords.push({ file, error: error.message });
    }
  }

  return { records, invalidRecords };
}

export function buildSummary({ dir, records, invalidRecords, limit }) {
  const byPhase = {};
  const byBranch = {};
  const validationOutcomes = {};
  const evidenceClassRecords = emptyCounts(EVIDENCE_CLASSES);
  const residualRiskCounts = {};
  const nextActionCounts = {};
  const failedValidations = [];
  const missingPlannerTimestamp = [];
  const missingHumanDecision = [];
  const dirtyRecords = [];

  for (const item of records) {
    const { file, record } = item;
    increment(byPhase, record.phase);
    increment(byBranch, record.branch);
    if (record.dirty) dirtyRecords.push(file);
    if (!record.plannerRecordedAt) missingPlannerTimestamp.push(file);
    if (!record.humanDecision) missingHumanDecision.push(file);

    for (const validation of Array.isArray(record.validations) ? record.validations : []) {
      increment(validationOutcomes, validation.outcome);
      if (!/^pass(ed)?$/i.test(String(validation.outcome || ""))) {
        failedValidations.push({
          file,
          task: record.task || "unknown",
          command: validation.command || "unknown",
          outcome: validation.outcome || "unknown",
          notes: validation.notes || ""
        });
      }
    }

    for (const evidenceClass of EVIDENCE_CLASSES) {
      const values = record.evidence?.[evidenceClass];
      if (Array.isArray(values) && values.length > 0) evidenceClassRecords[evidenceClass] += 1;
    }

    for (const risk of Array.isArray(record.residualRisks) ? record.residualRisks : []) {
      increment(residualRiskCounts, risk);
    }
    if (record.nextAction) increment(nextActionCounts, record.nextAction);
  }

  const sortedRecords = [...records].sort((a, b) => {
    return String(b.record.recordedAt || "").localeCompare(String(a.record.recordedAt || ""));
  });

  const repeatedResidualRisks = Object.entries(residualRiskCounts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([risk, count]) => ({ risk, count }));

  const repeatedNextActions = Object.entries(nextActionCounts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([nextAction, count]) => ({ nextAction, count }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceDir: dir,
    totals: {
      records: records.length,
      invalidRecords: invalidRecords.length,
      dirtyRecords: dirtyRecords.length,
      failedValidations: failedValidations.length,
      missingPlannerTimestamp: missingPlannerTimestamp.length,
      missingHumanDecision: missingHumanDecision.length
    },
    byPhase,
    byBranch,
    validationOutcomes,
    evidenceClassRecords,
    repeatedResidualRisks,
    repeatedNextActions,
    recentRecords: sortedRecords.slice(0, limit).map(({ file, record }) => ({
      file,
      recordedAt: record.recordedAt || null,
      task: record.task || "unknown",
      phase: record.phase || "unknown",
      branch: record.branch || "unknown",
      dirty: Boolean(record.dirty),
      validations: Array.isArray(record.validations) ? record.validations.length : 0,
      residualRisks: Array.isArray(record.residualRisks) ? record.residualRisks.length : 0
    })),
    failedValidations: failedValidations.slice(0, limit),
    invalidRecords: invalidRecords.slice(0, limit),
    recommendations: buildRecommendations({
      records,
      invalidRecords,
      dirtyRecords,
      failedValidations,
      repeatedResidualRisks,
      repeatedNextActions
    })
  };
}

function buildRecommendations({ records, invalidRecords, dirtyRecords, failedValidations, repeatedResidualRisks, repeatedNextActions }) {
  const recommendations = [];
  if (!records.length) {
    recommendations.push("Create task records with npm run evidence:task after meaningful local work.");
  }
  if (invalidRecords.length) {
    recommendations.push("Inspect malformed evidence records before using this index for trend decisions.");
  }
  if (failedValidations.length) {
    recommendations.push("Review failed validation commands before promoting any repeated workflow change.");
  }
  if (repeatedResidualRisks.length) {
    recommendations.push("Convert repeated residual risks into a targeted check, planner rule, doc update, or skill only after confirming the pattern is structural.");
  }
  if (repeatedNextActions.length) {
    recommendations.push("Promote repeated next actions when they would reduce future task setup or validation effort.");
  }
  if (dirtyRecords.length) {
    recommendations.push("When evidence is collected in dirty trees, keep unrelated WIP explicit in handoff and stage only owned paths.");
  }
  if (!recommendations.length) {
    recommendations.push("No repeated development-system friction is visible yet.");
  }
  return recommendations;
}

function formatText(summary) {
  const lines = [
    "Development Evidence Index",
    `- generated_at: ${summary.generatedAt}`,
    `- source_dir: ${summary.sourceDir}`,
    `- records: ${summary.totals.records}`,
    `- invalid_records: ${summary.totals.invalidRecords}`,
    `- dirty_records: ${summary.totals.dirtyRecords}`,
    `- failed_validations: ${summary.totals.failedValidations}`,
    `- missing_planner_timestamp: ${summary.totals.missingPlannerTimestamp}`,
    `- missing_human_decision: ${summary.totals.missingHumanDecision}`,
    "- evidence_classes:",
    ...EVIDENCE_CLASSES.map((name) => `  - ${name}: ${summary.evidenceClassRecords[name]}`),
    "- repeated_residual_risks:",
    ...(summary.repeatedResidualRisks.length
      ? summary.repeatedResidualRisks.map((item) => `  - ${item.count}x ${item.risk}`)
      : ["  - none"]),
    "- repeated_next_actions:",
    ...(summary.repeatedNextActions.length
      ? summary.repeatedNextActions.map((item) => `  - ${item.count}x ${item.nextAction}`)
      : ["  - none"]),
    "- recent_records:",
    ...(summary.recentRecords.length
      ? summary.recentRecords.map((item) => `  - ${item.recordedAt || "unknown"} ${item.task} (${item.phase}, ${item.branch})`)
      : ["  - none"]),
    "- recommendations:",
    ...summary.recommendations.map((item) => `  - ${item}`)
  ];

  if (summary.failedValidations.length) {
    lines.push("- failed_validation_details:");
    lines.push(...summary.failedValidations.map((item) => `  - ${item.task}: ${item.command} -> ${item.outcome}`));
  }
  if (summary.invalidRecords.length) {
    lines.push("- invalid_record_details:");
    lines.push(...summary.invalidRecords.map((item) => `  - ${item.file}: ${item.error}`));
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { records, invalidRecords } = readRecords(args.dir);
  const summary = buildSummary({
    dir: args.dir,
    records,
    invalidRecords,
    limit: args.limit
  });
  console.log(args.json ? JSON.stringify(summary, null, 2) : formatText(summary));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`Development evidence index failed: ${error.message}`);
    process.exit(1);
  }
}
