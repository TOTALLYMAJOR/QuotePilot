import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./ambientSurfaceGrammar.css";
import AuthGate from "./components/AuthGate";
import CustomerPortalView from "quotepilot-active-customer-portal";
import { RebookQuoteReviewBanner } from "./components/CustomerRebookDraftAction";
import LiveBreakdown from "./components/LiveBreakdown";
import ProductBrandLockup from "./components/ProductBrandLockup";
import ActiveWorkspaceShell from "quotepilot-active-workspace-shell";
import {
  createRecoverableLazy,
  RecoverableErrorBoundary
} from "./components/RecoverableErrorBoundary";
import {
  useStickyMount,
  WorkspaceArrivalNotice,
  WorkspaceLazyRoute,
  WorkspaceLazyTool,
  WorkspaceToolSurface
} from "./components/WorkspaceSurfaceBoundary";
import { StepEvent, StepMenu, StepReview, StepServices } from "./components/WizardSteps";
import CreateIntake from "./components/CreateIntake";
import ChangeRequestPanel from "./components/ChangeRequestPanel";
import { parseIntentDraftWithModel } from "./lib/intentParseClient";
import { applyProposalToForm, proposalTouchedFields } from "./components/changeRequestParse";
import {
  isDefinitiveRecordError,
  linkChangeRequestResolutionVersion,
  recordChangeRequestParse
} from "./lib/changeRequestRecordClient";
import { useEventType } from "./context/EventTypeContext";
import { useOrganization } from "./context/OrganizationContext";
import { useWorkspaceNavigation } from "./context/WorkspaceNavigationContext";
import { DEFAULT_FEATURE_FLAGS, STAFF_RULES } from "./data/mockCatalog";
import { useCatalogData } from "./hooks/useCatalogData";
import { useCommercialWorkspaceSnapshot } from "./hooks/useCommercialWorkspaceSnapshot";
import {
  calculateQuotePricing,
  notifyOwnerNewQuote
} from "./lib/commerceOps";
import {
  isCommercialSearchAvailable,
  resolveCommercialSearchShortcutAction
} from "./lib/commercialSearchShell";
import { areWorkspaceSoundsEnabled, setWorkspaceSoundsEnabled } from "./components/soundKit";
import { setActiveOrganizationId } from "./lib/organizationService";
import { isCatalogPricingConfirmationCurrent } from "./lib/catalogPricingConfirmation";
import { calculateQuote, currency } from "./lib/quoteCalculator";
import { buildUpsellRecommendations } from "./lib/recommendations";
import {
  catalogReconciliationNotice,
  reconcileCatalogSelections
} from "./lib/catalogSelectionReconciliation";
import { buildProposalReadiness } from "./lib/quoteWorkflow";
import {
  hydrateSavedQuoteDraftBase
} from "./lib/quoteDraftRuntimeBase";
import { recommendationWouldChangeForm } from "./lib/recommendationState";
import {
  applyEventTypeTemplateDefaults,
  buildStepperModel,
  buildStepStatus,
  buildStepValidation,
  createTemplateDefaultsOwnership,
  findTemplateForEventType,
  hasTemplateDefaultsOwnership,
  MIN_EVENT_HOURS,
  normalizeEventHours,
  releaseTemplateDefaultsOwnership,
  resolveFirstValidPackageId,
  restoreTemplateOwnedDefaults,
  STEP1_REQUIRED_FIELDS
} from "./lib/wizardUi";
import {
  checkEventAvailability,
  getQuoteById,
  setQuoteStoreOrganizationId,
  submitQuote,
  updateQuote
} from "./lib/quoteStore";
import {
  buildCustomerPath,
  buildMessagingPath,
  buildQuoteEditPath,
  buildQuotePath,
  buildWorkflowPath,
  WORKSPACE_PATHS,
  WORKSPACE_ROUTE_IDS
} from "./lib/workspaceRoutes";
import {
  createWorkspaceArrivalHandoff,
  parseWorkspaceArrivalHandoff
} from "./lib/workspaceArrivalContract";
import { recordDiagnosticError, setDiagnosticsUserContext } from "./lib/sessionDiagnostics";
import { createRebookQuoteDraft } from "./lib/rebookQuoteClient";
import { clearTenantContextCache } from "./lib/tenantDomainService";
import {
  beginWizardAnalyticsSession,
  recordProductAnalyticsEvent
} from "quotepilot-active-product-analytics";

const AMBIENT_UI_ENABLED = import.meta.env.VITE_AMBIENT_UI_ENABLED === "1"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "true"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "yes"
  || import.meta.env.VITE_AMBIENT_UI_ENABLED === "on";
const OPERATIONAL_STAFFING_UI_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_OPERATIONAL_STAFFING_ENABLED || "").trim().toLowerCase()
);
const AdminCatalogView = createRecoverableLazy(
  () => import("./components/AdminCatalogModal").then((module) => ({ default: module.AdminCatalogView })),
  "AdminCatalogView"
);
const CommandCenterHome = AMBIENT_UI_ENABLED
  ? null
  : createRecoverableLazy(
      () => import("./components/CommandCenterHome"),
      "CommandCenterHome"
    );
const CommercialSearchPalette = AMBIENT_UI_ENABLED
  ? null
  : createRecoverableLazy(
      () => import("./components/CommercialSearchPalette"),
      "CommercialSearchPalette"
    );
const CommercialChangeImpactPanel = createRecoverableLazy(
  () => import("./components/CommercialChangeImpactPanel"),
  "CommercialChangeImpactPanel"
);
const CustomerDirectoryView = createRecoverableLazy(
  () => import("./components/AmbientCustomerDirectoryView"),
  "CustomerDirectoryView"
);
const CustomerWorkspaceView = createRecoverableLazy(
  () => import("quotepilot-active-customer-workspace"),
  "CustomerWorkspaceView"
);
const StaffWorkspace = createRecoverableLazy(
  () => import("./components/StaffWorkspace"),
  "StaffWorkspace"
);
const MessagingStation = createRecoverableLazy(
  () => import("quotepilot-active-messaging-station"),
  "MessagingStation"
);
const WorkspaceNotFound = createRecoverableLazy(
  () => import("./components/WorkspaceNotFound"),
  "WorkspaceNotFound"
);
const EventScheduleView = createRecoverableLazy(
  () => import("quotepilot-active-event-schedule"),
  "EventScheduleView"
);
const IntegrationOpsView = createRecoverableLazy(
  () => import("./components/IntegrationOpsModal").then((module) => ({ default: module.IntegrationOpsView })),
  "IntegrationOpsView"
);
const ImportStudioView = createRecoverableLazy(
  () => import("./components/ImportStudioModal").then((module) => ({ default: module.ImportStudioView })),
  "ImportStudioView"
);
const DiagnosticsView = createRecoverableLazy(
  () => import("./components/DiagnosticsModal").then((module) => ({ default: module.DiagnosticsView })),
  "DiagnosticsView"
);
const QuoteCompareModal = createRecoverableLazy(
  () => import("./components/QuoteCompareModal"),
  "QuoteCompareModal"
);
const QuoteHistoryView = createRecoverableLazy(
  () => import("quotepilot-active-quote-history"),
  "QuoteHistoryView"
);
const ReportingDashboardView = createRecoverableLazy(
  () => import("quotepilot-active-reporting"),
  "ReportingDashboardView"
);
const SalesWorkflowView = createRecoverableLazy(
  () => import("quotepilot-active-workflow"),
  "SalesWorkflowView"
);

const E2E_ALLOW_NON_AUTHORITATIVE_PRICING = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING || "").trim().toLowerCase()
);
const CUSTOMER_CENTERED_WORKSPACE_ENABLED = !["0", "false", "no", "off"].includes(
  String(import.meta.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED || "").trim().toLowerCase()
);
// The NOW surface is an additional default-off presentation gate. Absent or
// unrecognized values keep it off; it never widens data access or authority.
const PILOT_NOW_REQUESTED = import.meta.env.VITE_PILOT_NOW_ENABLED === "1"
  || import.meta.env.VITE_PILOT_NOW_ENABLED === "true"
  || import.meta.env.VITE_PILOT_NOW_ENABLED === "yes"
  || import.meta.env.VITE_PILOT_NOW_ENABLED === "on";
const PILOT_NOW_ENABLED = CUSTOMER_CENTERED_WORKSPACE_ENABLED && PILOT_NOW_REQUESTED;
// The CREATE intake canvas is an additional default-off presentation gate
// (docs/INTENT_INTAKE_ADR.md). It prefills the ordinary editable draft form
// only; quote creation authority is unchanged.
const PILOT_CREATE_ENABLED = import.meta.env.VITE_PILOT_CREATE_ENABLED === "1"
  || import.meta.env.VITE_PILOT_CREATE_ENABLED === "true"
  || import.meta.env.VITE_PILOT_CREATE_ENABLED === "yes"
  || import.meta.env.VITE_PILOT_CREATE_ENABLED === "on";
// The client-request panel is an additional default-off presentation gate.
// It parses the stored change-request message into stageable draft edits
// only; the ordinary save path remains the sole versioning authority.
const PILOT_CHANGE_REQUESTS_ENABLED = import.meta.env.VITE_PILOT_CHANGE_REQUESTS_ENABLED === "1"
  || import.meta.env.VITE_PILOT_CHANGE_REQUESTS_ENABLED === "true"
  || import.meta.env.VITE_PILOT_CHANGE_REQUESTS_ENABLED === "yes"
  || import.meta.env.VITE_PILOT_CHANGE_REQUESTS_ENABLED === "on";
// The Pilot command bar is an additional default-off presentation gate.
// Commands preview before anything touches the draft; applying stages
// draft edits only, and the save path remains the sole authority.
const PILOT_COMMAND_ENABLED = import.meta.env.VITE_PILOT_COMMAND_ENABLED === "1"
  || import.meta.env.VITE_PILOT_COMMAND_ENABLED === "true"
  || import.meta.env.VITE_PILOT_COMMAND_ENABLED === "yes"
  || import.meta.env.VITE_PILOT_COMMAND_ENABLED === "on";
// Default-off presentation replacement for Pilot Slice Alpha. This class is
// used only to remove duplicate mobile chrome around the selected opportunity;
// authority remains in the existing quote callbacks and save path.
const AMBIENT_NOW_ENABLED = AMBIENT_UI_ENABLED && PILOT_NOW_ENABLED;
// Keep the v0.7 command surface available under its existing gate while the
// expanded query/scenario contract stays coupled to the separately default-off
// Ambient release. Production currently binds Pilot Command but not Ambient.
const AMBIENT_PILOT_COMMANDS_ENABLED = AMBIENT_UI_ENABLED && PILOT_COMMAND_ENABLED;
const LEGACY_NOW_ENABLED = PILOT_NOW_ENABLED && !AMBIENT_UI_ENABLED;

const AmbientGlobalPilotSurface = AMBIENT_UI_ENABLED
  ? createRecoverableLazy(
      () => import("./components/AmbientGlobalPilotSurface"),
      "AmbientGlobalPilotSurface"
    )
  : null;
const AmbientNowView = AMBIENT_NOW_ENABLED
  ? createRecoverableLazy(
      () => import("./components/AmbientNowView"),
      "AmbientNowView"
    )
  : null;
const NowView = LEGACY_NOW_ENABLED
  ? createRecoverableLazy(
      () => import("./components/NowView"),
      "NowView"
    )
  : null;
const PilotCommandBar = PILOT_COMMAND_ENABLED
  ? createRecoverableLazy(
      AMBIENT_UI_ENABLED
        ? () => import("./components/PilotCommandBar")
        : () => import("./components/LegacyPilotCommandBar"),
      "PilotCommandBar"
    )
  : null;
const loadAmbientPackageMenuCatalogEvidence = AMBIENT_PILOT_COMMANDS_ENABLED
  ? () => import("./lib/ambientPackageMenuCatalogEvidence")
  : null;
const loadPilotScenarioDraftReview = AMBIENT_PILOT_COMMANDS_ENABLED
  ? () => import("./lib/pilotScenarioDraftReview")
  : null;
const loadAmbientPackageMenuDraftAdoption = AMBIENT_UI_ENABLED
  ? () => import("./lib/ambientPackageMenuDraftAdoption")
  : null;
const loadAmbientQuoteDraftRuntime = AMBIENT_UI_ENABLED
  ? () => import("./lib/quoteDraftRuntime")
  : null;
const loadAmbientProductAnalytics = AMBIENT_UI_ENABLED
  ? () => import("./lib/productAnalyticsAmbient")
  : null;
const loadAmbientGlobalPilotTarget = AMBIENT_UI_ENABLED
  ? () => import("./lib/ambientGlobalPilotTarget")
  : null;
const AmbientDraftIntentReview = AMBIENT_UI_ENABLED
  ? createRecoverableLazy(
      () => import("./components/AmbientDraftIntentReview"),
      "AmbientDraftIntentReview"
    )
  : null;
const AmbientLibraryRoute = AMBIENT_UI_ENABLED
  ? createRecoverableLazy(
      () => import("./components/AmbientLibraryRoute"),
      "AmbientLibraryRoute"
    )
  : null;
const AmbientPilotScenarioReview = AMBIENT_PILOT_COMMANDS_ENABLED
  ? createRecoverableLazy(
      () => import("./components/AmbientPilotScenarioReview"),
      "AmbientPilotScenarioReview"
    )
  : null;

const INITIAL_FORM = {
  date: "",
  time: "",
  hours: MIN_EVENT_HOURS,
  servers: 0,
  chefs: 0,
  bartenders: 0,
  guests: 0,
  venue: "",
  venueAddress: "",
  eventName: "",
  dietaryRestrictions: "",
  clientOrg: "",
  style: "Buffet",
  name: "",
  phone: "",
  email: "",
  pkg: "",
  addons: [],
  addonQuantities: {},
  rentals: [],
  rentalQuantities: {},
  menuItems: [],
  menuItemQuantities: {},
  eventTypeId: "",
  bartenderRateTypeId: "",
  staffingRateTypeId: "",
  bartenderRateOverride: "",
  serverRateOverride: "",
  serverRateMixCsv: "",
  chefRateMixCsv: "",
  chefRateOverride: "",
  eventTemplateId: "custom",
  taxRegion: "",
  seasonProfileId: "auto",
  milesRT: 0,
  includeDisposables: true,
  payMethod: "card"
};

const EMPTY_EDITING_QUOTE = Object.freeze({
  id: "",
  quoteNumber: "",
  activeVersionId: "",
  customerId: "",
  organizationId: "",
  rebooking: null
});

const EMPTY_CHANGE_IMPACT_PREVIEW = Object.freeze({
  requested: false,
  loading: false,
  recovering: false,
  error: "",
  model: null,
  formKey: "",
  authorityState: "",
  simulationRequestId: "",
  simulationReceiptId: "",
  authorizationRequired: false,
  approval: null,
  authorizationReceiptId: "",
  applyRequestId: "",
  mutationState: "ready",
  mutationKind: "",
  mutationMessage: "",
  applyResult: null,
  applyOutcome: null
});
const EMPTY_LIBRARY_INTERACTION = Object.freeze({ dirty: false, busy: false });

function readPortalKeyFromUrl() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return String(params.get("portal") || "").trim();
}

function readPaymentReturnFromUrl() {
  if (typeof window === "undefined") return "";
  const value = String(new URLSearchParams(window.location.search).get("payment") || "")
    .trim()
    .toLowerCase();
  return ["success", "cancelled"].includes(value) ? value : "";
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toRateArray(input, fallback = []) {
  if (!Array.isArray(input)) return Array.isArray(fallback) ? [...fallback] : [];
  return input
    .map((value) => Math.round(toNumber(value, 0) * 100) / 100)
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function toPositiveTimeout(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1_000, Math.round(parsed));
}

async function withTimeout(promise, timeoutMs, operation = "operation") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

const SAVE_FLOW_TIMEOUT_MS = toPositiveTimeout(
  import.meta.env.VITE_SAVE_FLOW_TIMEOUT_MS,
  30_000
);
const OWNER_SMS_TIMEOUT_MS = toPositiveTimeout(
  import.meta.env.VITE_OWNER_SMS_TIMEOUT_MS,
  15_000
);

function WorkspaceStatusCard({ children }) {
  return (
    <section className="panel auth-card">
      <ProductBrandLockup className="auth-product-brand" />
      {children}
    </section>
  );
}

function MobilePricingSummary({ step, totals, open, onToggle, toggleRef }) {
  if (step < 1 || step > 5) return null;

  return (
    <section
      className="mobile-pricing-summary"
      aria-label="Current quote pricing"
      data-testid="mobile-pricing-summary"
    >
      <div className="mobile-pricing-value">
        <span>Total</span>
        <strong data-testid="mobile-pricing-total">{currency(totals.total)}</strong>
      </div>
      <div className="mobile-pricing-value">
        <span>Deposit</span>
        <strong>{currency(totals.deposit)}</strong>
      </div>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls="live-breakdown"
        onClick={onToggle}
      >
        {open ? "Hide breakdown" : "View breakdown"}
      </button>
    </section>
  );
}

function normalizeFeatureFlags(input) {
  const source = input && typeof input === "object" ? input : {};
  const aiAssist = source.aiAssist !== false;
  return {
    customerPortal: source.customerPortal !== false,
    eventSchedule: source.eventSchedule !== false,
    integrationsOps: source.integrationsOps !== false,
    diagnostics: source.diagnostics !== false,
    reportingDashboard: source.reportingDashboard !== false,
    quoteCompare: source.quoteCompare !== false,
    crmSync: source.crmSync !== false,
    guidedSelling: source.guidedSelling !== false,
    aiAssist,
    aiAutopilot: aiAssist && source.aiAutopilot === true
  };
}

function normalizePricingLineCategory(value) {
  return String(value || "").trim().toLowerCase();
}

function sumPricingLineTotals(lineItems, categories = []) {
  const categorySet = new Set(categories.map((category) => normalizePricingLineCategory(category)));
  const source = Array.isArray(lineItems) ? lineItems : [];
  return source.reduce((sum, item) => {
    const category = normalizePricingLineCategory(item?.category);
    if (!categorySet.has(category)) return sum;
    return sum + toNumber(item?.total, 0);
  }, 0);
}

function buildTotalsFromPricingSnapshot(pricingSnapshot = {}, fallbackTotals = {}) {
  const lineItems = Array.isArray(pricingSnapshot?.lineItems) ? pricingSnapshot.lineItems : [];
  const rules = pricingSnapshot?.rulesSnapshot && typeof pricingSnapshot.rulesSnapshot === "object"
    ? pricingSnapshot.rulesSnapshot
    : {};
  const staffingSnapshot = rules.staffing && typeof rules.staffing === "object"
    ? rules.staffing
    : {};
  const laborSnapshot = rules.laborRateSnapshot && typeof rules.laborRateSnapshot === "object"
    ? rules.laborRateSnapshot
    : {};
  const selectedPackage = pricingSnapshot?.inputs?.selection?.package || {};

  const base = toNumber(
    sumPricingLineTotals(lineItems, ["package"]),
    toNumber(fallbackTotals.base, 0)
  );
  const addons = toNumber(
    sumPricingLineTotals(lineItems, ["addon", "addons"]),
    toNumber(fallbackTotals.addons, 0)
  );
  const rentals = toNumber(
    sumPricingLineTotals(lineItems, ["rental", "rentals"]),
    toNumber(fallbackTotals.rentals, 0)
  );
  const menu = toNumber(
    sumPricingLineTotals(lineItems, ["menu_item", "menu_items", "menu"]),
    toNumber(fallbackTotals.menu, 0)
  );

  return {
    ...fallbackTotals,
    selectedPkg: {
      ...(fallbackTotals.selectedPkg || {}),
      id: String(selectedPackage?.id || fallbackTotals.selectedPkg?.id || "").trim(),
      name: String(selectedPackage?.name || fallbackTotals.selectedPkg?.name || "").trim()
    },
    base,
    addons,
    rentals,
    menu,
    labor: toNumber(pricingSnapshot?.fees?.labor, toNumber(fallbackTotals.labor, 0)),
    serverLabor: toNumber(
      pricingSnapshot?.fees?.serverLabor,
      toNumber(laborSnapshot.serverLabor, toNumber(fallbackTotals.serverLabor, 0))
    ),
    chefLabor: toNumber(
      pricingSnapshot?.fees?.chefLabor,
      toNumber(laborSnapshot.chefLabor, toNumber(fallbackTotals.chefLabor, 0))
    ),
    bartenderLabor: toNumber(pricingSnapshot?.fees?.bartenderLabor, toNumber(fallbackTotals.bartenderLabor, 0)),
    bartenderRateApplied: toNumber(laborSnapshot.bartenderRateApplied, toNumber(fallbackTotals.bartenderRateApplied, 0)),
    serverRateApplied: toNumber(laborSnapshot.serverRateApplied, toNumber(fallbackTotals.serverRateApplied, 0)),
    serverRatesApplied: toRateArray(laborSnapshot.serverRatesApplied, fallbackTotals.serverRatesApplied),
    chefRateApplied: toNumber(laborSnapshot.chefRateApplied, toNumber(fallbackTotals.chefRateApplied, 0)),
    chefRatesApplied: toRateArray(laborSnapshot.chefRatesApplied, fallbackTotals.chefRatesApplied),
    bartenderRateTypeId: String(laborSnapshot.bartenderRateTypeId || fallbackTotals.bartenderRateTypeId || ""),
    bartenderRateTypeName: String(laborSnapshot.bartenderRateTypeName || fallbackTotals.bartenderRateTypeName || ""),
    staffingRateTypeId: String(laborSnapshot.staffingRateTypeId || fallbackTotals.staffingRateTypeId || ""),
    staffingRateTypeName: String(laborSnapshot.staffingRateTypeName || fallbackTotals.staffingRateTypeName || ""),
    staffingLaborEnabled:
      rules.staffingLaborEnabled !== undefined
        ? rules.staffingLaborEnabled !== false
        : fallbackTotals.staffingLaborEnabled !== false,
    staffingChargeMode: String(rules.staffingChargeMode || fallbackTotals.staffingChargeMode || "per_hour"),
    servers: toNumber(staffingSnapshot.servers, toNumber(fallbackTotals.servers, 0)),
    chefs: toNumber(staffingSnapshot.chefs, toNumber(fallbackTotals.chefs, 0)),
    bartenders: toNumber(staffingSnapshot.bartenders, toNumber(fallbackTotals.bartenders, 0)),
    baseServers: toNumber(
      staffingSnapshot.baseServers,
      toNumber(fallbackTotals.baseServers, toNumber(staffingSnapshot.servers, toNumber(fallbackTotals.servers, 0)))
    ),
    baseChefs: toNumber(
      staffingSnapshot.baseChefs,
      toNumber(fallbackTotals.baseChefs, toNumber(staffingSnapshot.chefs, toNumber(fallbackTotals.chefs, 0)))
    ),
    baseBartenders: toNumber(
      staffingSnapshot.baseBartenders,
      toNumber(fallbackTotals.baseBartenders, toNumber(staffingSnapshot.bartenders, toNumber(fallbackTotals.bartenders, 0)))
    ),
    addonServers: toNumber(staffingSnapshot.addonServers, toNumber(fallbackTotals.addonServers, 0)),
    addonChefs: toNumber(staffingSnapshot.addonChefs, toNumber(fallbackTotals.addonChefs, 0)),
    addonBartenders: toNumber(staffingSnapshot.addonBartenders, toNumber(fallbackTotals.addonBartenders, 0)),
    travel: toNumber(pricingSnapshot?.fees?.travel, toNumber(fallbackTotals.travel, 0)),
    serviceFee: toNumber(pricingSnapshot?.fees?.serviceFee, toNumber(fallbackTotals.serviceFee, 0)),
    tax: toNumber(pricingSnapshot?.tax?.amount, toNumber(fallbackTotals.tax, 0)),
    total: toNumber(pricingSnapshot?.grandTotal, toNumber(fallbackTotals.total, 0)),
    deposit: toNumber(pricingSnapshot?.deposit?.amount, toNumber(fallbackTotals.deposit, 0)),
    serviceFeePctApplied: toNumber(rules.serviceFeePctApplied, toNumber(fallbackTotals.serviceFeePctApplied, 0)),
    taxRateApplied: toNumber(pricingSnapshot?.tax?.rate, toNumber(fallbackTotals.taxRateApplied, 0)),
    taxRegionId: String(pricingSnapshot?.tax?.regionId || fallbackTotals.taxRegionId || ""),
    taxRegionName: String(pricingSnapshot?.tax?.regionName || fallbackTotals.taxRegionName || ""),
    seasonProfileId: String(rules.seasonProfileId || fallbackTotals.seasonProfileId || ""),
    seasonProfileName: String(rules.seasonProfileName || fallbackTotals.seasonProfileName || ""),
    packageMultiplier: toNumber(rules.packageMultiplier, toNumber(fallbackTotals.packageMultiplier, 1)),
    addonMultiplier: toNumber(rules.addonMultiplier, toNumber(fallbackTotals.addonMultiplier, 1)),
    rentalMultiplier: toNumber(rules.rentalMultiplier, toNumber(fallbackTotals.rentalMultiplier, 1))
  };
}

function resolveCatalogItemName(items, id) {
  const normalizedId = String(id || "").trim();
  if (!normalizedId) return "";
  const match = (Array.isArray(items) ? items : []).find(
    (item) => String(item?.id || "").trim() === normalizedId
  );
  return String(match?.name || "").trim();
}

// Builds the human-readable disclosure and carries exact field provenance for
// every value the template changed. The provenance lets "Clear defaults"
// restore the prior form without rolling back edits made after application.
function buildTemplateDefaultsNotice({
  template,
  catalog,
  ownership
}) {
  if (!template) return null;
  const templateName = String(template.name || template.id || "").trim();
  if (!templateName || !hasTemplateDefaultsOwnership(ownership)) return null;

  const ownedFields = new Set(Object.keys(ownership?.fields || {}));
  const ownedSelections = ownership?.selections || {};
  const packageId = String(ownership?.fields?.pkg?.applied || "").trim();
  const packageName = resolveCatalogItemName(catalog?.packages, packageId);
  const addonCount = ownedSelections.addons?.changedIds?.length || 0;
  const rentalCount = ownedSelections.rentals?.changedIds?.length || 0;
  const menuCount = ownedSelections.menuItems?.changedIds?.length || 0;
  const ownsStaffing = [
    "servers",
    "chefs",
    "bartenders",
    "bartenderRateTypeId",
    "staffingRateTypeId",
    "bartenderRateOverride",
    "serverRateOverride",
    "serverRateMixCsv",
    "chefRateMixCsv",
    "chefRateOverride"
  ].some((field) => ownedFields.has(field));
  const ownsPricingChoices = ["taxRegion", "seasonProfileId", "payMethod"]
    .some((field) => ownedFields.has(field));

  const parts = [
    ownedFields.has("pkg") ? `${packageName || "Package"} tier` : "",
    ownedFields.has("hours") ? "event hours" : "",
    ownedFields.has("style") ? "service style" : "",
    ownedFields.has("eventTypeId") ? "event type" : "",
    menuCount ? `${menuCount} menu selection${menuCount === 1 ? "" : "s"}` : "",
    addonCount ? `${addonCount} add-on selection${addonCount === 1 ? "" : "s"}` : "",
    rentalCount ? `${rentalCount} rental selection${rentalCount === 1 ? "" : "s"}` : "",
    ownsStaffing ? "staffing" : "",
    ownedFields.has("milesRT") ? "travel miles" : "",
    ownsPricingChoices ? "pricing choices" : ""
  ].filter(Boolean);

  return {
    templateId: String(template.id || "").trim(),
    templateName,
    summary: `${templateName} defaults applied: ${parts.join(" · ")}. Adjust any field to keep your edit, or clear all untouched defaults.`,
    ownership
  };
}

const WORKFLOW_ARRIVAL_INTENT_BY_ATTENTION = Object.freeze({
  approval: "review_approval",
  change_request: "review_customer_request",
  follow_up: "review_follow_up",
  post_event_closeout: "review_follow_up",
  anniversary_rebooking: "review_follow_up",
  decision_debt: "review_decision_debt",
  unread_customer_reply: "review_customer_reply"
});

function ambientWorkflowArrivalInput(target = {}, options = {}) {
  const arrivalTarget = options?.arrivalContext?.target || {};
  const quoteId = String(target?.quoteId || arrivalTarget?.quoteId || "").trim();
  const requestId = String(target?.requestId || arrivalTarget?.requestId || "").trim();
  const inferredConversationRequest = options?.arrivalContext?.object?.type
    === "customer-communication-evidence";
  const attentionType = String(
    target?.attentionType
    || arrivalTarget?.attentionType
    || (inferredConversationRequest && requestId ? "change_request" : "")
  ).trim();
  const approval = attentionType === "approval";
  return {
    destination: approval ? "approval" : "workflow",
    object: {
      id: requestId,
      type: approval ? "approval" : "workflow-item"
    },
    focus: approval
      ? { quoteId, requestId }
      : { quoteId, attentionType, requestId },
    intentId: WORKFLOW_ARRIVAL_INTENT_BY_ATTENTION[attentionType] || "review_workflow_item"
  };
}

function ambientConversationArrivalInput(quoteId, options = {}) {
  const normalizedQuoteId = String(quoteId || "").trim();
  const messageId = String(options?.arrivalContext?.target?.messageId || "").trim();
  return {
    destination: "messages",
    object: messageId
      ? { id: messageId, type: "customer-communication-evidence" }
      : { id: normalizedQuoteId, type: "opportunity" },
    focus: messageId
      ? { quoteId: normalizedQuoteId, messageId }
      : { quoteId: normalizedQuoteId },
    intentId: messageId
      ? "review_customer_reply"
      : "review_conversation"
  };
}

function ambientOpportunityArrivalInput(target = {}) {
  const quoteId = String(target?.quoteId || "").trim();
  const actionId = String(target?.actionId || "").trim();
  return {
    destination: "opportunity",
    object: { id: quoteId, type: "opportunity" },
    focus: { quoteId },
    intentId: actionId.startsWith("review-opportunity-proposal:")
      ? "review_proposal_gap"
      : "review_opportunity"
  };
}

function ambientClientArrivalInput(target = {}) {
  const customerId = String(target?.customerId || target?.clientId || "").trim();
  return {
    destination: "client",
    object: { id: customerId, type: "client" },
    focus: { customerId },
    intentId: "review_client"
  };
}

export default function App({
  tenantContext,
  authSession,
  portalRouteAllowed = true,
  committedPortalToken = "",
  onPortalScopeCommit
}) {
  const {
    route: browserRoute,
    location: browserLocation,
    navigate,
    replace
  } = useWorkspaceNavigation();
  const workspaceArrivalHandoff = useMemo(() => {
    if (!AMBIENT_UI_ENABLED || !browserLocation.state?.ambientArrival) return null;
    return parseWorkspaceArrivalHandoff(browserLocation);
  }, [browserLocation]);
  const workspaceArrivalAttempted = Boolean(
    AMBIENT_UI_ENABLED && browserLocation.state?.ambientArrival
  );
  const workspaceArrivalContext = workspaceArrivalHandoff?.ok
    ? workspaceArrivalHandoff.contract
    : null;
  const [workspaceArrivalResolution, setWorkspaceArrivalResolution] = useState(null);
  const [catalogRouteInteraction, setCatalogRouteInteraction] = useState(EMPTY_LIBRARY_INTERACTION);
  const [catalogModalInteraction, setCatalogModalInteraction] = useState(EMPTY_LIBRARY_INTERACTION);
  const ambientLibraryInteraction = useMemo(() => ({
    dirty: catalogRouteInteraction.dirty || catalogModalInteraction.dirty,
    busy: catalogRouteInteraction.busy || catalogModalInteraction.busy
  }), [catalogRouteInteraction, catalogModalInteraction]);
  const workspaceArrivalKey = workspaceArrivalAttempted
      ? workspaceArrivalContext ? [
        workspaceArrivalContext.surfaceId,
        workspaceArrivalContext.intentId,
        workspaceArrivalContext.object?.type,
        workspaceArrivalContext.object?.id,
        workspaceArrivalContext.focus?.quoteId,
        workspaceArrivalContext.focus?.customerId,
        workspaceArrivalContext.focus?.attentionType,
        workspaceArrivalContext.focus?.requestId,
        workspaceArrivalContext.focus?.messageId,
        workspaceArrivalContext.focus?.reportScope,
        workspaceArrivalContext.focus?.reportSignal,
        workspaceArrivalContext.focus?.sectionId,
        workspaceArrivalContext.focus?.recordId
      ].filter(Boolean).join(":") : [
        "recovery",
        browserLocation.pathname,
        browserLocation.search,
        workspaceArrivalHandoff?.recovery?.code || "invalid_input"
      ].join(":")
    : "";
  useEffect(() => {
    if (workspaceArrivalContext) {
      setWorkspaceArrivalResolution({ status: "pending" });
      return;
    }
    if (workspaceArrivalAttempted && workspaceArrivalHandoff?.recovery) {
      setWorkspaceArrivalResolution({
        status: "recovery",
        ...workspaceArrivalHandoff.recovery
      });
      return;
    }
    setWorkspaceArrivalResolution(null);
  }, [workspaceArrivalKey]);
  const navigateWorkspace = useCallback((destination, options = {}) => navigate(destination, {
    ...options,
    preserveSearch: false
  }), [navigate]);
  const navigateAmbientWorkflow = useCallback((target = {}, options = {}) => {
    if (!AMBIENT_UI_ENABLED) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff(ambientWorkflowArrivalInput(target, options));
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    navigateWorkspace(handoff.navigation.path, { state: handoff.navigation.state });
    return { status: "pending", contract: handoff.contract };
  }, [navigateWorkspace]);
  const navigateAmbientConversation = useCallback((quoteId, options = {}) => {
    if (!AMBIENT_UI_ENABLED) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff(
      ambientConversationArrivalInput(quoteId, options)
    );
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    navigateWorkspace(handoff.navigation.path, { state: handoff.navigation.state });
    return { status: "pending", contract: handoff.contract };
  }, [navigateWorkspace]);
  const navigateAmbientOpportunity = useCallback((target = {}) => {
    if (!AMBIENT_UI_ENABLED) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff(ambientOpportunityArrivalInput(target));
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    navigateWorkspace(handoff.navigation.path, { state: handoff.navigation.state });
    return { status: "pending", contract: handoff.contract };
  }, [navigateWorkspace]);
  const navigateAmbientClient = useCallback((target = {}) => {
    if (!AMBIENT_UI_ENABLED) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff(ambientClientArrivalInput(target));
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    navigateWorkspace(handoff.navigation.path, { state: handoff.navigation.state });
    return { status: "pending", contract: handoff.contract };
  }, [navigateWorkspace]);
  const wizardRef = useRef(null);
  const stepperRef = useRef(null);
  const mobilePricingToggleRef = useRef(null);
  const historyTriggerRef = useRef(null);
  const workflowTriggerRef = useRef(null);
  const headerMenusRef = useRef(null);
  const operationsMenuTriggerRef = useRef(null);
  const accountMenuTriggerRef = useRef(null);
  const moreMenuTriggerRef = useRef(null);
  const globalPilotTriggerRef = useRef(null);
  const globalPilotRequestCounterRef = useRef(0);
  const globalPilotRouteRef = useRef("");
  const commercialSearchTriggerRef = useRef(null);
  const commercialSearchReturnFocusRef = useRef(null);
  const workspaceToolReturnFocusRef = useRef(null);
  const saveQuoteButtonRef = useRef(null);
  const menuSelectionValidationRef = useRef(null);
  const autopilotAppliedRef = useRef(new Set());
  const directEditLoadRef = useRef({ key: "", generation: 0 });
  const changeImpactPreviewGenerationRef = useRef(0);
  const catalogReconciliationNoticeRef = useRef("");
  const { eventTypeId: globalEventTypeId, setEventTypeId: setGlobalEventTypeId } = useEventType();
  const { organization, setOrganizationId } = useOrganization();
  const [portalKey, setPortalKey] = useState(() => readPortalKeyFromUrl());
  const [portalMode, setPortalMode] = useState(Boolean(portalKey));
  const [paymentReturn] = useState(() => readPaymentReturnFromUrl());
  const lastWorkspaceLocationRef = useRef(browserRoute.surface === "workspace" ? {
    destination: `${browserLocation.pathname}${browserLocation.search}${browserLocation.hash}`,
    state: browserLocation.state
  } : { destination: WORKSPACE_PATHS.home, state: null });
  const isUnscopedPlatformOperator = (
    tenantContext.ready
    && (tenantContext.hostType === "app" || tenantContext.hostType === "local")
    && authSession.isAdmin
    && authSession.platformAdmin
    && !String(authSession.organizationId || "").trim()
  );
  const catalogEnabled = authSession.isStaff
    && tenantContext.ready
    && !isUnscopedPlatformOperator
    && (!tenantContext.requiresTenant || authSession.organizationId === tenantContext.organizationId);
  const catalog = useCatalogData({
    enabled: catalogEnabled,
    organizationId: authSession.organizationId
  });
  const hasConfiguredPackage = catalog.packages.some((item) => {
    const name = String(item?.name || "").trim();
    return item?.active !== false
      && name
      && name.toLowerCase() !== "new package"
      && Number(item?.ppp || 0) > 0;
  });
  const hasConfiguredEventType = Boolean(
    String(globalEventTypeId || "").trim()
    || (catalog.eventTypes || []).some(
      (item) => String(item?.id || "").trim() && String(item?.name || "").trim()
    )
  );
  const pricingSetupConfirmed = isCatalogPricingConfirmationCurrent(catalog.settings);
  const catalogSetupComplete = hasConfiguredPackage
    && hasConfiguredEventType
    && pricingSetupConfirmed;
  const [dynamicMenuSections, setDynamicMenuSections] = useState([]);
  const [dynamicMenuLoading, setDynamicMenuLoading] = useState(false);
  const [dynamicMenuError, setDynamicMenuError] = useState("");
  const [dynamicMenuLoadedEventTypeId, setDynamicMenuLoadedEventTypeId] = useState("");
  const [dynamicMenuRetryToken, setDynamicMenuRetryToken] = useState(0);
  const [step, setStep] = useState(1);
  const [mobilePricingOpen, setMobilePricingOpen] = useState(false);

  const closeMobilePricing = () => {
    setMobilePricingOpen(false);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => mobilePricingToggleRef.current?.focus());
    }
  };

  const handleCatalogMutation = useCallback((mutation) => {
    catalog.acceptCatalogMutation(mutation);
    setDynamicMenuRetryToken((token) => token + 1);
  }, [catalog.acceptCatalogMutation]);

  useEffect(() => {
    setMobilePricingOpen(false);
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    let frame = 0;
    const centerCurrentStep = () => {
      if (!window.matchMedia("(max-width: 640px)").matches) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const stepper = stepperRef.current;
        const currentStep = stepper?.querySelector('[aria-current="step"]');
        if (!stepper || !currentStep) return;
        const railRect = stepper.getBoundingClientRect();
        const stepRect = currentStep.getBoundingClientRect();
        stepper.scrollTo({
          left: Math.max(
            0,
            stepper.scrollLeft
              + (stepRect.left - railRect.left)
              - ((railRect.width - stepRect.width) / 2)
          ),
          behavior: "auto"
        });
      });
    };

    centerCurrentStep();
    window.addEventListener("resize", centerCurrentStep);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", centerCurrentStep);
    };
  }, [step]);

  useEffect(() => {
    if (!mobilePricingOpen || typeof window === "undefined") return undefined;
    const mobileLayout = window.matchMedia("(max-width: 980px)");
    const backgroundTargets = [
      document.querySelector(".site-header"),
      document.querySelector(".workspace-intro"),
      wizardRef.current?.querySelector(".wizard-panel"),
      document.querySelector(".toast-stack")
    ].filter(Boolean);
    const previousInertValues = backgroundTargets.map((element) => element.inert);
    const previousBodyOverflow = document.body.style.overflow;

    backgroundTargets.forEach((element) => {
      element.inert = true;
    });
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      document.querySelector("#live-breakdown .breakdown-mobile-close")?.focus();
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobilePricing();
        return;
      }
      if (event.key !== "Tab") return;

      const breakdown = document.querySelector("#live-breakdown");
      const focusable = Array.from(breakdown?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        breakdown?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !breakdown?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !breakdown?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleLayoutChange = (event) => {
      if (event.matches) return;
      setMobilePricingOpen(false);
      window.requestAnimationFrame(() => wizardRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("keydown", handleKeyDown);
    mobileLayout.addEventListener("change", handleLayoutChange);
    if (!mobileLayout.matches) handleLayoutChange(mobileLayout);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      mobileLayout.removeEventListener("change", handleLayoutChange);
      backgroundTargets.forEach((element, index) => {
        element.inert = previousInertValues[index];
      });
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [mobilePricingOpen]);

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminInitialTab, setAdminInitialTab] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [importStudioOpen, setImportStudioOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState({ quoteId: "", reason: "" });
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [openHeaderMenu, setOpenHeaderMenu] = useState("");
  const [workspaceSoundsOn, setWorkspaceSoundsOn] = useState(() => areWorkspaceSoundsEnabled());
  const toggleWorkspaceSounds = useCallback(() => {
    setWorkspaceSoundsOn((current) => {
      setWorkspaceSoundsEnabled(!current);
      return !current;
    });
  }, []);
  // Directional wizard transitions: compare against the previously rendered
  // step at render time so the entering stage animates from the correct side.
  const previousStepRef = useRef(step);
  const stepNavDir = step >= previousStepRef.current ? "fwd" : "back";
  useEffect(() => {
    previousStepRef.current = step;
  }, [step]);
  const [commercialSearchOpen, setCommercialSearchOpen] = useState(false);
  const resolvedWorkspaceRouteId = !CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && browserRoute.routeId === WORKSPACE_ROUTE_IDS.HOME
    ? WORKSPACE_ROUTE_IDS.QUOTE_NEW
    : browserRoute.routeId;
  const historyOpen = [WORKSPACE_ROUTE_IDS.QUOTE_LIST, WORKSPACE_ROUTE_IDS.QUOTE_DETAIL]
    .includes(resolvedWorkspaceRouteId);
  const messagingOpen = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.MESSAGING;
  const salesWorkflowOpen = resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.WORKFLOW;
  const shellRouteOpen = (routeId) => CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === routeId;
  const shellModalOpen = (open, routeId) => open || (
    !CUSTOMER_CENTERED_WORKSPACE_ENABLED && resolvedWorkspaceRouteId === routeId
  );
  const scheduleRouteOpen = shellRouteOpen(WORKSPACE_ROUTE_IDS.SCHEDULE);
  const reportingRouteOpen = shellRouteOpen(WORKSPACE_ROUTE_IDS.REPORTING);
  const integrationsRouteOpen = shellRouteOpen(WORKSPACE_ROUTE_IDS.INTEGRATIONS);
  const importsRouteOpen = shellRouteOpen(WORKSPACE_ROUTE_IDS.IMPORTS);
  const catalogRouteOpen = shellRouteOpen(WORKSPACE_ROUTE_IDS.CATALOG);
  const staffRouteOpen = shellRouteOpen(WORKSPACE_ROUTE_IDS.STAFF);
  const diagnosticsRouteOpen = shellRouteOpen(WORKSPACE_ROUTE_IDS.DIAGNOSTICS);
  const scheduleModalOpen = shellModalOpen(scheduleOpen, WORKSPACE_ROUTE_IDS.SCHEDULE);
  const reportingModalOpen = shellModalOpen(dashboardOpen, WORKSPACE_ROUTE_IDS.REPORTING);
  const integrationsModalOpen = shellModalOpen(integrationsOpen, WORKSPACE_ROUTE_IDS.INTEGRATIONS);
  const importsModalOpen = shellModalOpen(importStudioOpen, WORKSPACE_ROUTE_IDS.IMPORTS);
  const catalogModalOpen = shellModalOpen(adminOpen, WORKSPACE_ROUTE_IDS.CATALOG);
  const diagnosticsModalOpen = shellModalOpen(diagnosticsOpen, WORKSPACE_ROUTE_IDS.DIAGNOSTICS);
  const commercialSearchAvailable = isCommercialSearchAvailable({
    enabled: CUSTOMER_CENTERED_WORKSPACE_ENABLED && !AMBIENT_UI_ENABLED,
    isStaff: authSession.isStaff,
    organizationId: authSession.organizationId,
    portalMode,
    workspaceReady: catalogSetupComplete,
    isUnscopedPlatformOperator,
    isWorkspaceRoute: browserRoute.surface === "workspace"
  });
  const closeCommercialSearch = useCallback(() => {
    setCommercialSearchOpen(false);
  }, []);
  const openCommercialSearch = useCallback((returnTarget = null) => {
    if (!commercialSearchAvailable || typeof document === "undefined") return;
    const existingDialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (existingDialog) return;
    const activeElement = typeof HTMLElement !== "undefined"
      && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    commercialSearchReturnFocusRef.current = returnTarget
      || activeElement
      || commercialSearchTriggerRef.current
      || null;
    setOpenHeaderMenu("");
    setCommercialSearchOpen(true);
  }, [commercialSearchAvailable]);
  const closeWorkspaceToolRoute = (routeId, setOpen) => {
    setOpen(false);
    if (resolvedWorkspaceRouteId === routeId) navigateWorkspace(WORKSPACE_PATHS.home);
  };
  const returnWorkspaceHome = () => navigateWorkspace(WORKSPACE_PATHS.home);
  const closeCatalogWorkspace = () => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.CATALOG, setAdminOpen);
  const closeStaffWorkspace = () => {
    if (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.STAFF) navigateWorkspace(WORKSPACE_PATHS.home);
  };
  const closeImportsWorkspace = () => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.IMPORTS, setImportStudioOpen);
  const closeScheduleWorkspace = () => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.SCHEDULE, setScheduleOpen);
  const closeReportingWorkspace = () => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.REPORTING, setDashboardOpen);
  const closeIntegrationsWorkspace = () => closeWorkspaceToolRoute(
    WORKSPACE_ROUTE_IDS.INTEGRATIONS,
    setIntegrationsOpen
  );
  const closeDiagnosticsWorkspace = () => closeWorkspaceToolRoute(
    WORKSPACE_ROUTE_IDS.DIAGNOSTICS,
    setDiagnosticsOpen
  );
  const openWorkspaceTool = (setOpen, {
    menuTriggerRef = null,
    fallbackRef = null,
    beforeOpen = null
  } = {}) => {
    const activeElement = typeof document !== "undefined"
      && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const activeInsideClosingDialog = Boolean(activeElement?.closest('[role="dialog"]'));
    workspaceToolReturnFocusRef.current = menuTriggerRef?.current
      || (activeInsideClosingDialog ? fallbackRef?.current : activeElement)
      || fallbackRef?.current
      || null;
    setOpenHeaderMenu("");
    beforeOpen?.();
    setOpen(true);
  };
  const openRoutedWorkspaceTool = (path, setOpen, {
    menuTriggerRef = null,
    beforeOpen = null
  } = {}) => {
    if (CUSTOMER_CENTERED_WORKSPACE_ENABLED) {
      setOpenHeaderMenu("");
      beforeOpen?.();
      navigateWorkspace(path);
      return;
    }
    openWorkspaceTool(setOpen, { menuTriggerRef, beforeOpen });
  };
  const commercialSnapshot = useCommercialWorkspaceSnapshot({
    enabled: Boolean(authSession.isStaff && authSession.organizationId),
    includeHistory: CUSTOMER_CENTERED_WORKSPACE_ENABLED,
    tenantTimeZone: String(catalog.settings?.businessTimeZone || "").trim(),
    organizationId: authSession.organizationId
  });
  const workflowAttentionCount = commercialSnapshot.attentionSummary?.quoteCount ?? null;
  const requestWorkflowAttentionRefresh = commercialSnapshot.refresh;
  const handleWorkflowAttentionSummary = useCallback((summary) => {
    if (String(summary?.organizationId || "").trim() !== String(authSession.organizationId || "").trim()) return;
    commercialSnapshot.refresh({ force: true });
  }, [authSession.organizationId, commercialSnapshot.refresh]);
  const adminMounted = useStickyMount(catalogModalOpen);
  const scheduleMounted = useStickyMount(scheduleModalOpen);
  const integrationsMounted = useStickyMount(integrationsModalOpen);
  const importStudioMounted = useStickyMount(importsModalOpen);
  const diagnosticsMounted = useStickyMount(diagnosticsModalOpen);
  const historyMounted = useStickyMount(historyOpen);
  const dashboardMounted = useStickyMount(reportingModalOpen);
  const catalogRouteMounted = useStickyMount(catalogRouteOpen);
  const staffRouteMounted = useStickyMount(staffRouteOpen);
  const scheduleRouteMounted = useStickyMount(scheduleRouteOpen);
  const reportingRouteMounted = useStickyMount(reportingRouteOpen);
  const integrationsRouteMounted = useStickyMount(integrationsRouteOpen);
  const importsRouteMounted = useStickyMount(importsRouteOpen);
  const diagnosticsRouteMounted = useStickyMount(diagnosticsRouteOpen);
  const compareMounted = useStickyMount(compareOpen);
  const salesWorkflowMounted = useStickyMount(salesWorkflowOpen);
  const quoteBuilderActive = [WORKSPACE_ROUTE_IDS.QUOTE_NEW, WORKSPACE_ROUTE_IDS.QUOTE_EDIT]
    .includes(resolvedWorkspaceRouteId);
  const quoteBuilderMounted = useStickyMount(quoteBuilderActive);
  const [submitState, setSubmitState] = useState({
    saving: false,
    message: ""
  });
  const [availabilityNotice, setAvailabilityNotice] = useState("");
  const [availabilityBlock, setAvailabilityBlock] = useState(null);
  const [editingQuote, setEditingQuote] = useState(EMPTY_EDITING_QUOTE);
  // A just-recorded structured change-request resolution awaiting a version
  // to link to. Best-effort only: cleared unconditionally once a link is
  // attempted, whether or not it succeeds (see DEV_TASKS "Structured
  // change-request version linking").
  const [pendingResolutionLink, setPendingResolutionLink] = useState(null);
  const [changeImpactPreview, setChangeImpactPreview] = useState(EMPTY_CHANGE_IMPACT_PREVIEW);
  const [quoteEditLoadState, setQuoteEditLoadState] = useState({
    quoteId: "",
    loading: false,
    error: ""
  });
  const [quoteEditRetryToken, setQuoteEditRetryToken] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [quoteDirty, setQuoteDirty] = useState(false);
  const [ambientDraftIntentReview, setAmbientDraftIntentReview] = useState(null);
  const [ambientDraftCatalogContext, setAmbientDraftCatalogContext] = useState(null);
  const [ambientDraftReviewResolution, setAmbientDraftReviewResolution] = useState("");
  const [pilotScenarioDraftReview, setPilotScenarioDraftReview] = useState(null);
  const [pilotScenarioDraftProposal, setPilotScenarioDraftProposal] = useState(null);
  const [pilotScenarioReviewResolution, setPilotScenarioReviewResolution] = useState("");
  const [globalPilotRequest, setGlobalPilotRequest] = useState(null);
  const [globalPilotSurfaceModel, setGlobalPilotSurfaceModel] = useState(null);
  const [globalPilotSurfaceOpen, setGlobalPilotSurfaceOpen] = useState(false);
  const [pilotCommandSurfaceOpen, setPilotCommandSurfaceOpen] = useState(true);
  const clearPilotScenarioDraftReview = () => {
    setPilotScenarioDraftReview(null);
    setPilotScenarioDraftProposal(null);
    setPilotScenarioReviewResolution("");
  };
  const ambientDraftOutcomeSaveLabel = pilotScenarioReviewResolution === "applied"
    ? "Save Pilot scenario"
    : ambientDraftReviewResolution === "applied"
    ? ambientDraftIntentReview?.kind === "replace_package"
      ? "Save package change"
      : ambientDraftIntentReview?.kind === "replace_menu_item"
        ? "Save menu replacement"
        : ambientDraftIntentReview?.kind === "reorder_menu"
          ? "Save menu order"
          : "Save reviewed change"
    : "";
  const [touchedFields, setTouchedFields] = useState({});
  const [showStepValidation, setShowStepValidation] = useState(false);
  const [menuSelectionValidationMessage, setMenuSelectionValidationMessage] = useState("");
  const [stepValidation, setStepValidation] = useState(() => buildStepValidation(INITIAL_FORM));
  const [stepStatus, setStepStatus] = useState(() => buildStepStatus({
    currentStep: 1,
    stepValidation: buildStepValidation(INITIAL_FORM)
  }));
  const [templateDefaultsNotice, setTemplateDefaultsNotice] = useState(null);
  const resetChangeImpactPreview = () => {
    changeImpactPreviewGenerationRef.current += 1;
    setChangeImpactPreview(EMPTY_CHANGE_IMPACT_PREVIEW);
  };

  useEffect(() => {
    if (
      (!quoteDirty && !ambientLibraryInteraction.dirty && !ambientLibraryInteraction.busy)
      || typeof window === "undefined"
    ) return undefined;
    const protectPendingWork = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPendingWork);
    return () => window.removeEventListener("beforeunload", protectPendingWork);
  }, [ambientLibraryInteraction.busy, ambientLibraryInteraction.dirty, quoteDirty]);

  useEffect(() => {
    if (!commercialSearchAvailable || typeof document === "undefined") {
      setCommercialSearchOpen(false);
      return undefined;
    }
    const handleCommercialSearchShortcut = (event) => {
      const paletteSurface = document.querySelector('[data-commercial-search-surface="true"]');
      const paletteDialog = paletteSurface?.querySelector('[role="dialog"][aria-modal="true"]');
      const existingDialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      const action = resolveCommercialSearchShortcutAction({
        event,
        paletteOpen: Boolean(commercialSearchOpen && paletteSurface),
        anotherModalOpen: Boolean(existingDialog && !paletteSurface?.contains(existingDialog))
      });
      if (!action) return;
      event.preventDefault();
      if (action === "refocus") {
        const paletteFocusTarget = paletteDialog?.querySelector("#commercial-search-query")
          || paletteDialog?.querySelector("button:not([disabled])")
          || paletteDialog;
        paletteFocusTarget?.focus({ preventScroll: true });
        return;
      }
      openCommercialSearch();
    };
    document.addEventListener("keydown", handleCommercialSearchShortcut);
    return () => document.removeEventListener("keydown", handleCommercialSearchShortcut);
  }, [commercialSearchAvailable, commercialSearchOpen, openCommercialSearch]);

  useEffect(() => {
    if (!openHeaderMenu || typeof document === "undefined") return undefined;
    const handlePointerDown = (event) => {
      if (headerMenusRef.current?.contains(event.target)) return;
      setOpenHeaderMenu("");
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const trigger = openHeaderMenu === "operations"
        ? operationsMenuTriggerRef.current
        : openHeaderMenu === "account"
          ? accountMenuTriggerRef.current
          : moreMenuTriggerRef.current;
      setOpenHeaderMenu("");
      window.requestAnimationFrame(() => trigger?.focus());
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openHeaderMenu]);

  const pushToast = useCallback((message, tone = "info") => {
    const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3600);
  }, []);

  const canLeaveAmbientLibrary = useCallback((nextPlace) => {
    if (ambientLibraryInteraction.busy) {
      pushToast("Wait for the current Library action to finish first.", "info");
      return false;
    }
    if (!quoteDirty && !ambientLibraryInteraction.dirty) return true;
    const work = quoteDirty && ambientLibraryInteraction.dirty
      ? "quote and Library changes"
      : quoteDirty ? "quote changes" : "Library changes";
    return window.confirm(`Discard unsaved ${work} and ${nextPlace}?`);
  }, [ambientLibraryInteraction, pushToast, quoteDirty]);

  useEffect(() => {
    if (browserRoute.surface === "portal") {
      if (!portalRouteAllowed) {
        if (!canLeaveAmbientLibrary("open the customer portal")) {
          const previous = lastWorkspaceLocationRef.current;
          replace(previous.destination, {
            state: previous.state,
            preserveSearch: false,
            preserveHash: false
          });
          return;
        }
        onPortalScopeCommit?.(browserRoute.portalToken);
        return;
      }
      setCatalogRouteInteraction(EMPTY_LIBRARY_INTERACTION);
      setCatalogModalInteraction(EMPTY_LIBRARY_INTERACTION);
      setPortalKey(browserRoute.portalToken);
      setPortalMode(true);
      return;
    }
    if (browserRoute.surface !== "workspace") return;
    lastWorkspaceLocationRef.current = {
      destination: `${browserLocation.pathname}${browserLocation.search}${browserLocation.hash}`,
      state: browserLocation.state
    };
    if (committedPortalToken) {
      onPortalScopeCommit?.("");
      return;
    }
    setPortalKey("");
    setPortalMode(false);
  }, [
    browserLocation.hash,
    browserLocation.pathname,
    browserLocation.search,
    browserLocation.state,
    browserRoute.portalToken,
    browserRoute.surface,
    canLeaveAmbientLibrary,
    committedPortalToken,
    onPortalScopeCommit,
    portalRouteAllowed,
    replace
  ]); // portalMode is intentionally excluded so the explicit in-app preview remains open.

  const nextGlobalPilotRequest = useCallback((target, targetModel) => {
    if (!AMBIENT_UI_ENABLED || !targetModel) return null;
    globalPilotRequestCounterRef.current += 1;
    return {
      id: `global-pilot-${globalPilotRequestCounterRef.current}`,
      target,
      routeId: resolvedWorkspaceRouteId,
      opportunityId: target === "living_opportunity"
        ? targetModel.object.id
        : ""
    };
  }, [resolvedWorkspaceRouteId]);

  const openGlobalPilot = useCallback(async () => {
    if (!AMBIENT_UI_ENABLED || !loadAmbientGlobalPilotTarget) return;
    setOpenHeaderMenu("");
    setGlobalPilotSurfaceOpen(false);
    setGlobalPilotSurfaceModel(null);
    setGlobalPilotRequest(null);
    pushToast("Finding the most useful Pilot context here.", "info");
    if (typeof window !== "undefined") {
      const trigger = globalPilotTriggerRef.current;
      const focusDeadline = window.performance.now() + 1000;
      const focusMountedDraftCommand = () => {
        const activeElement = document.activeElement;
        if (
          activeElement
          && activeElement !== document.body
          && activeElement !== trigger
        ) return;
        const commandInput = wizardRef.current?.querySelector(".pilot-command-input");
        const inputVisible = commandInput
          && commandInput.closest('[aria-hidden="true"]') === null
          && commandInput.getClientRects().length > 0;
        if (inputVisible) {
          commandInput.scrollIntoView?.({ block: "center", behavior: "smooth" });
          commandInput.focus?.({ preventScroll: true });
          return;
        }
        if (window.performance.now() < focusDeadline) {
          window.requestAnimationFrame(focusMountedDraftCommand);
        }
      };
      window.requestAnimationFrame(focusMountedDraftCommand);
    }
    let targetModel;
    try {
      const { resolveAmbientGlobalPilotTarget } = await loadAmbientGlobalPilotTarget();
      targetModel = resolveAmbientGlobalPilotTarget({
        routeId: resolvedWorkspaceRouteId,
        opportunityId: browserRoute.params?.quoteId || "",
        draftObject: quoteBuilderActive ? {
          id: String(editingQuote.id || "new-draft"),
          type: "quote-draft",
          label: String(
            form.eventName
            || editingQuote.event?.name
            || editingQuote.quoteNumber
            || "New quote draft"
          ).trim()
        } : null,
        pilotCommandEnabled: PILOT_COMMAND_ENABLED
      });
    } catch {
      setGlobalPilotSurfaceOpen(true);
      return;
    }
    setGlobalPilotSurfaceModel(targetModel);
    if (targetModel.target === "living_opportunity") {
      setGlobalPilotRequest(nextGlobalPilotRequest("living_opportunity", targetModel));
      return;
    }
    if (targetModel.target === "draft_command") {
      setGlobalPilotRequest(nextGlobalPilotRequest("draft_command", targetModel));
      return;
    }
    setGlobalPilotSurfaceOpen(true);
  }, [
    browserRoute.params?.quoteId,
    editingQuote.event?.name,
    editingQuote.id,
    editingQuote.quoteNumber,
    form.eventName,
    nextGlobalPilotRequest,
    pushToast,
    quoteBuilderActive,
    resolvedWorkspaceRouteId
  ]);

  const handleGlobalPilotResolution = useCallback((resolution) => {
    if (!AMBIENT_UI_ENABLED || !globalPilotSurfaceModel) return;
    if (["opened", "focused"].includes(resolution?.status)) return;
    setGlobalPilotSurfaceModel({
      ...globalPilotSurfaceModel,
      target: "recovery",
      reason: String(
        resolution?.reason
        || "Pilot could not confirm which opportunity or draft you meant from this view."
      ).trim(),
      consequence: "Pilot did not switch to another opportunity or draft, and nothing in the workspace changed.",
      nextResolution: {
        id: "open-opportunities",
        label: "Choose an opportunity"
      }
    });
    setGlobalPilotSurfaceOpen(true);
  }, [globalPilotSurfaceModel]);

  const closeGlobalPilotSurface = useCallback(() => {
    if (!AMBIENT_UI_ENABLED) return;
    setGlobalPilotSurfaceOpen(false);
  }, []);

  const chooseGlobalPilotOpportunity = useCallback(() => {
    if (!AMBIENT_UI_ENABLED) return;
    setGlobalPilotSurfaceOpen(false);
    setGlobalPilotRequest(null);
    navigateWorkspace(WORKSPACE_PATHS.quotes);
  }, [navigateWorkspace]);

  useEffect(() => {
    if (!AMBIENT_UI_ENABLED) return;
    const previousRouteId = globalPilotRouteRef.current;
    globalPilotRouteRef.current = resolvedWorkspaceRouteId;
    if (!previousRouteId || previousRouteId === resolvedWorkspaceRouteId) return;
    if (globalPilotRequest?.routeId === resolvedWorkspaceRouteId) return;
    setGlobalPilotSurfaceOpen(false);
    setGlobalPilotSurfaceModel(null);
    setGlobalPilotRequest(null);
  }, [globalPilotRequest?.routeId, resolvedWorkspaceRouteId]);

  useEffect(() => {
    if (!PILOT_COMMAND_ENABLED) return;
    setPilotCommandSurfaceOpen(true);
  }, [resolvedWorkspaceRouteId]);

  const openAmbientWorkflow = useCallback((target = {}, options = {}) => {
    const result = navigateAmbientWorkflow(target, options);
    if (result?.status === "recovery") {
      pushToast(`${result.reason} ${result.nextResolution}`, "warning");
    }
    return result;
  }, [navigateAmbientWorkflow, pushToast]);

  const openAmbientConversation = useCallback((quoteId, options = {}) => {
    const result = navigateAmbientConversation(quoteId, options);
    if (result?.status === "recovery") {
      pushToast(`${result.reason} ${result.nextResolution}`, "warning");
    }
    return result;
  }, [navigateAmbientConversation, pushToast]);

  const markFieldsTouched = (fields = []) => {
    const unique = Array.from(new Set(fields.filter(Boolean)));
    if (!unique.length) return;
    if (typeof loadAmbientProductAnalytics === "function") {
      const observedAtMs = Date.now();
      void loadAmbientProductAnalytics()
        .then((analytics) => analytics.recordProductAnalyticsFirstIntent({ observedAtMs }))
        .catch(() => {});
    }
    setTouchedFields((prev) => {
      const next = { ...prev };
      let changed = false;
      unique.forEach((field) => {
        if (!next[field]) {
          next[field] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  };

  const releaseTemplateDefault = (field, itemId = "") => {
    setTemplateDefaultsNotice((current) => {
      if (!current?.ownership) return current;
      const ownership = releaseTemplateDefaultsOwnership(current.ownership, field, itemId);
      return hasTemplateDefaultsOwnership(ownership)
        ? { ...current, ownership }
        : null;
    });
  };

  const handleStep1FieldChange = (field, value) => {
    markFieldsTouched([field]);
    releaseTemplateDefault(field);
    setQuoteDirty(true);
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleStep1FieldBlur = (field) => {
    markFieldsTouched([field]);
  };

  const handleSelectionTouched = (field, itemId) => {
    markFieldsTouched([field]);
    releaseTemplateDefault(field, itemId);
    if (
      ambientDraftIntentReview
      && ["pkg", "menuItems", "menuItemQuantities"].includes(String(field || "").trim())
    ) {
      setAmbientDraftIntentReview(null);
      setAmbientDraftCatalogContext(null);
      setAmbientDraftReviewResolution("");
    }
    setQuoteDirty(true);
  };

  const handleAddonSelection = (addonId, selected) => {
    recordProductAnalyticsEvent(selected ? "addon_selected" : "addon_removed", { addonId });
  };

  const stepperModel = useMemo(
    () => buildStepperModel({ currentStep: step, stepStatus }),
    [step, stepStatus]
  );
  const completedStepCount = stepperModel.filter((item) => item.status === "completed").length;
  const currentStepMeta = stepperModel.find((item) => item.stepNumber === step) || stepperModel[0];
  const nextStepOutcome = {
    1: "Build the menu",
    2: "Compare packages and services",
    3: "Review pricing",
    4: "Prepare the draft"
  }[step] || "Continue";
  const step1Validation = stepValidation.step1 || { valid: false, missingFields: [], fieldErrors: {} };
  const step1CanAdvance = step1Validation.valid;

  const effectiveMenuSections = useMemo(
    () => (Array.isArray(dynamicMenuSections) ? dynamicMenuSections : []),
    [dynamicMenuSections]
  );

  const selectedMenuItemCount = (Array.isArray(form.menuItems) ? form.menuItems : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .length;

  const menuSelectionGuidance = useCallback(() => {
    const configuredItemCount = effectiveMenuSections.reduce(
      (count, section) => count + (Array.isArray(section?.items) ? section.items.length : 0),
      0
    );
    if (configuredItemCount > 0) {
      return "Choose at least one menu item before continuing. The selected items will appear on the saved proposal.";
    }
    return authSession.isAdmin
      ? "This event type has no menu items yet. Use Add menu items to populate the catalog, then select at least one item for this quote."
      : "This event type has no menu items yet. Ask an organization admin to add menu items, then return here and select at least one.";
  }, [authSession.isAdmin, effectiveMenuSections]);

  const showMissingMenuSelection = useCallback(({ moveToMenuStep = false } = {}) => {
    const message = menuSelectionGuidance();
    setMenuSelectionValidationMessage(message);
    setSubmitState((prev) => ({ ...prev, saving: false, message }));
    if (moveToMenuStep) setStep(2);
  }, [menuSelectionGuidance]);

  useEffect(() => {
    if (selectedMenuItemCount < 1 || !menuSelectionValidationMessage) return;
    setMenuSelectionValidationMessage("");
    setSubmitState((prev) => (
      prev.message === menuSelectionValidationMessage
        ? { ...prev, message: "" }
        : prev
    ));
  }, [menuSelectionValidationMessage, selectedMenuItemCount]);

  useEffect(() => {
    if (step !== 2 || !menuSelectionValidationMessage) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const firstMenuChoice = document.querySelector(
        ".wizard-panel .menu-library input[type='checkbox']"
      );
      const focusTarget = firstMenuChoice || menuSelectionValidationRef.current;
      focusTarget?.scrollIntoView({ behavior: "smooth", block: "center" });
      focusTarget?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuSelectionValidationMessage, step]);

  const effectiveSettings = useMemo(() => {
    const featureFlags = {
      ...DEFAULT_FEATURE_FLAGS,
      ...normalizeFeatureFlags(catalog.settings?.featureFlags)
    };
    return {
      ...catalog.settings,
      organizationName: String(organization?.name || "").trim(),
      menuSections: effectiveMenuSections,
      featureFlags,
      guidedSellingEnabled: (catalog.settings?.guidedSellingEnabled !== false) && featureFlags.guidedSelling
    };
  }, [catalog.settings, effectiveMenuSections, organization?.name]);
  const pilotScenarioCatalogContext = useMemo(() => {
    if (!AMBIENT_PILOT_COMMANDS_ENABLED) return null;
    return {
      organizationId: authSession.organizationId,
      catalog: {
        ...catalog,
        settings: effectiveSettings
      }
    };
  }, [
    authSession.organizationId,
    catalog.addons,
    catalog.error,
    catalog.loading,
    catalog.observedAtISO,
    catalog.packages,
    catalog.rentals,
    catalog.source,
    effectiveSettings
  ]);
  const featureFlags = effectiveSettings.featureFlags || DEFAULT_FEATURE_FLAGS;
  const customerPortalEnabled = featureFlags.customerPortal !== false;
  const eventScheduleEnabled = featureFlags.eventSchedule !== false;
  const integrationsEnabled = featureFlags.integrationsOps !== false;
  const diagnosticsEnabled = featureFlags.diagnostics !== false;
  const dashboardEnabled = featureFlags.reportingDashboard !== false;
  const quoteCompareEnabled = featureFlags.quoteCompare !== false;
  const aiAssistEnabled = featureFlags.aiAssist !== false;
  const aiAutopilotEnabled = aiAssistEnabled && featureFlags.aiAutopilot === true;
  useEffect(() => {
    setStepValidation(buildStepValidation(form));
  }, [form]);

  useEffect(() => {
    setStepStatus(buildStepStatus({
      currentStep: step,
      stepValidation
    }));
  }, [step, stepValidation]);

  useEffect(() => {
    if (step === 1 && !step1CanAdvance) return;
    if (!showStepValidation) return;
    setShowStepValidation(false);
  }, [showStepValidation, step, step1CanAdvance]);

  useEffect(() => {
    setOrganizationId(authSession.organizationId);
    setActiveOrganizationId(authSession.organizationId);
    setQuoteStoreOrganizationId(authSession.organizationId);
  }, [authSession.organizationId, setOrganizationId]);

  useEffect(() => {
    const organizationId = String(authSession.organizationId || "").trim();
    if (!organizationId || !authSession.isStaff || catalog.loading) return;
    let cancelled = false;
    const beginSession = () => {
      if (cancelled) return;
      beginWizardAnalyticsSession({ organizationId, mode: editingQuote.id ? "edit" : "create" });
    };
    if (typeof loadAmbientProductAnalytics === "function") {
      void loadAmbientProductAnalytics().then(beginSession).catch(beginSession);
    } else {
      beginSession();
    }
    return () => {
      cancelled = true;
    };
  }, [authSession.isStaff, authSession.organizationId, catalog.loading, editingQuote.id]);

  useEffect(() => {
    const nextGlobal = String(globalEventTypeId || "").trim();
    if (!nextGlobal) return;
    if (nextGlobal === String(form.eventTypeId || "").trim()) return;
    setForm((prev) => ({
      ...prev,
      eventTypeId: nextGlobal,
      menuItems: [],
      menuItemQuantities: {}
    }));
  }, [globalEventTypeId, form.eventTypeId]);

  const totals = useMemo(
    () => calculateQuote(form, catalog, effectiveSettings),
    [form, catalog, effectiveSettings]
  );
  const proposalReadiness = useMemo(
    () => buildProposalReadiness(form, totals),
    [form, totals]
  );

  const recommendations = useMemo(
    () => buildUpsellRecommendations({ form, catalog, totals, settings: effectiveSettings }),
    [form, catalog, totals, effectiveSettings]
  );
  const quoteEditRouteId = resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.QUOTE_EDIT
    ? String(browserRoute.params?.quoteId || "").trim()
    : "";
  const quoteEditReady = Boolean(quoteEditRouteId && editingQuote.id === quoteEditRouteId);
  const isEditingQuote = quoteEditReady;
  const currentChangeImpactFormKey = JSON.stringify(form);
  const changeImpactPresentationError = changeImpactPreview.error || (
    changeImpactPreview.model
    && changeImpactPreview.formKey
    && changeImpactPreview.formKey !== currentChangeImpactFormKey
      ? "Quote inputs changed after this preview. The retained result is stale; refresh it before relying on the comparison."
      : ""
  );
  const changeImpactPreviewAvailable = isEditingQuote
    && String(catalog.source || "").trim().toLowerCase().startsWith("firebase");
  const organizationName = String(organization?.name || "").trim();
  const tenantBrandName = String(catalog.settings?.brandName || "").trim();
  const tenantBrandTagline = String(catalog.settings?.brandTagline || "").trim();
  const tenantBrandLogoUrl = String(catalog.settings?.brandLogoUrl || "").trim();
  const workspaceName = String(
    tenantBrandName
    || organization?.name
    || authSession.organizationId
    || "Organization workspace"
  ).trim();
  const tenantTimeZone = String(effectiveSettings.businessTimeZone || "").trim();
  const brandPrimaryColor = catalog.settings?.brandPrimaryColor || "#c99334";
  const brandAccentColor = catalog.settings?.brandAccentColor || "#f0d29a";
  const brandDarkAccentColor = catalog.settings?.brandDarkAccentColor || "#8d611a";
  const brandBackgroundStart = catalog.settings?.brandBackgroundStart || "#100d09";
  const brandBackgroundMid = catalog.settings?.brandBackgroundMid || "#221a12";
  const brandBackgroundEnd = catalog.settings?.brandBackgroundEnd || "#ae7d2b";
  const brandCrew = Array.isArray(catalog.settings?.brandCrew) ? catalog.settings.brandCrew : [];
  const scheduleStaffLeads = brandCrew
    .map((member) => String(member?.label || "").trim())
    .filter(Boolean);
  const scheduleCapacityLimit = Math.max(1, Number(catalog.settings?.capacityLimit || 400));
  const appThemeVars = {
    "--tone-gold-1": brandAccentColor,
    "--tone-gold-2": brandPrimaryColor,
    "--tone-gold-3": brandDarkAccentColor,
    "--app-bg-start": brandBackgroundStart,
    "--app-bg-mid": brandBackgroundMid,
    "--app-bg-end": brandBackgroundEnd
  };
  const routedToolAuthorized = (
    (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.STAFF
      && authSession.isAdmin
      && OPERATIONAL_STAFFING_UI_ENABLED)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.SCHEDULE && eventScheduleEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.REPORTING && dashboardEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INTEGRATIONS && integrationsEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.DIAGNOSTICS && diagnosticsEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CATALOG && authSession.isAdmin)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.IMPORTS && authSession.isAdmin)
  );
  const workspaceShellModel = {
    mode: CUSTOMER_CENTERED_WORKSPACE_ENABLED ? "workspace" : "legacy",
    activeSection: quoteBuilderActive ? "quotes" : browserRoute.section,
    active: { quoteBuilder: quoteBuilderActive },
    showNotFound: browserRoute.routeId === WORKSPACE_ROUTE_IDS.NOT_FOUND
      || browserRoute.routeId === WORKSPACE_ROUTE_IDS.OUTSIDE
      || ([
        WORKSPACE_ROUTE_IDS.STAFF,
        WORKSPACE_ROUTE_IDS.SCHEDULE,
        WORKSPACE_ROUTE_IDS.REPORTING,
        WORKSPACE_ROUTE_IDS.CATALOG,
        WORKSPACE_ROUTE_IDS.IMPORTS,
        WORKSPACE_ROUTE_IDS.INTEGRATIONS,
        WORKSPACE_ROUTE_IDS.DIAGNOSTICS
      ].includes(resolvedWorkspaceRouteId) && !routedToolAuthorized)
      || (!CUSTOMER_CENTERED_WORKSPACE_ENABLED && [
        WORKSPACE_ROUTE_IDS.STAFF,
        WORKSPACE_ROUTE_IDS.CUSTOMER_LIST,
        WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL,
        WORKSPACE_ROUTE_IDS.MESSAGING
      ].includes(resolvedWorkspaceRouteId))
  };

  useEffect(() => {
    let alive = true;

    if (isUnscopedPlatformOperator || catalog.loading) {
      setDynamicMenuLoadedEventTypeId("");
      return () => {
        alive = false;
      };
    }

    const nextEventTypeId = String(form.eventTypeId || "").trim();
    if (!nextEventTypeId) {
      setDynamicMenuSections([]);
      setDynamicMenuLoading(false);
      setDynamicMenuError("");
      setDynamicMenuLoadedEventTypeId("");
      return () => {
        alive = false;
      };
    }

    async function loadMenu() {
      setDynamicMenuLoading(true);
      setDynamicMenuError("");
      setDynamicMenuLoadedEventTypeId("");
      try {
        const sections = await catalog.loadMenuByEvent(nextEventTypeId);
        if (!alive) return;
        setDynamicMenuSections(Array.isArray(sections) ? sections : []);
        setDynamicMenuLoadedEventTypeId(nextEventTypeId);
      } catch (err) {
        if (!alive) return;
        setDynamicMenuLoadedEventTypeId("");
        setDynamicMenuError(err?.message || "Failed to load event type menu.");
      } finally {
        if (alive) {
          setDynamicMenuLoading(false);
        }
      }
    }

    loadMenu();
    return () => {
      alive = false;
    };
  }, [
    catalog.loading,
    catalog.authoritativeVersion,
    catalog.loadMenuByEvent,
    dynamicMenuRetryToken,
    form.eventTypeId,
    isUnscopedPlatformOperator
  ]);

  useEffect(() => {
    if (isUnscopedPlatformOperator || catalog.loading) return;
    const eventTypeId = String(form.eventTypeId || "").trim();
    const waitingForMenu = eventTypeId
      && !dynamicMenuError
      && (dynamicMenuLoading || dynamicMenuLoadedEventTypeId !== eventTypeId);
    if (waitingForMenu) return;

    const menuItemIds = eventTypeId && dynamicMenuLoadedEventTypeId === eventTypeId
      ? new Set(effectiveMenuSections.flatMap((section) => (
          (section.items || [])
            .filter((item) => item?.active !== false)
            .map((item) => String(item?.id || "").trim())
            .filter(Boolean)
        )))
      : null;
    const result = reconcileCatalogSelections({ form, catalog, menuItemIds });
    if (!result.changed) {
      catalogReconciliationNoticeRef.current = "";
      return;
    }

    setForm(result.form);
    if (result.userSelectionChanged) {
      setQuoteDirty(true);
      const fingerprint = JSON.stringify({
        organizationId: authSession.organizationId,
        eventTypeId,
        removed: result.removed
      });
      if (catalogReconciliationNoticeRef.current !== fingerprint) {
        catalogReconciliationNoticeRef.current = fingerprint;
        pushToast(catalogReconciliationNotice(result.removed), "warning");
      }
    }
  }, [
    authSession.organizationId,
    catalog,
    catalog.loading,
    dynamicMenuError,
    dynamicMenuLoadedEventTypeId,
    dynamicMenuLoading,
    effectiveMenuSections,
    form,
    isUnscopedPlatformOperator,
    pushToast
  ]);

  useEffect(() => {
    if (catalog.loading) return;
    setForm((prev) => {
      let changed = false;
      const next = { ...prev };
      const defaultTaxRegion = catalog.settings?.defaultTaxRegion || catalog.settings?.taxRegions?.[0]?.id || "";
      const defaultSeasonProfile = catalog.settings?.defaultSeasonProfile || "auto";

      if (!next.taxRegion && defaultTaxRegion) {
        next.taxRegion = defaultTaxRegion;
        changed = true;
      }
      if (!next.seasonProfileId) {
        next.seasonProfileId = defaultSeasonProfile;
        changed = true;
      }
      if (!next.eventTemplateId) {
        next.eventTemplateId = "custom";
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [catalog.loading, catalog.settings]);

  useEffect(() => {
    if (!eventScheduleEnabled) setScheduleOpen(false);
    if (!integrationsEnabled) setIntegrationsOpen(false);
    if (!diagnosticsEnabled) setDiagnosticsOpen(false);
    if (!dashboardEnabled) setDashboardOpen(false);
    if (!quoteCompareEnabled) setCompareOpen(false);
  }, [eventScheduleEnabled, integrationsEnabled, diagnosticsEnabled, dashboardEnabled, quoteCompareEnabled]);

  useEffect(() => {
    if (!customerPortalEnabled) {
      setPortalMode(false);
      setPortalKey("");
    }
  }, [customerPortalEnabled]);

  useEffect(() => {
    setAvailabilityNotice("");
    setAvailabilityBlock(null);
  }, [form.date, form.venue, form.time, form.hours]);

  useEffect(() => {
    setDiagnosticsUserContext({
      uid: authSession.user?.uid || "",
      email: authSession.user?.email || "",
      role: authSession.role || "customer",
      authenticated: Boolean(authSession.user)
    });
  }, [authSession.user?.uid, authSession.user?.email, authSession.role]);

  useEffect(() => {
    if (!authSession.error) return;
    recordDiagnosticError(new Error(authSession.error), {
      surface: "auth-session",
      action: "load-user-role"
    });
  }, [authSession.error]);

  useEffect(() => {
    if (!catalog.error) return;
    recordDiagnosticError(new Error(catalog.error), {
      surface: "catalog",
      action: "load-catalog"
    });
  }, [catalog.error]);

  const applyEventTemplate = (templateId) => {
    setQuoteDirty(true);
    if (templateId === "custom") {
      setForm((prev) => ({ ...prev, eventTemplateId: "custom" }));
      setTemplateDefaultsNotice(null);
      return;
    }

    const templates = Array.isArray(catalog.settings?.eventTemplates) ? catalog.settings.eventTemplates : [];
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      setForm((prev) => ({ ...prev, eventTemplateId: "custom" }));
      setTemplateDefaultsNotice(null);
      return;
    }

    const addonIds = new Set(catalog.addons.filter((item) => item?.active !== false).map((item) => item.id));
    const rentalIds = new Set(catalog.rentals.filter((item) => item?.active !== false).map((item) => item.id));
    const menuItemIds = new Set(
      effectiveMenuSections.flatMap((section) => (section.items || []).map((item) => item.id))
    );
    const templateMenuItems = (template.menuItems || []).filter((id) => menuItemIds.has(id));
    const templateAddons = (template.addons || []).filter((id) => addonIds.has(id));
    const templateRentals = (template.rentals || []).filter((id) => rentalIds.has(id));
    if (template.eventTypeId) {
      setGlobalEventTypeId(template.eventTypeId);
    }

    const nextForm = {
      ...form,
      eventTemplateId: template.id,
      eventTypeId: template.eventTypeId || form.eventTypeId || "",
      style: template.style || form.style,
      hours: normalizeEventHours(template.hours || form.hours),
      servers: Number(template.servers ?? form.servers ?? 0),
      chefs: Number(template.chefs ?? form.chefs ?? 0),
      bartenders: Number(template.bartenders ?? form.bartenders ?? 0),
      pkg: resolveFirstValidPackageId(catalog.packages, template.pkg || form.pkg),
      addons: templateAddons,
      addonQuantities: templateAddons.reduce((acc, id) => ({ ...acc, [id]: 1 }), {}),
      rentals: templateRentals,
      rentalQuantities: templateRentals.reduce((acc, id) => ({ ...acc, [id]: 1 }), {}),
      menuItems: templateMenuItems,
      menuItemQuantities: templateMenuItems.reduce((acc, id) => ({ ...acc, [id]: 1 }), {}),
      milesRT: Number(template.milesRT || form.milesRT || 0),
      payMethod: template.payMethod || form.payMethod,
      taxRegion: template.taxRegion || form.taxRegion || catalog.settings.defaultTaxRegion || "",
      seasonProfileId: template.seasonProfileId || form.seasonProfileId || "auto",
      bartenderRateTypeId: template.bartenderRateTypeId || form.bartenderRateTypeId || "",
      staffingRateTypeId: template.staffingRateTypeId || form.staffingRateTypeId || "",
      bartenderRateOverride:
        template.bartenderRateOverride === "" || template.bartenderRateOverride === null || template.bartenderRateOverride === undefined
          ? form.bartenderRateOverride
          : Number(template.bartenderRateOverride),
      serverRateOverride:
        template.serverRateOverride === "" || template.serverRateOverride === null || template.serverRateOverride === undefined
          ? form.serverRateOverride
          : Number(template.serverRateOverride),
      serverRateMixCsv:
        template.serverRateMixCsv === null || template.serverRateMixCsv === undefined
          ? form.serverRateMixCsv
          : String(template.serverRateMixCsv || ""),
      chefRateMixCsv:
        template.chefRateMixCsv === null || template.chefRateMixCsv === undefined
          ? form.chefRateMixCsv
          : String(template.chefRateMixCsv || ""),
      chefRateOverride:
        template.chefRateOverride === "" || template.chefRateOverride === null || template.chefRateOverride === undefined
          ? form.chefRateOverride
          : Number(template.chefRateOverride)
    };
    const ownership = createTemplateDefaultsOwnership({
      beforeForm: form,
      afterForm: nextForm,
      appliedFields: [
        "eventTemplateId",
        "eventTypeId",
        "style",
        "hours",
        "servers",
        "chefs",
        "bartenders",
        "pkg",
        "addons",
        "rentals",
        "menuItems",
        "milesRT",
        "payMethod",
        "taxRegion",
        "seasonProfileId",
        "bartenderRateTypeId",
        "staffingRateTypeId",
        "bartenderRateOverride",
        "serverRateOverride",
        "serverRateMixCsv",
        "chefRateMixCsv",
        "chefRateOverride"
      ]
    });
    setForm(nextForm);
    setTemplateDefaultsNotice(buildTemplateDefaultsNotice({
      template,
      catalog,
      ownership
    }));
  };

  const handleEventTypeChange = (eventTypeId) => {
    const nextEventTypeId = String(eventTypeId || "").trim();
    markFieldsTouched(["eventTypeId"]);
    setQuoteDirty(true);
    setGlobalEventTypeId(nextEventTypeId);
    const templates = Array.isArray(catalog.settings?.eventTemplates) ? catalog.settings.eventTemplates : [];
    const matchedTemplate = findTemplateForEventType({
      eventTypeId: nextEventTypeId,
      templates,
      eventTypes: catalog.eventTypes
    });

    const formWithoutPriorTemplate = templateDefaultsNotice?.ownership
      ? restoreTemplateOwnedDefaults({ form, ownership: templateDefaultsNotice.ownership })
      : form;
    const baseForm = {
      ...formWithoutPriorTemplate,
      eventTypeId: nextEventTypeId,
      eventTemplateId: "custom"
    };
    const { nextForm, appliedFields } = applyEventTypeTemplateDefaults({
      form: baseForm,
      template: matchedTemplate,
      catalog,
      touchedFields,
      initialForm: INITIAL_FORM
    });
    const ownership = createTemplateDefaultsOwnership({
      beforeForm: baseForm,
      afterForm: nextForm,
      appliedFields
    });
    setForm(nextForm);

    // Only the fields applyEventTypeTemplateDefaults actually filled in are
    // disclosed here — fields the caller already customized are left out,
    // matching the "never touches user-made selections" rule (audit #17).
    setTemplateDefaultsNotice(buildTemplateDefaultsNotice({
      template: matchedTemplate,
      catalog,
      ownership
    }));
  };

  const clearTemplateDefaults = () => {
    if (!templateDefaultsNotice?.ownership) return;
    setQuoteDirty(true);
    setForm((prev) => restoreTemplateOwnedDefaults({
      form: prev,
      ownership: templateDefaultsNotice.ownership
    }));
    setTemplateDefaultsNotice(null);
  };

  const dismissTemplateDefaultsNotice = () => {
    setTemplateDefaultsNotice(null);
  };

  // CREATE intake apply (docs/INTENT_INTAKE_ADR.md): the extracted event type
  // runs through the canonical handleEventTypeChange first so template
  // defaults cascade for untouched fields, then the operator's explicit
  // extracted facts merge over that result and are marked touched — the same
  // protection ordinary typing gets. Draft-form state only; the trusted
  // create path remains the sole creation authority.
  //
  // guestBand holds the operator's own stated uncertainty for the preview
  // band only (docs/POST_COMPETITIVE_DESIGN.md §4.2). It never persists and
  // never reaches authoritative pricing; typing any different exact count
  // resolves it.
  const [guestBand, setGuestBand] = useState(null);
  useEffect(() => {
    if (!guestBand) return;
    if (Number(form.guests) !== Number(guestBand.appliedValue)) setGuestBand(null);
  }, [form.guests, guestBand]);

  const applyIntentDraft = (draft = {}, meta = null) => {
    const { eventTypeId, ...rest } = draft || {};
    const entries = Object.entries(rest).filter(
      ([, value]) => value !== undefined && value !== null && String(value) !== ""
    );
    if (eventTypeId) handleEventTypeChange(eventTypeId);
    if (entries.length) {
      setQuoteDirty(true);
      markFieldsTouched(entries.map(([key]) => key));
      setForm((prev) => {
        const next = { ...prev };
        for (const [key, value] of entries) next[key] = value;
        return next;
      });
    }
    if (Object.prototype.hasOwnProperty.call(rest, "guests")) {
      setGuestBand(meta?.guestBand || null);
    }
    if (eventTypeId || entries.length) setStep(1);
  };

  // Client-request staging: applies one parsed proposal to the draft form
  // with the same touched-field protection ordinary typing gets. Saving
  // remains the approval — it re-prices authoritatively and versions.
  const stageChangeRequestProposal = (proposal) => {
    if (!proposal) return;
    setQuoteDirty(true);
    markFieldsTouched(proposalTouchedFields(proposal));
    setForm((prev) => applyProposalToForm(prev, proposal));
  };

  const loadCurrentPilotScenarioRuntime = async () => {
    if (
      typeof loadAmbientPackageMenuCatalogEvidence !== "function"
      || typeof loadPilotScenarioDraftReview !== "function"
      || !pilotScenarioCatalogContext
    ) {
      throw new Error("Pilot scenario review is unavailable outside the Ambient workspace.");
    }
    const [catalogEvidenceModule, reviewModule] = await Promise.all([
      loadAmbientPackageMenuCatalogEvidence(),
      loadPilotScenarioDraftReview()
    ]);
    return {
      catalogEvidence: catalogEvidenceModule.buildAmbientPackageMenuCatalogEvidence(
        pilotScenarioCatalogContext
      ),
      reviewModule
    };
  };

  const handoffPilotScenarioToDraftReview = async (proposal) => {
    if (
      ambientDraftIntentReview
      && ambientDraftReviewResolution === "pending_review"
    ) {
      return {
        ok: false,
        acknowledgement: {
          reason: "Resolve the current Package or Menu review before opening a Pilot scenario review.",
          consequence: "Neither pending outcome was changed.",
          nextResolutions: ["Apply or keep the current reviewed outcome, then run Pilot again."]
        }
      };
    }
    if (
      pilotScenarioDraftReview
      && pilotScenarioReviewResolution === "pending_review"
    ) {
      return {
        ok: false,
        acknowledgement: {
          reason: "A Pilot scenario is already awaiting review.",
          consequence: "The existing review remains current and the draft is unchanged.",
          nextResolutions: ["Apply or keep the current scenario before choosing another."]
        }
      };
    }
    let created;
    try {
      const { catalogEvidence, reviewModule } = await loadCurrentPilotScenarioRuntime();
      created = await reviewModule.createPilotScenarioDraftReview({
        proposal,
        organizationId: authSession.organizationId,
        catalogEvidence,
        form
      });
    } catch (error) {
      return {
        ok: false,
        acknowledgement: {
          reason: String(error?.message || "Pilot scenario review could not be prepared.").trim(),
          consequence: "The current draft is unchanged.",
          nextResolutions: ["Keep working from this draft, then retry the scenario review."]
        }
      };
    }
    if (!created.ok) {
      setSubmitState((current) => ({
        ...current,
        saving: false,
        message: `${created.acknowledgement.reason} ${created.acknowledgement.nextResolutions.join(" ")}`
      }));
      return created;
    }
    setPilotScenarioDraftReview(created.review);
    setPilotScenarioDraftProposal(proposal);
    setPilotScenarioReviewResolution("pending_review");
    setSubmitState((current) => ({
      ...current,
      saving: false,
      message: `${created.acknowledgement.reason} ${created.acknowledgement.consequence}`
    }));
    window.requestAnimationFrame(() => {
      const review = wizardRef.current?.querySelector('[data-ambient-pilot-scenario-review="available"]');
      review?.scrollIntoView({ behavior: "smooth", block: "center" });
      review?.querySelector('[data-pilot-scenario-review-action="apply"]')?.focus({ preventScroll: true });
    });
    return created;
  };

  const handleApplyPilotScenarioDraftReview = async (review) => {
    if (
      review !== pilotScenarioDraftReview
      || pilotScenarioReviewResolution !== "pending_review"
      || !pilotScenarioDraftProposal
    ) {
      return {
        ok: false,
        acknowledgement: {
          reason: "This Pilot scenario review is no longer current. Create a new scenario from the current draft."
        }
      };
    }
    let result;
    try {
      const { catalogEvidence, reviewModule } = await loadCurrentPilotScenarioRuntime();
      result = await reviewModule.applyPilotScenarioDraftReview({
        review,
        currentProposal: pilotScenarioDraftProposal,
        organizationId: authSession.organizationId,
        catalogEvidence,
        form,
        confirmed: true
      });
    } catch (error) {
      return {
        ok: false,
        acknowledgement: {
          reason: String(error?.message || "Pilot scenario review could not be applied.").trim(),
          consequence: "The current draft is unchanged.",
          nextResolutions: ["Keep the current draft or retry from the latest opportunity state."]
        }
      };
    }
    if (!result.ok) return result;
    resetChangeImpactPreview();
    setForm(result.form);
    setQuoteDirty(true);
    markFieldsTouched(result.dirtyFields);
    setPilotScenarioReviewResolution("applied");
    setStep(result.dirtyFields.includes("pkg") ? 3 : result.dirtyFields.some((field) => (
      ["menuItems", "menuItemQuantities"].includes(field)
    )) ? 2 : 4);
    setSubmitState((current) => ({
      ...current,
      saving: false,
      message: `${result.acknowledgement.reason} ${result.acknowledgement.consequence} Next step: ${result.acknowledgement.nextResolutions.join(" ")}`
    }));
    return result;
  };

  const handleKeepPilotScenarioDraftReview = (review) => {
    if (
      review !== pilotScenarioDraftReview
      || pilotScenarioReviewResolution !== "pending_review"
    ) {
      return {
        ok: false,
        acknowledgement: { reason: "This Pilot scenario review is no longer current." }
      };
    }
    setPilotScenarioReviewResolution("kept");
    setSubmitState((current) => ({
      ...current,
      saving: false,
      message: "Kept the current draft. No Pilot scenario field was applied, repriced, saved, sent, or published."
    }));
    return { ok: true };
  };

  const applyRecommendation = (item, { userOriginated = true } = {}) => {
    if (!item) return;
    if (userOriginated || recommendationWouldChangeForm(form, item)) {
      setQuoteDirty(true);
    }
    if (userOriginated) {
      if (item.kind === "package") handleSelectionTouched("pkg");
    }
    // Route addon/rental recommendations through handleSelectionTouched (not
    // a bare markFieldsTouched) so an applied id that happens to match a
    // template-sourced one is released from templateDefaultsNotice — "Clear
    // defaults" must never strip a selection the user just deliberately
    // applied here (audit #17).
    if (userOriginated && item.kind === "addon") handleSelectionTouched("addons", item.id);
    if (userOriginated && item.kind === "rental") handleSelectionTouched("rentals", item.id);
    if (userOriginated && item.kind === "addon" && !(form.addons || []).includes(item.id)) {
      handleAddonSelection(item.id, true);
    }

    setForm((prev) => {
      if (item.kind === "package") {
        return { ...prev, eventTemplateId: "custom", pkg: item.id };
      }
      if (item.kind === "addon") {
        const next = new Set(prev.addons || []);
        next.add(item.id);
        return {
          ...prev,
          eventTemplateId: "custom",
          addons: [...next],
          addonQuantities: {
            ...(prev.addonQuantities || {}),
            [item.id]: Math.max(1, Number(prev.addonQuantities?.[item.id] || 1))
          }
        };
      }
      if (item.kind === "rental") {
        const next = new Set(prev.rentals || []);
        next.add(item.id);
        return {
          ...prev,
          eventTemplateId: "custom",
          rentals: [...next],
          rentalQuantities: {
            ...(prev.rentalQuantities || {}),
            [item.id]: Math.max(1, Number(prev.rentalQuantities?.[item.id] || 1))
          }
        };
      }
      return prev;
    });
  };

  useEffect(() => {
    if (!aiAutopilotEnabled) {
      autopilotAppliedRef.current.clear();
      return;
    }
    if (step !== 3) return;
    if (!Array.isArray(recommendations) || recommendations.length === 0) return;
    const nextRecommendation = recommendations.find((item) => !autopilotAppliedRef.current.has(item.key));
    if (!nextRecommendation) return;
    autopilotAppliedRef.current.add(nextRecommendation.key);
    applyRecommendation(nextRecommendation, { userOriginated: false });
  }, [aiAutopilotEnabled, recommendations, step]);

  const handleNextStep = () => {
    if (catalog.loading) return;
    if (step === 1 && !step1CanAdvance) {
      markFieldsTouched(STEP1_REQUIRED_FIELDS.map((field) => field.key));
      setShowStepValidation(true);
      window.requestAnimationFrame(() => {
        const firstInvalid = document.querySelector(".wizard-panel [aria-invalid='true']");
        firstInvalid?.scrollIntoView({ behavior: "smooth", block: "center" });
        firstInvalid?.focus({ preventScroll: true });
      });
      return;
    }
    if (step === 2 && selectedMenuItemCount < 1) {
      showMissingMenuSelection();
      return;
    }
    setShowStepValidation(false);
    recordProductAnalyticsEvent("wizard_step_completed", { step });
    setStep((current) => Math.min(5, current + 1));
  };

  const buildCurrentPricingInput = (source = catalog.source || "") => ({
    organizationId: authSession.organizationId || "",
    quoteId: isEditingQuote ? editingQuote.id : "",
    quoteNumber: isEditingQuote ? editingQuote.quoteNumber || "" : "",
    actor: {
      uid: authSession.user?.uid || "",
      email: authSession.user?.email || "",
      role: authSession.role || "sales"
    },
    form,
    metadata: {
      source,
      generatedAt: new Date().toISOString()
    }
  });

  const handlePreviewChangeImpact = async ({ recovery = false } = {}) => {
    if (!isEditingQuote || !editingQuote.id) return;
    const generation = changeImpactPreviewGenerationRef.current + 1;
    changeImpactPreviewGenerationRef.current = generation;
    const formKey = JSON.stringify(form);
    const priorRequestId = recovery ? changeImpactPreview.simulationRequestId : "";
    setChangeImpactPreview((current) => ({
      ...current,
      requested: true,
      loading: true,
      recovering: recovery === true,
      error: "",
      mutationState: recovery
        ? priorRequestId ? "reconciliation" : "recovery"
        : "submitting",
      mutationKind: "simulation",
      mutationMessage: recovery
        ? priorRequestId
          ? "Reconciling the exact commercial change simulation request."
          : "Starting a corrected commercial change simulation after a definitive rejection."
        : "Requesting a server-authoritative commercial change simulation."
    }));
    try {
      const {
        buildCommercialChangeRequestId,
        simulateCommercialQuoteChange
      } = await import("./lib/commercialChangeAuthorityClient");
      const simulationRequestId = priorRequestId
        || buildCommercialChangeRequestId("simulation");
      const result = await simulateCommercialQuoteChange({
        organizationId: authSession.organizationId || "",
        quoteId: editingQuote.id,
        expectedActiveVersionId: editingQuote.activeVersionId,
        requestId: simulationRequestId,
        form
      });
      if (changeImpactPreviewGenerationRef.current !== generation) return;
      setChangeImpactPreview({
        requested: true,
        loading: false,
        recovering: false,
        error: "",
        model: result.simulation,
        formKey,
        authorityState: result.authorityState,
        simulationRequestId,
        simulationReceiptId: result.simulationReceipt.receiptId,
        authorizationRequired: result.simulationReceipt.authorizationRequired === true,
        approval: null,
        authorizationReceiptId: "",
        applyRequestId: "",
        mutationState: "receipt",
        mutationKind: "simulation",
        mutationMessage: result.authorityState === "enforced"
          ? "The exact simulation receipt is ready for governed authorization."
          : "The exact simulation receipt is ready; enforcement remains dormant for this workspace.",
        applyResult: null,
        applyOutcome: null
      });
    } catch (error) {
      if (changeImpactPreviewGenerationRef.current !== generation) return;
      const { isDefinitiveCommercialChangeError } = await import(
        "./lib/commercialChangeAuthorityClient"
      );
      if (changeImpactPreviewGenerationRef.current !== generation) return;
      const definitive = isDefinitiveCommercialChangeError(error);
      recordDiagnosticError(error, {
        surface: "quote-builder",
        action: "preview-commercial-change-impact",
        quoteId: editingQuote.id
      });
      setChangeImpactPreview((current) => ({
        ...current,
        requested: true,
        loading: false,
        recovering: false,
        error: definitive
          ? "Authoritative change impact was rejected. Correct the saved quote source, then start a new simulation; no change was authorized or applied."
          : "Authoritative change impact is unavailable. Reconcile the exact request before starting another simulation; no change was authorized or applied.",
        simulationRequestId: definitive ? "" : current.simulationRequestId,
        mutationState: definitive ? "error" : "uncertain",
        mutationKind: "simulation",
        mutationMessage: definitive
          ? "The simulation was definitively rejected. Correct the quote source, then start a new simulation request."
          : "No definitive simulation receipt was returned. The same request identity must be reconciled before another simulation starts."
      }));
    }
  };

  const changeImpactScopeIsCurrent = () => Boolean(
    changeImpactPreview.model
    && changeImpactPreview.formKey
    && changeImpactPreview.formKey === JSON.stringify(form)
    && changeImpactPreview.simulationReceiptId
    && changeImpactPreview.model?.identity?.beforeRevisionId === editingQuote.activeVersionId
  );

  const handleRequestChangeAuthorization = async () => {
    if (!changeImpactScopeIsCurrent()) {
      setChangeImpactPreview((current) => ({
        ...current,
        error: "Quote inputs or the saved revision changed after simulation. Re-simulate before requesting authorization.",
        mutationState: "error",
        mutationKind: "approval"
      }));
      return;
    }
    setChangeImpactPreview((current) => ({
      ...current,
      error: "",
      mutationState: "submitting",
      mutationKind: "approval",
      mutationMessage: "Requesting approval for this exact simulation receipt."
    }));
    try {
      const {
        buildCommercialChangeRequestId,
        requestCommercialQuoteChangeAuthorization
      } = await import("./lib/commercialChangeAuthorityClient");
      const result = await requestCommercialQuoteChangeAuthorization({
        organizationId: authSession.organizationId || "",
        quoteId: editingQuote.id,
        simulationReceiptId: changeImpactPreview.simulationReceiptId,
        requestId: buildCommercialChangeRequestId("approval")
      });
      setChangeImpactPreview((current) => ({
        ...current,
        approval: result.approval,
        mutationState: result.approval?.state === "authorized" ? "authorized" : "pending",
        mutationKind: "approval",
        authorizationReceiptId: result.approval?.authorizationReceiptId || "",
        mutationMessage: result.approval?.state === "authorized"
          ? "Administrator authorization is ready for this exact simulation."
          : "Authorization is pending administrator review."
      }));
    } catch (error) {
      recordDiagnosticError(error, {
        surface: "quote-builder",
        action: "request-commercial-change-authorization",
        quoteId: editingQuote.id
      });
      setChangeImpactPreview((current) => ({
        ...current,
        error: error?.message || "The authorization request did not complete.",
        mutationState: "error",
        mutationKind: "approval",
        mutationMessage: "No approval state is assumed. Review the exact simulation and retry."
      }));
    }
  };

  const handleRefreshChangeAuthorization = async () => {
    if (!changeImpactScopeIsCurrent()) return;
    setChangeImpactPreview((current) => ({
      ...current,
      error: "",
      mutationState: "reconciliation",
      mutationKind: "approval",
      mutationMessage: "Refreshing approval state for the exact simulation receipt."
    }));
    try {
      const { getCommercialQuoteChangeAuthorizationState } = await import(
        "./lib/commercialChangeAuthorityClient"
      );
      const result = await getCommercialQuoteChangeAuthorizationState({
        organizationId: authSession.organizationId || "",
        quoteId: editingQuote.id,
        simulationReceiptId: changeImpactPreview.simulationReceiptId
      });
      setChangeImpactPreview((current) => ({
        ...current,
        approval: result.approval,
        authorizationReceiptId: result.approval?.authorizationReceiptId || "",
        mutationState: result.approval?.state === "authorized" ? "authorized" : "pending",
        mutationKind: "approval",
        mutationMessage: result.approval?.state === "authorized"
          ? "Administrator authorization is ready for this exact simulation."
          : "Authorization remains pending for this exact simulation."
      }));
    } catch (error) {
      recordDiagnosticError(error, {
        surface: "quote-builder",
        action: "refresh-commercial-change-authorization",
        quoteId: editingQuote.id
      });
      setChangeImpactPreview((current) => ({
        ...current,
        error: error?.message || "Authorization state could not be refreshed.",
        mutationState: "uncertain",
        mutationKind: "approval",
        mutationMessage: "The retained approval state may be stale. Retry this exact state read before applying."
      }));
    }
  };

  const handleAuthorizeChange = async () => {
    if (!changeImpactScopeIsCurrent()) return;
    setChangeImpactPreview((current) => ({
      ...current,
      error: "",
      mutationState: "submitting",
      mutationKind: "authorization",
      mutationMessage: "Recording administrator authorization for this exact simulation."
    }));
    try {
      const {
        authorizeCommercialQuoteChange,
        buildCommercialChangeRequestId
      } = await import("./lib/commercialChangeAuthorityClient");
      const result = await authorizeCommercialQuoteChange({
        organizationId: authSession.organizationId || "",
        quoteId: editingQuote.id,
        simulationReceiptId: changeImpactPreview.simulationReceiptId,
        requestId: buildCommercialChangeRequestId("authorization")
      });
      setChangeImpactPreview((current) => ({
        ...current,
        approval: result.approval || current.approval,
        authorizationReceiptId: result.authorizationReceipt.receiptId,
        mutationState: "authorized",
        mutationKind: "authorization",
        mutationMessage: "Administrator authorization is bound to this simulation and saved revision."
      }));
    } catch (error) {
      recordDiagnosticError(error, {
        surface: "quote-builder",
        action: "authorize-commercial-change",
        quoteId: editingQuote.id
      });
      setChangeImpactPreview((current) => ({
        ...current,
        error: error?.message || "Commercial change authorization did not complete.",
        mutationState: "error",
        mutationKind: "authorization",
        mutationMessage: "No administrator authorization is assumed. Re-simulate if the source changed."
      }));
    }
  };

  const handleReconcileCommercialChangeApplyOutcome = async () => {
    if (
      !editingQuote.id
      || !changeImpactPreview.applyRequestId
      || !changeImpactPreview.simulationReceiptId
    ) return;
    setChangeImpactPreview((current) => ({
      ...current,
      error: "",
      mutationState: "reconciliation",
      mutationKind: "apply",
      mutationMessage: "Reconciling the exact apply request against its immutable quote revision and server receipt."
    }));
    try {
      const { reconcileCommercialQuoteChangeApplyOutcome } = await import(
        "./lib/commercialChangeAuthorityClient"
      );
      const result = await reconcileCommercialQuoteChangeApplyOutcome({
        organizationId: authSession.organizationId || "",
        quoteId: editingQuote.id,
        simulationReceiptId: changeImpactPreview.simulationReceiptId,
        authorizationReceiptId: changeImpactPreview.authorizationReceiptId,
        applyRequestId: changeImpactPreview.applyRequestId,
        expectedBaseRevisionId:
          changeImpactPreview.model?.identity?.beforeRevisionId || editingQuote.activeVersionId
      });
      if (result.outcomeReceipt.state === "committed") {
        setQuoteDirty(false);
        setSubmitState({
          saving: false,
          message: `Quote ${editingQuote.quoteNumber || editingQuote.id} was proven committed by its exact apply-outcome receipt.`
        });
        setChangeImpactPreview((current) => ({
          ...current,
          error: "",
          applyOutcome: result.outcomeReceipt,
          applyResult: result.commercialChange,
          mutationState: "receipt",
          mutationKind: "apply",
          mutationMessage: result.outcomeReceipt.appliedRevisionIsActive
            ? "The exact quote revision and apply receipt prove this authorized edit committed."
            : "This authorized edit committed, but a later quote revision is now active. Open the authoritative quote record before further work."
        }));
        pushToast("Authorized quote change reconciled as committed.", "success");
        requestWorkflowAttentionRefresh({ force: true });
        setHistoryTarget({ quoteId: editingQuote.id, reason: "updated" });
        navigateWorkspace(buildQuotePath(editingQuote.id));
        return;
      }
      setChangeImpactPreview((current) => ({
        ...current,
        error: "",
        applyOutcome: result.outcomeReceipt,
        applyResult: null,
        mutationState: "recovery",
        mutationKind: "apply",
        mutationMessage: result.outcomeReceipt.sourceChanged
          ? "The server proved this request did not commit and permanently fenced it. The saved quote has since changed; reload it before starting a new simulation."
          : "The server proved this request did not commit and permanently fenced it. Start a fresh simulation before applying again."
      }));
    } catch (error) {
      const { isDefinitiveCommercialChangeError } = await import(
        "./lib/commercialChangeAuthorityClient"
      );
      const definitive = isDefinitiveCommercialChangeError(error);
      recordDiagnosticError(error, {
        surface: "quote-builder",
        action: "reconcile-commercial-change-apply-outcome",
        quoteId: editingQuote.id
      });
      setChangeImpactPreview((current) => ({
        ...current,
        error: error?.message || "The exact commercial change apply outcome could not be reconciled.",
        mutationState: definitive ? "error" : "uncertain",
        mutationKind: "apply",
        mutationMessage: definitive
          ? "The outcome request was definitively rejected. Recover from the authoritative saved quote before starting a new simulation."
          : "The outcome lookup is still uncertain. Retry this same apply request identity; do not submit the quote edit again."
      }));
    }
  };

  const handleRecoverCommercialChangeApply = () => {
    if (changeImpactPreview.applyOutcome?.sourceChanged) {
      setHistoryTarget({ quoteId: editingQuote.id, reason: "updated" });
      navigateWorkspace(buildQuotePath(editingQuote.id));
      return;
    }
    setChangeImpactPreview((current) => ({
      ...current,
      approval: null,
      authorizationReceiptId: "",
      applyRequestId: "",
      applyResult: null,
      applyOutcome: null,
      mutationState: "recovery",
      mutationKind: "simulation",
      mutationMessage: "Starting a fresh simulation after the prior apply request was safely fenced."
    }));
    void handlePreviewChangeImpact({ recovery: false });
  };

  const handleApplyCommercialChange = async () => {
    if (!changeImpactScopeIsCurrent() || !changeImpactPreview.authorizationReceiptId) return;
    if (changeImpactPreview.applyRequestId) {
      await handleReconcileCommercialChangeApplyOutcome();
      return;
    }
    const {
      buildCommercialChangeRequestId,
      isDefinitiveCommercialChangeError
    } = await import("./lib/commercialChangeAuthorityClient");
    const applyRequestId = changeImpactPreview.applyRequestId
      || buildCommercialChangeRequestId("apply");
    setChangeImpactPreview((current) => ({
      ...current,
      applyRequestId,
      error: "",
      mutationState: "applying",
      mutationKind: "apply",
      mutationMessage: "Applying the authorized edit atomically with its immutable invalidation receipts."
    }));
    try {
      const result = await handleSubmitQuote({
        commercialChangeAuthority: {
          simulationReceiptId: changeImpactPreview.simulationReceiptId,
          authorizationReceiptId: changeImpactPreview.authorizationReceiptId,
          applyRequestId
        },
        propagateError: true
      });
      if (!result) return;
      setChangeImpactPreview((current) => ({
        ...current,
        applyResult: result.commercialChange,
        applyOutcome: null,
        mutationState: "receipt",
        mutationKind: "apply",
        mutationMessage: result.commercialChange?.authorityState === "enforced"
          ? `The edit and ${result.commercialChange.totalInvalidationCount} dependency invalidation receipt(s) were committed atomically.`
          : "The quote edit was saved while commercial-change enforcement remained dormant."
      }));
    } catch (error) {
      const definitive = isDefinitiveCommercialChangeError(error);
      setChangeImpactPreview((current) => ({
        ...current,
        applyOutcome: null,
        error: error?.message || "The commercial change apply did not return a receipt.",
        mutationState: definitive ? "error" : "uncertain",
        mutationKind: "apply",
        mutationMessage: definitive
          ? "The server definitively rejected this apply. Correct the source or authorization, then re-simulate."
          : "The apply outcome is uncertain. This screen will not submit it again; refresh the authoritative quote record before taking another action."
      }));
    }
  };

  const handleApplyAmbientDraftIntent = async (intent) => {
    if (
      !ambientDraftIntentReview
      || intent !== ambientDraftIntentReview
      || ambientDraftReviewResolution !== "pending_review"
    ) {
      return {
        ok: false,
        reason: "This Package or Menu review is no longer the current editor handoff. Return to the Living Opportunity and choose the exact outcome again."
      };
    }
    let result;
    try {
      if (typeof loadAmbientPackageMenuDraftAdoption !== "function") {
        throw new Error("Package and Menu draft review is unavailable outside the Ambient workspace.");
      }
      const adoptionModule = await loadAmbientPackageMenuDraftAdoption();
      result = adoptionModule.adoptAmbientPackageMenuDraftChange({
        ambientDraftIntent: intent,
        form,
        catalogContext: ambientDraftCatalogContext
      });
    } catch (error) {
      return {
        ok: false,
        reason: `${String(error?.message || "This change could not be added to the draft.").trim()} The draft is unchanged; retry from the current Living Opportunity.`
      };
    }
    if (!result.ok) {
      return {
        ok: false,
        reason: `${result.acknowledgement.reason} ${result.acknowledgement.nextResolutions.join(" ")}`
      };
    }

    resetChangeImpactPreview();
    setForm(result.form);
    setQuoteDirty(true);
    markFieldsTouched(result.dirtyFields);
    setTemplateDefaultsNotice((current) => {
      if (!current?.ownership) return current;
      const ownership = result.dirtyFields.reduce(
        (next, field) => releaseTemplateDefaultsOwnership(next, field),
        current.ownership
      );
      return hasTemplateDefaultsOwnership(ownership)
        ? { ...current, ownership }
        : null;
    });
    setMenuSelectionValidationMessage("");
    setAmbientDraftReviewResolution("applied");
    const nextStep = intent.kind === "replace_package" ? 3 : 2;
    setStep(nextStep);
    setSubmitState({
      saving: false,
      message: `${result.acknowledgement.reason} ${result.acknowledgement.consequence} Next step: ${result.acknowledgement.nextResolutions.join(" ")}`
    });
    const focusField = intent.kind === "replace_package" ? "pkg" : "menuItems";
    window.requestAnimationFrame(() => {
      const target = wizardRef.current?.querySelector(`[data-ambient-field="${focusField}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
    return result;
  };

  const handleKeepAmbientDraftIntent = (intent) => {
    if (
      !ambientDraftIntentReview
      || intent !== ambientDraftIntentReview
      || ambientDraftReviewResolution !== "pending_review"
    ) {
      return {
        ok: false,
        reason: "This Package or Menu review is no longer current. The editor draft was not changed."
      };
    }
    setAmbientDraftReviewResolution("kept");
    setSubmitState((current) => ({
      ...current,
      saving: false,
      message: intent.kind === "replace_package"
        ? "Kept the saved package. No package outcome was applied, repriced, or saved."
        : "Kept the saved menu state. No menu outcome was applied, repriced, or saved."
    }));
    return { ok: true };
  };

  const handleSubmitQuote = async ({
    commercialChangeAuthority = null,
    propagateError = false
  } = {}) => {
    if (quoteEditRouteId && !quoteEditReady) {
      setSubmitState((current) => ({
        ...current,
        saving: false,
        message: "This saved quote has not loaded for editing. Retry the edit before saving."
      }));
      return;
    }
    if (
      pilotScenarioDraftReview
      && pilotScenarioReviewResolution === "pending_review"
    ) {
      setSubmitState((current) => ({
        ...current,
        saving: false,
        message: "Resolve the pending Pilot scenario review before saving: apply the exact scenario to this draft, or keep the current draft. Nothing has been saved."
      }));
      window.requestAnimationFrame(() => {
        const reviewAction = wizardRef.current?.querySelector('[data-pilot-scenario-review-action="apply"]');
        reviewAction?.scrollIntoView({ behavior: "smooth", block: "center" });
        reviewAction?.focus({ preventScroll: true });
      });
      return null;
    }
    if (
      ambientDraftIntentReview
      && ambientDraftReviewResolution === "pending_review"
    ) {
      setStep(ambientDraftIntentReview.kind === "replace_package" ? 3 : 2);
      setSubmitState((current) => ({
        ...current,
        saving: false,
        message: "Resolve the pending Package or Menu review before saving: apply the exact outcome to this draft, or keep the saved value. Nothing has been saved."
      }));
      window.requestAnimationFrame(() => {
        const reviewAction = wizardRef.current?.querySelector('[data-draft-review-outcome="apply"]');
        reviewAction?.scrollIntoView({ behavior: "smooth", block: "center" });
        reviewAction?.focus({ preventScroll: true });
      });
      return null;
    }
    if (isEditingQuote && changeImpactPreviewAvailable && !commercialChangeAuthority) {
      if (!changeImpactScopeIsCurrent()) {
        setStep(5);
        setSubmitState((current) => ({
          ...current,
          saving: false,
          message: "Build and review a current Change Impact simulation before saving this edit."
        }));
        return null;
      }
      if (
        changeImpactPreview.authorityState === "enforced"
        && changeImpactPreview.authorizationRequired
      ) {
        setStep(5);
        setSubmitState((current) => ({
          ...current,
          saving: false,
          message: "This edit has governed dependencies. Authorize and apply it from Change Impact."
        }));
        return null;
      }
    }
    if (selectedMenuItemCount < 1) {
      showMissingMenuSelection({ moveToMenuStep: true });
      return;
    }
    const requiredError =
      totals.guests <= 0
        ? "Add guest count before saving a quote."
        : !form.name.trim()
          ? "Client name is required."
          : !form.email.trim()
            ? "Client email is required."
            : !/^\S+@\S+\.\S+$/.test(form.email.trim())
              ? "Client email format is invalid."
              : !form.eventTypeId
                ? "Event type is required."
                : !form.date
                  ? "Event date is required."
                  : !form.eventName.trim()
                    ? "Event name is required."
                    : !form.venue.trim()
                      ? "Venue is required."
                      : "";

    if (requiredError) {
      setSubmitState((prev) => ({ ...prev, saving: false, message: requiredError }));
      return;
    }

    setSubmitState((prev) => ({
      ...prev,
      saving: true,
      message: ""
    }));
    try {
      const availability = await checkEventAvailability({
        eventDate: form.date,
        venue: form.venue,
        eventTime: form.time,
        eventHours: form.hours,
        eventGuests: form.guests,
        capacityLimit: scheduleCapacityLimit,
        excludeQuoteId: isEditingQuote ? editingQuote.id : "",
        organizationId: authSession.organizationId
      });
      if (availability.hasBlockingConflict) {
        const bookedConflicts = availability.conflicts
          .filter((item) => item.status === "booked");
        const conflictRefs = bookedConflicts
          .slice(0, 3)
          .map((item) => item.quoteNumber || item.id)
          .join(", ");
        const capacityNote = availability.capacityExceeded
          ? ` Capacity alert: projected load (${availability.sameVenueLoad}) exceeds configured threshold (${availability.capacityLimit}).`
          : "";
        setAvailabilityBlock({
          conflicts: bookedConflicts,
          capacityExceeded: Boolean(availability.capacityExceeded),
          sameVenueLoad: Number(availability.sameVenueLoad || 0),
          capacityLimit: Number(availability.capacityLimit || 0)
        });
        setSubmitState({
          saving: false,
          message:
            `Availability conflict: this date/venue is already booked.` +
            `${conflictRefs ? ` Existing booking(s): ${conflictRefs}.` : ""}` +
            capacityNote +
            " Open the schedule for context or edit the date, time, or venue to continue."
        });
        return;
      }
      setAvailabilityBlock(null);
      const softConflicts = availability.conflicts.filter((item) => item.status === "accepted");
      const notes = [];
      if (softConflicts.length) {
        const refs = softConflicts
          .slice(0, 3)
          .map((item) => item.quoteNumber || item.id)
          .join(", ");
        notes.push(
          `Availability note: ${softConflicts.length} accepted quote(s) already exist for this date/venue${refs ? ` (${refs})` : ""}.`
        );
      }
      if (availability.capacityExceeded) {
        notes.push(
          `Capacity note: projected same-venue load is ${availability.sameVenueLoad} guests (limit ${availability.capacityLimit}).`
        );
      }
      if (notes.length) {
        setAvailabilityNotice(notes.join(" "));
      } else {
        setAvailabilityNotice("");
      }

      const requiresAuthoritativePricing =
        !E2E_ALLOW_NON_AUTHORITATIVE_PRICING
        && String(catalog.source || "").trim().toLowerCase().startsWith("firebase");
      const pricingInput = buildCurrentPricingInput();
      let totalsForPersistence = totals;
      let pricingSnapshot = null;
      let pricingAdjustmentNote = "";

      try {
        const pricingResult = await calculateQuotePricing({
          organizationId: authSession.organizationId || "",
          pricingInput
        });
        const authoritativePricing = pricingResult?.pricing && typeof pricingResult.pricing === "object"
          ? pricingResult.pricing
          : null;
        if (!authoritativePricing) {
          throw new Error("Authoritative pricing response was empty.");
        }
        pricingSnapshot = authoritativePricing;
        totalsForPersistence = buildTotalsFromPricingSnapshot(authoritativePricing, totals);
        const previewTotal = toNumber(totals.total, 0);
        const authoritativeTotal = toNumber(totalsForPersistence.total, previewTotal);
        if (Math.abs(authoritativeTotal - previewTotal) >= 0.01) {
          pricingAdjustmentNote = ` Server pricing adjusted total from ${currency(previewTotal)} to ${currency(authoritativeTotal)}.`;
        }
      } catch (pricingErr) {
        if (requiresAuthoritativePricing) {
          throw new Error(pricingErr?.message || "Failed to calculate authoritative quote pricing.");
        }
      }

      const result = await withTimeout(
        isEditingQuote
          ? updateQuote({
            quoteId: editingQuote.id,
            form,
            totals: totalsForPersistence,
            pricingSnapshot,
            catalogSource: catalog.source,
            settings: effectiveSettings,
            catalog,
            ownerUid: authSession.user?.uid || "",
            ownerEmail: authSession.user?.email || "",
            organizationId: authSession.organizationId,
            ...(commercialChangeAuthority ? { commercialChangeAuthority } : {})
          })
          : submitQuote({
            form,
            totals: totalsForPersistence,
            pricingSnapshot,
            catalogSource: catalog.source,
            settings: effectiveSettings,
            catalog,
            ownerUid: authSession.user?.uid || "",
            ownerEmail: authSession.user?.email || "",
            organizationId: authSession.organizationId
          }),
        SAVE_FLOW_TIMEOUT_MS,
        isEditingQuote ? "updateQuote" : "submitQuote"
      );
      if (isEditingQuote) {
        setQuoteDirty(false);
        setAmbientDraftIntentReview(null);
        setAmbientDraftCatalogContext(null);
        setAmbientDraftReviewResolution("");
        clearPilotScenarioDraftReview();
        recordProductAnalyticsEvent("quote_saved");
        if (typeof loadAmbientProductAnalytics === "function") {
          const observedAtMs = Date.now();
          void loadAmbientProductAnalytics()
            .then((analytics) => analytics.recordProductAnalyticsPricedDraftReceipt({
              pricingAuthority: pricingSnapshot?.authority,
              storage: result.storage,
              observedAtMs
            }))
            .catch(() => {});
        }
        setSubmitState({
          saving: false,
          message: `Quote ${result.quoteNumber} updated in ${result.storage}. Version snapshot saved and rates locked.${pricingAdjustmentNote}`
        });
        pushToast(`Quote ${result.quoteNumber} updated.`, "success");
        // Structured change-request version linking: this save already
        // fully succeeded above, so linking is strictly best-effort — never
        // block navigation or surface its own failure. Cleared either way
        // so a later, unrelated save cannot attempt a stale link.
        if (
          result.storage === "firebase"
          && pendingResolutionLink?.quoteId === editingQuote.id
          && result.activeVersionId
        ) {
          void linkChangeRequestResolutionVersion({
            organizationId: authSession.organizationId,
            quoteId: editingQuote.id,
            resolutionId: pendingResolutionLink.resolutionId,
            versionId: result.activeVersionId
          }).catch((error) => {
            recordDiagnosticError(error, {
              surface: "change-request-record",
              action: "link-version"
            });
          });
          setPendingResolutionLink(null);
        }
        setHistoryTarget({ quoteId: result.id, reason: "updated" });
        navigateWorkspace(buildQuotePath(result.id));
        return result;
      }

      const savedDraftMessage = `Quote ${result.quoteNumber} saved as a draft in ${result.storage}. It has not been sent to the customer.`;
      setQuoteDirty(false);
      setAmbientDraftIntentReview(null);
      setAmbientDraftCatalogContext(null);
      setAmbientDraftReviewResolution("");
      clearPilotScenarioDraftReview();
      recordProductAnalyticsEvent("quote_saved");
      if (typeof loadAmbientProductAnalytics === "function") {
        const observedAtMs = Date.now();
        void loadAmbientProductAnalytics()
          .then((analytics) => analytics.recordProductAnalyticsPricedDraftReceipt({
            pricingAuthority: pricingSnapshot?.authority,
            storage: result.storage,
            observedAtMs
          }))
          .catch(() => {});
      }
      setSubmitState({
        saving: false,
        message: `${savedDraftMessage}${pricingAdjustmentNote}`
      });
      pushToast(`Quote ${result.quoteNumber} saved as a draft.`, "success");
      requestWorkflowAttentionRefresh({ force: true });
      setHistoryTarget({ quoteId: result.id, reason: "created" });
      navigateWorkspace(buildQuotePath(result.id));

      // Quote persistence is the handoff boundary. Owner notification is
      // intentionally non-blocking so a slow/disabled SMS provider cannot
      // delay the exact saved-draft review surface.
      if (result.storage === "firebase" && authSession.isAdmin) {
        void withTimeout(
          notifyOwnerNewQuote({
            quoteId: result.id
          }),
          OWNER_SMS_TIMEOUT_MS,
          "notifyOwnerNewQuote"
        )
          .then((smsResult) => {
            let smsSuffix = "";
            if (smsResult?.sms?.queued || smsResult?.sms?.state === "queued") {
              smsSuffix = " Owner SMS queued; delivery is not yet proven.";
            } else if (smsResult?.sms?.accepted) {
              smsSuffix = " Owner SMS request accepted; delivery is not yet proven.";
            } else if (smsResult?.sms?.reason === "sms_not_configured") {
              smsSuffix = " Owner SMS not configured yet.";
            } else if (smsResult?.sms?.reason === "sms_disabled") {
              smsSuffix = " Owner SMS disabled by configuration.";
            } else if (smsResult?.sms?.requiresReconciliation) {
              smsSuffix = " Owner SMS outcome needs reconciliation; do not retry blindly.";
            } else if (smsResult?.sms?.state === "definite_failure") {
              smsSuffix = " Owner SMS was not accepted.";
            }
            if (!smsSuffix) return;
            setSubmitState((current) => current.message.startsWith(savedDraftMessage)
              ? { ...current, message: `${savedDraftMessage}${smsSuffix}${pricingAdjustmentNote}` }
              : current);
          })
          .catch(() => {
            setSubmitState((current) => current.message.startsWith(savedDraftMessage)
              ? { ...current, message: `${savedDraftMessage} Owner SMS status is unavailable; do not retry blindly.${pricingAdjustmentNote}` }
              : current);
          });
      }
    } catch (err) {
      recordDiagnosticError(err, {
        surface: "app",
        action: "submit-quote",
        eventDate: form.date,
        venue: form.venue,
        guests: totals.guests
      });
      pushToast(err?.message || "Failed to save quote.", "error");
      setSubmitState((prev) => ({
        ...prev,
        saving: false,
        message: err?.message || "Failed to save quote."
      }));
      if (propagateError) throw err;
      return null;
    }
  };

  const handleEditQuote = async (
    quote,
    {
      navigateToRoute = true,
      draftPatch = null,
      draftIntent = null,
      ambientCatalogContext = null
    } = {},
    ambientArrival = null
  ) => {
    const arrivalContext = AMBIENT_UI_ENABLED ? ambientArrival : null;
    if (!quote?.id) {
      if (!AMBIENT_UI_ENABLED) return;
      return {
        status: "recovery",
        reason: "The selected quote has no stable identifier.",
        consequence: "No editor route opened and the current work remains unchanged.",
        nextResolution: "Return to Opportunities and select a valid saved quote."
      };
    }
    if (
      navigateToRoute
      && CUSTOMER_CENTERED_WORKSPACE_ENABLED
      && quoteDirty
      && !window.confirm("Edit this saved quote? Your unsaved quote changes will be discarded.")
    ) {
      if (!AMBIENT_UI_ENABLED) return;
      return {
        status: "cancelled",
        reason: "The route change was cancelled to preserve unsaved quote work.",
        consequence: "The current draft, saved quote, and Ambient scenario remain unchanged.",
        nextResolution: "Save or discard the current draft, then open this priced editor again."
      };
    }

    const safeArrivalContext = AMBIENT_UI_ENABLED
      && arrivalContext
      && (
        String(arrivalContext.object?.id || "").trim() === String(quote.id)
        || String(arrivalContext.object?.opportunityId || "").trim() === String(quote.id)
      )
      && String(arrivalContext.reason || "").trim()
      && String(arrivalContext.consequence || "").trim()
      && String(arrivalContext.nextResolution || "").trim()
      ? arrivalContext
      : null;
    const draftInput = {
      quote,
      previousForm: form,
      catalogPackages: catalog.packages,
      organizationId: authSession.organizationId
    };
    let draftRuntime;
    if (AMBIENT_UI_ENABLED) {
      try {
        if (typeof loadAmbientQuoteDraftRuntime !== "function") {
          throw new Error("Ambient draft context is not available in this build.");
        }
        const runtimeModule = await loadAmbientQuoteDraftRuntime();
        draftRuntime = runtimeModule.hydrateSavedQuoteDraft({
          ...draftInput,
          draftPatch,
          draftIntent,
          ambientCatalogContext,
          ambientEnabled: true
        });
      } catch (error) {
        return {
          status: "recovery",
          reason: String(error?.message || "The Ambient draft context could not be prepared.").trim(),
          consequence: "No editor route opened and the current work remains unchanged.",
          nextResolution: "Return to the opportunity and retry the exact edit outcome."
        };
      }
    } else {
      draftRuntime = hydrateSavedQuoteDraftBase(draftInput);
    }
    if (!draftRuntime.ok) {
      return {
        status: "recovery",
        reason: draftRuntime.reason,
        consequence: draftRuntime.consequence,
        nextResolution: draftRuntime.nextResolution
      };
    }
    const stagedDraftFields = draftRuntime.stagedFields;
    resetChangeImpactPreview();
    clearPilotScenarioDraftReview();
    setGlobalEventTypeId(draftRuntime.eventTypeId);
    setForm(draftRuntime.form);
    setEditingQuote(draftRuntime.editingQuote);
    const packageMenuDraftIntent = draftRuntime.ambientDraftIntent?.family === "package_menu"
      ? draftRuntime.ambientDraftIntent
      : null;
    setAmbientDraftIntentReview(packageMenuDraftIntent);
    setAmbientDraftCatalogContext(packageMenuDraftIntent ? ambientCatalogContext : null);
    setAmbientDraftReviewResolution(packageMenuDraftIntent ? "pending_review" : "");
    setQuoteDirty(stagedDraftFields.length > 0);
    setTouchedFields(Object.fromEntries(stagedDraftFields.map((field) => [field, true])));
    setShowStepValidation(false);
    setTemplateDefaultsNotice(null);
    setAvailabilityBlock(null);
    setAvailabilityNotice("");
    setHistoryTarget({ quoteId: "", reason: "" });
    setStep(1);
    if (navigateToRoute) navigateWorkspace(buildQuoteEditPath(quote.id));
    beginWizardAnalyticsSession({
      organizationId: authSession.organizationId,
      mode: "edit",
      force: true
    });
    const rebookReviewRequired = quote.rebooking?.state === "draft_created_for_staff_review";
    setSubmitState({
      saving: false,
      message: safeArrivalContext
        ? `${quote.event?.name || quote.quoteNumber || quote.id}: ${safeArrivalContext.object.label || "Selected object"}. ${safeArrivalContext.reason} ${safeArrivalContext.consequence} Next step: ${safeArrivalContext.nextResolution}`
        : rebookReviewRequired
        ? `Rebook review required for ${quote.quoteNumber || quote.id}: choose a current-or-future event date, review the copied scope, then save. Delivery remains blocked until that trusted edit succeeds.`
        : `Editing ${quote.quoteNumber || quote.id}. Save will update this quote and keep a version snapshot.`
    });
    const ambientFocusField = draftRuntime.ambientDraftIntent?.focusField || "";
    wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => {
      const exactField = ambientFocusField
        ? wizardRef.current?.querySelector(`[data-ambient-field="${ambientFocusField}"]`)
        : null;
      (exactField || wizardRef.current)?.focus({ preventScroll: true });
      exactField?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return AMBIENT_UI_ENABLED ? {
      status: "opened",
      focusField: ambientFocusField,
      draftIntentFamily: draftRuntime.ambientDraftIntent?.family || ""
    } : undefined;
  };

  const handleCreateCustomerRebook = async (reviewedAction, { mode = "create" } = {}) => {
    const discardDirtyDraft = quoteDirty;
    if (
      mode === "create"
      && discardDirtyDraft
      && !window.confirm(
        "Create this rebook draft? Your current unsaved quote changes will be discarded only after the trusted rebook receipt is confirmed."
      )
    ) {
      const error = new Error("Rebook creation was cancelled before dispatch.");
      error.code = "failed-precondition";
      error.rebookDefinitive = true;
      error.rebookCancelled = true;
      throw error;
    }
    try {
      const receipt = await createRebookQuoteDraft({
        organizationId: authSession.organizationId,
        reviewedAction
      });
      if (discardDirtyDraft) {
        setQuoteDirty(false);
        setEditingQuote(EMPTY_EDITING_QUOTE);
        resetChangeImpactPreview();
      }
      return receipt;
    } catch (error) {
      recordDiagnosticError(error, {
        surface: "customer-360",
        action: "create-rebook-draft"
      });
      throw error;
    }
  };

  useEffect(() => {
    if (resolvedWorkspaceRouteId !== WORKSPACE_ROUTE_IDS.QUOTE_EDIT) {
      setQuoteEditLoadState({ quoteId: "", loading: false, error: "" });
      if (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.QUOTE_NEW && editingQuote.id) {
        directEditLoadRef.current = {
          key: "",
          generation: directEditLoadRef.current.generation + 1
        };
        setEditingQuote(EMPTY_EDITING_QUOTE);
        resetChangeImpactPreview();
        setQuoteDirty(true);
        setSubmitState((current) => ({
          ...current,
          saving: false,
          message: "This in-memory draft is detached from the saved quote and will save as a new quote."
        }));
      }
      return undefined;
    }
    const quoteId = String(browserRoute.params?.quoteId || "").trim();
    const organizationId = String(authSession.organizationId || "").trim();
    if (!quoteId || !organizationId) return undefined;
    if (editingQuote.id === quoteId) {
      setQuoteEditLoadState({ quoteId, loading: false, error: "" });
      return undefined;
    }
    const key = `${organizationId}:${quoteId}`;
    if (directEditLoadRef.current.key === key) return undefined;
    if (
      quoteDirty
      && !window.confirm("Load this saved quote for editing? Your unsaved quote changes will be discarded.")
    ) {
      navigateWorkspace(WORKSPACE_PATHS.quoteNew, { replace: true });
      return undefined;
    }
    const generation = directEditLoadRef.current.generation + 1;
    directEditLoadRef.current = { key, generation };
    setQuoteEditLoadState({ quoteId, loading: true, error: "" });
    setSubmitState((current) => ({ ...current, message: "Loading the saved quote for editing..." }));
    getQuoteById(quoteId)
      .then(async (quote) => {
        if (directEditLoadRef.current.generation !== generation) return;
        const editResult = await handleEditQuote(quote, { navigateToRoute: false });
        if (directEditLoadRef.current.generation !== generation) return;
        if (editResult?.status === "recovery") {
          throw new Error(editResult.reason || "Unable to prepare this saved quote for editing.");
        }
        setQuoteEditLoadState({ quoteId, loading: false, error: "" });
      })
      .catch((error) => {
        if (directEditLoadRef.current.generation !== generation) return;
        const message = error?.message || "Unable to load this quote for editing.";
        setQuoteEditLoadState({ quoteId, loading: false, error: message });
        setSubmitState((current) => ({
          ...current,
          message
        }));
      });
    return () => {
      if (directEditLoadRef.current.generation === generation) {
        directEditLoadRef.current = { key: "", generation: generation + 1 };
      }
    };
  }, [
    authSession.organizationId,
    browserRoute.params?.quoteId,
    editingQuote.id,
    quoteDirty,
    quoteEditRetryToken,
    resolvedWorkspaceRouteId
  ]);

  const handleCorrectAvailability = () => {
    setStep(1);
    setSubmitState((prev) => ({
      ...prev,
      saving: false,
      message: "Update the event date, start time, duration, or venue, then save again to recheck availability."
    }));
    window.requestAnimationFrame(() => {
      wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      wizardRef.current?.querySelector('input[type="date"]')?.focus({ preventScroll: true });
    });
  };

  const handleGetInstantQuote = () => {
    if (quoteDirty && !window.confirm("Start a new quote? Your unsaved changes will be discarded.")) {
      return {
        status: "recovery",
        reason: "The existing unsaved draft was kept.",
        nextResolution: "Continue the current draft or choose Start an opportunity again when you are ready to replace it."
      };
    }
    directEditLoadRef.current = { key: "", generation: directEditLoadRef.current.generation + 1 };
    navigateWorkspace(WORKSPACE_PATHS.quoteNew);
    setEditingQuote(EMPTY_EDITING_QUOTE);
    setAmbientDraftIntentReview(null);
    setAmbientDraftCatalogContext(null);
    setAmbientDraftReviewResolution("");
    clearPilotScenarioDraftReview();
    resetChangeImpactPreview();
    setQuoteDirty(false);
    setForm({
      ...INITIAL_FORM,
      pkg: resolveFirstValidPackageId(catalog.packages),
      taxRegion: catalog.settings?.defaultTaxRegion || catalog.settings?.taxRegions?.[0]?.id || "",
      seasonProfileId: catalog.settings?.defaultSeasonProfile || "auto"
    });
    setGlobalEventTypeId("");
    setTouchedFields({});
    setShowStepValidation(false);
    setAvailabilityNotice("");
    setAvailabilityBlock(null);
    setSubmitState((prev) => ({ ...prev, message: "" }));
    setTemplateDefaultsNotice(null);
    autopilotAppliedRef.current.clear();
    setStep(1);
    beginWizardAnalyticsSession({
      organizationId: authSession.organizationId,
      mode: "create",
      force: true
    });
    wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    return { status: "pending" };
  };

  const handleSignOut = async () => {
    if (!canLeaveAmbientLibrary("sign out")) return;
    try {
      await authSession.signOut();
    } catch (err) {
      recordDiagnosticError(err, {
        surface: "app",
        action: "sign-out"
      });
      setSubmitState((prev) => ({ ...prev, message: err?.message || "Failed to sign out." }));
    }
  };

  const handleRetryTenantResolution = () => {
    clearTenantContextCache();
    window.location.reload();
  };

  const handleRefreshAccess = async () => {
    setSubmitState((prev) => ({ ...prev, message: "Refreshing your role and organization access..." }));
    try {
      await authSession.refreshAccess();
      window.location.reload();
    } catch (err) {
      setSubmitState((prev) => ({
        ...prev,
        message: err?.message || "Unable to refresh access. Try again or ask your organization admin to confirm the invitation."
      }));
    }
  };

  const handleResendVerification = async () => {
    try {
      await authSession.resendVerification();
      setSubmitState((prev) => ({
        ...prev,
        message: "Verification email sent. Open it, verify this address, then return and check again."
      }));
    } catch (err) {
      setSubmitState((prev) => ({
        ...prev,
        message: err?.message || "Unable to send the verification email."
      }));
    }
  };

  const handleRefreshVerification = async () => {
    try {
      const result = await authSession.refreshVerification();
      if (result.emailVerified) {
        window.location.reload();
        return;
      }
      setSubmitState((prev) => ({
        ...prev,
        message: "This email is not verified yet. Open the verification link, then check again."
      }));
    } catch (err) {
      setSubmitState((prev) => ({
        ...prev,
        message: err?.message || "Unable to refresh email verification."
      }));
    }
  };

  const openPortalMode = () => {
    if (!customerPortalEnabled || !canLeaveAmbientLibrary("open the customer portal")) return;
    setCatalogRouteInteraction(EMPTY_LIBRARY_INTERACTION);
    setCatalogModalInteraction(EMPTY_LIBRARY_INTERACTION);
    setPortalKey("");
    setPortalMode(true);
  };

  const closePortalMode = () => {
    setPortalMode(false);
    setPortalKey("");
    requestWorkflowAttentionRefresh({ force: true });
    replace(WORKSPACE_PATHS.home, { preserveSearch: false, preserveHash: false });
  };

  const closeHistoryWorkspace = () => {
    const returnTarget = !CUSTOMER_CENTERED_WORKSPACE_ENABLED
      ? historyTarget.returnFocus === "workflow"
        ? workflowTriggerRef.current
        : historyTarget.quoteId
          ? saveQuoteButtonRef.current
          : historyTriggerRef.current
      : null;
    setHistoryTarget({ quoteId: "", reason: "" });
    requestWorkflowAttentionRefresh({ force: true });
    navigateWorkspace(WORKSPACE_PATHS.home);
    if (returnTarget) {
      window.requestAnimationFrame(() => returnTarget.focus());
    }
  };

  const closeSalesWorkflowWorkspace = () => {
    navigateWorkspace(WORKSPACE_PATHS.home);
  };

  const saveCatalogDuringSetup = async (nextCatalog) => {
    if (!hasConfiguredEventType) {
      return {
        ok: false,
        error: "Open the Menu tab and add at least one customer-specific event type before saving setup."
      };
    }
    const result = await catalog.saveCatalog(nextCatalog);
    if (result.ok) {
      setCatalogModalInteraction(EMPTY_LIBRARY_INTERACTION);
      setAdminOpen(false);
    }
    return result;
  };

  if (tenantContext.loading) {
    return (
      <main className="auth-shell container">
        <WorkspaceStatusCard>
          <h1>Loading Workspace</h1>
          <p className="muted">Resolving tenant context for this host...</p>
        </WorkspaceStatusCard>
      </main>
    );
  }

  if (tenantContext.blocked) {
    return (
      <main className="auth-shell container">
        <WorkspaceStatusCard>
          <h1>Tenant Not Found</h1>
          <p className="muted">
            Host <strong>{tenantContext.hostname || "unknown"}</strong> is not active or is not mapped to a tenant.
          </p>
          <p className="source-note">
            {tenantContext.error || "This domain needs to be activated or mapped to a customer workspace."}
          </p>
          {submitState.message && <p className="warning-note">{submitState.message}</p>}
          <div className="auth-actions">
            <button type="button" className="cta" onClick={handleRetryTenantResolution}>
              Retry Workspace
            </button>
            <a
              className="ghost button-link"
              href="https://mbmapps.com/contact"
              target="_blank"
              rel="noreferrer"
            >
              Contact Support
            </a>
            <a className="ghost button-link" href="https://quotepilot.mbmapps.com/app">
              Open QuotePilot App
            </a>
          </div>
          <p className="source-note">When contacting support, include the hostname shown above.</p>
        </WorkspaceStatusCard>
      </main>
    );
  }

  if (portalMode && customerPortalEnabled) {
    return (
      <div className="app-shell" style={appThemeVars}>
        <CustomerPortalView
          initialPortalKey={portalKey}
          initialPaymentReturn={paymentReturn}
          onBackToStaff={closePortalMode}
        />
      </div>
    );
  }

  if (authSession.loading) {
    return (
      <main className="auth-shell container">
        <WorkspaceStatusCard>
          <h1>Loading</h1>
          <p className="muted">Checking your session...</p>
        </WorkspaceStatusCard>
      </main>
    );
  }

  if (!authSession.user) {
    return <AuthGate sessionError={authSession.error} />;
  }

  if (!authSession.isStaff) {
    const needsEmailVerification = authSession.user.emailVerified !== true;
    return (
      <main className="auth-shell container">
        <WorkspaceStatusCard>
          <h1>{needsEmailVerification ? "Verify Your Email" : "Access Restricted"}</h1>
          {needsEmailVerification ? (
            <>
              <p className="muted">
                Signed in as {authSession.user.email}. Organization invites and staff authority stay locked until this exact address is verified.
              </p>
              <p className="source-note">Use the verification link from Firebase, then return here and check again.</p>
            </>
          ) : (
            <>
              <p className="muted">
                Signed in as {authSession.user.email}. Your account role is <strong>{authSession.role}</strong>.
              </p>
              <p className="source-note">Ask an admin to assign your role and organization, then refresh your session.</p>
            </>
          )}
          {authSession.error && <p className="warning-note">{authSession.error}</p>}
          {submitState.message && <p className="source-note">{submitState.message}</p>}
          <div className="auth-actions">
            {needsEmailVerification && (
              <>
                <button type="button" className="cta" onClick={handleRefreshVerification}>I Verified My Email</button>
                <button type="button" className="ghost" onClick={handleResendVerification}>Resend Verification</button>
              </>
            )}
            {!needsEmailVerification && (
              <button type="button" className="cta" onClick={handleRefreshAccess}>Refresh Access</button>
            )}
            {customerPortalEnabled && <button type="button" className="ghost" onClick={openPortalMode}>Open Customer Portal</button>}
            <button type="button" className={needsEmailVerification ? "ghost" : "cta"} onClick={handleSignOut}>Sign Out</button>
          </div>
        </WorkspaceStatusCard>
      </main>
    );
  }

  if (isUnscopedPlatformOperator) {
    return (
      <div className="app-shell app-shell-neutral" style={appThemeVars}>
        <main className="auth-shell container">
          <WorkspaceStatusCard>
            <p className="eyebrow">Platform Operations</p>
            <h1>Customer Provisioning</h1>
            <p className="muted">
              Create a customer workspace and complete its owner handoff before entering an organization-scoped workspace.
            </p>
            <div className="auth-actions">
              <button type="button" className="cta" onClick={() => openWorkspaceTool(setIntegrationsOpen)}>
                Open Customer Provisioning
              </button>
              <button type="button" className="ghost" onClick={handleSignOut}>Sign Out</button>
            </div>
          </WorkspaceStatusCard>
        </main>

        {integrationsMounted && (
          <WorkspaceLazyTool
            open={integrationsOpen}
            surfaceName="Customer Provisioning"
            component={IntegrationOpsView}
            onClose={closeIntegrationsWorkspace}
            returnFocusRef={workspaceToolReturnFocusRef}
            hasUnsavedWorkspaceChanges={quoteDirty}
          >
            <IntegrationOpsView
              open={integrationsOpen}
              presentation="modal"
              onClose={closeIntegrationsWorkspace}
              returnFocusRef={workspaceToolReturnFocusRef}
              organizationId=""
              settings={{}}
              currentUserEmail={authSession.user?.email || ""}
              currentUserUid={authSession.user?.uid || ""}
              canProvisionCustomer={authSession.isAdmin && authSession.platformAdmin}
              canManageProviders={authSession.isAdmin}
              provisioningOnly
            />
          </WorkspaceLazyTool>
        )}
      </div>
    );
  }

  if (catalog.loading) {
    return (
      <main className="auth-shell container">
        <WorkspaceStatusCard>
          <h1>Loading Catalog</h1>
          <p className="muted">Checking this organization’s configured products and pricing...</p>
        </WorkspaceStatusCard>
      </main>
    );
  }

  if (catalog.requiresFirebase) {
    return (
      <main className="auth-shell container">
        <WorkspaceStatusCard>
          <h1>Catalog Unavailable</h1>
          <p className="muted">
            Firebase catalog access is required in this environment.
          </p>
          <p className="source-note">{catalog.error || "Configure Firebase credentials and reload."}</p>
          <div className="auth-actions">
            <button type="button" className="cta" onClick={catalog.reload}>Retry Catalog</button>
            <button type="button" className="ghost" onClick={() => window.location.reload()}>Reload Workspace</button>
            <button type="button" className="ghost" onClick={handleSignOut}>Sign Out</button>
          </div>
        </WorkspaceStatusCard>
      </main>
    );
  }

  if (!catalogSetupComplete) {
    return (
      <div className="app-shell app-shell-neutral" style={appThemeVars}>
        <main className="auth-shell container">
          <WorkspaceStatusCard>
            <p className="eyebrow">Owner Setup Required</p>
            <h1>Configure Your Catalog</h1>
            <p className="muted">
              Quote creation stays locked until this organization has customer-specific products and reviewed pricing.
            </p>
            <p className="source-note">
              New tenants start blank. Open Catalog Admin to stage an industry starter pack or build a catalog manually; every suggested price still requires your review.
            </p>
            <ul className="source-note">
              <li>Starter Packs: populate a complete Wedding, Corporate, BBQ, or Church & community draft in one click.</li>
              <li>Packages and Menu: review a specifically named package above $0 and at least one event type.</li>
              <li>Pricing: review every fee, tax, deposit, travel, staffing, tier, and seasonal value, then approve the pricing setup.</li>
            </ul>
            <div className="auth-actions">
              {authSession.isAdmin && (
                <button type="button" className="cta" onClick={() => openWorkspaceTool(setAdminOpen)}>
                  Open Admin Catalog
                </button>
              )}
              {!authSession.isAdmin && (
                <button type="button" className="cta" onClick={catalog.reload}>
                  Refresh Catalog Setup
                </button>
              )}
              <button type="button" className="ghost" onClick={handleSignOut}>Sign Out</button>
            </div>
            {!authSession.isAdmin && (
              <p className="warning-note">Ask an organization admin to configure and save the catalog, then use Refresh Catalog Setup.</p>
            )}
          </WorkspaceStatusCard>
        </main>

        {authSession.isAdmin && adminMounted && (
          <WorkspaceLazyTool
            open={adminOpen}
            surfaceName="Catalog Admin"
            component={AdminCatalogView}
            onClose={closeCatalogWorkspace}
            returnFocusRef={workspaceToolReturnFocusRef}
            hasUnsavedWorkspaceChanges={quoteDirty}
          >
            <AdminCatalogView
              open={adminOpen}
              presentation="modal"
              catalog={catalog}
              organizationId={authSession.organizationId}
              onClose={closeCatalogWorkspace}
              returnFocusRef={workspaceToolReturnFocusRef}
              onSave={saveCatalogDuringSetup}
              onApplyStarterPack={catalog.stageStarterPack}
              onCatalogMutation={handleCatalogMutation}
              onReload={catalog.reload}
              saving={catalog.saving}
              selectedEventType={globalEventTypeId}
              onEventTypeChange={setGlobalEventTypeId}
              onInteractionStateChange={setCatalogModalInteraction}
              onToast={pushToast}
            />
          </WorkspaceLazyTool>
        )}
      </div>
    );
  }

  const currentUserEmail = authSession.user.email || "";
  const currentUserUid = authSession.user.uid || "";
  const catalogTool = {
    surfaceName: AMBIENT_UI_ENABLED ? "Library" : "Catalog Admin",
    component: AdminCatalogView,
    enabled: authSession.isAdmin,
    onClose: closeCatalogWorkspace,
    surfaceProps: {
      catalog,
      organizationId: authSession.organizationId,
      onSave: catalog.saveCatalog,
      onApplyStarterPack: catalog.stageStarterPack,
      onCatalogMutation: handleCatalogMutation,
      onReload: catalog.reload,
      saving: catalog.saving,
      initialTab: adminInitialTab,
      onToast: pushToast
    },
    route: {
      mounted: catalogRouteMounted,
      open: catalogRouteOpen,
      component: AMBIENT_UI_ENABLED && AmbientLibraryRoute ? AmbientLibraryRoute : AdminCatalogView,
      props: {
        selectedEventType: globalEventTypeId,
        onEventTypeChange: setGlobalEventTypeId,
        currentUserRole: authSession.role,
        arrivalContext: workspaceArrivalContext?.surfaceId === "ambient-library"
          ? workspaceArrivalContext
          : null,
        arrivalAttempted: workspaceArrivalAttempted,
        onArrivalResolution: setWorkspaceArrivalResolution,
        onInteractionStateChange: setCatalogRouteInteraction
      }
    },
    modal: {
      mounted: adminMounted,
      open: catalogModalOpen,
      props: { onInteractionStateChange: setCatalogModalInteraction }
    }
  };
  const staffTool = {
    surfaceName: "Staff",
    component: StaffWorkspace,
    enabled: authSession.isAdmin && OPERATIONAL_STAFFING_UI_ENABLED,
    onClose: closeStaffWorkspace,
    surfaceProps: {
      organizationId: authSession.organizationId,
      organizationName: workspaceName
    },
    route: { mounted: staffRouteMounted, open: staffRouteOpen },
    modal: { mounted: false, open: false }
  };
  const importsTool = {
    surfaceName: "Import Studio",
    component: ImportStudioView,
    enabled: authSession.isAdmin,
    onClose: closeImportsWorkspace,
    surfaceProps: {
      organizationId: authSession.organizationId,
      organizationName: workspaceName,
      currentUserUid,
      currentUserEmail,
      catalogRevision: Math.max(0, Number(catalog.settings?.catalogRevision || 0)),
      onReload: () => catalog.reload({ background: true }),
      onImported: (result) => {
        catalog.reload({ background: true });
        if (result?.status === "rolled_back") {
          pushToast(`Import ${result.importBatchId} was undone.`, "info");
        } else {
          pushToast(`Imported ${result?.createdCount || 0} record(s) into ${authSession.organizationId}.`, "success");
        }
      }
    },
    route: { mounted: importsRouteMounted, open: importsRouteOpen },
    modal: { mounted: importStudioMounted, open: importsModalOpen }
  };
  const scheduleTool = {
    surfaceName: "Event Schedule",
    component: EventScheduleView,
    enabled: eventScheduleEnabled,
    onClose: closeScheduleWorkspace,
    surfaceProps: {
      organizationId: authSession.organizationId,
      staffLeads: scheduleStaffLeads,
      capacityLimit: scheduleCapacityLimit,
      currentUserEmail,
      arrivalContext: workspaceArrivalContext?.surfaceId === "schedule"
        ? workspaceArrivalContext
        : null,
      onArrivalResolution: setWorkspaceArrivalResolution
    },
    route: { mounted: scheduleRouteMounted, open: scheduleRouteOpen },
    modal: { mounted: scheduleMounted, open: scheduleModalOpen }
  };
  const reportingTool = {
    surfaceName: "Reporting Dashboard",
    component: ReportingDashboardView,
    enabled: dashboardEnabled,
    onClose: closeReportingWorkspace,
    surfaceProps: {
      organizationId: authSession.organizationId,
      addons: catalog.addons,
      arrivalContext: workspaceArrivalContext?.surfaceId === "reporting"
        ? workspaceArrivalContext
        : null,
      onArrivalResolution: setWorkspaceArrivalResolution
    },
    route: { mounted: reportingRouteMounted, open: reportingRouteOpen },
    modal: { mounted: dashboardMounted, open: reportingModalOpen }
  };
  const integrationsTool = {
    surfaceName: "Integrations Ops",
    component: IntegrationOpsView,
    enabled: integrationsEnabled,
    onClose: closeIntegrationsWorkspace,
    surfaceProps: {
      organizationId: authSession.organizationId,
      settings: effectiveSettings,
      currentUserEmail,
      currentUserUid,
      canProvisionCustomer: authSession.isAdmin && authSession.platformAdmin,
      canManageProviders: authSession.isAdmin
    },
    route: { mounted: integrationsRouteMounted, open: integrationsRouteOpen },
    modal: { mounted: integrationsMounted, open: integrationsModalOpen }
  };
  const diagnosticsTool = {
    surfaceName: "Session Diagnostics",
    component: DiagnosticsView,
    enabled: diagnosticsEnabled,
    onClose: closeDiagnosticsWorkspace,
    route: { mounted: diagnosticsRouteMounted, open: diagnosticsRouteOpen },
    modal: { mounted: diagnosticsMounted, open: diagnosticsModalOpen }
  };
  const renderWorkspaceTools = (presentation, tools) => tools.map((tool) => {
    const state = tool[presentation];
    const onClose = presentation === "route" ? returnWorkspaceHome : tool.onClose;
    const Surface = state.component || tool.component;
    return (
      <WorkspaceToolSurface
        key={tool.surfaceName}
        mounted={tool.enabled && state.mounted}
        open={state.open}
        presentation={presentation}
        surfaceName={tool.surfaceName}
        component={Surface}
        onClose={onClose}
        returnFocusRef={workspaceToolReturnFocusRef}
        hasUnsavedWorkspaceChanges={quoteDirty}
        surfaceProps={tool.surfaceProps}
        presentationProps={state.props}
      />
    );
  });

  return (
    <ActiveWorkspaceShell
      model={workspaceShellModel}
      identity={{
        workspaceName,
        tenantBrandName,
        tenantBrandTagline,
        tenantBrandLogoUrl,
        organizationName: String(organization?.name || tenantBrandName || "Catering workspace").trim(),
        brandCrew
      }}
      principal={{ email: authSession.user.email, role: authSession.role, isAdmin: authSession.isAdmin }}
      capabilities={{
        customerPortal: customerPortalEnabled,
        staffDirectory: CUSTOMER_CENTERED_WORKSPACE_ENABLED && OPERATIONAL_STAFFING_UI_ENABLED,
        eventSchedule: eventScheduleEnabled,
        reportingDashboard: dashboardEnabled,
        integrationsOps: integrationsEnabled,
        diagnostics: diagnosticsEnabled
      }}
      draftStatus={{ dirty: quoteDirty, editing: isEditingQuote, quoteNumber: editingQuote.quoteNumber }}
      attentionCount={workflowAttentionCount}
      sounds={{ enabled: workspaceSoundsOn, onToggle: toggleWorkspaceSounds }}
      triggerRefs={{
        headerMenus: headerMenusRef,
        search: commercialSearchTriggerRef,
        quotes: historyTriggerRef,
        workflow: workflowTriggerRef,
        operations: operationsMenuTriggerRef,
        account: accountMenuTriggerRef,
        more: moreMenuTriggerRef,
        pilot: AMBIENT_UI_ENABLED ? globalPilotTriggerRef : undefined
      }}
      menu={{ openId: openHeaderMenu, onOpenChange: setOpenHeaderMenu }}
      actions={{
        onHome: () => navigateWorkspace(WORKSPACE_PATHS.home),
        onCustomers: () => navigateWorkspace(WORKSPACE_PATHS.customers),
        onSearch: openCommercialSearch,
        onNewQuote: handleGetInstantQuote,
        onQuotes: () => {
          setHistoryTarget({ quoteId: "", reason: "" });
          navigateWorkspace(WORKSPACE_PATHS.quotes);
        },
        onMessages: () => navigateWorkspace(WORKSPACE_PATHS.messaging),
        onWorkflow: () => navigateWorkspace(WORKSPACE_PATHS.workflow),
        onStaff: () => navigateWorkspace(WORKSPACE_PATHS.staff),
        onSchedule: (menuTriggerRef) => openRoutedWorkspaceTool(
          WORKSPACE_PATHS.schedule,
          setScheduleOpen,
          { menuTriggerRef }
        ),
        onReporting: (menuTriggerRef) => openRoutedWorkspaceTool(
          WORKSPACE_PATHS.reporting,
          setDashboardOpen,
          { menuTriggerRef }
        ),
        onIntegrations: (menuTriggerRef) => openRoutedWorkspaceTool(
          WORKSPACE_PATHS.integrations,
          setIntegrationsOpen,
          { menuTriggerRef }
        ),
        onImports: (menuTriggerRef) => openRoutedWorkspaceTool(
          WORKSPACE_PATHS.imports,
          setImportStudioOpen,
          { menuTriggerRef }
        ),
        onCatalog: (menuTriggerRef) => openRoutedWorkspaceTool(
          WORKSPACE_PATHS.catalog,
          setAdminOpen,
          { menuTriggerRef, beforeOpen: () => setAdminInitialTab("") }
        ),
        onDiagnostics: (menuTriggerRef) => openRoutedWorkspaceTool(
          WORKSPACE_PATHS.diagnostics,
          setDiagnosticsOpen,
          { menuTriggerRef }
        ),
        onPortal: openPortalMode,
        onPilot: AMBIENT_UI_ENABLED ? openGlobalPilot : undefined,
        onSignOut: handleSignOut
      }}
      searchSurface={commercialSearchAvailable && commercialSearchOpen ? (
        <WorkspaceLazyTool
          open
          surfaceName="Workspace search"
          component={CommercialSearchPalette}
          onClose={closeCommercialSearch}
          returnFocusRef={commercialSearchReturnFocusRef}
        >
          <CommercialSearchPalette
            open
            organizationId={authSession.organizationId}
            onClose={closeCommercialSearch}
            onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
            onOpenQuote={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}
            returnFocusRef={commercialSearchReturnFocusRef}
          />
        </WorkspaceLazyTool>
      ) : null}
      themeVars={appThemeVars}
      ambientOpportunity={AMBIENT_UI_ENABLED && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.QUOTE_DETAIL}
      ambientNavigation={AMBIENT_UI_ENABLED}
    >
      {AMBIENT_UI_ENABLED && AmbientGlobalPilotSurface && (
        <RecoverableErrorBoundary
          active={globalPilotSurfaceOpen}
          surfaceName="Pilot context"
          surfaceKind="tool"
          onRetry={AmbientGlobalPilotSurface.retry}
          onClose={closeGlobalPilotSurface}
          returnFocusRef={globalPilotTriggerRef}
        >
          <Suspense fallback={globalPilotSurfaceOpen ? (
            <section
              className="workspace-arrival-context source-note"
              role="status"
              aria-live="polite"
              data-surface-purpose="clarify reveal_context"
            >
              <strong>Finding Pilot context</strong>
              <span>The current workspace stays unchanged while Pilot prepares the relevant next step.</span>
            </section>
          ) : null}
          >
            <AmbientGlobalPilotSurface
              open={globalPilotSurfaceOpen}
              model={globalPilotSurfaceModel}
              anchorRef={globalPilotTriggerRef}
              returnFocusRef={globalPilotTriggerRef}
              onClose={closeGlobalPilotSurface}
              onChooseOpportunity={chooseGlobalPilotOpportunity}
            />
          </Suspense>
        </RecoverableErrorBoundary>
      )}
      {toasts.length > 0 && (
        <div
          className="toast-stack"
          role="status"
          aria-live="polite"
          aria-atomic="false"
          data-layout-audit-surface="workspace-feedback"
          data-layout-audit-overflow="workspace-feedback"
          data-surface-purpose="clarify resolve reveal_context"
        >
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.tone || "info"}`}>
              {toast.message}
            </div>
          ))}
        </div>
      )}

      {AMBIENT_UI_ENABLED && workspaceArrivalAttempted && !workspaceArrivalContext && (
        <WorkspaceArrivalNotice
          context={null}
          resolution={workspaceArrivalResolution}
          fallbackSurfaceId={resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.MESSAGING
            ? "conversation"
            : resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.WORKFLOW
              ? "workflow"
              : String(resolvedWorkspaceRouteId || "workspace")}
        />
      )}

      {CUSTOMER_CENTERED_WORKSPACE_ENABLED && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.HOME && (
        PILOT_NOW_ENABLED ? (
          <WorkspaceLazyRoute
            surfaceName="Now"
            component={AMBIENT_NOW_ENABLED ? AmbientNowView : NowView}
          >
            <main className="container workspace-route-main">
              {AMBIENT_NOW_ENABLED ? (
                <AmbientNowView
                  snapshot={commercialSnapshot}
                  organizationName={organizationName}
                  organizationId={authSession.organizationId}
                  currentUserRole={authSession.role}
                  tenantTimeZone={tenantTimeZone}
                  onRefresh={commercialSnapshot.refresh}
                  onOpenWorkflow={openAmbientWorkflow}
                  onNewQuote={handleGetInstantQuote}
                />
              ) : (
                <NowView
                  ambientMode={false}
                  snapshot={commercialSnapshot}
                  organizationName={organizationName}
                  organizationId={authSession.organizationId}
                  onRefresh={commercialSnapshot.refresh}
                  onOpenWorkflow={(target = {}) => navigateWorkspace(buildWorkflowPath(target))}
                  onOpenQuote={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}
                  onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
                  onNewQuote={handleGetInstantQuote}
                />
              )}
            </main>
          </WorkspaceLazyRoute>
        ) : AMBIENT_UI_ENABLED ? (
          <main className="container workspace-route-main">
            <section className="panel" role="status" aria-labelledby="ambient-now-gate-title">
              <p className="eyebrow">Now</p>
              <h2 id="ambient-now-gate-title">Ambient briefing is not enabled</h2>
              <p className="source-note">
                Enable the existing Now presentation gate to open the contextual briefing. Opportunities,
                Clients, and Library remain available from persistent orientation.
              </p>
            </section>
          </main>
        ) : (
          <WorkspaceLazyRoute surfaceName="Command Center" component={CommandCenterHome}>
            <main className="container workspace-route-main">
              <CommandCenterHome
                ambientMode={AMBIENT_UI_ENABLED}
                snapshot={commercialSnapshot}
                organizationName={organizationName}
                organizationId={authSession.organizationId}
                onRefresh={commercialSnapshot.refresh}
                onOpenWorkflow={AMBIENT_UI_ENABLED
                  ? openAmbientWorkflow
                  : (target = {}) => navigateWorkspace(buildWorkflowPath(target))}
                onOpenQuote={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}
                onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
                onNewQuote={handleGetInstantQuote}
              />
            </main>
          </WorkspaceLazyRoute>
        )
      )}

      {CUSTOMER_CENTERED_WORKSPACE_ENABLED && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CUSTOMER_LIST && (
        <WorkspaceLazyRoute surfaceName={AMBIENT_UI_ENABLED ? "Clients" : "Customer directory"} component={CustomerDirectoryView}>
          <CustomerDirectoryView
            organizationId={authSession.organizationId}
            organizationName={organizationName}
            onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
            onOpenClientAmbient={navigateAmbientClient}
            onNewQuote={handleGetInstantQuote}
            ambientMode={AMBIENT_UI_ENABLED}
            currentUserRole={authSession.role}
          />
        </WorkspaceLazyRoute>
      )}

      {CUSTOMER_CENTERED_WORKSPACE_ENABLED && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL && (
        <WorkspaceLazyRoute surfaceName="Client overview" component={CustomerWorkspaceView}>
          {AMBIENT_UI_ENABLED && workspaceArrivalContext?.surfaceId === "client-overview" && (
            <WorkspaceArrivalNotice
              context={workspaceArrivalContext}
              resolution={workspaceArrivalResolution}
              fallbackSurfaceId="client-overview"
            />
          )}
          <CustomerWorkspaceView
            organizationId={authSession.organizationId}
            organizationName={organizationName}
            customerId={browserRoute.params?.customerId || ""}
            onBack={() => navigateWorkspace(WORKSPACE_PATHS.customers)}
            onOpenQuotes={() => navigateWorkspace(WORKSPACE_PATHS.quotes)}
            onOpenQuote={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}
            onOpenOpportunity={navigateAmbientOpportunity}
            onOpenConversation={AMBIENT_UI_ENABLED
              ? openAmbientConversation
              : (quoteId) => navigateWorkspace(buildMessagingPath({ quoteId }))}
            onOpenQuoteEdit={(quoteId) => navigateWorkspace(buildQuoteEditPath(quoteId))}
            onCreateRebook={handleCreateCustomerRebook}
            onOpenWorkflow={AMBIENT_UI_ENABLED
              ? openAmbientWorkflow
              : (target = {}) => navigateWorkspace(buildWorkflowPath(target))}
            onOpenSchedule={() => navigateWorkspace(WORKSPACE_PATHS.schedule)}
            scheduleAvailable={eventScheduleEnabled}
            tenantTimeZone={tenantTimeZone}
            isAdmin={authSession.isAdmin}
            currentUserRole={authSession.role}
            ambientMode={AMBIENT_UI_ENABLED}
            arrivalContext={workspaceArrivalContext?.surfaceId === "client-overview"
              ? workspaceArrivalContext
              : null}
            arrivalAttempted={workspaceArrivalAttempted}
            onArrivalResolution={setWorkspaceArrivalResolution}
          />
        </WorkspaceLazyRoute>
      )}

      {messagingOpen && (
        <>
        {AMBIENT_UI_ENABLED && workspaceArrivalContext?.surfaceId === "conversation" && (
          <WorkspaceArrivalNotice
            context={workspaceArrivalContext}
            resolution={workspaceArrivalResolution}
            fallbackSurfaceId="conversation"
          />
        )}
        <WorkspaceLazyRoute surfaceName="Messages" component={MessagingStation}>
          <div className="container workspace-route-main messaging-route-main">
            <MessagingStation
              organizationId={authSession.organizationId}
              seedQuotes={commercialSnapshot.quotes}
              initialQuoteId={browserRoute.messagingFocus?.quoteId || ""}
              arrivalContext={workspaceArrivalContext?.surfaceId === "conversation"
                ? workspaceArrivalContext
                : null}
              arrivalAttempted={workspaceArrivalAttempted}
              onArrivalResolution={setWorkspaceArrivalResolution}
              onSelectQuote={(quoteId) => navigateWorkspace(
                buildMessagingPath({ quoteId }),
                { replace: !quoteId }
              )}
              onOpenEvent={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}
              onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
            />
          </div>
        </WorkspaceLazyRoute>
        </>
      )}

      {AMBIENT_UI_ENABLED && workspaceArrivalContext?.surfaceId === "reporting" && (
        <WorkspaceArrivalNotice
          context={workspaceArrivalContext}
          resolution={workspaceArrivalResolution}
          fallbackSurfaceId="reporting"
        />
      )}

      {AMBIENT_UI_ENABLED && workspaceArrivalContext?.surfaceId === "schedule" && (
        <WorkspaceArrivalNotice
          context={workspaceArrivalContext}
          resolution={workspaceArrivalResolution}
          fallbackSurfaceId="schedule"
        />
      )}

      {renderWorkspaceTools("route", [
        staffTool,
        catalogTool,
        importsTool,
        scheduleTool,
        reportingTool,
        integrationsTool,
        diagnosticsTool
      ])}

      {workspaceShellModel.showNotFound && (
        <WorkspaceLazyRoute surfaceName="Workspace page" component={WorkspaceNotFound}>
          <WorkspaceNotFound
            pathname={browserRoute.pathname}
            reason={resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.STAFF
              ? !authSession.isAdmin
                ? "role-denied"
                : "feature-disabled"
              : resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CATALOG && !authSession.isAdmin
                ? "role-denied"
                : ""}
            routeId={resolvedWorkspaceRouteId}
            ambientMode={AMBIENT_UI_ENABLED}
            onHome={() => navigateWorkspace(WORKSPACE_PATHS.home)}
          />
        </WorkspaceLazyRoute>
      )}

      {quoteBuilderActive && quoteEditRouteId && !quoteEditReady && (
        <main className="container workspace-route-main" aria-labelledby="quote-edit-load-title">
          <section className="panel workspace-not-found">
            <p className="eyebrow">Quotes</p>
            <h1 id="quote-edit-load-title">
              {quoteEditLoadState.error ? "Quote edit unavailable" : "Loading saved quote"}
            </h1>
            {quoteEditLoadState.error ? (
              <p className="error-note" role="alert">{quoteEditLoadState.error}</p>
            ) : (
              <p className="source-note" role="status">
                Loading the exact canonical quote before editing is enabled.
              </p>
            )}
            <div className="right-actions">
              {quoteEditLoadState.error && (
                <button
                  type="button"
                  className="cta"
                  onClick={() => {
                    directEditLoadRef.current = {
                      key: "",
                      generation: directEditLoadRef.current.generation + 1
                    };
                    setQuoteEditRetryToken((value) => value + 1);
                  }}
                >
                  Retry edit
                </button>
              )}
              <button type="button" className="ghost" onClick={() => navigateWorkspace(WORKSPACE_PATHS.quotes)}>
                Back to Quotes
              </button>
            </div>
          </section>
        </main>
      )}

      {quoteBuilderMounted && (
      <main
        className="container wizard-grid"
        ref={wizardRef}
        tabIndex={-1}
        hidden={!quoteBuilderActive || Boolean(quoteEditRouteId && !quoteEditReady)}
        aria-hidden={!quoteBuilderActive || Boolean(quoteEditRouteId && !quoteEditReady)}
      >
        {PILOT_COMMAND_ENABLED && PilotCommandBar && pilotCommandSurfaceOpen && (
          <RecoverableErrorBoundary
            key={`pilot-command-${authSession.organizationId || "no-org"}-${quoteEditRouteId || "new"}`}
            active={pilotCommandSurfaceOpen}
            surfaceName="Pilot for this draft"
            surfaceKind="tool"
            hasUnsavedWorkspaceChanges={quoteDirty}
            onRetry={PilotCommandBar.retry}
            onClose={() => setPilotCommandSurfaceOpen(false)}
          >
            <Suspense fallback={(
              <section className="panel source-note" role="status" data-surface-purpose="clarify">
                Preparing Pilot for this draft. Nothing is changing.
              </section>
            )}>
              <PilotCommandBar
                ambientEnabled={AMBIENT_PILOT_COMMANDS_ENABLED}
                form={form}
                catalog={catalog}
                settings={effectiveSettings}
                styles={Object.keys(STAFF_RULES)}
                canViewStaffMargin={authSession.isStaff}
                scenarioOrganizationId={authSession.organizationId}
                scenarioCatalogContext={pilotScenarioCatalogContext}
                scenarioLockedScope={[]}
                onStageProposal={stageChangeRequestProposal}
                onHandoffScenarioToDraftReview={AMBIENT_PILOT_COMMANDS_ENABLED
                  ? handoffPilotScenarioToDraftReview
                  : undefined}
                contextLabel={globalPilotSurfaceModel?.object?.label || form.eventName?.trim() || "New quote"}
                focusRequest={AMBIENT_UI_ENABLED && globalPilotRequest?.target === "draft_command"
                  ? globalPilotRequest
                  : null}
                onFocusRequestResolution={AMBIENT_UI_ENABLED ? handleGlobalPilotResolution : undefined}
                voiceCaptureMode={AMBIENT_UI_ENABLED ? "hold" : "toggle"}
              />
            </Suspense>
          </RecoverableErrorBoundary>
        )}
        {PILOT_CREATE_ENABLED && CreateIntake
          && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.QUOTE_NEW
          && !editingQuote.id && (
          <CreateIntake
            eventTypes={catalog.eventTypes || []}
            styles={Object.keys(STAFF_RULES)}
            onApplyDraft={applyIntentDraft}
            organizationId={authSession.organizationId}
            onModelParse={parseIntentDraftWithModel}
          />
        )}
        {PILOT_CHANGE_REQUESTS_ENABLED && ChangeRequestPanel
          && isEditingQuote
          && editingQuote?.portalDecision?.decision === "changes_requested"
          && String(editingQuote?.portalDecision?.message || "").trim() && (
          <ChangeRequestPanel
                message={editingQuote.portalDecision.message}
                submittedAtISO={editingQuote.portalDecision.submittedAtISO || ""}
                requestId={editingQuote.portalDecision.requestId || ""}
                form={form}
                catalog={catalog}
                settings={effectiveSettings}
                styles={Object.keys(STAFF_RULES)}
                onStageProposal={stageChangeRequestProposal}
                onRecordParse={
                  String(catalog.source || "").trim().toLowerCase().startsWith("firebase")
                    ? async (payload) => {
                        try {
                          const receipt = await recordChangeRequestParse({
                            organizationId: authSession.organizationId,
                            quoteId: editingQuote.id,
                            ...payload
                          });
                          setPendingResolutionLink({
                            quoteId: editingQuote.id,
                            resolutionId: receipt.resolutionId
                          });
                          return receipt;
                        } catch (error) {
                          if (error && typeof error === "object") {
                            error.definitive = isDefinitiveRecordError(error);
                          }
                          throw error;
                        }
                      }
                    : null
                }
          />
        )}
        <section className="panel wizard-panel">
          {AMBIENT_PILOT_COMMANDS_ENABLED && AmbientPilotScenarioReview && pilotScenarioDraftReview && (
            <RecoverableErrorBoundary
              active
              surfaceName="Pilot scenario review"
              surfaceKind="tool"
              hasUnsavedWorkspaceChanges={quoteDirty}
              onRetry={AmbientPilotScenarioReview.retry}
              onClose={clearPilotScenarioDraftReview}
            >
              <Suspense fallback={(
                <p className="source-note" role="status">
                  Preparing the Pilot scenario review. Your draft stays unchanged.
                </p>
              )}>
                <AmbientPilotScenarioReview
                  review={pilotScenarioDraftReview}
                  onApply={handleApplyPilotScenarioDraftReview}
                  onKeep={handleKeepPilotScenarioDraftReview}
                />
              </Suspense>
            </RecoverableErrorBoundary>
          )}
          {AMBIENT_UI_ENABLED && AmbientDraftIntentReview && ambientDraftIntentReview && (
            <RecoverableErrorBoundary
              active
              surfaceName="Draft change review"
              surfaceKind="tool"
              hasUnsavedWorkspaceChanges={quoteDirty}
              onRetry={AmbientDraftIntentReview.retry}
              onClose={() => {
                setAmbientDraftIntentReview(null);
                setAmbientDraftCatalogContext(null);
                setAmbientDraftReviewResolution("");
              }}
            >
              <Suspense fallback={(
                <p className="source-note" role="status">
                  Preparing the draft change review. Your saved quote stays unchanged.
                </p>
              )}>
                <AmbientDraftIntentReview
                  intent={ambientDraftIntentReview}
                  catalogContext={ambientDraftCatalogContext}
                  onApply={handleApplyAmbientDraftIntent}
                  onKeep={handleKeepAmbientDraftIntent}
                />
              </Suspense>
            </RecoverableErrorBoundary>
          )}
          <RebookQuoteReviewBanner
            quoteNumber={editingQuote.quoteNumber}
            organizationId={editingQuote.organizationId || authSession.organizationId}
            customerId={editingQuote.customerId}
            eventDate={form.date}
            tenantTimeZone={tenantTimeZone}
            rebooking={editingQuote.rebooking}
            onFocusEventDate={() => {
              setStep(1);
              window.requestAnimationFrame(() => {
                wizardRef.current?.querySelector('input[type="date"]')?.focus({ preventScroll: true });
              });
            }}
          />
          <div className="wizard-orientation" aria-live="polite">
            <div>
              <span>Creating this quote</span>
              <strong>{currentStepMeta?.label || "Quote details"}</strong>
            </div>
            <p>{completedStepCount} of {stepperModel.length} decisions complete</p>
          </div>
          <ol className="stepper" ref={stepperRef}>
            {stepperModel.map((stepMeta) => {
              const stepOneMissing = stepMeta.stepNumber === 1 && !step1Validation.valid;
              const stepContents = (
                <>
                  <span className="step-badge">
                    {stepMeta.status === "completed" ? "✓" : stepOneMissing ? "!" : stepMeta.stepNumber}
                  </span>
                  <span className="step-copy">
                    <em>{stepMeta.label}</em>
                    <small>{stepMeta.microcopy}</small>
                    {stepOneMissing && (
                      <small className="step-warning">Missing required fields</small>
                    )}
                  </span>
                </>
              );
              return (
                <li
                  key={stepMeta.label}
                  className={`stepper-item status-${stepMeta.status} ${stepMeta.isLocked ? "is-locked" : ""}`.trim()}
                  aria-current={stepMeta.stepNumber === step ? "step" : undefined}
                >
                  {stepMeta.status === "completed" ? (
                    <button
                      type="button"
                      className="stepper-target"
                      onClick={() => setStep(stepMeta.stepNumber)}
                      aria-label={`Return to ${stepMeta.label}`}
                    >
                      {stepContents}
                    </button>
                  ) : stepContents}
                </li>
              );
            })}
          </ol>

          <MobilePricingSummary
            step={step}
            totals={totals}
            open={mobilePricingOpen}
            onToggle={() => setMobilePricingOpen((current) => !current)}
            toggleRef={mobilePricingToggleRef}
          />

          <div className="step-stage" key={step} data-nav-dir={stepNavDir}>
            {catalog.loading && <p className="source-note">Loading catalog...</p>}
            {!catalog.loading && step === 1 && (
              <StepEvent
                form={form}
                setForm={setForm}
                styles={Object.keys(STAFF_RULES)}
                settings={effectiveSettings}
                onTemplateChange={applyEventTemplate}
                eventTypes={catalog.eventTypes || []}
                onEventTypeChange={handleEventTypeChange}
                onFieldChange={handleStep1FieldChange}
                onFieldBlur={handleStep1FieldBlur}
                touchedFields={touchedFields}
                fieldErrors={step1Validation.fieldErrors}
                showValidation={showStepValidation}
                templateNotice={templateDefaultsNotice}
                onClearTemplateDefaults={clearTemplateDefaults}
                onDismissTemplateNotice={dismissTemplateDefaultsNotice}
              />
            )}
            {!catalog.loading && step === 1 && showStepValidation && !step1CanAdvance && (
              <p className="warning-note step-guidance">
                Complete required fields before continuing: {step1Validation.missingFields.map((field) => field.label).join(", ")}.
              </p>
            )}
            {!catalog.loading && step === 2 && (
              <>
                <StepMenu
                  form={form}
                  setForm={setForm}
                  menuSections={effectiveMenuSections}
                  catalog={catalog}
                  pricingSettings={effectiveSettings}
                  totals={totals}
                  menuLoading={dynamicMenuLoading}
                  menuError={dynamicMenuError}
                  eventTypeLabel={catalog.eventTypes?.find(
                    (item) => String(item.id) === String(form.eventTypeId)
                  )?.name || form.eventTypeId}
                  isAdmin={authSession.isAdmin}
                  onRetry={() => setDynamicMenuRetryToken((value) => value + 1)}
                  onOpenCatalogMenu={() => {
                    setGlobalEventTypeId(form.eventTypeId);
                    openWorkspaceTool(setAdminOpen, {
                      beforeOpen: () => setAdminInitialTab("menu")
                    });
                  }}
                  onSelectionTouched={handleSelectionTouched}
                  packageIncludedMenuItemIds={
                    catalog.packages.find((item) => item.id === form.pkg)?.includedMenuItemIds || []
                  }
                />
                {menuSelectionValidationMessage && (
                  <p
                    className="warning-note step-guidance"
                    role="alert"
                    tabIndex={-1}
                    ref={menuSelectionValidationRef}
                  >
                    {menuSelectionValidationMessage}
                  </p>
                )}
              </>
            )}
            {!catalog.loading && step === 3 && (
              <StepServices
                form={form}
                setForm={setForm}
                catalog={catalog}
                recommendations={recommendations}
                guidedSellingEnabled={effectiveSettings.guidedSellingEnabled !== false}
                aiAssistEnabled={aiAssistEnabled}
                aiAutopilotEnabled={aiAutopilotEnabled}
                onApplyRecommendation={applyRecommendation}
                onSelectionTouched={handleSelectionTouched}
                templateNotice={templateDefaultsNotice}
                onClearTemplateDefaults={clearTemplateDefaults}
                onDismissTemplateNotice={dismissTemplateDefaultsNotice}
                onAddonSelection={handleAddonSelection}
                totals={totals}
                pricingSettings={effectiveSettings}
              />
            )}
            {!catalog.loading && step === 4 && (
              <StepReview
                form={form}
                totals={totals}
                settings={effectiveSettings}
                readiness={proposalReadiness}
              />
            )}
            {!catalog.loading && step === 5 && (
              <>
                <article className="quote-recap-card">
                  <h3>Review before you save</h3>
                  <p><strong>Client:</strong> {form.name || "-"}</p>
                  <p><strong>Event:</strong> {form.eventName || "-"}{form.date ? ` · ${form.date}` : ""}</p>
                  <p><strong>Guests:</strong> {totals.guests}</p>
                  <p><strong>Total:</strong> {currency(totals.total)}</p>
                  <p><strong>Deposit:</strong> {currency(totals.deposit)}</p>
                  <p><strong>Quote validity:</strong> {Math.max(1, Number(catalog.settings?.quoteValidityDays || 30))} days</p>
                  <p className="muted">Saving creates a draft. You'll send it to the customer from the next screen.</p>
                </article>
                <div className="grid two-col">
                  <label className="field">
                    <span>Payment method</span>
                    <select
                      value={form.payMethod}
                      onChange={(e) => {
                        handleSelectionTouched("payMethod");
                        setForm((f) => ({ ...f, payMethod: e.target.value }));
                      }}
                    >
                      <option value="card">Pay by Card</option>
                      <option value="ach">Pay by ACH/Check</option>
                    </select>
                  </label>
                  <article className="summary-total">
                    <p><strong>Final total:</strong> {currency(totals.total)}</p>
                    <p><strong>Deposit due:</strong> {currency(totals.deposit)}</p>
                    <p className="muted">Saving will keep a version snapshot for edits and lifecycle changes.</p>
                  </article>
                </div>
                {isEditingQuote && (
                  <section
                    className="quote-change-impact-preview"
                    data-capability-id="cwf-15b-commercial-change-impact-preview"
                  >
                    <div className="quote-change-impact-preview-head">
                      <div>
                        <p className="eyebrow">Related quote items</p>
                        <h3>Preview change blast radius</h3>
                        <p className="source-note">
                          Server-authoritative comparison of the saved canonical revision and current form. The simulation itself changes nothing; an exact authorization and atomic apply receipt are required when governed dependencies are affected.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={() => handlePreviewChangeImpact({
                          recovery: Boolean(changeImpactPresentationError)
                        })}
                        disabled={!changeImpactPreviewAvailable || changeImpactPreview.loading}
                        title={changeImpactPreviewAvailable
                          ? "Create an immutable server simulation receipt for the current form and saved revision."
                          : "Change impact requires a Firebase-backed canonical quote and trusted pricing."}
                      >
                        {changeImpactPreview.recovering
                          ? "Retrying preview…"
                          : changeImpactPreview.loading
                            ? "Building preview…"
                          : changeImpactPreview.model
                            ? "Refresh impact preview"
                            : "Preview change impact"}
                      </button>
                    </div>
                    {!changeImpactPreviewAvailable && (
                      <p className="warning-note">
                        Authoritative change impact is unavailable in browser-local mode. No client-calculated substitute is shown.
                      </p>
                    )}
                    {changeImpactPreview.requested && (
                      <RecoverableErrorBoundary
                        active
                        surfaceName="Commercial change impact"
                        surfaceKind="tool"
                        onRetry={CommercialChangeImpactPanel.retry}
                        onClose={() => resetChangeImpactPreview()}
                        hasUnsavedWorkspaceChanges={quoteDirty}
                      >
                        <Suspense fallback={<p className="source-note" role="status">Loading change-impact presentation…</p>}>
                          <CommercialChangeImpactPanel
                            model={changeImpactPreview.model}
                            loading={changeImpactPreview.loading}
                            recovering={changeImpactPreview.recovering}
                            error={changeImpactPresentationError}
                            partial={false}
                            authorityState={changeImpactPreview.authorityState}
                            authorizationRequired={changeImpactPreview.authorizationRequired}
                            staffRole={authSession.role}
                            approval={changeImpactPreview.approval}
                            authorizationReceiptId={changeImpactPreview.authorizationReceiptId}
                            mutationState={changeImpactPreview.mutationState}
                            mutationKind={changeImpactPreview.mutationKind}
                            mutationMessage={changeImpactPreview.mutationMessage}
                            applyResult={changeImpactPreview.applyResult}
                            applyOutcome={changeImpactPreview.applyOutcome}
                            scopeCurrent={!changeImpactPresentationError}
                            onRetry={() => handlePreviewChangeImpact({ recovery: true })}
                            onRequestAuthorization={handleRequestChangeAuthorization}
                            onRefreshAuthorization={handleRefreshChangeAuthorization}
                            onAuthorize={handleAuthorizeChange}
                            onApply={handleApplyCommercialChange}
                            onReconcileApplyOutcome={handleReconcileCommercialChangeApplyOutcome}
                            onRecoverApply={handleRecoverCommercialChangeApply}
                            onReturnToEdit={() => {
                              setStep(1);
                              window.requestAnimationFrame(() => {
                                wizardRef.current?.focus({ preventScroll: true });
                              });
                            }}
                          />
                        </Suspense>
                      </RecoverableErrorBoundary>
                    )}
                  </section>
                )}
              </>
            )}
          </div>

          <div className="wizard-actions">
            <div className="right-actions">
              <button className="ghost" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || catalog.loading}>Back</button>
              {quoteCompareEnabled && (
                <button className="ghost" onClick={() => openWorkspaceTool(setCompareOpen)} disabled={catalog.loading || step < 2}>
                  Compare Scenario
                </button>
              )}
            </div>
            <div className="right-actions">
              {step < 5 ? (
                <button
                  className="cta"
                  onClick={handleNextStep}
                  disabled={catalog.loading}
                  aria-label={`Next: ${nextStepOutcome}`}
                >
                  {nextStepOutcome} →
                </button>
              ) : (
                <>
                <button
                  className="cta"
                  ref={saveQuoteButtonRef}
                  onClick={() => void handleSubmitQuote()}
                  disabled={submitState.saving || catalog.loading || totals.guests <= 0}
                >
                    {submitState.saving
                      ? (isEditingQuote ? "Saving Changes..." : "Saving Draft...")
                      : (isEditingQuote ? (ambientDraftOutcomeSaveLabel || "Save Changes") : "Save draft")}
                  </button>
                </>
              )}
            </div>
          </div>

          <p className="source-note">Quote validity: {Math.max(1, Number(catalog.settings?.quoteValidityDays || 30))} days</p>
          {isEditingQuote && (
            <p className="warning-note">
              Editing quote {editingQuote.quoteNumber}. Saving updates this quote (with version history) and keeps labor rates locked by snapshot.
            </p>
          )}
          {catalog.error && <p className="error-note">{catalog.error}</p>}
          {availabilityNotice && <p className="warning-note">{availabilityNotice}</p>}
          {availabilityBlock && (
            <article className="warning-note availability-recovery" role="alert">
              <h4>Resolve the booking conflict</h4>
              <p>These booked events overlap the current date and venue:</p>
              <ul>
                {availabilityBlock.conflicts.slice(0, 5).map((conflict) => (
                  <li key={conflict.id || conflict.quoteNumber}>
                    <strong>{conflict.quoteNumber || conflict.id || "Booked event"}</strong>
                    {conflict.eventName ? ` · ${conflict.eventName}` : ""}
                    {` · ${conflict.eventDate || form.date}`}
                    {` at ${conflict.eventTime || "time not set"}`}
                    {Number(conflict.eventHours || 0) > 0 ? ` for ${conflict.eventHours} hours` : ""}
                    {conflict.venue ? ` · ${conflict.venue}` : ""}
                  </li>
                ))}
              </ul>
              {availabilityBlock.capacityExceeded && (
                <p>
                  Projected same-venue load is {availabilityBlock.sameVenueLoad} guests; the configured limit is {availabilityBlock.capacityLimit}.
                </p>
              )}
              <div className="auth-actions">
                <button type="button" className="cta" onClick={handleCorrectAvailability}>
                  Edit Date, Time, or Venue
                </button>
                {eventScheduleEnabled && (
                  <button type="button" className="ghost" onClick={() => navigateWorkspace(WORKSPACE_PATHS.schedule)}>
                    Open Event Schedule
                  </button>
                )}
              </div>
            </article>
          )}
          {submitState.message && <p className="source-note">{submitState.message}</p>}
        </section>

        <LiveBreakdown
          form={form}
          totals={totals}
          settings={effectiveSettings}
          catalog={catalog}
          mobileExpanded={mobilePricingOpen}
          onMobileClose={closeMobilePricing}
          guestBand={guestBand}
        />
      </main>
      )}

      {renderWorkspaceTools("modal", [catalogTool, importsTool])}

      {historyMounted && (
        <>
        {AMBIENT_UI_ENABLED && workspaceArrivalContext?.surfaceId === "living-opportunity" && (
          <WorkspaceArrivalNotice
            context={workspaceArrivalContext}
            resolution={workspaceArrivalResolution}
            fallbackSurfaceId="living-opportunity"
          />
        )}
        <WorkspaceLazyRoute
          active={historyOpen}
          surfaceName="Quotes"
          component={QuoteHistoryView}
          onClose={closeHistoryWorkspace}
        >
          <QuoteHistoryView
            open={historyOpen}
            presentation={CUSTOMER_CENTERED_WORKSPACE_ENABLED ? "embedded" : "modal"}
            onClose={closeHistoryWorkspace}
            onCloseBlocked={(message) => {
              pushToast(message || "Finish the pending Quotes action before leaving.", "warning");
              navigateWorkspace(WORKSPACE_PATHS.quotes, { replace: true });
            }}
            basePortalUrl={`${window.location.origin}${WORKSPACE_PATHS.home}`}
            organizationId={authSession.organizationId}
            currentUserUid={authSession.user?.uid || ""}
            currentUserEmail={authSession.user?.email || ""}
            currentUserRole={authSession.role}
            tenantTimeZone={tenantTimeZone}
            ambientPricingCatalog={AMBIENT_UI_ENABLED ? catalog : null}
            ambientPricingSettings={AMBIENT_UI_ENABLED ? effectiveSettings : null}
            globalPilotRequest={AMBIENT_UI_ENABLED && globalPilotRequest?.target === "living_opportunity"
              ? globalPilotRequest
              : null}
            globalPilotReturnFocusRef={AMBIENT_UI_ENABLED ? globalPilotTriggerRef : null}
            onGlobalPilotResolution={AMBIENT_UI_ENABLED ? handleGlobalPilotResolution : undefined}
            focusQuoteId={browserRoute.params?.quoteId || historyTarget.quoteId}
            focusAction={historyTarget.quoteId === browserRoute.params?.quoteId ? historyTarget.action : ""}
            focusReason={historyTarget.quoteId === browserRoute.params?.quoteId ? historyTarget.reason : ""}
            arrivalContext={workspaceArrivalContext?.surfaceId === "living-opportunity"
              ? workspaceArrivalContext
              : null}
            onArrivalResolution={setWorkspaceArrivalResolution}
            onEditQuote={AMBIENT_UI_ENABLED
              ? (quote, options) => {
                  requestWorkflowAttentionRefresh({ force: true });
                  return handleEditQuote(quote, options, options?.arrivalContext || null);
                }
              : (quote) => {
                  requestWorkflowAttentionRefresh({ force: true });
                  handleEditQuote(quote);
                }}
            onBackToQuotes={() => {
              setHistoryTarget({ quoteId: "", reason: "" });
              navigateWorkspace(WORKSPACE_PATHS.quotes);
            }}
            onOpenSchedule={() => navigateWorkspace(WORKSPACE_PATHS.schedule)}
            scheduleAvailable={eventScheduleEnabled}
            onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
            onOpenOpportunity={(target = {}) => {
              const result = navigateAmbientOpportunity(target);
              if (result.status === "pending") {
                setHistoryTarget({ quoteId: "", reason: "" });
              }
              return result;
            }}
            onOpenWorkflow={AMBIENT_UI_ENABLED
              ? openAmbientWorkflow
              : (target = {}) => navigateWorkspace(buildWorkflowPath(target))}
            onOpenConversation={CUSTOMER_CENTERED_WORKSPACE_ENABLED
              ? AMBIENT_UI_ENABLED
                ? openAmbientConversation
                : (quoteId) => navigateWorkspace(buildMessagingPath({ quoteId }))
              : undefined}
            onOpenIntegrations={() => {
              setHistoryTarget({ quoteId: "", reason: "" });
              navigateWorkspace(WORKSPACE_PATHS.integrations);
            }}
            onStartOpportunity={handleGetInstantQuote}
            integrationsAvailable={integrationsEnabled}
            canDeleteQuotes={authSession.isAdmin}
            onToast={pushToast}
          />
        </WorkspaceLazyRoute>
        </>
      )}

      {salesWorkflowMounted && (
        <>
        {AMBIENT_UI_ENABLED && workspaceArrivalContext?.surfaceId === "workflow" && (
          <WorkspaceArrivalNotice
            context={workspaceArrivalContext}
            resolution={workspaceArrivalResolution}
            fallbackSurfaceId="workflow"
          />
        )}
        <WorkspaceLazyRoute
          active={salesWorkflowOpen}
          surfaceName="Workflow"
          component={SalesWorkflowView}
          onClose={closeSalesWorkflowWorkspace}
        >
          <SalesWorkflowView
            open={salesWorkflowOpen}
            presentation={CUSTOMER_CENTERED_WORKSPACE_ENABLED ? "embedded" : "modal"}
            onClose={closeSalesWorkflowWorkspace}
            onOpenQuoteHistory={({ quoteId = "", action = "" } = {}) => {
              if (action === "conversation" && CUSTOMER_CENTERED_WORKSPACE_ENABLED) {
                if (AMBIENT_UI_ENABLED) {
                  openAmbientConversation(quoteId);
                } else {
                  navigateWorkspace(buildMessagingPath({ quoteId }));
                }
                return;
              }
              const actionLabel = String(action || "approved action").replaceAll("_", " ");
              setHistoryTarget({
                quoteId,
                action,
                reason: action === "conversation"
                  ? "Review unread customer reply"
                  : `Execute approved ${actionLabel}`,
                returnFocus: "workflow"
              });
              navigateWorkspace(buildQuotePath(quoteId));
            }}
            onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
            organizationId={authSession.organizationId}
            currentUserEmail={authSession.user?.email || ""}
            currentUserRole={authSession.role}
            tenantTimeZone={tenantTimeZone}
            focusQuoteId={browserRoute.workflowFocus?.quoteId || ""}
            focusAttentionType={browserRoute.workflowFocus?.attentionType || ""}
            focusRequestId={browserRoute.workflowFocus?.requestId || ""}
            arrivalContext={workspaceArrivalContext?.surfaceId === "workflow"
              ? workspaceArrivalContext
              : null}
            onArrivalResolution={setWorkspaceArrivalResolution}
            onEditQuote={(quote) => {
              handleEditQuote(quote);
            }}
            onAttentionSummaryChange={handleWorkflowAttentionSummary}
            onToast={pushToast}
          />
        </WorkspaceLazyRoute>
        </>
      )}

      {renderWorkspaceTools("modal", [scheduleTool, integrationsTool, diagnosticsTool])}

      {quoteCompareEnabled && compareMounted && (
        <WorkspaceLazyTool
          open={compareOpen}
          surfaceName="Scenario Compare"
          component={QuoteCompareModal}
          onClose={() => setCompareOpen(false)}
          returnFocusRef={workspaceToolReturnFocusRef}
          hasUnsavedWorkspaceChanges={quoteDirty}
        >
          <QuoteCompareModal
            open={compareOpen}
            onClose={() => setCompareOpen(false)}
            returnFocusRef={workspaceToolReturnFocusRef}
            form={form}
            setForm={(updater) => {
              setQuoteDirty(true);
              setForm(updater);
            }}
            catalog={catalog}
            settings={effectiveSettings}
            styles={Object.keys(STAFF_RULES)}
            primaryTotals={totals}
          />
        </WorkspaceLazyTool>
      )}

      {renderWorkspaceTools("modal", [reportingTool])}
    </ActiveWorkspaceShell>
  );
}
