import {
  DELIVERY_BLUEPRINT_VERSION,
  QUANTITY_POLICY_VERSION
} from "./deliveryPlanning";

export const DELIVERY_PLANNING_SOURCE_FIELDS = Object.freeze([
  "deliveryBlueprints",
  "quantityPolicies",
  "purchasingPacks"
]);

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function validISO(value) {
  const normalized = text(value);
  return Boolean(normalized) && Number.isFinite(Date.parse(normalized));
}

export function normalizeDeliverySourceReference(value) {
  if (typeof value === "string") return { id: text(value), revision: "" };
  if (!record(value)) return { id: "", revision: "" };
  return {
    id: text(value.id || value.sourceId),
    revision: text(value.revision || value.sourceRevision)
  };
}

function sourceKey(value) {
  const reference = normalizeDeliverySourceReference(value);
  return `${reference.id}@${reference.revision}`;
}

function issue(id, message, path = "", publishedClaim = false) {
  return { id, message, path, publishedClaim };
}

function publicationMetadataIssues(source, path, schemaVersion) {
  if (text(source?.publicationState) !== "published") return [];
  const issues = [];
  if (text(source?.schemaVersion) !== schemaVersion) {
    issues.push(issue("schema_version_invalid", `${path} must use ${schemaVersion}.`, path, true));
  }
  if (!text(source?.id) || !text(source?.revision)) {
    issues.push(issue("source_identity_missing", `${path} needs an exact ID and revision.`, path, true));
  }
  if (!text(source?.declaredBy) || !validISO(source?.declaredAtISO) || !text(source?.provenance)) {
    issues.push(issue(
      "source_declaration_missing",
      `${path} needs a declaring actor, valid declaration time, and provenance before publication.`,
      path,
      true
    ));
  }
  return issues;
}

function uniquePublishedSources(sources, label, schemaVersion, issues) {
  const published = (Array.isArray(sources) ? sources : []).filter((source) => text(source?.publicationState) === "published");
  const seen = new Set();
  published.forEach((source, index) => {
    const path = `${label}[${index}]`;
    issues.push(...publicationMetadataIssues(source, path, schemaVersion));
    const key = sourceKey(source);
    if (seen.has(key)) {
      issues.push(issue("source_revision_duplicated", `${path} duplicates ${key}.`, path, true));
    }
    seen.add(key);
  });
  return published;
}

function publishedPackIssues(pack, path) {
  if (text(pack?.publicationState) !== "published") return [];
  const quantityMicros = exactInteger(pack?.quantityMicros, 1);
  const issues = [];
  if (!text(pack?.id) || !text(pack?.revision)) {
    issues.push(issue("purchasing_pack_identity_missing", `${path} needs an exact ID and revision.`, path, true));
  }
  if (!text(pack?.unitId) || quantityMicros === null) {
    issues.push(issue("purchasing_pack_invalid", `${path} needs a unit and a positive pack quantity.`, path, true));
  }
  return issues;
}

function findExactSource(sources, reference) {
  const normalized = normalizeDeliverySourceReference(reference);
  if (!normalized.id || !normalized.revision) return null;
  return sources.find((source) => (
    text(source?.id) === normalized.id
    && text(source?.revision) === normalized.revision
  )) || null;
}

function menuItemIds(catalog) {
  return new Set([
    ...(Array.isArray(catalog?.menuItems) ? catalog.menuItems : []),
    ...(catalog?.settings?.menuSections || []).flatMap((section) => section?.items || [])
  ].map((item) => text(item?.id)).filter(Boolean));
}

export function parseDeliveryPlanningSourceDrafts(jsonDrafts = {}) {
  const sources = {};
  const issues = [];
  DELIVERY_PLANNING_SOURCE_FIELDS.forEach((field) => {
    try {
      const parsed = JSON.parse(jsonDrafts?.[field] || "[]");
      if (!Array.isArray(parsed)) throw new TypeError("must be a JSON array");
      sources[field] = parsed;
    } catch (error) {
      sources[field] = [];
      issues.push(issue(
        "source_json_invalid",
        `${field}: ${error?.message || "must be valid JSON"}.`,
        field
      ));
    }
  });
  return { ok: issues.length === 0, sources, issues };
}

export function assessDeliveryPlanningConfiguration(catalog = {}) {
  const settings = catalog?.settings || {};
  const issues = [];
  const blueprints = uniquePublishedSources(
    settings.deliveryBlueprints,
    "deliveryBlueprints",
    DELIVERY_BLUEPRINT_VERSION,
    issues
  );
  const policies = uniquePublishedSources(
    settings.quantityPolicies,
    "quantityPolicies",
    QUANTITY_POLICY_VERSION,
    issues
  );
  const packs = (Array.isArray(settings.purchasingPacks) ? settings.purchasingPacks : [])
    .filter((pack) => text(pack?.publicationState) === "published");
  const packKeys = new Set();
  packs.forEach((pack, index) => {
    const path = `purchasingPacks[${index}]`;
    issues.push(...publishedPackIssues(pack, path));
    const key = sourceKey(pack);
    if (packKeys.has(key)) {
      issues.push(issue("purchasing_pack_revision_duplicated", `${path} duplicates ${key}.`, path, true));
    }
    packKeys.add(key);
  });

  const knownMenuItems = menuItemIds(catalog);
  blueprints.forEach((blueprint, blueprintIndex) => {
    const path = `deliveryBlueprints[${blueprintIndex}]`;
    if (!Array.isArray(blueprint.compatibleServiceFormats)
      || !blueprint.compatibleServiceFormats.map(text).includes("Buffet")) {
      issues.push(issue("staffed_buffet_format_missing", `${path} must explicitly support Buffet for this pilot.`, path, true));
    }
    if (!Array.isArray(blueprint.workBlocks) || blueprint.workBlocks.length === 0) {
      issues.push(issue("work_blocks_missing", `${path} needs at least one declared work block.`, path, true));
    } else {
      const workBlockIds = new Set();
      blueprint.workBlocks.forEach((block, blockIndex) => {
        const blockPath = `${path}.workBlocks[${blockIndex}]`;
        const blockId = text(block?.id);
        const capabilities = Array.isArray(block?.requiredCapabilities)
          ? block.requiredCapabilities.map(text).filter(Boolean)
          : [];
        if (!blockId || workBlockIds.has(blockId) || !text(block?.label)
          || !text(block?.timing?.anchor)
          || exactInteger(block?.timing?.offsetMinutes, -43_200, 43_200) === null
          || exactInteger(block?.timing?.durationMinutes, 1, 10_080) === null
          || capabilities.length === 0) {
          issues.push(issue("work_block_invalid", `${blockPath} is incomplete or duplicated.`, blockPath, true));
        }
        workBlockIds.add(blockId);
      });
    }

    if (!Array.isArray(blueprint.productionComponents) || blueprint.productionComponents.length === 0) {
      issues.push(issue("production_components_missing", `${path} needs at least one production component.`, path, true));
      return;
    }
    blueprint.productionComponents.forEach((component, componentIndex) => {
      const componentPath = `${path}.productionComponents[${componentIndex}]`;
      const componentId = text(component?.componentId);
      if (!componentId || !knownMenuItems.has(componentId)) {
        issues.push(issue("production_component_missing", `${componentPath} must reference a current menu item ID.`, componentPath, true));
      }
      const policyReference = normalizeDeliverySourceReference(component?.quantityPolicyRef);
      if (!policyReference.id || !policyReference.revision) {
        issues.push(issue("quantity_policy_reference_inexact", `${componentPath} needs an exact quantity-policy ID and revision.`, componentPath, true));
      } else if (!findExactSource(policies, policyReference)) {
        issues.push(issue("quantity_policy_reference_stale", `${componentPath} does not match a published quantity policy revision.`, componentPath, true));
      }
    });
  });

  policies.forEach((policy, policyIndex) => {
    const path = `quantityPolicies[${policyIndex}]`;
    const minimum = exactInteger(policy?.input?.minimumGuestCount, 1);
    const maximum = exactInteger(policy?.input?.maximumGuestCount, minimum ?? 1);
    if (text(policy?.input?.kind) !== "guest_count"
      || minimum === null
      || maximum === null
      || exactInteger(policy?.output?.numerator, 1) === null
      || exactInteger(policy?.output?.denominator, 1) === null
      || !["ceil", "floor", "nearest"].includes(text(policy?.output?.rounding))
      || !text(policy?.output?.unitId)) {
      issues.push(issue("quantity_policy_invalid", `${path} has an invalid guest bound or production calculation.`, path, true));
    }
    (Array.isArray(policy.ingredients) ? policy.ingredients : []).forEach((ingredient, ingredientIndex) => {
      const ingredientPath = `${path}.ingredients[${ingredientIndex}]`;
      if (!text(ingredient?.ingredientId)
        || !text(ingredient?.unitId)
        || exactInteger(ingredient?.quantityPerOutputMicros, 1) === null) {
        issues.push(issue("ingredient_requirement_invalid", `${ingredientPath} is incomplete.`, ingredientPath, true));
      }
      const packReference = normalizeDeliverySourceReference(ingredient?.purchasingPackRef);
      if (!packReference.id || !packReference.revision) {
        issues.push(issue("purchasing_pack_reference_inexact", `${ingredientPath} needs an exact purchasing-pack ID and revision.`, ingredientPath, true));
      } else {
        const pack = findExactSource(packs, packReference);
        if (!pack || text(pack?.unitId) !== text(ingredient?.unitId)) {
          issues.push(issue("purchasing_pack_reference_stale", `${ingredientPath} does not match a published pack in the same unit.`, ingredientPath, true));
        }
      }
    });
  });

  const sourceClaimIssues = issues.filter((entry) => entry.publishedClaim);
  const eligibleBlueprints = sourceClaimIssues.length === 0 ? blueprints : [];
  const activeOffers = (Array.isArray(catalog?.packages) ? catalog.packages : []).filter((offer) => offer?.active !== false);
  const boundOffers = activeOffers.filter((offer) => {
    const reference = normalizeDeliverySourceReference(offer?.deliveryBlueprintRef);
    if (!reference.id) return false;
    const blueprint = findExactSource(blueprints, reference);
    if (!blueprint) {
      issues.push(issue(
        "offer_blueprint_reference_stale",
        `${text(offer?.name) || text(offer?.id) || "An active Offer"} does not match a published Delivery Blueprint revision.`,
        `packages.${text(offer?.id)}`,
        true
      ));
      return false;
    }
    return true;
  });
  const publishedClaimIssues = issues.filter((entry) => entry.publishedClaim);
  const canEnable = eligibleBlueprints.length > 0
    && boundOffers.length > 0
    && publishedClaimIssues.length === 0;
  const enabled = settings.deliveryPlanningEnabled === true;
  const state = enabled && canEnable ? "enabled" : canEnable ? "ready" : "blocked";

  return {
    state,
    enabled,
    canEnable,
    issues,
    publishedClaimIssues,
    counts: {
      activeOffers: activeOffers.length,
      boundOffers: boundOffers.length,
      publishedBlueprints: blueprints.length,
      eligibleBlueprints: eligibleBlueprints.length,
      publishedPolicies: policies.length,
      publishedPacks: packs.length
    },
    eligibleBlueprints: eligibleBlueprints.map((blueprint) => ({
      id: text(blueprint.id),
      revision: text(blueprint.revision),
      label: text(blueprint.label) || text(blueprint.id)
    }))
  };
}

export function buildDeliveryPlanningDraftCatalog(catalog = {}, jsonDrafts = {}) {
  const parsed = parseDeliveryPlanningSourceDrafts(jsonDrafts);
  if (!parsed.ok) throw new Error(parsed.issues.map((entry) => entry.message).join(" "));
  return {
    ...catalog,
    settings: {
      ...(catalog?.settings || {}),
      ...parsed.sources
    }
  };
}

export function validateDeliveryPlanningConfiguration(catalog = {}) {
  const assessment = assessDeliveryPlanningConfiguration(catalog);
  if (assessment.publishedClaimIssues.length > 0) {
    throw new Error(assessment.publishedClaimIssues[0].message);
  }
  if (assessment.enabled && !assessment.canEnable) {
    throw new Error("Delivery Planning cannot be enabled until a current published Blueprint is bound to an active Offer.");
  }
  return assessment;
}
