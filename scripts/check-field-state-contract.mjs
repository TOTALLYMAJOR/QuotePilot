import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIELD_STATE_AXES,
  FIELD_STATE_DEFINITIONS,
  FIELD_STATE_PRIMARY_ORDER
} from "../src/lib/fieldState.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const CONTRACT_PATH = path.join(REPO_ROOT, "docs/field-state-contract.json");
const REGISTRY_PATH = path.join(REPO_ROOT, "docs/field-state-surface-contracts.json");

const EXPECTED_AXES = ["availability", "origin", "editability", "persistence", "evidence"];
const EXPECTED_LABELS = [
  "Unknown",
  "Not provided",
  "Not applicable",
  "Defaulted",
  "Suggested",
  "Prepopulated",
  "Draft",
  "Saving",
  "Saved",
  "Published",
  "Pending",
  "Confirmed",
  "Failed",
  "Unavailable",
  "Stale",
  "Blocked",
  "Read-only",
  "Protected",
  "Historical/imported"
];

function readJson(filePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${path.relative(REPO_ROOT, filePath)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function safeRepositoryPath(relativePath, repoRoot = REPO_ROOT) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") return null;
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolutePath;
}

function listFilesRecursively(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursively(absolutePath) : [absolutePath];
  });
}

function findSharedPrimitiveAdopters(repoRoot = REPO_ROOT, adoptionRoots = []) {
  return adoptionRoots.flatMap((relativeRoot) => {
    const absoluteRoot = safeRepositoryPath(relativeRoot, repoRoot);
    if (!absoluteRoot || !fs.existsSync(absoluteRoot)) return [];
    return listFilesRecursively(absoluteRoot)
      .filter((absolutePath) => /\.(?:js|jsx|ts|tsx)$/.test(absolutePath))
      .filter((absolutePath) => !absolutePath.split(path.sep).includes("__tests__"))
      .filter((absolutePath) => {
        const source = fs.readFileSync(absolutePath, "utf8");
        return /from\s+["'][^"']*(?:FieldStateIndicator|AdaptiveChoiceField)["']/.test(source);
      })
      .map((absolutePath) => path.relative(repoRoot, absolutePath).split(path.sep).join("/"));
  }).sort();
}

function comparableDefinition(definition) {
  const comparable = {
    axis: definition.axis,
    label: definition.label,
    meaning: definition.meaning,
    priority: definition.priority,
    tone: definition.tone,
    announce: definition.announce
  };
  for (const key of ["requiresReason", "requiresRecovery", "requiresProvenance"]) {
    if (definition[key] === true) comparable[key] = true;
  }
  return comparable;
}

function sameMembers(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function validateFieldStateContract({ contract, registry, repoRoot = REPO_ROOT }) {
  const errors = [];
  if (!contract || !registry) return ["Field-state contract and surface registry are both required."];

  if (contract.contractId !== "quote-pilot-field-state-v1") {
    errors.push("field-state-contract.json must declare contractId quote-pilot-field-state-v1.");
  }
  if (contract.schemaVersion !== 1 || registry.schemaVersion !== 1) {
    errors.push("Field-state contract and surface registry must use schemaVersion 1.");
  }
  if (registry.contractId !== contract.contractId) {
    errors.push("Field-state surface registry must reference the canonical contractId.");
  }

  const contractAxes = Object.keys(contract.axes || {});
  if (JSON.stringify(contractAxes) !== JSON.stringify(EXPECTED_AXES)) {
    errors.push(`Field-state axes must be exactly: ${EXPECTED_AXES.join(", ")}.`);
  }

  const contractDefinitions = new Map();
  for (const axis of EXPECTED_AXES) {
    const axisContract = contract.axes?.[axis];
    if (!axisContract || typeof axisContract.baseline !== "string" || !Array.isArray(axisContract.states)) {
      errors.push(`Axis ${axis} must declare a baseline and states array.`);
      continue;
    }
    for (const definition of axisContract.states) {
      if (!definition?.id || contractDefinitions.has(definition.id)) {
        errors.push(`Field state ids must be non-empty and unique; found ${String(definition?.id)}.`);
        continue;
      }
      contractDefinitions.set(definition.id, { axis, ...definition });
    }
  }

  const contractLabels = [...contractDefinitions.values()].map((definition) => definition.label).sort();
  if (JSON.stringify(contractLabels) !== JSON.stringify([...EXPECTED_LABELS].sort())) {
    errors.push("Field-state labels drifted from the 19 canonical user-facing labels.");
  }

  const priorities = [...contractDefinitions.values()].map((definition) => definition.priority);
  if (priorities.some((priority) => !Number.isInteger(priority)) || new Set(priorities).size !== priorities.length) {
    errors.push("Every field state must have one unique integer primary priority.");
  }

  if ([...contractDefinitions.values()].some((definition) => typeof definition.meaning !== "string" || definition.meaning.trim() === "")) {
    errors.push("Every field state must define its user-facing meaning.");
  }

  for (const [axis, ids] of Object.entries(FIELD_STATE_AXES)) {
    const contractIds = contract.axes?.[axis]?.states?.map((state) => state.id) || [];
    if (JSON.stringify(contractIds) !== JSON.stringify(ids)) {
      errors.push(`Runtime ${axis} states do not match the canonical contract order.`);
    }
  }

  for (const [id, runtimeDefinition] of Object.entries(FIELD_STATE_DEFINITIONS)) {
    const contractDefinition = contractDefinitions.get(id);
    if (!contractDefinition) {
      errors.push(`Runtime state ${id} is missing from the canonical contract.`);
      continue;
    }
    const runtimeComparable = comparableDefinition(runtimeDefinition);
    const contractComparable = comparableDefinition(contractDefinition);
    if (JSON.stringify(runtimeComparable) !== JSON.stringify(contractComparable)) {
      errors.push(`Runtime definition ${id} does not match the canonical contract.`);
    }
  }

  const contractPrimaryOrder = [...contractDefinitions.values()]
    .sort((left, right) => left.priority - right.priority)
    .map((definition) => definition.id);
  if (JSON.stringify(contractPrimaryOrder) !== JSON.stringify(FIELD_STATE_PRIMARY_ORDER)) {
    errors.push("Runtime primary-state precedence does not match the canonical contract.");
  }

  const detailRules = [
    ["reasonRequiredFor", "requiresReason"],
    ["recoveryRequiredFor", "requiresRecovery"]
  ];
  for (const [contractKey, definitionKey] of detailRules) {
    const expected = [...contractDefinitions.values()]
      .filter((definition) => definition[definitionKey] === true)
      .map((definition) => definition.id);
    if (!sameMembers(contract.presentation?.[contractKey], expected)) {
      errors.push(`presentation.${contractKey} must match state-definition requirements.`);
    }
  }

  for (const announce of ["polite", "assertive"]) {
    const expected = [...contractDefinitions.values()]
      .filter((definition) => definition.announce === announce)
      .map((definition) => definition.id);
    if (!sameMembers(contract.presentation?.liveStates?.[announce], expected)) {
      errors.push(`presentation.liveStates.${announce} must match state-definition announcements.`);
    }
  }

  if (
    contract.composition?.oneStatePerAxis !== true
    || contract.composition?.axesMayCoexist !== true
    || contract.presentation?.provenanceRequiredForAxis !== "origin"
  ) {
    errors.push("Field-state composition must preserve one state per axis, cross-axis coexistence, and origin provenance.");
  }

  if (registry.runtime?.path !== contract.runtimeModule) {
    errors.push("The registered field-state runtime must match contract.runtimeModule.");
  }

  const registeredPaths = new Set();
  const registrations = [registry.runtime, ...(registry.surfaces || [])];
  for (const registration of registrations) {
    if (!registration?.path || registeredPaths.has(registration.path)) {
      errors.push(`Registered field-state paths must be non-empty and unique; found ${String(registration?.path)}.`);
      continue;
    }
    registeredPaths.add(registration.path);
    const absolutePath = safeRepositoryPath(registration.path, repoRoot);
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      errors.push(`Registered field-state surface does not exist: ${registration.path}.`);
      continue;
    }
    const source = fs.readFileSync(absolutePath, "utf8");
    if (!Array.isArray(registration.markers) || registration.markers.length === 0) {
      errors.push(`Registered field-state surface needs exact markers: ${registration.path}.`);
    } else {
      for (const marker of registration.markers) {
        if (typeof marker !== "string" || !source.includes(marker)) {
          errors.push(`Missing marker "${String(marker)}" in ${registration.path}.`);
        }
      }
    }
    const testPaths = [...new Set([
      registration.testPath,
      ...(Array.isArray(registration.testPaths) ? registration.testPaths : [])
    ].filter(Boolean))];
    if (registration !== registry.runtime && testPaths.length === 0) {
      errors.push(`Registered field-state surface needs an assertion-bearing test: ${registration.path}.`);
    }
    for (const registeredTestPath of testPaths) {
      const testPath = path.resolve(repoRoot, registeredTestPath);
      const relativeTestPath = path.relative(repoRoot, testPath);
      if (relativeTestPath.startsWith("..") || path.isAbsolute(relativeTestPath) || !fs.existsSync(testPath)) {
        errors.push(`Registered field-state test does not exist: ${registeredTestPath}.`);
      }
    }
  }

  if (
    registry.coverage?.mode !== "shared-primitive-import-registration"
    || registry.coverage?.wholeRepositoryScan !== false
    || !Array.isArray(registry.coverage?.adoptionRoots)
    || registry.coverage.adoptionRoots.length === 0
  ) {
    errors.push("Field-state registry must scan shared-primitive imports within explicit adoption roots, not unrelated repository text.");
  } else {
    const adopters = findSharedPrimitiveAdopters(repoRoot, registry.coverage.adoptionRoots);
    adopters.forEach((adopterPath) => {
      if (!registeredPaths.has(adopterPath)) {
        errors.push(`Unregistered field-state adopter: ${adopterPath}.`);
      }
    });
  }

  const adaptiveSurface = registry.surfaces?.find((surface) => surface.id === "adaptive-choice-field");
  if (!sameMembers(adaptiveSurface?.modes, ["empty", "single", "select"])) {
    errors.push("Adaptive choice registration must cover empty, single, and select modes.");
  }

  return errors;
}

function main() {
  const parseErrors = [];
  const contract = readJson(CONTRACT_PATH, parseErrors);
  const registry = readJson(REGISTRY_PATH, parseErrors);
  const errors = [
    ...parseErrors,
    ...validateFieldStateContract({ contract, registry })
  ];

  if (errors.length > 0) {
    console.error("field-state-contract: invalid");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `field-state-contract: valid (${Object.keys(FIELD_STATE_DEFINITIONS).length} states, ${registry.surfaces.length} registered surfaces)`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) main();
