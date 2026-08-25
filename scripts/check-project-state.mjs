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

export const PROOF_VERDICTS = Object.freeze([
  'PROVEN',
  'PARTIALLY_PROVEN',
  'UNVERIFIED',
  'CONTRADICTED',
]);

const STATE_SCHEMA_VERSION = 2;

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

const REQUIRED_PROJECT_FIELDS = Object.freeze([
  'id',
  'name',
  'repository',
  'primaryPurpose',
  'archetype',
  'primaryActors',
  'economicBuyer',
  'problemSolved',
  'stage',
  'primaryDeploymentTarget',
  'lastEvidenceReconciliation',
]);

const REQUIRED_JOURNEY_FIELDS = Object.freeze([
  'id',
  'name',
  'primary',
  'actors',
  'trigger',
  'steps',
  'stateChange',
  'authorityOrEvidence',
  'nextState',
  'outcome',
  'lifecycle_state',
  'confidence',
  'blockers',
]);

const REQUIRED_BLOCKER_FIELDS = Object.freeze([
  'id',
  'priority',
  'status',
  'statement',
  'source',
  'affectedGoals',
  'affectedJourneys',
  'dependencies',
  'resolutionCondition',
]);

const REQUIRED_PROOF_EVENT_FIELDS = Object.freeze([
  'id',
  'isNext',
  'title',
  'hypothesis',
  'whyItMatters',
  'preconditions',
  'observableEvent',
  'acceptanceCriteria',
  'requiredEvidence',
  'blockers',
  'evidenceDestination',
  'reducesUncertaintyFor',
]);

const REQUIRED_COMMERCIAL_CATEGORIES = Object.freeze([
  'TARGET_BUYER',
  'BUYING_TRIGGER',
  'OFFER',
  'PRICE_HYPOTHESIS',
  'PROSPECTS',
  'DESIGN_PARTNERS',
  'PAID_CUSTOMERS',
  'ACTIVATION',
  'USAGE',
  'RETENTION',
  'MEASURED_OUTCOME',
  'REVENUE',
]);

const PLACEHOLDER = /\b(?:tbd|todo|fixme|placeholder)\b/i;
const FRESHNESS_REQUIRED = new Set([
  'TESTED',
  'VERIFIED',
  'DEPLOYED',
  'USED',
  'COMMERCIALLY_PROVEN',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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
    if (!isRecord(record)) {
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

function validateRequiredFields(label, record, fields, errors) {
  for (const field of fields) {
    if (!(field in record)) errors.push(`${label} is missing ${field}`);
  }
}

function validateNonEmptyString(value, label, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label} must be a non-empty string`);
    return;
  }
  if (PLACEHOLDER.test(value)) errors.push(`${label} contains unresolved placeholder text`);
}

function validateNonEmptyArray(value, label, errors, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return false;
  }
  if (!allowEmpty && value.length === 0) errors.push(`${label} must not be empty`);
  return true;
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
    ['PROJECT_STATE.md', ['## Identity', '## North-Star Goal', '## Canonical Journey', '## NEXT PROOF EVENT', '**Required Evidence:**', '**Current Blockers:**']],
    ['docs/project/EXECUTIVE_STATE.md', ['## What This Is', '## North Star', '## Current Reality', '## Capability State', '## What Is Not Proven', '## Primary Journey', '## Critical Decisions', '## Critical Blockers', '## Next Proof Event', '## Next Actions', '## Commercial / Operational Evidence', '## Confidence']],
    ['docs/project/CAPABILITIES.md', ['docs/FEATURE_MATRIX.md', '| Capability | Intended Outcome | State | Evidence | Missing Proof | Blocker |']],
    ['docs/project/DECISIONS.md', ['Decision ID:', 'Alternatives Considered:', 'Reversible:', 'Revisit Trigger:']],
    ['docs/project/EXPLORATIONS.md', ['Exploration:', 'Question:', 'Hypothesis:', 'Decision Required:', 'Status:']],
    ['docs/project/PROOF.md', ['| Claim | Required Evidence | Current Evidence | Verdict |']],
    ['docs/project/BLOCKERS.md', ['DEV_TASKS.md', 'Affected Goal', 'Affected Journey', 'Resolution Condition']],
    ['AGENTS.md', ['## Canonical State Completion Contract', 'What remains `UNVERIFIED`?', 'Did the single NEXT PROOF EVENT change?']],
  ];
  for (const [relativePath, markers] of contracts) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`required control-plane document does not exist: ${relativePath}`);
      continue;
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    for (const marker of markers) {
      if (!content.includes(marker)) errors.push(`${relativePath} must contain ${marker}`);
    }
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
  if (!isRecord(state)) errors.push('.project/state.json must contain an object');
  if (!isRecord(portfolio)) errors.push('.project/portfolio.json must contain an object');
  if (errors.length > 0) return { errors, warnings, state, portfolio };
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    errors.push(`.project/state.json schemaVersion must be ${STATE_SCHEMA_VERSION}`);
  }
  if (portfolio.schemaVersion !== 1) errors.push('.project/portfolio.json schemaVersion must be 1');
  if (!isRecord(state.project)) errors.push('.project/state.json project must be an object');
  if (!isRecord(state.canonicalSources)) errors.push('.project/state.json canonicalSources must be an object');
  if (!isIsoDate(state.lastReconciled)) errors.push('lastReconciled must be an ISO date');
  if (typeof state.reconciliationHead !== 'string' || !/^[a-f0-9]{40}$/u.test(state.reconciliationHead)) {
    errors.push('reconciliationHead must be a full lowercase Git SHA');
  }

  if (isRecord(state.project)) {
    validateRequiredFields('project', state.project, REQUIRED_PROJECT_FIELDS, errors);
    for (const field of REQUIRED_PROJECT_FIELDS) {
      if (field === 'primaryActors') {
        validateNonEmptyArray(state.project[field], `project.${field}`, errors);
      } else if (field === 'lastEvidenceReconciliation') {
        if (!isIsoDate(state.project[field])) errors.push(`project.${field} must be an ISO date`);
      } else {
        validateNonEmptyString(state.project[field], `project.${field}`, errors);
      }
    }
  }

  if (!isRecord(state.project) || !isRecord(state.canonicalSources)) {
    return { errors, warnings, state, portfolio };
  }

  let hasInvalidCollectionRecord = false;
  for (const collectionName of REQUIRED_COLLECTIONS) {
    if (!Array.isArray(state[collectionName])) {
      errors.push(`${collectionName} must be an array`);
    } else {
      validateUniqueIds(collectionName, state[collectionName], errors);
      if (state[collectionName].some((record) => !isRecord(record))) hasInvalidCollectionRecord = true;
    }
  }
  if (errors.some((error) => error.endsWith('must be an array')) || hasInvalidCollectionRecord) {
    return { errors, warnings, state, portfolio };
  }

  for (const [key, sourcePath] of Object.entries(state.canonicalSources)) {
    validateRepositoryPath(root, sourcePath, `canonicalSources.${key}`, errors);
  }

  const goalKinds = new Set();
  for (const goal of state.goals) {
    validateRequiredFields(`goal ${goal.id ?? '<missing>'}`, goal, ['id', 'kind', 'statement'], errors);
    if (!['technical', 'user', 'operational', 'commercial'].includes(goal.kind)) {
      errors.push(`goal ${goal.id} has invalid kind ${goal.kind}`);
    }
    if (goalKinds.has(goal.kind)) errors.push(`goals has duplicate kind ${goal.kind}`);
    goalKinds.add(goal.kind);
    validateNonEmptyString(goal.statement, `goal ${goal.id}.statement`, errors);
  }
  for (const kind of ['technical', 'user', 'operational', 'commercial']) {
    if (!goalKinds.has(kind)) errors.push(`goals must include kind ${kind}`);
  }

  const capabilityIds = new Set(state.capabilities.map(({ id }) => id));
  const integrationIds = new Set(state.integrations.map(({ id }) => id));
  const blockerIds = new Set(state.blockers.map(({ id }) => id));
  const goalIds = new Set(state.goals.map(({ id }) => id));
  const journeyIds = new Set(state.journeys.map(({ id }) => id));
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
    validateNonEmptyString(capability.name, `capability ${capability.id}.name`, errors);
    validateNonEmptyString(capability.description, `capability ${capability.id}.description`, errors);
    validateNonEmptyString(capability.owner_or_authority, `capability ${capability.id}.owner_or_authority`, errors);
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
      if (!isRecord(evidence)) {
        errors.push(`capability ${capability.id} evidence[${evidenceIndex}] must be an object`);
        continue;
      }
      validateRepositoryPath(root, evidence.path, `capability ${capability.id} evidence[${evidenceIndex}].path`, errors);
      if (!isIsoDate(evidence.verifiedAt)) errors.push(`capability ${capability.id} evidence[${evidenceIndex}] requires verifiedAt`);
      else if (dayAge(evidence.verifiedAt, nowDate) > 120) errors.push(`capability ${capability.id} evidence[${evidenceIndex}] is stale (${evidence.verifiedAt})`);
      else if (dayAge(evidence.verifiedAt, nowDate) < 0) errors.push(`capability ${capability.id} evidence[${evidenceIndex}] is in the future (${evidence.verifiedAt})`);
      if (typeof evidence.type !== 'string' || typeof evidence.status !== 'string') {
        errors.push(`capability ${capability.id} evidence[${evidenceIndex}] requires type and status`);
      }
      validateNonEmptyString(evidence.note, `capability ${capability.id} evidence[${evidenceIndex}].note`, errors);
      if (evidence.status === 'PASSED') {
        if (evidence.type !== 'test') errors.push(`capability ${capability.id} evidence[${evidenceIndex}] status PASSED requires type test`);
        if (!/(?:test|spec)\.[cm]?[jt]sx?$/u.test(evidence.path)) {
          errors.push(`capability ${capability.id} evidence[${evidenceIndex}] status PASSED must reference a test or spec file`);
        }
      }
    }
  }

  let primaryJourneyCount = 0;
  for (const journey of state.journeys) {
    validateRequiredFields(`journey ${journey.id ?? '<missing>'}`, journey, REQUIRED_JOURNEY_FIELDS, errors);
    if (journey.primary === true) primaryJourneyCount += 1;
    else if (journey.primary !== false) errors.push(`journey ${journey.id}.primary must be boolean`);
    if (!LIFECYCLE_STATES.includes(journey.lifecycle_state)) errors.push(`journey ${journey.id} has invalid lifecycle_state ${journey.lifecycle_state}`);
    if (!['HIGH', 'MEDIUM', 'LOW'].includes(journey.confidence)) errors.push(`journey ${journey.id} has invalid confidence ${journey.confidence}`);
    for (const field of ['name', 'trigger', 'stateChange', 'authorityOrEvidence', 'nextState', 'outcome']) {
      validateNonEmptyString(journey[field], `journey ${journey.id}.${field}`, errors);
    }
    validateNonEmptyArray(journey.actors, `journey ${journey.id}.actors`, errors);
    validateNonEmptyArray(journey.steps, `journey ${journey.id}.steps`, errors);
    validateNonEmptyArray(journey.blockers, `journey ${journey.id}.blockers`, errors, { allowEmpty: true });
    for (const blockerId of journey.blockers ?? []) {
      if (!blockerIds.has(blockerId)) errors.push(`journey ${journey.id} references unknown blocker ${blockerId}`);
    }
  }
  if (primaryJourneyCount !== 1) errors.push(`exactly one journey must have primary=true; found ${primaryJourneyCount}`);

  for (const decision of state.decisions) {
    validateRequiredFields(`decision ${decision.id ?? '<missing>'}`, decision, ['id', 'status', 'statement', 'evidence'], errors);
    validateNonEmptyString(decision.status, `decision ${decision.id}.status`, errors);
    validateNonEmptyString(decision.statement, `decision ${decision.id}.statement`, errors);
    validateRepositoryPath(root, decision.evidence, `decision ${decision.id}.evidence`, errors);
  }
  for (const integration of state.integrations) {
    validateRequiredFields(`integration ${integration.id ?? '<missing>'}`, integration, ['id', 'name', 'state', 'evidence', 'unknowns'], errors);
    validateNonEmptyString(integration.name, `integration ${integration.id}.name`, errors);
    validateNonEmptyString(integration.state, `integration ${integration.id}.state`, errors);
    validateNonEmptyArray(integration.unknowns, `integration ${integration.id}.unknowns`, errors, { allowEmpty: true });
    validateRepositoryPath(root, integration.evidence, `integration ${integration.id}.evidence`, errors);
  }
  for (const risk of state.risks) {
    validateRequiredFields(`risk ${risk.id ?? '<missing>'}`, risk, ['id', 'severity', 'statement', 'mitigation'], errors);
    if (!['HIGH', 'MEDIUM', 'LOW'].includes(risk.severity)) errors.push(`risk ${risk.id} has invalid severity ${risk.severity}`);
    validateNonEmptyString(risk.statement, `risk ${risk.id}.statement`, errors);
    validateNonEmptyString(risk.mitigation, `risk ${risk.id}.mitigation`, errors);
  }

  const blockerDependencyIds = new Set([...blockerIds, ...dependencyIds]);
  for (const blocker of state.blockers) {
    validateRequiredFields(`blocker ${blocker.id ?? '<missing>'}`, blocker, REQUIRED_BLOCKER_FIELDS, errors);
    if (!['P0', 'P1', 'P2', 'P3', 'P4'].includes(blocker.priority)) errors.push(`blocker ${blocker.id} has invalid priority ${blocker.priority}`);
    if (!['OPEN', 'RESOLVED'].includes(blocker.status)) errors.push(`blocker ${blocker.id} has invalid status ${blocker.status}`);
    validateNonEmptyString(blocker.statement, `blocker ${blocker.id}.statement`, errors);
    validateNonEmptyString(blocker.resolutionCondition, `blocker ${blocker.id}.resolutionCondition`, errors);
    validateRepositoryPath(root, blocker.source, `blocker ${blocker.id}.source`, errors);
    validateNonEmptyArray(blocker.affectedGoals, `blocker ${blocker.id}.affectedGoals`, errors);
    validateNonEmptyArray(blocker.affectedJourneys, `blocker ${blocker.id}.affectedJourneys`, errors, { allowEmpty: true });
    validateNonEmptyArray(blocker.dependencies, `blocker ${blocker.id}.dependencies`, errors, { allowEmpty: true });
    for (const goalId of blocker.affectedGoals ?? []) {
      if (!goalIds.has(goalId)) errors.push(`blocker ${blocker.id} references unknown affected goal ${goalId}`);
    }
    for (const journeyId of blocker.affectedJourneys ?? []) {
      if (!journeyIds.has(journeyId)) errors.push(`blocker ${blocker.id} references unknown affected journey ${journeyId}`);
    }
    for (const dependencyId of blocker.dependencies ?? []) {
      if (dependencyId === blocker.id) errors.push(`blocker ${blocker.id} cannot depend on itself`);
      else if (!blockerDependencyIds.has(dependencyId)) errors.push(`blocker ${blocker.id} references unknown dependency ${dependencyId}`);
    }
  }

  const nextProofEvents = state.proofEvents.filter(({ isNext }) => isNext === true);
  if (nextProofEvents.length !== 1) errors.push(`exactly one proof event must have isNext=true; found ${nextProofEvents.length}`);
  for (const proofEvent of state.proofEvents) {
    validateRequiredFields(`proof event ${proofEvent.id ?? '<missing>'}`, proofEvent, REQUIRED_PROOF_EVENT_FIELDS, errors);
    for (const field of ['title', 'hypothesis', 'whyItMatters', 'observableEvent']) {
      validateNonEmptyString(proofEvent[field], `proof event ${proofEvent.id}.${field}`, errors);
    }
    for (const field of ['preconditions', 'acceptanceCriteria', 'requiredEvidence', 'blockers', 'reducesUncertaintyFor']) {
      validateNonEmptyArray(proofEvent[field], `proof event ${proofEvent.id}.${field}`, errors);
    }
    validateRepositoryPath(root, proofEvent.evidenceDestination, `proof event ${proofEvent.id}.evidenceDestination`, errors);
    for (const capabilityId of proofEvent.reducesUncertaintyFor ?? []) {
      if (!capabilityIds.has(capabilityId)) errors.push(`proof event ${proofEvent.id} references unknown capability ${capabilityId}`);
    }
    for (const blockerId of proofEvent.blockers ?? []) {
      if (!blockerIds.has(blockerId)) errors.push(`proof event ${proofEvent.id} references unknown blocker ${blockerId}`);
    }
  }

  const commercialCategories = new Set();
  for (const commercialRecord of state.commercialEvidence) {
    validateRequiredFields(`commercial evidence ${commercialRecord.id ?? '<missing>'}`, commercialRecord, ['id', 'category', 'claim', 'verdict', 'evidence', 'note'], errors);
    if (!REQUIRED_COMMERCIAL_CATEGORIES.includes(commercialRecord.category)) {
      errors.push(`commercial evidence ${commercialRecord.id} has invalid category ${commercialRecord.category}`);
    }
    if (commercialCategories.has(commercialRecord.category)) errors.push(`commercial evidence has duplicate category ${commercialRecord.category}`);
    commercialCategories.add(commercialRecord.category);
    if (!PROOF_VERDICTS.includes(commercialRecord.verdict)) {
      errors.push(`commercial evidence ${commercialRecord.id} has invalid verdict ${commercialRecord.verdict}`);
    }
    validateNonEmptyString(commercialRecord.claim, `commercial evidence ${commercialRecord.id}.claim`, errors);
    validateNonEmptyString(commercialRecord.note, `commercial evidence ${commercialRecord.id}.note`, errors);
    validateNonEmptyArray(commercialRecord.evidence, `commercial evidence ${commercialRecord.id}.evidence`, errors, { allowEmpty: true });
    if (commercialRecord.verdict === 'UNVERIFIED' && (commercialRecord.evidence?.length ?? 0) > 0) {
      warnings.push(`commercial evidence ${commercialRecord.id} is UNVERIFIED but has evidence references; review the verdict`);
    }
    if (['PROVEN', 'PARTIALLY_PROVEN'].includes(commercialRecord.verdict) && (commercialRecord.evidence?.length ?? 0) === 0) {
      errors.push(`commercial evidence ${commercialRecord.id} requires evidence for ${commercialRecord.verdict}`);
    }
    for (const evidencePath of commercialRecord.evidence ?? []) {
      validateRepositoryPath(root, evidencePath, `commercial evidence ${commercialRecord.id}`, errors);
    }
  }
  for (const category of REQUIRED_COMMERCIAL_CATEGORIES) {
    if (!commercialCategories.has(category)) errors.push(`commercial evidence must include category ${category}`);
  }

  for (const nextAction of state.nextActions) {
    validateRequiredFields(`next action ${nextAction.id ?? '<missing>'}`, nextAction, ['id', 'priority', 'action', 'owner'], errors);
    if (!Number.isInteger(nextAction.priority) || nextAction.priority < 1) errors.push(`next action ${nextAction.id} priority must be a positive integer`);
    validateNonEmptyString(nextAction.action, `next action ${nextAction.id}.action`, errors);
    validateNonEmptyString(nextAction.owner, `next action ${nextAction.id}.owner`, errors);
  }

  if (portfolio.projectId !== state.project.id) errors.push('portfolio projectId must match state.project.id');
  if (portfolio.canonicalStatePath !== '.project/state.json') errors.push('portfolio canonicalStatePath must be .project/state.json');
  if (!isIsoDate(portfolio.lastReconciled)) errors.push('portfolio lastReconciled must be an ISO date');
  for (const field of ['name', 'repository', 'purpose', 'authorityDomain', 'portfolioStatus']) {
    validateNonEmptyString(portfolio[field], `portfolio.${field}`, errors);
  }
  for (const field of ['primaryContracts', 'upstreamSystems', 'downstreamSystems']) {
    validateNonEmptyArray(portfolio[field], `portfolio.${field}`, errors, { allowEmpty: field === 'downstreamSystems' });
  }
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
