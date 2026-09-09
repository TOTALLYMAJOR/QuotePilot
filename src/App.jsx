import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./ambientSurfaceGrammar.css";
import AuthGate from "./components/AuthGate";
import { RebookQuoteReviewBanner } from "./components/CustomerRebookDraftAction";
import LiveBreakdown from "./components/LiveBreakdown";
import ProposalComposer, { buildDraftSaveBlockers } from "./components/ProposalComposer";
import CatalogReadNotice from "./components/CatalogReadNotice";
import QuoteCatalogRevisionReviewPanel from "./components/QuoteCatalogRevisionReviewPanel";
import { buildMarginPresentation } from "./components/marginPresentation";
import ProductBrandLockup from "./components/ProductBrandLockup";
import WorkspaceActionFeedbackNotice, {
  buildWorkspaceActionFeedbackFollowUpIdentity,
  resolveWorkspaceActionFeedbackApprovalAction,
  resolveWorkspaceActionFeedbackFollowUpAction,
  workspaceActionFeedbackMatchesTaskJourney
} from "./components/WorkspaceActionFeedbackNotice";
import WorkspaceTaskJourneyNotice from "./components/WorkspaceTaskJourneyNotice";
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
import { useWorkspaceActionFeedback } from "./context/WorkspaceActionFeedbackContext";
import { DEFAULT_FEATURE_FLAGS, STAFF_RULES } from "./data/mockCatalog";
import { useCatalogData } from "./hooks/useCatalogData";
import { useCommercialWorkspaceSnapshot } from "./hooks/useCommercialWorkspaceSnapshot";
import { useInventoryRecipeExtension } from "./hooks/useInventoryRecipeExtension";
import {
  buildEventIngredientSelectionInputs,
  useEventIngredientProjection
} from "./hooks/useEventIngredientProjection";
import EventIngredientProjectionPanel from "./components/EventIngredientProjectionPanel";
import { buildCommercialInventoryConsequences } from "./lib/commercialInventoryConsequences";
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
import { requestPasswordReset } from "./lib/authClient";
import { firebaseReady } from "./lib/firebase";
import { isCatalogPricingConfirmationCurrent } from "./lib/catalogPricingConfirmation";
import { calculateQuote, currency } from "./lib/quoteCalculator";
import { buildUpsellRecommendations } from "./lib/recommendations";
import {
  catalogReconciliationNotice,
  reconcileCatalogSelections
} from "./lib/catalogSelectionReconciliation";
import { buildProposalReadiness } from "./lib/quoteWorkflow";
import {
  buildUnifiedCommercialConsequenceReview,
  buildUnifiedConsequenceProposedForm,
  unifiedConsequenceFenceCurrent
} from "./lib/unifiedCommercialConsequenceReview";
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
  buildEventLivePath,
  buildEventPath,
  buildEventReplayPath,
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
import {
  clearWorkspaceTaskJourney,
  createWorkspaceTaskJourney,
  readWorkspaceTaskJourney,
  transitionWorkspaceTaskContext,
  transitionWorkspaceTaskOutcome,
  WORKSPACE_APPROVAL_TASK_PROOF_TYPE,
  WORKSPACE_APPROVAL_TASK_VERIFIER_ID,
  WORKSPACE_FOLLOW_UP_TASK_PROOF_TYPE,
  WORKSPACE_FOLLOW_UP_TASK_VERIFIER_ID,
  workspaceTaskJourneyBelongsToPrincipal,
  workspaceTaskJourneyMatchesArrival,
  writeWorkspaceTaskJourney
} from "./lib/workspaceTaskJourney";
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
const EVENT_OPERATING_SPINE_UI_ENABLED = import.meta.env.VITE_EVENT_OPERATING_SPINE_ENABLED === "true";
const OPERATIONAL_STAFFING_UI_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_OPERATIONAL_STAFFING_ENABLED || "").trim().toLowerCase()
);
const INVENTORY_AUTHORITY_UI_ENABLED = import.meta.env.VITE_INVENTORY_AUTHORITY_ENABLED === "true";
const AdminCatalogView = createRecoverableLazy(
  () => import("./components/AdminCatalogModal").then((module) => ({ default: module.AdminCatalogView })),
  "AdminCatalogView"
);
const CustomerPortalView = createRecoverableLazy(
  () => import("quotepilot-active-customer-portal"),
  "CustomerPortalView"
);
const CommandCenterHome = AMBIENT_UI_ENABLED
  ? null
  : createRecoverableLazy(
      () => import("./components/CommandCenterHome"),
      "CommandCenterHome"
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
const EventPlanningView = createRecoverableLazy(
  () => import("./components/LiveOperationsPlanningViews").then((module) => ({ default: module.EventPlanningView })),
  "EventPlanningView"
);
const ClearDeckView = createRecoverableLazy(
  () => import("./components/LiveOperationsPlanningViews").then((module) => ({ default: module.ClearDeckView })),
  "ClearDeckView"
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
const InventoryWorkspace = createRecoverableLazy(
  () => import("./components/InventoryWorkspace"),
  "InventoryWorkspace"
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
// The Proposal Composer is the default presentation of the quote builder
// (docs/PROPOSAL_COMPOSER_PLAN.md). Explicit 0/false/no/off restores the
// wizard-first presentation. Either way the wizard remains available as
// Guided mode, both write the same draft form, and the save path keeps its
// existing authority (server pricing, versioning) unchanged.
const PROPOSAL_COMPOSER_ENABLED = !["0", "false", "no", "off"].includes(
  String(import.meta.env.VITE_PROPOSAL_COMPOSER_ENABLED || "").trim().toLowerCase()
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
  pricingCatalogAuthority: null,
  catalogRevisionReview: null,
  selection: {},
  baseForm: null,
  rebooking: null,
  commercialAmendment: null
});

const EMPTY_CATALOG_REVISION_REVIEW = Object.freeze({
  loading: false,
  submitting: false,
  error: "",
  review: null,
  outcome: "",
  receipt: null
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
  appliedQuote: null
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
  const requestedObject = options?.arrivalContext?.object || {};
  const exactConversationObject = requestedObject.type === "customer-communication-evidence"
    && String(requestedObject.id || "").trim() === normalizedQuoteId;
  return {
    destination: "messages",
    object: messageId
      ? { id: messageId, type: "customer-communication-evidence" }
      : exactConversationObject
        ? { id: normalizedQuoteId, type: "customer-communication-evidence" }
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

function ambientQuoteAdministrationArrivalInput(quoteId, context = {}) {
  const normalizedQuoteId = String(quoteId || "").trim();
  const sourceObjectType = String(context?.object?.type || "").trim();
  const proposal = sourceObjectType === "customer-decision-artifact";
  const payment = sourceObjectType === "commercial-evidence";
  return {
    destination: "administration",
    object: {
      id: normalizedQuoteId,
      type: proposal
        ? "customer-decision-artifact"
        : payment
          ? "payment-evidence"
          : "opportunity"
    },
    focus: { quoteId: normalizedQuoteId },
    intentId: proposal
      ? "review_proposal_controls"
      : payment
        ? "review_payment_controls"
        : "review_quote_controls"
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

function ambientTaskActionId(target = {}, options = {}) {
  return String(
    target?.actionId
    || options?.actionId
    || options?.arrivalContext?.actionId
    || ""
  ).trim();
}

function workspaceTaskPrincipal(authSession = {}) {
  return {
    id: String(authSession.user?.uid || "").trim(),
    role: String(authSession.role || "").trim().toLowerCase()
  };
}

const WORKSPACE_TASK_DESTINATION_ROUTE = Object.freeze({
  client: WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL,
  opportunity: WORKSPACE_ROUTE_IDS.QUOTE_DETAIL,
  administration: WORKSPACE_ROUTE_IDS.QUOTE_LIST,
  workflow: WORKSPACE_ROUTE_IDS.WORKFLOW,
  approval: WORKSPACE_ROUTE_IDS.WORKFLOW,
  messages: WORKSPACE_ROUTE_IDS.MESSAGING,
  schedule: WORKSPACE_ROUTE_IDS.SCHEDULE,
  reporting: WORKSPACE_ROUTE_IDS.REPORTING,
  library: WORKSPACE_ROUTE_IDS.CATALOG
});

/**
 * Applies an exact Workflow task outcome against the latest principal-bound
 * session record. Feedback-owned reconciliation may resolve independently
 * only when it does not own that active task; an exact matching task must
 * transition and persist before the UI may report it completed.
 */
export function applyWorkspaceTaskOutcome({
  outcome,
  currentTaskSession,
  feedbackIdentity = null,
  readTaskJourney = readWorkspaceTaskJourney,
  persistTaskJourney,
  requestAttentionRefresh = () => {},
  clearFeedbackReconciliation = () => {}
} = {}) {
  if (!outcome || typeof outcome !== "object") {
    return { status: "ignored" };
  }
  if (!currentTaskSession?.organizationId) return { status: "ignored" };
  const currentStoredTask = readTaskJourney(currentTaskSession.organizationId);
  const currentWorkspaceTaskJourney = currentStoredTask.ok
    && workspaceTaskJourneyBelongsToPrincipal(
      currentStoredTask.journey,
      currentTaskSession.principal
    )
    ? currentStoredTask.journey
    : null;
  const outcomeFocus = outcome.focus && typeof outcome.focus === "object"
    ? outcome.focus
    : null;
  const phase = outcome.phase;
  const proof = outcome.proof;
  const approvalOutcome = outcomeFocus?.attentionType === "approval";
  const exactOutcomeArrival = outcomeFocus ? approvalOutcome
    ? {
        destination: "approval",
        object: {
          id: outcomeFocus.requestId,
          type: "approval"
        },
        focus: {
          quoteId: outcomeFocus.quoteId,
          requestId: outcomeFocus.requestId
        },
        intentId: "review_approval"
      }
    : {
        destination: "workflow",
        object: {
          id: outcomeFocus.requestId,
          type: "workflow-item"
        },
        focus: outcomeFocus,
        intentId: "review_follow_up"
      } : null;
  const proofIsFollowUpConfirmation = phase === "resolved"
    && proof
    && Object.keys(proof).length === 3
    && proof.verifierId === WORKSPACE_FOLLOW_UP_TASK_VERIFIER_ID
    && /^follow-up-completed:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
      String(proof.proofId || "")
    )
    && proof.proofType === WORKSPACE_FOLLOW_UP_TASK_PROOF_TYPE;
  const proofIsApprovalConfirmation = phase === "resolved"
    && approvalOutcome
    && proof
    && Object.keys(proof).length === 3
    && proof.verifierId === WORKSPACE_APPROVAL_TASK_VERIFIER_ID
    && (() => {
      const prefix = `approval-resolved:${String(outcomeFocus?.requestId || "").trim()}:`;
      const proofId = String(proof.proofId || "");
      return proofId.startsWith(prefix)
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(proofId.slice(prefix.length));
    })()
    && proof.proofType === WORKSPACE_APPROVAL_TASK_PROOF_TYPE;
  const proofIsAuthoritativeConfirmation = approvalOutcome
    ? proofIsApprovalConfirmation
    : proofIsFollowUpConfirmation;
  const proofIsAbsentForOpenOutcome = ["uncertain", "superseded"].includes(phase)
    && proof === null;
  const exactFeedbackOwnedOutcome = Boolean(
    feedbackIdentity
    && Object.keys(outcome).length === 6
    && Object.keys(outcomeFocus || {}).length === 3
    && outcome.organizationId === currentTaskSession.organizationId
    && outcome.taskId === feedbackIdentity.taskId
    && outcome.startedAtISO === feedbackIdentity.startedAtISO
    && exactOutcomeArrival
    && exactOutcomeArrival.destination === feedbackIdentity.destination
    && exactOutcomeArrival.intentId === feedbackIdentity.intentId
    && exactOutcomeArrival.object.id === feedbackIdentity.object.id
    && exactOutcomeArrival.object.type === feedbackIdentity.object.type
    && outcomeFocus.quoteId === feedbackIdentity.focus.quoteId
    && outcomeFocus.attentionType === feedbackIdentity.focus.attentionType
    && outcomeFocus.requestId === feedbackIdentity.focus.requestId
    && !approvalOutcome
    && (proofIsAuthoritativeConfirmation || proofIsAbsentForOpenOutcome)
  );
  const feedbackIdentityMatchesCurrentTask = Boolean(
    exactFeedbackOwnedOutcome
    && currentWorkspaceTaskJourney
    && currentWorkspaceTaskJourney.taskId === feedbackIdentity.taskId
    && currentWorkspaceTaskJourney.startedAtISO === feedbackIdentity.startedAtISO
    && workspaceTaskJourneyMatchesArrival(
      currentWorkspaceTaskJourney,
      exactOutcomeArrival
    )
  );
  if (exactFeedbackOwnedOutcome && !feedbackIdentityMatchesCurrentTask) {
    if (phase === "resolved") {
      requestAttentionRefresh({ force: true });
      clearFeedbackReconciliation();
    }
    return { status: phase, taskState: "independent" };
  }
  if (!currentWorkspaceTaskJourney) {
    if (!feedbackIdentity) return { status: "ignored" };
    return {
      status: "recovery",
      reason: "The reconciliation outcome did not match the exact returned follow-up.",
      consequence: "No task record was restored or changed.",
      nextResolution: "Keep the returned follow-up open and reconcile only its exact record."
    };
  }

  const exactOutcome = (
    Object.keys(outcome).length === 6
    && outcome.organizationId === currentWorkspaceTaskJourney.organizationId
    && outcome.organizationId === currentTaskSession.organizationId
    && outcome.taskId === currentWorkspaceTaskJourney.taskId
    && outcome.startedAtISO === currentWorkspaceTaskJourney.startedAtISO
    && currentWorkspaceTaskJourney.intentId === exactOutcomeArrival?.intentId
    && currentWorkspaceTaskJourney.destination === exactOutcomeArrival?.destination
    && exactOutcomeArrival
    && workspaceTaskJourneyMatchesArrival(
      currentWorkspaceTaskJourney,
      exactOutcomeArrival
    )
    && (proofIsAuthoritativeConfirmation || proofIsAbsentForOpenOutcome)
  );
  if (!exactOutcome) {
    return {
      status: "recovery",
      reason: "The task outcome did not match the exact active follow-up.",
      consequence: "Task tracking remains unchanged.",
      nextResolution: "Return to the exact follow-up and confirm it again without repeating the write."
    };
  }
  if (
    phase === "uncertain"
    && currentWorkspaceTaskJourney.phase === "uncertain"
  ) {
    return { status: "uncertain", taskState: "retained" };
  }

  const transitioned = transitionWorkspaceTaskOutcome(
    currentWorkspaceTaskJourney,
    phase === "resolved" ? { phase, proof } : { phase }
  );
  if (!transitioned.ok) {
    return {
      status: "recovery",
      reason: "The task outcome could not be retained.",
      consequence: "The business record was not retried.",
      nextResolution: "Keep the exact task attached and reconcile its current record.",
      ...transitioned.recovery
    };
  }
  const stored = typeof persistTaskJourney === "function"
    ? persistTaskJourney(transitioned.journey)
    : { ok: false, recovery: { code: "storage_unavailable" } };
  if (!stored.ok) {
    return {
      status: "recovery",
      reason: approvalOutcome
        ? "The approval outcome is recorded, but this device could not retain its task status."
        : "The follow-up outcome is recorded, but this device could not retain its task status.",
      consequence: "The confirmed business record was not retried.",
      nextResolution: approvalOutcome
        ? "Inspect the exact approval before taking another action."
        : "Inspect the exact follow-up before changing it again.",
      ...stored.recovery
    };
  }
  if (["resolved", "superseded"].includes(phase)) {
    requestAttentionRefresh({ force: true });
    if (feedbackIdentityMatchesCurrentTask) clearFeedbackReconciliation();
  }
  return { status: phase, taskState: "persisted" };
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
    replace,
    setHistoryTraversalGuard,
    setReturnContextScope,
    returnToOrigin,
    returnContextStatus
  } = useWorkspaceNavigation();
  const {
    currentFeedback: currentWorkspaceActionFeedback,
    acknowledgeActionFeedback
  } = useWorkspaceActionFeedback();
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
  const [
    workspaceActionFeedbackReconciliationContext,
    setWorkspaceActionFeedbackReconciliationContext
  ] = useState(null);
  const activeWorkspaceTaskPrincipal = workspaceTaskPrincipal(authSession);
  useEffect(() => {
    setWorkspaceActionFeedbackReconciliationContext(null);
    setReturnContextScope?.({
      organizationId: authSession.organizationId,
      principalId: authSession.user?.uid,
      role: authSession.role
    });
    return () => setReturnContextScope?.(null);
  }, [
    authSession.organizationId,
    authSession.role,
    authSession.user?.uid,
    setReturnContextScope
  ]);
  const currentWorkspaceTaskSessionRef = useRef(null);
  currentWorkspaceTaskSessionRef.current = {
    organizationId: String(authSession.organizationId || "").trim(),
    principal: activeWorkspaceTaskPrincipal
  };
  const [workspaceTaskJourney, setWorkspaceTaskJourney] = useState(() => {
    if (!AMBIENT_UI_ENABLED) return null;
    const stored = readWorkspaceTaskJourney(authSession.organizationId);
    const principal = workspaceTaskPrincipal(authSession);
    return stored.ok && workspaceTaskJourneyBelongsToPrincipal(stored.journey, principal)
      ? stored.journey
      : null;
  });
  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((message, tone = "info") => {
    const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3600);
  }, []);
  const activeWorkspaceTaskJourney = workspaceTaskJourney?.organizationId
    === String(authSession.organizationId || "").trim()
    && workspaceTaskJourneyBelongsToPrincipal(workspaceTaskJourney, activeWorkspaceTaskPrincipal)
    ? workspaceTaskJourney
    : null;
  const [catalogRouteInteraction, setCatalogRouteInteraction] = useState(EMPTY_LIBRARY_INTERACTION);
  const [catalogModalInteraction, setCatalogModalInteraction] = useState(EMPTY_LIBRARY_INTERACTION);
  const [libraryContextualOrigin, setLibraryContextualOrigin] = useState(null);
  useEffect(() => {
    setLibraryContextualOrigin(null);
  }, [authSession.organizationId, authSession.role, authSession.user?.uid]);
  const handleQuickUpdatesGuardChange = useCallback((guard = null) => {
    if (typeof setHistoryTraversalGuard === "function") {
      setHistoryTraversalGuard(guard, "quick-updates");
    }
  }, [setHistoryTraversalGuard]);
  const handleWorkspaceToolsGuardChange = useCallback((guard = null) => {
    if (typeof setHistoryTraversalGuard === "function") {
      setHistoryTraversalGuard(guard, "workspace-tools");
    }
  }, [setHistoryTraversalGuard]);
  useEffect(() => () => {
    if (typeof setHistoryTraversalGuard === "function") {
      setHistoryTraversalGuard(null, "quick-updates");
      setHistoryTraversalGuard(null, "workspace-tools");
    }
  }, [setHistoryTraversalGuard]);
  const ambientLibraryInteraction = useMemo(() => ({
    dirty: catalogRouteInteraction.dirty || catalogModalInteraction.dirty,
    busy: catalogRouteInteraction.busy || catalogModalInteraction.busy
  }), [catalogRouteInteraction, catalogModalInteraction]);
  const workspaceArrivalKey = workspaceArrivalAttempted
      ? workspaceArrivalContext ? JSON.stringify([
        "arrival",
        workspaceArrivalContext.destination,
        workspaceArrivalContext.routeId,
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
      ]) : JSON.stringify([
        "recovery",
        browserLocation.pathname,
        browserLocation.search,
        workspaceArrivalHandoff?.recovery?.code || "invalid_input"
      ])
    : "";
  useEffect(() => {
    if (workspaceArrivalContext) {
      setWorkspaceArrivalResolution({ arrivalKey: workspaceArrivalKey, status: "pending" });
      return;
    }
    if (workspaceArrivalAttempted && workspaceArrivalHandoff?.recovery) {
      setWorkspaceArrivalResolution({
        arrivalKey: workspaceArrivalKey,
        status: "recovery",
        ...workspaceArrivalHandoff.recovery
      });
      return;
    }
    setWorkspaceArrivalResolution(null);
  }, [workspaceArrivalKey]);
  const handleWorkspaceArrivalResolution = useCallback((resolution) => {
    if (!workspaceArrivalKey || !resolution || typeof resolution !== "object") return;
    setWorkspaceArrivalResolution({ ...resolution, arrivalKey: workspaceArrivalKey });
  }, [workspaceArrivalKey]);
  useEffect(() => {
    if (!AMBIENT_UI_ENABLED) return;
    const stored = readWorkspaceTaskJourney(authSession.organizationId);
    if (
      stored.ok
      && stored.journey
      && !workspaceTaskJourneyBelongsToPrincipal(stored.journey, activeWorkspaceTaskPrincipal)
    ) {
      clearWorkspaceTaskJourney(authSession.organizationId);
    }
    setWorkspaceTaskJourney(
      stored.ok && workspaceTaskJourneyBelongsToPrincipal(stored.journey, activeWorkspaceTaskPrincipal)
        ? stored.journey
        : null
    );
  }, [
    activeWorkspaceTaskPrincipal.id,
    activeWorkspaceTaskPrincipal.role,
    authSession.organizationId
  ]);
  const persistWorkspaceTaskJourney = useCallback((journey) => {
    const stored = writeWorkspaceTaskJourney(authSession.organizationId, journey);
    if (stored.ok) setWorkspaceTaskJourney(stored.journey);
    return stored;
  }, [authSession.organizationId]);
  const beginWorkspaceTaskJourney = useCallback((handoff, actionId) => {
    const taskId = String(actionId || "").trim();
    if (!taskId) return { ok: true, journey: null };
    const started = createWorkspaceTaskJourney({
      organizationId: authSession.organizationId,
      principal: activeWorkspaceTaskPrincipal,
      taskId,
      startedAtISO: new Date().toISOString(),
      origin: {
        routeId: browserRoute.routeId,
        pathname: browserRoute.pathname
      },
      destination: handoff.contract.destination,
      object: {
        id: handoff.contract.object.id,
        type: handoff.contract.object.type
      },
      focus: handoff.contract.destination === "approval"
        ? {
            quoteId: handoff.contract.focus.quoteId,
            requestId: handoff.contract.focus.requestId
          }
        : handoff.contract.focus,
      intentId: handoff.contract.intentId
    });
    if (!started.ok) return started;
    return persistWorkspaceTaskJourney(started.journey);
  }, [
    authSession.organizationId,
    activeWorkspaceTaskPrincipal.id,
    activeWorkspaceTaskPrincipal.role,
    browserRoute.pathname,
    browserRoute.routeId,
    persistWorkspaceTaskJourney
  ]);
  useEffect(() => {
    if (!activeWorkspaceTaskJourney) return;
    const destinationRouteId = WORKSPACE_TASK_DESTINATION_ROUTE[
      activeWorkspaceTaskJourney.destination
    ];
    if (browserRoute.routeId !== destinationRouteId) return;

    let contextState = "recovery";
    if (
      workspaceArrivalAttempted
      && workspaceTaskJourneyMatchesArrival(activeWorkspaceTaskJourney, workspaceArrivalContext)
    ) {
      const exactResolution = workspaceArrivalResolution?.arrivalKey === workspaceArrivalKey
        ? workspaceArrivalResolution
        : null;
      contextState = exactResolution?.status === "resolved"
        ? "ready"
        : exactResolution?.status === "recovery"
          ? "recovery"
          : "locating";
    }
    const transitioned = transitionWorkspaceTaskContext(
      activeWorkspaceTaskJourney,
      contextState
    );
    if (
      transitioned.ok
      && transitioned.journey.contextState !== activeWorkspaceTaskJourney.contextState
    ) {
      persistWorkspaceTaskJourney(transitioned.journey);
    }
  }, [
    activeWorkspaceTaskJourney,
    browserRoute.routeId,
    persistWorkspaceTaskJourney,
    workspaceArrivalAttempted,
    workspaceArrivalContext,
    workspaceArrivalKey,
    workspaceArrivalResolution
  ]);
  useEffect(() => {
    const contextualLibrary = workspaceArrivalContext?.surfaceId === "ambient-library"
      && workspaceArrivalContext?.intentId === "browse_library";
    const quoteId = contextualLibrary
      ? String(workspaceArrivalContext?.focus?.quoteId || "").trim()
      : "";
    const organizationId = String(authSession.organizationId || "").trim();
    const requestedOrganizationId = String(workspaceArrivalContext?.object?.id || "").trim();
    if (!quoteId || !organizationId || requestedOrganizationId !== organizationId) {
      setLibraryContextualOrigin(null);
      return undefined;
    }

    const sectionId = String(workspaceArrivalContext?.focus?.sectionId || "overview").trim() || "overview";
    let cancelled = false;
    setLibraryContextualOrigin((current) => current?.quoteId === quoteId
      ? current
      : {
          quoteId,
          organizationId,
          label: "opportunity",
          sectionId,
          returnLabel: "Return to opportunity"
        });

    void getQuoteById(quoteId)
      .then((quote) => {
        if (cancelled) return;
        const quoteOrganizationId = String(quote?.organizationId || organizationId).trim();
        if (!quote?.id || quoteOrganizationId !== organizationId) return;
        const label = String(
          quote.event?.name || quote.quoteNumber || "opportunity"
        ).trim() || "opportunity";
        setLibraryContextualOrigin({
          quoteId,
          organizationId,
          label,
          sectionId,
          returnLabel: label === "opportunity" ? "Return to opportunity" : `Return to ${label}`
        });
      })
      .catch(() => {
        // The exact route-state identity is sufficient for a safe return. A
        // failed label refresh must not erase that contextual navigation.
      });
    return () => {
      cancelled = true;
    };
  }, [
    authSession.organizationId,
    workspaceArrivalContext?.focus?.quoteId,
    workspaceArrivalContext?.focus?.sectionId,
    workspaceArrivalContext?.intentId,
    workspaceArrivalContext?.object?.id,
    workspaceArrivalContext?.surfaceId
  ]);
  const navigateWorkspace = useCallback((destination, options = {}) => {
    const {
      bypassQuickUpdatesGuard = false,
      quickUpdatesReason = "navigation",
      beforeCommit = null,
      ...navigationOptions
    } = options;
    return navigate(destination, {
      ...navigationOptions,
      preserveSearch: false,
      beforeNavigationCommit: beforeCommit,
      historyGuardReason: quickUpdatesReason,
      skipHistoryGuard: bypassQuickUpdatesGuard
    });
  }, [navigate]);
  const returnToWorkspaceOrigin = useCallback((fallback, options = {}) => {
    if (typeof returnToOrigin === "function") {
      return returnToOrigin({ fallback, ...options });
    }
    return navigateWorkspace(fallback);
  }, [navigateWorkspace, returnToOrigin]);
  const navigateAmbientTaskHandoff = useCallback((handoff, actionId, options = {}) => {
    let startedTask = null;
    const navigationResult = navigateWorkspace(handoff.navigation.path, {
      state: handoff.navigation.state,
      preserveReturnContext: Boolean(options.preserveReturnContext),
      returnContextSurfaceId: options.returnContextSurfaceId || handoff.contract.surfaceId,
      returnContextHint: options.returnContextHint || null,
      returnContextDestination: options.returnContextDestination || null,
      beforeCommit: () => {
        startedTask = beginWorkspaceTaskJourney(handoff, actionId);
        if (!startedTask.ok) {
          pushToast(
            "Opening the exact context, but task tracking is unavailable in this session. No record changed.",
            "warning"
          );
          return null;
        }
        return startedTask;
      }
    });
    if (["blocked", "guarded"].includes(navigationResult?.status)) {
      return {
        status: navigationResult.status,
        contract: handoff.contract,
        taskJourney: null
      };
    }
    return {
      status: "pending",
      contract: handoff.contract,
      taskJourney: startedTask?.journey || null
    };
  }, [beginWorkspaceTaskJourney, navigateWorkspace, pushToast]);
  const navigateAmbientWorkflow = useCallback((target = {}, options = {}) => {
    if (!AMBIENT_UI_ENABLED) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff(ambientWorkflowArrivalInput(target, options));
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    return navigateAmbientTaskHandoff(
      handoff,
      ambientTaskActionId(target, options),
      options
    );
  }, [navigateAmbientTaskHandoff]);
  const navigateAmbientConversation = useCallback((quoteId, options = {}) => {
    if (!AMBIENT_UI_ENABLED) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff(
      ambientConversationArrivalInput(quoteId, options)
    );
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    return navigateAmbientTaskHandoff(handoff, ambientTaskActionId({}, options));
  }, [navigateAmbientTaskHandoff]);
  const navigateAmbientCalendar = useCallback((quoteId, options = {}) => {
    const normalizedQuoteId = String(quoteId || "").trim();
    if (!AMBIENT_UI_ENABLED || !normalizedQuoteId) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff({
      destination: "schedule",
      object: { id: normalizedQuoteId, type: "opportunity" },
      focus: { quoteId: normalizedQuoteId },
      intentId: options.intentId === "review_schedule_conflict"
        ? "review_schedule_conflict"
        : "review_event_schedule"
    });
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    return navigateAmbientTaskHandoff(handoff, options.actionId || `open-calendar:${normalizedQuoteId}`);
  }, [navigateAmbientTaskHandoff]);
  const navigateAmbientOpportunity = useCallback((target = {}) => {
    if (!AMBIENT_UI_ENABLED) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff(ambientOpportunityArrivalInput(target));
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    return navigateAmbientTaskHandoff(handoff, ambientTaskActionId(target), {
      preserveReturnContext: true,
      returnContextSurfaceId: "living-opportunity",
      returnContextHint: {
        focus: {
          kind: browserRoute.routeId === WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL
            ? "client-overview-action"
            : "opportunity-action",
          objectId: handoff.contract.focus.quoteId,
          actionId: ambientTaskActionId(target),
          controlId: String(target.returnFocusControlId || "").trim()
        }
      }
    });
  }, [browserRoute.routeId, navigateAmbientTaskHandoff]);
  const navigateAmbientQuoteAdministration = useCallback((quoteId, context = {}) => {
    if (!AMBIENT_UI_ENABLED) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff(
      ambientQuoteAdministrationArrivalInput(quoteId, context)
    );
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    return navigateAmbientTaskHandoff(handoff, ambientTaskActionId(context));
  }, [navigateAmbientTaskHandoff]);
  const navigateAmbientClient = useCallback((target = {}) => {
    if (!AMBIENT_UI_ENABLED) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff(ambientClientArrivalInput(target));
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    return navigateAmbientTaskHandoff(handoff, ambientTaskActionId(target), {
      preserveReturnContext: true,
      returnContextSurfaceId: "client-overview",
      returnContextHint: {
        focus: {
          kind: "client-action",
          objectId: handoff.contract.focus.customerId,
          actionId: ambientTaskActionId(target)
        }
      }
    });
  }, [navigateAmbientTaskHandoff]);
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
  const resolvedWorkspaceRouteId = !CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && browserRoute.routeId === WORKSPACE_ROUTE_IDS.HOME
    ? WORKSPACE_ROUTE_IDS.QUOTE_NEW
    : browserRoute.routeId;
  const historyOpen = [WORKSPACE_ROUTE_IDS.QUOTE_LIST, WORKSPACE_ROUTE_IDS.QUOTE_DETAIL]
    .includes(resolvedWorkspaceRouteId);
  const quoteAdministrationArrival = workspaceArrivalContext?.surfaceId === "quote-administration"
    ? workspaceArrivalContext
    : null;
  const historyFocusQuoteId = browserRoute.params?.quoteId
    || quoteAdministrationArrival?.focus?.quoteId
    || historyTarget.quoteId;
  const historyFocusAction = quoteAdministrationArrival
    ? "administration"
    : historyTarget.quoteId && historyTarget.quoteId === historyFocusQuoteId
      ? historyTarget.action
      : "";
  const historyFocusReason = quoteAdministrationArrival?.reasonId
    || (historyTarget.quoteId && historyTarget.quoteId === historyFocusQuoteId
      ? historyTarget.reason
      : "");
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
  const inventoryRouteOpen = shellRouteOpen(WORKSPACE_ROUTE_IDS.INVENTORY);
  const diagnosticsRouteOpen = shellRouteOpen(WORKSPACE_ROUTE_IDS.DIAGNOSTICS);
  const scheduleModalOpen = shellModalOpen(scheduleOpen, WORKSPACE_ROUTE_IDS.SCHEDULE);
  const reportingModalOpen = shellModalOpen(dashboardOpen, WORKSPACE_ROUTE_IDS.REPORTING);
  const integrationsModalOpen = shellModalOpen(integrationsOpen, WORKSPACE_ROUTE_IDS.INTEGRATIONS);
  const importsModalOpen = shellModalOpen(importStudioOpen, WORKSPACE_ROUTE_IDS.IMPORTS);
  const catalogModalOpen = shellModalOpen(adminOpen, WORKSPACE_ROUTE_IDS.CATALOG);
  const diagnosticsModalOpen = shellModalOpen(diagnosticsOpen, WORKSPACE_ROUTE_IDS.DIAGNOSTICS);
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
    const workspaceToolsTransition = existingDialog?.id === "workspace-tools-dialog"
      && returnTarget?.matches?.(".workspace-tools-trigger");
    if (existingDialog && !workspaceToolsTransition) return;
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
      navigateWorkspace(path, { beforeCommit: beforeOpen });
      return;
    }
    openWorkspaceTool(setOpen, { menuTriggerRef, beforeOpen });
  };
  const commercialSnapshot = useCommercialWorkspaceSnapshot({
    enabled: Boolean(authSession.isStaff && authSession.organizationId),
    includeHistory: CUSTOMER_CENTERED_WORKSPACE_ENABLED,
    includeRevenueAttention: CUSTOMER_CENTERED_WORKSPACE_ENABLED && firebaseReady,
    includeDecisionDebt: CUSTOMER_CENTERED_WORKSPACE_ENABLED
      && firebaseReady
      && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CLEAR_DECK,
    tenantTimeZone: String(catalog.settings?.businessTimeZone || "").trim(),
    organizationId: authSession.organizationId
  });
  const workflowAttentionCount = commercialSnapshot.attentionSummary?.quoteCount ?? null;
  const requestWorkflowAttentionRefresh = commercialSnapshot.refresh;
  const handleWorkflowAttentionSummary = useCallback((summary) => {
    if (String(summary?.organizationId || "").trim() !== String(authSession.organizationId || "").trim()) return;
    commercialSnapshot.refresh({ force: true });
  }, [authSession.organizationId, commercialSnapshot.refresh]);
  const handleWorkspaceTaskOutcome = useCallback((outcome) => {
    const currentTaskSession = currentWorkspaceTaskSessionRef.current;
    const feedbackIdentity = workspaceActionFeedbackReconciliationContext?.identity;
    return applyWorkspaceTaskOutcome({
      outcome,
      currentTaskSession,
      feedbackIdentity,
      persistTaskJourney: persistWorkspaceTaskJourney,
      requestAttentionRefresh: requestWorkflowAttentionRefresh,
      clearFeedbackReconciliation: () => (
        setWorkspaceActionFeedbackReconciliationContext(null)
      )
    });
  }, [
    persistWorkspaceTaskJourney,
    requestWorkflowAttentionRefresh,
    workspaceActionFeedbackReconciliationContext
  ]);
  const adminMounted = useStickyMount(catalogModalOpen);
  const scheduleMounted = useStickyMount(scheduleModalOpen);
  const integrationsMounted = useStickyMount(integrationsModalOpen);
  const importStudioMounted = useStickyMount(importsModalOpen);
  const diagnosticsMounted = useStickyMount(diagnosticsModalOpen);
  const historyMounted = useStickyMount(historyOpen);
  const dashboardMounted = useStickyMount(reportingModalOpen);
  const catalogRouteMounted = useStickyMount(catalogRouteOpen);
  const staffRouteMounted = useStickyMount(staffRouteOpen);
  const inventoryRouteMounted = useStickyMount(inventoryRouteOpen);
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
  const [catalogRevisionReview, setCatalogRevisionReview] = useState(EMPTY_CATALOG_REVISION_REVIEW);
  const [quoteEditLoadState, setQuoteEditLoadState] = useState({
    quoteId: "",
    loading: false,
    error: ""
  });
  const [quoteEditRetryToken, setQuoteEditRetryToken] = useState(0);
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

  const loadQuoteCatalogRevisionReview = useCallback(async () => {
    const organizationId = String(authSession.organizationId || "").trim();
    const quoteId = String(editingQuote.id || "").trim();
    if (!organizationId || !quoteId) {
      setCatalogRevisionReview(EMPTY_CATALOG_REVISION_REVIEW);
      return;
    }
    setCatalogRevisionReview((current) => ({
      ...current,
      loading: true,
      error: ""
    }));
    try {
      const { getQuoteCatalogRevisionReview } = await import("./lib/quoteCatalogRevisionReview");
      const result = await getQuoteCatalogRevisionReview({ organizationId, quoteId });
      setCatalogRevisionReview({
        loading: false,
        submitting: false,
        error: "",
        review: result.review,
        outcome: "",
        receipt: null
      });
    } catch (error) {
      setCatalogRevisionReview({
        loading: false,
        submitting: false,
        error: error?.message || "Catalog revision review is unavailable.",
        review: null,
        outcome: "",
        receipt: null
      });
    }
  }, [authSession.organizationId, editingQuote.activeVersionId, editingQuote.id]);

  useEffect(() => {
    void loadQuoteCatalogRevisionReview();
  }, [catalog.authoritativeVersion, loadQuoteCatalogRevisionReview]);

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

  const continueWorkspaceTaskJourney = useCallback(() => {
    if (!activeWorkspaceTaskJourney) return { status: "recovery" };
    const handoff = createWorkspaceArrivalHandoff({
      destination: activeWorkspaceTaskJourney.destination,
      object: activeWorkspaceTaskJourney.object,
      focus: activeWorkspaceTaskJourney.focus,
      intentId: activeWorkspaceTaskJourney.intentId
    });
    if (!handoff.ok) {
      const recovery = transitionWorkspaceTaskContext(activeWorkspaceTaskJourney, "recovery");
      if (recovery.ok) persistWorkspaceTaskJourney(recovery.journey);
      pushToast("The exact task context is unavailable. The task remains in progress.", "warning");
      return { status: "recovery", ...handoff.recovery };
    }
    const locating = transitionWorkspaceTaskContext(activeWorkspaceTaskJourney, "locating");
    if (!locating.ok) {
      pushToast("The task context could not be restored. No record changed.", "warning");
      return { status: "recovery", ...locating.recovery };
    }
    const navigationResult = navigateWorkspace(handoff.navigation.path, {
      state: handoff.navigation.state,
      beforeCommit: () => {
        const persisted = persistWorkspaceTaskJourney(locating.journey);
        if (!persisted.ok) {
          pushToast(
            "Opening the exact context, but task tracking could not be retained in this session. No record changed.",
            "warning"
          );
          return null;
        }
        return persisted;
      }
    });
    if (["blocked", "guarded"].includes(navigationResult?.status)) {
      return { status: navigationResult.status };
    }
    return { status: "pending", contract: handoff.contract };
  }, [
    activeWorkspaceTaskJourney,
    navigateWorkspace,
    persistWorkspaceTaskJourney,
    pushToast
  ]);

  const stopTrackingWorkspaceTask = useCallback(() => {
    if (!activeWorkspaceTaskJourney) return { status: "idle" };
    const cancelled = transitionWorkspaceTaskOutcome(activeWorkspaceTaskJourney, {
      phase: "cancelled"
    });
    if (!cancelled.ok) {
      pushToast("Task tracking could not be stopped. No record changed.", "warning");
      return { status: "recovery", ...cancelled.recovery };
    }
    const cleared = clearWorkspaceTaskJourney(authSession.organizationId);
    if (!cleared.ok) {
      pushToast("Task tracking could not be cleared from this session. No record changed.", "warning");
      return { status: "recovery", ...cleared.recovery };
    }
    setWorkspaceTaskJourney(null);
    pushToast("Stopped tracking this task on this device. No work or record changed.", "info");
    return { status: "cancelled" };
  }, [activeWorkspaceTaskJourney, authSession.organizationId, pushToast]);

  const actionFeedbackSelector = useCallback((feedback) => ({
    attemptId: feedback?.attemptId,
    actionId: feedback?.actionId,
    generation: feedback?.generation,
    recordRevision: feedback?.revision,
    object: feedback?.object
      ? {
          kind: feedback.object.kind,
          id: feedback.object.id,
          label: feedback.object.label
        }
      : null
  }), []);

  const acknowledgeWorkspaceActionFeedback = useCallback((feedback) => {
    const selected = feedback || currentWorkspaceActionFeedback;
    if (!selected) return { status: "idle" };
    return acknowledgeActionFeedback(actionFeedbackSelector(selected));
  }, [
    acknowledgeActionFeedback,
    actionFeedbackSelector,
    currentWorkspaceActionFeedback
  ]);

  const currentWorkspaceActionFeedbackFollowUp = useMemo(
    () => buildWorkspaceActionFeedbackFollowUpIdentity(currentWorkspaceActionFeedback),
    [currentWorkspaceActionFeedback]
  );
  const workspaceActionFeedbackReturnIdentity = currentWorkspaceActionFeedbackFollowUp
    || workspaceActionFeedbackReconciliationContext?.identity
    || null;
  const workspaceActionFeedbackReturnOwnsCurrentArrival = Boolean(
    workspaceActionFeedbackReturnIdentity
    && browserRoute.routeId === WORKSPACE_ROUTE_IDS.WORKFLOW
    && workspaceArrivalContext?.destination === "workflow"
    && workspaceArrivalContext?.intentId === "review_follow_up"
    && workspaceArrivalContext?.object?.type === "workflow-item"
    && workspaceArrivalContext?.object?.id
      === workspaceActionFeedbackReturnIdentity.object.id
    && workspaceArrivalContext?.focus?.quoteId
      === workspaceActionFeedbackReturnIdentity.focus.quoteId
    && workspaceArrivalContext?.focus?.attentionType === "follow_up"
    && workspaceArrivalContext?.focus?.requestId
      === workspaceActionFeedbackReturnIdentity.focus.requestId
  );
  const workspaceActionFeedbackOwnsCurrentArrival = Boolean(
    currentWorkspaceActionFeedbackFollowUp
    && workspaceActionFeedbackReturnIdentity === currentWorkspaceActionFeedbackFollowUp
    && workspaceActionFeedbackReturnOwnsCurrentArrival
  );
  const workspaceActionFeedbackNextActionResolved = Boolean(
    workspaceActionFeedbackOwnsCurrentArrival
    && workspaceArrivalResolution?.arrivalKey === workspaceArrivalKey
    && workspaceArrivalResolution?.status === "resolved"
    && workspaceArrivalResolution?.itemId
      === currentWorkspaceActionFeedbackFollowUp.focus.requestId
  );
  const activeWorkspaceTaskOwnsCurrentFeedback = Boolean(
    currentWorkspaceActionFeedback
    && activeWorkspaceTaskJourney
    && workspaceActionFeedbackMatchesTaskJourney(
      currentWorkspaceActionFeedback,
      activeWorkspaceTaskJourney
    )
  );
  const feedbackOwnedFollowUpTaskContext = useMemo(() => {
    if (
      activeWorkspaceTaskOwnsCurrentFeedback
      || !workspaceActionFeedbackReturnOwnsCurrentArrival
      || (currentWorkspaceActionFeedback && !currentWorkspaceActionFeedbackFollowUp)
      || (
        currentWorkspaceActionFeedback
        && !["recovery", "uncertain"].includes(currentWorkspaceActionFeedback.phase)
      )
    ) {
      return null;
    }
    const identity = workspaceActionFeedbackReturnIdentity;
    return Object.freeze({
      organizationId: String(authSession.organizationId || "").trim(),
      taskId: identity.taskId,
      startedAtISO: identity.startedAtISO,
      phase: "uncertain",
      contextState: workspaceActionFeedbackNextActionResolved ? "ready" : "locating",
      destination: identity.destination,
      object: identity.object,
      focus: identity.focus,
      intentId: identity.intentId
    });
  }, [
    activeWorkspaceTaskOwnsCurrentFeedback,
    authSession.organizationId,
    currentWorkspaceActionFeedback?.phase,
    currentWorkspaceActionFeedbackFollowUp,
    workspaceActionFeedbackNextActionResolved,
    workspaceActionFeedbackReturnIdentity,
    workspaceActionFeedbackReturnOwnsCurrentArrival
  ]);
  const workflowTaskJourney = feedbackOwnedFollowUpTaskContext || activeWorkspaceTaskJourney;
  const workflowReturnFallback = workflowTaskJourney?.origin?.routeId === WORKSPACE_ROUTE_IDS.QUOTE_LIST
    ? WORKSPACE_PATHS.quotes
    : workflowTaskJourney?.origin?.routeId === WORKSPACE_ROUTE_IDS.CLEAR_DECK
      ? WORKSPACE_PATHS.clearDeck
      : WORKSPACE_PATHS.home;

  useEffect(() => {
    if (
      !currentWorkspaceActionFeedbackFollowUp
      || !currentWorkspaceActionFeedback
      || !["recovery", "uncertain"].includes(currentWorkspaceActionFeedback.phase)
      || !workspaceActionFeedbackNextActionResolved
    ) {
      return;
    }
    setWorkspaceActionFeedbackReconciliationContext((current) => (
      current?.attemptId === currentWorkspaceActionFeedback.attemptId
      && current?.generation === currentWorkspaceActionFeedback.generation
        ? current
        : {
            attemptId: currentWorkspaceActionFeedback.attemptId,
            generation: currentWorkspaceActionFeedback.generation,
            identity: currentWorkspaceActionFeedbackFollowUp
          }
    ));
  }, [
    currentWorkspaceActionFeedback,
    currentWorkspaceActionFeedbackFollowUp,
    workspaceActionFeedbackNextActionResolved
  ]);

  const handleWorkspaceActionFeedbackNextAction = useCallback((nextAction, feedback) => {
    const selected = feedback || currentWorkspaceActionFeedback;
    if (!selected) return { status: "idle" };
    const nextActionId = String(nextAction?.id || selected.nextAction?.id || "").trim();
    const approvalFeedback = selected.actionId === "resolve-approval";
    const resolution = approvalFeedback
      ? resolveWorkspaceActionFeedbackApprovalAction({
          feedback: selected,
          nextActionId,
          activeTaskJourney: activeWorkspaceTaskJourney
        })
      : resolveWorkspaceActionFeedbackFollowUpAction({
          feedback: selected,
          nextActionId,
          activeTaskJourney: activeWorkspaceTaskJourney
        });
    if (!resolution.ok) return resolution;
    const { identity = null } = resolution;

    let navigationResult;
    if (resolution.strategy === "continue") {
      navigationResult = continueWorkspaceTaskJourney();
    } else {
      navigationResult = navigateWorkspace(resolution.navigation.path, {
        state: resolution.navigation.state
      });
    }

    const navigationAccepted = typeof navigationResult === "string"
      || navigationResult?.status === "pending";
    if (!navigationAccepted) return navigationResult || { status: "recovery" };
    if (!approvalFeedback && ["recovery", "uncertain"].includes(selected.phase)) {
      setWorkspaceActionFeedbackReconciliationContext({
        attemptId: selected.attemptId,
        generation: selected.generation,
        identity
      });
    }
    return typeof navigationResult === "string"
      ? { status: "pending", destination: navigationResult }
      : navigationResult;
  }, [
    activeWorkspaceTaskJourney,
    continueWorkspaceTaskJourney,
    currentWorkspaceActionFeedback,
    navigateWorkspace
  ]);

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
  const inventoryTenantEnabled = effectiveSettings.inventoryAuthorityEnabled === true;
  const inventoryWorkspaceEnabled = CUSTOMER_CENTERED_WORKSPACE_ENABLED
    && INVENTORY_AUTHORITY_UI_ENABLED
    && inventoryTenantEnabled
    && firebaseReady
    && authSession.isAdmin;
  const quoteCompareEnabled = featureFlags.quoteCompare !== false;
  const aiAssistEnabled = featureFlags.aiAssist !== false;
  const aiAutopilotEnabled = aiAssistEnabled && featureFlags.aiAutopilot === true;
  const navigateEventSchedule = useCallback((quoteId) => {
    const normalizedQuoteId = String(quoteId || "").trim();
    if (!eventScheduleEnabled || !normalizedQuoteId) {
      return { status: "recovery", reason: "The exact event Schedule destination is unavailable." };
    }
    if (!AMBIENT_UI_ENABLED) return navigateWorkspace(WORKSPACE_PATHS.schedule);
    const handoff = createWorkspaceArrivalHandoff({
      destination: "schedule",
      object: { id: normalizedQuoteId, type: "opportunity" },
      focus: { quoteId: normalizedQuoteId },
      intentId: "review_event_schedule"
    });
    if (!handoff.ok) return { status: "recovery", ...handoff.recovery };
    return navigateAmbientTaskHandoff(handoff, "review-event-schedule", {
      preserveReturnContext: true,
      returnContextSurfaceId: "schedule",
      returnContextHint: {
        focus: {
          kind: "event-control-room-action",
          objectId: normalizedQuoteId,
          actionId: "review-event-schedule"
        }
      }
    });
  }, [eventScheduleEnabled, navigateAmbientTaskHandoff, navigateWorkspace]);
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
  const proposedMargin = useMemo(
    () => buildMarginPresentation({ form, totals, catalog, settings: effectiveSettings }),
    [catalog, effectiveSettings, form, totals]
  );
  const quoteEditRouteId = resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.QUOTE_EDIT
    ? String(browserRoute.params?.quoteId || "").trim()
    : "";
  const quoteEditReady = Boolean(quoteEditRouteId && editingQuote.id === quoteEditRouteId);
  const isEditingQuote = quoteEditReady;
  const inventoryRecipeExtension = useInventoryRecipeExtension({
    active: adminOpen || catalogRouteOpen || catalogModalOpen || isEditingQuote,
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
    scenarioFingerprint: currentChangeImpactFormKey,
    draftDirty: quoteDirty
  });
  const commercialInventoryConsequences = useMemo(() => buildCommercialInventoryConsequences({
    savedRead: eventIngredientProjection.read,
    scenarioPreview: eventIngredientProjection.preview,
    organizationId: authSession.organizationId,
    quoteId: editingQuote.id,
    savedQuoteRevisionId: String(
      editingQuote.activeVersionId || editingQuote.versionMeta?.versionId || ""
    ).trim(),
    scenarioFingerprint: currentChangeImpactFormKey
  }), [
    authSession.organizationId,
    currentChangeImpactFormKey,
    editingQuote.activeVersionId,
    editingQuote.id,
    editingQuote.versionMeta?.versionId,
    eventIngredientProjection.preview,
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
  const unifiedConsequenceReview = useMemo(() => buildUnifiedCommercialConsequenceReview({
    model: changeImpactPreview.model,
    recommendations,
    margin: proposedMargin,
    proposalReadiness,
    catalogRevision: changeImpactPreview.catalogRevision
  }), [
    changeImpactPreview.catalogRevision,
    changeImpactPreview.model,
    proposalReadiness,
    proposedMargin,
    recommendations
  ]);
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
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.OPERATIONS && eventScheduleEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INVENTORY && inventoryWorkspaceEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.SCHEDULE && eventScheduleEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.REPORTING && dashboardEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INTEGRATIONS && integrationsEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.DIAGNOSTICS && diagnosticsEnabled)
    || (resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CATALOG
      && (authSession.isAdmin || AMBIENT_UI_ENABLED))
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
        WORKSPACE_ROUTE_IDS.OPERATIONS,
        WORKSPACE_ROUTE_IDS.INVENTORY,
        WORKSPACE_ROUTE_IDS.SCHEDULE,
        WORKSPACE_ROUTE_IDS.REPORTING,
        WORKSPACE_ROUTE_IDS.CATALOG,
        WORKSPACE_ROUTE_IDS.IMPORTS,
        WORKSPACE_ROUTE_IDS.INTEGRATIONS,
        WORKSPACE_ROUTE_IDS.DIAGNOSTICS
      ].includes(resolvedWorkspaceRouteId) && !routedToolAuthorized)
      || (!CUSTOMER_CENTERED_WORKSPACE_ENABLED && [
        WORKSPACE_ROUTE_IDS.CLEAR_DECK,
        WORKSPACE_ROUTE_IDS.STAFF,
        WORKSPACE_ROUTE_IDS.CUSTOMER_LIST,
        WORKSPACE_ROUTE_IDS.CUSTOMER_DETAIL,
        WORKSPACE_ROUTE_IDS.EVENT_LIST,
        WORKSPACE_ROUTE_IDS.EVENT_DETAIL,
        WORKSPACE_ROUTE_IDS.EVENT_LIVE,
        WORKSPACE_ROUTE_IDS.EVENT_REPLAY,
        WORKSPACE_ROUTE_IDS.OPERATIONS,
        WORKSPACE_ROUTE_IDS.INVENTORY,
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
    // Loaded quotes retain their saved commercial plan until the operator
    // resolves the catalog revision review. Never remove or replace a missing
    // or inactive saved choice during hydration.
    if (editingQuote.id) return;
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
    editingQuote.id,
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
  const [attendanceChange, setAttendanceChange] = useState(null);
  useEffect(() => {
    if (!guestBand) return;
    if (Number(form.guests) !== Number(guestBand.appliedValue)) setGuestBand(null);
  }, [form.guests, guestBand]);
  useEffect(() => {
    if (form.attendancePlanning && Number(form.guests) !== form.attendancePlanning.value) {
      setForm(current => { const next = { ...current }; delete next.attendancePlanning; return next; });
    }
  }, [form.guests, form.attendancePlanning]);

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

  const buildCurrentPricingInput = (
    source = catalog.source || "",
    {
      candidateForm = form,
      candidateEditingQuote = editingQuote,
      candidateIsEditing = isEditingQuote
    } = {}
  ) => ({
    organizationId: authSession.organizationId || "",
    quoteId: candidateIsEditing ? candidateEditingQuote.id : "",
    quoteNumber: candidateIsEditing ? candidateEditingQuote.quoteNumber || "" : "",
    actor: {
      uid: authSession.user?.uid || "",
      email: authSession.user?.email || "",
      role: authSession.role || "sales"
    },
    form: candidateForm,
    metadata: {
      source,
      generatedAt: new Date().toISOString()
    }
  });

  const handlePreviewChangeImpact = async ({ recovery = false, candidateForm = form } = {}) => {
    if (!isEditingQuote || !editingQuote.id) return;
    const generation = changeImpactPreviewGenerationRef.current + 1;
    changeImpactPreviewGenerationRef.current = generation;
    const formKey = JSON.stringify(candidateForm);
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
        form: candidateForm,
        ...(attendanceChange ? { attendanceSubmissionReceiptId: attendanceChange.submissionReceiptId } : {})
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
        appliedQuote: null
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

  const unifiedConsequenceScopeIsCurrent = () => unifiedConsequenceFenceCurrent(
    unifiedConsequenceReview,
    {
      quoteRevisionId: editingQuote.activeVersionId,
      proposedRevisionId: changeImpactPreview.model?.identity?.proposedRevisionId,
      catalogRevision: catalog.settings?.catalogRevision
    }
  ) && changeImpactScopeIsCurrent();

  const handleApplyUnifiedConsequences = async (selectedIds) => {
    if (!unifiedConsequenceScopeIsCurrent()) {
      setChangeImpactPreview((current) => ({
        ...current,
        error: "The quote, catalog, or simulation fence changed. Refresh consequence review before applying a selection."
      }));
      return;
    }
    const nextForm = buildUnifiedConsequenceProposedForm({
      form,
      review: unifiedConsequenceReview,
      selectedIds
    });
    setForm(nextForm);
    setQuoteDirty(true);
    setSubmitState((current) => ({
      ...current,
      saving: false,
      message: "The selected consequence plan is staged. A fresh authoritative simulation is required before the governed version action."
    }));
    await handlePreviewChangeImpact({ candidateForm: nextForm });
  };

  const handleKeepUnifiedQuotedPlan = () => {
    const baseForm = editingQuote.baseForm;
    if (!baseForm) return;
    setForm({ ...baseForm });
    setQuoteDirty(false);
    resetChangeImpactPreview();
    setSubmitState((current) => ({
      ...current,
      saving: false,
      message: "Kept the quoted plan. The unsaved consequence proposal was discarded and the saved quote was not mutated."
    }));
  };

  const handleCatalogReviewOutcome = async (outcome) => {
    const review = catalogRevisionReview.review;
    if (!review || !editingQuote.id) return;
    setCatalogRevisionReview((current) => ({ ...current, submitting: true, error: "" }));
    try {
      const {
        createQuoteCatalogReviewRequestId,
        recordQuoteCatalogReviewOutcome
      } = await import("./lib/quoteCatalogRevisionReview");
      const result = await recordQuoteCatalogReviewOutcome({
        organizationId: authSession.organizationId,
        quoteId: editingQuote.id,
        expectedQuoteVersionId: review.quoteVersionId,
        expectedCatalogRevision: review.currentCatalogRevision,
        outcome,
        requestId: createQuoteCatalogReviewRequestId(outcome)
      });
      setCatalogRevisionReview((current) => ({
        ...current,
        submitting: false,
        outcome,
        receipt: result.receipt
      }));
      if (outcome === "keep_quoted_values") {
        setSubmitState((current) => ({
          ...current,
          saving: false,
          message: "Quoted commercial inputs were preserved for this saved version. Change guests, duration, service style, staffing, or selections only through Review and update."
        }));
        return;
      }
      const savedSelection = editingQuote.selection || {};
      const currentCatalogForm = {
        ...form,
        bartenderRateOverride: savedSelection.bartenderRateOverride ?? "",
        serverRateOverride: savedSelection.serverRateOverride ?? "",
        chefRateOverride: savedSelection.chefRateOverride ?? ""
      };
      setForm(currentCatalogForm);
      setQuoteDirty(true);
      setSubmitState((current) => ({
        ...current,
        saving: false,
        message: "Current-catalog values are staged for authoritative Change Impact review. Nothing has been saved yet."
      }));
      await handlePreviewChangeImpact({ candidateForm: currentCatalogForm });
    } catch (error) {
      setCatalogRevisionReview((current) => ({
        ...current,
        submitting: false,
        error: error?.message || "The catalog review outcome was not recorded."
      }));
    }
  };

  const changeImpactScopeIsCurrent = () => Boolean(
    changeImpactPreview.model
    && changeImpactPreview.formKey
    && changeImpactPreview.formKey === JSON.stringify(form)
    && changeImpactPreview.simulationReceiptId
    && (attendanceChange?.submissionReceiptId || "") === (changeImpactPreview.model?.attendanceBinding?.submissionReceiptId || "")
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
        mutationMessage: attendanceChange ? "Reviewed attendance was applied to a new draft revision. Prior payment and booking history remain preserved. Separate customer acceptance and administrator booking revalidation are required; no payment was charged." : result.commercialChange?.authorityState === "enforced"
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
    propagateError = false,
    explicitDraft = null,
    navigateAfterSave = true,
    manageEditorState = true,
    onPersistenceResolved = null
  } = {}) => {
    const submissionForm = explicitDraft?.form || form;
    const submissionEditingQuote = explicitDraft?.editingQuote || editingQuote;
    const submissionIsEditing = explicitDraft
      ? Boolean(String(submissionEditingQuote?.id || "").trim())
      : isEditingQuote;
    const submissionTotals = explicitDraft
      ? calculateQuote(submissionForm, catalog, effectiveSettings)
      : totals;
    const submissionMenuItemCount = Array.isArray(submissionForm?.menuItems)
      ? submissionForm.menuItems.length
      : 0;
    if (!explicitDraft && quoteEditRouteId && !quoteEditReady) {
      if (manageEditorState) {
        setSubmitState((current) => ({
          ...current,
          saving: false,
          message: "This saved quote has not loaded for editing. Retry the edit before saving."
        }));
      }
      return;
    }
    if (!explicitDraft && submissionIsEditing) {
      const reviewState = catalogRevisionReview.review?.state;
      const unresolved = ["review_required", "legacy_unknown", "unavailable"].includes(reviewState)
        && catalogRevisionReview.outcome !== "review_and_update";
      const keptPlanChanged = catalogRevisionReview.outcome === "keep_quoted_values" && quoteDirty;
      if (unresolved || keptPlanChanged) {
        setSubmitState((current) => ({
          ...current,
          saving: false,
          message: keptPlanChanged
            ? "The kept commercial plan is frozen. Choose Review and update before changing guests, duration, service style, staffing, or selections."
            : "Resolve the catalog revision review before saving. No saved values were repriced or removed."
        }));
        window.requestAnimationFrame(() => {
          wizardRef.current?.querySelector('[data-capability-id="quote-catalog-revision-review"]')
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return null;
      }
    }
    if (
      !explicitDraft
      &&
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
      !explicitDraft
      &&
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
    if (!explicitDraft && isEditingQuote && changeImpactPreviewAvailable && !commercialChangeAuthority) {
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
        && (
          changeImpactPreview.model?.attendanceBinding
          || (
            changeImpactPreview.authorizationRequired
            && !changeImpactPreview.authorizationReceiptId
          )
        )
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
    if (submissionMenuItemCount < 1) {
      const message = "Choose at least one menu item before saving this quote.";
      if (manageEditorState) {
        showMissingMenuSelection({ moveToMenuStep: true });
      }
      if (propagateError) throw new Error(message);
      return;
    }
    const requiredError =
      submissionTotals.guests <= 0
        ? "Add guest count before saving a quote."
        : !submissionForm.name.trim()
          ? "Client name is required."
          : !submissionForm.email.trim()
            ? "Client email is required."
            : !/^\S+@\S+\.\S+$/.test(submissionForm.email.trim())
              ? "Client email format is invalid."
              : !submissionForm.eventTypeId
                ? "Event type is required."
                : !submissionForm.date
                  ? "Event date is required."
                  : !submissionForm.eventName.trim()
                    ? "Event name is required."
                    : !submissionForm.venue.trim()
                      ? "Venue is required."
                      : "";

    if (requiredError) {
      if (manageEditorState) {
        setSubmitState((prev) => ({ ...prev, saving: false, message: requiredError }));
      }
      if (propagateError) throw new Error(requiredError);
      return;
    }

    if (manageEditorState) {
      setSubmitState((prev) => ({
        ...prev,
        saving: true,
        message: ""
      }));
    }
    try {
      const availability = await checkEventAvailability({
        eventDate: submissionForm.date,
        venue: submissionForm.venue,
        eventTime: submissionForm.time,
        eventHours: submissionForm.hours,
        eventGuests: submissionForm.guests,
        capacityLimit: scheduleCapacityLimit,
        excludeQuoteId: submissionIsEditing ? submissionEditingQuote.id : "",
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
        const message =
          `Availability conflict: this date/venue is already booked.` +
          `${conflictRefs ? ` Existing booking(s): ${conflictRefs}.` : ""}` +
          capacityNote +
          " Open the schedule for context or edit the date, time, or venue to continue.";
        if (manageEditorState) {
          setAvailabilityBlock({
            conflicts: bookedConflicts,
            capacityExceeded: Boolean(availability.capacityExceeded),
            sameVenueLoad: Number(availability.sameVenueLoad || 0),
            capacityLimit: Number(availability.capacityLimit || 0)
          });
          setSubmitState({ saving: false, message });
        }
        if (propagateError) throw new Error(message);
        return;
      }
      if (manageEditorState) setAvailabilityBlock(null);
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
      if (manageEditorState) {
        if (notes.length) {
          setAvailabilityNotice(notes.join(" "));
        } else {
          setAvailabilityNotice("");
        }
      }

      const requiresAuthoritativePricing =
        !E2E_ALLOW_NON_AUTHORITATIVE_PRICING
        && String(catalog.source || "").trim().toLowerCase().startsWith("firebase");
      const pricingInput = buildCurrentPricingInput(catalog.source || "", {
        candidateForm: submissionForm,
        candidateEditingQuote: submissionEditingQuote,
        candidateIsEditing: submissionIsEditing
      });
      let totalsForPersistence = submissionTotals;
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
        totalsForPersistence = buildTotalsFromPricingSnapshot(authoritativePricing, submissionTotals);
        const previewTotal = toNumber(submissionTotals.total, 0);
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
        submissionIsEditing
          ? updateQuote({
            quoteId: submissionEditingQuote.id,
            form: submissionForm,
            totals: totalsForPersistence,
            pricingSnapshot,
            catalogSource: catalog.source,
            settings: effectiveSettings,
            catalog,
            ownerUid: authSession.user?.uid || "",
            ownerEmail: authSession.user?.email || "",
            organizationId: authSession.organizationId,
            expectedActiveVersionId: explicitDraft?.expectedActiveVersionId
              || submissionEditingQuote.activeVersionId
              || undefined,
            catalogReviewReceiptId: catalogRevisionReview.outcome === "review_and_update"
              ? catalogRevisionReview.receipt?.receiptId
              : undefined,
            ...(commercialChangeAuthority ? { commercialChangeAuthority } : {})
          })
          : submitQuote({
            form: submissionForm,
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
        submissionIsEditing ? "updateQuote" : "submitQuote"
      );
      if (typeof onPersistenceResolved === "function") {
        onPersistenceResolved(result);
      }
      if (submissionIsEditing) {
        if (manageEditorState) {
          setQuoteDirty(false);
          setAmbientDraftIntentReview(null);
          setAmbientDraftCatalogContext(null);
          setAmbientDraftReviewResolution("");
          clearPilotScenarioDraftReview();
        }
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
        if (manageEditorState) {
          setSubmitState({
            saving: false,
            message: `Quote ${result.quoteNumber} updated in ${result.storage}. Version snapshot saved and rates locked.${pricingAdjustmentNote}`
          });
          pushToast(`Quote ${result.quoteNumber} updated.`, "success");
        }
        // The quote save and change-request linkage are separate outcomes.
        // A linkage failure must not erase the confirmed quote receipt, but it
        // must remain visible so the operator does not assume resolution.
        if (
          result.storage === "firebase"
          && manageEditorState
          && pendingResolutionLink?.quoteId === submissionEditingQuote.id
          && result.activeVersionId
        ) {
          void linkChangeRequestResolutionVersion({
            organizationId: authSession.organizationId,
            quoteId: submissionEditingQuote.id,
            resolutionId: pendingResolutionLink.resolutionId,
            versionId: result.activeVersionId
          }).catch((error) => {
            recordDiagnosticError(error, {
              surface: "change-request-record",
              action: "link-version"
            });
            pushToast(
              `Quote ${result.quoteNumber} was saved, but its change-request resolution was not confirmed. Reopen Change Requests and retry against the saved version.`,
              "warning"
            );
          });
          setPendingResolutionLink(null);
        }
        requestWorkflowAttentionRefresh({ force: true });
        if (manageEditorState) {
          setHistoryTarget({ quoteId: result.id, reason: "updated" });
        }
        if (navigateAfterSave) navigateWorkspace(buildQuotePath(result.id));
        return {
          ...result,
          pricingSnapshot,
          pricingAdjustmentNote
        };
      }

      const savedDraftMessage = `Quote ${result.quoteNumber} saved as a draft in ${result.storage}. It has not been sent to the customer.`;
      setQuoteDirty(false);
      if (typeof window !== "undefined") {
        clearDraftSnapshot(window.localStorage, draftRecoveryStorageKey);
      }
      setDraftRecoveryOffer(null);
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
        action: explicitDraft ? "save-quick-update" : "submit-quote",
        eventDate: submissionForm.date,
        venue: submissionForm.venue,
        guests: submissionTotals.guests
      });
      if (manageEditorState) {
        pushToast(err?.message || "Failed to save quote.", "error");
        setSubmitState((prev) => ({
          ...prev,
          saving: false,
          message: err?.message || "Failed to save quote."
        }));
      }
      if (propagateError) throw err;
      return null;
    }
  };

  const quickUpdateFailure = (status, code, reason, nextResolution, recovery = {}) => ({
    status,
    code,
    reason,
    consequence: "The Quick Updates draft remains open and no additional quote change is assumed.",
    nextResolution,
    recoveryAction: String(recovery.action || "").trim(),
    recoveryLabel: String(recovery.label || "").trim(),
    retryable: recovery.retryable !== false
  });

  const quickUpdateRequiresEditor = (reason, nextResolution) => quickUpdateFailure(
    "handoff",
    "full-editor-required",
    reason,
    nextResolution,
    {
      action: "open_editor",
      label: "Continue in quote editor",
      retryable: false
    }
  );

  const isFirebaseQuickUpdateSource = () => String(catalog.source || "")
    .trim()
    .toLowerCase()
    .startsWith("firebase");

  const quickUpdatePersistedEffectsMatch = (preview, candidate) => {
    const effects = preview?.persistedEffects;
    const delta = Array.isArray(effects?.requestedDelta)
      ? effects.requestedDelta
      : [];
    const requested = candidate?.delta?.[0] || {};
    return Boolean(
      effects?.schemaVersion === "commercial-change-persisted-effects-v1"
      && effects?.authority === "server_authoritative"
      && effects?.identity?.organizationId === String(authSession.organizationId || "").trim()
      && effects?.identity?.quoteId === String(candidate?.quote?.id || candidate?.editingQuote?.id || "").trim()
      && effects?.identity?.baseRevisionId === candidate?.baseRevisionId
      && effects?.status?.before === "draft"
      && effects?.status?.after === "draft"
      && effects?.version?.beforeRevisionId === candidate?.baseRevisionId
      && effects?.version?.afterRevisionId === effects?.identity?.projectedRevisionId
      && effects?.version?.createsImmutableVersion === true
      && delta.length === 1
      && delta[0]?.fieldPath === "event.style"
      && String(delta[0]?.before || "").trim() === String(requested.before || "").trim()
      && String(delta[0]?.after || "").trim() === String(requested.after || "").trim()
    );
  };

  const prepareQuickUpdateCandidate = async (request = {}) => {
    const quoteId = String(request.quoteId || "").trim();
    const organizationId = String(request.organizationId || "").trim();
    const baseRevisionId = String(request.baseRevisionId || "").trim();
    const nextStyle = String(request.patch?.event?.style || "").trim();
    const requestedDelta = Array.isArray(request.delta) ? request.delta : [];
    const allowedStyles = Object.keys(STAFF_RULES);
    if (
      request.modelId !== "quick-updates-request-v1"
      || request.source !== "quick_updates"
      || request.scope !== "event.service_style"
      || !quoteId
      || !organizationId
      || !baseRevisionId
      || !nextStyle
      || requestedDelta.length !== 1
      || requestedDelta[0]?.fieldPath !== "event.style"
    ) {
      throw Object.assign(new Error("The Quick Updates request is incomplete or unsupported."), {
        code: "invalid-argument"
      });
    }
    if (organizationId !== String(authSession.organizationId || "").trim()) {
      throw Object.assign(new Error("The Quick Updates request belongs to another workspace."), {
        code: "permission-denied"
      });
    }
    if (!["admin", "sales"].includes(String(authSession.role || "").trim().toLowerCase())) {
      throw Object.assign(new Error("Your role cannot edit this opportunity."), {
        code: "permission-denied"
      });
    }
    if (!allowedStyles.includes(nextStyle)) {
      throw Object.assign(new Error("Choose a service style offered by the current quote editor."), {
        code: "invalid-argument"
      });
    }
    const currentQuote = await getQuoteById(quoteId);
    const currentOrganizationId = String(
      currentQuote?.organizationId || organizationId
    ).trim();
    if (currentOrganizationId !== organizationId) {
      throw Object.assign(new Error("The saved quote belongs to another workspace."), {
        code: "permission-denied"
      });
    }
    const currentRevisionId = String(
      currentQuote?.activeVersionId || currentQuote?.versionMeta?.versionId || ""
    ).trim();
    if (!currentRevisionId || currentRevisionId !== baseRevisionId) {
      throw Object.assign(
        new Error("This opportunity changed after Quick Updates opened. Reload the current saved version before editing it."),
        { code: "conflict" }
      );
    }
    const currentStyle = String(currentQuote?.event?.style || "").trim();
    if (
      String(requestedDelta[0]?.before || "").trim() !== currentStyle
      || String(requestedDelta[0]?.after || "").trim() !== nextStyle
      || currentStyle === nextStyle
    ) {
      throw Object.assign(
        new Error("The reviewed service-style delta no longer matches the saved opportunity."),
        { code: "conflict" }
      );
    }
    const runtime = hydrateSavedQuoteDraftBase({
      quote: currentQuote,
      previousForm: INITIAL_FORM,
      catalogPackages: catalog.packages,
      organizationId
    });
    if (!runtime.ok) {
      throw Object.assign(new Error(runtime.reason || "The saved quote could not be prepared for editing."), {
        code: "failed-precondition"
      });
    }
    return {
      quote: currentQuote,
      baseRevisionId: currentRevisionId,
      form: { ...runtime.form, style: nextStyle },
      editingQuote: runtime.editingQuote,
      delta: [{
        ...requestedDelta[0],
        fieldPath: "event.style",
        before: currentStyle,
        after: nextStyle
      }]
    };
  };

  const handlePreviewQuickUpdate = async (request = {}) => {
    try {
      const candidate = await prepareQuickUpdateCandidate(request);
      if (!isFirebaseQuickUpdateSource()) {
        return quickUpdateRequiresEditor(
          "Quick Updates can browse this local fallback quote, but it cannot claim an authoritative save.",
          "Discard only this panel draft, then make and review the change in the full quote editor."
        );
      }
      const quoteStatus = String(candidate.quote?.status || "draft").trim().toLowerCase();
      if (quoteStatus !== "draft") {
        return quickUpdateRequiresEditor(
          `This ${quoteStatus || "non-draft"} opportunity needs the full quote editor because saving an edit creates a new draft lifecycle version.`,
          "Discard only this panel draft, then review the lifecycle and customer-facing effects in the full quote editor."
        );
      }
      const {
        buildCommercialChangeRequestId,
        simulateCommercialQuoteChange
      } = await import("./lib/commercialChangeAuthorityClient");
      const result = await simulateCommercialQuoteChange({
        organizationId: request.organizationId,
        quoteId: request.quoteId,
        expectedActiveVersionId: candidate.baseRevisionId,
        requestId: buildCommercialChangeRequestId("simulation"),
        form: candidate.form
      });
      const authorizationRequired = result.simulationReceipt?.authorizationRequired === true;
      const persistedEffects = result.persistedEffects;
      if (!quickUpdatePersistedEffectsMatch({ persistedEffects }, candidate)) {
        return quickUpdateFailure(
          "failed",
          "invalid-server-response",
          "The authoritative review did not return the exact enumerated material effects for this menu draft.",
          "Keep the draft open or continue in the full quote editor.",
          { action: "open_editor", label: "Continue in quote editor", retryable: false }
        );
      }
      const saveAllowed = !(result.authorityState === "enforced" && authorizationRequired);
      return {
        status: "ready",
        storage: result.storage,
        authorityState: result.authorityState,
        authorizationRequired,
        simulationReceiptId: result.simulationReceipt?.receiptId || "",
        applyRequestId: buildCommercialChangeRequestId("apply"),
        baseRevisionId: candidate.baseRevisionId,
        simulation: result.simulation,
        persistedEffects,
        saveAllowed,
        handoffReason: saveAllowed
          ? ""
          : "This reviewed change has governed dependencies and must continue through Change Impact in the full quote editor.",
        delta: candidate.delta
      };
    } catch (error) {
      recordDiagnosticError(error, {
        surface: "quick-updates",
        action: "preview-service-style",
        quoteId: request.quoteId
      });
      const code = String(error?.code || "").replace(/^functions\//u, "") || "failed-precondition";
      const conflict = code === "conflict" || code === "aborted";
      return quickUpdateFailure(
        conflict ? "conflict" : "failed",
        code,
        error?.message || "The exact service-style review could not be prepared.",
        conflict
          ? "Reload the opportunity, then create a new Quick Updates draft from its current version."
          : "Keep the draft open or continue in the full authoritative editor."
      );
    }
  };

  const handleSaveQuickUpdate = async (request = {}) => {
    let persistenceReceipt = null;
    try {
      const preview = request.preview && typeof request.preview === "object"
        ? request.preview
        : null;
      if (!preview || preview.status !== "ready") {
        return quickUpdateFailure(
          "failed",
          "failed-precondition",
          "Review the exact Quick Updates delta before saving.",
          "Return to the review step, then save the current reviewed delta."
        );
      }
      if (
        preview.saveAllowed === false
        || (preview.authorityState === "enforced" && preview.authorizationRequired === true)
      ) {
        return quickUpdateFailure(
          "handoff",
          "authorization-required",
          "This change requires the existing Commercial Change authorization flow.",
          "Discard only this panel draft, then open the full editor to review Change Impact and obtain the required authorization.",
          { action: "open_editor", label: "Continue in quote editor", retryable: false }
        );
      }
      const commercialChangeAuthority = {
        simulationReceiptId: String(preview.simulationReceiptId || "").trim(),
        authorizationReceiptId: "",
        applyRequestId: String(preview.applyRequestId || "").trim()
      };
      if (
        !commercialChangeAuthority.simulationReceiptId
        || !commercialChangeAuthority.applyRequestId
      ) {
        return quickUpdateFailure(
          "failure",
          "failed-precondition",
          "The reviewed Commercial Change receipt is incomplete.",
          "Return to edit and prepare a new exact review before saving."
        );
      }
      const candidate = await prepareQuickUpdateCandidate(request);
      if (!isFirebaseQuickUpdateSource()) {
        return quickUpdateRequiresEditor(
          "Quick Updates cannot save from the local fallback catalog.",
          "Discard only this panel draft, then continue in the full quote editor."
        );
      }
      if (String(candidate.quote?.status || "draft").trim().toLowerCase() !== "draft") {
        return quickUpdateRequiresEditor(
          "This opportunity is no longer a draft, so its lifecycle effects need the full quote editor.",
          "Discard only this panel draft, then review the current saved lifecycle in the full quote editor."
        );
      }
      if (
        String(preview.baseRevisionId || "").trim() !== candidate.baseRevisionId
        || JSON.stringify(preview.delta || []) !== JSON.stringify(candidate.delta)
        || !quickUpdatePersistedEffectsMatch(preview, candidate)
      ) {
        return quickUpdateFailure(
          "conflict",
          "conflict",
          "The reviewed delta is no longer bound to the current saved version.",
          "Reload the opportunity and review the current values before saving."
        );
      }
      const result = await handleSubmitQuote({
        commercialChangeAuthority,
        propagateError: true,
        explicitDraft: {
          source: "quick_updates",
          form: candidate.form,
          editingQuote: candidate.editingQuote,
          expectedActiveVersionId: candidate.baseRevisionId
        },
        navigateAfterSave: false,
        manageEditorState: false,
        onPersistenceResolved: (writeResult) => {
          persistenceReceipt = {
            quoteId: String(writeResult?.id || ""),
            organizationId: String(request.organizationId),
            activeVersionId: String(writeResult?.activeVersionId || ""),
            latestVersionNumber: Number(writeResult?.latestVersionNumber || 0),
            quoteNumber: String(writeResult?.quoteNumber || ""),
            status: String(writeResult?.status || ""),
            storage: String(writeResult?.storage || ""),
            portalKey: String(writeResult?.portalKey || ""),
            portalIssuedAtISO: String(writeResult?.portalIssuedAtISO || ""),
            portalExpiresAtISO: String(writeResult?.portalExpiresAtISO || "")
          };
        }
      });
      if (!result?.id || !result?.activeVersionId) {
        return quickUpdateFailure(
          "uncertain",
          "unknown",
          "The save did not return an exact version receipt.",
          "Reconcile the saved opportunity before retrying this request.",
          { action: "reconcile_only", label: "Reconcile in quote editor", retryable: false }
        );
      }
      if (
        persistenceReceipt.storage !== "firebase"
        || persistenceReceipt.activeVersionId
          !== String(preview.persistedEffects?.version?.afterRevisionId || "").trim()
        || persistenceReceipt.latestVersionNumber
          !== Number(preview.persistedEffects?.version?.afterVersionNumber || 0)
        || persistenceReceipt.status.toLowerCase()
          !== String(preview.persistedEffects?.status?.after || "").trim().toLowerCase()
        || persistenceReceipt.portalKey !== String(candidate.quote?.portalKey || "").trim()
        || !Number.isFinite(Date.parse(persistenceReceipt.portalIssuedAtISO))
        || !Number.isFinite(Date.parse(persistenceReceipt.portalExpiresAtISO))
      ) {
        return quickUpdateFailure(
          "uncertain",
          "write-receipt-mismatch",
          "The write returned, but its exact Firebase version receipt did not match the reviewed edit plan.",
          "Reconcile the authoritative opportunity before submitting anything again.",
          { action: "reconcile_only", label: "Reconcile in quote editor", retryable: false }
        );
      }
      const authoritativeQuote = await getQuoteById(result.id, { serverOnly: true });
      const readbackRevisionId = String(
        authoritativeQuote?.activeVersionId || authoritativeQuote?.versionMeta?.versionId || ""
      ).trim();
      const readbackStyle = String(authoritativeQuote?.event?.style || "").trim();
      const expectedEffects = preview.persistedEffects;
      const expectedTotal = Number(expectedEffects?.pricing?.authoritativeTotal?.proposedAfter);
      const expectedDeposit = Number(expectedEffects?.pricing?.depositRequirement?.proposedAfter);
      const readbackTotal = Number(
        authoritativeQuote?.pricing?.grandTotal ?? authoritativeQuote?.totals?.total
      );
      const readbackDeposit = Number(
        authoritativeQuote?.pricing?.deposit?.amount ?? authoritativeQuote?.totals?.deposit
      );
      const staffingFields = ["servers", "chefs", "bartenders"];
      const staffingMatches = staffingFields.every((field) => {
        const expected = expectedEffects?.staffing?.after?.[field];
        const actual = authoritativeQuote?.event?.[field];
        if (expected === null) return actual === null || actual === undefined;
        return Number(actual) === Number(expected);
      });
      const proposalWorkflowMatches = expectedEffects?.proposal?.workflowEvidencePreserved === true
        && JSON.stringify(authoritativeQuote?.workflow || {})
          === JSON.stringify(candidate.quote?.workflow || {});
      const beforeDraftAtISO = String(candidate.quote?.lifecycle?.draftAtISO || "").trim();
      const afterDraftAtISO = String(authoritativeQuote?.lifecycle?.draftAtISO || "").trim();
      const lifecycleMatches = (
        expectedEffects?.lifecycle?.draftAtPreserved === true
          ? Boolean(beforeDraftAtISO) && afterDraftAtISO === beforeDraftAtISO
          : expectedEffects?.lifecycle?.draftAtAssignedIfMissing === true
            && Number.isFinite(Date.parse(afterDraftAtISO))
      ) && Number.isFinite(Date.parse(authoritativeQuote?.lifecycle?.editedAtISO || ""));
      const terminalEvidenceMatches = [
        "acceptanceReceipt",
        "portalDecision",
        "booking",
        "payment"
      ].every((field) => (
        JSON.stringify(authoritativeQuote?.[field] || {})
          === JSON.stringify(candidate.quote?.[field] || {})
      ));
      if (
        String(authoritativeQuote?.id || "").trim() !== String(request.quoteId || "").trim()
        || String(authoritativeQuote?.organizationId || request.organizationId || "").trim()
          !== String(request.organizationId || "").trim()
        || readbackRevisionId !== String(result.activeVersionId || "").trim()
        || readbackRevisionId !== persistenceReceipt.activeVersionId
        || readbackStyle !== String(request.patch?.event?.style || "").trim()
        || String(authoritativeQuote?.status || "").trim().toLowerCase()
          !== String(expectedEffects?.status?.after || "").trim().toLowerCase()
        || Number(authoritativeQuote?.latestVersionNumber || 0)
          !== persistenceReceipt.latestVersionNumber
        || String(authoritativeQuote?.portalKey || "").trim() !== persistenceReceipt.portalKey
        || String(authoritativeQuote?.portalIssuedAtISO || "").trim()
          !== persistenceReceipt.portalIssuedAtISO
        || String(authoritativeQuote?.portalExpiresAtISO || "").trim()
          !== persistenceReceipt.portalExpiresAtISO
        || !staffingMatches
        || !proposalWorkflowMatches
        || !lifecycleMatches
        || !terminalEvidenceMatches
        || !Number.isFinite(readbackTotal)
        || !Number.isFinite(expectedTotal)
        || Math.abs(readbackTotal - expectedTotal) >= 0.005
        || !Number.isFinite(readbackDeposit)
        || !Number.isFinite(expectedDeposit)
        || Math.abs(readbackDeposit - expectedDeposit) >= 0.005
      ) {
        return quickUpdateFailure(
          "uncertain",
          "readback-mismatch",
          "The write returned, but the authoritative quote readback did not match its receipt.",
          "Keep this result open and reconcile the saved opportunity before submitting anything again.",
          { action: "reconcile_only", label: "Reconcile in quote editor", retryable: false }
        );
      }
      return {
        status: "persisted",
        receipt: {
          ...persistenceReceipt,
          activeVersionId: readbackRevisionId,
          quoteNumber: String(result.quoteNumber || authoritativeQuote.quoteNumber || "")
        },
        quote: authoritativeQuote
      };
    } catch (error) {
      recordDiagnosticError(error, {
        surface: "quick-updates",
        action: "save-service-style",
        quoteId: request.quoteId
      });
      const code = String(error?.code || "").replace(/^functions\//u, "") || "unknown";
      const definitive = [
        "aborted",
        "already-exists",
        "failed-precondition",
        "invalid-argument",
        "not-found",
        "permission-denied"
      ].includes(code);
      const conflict = code === "aborted" || code === "conflict"
        || /changed after|reload the current saved version/iu.test(String(error?.message || ""));
      if (persistenceReceipt) {
        return quickUpdateFailure(
          "uncertain",
          code,
          error?.message || "The write returned, but its authoritative readback did not complete.",
          "Reconcile the authoritative opportunity before submitting anything again.",
          { action: "reconcile_only", label: "Reconcile in quote editor", retryable: false }
        );
      }
      return quickUpdateFailure(
        conflict ? "conflict" : definitive ? "failed" : "uncertain",
        code,
        error?.message || "The Quick Updates save did not return a confirmed result.",
        conflict
          ? "Reload the opportunity before reviewing a new draft."
          : definitive
            ? "Correct the stated problem and retry this retained draft."
            : "Reconcile the authoritative opportunity before submitting this request again.",
        conflict || definitive
          ? {}
          : { action: "reconcile_only", label: "Reconcile in quote editor", retryable: false }
      );
    }
  };

  const handleOpenQuickUpdatesLibrary = (handoff = {}) => {
    const quoteId = String(handoff.quoteId || handoff.opportunityId || "").trim();
    const organizationId = String(
      handoff.organizationId || authSession.organizationId || ""
    ).trim();
    const sectionId = String(handoff.sectionId || "overview").trim() || "overview";
    const label = String(
      handoff.label || handoff.opportunityLabel || "opportunity"
    ).trim() || "opportunity";
    if (!quoteId || !organizationId || organizationId !== String(authSession.organizationId || "").trim()) {
      return quickUpdateFailure(
        "failed",
        "invalid-argument",
        "The contextual Library destination is incomplete or belongs to another workspace.",
        "Keep the opportunity open and use the standalone Library only from the current workspace."
      );
    }
    const arrival = createWorkspaceArrivalHandoff({
      destination: "library",
      object: { id: organizationId, type: "organization-library" },
      focus: { sectionId, quoteId },
      intentId: "browse_library"
    });
    if (!arrival.ok) return { status: "failed", ...arrival.recovery };
    setLibraryContextualOrigin({
      quoteId,
      organizationId,
      label,
      sectionId,
      returnLabel: `Return to ${label}`
    });
    navigateWorkspace(arrival.navigation.path, {
      state: arrival.navigation.state,
      bypassQuickUpdatesGuard: true,
      quickUpdatesReason: "library",
      preserveReturnContext: true,
      returnContextSurfaceId: "ambient-library",
      returnContextHint: {
        focus: {
          kind: "quick-updates",
          objectId: quoteId,
          actionId: "open-quick-updates"
        }
      }
    });
    return { status: "pending", contract: arrival.contract };
  };

  const handleEditQuote = async (
    quote,
    {
      navigateToRoute = true,
      draftPatch = null,
      draftIntent = null,
      ambientCatalogContext = null,
      attendanceSubmission = null
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
    if (attendanceSubmission && (
      !EVENT_OPERATING_SPINE_UI_ENABLED || catalog.settings?.eventOperatingSpineEnabled !== true
      || attendanceSubmission.organizationId !== authSession.organizationId || attendanceSubmission.quoteId !== quote.id
      || attendanceSubmission.sourceVersionId !== (quote.activeVersionId || quote.versionMeta?.versionId)
      || attendanceSubmission.acceptanceReceiptId !== quote.acceptanceReceipt?.receiptId
      || !Number.isInteger(attendanceSubmission.count) || attendanceSubmission.count < 1 || attendanceSubmission.count > 400
    )) return { status: "recovery", reason: "The submitted count no longer matches the selected accepted quote. Refresh attendance before review." };
    const stagedDraftFields = attendanceSubmission ? [...new Set([...draftRuntime.stagedFields, "guests"])] : draftRuntime.stagedFields;
    resetChangeImpactPreview();
    clearPilotScenarioDraftReview();
    setGlobalEventTypeId(draftRuntime.eventTypeId);
    setAttendanceChange(attendanceSubmission);
    setForm(attendanceSubmission ? { ...draftRuntime.form, guests: attendanceSubmission.count } : draftRuntime.form);
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
      message: attendanceSubmission
        ? `Submitted count ${attendanceSubmission.count} is staged for commercial review. Preview and explicitly apply it; no attendance confirmation or price change has been saved.`
        : safeArrivalContext
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
    setDraftRecoveryResumed(false);
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
      clearWorkspaceTaskJourney(authSession.organizationId);
      setWorkspaceTaskJourney(null);
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
      setCatalogModalInteraction(EMPTY_LIBRARY_INTERACTION);
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
      <div className="app-shell portal-app-shell" style={appThemeVars}>
        <RecoverableErrorBoundary
          active
          surfaceName="Customer portal"
          surfaceKind="route"
          onRetry={CustomerPortalView.retry}
          onClose={closePortalMode}
        >
          <Suspense fallback={(
            <main className="auth-shell container" role="status" aria-live="polite">
              <WorkspaceStatusCard>
                <h1>Opening Customer Portal</h1>
                <p className="muted">Loading this customer-safe view…</p>
              </WorkspaceStatusCard>
            </main>
          )}>
            <CustomerPortalView
              initialPortalKey={portalKey}
              initialPaymentReturn={paymentReturn}
              onBackToStaff={closePortalMode}
            />
          </Suspense>
        </RecoverableErrorBoundary>
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

  // Keep Catalog Admin inside the setup branch so it receives the setup-only
  // save guard and starter eligibility contract. Import Studio is rendered by
  // the ordinary workspace branch, so that overlay still suppresses the gate.
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
              initialTab={adminInitialTab}
              selectedEventType={globalEventTypeId}
              onEventTypeChange={setGlobalEventTypeId}
              onInteractionStateChange={setCatalogModalInteraction}
              onToast={pushToast}
              inventoryRecipeExtension={inventoryRecipeExtension}
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
    enabled: Boolean(authSession.organizationId),
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
      onToast: pushToast,
      inventoryRecipeExtension
    },
    route: {
      mounted: catalogRouteMounted,
      open: catalogRouteOpen,
      component: AMBIENT_UI_ENABLED && AmbientLibraryRoute ? AmbientLibraryRoute : AdminCatalogView,
      props: {
        selectedEventType: globalEventTypeId,
        onEventTypeChange: setGlobalEventTypeId,
        currentUserRole: authSession.role,
        principalId: authSession.user?.uid || "",
        workflowStudioEnabled: EVENT_OPERATING_SPINE_UI_ENABLED && catalog.settings?.eventOperatingSpineEnabled === true,
        workflowSource: ["firebase", "firebase-org"].includes(catalog.source) ? "firebase" : catalog.source,
        inventoryRecipeAccess: {
          browserEnabled: INVENTORY_AUTHORITY_UI_ENABLED,
          tenantEnabled: inventoryTenantEnabled
        },
        inventoryRecipeExtension,
        arrivalContext: workspaceArrivalContext?.surfaceId === "ambient-library"
          ? workspaceArrivalContext
          : null,
        arrivalAttempted: workspaceArrivalAttempted,
        onArrivalResolution: handleWorkspaceArrivalResolution,
        onInteractionStateChange: setCatalogRouteInteraction,
        contextualOrigin: libraryContextualOrigin
          && libraryContextualOrigin.organizationId === String(authSession.organizationId || "").trim()
          && workspaceArrivalContext?.surfaceId === "ambient-library"
          && workspaceArrivalContext?.intentId === "browse_library" ? {
            ...libraryContextualOrigin,
            onReturn: (context = libraryContextualOrigin) => {
              const quoteId = String(context?.quoteId || libraryContextualOrigin.quoteId || "").trim();
              if (quoteId) {
                returnToWorkspaceOrigin(buildQuotePath(quoteId), {
                  targetRouteId: WORKSPACE_ROUTE_IDS.QUOTE_DETAIL
                });
              }
            }
          } : null
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
  const inventoryTool = {
    surfaceName: "Inventory",
    component: InventoryWorkspace,
    enabled: inventoryWorkspaceEnabled,
    onClose: returnWorkspaceHome,
    surfaceProps: {
      organizationId: authSession.organizationId,
      role: authSession.role,
      browserEnabled: INVENTORY_AUTHORITY_UI_ENABLED,
      tenantEnabled: inventoryTenantEnabled
    },
    route: { mounted: inventoryRouteMounted, open: inventoryRouteOpen },
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
      catalogContext: {
        eventTypeId: globalEventTypeId,
        eventTypes: catalog.eventTypes || [],
        packages: catalog.packages || [],
        addons: catalog.addons || [],
        rentals: catalog.rentals || [],
        menuSections: effectiveMenuSections
      },
      onReload: () => catalog.reload({ background: true }),
      onReviewCatalog: (result) => {
        const importType = String(result?.importType || "");
        const reviewTab = ["eventTypes", "menuCategories", "menuItems"].includes(importType)
          ? "menu"
          : ["packages", "addons", "rentals"].includes(importType)
            ? importType
            : "starter";
        setImportStudioOpen(false);
        openRoutedWorkspaceTool(WORKSPACE_PATHS.catalog, setAdminOpen, {
          beforeOpen: () => {
            setLibraryContextualOrigin(null);
            setAdminInitialTab(reviewTab);
          }
        });
      },
      onImported: (result) => {
        catalog.reload({ background: true });
        if (result?.status === "published") {
          pushToast(
            `Import ${result.importBatchId} was already published in catalog revision ${result.catalogRevisionAfter ?? result.catalogRevision ?? "confirmed by the server"}.`,
            "success"
          );
        } else if (result?.status === "staged") {
          pushToast(`Added ${result?.stagedCount || 0} record(s) to the catalog setup draft.`, "success");
        } else if (result?.status === "rolled_back") {
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
      onArrivalResolution: handleWorkspaceArrivalResolution
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
      onArrivalResolution: handleWorkspaceArrivalResolution
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

  // Shared builder JSX rendered by both presentations (Proposal Composer and
  // the Guided-mode wizard) so neither mode loses the staged-change review
  // protocol or the save/availability messaging.
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
        <div data-capability-id="inventory-event-ingredient-consequence">
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
          />
        </div>
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
              workflowEnabled={EVENT_OPERATING_SPINE_UI_ENABLED && catalog.settings?.eventOperatingSpineEnabled === true}
              principalId={authSession.user?.uid || ""}
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
              onRetry={() => handlePreviewChangeImpact({ recovery: true })}
              onRequestAuthorization={handleRequestChangeAuthorization}
              onRefreshAuthorization={handleRefreshChangeAuthorization}
              onAuthorize={handleAuthorizeChange}
              onApply={handleApplyCommercialChange}
              onReconcileApplyOutcome={handleReconcileCommercialChangeApplyOutcome}
              onRecoverApply={handleRecoverCommercialChangeApply}
              unifiedReview={unifiedConsequenceReview}
              onApplyAllConsequences={handleApplyUnifiedConsequences}
              onApplySelectedConsequences={handleApplyUnifiedConsequences}
              onKeepQuotedPlan={handleKeepUnifiedQuotedPlan}
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
        pilotScenarioReviewPending: Boolean(
          pilotScenarioDraftReview && pilotScenarioReviewResolution === "pending_review"
        ),
        draftIntentReviewPending: Boolean(
          ambientDraftIntentReview && ambientDraftReviewResolution === "pending_review"
        ),
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
      touchedFields={touchedFields}
      quoteDirty={quoteDirty}
      saving={submitState.saving}
      saveLabel={submitState.saving
        ? (isEditingQuote ? "Saving Changes..." : "Saving Draft...")
        : (isEditingQuote ? (ambientDraftOutcomeSaveLabel || "Save Changes") : "Save draft")}
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
        inventoryAuthority: inventoryWorkspaceEnabled,
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
        onEvents: () => navigateWorkspace(WORKSPACE_PATHS.events),
        onClearDeck: () => navigateWorkspace(WORKSPACE_PATHS.clearDeck),
        onOperations: eventScheduleEnabled
          ? () => navigateWorkspace(WORKSPACE_PATHS.operations)
          : undefined,
        onInventory: inventoryWorkspaceEnabled
          ? () => navigateWorkspace(WORKSPACE_PATHS.inventory)
          : undefined,
        onMessages: () => navigateWorkspace(WORKSPACE_PATHS.messaging),
        onWorkflow: () => navigateWorkspace(WORKSPACE_PATHS.workflow),
        onStaff: () => navigateWorkspace(WORKSPACE_PATHS.staff),
        onSchedule: eventScheduleEnabled
          ? (menuTriggerRef) => openRoutedWorkspaceTool(
              WORKSPACE_PATHS.schedule,
              setScheduleOpen,
              { menuTriggerRef }
            )
          : undefined,
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
          {
            menuTriggerRef,
            beforeOpen: () => {
              setLibraryContextualOrigin(null);
              setAdminInitialTab("");
            }
          }
        ),
        onDiagnostics: (menuTriggerRef) => openRoutedWorkspaceTool(
          WORKSPACE_PATHS.diagnostics,
          setDiagnosticsOpen,
          { menuTriggerRef }
        ),
        onPortal: openPortalMode,
        onPilot: AMBIENT_UI_ENABLED ? openGlobalPilot : undefined,
        onRequestPasswordReset: () => requestPasswordReset({
          email: authSession.user?.email || ""
        }),
        onWorkspaceToolsGuardChange: handleWorkspaceToolsGuardChange,
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

      {AMBIENT_UI_ENABLED && returnContextStatus && (
        <div
          className={returnContextStatus.state === "restoring"
            ? "sr-only"
            : "workspace-arrival-context source-note"}
          data-workspace-return-state={returnContextStatus.state}
          data-arrival-state={returnContextStatus.state === "restored" ? "resolved" : returnContextStatus.state}
          role="status"
          aria-live="polite"
          data-surface-purpose="clarify reveal_context"
        >
          {returnContextStatus.message || (returnContextStatus.state === "restoring"
            ? "Restoring your previous place."
            : "")}
        </div>
      )}

      {AMBIENT_UI_ENABLED && (currentWorkspaceActionFeedback || activeWorkspaceTaskJourney) && (
        <div
          className="workspace-continuity-stack"
          data-workspace-continuity-stack="true"
        >
          {currentWorkspaceActionFeedback && (
            <WorkspaceActionFeedbackNotice
              feedback={currentWorkspaceActionFeedback}
              onNextAction={handleWorkspaceActionFeedbackNextAction}
              onAcknowledge={acknowledgeWorkspaceActionFeedback}
              nextActionResolved={workspaceActionFeedbackNextActionResolved}
            />
          )}
          {activeWorkspaceTaskJourney && (
            <WorkspaceTaskJourneyNotice
              journey={activeWorkspaceTaskJourney}
              currentRouteId={browserRoute.routeId}
              onContinue={continueWorkspaceTaskJourney}
              onStopTracking={stopTrackingWorkspaceTask}
            />
          )}
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
                  onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
                  onOpenCalendar={eventScheduleEnabled
                    ? (quoteId) => navigateAmbientCalendar(quoteId, {
                        actionId: `open-now-calendar:${quoteId}`
                      })
                    : undefined}
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

      {CUSTOMER_CENTERED_WORKSPACE_ENABLED && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CLEAR_DECK && (
        <WorkspaceLazyRoute surfaceName="Clear the Deck" component={ClearDeckView}>
          <ClearDeckView
            snapshot={commercialSnapshot}
            organizationName={organizationName}
            organizationId={authSession.organizationId}
            onRefresh={commercialSnapshot.refresh}
            onOpenWorkflow={AMBIENT_UI_ENABLED
              ? openAmbientWorkflow
              : (target = {}) => navigateWorkspace(buildWorkflowPath(target))}
          />
        </WorkspaceLazyRoute>
      )}

      {CUSTOMER_CENTERED_WORKSPACE_ENABLED && [
        WORKSPACE_ROUTE_IDS.EVENT_LIST,
        WORKSPACE_ROUTE_IDS.EVENT_DETAIL,
        WORKSPACE_ROUTE_IDS.EVENT_LIVE,
        WORKSPACE_ROUTE_IDS.EVENT_REPLAY
      ].includes(resolvedWorkspaceRouteId) && (
        <WorkspaceLazyRoute surfaceName="Events" component={EventPlanningView}>
          <EventPlanningView
            principalId={authSession.user?.uid || ""}
            role={authSession.role}
            eventOperationsEnabled={EVENT_OPERATING_SPINE_UI_ENABLED && catalog.settings?.eventOperatingSpineEnabled === true}
            snapshot={commercialSnapshot}
            organizationName={organizationName}
            organizationId={authSession.organizationId}
            tenantTimeZone={tenantTimeZone}
            scheduleAvailable={eventScheduleEnabled && AMBIENT_UI_ENABLED}
            scheduleCapacityLimit={scheduleCapacityLimit}
            routeMode={resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.EVENT_LIVE
              ? "live"
              : resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.EVENT_REPLAY
                ? "replay"
                : resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.EVENT_DETAIL
                  ? "detail"
                  : "list"}
            quoteId={browserRoute.params?.quoteId || ""}
            onRefresh={commercialSnapshot.refresh}
            onOpenEvent={(quoteId) => navigateWorkspace(buildEventPath(quoteId))}
            onOpenQuote={(quoteId) => navigateWorkspace(buildQuotePath(quoteId))}
            onOpenLive={(quoteId) => navigateWorkspace(buildEventLivePath(quoteId))}
            onOpenReplay={(quoteId) => navigateWorkspace(buildEventReplayPath(quoteId))}
            onOpenCustomer={(customerId) => navigateWorkspace(buildCustomerPath(customerId))}
            onOpenWorkflow={AMBIENT_UI_ENABLED
              ? openAmbientWorkflow
              : (target = {}) => navigateWorkspace(buildWorkflowPath(target))}
            onOpenSchedule={eventScheduleEnabled ? navigateEventSchedule : undefined}
            onOpenOperations={eventScheduleEnabled
              ? () => navigateWorkspace(WORKSPACE_PATHS.operations)
              : undefined}
            onOpenEvents={() => navigateWorkspace(WORKSPACE_PATHS.events)}
            onOpenOpportunities={() => navigateWorkspace(WORKSPACE_PATHS.quotes)}
            onStartOpportunity={handleGetInstantQuote}
          />
        </WorkspaceLazyRoute>
      )}

      {CUSTOMER_CENTERED_WORKSPACE_ENABLED
        && eventScheduleEnabled
        && resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.OPERATIONS && (
        <WorkspaceLazyRoute surfaceName="Operations" component={EventScheduleView}>
          <EventScheduleView
            open
            presentation="embedded"
            surfaceTitle="Operations"
            surfaceEyebrow="Calendar-first operations"
            organizationId={authSession.organizationId}
            staffLeads={scheduleStaffLeads}
            capacityLimit={scheduleCapacityLimit}
            currentUserEmail={currentUserEmail}
            arrivalContext={workspaceArrivalContext?.surfaceId === "schedule"
              ? workspaceArrivalContext
              : null}
            onArrivalResolution={handleWorkspaceArrivalResolution}
            onClose={() => navigateWorkspace(WORKSPACE_PATHS.home)}
            onOpenOpportunity={(quoteId) => navigateAmbientOpportunity({
              quoteId,
              actionId: `open-calendar-opportunity:${quoteId}`
            })}
            onOpenPeople={authSession.isAdmin && OPERATIONAL_STAFFING_UI_ENABLED
              ? () => navigateWorkspace(WORKSPACE_PATHS.staff)
              : undefined}
            onOpenReporting={dashboardEnabled
              ? () => navigateWorkspace(WORKSPACE_PATHS.reporting)
              : undefined}
          />
        </WorkspaceLazyRoute>
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
            onBack={() => returnToWorkspaceOrigin(WORKSPACE_PATHS.customers)}
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
            onOpenSchedule={eventScheduleEnabled
              ? (quoteId) => quoteId
                  ? navigateAmbientCalendar(quoteId)
                  : navigateWorkspace(WORKSPACE_PATHS.operations)
              : undefined}
            scheduleAvailable={eventScheduleEnabled}
            tenantTimeZone={tenantTimeZone}
            isAdmin={authSession.isAdmin}
            currentUserRole={authSession.role}
            currentUserUid={authSession.user?.uid || ""}
            workflowEnabled={EVENT_OPERATING_SPINE_UI_ENABLED && catalog.settings?.eventOperatingSpineEnabled === true}
            ambientMode={AMBIENT_UI_ENABLED}
            arrivalContext={workspaceArrivalContext?.surfaceId === "client-overview"
              ? workspaceArrivalContext
              : null}
            arrivalAttempted={workspaceArrivalAttempted}
            onArrivalResolution={handleWorkspaceArrivalResolution}
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
              onArrivalResolution={handleWorkspaceArrivalResolution}
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

      {AMBIENT_UI_ENABLED && eventScheduleEnabled && workspaceArrivalContext?.surfaceId === "schedule" && (
        <WorkspaceArrivalNotice
          context={workspaceArrivalContext}
          resolution={workspaceArrivalResolution}
          fallbackSurfaceId="schedule"
        />
      )}

      {renderWorkspaceTools("route", [
        staffTool,
        inventoryTool,
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
              : resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.INVENTORY
                ? !authSession.isAdmin
                  ? "role-denied"
                  : "feature-disabled"
              : resolvedWorkspaceRouteId === WORKSPACE_ROUTE_IDS.CATALOG
                && !authSession.isAdmin
                && !AMBIENT_UI_ENABLED
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
        className={proposalComposerActive ? "container pc-shell" : "container wizard-grid"}
        ref={wizardRef}
        tabIndex={-1}
        hidden={!quoteBuilderActive || Boolean(quoteEditRouteId && !quoteEditReady)}
        aria-hidden={!quoteBuilderActive || Boolean(quoteEditRouteId && !quoteEditReady)}
      >
        {isEditingQuote && (
          <QuoteCatalogRevisionReviewPanel
            review={catalogRevisionReview.review}
            loading={catalogRevisionReview.loading}
            error={catalogRevisionReview.error}
            submitting={catalogRevisionReview.submitting}
            resolvedOutcome={catalogRevisionReview.outcome}
            receipt={catalogRevisionReview.receipt}
            onRetry={loadQuoteCatalogRevisionReview}
            onKeepQuotedValues={() => handleCatalogReviewOutcome("keep_quoted_values")}
            onReviewAndUpdate={() => handleCatalogReviewOutcome("review_and_update")}
          />
        )}
        {PILOT_COMMAND_ENABLED
          && PilotCommandBar
          && pilotCommandSurfaceOpen
          && (
            Boolean(editingQuote.id)
            || Object.keys(touchedFields).length > 0
            || draftRecoveryResumed
            || globalPilotRequest?.target === "draft_command"
          ) && (
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
                    {submitState.saving
                      ? (isEditingQuote ? "Saving Changes..." : "Saving Draft...")
                      : (isEditingQuote ? (ambientDraftOutcomeSaveLabel || "Save Changes") : "Save draft")}
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
        {AMBIENT_UI_ENABLED && quoteAdministrationArrival && (
          <WorkspaceArrivalNotice
            context={quoteAdministrationArrival}
            resolution={workspaceArrivalResolution}
            fallbackSurfaceId="quote-administration"
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
            attendanceEnabled={EVENT_OPERATING_SPINE_UI_ENABLED && catalog.settings?.eventOperatingSpineEnabled === true}
            tenantTimeZone={tenantTimeZone}
            serviceStyles={Object.keys(STAFF_RULES)}
            ambientPricingCatalog={AMBIENT_UI_ENABLED ? catalog : null}
            ambientPricingSettings={AMBIENT_UI_ENABLED ? effectiveSettings : null}
            globalPilotRequest={AMBIENT_UI_ENABLED && globalPilotRequest?.target === "living_opportunity"
              ? globalPilotRequest
              : null}
            globalPilotReturnFocusRef={AMBIENT_UI_ENABLED ? globalPilotTriggerRef : null}
            onGlobalPilotResolution={AMBIENT_UI_ENABLED ? handleGlobalPilotResolution : undefined}
            focusQuoteId={historyFocusQuoteId}
            focusAction={historyFocusAction}
            focusReason={historyFocusReason}
            arrivalContext={workspaceArrivalContext?.surfaceId === "living-opportunity"
              || workspaceArrivalContext?.surfaceId === "quote-administration"
              ? workspaceArrivalContext
              : null}
            onArrivalResolution={handleWorkspaceArrivalResolution}
            onPreviewQuickUpdate={AMBIENT_UI_ENABLED ? handlePreviewQuickUpdate : undefined}
            onSaveQuickUpdate={AMBIENT_UI_ENABLED ? handleSaveQuickUpdate : undefined}
            onOpenQuickUpdatesLibrary={AMBIENT_UI_ENABLED && authSession.isAdmin
              ? handleOpenQuickUpdatesLibrary
              : undefined}
            onQuickUpdatesGuardChange={AMBIENT_UI_ENABLED
              ? handleQuickUpdatesGuardChange
              : undefined}
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
              returnToWorkspaceOrigin(WORKSPACE_PATHS.quotes);
            }}
            onOpenSchedule={eventScheduleEnabled
              ? (quoteId) => quoteId
                  ? navigateAmbientCalendar(quoteId)
                  : navigateWorkspace(WORKSPACE_PATHS.operations)
              : undefined}
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
            onOpenQuoteAdministration={(quoteId, context = {}) => {
              const normalizedQuoteId = String(quoteId || "").trim();
              if (!normalizedQuoteId) {
                return {
                  status: "recovery",
                  reason: "The exact quote could not be identified.",
                  consequence: "The current opportunity remains open and unchanged.",
                  nextResolution: "Return to Opportunities and reopen the exact quote."
                };
              }
              return navigateAmbientQuoteAdministration(normalizedQuoteId, context);
            }}
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
            arrivalContext={workspaceArrivalContext?.surfaceId === "workflow"
              ? workspaceArrivalContext
              : null}
            onArrivalResolution={handleWorkspaceArrivalResolution}
            activeTaskJourney={workflowTaskJourney}
            onTaskOutcome={handleWorkspaceTaskOutcome}
            onReturnToOrigin={() => returnToWorkspaceOrigin(workflowReturnFallback)}
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
