import assert from "node:assert/strict";
import test from "node:test";

let reconciliation = {};
try {
  reconciliation = await import("../check-backlog-issue-reconciliation.mjs");
} catch {
  // The first TDD run intentionally reaches this branch before the checker exists.
}

const backlog = `
## NOW — Governance evolution

### \`GOV-001\` — Reconcile the canonical backlog with GitHub issues

- **Status:** in_progress

### \`GOV-002\` — Add risk-triggered independent review

- **Status:** queued

### \`GOV-003\` — Feed outcomes back into prioritization

- **Status:** queued

## Actor-journey initiative delivery packets
`;

const releaseBacklog = `
## NOW — v0.20 release publication

- [ ] \`QPR-002\` — Review and package documentation authority
  Preserve unrelated work.
- [ ] \`QPR-003\` — Review and package first quote
  Depends on QPR-002.
- [x] \`QPR-001\` — Classify the dirty checkout

## Deferred
`;

function issue(id, number, labels = ["ready-for-agent"]) {
  return {
    number,
    state: "OPEN",
    title: `[${id}] governed work`,
    body: `Backlog-ID: ${id}\nAuthority: DEV_TASKS.md`,
    labels: labels.map((name) => ({ name }))
  };
}

test("parses only active NOW governance initiatives", () => {
  assert.equal(typeof reconciliation.parseNowGovernanceInitiatives, "function");
  assert.deepEqual(reconciliation.parseNowGovernanceInitiatives(backlog), [
    { id: "GOV-001", title: "Reconcile the canonical backlog with GitHub issues", status: "in_progress" },
    { id: "GOV-002", title: "Add risk-triggered independent review", status: "queued" },
    { id: "GOV-003", title: "Feed outcomes back into prioritization", status: "queued" }
  ]);
});

test("parses open QPR checkboxes from active NOW sections", () => {
  assert.equal(typeof reconciliation.parseNowBacklogInitiatives, "function");
  assert.deepEqual(reconciliation.parseNowBacklogInitiatives(releaseBacklog), [
    { id: "QPR-002", title: "Review and package documentation authority", status: "open" },
    { id: "QPR-003", title: "Review and package first quote", status: "open" }
  ]);
});

test("reconciles current QPR issue mirrors", () => {
  const result = reconciliation.validateBacklogIssueReconciliation({
    backlogMarkdown: releaseBacklog,
    issues: [issue("QPR-002", 157), issue("QPR-003", 158)]
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.links, [
    { backlogId: "QPR-002", issueNumber: 157 },
    { backlogId: "QPR-003", issueNumber: 158 }
  ]);
});

test("accepts one correctly governed open issue per NOW initiative", () => {
  assert.equal(typeof reconciliation.validateBacklogIssueReconciliation, "function");
  const result = reconciliation.validateBacklogIssueReconciliation({
    backlogMarkdown: backlog,
    issues: [issue("GOV-001", 201), issue("GOV-002", 202), issue("GOV-003", 203)]
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.links, [
    { backlogId: "GOV-001", issueNumber: 201 },
    { backlogId: "GOV-002", issueNumber: 202 },
    { backlogId: "GOV-003", issueNumber: 203 }
  ]);
});

test("reports missing, duplicate, stale, and incorrectly governed issue mirrors", () => {
  const duplicate = issue("GOV-001", 204, ["ready-for-agent", "ready-for-human"]);
  duplicate.body = "Backlog-ID: GOV-001\nAuthority: another-file.md";

  const result = reconciliation.validateBacklogIssueReconciliation({
    backlogMarkdown: backlog,
    issues: [
      issue("GOV-001", 201),
      duplicate,
      issue("GOV-003", 203, []),
      issue("GOV-999", 999)
    ]
  });

  assert.deepEqual(result.errors, [
    "GOV-001 has 2 open GitHub issues; expected exactly 1",
    "GOV-002 has no open GitHub issue",
    "GitHub issue #203 for GOV-003 must have exactly one canonical triage label",
    "Open GitHub issue #999 references GOV-999, which is not active in a NOW backlog section"
  ]);
});

test("rejects an issue whose sole mirror points at a competing authority", () => {
  const wrongAuthority = issue("GOV-001", 201);
  wrongAuthority.body = "Backlog-ID: GOV-001\nAuthority: issue-body";

  const result = reconciliation.validateBacklogIssueReconciliation({
    backlogMarkdown: backlog,
    issues: [wrongAuthority, issue("GOV-002", 202), issue("GOV-003", 203)]
  });

  assert.deepEqual(result.errors, [
    "GitHub issue #201 for GOV-001 must declare Authority: DEV_TASKS.md"
  ]);
});
