#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";
import {
  OPERATIONS_FIXTURE_SOURCE,
  OPERATIONS_ORGANIZATION_ID,
  OPERATIONS_POPULATION_VERSION,
  REALISTIC_ADDONS,
  REALISTIC_EVENTS,
  REALISTIC_OFFERS,
  REALISTIC_RENTALS,
  REALISTIC_STAFF,
  STAFF_ASSET_DIRECTORY,
  operationsPopulationSummary
} from "./realistic-ragnakok-operations-data.mjs";

const require = createRequire(import.meta.url);
const commercial = require("../functions/commercialPlatformCore.cjs");
const pricing = require("../functions/pricingEngine.js");
const quoteCreation = require("../functions/quoteCreation.js");
const quoteDelivery = require("../functions/quoteDelivery.js");
const proposalAcceptance = require("../functions/proposalAcceptance.js");
const { planContractConversion } = require("../functions/contractWorkflow.js");
const approval = require("../functions/approvalWorkflow.js");
const staffingAuthority = require("../functions/operationalStaffingAuthority.js");
const staffingRuntime = require("../functions/operationalStaffingRuntime.js");
const staffDirectory = require("../functions/staffDirectoryAuthority.js");
const workflowDefinitions = require("../functions/workflowDefinitions.js");
const eventOperations = require("../functions/eventOperations.js");
const workflowAdapters = require("../functions/workflowPackAdapters.js");

const ALLOWED_PROJECTS = new Set(["quotepilot-staging-20260804", "tonicatering"]);
const WORKFLOW_KINDS = ["quote_review", "final_guest_count", "event_execution", "closeout_follow_up"];
const ASSET_DIRECTORY = fileURLToPath(STAFF_ASSET_DIRECTORY);

class OperationsPopulationError extends Error {
  constructor(message) {
    super(message);
    this.name = "OperationsPopulationError";
  }
}

const text = (value) => String(value ?? "").trim();
const slug = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
const digest = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const fixture = (value = {}) => value?.fixtureProvenance?.source === OPERATIONS_FIXTURE_SOURCE;

function takeValue(argv, index, flag) {
  const value = text(argv[index + 1]);
  if (!value || value.startsWith("--")) throw new OperationsPopulationError(`${flag} requires a value.`);
  return value;
}

export function parseOperationsPopulationArgs(argv = process.argv.slice(2)) {
  const values = new Map();
  const modes = new Set();
  const knownValues = new Set(["--project", "--organization", "--confirm"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = text(argv[index]);
    if (["--apply", "--dry-run"].includes(token)) {
      if (modes.has(token)) throw new OperationsPopulationError(`Duplicate argument: ${token}`);
      modes.add(token);
      continue;
    }
    if (!knownValues.has(token)) throw new OperationsPopulationError(`Unknown argument: ${token || "(empty)"}`);
    if (values.has(token)) throw new OperationsPopulationError(`Duplicate argument: ${token}`);
    values.set(token, takeValue(argv, index, token));
    index += 1;
  }
  if (modes.has("--apply") && modes.has("--dry-run")) throw new OperationsPopulationError("Choose exactly one mode: --dry-run or --apply.");
  const projectId = text(values.get("--project"));
  const organizationId = text(values.get("--organization"));
  const apply = modes.has("--apply");
  if (!ALLOWED_PROJECTS.has(projectId)) throw new OperationsPopulationError(`Project must be one of: ${[...ALLOWED_PROJECTS].join(", ")}.`);
  if (organizationId !== OPERATIONS_ORGANIZATION_ID) throw new OperationsPopulationError(`Population is restricted to organization ${OPERATIONS_ORGANIZATION_ID}.`);
  const expectedConfirmation = `POPULATE OPERATIONS ${projectId} ${organizationId} ${OPERATIONS_POPULATION_VERSION}`;
  const confirmation = text(values.get("--confirm"));
  if (!apply && confirmation) throw new OperationsPopulationError("--confirm is valid only with --apply.");
  if (apply && confirmation !== expectedConfirmation) throw new OperationsPopulationError(`Apply requires --confirm \"${expectedConfirmation}\". The default mode is read-only.`);
  return Object.freeze({ projectId, organizationId, apply, expectedConfirmation });
}

function activeOrganization(value = {}) {
  const status = text(value.status).toLowerCase();
  return value.active !== false && value.archived !== true && (!status || status === "active");
}

async function resolveActor({ db, auth, organizationId }) {
  const organizationRef = db.collection("organizations").doc(organizationId);
  const [organizationSnapshot, roleSnapshot] = await Promise.all([
    organizationRef.get(),
    db.collection("userRoles").where("organizationId", "==", organizationId).limit(25).get()
  ]);
  if (!organizationSnapshot.exists || !activeOrganization(organizationSnapshot.data() || {})) throw new OperationsPopulationError(`Organization ${organizationId} is missing, inactive, or archived.`);
  const organization = organizationSnapshot.data() || {};
  const admins = roleSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...(snapshot.data() || {}) })).filter((role) => text(role.role).toLowerCase() === "admin");
  const role = admins.find((entry) => entry.id === text(organization.ownerUid)) || (admins.length === 1 ? admins[0] : null);
  if (!role) throw new OperationsPopulationError("Population requires the canonical owner or one unambiguous organization administrator.");
  const email = text(role.email).toLowerCase();
  const user = await auth.getUser(role.id);
  if (!email || user.emailVerified !== true || text(user.email).toLowerCase() !== email) throw new OperationsPopulationError("The population actor is not an exact verified Auth and role match.");
  return Object.freeze({ uid: role.id, email, role: "admin", organizationId, principalOrganizationId: organizationId, organizationName: text(organization.name || organization.displayName || organizationId) });
}

function assertPortraitAssets() {
  const missing = REALISTIC_STAFF.map((member) => path.join(ASSET_DIRECTORY, member.portrait)).filter((assetPath) => !existsSync(assetPath));
  if (missing.length) throw new OperationsPopulationError(`Missing ${missing.length} generated staff portrait assets.`);
}

const portraitUrl = (_projectId, member) => `https://quotepilot.mbmapps.com/fixtures/ragnakok-staff/${encodeURIComponent(member.portrait)}`;

function menuIds(names, byName) {
  return names.map((name) => {
    const item = byName.get(name.toLowerCase());
    if (!item) throw new OperationsPopulationError(`Required menu item is missing: ${name}`);
    return item.id;
  });
}

function offerDocuments(byName, nowISO) {
  return REALISTIC_OFFERS.map((offer) => ({
    id: offer.id,
    data: {
      name: offer.name,
      pppMinor: Math.round(offer.ppp * 100),
      costPppMinor: Math.round(offer.costPpp * 100),
      includedMenuItemIds: menuIds(offer.menuNames, byName),
      includedAddonIds: [],
      includedRentalIds: [],
      choiceGroups: [{ id: "featured-main", label: "Choose one featured main", componentType: "menu_item", componentIds: menuIds(offer.choiceNames, byName), minChoices: 1, maxChoices: 1 }],
      quantityPolicyRefs: ["catering-demand-guests"],
      ruleRefs: ["rko-rule-large-event-captain"],
      offerVersion: "configurable-offer-v1",
      verticalType: "catering",
      active: true,
      fixtureProvenance: { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION },
      createdAtISO: nowISO,
      updatedAtISO: nowISO
    }
  }));
}

function addonDocuments(nowISO) {
  return REALISTIC_ADDONS.map((item) => ({ id: item.id, data: {
    name: item.name, pricingType: item.pricingType, type: item.pricingType,
    priceMinor: Math.round(item.price * 100), costMinor: Math.round(item.cost * 100),
    staffRole: item.staffRole || "", active: true, portalDecidable: item.portalDecidable === true,
    fixtureProvenance: { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION }, createdAtISO: nowISO, updatedAtISO: nowISO
  } }));
}

function rentalDocuments(nowISO) {
  return REALISTIC_RENTALS.map((item) => ({ id: item.id, data: {
    name: item.name, pricingType: item.pricingType, type: item.pricingType,
    priceMinor: Math.round(item.price * 100), costMinor: Math.round(item.cost * 100), qtyPerGuests: item.qtyPerGuests,
    active: true, portalDecidable: item.portalDecidable === true,
    fixtureProvenance: { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION }, createdAtISO: nowISO, updatedAtISO: nowISO
  } }));
}

function eventTemplates(offers, eventTypeId) {
  const styles = ["buffet", "plated", "stations", "cocktail"];
  return offers.map((offer, index) => ({
    id: `rko-template-${offer.id.replace("rko-offer-", "")}`,
    name: `${offer.data.name} event plan`, templateVersion: "commercial-template-v1", verticalType: "catering",
    eventTypeId, pkg: offer.id, style: styles[index % styles.length], hours: index % 2 ? 6 : 5,
    addons: index % 2 ? ["rko-addon-welcome-sparkler"] : ["rko-addon-coffee-salon"],
    rentals: ["rko-rental-linen", "rko-rental-china"], menuItems: offer.data.includedMenuItemIds,
    resourcePolicyRefs: ["catering-staffing"], pricingContextRefs: ["catering-pricing-v2"],
    provenance: { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION }
  }));
}

function configurationRules() {
  return [
    ["rko-rule-large-event-captain", "event.demandQuantity", "gte", 125, "addon", "rko-addon-event-captain", "Events at 125 guests or more benefit from a dedicated event captain."],
    ["rko-rule-evening-coffee", "event.serviceStyle", "eq", "plated", "addon", "rko-addon-coffee-salon", "Plated evening service benefits from a defined coffee close."],
    ["rko-rule-cocktail-glassware", "event.serviceStyle", "eq", "cocktail", "rental", "rko-rental-glassware", "Cocktail service should include a reviewed glassware plan."],
    ["rko-rule-large-event-lounge", "event.demandQuantity", "gte", 150, "rental", "rko-rental-lounge", "Large guest counts may benefit from a defined conversation zone."]
  ].map(([id, conditionPath, operator, value, componentType, componentId, reason]) => ({
    id, ruleVersion: "configuration-rule-v1", type: "recommendation",
    conditions: [{ path: conditionPath, operator, value }], effect: { operator: "recommend", componentRef: { componentType, componentId } },
    reason, severity: "info", verticalScope: "catering", enabled: true,
    provenance: { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION }
  }));
}

function templateModules() {
  return [
    ["rko-module-premium-bar", "Premium bar", "addons", "rko-addon-signature-bar"],
    ["rko-module-dessert-finale", "Dessert finale", "addons", "rko-addon-dessert-flight"],
    ["rko-module-lounge", "Guest lounge", "rentals", "rko-rental-lounge"],
    ["rko-module-raw-bar", "Raw bar", "addons", "rko-addon-raw-bar"]
  ].map(([id, name, group, item]) => ({ id, name, moduleVersion: "commercial-template-module-v1", componentSelections: { [group]: [item] }, presentationMetadata: { label: name }, provenance: { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION } }));
}

async function assertFixtureWriteTargets(collection, documents) {
  const snapshots = await Promise.all(documents.map((entry) => collection.doc(entry.id).get()));
  snapshots.forEach((snapshot) => {
    if (snapshot.exists && !fixture(snapshot.data() || {})) throw new OperationsPopulationError(`Refusing to overwrite non-fixture record ${snapshot.ref.path}.`);
  });
}

async function removeLegacyFixtureRecords(db, organizationRef, collectionName, documents) {
  const snapshots = await Promise.all(documents.map((entry) => organizationRef.collection(collectionName).doc(entry.id).get()));
  const owned = snapshots.filter((snapshot) => snapshot.exists && fixture(snapshot.data() || {}));
  const foreign = snapshots.find((snapshot) => snapshot.exists && !fixture(snapshot.data() || {}));
  if (foreign) throw new OperationsPopulationError(`Refusing to remove non-fixture legacy record ${foreign.ref.path}.`);
  if (!owned.length) return 0;
  const batch = db.batch();
  owned.forEach((snapshot) => batch.delete(snapshot.ref));
  await batch.commit();
  return owned.length;
}

async function prepareCatalog({ db, organizationId, actor, nowISO, apply }) {
  const organizationRef = db.collection("organizations").doc(organizationId);
  const [settingsSnapshot, menuSnapshot, eventTypesSnapshot] = await Promise.all([
    organizationRef.collection("settings").doc("config").get(),
    organizationRef.collection("menuItems").get(),
    organizationRef.collection("eventTypes").limit(20).get()
  ]);
  if (!settingsSnapshot.exists) throw new OperationsPopulationError("Organization pricing settings are missing.");
  if (menuSnapshot.size < 500) throw new OperationsPopulationError(`The menu has ${menuSnapshot.size} items; run populate:inventory:ragnakok first.`);
  const eventTypeDocument = eventTypesSnapshot.docs.find((document) => document.data()?.active !== false && document.data()?.enabled !== false);
  if (!eventTypeDocument) throw new OperationsPopulationError("At least one selectable event type is required.");
  const byName = new Map(menuSnapshot.docs.map((document) => [text(document.data()?.name).toLowerCase(), { id: document.id, ...document.data() }]));
  const offers = offerDocuments(byName, nowISO);
  const addons = addonDocuments(nowISO);
  const rentals = rentalDocuments(nowISO);
  const templates = eventTemplates(offers, eventTypeDocument.id);
  const rules = configurationRules();
  const verticalPack = { ...commercial.CATERING_VERTICAL_PACK, starterData: { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION }, offerRefs: offers.map((entry) => entry.id), templateRefs: templates.map((entry) => entry.id), ruleRefs: rules.map((entry) => entry.id) };
  commercial.validateVerticalPack(verticalPack);
  commercial.validateCommercialPublication({
    packages: offers.map((entry) => ({ id: entry.id, ...entry.data })),
    addons: addons.map((entry) => ({ id: entry.id, ...entry.data })),
    rentals: rentals.map((entry) => ({ id: entry.id, ...entry.data })),
    menuItems: menuSnapshot.docs.map((document) => ({ id: document.id, ...(document.data() || {}) })),
    settings: { eventTemplates: templates, configurationRules: rules }
  });
  if (!apply) return { offers, addons, rentals, templates, rules, settings: settingsSnapshot.data() || {} };
  const collections = { catalogPackages: offers, catalogAddons: addons, catalogRentals: rentals };
  for (const [name, documents] of Object.entries(collections)) await assertFixtureWriteTargets(organizationRef.collection(name), documents);
  const batch = db.batch();
  Object.entries(collections).forEach(([name, documents]) => documents.forEach((entry) => batch.set(organizationRef.collection(name).doc(entry.id), entry.data)));
  await batch.commit();
  const removedLegacyRecords = (
    await removeLegacyFixtureRecords(db, organizationRef, "addons", addons)
  ) + (
    await removeLegacyFixtureRecords(db, organizationRef, "rentals", rentals)
  );
  const settingsRef = organizationRef.collection("settings").doc("config");
  let catalogRevision = 0;
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(settingsRef)).data() || {};
    const mergeById = (prior, seeded) => [...(Array.isArray(prior) ? prior : []).filter((item) => !text(item?.id).startsWith("rko-")), ...seeded];
    catalogRevision = Number.isSafeInteger(Number(current.catalogRevision)) ? Number(current.catalogRevision) + 1 : 1;
    tx.set(settingsRef, {
      eventTemplates: mergeById(current.eventTemplates, templates), configurationRules: mergeById(current.configurationRules, rules),
      commercialTemplateModules: mergeById(current.commercialTemplateModules, templateModules()), verticalPack,
      catalogRevision, pricingSetupConfirmed: false, pricingConfirmation: null,
      inventoryAuthorityEnabled: true, operationalStaffingAuthorityEnabled: true,
      targetMarginPct: Number.isFinite(Number(current.targetMarginPct)) ? Number(current.targetMarginPct) : 0.42,
      operationsPopulationVersion: OPERATIONS_POPULATION_VERSION, operationsPopulationSource: OPERATIONS_FIXTURE_SOURCE,
      operationsPopulationUpdatedAtISO: nowISO, updatedAtISO: nowISO
    }, { merge: true });
  });
  await settingsRef.set({
    pricingSetupConfirmed: true,
    pricingConfirmation: { actorUid: actor.uid, actorEmail: actor.email, confirmedAtISO: nowISO, confirmedCatalogRevision: catalogRevision },
    pricingConfirmationReason: `Operator-authorized ${OPERATIONS_POPULATION_VERSION} fixture publication`
  }, { merge: true });
  return { offers, addons, rentals, templates, rules, catalogRevision, removedLegacyRecords };
}

function staffRecordDraft(member, projectId, nowISO) {
  const defaults = staffDirectory.defaultStaffRecord({ organizationId: OPERATIONS_ORGANIZATION_ID, staffId: member.id, displayName: member.displayName, capabilities: member.capabilities });
  const fields = ["preferredName", "legalName", "photoUrl", "contact", "roleDetails", "qualifications", "scheduling", "compensation", "travel", "assignmentDefaults", "briefingDefaults", "attendance", "reliability", "privateNotes"];
  const draft = Object.fromEntries(fields.map((key) => [key, structuredClone(defaults[key])]));
  draft.preferredName = member.displayName.split(" ")[0];
  draft.legalName = member.displayName;
  draft.photoUrl = portraitUrl(projectId, member);
  draft.contact = { ...draft.contact, email: `${slug(member.displayName)}@staff.quotepilot.invalid`, phone: "+1 617 555 0100", preferredChannel: "either", emailStatus: "verified", timeZone: "America/New_York", lastVerifiedAtISO: nowISO };
  draft.roleDetails = member.capabilities.slice().sort().map((role, index) => ({ role, proficiency: role === "lead" ? "lead" : member.proficiency, preferred: index === 0, acceptsAssignments: true }));
  draft.qualifications = [{ qualificationId: `rko-${slug(member.qualification)}`, type: member.qualification, number: `SYN-${digest(member.id).slice(0, 8).toUpperCase()}`, provider: "Synthetic training registry", issuedOn: "2026-06-01", expiresOn: "2027-06-01", status: "current", documentUrl: "", notes: "Synthetic fixture qualification; not employment verification." }];
  draft.scheduling = { ...draft.scheduling, preferredHours: "Event-based; evenings and weekends", maxWeeklyHours: 40, maxConsecutiveDays: 5, minRestHours: 10, recurringAvailabilityNote: "Operator-recorded fixture availability covers the seeded event calendar." };
  draft.compensation = { ...draft.compensation, payType: "hourly", hourlyRate: member.hourlyRate, overtimeRate: Math.round(member.hourlyRate * 150) / 100, travelStipend: 20, payrollStatus: "ready" };
  draft.travel = { ...draft.travel, homeBase: member.homeBase, maxDistanceMiles: 45, transportation: "Own transportation", preferredAreas: member.preferredAreas };
  draft.assignmentDefaults = { ...draft.assignmentDefaults, department: member.department, station: member.station, reportingLocation: "Boston Market commissary", arrivalInstructions: "Check in with the event captain before unloading or setup." };
  draft.briefingDefaults = { uniform: "Pressed black hospitality attire and closed-toe black shoes", parking: "Follow the venue-specific BEO brief", entrance: "Use the staff entrance identified in the event brief", mealPolicy: "Team meal scheduled before guest service", responsibilities: `${member.title}; review the current BEO, allergy notes, and run of show before service.` };
  draft.attendance = { ...draft.attendance, completedAssignments: member.completedAssignments, lateArrivals: member.completedAssignments > 100 ? 1 : 0, noShows: 0, cancellations: 1, lastAssignmentAtISO: "2026-08-29T22:00:00.000Z", lastResponse: "accepted", lastRespondedAtISO: "2026-09-08T15:00:00.000Z" };
  draft.reliability = { status: member.reliability, managerRating: member.managerRating, notes: "Synthetic operating-twin performance history." };
  draft.privateNotes = "Synthetic staff fixture. Portrait is generated artwork and does not represent a real employee.";
  return draft;
}

async function prepareStaff({ db, projectId, organizationId, actor, nowISO, apply }) {
  if (!apply) return { planned: REALISTIC_STAFF.length };
  const organizationRef = db.collection("organizations").doc(organizationId);
  for (const member of REALISTIC_STAFF) {
    const requestId = `rko-staff-record-${slug(member.displayName)}-v1`;
    const profileRef = organizationRef.collection("staffProfiles").doc(member.id);
    const recordRef = organizationRef.collection("staffRecords").doc(member.id);
    const profileRequest = { requestId, organizationId, staffId: member.id, expectedRevision: 0, profile: { displayName: member.displayName, active: true, capabilities: member.capabilities, availabilityWindows: [{ availabilityId: `rko-availability-${slug(member.displayName)}`, source: "operator_recorded", state: "available", startAtISO: "2026-09-15T00:00:00.000Z", endAtISO: "2027-05-01T00:00:00.000Z" }] } };
    const recordRequest = { requestId, organizationId, staffId: member.id, expectedRevision: 0, record: staffRecordDraft(member, projectId, nowISO) };
    const profileReceiptId = staffingAuthority.buildOperationalStaffProfileReceiptId(profileRequest);
    const recordReceiptId = staffDirectory.buildStaffRecordReceiptId(recordRequest);
    await db.runTransaction(async (tx) => {
      const [profileSnapshot, recordSnapshot, profileReceiptSnapshot, recordReceiptSnapshot] = await Promise.all([
        tx.get(profileRef), tx.get(recordRef), tx.get(profileRef.collection("versions").doc(profileReceiptId)), tx.get(recordRef.collection("versions").doc(recordReceiptId))
      ]);
      if (profileSnapshot.exists && !profileReceiptSnapshot.exists) throw new OperationsPopulationError(`Staff profile ${member.id} exists without fixture receipt ownership.`);
      if (recordSnapshot.exists && !recordReceiptSnapshot.exists) throw new OperationsPopulationError(`Staff record ${member.id} exists without fixture receipt ownership.`);
      const profilePlan = staffingAuthority.planOperationalStaffProfileCommand({ request: profileRequest, currentProfile: profileSnapshot.exists ? profileSnapshot.data() : null, actor, serverTimeISO: nowISO, existingReceipt: profileReceiptSnapshot.exists ? profileReceiptSnapshot.data()?.receipt : null });
      const recordPlan = staffDirectory.planStaffRecordCommand({ request: recordRequest, currentRecord: recordSnapshot.exists ? recordSnapshot.data() : null, actor, serverTimeISO: nowISO, existingReceipt: recordReceiptSnapshot.exists ? recordReceiptSnapshot.data()?.receipt : null });
      if (profilePlan.kind !== recordPlan.kind) throw new OperationsPopulationError(`Paired staff authorities disagree for ${member.id}.`);
      if (profilePlan.kind === "apply") {
        tx.set(profileRef, { ...profilePlan.nextProfile, fixtureProvenance: { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION } });
        tx.set(recordRef, { ...recordPlan.nextRecord, fixtureProvenance: { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION } });
        tx.create(profileRef.collection("versions").doc(profileReceiptId), { organizationId, staffId: member.id, requestId, receipt: profilePlan.receipt, createdAtISO: nowISO });
        tx.create(recordRef.collection("versions").doc(recordReceiptId), { organizationId, staffId: member.id, requestId, receipt: recordPlan.receipt, createdAtISO: nowISO });
      }
    });
  }
  return { planned: REALISTIC_STAFF.length, hostedPortraits: REALISTIC_STAFF.length };
}

function workflowConfig(kind) {
  const packPolicy = {
    quote_review: { approval: { basis: "absolute_total_delta_cents", thresholdCents: 25000, allowedRoles: ["admin", "sales"] } },
    final_guest_count: { responsibleRoles: ["admin", "sales"] },
    event_execution: { phaseConstraints: { in_progress: { requiredCheckpoints: ["venue_access", "team_briefing"], blockOpenUrgentIssues: true }, completed: { requiredCheckpoints: ["service_handoff", "pack_down"], blockOpenUrgentIssues: true } }, checkpointPrerequisites: { venue_access: [], team_briefing: ["venue_access"], service_handoff: ["team_briefing"], pack_down: ["service_handoff"] } },
    closeout_follow_up: { responsibleRoles: ["admin", "sales"], followUpOffsetDays: 1 }
  }[kind];
  const taskSets = {
    quote_review: [["review_consequence", "Review commercial consequence", "Confirm price, margin, inventory, staffing, and customer-facing changes."]],
    final_guest_count: [["confirm_attendance", "Confirm final attendance", "Compare the customer response with the accepted commercial count."]],
    event_execution: [["review_beo", "Review BEO", "Confirm the current BEO with culinary and service leads."], ["confirm_inventory", "Confirm inventory", "Review shortages, substitutions, and purchasing receipts."], ["brief_team", "Brief event team", "Share the run of show, venue access, allergy, and service notes."]],
    closeout_follow_up: [["review_actuals", "Review event actuals", "Compare recorded labor and purchasing actuals with the accepted plan."], ["schedule_follow_up", "Schedule customer follow-up", "Prepare the approved follow-up through an existing communication surface."]]
  }[kind];
  return {
    schemaVersion: 2, workflowKind: kind,
    name: { quote_review: "Commercial change review", final_guest_count: "Final guest count", event_execution: "Event execution", closeout_follow_up: "Post-event closeout" }[kind],
    allowedRoles: ["admin", "sales"], actualsReviewThresholdCents: kind === "event_execution" ? 50000 : null,
    comparisonPolicy: kind === "event_execution" ? { laborBasisPoints: 750, purchasingBasisPoints: 500, minimumCents: 25000 } : null,
    duePolicy: { offsetMinutes: 0 }, escalationPolicy: { afterMinutes: 240, role: "admin" },
    taskTemplates: taskSets.map(([taskKey, label, instruction], index) => ({ taskKey, label, instruction, ownerRole: index === 0 ? "admin" : "sales", dueOffsetMinutes: index * 60, communicationTemplateRef: kind === "event_execution" && taskKey === "brief_team" ? "internal_event_brief_v1" : null })),
    packPolicy
  };
}

async function prepareWorkflowDefinitions({ db, organizationId, actor, nowISO, apply }) {
  const organizationRef = db.collection("organizations").doc(organizationId);
  const results = new Map();
  for (const [index, kind] of WORKFLOW_KINDS.entries()) {
    const headRef = organizationRef.collection("workflowDefinitions").doc(kind);
    const headSnapshot = await headRef.get();
    let currentHead = null;
    let currentReceipt = null;
    if (headSnapshot.exists) {
      currentHead = headSnapshot.data() || {};
      if (currentHead.lastReceiptId) {
        const receiptSnapshot = await headRef.collection("lifecycleReceipts").doc(currentHead.lastReceiptId).get();
        if (!receiptSnapshot.exists) throw new OperationsPopulationError(`Workflow definition ${kind} has incomplete lifecycle evidence.`);
        currentReceipt = receiptSnapshot.data();
      }
      if (currentHead.activeVersionId) {
        const active = await headRef.collection("versions").doc(currentHead.activeVersionId).get();
        if (!active.exists) throw new OperationsPopulationError(`Workflow definition ${kind} has a missing active tenant version.`);
        results.set(kind, active.data());
        continue;
      }
    }
    const config = workflowConfig(kind);
    workflowDefinitions.validateConfig(config);
    if (!apply) { results.set(kind, { workflowKind: kind, config }); continue; }
    const saveAtISO = new Date(Date.parse(nowISO) + index * 2000).toISOString();
    const startingRevision = currentHead?.revision || 0;
    const saveRequest = { organizationId, workflowKind: kind, requestId: `rko-workflow-${kind}-save-r${startingRevision}-v1`, expectedRevision: startingRevision, command: "save_draft", config };
    const saved = workflowDefinitions.planCommand({ request: saveRequest, actor, head: currentHead, currentReceipt, nowISO: saveAtISO });
    const preview = workflowDefinitions.previewPublish({ organizationId, workflowKind: kind, actor, head: saved.nextHead, currentReceipt: saved.receipt });
    const publishRequest = { organizationId, workflowKind: kind, requestId: `rko-workflow-${kind}-publish-v1`, expectedRevision: saved.nextHead.revision, command: "publish", previewDigest: preview.previewDigest, confirmationText: preview.confirmationText };
    const published = workflowDefinitions.planCommand({ request: publishRequest, actor, head: saved.nextHead, currentReceipt: saved.receipt, nowISO: new Date(Date.parse(saveAtISO) + 1000).toISOString() });
    const batch = db.batch();
    batch.set(headRef, published.nextHead);
    batch.create(headRef.collection("lifecycleReceipts").doc(saved.receipt.receiptId), saved.receipt);
    batch.create(headRef.collection("lifecycleReceipts").doc(published.receipt.receiptId), published.receipt);
    batch.create(headRef.collection("versions").doc(published.publishedVersion.versionId), published.publishedVersion);
    await batch.commit();
    results.set(kind, published.publishedVersion);
  }
  return results;
}

function eventForm(event, offerDocument, settings, eventTypeId) {
  const featuredChoiceId = offerDocument.data.choiceGroups[0].componentIds[0];
  const menuItems = [...offerDocument.data.includedMenuItemIds, featuredChoiceId];
  return {
    name: event.customer, email: `fixture+${slug(event.customer)}@quotepilot.invalid`, phone: "+1 617 555 0199", clientOrg: event.company,
    eventName: event.name, date: event.date, time: event.time, venue: event.venue, venueAddress: event.address,
    guests: event.guests, hours: event.hours, servers: event.staffing.server, chefs: event.staffing.chef, bartenders: event.staffing.bartender,
    dietaryRestrictions: "Review the BEO allergy matrix; vegetarian and gluten-aware alternates are required.", style: event.style,
    pkg: event.offerId, addons: event.addons, rentals: event.rentals, menuItems,
    offerChoiceSelections: { "featured-main": [featuredChoiceId] },
    addonQuantities: Object.fromEntries(event.addons.map((id) => [id, 1])), rentalQuantities: Object.fromEntries(event.rentals.map((id) => [id, 1])),
    menuItemQuantities: Object.fromEntries(menuItems.map((id) => [id, 1])), eventTypeId,
    bartenderRateTypeId: "", staffingRateTypeId: "", eventTemplateId: `rko-template-${event.offerId.replace("rko-offer-", "")}`,
    taxRegion: text(settings.defaultTaxRegion || settings.taxRegions?.[0]?.id), seasonProfileId: "auto", milesRT: 18, includeDisposables: true, payMethod: "ach"
  };
}

async function buildEventDocuments({ db, organizationId, actor, event, offerDocument, settings, eventTypeId, nowISO }) {
  const requestedForm = eventForm(event, offerDocument, settings, eventTypeId);
  const sanitized = quoteCreation.sanitizeQuoteCreationRequest({ organizationId, form: requestedForm });
  const authoritativeForm = { ...sanitized.form, offerChoiceSelections: requestedForm.offerChoiceSelections };
  const pricingResult = await pricing.calculateQuotePricingAuthoritative({ db, data: { organizationId, pricingInput: { organizationId, form: authoritativeForm, metadata: { source: OPERATIONS_FIXTURE_SOURCE, generatedAt: nowISO } } }, staff: actor, organizationsCollection: "organizations", nowISO });
  const portalKey = digest(`${OPERATIONS_POPULATION_VERSION}\u0000portal\u0000${event.id}`);
  const documents = quoteCreation.buildTrustedQuoteCreationDocuments({ quoteId: event.id, quoteNumber: `RKO-${event.date.replaceAll("-", "")}-${event.id.slice(-8).toUpperCase()}`, portalKey, organizationId, staff: actor, form: authoritativeForm, pricing: pricingResult.pricing, pricingCatalogAuthority: pricingResult.catalogAuthority, catalogSource: pricingResult.catalogSource, catalog: pricingResult.catalog, settings: { ...settings, organizationName: actor.organizationName }, nowISO });
  const customerId = `rko-customer-${slug(event.customer)}`;
  const bound = quoteCreation.bindCustomerIdentityToQuoteDocuments(documents, customerId);
  const fixtureProvenance = { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION, synthetic: true, providerEvidence: "not_applicable", customerConsentEvidence: "synthetic_fixture_only" };
  let quote = {
    ...bound.quote,
    selection: { ...bound.quote.selection, offerChoiceSelections: structuredClone(requestedForm.offerChoiceSelections) },
    fixtureProvenance
  };
  let portal = { ...bound.portal, fixtureProvenance };
  let acceptanceReceipt = null;
  if (["accepted", "booked"].includes(event.status)) {
    const revisionId = quoteDelivery.resolveQuoteDeliveryRevisionId(quote, event.id);
    const claimed = quoteDelivery.claimQuoteDelivery({ quote, quoteId: event.id, organizationId, expectedRevisionId: revisionId, actorEmail: actor.email, attemptId: `rko-synthetic-delivery-${event.id}`, attemptProvider: "synthetic_fixture", payloadSha256: digest(event.id), nowISO });
    const success = quoteDelivery.buildQuoteDeliverySuccess({ delivery: claimed.delivery, email: { provider: "synthetic_fixture", messageId: `fixture-${digest(event.id).slice(0, 32)}` }, nowISO, portalKey, portalIssuedAtISO: quote.portalIssuedAtISO });
    quote = { ...quote, status: "sent", workflow: { ...quote.workflow, quoteDelivery: success } };
    portal = quoteCreation.buildCanonicalPortalSnapshot(event.id, quote);
    const acceptedAtISO = new Date(Date.parse(nowISO) + 60_000).toISOString();
    const signed = proposalAcceptance.planProposalAcceptance({ quoteId: event.id, quote, portal, portalKey, signerName: `${event.customer} synthetic fixture`, consentVersion: proposalAcceptance.ACCEPTANCE_CONSENT_VERSION, expectedRevisionId: revisionId, expectedPortalIssuedAtISO: quote.portalIssuedAtISO, acceptedAtISO, receiptId: `rko-acceptance-${event.id}`, message: "Synthetic operating-twin acceptance; no customer action or provider delivery occurred.", actor: { uid: `fixture-${slug(event.customer)}`, email: sanitized.form.email } });
    quote = { ...quote, ...signed.quotePatch, fixtureProvenance };
    portal = { ...portal, ...signed.portalPatch, fixtureProvenance };
    acceptanceReceipt = { ...signed.receiptDocument, fixtureProvenance };
    if (event.status === "booked") {
      const bookedAtISO = new Date(Date.parse(acceptedAtISO) + 60_000).toISOString();
      const booking = planContractConversion({ quoteId: event.id, quote, peerQuotes: [], actorEmail: actor.email, nowISO: bookedAtISO, contractNumber: `RKO-C-${event.date.replaceAll("-", "")}-${event.id.slice(-4).toUpperCase()}`, capacityLimit: 400 });
      quote = { ...quote, ...booking.quotePatch, fixtureProvenance };
      portal = { ...quoteCreation.buildCanonicalPortalSnapshot(event.id, quote), fixtureProvenance };
    }
  }
  const approvalAction = event.status === "accepted" ? "convert_to_contract" : event.status === "booked" && ["rko-event-seaport-gala", "rko-event-cambridge-summit"].includes(event.id) ? "rotate_portal_link" : "";
  if (approvalAction) {
    approval.assertApprovalActionRequestable({ quote, action: approvalAction });
    const built = approval.buildApprovalRequest({ workflow: quote.workflow, action: approvalAction, note: approvalAction === "convert_to_contract" ? "Review event capacity, margin, inventory, and staffing before contract conversion." : "Review the customer portal refresh before sharing a new link.", actorEmail: actor.email, nowISO: new Date(Date.parse(nowISO) + 180_000).toISOString(), requestId: `rko-approval-${event.id}` });
    let approvalRequests = built.approvalRequests;
    if (event.id === "rko-event-cambridge-summit") approvalRequests = approval.buildApprovalResolution({ workflow: { approvalRequests }, requestId: built.request.id, state: "approved", resolutionNote: "Synthetic fixture approval recorded for review-state coverage.", actorEmail: actor.email, nowISO: new Date(Date.parse(nowISO) + 240_000).toISOString() }).approvalRequests;
    quote = { ...quote, workflow: { ...quote.workflow, approvalRequests }, fixtureProvenance };
    portal = { ...quoteCreation.buildCanonicalPortalSnapshot(event.id, quote), fixtureProvenance };
  }
  const version = {
    ...bound.version,
    fixtureProvenance,
    snapshot: {
      ...bound.version.snapshot,
      selection: { ...bound.version.snapshot.selection, offerChoiceSelections: structuredClone(requestedForm.offerChoiceSelections) },
      fixtureProvenance
    }
  };
  const customer = { customerId, organizationId, name: event.customer, nameKey: event.customer.toLowerCase(), email: sanitized.form.email, emailKey: sanitized.form.email, phone: sanitized.form.phone, company: event.company, createdAtISO: nowISO, updatedAtISO: nowISO, lastQuoteId: event.id, lastQuoteNumber: quote.quoteNumber, lastEventName: event.name, lastEventDate: event.date, fixtureProvenance };
  const emailClaim = quoteCreation.buildCustomerEmailClaim({ organizationId, customerId, customerEmail: sanitized.form.email, nowISO, claimSource: OPERATIONS_FIXTURE_SOURCE });
  return { quote, portal, version, customer, customerId, emailClaim, acceptanceReceipt };
}

async function prepareEvents({ db, organizationId, actor, nowISO, settings, catalogPlan, apply }) {
  const organizationRef = db.collection("organizations").doc(organizationId);
  const eventTypeSnapshot = await organizationRef.collection("eventTypes").limit(20).get();
  const eventTypeId = eventTypeSnapshot.docs.find((document) => document.data()?.active !== false && document.data()?.enabled !== false)?.id;
  const offerDocumentById = new Map(catalogPlan.offers.map((entry) => [entry.id, entry]));
  let created = 0;
  for (const [index, event] of REALISTIC_EVENTS.entries()) {
    const quoteRef = organizationRef.collection("quotes").doc(event.id);
    const existing = await quoteRef.get();
    if (existing.exists) {
      if (!fixture(existing.data() || {})) throw new OperationsPopulationError(`Refusing to overwrite non-fixture quote ${event.id}.`);
      continue;
    }
    if (!apply) { created += 1; continue; }
    const documents = await buildEventDocuments({ db, organizationId, actor, event, offerDocument: offerDocumentById.get(event.offerId), settings, eventTypeId, nowISO: new Date(Date.parse(nowISO) + (index + 1) * 10 * 60_000).toISOString() });
    const batch = db.batch();
    batch.create(quoteRef, documents.quote);
    batch.create(quoteRef.collection("versions").doc(documents.version.versionId), documents.version);
    batch.create(db.collection("customerPortalQuotes").doc(documents.quote.portalKey), documents.portal);
    batch.set(organizationRef.collection("customers").doc(documents.customerId), documents.customer, { merge: true });
    batch.set(organizationRef.collection("customerEmailClaims").doc(quoteCreation.customerEmailClaimDocumentId(documents.customer.email)), documents.emailClaim, { merge: true });
    if (documents.acceptanceReceipt) batch.create(organizationRef.collection("proposalAcceptanceReceipts").doc(documents.acceptanceReceipt.receiptId), documents.acceptanceReceipt);
    await batch.commit();
    created += 1;
  }
  return { planned: REALISTIC_EVENTS.length, created };
}

function uniqueAssignments(event, eventIndex) {
  const used = new Set();
  const assignments = [];
  for (const role of ["bartender", "chef", "server"]) {
    const count = event.staffing[role];
    const candidates = REALISTIC_STAFF.filter((member) => member.capabilities.includes(role));
    for (let index = 0; index < count; index += 1) {
      const member = [...candidates.slice(eventIndex % candidates.length), ...candidates.slice(0, eventIndex % candidates.length)].find((candidate) => !used.has(candidate.id));
      if (!member) throw new OperationsPopulationError(`The fixture has insufficient unique ${role} staff for ${event.id}.`);
      used.add(member.id);
      assignments.push({ assignmentId: `${event.id}-${role}-${index + 1}`, staffId: member.id, role, expectedStaffRevision: 1 });
    }
  }
  return assignments;
}

async function prepareStaffingPlans({ db, organizationId, actor, nowISO, apply }) {
  const plannedEvents = REALISTIC_EVENTS.filter((event) => event.status !== "draft");
  if (!apply) return { planned: plannedEvents.length };
  const organizationRef = db.collection("organizations").doc(organizationId);
  const settings = (await organizationRef.collection("settings").doc("config").get()).data() || {};
  let created = 0;
  for (const [eventIndex, event] of plannedEvents.entries()) {
    const quoteRef = organizationRef.collection("quotes").doc(event.id);
    const quoteSnapshot = await quoteRef.get();
    const quote = { id: quoteSnapshot.id, ...(quoteSnapshot.data() || {}) };
    const versionSnapshot = await quoteRef.collection("versions").doc(quote.activeVersionId).get();
    if (!versionSnapshot.exists) throw new OperationsPopulationError(`Staffing source version ${quote.activeVersionId || "(missing)"} is unavailable for ${event.id}.`);
    const evidence = staffingRuntime.deriveCanonicalOperationalStaffingEvidence({ organizationId, quoteId: event.id, activeQuoteRevisionId: quote.activeVersionId, version: versionSnapshot.data(), settings });
    const assignments = uniqueAssignments(event, eventIndex);
    const fenceRefs = staffingAuthority.deriveOperationalStaffingScheduleFenceRefs({ organizationId, eventWindow: evidence.canonicalEventWindow, assignments });
    const request = { requestId: `rko-staffing-plan-${event.id}-v1`, organizationId, quoteId: event.id, expectedQuoteRevisionId: quote.activeVersionId, expectedPlanRevision: 0, eventWindow: evidence.canonicalEventWindow, requirements: evidence.canonicalRequirements, assignments, expectedScheduleFences: fenceRefs.map((ref) => ({ fenceId: ref.fenceId, revision: 0 })) };
    const receiptId = staffingAuthority.buildOperationalStaffingReceiptId(request);
    const planRef = organizationRef.collection("staffingPlans").doc(event.id);
    const receiptRef = planRef.collection("versions").doc(receiptId);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(receiptRef)).exists) return;
      if ((await tx.get(planRef)).exists) throw new OperationsPopulationError(`Staffing plan ${event.id} exists without fixture receipt ownership.`);
      const profileRefs = assignments.map((entry) => organizationRef.collection("staffProfiles").doc(entry.staffId));
      const fenceDocRefs = fenceRefs.map((ref) => organizationRef.collection("staffingScheduleFences").doc(ref.fenceId));
      const profileSnapshots = await tx.getAll(...profileRefs);
      const fenceSnapshots = await tx.getAll(...fenceDocRefs);
      const fences = fenceRefs.map((ref, index) => fenceSnapshots[index].exists ? fenceSnapshots[index].data() : { schemaVersion: 1, organizationId, fenceId: ref.fenceId, staffId: ref.staffId, utcDate: ref.utcDate, revision: 0, assignments: [], assignmentsTruncated: false });
      const planned = staffingAuthority.planOperationalStaffingCommand({ request, activeQuoteRevisionId: evidence.activeQuoteRevisionId, canonicalEventWindow: evidence.canonicalEventWindow, canonicalRequirements: evidence.canonicalRequirements, currentPlan: null, staffProfiles: profileSnapshots.map((snapshot) => snapshot.data()), overlappingAssignments: [], scheduleFences: fences, evidenceBounds: { staffProfilesTruncated: false, overlapAssignmentsTruncated: false, scheduleFencesTruncated: false }, actor, serverTimeISO: new Date(Date.parse(nowISO) + (eventIndex + 1) * 600_000 + 300_000).toISOString() });
      tx.create(planRef, { ...planned.nextPlan, fixtureProvenance: { source: OPERATIONS_FIXTURE_SOURCE, version: OPERATIONS_POPULATION_VERSION } });
      tx.create(receiptRef, { organizationId, quoteId: event.id, requestId: planned.request.requestId, receipt: planned.receipt, createdAtISO: planned.receipt.recordedAtISO });
      planned.scheduleFenceOutputs.forEach((output) => tx.set(organizationRef.collection("staffingScheduleFences").doc(output.fenceId), output.nextProjection));
      created += 1;
    });
  }
  return { planned: plannedEvents.length, created };
}

async function prepareEventWorkflows({ db, organizationId, actor, nowISO, definitions, apply }) {
  const booked = REALISTIC_EVENTS.filter((event) => event.status === "booked");
  if (!apply) return { planned: booked.length };
  const organizationRef = db.collection("organizations").doc(organizationId);
  let created = 0;
  for (const [index, event] of booked.entries()) {
    const quote = (await organizationRef.collection("quotes").doc(event.id).get()).data() || {};
    const source = { organizationId, quoteId: event.id, sourceVersionId: quote.activeVersionId, acceptanceReceiptId: quote.acceptanceReceipt?.receiptId };
    const ledgerRef = organizationRef.collection("eventOperatingLedgers").doc(eventOperations.ledgerIdFor(source));
    if ((await ledgerRef.get()).exists) continue;
    const request = { ...source, requestId: `rko-event-phase-${event.id}-initialize-v1`, command: "initialize", expectedLedgerRevision: 0, targetPhase: "prepared" };
    const eventAtISO = new Date(Date.parse(nowISO) + (index + 1) * 12 * 60_000).toISOString();
    const phasePlan = eventOperations.planCommand({ request, actor, source, nowISO: eventAtISO });
    const observation = workflowAdapters.eventObservation({ source, ledger: phasePlan.nextLedger, receipt: phasePlan.receipt });
    const workflowPlan = workflowAdapters.planObservation({ ...observation, definition: definitions.get("event_execution"), actor, requestId: `rko-workflow-instance-${event.id}-v1`, nowISO: new Date(Date.parse(eventAtISO) + 1000).toISOString() });
    const workflowRef = organizationRef.collection("workflowInstances").doc(workflowPlan.nextInstance.instanceId);
    const batch = db.batch();
    batch.create(ledgerRef, phasePlan.nextLedger);
    batch.create(ledgerRef.collection("receipts").doc(phasePlan.receipt.receiptId), phasePlan.receipt);
    batch.create(workflowRef, workflowPlan.nextInstance);
    batch.create(workflowRef.collection("receipts").doc(workflowPlan.receipt.receiptId), workflowPlan.receipt);
    await batch.commit();
    created += 1;
  }
  return { planned: booked.length, created };
}

async function readBack(db, organizationId) {
  const organizationRef = db.collection("organizations").doc(organizationId);
  const names = ["menuItems", "catalogPackages", "catalogAddons", "catalogRentals", "customers", "quotes", "staffProfiles", "staffRecords", "staffingPlans", "workflowDefinitions", "workflowInstances", "eventOperatingLedgers"];
  const snapshots = await Promise.all(names.map((name) => organizationRef.collection(name).get()));
  const settings = (await organizationRef.collection("settings").doc("config").get()).data() || {};
  return Object.fromEntries([...names.map((name, index) => [name, snapshots[index].size]), ["pricingSetupConfirmed", pricing.isCatalogPricingConfirmationCurrent(settings)], ["inventoryAuthorityEnabled", settings.inventoryAuthorityEnabled === true], ["operationalStaffingAuthorityEnabled", settings.operationalStaffingAuthorityEnabled === true], ["catalogRevision", settings.catalogRevision]]);
}

async function run() {
  const options = parseOperationsPopulationArgs();
  assertPortraitAssets();
  const admin = loadFirebaseAdmin();
  if (!admin.getApps().length) admin.initializeApp({ projectId: options.projectId });
  const db = admin.getFirestore();
  const actor = await resolveActor({ db, auth: admin.getAuth(), organizationId: options.organizationId });
  const nowISO = new Date().toISOString();
  const before = await readBack(db, options.organizationId);
  const catalogPlan = await prepareCatalog({ db, organizationId: options.organizationId, actor, nowISO, apply: options.apply });
  const definitions = await prepareWorkflowDefinitions({ db, organizationId: options.organizationId, actor, nowISO, apply: options.apply });
  const staff = await prepareStaff({ db, projectId: options.projectId, organizationId: options.organizationId, actor, nowISO, apply: options.apply });
  const settings = options.apply ? (await db.collection("organizations").doc(options.organizationId).collection("settings").doc("config").get()).data() : catalogPlan.settings;
  const events = await prepareEvents({ db, organizationId: options.organizationId, actor, nowISO, settings: settings || {}, catalogPlan, apply: options.apply });
  const staffing = await prepareStaffingPlans({ db, organizationId: options.organizationId, actor, nowISO, apply: options.apply });
  const workflows = await prepareEventWorkflows({ db, organizationId: options.organizationId, actor, nowISO, definitions, apply: options.apply });
  const after = options.apply ? await readBack(db, options.organizationId) : before;
  console.log(JSON.stringify({
    mode: options.apply ? "apply" : "dry-run", projectId: options.projectId, organizationId: options.organizationId,
    population: operationsPopulationSummary(), plan: { catalog: { offers: catalogPlan.offers.length, addons: catalogPlan.addons.length, rentals: catalogPlan.rentals.length, templates: catalogPlan.templates.length, rules: catalogPlan.rules.length }, staff, events, staffing, workflows, portraits: REALISTIC_STAFF.length }, before, after,
    evidenceBoundary: "All fixture acceptances, approvals, qualifications, performance history, and provider-delivery fields are synthetic operating-twin data; they are not customer, employee, provider, or settlement proof."
  }, null, 2));
  if (!options.apply) console.log(`\nApply requires --confirm \"${options.expectedConfirmation}\".`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(`${error.name || "Error"}: ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  });
}
