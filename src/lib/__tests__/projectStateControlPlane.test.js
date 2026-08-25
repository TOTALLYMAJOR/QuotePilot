import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateControlPlane } from '../../../scripts/check-project-state.mjs';

const temporaryRoots = [];

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-pilot-state-'));
  temporaryRoots.push(root);
  const requiredFiles = [
    'docs/FEATURE_MATRIX.md',
    'PROJECT_STATUS.md',
    'DEV_TASKS.md',
    'CHANGELOG.md',
    'docs/USER_MANUAL.md',
    'docs/DOC_SYSTEM.md',
    'docs/capability-surfacing-contracts.json',
    'scripts/check-project-state.mjs',
    'src/lib/__tests__/projectStateControlPlane.test.js',
  ];
  for (const relativePath of requiredFiles) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'fixture\n');
  }
  fs.writeFileSync(path.join(root, 'PROJECT_STATE.md'), '## NEXT PROOF EVENT\n');
  fs.mkdirSync(path.join(root, 'docs/project'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/project/EXECUTIVE_STATE.md'), '## Next Proof Event\n');
  fs.writeFileSync(path.join(root, 'docs/project/CAPABILITIES.md'), 'docs/FEATURE_MATRIX.md\n');
  fs.writeFileSync(path.join(root, 'docs/project/BLOCKERS.md'), 'DEV_TASKS.md\n');

  const state = {
    schemaVersion: 1,
    lastReconciled: '2026-08-24',
    project: { id: 'quote-pilot' },
    canonicalSources: {
      capabilities: 'docs/FEATURE_MATRIX.md',
      operationalState: 'PROJECT_STATUS.md',
      backlog: 'DEV_TASKS.md',
      history: 'CHANGELOG.md',
      userTasks: 'docs/USER_MANUAL.md',
      documentationPolicy: 'docs/DOC_SYSTEM.md',
      capabilityTraceability: 'docs/capability-surfacing-contracts.json',
    },
    goals: [{ id: 'goal-one' }],
    capabilities: [
      {
        id: 'cap-one',
        name: 'A real capability',
        description: 'Fixture capability.',
        lifecycle_state: 'TESTED',
        confidence: 'HIGH',
        evidence: [{ type: 'test', path: 'src/lib/__tests__/projectStateControlPlane.test.js', status: 'PASSED', verifiedAt: '2026-08-24' }],
        dependencies: ['integration-one'],
        blockers: [],
        last_verified: '2026-08-24',
        owner_or_authority: 'fixture authority',
      },
    ],
    journeys: [{ id: 'journey-one', lifecycle_state: 'TESTED', blockers: [] }],
    decisions: [{ id: 'decision-one', evidence: 'docs/DOC_SYSTEM.md' }],
    integrations: [{ id: 'integration-one', evidence: 'PROJECT_STATUS.md' }],
    risks: [{ id: 'risk-one' }],
    blockers: [{ id: 'blocker-one', source: 'DEV_TASKS.md' }],
    proofEvents: [
      {
        id: 'proof-one',
        isNext: true,
        evidenceDestination: 'PROJECT_STATUS.md',
        reducesUncertaintyFor: ['cap-one'],
      },
    ],
    commercialEvidence: [{ id: 'commercial-one', verdict: 'UNVERIFIED', evidence: [] }],
    nextActions: [{ id: 'action-one' }],
  };
  const portfolio = {
    schemaVersion: 1,
    projectId: 'quote-pilot',
    canonicalStatePath: '.project/state.json',
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

  it('rejects broken evidence paths and stale verification', () => {
    const { root, state } = makeFixture();
    state.capabilities[0].evidence[0].path = 'missing/evidence.txt';
    state.capabilities[0].last_verified = '2025-01-01';
    writeJson(path.join(root, '.project/state.json'), state);

    const { errors } = validateControlPlane({ root, nowDate: '2026-08-24' });
    expect(errors).toContain('capability cap-one evidence[0].path does not exist: missing/evidence.txt');
    expect(errors).toContain('capability cap-one verification is stale (2025-01-01)');
  });
});
