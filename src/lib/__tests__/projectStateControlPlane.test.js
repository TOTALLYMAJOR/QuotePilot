import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateControlPlane } from '../../../scripts/check-project-state.mjs';

const temporaryRoots = [];
const commercialCategories = [
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
];

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-pilot-state-'));
  temporaryRoots.push(root);
  for (const relativePath of [
    'docs/FEATURE_MATRIX.md',
    'PROJECT_STATUS.md',
    'DEV_TASKS.md',
    'CHANGELOG.md',
    'docs/USER_MANUAL.md',
    'docs/DOC_SYSTEM.md',
    'docs/capability-surfacing-contracts.json',
    'scripts/check-project-state.mjs',
    'src/lib/__tests__/projectStateControlPlane.test.js',
  ]) writeText(root, relativePath, 'fixture\n');

  writeText(root, 'PROJECT_STATE.md', [
    '## Identity',
    '## North-Star Goal',
    '## Canonical Journey',
    '## NEXT PROOF EVENT',
    '**Required Evidence:**',
    '**Current Blockers:**',
  ].join('\n'));
  writeText(root, 'docs/project/EXECUTIVE_STATE.md', [
    '## What This Is',
    '## North Star',
    '## Current Reality',
    '## Capability State',
    '## What Is Not Proven',
    '## Primary Journey',
    '## Critical Decisions',
    '## Critical Blockers',
    '## Next Proof Event',
    '## Next Actions',
    '## Commercial / Operational Evidence',
    '## Confidence',
  ].join('\n'));
  writeText(root, 'docs/project/CAPABILITIES.md', 'docs/FEATURE_MATRIX.md\n| Capability | Intended Outcome | State | Evidence | Missing Proof | Blocker |\n');
  writeText(root, 'docs/project/DECISIONS.md', 'Decision ID:\nAlternatives Considered:\nReversible:\nRevisit Trigger:\n');
  writeText(root, 'docs/project/EXPLORATIONS.md', 'Exploration:\nQuestion:\nHypothesis:\nDecision Required:\nStatus:\n');
  writeText(root, 'docs/project/PROOF.md', '| Claim | Required Evidence | Current Evidence | Verdict |\n');
  writeText(root, 'docs/project/BLOCKERS.md', 'DEV_TASKS.md\nAffected Goal\nAffected Journey\nResolution Condition\n');
  writeText(root, 'AGENTS.md', '## Canonical State Completion Contract\nWhat remains `UNVERIFIED`?\nDid the single NEXT PROOF EVENT change?\n');

  const state = {
    schemaVersion: 2,
    lastReconciled: '2026-08-24',
    reconciliationHead: 'a'.repeat(40),
    project: {
      id: 'quote-pilot',
      name: 'QuotePilot',
      repository: 'https://example.com/quote-pilot',
      primaryPurpose: 'Govern a quote lifecycle.',
      archetype: 'commercial_saas',
      primaryActors: ['operator'],
      economicBuyer: 'owner',
      problemSolved: 'Fragmented quote operations.',
      stage: 'test fixture',
      primaryDeploymentTarget: 'test target',
      lastEvidenceReconciliation: '2026-08-24',
    },
    canonicalSources: {
      capabilities: 'docs/FEATURE_MATRIX.md',
      operationalState: 'PROJECT_STATUS.md',
      backlog: 'DEV_TASKS.md',
      history: 'CHANGELOG.md',
      userTasks: 'docs/USER_MANUAL.md',
      documentationPolicy: 'docs/DOC_SYSTEM.md',
      capabilityTraceability: 'docs/capability-surfacing-contracts.json',
    },
    goals: [
      { id: 'goal-technical', kind: 'technical', statement: 'Preserve authority.' },
      { id: 'goal-user', kind: 'user', statement: 'Complete the journey.' },
      { id: 'goal-operational', kind: 'operational', statement: 'Inspect evidence.' },
      { id: 'goal-commercial', kind: 'commercial', statement: 'Prove value.' },
    ],
    capabilities: [
      {
        id: 'cap-one',
        name: 'A real capability',
        description: 'Fixture capability.',
        lifecycle_state: 'TESTED',
        confidence: 'HIGH',
        evidence: [{
          type: 'test',
          path: 'src/lib/__tests__/projectStateControlPlane.test.js',
          status: 'PASSED',
          verifiedAt: '2026-08-24',
          note: 'The focused fixture passed.',
        }],
        dependencies: ['integration-one'],
        blockers: [],
        last_verified: '2026-08-24',
        owner_or_authority: 'fixture authority',
      },
    ],
    journeys: [{
      id: 'journey-one',
      name: 'Primary fixture journey',
      primary: true,
      actors: ['operator'],
      trigger: 'A request arrives.',
      steps: ['perform action'],
      stateChange: 'Fixture state changes.',
      authorityOrEvidence: 'Fixture authority.',
      nextState: 'Next fixture state.',
      outcome: 'Fixture outcome.',
      lifecycle_state: 'TESTED',
      confidence: 'HIGH',
      blockers: ['blocker-one'],
    }],
    decisions: [{ id: 'decision-one', status: 'ACCEPTED', statement: 'Use the fixture authority.', evidence: 'docs/DOC_SYSTEM.md' }],
    integrations: [{ id: 'integration-one', name: 'Fixture integration', state: 'TESTED', evidence: 'PROJECT_STATUS.md', unknowns: [] }],
    risks: [{ id: 'risk-one', severity: 'LOW', statement: 'Fixture risk.', mitigation: 'Fixture mitigation.' }],
    blockers: [{
      id: 'blocker-one',
      priority: 'P1',
      status: 'OPEN',
      statement: 'Fixture blocker.',
      source: 'DEV_TASKS.md',
      affectedGoals: ['goal-user'],
      affectedJourneys: ['journey-one'],
      dependencies: ['integration-one'],
      resolutionCondition: 'Record the fixture receipt.',
    }],
    proofEvents: [{
      id: 'proof-one',
      isNext: true,
      title: 'Fixture proof event',
      hypothesis: 'The fixture behaves as intended.',
      whyItMatters: 'It reduces fixture uncertainty.',
      preconditions: ['prepare fixture'],
      observableEvent: 'The fixture event occurs.',
      acceptanceCriteria: ['fixture result is recorded'],
      requiredEvidence: ['fixture receipt'],
      blockers: ['blocker-one'],
      evidenceDestination: 'PROJECT_STATUS.md',
      reducesUncertaintyFor: ['cap-one'],
    }],
    commercialEvidence: commercialCategories.map((category, index) => ({
      id: `commercial-${index}`,
      category,
      claim: `Fixture claim for ${category}.`,
      verdict: 'UNVERIFIED',
      evidence: [],
      note: 'Fixture evidence is absent.',
    })),
    nextActions: [{ id: 'action-one', priority: 1, action: 'Run the fixture proof.', owner: 'fixture owner' }],
  };
  const portfolio = {
    schemaVersion: 1,
    projectId: 'quote-pilot',
    name: 'QuotePilot',
    repository: 'https://example.com/quote-pilot',
    purpose: 'Fixture purpose.',
    authorityDomain: 'fixture authority',
    canonicalStatePath: '.project/state.json',
    primaryContracts: ['fixture contract'],
    upstreamSystems: ['fixture upstream'],
    downstreamSystems: [],
    portfolioStatus: 'FIXTURE',
    lastReconciled: '2026-08-24',
  };
  writeJson(path.join(root, '.project/state.json'), state);
  writeJson(path.join(root, '.project/portfolio.json'), portfolio);
  return { root, state };
}

afterEach(() => {
  while (temporaryRoots.length) fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

describe('project state control plane', () => {
  it('accepts a complete, internally consistent ledger', () => {
    const { root } = makeFixture();
    expect(validateControlPlane({ root, nowDate: '2026-08-24' }).errors).toEqual([]);
  });

  it('rejects duplicate ids and more than one next proof event', () => {
    const { root, state } = makeFixture();
    state.blockers.push({ ...state.blockers[0] });
    state.proofEvents.push({ ...state.proofEvents[0], id: 'proof-two' });
    writeJson(path.join(root, '.project/state.json'), state);

    const { errors } = validateControlPlane({ root, nowDate: '2026-08-24' });
    expect(errors).toContain('blockers has duplicate id blocker-one');
    expect(errors).toContain('exactly one proof event must have isNext=true; found 2');
  });

  it('reports malformed collection records without crashing', () => {
    const { root, state } = makeFixture();
    state.capabilities = [null];
    writeJson(path.join(root, '.project/state.json'), state);

    expect(() => validateControlPlane({ root, nowDate: '2026-08-24' })).not.toThrow();
    expect(validateControlPlane({ root, nowDate: '2026-08-24' }).errors)
      .toContain('capabilities[0] must be an object');
  });

  it('rejects broken evidence paths and stale verification', () => {
    const { root, state } = makeFixture();
    state.capabilities[0].evidence[0].path = 'missing/evidence.test.js';
    state.capabilities[0].last_verified = '2025-01-01';
    writeJson(path.join(root, '.project/state.json'), state);

    const { errors } = validateControlPlane({ root, nowDate: '2026-08-24' });
    expect(errors).toContain('capability cap-one evidence[0].path does not exist: missing/evidence.test.js');
    expect(errors).toContain('capability cap-one verification is stale (2025-01-01)');
  });

  it('rejects placeholder capability claims and false passing-test records', () => {
    const { root, state } = makeFixture();
    state.capabilities[0].description = 'TODO placeholder capability.';
    state.capabilities[0].evidence[0] = {
      type: 'source',
      path: 'docs/FEATURE_MATRIX.md',
      status: 'PASSED',
      verifiedAt: '2026-08-24',
      note: 'A source file exists.',
    };
    writeJson(path.join(root, '.project/state.json'), state);

    const { errors } = validateControlPlane({ root, nowDate: '2026-08-24' });
    expect(errors).toContain('capability cap-one.description contains unresolved placeholder text');
    expect(errors).toContain('capability cap-one evidence[0] status PASSED requires type test');
    expect(errors).toContain('capability cap-one evidence[0] status PASSED must reference a test or spec file');
  });

  it('rejects invalid commercial verdicts and broken blocker references', () => {
    const { root, state } = makeFixture();
    state.commercialEvidence[0].verdict = 'VERIFIED';
    state.blockers[0].affectedGoals = ['missing-goal'];
    state.proofEvents[0].blockers = ['missing-blocker'];
    writeJson(path.join(root, '.project/state.json'), state);

    const { errors } = validateControlPlane({ root, nowDate: '2026-08-24' });
    expect(errors).toContain('commercial evidence commercial-0 has invalid verdict VERIFIED');
    expect(errors).toContain('blocker blocker-one references unknown affected goal missing-goal');
    expect(errors).toContain('proof event proof-one references unknown blocker missing-blocker');
  });

  it('rejects an incomplete executive-state contract', () => {
    const { root } = makeFixture();
    writeText(root, 'docs/project/EXECUTIVE_STATE.md', '## Next Proof Event\n');

    const { errors } = validateControlPlane({ root, nowDate: '2026-08-24' });
    expect(errors).toContain('docs/project/EXECUTIVE_STATE.md must contain ## What This Is');
    expect(errors).toContain('docs/project/EXECUTIVE_STATE.md must contain ## Confidence');
  });
});
