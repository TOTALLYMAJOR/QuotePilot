import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
const require = createRequire(import.meta.url);
const definitions = require("../../../functions/workflowDefinitions.js");
const actor = { organizationId: "org-one", uid: "admin-one", role: "admin" };
const refs = { organizationId: actor.organizationId, workflowKind: "event_execution" };
const nowISO = "2026-09-05T20:00:00.000Z";
const config = () => structuredClone(definitions.seedPublishedVersion().config);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
}
const hash = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const rehash = (value, key) => { const clone = structuredClone(value); delete clone[key]; return { ...clone, [key]: hash(clone) }; };
function save(previous = null, value = config(), suffix = "default") {
  return definitions.planSaveDraft({ request: { ...refs, requestId: `definition-save-request-${suffix}-${previous?.nextHead.revision || 0}`, expectedRevision: previous?.nextHead.revision || 0, command: "save_draft", config: value }, actor, head: previous?.nextHead, currentReceipt: previous?.receipt, nowISO });
}
function preview(previous, by = actor) {
  return definitions.previewPublish({ ...refs, actor: by, head: previous.nextHead, currentReceipt: previous.receipt });
}
function publish(previous, overrides = {}) {
  const proof = preview(previous);
  const request = { ...refs, requestId: `definition-publish-request-${previous.nextHead.revision}`, expectedRevision: previous.nextHead.revision, command: "publish", previewDigest: proof.previewDigest, confirmationText: proof.confirmationText, ...overrides };
  return definitions.planPublish({ request, actor, head: previous.nextHead, currentReceipt: previous.receipt, nowISO });
}
function retire(previous) {
  return definitions.planRetire({ request: { ...refs, requestId: `definition-retire-request-${previous.nextHead.revision}`, expectedRevision: previous.nextHead.revision, command: "retire", versionId: previous.nextHead.activeVersionId, reason: "Stop new instance attachment" }, actor, head: previous.nextHead, currentReceipt: previous.receipt, nowISO });
}
const snapshot = (previous, activeVersion = previous?.publishedVersion) => definitions.projectDefinitionSnapshot({ ...refs, head: previous?.nextHead, currentReceipt: previous?.receipt, activeVersion });

describe("pure workflow definition configuration", () => {
  test("definition config preserves explicit zero and null without inferred policy", () => {
    const empty = definitions.validateConfig(config());
    expect(empty.actualsReviewThresholdCents).toBeNull();
    expect(empty.comparisonPolicy).toBeNull();
    const zero = config();
    zero.actualsReviewThresholdCents = 0;
    zero.comparisonPolicy = { laborBasisPoints: 0, purchasingBasisPoints: 0, minimumCents: 0 };
    expect(definitions.validateConfig(zero).comparisonPolicy).toEqual(zero.comparisonPolicy);
    expect(Object.isFrozen(empty.taskTemplates[0])).toBe(true);
  });

  test.each([
    ["unknown field", (value) => { value.webhook = "forbidden"; }],
    ["missing field", (value) => { delete value.comparisonPolicy; }],
    ["role escalation", (value) => { value.allowedRoles = ["admin", "finance"]; }],
    ["admin removal", (value) => { value.allowedRoles = ["sales"]; }],
    ["duplicate role", (value) => { value.allowedRoles = ["admin", "admin"]; }],
    ["unsupported owner", (value) => { value.allowedRoles = ["admin"]; value.taskTemplates[0].ownerRole = "sales"; }],
    ["fractional cents", (value) => { value.actualsReviewThresholdCents = 0.5; }],
    ["negative threshold", (value) => { value.actualsReviewThresholdCents = -1; }],
    ["threshold ceiling", (value) => { value.actualsReviewThresholdCents = 1_000_000_001; }],
    ["boolean policy", (value) => { value.comparisonPolicy = { laborBasisPoints: false, purchasingBasisPoints: 0, minimumCents: 0 }; }],
    ["missing policy", (value) => { value.comparisonPolicy = { laborBasisPoints: 0, purchasingBasisPoints: 0 }; }],
    ["due ceiling", (value) => { value.duePolicy.offsetMinutes = 43_201; }],
    ["escalation role", (value) => { value.escalationPolicy.role = "sales"; }],
    ["duplicate task", (value) => { value.taskTemplates.push(value.taskTemplates[0]); }],
    ["task count", (value) => { value.taskTemplates = Array.from({ length: 13 }, (_, i) => ({ ...value.taskTemplates[0], taskKey: `task_${i}` })); }],
    ["unknown reference", (value) => { value.taskTemplates[0].communicationTemplateRef = "arbitrary-template"; }],
    ["URL", (value) => { value.taskTemplates[0].instruction = "https://example.test/action"; }],
    ["executable expression", (value) => { value.taskTemplates[0].instruction = "() => arbitrary()"; }],
    ["recipient", (value) => { value.taskTemplates[0].instruction = "Send to someone@example.test"; }],
    ["task label bound", (value) => { value.taskTemplates[0].label = "x".repeat(81); }]
  ])("definition rejects %s without widening authority", (_label, mutate) => {
    const value = config(); mutate(value);
    expect(() => definitions.validateConfig(value)).toThrow();
  });

  test("fixed communication references carry visible manual handoff guidance", () => {
    for (const ref of ["internal_event_brief_v1", "post_event_review_v1"]) {
      const value = config(); value.taskTemplates[0].communicationTemplateRef = ref;
      expect(definitions.validateConfig(value).taskTemplates[0].communicationTemplateRef).toBe(ref);
      expect(definitions.HANDOFF_TEMPLATES[ref].guidance).toContain("no send or delivery");
    }
  });

  test("definition seed is exact source-controlled evidence and fixture kind requires explicit opt-in", () => {
    const seed = definitions.seedPublishedVersion();
    expect(seed.version).toBe(0);
    expect(definitions.validatePublishedVersion(seed)).toEqual(seed);
    expect(definitions.comparisonPolicyEvidence(seed)).toBeNull();
    for (const change of [
      (value) => { value.config.actualsReviewThresholdCents = 0; },
      (value) => { value.publishedBy.uid = "tenant-made-seed"; },
      (value) => { value.organizationId = "org-one"; },
      (value) => { value.publishedAtISO = "2026-09-06T00:00:00.000Z"; }
    ]) {
      const forged = structuredClone(seed); change(forged);
      expect(() => definitions.validatePublishedVersion(rehash(forged, "definitionDigest"))).toThrow(/seed/);
    }
    expect(() => definitions.seedPublishedVersion("post_event_review")).toThrow(/runtime/);
    const second = definitions.seedPublishedVersion("post_event_review", { fixtureOnly: true });
    expect(definitions.validatePublishedVersion(second, { workflowKind: "post_event_review", fixtureOnly: true }).config.workflowKind).toBe("post_event_review");
    expect(() => definitions.validatePublishedVersion(second)).toThrow(/identity/);
    expect(() => definitions.validateConfig(second.config)).toThrow(/runtime/);
    expect(() => definitions.definitionPin(second)).toThrow(/runtime/);
    expect(definitions.definitionPin(second, { fixtureOnly: true }).workflowKind).toBe("post_event_review");
  });
});

describe("pure workflow definition lifecycle", () => {
  test("definition tenant and actor identifiers retain existing Unicode and 180-character support", () => {
    const organizationId = `組織-${"x".repeat(177)}`;
    const by = { organizationId, uid: `担当-${"y".repeat(177)}`, role: "admin" };
    const request = { organizationId, workflowKind: "event_execution", requestId: "definition-unicode-request-0001", expectedRevision: 0, command: "save_draft", config: config() };
    const saved = definitions.planSaveDraft({ request, actor: by, nowISO });
    expect(saved.nextHead.organizationId).toBe(organizationId);
    expect(saved.receipt.recordedBy.uid).toBe(by.uid);
    const proof = definitions.previewPublish({ organizationId, actor: by, head: saved.nextHead, currentReceipt: saved.receipt });
    const published = definitions.planPublish({ request: { organizationId, workflowKind: "event_execution", requestId: "definition-unicode-publish-0001", expectedRevision: 1, command: "publish", previewDigest: proof.previewDigest, confirmationText: proof.confirmationText }, actor: by, head: saved.nextHead, currentReceipt: saved.receipt, nowISO });
    expect(definitions.validatePublishedVersion(published.publishedVersion).publishedBy).toEqual(by);
    for (const invalid of ["x".repeat(181), ".", "..", "has/slash", "has space"]) {
      expect(() => definitions.planSaveDraft({ request: { ...request, organizationId: invalid }, actor: { ...by, organizationId: invalid }, nowISO })).toThrow(/identifier/);
    }
  });
+
  test("definition publish binds exact draft head actor preview and typed confirmation", () => {
    const draft = save();
    const proof = preview(draft);
    expect(proof.confirmationText).toContain("event_execution_v1");
    expect(proof.confirmationText).toContain(proof.previewDigest.slice(0, 12));
    expect(() => publish(draft, { confirmationText: "PUBLISH" })).toThrow(/typed confirmation/);
    expect(() => publish(draft, { previewDigest: "0".repeat(64) })).toThrow(/current preview/);
    const otherPreview = preview(draft, { ...actor, uid: "admin-two" });
    expect(() => publish(draft, { previewDigest: otherPreview.previewDigest, confirmationText: otherPreview.confirmationText })).toThrow(/current preview/);
    const updated = save(draft, { ...config(), name: "Updated draft" });
    expect(() => publish(updated, { previewDigest: proof.previewDigest, confirmationText: proof.confirmationText })).toThrow(/current preview/);
    expect(() => publish(draft, { expectedRevision: 0 })).toThrow(/changed/);
    const published = publish(draft);
    expect(published.nextHead.revision).toBe(2);
    expect(published.publishedVersion.publishedBy).toEqual(actor);
    expect(published.publishedVersion.publishedAtISO).toBe(nowISO);
    expect(snapshot(published).activeVersion).toEqual(published.publishedVersion);
    expect(Object.isFrozen(published.publishedVersion.config)).toBe(true);
  });

  test("definition retirement preserves immutable versions and never falls back to seed", () => {
    expect(snapshot(null).state).toBe("seed");
    const published = publish(save());
    const bytes = JSON.stringify(published.publishedVersion);
    const retired = retire(published);
    expect(snapshot(retired)).toMatchObject({ state: "retired", activeVersion: null, newInstanceEligible: false, lifetimeVersionCount: 1 });
    expect(JSON.stringify(definitions.validatePublishedVersion(published.publishedVersion))).toBe(bytes);
    const edited = save(retired, { ...config(), name: "Next draft" });
    expect(snapshot(edited).state).toBe("retired");
    const nextVersion = publish(edited);
    expect(nextVersion.publishedVersion.version).toBe(2);
    expect(JSON.stringify(published.publishedVersion)).toBe(bytes);
  });

  test("definition publication lifetime capacity includes retired versions", () => {
    let previous = save();
    for (let version = 1; version <= 50; version += 1) {
      previous = publish(previous);
      expect(previous.publishedVersion.version).toBe(version);
      previous = retire(previous);
    }
    expect(previous.nextHead.lifetimeVersionCount).toBe(50);
    expect(() => preview(previous)).toThrow(/lifetime publication capacity/);
    expect(snapshot(previous).activeVersion).toBeNull();
  });

  test("definition historical retries preserve exact actor and payload identity", () => {
    const original = publish(save());
    const request = original.receipt.request;
    const replay = definitions.planPublish({ request, actor, existingReceipt: original.receipt, head: { bad: "newer unrelated head" } });
    expect(replay.idempotent).toBe(true);
    expect(replay.nextHead).toBeNull();
    expect(replay.receipt).toEqual(original.receipt);
    expect(() => definitions.planPublish({ request: { ...request, confirmationText: "changed" }, actor, existingReceipt: original.receipt })).toThrow(/another immutable/);
    expect(() => definitions.planPublish({ request, actor: { ...actor, uid: "admin-two" }, existingReceipt: original.receipt })).toThrow(/another immutable/);
    expect(() => definitions.planPublish({ request, actor: { ...actor, role: "sales" }, existingReceipt: original.receipt })).toThrow(/administrator/);
    expect(() => definitions.planPublish({ request, actor: { ...actor, principalOrganizationId: "org-two" }, existingReceipt: original.receipt })).toThrow(/administrator/);
  });

  test("definition heads and receipts reject orphan tamper and rehashed transition substitution", () => {
    const published = publish(save());
    expect(() => definitions.projectDefinitionSnapshot({ ...refs, head: published.nextHead, activeVersion: published.publishedVersion })).toThrow();
    expect(() => definitions.projectDefinitionSnapshot({ ...refs, currentReceipt: published.receipt })).toThrow(/no current/);
    expect(() => definitions.projectDefinitionSnapshot({ ...refs, activeVersion: published.publishedVersion })).toThrow(/seed fallback is forbidden/);
    const changed = structuredClone(published.receipt);
    changed.resultHead.activeVersionId = "";
    expect(() => definitions.verifyLifecycleReceipt(rehash(changed, "receiptDigest"))).toThrow(/deterministic transition/);
    const malformed = structuredClone(published.receipt);
    malformed.priorHead.draftConfig.allowedRoles = ["sales"];
    malformed.priorHead.draftDigest = hash(malformed.priorHead.draftConfig);
    expect(() => definitions.verifyLifecycleReceipt(rehash(malformed, "receiptDigest"))).toThrow();
    const wrongVersion = structuredClone(published.publishedVersion);
    wrongVersion.publishedBy.organizationId = "other-org";
    expect(() => definitions.validatePublishedVersion(rehash(wrongVersion, "definitionDigest"))).toThrow();
    expect(() => definitions.projectDefinitionSnapshot({ ...refs, head: published.nextHead, currentReceipt: published.receipt, activeVersion: definitions.seedPublishedVersion() })).toThrow(/seed|identity/);
  });

  test("definition comparison evidence uses only explicit publisher provenance", () => {
    const value = config();
    value.comparisonPolicy = { laborBasisPoints: 0, purchasingBasisPoints: 25, minimumCents: 0 };
    const version = publish(save(null, value)).publishedVersion;
    expect(definitions.comparisonPolicyEvidence(version)).toEqual({ laborBasisPoints: 0, purchasingBasisPoints: 25, minimumCents: 0, declaredBy: actor.uid, declaredAtISO: nowISO });
    expect(definitions.comparisonPolicyEvidence(publish(save()).publishedVersion)).toBeNull();
  });

  test("definition unsupported schemas remain unavailable and cannot publish", () => {
    const value = config(); value.schemaVersion = 99;
    expect(() => definitions.validateConfig(value)).toThrow(/schema is unsupported/);
    expect(definitions.projectDefinitionSnapshot({ ...refs, head: { schemaVersion: 2 } })).toMatchObject({ availability: "schema_drift", activeVersion: null });
    const published = publish(save());
    const changed = structuredClone(published.publishedVersion); changed.schemaVersion = 99;
    expect(() => definitions.validatePublishedVersion(changed)).toThrow(/schema is unsupported/);
  });
});


describe("published version two pack policies", () => {
  const policy = (kind) => kind === "quote_review" ? { approval: { basis: "absolute_total_delta_cents", thresholdCents: 0, allowedRoles: ["admin", "sales"] } }
    : kind === "event_execution" ? { phaseConstraints: { in_progress: { requiredCheckpoints: ["venue_access"], blockOpenUrgentIssues: false }, completed: { requiredCheckpoints: ["pack_down"], blockOpenUrgentIssues: true } }, checkpointPrerequisites: { venue_access: [], team_briefing: ["venue_access"], service_handoff: ["team_briefing"], pack_down: [] } }
      : kind === "closeout_follow_up" ? { responsibleRoles: ["admin", "sales"], followUpOffsetDays: 7 } : { responsibleRoles: ["admin", "sales"] };
  const value = (kind) => ({ ...config(), schemaVersion: 2, workflowKind: kind, packPolicy: policy(kind) });
  test("version two packs publish exact immutable policies without creating new seed authority", () => {
    for (const workflowKind of ["quote_review", "final_guest_count", "event_execution", "closeout_follow_up"]) {
      const request = { organizationId: actor.organizationId, workflowKind, requestId: `definition-save-${workflowKind}-00001`, expectedRevision: 0, command: "save_draft", config: value(workflowKind) };
      const draft = definitions.planCommand({ request, actor, nowISO });
      const proof = definitions.previewPublish({ organizationId: actor.organizationId, workflowKind, actor, head: draft.nextHead, currentReceipt: draft.receipt });
      const { config: ignoredConfig, ...publishBase } = request;
      const publication = definitions.planCommand({ request: { ...publishBase, command: "publish", requestId: `definition-publish-${workflowKind}-00001`, expectedRevision: 1, previewDigest: proof.previewDigest, confirmationText: proof.confirmationText }, actor, nowISO, head: draft.nextHead, currentReceipt: draft.receipt });
      expect(publication.publishedVersion.schemaVersion).toBe(2);
      expect(definitions.validatePublishedVersion(publication.publishedVersion, { workflowKind }).config.packPolicy).toEqual(policy(workflowKind));
      expect(Object.isFrozen(definitions.validateConfig(value(workflowKind)).packPolicy)).toBe(true);
      if (workflowKind !== "event_execution") {
        expect(() => definitions.seedPublishedVersion(workflowKind)).toThrow();
        expect(definitions.projectDefinitionSnapshot({ organizationId: actor.organizationId, workflowKind })).toMatchObject({ state: "unpublished", newInstanceEligible: false, activeVersion: null });
      }
    }
  });
  test("version two pack constraints reject unknown fields roles and checkpoint cycles", () => {
    const bad = value("event_execution");
    bad.packPolicy.checkpointPrerequisites.venue_access = ["team_briefing"];
    expect(() => definitions.validateConfig(bad)).toThrow(/cycles/);
    expect(() => definitions.validateConfig({ ...value("quote_review"), packPolicy: { approval: { basis: "relative", thresholdCents: 0, allowedRoles: ["admin"] } } })).toThrow();
    expect(() => definitions.validateConfig({ ...value("final_guest_count"), actualsReviewThresholdCents: 0 })).toThrow();
    expect(() => definitions.validateConfig({ ...value("closeout_follow_up"), packPolicy: { responsibleRoles: ["sales"], followUpOffsetDays: 0 } })).toThrow();
    expect(() => definitions.validateConfig({ ...value("quote_review"), packPolicy: { ...policy("quote_review"), sendEmail: true } })).toThrow();
  });
});
