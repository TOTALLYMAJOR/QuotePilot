import { isCatalogPricingConfirmationCurrent } from "./catalogPricingConfirmation";

export const PACKAGE_WORKSPACE_MODEL_VERSION = "package-workspace-model-v1";

const LIFECYCLE_ACTIVE = "active";
const LIFECYCLE_ARCHIVED = "archived";
const LIFECYCLE_DRAFT = "draft";
const VALID_LIFECYCLES = new Set([LIFECYCLE_ACTIVE, LIFECYCLE_ARCHIVED, LIFECYCLE_DRAFT]);

function text(value) {
  return String(value ?? "").trim();
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function idList(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => text(entry))
    .filter(Boolean)
    .slice(0, 100);
}

function flattenMenuItems(menuItems = [], catalog = {}) {
  if (Array.isArray(menuItems) && menuItems.length > 0) {
    if (Array.isArray(menuItems[0]?.items)) {
      return menuItems.flatMap((section) => Array.isArray(section?.items) ? section.items : []);
    }
    return menuItems;
  }
  return (catalog?.settings?.menuSections || []).flatMap((section) => (
    Array.isArray(section?.items) ? section.items : []
  ));
}

function buildRecordMap(records = []) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const id = text(record?.id);
    if (!id || map.has(id)) continue;
    map.set(id, {
      id,
      name: text(record?.name),
      active: record?.active !== false
    });
  }
  return map;
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinCountParts(parts = []) {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function summarizeReferenceCounts(counts = {}) {
  const parts = [];
  if (counts.missing > 0) parts.push(countLabel(counts.missing, "missing inclusion"));
  if (counts.invalid > 0) parts.push(countLabel(counts.invalid, "invalid inclusion"));
  return joinCountParts(parts);
}

function buildReferenceHealth(rawIds, recordMap, kind) {
  const references = [];
  const seen = new Set();
  const counts = {
    total: 0,
    ok: 0,
    invalid: 0,
    missing: 0,
    inactive: 0
  };

  for (const rawId of Array.isArray(rawIds) ? rawIds : []) {
    const id = text(rawId);
    const base = {
      kind,
      id,
      rawValue: rawId,
      name: "",
      label: id || `Entry ${references.length + 1}`,
      status: "invalid",
      issue: "blank"
    };
    counts.total += 1;

    if (!id) {
      counts.invalid += 1;
      references.push(base);
      continue;
    }
    if (seen.has(id)) {
      counts.invalid += 1;
      references.push({
        ...base,
        label: id,
        issue: "duplicate"
      });
      continue;
    }

    seen.add(id);
    const record = recordMap.get(id);
    if (!record) {
      counts.missing += 1;
      references.push({
        ...base,
        label: id,
        issue: "missing",
        status: "missing"
      });
      continue;
    }

    if (record.active === false) {
      counts.inactive += 1;
      references.push({
        ...base,
        name: record.name,
        label: record.name || id,
        issue: "inactive",
        status: "inactive"
      });
      continue;
    }

    counts.ok += 1;
    references.push({
      ...base,
      name: record.name,
      label: record.name || id,
      issue: "",
      status: "ok"
    });
  }

  return {
    references,
    counts
  };
}

function mergeReferenceCounts(groups = []) {
  return groups.reduce((summary, group) => ({
    total: summary.total + group.total,
    ok: summary.ok + group.ok,
    invalid: summary.invalid + group.invalid,
    missing: summary.missing + group.missing,
    inactive: summary.inactive + group.inactive
  }), {
    total: 0,
    ok: 0,
    invalid: 0,
    missing: 0,
    inactive: 0
  });
}

function resolveLifecycle(packageRecord = {}) {
  const explicitLifecycle = text(packageRecord?.lifecycle).toLowerCase();
  if (VALID_LIFECYCLES.has(explicitLifecycle)) {
    return {
      value: explicitLifecycle,
      source: "package_lifecycle"
    };
  }
  return {
    value: packageRecord?.active === false ? LIFECYCLE_DRAFT : LIFECYCLE_ACTIVE,
    source: "legacy_active_boolean"
  };
}

function buildCommercialSummary(packageRecord = {}) {
  const pricePerPerson = finiteNumber(packageRecord?.ppp, 0);
  const costPerPerson = nullableNumber(packageRecord?.costPpp);
  const contributionPerPerson = costPerPerson === null ? null : pricePerPerson - costPerPerson;
  const marginPct = costPerPerson === null || !(pricePerPerson > 0)
    ? null
    : contributionPerPerson / pricePerPerson;

  const includedCounts = {
    menuItems: idList(packageRecord?.includedMenuItemIds).length,
    addons: idList(packageRecord?.includedAddonIds).length,
    rentals: idList(packageRecord?.includedRentalIds).length
  };

  return {
    pricingBasis: "per_person",
    pricePerPerson,
    costPerPerson,
    contributionPerPerson,
    marginPct,
    marginState: marginPct === null ? "unavailable" : "available",
    includedCounts: {
      ...includedCounts,
      total: includedCounts.menuItems + includedCounts.addons + includedCounts.rentals
    }
  };
}

function buildReasons({
  packageRecord,
  commercialSummary,
  combinedReferenceCounts,
  pricingConfirmationCurrent,
  includeLegacyLifecycleReview,
  lifecycleSource
}) {
  const reasons = [];
  const packageName = text(packageRecord?.name);
  const pricePerPerson = commercialSummary.pricePerPerson;

  if (!packageName) {
    reasons.push({
      code: "missing_name",
      severity: "blocker",
      title: "Package name is missing",
      detail: "Add a customer-facing package name before this package is ready for quoting.",
      targetSection: "overview",
      targetField: "name",
      actionLabel: "Add package name"
    });
  }

  if (!(pricePerPerson > 0)) {
    reasons.push({
      code: "missing_positive_price",
      severity: "blocker",
      title: "Selling price is missing",
      detail: "Record a package price above $0 before this package is ready for quoting.",
      targetSection: "pricing",
      targetField: "ppp",
      actionLabel: "Record package price"
    });
  }

  if (combinedReferenceCounts.missing > 0 || combinedReferenceCounts.invalid > 0) {
    reasons.push({
      code: "missing_or_invalid_reference",
      severity: "blocker",
      title: "Included records need correction",
      detail: `${summarizeReferenceCounts(combinedReferenceCounts)} must be fixed before this package can quote safely.`,
      targetSection: "includes",
      actionLabel: "Review included items"
    });
  }

  if (combinedReferenceCounts.inactive > 0) {
    reasons.push({
      code: "inactive_reference",
      severity: "review",
      title: "Inactive included records remain selected",
      detail: `${countLabel(combinedReferenceCounts.inactive, "inactive inclusion")} should be removed or replaced before activation.`,
      targetSection: "includes",
      actionLabel: "Resolve inactive inclusions"
    });
  }

  if (commercialSummary.costPerPerson === null) {
    reasons.push({
      code: "missing_package_cost",
      severity: "review",
      title: "Package cost is not recorded",
      detail: "Record a package cost to unlock contribution and margin evidence.",
      targetSection: "pricing",
      targetField: "costPpp",
      actionLabel: "Record package cost"
    });
  }

  if (commercialSummary.marginPct === null) {
    reasons.push({
      code: "margin_unavailable",
      severity: "review",
      title: "Margin is unavailable",
      detail: "Package margin stays unavailable until QuotePilot has a valid positive price and a recorded package cost.",
      targetSection: "pricing",
      actionLabel: "Complete package economics"
    });
  }

  if (!pricingConfirmationCurrent) {
    reasons.push({
      code: "catalog_pricing_unconfirmed",
      severity: "review",
      title: "Catalog pricing is not confirmed at the current revision",
      detail: "QuotePilot keeps package readiness separate from the catalog-wide pricing confirmation receipt.",
      targetSection: "pricing",
      actionLabel: "Confirm catalog pricing"
    });
  }

  if (includeLegacyLifecycleReview && lifecycleSource === "legacy_active_boolean") {
    reasons.push({
      code: "legacy_lifecycle_unreviewed",
      severity: "review",
      title: "Lifecycle still comes from the legacy active flag",
      detail: "This package still relies on compatibility lifecycle mapping and has no persisted workspace lifecycle yet.",
      targetSection: "evidence",
      actionLabel: "Review lifecycle mapping"
    });
  }

  return reasons;
}

function deriveReadiness(reasons = []) {
  if (reasons.some((reason) => reason.severity === "blocker")) return "incomplete";
  if (reasons.some((reason) => reason.severity === "review")) return "needs_review";
  return "ready";
}

function buildUnavailableProjection(catalog = {}) {
  return {
    modelVersion: PACKAGE_WORKSPACE_MODEL_VERSION,
    available: false,
    package: null,
    commercialSummary: {
      pricingBasis: "per_person",
      pricePerPerson: 0,
      costPerPerson: null,
      contributionPerPerson: null,
      marginPct: null,
      marginState: "unavailable",
      includedCounts: {
        menuItems: 0,
        addons: 0,
        rentals: 0,
        total: 0
      }
    },
    referenceHealth: {
      menuItems: [],
      addons: [],
      rentals: [],
      counts: {
        total: 0,
        ok: 0,
        invalid: 0,
        missing: 0,
        inactive: 0,
        blocking: 0,
        review: 0
      }
    },
    evidence: {
      pricingConfirmationCurrent: isCatalogPricingConfirmationCurrent(catalog?.settings),
      pricingSetupConfirmed: catalog?.settings?.pricingSetupConfirmed === true,
      catalogRevision: Number.isSafeInteger(Number(catalog?.settings?.catalogRevision))
        ? Number(catalog.settings.catalogRevision)
        : null
    },
    quoteBehaviorSummary: {
      autoAddsInclusions: false,
      selectedIncludedItemsAreZeroDollar: true,
      description: "Package inclusions stay optional in Quote Builder and charge $0 only when the estimator selects them."
    },
    readiness: "incomplete",
    reasons: [{
      code: "unavailable_package_record",
      severity: "blocker",
      title: "Package record is unavailable",
      detail: "Select a valid package record before QuotePilot can build workspace health.",
      targetSection: "overview",
      actionLabel: "Select a package"
    }],
    nextAction: {
      code: "unavailable_package_record",
      label: "Select a package",
      targetSection: "overview"
    }
  };
}

function packageSortLabel(packageRecord = {}) {
  return (text(packageRecord?.name) || text(packageRecord?.id)).toLowerCase();
}

export function buildPackageWorkspaceModel({
  packageRecord,
  catalog = {},
  menuItems = [],
  pricingConfirmationCurrent = isCatalogPricingConfirmationCurrent(catalog?.settings),
  includeLegacyLifecycleReview = false
} = {}) {
  const packageId = text(packageRecord?.id);
  if (!packageId) {
    return buildUnavailableProjection(catalog);
  }

  const lifecycle = resolveLifecycle(packageRecord);
  const commercialSummary = buildCommercialSummary(packageRecord);
  const menuHealth = buildReferenceHealth(
    packageRecord?.includedMenuItemIds,
    buildRecordMap(flattenMenuItems(menuItems, catalog)),
    "menu_item"
  );
  const addonHealth = buildReferenceHealth(
    packageRecord?.includedAddonIds,
    buildRecordMap(catalog?.addons || []),
    "addon"
  );
  const rentalHealth = buildReferenceHealth(
    packageRecord?.includedRentalIds,
    buildRecordMap(catalog?.rentals || []),
    "rental"
  );
  const combinedReferenceCounts = mergeReferenceCounts([
    menuHealth.counts,
    addonHealth.counts,
    rentalHealth.counts
  ]);
  const reasons = buildReasons({
    packageRecord,
    commercialSummary,
    combinedReferenceCounts,
    pricingConfirmationCurrent,
    includeLegacyLifecycleReview,
    lifecycleSource: lifecycle.source
  });

  return {
    modelVersion: PACKAGE_WORKSPACE_MODEL_VERSION,
    available: true,
    package: {
      id: packageId,
      name: text(packageRecord?.name),
      displayName: text(packageRecord?.name) || packageId,
      pricingBasis: "per_person",
      pricePerPerson: commercialSummary.pricePerPerson,
      costPerPerson: commercialSummary.costPerPerson,
      lifecycle: lifecycle.value,
      lifecycleSource: lifecycle.source,
      active: lifecycle.value === LIFECYCLE_ACTIVE,
      includedMenuItemIds: idList(packageRecord?.includedMenuItemIds),
      includedAddonIds: idList(packageRecord?.includedAddonIds),
      includedRentalIds: idList(packageRecord?.includedRentalIds)
    },
    commercialSummary,
    referenceHealth: {
      menuItems: menuHealth.references,
      addons: addonHealth.references,
      rentals: rentalHealth.references,
      counts: {
        ...combinedReferenceCounts,
        blocking: combinedReferenceCounts.missing + combinedReferenceCounts.invalid,
        review: combinedReferenceCounts.inactive
      }
    },
    evidence: {
      pricingConfirmationCurrent,
      pricingSetupConfirmed: catalog?.settings?.pricingSetupConfirmed === true,
      catalogRevision: Number.isSafeInteger(Number(catalog?.settings?.catalogRevision))
        ? Number(catalog.settings.catalogRevision)
        : null
    },
    quoteBehaviorSummary: {
      autoAddsInclusions: false,
      selectedIncludedItemsAreZeroDollar: true,
      description: "Package inclusions stay optional in Quote Builder and charge $0 only when the estimator selects them."
    },
    readiness: deriveReadiness(reasons),
    reasons,
    nextAction: reasons.length > 0
      ? {
          code: reasons[0].code,
          label: reasons[0].actionLabel,
          targetSection: reasons[0].targetSection,
          targetField: reasons[0].targetField || ""
        }
      : null
  };
}

export function buildPackageWorkspaceCollectionModel({
  catalog = {},
  menuItems = [],
  selectedPackageId = "",
  pricingConfirmationCurrent = isCatalogPricingConfirmationCurrent(catalog?.settings),
  includeLegacyLifecycleReview = false
} = {}) {
  const packages = (Array.isArray(catalog?.packages) ? catalog.packages : [])
    .filter((packageRecord) => text(packageRecord?.id))
    .slice()
    .sort((left, right) => {
      const labelResult = packageSortLabel(left).localeCompare(packageSortLabel(right), undefined, {
        numeric: true,
        sensitivity: "base"
      });
      if (labelResult !== 0) return labelResult;
      return text(left?.id).localeCompare(text(right?.id), undefined, {
        numeric: true,
        sensitivity: "base"
      });
    })
    .map((packageRecord) => buildPackageWorkspaceModel({
      packageRecord,
      catalog,
      menuItems,
      pricingConfirmationCurrent,
      includeLegacyLifecycleReview
    }));

  const resolvedSelectedPackageId = packages.some((entry) => entry.package?.id === selectedPackageId)
    ? selectedPackageId
    : (packages[0]?.package?.id || "");

  return {
    modelVersion: PACKAGE_WORKSPACE_MODEL_VERSION,
    selectedPackageId: resolvedSelectedPackageId,
    packageIds: packages.map((entry) => entry.package?.id || ""),
    packages,
    selectedPackage: packages.find((entry) => entry.package?.id === resolvedSelectedPackageId) || null
  };
}
