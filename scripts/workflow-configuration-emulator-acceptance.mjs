#!/usr/bin/env node
// Disposable local acceptance. No provider calls or real project credentials.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const definitions = createRequire(import.meta.url)("../functions/workflowDefinitions.js");
import { createHash, randomBytes } from "node:crypto";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

// Named assertion groups are canonical capability evidence; failures propagate.
const passedGroups = [];
function test(name, assertions) { assertions(); passedGroups.push(name); console.log(`PASS ${name}`); }
const artifactArgs = process.argv.slice(2);
assert.ok(artifactArgs.length === 0 || artifactArgs.length === 2 && artifactArgs[0] === "--evidence-output" && artifactArgs[1].startsWith("/tmp/"), "Optional evidence output must be an explicit /tmp path.");
const sourceFiles = ["functions/index.js", "functions/workflowDefinitions.js", "functions/workflowExecution.js", "functions/eventWorkflowAdapter.js", "functions/workflowPackAdapters.js", "functions/quoteAttendance.js", "functions/commercialChangeAuthority.js", "functions/postEventCloseout.js", "functions/eventOperations.js", "functions/eventOperatingWork.js", "functions/eventOperatingActuals.js", "functions/quoteDelivery.js", "functions/portalConversation.js", "functions/quoteCreation.js", "scripts/workflow-configuration-emulator-acceptance.mjs"];
const sourceDigests = () => Object.fromEntries(sourceFiles.map((path) => [path, createHash("sha256").update(readFileSync(new URL(`../${path}`, import.meta.url))).digest("hex")]));
const testedSourceDigests = sourceDigests();

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
const ORG = "workflow-configuration-local";
const OTHER = "workflow-configuration-other";
const orgRef = db.collection("organizations").doc(ORG);
const settingsRef = orgRef.collection("settings").doc("config");
const quoteRef = orgRef.collection("quotes").doc("booked-event");
const source = { organizationId: ORG, quoteId: quoteRef.id, sourceVersionId: "v1", acceptanceReceiptId: "acceptance-one" };
const request = { ...source, requestId: "event-operations-initialize-0001", command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" };
const importMode = String(process.env.WORKFLOW_ACCEPTANCE_IMPORT_MODE || "");
assert.ok(["", "disabled", "restored"].includes(importMode));
assert.ok(!importMode || globalGate === (importMode === "disabled" ? "false" : "true"));
const importedState = Boolean(importMode);
if (importedState) assert.equal((await orgRef.get()).exists, true, "Explicit import mode requires the populated demo fixture.");
const password = `Emulator-${randomBytes(20).toString("hex")}-Aa1!`;
async function principal(name, role, organizationId = ORG, emailVerified = true) {
  const email = `${name}@local.test`;
  let user;
  if (importedState) {
    user = await auth.getUserByEmail(email);
    assert.equal(user.customClaims.role, role); assert.equal(user.customClaims.organizationId, organizationId);
    assert.equal(user.emailVerified, emailVerified);
    const persisted = (await db.collection("userRoles").doc(user.uid).get()).data();
    assert.equal(persisted.role, role); assert.equal(persisted.organizationId, organizationId);
    // Reuse the same synthetic UID/role; only the disposable sign-in password changes.
    await auth.updateUser(user.uid, { password });
  } else {
    user = await auth.createUser({ email, password, emailVerified });
    await auth.setCustomUserClaims(user.uid, { role, organizationId, claimsVersion: 1 });
    await db.collection("userRoles").doc(user.uid).set({ role, organizationId, email });
  }
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

if (!importedState) await Promise.all([orgRef.set({ active: true, archived: false, status: "active" }), db.collection("organizations").doc(OTHER).set({ active: true, status: "active" }), settingsRef.set({ businessTimeZone: "America/Chicago", eventOperatingSpineEnabled: true })]);
const [owner, sales, outsider, unverified] = await Promise.all([principal("event-admin", "admin"), principal("event-sales", "sales"), principal("event-other", "admin", OTHER), principal("event-unverified", "admin", ORG, false)]);
const issued = "2026-09-01T12:00:00.000Z";
const proposalSnapshot = { organizationId: ORG, quoteId: quoteRef.id, revisionId: `v1@${issued}`, portalIssuedAtISO: issued };
const acceptance = { receiptId: "acceptance-one", organizationId: ORG, quoteId: quoteRef.id, quoteRevisionId: proposalSnapshot.revisionId, acceptedAtISO: "2026-09-02T12:00:00.000Z", portalIssuedAtISO: issued, snapshotSha256: createHash("sha256").update(JSON.stringify(proposalSnapshot)).digest("hex"), proposalSnapshot };
const quote = { id: quoteRef.id, organizationId: ORG, customerId: "synthetic-customer", status: "booked", activeVersionId: "v1", event: { date: "2026-09-06" }, booking: { bookedAtISO: "2026-09-02T13:00:00.000Z" }, acceptanceReceipt: acceptance };
if (!importedState) await Promise.all([quoteRef.set(quote), quoteRef.collection("versions").doc("v1").set({ versionId: "v1", quoteId: quoteRef.id, organizationId: ORG, customerId: quote.customerId, snapshot: { id: quoteRef.id, organizationId: ORG, customerId: quote.customerId, event: quote.event } }), orgRef.collection("proposalAcceptanceReceipts").doc("acceptance-one").set(acceptance)]);
const scope = { organizationId: ORG, workflowKind: "event_execution" };
const configRead = (who = owner) => call("getWorkflowConfiguration", who, scope);
const configApply = (data, who = owner) => preservesCanonicalDomain(() => call("applyWorkflowDefinitionCommand", who, { ...scope, ...data }));
const eventRead = (who = owner) => call("getEventWorkflowSnapshot", who, { organizationId: ORG, quoteId: quoteRef.id });
const eventApply = (data, who = owner) => preservesCanonicalDomain(() => call("applyEventWorkflowCommand", who, { ...source, ...data }));
const phaseApply = (data = request, who = owner) => call("applyEventOperatingCommand", who, data);
const configurationRef = orgRef.collection("workflowDefinitions").doc("event_execution");
const comparable = (value) => JSON.parse(JSON.stringify(value));
async function collections(ref, names) {
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, (await ref.collection(name).get()).docs.map((doc) => ({ id: doc.id, data: comparable(doc.data()) })).sort((a, b) => a.id.localeCompare(b.id))])));
}
async function storedState() {
  const head = await configurationRef.get();
  const definitionsState = { head: head.exists ? comparable(head.data()) : null, ...await collections(configurationRef, ["versions", "lifecycleReceipts"]) };
  const instances = await orgRef.collection("workflowInstances").get();
  const ledgers = await orgRef.collection("eventOperatingLedgers").get();
  const otherDefinitions = await orgRef.collection("workflowDefinitions").get();
  const attendance = await orgRef.collection("quoteAttendance").get();
  const closeouts = await orgRef.collection("postEventCloseouts").get();
  const quotes = await orgRef.collection("quotes").get();
  return { definitions: definitionsState,
    packDefinitions: await Promise.all(otherDefinitions.docs.filter((doc) => doc.id !== "event_execution").map(async (doc) => ({ id: doc.id, data: comparable(doc.data()), ...await collections(doc.ref, ["versions", "lifecycleReceipts"]) }))),
    attendance: await Promise.all(attendance.docs.map(async (doc) => ({ id: doc.id, data: comparable(doc.data()), ...await collections(doc.ref, ["receipts"]) }))),
    quotes: await Promise.all(quotes.docs.map(async (doc) => ({ id: doc.id, data: comparable(doc.data()), ...await collections(doc.ref, ["versions"]) }))),
    closeouts: await Promise.all(closeouts.docs.map(async (doc) => ({ id: doc.id, data: comparable(doc.data()), ...await collections(doc.ref, ["actionReceipts"]) }))),
    otherDomains: await collections(orgRef, ["proposalAcceptanceReceipts", "commercialChangeSimulations", "commercialChangeAuthorizations", "commercialChangeApplyReceipts"]),
    instances: await Promise.all(instances.docs.map(async (doc) => ({ id: doc.id, data: comparable(doc.data()), ...await collections(doc.ref, ["receipts", "observations"]) }))),
    ledgers: await Promise.all(ledgers.docs.map(async (doc) => ({ id: doc.id, data: comparable(doc.data()), ...await collections(doc.ref, ["receipts", "workState", "workReceipts", "actualsState", "actualsReceipts"]) }))) };
}
async function canonicalDomainState() {
  const state = await storedState();
  return { settings: comparable((await settingsRef.get()).data()), quotes: state.quotes, acceptanceAndCommercialReceipts: state.otherDomains,
    attendance: state.attendance, events: state.ledgers, closeouts: state.closeouts };
}
async function preservesCanonicalDomain(action) {
  const before = await canonicalDomainState();
  const result = await action();
  assert.deepEqual(await canonicalDomainState(), before, "Configuration or coordination changed native business facts.");
  return result;
}
async function unchangedFailure(action, status) {
  const before = await storedState();
  await rejected(action, status);
  assert.deepEqual(await storedState(), before, "Rejected request changed definitions, instances, phase, or child journals.");
}
const commercialState = async () => ({ quote: comparable((await quoteRef.get()).data()), version: comparable((await quoteRef.collection("versions").doc("v1").get()).data()), acceptance: comparable((await orgRef.collection("proposalAcceptanceReceipts").doc("acceptance-one").get()).data()) });
const baseline = await commercialState();
const config = { ...definitions.seedPublishedVersion().config, name: "Local declared coordination", actualsReviewThresholdCents: 0,
  comparisonPolicy: { laborBasisPoints: 0, purchasingBasisPoints: 100, minimumCents: 0 },
  taskTemplates: [{ ...definitions.seedPublishedVersion().config.taskTemplates[0], ownerRole: "sales", communicationTemplateRef: "internal_event_brief_v1" }] };
const draft = { requestId: "workflow-config-draft-initial-0001", expectedRevision: 0, command: "save_draft", config };
async function publish(configValue, revision, suffix) {
  await configApply({ requestId: `workflow-config-draft-${suffix}`, expectedRevision: revision, command: "save_draft", config: configValue });
  const { preview } = await call("previewWorkflowDefinition", owner, { ...scope, expectedRevision: revision + 1 });
  const command = { requestId: `workflow-config-publish-${suffix}`, expectedRevision: revision + 1, command: "publish", previewDigest: preview.previewDigest, confirmationText: preview.confirmationText };
  const result = await configApply(command);
  return { result, command, preview };
}
const packKinds = ["quote_review", "final_guest_count", "event_execution", "closeout_follow_up"];
const packPolicies = {
  quote_review: { approval: { basis: "absolute_total_delta_cents", thresholdCents: 0, allowedRoles: ["admin", "sales"] } },
  final_guest_count: { responsibleRoles: ["admin", "sales"] },
  event_execution: { phaseConstraints: { in_progress: { requiredCheckpoints: ["venue_access"], blockOpenUrgentIssues: true }, completed: { requiredCheckpoints: [], blockOpenUrgentIssues: false } }, checkpointPrerequisites: { venue_access: [], team_briefing: ["venue_access"], service_handoff: [], pack_down: [] } },
  closeout_follow_up: { responsibleRoles: ["admin", "sales"], followUpOffsetDays: 0 }
};
function packConfig(kind, suffix = "initial") {
  return { ...structuredClone(definitions.seedPublishedVersion().config), schemaVersion: 2, workflowKind: kind,
    name: `Synthetic ${kind} ${suffix}`, packPolicy: packPolicies[kind] };
}
async function publishPack(kind, suffix = "initial") {
  const scope = { organizationId: ORG, workflowKind: kind };
  const prior = (await call("getWorkflowConfiguration", owner, scope)).snapshot;
  const config = packConfig(kind, suffix);
  await preservesCanonicalDomain(() => call("applyWorkflowDefinitionCommand", owner, { ...scope, requestId: `pack-${kind}-draft-${suffix}`, expectedRevision: prior.revision, command: "save_draft", config }));
  const { preview } = await call("previewWorkflowDefinition", owner, { ...scope, expectedRevision: prior.revision + 1 });
  const result = await preservesCanonicalDomain(() => call("applyWorkflowDefinitionCommand", owner, { ...scope, requestId: `pack-${kind}-publish-${suffix}`, expectedRevision: prior.revision + 1, command: "publish", previewDigest: preview.previewDigest, confirmationText: preview.confirmationText }));
  return { config, result };
}
async function syntheticAcceptedSource(quoteId, eventDate) {
  // Explicit fixture acceptance and delivery records. No provider was contacted
  // and these records must never be presented as real customer acceptance.
  const portalKey = randomBytes(24).toString("hex");
  const quoteRef = orgRef.collection("quotes").doc(quoteId);
  const refs = { organizationId: ORG, quoteId, sourceVersionId: "v1", acceptanceReceiptId: `acceptance-${quoteId}` };
  const event = { date: eventDate, guests: 84 };
  const proposalSnapshot = { organizationId: ORG, quoteId, revisionId: `v1@${issued}`, portalIssuedAtISO: issued, event };
  const acceptance = { ...refs, receiptId: refs.acceptanceReceiptId, quoteRevisionId: proposalSnapshot.revisionId, acceptedAtISO: "2026-09-02T12:00:00.000Z", portalIssuedAtISO: issued,
    snapshotSha256: createHash("sha256").update(JSON.stringify(proposalSnapshot)).digest("hex"), proposalSnapshot };
  const deliveryEvidence = { revisionId: proposalSnapshot.revisionId, state: "provider_accepted", portalActivationState: "active", portalKey, portalIssuedAtISO: issued, providerAcceptedAtISO: "2026-09-01T12:01:00.000Z" };
  const quote = { id: quoteId, organizationId: ORG, customerId: `customer-${quoteId}`, status: "booked", activeVersionId: "v1", event,
    booking: { bookedAtISO: "2026-09-02T13:00:00.000Z" }, acceptanceReceipt: acceptance,
    portalKey, portalIssuedAtISO: issued, portalExpiresAtISO: "2026-12-31T23:59:59.000Z",
    workflow: { quoteDelivery: { ...deliveryEvidence, providerMessageId: `synthetic-no-provider-${quoteId}`, provider: "none" } } };
  const version = { versionId: "v1", organizationId: ORG, quoteId, customerId: quote.customerId,
    snapshot: { id: quoteId, organizationId: ORG, customerId: quote.customerId, event } };
  await Promise.all([quoteRef.set(quote), quoteRef.collection("versions").doc("v1").set(version),
    orgRef.collection("proposalAcceptanceReceipts").doc(refs.acceptanceReceiptId).set(acceptance),
    db.collection("customerPortalQuotes").doc(portalKey).set({ ...quote, quoteId, deliveryEvidence })]);
  return { refs, quote, version, acceptance, quoteRef, portalKey };
}
async function allFourOwnerAcceptance() {
  assert.equal(process.env.COMMERCIAL_CHANGE_AUTHORITY_ENABLED, "true", "All-four qualification requires explicit Commercial Change server authority.");
  await settingsRef.update({ commercialChangeAuthorityEnabled: true });
  for (const kind of packKinds) await publishPack(kind);
  const operation = await syntheticAcceptedSource("pack-operating-event", "2026-10-17");
  const operatingRequest = { ...operation.refs, requestId: "pack-native-event-initialize-0001", expectedLedgerRevision: 0, command: "initialize", targetPhase: "prepared" };
  const initialized = await call("applyEventOperatingCommand", owner, operatingRequest);
  const scopes = [{ organizationId: ORG, quoteId: operation.refs.quoteId, workflowKind: "event_execution" }];
  const packRead = (scope, who = owner) => call("getWorkflowPackSnapshot", who, scope);
  const eventInitial = (await packRead(scopes[0])).snapshot;
  assert.equal(eventInitial.domainRef.evidenceId, initialized.receipt.receiptId);
  await unchangedFailure(() => call("applyEventOperatingCommand", owner, { ...operatingRequest, requestId: "pack-native-event-blocked-0001", expectedLedgerRevision: 1, command: "transition", targetPhase: "in_progress" }), "FAILED_PRECONDITION");
  await call("applyEventOperatingWorkCommand", owner, { ...operation.refs, requestId: "pack-native-checkpoint-record-0001", workPolicyVersion: 1, expectedWorkRevision: 0, command: "checkpoint_record", checkpointCode: "venue_access", note: "Synthetic operator observation" });
  const phaseProgress = await call("applyEventOperatingCommand", owner, { ...operatingRequest, requestId: "pack-native-event-progress-0001", expectedLedgerRevision: 1, command: "transition", targetPhase: "in_progress" });
  assert.equal((await packRead(scopes[0])).snapshot.domainRef.evidenceId, phaseProgress.receipt.receiptId);

  const attendanceRequest = { ...operation.refs, requestId: "pack-native-attendance-request-0001", expectedAttendanceRevision: 0, command: "request_confirmation" };
  const attendanceStart = await call("applyQuoteAttendanceCommand", owner, attendanceRequest);
  const attendanceScope = { organizationId: ORG, quoteId: operation.refs.quoteId, workflowKind: "final_guest_count" };
  scopes.push(attendanceScope);
  const attendanceBefore = await canonicalDomainState();
  const portalRequest = { portalKey: operation.portalKey, confirmationRequestId: attendanceStart.receipt.receiptId,
    expectedSourceVersionId: "v1", expectedPortalIssuedAtISO: issued, expectedAttendanceRevision: 1, requestId: "pack-native-portal-response-0001", count: 84 };
  const submitted = await call("submitQuoteAttendanceResponse", null, portalRequest);
  const attendanceAfter = await canonicalDomainState();
  assert.deepEqual(attendanceAfter.quotes, attendanceBefore.quotes, "A matching portal count rewrote a quote or price.");
  assert.deepEqual(attendanceAfter.events, attendanceBefore.events);
  assert.deepEqual(attendanceAfter.acceptanceAndCommercialReceipts, attendanceBefore.acceptanceAndCommercialReceipts);
  const portalRead = await call("getQuoteAttendance", null, { accessMode: "portal", portalKey: operation.portalKey });
  assert.equal(portalRead.snapshot.latestResponse.count, 84);
  assert.equal((await packRead(attendanceScope)).snapshot.domainRef.evidenceId, submitted.receipt.receiptId);
  assert.equal((await packRead(attendanceScope)).snapshot.domainRef.stateCode, "response_recorded");

  const past = await syntheticAcceptedSource("pack-closeout-event", "2026-08-20");
  const closeoutOwner = createRequire(import.meta.url)("../functions/postEventCloseout.js");
  const closeoutRecord = closeoutOwner.buildPostEventCloseoutRecord({ organizationId: ORG, quoteId: past.refs.quoteId, sourceQuote: past.quote,
    sourceVersion: past.version, acceptanceReceiptDocument: past.acceptance, settings: { businessTimeZone: "America/Chicago" }, actor: owner, nowISO: new Date().toISOString() });
  await orgRef.collection("postEventCloseouts").doc(closeoutRecord.closeoutId).set(closeoutRecord);
  const closeoutRequest = { organizationId: ORG, quoteId: past.refs.quoteId, closeoutId: closeoutRecord.closeoutId,
    itemCode: "internal_closeout", action: "review", requestId: "pack-native-closeout-review-0001", note: "Synthetic local owner review" };
  await call("recordPostEventCloseoutReview", owner, closeoutRequest);
  const closeoutScope = { organizationId: ORG, quoteId: past.refs.quoteId, workflowKind: "closeout_follow_up" };
  scopes.push(closeoutScope);
  const refreshRequest = { organizationId: ORG, quoteId: past.refs.quoteId, closeoutId: closeoutRecord.closeoutId, requestId: "pack-native-closeout-refresh-0001" };
  await call("refreshPostEventCloseoutConfiguration", owner, refreshRequest);
  const closeoutSnapshot = (await packRead(closeoutScope)).snapshot;
  assert.equal(closeoutSnapshot.domainRef.evidenceId, closeoutOwner.normalizePostEventCloseoutPolicyRefreshRequest(refreshRequest).receiptId);
  const closeoutInstance = orgRef.collection("workflowInstances").doc(closeoutSnapshot.instanceId);
  const closeoutProof = await closeoutInstance.collection("observations").doc(closeoutSnapshot.domainRef.evidenceId).get();
  assert.equal(closeoutProof.exists, true);
  assert.equal(closeoutProof.data().proofDigest, closeoutSnapshot.domainRef.evidenceDigest);

  // Reuse the established disposable CCA catalog fixture, with explicit prices.
  const confirmationAtISO = new Date().toISOString();
  await settingsRef.set({ catalogRevision: 1, pricingSetupConfirmed: true,
    pricingConfirmation: { actorUid: owner.uid, actorEmail: owner.email, confirmedAtISO: confirmationAtISO, confirmedCatalogRevision: 1 },
    serviceFeePct: 0.15, serviceFeeTiers: [{ id: "pack-standard", minGuests: 0, maxGuests: 9999, pct: 0.15 }], taxRate: 0.08,
    taxRegions: [{ id: "pack-local", name: "Synthetic Local", rate: 0.08 }], defaultTaxRegion: "pack-local", depositPct: 0.25,
    staffingLaborEnabled: true, staffingChargeMode: "per_hour", serverRate: 22, chefRate: 28, bartenderRate: 24,
    quoteValidityDays: 30, updatedAtISO: confirmationAtISO }, { merge: true });
  await orgRef.collection("catalogPackages").doc("pack-local").set({ name: "Synthetic package", description: "Local acceptance fixture", pppMinor: 4200, active: true });
  await orgRef.collection("menuItems").doc("pack-menu").set({ name: "Synthetic entree", eventTypeId: "pack-event", categoryId: "pack-entrees", priceMinor: 0, pricingType: "per_event", type: "per_event", active: true });
  const form = { name: "Synthetic operator fixture", email: "synthetic-customer@local.test", phone: "205-555-0136", clientOrg: "Local acceptance",
    eventName: "Synthetic commercial review", date: "2026-10-17", time: "12:00", hours: 5, guests: 84, servers: 2, chefs: 1, bartenders: 0,
    style: "buffet", venue: "Local fixture", venueAddress: "100 Emulator Way", dietaryRestrictions: "", eventTypeId: "pack-event", pkg: "pack-local",
    addons: [], rentals: [], menuItems: ["pack-menu"], addonQuantities: {}, rentalQuantities: {}, menuItemQuantities: { "pack-menu": 1 }, milesRT: 0,
    payMethod: "card", eventTemplateId: "custom", taxRegion: "pack-local", seasonProfileId: "standard", includeDisposables: true };
  const created = await call("createQuoteDraft", owner, { organizationId: ORG, form });
  const changed = { ...form, guests: 126 };
  const simulationRequest = { organizationId: ORG, quoteId: created.id, expectedActiveVersionId: created.activeVersionId,
    requestId: `change_sim_${"a".repeat(32)}`, form: changed };
  const simulation = await call("simulateCommercialQuoteChange", owner, simulationRequest);
  const quoteScope = { organizationId: ORG, quoteId: created.id, workflowKind: "quote_review", simulationReceiptId: simulation.simulationReceipt.receiptId };
  scopes.push(quoteScope);
  assert.equal((await packRead(quoteScope)).snapshot.domainRef.evidenceId, simulation.simulationReceipt.receiptId);
  await call("requestCommercialQuoteChangeAuthorization", owner, { organizationId: ORG, quoteId: created.id, simulationReceiptId: quoteScope.simulationReceiptId, requestId: `change_auth_request_${"b".repeat(32)}` });
  const authorizationRequest = { organizationId: ORG, quoteId: created.id, simulationReceiptId: quoteScope.simulationReceiptId, requestId: `change_auth_${"c".repeat(32)}` };
  const beforeAuthorizationGate = await storedState();
  await settingsRef.update({ eventOperatingSpineEnabled: false });
  await unchangedFailure(() => call("authorizeCommercialQuoteChange", owner, authorizationRequest), "FAILED_PRECONDITION");
  await settingsRef.update({ eventOperatingSpineEnabled: true });
  assert.deepEqual(await storedState(), beforeAuthorizationGate);
  test("quote workflow authorization gate rejects the still-current native source without writes", () => { assert.equal(simulation.simulationReceipt.baseRevisionId, created.activeVersionId); });
  const authorized = await call("authorizeCommercialQuoteChange", owner, authorizationRequest);
  assert.equal((await packRead(quoteScope)).snapshot.domainRef.evidenceId, authorized.authorizationReceipt.receiptId);
  const applied = await call("updateQuoteDraft", owner, { organizationId: ORG, quoteId: created.id, form: changed,
    commercialChangeAuthority: { simulationReceiptId: quoteScope.simulationReceiptId, authorizationReceiptId: authorized.authorizationReceipt.receiptId, applyRequestId: `change_apply_${"d".repeat(32)}` } });
  const quoteSnapshot = (await packRead(quoteScope)).snapshot;
  assert.equal(quoteSnapshot.domainRef.stateCode, "applied");
  assert.equal(quoteSnapshot.domainRef.evidenceId, applied.commercialChange.applyReceiptId);

  const replays = [];
  for (const scope of scopes) {
    const before = (await packRead(scope)).snapshot;
    const identity = { ...scope, sourceVersionId: before.source.sourceVersionId, sourceReceiptId: before.source.sourceReceiptId };
    const ack = { ...identity, requestId: `pack-task-ack-${scope.workflowKind}-0001`, expectedRevision: before.revision,
      command: "task_ack", taskKey: before.tasks[0].taskKey, note: "Reviewed synthetic coordination instruction" };
    await unchangedFailure(() => call("applyWorkflowPackCommand", sales, ack), "PERMISSION_DENIED");
    await preservesCanonicalDomain(() => call("applyWorkflowPackCommand", owner, ack));
    const acknowledged = (await packRead(scope)).snapshot;
    await publishPack(scope.workflowKind, "next");
    assert.deepEqual((await packRead(scope)).snapshot.definitionPin, acknowledged.definitionPin);
    const { preview } = await call("previewWorkflowPackMigration", owner, { ...identity, expectedRevision: acknowledged.revision });
    assert.equal(preview.compatible, true);
    const migrate = { ...identity, requestId: `pack-migrate-${scope.workflowKind}-0001`, expectedRevision: acknowledged.revision,
      command: "migrate", previewDigest: preview.previewDigest, confirmation: preview.confirmation, note: "Explicit compatible fixture migration" };
    await preservesCanonicalDomain(() => call("applyWorkflowPackCommand", owner, migrate));
    const migrated = (await packRead(scope)).snapshot;
    assert.equal(migrated.tasks[0].state, "acknowledged");
    const configScope = { organizationId: ORG, workflowKind: scope.workflowKind };
    const catalog = (await call("getWorkflowConfiguration", owner, configScope)).snapshot;
    await preservesCanonicalDomain(() => call("applyWorkflowDefinitionCommand", owner, { ...configScope, requestId: `pack-retire-${scope.workflowKind}-0001`, expectedRevision: catalog.revision,
      command: "retire", versionId: migrated.definitionPin.versionId, reason: "Synthetic pause for new sources" }));
    assert.deepEqual((await packRead(scope)).snapshot.definitionPin, migrated.definitionPin);
    replays.push({ scope, command: migrate, snapshot: migrated });
  }
  test("all four workflow packs pair real owner commands while coordination preserves canonical business facts", () => {
    assert.deepEqual(scopes.map((scope) => scope.workflowKind).sort(), [...packKinds].sort());
    assert.equal(replays.length, 4);
    assert.ok(replays.every(({ snapshot }) => snapshot.source.schemaVersion === 2 && snapshot.domainRef.schemaVersion === 2));
  });
  const beforeOff = await storedState();
  await settingsRef.update({ eventOperatingSpineEnabled: false });
  for (const { scope, command } of replays) {
    await unchangedFailure(() => packRead(scope), "FAILED_PRECONDITION");
    await unchangedFailure(() => call("applyWorkflowPackCommand", owner, command), "FAILED_PRECONDITION");
  }
  await unchangedFailure(() => call("applyQuoteAttendanceCommand", owner, attendanceRequest), "FAILED_PRECONDITION");
  await unchangedFailure(() => call("submitQuoteAttendanceResponse", null, portalRequest), "FAILED_PRECONDITION");
  await unchangedFailure(() => call("applyEventOperatingCommand", owner, operatingRequest), "FAILED_PRECONDITION");
  await unchangedFailure(() => call("recordPostEventCloseoutReview", owner, closeoutRequest), "FAILED_PRECONDITION");
  // Native freshness validation precedes authorization replay once apply moved
  // the canonical quote. The current-source gate was independently tested above.
  await unchangedFailure(() => call("authorizeCommercialQuoteChange", owner, authorizationRequest), "ABORTED");
  assert.deepEqual(await storedState(), beforeOff);
  await settingsRef.update({ eventOperatingSpineEnabled: true });
  for (const { scope, command, snapshot } of replays) {
    const restored = (await packRead(scope)).snapshot;
    assert.deepEqual(restored.definitionPin, snapshot.definitionPin);
    assert.equal(restored.lastReceiptId, snapshot.lastReceiptId);
    assert.equal((await preservesCanonicalDomain(() => call("applyWorkflowPackCommand", owner, command))).idempotent, true);
  }
  test("all four workflow packs retain populated evidence across disable restore and exact replay", () => {
    assert.equal(replays.length, 4);
    assert.ok(beforeOff.attendance.length && beforeOff.closeouts.length && beforeOff.packDefinitions.length === 3);
  });
  assert.deepEqual(await storedState(), beforeOff);
  return { workflowKinds: [...packKinds], workflowSchemas: [1, 2], syntheticPortalDeliveryEvidence: true,
    closeoutInitialization: "explicit_native_writer_fixture", canonicalBusinessFactsPreservedByCoordination: true };
}
async function importedOwnerAcceptance() {
  const before = await storedState();
  const bound = before.instances.filter((entry) => entry.data.schemaVersion === 2);
  assert.deepEqual([...new Set(bound.map((entry) => entry.data.source.workflowKind))].sort(), [...packKinds].sort());
  for (const entry of bound) {
    const source = entry.data.source;
    const scope = { organizationId: ORG, quoteId: source.subjectId, workflowKind: source.workflowKind,
      ...(source.workflowKind === "quote_review" ? { simulationReceiptId: source.sourceReceiptId } : {}) };
    const receipt = entry.receipts.find((item) => item.id === entry.data.lastReceiptId)?.data;
    assert.ok(receipt, "Imported workflow is missing its immutable head receipt.");
    const command = { ...scope, sourceVersionId: source.sourceVersionId, sourceReceiptId: source.sourceReceiptId, ...receipt.request };
    if (importMode === "disabled") {
      await unchangedFailure(() => call("getWorkflowPackSnapshot", owner, scope), "FAILED_PRECONDITION");
      await unchangedFailure(() => call("applyWorkflowPackCommand", owner, command), "FAILED_PRECONDITION");
    } else {
      const restored = (await call("getWorkflowPackSnapshot", owner, scope)).snapshot;
      assert.deepEqual(restored.definitionPin, entry.data.definitionPin);
      assert.equal(restored.lastReceiptId, entry.data.lastReceiptId);
      assert.equal(restored.revision, entry.data.revision);
      assert.equal((await preservesCanonicalDomain(() => call("applyWorkflowPackCommand", owner, command))).idempotent, true);
    }
  }
  for (const entry of before.ledgers) {
    const initial = entry.receipts.find((item) => item.data.request.command === "initialize");
    assert.ok(initial);
    if (importMode === "disabled") await unchangedFailure(() => call("applyEventOperatingCommand", owner, initial.data.request), "FAILED_PRECONDITION");
    else assert.equal((await call("applyEventOperatingCommand", owner, initial.data.request)).idempotent, true);
  }
  for (const entry of before.attendance) {
    const requested = entry.receipts.find((item) => item.data.request.command === "request_confirmation");
    assert.ok(requested);
    if (importMode === "disabled") await unchangedFailure(() => call("applyQuoteAttendanceCommand", owner, requested.data.request), "FAILED_PRECONDITION");
    else assert.equal((await call("applyQuoteAttendanceCommand", owner, requested.data.request)).idempotent, true);
  }
  for (const entry of before.closeouts) {
    const reviewed = entry.actionReceipts.find((item) => item.data.action === "review");
    assert.ok(reviewed);
    const command = Object.fromEntries(["organizationId", "quoteId", "closeoutId", "itemCode", "action", "requestId", "note"].map((key) => [key, reviewed.data[key]]));
    if (importMode === "disabled") await unchangedFailure(() => call("recordPostEventCloseoutReview", owner, command), "FAILED_PRECONDITION");
    else await call("recordPostEventCloseoutReview", owner, command);
  }
  assert.deepEqual(await storedState(), before, "Global disable or restore changed imported native facts, pins, or retained receipts.");
  if (importMode === "disabled") {
    test("all four populated workflow packs survive global server disable without writes", () => { assert.equal(bound.length, 4); assert.ok(before.attendance.length && before.closeouts.length); });
  } else {
    test("all four populated workflow packs restore original identities pins and historical receipts", () => { assert.equal(bound.length, 4); assert.ok(before.attendance.length && before.closeouts.length); });
  }
  return { workflowKinds: [...packKinds], workflowSchemas: [1, 2], syntheticPortalDeliveryEvidence: true,
    importMode, importedNativeState: true, syntheticPrincipalIdentitiesReused: true,
    canonicalBusinessFactsPreservedByCoordination: true };
}
if (globalGate === "false") {
  const before = await storedState();
  for (const action of [() => configRead(), () => configApply(draft), () => call("previewWorkflowDefinition", owner, { ...scope, expectedRevision: 0 }), () => eventRead(), () => call("previewEventWorkflowMigration", owner, { ...source, expectedRevision: 0 }), () => eventApply({ requestId: "workflow-off-task-00000001", expectedRevision: 0, command: "task_ack", taskKey: "review_event_context", note: "Gate test" }), () => phaseApply()]) await rejected(action, "FAILED_PRECONDITION");
  test("workflow emulator global gate denies all configuration and coordination authority", () => {
    if (importedState) assert.ok(before.instances.length > 0 && before.ledgers.length > 0);
    else { assert.equal(before.definitions.head, null); assert.equal(before.instances.length, 0); assert.equal(before.ledgers.length, 0); }
  });
  assert.deepEqual(await storedState(), before);
  for (const kind of packKinds) {
    const packScope = { organizationId: ORG, quoteId: quoteRef.id, workflowKind: kind,
      ...(kind === "quote_review" ? { simulationReceiptId: `ccs_${"a".repeat(48)}` } : {}) };
    await rejected(() => call("getWorkflowPackSnapshot", owner, packScope), "FAILED_PRECONDITION");
    await rejected(() => call("applyWorkflowPackCommand", owner, { ...packScope, sourceVersionId: "v1", sourceReceiptId: kind === "quote_review" ? packScope.simulationReceiptId : source.acceptanceReceiptId,
      requestId: `pack-global-off-${kind}-0001`, command: "task_ack", expectedRevision: 1, taskKey: "review_event_context", note: "Explicit global gate test" }), "FAILED_PRECONDITION");
  }
  await rejected(() => call("getQuoteAttendance", owner, { organizationId: ORG, quoteId: quoteRef.id, accessMode: "staff" }), "FAILED_PRECONDITION");
  await rejected(() => call("applyQuoteAttendanceCommand", owner, { ...source, requestId: "attendance-global-off-0001", expectedAttendanceRevision: 0, command: "request_confirmation" }), "FAILED_PRECONDITION");
  test("all four workflow pack callables deny the global disabled gate without writes", () => { assert.equal(packKinds.length, 4); });
  assert.deepEqual(await storedState(), before);
} else if (!importedState) {
  await rejected(() => configRead(null), "UNAUTHENTICATED");
  await rejected(() => configRead(sales), "PERMISSION_DENIED");
  await rejected(() => configRead(outsider), "PERMISSION_DENIED");
  await rejected(() => configRead(unverified), "FAILED_PRECONDITION");
  const beforeRead = await storedState();
  assert.equal((await configRead()).snapshot.state, "seed");
  assert.deepEqual(await storedState(), beforeRead);
  await settingsRef.update({ eventOperatingSpineEnabled: false });
  await unchangedFailure(() => configApply(draft), "FAILED_PRECONDITION");
  await rejected(() => eventRead(), "FAILED_PRECONDITION");
  await settingsRef.update({ eventOperatingSpineEnabled: true });
  // Two writes race on the same empty head; only one CAS may commit.
  const drafts = await Promise.allSettled([configApply(draft), configApply({ ...draft, requestId: "workflow-config-draft-competing-0001" })]);
  const afterDraft = await storedState();
  test("workflow emulator commits exactly one concurrent configuration draft", () => {
    assert.equal(drafts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(drafts.find((result) => result.status === "rejected").reason.status, "ABORTED");
    assert.equal(afterDraft.definitions.head.revision, 1);
    assert.equal(afterDraft.definitions.lifecycleReceipts.length, 1);
    assert.equal(afterDraft.definitions.versions.length, 0);
  });
  const { preview } = await call("previewWorkflowDefinition", owner, { ...scope, expectedRevision: 1 });
  const publication = { requestId: "workflow-config-publish-initial-0001", expectedRevision: 1, command: "publish", previewDigest: preview.previewDigest, confirmationText: preview.confirmationText };
  await unchangedFailure(() => configApply({ ...publication, confirmationText: "PUBLISH wrong candidate" }), "FAILED_PRECONDITION");
  await configApply(publication);
  assert.equal((await configApply(publication)).idempotent, true);
  await unchangedFailure(() => configApply({ ...publication, confirmationText: "Changed original payload" }), "ALREADY_EXISTS");
  await unchangedFailure(() => configApply(publication, sales), "PERMISSION_DENIED");
  const firstVersion = comparable((await configurationRef.collection("versions").doc("event_execution_v1").get()).data());
  await phaseApply();
  const first = (await eventRead(sales)).snapshot;
  const instanceRef = orgRef.collection("workflowInstances").doc(first.instanceId);
  assert.equal(first.definitionPin.version, 1);
  assert.equal(first.comparisonPolicy.laborBasisPoints, 0);
  assert.equal(first.actualsReview.state, "not_yet_available");
  assert.equal((await phaseApply()).idempotent, true);
  const task = { requestId: "workflow-task-acknowledge-first-0001", expectedRevision: 1, command: "task_ack", taskKey: first.tasks[0].taskKey, note: "Reviewed manual internal event brief" };
  const tasks = await Promise.allSettled([eventApply(task, sales), eventApply({ ...task, requestId: "workflow-task-acknowledge-competing-0001" }, owner)]);
  const afterTask = (await eventRead()).snapshot;
  const taskReceipts = await instanceRef.collection("receipts").get();
  test("workflow emulator commits exactly one concurrent task acknowledgement", () => {
    assert.equal(tasks.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(tasks.find((result) => result.status === "rejected").reason.status, "ABORTED");
    assert.equal(afterTask.revision, 2); assert.equal(afterTask.tasks[0].state, "acknowledged");
    assert.equal(taskReceipts.size, 2);
  });
  const winningTask = tasks[0].status === "fulfilled" ? { data: task, who: sales } : { data: { ...task, requestId: "workflow-task-acknowledge-competing-0001" }, who: owner };
  assert.equal((await eventApply(winningTask.data, winningTask.who)).idempotent, true);
  await unchangedFailure(() => eventApply(winningTask.data, winningTask.who === owner ? sales : owner), "ALREADY_EXISTS");
  // Complete known zero costs trigger a zero threshold; subsequent C revision invalidates it.
  let actualsLast;
  for (const [index, category] of ["labor", "purchasing", "other"].entries()) {
    actualsLast = await call("applyEventOperatingActualsCommand", owner, { ...source, requestId: `workflow-actuals-zero-${category}`, actualsPolicyVersion: 1, expectedActualsRevision: index, command: "declare_category", category, state: "complete", note: "Explicitly confirmed zero captured costs" });
  }
  assert.equal((await eventRead()).snapshot.actualsReview.state, "required");
  const review = { requestId: "workflow-review-explicit-zero-0001", expectedRevision: 2, command: "review_ack", actualsRevision: 3, actualsReceiptId: actualsLast.receipt.receiptId, note: "Reviewed explicitly complete zero costs" };
  await eventApply(review);
  assert.equal((await eventRead()).snapshot.actualsReview.state, "acknowledged");
  await call("applyEventOperatingActualsCommand", owner, { ...source, requestId: "workflow-actuals-invalidate-0001", actualsPolicyVersion: 1, expectedActualsRevision: 3, command: "declare_category", category: "other", state: "partial", note: "Further cost information pending" });
  assert.equal((await eventRead()).snapshot.actualsReview.state, "not_yet_available");
  await unchangedFailure(() => eventApply({ ...review, requestId: "workflow-review-stale-source-0001", expectedRevision: 3 }), "ABORTED");
  // Later publication cannot silently change the existing instance; explicit migration can.
  const later = await publish({ ...config, name: "Revised local coordination" }, 2, "second-0001");
  assert.equal((await eventRead()).snapshot.definitionPin.version, 1);
  const { preview: migration } = await call("previewEventWorkflowMigration", owner, { ...source, expectedRevision: 3 });
  assert.equal(migration.compatible, true);
  const migrate = { requestId: "workflow-migration-explicit-0001", expectedRevision: 3, command: "migrate", previewDigest: migration.previewDigest, confirmation: migration.confirmation, note: "Adopt revised compatible coordination" };
  await unchangedFailure(() => eventApply({ ...migrate, confirmation: "MIGRATE wrong" }), "ABORTED");
  await eventApply(migrate);
  const migrated = (await eventRead()).snapshot;
  assert.equal(migrated.definitionPin.version, 2); assert.equal(migrated.tasks[0].state, "acknowledged");
  assert.deepEqual(migrated.configuration.comparisonPolicy, config.comparisonPolicy);
  await configApply({ requestId: "workflow-retire-second-0001", expectedRevision: 4, command: "retire", versionId: "event_execution_v2", reason: "Pause eligibility for new events" });
  assert.equal((await configRead()).snapshot.state, "retired");
  assert.equal((await configRead()).snapshot.newInstanceEligible, false);
  assert.equal((await eventRead()).snapshot.definitionPin.version, 2);
  const phaseResult = await phaseApply({ ...request, requestId: "workflow-phase-transition-paired-0001", expectedLedgerRevision: 1, command: "transition", targetPhase: "in_progress" });
  const progressed = (await eventRead()).snapshot;
  test("workflow emulator preserves immutable pins and atomically pairs phase coordination", () => {
    assert.equal(progressed.revision, 5);
    assert.equal(progressed.domainRef.receiptId, phaseResult.receipt.receiptId);
    assert.equal(progressed.definitionPin.version, 2);
    assert.equal(progressed.tasks[0].state, "acknowledged");
  });
  assert.deepEqual(comparable((await configurationRef.collection("versions").doc("event_execution_v1").get()).data()), firstVersion);
  assert.equal((await configApply(later.command)).idempotent, true);
  // Current persisted authority is rechecked even for exact historical retry.
  await db.collection("userRoles").doc(owner.uid).update({ role: "sales" });
  await unchangedFailure(() => configApply(publication), "PERMISSION_DENIED");
  await db.collection("userRoles").doc(owner.uid).update({ role: "admin" });
  const beforeRollback = await storedState();
  const policyBeforeRollback = (await eventRead()).snapshot;
  await settingsRef.update({ eventOperatingSpineEnabled: false });
  for (const action of [() => configRead(), () => eventRead(), () => eventApply(migrate),
    () => configApply(publication), () => phaseApply({ ...request, requestId: "rollback-phase-denied-0001", command: "transition", expectedLedgerRevision: 2, targetPhase: "completed" })]) {
    await unchangedFailure(action, "FAILED_PRECONDITION");
  }
  const disabledRollback = await storedState();
  await settingsRef.update({ eventOperatingSpineEnabled: true });
  const restoredPolicy = (await eventRead()).snapshot;
  const restoredReplay = await eventApply(migrate);
  const restoredRollback = await storedState();
  test("workflow emulator rollback preserves populated state and restores exact receipts", () => {
    assert.deepEqual(disabledRollback, beforeRollback);
    assert.deepEqual(restoredRollback, beforeRollback);
    assert.equal(restoredReplay.idempotent, true);
    assert.deepEqual(restoredPolicy.definitionPin, policyBeforeRollback.definitionPin);
    assert.equal(restoredPolicy.lastReceiptId, policyBeforeRollback.lastReceiptId);
    assert.equal(restoredPolicy.revision, policyBeforeRollback.revision);
    assert.ok(beforeRollback.instances.length > 0 && beforeRollback.ledgers.length > 0);
  });
  // A missing pinned immutable publication invalidates reads without rebasing to active state.
  const secondRef = configurationRef.collection("versions").doc("event_execution_v2");
  const secondDocument = (await secondRef.get()).data();
  await secondRef.delete();
  await rejected(() => eventRead(), "DATA_LOSS");
  await secondRef.set(secondDocument);
  const movedAcceptance = { ...acceptance, receiptId: "acceptance-two" };
  await orgRef.collection("proposalAcceptanceReceipts").doc("acceptance-two").set(movedAcceptance);
  await quoteRef.update({ acceptanceReceipt: movedAcceptance });
  assert.equal((await eventApply(migrate)).idempotent, true, "Historical replay must preserve exact original source and intent.");
  await unchangedFailure(() => eventApply({ ...migrate, requestId: "workflow-source-changed-migrate-0001", expectedRevision: 5 }), "ABORTED");
  await unchangedFailure(() => phaseApply({ ...request, acceptanceReceiptId: "acceptance-two", requestId: "workflow-retired-new-instance-0001" }), "FAILED_PRECONDITION");
  await quoteRef.set(quote);
  assert.deepEqual(await commercialState(), baseline);
  console.log("PASS workflow configuration local emulator: exact preview publication, CAS, immutable pins, retirement, explicit migration, task ownership, actuals review invalidation, current auth/gates, exact historical source replay, no commercial mutation.");
}
assert.deepEqual(await commercialState(), baseline);
const allFour = importedState ? await importedOwnerAcceptance() : globalGate === "true" ? await allFourOwnerAcceptance() : null;
assert.deepEqual(await commercialState(), baseline);
const finalState = await storedState();
assert.deepEqual(sourceDigests(), testedSourceDigests, "Source changed during the local acceptance run; its artifact would not identify one tested source.");
const evidenceArtifact = {
  schemaVersion: 1, reportKind: "tenant_operating_model_local_acceptance", evidenceClass: "local_simulation",
  projectId, organizationId: ORG, mode: globalGate === "true" ? "enabled" : "global_disabled",
  recordedAtISO: new Date().toISOString(), sourceDigests: testedSourceDigests,
  serverGates: { EVENT_OPERATING_SPINE_ENABLED: globalGate, COMMERCIAL_CHANGE_AUTHORITY_ENABLED: String(process.env.COMMERCIAL_CHANGE_AUTHORITY_ENABLED || "unset") },
  browserGateExercised: false,
  passedAssertionGroups: passedGroups, baselineEventCommercialAuthorityUnchanged: true,
  ...(allFour || { workflowKinds: ["event_execution"], workflowSchemas: [1], syntheticPortalDeliveryEvidence: false }),
  retainedState: { definitions: finalState.definitions.versions.length, definitionReceipts: finalState.definitions.lifecycleReceipts.length,
    workflowInstances: finalState.instances.length, workflowReceipts: finalState.instances.reduce((count, entry) => count + entry.receipts.length, 0),
    phaseLedgers: finalState.ledgers.length },
  notEstablished: ["hosted_role_behavior", "real_tenant_activation", "operator_acceptance", "customer_outcomes", "provider_outcomes", "browser_rollback_presentation", "measured_pilot_baseline"]
};
await db.terminate();
if (artifactArgs.length) writeFileSync(artifactArgs[1], `${JSON.stringify(evidenceArtifact, null, 2)}\n`, { flag: "wx", mode: 0o600 });
else console.log(`LOCAL_ACCEPTANCE_EVIDENCE ${JSON.stringify(evidenceArtifact)}`);
