import {
  buildClientCalculationImpactPreview,
  buildCommercialChangeSimulationImpactPreview
} from "./impactPreviewAdapter";
import { calculateQuote } from "./quoteCalculator";
import {
  hydrateSavedQuoteDraft,
  resolveQuoteDraftRevisionId
} from "./quoteDraftRuntime";
import { buildMarginPresentationFromCommercialSnapshot } from "./commercialSnapshot";

export const AMBIENT_PRICING_PREVIEW_SCHEMA_VERSION = "ambient-pricing-preview-host-v1";
export const AMBIENT_PRICING_MARGIN_CONTEXT_SCHEMA_VERSION =
  "ambient-pricing-margin-context-v1";
export const AMBIENT_SAVED_PRICING_MARGIN_MODEL = "margin-presentation-v1";
export const AMBIENT_SAVED_PRICING_MARGIN_SOURCE_LABEL =
  "Current tenant catalog staff-only cost context";
export const AMBIENT_SAVED_PRICING_MARGIN_SNAPSHOT_SOURCE_LABEL =
  "Saved quote staff-only cost snapshot";
export const AMBIENT_PRICING_MARGIN_BOUNDARY =
  "Margin context is staff-only advisory evidence from the loaded client catalog. It is never customer output, accounting revenue, authoritative repricing, authorization, or permission to save, send, accept, book, or charge.";

const REQUEST_ID_PATTERN = /^change_sim_[a-f0-9]{32}$/u;
const SERVER_SOURCE = "firebase";
const LOCAL_SOURCE = "local";

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}

function exactIso(value) {
  const normalized = text(value);
  if (!normalized) return "";
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized
    ? ""
    : normalized;
}

function opaqueId(value) {
  const normalized = text(value);
  if (
    !normalized
    || normalized.length > 256
    || /[\s/?#\\\u0000]/u.test(normalized)
    || normalized === "."
    || normalized === ".."
    || /^[^@\s]+@[^@\s]+$/u.test(normalized)
  ) return "";
  return normalized;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function uniqueText(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

export class AmbientPricingPreviewError extends Error {
  constructor(code, message, {
    requestId = "",
    definitive = true,
    cause = undefined
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AmbientPricingPreviewError";
    this.code = code;
    this.userMessage = message;
    this.requestId = definitive ? "" : text(requestId);
    this.definitive = definitive === true;
  }
}

function fail(code, message, options) {
  throw new AmbientPricingPreviewError(code, message, options);
}

function retainedRequestOptions(requestId, cause) {
  const exactRequestId = REQUEST_ID_PATTERN.test(text(requestId)) ? text(requestId) : "";
  return {
    requestId: exactRequestId,
    definitive: !exactRequestId,
    cause
  };
}

function validateHostScope({ source, organizationId, quote, guestCount, timestamp, requestId }) {
  const normalizedSource = text(source).toLowerCase();
  const normalizedOrganizationId = opaqueId(organizationId);
  const quoteId = opaqueId(quote?.id);
  const evaluatedAt = exactIso(timestamp);
  const normalizedRequestId = text(requestId).toLowerCase();

  if (![LOCAL_SOURCE, SERVER_SOURCE].includes(normalizedSource)) {
    fail(
      "preview_source_invalid",
      "Pricing preview requires an exact local or Firebase quote source.",
      retainedRequestOptions(normalizedRequestId)
    );
  }
  if (!normalizedOrganizationId) {
    fail(
      "organization_scope_missing",
      "Pricing preview requires the exact active organization scope.",
      retainedRequestOptions(normalizedRequestId)
    );
  }
  if (!quoteId) {
    fail(
      "quote_scope_missing",
      "Pricing preview requires an exact saved quote identity.",
      retainedRequestOptions(normalizedRequestId)
    );
  }
  if (!evaluatedAt) {
    fail(
      "preview_timestamp_invalid",
      "Pricing preview requires an exact evaluation timestamp.",
      retainedRequestOptions(normalizedRequestId)
    );
  }
  const normalizedGuestCount = Number(guestCount);
  if (!Number.isInteger(normalizedGuestCount) || normalizedGuestCount < 1 || normalizedGuestCount > 400) {
    fail(
      "guest_count_out_of_bounds",
      "Pricing preview guest count must be a whole number from 1 through 400.",
      retainedRequestOptions(normalizedRequestId)
    );
  }
  if (normalizedRequestId && !REQUEST_ID_PATTERN.test(normalizedRequestId)) {
    fail(
      "simulation_request_id_invalid",
      "The saved pricing request ID cannot be used to safely check its status.",
      { definitive: true }
    );
  }
  if (normalizedSource === LOCAL_SOURCE && normalizedRequestId) {
    fail(
      "pending_server_request_requires_reconciliation",
      "Check the previous connected pricing request before using local pricing.",
      { requestId: normalizedRequestId, definitive: false }
    );
  }

  return {
    source: normalizedSource,
    organizationId: normalizedOrganizationId,
    quoteId,
    guestCount: normalizedGuestCount,
    timestamp: evaluatedAt,
    requestId: normalizedRequestId
  };
}

function defaultDraftForm(settings) {
  const taxRegions = Array.isArray(settings?.taxRegions) ? settings.taxRegions : [];
  return {
    style: "",
    pkg: "",
    taxRegion: text(settings?.defaultTaxRegion || taxRegions[0]?.id),
    seasonProfileId: text(settings?.defaultSeasonProfile) || "auto",
    payMethod: "card"
  };
}

function hydrateSavedPricingForm({ quote, organizationId, catalog, settings, requestId = "" }) {
  if (!record(catalog) || !Array.isArray(catalog.packages)) {
    fail(
      "catalog_unavailable",
      "The current tenant catalog is unavailable for this pricing preview.",
      retainedRequestOptions(requestId)
    );
  }
  if (!record(settings)) {
    fail(
      "pricing_settings_unavailable",
      "The current tenant pricing settings are unavailable for this preview.",
      retainedRequestOptions(requestId)
    );
  }

  const selectedPackageId = text(quote?.selection?.packageId);
  if (
    !selectedPackageId
    || !catalog.packages.some((item) => text(item?.id) === selectedPackageId && item?.active !== false)
  ) {
    fail(
      "saved_package_evidence_missing",
      "The saved quote package is absent from the current tenant catalog, so the scenario cannot be priced safely.",
      retainedRequestOptions(requestId)
    );
  }

  const quoteOrganizationId = opaqueId(quote?.organizationId);
  if (quoteOrganizationId && quoteOrganizationId !== organizationId) {
    fail(
      "organization_scope_mismatch",
      "The selected quote does not belong to the active organization scope.",
      retainedRequestOptions(requestId)
    );
  }

  const current = hydrateSavedQuoteDraft({
    quote,
    previousForm: defaultDraftForm(settings),
    catalogPackages: catalog.packages,
    organizationId
  });
  if (!current?.ok) {
    fail(
      current?.code || "saved_draft_unavailable",
      current?.reason || "The exact saved quote draft could not be hydrated.",
      retainedRequestOptions(requestId)
    );
  }
  if (current.editingQuote.organizationId !== organizationId) {
    fail(
      "hydrated_scope_mismatch",
      "The hydrated quote draft does not match the active organization scope.",
      retainedRequestOptions(requestId)
    );
  }

  const currentGuestCount = Number(current.form.guests);
  const pricingGuestCount = Number(quote?.pricing?.inputs?.event?.guests);
  if (
    Number.isFinite(pricingGuestCount)
    && pricingGuestCount > 0
    && pricingGuestCount !== currentGuestCount
  ) {
    fail(
      "saved_pricing_scope_mismatch",
      "The saved pricing details and event record show different guest counts. Refresh the latest quote before simulating.",
      retainedRequestOptions(requestId)
    );
  }
  if (!Number.isInteger(currentGuestCount) || currentGuestCount < 1 || currentGuestCount > 400) {
    fail(
      "saved_guest_count_invalid",
      "The saved quote does not contain a supported guest count for comparison.",
      retainedRequestOptions(requestId)
    );
  }
  return { current, currentGuestCount };
}

function hydratePricingScenarios({ quote, organizationId, guestCount, catalog, settings, requestId }) {
  const saved = hydrateSavedPricingForm({
    quote,
    organizationId,
    catalog,
    settings,
    requestId
  });
  const { current, currentGuestCount } = saved;
  if (currentGuestCount === guestCount) {
    fail(
      "pricing_scenario_unchanged",
      "Choose a guest count different from the saved quote before requesting a pricing counterfactual.",
      retainedRequestOptions(requestId)
    );
  }

  const proposed = hydrateSavedQuoteDraft({
    quote,
    previousForm: defaultDraftForm(settings),
    catalogPackages: catalog.packages,
    organizationId,
    ambientEnabled: true,
    draftPatch: {
      source: "ambient-pricing-scenario-v1",
      baseRevisionId: current.sourceRevisionId,
      event: { guests: guestCount }
    }
  });
  if (!proposed?.ok || proposed.form.guests !== guestCount) {
    fail(
      proposed?.code || "pricing_scenario_hydration_failed",
      proposed?.reason || "The guest-count scenario could not be prepared.",
      retainedRequestOptions(requestId)
    );
  }

  return { ...saved, proposed };
}

function pricingDependencies(currentGuestCount, guestCount) {
  return [
    {
      object: { id: "staffing", type: "operational_fact", label: "Staffing" },
      relationship: "Guest count can change both quoted labor and operational coverage requirements.",
      consequence: `Review staffing evidence when moving from ${currentGuestCount} to ${guestCount} guests.`
    },
    {
      object: { id: "catalog-scope", type: "commercial_dependency", label: "Package, menu, and extras" },
      relationship: "Per-person and quantity-aware selections depend on guest count.",
      consequence: "Package, menu, add-on, and rental amounts may change in the scenario."
    },
    {
      object: { id: "deposit-policy", type: "commercial_dependency", label: "Deposit policy" },
      relationship: "The deposit requirement is derived from the calculated total and tenant policy.",
      consequence: "A changed total may change the deposit requirement without creating a payment request."
    },
    {
      object: { id: "margin", type: "commercial_dependency", label: "Margin" },
      relationship: "Quoted amounts and recorded cost coverage can change when the scope changes.",
      consequence: "Margin stays unavailable unless every selected cost counterpart is recorded."
    }
  ];
}

function previewLanguage({ quote, currentGuestCount, guestCount }) {
  const savedTotal = Number(quote?.pricing?.grandTotal ?? quote?.totals?.total);
  return {
    why: `The active scenario changes guest count from ${currentGuestCount} to ${guestCount}.`,
    consequence: "The counterfactual reveals commercial and dependency effects while leaving the saved quote unchanged.",
    doNothing: Number.isFinite(savedTotal)
      ? `The saved quote remains ${money(savedTotal)} for ${currentGuestCount} guests.`
      : `The saved quote remains unchanged for ${currentGuestCount} guests; its exact total is unavailable on this record.`
  };
}

function unavailableMargin(reason, missing = []) {
  return deepFreeze({
    schemaVersion: AMBIENT_PRICING_MARGIN_CONTEXT_SCHEMA_VERSION,
    status: "unavailable",
    authority: "advisory_client_cost_context",
    current: null,
    proposed: null,
    deltas: null,
    missing: uniqueText(missing),
    unavailableReasons: [text(reason) || "Complete margin evidence is unavailable."],
    boundary: AMBIENT_PRICING_MARGIN_BOUNDARY
  });
}

function normalizeMargin(value) {
  if (!record(value) || value.available !== true) return null;
  const revenue = Number(value.revenue);
  const cost = Number(value.cost);
  const marginPct = Number(value.marginPct);
  const target = value.target === null || value.target === undefined
    ? null
    : Number(value.target);
  if (
    !finite(revenue)
    || !(revenue > 0)
    || !finite(cost)
    || cost < 0
    || !finite(marginPct)
    || Math.abs(((revenue - cost) / revenue) - marginPct) > 1e-9
    || (target !== null && (!finite(target) || target < 0 || target > 1))
  ) return null;
  return {
    revenue,
    cost,
    marginPct,
    target,
    targetGap: target !== null && marginPct < target
      ? { points: (target - marginPct) * 100, amount: revenue * (target - marginPct) }
      : null
  };
}

/**
 * Builds staff-only client margin context. Server simulation receipts do not
 * contain complete cost-line evidence, so they intentionally fail closed here.
 */
export function buildAmbientPricingMarginContext({
  previewKind,
  currentForm,
  proposedForm,
  catalog,
  settings,
  evaluateMargin
} = {}) {
  if (previewKind !== "client_calculation") {
    return unavailableMargin(
      "Connected pricing does not include the complete staff-only cost details needed for margin, so margin remains unavailable here."
    );
  }
  if (typeof evaluateMargin !== "function") {
    return unavailableMargin("Margin could not be calculated for this pricing preview.");
  }
  if (!record(currentForm) || !record(proposedForm) || !record(catalog) || !record(settings)) {
    return unavailableMargin("The quote details, catalog, or pricing settings needed to calculate margin are unavailable.");
  }

  let currentResult;
  let proposedResult;
  try {
    const currentTotals = calculateQuote(currentForm, catalog, settings);
    const proposedTotals = calculateQuote(proposedForm, catalog, settings);
    currentResult = evaluateMargin({
      form: currentForm,
      totals: currentTotals,
      catalog,
      settings
    });
    proposedResult = evaluateMargin({
      form: proposedForm,
      totals: proposedTotals,
      catalog,
      settings
    });
  } catch {
    return unavailableMargin("Margin could not be calculated for both the current and proposed scenarios.");
  }

  const current = normalizeMargin(currentResult);
  const proposed = normalizeMargin(proposedResult);
  if (!current || !proposed) {
    const missing = [
      ...(Array.isArray(currentResult?.missing) ? currentResult.missing : []),
      ...(Array.isArray(proposedResult?.missing) ? proposedResult.missing : [])
    ];
    return unavailableMargin(
      "Complete recorded cost coverage is required for both sides of the margin counterfactual.",
      missing
    );
  }

  return deepFreeze({
    schemaVersion: AMBIENT_PRICING_MARGIN_CONTEXT_SCHEMA_VERSION,
    status: "available",
    authority: "advisory_client_cost_context",
    current,
    proposed,
    deltas: {
      revenue: proposed.revenue - current.revenue,
      cost: proposed.cost - current.cost,
      marginPoints: (proposed.marginPct - current.marginPct) * 100
    },
    missing: [],
    unavailableReasons: [],
    boundary: AMBIENT_PRICING_MARGIN_BOUNDARY
  });
}

function unavailableSavedMargin(
  reason,
  missing = [],
  code = "margin_evidence_unavailable",
  missingCount = null,
  {
    evidenceAuthority = "advisory_current_catalog_cost_context",
    sourceLabel = AMBIENT_SAVED_PRICING_MARGIN_SOURCE_LABEL
  } = {}
) {
  const namedMissing = uniqueText(missing);
  const normalizedMissingCount = Number.isSafeInteger(Number(missingCount))
    && Number(missingCount) >= namedMissing.length
      ? Number(missingCount)
      : namedMissing.length;
  return deepFreeze({
    modelId: AMBIENT_SAVED_PRICING_MARGIN_MODEL,
    available: false,
    missingCount: normalizedMissingCount,
    missing: namedMissing,
    note: text(reason) || "Margins unavailable because complete current-catalog cost evidence is missing.",
    evidenceAuthority,
    sourceLabel,
    evidenceCode: code,
    boundary: AMBIENT_PRICING_MARGIN_BOUNDARY
  });
}

/**
 * Prefer the saved quote's private commercial snapshot when it exists.
 * Legacy quotes without that snapshot still hydrate the exact saved form and
 * evaluate against the currently loaded tenant catalog. Neither path is
 * customer output or server-authoritative repricing.
 */
export function buildSavedAmbientPricingMargin({
  organizationId,
  quote,
  catalog,
  settings = catalog?.settings,
  evaluateMargin
} = {}) {
  const normalizedOrganizationId = opaqueId(organizationId);
  if (!normalizedOrganizationId) {
    return unavailableSavedMargin(
      "Margins unavailable because the exact active organization scope is missing.",
      ["Active organization scope"],
      "organization_scope_missing"
    );
  }
  const quoteOrganizationId = opaqueId(quote?.organizationId);
  if (quoteOrganizationId && quoteOrganizationId !== normalizedOrganizationId) {
    return unavailableSavedMargin(
      "Margins unavailable because the selected quote does not belong to the active organization scope.",
      ["Active organization scope"],
      "organization_scope_mismatch"
    );
  }

  const savedCommercialSnapshot = record(quote?.pricing?.commercialSnapshot)
    ? quote.pricing.commercialSnapshot
    : null;
  if (savedCommercialSnapshot) {
    const evaluated = buildMarginPresentationFromCommercialSnapshot({
      commercialSnapshot: savedCommercialSnapshot,
      totals: quote?.totals || {}
    });
    if (!record(evaluated) || evaluated.available !== true) {
      return unavailableSavedMargin(
        evaluated?.note
          || "Margins unavailable until every selected saved cost counterpart is recorded.",
        Array.isArray(evaluated?.missing) ? evaluated.missing : [],
        "cost_evidence_incomplete",
        evaluated?.missingCount,
        {
          evidenceAuthority: "advisory_saved_cost_snapshot",
          sourceLabel: AMBIENT_SAVED_PRICING_MARGIN_SNAPSHOT_SOURCE_LABEL
        }
      );
    }
    const normalized = normalizeMargin(evaluated);
    if (!normalized) {
      return unavailableSavedMargin(
        "Margins are unavailable because the saved commercial snapshot is inconsistent.",
        ["Consistent revenue, cost, and margin evidence"],
        "margin_evidence_inconsistent",
        null,
        {
          evidenceAuthority: "advisory_saved_cost_snapshot",
          sourceLabel: AMBIENT_SAVED_PRICING_MARGIN_SNAPSHOT_SOURCE_LABEL
        }
      );
    }
    return deepFreeze({
      ...evaluated,
      modelId: text(evaluated.modelId) || AMBIENT_SAVED_PRICING_MARGIN_MODEL,
      available: true,
      revenue: normalized.revenue,
      cost: normalized.cost,
      marginPct: normalized.marginPct,
      target: normalized.target,
      evidenceAuthority: "advisory_saved_cost_snapshot",
      sourceLabel: AMBIENT_SAVED_PRICING_MARGIN_SNAPSHOT_SOURCE_LABEL,
      sourceRevisionId: resolveQuoteDraftRevisionId(quote),
      boundary: AMBIENT_PRICING_MARGIN_BOUNDARY
    });
  }

  if (typeof evaluateMargin !== "function") {
    return unavailableSavedMargin(
      "Margins are unavailable because the margin calculation could not run.",
      ["Margin calculation"],
      "margin_evaluator_missing"
    );
  }

  let saved;
  try {
    saved = hydrateSavedPricingForm({
      quote,
      organizationId: normalizedOrganizationId,
      catalog,
      settings
    });
  } catch (error) {
    return unavailableSavedMargin(
      error?.userMessage || "Margins unavailable because the exact saved form could not be hydrated.",
      [error?.userMessage || "Exact saved quote form"],
      error?.code || "saved_form_unavailable"
    );
  }

  let evaluated;
  try {
    const totals = calculateQuote(saved.current.form, catalog, settings);
    evaluated = evaluateMargin({
      form: saved.current.form,
      totals,
      catalog,
      settings
    });
  } catch {
    return unavailableSavedMargin(
      "Margins are unavailable because the current-catalog calculation did not finish.",
      ["Current tenant catalog margin evaluation"],
      "margin_evaluation_failed"
    );
  }

  if (!record(evaluated) || evaluated.available !== true) {
    return unavailableSavedMargin(
      evaluated?.note
        || "Margins unavailable until every selected current-catalog cost counterpart is recorded.",
      Array.isArray(evaluated?.missing) ? evaluated.missing : [],
      "cost_evidence_incomplete",
      evaluated?.missingCount
    );
  }
  const normalized = normalizeMargin(evaluated);
  if (!normalized) {
    return unavailableSavedMargin(
      "Margins are unavailable because the calculated revenue, cost, and margin do not agree.",
      ["Consistent revenue, cost, and margin evidence"],
      "margin_evidence_inconsistent"
    );
  }

  return deepFreeze({
    ...evaluated,
    modelId: text(evaluated.modelId) || AMBIENT_SAVED_PRICING_MARGIN_MODEL,
    available: true,
    revenue: normalized.revenue,
    cost: normalized.cost,
    marginPct: normalized.marginPct,
    target: normalized.target,
    evidenceAuthority: "advisory_current_catalog_cost_context",
    sourceLabel: AMBIENT_SAVED_PRICING_MARGIN_SOURCE_LABEL,
    sourceRevisionId: saved.current.sourceRevisionId,
    boundary: AMBIENT_PRICING_MARGIN_BOUNDARY
  });
}

function classifyDefinitive(error, isDefinitiveError) {
  if (error?.definitive === true) return true;
  if (typeof isDefinitiveError !== "function") return false;
  try {
    return isDefinitiveError(error) === true;
  } catch {
    return false;
  }
}

function exactRequestId({ requestId, createRequestId }) {
  if (REQUEST_ID_PATTERN.test(requestId)) return requestId;
  if (typeof createRequestId !== "function") {
    fail(
      "simulation_request_id_missing",
      "Connected pricing simulation requires an exact request identity.",
      { definitive: true }
    );
  }
  let created;
  try {
    created = text(createRequestId("simulation")).toLowerCase();
  } catch (error) {
    fail(
      "simulation_request_id_generation_failed",
      "A safe pricing simulation request identity could not be created.",
      { definitive: true, cause: error }
    );
  }
  if (!REQUEST_ID_PATTERN.test(created)) {
    fail(
      "simulation_request_id_invalid",
      "The generated pricing simulation request identity is invalid.",
      { definitive: true }
    );
  }
  return created;
}

/**
 * Hosts the Ambient Pricing preview without importing Firebase or provider
 * code. Connected execution occurs only through the caller-injected function.
 */
export async function prepareAmbientPricingPreview(input = {}) {
  const scope = validateHostScope(input);
  const settings = input.settings ?? input.catalog?.settings;
  const baseRevision = resolveQuoteDraftRevisionId(input.quote);
  if (!baseRevision) {
    fail(
      "saved_revision_missing",
      "Pricing preview requires the exact saved quote revision; refresh this opportunity before simulating.",
      retainedRequestOptions(scope.requestId)
    );
  }
  const scenarios = hydratePricingScenarios({
    quote: input.quote,
    organizationId: scope.organizationId,
    guestCount: scope.guestCount,
    catalog: input.catalog,
    settings,
    requestId: scope.requestId
  });
  const language = previewLanguage({
    quote: input.quote,
    currentGuestCount: scenarios.currentGuestCount,
    guestCount: scope.guestCount
  });
  const affectedDependencies = pricingDependencies(
    scenarios.currentGuestCount,
    scope.guestCount
  );
  const object = { id: scope.quoteId, type: "pricing", label: "Pricing" };

  if (scope.source === LOCAL_SOURCE) {
    let preview;
    try {
      preview = buildClientCalculationImpactPreview({
        id: `pricing:${scope.quoteId}:${baseRevision}:${scope.guestCount}:client`,
        object,
        baseRevision,
        currentForm: scenarios.current.form,
        proposedForm: scenarios.proposed.form,
        catalog: input.catalog,
        settings,
        factDeltas: [{
          field: "guests",
          before: scenarios.currentGuestCount,
          after: scope.guestCount
        }],
        affectedDependencies,
        calculatedAt: scope.timestamp,
        currency: text(settings.currency || input.quote?.pricing?.currency || "USD"),
        sourceId: `client-calculator:${scope.organizationId}:${scope.quoteId}:${baseRevision}:${scope.guestCount}`,
        sourceLabel: "Current tenant catalog calculation",
        ...language
      });
    } catch (error) {
      fail(
        "client_pricing_preview_invalid",
        "The pricing preview did not include all details needed for a safe comparison.",
        { definitive: true, cause: error }
      );
    }
    if (preview.status !== "partial") {
      fail(
        "client_pricing_evidence_incomplete",
        preview.unavailableReasons?.[0] || "The loaded client pricing evidence is incomplete.",
        { definitive: true }
      );
    }
    const marginContext = buildAmbientPricingMarginContext({
      previewKind: preview.previewKind,
      currentForm: scenarios.current.form,
      proposedForm: scenarios.proposed.form,
      catalog: input.catalog,
      settings,
      evaluateMargin: input.evaluateMargin
    });
    return deepFreeze({
      schemaVersion: AMBIENT_PRICING_PREVIEW_SCHEMA_VERSION,
      mode: "client",
      preview,
      requestId: "",
      marginContext
    });
  }

  if (typeof input.simulate !== "function") {
    fail(
      "server_simulation_unavailable",
      "Connected pricing is unavailable. Local pricing will not replace a connected result.",
      retainedRequestOptions(scope.requestId)
    );
  }
  const activeRevisionId = text(scenarios.current.editingQuote.activeVersionId);
  if (!activeRevisionId || activeRevisionId !== baseRevision) {
    fail(
      "active_revision_missing",
      "Connected pricing needs the exact currently saved quote version.",
      retainedRequestOptions(scope.requestId)
    );
  }
  const requestId = exactRequestId({
    requestId: scope.requestId,
    createRequestId: input.createRequestId
  });

  let result;
  try {
    result = await input.simulate({
      organizationId: scope.organizationId,
      quoteId: scope.quoteId,
      expectedActiveVersionId: activeRevisionId,
      requestId,
      form: scenarios.proposed.form
    });
  } catch (error) {
    const definitive = classifyDefinitive(error, input.isDefinitiveError);
    fail(
      definitive ? "server_simulation_rejected" : "server_simulation_uncertain",
      definitive
        ? "Connected pricing rejected this request. Correct the source details before starting a new one."
        : "QuotePilot could not confirm the pricing result. Try the same request again before starting a different simulation.",
      { requestId, definitive, cause: error }
    );
  }

  if (
    result?.organizationId !== scope.organizationId
    || result?.quoteId !== scope.quoteId
  ) {
    fail(
      "server_simulation_scope_mismatch",
      "The connected pricing result belongs to a different organization or quote.",
      { requestId, definitive: false }
    );
  }

  let preview;
  try {
    preview = buildCommercialChangeSimulationImpactPreview({
      id: `pricing:${scope.quoteId}:${baseRevision}:${scope.guestCount}:server`,
      object,
      baseRevision,
      result,
      evaluatedAt: scope.timestamp,
      ...language
    });
  } catch (error) {
    fail(
      "server_pricing_preview_invalid",
      "The connected pricing result did not include all details needed for a safe comparison.",
      { requestId, definitive: false, cause: error }
    );
  }

  if (
    preview.status !== "available"
    || !preview.receipt
    || preview.receipt.requestId !== requestId
  ) {
    const definitive = Boolean(preview.receipt && preview.receipt.requestId === requestId);
    fail(
      definitive ? "server_simulation_receipt_unusable" : "server_simulation_receipt_uncertain",
      preview.unavailableReasons?.[0]
        || "The connected pricing result does not match the exact request that created it.",
      { requestId, definitive }
    );
  }
  if (preview.baseRevision !== activeRevisionId) {
    fail(
      "server_simulation_revision_changed",
      "This connected pricing result belongs to a different saved quote version. Refresh before simulating again.",
      { requestId, definitive: true }
    );
  }
  const guestDelta = preview.deltas.find((delta) => delta.field === "fact.event.guest_count");
  if (
    !guestDelta
    || guestDelta.before !== scenarios.currentGuestCount
    || guestDelta.after !== scope.guestCount
  ) {
    fail(
      "server_simulation_fact_mismatch",
      "The connected pricing result does not include the requested guest-count comparison.",
      { requestId, definitive: true }
    );
  }

  return deepFreeze({
    schemaVersion: AMBIENT_PRICING_PREVIEW_SCHEMA_VERSION,
    mode: "server",
    preview,
    requestId,
    marginContext: buildAmbientPricingMarginContext({ previewKind: preview.previewKind })
  });
}
