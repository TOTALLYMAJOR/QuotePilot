export const AMBIENT_PACKAGE_MENU_CATALOG_EVIDENCE_MODEL =
  "ambient-package-menu-catalog-evidence-v1";

const CURRENT_CATALOG_SOURCES = new Set(["firebase-org", "local-cache"]);

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactIso(value) {
  const candidate = text(value);
  if (!candidate) return "";
  const parsed = new Date(candidate);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === candidate
    ? candidate
    : "";
}

function immutable(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || Object.isFrozen(value) || seen.has(value)) {
    return value;
  }
  seen.add(value);
  Object.values(value).forEach((entry) => immutable(entry, seen));
  return Object.freeze(value);
}

/**
 * Adapts the exact catalog snapshot already held by the workspace into the
 * narrow evidence shape consumed by the Package and Menu intelligent objects.
 * It does not load, infer, price, mutate, or authorize anything.
 */
export function buildAmbientPackageMenuCatalogEvidence({
  organizationId = "",
  catalog = null
} = {}) {
  const scope = text(organizationId);
  const source = text(catalog?.source).toLowerCase();
  const observedAt = exactIso(catalog?.observedAtISO);
  const settings = record(catalog?.settings) ? catalog.settings : {};
  const catalogRevision = settings.catalogRevision;
  const packages = Array.isArray(catalog?.packages) ? catalog.packages : [];
  const addons = Array.isArray(catalog?.addons) ? catalog.addons : [];
  const rentals = Array.isArray(catalog?.rentals) ? catalog.rentals : [];
  const menuSections = Array.isArray(settings.menuSections) ? settings.menuSections : [];
  const upsellRules = Array.isArray(settings.upsellRules) ? settings.upsellRules : [];
  const error = text(catalog?.error);
  const structurallyScoped = Boolean(
    scope
    && Number.isSafeInteger(catalogRevision)
    && catalogRevision >= 0
    && Array.isArray(catalog?.packages)
    && Array.isArray(settings.menuSections)
  );
  const currentSource = CURRENT_CATALOG_SOURCES.has(source);
  const fresh = structurallyScoped
    && currentSource
    && Boolean(observedAt)
    && catalog?.loading !== true
    && !error;
  const stale = structurallyScoped
    && currentSource
    && Boolean(observedAt)
    && Boolean(error);
  const reason = fresh
    ? ""
    : stale
      ? `The last usable ${source} catalog snapshot is retained, but its refresh reported: ${error}`
      : !scope
        ? "The active organization scope is unavailable."
        : !structurallyScoped
          ? "The catalog snapshot lacks an exact revision or complete package/menu collections."
          : !currentSource
            ? `Catalog source ${source || "unavailable"} is not an observed tenant catalog snapshot.`
            : !observedAt
              ? "The catalog loader did not record an exact observation time."
              : catalog?.loading === true
                ? "The tenant catalog refresh is still in progress."
                : "The tenant catalog snapshot is not current.";

  return immutable({
    modelId: AMBIENT_PACKAGE_MENU_CATALOG_EVIDENCE_MODEL,
    organizationId: scope,
    sourceLabel: source || "catalog-source-unavailable",
    catalogRevision: Number.isSafeInteger(catalogRevision) && catalogRevision >= 0
      ? catalogRevision
      : 0,
    freshness: {
      state: fresh ? "fresh" : stale ? "stale" : "unknown",
      observedAtISO: observedAt || null,
      reason
    },
    packages: packages.map((item) => ({ ...item })),
    // Functions cannot cross the presentation-evidence boundary. Quantity
    // policy is represented by the recorded pricing type and divisor instead.
    addons: addons.map(({ qtyRule: _qtyRule, ...item }) => ({ ...item })),
    rentals: rentals.map(({ qtyRule: _qtyRule, ...item }) => ({ ...item })),
    upsellRules: upsellRules.map((item) => ({ ...item })),
    menuSections: menuSections.map((section) => ({
      ...section,
      items: Array.isArray(section?.items)
        ? section.items.map((item) => ({ ...item }))
        : section?.items
    }))
  });
}
