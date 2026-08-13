import { canonicalSerialize, sha256CanonicalValue } from "./commercialDependencyGraph";
import { PILOT_BOUNDED_SCENARIO_MODEL } from "./pilotBoundedScenarios";

export const PILOT_SCENARIO_DRAFT_REVIEW_MODEL =
  "pilot-scenario-draft-review-v1";

export const PILOT_SCENARIO_DRAFT_PATCH_FIELDS = Object.freeze([
  "addonQuantities",
  "addons",
  "bartenders",
  "chefs",
  "eventTemplateId",
  "menuItemQuantities",
  "menuItems",
  "pkg",
  "rentalQuantities",
  "rentals",
  "servers"
]);

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CURRENT_CATALOG_SOURCES = new Set(["firebase-org", "local-cache"]);
const SUPPORTED_DIMENSIONS = Object.freeze([
  "package",
  "event_template",
  "addons",
  "rentals",
  "menu",
  "staffing"
]);
const FIELD_DIMENSIONS = Object.freeze({
  pkg: "package",
  eventTemplateId: "event_template",
  addons: "addons",
  addonQuantities: "addons",
  rentals: "rentals",
  rentalQuantities: "rentals",
  menuItems: "menu",
  menuItemQuantities: "menu",
  servers: "staffing",
  chefs: "staffing",
  bartenders: "staffing"
});
const COMPLETE_FIELD_GROUPS = Object.freeze({
  addons: Object.freeze(["addons", "addonQuantities"]),
  rentals: Object.freeze(["rentals", "rentalQuantities"]),
  menu: Object.freeze(["menuItems", "menuItemQuantities"]),
  staffing: Object.freeze(["servers", "chefs", "bartenders"])
});
const PROPOSAL_KEYS = Object.freeze([
  "id",
  "modelId",
  "kind",
  "commandClass",
  "authorityLevel",
  "state",
  "title",
  "summary",
  "patch",
  "changedFields",
  "lockedScope",
  "compromises",
  "clientPreview",
  "marginEvidence",
  "why",
  "consequence",
  "doNothing",
  "confidence",
  "provenance",
  "unavailableReasons",
  "adoption",
  "boundary"
]);
const REVIEW_KEYS = Object.freeze([
  "modelId",
  "reviewId",
  "kind",
  "state",
  "commandClass",
  "authorityLevel",
  "organizationScope",
  "catalogScope",
  "proposalIdentity",
  "sourceSnapshot",
  "changedFields",
  "dimensions",
  "patch",
  "changes",
  "title",
  "summary",
  "compromises",
  "clientPreview",
  "marginEvidence",
  "judgment",
  "adoption",
  "boundary"
]);
const MAX_PATCH_FIELDS = PILOT_SCENARIO_DRAFT_PATCH_FIELDS.length;
const MAX_SELECTIONS = 100;
const MAX_QUANTITY = 10_000;
const MAX_CATALOG_RECORDS = 500;
const MAX_MENU_SECTIONS = 100;
const MAX_CANONICAL_BYTES = 1_500_000;
const BOUNDARY =
  "This review can stage only the exact bounded patch into an isolated editor draft. It does not save, reprice authoritatively, version a quote, publish a proposal, communicate, book, collect payment, or change provider state.";

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const names = Object.getOwnPropertyNames(value);
  if (
    Object.getOwnPropertySymbols(value).length
    || names.length !== expected.length
    || Reflect.ownKeys(value).length !== names.length
  ) return false;
  return [...names].sort().every((key, index) => key === [...expected].sort()[index]);
}

function safeText(value, maximum = 1_000) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximum
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function safeId(value) {
  return safeText(value, 180) && !/[/?#\\]/u.test(value);
}

function exactIso(value) {
  if (!safeText(value, 64)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function exactList(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function isDeeplyFrozenJson(value, ancestors = new Set()) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) return true;
  if (!value || typeof value !== "object" || !Object.isFrozen(value)) return false;
  if (!Array.isArray(value) && !isRecord(value)) return false;
  if (ancestors.has(value) || Object.getOwnPropertySymbols(value).length) return false;
  const names = Object.getOwnPropertyNames(value);
  if (Array.isArray(value)) {
    if (names.some((name) => name !== "length" && !/^\d+$/u.test(name))) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
    }
  } else if (names.some((name) => FORBIDDEN_KEYS.has(name))) {
    return false;
  }
  ancestors.add(value);
  try {
    return names.every((name) => {
      if (name === "length" && Array.isArray(value)) return true;
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      return Boolean(
        descriptor?.enumerable
        && "value" in descriptor
        && isDeeplyFrozenJson(descriptor.value, ancestors)
      );
    });
  } finally {
    ancestors.delete(value);
  }
}

function cloneBoundedJson(value, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 25_000 || depth > 16) {
    throw new TypeError("The review evidence exceeds its safe structural bound.");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Review evidence numbers must be finite.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    if (value.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      throw new TypeError("Review evidence contains unsupported text.");
    }
    return value;
  }
  if (!value || typeof value !== "object") {
    throw new TypeError("Review evidence must contain only JSON-safe values.");
  }
  if (!Array.isArray(value) && !isRecord(value)) {
    throw new TypeError("Review evidence contains an unsupported object type.");
  }
  const names = Object.getOwnPropertyNames(value);
  if (Object.getOwnPropertySymbols(value).length || names.some((name) => FORBIDDEN_KEYS.has(name))) {
    throw new TypeError("Review evidence contains an unsafe property.");
  }
  if (Array.isArray(value)) {
    if (value.length > 2_000) throw new TypeError("Review evidence contains an oversized list.");
    const allowedNames = new Set(["length"]);
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      const name = String(index);
      allowedNames.add(name);
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("Review evidence contains a sparse or accessor list.");
      }
      output.push(cloneBoundedJson(descriptor.value, state, depth + 1));
    }
    if (names.some((name) => !allowedNames.has(name))) {
      throw new TypeError("Review evidence contains a decorated list.");
    }
    return output;
  }
  if (names.length > 1_000) throw new TypeError("Review evidence contains an oversized record.");
  const output = {};
  names.sort().forEach((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError("Review evidence contains an accessor or hidden property.");
    }
    output[name] = cloneBoundedJson(descriptor.value, state, depth + 1);
  });
  return output;
}

function canonicalBytes(value) {
  const canonical = canonicalSerialize(value);
  if (canonical.length > MAX_CANONICAL_BYTES) {
    throw new TypeError("The review evidence exceeds its canonical byte bound.");
  }
  return canonical;
}

async function fingerprint(value, cryptoApi) {
  canonicalBytes(value);
  return sha256CanonicalValue(value, { cryptoApi });
}

function immutable(value) {
  return deepFreeze(value);
}

function catalogScope(organizationId, evidence) {
  if (!safeId(organizationId)) {
    return { ok: false, reason: "The active organization scope is unavailable." };
  }
  if (!isRecord(evidence) || evidence.organizationId !== organizationId) {
    return { ok: false, reason: "The catalog evidence does not match the active organization." };
  }
  const sourceLabel = evidence.sourceLabel;
  const catalogRevision = evidence.catalogRevision;
  const freshness = evidence.freshness;
  const observedAt = isRecord(freshness)
    ? freshness.observedAtISO || freshness.observedAt
    : "";
  if (
    !CURRENT_CATALOG_SOURCES.has(sourceLabel)
    || !Number.isSafeInteger(catalogRevision)
    || catalogRevision < 0
    || !isRecord(freshness)
    || freshness.state !== "fresh"
    || !exactIso(observedAt)
  ) {
    return { ok: false, reason: "A fresh exact-revision catalog observation is required." };
  }
  return {
    ok: true,
    value: {
      organizationId,
      sourceLabel,
      catalogRevision,
      observedAt,
      freshness: "fresh"
    }
  };
}

function catalogProjection(scope, evidence) {
  const collections = ["packages", "addons", "rentals", "menuSections", "upsellRules"];
  if (
    !Array.isArray(evidence.packages)
    || !Array.isArray(evidence.addons)
    || !Array.isArray(evidence.rentals)
    || !Array.isArray(evidence.menuSections)
    || !Array.isArray(evidence.upsellRules)
    || evidence.packages.length > MAX_CATALOG_RECORDS
    || evidence.addons.length > MAX_CATALOG_RECORDS
    || evidence.rentals.length > MAX_CATALOG_RECORDS
    || evidence.menuSections.length > MAX_MENU_SECTIONS
    || evidence.upsellRules.length > MAX_CATALOG_RECORDS
  ) throw new TypeError("The catalog evidence is incomplete or outside the review bound.");
  return cloneBoundedJson({
    scope,
    ...Object.fromEntries(collections.map((name) => [name, evidence[name]]))
  });
}

function normalizedActiveCatalogSets(evidence) {
  const build = (records) => {
    const ids = new Set();
    for (const record of records) {
      if (!isRecord(record) || !safeId(record.id) || ids.has(record.id)) return null;
      if (record.active !== false) ids.add(record.id);
    }
    return ids;
  };
  const packages = build(evidence.packages);
  const addons = build(evidence.addons);
  const rentals = build(evidence.rentals);
  const menuRecords = [];
  for (const section of evidence.menuSections) {
    if (!isRecord(section) || !Array.isArray(section.items)) return null;
    menuRecords.push(...section.items);
    if (menuRecords.length > 10_000) return null;
  }
  const menu = build(menuRecords);
  return packages && addons && rentals && menu
    ? { packages, addons, rentals, menu }
    : null;
}

function strictIdList(value) {
  return Array.isArray(value)
    && value.length <= MAX_SELECTIONS
    && value.every((entry) => safeId(entry))
    && new Set(value).size === value.length;
}

function strictQuantityMap(value, selected) {
  if (!isRecord(value)) return false;
  const names = Object.getOwnPropertyNames(value);
  return names.length <= MAX_SELECTIONS
    && !Object.getOwnPropertySymbols(value).length
    && names.every((name) => (
      safeId(name)
      && selected.includes(name)
      && Number.isSafeInteger(value[name])
      && value[name] >= 1
      && value[name] <= MAX_QUANTITY
    ));
}

function validatePatch(patch, changedFields, lockedScope, evidence) {
  if (!isRecord(patch)) return { ok: false, reason: "The scenario patch is not a plain record." };
  const fields = Object.getOwnPropertyNames(patch).sort();
  if (
    !fields.length
    || fields.length > MAX_PATCH_FIELDS
    || Object.getOwnPropertySymbols(patch).length
    || fields.some((field) => !PILOT_SCENARIO_DRAFT_PATCH_FIELDS.includes(field))
  ) {
    return { ok: false, reason: "The scenario patch is empty or contains a non-draft field." };
  }
  if (!exactList(changedFields, fields)) {
    return { ok: false, reason: "The scenario changed-field declaration does not exactly match its patch." };
  }
  const dimensions = [...new Set(fields.map((field) => FIELD_DIMENSIONS[field]))].sort();
  for (const [dimension, requiredFields] of Object.entries(COMPLETE_FIELD_GROUPS)) {
    if (
      dimensions.includes(dimension)
      && !requiredFields.every((field) => fields.includes(field))
    ) {
      return { ok: false, reason: `The ${dimension} patch is not an exact complete draft field group.` };
    }
  }
  if (
    fields.includes("eventTemplateId")
    && (!fields.includes("pkg") || patch.eventTemplateId !== "custom")
  ) {
    return { ok: false, reason: "Template ownership may change only to custom with an exact package replacement." };
  }
  if (
    fields.includes("pkg") && !safeId(patch.pkg)
    || fields.includes("addons") && !strictIdList(patch.addons)
    || fields.includes("rentals") && !strictIdList(patch.rentals)
    || fields.includes("menuItems") && !strictIdList(patch.menuItems)
    || fields.includes("addonQuantities") && !strictQuantityMap(patch.addonQuantities, patch.addons)
    || fields.includes("rentalQuantities") && !strictQuantityMap(patch.rentalQuantities, patch.rentals)
    || fields.includes("menuItemQuantities") && !strictQuantityMap(patch.menuItemQuantities, patch.menuItems)
    || ["servers", "chefs", "bartenders"].some((field) => fields.includes(field)
      && (!Number.isSafeInteger(patch[field]) || patch[field] < 0 || patch[field] > 100))
  ) {
    return { ok: false, reason: "The scenario patch contains an invalid or unbounded draft value." };
  }
  const locked = new Set(lockedScope);
  if (dimensions.some((dimension) => locked.has(dimension))) {
    return { ok: false, reason: "The scenario patch changes a caller-locked dimension." };
  }
  const active = normalizedActiveCatalogSets(evidence);
  if (!active) return { ok: false, reason: "The catalog inventory is ambiguous or invalid." };
  if (
    fields.includes("pkg") && !active.packages.has(patch.pkg)
    || fields.includes("addons") && patch.addons.some((id) => !active.addons.has(id))
    || fields.includes("rentals") && patch.rentals.some((id) => !active.rentals.has(id))
    || fields.includes("menuItems") && patch.menuItems.some((id) => !active.menu.has(id))
  ) {
    return { ok: false, reason: "The scenario patch references an inactive or absent catalog record." };
  }
  return { ok: true, fields, dimensions };
}

function validateProposal(proposal, scope, evidence) {
  if (!isDeeplyFrozenJson(proposal)) {
    return { ok: false, reason: "The scenario proposal is not deeply frozen JSON evidence." };
  }
  if (!exactKeys(proposal, PROPOSAL_KEYS)) {
    return { ok: false, reason: "The scenario proposal does not match the exact v1 envelope shape." };
  }
  if (
    proposal.modelId !== PILOT_BOUNDED_SCENARIO_MODEL
    || proposal.kind !== "simulation_proposal"
    || proposal.commandClass !== "simulation"
    || proposal.authorityLevel !== "draft"
    || proposal.state !== "available"
    || !safeId(proposal.id)
    || !safeText(proposal.title, 240)
    || !safeText(proposal.summary, 600)
    || !safeText(proposal.why, 1_200)
    || !safeText(proposal.consequence, 1_500)
    || !safeText(proposal.doNothing, 1_200)
    || !safeText(proposal.boundary, 1_500)
  ) {
    return { ok: false, reason: "The scenario is not one available draft-authority simulation proposal." };
  }
  if (
    !exactKeys(proposal.adoption, [
      "required",
      "outcomeLabel",
      "allowedAfterExplicitConfirmation",
      "boundary"
    ])
    || proposal.adoption.required !== true
    || proposal.adoption.allowedAfterExplicitConfirmation !== true
    || proposal.adoption.outcomeLabel !== "Adopt in draft review"
    || !safeText(proposal.adoption.boundary, 1_500)
  ) {
    return { ok: false, reason: "The scenario does not require an allowed explicit draft adoption." };
  }
  if (
    !Array.isArray(proposal.changedFields)
    || !Array.isArray(proposal.lockedScope)
    || !exactList(proposal.lockedScope, [...proposal.lockedScope].sort())
    || new Set(proposal.lockedScope).size !== proposal.lockedScope.length
    || proposal.lockedScope.some((entry) => !SUPPORTED_DIMENSIONS.includes(entry))
  ) {
    return { ok: false, reason: "The scenario lock declaration is invalid or ambiguous." };
  }
  const patchValidation = validatePatch(
    proposal.patch,
    proposal.changedFields,
    proposal.lockedScope,
    evidence
  );
  if (!patchValidation.ok) return patchValidation;
  if (
    !Array.isArray(proposal.compromises)
    || !proposal.compromises.length
    || proposal.compromises.length > SUPPORTED_DIMENSIONS.length
  ) {
    return { ok: false, reason: "The scenario must expose every bounded compromise." };
  }
  const compromiseDimensions = [];
  for (const compromise of proposal.compromises) {
    if (
      !exactKeys(compromise, ["dimension", "label", "before", "after", "why"])
      || !patchValidation.dimensions.includes(compromise.dimension)
      || !safeText(compromise.label, 240)
      || !safeText(compromise.before, 500)
      || !safeText(compromise.after, 500)
      || !safeText(compromise.why, 1_000)
    ) {
      return { ok: false, reason: "A scenario compromise is missing exact before, after, or reasoning evidence." };
    }
    compromiseDimensions.push(compromise.dimension);
  }
  if (
    new Set(compromiseDimensions).size !== compromiseDimensions.length
    || !exactList([...compromiseDimensions].sort(), patchValidation.dimensions)
  ) {
    return { ok: false, reason: "Scenario compromises do not exactly cover the changed dimensions." };
  }
  if (
    !exactKeys(proposal.confidence, ["level", "basis"])
    || !["low", "medium", "high"].includes(proposal.confidence.level)
    || !safeText(proposal.confidence.basis, 1_500)
    || !Array.isArray(proposal.provenance)
    || !proposal.provenance.length
    || proposal.provenance.length > 8
  ) {
    return { ok: false, reason: "The scenario confidence or provenance contract is incomplete." };
  }
  const catalogProvenance = proposal.provenance.find((entry) => (
    isRecord(entry)
    && entry.catalogRevision === scope.catalogRevision
    && entry.freshness === "fresh"
    && entry.observedAtISO === scope.observedAt
  ));
  if (!catalogProvenance) {
    return { ok: false, reason: "The scenario does not bind its claim to the exact current catalog observation." };
  }
  try {
    const clone = cloneBoundedJson(proposal);
    canonicalBytes(clone);
    return {
      ok: true,
      proposal: clone,
      patch: cloneBoundedJson(proposal.patch),
      fields: patchValidation.fields,
      dimensions: patchValidation.dimensions
    };
  } catch (error) {
    return { ok: false, reason: error?.message || "The scenario evidence could not be isolated." };
  }
}

function sourceFieldSnapshot(form, field) {
  const descriptor = Object.getOwnPropertyDescriptor(form, field);
  if (!descriptor) return { field, present: false, encoding: "missing", value: null };
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw new TypeError(`The current ${field} draft field is not a plain data property.`);
  }
  if (descriptor.value === undefined) {
    return { field, present: true, encoding: "undefined", value: null };
  }
  return {
    field,
    present: true,
    encoding: "json",
    value: cloneBoundedJson(descriptor.value)
  };
}

function snapshotMatches(snapshot, form) {
  try {
    return canonicalSerialize(snapshot) === canonicalSerialize(sourceFieldSnapshot(form, snapshot.field));
  } catch {
    return false;
  }
}

function proposalIdentityProjection(proposal) {
  return cloneBoundedJson(proposal);
}

function recovery({ code, reason, form = null, state = "not_applied" }) {
  return immutable({
    ok: false,
    form,
    dirtyFields: [],
    review: null,
    acknowledgement: {
      kind: "recovery",
      state,
      code,
      reason,
      consequence: "The editor draft was not changed, saved, repriced, sent, or published.",
      nextResolutions: [
        "Keep the current draft.",
        "Refresh the opportunity and create a new scenario from current evidence."
      ]
    }
  });
}

function safeFormClone(form) {
  if (!isRecord(form)) throw new TypeError("The current editor draft is not a plain record.");
  return cloneBoundedJson(form);
}

function exactReviewContract(review) {
  return isDeeplyFrozenJson(review)
    && exactKeys(review, REVIEW_KEYS)
    && review.modelId === PILOT_SCENARIO_DRAFT_REVIEW_MODEL
    && review.kind === "pilot_scenario_draft_review"
    && review.state === "pending_review"
    && review.commandClass === "simulation"
    && review.authorityLevel === "draft"
    && safeId(review.reviewId)
    && exactKeys(review.organizationScope, ["organizationId"])
    && exactKeys(review.catalogScope, [
      "sourceLabel",
      "catalogRevision",
      "observedAt",
      "freshness",
      "fingerprint"
    ])
    && /^[a-f0-9]{64}$/u.test(review.catalogScope.fingerprint)
    && exactKeys(review.proposalIdentity, ["modelId", "proposalId", "fingerprint"])
    && /^[a-f0-9]{64}$/u.test(review.proposalIdentity.fingerprint)
    && exactKeys(review.sourceSnapshot, ["modelId", "fields", "fingerprint"])
    && review.sourceSnapshot.modelId === "pilot-scenario-source-snapshot-v1"
    && Array.isArray(review.sourceSnapshot.fields)
    && /^[a-f0-9]{64}$/u.test(review.sourceSnapshot.fingerprint)
    && exactKeys(review.adoption, [
      "required",
      "allowedAfterExplicitConfirmation",
      "applyLabel",
      "keepLabel",
      "boundary"
    ])
    && review.adoption.required === true
    && review.adoption.allowedAfterExplicitConfirmation === true
    && review.adoption.applyLabel === "Apply scenario to draft"
    && review.adoption.keepLabel === "Keep current draft";
}

export async function createPilotScenarioDraftReview({
  proposal = null,
  organizationId = "",
  catalogEvidence = null,
  form = null,
  cryptoApi = globalThis.crypto
} = {}) {
  let currentForm;
  try {
    currentForm = safeFormClone(form);
  } catch (error) {
    return recovery({
      code: "pilot_scenario_review_form_invalid",
      reason: error?.message || "The current editor draft could not be safely isolated.",
      state: "not_created"
    });
  }
  const scope = catalogScope(organizationId, catalogEvidence);
  if (!scope.ok) {
    return recovery({
      code: "pilot_scenario_review_catalog_unavailable",
      reason: scope.reason,
      form: currentForm,
      state: "not_created"
    });
  }
  const validated = validateProposal(proposal, scope.value, catalogEvidence);
  if (!validated.ok) {
    return recovery({
      code: "pilot_scenario_review_proposal_invalid",
      reason: validated.reason,
      form: currentForm,
      state: "not_created"
    });
  }

  try {
    const fields = validated.fields.map((field) => sourceFieldSnapshot(form, field));
    const sourceProjection = {
      modelId: "pilot-scenario-source-snapshot-v1",
      fields
    };
    const hasChange = fields.some((entry, index) => canonicalSerialize({
      present: entry.present,
      encoding: entry.encoding,
      value: entry.value
    }) !== canonicalSerialize({
      present: true,
      encoding: "json",
      value: validated.patch[validated.fields[index]]
    }));
    if (!hasChange) {
      return recovery({
        code: "pilot_scenario_review_no_change",
        reason: "The scenario patch does not change any current draft field.",
        form: currentForm,
        state: "not_created"
      });
    }
    const catalog = catalogProjection(scope.value, catalogEvidence);
    const proposalProjection = proposalIdentityProjection(proposal);
    const [catalogFingerprint, proposalFingerprint, sourceFingerprint] = await Promise.all([
      fingerprint(catalog, cryptoApi),
      fingerprint(proposalProjection, cryptoApi),
      fingerprint(sourceProjection, cryptoApi)
    ]);
    const review = immutable({
      modelId: PILOT_SCENARIO_DRAFT_REVIEW_MODEL,
      reviewId: `pilot-scenario-review:${proposal.id}:${proposalFingerprint.slice(0, 16)}`,
      kind: "pilot_scenario_draft_review",
      state: "pending_review",
      commandClass: "simulation",
      authorityLevel: "draft",
      organizationScope: { organizationId },
      catalogScope: {
        sourceLabel: scope.value.sourceLabel,
        catalogRevision: scope.value.catalogRevision,
        observedAt: scope.value.observedAt,
        freshness: "fresh",
        fingerprint: catalogFingerprint
      },
      proposalIdentity: {
        modelId: PILOT_BOUNDED_SCENARIO_MODEL,
        proposalId: proposal.id,
        fingerprint: proposalFingerprint
      },
      sourceSnapshot: {
        ...sourceProjection,
        fingerprint: sourceFingerprint
      },
      changedFields: validated.fields,
      dimensions: validated.dimensions,
      patch: validated.patch,
      changes: validated.fields.map((field, index) => ({
        field,
        dimension: FIELD_DIMENSIONS[field],
        before: fields[index],
        after: cloneBoundedJson(validated.patch[field])
      })),
      title: validated.proposal.title,
      summary: validated.proposal.summary,
      compromises: validated.proposal.compromises,
      clientPreview: validated.proposal.clientPreview,
      marginEvidence: validated.proposal.marginEvidence,
      judgment: {
        why: validated.proposal.why,
        consequence: validated.proposal.consequence,
        doNothing: validated.proposal.doNothing,
        confidence: validated.proposal.confidence,
        provenance: validated.proposal.provenance
      },
      adoption: {
        required: true,
        allowedAfterExplicitConfirmation: true,
        applyLabel: "Apply scenario to draft",
        keepLabel: "Keep current draft",
        boundary: validated.proposal.adoption.boundary
      },
      boundary: BOUNDARY
    });
    return immutable({
      ok: true,
      form: currentForm,
      dirtyFields: [],
      review,
      acknowledgement: {
        kind: "context",
        state: "pending_review",
        reason: "The exact scenario, catalog observation, and changed draft fields are bound into an immutable review.",
        consequence: "Nothing has changed yet. Applying still requires an explicit person action.",
        nextResolutions: ["Apply scenario to draft", "Keep current draft"]
      }
    });
  } catch (error) {
    return recovery({
      code: "pilot_scenario_review_fingerprint_unavailable",
      reason: error?.message || "The immutable review fingerprint could not be created.",
      form: currentForm,
      state: "not_created"
    });
  }
}

export async function applyPilotScenarioDraftReview({
  review = null,
  currentProposal = null,
  organizationId = "",
  catalogEvidence = null,
  form = null,
  confirmed = false,
  cryptoApi = globalThis.crypto
} = {}) {
  let currentForm;
  try {
    currentForm = safeFormClone(form);
  } catch (error) {
    return recovery({
      code: "pilot_scenario_apply_form_invalid",
      reason: error?.message || "The current editor draft could not be safely isolated."
    });
  }
  if (confirmed !== true) {
    return recovery({
      code: "pilot_scenario_apply_confirmation_required",
      reason: "Explicit confirmation is required before a scenario can enter the editor draft.",
      form: currentForm
    });
  }
  if (!exactReviewContract(review)) {
    return recovery({
      code: "pilot_scenario_apply_review_invalid",
      reason: "The immutable Pilot scenario review is missing, changed, or outside the v1 contract.",
      form: currentForm
    });
  }
  if (organizationId !== review.organizationScope.organizationId) {
    return recovery({
      code: "pilot_scenario_apply_organization_drift",
      reason: "The active organization changed after this scenario review was created.",
      form: currentForm
    });
  }
  const scope = catalogScope(organizationId, catalogEvidence);
  if (!scope.ok) {
    return recovery({
      code: "pilot_scenario_apply_catalog_unavailable",
      reason: scope.reason,
      form: currentForm
    });
  }
  if (
    scope.value.sourceLabel !== review.catalogScope.sourceLabel
    || scope.value.catalogRevision !== review.catalogScope.catalogRevision
    || scope.value.observedAt !== review.catalogScope.observedAt
    || scope.value.freshness !== review.catalogScope.freshness
  ) {
    return recovery({
      code: "pilot_scenario_apply_catalog_drift",
      reason: "The catalog source, revision, freshness, or observation time changed after review.",
      form: currentForm
    });
  }
  const validated = validateProposal(currentProposal, scope.value, catalogEvidence);
  if (!validated.ok) {
    return recovery({
      code: "pilot_scenario_apply_proposal_invalid",
      reason: validated.reason,
      form: currentForm
    });
  }
  if (
    currentProposal.id !== review.proposalIdentity.proposalId
    || !exactList(validated.fields, review.changedFields)
    || canonicalSerialize(validated.patch) !== canonicalSerialize(review.patch)
  ) {
    return recovery({
      code: "pilot_scenario_apply_proposal_drift",
      reason: "The selected scenario identity or exact patch changed after review.",
      form: currentForm
    });
  }
  if (
    review.sourceSnapshot.fields.length !== review.changedFields.length
    || !review.sourceSnapshot.fields.every((entry, index) => (
      exactKeys(entry, ["field", "present", "encoding", "value"])
      && entry.field === review.changedFields[index]
      && snapshotMatches(entry, form)
    ))
  ) {
    return recovery({
      code: "pilot_scenario_apply_source_drift",
      reason: "At least one draft field changed after this scenario review was created.",
      form: currentForm
    });
  }

  try {
    const catalog = catalogProjection(scope.value, catalogEvidence);
    const proposalProjection = proposalIdentityProjection(currentProposal);
    const sourceProjection = {
      modelId: review.sourceSnapshot.modelId,
      fields: review.sourceSnapshot.fields
    };
    const [catalogFingerprint, proposalFingerprint, sourceFingerprint] = await Promise.all([
      fingerprint(catalog, cryptoApi),
      fingerprint(proposalProjection, cryptoApi),
      fingerprint(sourceProjection, cryptoApi)
    ]);
    if (catalogFingerprint !== review.catalogScope.fingerprint) {
      return recovery({
        code: "pilot_scenario_apply_catalog_drift",
        reason: "The bounded catalog evidence changed after this scenario review was created.",
        form: currentForm
      });
    }
    if (proposalFingerprint !== review.proposalIdentity.fingerprint) {
      return recovery({
        code: "pilot_scenario_apply_proposal_drift",
        reason: "The selected scenario evidence changed after this review was created.",
        form: currentForm
      });
    }
    if (sourceFingerprint !== review.sourceSnapshot.fingerprint) {
      return recovery({
        code: "pilot_scenario_apply_snapshot_drift",
        reason: "The draft source snapshot no longer matches its immutable fingerprint.",
        form: currentForm
      });
    }
    const nextForm = {
      ...currentForm,
      ...cloneBoundedJson(review.patch)
    };
    return immutable({
      ok: true,
      form: nextForm,
      dirtyFields: [...review.changedFields],
      review,
      acknowledgement: {
        kind: "preview",
        state: "draft_updated",
        reason: "The exact reviewed scenario was applied to the isolated editor draft.",
        consequence: `Only ${review.changedFields.join(", ")} changed. The saved quote and customer proposal remain unchanged.`,
        nextResolutions: [
          "Review the recalculated commercial consequences.",
          "Use the outcome-named trusted save only if the draft remains acceptable."
        ],
        saveRequired: true,
        authoritativeRepriceRequired: true
      }
    });
  } catch (error) {
    return recovery({
      code: "pilot_scenario_apply_fingerprint_unavailable",
      reason: error?.message || "The scenario evidence could not be revalidated.",
      form: currentForm
    });
  }
}
