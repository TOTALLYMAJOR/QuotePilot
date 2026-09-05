import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";
import { deriveAttendanceState } from "../../components/attendanceState.js";
const require = createRequire(import.meta.url);
const creation = require("../../../functions/quoteCreation.js");
const pricingOwner = require("../../../functions/pricingEngine.js");
const definitions = require("../../../functions/workflowDefinitions.js");
const execution = require("../../../functions/workflowExecution.js");
const delivery = require("../../../functions/quoteDelivery.js");
const acceptance = require("../../../functions/proposalAcceptance.js");
const contract = require("../../../functions/contractWorkflow.js");
const graphCore = require("../commercialDependencyGraphCore.cjs");
const impact = require("../../../functions/commercialChangeImpactPreview.js");
const ccaModule = require("../../../functions/commercialChangeAuthority.js");
const evaluateImpact = require("../../../functions/commercialChangeImpactEvaluator.js").createCommercialChangeImpactEvaluator({ graphCore });
const cca = ccaModule.createCommercialChangeAuthority({ graphCore, buildPreviewSnapshots: impact.buildCommercialChangeImpactPreviewSnapshots, simulateImpact: evaluateImpact });
const sourceText = readFileSync(new URL("../../../functions/index.js", import.meta.url), "utf8");
const sourceAst = require("acorn").parse(sourceText, { ecmaVersion: "latest", sourceType: "script" });
const actor = { organizationId: "org-a", principalOrganizationId: "org-a", uid: "staff-a", email: "staff@example.com", role: "admin" };
const orgPath = "organizations/org-a", quotePath = `${orgPath}/quotes/quote-a`;
const nowISO = "2026-09-05T21:00:00.000Z";
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [nowISO])); } static now() { return Date.parse(nowISO); } }

function buildPricing(overrides = {}) {
  return {
    pricingVersion: "pricing-v1",
    calculatedAt: "2026-07-27T12:00:00.000Z",
    authority: "server_authoritative",
    inputs: {
      organizationId: "org-a",
      event: {
        name: "Annual Dinner",
        eventTypeId: "dinner",
        date: "2026-09-12",
        time: "18:00",
        venue: "Main Hall",
        venueAddress: "123 Main Street",
        guests: 50,
        hours: 4,
        style: "Buffet",
        servers: 2,
        chefs: 1,
        bartenders: 1,
        milesRT: 10,
        taxRegionId: "local",
        seasonProfileId: "standard"
      },
      selection: {
        package: {
          id: "classic",
          name: "Classic",
          pricingMode: "per_person",
          unitPrice: 20,
          quantity: 1,
          inclusions: {
            menuItems: [
              { id: "included-side", name: "Included Side", pricingMode: "per_event", unitPrice: 0 },
              { id: "unselected-side", name: "Unselected Side", pricingMode: "per_event", unitPrice: 0 }
            ],
            addons: [
              { id: "included-drink", name: "Included Drink", pricingMode: "per_person", unitPrice: 0 },
              { id: "unselected-drink", name: "Unselected Drink", pricingMode: "per_person", unitPrice: 0 }
            ],
            rentals: [
              { id: "included-chafer", name: "Included Chafer", pricingMode: "per_item", unitPrice: 0 },
              { id: "unselected-chafer", name: "Unselected Chafer", pricingMode: "per_item", unitPrice: 0 }
            ]
          }
        },
        addons: [
          {
            id: "dessert",
            name: "Dessert",
            pricingMode: "per_person",
            unitPrice: 3,
            quantity: 1
          },
          {
            id: "included-drink",
            name: "Included Drink",
            pricingMode: "per_person",
            unitPrice: 0,
            quantity: 1,
            includedInPackage: true
          }
        ],
        rentals: [{
          id: "included-chafer",
          name: "Included Chafer",
          pricingMode: "per_item",
          unitPrice: 0,
          quantity: 1,
          includedInPackage: true
        }],
        menuItems: [
          {
            id: "salad",
            name: "Salad",
            pricingMode: "per_event",
            unitPrice: 50,
            quantity: 1
          },
          {
            id: "included-side",
            name: "Included Side",
            pricingMode: "per_event",
            unitPrice: 0,
            quantity: 1,
            includedInPackage: true
          }
        ],
        quantities: {
          addonQuantities: {},
          rentalQuantities: {},
          menuItemQuantities: {
            salad: 1
          }
        }
      },
      labor: {
        bartenderRateOverride: "",
        serverRateOverride: "",
        chefRateOverride: "",
        serverRateMixCsv: "",
        chefRateMixCsv: ""
      }
    },
    lineItems: [
      { id: "classic", category: "package", total: 1000 },
      { id: "dessert", category: "addon", total: 150 },
      { id: "salad", category: "menu_item", total: 50 }
    ],
    fees: {
      labor: 200,
      serverLabor: 100,
      chefLabor: 60,
      bartenderLabor: 40,
      travel: 25,
      serviceFee: 100
    },
    tax: {
      rate: 0.08,
      amount: 122,
      regionId: "local",
      regionName: "Local"
    },
    deposit: {
      pct: 0.3,
      amount: 494.1
    },
    subtotal: 1425,
    grandTotal: 1647,
    rulesSnapshot: {
      serviceFeePctApplied: 0.08,
      taxRateApplied: 0.08,
      taxRegionId: "local",
      taxRegionName: "Local",
      seasonProfileId: "standard",
      seasonProfileName: "Standard",
      packageMultiplier: 1,
      addonMultiplier: 1,
      rentalMultiplier: 1,
      pricingSettingsVersion: 3,
      pricingSettingsUpdatedAtISO: "2026-07-27T10:00:00.000Z",
      laborRateSnapshot: {
        bartenderRateApplied: 40,
        serverRateApplied: 25,
        serverRatesApplied: [25, 25],
        serverLabor: 100,
        chefRateApplied: 60,
        chefRatesApplied: [60],
        chefLabor: 60,
        bartenderRateTypeId: "standard",
        bartenderRateTypeName: "Standard",
        staffingRateTypeId: "standard",
        staffingRateTypeName: "Standard"
      }
    },
    ...overrides
  };
}

function buildForm(overrides = {}) {
  return {
    name: "Client One",
    email: "CLIENT@EXAMPLE.COM",
    phone: "205-555-0101",
    clientOrg: "Client Co",
    eventName: "Annual Dinner",
    date: "2026-09-12",
    time: "18:00",
    venue: "Main Hall",
    venueAddress: "123 Main Street",
    guests: 50,
    hours: 4,
    servers: 2,
    chefs: 1,
    bartenders: 1,
    dietaryRestrictions: "No peanuts",
    style: "Buffet",
    pkg: "classic",
    addons: ["dessert"],
    rentals: [],
    menuItems: ["salad"],
    menuItemQuantities: { salad: 1, injected: 999 },
    eventTypeId: "dinner",
    eventTemplateId: "custom",
    taxRegion: "local",
    seasonProfileId: "standard",
    milesRT: 10,
    includeDisposables: true,
    payMethod: "ach",
    depositLink: "https://attacker.example/pay",
    ...overrides
  };
}


function harness({ commercialServer = true, commercialTenant = true } = {}) {
  const settings = { eventOperatingSpineEnabled: true, commercialChangeAuthorityEnabled: commercialTenant, businessTimeZone: "America/Chicago", pricingSetupConfirmed: true, catalogRevision: 1, pricingConfirmation: { actorUid: actor.uid, actorEmail: actor.email, confirmedAtISO: "2026-09-01T09:00:00.000Z", confirmedCatalogRevision: 1 } };
  const created = creation.buildTrustedQuoteCreationDocuments({ quoteId: "quote-a", quoteNumber: "Q-ONE", portalKey: "0123456789abcdef0123456789abcdef", organizationId: "org-a",
    pricingCatalogAuthority: pricingOwner.buildPricingCatalogAuthority({ organizationId: "org-a", catalogSource: "firebase-org", settings }),
    staff: actor, form: creation.sanitizeQuoteCreationRequest({ form: buildForm() }).form, pricing: buildPricing(), catalogSource: "firebase-org", settings, nowISO: "2026-09-01T10:00:00.000Z" });
  const initial = { ...created.quote, customerId: "customer-a", status: "sent" };
  const claimed = delivery.claimQuoteDelivery({ quote: initial, quoteId: "quote-a", organizationId: "org-a", expectedRevisionId: delivery.resolveQuoteDeliveryRevisionId(initial, "quote-a"), actorEmail: actor.email,
    attemptId: "local-initial-send", attemptProvider: "resend", payloadSha256: "d".repeat(64), nowISO: "2026-09-01T10:01:00.000Z" });
  initial.workflow.quoteDelivery = delivery.buildQuoteDeliverySuccess({ delivery: claimed.delivery, email: { provider: "resend", messageId: "local-fixture" },
    nowISO: "2026-09-01T10:02:00.000Z", portalKey: initial.portalKey, portalIssuedAtISO: initial.portalIssuedAtISO });
  const signed = acceptance.planProposalAcceptance({ quoteId: "quote-a", quote: initial, portal: creation.buildCanonicalPortalSnapshot("quote-a", initial), portalKey: initial.portalKey,
    signerName: "Local Customer", consentVersion: acceptance.ACCEPTANCE_CONSENT_VERSION, expectedRevisionId: delivery.resolveQuoteDeliveryRevisionId(initial, "quote-a"), expectedPortalIssuedAtISO: initial.portalIssuedAtISO,
    acceptedAtISO: "2026-09-02T10:00:00.000Z", receiptId: "acceptance-original", actor: {} });
  const accepted = { ...initial, ...signed.quotePatch, payment: { ...initial.payment, depositStatus: "paid", stripeSessionId: "cs_local", depositConfirmedAtISO: "2026-09-02T10:30:00.000Z" } };
  const booked = contract.planContractConversion({ quoteId: "quote-a", quote: accepted, peerQuotes: [], actorEmail: actor.email, nowISO: "2026-09-02T11:00:00.000Z", contractNumber: "C-ORIGINAL" });
  const quote = { ...accepted, ...booked.quotePatch, latestVersionNumber: 2 };
  const version = { ...created.version, customerId: "customer-a", snapshot: { ...created.version.snapshot, customerId: "customer-a" } };
  const store = new Map([[orgPath, { active: true, status: "active", name: "Local organization" }], [`${orgPath}/settings/config`, settings],
    ["userRoles/staff-a", actor], [quotePath, quote], [`${quotePath}/versions/v0001`, version],
    [`${orgPath}/proposalAcceptanceReceipts/acceptance-original`, signed.receiptDocument],
    [`customerPortalQuotes/${quote.portalKey}`, creation.buildCanonicalPortalSnapshot("quote-a", quote)],
    [`${orgPath}/customers/customer-a`, { organizationId: "org-a", customerId: "customer-a", name: quote.customer.name, email: quote.customer.email, emailKey: quote.customer.email }]]);
  const writes = []; const diagnostics = []; let staff = actor;
  const snap = path => ({ id: path.split("/").at(-1), exists: store.has(path), ref: ref(path), data: () => structuredClone(store.get(path)) });
  const collection = (path, filters = [], order = null, max = Infinity) => ({ path, query: true, filters, order, max,
    doc: (id = "generated-local-id") => ref(`${path}/${id}`), where: (key, op, value) => collection(path, [...filters, { key, op, value }], order, max),
    orderBy: (key, direction = "asc") => collection(path, filters, { key, direction }, max), limit: max => collection(path, filters, order, max), get: async () => read(collection(path, filters, order, max)) });
  const ref = path => ({ path, id: path.split("/").at(-1), parent: collection(path.split("/").slice(0, -1).join("/")), collection: name => collection(`${path}/${name}`), get: async () => snap(path) });
  function read(reference) {
    if (!reference.query) return snap(reference.path);
    const prefix = reference.path + "/";
    let paths = [...store.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes("/") && reference.filters.every(({ key, op, value }) => {
      const found = key === "__name__" ? path.split("/").at(-1) : key.split(".").reduce((v, part) => v?.[part], store.get(path));
      return op === "==" ? found === value : op === "<=" ? found <= value : op === ">=" ? found >= value : false;
    }));
    if (reference.order) paths.sort((a, b) => { const field = reference.order.key; const va = field === "__name__" ? a : store.get(a)[field], vb = field === "__name__" ? b : store.get(b)[field]; return (va < vb ? -1 : va > vb ? 1 : 0) * (reference.order.direction === "desc" ? -1 : 1); });
    const docs = paths.slice(0, reference.max).map(snap); return { empty: !docs.length, size: docs.length, docs };
  }
  let tail = Promise.resolve();
  async function transaction(callback) {
    const pending = []; let wrote = false;
    const tx = { get: async reference => { if (wrote) throw Error("Transaction read after write"); return read(reference); },
      create: (reference, value) => { wrote = true; if (store.has(reference.path)) throw Error("Immutable identity collision"); pending.push(["create", reference.path, value]); },
      set: (reference, value, options) => { wrote = true; pending.push([options?.merge ? "merge" : "set", reference.path, value]); },
      update: (reference, value) => { wrote = true; if (!store.has(reference.path)) throw Error("Missing update parent"); pending.push(["merge", reference.path, value]); },
      delete: reference => { wrote = true; pending.push(["delete", reference.path]); } };
    const result = await callback(tx);
    for (const [kind, path, value] of pending) { if (kind === "delete") store.delete(path); else store.set(path, structuredClone(kind === "merge" ? { ...store.get(path), ...value } : value)); }
    writes.push(...pending); return result;
  }
  const db = { collection: name => collection(name), runTransaction: callback => { const result = tail.then(() => transaction(callback)); tail = result.catch(() => {}); return result; } };
  class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
  const sandbox = { console: { log() {}, error() {} }, Date: FixedDate, createHash, randomUUID, structuredClone, Buffer, db, exports: {}, REGION: "test",
    FieldValue: { serverTimestamp: () => ({ localServerTimestamp: nowISO }) }, FieldPath: { documentId: () => "__name__" },
    process: { env: { EVENT_OPERATING_SPINE_ENABLED: "true", COMMERCIAL_CHANGE_AUTHORITY_ENABLED: commercialServer ? "true" : "false" } },
    functions: { region: () => ({ https: { onCall: callback => callback } }), https: { HttpsError }, logger: { error: (_label, details) => diagnostics.push(details?.error), warn() {}, info() {} } },
    decisionDebtAuthority: require("../../../functions/decisionDebt.js").createDecisionDebtAuthority({ graphCore }),
    // Model the JSON boundary in the host realm so strict plain-object validation
    // does not mistake VM prototypes for malformed production payloads.
    commercialChangeAuthority: Object.fromEntries(Object.entries(cca).map(([key, value]) => [key, typeof value === "function" ? (...args) => value(...structuredClone(args)) : value])), commercialDependencyGraphCore: Object.fromEntries(Object.entries(graphCore).map(([key, value]) => [key, typeof value === "function" && !key.endsWith("Error") ? (...args) => value(...structuredClone(args)) : value])), evaluateCommercialChangeImpact: evaluateImpact,
    quoteAttendance: require("../../../functions/quoteAttendance.js"), workflowDefinitions: definitions, workflowExecution: execution,
    workflowPackAdapters: require("../../../functions/workflowPackAdapters.js"), eventWorkflowAdapter: require("../../../functions/eventWorkflowAdapter.js"),
    eventOperations: require("../../../functions/eventOperations.js"), eventOperatingWork: require("../../../functions/eventOperatingWork.js"),
    eventOperatingActuals: require("../../../functions/eventOperatingActuals.js"), eventOperatingHistory: require("../../../functions/eventOperatingHistory.js") };
  for (const name of ["quoteCreation", "quoteCatalogRevisionReview", "pricingEngine", "quoteDelivery", "proposalAcceptance", "postEventCloseout", "commercialChangeAuthority", "commercialChangeImpactPreview", "decisionDebt", "organizationAuthority", "portalConversation"]) {
    Object.assign(sandbox, require(`../../../functions/${name}.js`));
  }
  vm.createContext(sandbox);
  // Evaluate the real top-level owner functions without initializing Firebase,
  // secrets, scheduled work or any provider. Only the selected actual handlers run.
  const functionSources = sourceAst.body.filter(node => node.type === "FunctionDeclaration").map(node => sourceText.slice(node.start, node.end));
  const literalConstants = [...sourceText.matchAll(/^const ([A-Z][A-Z0-9_]*)\s*=\s*("[^"\n]*"|[0-9]+);/gm)].map(match => match[0]);
  vm.runInContext(functionSources.join("\n") + "\n" + literalConstants.join("\n") + '\nconst COMMERCIAL_CHANGE_GLOBAL_ENFORCEMENT_ENABLED = process.env.COMMERCIAL_CHANGE_AUTHORITY_ENABLED === "true";', sandbox);
  const originalPackError = sandbox.throwWorkflowPackError;
  sandbox.throwWorkflowPackError = error => { if (!error.code) throw error; return originalPackError(error); };
  sandbox.assertStaff = async () => staff;
  sandbox.calculateQuotePricingAuthoritative = async ({ data }) => {
    const pricing = buildPricing(); pricing.inputs.event.guests = data.pricingInput.form.guests;
    const currentSettings = store.get(`${orgPath}/settings/config`);
    return { pricing, catalogSource: "firebase-org", catalog: null, catalogAuthority: pricingOwner.buildPricingCatalogAuthority({ organizationId: "org-a", catalogSource: "firebase-org", settings: currentSettings }) };
  };
  for (const name of ["applyWorkflowDefinitionCommand", "previewWorkflowDefinition", "getWorkflowConfiguration", "applyQuoteAttendanceCommand", "getWorkflowPackSnapshot", "previewWorkflowPackMigration", "applyWorkflowPackCommand", "simulateCommercialQuoteChange", "authorizeCommercialQuoteChange", "reconcileCommercialQuoteChangeApplyOutcome"]) {
    const start = sourceText.indexOf(`exports.${name} =`); const end = sourceText.indexOf("\n});", start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start); vm.runInContext(sourceText.slice(start, end + 4), sandbox);
  }
  const invoke = async (name, data) => { try { return await sandbox.exports[name](data, {}); } catch (error) { if (error.code === "internal") error.message += ` Local harness cause: ${diagnostics.at(-1)}`; throw error; } };
  return { store, writes, quote, invoke, sandbox, setStaff: value => { staff = value; store.set(`userRoles/${value.uid}`, value); },
    apply: input => sandbox.updateTrustedQuoteDraftInternal({ organizationId: "org-a", quoteId: "quote-a", staff, ...input }) };
}
async function publish(h, workflowKind, revision = 0) {
  const scope = { organizationId: "org-a", workflowKind };
  const config = { ...structuredClone(definitions.seedPublishedVersion().config), schemaVersion: 2, workflowKind,
    packPolicy: workflowKind === "quote_review" ? { approval: { basis: "absolute_total_delta_cents", thresholdCents: 0, allowedRoles: ["admin", "sales"] } } : { responsibleRoles: ["admin", "sales"] } };
  if (revision) config.name = "Reviewed commercial coordination";
  await h.invoke("applyWorkflowDefinitionCommand", { ...scope, requestId: `save-${workflowKind}-local-${revision}-0001`, command: "save_draft", expectedRevision: revision, config });
  const { preview } = await h.invoke("previewWorkflowDefinition", { ...scope, expectedRevision: revision + 1 });
  return h.invoke("applyWorkflowDefinitionCommand", { ...scope, requestId: `publish-${workflowKind}-local-${revision}-0001`, command: "publish", expectedRevision: revision + 1, previewDigest: preview.previewDigest, confirmationText: preview.confirmationText });
}
async function requestedResponse(h, count = 60) {
  await publish(h, "final_guest_count"); await publish(h, "quote_review");
  const source = { organizationId: "org-a", quoteId: "quote-a", sourceVersionId: "v0001", acceptanceReceiptId: "acceptance-original" };
  const requested = await h.invoke("applyQuoteAttendanceCommand", { ...source, requestId: "attendance-local-request-001", expectedAttendanceRevision: 0, command: "request_confirmation" });
  return h.invoke("applyQuoteAttendanceCommand", { ...source, requestId: "attendance-local-response-001", expectedAttendanceRevision: 1, command: "record_response", confirmationRequestId: requested.receipt.receiptId, count, note: "Local staff response" });
}
function simulationInput(h, submission, suffix = "a") { return { organizationId: "org-a", quoteId: "quote-a", expectedActiveVersionId: "v0001", requestId: "change_sim_" + suffix.repeat(32),
  attendanceSubmissionReceiptId: submission.receipt.receiptId, form: { ...creation.buildDuplicateQuoteForm(h.quote), guests: 60 } }; }
describe("commercial pack actual callable integration", () => {
  test("bound commercial workflow denies either dormant gate without writing canonical or workflow state", async () => {
    for (const gates of [{ commercialServer: false }, { commercialTenant: false }]) {
      const h = harness(gates); const response = await requestedResponse(h); const before = structuredClone([...h.store]);
      await expect(h.invoke("simulateCommercialQuoteChange", simulationInput(h, response))).rejects.toMatchObject({ code: "failed-precondition" });
      expect([...h.store]).toEqual(before);
    }
  });
  test("sealed attendance amendment applies atomically and preserves paid contract and old acceptance evidence", async () => {
    const h = harness(); const response = await requestedResponse(h); const original = structuredClone(h.store.get(quotePath));
    const input = simulationInput(h, response); const simulated = await h.invoke("simulateCommercialQuoteChange", input);
    expect(simulated.simulationReceipt.schemaVersion).toBe("commercial-change-simulation-receipt-v2");
    expect(simulated.simulationReceipt.authorizationRequired).toBe(true);
    expect(h.store.get(quotePath)).toEqual(original);
    const authorized = await h.invoke("authorizeCommercialQuoteChange", { organizationId: "org-a", quoteId: "quote-a", simulationReceiptId: simulated.simulationReceipt.receiptId, requestId: "change_auth_" + "b".repeat(32) });
    const authority = { simulationReceiptId: simulated.simulationReceipt.receiptId, authorizationReceiptId: authorized.authorizationReceipt.receiptId, applyRequestId: "change_apply_" + "c".repeat(32) };
    const beforeFailure = structuredClone([...h.store]);
    await expect(h.apply({ form: { ...input.form, guests: 61 }, expectedActiveVersionId: "v0001", commercialChangeAuthorityInput: authority })).rejects.toBeDefined();
    expect([...h.store]).toEqual(beforeFailure);
    const result = await h.apply({ form: input.form, expectedActiveVersionId: "v0001", commercialChangeAuthorityInput: authority });
    const quote = h.store.get(quotePath);
    expect(quote.status).toBe("draft"); expect(quote.acceptanceReceipt).toBeNull(); expect(quote.payment).toEqual(original.payment); expect(quote.booking).toEqual(original.booking);
    expect(quote.event.attendance.confirmation).toMatchObject({ state: "applied", submittedCount: 60, appliedRevisionId: result.activeVersionId, commercialChangeReceiptId: result.commercialChange.applyReceiptId });
    expect(quote.attendanceAmendment.applyReceiptId).toBe(result.commercialChange.applyReceiptId);
    expect(quote.pricingCatalogAuthority).toEqual(pricingOwner.buildPricingCatalogAuthority({ organizationId: "org-a", catalogSource: "firebase-org", settings: h.store.get(`${orgPath}/settings/config`) }));
    expect(h.store.get(`${quotePath}/versions/${result.activeVersionId}`).pricingCatalogAuthority).toEqual(quote.pricingCatalogAuthority);
    expect(h.store.get(`${quotePath}/versions/${result.activeVersionId}`).snapshot.pricingCatalogAuthority).toEqual(quote.pricingCatalogAuthority);
    expect(deriveAttendanceState({ quote })).toMatchObject({ commercialBasis: { count: 60, source: "confirmation" }, confirmation: { state: "applied" }, boundaries: { provesAppliedFinalCount: true, provesPaymentOrProviderOutcome: false } });
    expect(h.store.get(`${quotePath}/versions/v0001`).snapshot.event.guests).toBe(50);
    expect(h.store.get(`${orgPath}/proposalAcceptanceReceipts/acceptance-original`).receiptId).toBe("acceptance-original");
    const applyDoc = h.store.get(`${orgPath}/commercialChangeApplyReceipts/${result.commercialChange.applyReceiptId}`);
    expect(applyDoc.receipt.attendanceBinding.submissionReceiptId).toBe(response.receipt.receiptId);
    const quoteInstance = [...h.store].find(([path, value]) => path.includes("/workflowInstances/") && !path.includes("/receipts/") && value.source?.workflowKind === "quote_review");
    expect(quoteInstance[1].domainRef.stateCode).toBe("applied");
    const nativeState = () => [...h.store].filter(([path]) => !path.includes("/workflowDefinitions/") && !path.includes("/workflowInstances/"));
    const nativeBefore = structuredClone(nativeState());
    const scope = { organizationId: "org-a", quoteId: "quote-a", workflowKind: "quote_review", simulationReceiptId: simulated.simulationReceipt.receiptId };
    const current = (await h.invoke("getWorkflowPackSnapshot", scope)).snapshot;
    await publish(h, "quote_review", 2);
    const migrationSource = { ...scope, sourceVersionId: "v0001", sourceReceiptId: simulated.simulationReceipt.receiptId, expectedRevision: current.revision };
    const { preview } = await h.invoke("previewWorkflowPackMigration", migrationSource);
    await h.invoke("applyWorkflowPackCommand", { ...migrationSource, command: "migrate", requestId: "quote-review-migrate-local-0001", previewDigest: preview.previewDigest, confirmation: preview.confirmation, note: "Adopt compatible coordination metadata" });
    const migrated = (await h.invoke("getWorkflowPackSnapshot", scope)).snapshot;
    expect(migrated.definitionPin.versionId).not.toBe(current.definitionPin.versionId);
    expect(migrated.domainRef).toEqual(current.domainRef);
    expect(nativeState()).toEqual(nativeBefore);
    expect(applyDoc.receipt.workflowPolicy.definitionPin.versionId).toBe(current.definitionPin.versionId);

    const reconciled = await h.invoke("reconcileCommercialQuoteChangeApplyOutcome", { organizationId: "org-a", quoteId: "quote-a", ...authority, expectedBaseRevisionId: "v0001" });
    expect(reconciled).toMatchObject({ ok: true });
    expect(h.store.get(quotePath)).toEqual(quote);
    expect([...h.store.keys()].filter(path => path.includes("/commercialChangeApplyReceipts/"))).toHaveLength(1);
  });
});


describe("current-main catalog review and attendance amendment intersection", () => {
  test("legacy and changed-catalog terminal sources cannot bypass catalog review through an attendance amendment", async () => {
    for (const kind of ["legacy", "changed_catalog"]) {
      const h = harness();
      if (kind === "legacy") {
        delete h.store.get(quotePath).pricingCatalogAuthority;
        delete h.store.get(`${quotePath}/versions/v0001`).pricingCatalogAuthority;
        delete h.store.get(`${quotePath}/versions/v0001`).snapshot.pricingCatalogAuthority;
      } else {
        const settings = h.store.get(`${orgPath}/settings/config`);
        settings.catalogRevision = 2;
        settings.pricingConfirmation.confirmedCatalogRevision = 2;
      }
      const response = await requestedResponse(h);
      const input = simulationInput(h, response);
      const simulated = await h.invoke("simulateCommercialQuoteChange", input);
      const authorized = await h.invoke("authorizeCommercialQuoteChange", { organizationId: "org-a", quoteId: "quote-a",
        simulationReceiptId: simulated.simulationReceipt.receiptId, requestId: "change_auth_" + "d".repeat(32) });
      const authority = { simulationReceiptId: simulated.simulationReceipt.receiptId,
        authorizationReceiptId: authorized.authorizationReceipt.receiptId, applyRequestId: "change_apply_" + "e".repeat(32) };
      const before = structuredClone([...h.store]);
      await expect(h.apply({ form: input.form, expectedActiveVersionId: "v0001", commercialChangeAuthorityInput: authority }))
        .rejects.toMatchObject({ code: "failed-precondition", message: "Resolve the quote catalog revision review before saving commercial changes." });
      expect([...h.store]).toEqual(before);
      expect(h.store.get(quotePath).status).toBe("booked");
      expect([...h.store.keys()].filter(path => path.includes("/commercialChangeApplyReceipts/"))).toHaveLength(0);
    }
  });
});
