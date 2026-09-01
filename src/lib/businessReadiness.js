import { isCatalogPricingConfirmationCurrent } from "./catalogPricingConfirmation";

export const BUSINESS_READINESS_MODEL = "business-readiness-v1";
export const SETUP_ROW_STATUSES = Object.freeze([
  "Ready",
  "Needs review",
  "Unavailable by policy",
  "Connection required"
]);

const ROWS = Object.freeze([
  ["identity", "Identity", "pricing"],
  ["offerings", "Offerings", "menu"],
  ["pricing", "Pricing", "pricing"],
  ["costs", "Costs and margin evidence", "pricing"],
  ["starting-points", "Quote starting points", "eventTemplates"],
  ["staffing", "Staffing policy", "pricing"],
  ["users", "Users and roles", "users"],
  ["connections", "Connections", "connections"]
]);

function active(records) {
  return (Array.isArray(records) ? records : []).filter((item) => item?.active !== false);
}

function recordedMoney(value) {
  return value !== "" && value !== null && value !== undefined
    && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function positiveMoney(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function managedMenuItems(catalog = {}) {
  const managed = Array.isArray(catalog.managedMenuItems) ? catalog.managedMenuItems : [];
  if (managed.length) return managed;
  return (catalog.settings?.menuSections || []).flatMap((section) => section?.items || []);
}

function costCoverage(catalog = {}) {
  const settings = catalog.settings || {};
  const records = [
    ...active(catalog.packages).map((item) => ({ label: item.name || "Package", value: item.costPpp })),
    ...active(catalog.addons).map((item) => ({ label: item.name || "Add-on", value: item.cost })),
    ...active(catalog.rentals).map((item) => ({ label: item.name || "Rental", value: item.cost })),
    ...active(managedMenuItems(catalog)).map((item) => ({ label: item.name || "Menu item", value: item.cost }))
  ];
  if (settings.staffingLaborEnabled !== false) {
    records.push(
      { label: "Server labor", value: settings.serverCostRate },
      { label: "Chef labor", value: settings.chefCostRate },
      { label: "Bartender labor", value: settings.bartenderCostRate }
    );
  }
  const missing = records.filter((item) => !recordedMoney(item.value)).map((item) => item.label);
  return {
    recordedCount: records.length - missing.length,
    totalCount: records.length,
    missing,
    complete: records.length > 0 && missing.length === 0
  };
}

function pricingPoliciesValid(settings = {}) {
  const percentageKeys = ["serviceFeePct", "taxRate", "depositPct"];
  return percentageKeys.every((key) => (
    Number.isFinite(Number(settings[key])) && Number(settings[key]) >= 0 && Number(settings[key]) <= 1
  )) && ["perMileRate", "longDistancePerMileRate", "serverRate", "chefRate", "bartenderRate"]
    .every((key) => Number.isFinite(Number(settings[key])) && Number(settings[key]) >= 0);
}

function projection({ id, label, ready, reasonCode, evidenceAt, blocking, nextAction }) {
  return {
    id,
    label,
    ready: ready === true,
    reasonCode,
    evidenceAt: evidenceAt || null,
    blocking: blocking === true,
    nextAction
  };
}

export function buildBusinessReadiness({
  catalog = {},
  draftState = {},
  quoteDraftReady = false,
  proposalReady = false,
  providerConnected = false,
  currentUserRole = "admin"
} = {}) {
  const settings = catalog.settings || {};
  const menuItems = active(managedMenuItems(catalog));
  const packages = active(catalog.packages);
  const eventTypes = active(catalog.eventTypes);
  const authoritativeCatalog = catalog.source === "firebase" || catalog.source === "firebase-org";
  const namedPositivePackage = packages.some((item) => String(item?.name || "").trim() && positiveMoney(item.ppp));
  const hasEventAndMenu = eventTypes.some((item) => String(item?.name || "").trim()) && menuItems.length > 0;
  const policiesValid = pricingPoliciesValid(settings);
  const confirmationCurrent = isCatalogPricingConfirmationCurrent(settings);
  const businessReady = authoritativeCatalog && namedPositivePackage && hasEventAndMenu
    && policiesValid && confirmationCurrent;
  const costs = costCoverage(catalog);
  const draftReady = Number(draftState.changedRecordCount || 0) > 0
    && !draftState.deviceOnly && !["saving", "conflict", "sync_failed", "error"].includes(draftState.status);
  const isAdmin = String(currentUserRole || "").trim().toLowerCase() === "admin";
  const observedAt = catalog.observedAtISO || settings.pricingConfirmation?.confirmedAtISO || null;
  const projections = {
    businessReadyToQuote: projection({
      id: "business-ready-to-quote",
      label: "Business ready to quote",
      ready: businessReady,
      reasonCode: !authoritativeCatalog ? "authoritative_catalog_unavailable"
        : !namedPositivePackage ? "positive_package_required"
          : !hasEventAndMenu ? "event_type_and_menu_required"
            : !policiesValid ? "pricing_policy_invalid"
              : !confirmationCurrent ? "pricing_confirmation_outdated" : "ready",
      evidenceAt: observedAt,
      blocking: true,
      nextAction: businessReady ? { route: "library", label: "Start a quote" }
        : { route: "library/pricing", label: isAdmin ? "Review setup" : "Ask an administrator to review setup" }
    }),
    catalogDraftReadyToPublish: projection({
      id: "catalog-draft-ready-to-publish",
      label: "Catalog draft ready to publish",
      ready: draftReady,
      reasonCode: draftReady ? "ready" : draftState.deviceOnly ? "device_only_changes"
        : draftState.status === "conflict" ? "revision_conflict" : "no_publishable_changes",
      evidenceAt: draftState.updatedAtISO || null,
      blocking: false,
      nextAction: { route: "library", label: draftReady ? "Review and publish catalog" : "Continue setup" }
    }),
    quoteDraftReadyToSave: projection({
      id: "quote-draft-ready-to-save",
      label: "Quote draft ready to save",
      ready: quoteDraftReady,
      reasonCode: quoteDraftReady ? "ready" : "quote_context_not_open",
      evidenceAt: null,
      blocking: false,
      nextAction: { route: "opportunities", label: "Open a quote" }
    }),
    proposalReadyToSend: projection({
      id: "proposal-ready-to-send",
      label: "Proposal ready to send",
      ready: proposalReady,
      reasonCode: proposalReady ? "ready" : "proposal_context_not_open",
      evidenceAt: null,
      blocking: false,
      nextAction: { route: "opportunities", label: "Review a proposal" }
    }),
    marginEvidenceComplete: projection({
      id: "margin-evidence-complete",
      label: "Margin evidence complete",
      ready: costs.complete,
      reasonCode: costs.complete ? "ready" : "cost_evidence_missing",
      evidenceAt: observedAt,
      blocking: false,
      nextAction: { route: "library/costs", label: isAdmin ? "Record missing costs" : "Ask an administrator to record costs" }
    }),
    providerConnectionReady: projection({
      id: "provider-connection-ready",
      label: "Provider connection ready",
      ready: providerConnected,
      reasonCode: providerConnected ? "ready" : "connection_required",
      evidenceAt: null,
      blocking: false,
      nextAction: { route: "settings/connections", label: isAdmin ? "Review connections" : "Ask an administrator about connections" }
    })
  };

  const statusFor = (ready, fallback = "Needs review") => ready ? "Ready" : fallback;
  const rows = ROWS.map(([id, label, target]) => {
    if (id === "identity") return { id, label, status: statusFor(Boolean(settings.organizationName || catalog.organizationName)), nextAction: isAdmin ? "Review business identity" : "Ask an administrator", target };
    if (id === "offerings") return { id, label, status: statusFor(namedPositivePackage && hasEventAndMenu), nextAction: isAdmin ? "Open Menu Builder" : "Ask an administrator", target };
    if (id === "pricing") return { id, label, status: statusFor(policiesValid && confirmationCurrent), nextAction: isAdmin ? "Review pricing" : "Ask an administrator", target };
    if (id === "costs") return { id, label, status: statusFor(costs.complete), nextAction: isAdmin ? "Review cost gaps" : "Ask an administrator", target, detail: `${costs.recordedCount}/${costs.totalCount} costs recorded` };
    if (id === "starting-points") return { id, label, status: statusFor(active(settings.eventTemplates).length > 0), nextAction: isAdmin ? "Review quote starting points" : "Ask an administrator", target };
    if (id === "staffing") return { id, label, status: statusFor(policiesValid), nextAction: isAdmin ? "Review staffing policy" : "Ask an administrator", target };
    if (id === "users") return { id, label, status: isAdmin ? "Ready" : "Unavailable by policy", nextAction: isAdmin ? "Review users and roles" : "Contact an administrator", target };
    return { id, label, status: providerConnected ? "Ready" : "Connection required", nextAction: isAdmin ? "Review connections" : "Contact an administrator", target };
  });

  return { modelId: BUSINESS_READINESS_MODEL, rows, projections, costs, businessReady, isAdmin };
}
