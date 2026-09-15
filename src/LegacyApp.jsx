import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarBlank,
  EnvelopeSimple,
  MagnifyingGlass,
  NotePencil,
  Plus,
  StarFour,
  UserCircle
} from "./components/ProductIcons";
import AttentionBadge from "./components/AttentionBadge";
import AuthGate from "./components/AuthGate";
import CustomerPortalView from "quotepilot-active-customer-portal";
import { RebookQuoteReviewBanner } from "./components/CustomerRebookDraftAction";
import LiveBreakdown from "./components/LiveBreakdown";
import ProposalComposer, { buildDraftSaveBlockers } from "./components/ProposalComposer";
import CatalogReadNotice from "./components/CatalogReadNotice";
import ProductBrandLockup from "./components/ProductBrandLockup";
import {
  createRecoverableLazy,
  LazySurfaceLoading,
  RecoverableErrorBoundary
} from "./components/RecoverableErrorBoundary";
import { StepEvent, StepMenu, StepReview, StepServices } from "./components/WizardSteps";
import CreateIntake from "./components/CreateIntake";
import { parseIntentDraftWithModel } from "./lib/intentParseClient";
import ChangeRequestPanel from "./components/ChangeRequestPanel";
import PilotCommandBar from "./components/LegacyPilotCommandBar";
import { applyProposalToForm, proposalTouchedFields } from "./components/changeRequestParse";
import {
  clearDraftSnapshot,
  describeSnapshotAge,
  draftRecoveryKey,
  readDraftSnapshot,
  snapshotMeaningful,
  writeDraftSnapshot
} from "./components/draftRecovery";
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
import { useInventoryRecipeExtension } from "./hooks/useInventoryRecipeExtension";
import {
  buildEventIngredientSelectionInputs,
  useEventIngredientProjection
} from "./hooks/useEventIngredientProjection";
import { useFulfillmentStaffingSnapshot } from "./hooks/useFulfillmentStaffingSnapshot";
import EventIngredientProjectionPanel from "./components/EventIngredientProjectionPanel";
import { buildCommercialInventoryConsequences } from "./lib/commercialInventoryConsequences";
import { buildCommercialScenarioProjectionRequest } from "./lib/commercialScenarioWorkbench";
import {
  buildLivingCommercialTwinInventoryFingerprint,
  buildLivingCommercialTwinProjection,
  buildLivingCommercialTwinScenarioContextFingerprint,
  getSavedInventoryComparisonRead,
  hasCommercialFormChanges,
  isGuestCountOnlyProposal
} from "./lib/livingCommercialTwinProjection";
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
import { firebaseReady } from "./lib/firebase";
import { isCatalogPricingConfirmationCurrent } from "./lib/catalogPricingConfirmation";
import { calculateQuote, currency } from "./lib/quoteCalculator";
import { buildUpsellRecommendations } from "./lib/recommendations";
import {
  catalogReconciliationNotice,
  reconcileCatalogSelections
} from "./lib/catalogSelectionReconciliation";
import { buildProposalReadiness } from "./lib/quoteWorkflow";
import { recommendationWouldChangeForm } from "./lib/recommendationState";
import { PRODUCT_NAME } from "./lib/productIdentity";
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
import { recordDiagnosticError, setDiagnosticsUserContext } from "./lib/sessionDiagnostics";
import { createRebookQuoteDraft } from "./lib/rebookQuoteClient";
import { clearTenantContextCache } from "./lib/tenantDomainService";
import {
  beginWizardAnalyticsSession,
  recordProductAnalyticsEvent
} from "quotepilot-active-product-analytics";

const AdminCatalogModal = createRecoverableLazy(
  () => import("./components/AdminCatalogModal"),
  "AdminCatalogModal"
);
const AdminCatalogView = createRecoverableLazy(
  () => import("./components/AdminCatalogModal").then((module) => ({ default: module.AdminCatalogView })),
  "AdminCatalogView"
);
const CommercialSearchPalette = createRecoverableLazy(
  () => import("./components/CommercialSearchPalette"),
  "CommercialSearchPalette"
);
const CommercialChangeImpactPanel = createRecoverableLazy(
  () => import("./components/CommercialChangeImpactPanel"),
  "CommercialChangeImpactPanel"
);
const CommercialAmendmentWorkspace = createRecoverableLazy(
  () => import("./components/CommercialAmendmentWorkspace"),
  "CommercialAmendmentWorkspace"
);
const loadCommercialAmendmentContext = () => import("./lib/commercialAmendmentContext");
const CustomerDirectoryView = createRecoverableLazy(
  () => import("quotepilot-active-customer-directory"),
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
const InventoryWorkspace = createRecoverableLazy(
  () => import("./components/InventoryWorkspace"),
  "InventoryWorkspace"
);
const InventoryMenuCostSummary = createRecoverableLazy(
  () => import("./components/InventoryRecipeEditor").then((module) => ({ default: module.InventoryMenuCostSummary })),
  "InventoryMenuCostSummary"
);
const MessagingStation = createRecoverableLazy(
  () => import("./components/LegacyMessagingStation"),
  "MessagingStation"
);
const WorkspaceNotFound = createRecoverableLazy(
  () => import("quotepilot-active-workspace-not-found"),
  "WorkspaceNotFound"
);
const EventScheduleModal = createRecoverableLazy(
  () => import("./components/LegacyEventScheduleModal"),
  "EventScheduleModal"
);
const EventScheduleView = createRecoverableLazy(
  () => import("./components/LegacyEventScheduleModal").then((module) => ({ default: module.EventScheduleView })),
  "EventScheduleView"
);
const IntegrationOpsModal = createRecoverableLazy(
  () => import("./components/IntegrationOpsModal"),
  "IntegrationOpsModal"
);
const IntegrationOpsView = createRecoverableLazy(
  () => import("./components/IntegrationOpsModal").then((module) => ({ default: module.IntegrationOpsView })),
  "IntegrationOpsView"
);
const ImportStudioModal = createRecoverableLazy(
  () => import("./components/ImportStudioModal"),
  "ImportStudioModal"
);
const ImportStudioView = createRecoverableLazy(
  () => import("./components/ImportStudioModal").then((module) => ({ default: module.ImportStudioView })),
  "ImportStudioView"
);
const DiagnosticsModal = createRecoverableLazy(
  () => import("./components/DiagnosticsModal"),
  "DiagnosticsModal"
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
  () => import("./components/LegacyQuoteHistoryModal").then((module) => ({ default: module.QuoteHistoryView })),
  "QuoteHistoryView"
);
const ReportingDashboardModal = createRecoverableLazy(
  () => import("./components/LegacyReportingDashboardModal"),
  "ReportingDashboardModal"
);
const ReportingDashboardView = createRecoverableLazy(
  () => import("./components/LegacyReportingDashboardModal").then((module) => ({ default: module.ReportingDashboardView })),
  "ReportingDashboardView"
);
const SalesWorkflowView = createRecoverableLazy(
  () => import("./components/LegacySalesWorkflowModal").then((module) => ({ default: module.SalesWorkflowView })),
  "SalesWorkflowView"
);

const E2E_ALLOW_NON_AUTHORITATIVE_PRICING = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING || "").trim().toLowerCase()
);
const CUSTOMER_CENTERED_WORKSPACE_ENABLED = !["0", "false", "no", "off"].includes(
  String(import.meta.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED || "").trim().toLowerCase()
);
// The Proposal Composer is the default presentation of the quote builder
// (docs/PROPOSAL_COMPOSER_PLAN.md). Explicit 0/false/no/off restores the
// wizard-first presentation. Either way the wizard remains available as
// Guided mode, both write the same draft form, and the save path keeps its
// existing authority (server pricing, versioning) unchanged.
const PROPOSAL_COMPOSER_ENABLED = !["0", "false", "no", "off"].includes(
  String(import.meta.env.VITE_PROPOSAL_COMPOSER_ENABLED || "").trim().toLowerCase()
);
const OPERATIONAL_STAFFING_UI_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_OPERATIONAL_STAFFING_ENABLED || "").trim().toLowerCase()
);
const INVENTORY_AUTHORITY_UI_ENABLED = import.meta.env.VITE_INVENTORY_AUTHORITY_ENABLED === "true";
// The NOW surface is an additional default-off presentation gate. Absent or
// unrecognized values keep it off; it never widens data access or authority.
const PILOT_NOW_ENABLED = CUSTOMER_CENTERED_WORKSPACE_ENABLED
  && ["1", "true", "yes", "on"].includes(
    String(import.meta.env.VITE_PILOT_NOW_ENABLED || "").trim().toLowerCase()
  );
// The CREATE intake canvas is an additional default-off presentation gate
// (docs/INTENT_INTAKE_ADR.md). It prefills the ordinary editable draft form
// only; quote creation authority is unchanged.
const PILOT_CREATE_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_CREATE_ENABLED || "").trim().toLowerCase()
);
// Model assistance is a separate browser capability. CREATE's deterministic
// intake remains available whenever its own gate is enabled.
const PILOT_MODEL_ENABLED = import.meta.env.VITE_PILOT_MODEL_ENABLED === "true";
const ActiveLegacyHome = createRecoverableLazy(
  () => import("quotepilot-active-legacy-home"),
  "ActiveLegacyHome"
);
// The client-request panel is an additional default-off presentation gate.
// It parses the stored change-request message into stageable draft edits
// only; the ordinary save path remains the sole versioning authority.
const PILOT_CHANGE_REQUESTS_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_CHANGE_REQUESTS_ENABLED || "").trim().toLowerCase()
);
// The Pilot command bar is an additional default-off presentation gate.
// Commands preview before anything touches the draft; applying stages
// draft edits only, and the save path remains the sole authority.
const PILOT_COMMAND_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_COMMAND_ENABLED || "").trim().toLowerCase()
);

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
  rebooking: null,
  commercialAmendment: null
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
  applyOutcome: null,
  catalogRevision: null,
  appliedQuote: null,
  workbenchRequest: null,
  inventoryObservation: null,
  inventoryScenarioFingerprint: "",
  staffingObservation: null
});
const EMPTY_EVENT_INGREDIENT_PREVIEW_INPUT = Object.freeze({ valid: false, selections: [] });

function normalizeLivingTwinGuestCount(value) {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= 400
    ? candidate
    : null;
}

function normalizeLivingTwinProjectionRequest(value, scopeKey) {
  try {
    return buildCommercialScenarioProjectionRequest({ ...value, scopeKey });
  } catch {
    return null;
  }
}

function focusLivingTwinCommitmentReview() {
  if (typeof document === "undefined") return false;
  const target = document.getElementById("commercial-change-impact-title")
    || document.querySelector('[data-capability-id="cwf-15b-commercial-change-impact-preview"]');
  if (!target) return false;
  if (!target.matches("button, a, input, select, textarea, [tabindex]")) {
    target.setAttribute("tabindex", "-1");
  }
  target.scrollIntoView?.({ behavior: "smooth", block: "start" });
  target.focus?.({ preventScroll: true });
  return true;
}

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

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

function useStickyMount(active) {
  const [hasMounted, setHasMounted] = useState(Boolean(active));

  useEffect(() => {
    if (active) setHasMounted(true);
  }, [active]);

  return Boolean(active) || hasMounted;
}

function WorkspaceLazyTool({
  open,
  surfaceName,
  component: LazyComponent,
  onClose,
  returnFocusRef,
  hasUnsavedWorkspaceChanges = false,
  children
}) {
  return (
    <RecoverableErrorBoundary
      active={open}
      surfaceName={surfaceName}
      surfaceKind="tool"
      onRetry={LazyComponent.retry}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      hasUnsavedWorkspaceChanges={hasUnsavedWorkspaceChanges}
    >
      <Suspense
        fallback={open ? (
          <LazySurfaceLoading
            surfaceName={surfaceName}
            onClose={onClose}
            returnFocusRef={returnFocusRef}
          />
        ) : null}
      >
        {children}
      </Suspense>
    </RecoverableErrorBoundary>
  );
}

function WorkspaceLazyRoute({
  active = true,
  surfaceName,
  component: LazyComponent,
  onClose = () => window.location.assign(WORKSPACE_PATHS.home),
  children
}) {
  return (
    <RecoverableErrorBoundary
      active={active}
      surfaceName={surfaceName}
      surfaceKind="route"
      onRetry={LazyComponent.retry}
      onClose={onClose}
    >
      <Suspense fallback={active ? <div className="qp-route-loading" role="status">Loading {surfaceName}...</div> : null}>
        {children}
      </Suspense>
    </RecoverableErrorBoundary>
  );
}

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

function LegacyAppCore({
  tenantContext,
  authSession,
  portalTransitionAllowed = true,
  onPendingWorkChange
}) {
  const { route: browserRoute, navigate, replace } = useWorkspaceNavigation();
  const navigateWorkspace = useCallback((destination, options = {}) => navigate(destination, {
    ...options,
    preserveSearch: false
  }), [navigate]);
  const wizardRef = useRef(null);
  const stepperRef = useRef(null);
  const mobilePricingToggleRef = useRef(null);
  const historyTriggerRef = useRef(null);
  const workflowTriggerRef = useRef(null);
  const headerMenusRef = useRef(null);
  const operationsMenuTriggerRef = useRef(null);
  const accountMenuTriggerRef = useRef(null);
  const moreMenuTriggerRef = useRef(null);
  const commercialSearchTriggerRef = useRef(null);
  const commercialSearchReturnFocusRef = useRef(null);
  const workspaceToolReturnFocusRef = useRef(null);
  const saveQuoteButtonRef = useRef(null);
  const menuSelectionValidationRef = useRef(null);
  const autopilotAppliedRef = useRef(new Set());
  const directEditLoadRef = useRef({ key: "", generation: 0 });
  const changeImpactPreviewGenerationRef = useRef(0);
  const livingTwinScenarioScopeRef = useRef({ key: "", generation: 0 });
  const catalogReconciliationNoticeRef = useRef("");
  const { eventTypeId: globalEventTypeId, setEventTypeId: setGlobalEventTypeId } = useEventType();
  const { organization, setOrganizationId } = useOrganization();
  const [portalKey, setPortalKey] = useState(() => readPortalKeyFromUrl());
  const [portalMode, setPortalMode] = useState(Boolean(portalKey));
  const [paymentReturn] = useState(() => readPaymentReturnFromUrl());

  useEffect(() => {
    if (!portalTransitionAllowed) return;
    if (browserRoute.surface === "portal") {
      setPortalKey(browserRoute.portalToken);
      setPortalMode(true);
      return;
    }
    setPortalKey("");
    setPortalMode(false);
  }, [browserRoute.portalToken, browserRoute.surface, portalTransitionAllowed]);
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
  // Builder presentation mode: the Proposal Composer document (flag default)
  // or the sequential wizard as Guided mode. Both write the same draft form.
  const [builderMode, setBuilderMode] = useState(
    PROPOSAL_COMPOSER_ENABLED ? "composer" : "guided"
  );
  const proposalComposerActive = PROPOSAL_COMPOSER_ENABLED && builderMode === "composer";

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
  const [skipCatalogSetup, setSkipCatalogSetup] = useState(false);
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
  const resolvedWorkspaceRouteId = (
    !CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && browserRoute.routeId === WORKSPACE_ROUTE_IDS.HOME
  ) ? WORKSPACE_ROUTE_IDS.QUOTE_NEW : browserRoute.routeId;
  const historyOpen = [WORKSPACE_ROUTE_IDS.QUOTE_LIST, WORKSPACE_ROUTE_IDS.QUOTE_DETAIL].includes(resolvedWorkspaceRouteId);
  const messagingOpen = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.MESSAGING;
  const salesWorkflowOpen = resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.WORKFLOW;
  const scheduleRouteOpen = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.SCHEDULE;
  const reportingRouteOpen = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.REPORTING;
  const integrationsRouteOpen = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INTEGRATIONS;
  const importsRouteOpen = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.IMPORTS;
  const catalogRouteOpen = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CATALOG;
  const staffRouteOpen = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.STAFF;
  const diagnosticsRouteOpen = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.DIAGNOSTICS;
  const legacyScheduleRouteOpen = !CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.SCHEDULE;
  const legacyReportingRouteOpen = !CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.REPORTING;
  const legacyIntegrationsRouteOpen = !CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INTEGRATIONS;
  const legacyImportsRouteOpen = !CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.IMPORTS;
  const legacyCatalogRouteOpen = !CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CATALOG;
  const legacyDiagnosticsRouteOpen = !CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.DIAGNOSTICS;
  const scheduleModalOpen = scheduleOpen || legacyScheduleRouteOpen;
  const reportingModalOpen = dashboardOpen || legacyReportingRouteOpen;
  const integrationsModalOpen = integrationsOpen || legacyIntegrationsRouteOpen;
  const importsModalOpen = importStudioOpen || legacyImportsRouteOpen;
  const catalogModalOpen = adminOpen || legacyCatalogRouteOpen;
  const diagnosticsModalOpen = diagnosticsOpen || legacyDiagnosticsRouteOpen;
  const commercialSearchAvailable = isCommercialSearchAvailable({
    enabled: CUSTOMER_CENTERED_WORKSPACE_ENABLED,
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
  const [eventIngredientPreviewInput, setEventIngredientPreviewInput] = useState(
    EMPTY_EVENT_INGREDIENT_PREVIEW_INPUT
  );
  const [pendingLivingTwinConsequenceRequest, setPendingLivingTwinConsequenceRequest] = useState(null);
  const [quoteEditLoadState, setQuoteEditLoadState] = useState({
    quoteId: "",
    loading: false,
    error: ""
  });
  const [quoteEditRetryToken, setQuoteEditRetryToken] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [quoteDirty, setQuoteDirty] = useState(false);
  const [catalogInteraction, setCatalogInteraction] = useState({ dirty: false, busy: false });
  useEffect(() => {
    onPendingWorkChange?.({
      quoteDirty,
      catalogDirty: catalogInteraction.dirty,
      catalogBusy: catalogInteraction.busy
    });
  }, [catalogInteraction.busy, catalogInteraction.dirty, onPendingWorkChange, quoteDirty]);
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
      (!quoteDirty && !catalogInteraction.dirty && !catalogInteraction.busy)
      || typeof window === "undefined"
    ) return undefined;
    const protectPendingWork = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPendingWork);
    return () => window.removeEventListener("beforeunload", protectPendingWork);
  }, [catalogInteraction.busy, catalogInteraction.dirty, quoteDirty]);

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

  const markFieldsTouched = (fields = []) => {
    const unique = Array.from(new Set(fields.filter(Boolean)));
    if (!unique.length) return;
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
    setQuoteDirty(true);
  };

  const handleAddonSelection = (addonId, selected) => {
    recordProductAnalyticsEvent(selected ? "addon_selected" : "addon_removed", { addonId });
  };

  // Multi-key draft merge for the Proposal Composer (selection arrays and
  // quantity maps). Field-level touch/template-release bookkeeping happens in
  // handleStep1FieldChange / handleSelectionTouched before this is called.
  const handleComposerPatch = (patch = {}) => {
    setQuoteDirty(true);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  // Loss protection for new drafts (src/components/draftRecovery.js): a
  // debounced local snapshot of the dirty new-quote form, offered back on
  // return to a pristine new-quote route. New drafts only — an edit session
  // always has its saved canonical revision — and cleared on save/discard.
  const [draftRecoveryOffer, setDraftRecoveryOffer] = useState(null);
  const [draftRecoveryResumed, setDraftRecoveryResumed] = useState(false);
  const draftRecoveryStorageKey = draftRecoveryKey({ organizationId: authSession.organizationId });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!quoteDirty || editingQuote.id) return undefined;
    const timer = setTimeout(() => {
      writeDraftSnapshot(window.localStorage, draftRecoveryStorageKey, { form });
    }, 800);
    return () => clearTimeout(timer);
  }, [form, quoteDirty, editingQuote.id, draftRecoveryStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (resolvedWorkspaceRouteId !== WORKSPACE_ROUTE_IDS.QUOTE_NEW) return;
    if (quoteDirty || editingQuote.id) return;
    const snapshot = readDraftSnapshot(window.localStorage, draftRecoveryStorageKey);
    setDraftRecoveryOffer(
      snapshot && snapshotMeaningful(snapshot.form, INITIAL_FORM) ? snapshot : null
    );
    // Evaluated on entry to the new-quote route only; typing hides the offer
    // via the render guard rather than re-running this read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedWorkspaceRouteId, draftRecoveryStorageKey]);

  const resumeDraftRecovery = () => {
    if (!draftRecoveryOffer) return;
    setForm({ ...INITIAL_FORM, ...draftRecoveryOffer.form });
    setQuoteDirty(true);
    setDraftRecoveryResumed(true);
    setDraftRecoveryOffer(null);
  };

  const discardDraftRecovery = () => {
    if (typeof window !== "undefined") {
      clearDraftSnapshot(window.localStorage, draftRecoveryStorageKey);
    }
    setDraftRecoveryOffer(null);
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
  const featureFlags = effectiveSettings.featureFlags || DEFAULT_FEATURE_FLAGS;
  const customerPortalEnabled = featureFlags.customerPortal !== false;
  const eventScheduleEnabled = featureFlags.eventSchedule !== false;
  const integrationsEnabled = featureFlags.integrationsOps !== false;
  const diagnosticsEnabled = featureFlags.diagnostics !== false;
  const dashboardEnabled = featureFlags.reportingDashboard !== false;
  const inventoryTenantEnabled = effectiveSettings.inventoryAuthorityEnabled === true;
  const inventoryWorkspaceEnabled = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && INVENTORY_AUTHORITY_UI_ENABLED
    && inventoryTenantEnabled
    && firebaseReady
    && authSession.isAdmin;
  const quoteCompareEnabled = featureFlags.quoteCompare !== false;
  const aiAssistEnabled = featureFlags.aiAssist !== false;
  const aiAutopilotEnabled = aiAssistEnabled && featureFlags.aiAutopilot === true;
  const routedToolAuthorized = (
    (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.STAFF
      && authSession.isAdmin
      && OPERATIONAL_STAFFING_UI_ENABLED)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INVENTORY && inventoryWorkspaceEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.SCHEDULE && eventScheduleEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.REPORTING && dashboardEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INTEGRATIONS && integrationsEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.DIAGNOSTICS && diagnosticsEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CATALOG && authSession.isAdmin)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.IMPORTS && authSession.isAdmin)
  );

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
    beginWizardAnalyticsSession({ organizationId, mode: editingQuote.id ? "edit" : "create" });
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
  const inventoryRecipeExtension = useInventoryRecipeExtension({
    active: catalogRouteOpen || catalogModalOpen || step === 2 || isEditingQuote,
    organizationId: authSession.organizationId,
    role: authSession.role,
    browserEnabled: INVENTORY_AUTHORITY_UI_ENABLED,
    tenantEnabled: inventoryTenantEnabled
  });
  const eventIngredientSelections = useMemo(() => buildEventIngredientSelectionInputs({
    quote: editingQuote,
    recipeProjectionsByMenuItemId: inventoryRecipeExtension.menuCostProjectionsByMenuItemId
  }), [editingQuote, inventoryRecipeExtension.menuCostProjectionsByMenuItemId]);
  const currentChangeImpactFormKey = JSON.stringify(form);
  const livingTwinNonGuestContextKey = useMemo(
    () => buildLivingCommercialTwinScenarioContextFingerprint({
      form,
      selections: eventIngredientPreviewInput.selections
    }),
    [eventIngredientPreviewInput.selections, form]
  );
  const livingTwinScenarioScopeIdentity = JSON.stringify([
    String(authSession.organizationId || "").trim(),
    String(editingQuote.id || "").trim(),
    String(editingQuote.activeVersionId || editingQuote.versionMeta?.versionId || "").trim(),
    livingTwinNonGuestContextKey
  ]);
  if (livingTwinScenarioScopeRef.current.key !== livingTwinScenarioScopeIdentity) {
    livingTwinScenarioScopeRef.current = {
      key: livingTwinScenarioScopeIdentity,
      generation: livingTwinScenarioScopeRef.current.generation + 1
    };
  }
  const currentInventoryScenarioFingerprint = useMemo(
    () => buildLivingCommercialTwinInventoryFingerprint({
      commercialFormFingerprint: currentChangeImpactFormKey,
      selections: eventIngredientPreviewInput.selections
    }),
    [currentChangeImpactFormKey, eventIngredientPreviewInput.selections]
  );
  const inventoryGuestScenarioEligible = useMemo(() => isGuestCountOnlyProposal({
    currentForm: editingQuote.baseForm,
    proposedForm: form
  }), [editingQuote.baseForm, form]);
  const eventIngredientProjection = useEventIngredientProjection({
    active: isEditingQuote && firebaseReady,
    organizationId: authSession.organizationId,
    role: authSession.role,
    browserEnabled: INVENTORY_AUTHORITY_UI_ENABLED,
    tenantEnabled: inventoryTenantEnabled,
    quoteId: editingQuote.id,
    quoteStatus: editingQuote.status,
    savedQuoteRevisionId: String(
      editingQuote.activeVersionId || editingQuote.versionMeta?.versionId || ""
    ).trim(),
    selections: eventIngredientSelections,
    scenarioFingerprint: currentInventoryScenarioFingerprint,
    draftDirty: quoteDirty
  });
  const fulfillmentStaffingActive = isEditingQuote
    && firebaseReady
    && authSession.isStaff
    && OPERATIONAL_STAFFING_UI_ENABLED
    && effectiveSettings.operationalStaffingAuthorityEnabled === true;
  const fulfillmentStaffing = useFulfillmentStaffingSnapshot({
    active: fulfillmentStaffingActive,
    organizationId: authSession.organizationId,
    quoteId: editingQuote.id,
    savedQuoteRevisionId: String(
      editingQuote.activeVersionId || editingQuote.versionMeta?.versionId || ""
    ).trim()
  });
  const proposedStaffingRequirements = useMemo(() => {
    const roleCounts = [Number(form.servers), Number(form.chefs), Number(form.bartenders)];
    if (roleCounts.some((value) => !Number.isSafeInteger(value) || value < 0)) return null;
    return {
      lead: 0,
      server: roleCounts[0],
      chef: roleCounts[1],
      bartender: roleCounts[2]
    };
  }, [
    form.bartenders,
    form.chefs,
    form.servers
  ]);
  const proposedStaffingEventWindowState = useMemo(() => (
    ["date", "time", "hours"].every((field) => (
      String(editingQuote.baseForm?.[field] ?? "") === String(form[field] ?? "")
    )) ? "current" : "changed_unchecked"
  ), [editingQuote.baseForm, form.date, form.hours, form.time]);
  const authoritativeStaffingObservation = changeImpactPreview.formKey === currentChangeImpactFormKey
    && changeImpactPreview.staffingObservation?.state === "available"
    ? changeImpactPreview.staffingObservation
    : null;
  const effectiveProposedStaffingRequirements = authoritativeStaffingObservation
    ?.preview?.proposed?.requirementsByRole || proposedStaffingRequirements;
  const effectiveProposedStaffingEventWindowState = authoritativeStaffingObservation
    ? authoritativeStaffingObservation.preview?.comparison?.windowState === "changed"
      ? "changed_unchecked"
      : "current"
    : proposedStaffingEventWindowState;
  const commercialInventoryScenarioPreview = useMemo(() => {
    const observation = changeImpactPreview.inventoryObservation;
    if (observation?.state === "available" && observation.preview?.projection) {
      return {
        state: "current",
        projection: observation.preview.projection,
        scenarioFingerprint: changeImpactPreview.inventoryScenarioFingerprint
      };
    }
    if (observation?.state === "unavailable") {
      return {
        state: "unavailable",
        projection: null,
        scenarioFingerprint: changeImpactPreview.inventoryScenarioFingerprint
      };
    }
    return {
      state: "not_evaluated",
      projection: null,
      scenarioFingerprint: changeImpactPreview.inventoryScenarioFingerprint
    };
  }, [
    changeImpactPreview.inventoryObservation,
    changeImpactPreview.inventoryScenarioFingerprint
  ]);
  const commercialInventoryConsequences = useMemo(() => buildCommercialInventoryConsequences({
    savedRead: getSavedInventoryComparisonRead(eventIngredientProjection.read),
    scenarioPreview: commercialInventoryScenarioPreview,
    organizationId: authSession.organizationId,
    quoteId: editingQuote.id,
    savedQuoteRevisionId: String(
      editingQuote.activeVersionId || editingQuote.versionMeta?.versionId || ""
    ).trim(),
    proposedQuoteRevisionId: String(
      changeImpactPreview.inventoryObservation?.proposedQuoteRevisionId || ""
    ).trim(),
    scenarioFingerprint: currentInventoryScenarioFingerprint
  }), [
    authSession.organizationId,
    changeImpactPreview.inventoryObservation?.proposedQuoteRevisionId,
    commercialInventoryScenarioPreview,
    currentInventoryScenarioFingerprint,
    editingQuote.activeVersionId,
    editingQuote.id,
    editingQuote.versionMeta?.versionId,
    eventIngredientProjection.read
  ]);
  const changeImpactPresentationError = changeImpactPreview.error || (
    changeImpactPreview.model
      ? changeImpactPreview.formKey
        && changeImpactPreview.formKey !== currentChangeImpactFormKey
        ? "Quote inputs changed after this preview. The retained result is stale; refresh it before relying on the comparison."
        : Number(changeImpactPreview.catalogRevision) !== Number(catalog.settings?.catalogRevision)
          ? "The catalog revision changed after this preview. Refresh it before choosing a consequence outcome."
          : ""
      : ""
  );
  const changeImpactPreviewAvailable = isEditingQuote
    && String(catalog.source || "").trim().toLowerCase().startsWith("firebase");
  const livingTwinBaseQuoteRevisionId = String(
    editingQuote.activeVersionId || editingQuote.versionMeta?.versionId || ""
  ).trim();
  const livingTwinScopeKey = JSON.stringify([
    String(authSession.organizationId || "").trim(),
    String(editingQuote.id || "").trim(),
    `draft-context-${livingTwinScenarioScopeRef.current.generation}`
  ]);
  const livingCommercialTwinProjection = useMemo(() => buildLivingCommercialTwinProjection({
    organizationId: authSession.organizationId,
    quoteId: editingQuote.id,
    quoteRevisionId: livingTwinBaseQuoteRevisionId,
    scenarioId: currentInventoryScenarioFingerprint,
    commitment: editingQuote.commercialAmendment,
    proposedGuestCount: form.guests,
    draftDirty: quoteDirty,
    selectedMenuItemNames: eventIngredientSelections.map((selection) => selection.menuItemName),
    selectedMenuItems: eventIngredientSelections.map((selection) => ({
      menuItemId: selection.menuItemId,
      label: selection.menuItemName
    })),
    previewAvailable: changeImpactPreviewAvailable,
    previewRequested: changeImpactPreview.requested,
    previewLoading: changeImpactPreview.loading,
    previewError: changeImpactPresentationError,
    previewScopeCurrent: !changeImpactPresentationError,
    commercialModel: changeImpactPreview.model,
    authorityState: changeImpactPreview.authorityState,
    authorizationRequired: changeImpactPreview.authorizationRequired,
    authorizationReceiptId: changeImpactPreview.authorizationReceiptId,
    inventoryEnabled: eventIngredientProjection.access.readEnabled,
    inventoryScenarioEligible: inventoryGuestScenarioEligible,
    inventoryPreviewAvailable: eventIngredientProjection.canPreview,
    inventoryInputReady: eventIngredientPreviewInput.valid,
    inventoryConsequences: commercialInventoryConsequences,
    inventoryPreview: commercialInventoryScenarioPreview,
    staffingRead: fulfillmentStaffing.read,
    proposedStaffingRequirements: effectiveProposedStaffingRequirements,
    proposedStaffingRequirementsSource: authoritativeStaffingObservation
      ? "server_authoritative_commercial_preview"
      : "proposed_commercial_and_canonical_counts",
    proposedStaffingEventWindowState: effectiveProposedStaffingEventWindowState,
    appliedQuote: changeImpactPreview.appliedQuote,
    workbenchRequest: changeImpactPreview.workbenchRequest
  }), [
    authSession.organizationId,
    changeImpactPresentationError,
    changeImpactPreview.appliedQuote,
    changeImpactPreview.authorityState,
    changeImpactPreview.authorizationReceiptId,
    changeImpactPreview.authorizationRequired,
    changeImpactPreview.loading,
    changeImpactPreview.model,
    changeImpactPreview.requested,
    changeImpactPreview.workbenchRequest,
    changeImpactPreviewAvailable,
    commercialInventoryConsequences,
    currentInventoryScenarioFingerprint,
    editingQuote.commercialAmendment,
    editingQuote.activeVersionId,
    editingQuote.id,
    editingQuote.versionMeta?.versionId,
    eventIngredientPreviewInput.valid,
    eventIngredientProjection.access.readEnabled,
    eventIngredientProjection.canPreview,
    commercialInventoryScenarioPreview,
    eventIngredientSelections,
    form.guests,
    inventoryGuestScenarioEligible,
    livingTwinBaseQuoteRevisionId,
    authoritativeStaffingObservation,
    effectiveProposedStaffingEventWindowState,
    effectiveProposedStaffingRequirements,
    proposedStaffingRequirements,
    proposedStaffingEventWindowState,
    fulfillmentStaffing.read,
    quoteDirty
  ]);
  const handleLivingTwinGuestCountChange = (value) => {
    const guestCount = normalizeLivingTwinGuestCount(value);
    if (guestCount === null || guestCount === Number(form.guests)) return false;
    const nextForm = { ...form, guests: guestCount };
    setPendingLivingTwinConsequenceRequest(null);
    resetChangeImpactPreview();
    setForm(nextForm);
    setQuoteDirty(hasCommercialFormChanges({
      currentForm: editingQuote.baseForm,
      proposedForm: nextForm
    }));
    return true;
  };
  const handleRevertLivingTwinGuestCount = () => {
    const savedGuestCount = livingCommercialTwinProjection.scenario.currentGuestCount;
    return savedGuestCount === null
      ? false
      : handleLivingTwinGuestCountChange(savedGuestCount);
  };
  const handleLivingTwinConsequenceRequest = (request = {}) => {
    const projectionRequest = normalizeLivingTwinProjectionRequest(request, livingTwinScopeKey);
    if (
      !projectionRequest
      || !livingTwinBaseQuoteRevisionId
      || projectionRequest.baseQuoteRevisionId !== livingTwinBaseQuoteRevisionId
    ) return false;
    const {
      scenarioId,
      generation,
      inputDigest,
      baseQuoteRevisionId,
      guestCount
    } = projectionRequest;
    const candidateForm = { ...form, guests: guestCount };
    setPendingLivingTwinConsequenceRequest({
      scenarioId,
      generation,
      inputDigest,
      baseQuoteRevisionId,
      guestCount,
      scopeKey: livingTwinScopeKey,
      candidateForm,
      formKey: JSON.stringify(candidateForm)
    });
    return true;
  };
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
  const brandName = tenantBrandName || organizationName || "Catering workspace";
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
  const activeWorkspaceSection = resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.QUOTE_NEW
    || resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.QUOTE_EDIT
    ? "quotes"
    : browserRoute.section;

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

  const handlePreviewChangeImpact = async ({
    recovery = false,
    candidateForm = form,
    workbenchRequest = null
  } = {}) => {
    if (!isEditingQuote || !editingQuote.id) return;
    const formKey = JSON.stringify(candidateForm);
    const suppliedWorkbenchRequest = normalizeLivingTwinProjectionRequest(
      workbenchRequest,
      livingTwinScopeKey
    );
    if (workbenchRequest !== null && !suppliedWorkbenchRequest) return false;
    const recoveredWorkbenchRequest = recovery && !suppliedWorkbenchRequest
        ? normalizeLivingTwinProjectionRequest(
          changeImpactPreview.workbenchRequest,
          livingTwinScopeKey
        )
        : null;
    if (
      recovery
      && !suppliedWorkbenchRequest
      && changeImpactPreview.workbenchRequest
      && !recoveredWorkbenchRequest
    ) return false;
    const exactWorkbenchRequest = suppliedWorkbenchRequest || recoveredWorkbenchRequest;
    const generation = changeImpactPreviewGenerationRef.current + 1;
    changeImpactPreviewGenerationRef.current = generation;
    const inventoryScenarioEligibleForRequest = isGuestCountOnlyProposal({
      currentForm: editingQuote.baseForm,
      proposedForm: candidateForm
    });
    const inventoryObservationRequested = formKey === currentChangeImpactFormKey
      && inventoryScenarioEligibleForRequest
      && eventIngredientProjection.access.readEnabled
      && eventIngredientProjection.canPreview
      && eventIngredientPreviewInput.valid;
    const inventoryScenarioFingerprintForRequest = buildLivingCommercialTwinInventoryFingerprint({
      commercialFormFingerprint: formKey,
      selections: eventIngredientPreviewInput.selections
    });
    const priorRequestId = recovery && changeImpactPreview.mutationState === "uncertain"
      ? changeImpactPreview.simulationRequestId
      : "";
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
      workbenchRequest: exactWorkbenchRequest,
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
        form: candidateForm,
        ...(inventoryObservationRequested ? {
          eventIngredientOutputs: eventIngredientPreviewInput.selections.map((selection) => ({
            menuItemId: selection.menuItemId,
            requiredOutputQuantity: selection.requiredOutputQuantity
          }))
        } : {})
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
        applyOutcome: null,
        catalogRevision: Number(catalog.settings?.catalogRevision),
        appliedQuote: null,
        workbenchRequest: exactWorkbenchRequest,
        inventoryObservation: result.inventoryObservation,
        inventoryScenarioFingerprint: inventoryScenarioFingerprintForRequest,
        staffingObservation: result.staffingObservation
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

  useEffect(() => {
    const pending = pendingLivingTwinConsequenceRequest;
    if (!pending) return;
    if (
      !livingTwinBaseQuoteRevisionId
      || pending.baseQuoteRevisionId !== livingTwinBaseQuoteRevisionId
    ) {
      setPendingLivingTwinConsequenceRequest(null);
      return;
    }
    if (
      pending.scopeKey !== livingTwinScopeKey
      || pending.formKey !== currentChangeImpactFormKey
    ) {
      setPendingLivingTwinConsequenceRequest(null);
      return;
    }
    setPendingLivingTwinConsequenceRequest(null);
    void handlePreviewChangeImpact({
      candidateForm: pending.candidateForm,
      workbenchRequest: pending
    });
  }, [
    currentChangeImpactFormKey,
    livingTwinBaseQuoteRevisionId,
    livingTwinScopeKey,
    pendingLivingTwinConsequenceRequest
  ]);

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
          appliedQuote: {
            quoteId: editingQuote.id,
            quoteNumber: editingQuote.quoteNumber || editingQuote.id,
            previousRevisionId: changeImpactPreview.model?.identity?.beforeRevisionId || editingQuote.activeVersionId,
            activeVersionId: result.outcomeReceipt.newRevisionId || "",
            latestVersionNumber: Number(editingQuote.commercialAmendment?.versionNumber || 0) + 1,
            status: "draft"
          },
          mutationState: "receipt",
          mutationKind: "apply",
          mutationMessage: result.outcomeReceipt.appliedRevisionIsActive
            ? "The exact quote revision and apply receipt prove this authorized edit committed."
            : "This authorized edit committed, but a later quote revision is now active. Open the authoritative quote record before further work."
        }));
        pushToast("Authorized quote change reconciled as committed.", "success");
        requestWorkflowAttentionRefresh({ force: true });
        setHistoryTarget({ quoteId: editingQuote.id, reason: "updated" });
        return;
      }
      setChangeImpactPreview((current) => ({
        ...current,
        error: "",
        applyOutcome: result.outcomeReceipt,
        applyResult: null,
        appliedQuote: null,
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
      appliedQuote: null,
      mutationState: "recovery",
      mutationKind: "simulation",
      mutationMessage: "Starting a fresh simulation after the prior apply request was safely fenced."
    }));
    void handlePreviewChangeImpact({ recovery: false });
  };

  const handleApplyCommercialChange = async () => {
    const requiresAuthorization = changeImpactPreview.authorityState === "enforced"
      && changeImpactPreview.authorizationRequired;
    if (
      !changeImpactScopeIsCurrent()
      || (requiresAuthorization && !changeImpactPreview.authorizationReceiptId)
    ) return;
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
      mutationMessage: requiresAuthorization
        ? "Applying the authorized edit atomically with its immutable invalidation receipts."
        : "Applying the reviewed edit through the existing quote authority."
    }));
    try {
      const result = await handleSubmitQuote({
        commercialChangeAuthority: {
          simulationReceiptId: changeImpactPreview.simulationReceiptId,
          authorizationReceiptId: requiresAuthorization
            ? changeImpactPreview.authorizationReceiptId
            : "",
          applyRequestId
        },
        propagateError: true,
        navigateAfterSave: false
      });
      if (!result) return;
      setChangeImpactPreview((current) => ({
        ...current,
        applyResult: result.commercialChange,
        applyOutcome: null,
        appliedQuote: {
          quoteId: result.id,
          quoteNumber: result.quoteNumber,
          previousRevisionId: changeImpactPreview.model?.identity?.beforeRevisionId || editingQuote.activeVersionId,
          activeVersionId: result.activeVersionId,
          latestVersionNumber: result.latestVersionNumber,
          status: result.status || "draft"
        },
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
        appliedQuote: null,
        error: error?.message || "The commercial change apply did not return a receipt.",
        mutationState: definitive ? "error" : "uncertain",
        mutationKind: "apply",
        mutationMessage: definitive
          ? "The server definitively rejected this apply. Correct the source or authorization, then re-simulate."
          : "The apply outcome is uncertain. This screen will not submit it again; refresh the authoritative quote record before taking another action."
      }));
    }
  };

  const handleSubmitQuote = async ({
    commercialChangeAuthority = null,
    propagateError = false,
    navigateAfterSave = true
  } = {}) => {
    if (quoteEditRouteId && !quoteEditReady) {
      setSubmitState((current) => ({
        ...current,
        saving: false,
        message: "This saved quote has not loaded for editing. Retry the edit before saving."
      }));
      return;
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
        && !changeImpactPreview.authorizationReceiptId
      ) {
        setStep(5);
        setSubmitState((current) => ({
          ...current,
          saving: false,
          message: "This edit has governed dependencies. Authorize and apply it from Change Impact."
        }));
        return null;
      }
      if (changeImpactPreview.applyResult || changeImpactPreview.applyOutcome?.state === "committed") {
        setStep(5);
        setSubmitState((current) => ({
          ...current,
          saving: false,
          message: "This governed amendment already produced a new revision. Review that exact quote before making another change."
        }));
        return null;
      }
      return handleApplyCommercialChange();
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
            expectedActiveVersionId: editingQuote.activeVersionId || undefined,
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
        recordProductAnalyticsEvent("quote_saved");
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
        if (navigateAfterSave) navigateWorkspace(buildQuotePath(result.id));
        return result;
      }

      const savedDraftMessage = `Quote ${result.quoteNumber} saved as a draft in ${result.storage}. It has not been sent to the customer.`;
      setQuoteDirty(false);
      if (typeof window !== "undefined") {
        clearDraftSnapshot(window.localStorage, draftRecoveryStorageKey);
      }
      setDraftRecoveryOffer(null);
      recordProductAnalyticsEvent("quote_saved");
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
            if (smsResult?.sms?.sent) {
              smsSuffix = " Owner SMS sent.";
            } else if (smsResult?.sms?.reason === "sms_not_configured") {
              smsSuffix = " Owner SMS not configured yet.";
            } else if (smsResult?.sms?.reason === "sms_disabled") {
              smsSuffix = " Owner SMS disabled by configuration.";
            } else if (smsResult?.sms?.reason === "sms_send_failed") {
              smsSuffix = " Owner SMS failed to send.";
            }
            if (!smsSuffix) return;
            setSubmitState((current) => current.message.startsWith(savedDraftMessage)
              ? { ...current, message: `${savedDraftMessage}${smsSuffix}${pricingAdjustmentNote}` }
              : current);
          })
          .catch(() => {
            setSubmitState((current) => current.message.startsWith(savedDraftMessage)
              ? { ...current, message: `${savedDraftMessage} Owner SMS failed to send.${pricingAdjustmentNote}` }
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

  const handleEditQuote = async (quote, { navigateToRoute = true } = {}) => {
    if (!quote?.id) return;
    if (
      navigateToRoute
      && CUSTOMER_CENTERED_WORKSPACE_ENABLED
      && quoteDirty
      && !window.confirm("Edit this saved quote? Your unsaved quote changes will be discarded.")
    ) {
      return;
    }
    const { buildCommercialAmendmentContext } = await loadCommercialAmendmentContext();
    const commercialAmendment = buildCommercialAmendmentContext(quote);
    if (!commercialAmendment.editable) {
      return {
        status: "recovery",
        reason: `${commercialAmendment.protocol.label}. ${commercialAmendment.protocol.explanation}`,
        consequence: "No editable draft was opened, and the saved commitment and its historical evidence remain unchanged.",
        nextResolution: commercialAmendment.protocol.nextAction
      };
    }

    const selection = quote.selection || {};
    const event = quote.event || {};
    const customer = quote.customer || {};
    const menuItemsFromSelection = Array.isArray(selection.menuItems) ? selection.menuItems : [];
    const menuItemsFromDetails = Array.isArray(selection.menuItemDetails)
      ? selection.menuItemDetails.map((item) => String(item?.id || "").trim()).filter(Boolean)
      : [];
    const menuItems = menuItemsFromSelection.length ? menuItemsFromSelection : menuItemsFromDetails;
    const menuItemQuantitiesFromDetails = Array.isArray(selection.menuItemDetails)
      ? selection.menuItemDetails.reduce((acc, item) => {
        const id = String(item?.id || "").trim();
        if (!id) return acc;
        acc[id] = Math.max(1, Number(item?.quantity || 1));
        return acc;
      }, {})
      : {};
    const menuItemQuantities = {
      ...menuItemQuantitiesFromDetails,
      ...(selection.menuItemQuantities || {})
    };
    const addonQuantities = selection.addonQuantities || {};
    const rentalQuantities = selection.rentalQuantities || {};
    const quoteEventTypeId = String(quote.eventTypeId || selection.eventTypeId || event.eventTypeId || "");
    resetChangeImpactPreview();
    setGlobalEventTypeId(quoteEventTypeId);

    // Lock labor rates during editing by defaulting overrides to the applied snapshot.
    const laborRateSnapshot = selection.laborRateSnapshot || {};
    const bartenderApplied = toOptionalNumber(
      laborRateSnapshot.bartenderRateApplied ?? quote.totals?.bartenderRateApplied
    );
    const serverApplied = toOptionalNumber(
      laborRateSnapshot.serverRateApplied ?? quote.totals?.serverRateApplied
    );
    const chefApplied = toOptionalNumber(
      laborRateSnapshot.chefRateApplied ?? quote.totals?.chefRateApplied
    );

    setForm((prev) => ({
      ...prev,
      date: event.date || "",
      time: event.time || "",
      hours: normalizeEventHours(event.hours),
      bartenders: toNumber(event.bartenders, 0),
      guests: toNumber(event.guests, 0),
      venue: event.venue || "",
      venueAddress: event.venueAddress || "",
      eventName: event.name || "",
      clientOrg: customer.organization || "",
      style: event.style || prev.style,
      servers: toNumber(event.servers, 0),
      chefs: toNumber(event.chefs, 0),
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      dietaryRestrictions: String(event.dietaryRestrictions || ""),
      pkg: resolveFirstValidPackageId(catalog.packages, selection.packageId || prev.pkg),
      addons: Array.isArray(selection.addons) ? selection.addons : [],
      addonQuantities,
      rentals: Array.isArray(selection.rentals) ? selection.rentals : [],
      rentalQuantities,
      menuItems,
      menuItemQuantities,
      eventTypeId: quoteEventTypeId,
      bartenderRateTypeId:
        String(selection.bartenderRateTypeId || laborRateSnapshot.bartenderRateTypeId || ""),
      staffingRateTypeId:
        String(selection.staffingRateTypeId || laborRateSnapshot.staffingRateTypeId || ""),
      bartenderRateOverride:
        selection.bartenderRateOverride !== "" && selection.bartenderRateOverride !== null && selection.bartenderRateOverride !== undefined
          ? toOptionalNumber(selection.bartenderRateOverride)
          : bartenderApplied,
      serverRateOverride:
        selection.serverRateOverride !== "" && selection.serverRateOverride !== null && selection.serverRateOverride !== undefined
          ? toOptionalNumber(selection.serverRateOverride)
          : serverApplied,
      serverRateMixCsv: String(selection.serverRateMixCsv || ""),
      chefRateMixCsv: String(selection.chefRateMixCsv || ""),
      chefRateOverride:
        selection.chefRateOverride !== "" && selection.chefRateOverride !== null && selection.chefRateOverride !== undefined
          ? toOptionalNumber(selection.chefRateOverride)
          : chefApplied,
      eventTemplateId: selection.eventTemplateId || "custom",
      taxRegion: selection.taxRegion || prev.taxRegion,
      seasonProfileId: selection.seasonProfileId || prev.seasonProfileId || "auto",
      milesRT: toNumber(selection.milesRT, 0),
      includeDisposables: quote.quoteMeta?.includeDisposables !== false,
      payMethod: selection.payMethod || prev.payMethod
    }));

    setEditingQuote({
      id: quote.id,
      quoteNumber: quote.quoteNumber || quote.id,
      activeVersionId: quote.activeVersionId || quote.versionMeta?.versionId || "",
      customerId: quote.customerId || "",
      organizationId: quote.organizationId || authSession.organizationId || "",
      rebooking: quote.rebooking && typeof quote.rebooking === "object"
        ? quote.rebooking
        : null,
      // Presentation context only: the client-request panel needs the stored
      // request to render beside the editor. Carrying the snapshot grants no
      // authority — the panel stages draft edits and the trusted save path
      // remains the sole versioning authority.
      portalDecision: quote.portalDecision && typeof quote.portalDecision === "object"
        ? quote.portalDecision
        : null,
      commercialAmendment
    });
    setQuoteDirty(false);
    setTouchedFields({});
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
      message: rebookReviewRequired
        ? `Rebook review required for ${quote.quoteNumber || quote.id}: choose a current-or-future event date, review the copied scope, then save. Delivery remains blocked until that trusted edit succeeds.`
        : `Editing ${quote.quoteNumber || quote.id}. Save will update this quote and keep a version snapshot.`
    });
    wizardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => wizardRef.current?.focus({ preventScroll: true }));
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
      return;
    }
    directEditLoadRef.current = { key: "", generation: directEditLoadRef.current.generation + 1 };
    navigateWorkspace(WORKSPACE_PATHS.quoteNew);
    setEditingQuote(EMPTY_EDITING_QUOTE);
    setDraftRecoveryResumed(false);
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
  };

  const handleSignOut = async () => {
    if (catalogInteraction.busy) {
      setSubmitState((prev) => ({
        ...prev,
        message: "Wait for the current catalog action to finish before signing out."
      }));
      return;
    }
    if (
      (quoteDirty || catalogInteraction.dirty)
      && !window.confirm("Discard unsaved workspace changes and sign out?")
    ) return;
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
    if (!customerPortalEnabled) return;
    if (catalogInteraction.busy) {
      pushToast("Wait for the current catalog action to finish before opening the customer portal.", "info");
      return;
    }
    if (
      (quoteDirty || catalogInteraction.dirty)
      && !window.confirm("Discard unsaved workspace changes and open the customer portal?")
    ) return;
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

  const catalogSetupBypassKey = String(authSession.organizationId || "").trim()
    ? `quotepilot:skipCatalogSetup:${String(authSession.organizationId).trim()}`
    : "";
  useEffect(() => {
    if (typeof window === "undefined" || !catalogSetupBypassKey) {
      setSkipCatalogSetup(false);
      return;
    }
    try {
      setSkipCatalogSetup(window.sessionStorage.getItem(catalogSetupBypassKey) === "1");
    } catch {
      setSkipCatalogSetup(false);
    }
  }, [catalogSetupBypassKey]);
  const setCatalogBypassState = useCallback((bypass) => {
    const nextBypass = Boolean(bypass);
    setSkipCatalogSetup(nextBypass);
    if (typeof window === "undefined" || !catalogSetupBypassKey) return;
    try {
      if (nextBypass) {
        window.sessionStorage.setItem(catalogSetupBypassKey, "1");
      } else {
        window.sessionStorage.removeItem(catalogSetupBypassKey);
      }
    } catch {
      // Storage failures are non-fatal for setup-gate control.
    }
  }, [catalogSetupBypassKey]);

  const saveCatalogDuringSetup = async (nextCatalog) => {
    if (!hasConfiguredEventType) {
      return {
        ok: false,
        error: "Almost there—add at least one event type in Menu, then save your catalog."
      };
    }
    const result = await catalog.saveCatalog(nextCatalog);
    if (result.ok) {
      setAdminOpen(false);
    }
    return result;
  };

  if (tenantContext.loading) {
    return (
      <main className="auth-shell container">
        <WorkspaceStatusCard>
          <h1>Opening Your Workspace</h1>
          <p className="muted">Finding the right organization for this address…</p>
        </WorkspaceStatusCard>
      </main>
    );
  }

  if (tenantContext.blocked) {
    return (
      <main className="auth-shell container">
        <WorkspaceStatusCard>
          <h1>We Couldn’t Open This Workspace</h1>
          <p className="muted">
            Host <strong>{tenantContext.hostname || "unknown"}</strong> is not active or is not mapped to a tenant.
          </p>
          <p className="source-note">
            {tenantContext.error || "This domain needs to be activated or mapped to a customer workspace."}
          </p>
          {submitState.message && <p className="warning-note">{submitState.message}</p>}
          <div className="auth-actions">
            <button type="button" className="cta" onClick={handleRetryTenantResolution}>
              Try Again
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
          <h1>Welcome Back</h1>
          <p className="muted">Getting your QuotePilot workspace ready…</p>
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
            component={IntegrationOpsModal}
            onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.INTEGRATIONS, setIntegrationsOpen)}
            returnFocusRef={workspaceToolReturnFocusRef}
            hasUnsavedWorkspaceChanges={quoteDirty}
          >
            <IntegrationOpsModal
              open={integrationsOpen}
              onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.INTEGRATIONS, setIntegrationsOpen)}
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
          <h1>Getting Your Catalog Ready</h1>
          <p className="muted">Bringing in this organization’s products and pricing…</p>
        </WorkspaceStatusCard>
      </main>
    );
  }

  if (catalog.requiresFirebase) {
    return (
      <main className="auth-shell container">
        <WorkspaceStatusCard>
          <CatalogReadNotice
            canContinue={false}
            loading={catalog.loading}
            onRetry={catalog.reload}
            technicalDetail={catalog.error}
            headingLevel={1}
            titleId="catalog-blocked-title"
          />
          <div className="auth-actions">
            <button type="button" className="ghost" onClick={() => window.location.reload()}>Reload Workspace</button>
            <button type="button" className="ghost" onClick={handleSignOut}>Sign Out</button>
          </div>
        </WorkspaceStatusCard>
      </main>
    );
  }

  const shouldSuppressSetupGate = skipCatalogSetup || importStudioOpen;
  if (!catalogSetupComplete && !shouldSuppressSetupGate) {
    return (
      <div className="app-shell app-shell-neutral" style={appThemeVars}>
        <main className="auth-shell container">
          <WorkspaceStatusCard>
            <p className="eyebrow">Let’s make QuotePilot yours</p>
            <h1>Bring Your Catalog to Life</h1>
            <p className="muted">
              Quote creation unlocks as soon as your real offerings and prices have a quick review.
            </p>
            <p className="source-note">
              Start fast with a starter catalog draft, bring in an existing menu, or create your own. You stay in control of every suggested price.
            </p>
            <ul className="source-note">
              <li>Pick a starting point: Wedding, Corporate, BBQ, or Church & community.</li>
              <li>Make it yours: name a package, add an event type, and shape the menu your team loves.</li>
              <li>Review with confidence: confirm fees, tax, deposits, travel, staffing, tiers, and seasonal pricing.</li>
            </ul>
            <div className="auth-actions">
              {authSession.isAdmin && (
                <>
                  <button
                    type="button"
                    className="cta"
                    onClick={() => openWorkspaceTool(setAdminOpen, {
                      beforeOpen: () => setAdminInitialTab("starter")
                    })}
                  >
                    Choose a starter or build my catalog
                  </button>
                  <button type="button" className="ghost" onClick={() => openWorkspaceTool(setImportStudioOpen)}>
                    Import my menu
                  </button>
                  <button type="button" className="ghost" onClick={() => setCatalogBypassState(true)}>
                    Explore the workspace
                  </button>
                </>
              )}
              {!authSession.isAdmin && (
                <button type="button" className="cta" onClick={catalog.reload}>
                  Check for catalog updates
                </button>
              )}
              <button type="button" className="ghost" onClick={handleSignOut}>Sign Out</button>
            </div>
            {!authSession.isAdmin && (
              <p className="warning-note">Your organization admin can finish the catalog; then check here for the latest update.</p>
            )}
            <p className="source-note">
              You can also import catalog records first, or continue with manual edits from workspace if you need to proceed today.
            </p>
          </WorkspaceStatusCard>
        </main>

        {authSession.isAdmin && adminMounted && (
          <WorkspaceLazyTool
            open={adminOpen}
            surfaceName="Catalog Admin"
            component={AdminCatalogModal}
            onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.CATALOG, setAdminOpen)}
            returnFocusRef={workspaceToolReturnFocusRef}
            hasUnsavedWorkspaceChanges={quoteDirty}
          >
            <AdminCatalogModal
              open={adminOpen}
              catalog={catalog}
              organizationId={authSession.organizationId}
              onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.CATALOG, setAdminOpen)}
              returnFocusRef={workspaceToolReturnFocusRef}
              onSave={saveCatalogDuringSetup}
              onApplyStarterPack={catalog.stageStarterPack}
              onCatalogMutation={handleCatalogMutation}
              onReload={catalog.reload}
              saving={catalog.saving}
              initialTab={adminInitialTab}
              selectedEventType={globalEventTypeId}
              onEventTypeChange={setGlobalEventTypeId}
              onToast={pushToast}
              onInteractionStateChange={setCatalogInteraction}
            />
          </WorkspaceLazyTool>
        )}
      </div>
    );
  }

  // Shared builder JSX rendered by both presentations (Proposal Composer and
  // the Guided-mode wizard) so neither mode loses the rebook review banner or
  // the save/availability messaging.
  const draftRecoveryBanner = draftRecoveryOffer && !quoteDirty && !editingQuote.id ? (
    <section className="panel draft-recovery-banner" role="status" data-testid="draft-recovery-banner">
      <div>
        <p className="eyebrow">Unsaved draft found</p>
        <p>You were composing a quote {describeSnapshotAge(draftRecoveryOffer.ageMs)}. Resume where you left off?</p>
      </div>
      <div className="right-actions">
        <button type="button" className="cta compact" onClick={resumeDraftRecovery}>
          Resume draft
        </button>
        <button type="button" className="ghost compact" onClick={discardDraftRecovery}>
          Discard
        </button>
      </div>
    </section>
  ) : null;

  const draftReviewSurfaces = (
    <>
    {draftRecoveryBanner}
    <RebookQuoteReviewBanner
      quoteNumber={editingQuote.quoteNumber}
      organizationId={editingQuote.organizationId || authSession.organizationId}
      customerId={editingQuote.customerId}
      eventDate={form.date}
      tenantTimeZone={tenantTimeZone}
      rebooking={editingQuote.rebooking}
      onFocusEventDate={() => {
        setBuilderMode("guided");
        setStep(1);
        window.requestAnimationFrame(() => {
          wizardRef.current?.querySelector('input[type="date"]')?.focus({ preventScroll: true });
        });
      }}
    />
    </>
  );

  const builderStatusNotes = (
    <>
      <p className="source-note">Quote validity: {Math.max(1, Number(catalog.settings?.quoteValidityDays || 30))} days</p>
      {isEditingQuote && (
        <p className="source-note">
          Editing quote {editingQuote.quoteNumber}. Saving updates this quote (with version history) and keeps labor rates locked by snapshot.
        </p>
      )}
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
    </>
  );

  const catalogReadNotice = catalog.error ? (
    <CatalogReadNotice
      canContinue
      loading={catalog.loading}
      onRetry={catalog.reload}
      technicalDetail={catalog.error}
      headingLevel={2}
      titleId="quote-builder-catalog-read-title"
    />
  ) : null;

  // "What will this change affect?" — the server-checked impact preview for a
  // saved quote being edited. Shared so it renders identically in the
  // Proposal Composer document and the Guided-mode wizard's save step.
  const changeImpactSurface = isEditingQuote ? (
    <>
      {eventIngredientProjection.access.readEnabled && (
        <details className="commercial-twin-evidence-disclosure">
          <summary>Ingredient quantity, cost, and allocation evidence</summary>
          <div data-capability-id="inventory-event-ingredient-consequence" id="commercial-twin-inventory-evidence">
          <EventIngredientProjectionPanel
            selectedMenuItems={eventIngredientSelections}
            read={eventIngredientProjection.read}
            preview={eventIngredientProjection.preview}
            operation={eventIngredientProjection.operation}
            allocationOperation={eventIngredientProjection.allocationOperation}
            quoteDirty={quoteDirty}
            canPreview={eventIngredientProjection.canPreview}
            canRecord={eventIngredientProjection.canRecord}
            controlsLocked={eventIngredientProjection.controlsLocked}
            allocationControlsLocked={eventIngredientProjection.allocationControlsLocked}
            canManageAllocation={eventIngredientProjection.canManageAllocation}
            canAllocate={eventIngredientProjection.canAllocate}
            canRelease={eventIngredientProjection.canRelease}
            canReconcilePlan={eventIngredientProjection.canReconcilePlan}
            allocationBlockedReason={eventIngredientProjection.allocationBlockedReason}
            recordBlockedReason={eventIngredientProjection.recordBlockedReason}
            onPreview={eventIngredientProjection.previewCurrent}
            onRecord={authSession.isAdmin ? eventIngredientProjection.recordCurrentPreview : undefined}
            onReconcile={eventIngredientProjection.reconcile}
            onReset={eventIngredientProjection.reset}
            onAllocate={eventIngredientProjection.allocate}
            onRelease={eventIngredientProjection.release}
            onReconcilePlan={eventIngredientProjection.reconcileStaleAllocation}
            onReconcileAllocation={eventIngredientProjection.reconcileAllocation}
            onResetAllocation={eventIngredientProjection.resetAllocation}
            onPreviewInputChange={setEventIngredientPreviewInput}
            showPreviewAction={!livingCommercialTwinProjection.scenario.proposalChanged}
          />
          </div>
        </details>
      )}
    <div data-capability-id="cwf-15b-commercial-change-impact-preview">
      <Suspense fallback={<p className="source-note" role="status">Loading governed amendment context…</p>}>
        <CommercialAmendmentWorkspace
          commitment={editingQuote.commercialAmendment}
          dirty={quoteDirty}
          previewAvailable={changeImpactPreviewAvailable}
          previewRequested={changeImpactPreview.requested}
          previewLoading={changeImpactPreview.loading}
          previewRecovering={changeImpactPreview.recovering}
          previewError={changeImpactPresentationError}
          previewActionVisible={!proposalComposerActive}
          onPreview={() => handlePreviewChangeImpact({
            recovery: Boolean(changeImpactPresentationError)
          })}
        >
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
              commitment={editingQuote.commercialAmendment}
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
              appliedQuote={changeImpactPreview.appliedQuote}
              inventoryConsequences={eventIngredientProjection.access.readEnabled
                ? commercialInventoryConsequences
                : null}
              scopeCurrent={!changeImpactPresentationError}
              onRetry={proposalComposerActive
                ? undefined
                : () => handlePreviewChangeImpact({ recovery: true })}
              onRequestAuthorization={handleRequestChangeAuthorization}
              onRefreshAuthorization={handleRefreshChangeAuthorization}
              onAuthorize={handleAuthorizeChange}
              onApply={handleApplyCommercialChange}
              onReconcileApplyOutcome={handleReconcileCommercialChangeApplyOutcome}
              onRecoverApply={handleRecoverCommercialChangeApply}
              onOpenAppliedQuote={() => {
                const quoteId = changeImpactPreview.appliedQuote?.quoteId || editingQuote.id;
                setHistoryTarget({ quoteId, reason: "updated" });
                navigateWorkspace(buildQuotePath(quoteId));
              }}
              onReturnToEdit={() => {
                if (!proposalComposerActive) setStep(1);
                window.requestAnimationFrame(() => {
                  wizardRef.current?.focus({ preventScroll: true });
                });
              }}
            />
          </Suspense>
        </RecoverableErrorBoundary>
      )}
        </CommercialAmendmentWorkspace>
      </Suspense>
    </div>
    </>
  ) : null;

  const proposalComposerChangeImpactScopeCurrent = !(
    isEditingQuote && changeImpactPreviewAvailable
  ) || changeImpactScopeIsCurrent();
  const proposalComposerSaveBlockers = proposalComposerActive
    ? buildDraftSaveBlockers({
        form,
        totals,
        catalogLoading: catalog.loading,
        selectedMenuItemCount,
        quoteEditUnavailable: Boolean(quoteEditRouteId && !quoteEditReady),
        changeImpactReviewRequired: Boolean(
          isEditingQuote
          && changeImpactPreviewAvailable
          && !proposalComposerChangeImpactScopeCurrent
        ),
        changeImpactAuthorizationRequired: Boolean(
          isEditingQuote
          && changeImpactPreviewAvailable
          && proposalComposerChangeImpactScopeCurrent
          && changeImpactPreview.authorityState === "enforced"
          && changeImpactPreview.authorizationRequired
        )
      })
    : [];

  const proposalComposerSurface = proposalComposerActive ? (
    <ProposalComposer
      form={form}
      totals={totals}
      catalog={catalog}
      settings={effectiveSettings}
      menuSections={effectiveMenuSections}
      menuLoading={dynamicMenuLoading}
      menuError={dynamicMenuError}
      packageIncludedMenuItemIds={
        catalog.packages.find((item) => item.id === form.pkg)?.includedMenuItemIds || []
      }
      eventTypes={catalog.eventTypes || []}
      eventTemplates={effectiveSettings.eventTemplates || []}
      readiness={proposalReadiness}
      editingQuote={editingQuote}
      quoteDirty={quoteDirty}
      saving={submitState.saving}
      saveLabel={submitState.saving
        ? (isEditingQuote ? "Saving Changes..." : "Saving Draft...")
        : (isEditingQuote ? "Save Changes" : "Save draft")}
      saveDisabled={submitState.saving || catalog.loading || totals.guests <= 0}
      saveDisabledReason={totals.guests <= 0
        ? "Set a guest count above zero before saving."
        : ""}
      saveBlockers={proposalComposerSaveBlockers}
      saveMessage={submitState.message}
      compareEnabled={quoteCompareEnabled}
      catalogLoading={catalog.loading}
      onFieldChange={handleStep1FieldChange}
      onSelectionTouched={handleSelectionTouched}
      onPatchForm={handleComposerPatch}
      onTemplateChange={applyEventTemplate}
      onEventTypeChange={handleEventTypeChange}
      onSaveQuote={() => void handleSubmitQuote()}
      onOpenCompare={() => openWorkspaceTool(setCompareOpen)}
      onGuidedMode={() => setBuilderMode("guided")}
      reviewSurfaces={draftReviewSurfaces}
      statusNotes={builderStatusNotes}
      changeImpactSurface={changeImpactSurface}
      livingCommercialTwin={isEditingQuote ? {
        projection: livingCommercialTwinProjection,
        scopeKey: livingTwinScopeKey,
        baseQuoteRevisionId: livingTwinBaseQuoteRevisionId,
        currentGuestCount: livingCommercialTwinProjection.scenario.currentGuestCount,
        proposedGuestCount: form.guests,
        eventName: editingQuote.commercialAmendment?.event?.name
          || editingQuote.baseForm?.eventName
          || "",
        eventDate: editingQuote.commercialAmendment?.event?.date
          || editingQuote.baseForm?.date
          || "",
        eventTime: editingQuote.commercialAmendment?.event?.time
          || editingQuote.baseForm?.time
          || "",
        venue: editingQuote.commercialAmendment?.event?.venue
          || editingQuote.baseForm?.venue
          || "",
        proposedEventName: form.eventName,
        proposedEventDate: form.date,
        proposedEventTime: form.time,
        proposedVenue: form.venue,
        onGuestCountChange: handleLivingTwinGuestCountChange,
        onRequestConsequences: handleLivingTwinConsequenceRequest,
        onRetryConsequences: (request) => handlePreviewChangeImpact({
          recovery: true,
          workbenchRequest: request
        }),
        onReviewForCommitment: focusLivingTwinCommitmentReview,
        onPreview: (request) => handlePreviewChangeImpact({
          recovery: Boolean(changeImpactPresentationError),
          workbenchRequest: request
        }),
        onRevertGuestCount: handleRevertLivingTwinGuestCount,
        inventoryEvidenceAvailable: eventIngredientProjection.access.readEnabled,
        onRefreshStaffing: fulfillmentStaffingActive
          ? () => void fulfillmentStaffing.refresh().catch(() => {})
          : undefined
      } : null}
      impactWatch={isEditingQuote
        ? {
            available: changeImpactPreviewAvailable,
            previewed: Boolean(changeImpactPreview.model)
          }
        : null}
      isAdmin={authSession.isAdmin}
      onOpenCatalogPricing={() => {
        setGlobalEventTypeId(form.eventTypeId);
        openWorkspaceTool(setAdminOpen, {
          beforeOpen: () => setAdminInitialTab("menu")
        });
      }}
    />
  ) : null;

  return (
    <div className={`app-shell${CUSTOMER_CENTERED_WORKSPACE_ENABLED ? " app-shell-neutral" : ""}`} style={appThemeVars}>
      <header className="site-header">
        <div className="container nav">
          <div className="workspace-header-identity">
            <ProductBrandLockup compact className="header-product-brand" />
            <div className="workspace-brand" aria-label={`Current workspace: ${workspaceName}`}>
              {tenantBrandLogoUrl ? (
                <img
                  className="workspace-brand-logo"
                  src={tenantBrandLogoUrl}
                  alt=""
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <span className="workspace-brand-logo workspace-brand-logo-placeholder" aria-hidden="true">
                  {workspaceName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <div className="workspace-brand-copy">
                <small>Workspace</small>
                <strong>{workspaceName}</strong>
                {tenantBrandTagline && tenantBrandName !== PRODUCT_NAME && <span>{tenantBrandTagline}</span>}
              </div>
            </div>
          </div>
          {brandCrew.length > 0 && (
            <div className="brand-crew">
              {brandCrew.map((member, idx) => (
                <figure className="crew-chip" key={`${member.label || "member"}-${idx}`}>
                  {member.imageUrl ? (
                    <img src={member.imageUrl} alt={member.label || `Team member ${idx + 1}`} loading="lazy" decoding="async" />
                  ) : tenantBrandLogoUrl ? (
                    <img src={tenantBrandLogoUrl} alt={member.label || `Team member ${idx + 1}`} loading="lazy" decoding="async" />
                  ) : (
                    <span className="crew-chip-placeholder" aria-hidden="true">
                      {String(member.label || "TM").slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <figcaption>{member.label || `Team member ${idx + 1}`}</figcaption>
                </figure>
              ))}
            </div>
          )}
          <div className="right-actions header-actions" ref={headerMenusRef}>
            {CUSTOMER_CENTERED_WORKSPACE_ENABLED && (
              <>
                <button
                  className={`ghost shell-nav-action${activeWorkspaceSection === "home" ? " nav-view-active" : ""}`}
                  type="button"
                  aria-current={activeWorkspaceSection === "home" ? "page" : undefined}
                  onClick={() => { setOpenHeaderMenu(""); navigateWorkspace(WORKSPACE_PATHS.home); }}
                >
                  <CalendarBlank className="shell-nav-icon" size={20} weight={activeWorkspaceSection === "home" ? "fill" : "regular"} aria-hidden="true" />
                  <span className="shell-nav-label">Now</span>
                </button>
                <button
                  className={`ghost shell-nav-action${activeWorkspaceSection === "customers" ? " nav-view-active" : ""}`}
                  type="button"
                  aria-current={activeWorkspaceSection === "customers" ? "page" : undefined}
                  onClick={() => { setOpenHeaderMenu(""); navigateWorkspace(WORKSPACE_PATHS.customers); }}
                >
                  <UserCircle className="shell-nav-icon" size={20} weight={activeWorkspaceSection === "customers" ? "fill" : "regular"} aria-hidden="true" />
                  <span className="shell-nav-label">Customers</span>
                </button>
                <button
                  className="ghost commercial-search-trigger"
                  type="button"
                  ref={commercialSearchTriggerRef}
                  aria-haspopup="dialog"
                  aria-keyshortcuts="Meta+K Control+K"
                  title="Search customers and quotes (Ctrl or Command K)"
                  onClick={(event) => openCommercialSearch(event.currentTarget)}
                >
                  <MagnifyingGlass className="shell-nav-icon" size={20} aria-hidden="true" />
                  <span className="shell-nav-label">Search</span>
                  <kbd aria-hidden="true">⌘K</kbd>
                </button>
              </>
            )}
            <button className="cta header-quick-cta" type="button" onClick={handleGetInstantQuote}>
              <Plus className="shell-nav-icon" size={20} weight="bold" aria-hidden="true" />
              <span className="shell-nav-label">New quote</span>
            </button>
            <button
              className={`ghost shell-nav-action${activeWorkspaceSection === "quotes" && !quoteBuilderActive ? " nav-view-active" : ""}`}
              type="button"
              ref={historyTriggerRef}
              onClick={() => {
                setOpenHeaderMenu("");
                setHistoryTarget({ quoteId: "", reason: "" });
                navigateWorkspace(WORKSPACE_PATHS.quotes);
              }}
            >
              <NotePencil className="shell-nav-icon" size={20} weight={activeWorkspaceSection === "quotes" && !quoteBuilderActive ? "fill" : "regular"} aria-hidden="true" />
              <span className="shell-nav-label">Quotes</span>
            </button>
            {CUSTOMER_CENTERED_WORKSPACE_ENABLED && (
              <button
                className={`ghost shell-nav-action${activeWorkspaceSection === "messaging" ? " nav-view-active" : ""}`}
                type="button"
                data-capability-entry="event-messaging-station"
                aria-current={activeWorkspaceSection === "messaging" ? "page" : undefined}
                onClick={() => {
                  setOpenHeaderMenu("");
                  navigateWorkspace(WORKSPACE_PATHS.messaging);
                }}
              >
                <EnvelopeSimple className="shell-nav-icon" size={20} weight={activeWorkspaceSection === "messaging" ? "fill" : "regular"} aria-hidden="true" />
                <span className="shell-nav-label">Messages</span>
              </button>
            )}
            <button
              className={`ghost shell-nav-action workflow-attention-trigger${activeWorkspaceSection === "workflow" ? " nav-view-active" : ""}`}
              type="button"
              ref={workflowTriggerRef}
              onClick={() => {
                setOpenHeaderMenu("");
                navigateWorkspace(WORKSPACE_PATHS.workflow);
              }}
              aria-label={workflowAttentionCount === null
                ? "Workflow"
                : workflowAttentionCount > 0
                  ? `Workflow, ${workflowAttentionCount} ${workflowAttentionCount === 1 ? "quote needs" : "quotes need"} attention`
                  : "Workflow, no quote follow-ups in this view"}
            >
              <NotePencil className="shell-nav-icon" size={20} aria-hidden="true" />
              <span className="shell-nav-label">Workflow</span>
              <AttentionBadge count={workflowAttentionCount} />
            </button>
            <div className="header-menu desktop-header-menu">
              <button
                className="ghost header-menu-trigger"
                type="button"
                ref={operationsMenuTriggerRef}
                aria-haspopup="menu"
                aria-expanded={openHeaderMenu === "operations"}
                onClick={() => setOpenHeaderMenu((current) => current === "operations" ? "" : "operations")}
              >
                <StarFour className="shell-nav-icon" size={20} aria-hidden="true" />
                <span className="shell-nav-label">Operations</span>
              </button>
              {openHeaderMenu === "operations" && (
                <div className="header-menu-popover" role="menu" aria-label="Operations">
                  {CUSTOMER_CENTERED_WORKSPACE_ENABLED && authSession.isAdmin && OPERATIONAL_STAFFING_UI_ENABLED && <button type="button" role="menuitem" onClick={() => { setOpenHeaderMenu(""); navigateWorkspace(WORKSPACE_PATHS.staff); }}>Staff</button>}
                  {inventoryWorkspaceEnabled && <button type="button" role="menuitem" onClick={() => { setOpenHeaderMenu(""); navigateWorkspace(WORKSPACE_PATHS.inventory); }}>Inventory</button>}
                  {eventScheduleEnabled && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.schedule, setScheduleOpen, { menuTriggerRef: operationsMenuTriggerRef })}>Event Schedule</button>}
                  {dashboardEnabled && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.reporting, setDashboardOpen, { menuTriggerRef: operationsMenuTriggerRef })}>Reporting Dashboard</button>}
                  {integrationsEnabled && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.integrations, setIntegrationsOpen, { menuTriggerRef: operationsMenuTriggerRef })}>Integrations Ops</button>}
                  {authSession.isAdmin && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.imports, setImportStudioOpen, { menuTriggerRef: operationsMenuTriggerRef })}>Import Studio</button>}
                  {authSession.isAdmin && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.catalog, setAdminOpen, { menuTriggerRef: operationsMenuTriggerRef, beforeOpen: () => setAdminInitialTab("") })}>Catalog Admin</button>}
                  {diagnosticsEnabled && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.diagnostics, setDiagnosticsOpen, { menuTriggerRef: operationsMenuTriggerRef })}>Session Diagnostics</button>}
                </div>
              )}
            </div>

            <div className="header-menu desktop-header-menu">
              <button
                className="ghost header-menu-trigger"
                type="button"
                ref={accountMenuTriggerRef}
                aria-haspopup="menu"
                aria-expanded={openHeaderMenu === "account"}
                onClick={() => setOpenHeaderMenu((current) => current === "account" ? "" : "account")}
              >
                <UserCircle className="shell-nav-icon" size={20} aria-hidden="true" />
                <span className="shell-nav-label">Account</span>
              </button>
              {openHeaderMenu === "account" && (
                <div className="header-menu-popover account-menu-popover" role="menu" aria-label="Account">
                  <div className="header-account-summary" role="presentation">
                    <strong>{authSession.user.email}</strong>
                    <span>{authSession.role}</span>
                  </div>
                  {customerPortalEnabled && <button type="button" role="menuitem" onClick={() => { setOpenHeaderMenu(""); openPortalMode(); }}>Customer Portal</button>}
                  <button type="button" role="menuitem" aria-pressed={workspaceSoundsOn} onClick={toggleWorkspaceSounds}>
                    Sounds: {workspaceSoundsOn ? "On" : "Off"}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setOpenHeaderMenu(""); handleSignOut(); }}>Sign Out</button>
                </div>
              )}
            </div>

            <div className="header-menu mobile-header-menu">
              <button
                className="ghost header-menu-trigger"
                type="button"
                ref={moreMenuTriggerRef}
                aria-haspopup="menu"
                aria-expanded={openHeaderMenu === "more"}
                onClick={() => setOpenHeaderMenu((current) => current === "more" ? "" : "more")}
              >
                <Plus className="shell-nav-icon" size={20} aria-hidden="true" />
                <span className="shell-nav-label">More</span>
              </button>
              {openHeaderMenu === "more" && (
                <div className="header-menu-popover mobile-more-popover" role="menu" aria-label="More">
                  {CUSTOMER_CENTERED_WORKSPACE_ENABLED && authSession.isAdmin && OPERATIONAL_STAFFING_UI_ENABLED && <button type="button" role="menuitem" onClick={() => { setOpenHeaderMenu(""); navigateWorkspace(WORKSPACE_PATHS.staff); }}>Staff</button>}
                  {inventoryWorkspaceEnabled && <button type="button" role="menuitem" onClick={() => { setOpenHeaderMenu(""); navigateWorkspace(WORKSPACE_PATHS.inventory); }}>Inventory</button>}
                  {eventScheduleEnabled && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.schedule, setScheduleOpen, { menuTriggerRef: moreMenuTriggerRef })}>Event Schedule</button>}
                  {dashboardEnabled && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.reporting, setDashboardOpen, { menuTriggerRef: moreMenuTriggerRef })}>Reporting Dashboard</button>}
                  {integrationsEnabled && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.integrations, setIntegrationsOpen, { menuTriggerRef: moreMenuTriggerRef })}>Integrations Ops</button>}
                  {authSession.isAdmin && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.imports, setImportStudioOpen, { menuTriggerRef: moreMenuTriggerRef })}>Import Studio</button>}
                  {authSession.isAdmin && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.catalog, setAdminOpen, { menuTriggerRef: moreMenuTriggerRef, beforeOpen: () => setAdminInitialTab("") })}>Catalog Admin</button>}
                  {diagnosticsEnabled && <button type="button" role="menuitem" onClick={() => openRoutedWorkspaceTool(WORKSPACE_PATHS.diagnostics, setDiagnosticsOpen, { menuTriggerRef: moreMenuTriggerRef })}>Session Diagnostics</button>}
                  <div className="header-account-summary" role="presentation">
                    <strong>{authSession.user.email}</strong>
                    <span>{authSession.role}</span>
                  </div>
                  {customerPortalEnabled && <button type="button" role="menuitem" onClick={() => { setOpenHeaderMenu(""); openPortalMode(); }}>Customer Portal</button>}
                  <button type="button" role="menuitem" aria-pressed={workspaceSoundsOn} onClick={toggleWorkspaceSounds}>
                    Sounds: {workspaceSoundsOn ? "On" : "Off"}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setOpenHeaderMenu(""); handleSignOut(); }}>Sign Out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {commercialSearchAvailable && commercialSearchOpen && (
        <div data-commercial-search-surface="true">
          <WorkspaceLazyTool
            open
            surfaceName="Commercial search"
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
        </div>
      )}

      <section className="workspace-intro container">
        <p><strong>{String(organization?.name || brandName || "Catering workspace").trim()}</strong></p>
        <p className={quoteDirty ? "workspace-save-state is-dirty" : "workspace-save-state"} aria-live="polite">
          {quoteDirty
            ? "Unsaved changes"
            : isEditingQuote
              ? `Editing ${editingQuote.quoteNumber || "saved quote"} · no unsaved changes`
              : "Workspace open"}
        </p>
      </section>

      {CUSTOMER_CENTERED_WORKSPACE_ENABLED && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.HOME && (
        PILOT_NOW_ENABLED ? (
          <WorkspaceLazyRoute surfaceName="Now" component={ActiveLegacyHome}>
            <main className="container workspace-route-main">
              <ActiveLegacyHome
                snapshot={commercialSnapshot}
                organizationName={organizationName}
                organizationId={authSession.organizationId}
                onRefresh={commercialSnapshot.refresh}
                onOpenWorkflow={(target = {}) => navigateWorkspace(buildWorkflowPath(target))}
                onOpenQuote={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}
                onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
                onNewQuote={handleGetInstantQuote}
              />
            </main>
          </WorkspaceLazyRoute>
        ) : (
          <WorkspaceLazyRoute surfaceName="Command Center" component={ActiveLegacyHome}>
            <main className="container workspace-route-main">
              <ActiveLegacyHome
                snapshot={commercialSnapshot}
                organizationName={organizationName}
                organizationId={authSession.organizationId}
                onRefresh={commercialSnapshot.refresh}
                onOpenWorkflow={(target = {}) => navigateWorkspace(buildWorkflowPath(target))}
                onOpenQuote={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}
                onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
                onNewQuote={handleGetInstantQuote}
              />
            </main>
          </WorkspaceLazyRoute>
        )
      )}

      {CUSTOMER_CENTERED_WORKSPACE_ENABLED && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CUSTOMER_LIST && (
        <WorkspaceLazyRoute surfaceName="Customer directory" component={CustomerDirectoryView}>
          <CustomerDirectoryView
            organizationId={authSession.organizationId}
            organizationName={organizationName}
            onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
            onNewQuote={handleGetInstantQuote}
          />
        </WorkspaceLazyRoute>
      )}

      {CUSTOMER_CENTERED_WORKSPACE_ENABLED && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL && (
        <WorkspaceLazyRoute surfaceName="Customer 360" component={CustomerWorkspaceView}>
          <CustomerWorkspaceView
            organizationId={authSession.organizationId}
            organizationName={organizationName}
            customerId={browserRoute.params?.customerId || ""}
            onBack={() => navigateWorkspace(WORKSPACE_PATHS.customers)}
            onOpenQuotes={() => navigateWorkspace(WORKSPACE_PATHS.quotes)}
            onOpenQuote={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}
            onOpenConversation={(quoteId) => navigateWorkspace(buildMessagingPath({ quoteId }))}
            onOpenQuoteEdit={(quoteId) => navigateWorkspace(buildQuoteEditPath(quoteId))}
            onCreateRebook={handleCreateCustomerRebook}
            onOpenWorkflow={(target = {}) => navigateWorkspace(buildWorkflowPath(target))}
            onOpenSchedule={() => navigateWorkspace(WORKSPACE_PATHS.schedule)}
            scheduleAvailable={eventScheduleEnabled}
            tenantTimeZone={tenantTimeZone}
            isAdmin={authSession.isAdmin}
          />
        </WorkspaceLazyRoute>
      )}

      {messagingOpen && (
        <WorkspaceLazyRoute surfaceName="Messages" component={MessagingStation}>
          <div className="container workspace-route-main messaging-route-main">
            <MessagingStation
              organizationId={authSession.organizationId}
              seedQuotes={commercialSnapshot.quotes}
              initialQuoteId={browserRoute.messagingFocus?.quoteId || ""}
              onSelectQuote={(quoteId) => navigateWorkspace(
                buildMessagingPath({ quoteId }),
                { replace: !quoteId }
              )}
              onOpenEvent={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}
              onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
            />
          </div>
        </WorkspaceLazyRoute>
      )}

      {authSession.isAdmin && OPERATIONAL_STAFFING_UI_ENABLED && staffRouteMounted && (
        <WorkspaceLazyRoute
          active={staffRouteOpen}
          surfaceName="Staff"
          component={StaffWorkspace}
          onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
        >
          <StaffWorkspace
            organizationId={authSession.organizationId}
            organizationName={workspaceName}
          />
        </WorkspaceLazyRoute>
      )}

      {CUSTOMER_CENTERED_WORKSPACE_ENABLED
        && inventoryWorkspaceEnabled
        && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INVENTORY && (
        <WorkspaceLazyRoute
          surfaceName="Inventory"
          component={InventoryWorkspace}
          onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
        >
          <InventoryWorkspace
            organizationId={authSession.organizationId}
            role={authSession.role}
            browserEnabled={INVENTORY_AUTHORITY_UI_ENABLED}
            tenantEnabled={inventoryTenantEnabled}
          />
        </WorkspaceLazyRoute>
      )}

      {authSession.isAdmin && catalogRouteMounted && (
        <WorkspaceLazyRoute
          active={catalogRouteOpen}
          surfaceName="Catalog Admin"
          component={AdminCatalogView}
          onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
        >
          <AdminCatalogView
            open={catalogRouteOpen}
            catalog={catalog}
            organizationId={authSession.organizationId}
            onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
            onSave={catalog.saveCatalog}
            onApplyStarterPack={catalog.stageStarterPack}
            onCatalogMutation={handleCatalogMutation}
            onReload={catalog.reload}
            saving={catalog.saving}
            initialTab={adminInitialTab}
            selectedEventType={globalEventTypeId}
            onEventTypeChange={setGlobalEventTypeId}
            onToast={pushToast}
            onInteractionStateChange={setCatalogInteraction}
            inventoryRecipeExtension={inventoryRecipeExtension}
          />
        </WorkspaceLazyRoute>
      )}

      {authSession.isAdmin && importsRouteMounted && (
        <WorkspaceLazyRoute
          active={importsRouteOpen}
          surfaceName="Import Studio"
          component={ImportStudioView}
          onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
        >
          <ImportStudioView
            open={importsRouteOpen}
            onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
            organizationId={authSession.organizationId}
            organizationName={workspaceName}
            currentUserUid={authSession.user?.uid || ""}
            currentUserEmail={authSession.user?.email || ""}
            catalogRevision={Math.max(0, Number(catalog.settings?.catalogRevision || 0))}
            onReload={() => catalog.reload({ background: true })}
            onImported={(result) => {
              catalog.reload({ background: true });
              if (result?.status === "rolled_back") {
                pushToast(`Import ${result.importBatchId} was undone.`, "info");
              } else {
                pushToast(`Imported ${result?.createdCount || 0} record(s) into ${authSession.organizationId}.`, "success");
              }
            }}
          />
        </WorkspaceLazyRoute>
      )}

      {eventScheduleEnabled && scheduleRouteMounted && (
        <WorkspaceLazyRoute
          active={scheduleRouteOpen}
          surfaceName="Event Schedule"
          component={EventScheduleView}
          onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
        >
          <EventScheduleView
            open={scheduleRouteOpen}
            onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
            organizationId={authSession.organizationId}
            role={authSession.role}
            staffLeads={scheduleStaffLeads}
            capacityLimit={scheduleCapacityLimit}
            currentUserEmail={authSession.user?.email || ""}
            onOpenIntegrations={integrationsEnabled
              ? () => navigateWorkspace(WORKSPACE_PATHS.integrations)
              : undefined}
          />
        </WorkspaceLazyRoute>
      )}

      {dashboardEnabled && reportingRouteMounted && (
        <WorkspaceLazyRoute
          active={reportingRouteOpen}
          surfaceName="Reporting Dashboard"
          component={ReportingDashboardView}
          onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
        >
          <ReportingDashboardView
            open={reportingRouteOpen}
            onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
            organizationId={authSession.organizationId}
            addons={catalog.addons}
          />
        </WorkspaceLazyRoute>
      )}

      {integrationsEnabled && integrationsRouteMounted && (
        <WorkspaceLazyRoute
          active={integrationsRouteOpen}
          surfaceName="Integrations Ops"
          component={IntegrationOpsView}
          onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
        >
          <IntegrationOpsView
            open={integrationsRouteOpen}
            onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
            organizationId={authSession.organizationId}
            settings={effectiveSettings}
            currentUserEmail={authSession.user?.email || ""}
            currentUserUid={authSession.user?.uid || ""}
            canProvisionCustomer={authSession.isAdmin && authSession.platformAdmin}
            canManageProviders={authSession.isAdmin}
          />
        </WorkspaceLazyRoute>
      )}

      {diagnosticsEnabled && diagnosticsRouteMounted && (
        <WorkspaceLazyRoute
          active={diagnosticsRouteOpen}
          surfaceName="Session Diagnostics"
          component={DiagnosticsView}
          onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
        >
          <DiagnosticsView
            open={diagnosticsRouteOpen}
            onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
          />
        </WorkspaceLazyRoute>
      )}

      {(browserRoute.routeId === WORKSPACE_ROUTE_IDS.NOT_FOUND
        || browserRoute.routeId === WORKSPACE_ROUTE_IDS.OUTSIDE
        || ([
          WORKSPACE_ROUTE_IDS.STAFF,
          WORKSPACE_ROUTE_IDS.INVENTORY,
          WORKSPACE_ROUTE_IDS.SCHEDULE,
          WORKSPACE_ROUTE_IDS.REPORTING,
          WORKSPACE_ROUTE_IDS.CATALOG,
          WORKSPACE_ROUTE_IDS.IMPORTS,
          WORKSPACE_ROUTE_IDS.INTEGRATIONS,
          WORKSPACE_ROUTE_IDS.DIAGNOSTICS
        ].includes(resolvedWorkspaceRouteId) && !routedToolAuthorized)
        || (!CUSTOMER_CENTERED_WORKSPACE_ENABLED && [
          WORKSPACE_ROUTE_IDS.STAFF,
          WORKSPACE_ROUTE_IDS.INVENTORY,
          WORKSPACE_ROUTE_IDS.CUSTOMER_LIST,
          WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL,
          WORKSPACE_ROUTE_IDS.MESSAGING
        ].includes(resolvedWorkspaceRouteId))) && (
        <WorkspaceLazyRoute surfaceName="Workspace page" component={WorkspaceNotFound}>
          <WorkspaceNotFound pathname={browserRoute.pathname} onHome={() => navigateWorkspace(WORKSPACE_PATHS.home)} />
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
        className={proposalComposerActive ? "container pc-shell" : "container wizard-grid"}
        ref={wizardRef}
        tabIndex={-1}
        hidden={!quoteBuilderActive || Boolean(quoteEditRouteId && !quoteEditReady)}
        aria-hidden={!quoteBuilderActive || Boolean(quoteEditRouteId && !quoteEditReady)}
      >
        {PILOT_COMMAND_ENABLED && (
          Boolean(editingQuote.id)
          || Object.keys(touchedFields).length > 0
          || draftRecoveryResumed
        ) && (
          <PilotCommandBar
            form={form}
            catalog={catalog}
            settings={effectiveSettings}
            styles={Object.keys(STAFF_RULES)}
            onStageProposal={stageChangeRequestProposal}
          />
        )}
        {PILOT_CREATE_ENABLED
          && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.QUOTE_NEW
          && !editingQuote.id && (
          <CreateIntake
            eventTypes={catalog.eventTypes || []}
            styles={Object.keys(STAFF_RULES)}
            onApplyDraft={applyIntentDraft}
            organizationId={authSession.organizationId}
            onModelParse={PILOT_MODEL_ENABLED ? parseIntentDraftWithModel : undefined}
          />
        )}
        {PILOT_CHANGE_REQUESTS_ENABLED
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
        {catalogReadNotice}
        {proposalComposerSurface}
        {!proposalComposerActive && (
        <>
        <section className="panel wizard-panel">
          {draftReviewSurfaces}
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
                {inventoryRecipeExtension.enabled && inventoryRecipeExtension.menuCostProjections.length > 0 && (
                  <Suspense fallback={<p role="status">Loading ingredient cost intelligence…</p>}>
                    <InventoryMenuCostSummary
                      projections={inventoryRecipeExtension.menuCostProjections}
                      sourceState={inventoryRecipeExtension.menuCostProjectionSourceState}
                      title="Menu ingredient cost"
                    />
                  </Suspense>
                )}
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
                {changeImpactSurface}
              </>
            )}
          </div>

          <div className="wizard-actions">
            <div className="right-actions">
              {PROPOSAL_COMPOSER_ENABLED && (
                <button className="ghost" onClick={() => setBuilderMode("composer")}>
                  Composer view
                </button>
              )}
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
                    {submitState.saving ? (isEditingQuote ? "Saving Changes..." : "Saving Draft...") : (isEditingQuote ? "Save Changes" : "Save draft")}
                  </button>
                </>
              )}
            </div>
          </div>

          {builderStatusNotes}
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
        </>
        )}
      </main>
      )}

      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.tone || "info"}`}>
              {toast.message}
            </div>
          ))}
        </div>
      )}

      {authSession.isAdmin && adminMounted && (
        <WorkspaceLazyTool
          open={catalogModalOpen}
          surfaceName="Catalog Admin"
          component={AdminCatalogModal}
          onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.CATALOG, setAdminOpen)}
          returnFocusRef={workspaceToolReturnFocusRef}
          hasUnsavedWorkspaceChanges={quoteDirty}
        >
          <AdminCatalogModal
            open={catalogModalOpen}
            catalog={catalog}
            organizationId={authSession.organizationId}
            onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.CATALOG, setAdminOpen)}
            returnFocusRef={workspaceToolReturnFocusRef}
            onSave={catalog.saveCatalog}
            onApplyStarterPack={catalog.stageStarterPack}
            onCatalogMutation={handleCatalogMutation}
            onReload={catalog.reload}
            saving={catalog.saving}
            initialTab={adminInitialTab}
            onToast={pushToast}
            onInteractionStateChange={setCatalogInteraction}
            inventoryRecipeExtension={inventoryRecipeExtension}
          />
        </WorkspaceLazyTool>
      )}

      {authSession.isAdmin && importStudioMounted && (
        <WorkspaceLazyTool
          open={importsModalOpen}
          surfaceName="Import Studio"
          component={ImportStudioModal}
          onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.IMPORTS, setImportStudioOpen)}
          returnFocusRef={workspaceToolReturnFocusRef}
          hasUnsavedWorkspaceChanges={quoteDirty}
        >
          <ImportStudioModal
            open={importsModalOpen}
            onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.IMPORTS, setImportStudioOpen)}
            returnFocusRef={workspaceToolReturnFocusRef}
            organizationId={authSession.organizationId}
            organizationName={workspaceName}
            currentUserUid={authSession.user?.uid || ""}
            currentUserEmail={authSession.user?.email || ""}
            catalogRevision={Math.max(0, Number(catalog.settings?.catalogRevision || 0))}
            onReload={() => catalog.reload({ background: true })}
            onImported={(result) => {
              catalog.reload({ background: true });
              if (result?.status === "rolled_back") {
                pushToast(`Import ${result.importBatchId} was undone.`, "info");
              } else {
                pushToast(`Imported ${result?.createdCount || 0} record(s) into ${authSession.organizationId}.`, "success");
              }
            }}
          />
        </WorkspaceLazyTool>
      )}

      {historyMounted && (
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
            focusQuoteId={browserRoute.params?.quoteId || historyTarget.quoteId}
            focusAction={historyTarget.action}
            focusReason={historyTarget.reason}
            onEditQuote={(quote) => {
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
            onOpenWorkflow={(target = {}) => navigateWorkspace(buildWorkflowPath(target))}
            onOpenConversation={CUSTOMER_CENTERED_WORKSPACE_ENABLED
              ? (quoteId) => navigateWorkspace(buildMessagingPath({ quoteId }))
              : undefined}
            onOpenIntegrations={() => {
              setHistoryTarget({ quoteId: "", reason: "" });
              navigateWorkspace(WORKSPACE_PATHS.integrations);
            }}
            integrationsAvailable={integrationsEnabled}
            canDeleteQuotes={authSession.isAdmin}
            onToast={pushToast}
          />
        </WorkspaceLazyRoute>
      )}

      {salesWorkflowMounted && (
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
                navigateWorkspace(buildMessagingPath({ quoteId }));
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
              navigateWorkspace(WORKSPACE_PATHS.quotes);
            }}
            onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
            onStartQuote={handleGetInstantQuote}
            organizationId={authSession.organizationId}
            currentUserEmail={authSession.user?.email || ""}
            currentUserRole={authSession.role}
            tenantTimeZone={tenantTimeZone}
            focusQuoteId={browserRoute.workflowFocus?.quoteId || ""}
            focusAttentionType={browserRoute.workflowFocus?.attentionType || ""}
            focusRequestId={browserRoute.workflowFocus?.requestId || ""}
            onEditQuote={(quote) => {
              handleEditQuote(quote);
            }}
            onAttentionSummaryChange={handleWorkflowAttentionSummary}
            onToast={pushToast}
          />
        </WorkspaceLazyRoute>
      )}

      {eventScheduleEnabled && scheduleMounted && (
        <WorkspaceLazyTool
          open={scheduleModalOpen}
          surfaceName="Event Schedule"
          component={EventScheduleModal}
          onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.SCHEDULE, setScheduleOpen)}
          returnFocusRef={workspaceToolReturnFocusRef}
          hasUnsavedWorkspaceChanges={quoteDirty}
        >
          <EventScheduleModal
            open={scheduleModalOpen}
            onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.SCHEDULE, setScheduleOpen)}
            returnFocusRef={workspaceToolReturnFocusRef}
            organizationId={authSession.organizationId}
            role={authSession.role}
            staffLeads={scheduleStaffLeads}
            capacityLimit={scheduleCapacityLimit}
            currentUserEmail={authSession.user?.email || ""}
            onOpenIntegrations={integrationsEnabled
              ? () => openRoutedWorkspaceTool(
                  WORKSPACE_PATHS.integrations,
                  setIntegrationsOpen,
                  { menuTriggerRef: operationsMenuTriggerRef }
                )
              : undefined}
          />
        </WorkspaceLazyTool>
      )}

      {integrationsEnabled && integrationsMounted && (
        <WorkspaceLazyTool
          open={integrationsModalOpen}
          surfaceName="Integrations Ops"
          component={IntegrationOpsModal}
          onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.INTEGRATIONS, setIntegrationsOpen)}
          returnFocusRef={workspaceToolReturnFocusRef}
          hasUnsavedWorkspaceChanges={quoteDirty}
        >
          <IntegrationOpsModal
            open={integrationsModalOpen}
            onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.INTEGRATIONS, setIntegrationsOpen)}
            returnFocusRef={workspaceToolReturnFocusRef}
            organizationId={authSession.organizationId}
            settings={effectiveSettings}
            currentUserEmail={authSession.user?.email || ""}
            currentUserUid={authSession.user?.uid || ""}
            canProvisionCustomer={authSession.isAdmin && authSession.platformAdmin}
            canManageProviders={authSession.isAdmin}
          />
        </WorkspaceLazyTool>
      )}

      {diagnosticsEnabled && diagnosticsMounted && (
        <WorkspaceLazyTool
          open={diagnosticsModalOpen}
          surfaceName="Session Diagnostics"
          component={DiagnosticsModal}
          onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.DIAGNOSTICS, setDiagnosticsOpen)}
          returnFocusRef={workspaceToolReturnFocusRef}
          hasUnsavedWorkspaceChanges={quoteDirty}
        >
          <DiagnosticsModal
            open={diagnosticsModalOpen}
            onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.DIAGNOSTICS, setDiagnosticsOpen)}
            returnFocusRef={workspaceToolReturnFocusRef}
          />
        </WorkspaceLazyTool>
      )}

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

      {dashboardEnabled && dashboardMounted && (
        <WorkspaceLazyTool
          open={reportingModalOpen}
          surfaceName="Reporting Dashboard"
          component={ReportingDashboardModal}
          onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.REPORTING, setDashboardOpen)}
          returnFocusRef={workspaceToolReturnFocusRef}
          hasUnsavedWorkspaceChanges={quoteDirty}
        >
          <ReportingDashboardModal
            open={reportingModalOpen}
            onClose={() => closeWorkspaceToolRoute(WORKSPACE_ROUTE_IDS.REPORTING, setDashboardOpen)}
            returnFocusRef={workspaceToolReturnFocusRef}
            organizationId={authSession.organizationId}
            addons={catalog.addons}
          />
        </WorkspaceLazyTool>
      )}
    </div>
  );
}

/**
 * Keep portal-token transitions fail-closed while the Ambient presentation is
 * disabled. WorkspaceRoute remounts organization context only after this
 * compatibility shell commits the exact public token (or clears it on return).
 */
export default function LegacyApp({
  portalRouteAllowed = true,
  committedPortalToken = "",
  onPortalScopeCommit,
  ...props
}) {
  const { route, location, replace } = useWorkspaceNavigation();
  const [pendingWork, setPendingWork] = useState({
    quoteDirty: false,
    catalogDirty: false,
    catalogBusy: false
  });
  const lastWorkspaceLocationRef = useRef(route.surface === "workspace" ? {
    destination: `${location.pathname}${location.search}${location.hash}`,
    state: location.state
  } : { destination: WORKSPACE_PATHS.home, state: null });

  useEffect(() => {
    if (portalRouteAllowed) {
      if (route.surface === "workspace") {
        lastWorkspaceLocationRef.current = {
          destination: `${location.pathname}${location.search}${location.hash}`,
          state: location.state
        };
      }
      return;
    }
    if (
      route.surface === "portal"
      && pendingWork.catalogBusy
    ) {
      const previous = lastWorkspaceLocationRef.current;
      replace(previous.destination, {
        state: previous.state,
        preserveSearch: false,
        preserveHash: false
      });
      return;
    }
    if (
      route.surface === "portal"
      && (pendingWork.quoteDirty || pendingWork.catalogDirty)
      && !window.confirm("Discard unsaved workspace changes and open the customer portal?")
    ) {
      const previous = lastWorkspaceLocationRef.current;
      replace(previous.destination, {
        state: previous.state,
        preserveSearch: false,
        preserveHash: false
      });
      return;
    }
    onPortalScopeCommit?.(route.surface === "portal" ? route.portalToken : "");
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    onPortalScopeCommit,
    pendingWork,
    portalRouteAllowed,
    replace,
    route.portalToken,
    route.surface
  ]);

  return (
    <LegacyAppCore
      {...props}
      committedPortalToken={committedPortalToken}
      portalTransitionAllowed={portalRouteAllowed}
      onPendingWorkChange={setPendingWork}
    />
  );
}
