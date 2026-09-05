#!/usr/bin/env node
// Disposable local acceptance. No provider calls or real project credentials.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

// Named assertion groups are canonical capability evidence; failures propagate.
function test(name, assertions) { assertions(); console.log(`PASS ${name}`); }

const projectId = String(process.env.GCLOUD_PROJECT || "");
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST || "");
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "");
const hubHost = String(process.env.FIREBASE_EMULATOR_HUB || "");
const globalGate = String(process.env.EVENT_OPERATING_SPINE_ENABLED || "");
const loopbackHost = (value) => /^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value);
assert.ok(projectId.startsWith("demo-") && [authHost, firestoreHost, hubHost].every(loopbackHost) && ["true", "false"].includes(globalGate), "Requires a demo project, loopback emulators and explicit global gate.");
const hub = await fetch(`http://${hubHost}/emulators`);
assert.equal(hub.ok, true, "Local emulator hub is unavailable.");
const emulators = await hub.json();
const functionsHost = `${emulators.functions?.host}:${emulators.functions?.port}`;
assert.ok(loopbackHost(functionsHost), "A loopback Functions emulator is required.");
const admin = loadFirebaseAdmin();
if (!admin.getApps().length) admin.initializeApp({ projectId });
const auth = admin.getAuth();
const db = admin.getFirestore();
const ORG = "event-operations-local";
const OTHER = "event-operations-other";
const orgRef = db.collection("organizations").doc(ORG);
const settingsRef = orgRef.collection("settings").doc("config");
const quoteRef = orgRef.collection("quotes").doc("booked-event");
const source = { organizationId: ORG, quoteId: quoteRef.id, sourceVersionId: "v1", acceptanceReceiptId: "acceptance-one" };
const request = { ...source, requestId: "event-operations-initialize-0001", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" };
const workRequest = { ...source, requestId: "event-work-initialize-0001", workPolicyVersion: 1, expectedWorkRevision: 0, command: "checkpoint_record", checkpointCode: "venue_access", note: "Venue access recorded" };
const actualsRequest = { ...source, requestId: "event-actuals-initialize-0001", actualsPolicyVersion: 1, expectedActualsRevision: 3, command: "record", category: "labor", description: "Declared service labor", costCents: 12500, durationMinutes: 180, laborRole: "server" };
const password = `Emulator-${randomBytes(20).toString("hex")}-Aa1!`;
async function principal(name, role, organizationId = ORG, emailVerified = true) {
  const email = `${name}@local.test`;
  const user = await auth.createUser({ email, password, emailVerified });
  await auth.setCustomUserClaims(user.uid, { role, organizationId, claimsVersion: 1 });
  await db.collection("userRoles").doc(user.uid).set({ role, organizationId, email });
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  assert.equal(response.ok, true, "Synthetic local sign-in failed.");
  const payload = await response.json();
  assert.ok(payload.idToken);
  return { uid: user.uid, email, role, organizationId, idToken: payload.idToken };
}
async function call(name, who, data = source) {
  const response = await fetch(`http://${functionsHost}/${projectId}/us-central1/${name}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:4174", ...(who ? { Authorization: `Bearer ${who.idToken}` } : {}) }, body: JSON.stringify({ data }) });
  const payload = await response.json();
  if (payload.error) { const error = new Error(payload.error.message || "Local callable rejected"); error.status = payload.error.status; throw error; }
  assert.equal(response.ok, true, "Local callable transport failed.");
  return payload.result || payload.data;
}
async function rejected(action, status) {
  await assert.rejects(action, (error) => error.status === status, `Expected ${status}`);
}
const read = (who) => call("getEventOperatingSnapshot", who);
const apply = (who, command = request) => call("applyEventOperatingCommand", who, command);
const workRead = (who) => call("getEventOperatingWorkSnapshot", who, { organizationId: ORG, quoteId: quoteRef.id });
const workApply = (who, command = workRequest) => call("applyEventOperatingWorkCommand", who, command);
const actualsRead = (who) => call("getEventOperatingActualsSnapshot", who, { organizationId: ORG, quoteId: quoteRef.id });
const actualsApply = (who, command = actualsRequest) => call("applyEventOperatingActualsCommand", who, command);
const historyRead = (who, cursor) => call("getEventOperatingHistory", who, { organizationId: ORG, quoteId: quoteRef.id, ...(cursor ? { cursor } : {}) });
const comparable = (value) => JSON.parse(JSON.stringify(value));
const domainState = async () => ({ quote: comparable((await quoteRef.get()).data()), version: comparable((await quoteRef.collection("versions").doc("v1").get()).data()), acceptance: comparable((await orgRef.collection("proposalAcceptanceReceipts").doc("acceptance-one").get()).data()) });
async function ledgerState() {
  const ledgers = await orgRef.collection("eventOperatingLedgers").get();
  return Promise.all(ledgers.docs.map(async (ledger) => ({ id: ledger.id, data: comparable(ledger.data()), receipts: (await ledger.ref.collection("receipts").get()).docs.map((receipt) => ({ id: receipt.id, data: comparable(receipt.data()) })).sort((a, b) => a.id.localeCompare(b.id)) })));
}
async function unchangedOnFailure(action, status) { const before = await ledgerState(); await rejected(action, status); assert.deepEqual(await ledgerState(), before, "Rejected command changed ledger or receipts."); }
async function workLedgerState() {
  const ledgers = await orgRef.collection("eventOperatingLedgers").get();
  return Promise.all(ledgers.docs.map(async (ledger) => {
    const current = await ledger.ref.collection("workState").doc("current").get();
    const receipts = await ledger.ref.collection("workReceipts").get();
    return {
      ledgerId: ledger.id,
      current: current.exists ? comparable(current.data()) : null,
      receipts: receipts.docs.map((receipt) => ({ id: receipt.id, data: comparable(receipt.data()) }))
        .sort((a, b) => a.id.localeCompare(b.id))
    };
  }));
}
async function unchangedWorkFailure(action, status) {
  const before = { phase: await ledgerState(), work: await workLedgerState() };
  await rejected(action, status);
  assert.deepEqual({ phase: await ledgerState(), work: await workLedgerState() }, before,
    "Rejected work command changed phase, journal, or receipts.");
}

async function actualsLedgerState() {
  const ledgers = await orgRef.collection("eventOperatingLedgers").get();
  return Promise.all(ledgers.docs.map(async (ledger) => {
    const current = await ledger.ref.collection("actualsState").doc("current").get();
    const receipts = await ledger.ref.collection("actualsReceipts").get();
    return {
      ledgerId: ledger.id, current: current.exists ? comparable(current.data()) : null,
      receipts: receipts.docs.map((receipt) => ({ id: receipt.id, data: comparable(receipt.data()) }))
        .sort((a, b) => a.id.localeCompare(b.id))
    };
  }));
}
async function unchangedActualsFailure(action, status) {
  const before = { phase: await ledgerState(), work: await workLedgerState(), actuals: await actualsLedgerState() };
  await rejected(action, status);
  assert.deepEqual({ phase: await ledgerState(), work: await workLedgerState(), actuals: await actualsLedgerState() }, before,
    "Rejected actuals command changed a journal or receipt.");
}

await Promise.all([orgRef.set({ active: true, archived: false, status: "active" }), db.collection("organizations").doc(OTHER).set({ active: true, status: "active" }), settingsRef.set({ businessTimeZone: "America/Chicago", eventOperatingSpineEnabled: true })]);
const [owner, sales, outsider, unverified] = await Promise.all([principal("event-admin", "admin"), principal("event-sales", "sales"), principal("event-other", "admin", OTHER), principal("event-unverified", "admin", ORG, false)]);
const issued = "2026-09-01T12:00:00.000Z";
const proposalSnapshot = { organizationId: ORG, quoteId: quoteRef.id, revisionId: `v1@${issued}`, portalIssuedAtISO: issued };
const acceptance = { receiptId: "acceptance-one", organizationId: ORG, quoteId: quoteRef.id, quoteRevisionId: proposalSnapshot.revisionId, acceptedAtISO: "2026-09-02T12:00:00.000Z", portalIssuedAtISO: issued, snapshotSha256: createHash("sha256").update(JSON.stringify(proposalSnapshot)).digest("hex"), proposalSnapshot };
const quote = { id: quoteRef.id, organizationId: ORG, customerId: "synthetic-customer", status: "booked", activeVersionId: "v1", event: { date: "2026-09-06" }, booking: { bookedAtISO: "2026-09-02T13:00:00.000Z" }, acceptanceReceipt: acceptance };
await Promise.all([quoteRef.set(quote), quoteRef.collection("versions").doc("v1").set({ versionId: "v1", quoteId: quoteRef.id, organizationId: ORG, customerId: quote.customerId, snapshot: { id: quoteRef.id, organizationId: ORG, customerId: quote.customerId, event: quote.event } }), orgRef.collection("proposalAcceptanceReceipts").doc("acceptance-one").set(acceptance)]);
const baseline = await domainState();
if (globalGate === "false") {
  await rejected(() => read(owner), "FAILED_PRECONDITION");
  await unchangedOnFailure(() => apply(owner), "FAILED_PRECONDITION");
  await rejected(() => workRead(owner), "FAILED_PRECONDITION");
  await rejected(() => actualsRead(owner), "FAILED_PRECONDITION");
  await rejected(() => historyRead(owner), "FAILED_PRECONDITION");
  await unchangedWorkFailure(() => workApply(owner), "FAILED_PRECONDITION");
  await unchangedActualsFailure(() => actualsApply(owner), "FAILED_PRECONDITION");
  assert.deepEqual(await domainState(), baseline);
  console.log("PASS event operations local emulator: global gate denies phase/work/actuals/history reads and operational writes; zero ledger/receipt/domain writes.");
} else {
  await unchangedOnFailure(() => apply(null), "UNAUTHENTICATED");
  await unchangedOnFailure(() => apply(unverified), "FAILED_PRECONDITION");
  await unchangedOnFailure(() => apply(sales), "PERMISSION_DENIED");
  await unchangedOnFailure(() => apply(outsider), "PERMISSION_DENIED");
  await rejected(() => read(outsider), "PERMISSION_DENIED");
  assert.equal((await read(sales)).snapshot.availability, "not_yet_available");
  assert.equal((await workRead(sales)).snapshot.reasonCode, "phase_ledger_missing");
  assert.equal((await actualsRead(sales)).snapshot.reasonCode, "phase_ledger_missing");
  assert.equal((await historyRead(sales)).snapshot.reasonCode, "phase_ledger_missing");
  await rejected(() => historyRead(null), "UNAUTHENTICATED");
  await rejected(() => historyRead(unverified), "FAILED_PRECONDITION");
  await unchangedWorkFailure(() => workApply(owner), "FAILED_PRECONDITION");
  await unchangedActualsFailure(() => actualsApply(owner), "FAILED_PRECONDITION");
  await unchangedWorkFailure(() => workApply(null), "UNAUTHENTICATED");
  await unchangedActualsFailure(() => actualsApply(null), "UNAUTHENTICATED");
  await unchangedWorkFailure(() => workApply(unverified), "FAILED_PRECONDITION");
  await unchangedActualsFailure(() => actualsApply(unverified), "FAILED_PRECONDITION");
  await unchangedWorkFailure(() => workApply(sales), "PERMISSION_DENIED");
  await unchangedActualsFailure(() => actualsApply(sales), "PERMISSION_DENIED");
  await unchangedWorkFailure(() => workApply(outsider), "PERMISSION_DENIED");
  await unchangedActualsFailure(() => actualsApply(outsider), "PERMISSION_DENIED");
  await rejected(() => workRead(outsider), "PERMISSION_DENIED");
  await rejected(() => actualsRead(outsider), "PERMISSION_DENIED");
  await rejected(() => historyRead(outsider), "PERMISSION_DENIED");
  await settingsRef.update({ eventOperatingSpineEnabled: false });
  await rejected(() => read(owner), "FAILED_PRECONDITION");
  await unchangedOnFailure(() => apply(owner), "FAILED_PRECONDITION");
  await rejected(() => workRead(owner), "FAILED_PRECONDITION");
  await rejected(() => actualsRead(owner), "FAILED_PRECONDITION");
  await rejected(() => historyRead(owner), "FAILED_PRECONDITION");
  await unchangedWorkFailure(() => workApply(owner), "FAILED_PRECONDITION");
  await unchangedActualsFailure(() => actualsApply(owner), "FAILED_PRECONDITION");
  await settingsRef.update({ eventOperatingSpineEnabled: true });
  const roleRef = db.collection("userRoles").doc(owner.uid);
  await roleRef.update({ role: "sales" });
  await unchangedOnFailure(() => apply(owner), "PERMISSION_DENIED");
  await unchangedWorkFailure(() => workApply(owner), "PERMISSION_DENIED");
  await unchangedActualsFailure(() => actualsApply(owner), "PERMISSION_DENIED");
  await roleRef.update({ role: "viewer" });
  await rejected(() => historyRead(owner), "PERMISSION_DENIED");
  await roleRef.update({ role: "admin", email: "changed-identity@local.test" });
  await unchangedOnFailure(() => apply(owner), "PERMISSION_DENIED");
  await unchangedWorkFailure(() => workApply(owner), "PERMISSION_DENIED");
  await unchangedActualsFailure(() => actualsApply(owner), "PERMISSION_DENIED");
  await rejected(() => historyRead(owner), "PERMISSION_DENIED");
  await roleRef.update({ email: owner.email, organizationId: OTHER });
  await unchangedOnFailure(() => apply(owner), "PERMISSION_DENIED");
  await unchangedWorkFailure(() => workApply(owner), "PERMISSION_DENIED");
  await unchangedActualsFailure(() => actualsApply(owner), "PERMISSION_DENIED");
  await rejected(() => historyRead(owner), "PERMISSION_DENIED");
  await roleRef.update({ organizationId: ORG });
  await orgRef.update({ active: false });
  await unchangedOnFailure(() => apply(owner), "FAILED_PRECONDITION");
  await unchangedWorkFailure(() => workApply(owner), "FAILED_PRECONDITION");
  await unchangedActualsFailure(() => actualsApply(owner), "FAILED_PRECONDITION");
  await rejected(() => historyRead(owner), "FAILED_PRECONDITION");
  await orgRef.update({ active: true });
  const tombstone = db.collection("organizationTombstones").doc(ORG);
  await tombstone.set({ retired: true });
  await unchangedOnFailure(() => apply(owner), "FAILED_PRECONDITION");
  await unchangedWorkFailure(() => workApply(owner), "FAILED_PRECONDITION");
  await unchangedActualsFailure(() => actualsApply(owner), "FAILED_PRECONDITION");
  await rejected(() => historyRead(owner), "FAILED_PRECONDITION");
  await tombstone.delete();
  const first = await apply(owner);
  assert.equal(first.snapshot.phase, "prepared");
  const ledgerRef = orgRef.collection("eventOperatingLedgers").doc(first.snapshot.ledgerId);
  assert.equal((await ledgerRef.collection("receipts").get()).size, 1);
  assert.equal((await apply(owner)).idempotent, true);
  const move = { ...request, command: "transition", expectedLedgerRevision: 1, targetPhase: "in_progress" };
  const outcomes = await Promise.allSettled([apply(owner, { ...move, requestId: "event-transition-concurrent-0001" }), apply(owner, { ...move, requestId: "event-transition-concurrent-0002" })]);
  const concurrentLedger = (await ledgerRef.get()).data();
  const concurrentReceipts = await ledgerRef.collection("receipts").get();
  test("event emulator commits exactly one concurrent transition", () => {
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1, "Exactly one concurrent revision transition must win.");
    assert.equal(outcomes.find((outcome) => outcome.status === "rejected").reason.status, "ABORTED");
    assert.equal(concurrentLedger.revision, 2);
    assert.equal(concurrentReceipts.size, 2, "Losing concurrent command must not leave a receipt.");
  });
  await unchangedOnFailure(() => apply(owner, { ...move, requestId: "event-stale-transition-0001" }), "ABORTED");
  await unchangedOnFailure(() => apply(owner, { ...move, requestId: "event-invalid-transition-0001", expectedLedgerRevision: 2, targetPhase: "prepared" }), "FAILED_PRECONDITION");
  await unchangedOnFailure(() => apply(owner, { ...move, requestId: request.requestId }), "ALREADY_EXISTS");
  const snapshot = (await read(sales)).snapshot;
  assert.equal(snapshot.phase, "in_progress");
  for (const hidden of ["recordedBy", "commandDigest", "resultLedger", "proposalSnapshot", "snapshotSha256", owner.email]) assert.equal(JSON.stringify(snapshot).includes(hidden), false, "Projection exposed private receipt data.");
  assert.deepEqual(await domainState(), baseline, "Phase commands modified commercial source authority.");
  // Journal owns its own revision and receipt stream; phase evidence is read-only.
  const phaseBeforeWork = await ledgerState();
  assert.equal((await workRead(owner)).snapshot.reasonCode, "journal_empty");
  const workFirst = await workApply(owner);
  assert.equal(workFirst.snapshot.revision, 1);
  assert.equal((await workApply(owner)).idempotent, true);
  const workMove = { ...workRequest, expectedWorkRevision: 1, note: "Team briefing recorded" };
  const workOutcomes = await Promise.allSettled([
    workApply(owner, { ...workMove, requestId: "event-work-concurrent-0001", checkpointCode: "team_briefing" }),
    workApply(owner, { ...workMove, requestId: "event-work-concurrent-0002", checkpointCode: "service_handoff" })
  ]);
  const workStateRef = ledgerRef.collection("workState").doc("current");
  const concurrentWork = (await workStateRef.get()).data();
  const concurrentWorkReceipts = await ledgerRef.collection("workReceipts").get();
  test("event work emulator commits exactly one concurrent journal change", () => {
    assert.equal(workOutcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(workOutcomes.find((outcome) => outcome.status === "rejected").reason.status, "ABORTED");
    assert.equal(concurrentWork.revision, 2);
    assert.equal(concurrentWorkReceipts.size, 2, "Losing journal transition must not create a receipt.");
  });
  let workRevision = 2;
  let workCounter = 1;
  async function recordWork(command, fields) {
    const result = await workApply(owner, {
      ...source, requestId: `event-work-lifecycle-${String(workCounter++).padStart(4, "0")}`,
      workPolicyVersion: 1, expectedWorkRevision: workRevision, command, ...fields
    });
    workRevision = result.snapshot.revision;
    return result;
  }
  await unchangedWorkFailure(() => workApply(owner, { ...workRequest, requestId: "event-work-stale-cas-0001" }), "ABORTED");
  await unchangedWorkFailure(() => workApply(owner, { ...workRequest, note: "Changed retry intent" }), "ALREADY_EXISTS");
  await unchangedWorkFailure(() => workApply(owner, { ...workRequest, note: "x".repeat(241) }), "INVALID_ARGUMENT");
  await recordWork("checkpoint_reopen", { checkpointCode: "venue_access", note: "Entrance changed" });
  await recordWork("checkpoint_record", { checkpointCode: "venue_access" });
  const issueOpened = await recordWork("issue_open", { severity: "urgent", note: "Serving access blocked" });
  const workIssueId = issueOpened.receipt.issueId;
  await recordWork("issue_resolve", { issueId: workIssueId, note: "Access restored" });
  const issueReopened = await recordWork("issue_reopen", { issueId: workIssueId, note: "Access blocked again" });
  assert.equal(issueReopened.snapshot.issues[0].description, "Serving access blocked");
  assert.equal(issueReopened.snapshot.issues[0].severity, "urgent");
  assert.equal(issueReopened.snapshot.issues[0].state, "open");
  // Resolved issues remain in the lifetime cap; there is no delete/reset path.
  for (let index = 2; index <= 25; index += 1) {
    await recordWork("issue_open", { severity: "normal", note: `Synthetic retained issue ${index}` });
  }
  await recordWork("issue_resolve", { issueId: workIssueId, note: "Resolved and retained" });
  await unchangedWorkFailure(() => workApply(owner, {
    ...source, requestId: "event-work-cap-attempt-0026", workPolicyVersion: 1,
    expectedWorkRevision: workRevision, command: "issue_open", severity: "normal", note: "Beyond lifetime cap"
  }), "RESOURCE_EXHAUSTED");
  const workProjection = (await workRead(sales)).snapshot;
  assert.equal(workProjection.issues.length, 25);
  for (const hidden of ["recordedBy", "commandDigest", "resultWorkState", "priorWorkDigest", owner.email]) {
    assert.equal(JSON.stringify(workProjection).includes(hidden), false, "Work projection exposed private command evidence.");
  }
  assert.deepEqual(await ledgerState(), phaseBeforeWork, "Journal commands changed phase ledger or receipts.");
  assert.deepEqual(await domainState(), baseline, "Journal commands changed accepted commercial source.");
  const savedWorkState = (await workStateRef.get()).data();
  await workStateRef.delete();
  await rejected(() => workRead(owner), "DATA_LOSS");
  await unchangedWorkFailure(() => workApply(owner, { ...workRequest, requestId: "event-work-orphan-reset-0001" }), "DATA_LOSS");
  assert.equal((await workApply(owner)).idempotent, true, "Historical retry must survive missing current projection.");
  await workStateRef.set(savedWorkState);
  const phaseBeforeOrphan = (await ledgerRef.get()).data();
  await ledgerRef.delete();
  await rejected(() => workRead(owner), "DATA_LOSS");
  await ledgerRef.set(phaseBeforeOrphan);
  // Explicit category declarations distinguish confirmed zero from unknown capture.
  const phaseBeforeActuals = await ledgerState();
  const workBeforeActuals = await workLedgerState();
  const emptyActuals = (await actualsRead(owner)).snapshot;
  assert.equal(emptyActuals.reasonCode, "actuals_empty");
  assert.equal(emptyActuals.captureComplete, false);
  assert.equal(emptyActuals.totals.totalCostCents, 0);
  assert.equal(emptyActuals.categories.labor.state, "not_declared");
  let actualsRevision = 0;
  let actualsCounter = 1;
  async function recordActuals(command, fields) {
    const result = await actualsApply(owner, {
      ...source, requestId: `event-actuals-lifecycle-${String(actualsCounter++).padStart(4, "0")}`,
      actualsPolicyVersion: 1, expectedActualsRevision: actualsRevision, command, ...fields
    });
    actualsRevision = result.snapshot.revision;
    return result;
  }
  let confirmedZero;
  for (const costCategory of ["labor", "purchasing", "other"]) {
    confirmedZero = await recordActuals("declare_category", { category: costCategory, state: "complete", note: "Operator confirms zero costs recorded for this category" });
  }
  assert.equal(confirmedZero.snapshot.captureComplete, true);
  assert.equal(confirmedZero.snapshot.totals.totalCostCents, 0);
  const firstActuals = await actualsApply(owner);
  actualsRevision = firstActuals.snapshot.revision;
  assert.equal(firstActuals.snapshot.captureComplete, false);
  assert.equal(firstActuals.snapshot.categories.labor.state, "partial");
  assert.equal((await actualsApply(owner)).idempotent, true);
  const costMove = { ...source, actualsPolicyVersion: 1, expectedActualsRevision: actualsRevision, command: "record", description: "Declared concurrent cost", costCents: 2000 };
  const actualsOutcomes = await Promise.allSettled([
    actualsApply(owner, { ...costMove, requestId: "event-actuals-concurrent-0001", category: "purchasing" }),
    actualsApply(owner, { ...costMove, requestId: "event-actuals-concurrent-0002", category: "other" })
  ]);
  const actualsStateRef = ledgerRef.collection("actualsState").doc("current");
  const concurrentActuals = (await actualsStateRef.get()).data();
  const concurrentActualsReceipts = await ledgerRef.collection("actualsReceipts").get();
  test("event actuals emulator commits exactly one concurrent cost record", () => {
    assert.equal(actualsOutcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(actualsOutcomes.find((outcome) => outcome.status === "rejected").reason.status, "ABORTED");
    assert.equal(concurrentActuals.revision, 5);
    assert.equal(concurrentActuals.entries.length, 2);
    assert.equal(concurrentActualsReceipts.size, 5, "Losing actuals command must not create a receipt.");
  });
  actualsRevision = concurrentActuals.revision;
  for (const costCategory of ["labor", "purchasing", "other"]) {
    await recordActuals("declare_category", { category: costCategory, state: "complete", note: "Operator reviewed captured costs" });
  }
  const laborEntryId = firstActuals.receipt.entryId;
  const correctedActuals = await recordActuals("correct", { entryId: laborEntryId, category: "labor", description: "Corrected declared labor", costCents: 15000, durationMinutes: 240, laborRole: "server", reason: "Original declaration omitted setup time" });
  assert.equal(correctedActuals.snapshot.entries[0].entryId, laborEntryId);
  assert.equal(correctedActuals.snapshot.categories.labor.state, "partial");
  assert.equal(correctedActuals.snapshot.categories.purchasing.state, "complete");
  assert.equal(correctedActuals.snapshot.captureComplete, false);
  await recordActuals("declare_category", { category: "labor", state: "complete", note: "Corrected total reviewed" });
  const voidedActuals = await recordActuals("void", { entryId: laborEntryId, reason: "Void duplicated supporting record" });
  assert.equal(voidedActuals.snapshot.entries[0].state, "voided");
  assert.equal(voidedActuals.snapshot.totals.laborCostCents, 0);
  assert.equal(voidedActuals.snapshot.categories.labor.state, "partial");
  await recordActuals("declare_category", { category: "labor", state: "not_applicable", note: "No remaining applicable labor costs" });
  await unchangedActualsFailure(() => actualsApply(owner, { ...actualsRequest, requestId: "event-actuals-terminal-0001", expectedActualsRevision: actualsRevision, command: "correct", entryId: laborEntryId, reason: "Cannot revive void" }), "FAILED_PRECONDITION");
  for (let index = 3; index <= 50; index += 1) {
    await recordActuals("record", { category: "purchasing", description: `Synthetic retained cost ${index}`, costCents: 1 });
  }
  const costProjection = (await actualsRead(sales)).snapshot;
  assert.equal(costProjection.entries.length, 50);
  await unchangedActualsFailure(() => actualsApply(owner, { ...costMove, requestId: "event-actuals-cap-0051", expectedActualsRevision: actualsRevision, category: "other" }), "RESOURCE_EXHAUSTED");
  await unchangedActualsFailure(() => actualsApply(owner, { ...actualsRequest, costCents: null }), "INVALID_ARGUMENT");
  await unchangedActualsFailure(() => actualsApply(owner, { ...actualsRequest, costCents: 777 }), "ALREADY_EXISTS");
  await unchangedActualsFailure(() => actualsApply(owner, { ...actualsRequest, requestId: "event-actuals-stale-0001" }), "ABORTED");
  for (const hidden of ["recordedBy", "commandDigest", "priorActualsState", "resultActualsState", owner.email]) {
    assert.equal(JSON.stringify(costProjection).includes(hidden), false, "Actuals projection exposed private command evidence.");
  }
  assert.deepEqual(await ledgerState(), phaseBeforeActuals, "Actuals commands changed phase authority.");
  assert.deepEqual(await workLedgerState(), workBeforeActuals, "Actuals commands changed work authority.");
  assert.deepEqual(await domainState(), baseline, "Actuals commands changed commercial source authority.");
  const savedActuals = (await actualsStateRef.get()).data();
  await actualsStateRef.delete();
  await rejected(() => actualsRead(owner), "DATA_LOSS");
  await rejected(() => historyRead(owner), "DATA_LOSS");
  await unchangedActualsFailure(() => actualsApply(owner, { ...actualsRequest, requestId: "event-actuals-orphan-reset-0001", expectedActualsRevision: 0 }), "DATA_LOSS");
  assert.equal((await actualsApply(owner)).idempotent, true);
  await actualsStateRef.set(savedActuals);
  const savedPhase = (await ledgerRef.get()).data();
  await ledgerRef.delete();
  await rejected(() => actualsRead(owner), "DATA_LOSS");
  await rejected(() => historyRead(owner), "DATA_LOSS");
  await rejected(() => read(owner), "DATA_LOSS");
  await rejected(() => apply(owner, { ...request, requestId: "event-orphan-new-initialize-0001" }), "DATA_LOSS");
  assert.equal((await ledgerRef.get()).exists, false, "Orphan phase must not be recreated.");
  assert.equal((await apply(owner)).idempotent, true, "Historical exact retry survives a missing parent.");
  await ledgerRef.set(savedPhase);
  const phaseReceiptRef = ledgerRef.collection("receipts").doc(savedPhase.lastReceiptId);
  const savedPhaseReceipt = (await phaseReceiptRef.get()).data();
  await phaseReceiptRef.update({ resultPhase: "tampered" });
  await rejected(() => actualsRead(owner), "DATA_LOSS");
  await rejected(() => historyRead(owner), "DATA_LOSS");
  await unchangedActualsFailure(() => actualsApply(owner, { ...actualsRequest, requestId: "event-actuals-phase-tamper-0001", expectedActualsRevision: actualsRevision }), "DATA_LOSS");
  await phaseReceiptRef.set(savedPhaseReceipt);
  const latestActualsReceiptRef = ledgerRef.collection("actualsReceipts").doc(savedActuals.lastReceiptId);
  const savedActualsReceipt = (await latestActualsReceiptRef.get()).data();
  await latestActualsReceiptRef.update({ commandDigest: "tampered" });
  await rejected(() => actualsRead(owner), "DATA_LOSS");
  await rejected(() => historyRead(owner), "DATA_LOSS");
  await unchangedActualsFailure(() => actualsApply(owner, savedActualsReceipt.request), "DATA_LOSS");
  await latestActualsReceiptRef.set(savedActualsReceipt);
  // History pages are read-only and stay pinned while newer journal receipts arrive.
  const historyBefore = { phase: await ledgerState(), work: await workLedgerState(), actuals: await actualsLedgerState() };
  const firstHistory = (await historyRead(sales)).snapshot;
  assert.equal(firstHistory.rows.length, 20);
  assert.equal(firstHistory.hasMore, true);
  assert.deepEqual({ phase: await ledgerState(), work: await workLedgerState(), actuals: await actualsLedgerState() }, historyBefore);
  const cursorPayload = JSON.parse(Buffer.from(firstHistory.nextCursor, "base64url").toString("utf8"));
  cursorPayload.positions.actuals.nextRevision = cursorPayload.anchors.actuals.revision + 1;
  await rejected(() => historyRead(owner, Buffer.from(JSON.stringify(cursorPayload)).toString("base64url")), "INVALID_ARGUMENT");
  await recordActuals("declare_category", { category: "other", state: "partial", note: "Newer explicit capture note" });
  const afterNewWrite = { phase: await ledgerState(), work: await workLedgerState(), actuals: await actualsLedgerState() };
  const historyRows = [...firstHistory.rows];
  let historyPage = firstHistory;
  while (historyPage.nextCursor) {
    historyPage = (await historyRead(owner, historyPage.nextCursor)).snapshot;
    assert.deepEqual(historyPage.anchors, firstHistory.anchors);
    assert.equal(historyPage.newerAvailable, true);
    assert.ok(historyPage.rows.length <= 20);
    historyRows.push(...historyPage.rows);
  }
  test("event history emulator pages anchored receipts without gaps or writes", () => {
    const expected = Object.values(firstHistory.anchors).reduce((sum, anchor) => sum + anchor.revision, 0);
    assert.equal(historyRows.length, expected);
    assert.equal(new Set(historyRows.map((row) => row.receiptId)).size, expected);
    assert.equal(historyPage.completeForAnchors, true);
    for (const channel of ["phase", "work", "actuals"]) {
      assert.deepEqual(historyRows.filter((row) => row.channel === channel).map((row) => row.resultRevision),
        Array.from({ length: firstHistory.anchors[channel].revision }, (_, index) => firstHistory.anchors[channel].revision - index));
    }
    for (const hidden of ["commandDigest", "priorActualsState", "resultActualsState", "resultLedger", owner.email]) {
      assert.equal(JSON.stringify(historyRows).includes(hidden), false);
    }
  });
  assert.deepEqual({ phase: await ledgerState(), work: await workLedgerState(), actuals: await actualsLedgerState() }, afterNewWrite);
  assert.deepEqual(await domainState(), baseline);
  const historicalWorkReceipt = await ledgerRef.collection("workReceipts").orderBy("resultRevision", "desc").limit(1).get();
  const historicRef = historicalWorkReceipt.docs[0].ref;
  const historicData = historicalWorkReceipt.docs[0].data();
  // Remove an older receipt, retaining the valid current head; traversal must fail closed.
  const oldReceipt = await ledgerRef.collection("workReceipts").where("resultRevision", "==", 1).get();
  const oldRef = oldReceipt.docs[0].ref;
  const oldData = oldReceipt.docs[0].data();
  await oldRef.delete();
  await rejected(async () => {
    let page = (await historyRead(owner)).snapshot;
    while (page.nextCursor) page = (await historyRead(owner, page.nextCursor)).snapshot;
  }, "DATA_LOSS");
  await oldRef.set(oldData);
  await historicRef.update({ commandDigest: "tampered-history" });
  await rejected(() => historyRead(owner), "DATA_LOSS");
  await historicRef.set(historicData);
  const actualsBeforeSourceMove = await actualsLedgerState();
  const workBeforeSourceMove = await workLedgerState();
  test("event work emulator preserves phase and commercial authorities", () => {
    assert.equal(workProjection.checkpoints[0].state, "recorded");
    assert.equal(workProjection.issues[0].state, "resolved");
    assert.equal(workProjection.historyCoverage, "latest_receipt_only");
  });
  const historical = await ledgerState();
  const newAcceptance = { ...acceptance, receiptId: "acceptance-two" };
  await orgRef.collection("proposalAcceptanceReceipts").doc("acceptance-two").set(newAcceptance);
  await quoteRef.update({ acceptanceReceipt: newAcceptance });
  const movedDomain = await domainState();
  await rejected(() => historyRead(owner, firstHistory.nextCursor), "ABORTED");
  assert.equal((await historyRead(owner)).snapshot.reasonCode, "phase_ledger_missing");
  const moved = await read(owner);
  assert.equal(moved.snapshot.availability, "not_yet_available");
  assert.notEqual(moved.snapshot.ledgerId, first.snapshot.ledgerId);
  assert.deepEqual(await ledgerState(), historical, "Source movement rewrote historical ledger.");
  assert.equal((await apply(owner)).idempotent, true, "Exact historical success must reconcile after source moves.");
  await unchangedOnFailure(() => apply(owner, { ...move, requestId: "event-after-source-move-0001", expectedLedgerRevision: 2, targetPhase: "completed" }), "ABORTED");
  assert.deepEqual(await domainState(), movedDomain, "Reconciliation changed domain source.");
  assert.equal((await workRead(owner)).snapshot.reasonCode, "phase_ledger_missing");
  assert.equal((await workApply(owner)).idempotent, true, "Exact work retry must reconcile historical source.");
  await unchangedWorkFailure(() => workApply(owner, { ...workRequest, note: "Different historical payload" }), "ALREADY_EXISTS");
  await unchangedWorkFailure(() => workApply(owner, { ...workRequest, requestId: "event-work-source-moved-0001", expectedWorkRevision: workRevision, checkpointCode: "pack_down" }), "ABORTED");
  assert.deepEqual(await workLedgerState(), workBeforeSourceMove, "Source movement rewrote journal history.");
  assert.deepEqual(await domainState(), movedDomain, "Work reconciliation changed domain source.");
  assert.equal((await actualsRead(owner)).snapshot.reasonCode, "phase_ledger_missing");
  assert.equal((await actualsApply(owner)).idempotent, true);
  await unchangedActualsFailure(() => actualsApply(owner, { ...actualsRequest, description: "Changed historical declaration" }), "ALREADY_EXISTS");
  await unchangedActualsFailure(() => actualsApply(owner, { ...actualsRequest, requestId: "event-actuals-source-shift-0001", expectedActualsRevision: actualsRevision }), "ABORTED");
  assert.deepEqual(await actualsLedgerState(), actualsBeforeSourceMove, "Source movement rewrote actuals history.");
  assert.deepEqual(await domainState(), movedDomain, "Actuals reconciliation changed commercial source.");
  console.log("PASS event history local emulator: anchored bounded pages; current authority and source; no duplicate or missing revisions; newer writes excluded; orphan phase repair; corrupt history rejected; no read writes.");
  console.log("PASS event actuals local emulator: explicit zero vs unknown; category invalidation; correction/void; retained50 cap; concurrent CAS one winner; gates/roles; parent/receipt tamper and orphan rejection; immutable phase/work/domain; historical replay.");
  console.log("PASS event work local emulator: initialized exact parent; checkpoint/issue lifecycle; retained25 cap; journal CAS one winner; unchanged phase/domain; orphan rejection; gates/roles; historical replay.");
  console.log("PASS event operations local emulator: role/email/tenant/gates; exact acceptance; concurrent CAS one winner; atomic ledger/receipts; replay; historical source isolation; bounded projection; unchanged commercial domain.");
}
await db.terminate();
