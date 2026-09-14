export const DELIVERY_BLUEPRINT_VERSION = "delivery-blueprint-v1";
export const QUANTITY_POLICY_VERSION = "quantity-policy-v1";
export const DELIVERY_PROPOSAL_VERSION = "delivery-proposal-v1";

const EVIDENCE_STATES = new Set([
  "available",
  "not_applicable",
  "not_yet_available",
  "missing",
  "stale",
  "blocked_by_integration",
  "contradictory",
  "schema_drift"
]);

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return String(value ?? "").trim();
}

function exactInteger(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (record(value)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined && typeof value[key] !== "function") {
          result[key] = stableValue(value[key]);
        }
        return result;
      }, {});
  }
  return value;
}

export function canonicalDeliveryValue(value) {
  return JSON.stringify(stableValue(value));
}

// This short digest is a deterministic session correlation key, not a security
// primitive or durable receipt. Owning domains issue their own receipts.
export function deliveryFingerprint(value) {
  const input = canonicalDeliveryValue(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `dp1-${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

function sourceMetadata(value) {
  const revision = text(value?.revision);
  const declaredBy = text(value?.declaredBy || value?.declaringActor);
  const declaredAtISO = text(value?.declaredAtISO || value?.declaredAt);
  const provenance = text(value?.provenance);
  const publicationState = text(value?.publicationState);
  return { revision, declaredBy, declaredAtISO, provenance, publicationState };
}

function publishedSource(value, schemaVersion) {
  const metadata = sourceMetadata(value);
  return record(value)
    && text(value.schemaVersion) === schemaVersion
    && Boolean(text(value.id))
    && Boolean(metadata.revision)
    && Boolean(metadata.declaredBy)
    && Boolean(metadata.declaredAtISO)
    && Boolean(metadata.provenance)
    && metadata.publicationState === "published";
}

function normalizeBlueprintReference(value) {
  if (typeof value === "string") return { id: text(value), revision: "" };
  if (!record(value)) return { id: "", revision: "" };
  return {
    id: text(value.id || value.blueprintId),
    revision: text(value.revision || value.blueprintRevision)
  };
}

function policyQuantity(policy, guestCount) {
  const minimumGuestCount = exactInteger(policy?.input?.minimumGuestCount, { minimum: 1 }) ?? 1;
  const maximumGuestCount = exactInteger(policy?.input?.maximumGuestCount, { minimum: minimumGuestCount });
  const numerator = exactInteger(policy?.output?.numerator, { minimum: 1 });
  const denominator = exactInteger(policy?.output?.denominator, { minimum: 1 });
  const rounding = text(policy?.output?.rounding);
  if (
    text(policy?.input?.kind) !== "guest_count"
    || maximumGuestCount === null
    || numerator === null
    || denominator === null
    || !["ceil", "floor", "nearest"].includes(rounding)
  ) {
    return { quantity: null, reasonCode: "quantity_policy_invalid" };
  }
  if (guestCount < minimumGuestCount || guestCount > maximumGuestCount) {
    return { quantity: null, reasonCode: "quantity_policy_out_of_bounds" };
  }
  const raw = (guestCount * numerator) / denominator;
  const quantity = rounding === "ceil" ? Math.ceil(raw) : rounding === "floor" ? Math.floor(raw) : Math.round(raw);
  return Number.isSafeInteger(quantity) && quantity >= 0
    ? { quantity, reasonCode: "" }
    : { quantity: null, reasonCode: "quantity_policy_output_invalid" };
}

function issue(id, message, details = {}) {
  return { id, message, ...details };
}

function normalizedWorkBlocks(blueprint, conflicts) {
  if (!Array.isArray(blueprint.workBlocks) || blueprint.workBlocks.length === 0) {
    conflicts.push(issue("work_blocks_missing", "The published Delivery Blueprint has no work blocks."));
    return [];
  }
  const seen = new Set();
  return blueprint.workBlocks.flatMap((block) => {
    const id = text(block?.id);
    const label = text(block?.label);
    const anchor = text(block?.timing?.anchor);
    const offsetMinutes = exactInteger(block?.timing?.offsetMinutes, {
      minimum: -43_200,
      maximum: 43_200
    });
    const durationMinutes = exactInteger(block?.timing?.durationMinutes, {
      minimum: 1,
      maximum: 10_080
    });
    const requiredCapabilities = Array.isArray(block?.requiredCapabilities)
      ? [...new Set(block.requiredCapabilities.map(text).filter(Boolean))].sort()
      : [];
    if (!id || !label || seen.has(id) || !anchor || offsetMinutes === null || durationMinutes === null || requiredCapabilities.length === 0) {
      conflicts.push(issue("work_block_invalid", `Work block ${id || "(missing id)"} is incomplete or duplicated.`));
      return [];
    }
    seen.add(id);
    return [{ id, label, timing: { anchor, offsetMinutes, durationMinutes }, requiredCapabilities }];
  });
}

function evidenceFor(domain, source, scope) {
  if (!scope.quoteRevisionId) {
    return {
      state: "not_yet_available",
      reasonCode: `${domain}_requires_saved_quote_revision`,
      recovery: "Save the quote, then refresh this domain review."
    };
  }
  if (!record(source)) {
    return {
      state: "missing",
      reasonCode: `${domain}_evidence_missing`,
      recovery: `Open ${domain} review after saving, then return and refresh.`
    };
  }
  const state = EVIDENCE_STATES.has(text(source.state)) ? text(source.state) : "schema_drift";
  const sourceScope = source.scope || source;
  const current = text(sourceScope.quoteId) === scope.quoteId
    && text(sourceScope.quoteRevisionId) === scope.quoteRevisionId
    && text(sourceScope.blueprintId) === scope.blueprintId
    && text(sourceScope.blueprintRevision) === scope.blueprintRevision
    && text(sourceScope.proposalFingerprint) === scope.proposalFingerprint
    && exactInteger(sourceScope.calculationGeneration, { minimum: 1 }) === scope.calculationGeneration;
  if (!current) {
    return {
      state: "stale",
      reasonCode: `${domain}_scope_mismatch`,
      recovery: `Refresh ${domain} against this exact quote and Delivery Proposal.`
    };
  }
  return {
    state,
    reasonCode: text(source.reasonCode || `${domain}_${state}`),
    recovery: text(source.recovery || (state === "available" ? "" : `Refresh ${domain} evidence.`)),
    observedAtISO: text(source.observedAtISO),
    sourceRevision: text(source.sourceRevision)
  };
}

function normalizeInventoryAvailability(inventoryEvidence, inventoryState) {
  if (inventoryState.state !== "available" || !record(inventoryEvidence?.availableByIngredient)) return new Map();
  return new Map(Object.entries(inventoryEvidence.availableByIngredient).flatMap(([ingredientId, entry]) => {
    const quantityMicros = exactInteger(entry?.quantityMicros);
    const unitId = text(entry?.unitId);
    return quantityMicros === null || !unitId ? [] : [[ingredientId, { quantityMicros, unitId }]];
  }));
}

function primaryPresentation({ conflicts, evidence }) {
  if (conflicts.length > 0) {
    return {
      state: "conflict",
      label: `${conflicts.length} planning conflict${conflicts.length === 1 ? "" : "s"}`,
      detail: "Resolve required components, policies, or retained overrides before relying on the proposal."
    };
  }
  const unchecked = [evidence.staffing, evidence.inventory].filter((item) => item.state !== "available").length;
  return unchecked > 0
    ? {
        state: "proposed",
        label: "Proposed work assembled",
        detail: "Staffing and physical Inventory remain separate and unchecked."
      }
    : {
        state: "reviewable",
        label: "Reviewable proposal",
        detail: "Current domain evidence is shown independently; no assignment, allocation, or order has been made."
      };
}

export function compileDeliveryProposal({
  form = {},
  catalog = {},
  offer = null,
  blueprint = null,
  quantityPolicies = [],
  purchasingPacks = [],
  editingQuote = null,
  calculationGeneration = 1,
  staffingEvidence = null,
  inventoryEvidence = null,
  overrides = {},
  removedOptionalComponentIds = []
} = {}) {
  const conflicts = [];
  const guestCount = exactInteger(form.guests, { minimum: 1, maximum: 100_000 });
  const offerId = text(offer?.id);
  const blueprintRef = normalizeBlueprintReference(offer?.deliveryBlueprintRef);
  const blueprintId = text(blueprint?.id);
  const blueprintRevision = text(blueprint?.revision);
  const generation = exactInteger(calculationGeneration, { minimum: 1 }) || 1;
  const quoteRevisionId = text(
    editingQuote?.activeQuoteRevisionId
      || editingQuote?.quoteRevisionId
      || editingQuote?.versionId
      || editingQuote?.version
  );
  const quoteId = text(editingQuote?.id || editingQuote?.quoteId);
  const catalogRevision = text(catalog?.settings?.catalogRevision ?? catalog?.catalogRevision);

  if (!offerId) conflicts.push(issue("offer_missing", "Choose an Offer before assembling delivery work."));
  if (guestCount === null) conflicts.push(issue("guest_count_invalid", "Enter a guest count within the published policy bounds."));
  if (!blueprintRef.id) conflicts.push(issue("blueprint_reference_missing", "This Offer does not reference a Delivery Blueprint."));
  if (!publishedSource(blueprint, DELIVERY_BLUEPRINT_VERSION)) {
    conflicts.push(issue("blueprint_unavailable", "The referenced Delivery Blueprint is missing, unpublished, or incomplete."));
  } else if (blueprintRef.id !== blueprintId || (blueprintRef.revision && blueprintRef.revision !== blueprintRevision)) {
    conflicts.push(issue("blueprint_reference_stale", "The Offer references a different Delivery Blueprint revision."));
  }

  const serviceFormat = text(form.style || form.serviceFormat);
  if (
    publishedSource(blueprint, DELIVERY_BLUEPRINT_VERSION)
    && (!Array.isArray(blueprint.compatibleServiceFormats)
      || !blueprint.compatibleServiceFormats.map(text).includes(serviceFormat))
  ) {
    conflicts.push(issue("service_format_incompatible", "The selected service format is not approved for this Delivery Blueprint."));
  }

  const workBlocks = publishedSource(blueprint, DELIVERY_BLUEPRINT_VERSION)
    ? normalizedWorkBlocks(blueprint, conflicts)
    : [];
  const policies = new Map((Array.isArray(quantityPolicies) ? quantityPolicies : []).map((policy) => [text(policy?.id), policy]));
  const packs = new Map((Array.isArray(purchasingPacks) ? purchasingPacks : []).map((pack) => [text(pack?.id), pack]));
  const menuItems = new Map(
    (catalog?.settings?.menuSections || [])
      .flatMap((section) => section?.items || [])
      .map((item) => [text(item?.id), item])
  );
  const selectedMenuIds = new Set((form.menuItems || []).map(text).filter(Boolean));
  const removedOptionalIds = new Set((removedOptionalComponentIds || []).map(text).filter(Boolean));
  const productionOutputs = [];
  const ingredientDemand = new Map();

  const components = Array.isArray(blueprint?.productionComponents) ? blueprint.productionComponents : [];
  components.forEach((component) => {
    const componentId = text(component?.componentId);
    const required = component?.required === true;
    const selected = selectedMenuIds.has(componentId);
    if (required && !selected) {
      conflicts.push(issue(
        "required_component_missing",
        `${text(component?.label) || componentId || "A required component"} is required by this Delivery Blueprint.`,
        { componentId }
      ));
      return;
    }
    if ((!required && (!selected || removedOptionalIds.has(componentId))) || !componentId) return;
    const policyRef = text(component?.quantityPolicyRef);
    const policy = policies.get(policyRef);
    if (!policyRef || !publishedSource(policy, QUANTITY_POLICY_VERSION)) {
      conflicts.push(issue(
        "quantity_policy_missing",
        `${text(component?.label) || componentId} has no current published quantity policy.`,
        { componentId, quantityPolicyRef: policyRef }
      ));
      return;
    }
    const generated = policyQuantity(policy, guestCount);
    if (generated.quantity === null) {
      conflicts.push(issue(
        generated.reasonCode,
        `${text(component?.label) || componentId} cannot be compiled for ${guestCount ?? "this"} guests.`,
        { componentId, quantityPolicyRef: policyRef }
      ));
      return;
    }
    const override = record(overrides?.[componentId]) ? overrides[componentId] : null;
    const overrideQuantity = exactInteger(override?.quantity, { minimum: 0 });
    const overrideConflict = overrideQuantity !== null
      && exactInteger(override?.baseGeneratedQuantity, { minimum: 0 }) !== generated.quantity;
    if (overrideConflict) {
      conflicts.push(issue(
        "retained_override_conflict",
        `${text(component?.label) || componentId} keeps an override that differs from the new generated quantity.`,
        { componentId, generatedQuantity: generated.quantity, overrideQuantity }
      ));
    }
    const quantity = overrideQuantity === null ? generated.quantity : overrideQuantity;
    const output = {
      componentId,
      label: text(component?.label || menuItems.get(componentId)?.name) || componentId,
      required,
      billingQuantity: guestCount,
      generatedQuantity: generated.quantity,
      productionQuantity: quantity,
      unitId: text(policy.output?.unitId) || "unit",
      quantityPolicy: {
        id: text(policy.id),
        revision: text(policy.revision),
        declaredBy: text(policy.declaredBy),
        declaredAtISO: text(policy.declaredAtISO),
        provenance: text(policy.provenance)
      },
      override: overrideQuantity === null ? null : {
        quantity: overrideQuantity,
        reason: text(override.reason),
        declaredBy: text(override.declaredBy),
        declaredAtISO: text(override.declaredAtISO),
        baseGeneratedQuantity: exactInteger(override.baseGeneratedQuantity, { minimum: 0 }),
        state: overrideConflict ? "conflict" : "retained"
      }
    };
    productionOutputs.push(output);

    (Array.isArray(policy.ingredients) ? policy.ingredients : []).forEach((ingredient) => {
      const ingredientId = text(ingredient?.ingredientId);
      const unitId = text(ingredient?.unitId);
      const perOutputMicros = exactInteger(ingredient?.quantityPerOutputMicros, { minimum: 1 });
      const purchasingPackRef = text(ingredient?.purchasingPackRef);
      if (!ingredientId || !unitId || perOutputMicros === null) {
        conflicts.push(issue("ingredient_requirement_invalid", `${output.label} has an invalid ingredient requirement.`, { componentId }));
        return;
      }
      const requiredQuantityMicros = quantity * perOutputMicros;
      if (!Number.isSafeInteger(requiredQuantityMicros)) {
        conflicts.push(issue("ingredient_quantity_overflow", `${output.label} exceeds the supported ingredient quantity range.`, { componentId }));
        return;
      }
      const key = `${ingredientId}:${unitId}`;
      const current = ingredientDemand.get(key) || {
        ingredientId,
        label: text(ingredient.label) || ingredientId,
        unitId,
        requiredQuantityMicros: 0,
        purchasingPackRef,
        sourceComponentIds: []
      };
      if (current.purchasingPackRef && purchasingPackRef && current.purchasingPackRef !== purchasingPackRef) {
        conflicts.push(issue("purchasing_pack_conflict", `${current.label} references more than one purchasing pack.`, { ingredientId }));
      }
      current.requiredQuantityMicros += requiredQuantityMicros;
      current.purchasingPackRef ||= purchasingPackRef;
      current.sourceComponentIds.push(componentId);
      ingredientDemand.set(key, current);
    });
  });

  const draftFingerprint = deliveryFingerprint({
    catalogRevision,
    offerId,
    blueprintId,
    blueprintRevision,
    serviceFormat,
    guestCount,
    menuItems: [...selectedMenuIds].sort()
  });
  const proposalFingerprint = deliveryFingerprint({
    draftFingerprint,
    productionOutputs: productionOutputs.map((output) => ({
      componentId: output.componentId,
      productionQuantity: output.productionQuantity,
      quantityPolicy: output.quantityPolicy,
      override: output.override
    })),
    removedOptionalComponentIds: [...removedOptionalIds].sort()
  });
  const scope = {
    quoteId,
    quoteRevisionId,
    blueprintId,
    blueprintRevision,
    proposalFingerprint,
    calculationGeneration: generation
  };
  const staffing = evidenceFor("staffing", staffingEvidence, scope);
  const inventory = evidenceFor("inventory", inventoryEvidence, scope);
  const availableByIngredient = normalizeInventoryAvailability(inventoryEvidence, inventory);

  const demand = [...ingredientDemand.values()].map((entry) => ({
    ...entry,
    sourceComponentIds: [...new Set(entry.sourceComponentIds)].sort()
  }));
  const purchaseRequirements = demand.map((entry) => {
    const available = availableByIngredient.get(entry.ingredientId);
    const availableQuantityMicros = available?.unitId === entry.unitId ? available.quantityMicros : null;
    const shortageQuantityMicros = availableQuantityMicros === null
      ? null
      : Math.max(0, entry.requiredQuantityMicros - availableQuantityMicros);
    const pack = packs.get(entry.purchasingPackRef);
    const packQuantityMicros = exactInteger(pack?.quantityMicros, { minimum: 1 });
    const packCurrent = record(pack)
      && text(pack.publicationState) === "published"
      && text(pack.unitId) === entry.unitId
      && packQuantityMicros !== null;
    const purchasablePackQuantity = shortageQuantityMicros === null || !packCurrent
      ? null
      : Math.ceil(shortageQuantityMicros / packQuantityMicros);
    return {
      ingredientId: entry.ingredientId,
      label: entry.label,
      unitId: entry.unitId,
      requiredIngredientQuantityMicros: entry.requiredQuantityMicros,
      availableQuantityMicros,
      shortageQuantityMicros,
      purchasingPackRef: entry.purchasingPackRef,
      packQuantityMicros: packCurrent ? packQuantityMicros : null,
      purchasablePackQuantity,
      expectedRemainderQuantityMicros: purchasablePackQuantity === null
        ? null
        : (purchasablePackQuantity * packQuantityMicros) - shortageQuantityMicros,
      state: availableQuantityMicros === null
        ? "unchecked"
        : packCurrent || shortageQuantityMicros === 0
          ? "calculated"
          : "missing_pack"
    };
  });

  const evidence = {
    commercial: quoteRevisionId
      ? { state: "available", reasonCode: "saved_quote_revision_bound" }
      : { state: "not_yet_available", reasonCode: "unsaved_quote_draft" },
    production: conflicts.some((entry) => [
      "quantity_policy_missing",
      "quantity_policy_invalid",
      "quantity_policy_out_of_bounds",
      "required_component_missing",
      "retained_override_conflict"
    ].includes(entry.id))
      ? { state: "contradictory", reasonCode: "production_compilation_conflict" }
      : { state: "available", reasonCode: "published_blueprint_and_policies_compiled" },
    staffing,
    inventory,
    purchasing: inventory.state === "available"
      ? {
          state: purchaseRequirements.some((entry) => entry.state === "missing_pack") ? "missing" : "available",
          reasonCode: purchaseRequirements.some((entry) => entry.state === "missing_pack")
            ? "purchasing_pack_missing"
            : "inventory_bound_purchase_requirements_compiled"
        }
      : {
          state: inventory.state,
          reasonCode: "purchasing_requires_current_inventory_evidence",
          recovery: inventory.recovery
        }
  };

  return deepFreeze({
    schemaVersion: DELIVERY_PROPOSAL_VERSION,
    authority: "session_only_advisory_projection",
    persistence: "none",
    calculationGeneration: generation,
    quoteDraftFingerprint: draftFingerprint,
    proposalFingerprint,
    bindings: {
      quoteId,
      quoteRevisionId,
      catalogRevision,
      offerId,
      blueprintId,
      blueprintRevision,
      serviceFormat
    },
    blueprint: publishedSource(blueprint, DELIVERY_BLUEPRINT_VERSION) ? {
      id: blueprintId,
      revision: blueprintRevision,
      label: text(blueprint.label) || blueprintId,
      declaredBy: text(blueprint.declaredBy),
      declaredAtISO: text(blueprint.declaredAtISO),
      provenance: text(blueprint.provenance),
      compatibleAlternativeBlueprintRefs: Array.isArray(blueprint.compatibleAlternativeBlueprintRefs)
        ? blueprint.compatibleAlternativeBlueprintRefs.map(normalizeBlueprintReference).filter((item) => item.id)
        : []
    } : null,
    workBlocks,
    productionOutputs,
    ingredientDemand: demand,
    purchaseRequirements,
    evidence,
    conflicts,
    unresolvedAssumptions: conflicts.map((entry) => ({ id: entry.id, message: entry.message })),
    presentation: primaryPresentation({ conflicts, evidence }),
    boundary: "This proposal does not save or send the quote, assign people, allocate stock, order goods, publish configuration, change pricing, or establish event readiness."
  });
}

export function buildDeliveryPlanningContext({
  form = {},
  catalog = {},
  settings = catalog?.settings || {},
  ...options
} = {}) {
  if (settings?.deliveryPlanningEnabled !== true) return null;
  const offer = (catalog?.packages || []).find((item) => text(item?.id) === text(form.pkg)) || null;
  const reference = normalizeBlueprintReference(offer?.deliveryBlueprintRef);
  if (!reference.id) return null;
  const blueprint = (settings?.deliveryBlueprints || []).find((item) => (
    text(item?.id) === reference.id && (!reference.revision || text(item?.revision) === reference.revision)
  )) || null;
  return compileDeliveryProposal({
    form,
    catalog,
    settings,
    offer,
    blueprint,
    quantityPolicies: settings?.quantityPolicies,
    purchasingPacks: settings?.purchasingPacks,
    ...options
  });
}

export function keepDeliveryOverride(overrides = {}, componentId, generatedQuantity) {
  const id = text(componentId);
  const generated = exactInteger(generatedQuantity, { minimum: 0 });
  if (!id || generated === null || !record(overrides[id])) return overrides;
  return {
    ...overrides,
    [id]: { ...overrides[id], baseGeneratedQuantity: generated }
  };
}

export function useGeneratedDeliveryQuantity(overrides = {}, componentId) {
  const id = text(componentId);
  if (!id || !Object.prototype.hasOwnProperty.call(overrides, id)) return overrides;
  const next = { ...overrides };
  delete next[id];
  return next;
}

export function createDeliveryHandoff(proposal, domain) {
  if (!proposal || !["staffing", "production", "purchasing"].includes(domain)) return null;
  return deepFreeze({
    schemaVersion: "delivery-handoff-v1",
    authority: "prefill_only",
    domain,
    quoteId: proposal.bindings.quoteId,
    quoteRevisionId: proposal.bindings.quoteRevisionId,
    quoteDraftFingerprint: proposal.quoteDraftFingerprint,
    blueprintId: proposal.bindings.blueprintId,
    blueprintRevision: proposal.bindings.blueprintRevision,
    proposalFingerprint: proposal.proposalFingerprint,
    calculationGeneration: proposal.calculationGeneration,
    requirements: domain === "staffing"
      ? proposal.workBlocks
      : domain === "production"
        ? proposal.productionOutputs
        : proposal.purchaseRequirements,
    boundary: "The receiving workflow must reread current authority, reject stale input, obtain its own approval, and issue its own receipt."
  });
}
