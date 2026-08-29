import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIFECYCLE_STATES = Object.freeze([
  'IDEA',
  'SPECIFIED',
  'DESIGNED',
  'IMPLEMENTED',
  'TESTED',
  'VERIFIED',
  'DEPLOYED',
  'USED',
  'COMMERCIALLY_PROVEN',
  'DEPRECATED',
  'BLOCKED',
]);

const REQUIRED_COLLECTIONS = Object.freeze([
  'goals',
  'capabilities',
  'journeys',
  'decisions',
  'integrations',
  'risks',
  'blockers',
  'proofEvents',
  'commercialEvidence',
  'nextActions',
]);

const REQUIRED_CAPABILITY_FIELDS = Object.freeze([
  'id',
  'name',
  'description',
  'lifecycle_state',
  'confidence',
  'evidence',
  'dependencies',
  'blockers',
  'last_verified',
  'owner_or_authority',
]);

const PLACEHOLDER = /^(?:tbd|todo|unknown|fixme|n\/a)$/i;
const FRESHNESS_REQUIRED = new Set([
  'TESTED',
  'VERIFIED',
  'DEPLOYED',
  'USED',
  'COMMERCIALLY_PROVEN',
]);

function readJson(filePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`${path.relative(process.cwd(), filePath) || filePath}: ${error.message}`);
    return null;
  }
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function dayAge(date, nowDate) {
  return Math.floor((Date.parse(`${nowDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}

function validateUniqueIds(collectionName, records, errors) {
  const seen = new Set();
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(`${collectionName}[${index}] must be an object`);
      continue;
    }
    if (typeof record.id !== 'string' || !record.id.trim()) {
      errors.push(`${collectionName}[${index}] must have a non-empty id`);
      continue;
    }
    if (seen.has(record.id)) errors.push(`${collectionName} has duplicate id ${record.id}`);
    seen.add(record.id);
  }
}

function validateRepositoryPath(root, value, label, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label} must name a repository-relative path`);
    return;
  }
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    errors.push(`${label} must stay inside the repository: ${value}`);
    return;
  }
  if (!fs.existsSync(path.join(root, value))) errors.push(`${label} does not exist: ${value}`);
}

function validateMarkdownContracts(root, errors) {
  const contracts = [
    ['PROJECT_STATE.md', '## NEXT PROOF EVENT'],
    ['docs/project/EXECUTIVE_STATE.md', '## Next Proof Event'],
    ['docs/project/CAPABILITIES.md', 'docs/FEATURE_MATRIX.md'],
    ['docs/project/BLOCKERS.md', 'DEV_TASKS.md'],
  ];
  for (const [relativePath, marker] of contracts) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`required control-plane document does not exist: ${relativePath}`);
      continue;
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    if (!content.includes(marker)) errors.push(`${relativePath} must contain ${marker}`);
  }
}

export function validateControlPlane({ root = process.cwd(), nowDate = new Date().toISOString().slice(0, 10) } = {}) {
  const errors = [];
  const warnings = [];
  const statePath = path.join(root, '.project/state.json');
  const portfolioPath = path.join(root, '.project/portfolio.json');
  const state = readJson(statePath, errors);
  const portfolio = readJson(portfolioPath, errors);

  if (!state || !portfolio) return { errors, warnings, state, portfolio };
  if (state.schemaVersion !== 1) errors.push('.project/state.json schemaVersion must be 1');
  if (portfolio.schemaVersion !== 1) errors.push('.project/portfolio.json schemaVersion must be 1');
  if (!state.project || typeof state.project !== 'object') errors.push('.project/state.json project must be an object');
  if (!state.canonicalSources || typeof state.canonicalSources !== 'object') errors.push('.project/state.json canonicalSources must be an object');
  if (!isIsoDate(state.lastReconciled)) errors.push('lastReconciled must be an ISO date');

  for (const collectionName of REQUIRED_COLLECTIONS) {
    if (!Array.isArray(state[collectionName])) {
      errors.push(`${collectionName} must be an array`);
    } else {
      validateUniqueIds(collectionName, state[collectionName], errors);
    }
  }
  if (errors.some((error) => error.endsWith('must be an array'))) {
    return { errors, warnings, state, portfolio };
  }

  for (const [key, sourcePath] of Object.entries(state.canonicalSources)) {
    validateRepositoryPath(root, sourcePath, `canonicalSources.${key}`, errors);
  }

  const capabilityIds = new Set(state.capabilities.map(({ id }) => id));
  const integrationIds = new Set(state.integrations.map(({ id }) => id));
  const blockerIds = new Set(state.blockers.map(({ id }) => id));
  const dependencyIds = new Set([...capabilityIds, ...integrationIds]);

  for (const capability of state.capabilities) {
    for (const field of REQUIRED_CAPABILITY_FIELDS) {
      if (!(field in capability)) errors.push(`capability ${capability.id ?? '<missing>'} is missing ${field}`);
    }
    if (!LIFECYCLE_STATES.includes(capability.lifecycle_state)) {
      errors.push(`capability ${capability.id} has invalid lifecycle_state ${capability.lifecycle_state}`);
    }
    if (!['HIGH', 'MEDIUM', 'LOW'].includes(capability.confidence)) {
      errors.push(`capability ${capability.id} has invalid confidence ${capability.confidence}`);
    }
    if (typeof capability.name !== 'string' || PLACEHOLDER.test(capability.name.trim())) {
      errors.push(`capability ${capability.id} has placeholder name`);
    }
    if (typeof capability.owner_or_authority !== 'string' || PLACEHOLDER.test(capability.owner_or_authority.trim())) {
      errors.push(`capability ${capability.id} has missing or placeholder authority`);
    }
    if (!Array.isArray(capability.dependencies) || !Array.isArray(capability.blockers) || !Array.isArray(capability.evidence)) {
      errors.push(`capability ${capability.id} evidence, dependencies, and blockers must be arrays`);
      continue;
    }
    for (const dependencyId of capability.dependencies) {
      if (!dependencyIds.has(dependencyId)) errors.push(`capability ${capability.id} references unknown dependency ${dependencyId}`);
    }
    for (const blockerId of capability.blockers) {
      if (!blockerIds.has(blockerId)) errors.push(`capability ${capability.id} references unknown blocker ${blockerId}`);
    }
    if (capability.lifecycle_state === 'BLOCKED' && capability.blockers.length === 0) {
      errors.push(`blocked capability ${capability.id} must reference a blocker`);
    }
    if (capability.lifecycle_state === 'DEPRECATED' && !capability.superseded_by) {
      errors.push(`deprecated capability ${capability.id} must name superseded_by`);
    }
    if (FRESHNESS_REQUIRED.has(capability.lifecycle_state)) {
      if (capability.evidence.length === 0) errors.push(`capability ${capability.id} requires evidence for ${capability.lifecycle_state}`);
      if (!isIsoDate(capability.last_verified)) {
        errors.push(`capability ${capability.id} requires an ISO last_verified date`);
      } else if (dayAge(capability.last_verified, nowDate) > 120) {
        errors.push(`capability ${capability.id} verification is stale (${capability.last_verified})`);
      } else if (dayAge(capability.last_verified, nowDate) < 0) {
        errors.push(`capability ${capability.id} verification is in the future (${capability.last_verified})`);
      }
    }
    for (const [evidenceIndex, evidence] of capability.evidence.entries()) {
      validateRepositoryPath(root, evidence.path, `capability ${capability.id} evidence[${evidenceIndex}].path`, errors);
      if (!isIsoDate(evidence.verifiedAt)) errors.push(`capability ${capability.id} evidence[${evidenceIndex}] requires verifiedAt`);
      if (typeof evidence.type !== 'string' || typeof evidence.status !== 'string') {
        errors.push(`capability ${capability.id} evidence[${evidenceIndex}] requires type and status`);
      }
    }
  }

  for (const journey of state.journeys) {
    if (!LIFECYCLE_STATES.includes(journey.lifecycle_state)) errors.push(`journey ${journey.id} has invalid lifecycle_state ${journey.lifecycle_state}`);
    for (const blockerId of journey.blockers ?? []) {
      if (!blockerIds.has(blockerId)) errors.push(`journey ${journey.id} references unknown blocker ${blockerId}`);
    }
  }

  for (const decision of state.decisions) validateRepositoryPath(root, decision.evidence, `decision ${decision.id}.evidence`, errors);
  for (const integration of state.integrations) validateRepositoryPath(root, integration.evidence, `integration ${integration.id}.evidence`, errors);
  for (const blocker of state.blockers) validateRepositoryPath(root, blocker.source, `blocker ${blocker.id}.source`, errors);

  const nextProofEvents = state.proofEvents.filter(({ isNext }) => isNext === true);
  if (nextProofEvents.length !== 1) errors.push(`exactly one proof event must have isNext=true; found ${nextProofEvents.length}`);
  if (nextProofEvents[0]) {
    validateRepositoryPath(root, nextProofEvents[0].evidenceDestination, `proof event ${nextProofEvents[0].id}.evidenceDestination`, errors);
    for (const capabilityId of nextProofEvents[0].reducesUncertaintyFor ?? []) {
      if (!capabilityIds.has(capabilityId)) errors.push(`proof event ${nextProofEvents[0].id} references unknown capability ${capabilityId}`);
    }
  }

  for (const commercialRecord of state.commercialEvidence) {
    if (commercialRecord.verdict === 'UNVERIFIED' && commercialRecord.evidence.length > 0) {
      warnings.push(`commercial evidence ${commercialRecord.id} is UNVERIFIED but has evidence references; review the verdict`);
    }
    for (const evidencePath of commercialRecord.evidence ?? []) {
      validateRepositoryPath(root, evidencePath, `commercial evidence ${commercialRecord.id}`, errors);
    }
  }

  if (portfolio.projectId !== state.project.id) errors.push('portfolio projectId must match state.project.id');
  if (portfolio.canonicalStatePath !== '.project/state.json') errors.push('portfolio canonicalStatePath must be .project/state.json');
  if (!isIsoDate(portfolio.lastReconciled)) errors.push('portfolio lastReconciled must be an ISO date');
  validateRepositoryPath(root, portfolio.canonicalStatePath, 'portfolio.canonicalStatePath', errors);
  validateMarkdownContracts(root, errors);

  return { errors, warnings, state, portfolio };
}

function main() {
  const root = path.resolve(process.cwd());
  const result = validateControlPlane({ root });
  for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
  if (result.errors.length > 0) {
    console.error(`Project state check failed with ${result.errors.length} error(s):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Project state check passed: ${result.state.capabilities.length} capabilities, ` +
      `${result.state.blockers.length} blockers, ${result.state.proofEvents.length} proof event, ` +
      `${result.state.commercialEvidence.length} commercial evidence records.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
