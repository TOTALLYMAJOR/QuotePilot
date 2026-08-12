import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChatCenteredDots,
  CheckCircle,
  CurrencyDollar,
  FileText,
  ForkKnife,
  Info,
  Package,
  Sparkle,
  UserGear,
  UsersThree,
  Wallet,
  WarningCircle
} from "@phosphor-icons/react";
import StatusChip from "./StatusChip";
import { useAmbientContext } from "../context/AmbientContext";
import { createAmbientActionResult } from "../lib/ambientContracts";
import { createAmbientActionMonitor } from "../lib/ambientInteractionAudit";
import {
  createAmbientMenuReorderIntent,
  createAmbientMenuReplacementIntent,
  createAmbientPackageReplacementIntent
} from "../lib/ambientPackageMenuObjects";
import {
  applyAmbientSelectionScenarioStep,
  selectionScenarioQuantity
} from "../lib/ambientSelectionObjects";
import {
  recordProductAnalyticsAmbientAssessment,
  recordProductAnalyticsIssueResolved,
  recordProductAnalyticsIssueSurfaced,
  resetProductAnalyticsIssueObservationState
} from "../lib/productAnalytics";
import {
  AmbientSelectionObjects,
  AmbientUndoRail,
  ContextSurface,
  InlineValue,
  createAmbientFeedbackEvent,
  createAmbientUndoModel,
  routeAmbientFeedback,
  useAmbientActionRuntime
} from "./ambient";
import {
  buildAmbientLivingOpportunityPresentation,
  validateAmbientGuestCount
} from "./ambientLivingOpportunityPresentation";
import AmbientMoneyContext from "./AmbientMoneyContext";
import AmbientConversationContext from "./AmbientConversationContext";
import AmbientProposalContext from "./AmbientProposalContext";
import "./ambientLivingOpportunity.css";

const AMBIENT_INTERACTION_EVENT_NAME = "quotepilot:ambient-interaction";
const OPERATIONAL_STAFFING_UI_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_OPERATIONAL_STAFFING_ENABLED || "").trim().toLowerCase()
);
const OperationalStaffingPanel = OPERATIONAL_STAFFING_UI_ENABLED
  ? lazy(() => import("./OperationalStaffingPanel"))
  : null;
const EMPTY_INTERACTION_HEALTH = Object.freeze({
  observedActionCount: 0,
  deadClickCount: 0,
  deadClickRate: 0,
  maxAcknowledgementMs: null
});
const EMPTY_PRICING_PREVIEW_STATE = Object.freeze({
  status: "idle",
  preview: null,
  marginContext: null,
  error: "",
  requestId: ""
});
const EVENT_LOGISTICS_UI = Object.freeze({
  date: Object.freeze({ inspect: "inspectEventDate", stage: "stageEventDate", dismiss: "dismissEventDateContext" }),
  time: Object.freeze({ inspect: "inspectEventTime", stage: "stageEventTime", dismiss: "dismissEventTimeContext" }),
  duration: Object.freeze({ inspect: "inspectEventDuration", stage: "stageEventDuration", dismiss: "dismissEventDurationContext" }),
  venue: Object.freeze({ inspect: "inspectEventVenue", stage: "stageEventVenue", dismiss: "dismissEventVenueContext" })
});
const EVENT_LOGISTICS_KINDS = Object.freeze(Object.keys(EVENT_LOGISTICS_UI));

function money(value) {
  if (value === null || value === undefined || value === "") return "Amount unavailable";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Amount unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function pricingCapabilityState(state, preview) {
  if (state === "loading") return "submitting";
  if (state === "recovery") return "reconciliation";
  if (state === "success") return preview?.receipt ? "receipt" : "ready";
  if (state === "error") return "error";
  return "ready";
}

function proposalStateLabel(state) {
  const labels = {
    current: "current details",
    needs_resolution: "needs attention",
    stale: "needs refresh",
    unavailable: "not available",
    local_preview: "unsaved preview"
  };
  return labels[String(state || "").trim().toLowerCase()] || "not available";
}

function conversationStateLabel(state) {
  const labels = {
    attention: "needs attention",
    current: "current details",
    needs_reconciliation: "needs reconciliation",
    stale: "needs refresh",
    unavailable: "not available",
    local_preview: "unsaved preview"
  };
  return labels[String(state || "").trim().toLowerCase()] || "not available";
}

const CATALOG_STATE_LABELS = /* @__PURE__ */ Object.freeze({
  current: "Current",
  fresh: "Current",
  stale: "Needs refresh",
  unknown: "Not confirmed",
  unavailable: "Unavailable",
  partial: "Needs review",
  available: "Available",
  matched_current: "Current",
  matched_stale: "Needs refresh",
  matched_unknown: "Not confirmed",
  missing: "Not found in the current catalog",
  name_changed: "Name changed"
});

function catalogStateLabel(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (CATALOG_STATE_LABELS[normalized]) return CATALOG_STATE_LABELS[normalized];
  if (!normalized) return "Not confirmed";
  return normalized
    .replace(/[_-]+/gu, " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

function catalogContextSummary(context = {}) {
  const state = String(context.state || "").trim().toLowerCase();
  const version = Number.isSafeInteger(context.catalogRevision)
    ? context.catalogRevision
    : null;
  if (["current", "fresh"].includes(state)) {
    return version === null
      ? "Matched to the current catalog."
      : `Matched to catalog version ${version}.`;
  }
  return version === null
    ? `Catalog match: ${catalogStateLabel(state)}.`
    : `Catalog version ${version}: ${catalogStateLabel(state)}.`;
}

function hasExactEventLogisticsStaging(descriptor) {
  return Boolean(
    descriptor?.savedValue?.state === "available"
    && descriptor?.permissions?.stage === true
    && descriptor?.staging?.authority === "draft_only"
    && descriptor?.staging?.commit === false
    && descriptor?.staging?.target?.objectId === descriptor.id
    && Array.isArray(descriptor?.staging?.target?.fieldPaths)
    && descriptor.staging.target.fieldPaths.length > 0
  );
}

function staffingLabel({ servers = 0, chefs = 0, bartenders = 0 } = {}) {
  const label = (value, singular) => `${value} ${Number(value) === 1 ? singular : `${singular}s`}`;
  return [label(servers, "server"), label(chefs, "chef"), label(bartenders, "bartender")].join(" · ");
}

function MomentumDimension({ item }) {
  return (
    <div
      className="ambient-momentum-dimension"
      data-state={item.state}
      data-momentum-domain={item.kind}
      data-ambient-feedback-dependent
    >
      <dt>{item.label}</dt>
      <dd>
        <span>{item.value}</span>
        <small>{item.detail}</small>
      </dd>
    </div>
  );
}

function ActionAcknowledgement({ value }) {
  if (!value) return null;
  return (
    <div
      className="ambient-action-acknowledgement"
      data-result-kind={value.kind}
      role="status"
      aria-live="polite"
    >
      <strong>{value.label}</strong>
      <span>{value.consequence}</span>
      <small>{value.nextResolutions[0]?.label}</small>
    </div>
  );
}

function EventLogisticsValue({ kind, descriptor, action, triggerRef, onInspect }) {
  const content = (
    <>
      <span>{descriptor.label.replace(/^Event /u, "")}</span>
      <strong>{descriptor.savedValue.displayValue}</strong>
    </>
  );
  if (!action?.enabled) {
    return (
      <span
        className="ambient-event-logistics-value"
        data-event-logistics-kind={kind}
        data-saved-value-state={descriptor.savedValue.state}
      >
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="ambient-event-logistics-value"
      ref={triggerRef}
      onClick={() => onInspect(kind, triggerRef)}
      aria-haspopup="dialog"
      aria-label={`${action.outcomeLabel}: ${descriptor.savedValue.displayValue}`}
      data-event-logistics-kind={kind}
      data-saved-value-state={descriptor.savedValue.state}
      data-surface-purpose="clarify reveal_context"
      data-ambient-action-id={action.id}
    >
      {content}
    </button>
  );
}

function DisclosureFacts({ items }) {
  return (
    <dl className="ambient-disclosure-facts">
      {items.map((item) => (
        <div key={item.id} className="ambient-disclosure-fact" data-state={item.state}>
          <dt>{item.label}</dt>
          <dd>
            <span>{item.value}</span>
            <small>{item.detail}</small>
          </dd>
        </div>
      ))}
    </dl>
  );
}

const AmbientLivingOpportunity = forwardRef(function AmbientLivingOpportunity({
  quote,
  source,
  ordinaryEditAllowed = false,
  conversationAvailable = false,
  pricingPreviewAvailable = false,
  pricingMargin = null,
  packageMenuCatalogEvidence = null,
  eventLogisticsEvidence = null,
  onBackToQuotes,
  onEditQuote,
  onSimulatePricing,
  onOpenWorkflow,
  onOpenConversation,
  onOpenLegacyWorkspace,
  arrivalContext = null,
  onArrivalResolution = null,
  globalPilotRequest = null,
  globalPilotReturnFocusRef = null,
  onGlobalPilotResolution = null
}, forwardedRef) {
  const ambientContext = useAmbientContext({ optional: true });
  const rootRef = useRef(null);
  const guestInlineRef = useRef(null);
  const guestInspectRef = useRef(null);
  const staffingInspectRef = useRef(null);
  const pricingInspectRef = useRef(null);
  const moneyInspectRef = useRef(null);
  const conversationInspectRef = useRef(null);
  const proposalInspectRef = useRef(null);
  const packageInspectRef = useRef(null);
  const menuInspectRef = useRef(null);
  const selectionInspectRef = useRef(null);
  const pilotTriggerRef = useRef(null);
  const pilotContextAnchorRef = useRef(null);
  const eventLogisticsTriggerRefs = useRef(Object.fromEntries(
    EVENT_LOGISTICS_KINDS.map((kind) => [kind, { current: null }])
  ));
  const mobileEventLogisticsTriggerRefs = useRef(Object.fromEntries(
    EVENT_LOGISTICS_KINDS.map((kind) => [kind, { current: null }])
  ));
  const activeEventLogisticsTriggerRef = useRef(null);
  const mobileEventDetailsRef = useRef(null);
  const operationalFactsRef = useRef(null);
  const supportingEvidenceRef = useRef(null);
  const interactionMonitor = useMemo(() => createAmbientActionMonitor(), []);
  const undoModel = useMemo(() => createAmbientUndoModel({ limit: 5 }), []);
  const observedRiskRef = useRef({ quoteId: "", issueCategory: "" });
  const ambientRole = String(ambientContext?.role || "non_staff").trim().toLowerCase() || "non_staff";
  const proposalSourceFreshness = String(
    ambientContext?.sourceFreshness?.state || "unknown"
  ).trim().toLowerCase() || "unknown";
  const isStaffRole = ["admin", "sales"].includes(ambientRole);
  const recordedGuestCount = Math.max(0, Math.round(Number(quote?.event?.guests) || 0));
  const recordedStaffingSignature = [
    quote?.event?.servers,
    quote?.event?.chefs,
    quote?.event?.bartenders,
    quote?.event?.style,
    quote?.activeVersionId || quote?.versionMeta?.versionId || quote?.updatedAtISO
  ].join(":");
  const recordedPricingSignature = [
    quote?.pricing?.authority,
    quote?.pricing?.calculatedAt,
    quote?.pricing?.grandTotal,
    quote?.pricing?.deposit?.amount,
    quote?.activeVersionId || quote?.versionMeta?.versionId || quote?.updatedAtISO
  ].join(":");
  const recordedSelectionSignature = JSON.stringify({
    addons: quote?.selection?.addons || [],
    rentals: quote?.selection?.rentals || [],
    addonQuantities: quote?.selection?.addonQuantities || {},
    rentalQuantities: quote?.selection?.rentalQuantities || {},
    revision: quote?.activeVersionId || quote?.versionMeta?.versionId || quote?.updatedAtISO || "",
    catalogRevision: packageMenuCatalogEvidence?.catalogRevision ?? null,
    catalogFreshness: packageMenuCatalogEvidence?.freshness?.observedAtISO || ""
  });
  const [scenarioGuestCount, setScenarioGuestCount] = useState(recordedGuestCount);
  const [staffingScenario, setStaffingScenario] = useState(null);
  const [guestOpen, setGuestOpen] = useState(false);
  const [staffingOpen, setStaffingOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [selectionScenario, setSelectionScenario] = useState({});
  const selectionScenarioRef = useRef({});
  const [menuReplacementSourceId, setMenuReplacementSourceId] = useState("");
  const menuDragItemRef = useRef("");
  const [pricingPreviewState, setPricingPreviewState] = useState(EMPTY_PRICING_PREVIEW_STATE);
  const pricingScenarioRef = useRef(recordedGuestCount);
  const [pilotOpen, setPilotOpen] = useState(false);
  const [pilotContextAlign, setPilotContextAlign] = useState("end");
  const [eventLogisticsOpenKind, setEventLogisticsOpenKind] = useState(null);
  const [mobileEventDetailsVisible, setMobileEventDetailsVisible] = useState(false);
  const [operationalFactsVisible, setOperationalFactsVisible] = useState(false);
  const [supportingEvidenceVisible, setSupportingEvidenceVisible] = useState(false);
  const [feedbackEvent, setFeedbackEvent] = useState(null);
  const [acknowledgement, setAcknowledgement] = useState(null);
  const [interactionObservation, setInteractionObservation] = useState(null);
  const handledGlobalPilotRequestRef = useRef("");
  const handledArrivalRef = useRef("");
  const pendingGlobalPilotResolutionRef = useRef(null);
  const globalPilotResolutionRef = useRef(onGlobalPilotResolution);
  const model = useMemo(() => buildAmbientLivingOpportunityPresentation(quote, {
    source,
    sourceFreshness: proposalSourceFreshness,
    ordinaryEditAllowed,
    conversationAvailable,
    conversationHandlerAvailable: typeof onOpenConversation === "function",
    workflowHandlerAvailable: typeof onOpenWorkflow === "function",
    legacyControlsAvailable: typeof onOpenLegacyWorkspace === "function",
    scenarioGuestCount,
    operationalStaffingEnabled: OPERATIONAL_STAFFING_UI_ENABLED,
    pricingPreviewAvailable: pricingPreviewAvailable && typeof onSimulatePricing === "function",
    pricingMargin,
    packageMenuCatalogEvidence,
    eventLogisticsEvidence,
    role: ambientRole
  }), [
    quote,
    source,
    ordinaryEditAllowed,
    conversationAvailable,
    pricingPreviewAvailable,
    pricingMargin,
    packageMenuCatalogEvidence,
    eventLogisticsEvidence,
    onSimulatePricing,
    onOpenConversation,
    onOpenWorkflow,
    onOpenLegacyWorkspace,
    scenarioGuestCount,
    ambientRole,
    proposalSourceFreshness
  ]);

  useEffect(() => {
    if (!arrivalContext || typeof onArrivalResolution !== "function") return undefined;
    const arrivalKey = [
      arrivalContext.modelId,
      arrivalContext.intentId,
      arrivalContext.object?.type,
      arrivalContext.object?.id,
      arrivalContext.focus?.quoteId
    ].filter(Boolean).join(":");
    if (!arrivalKey || handledArrivalRef.current === arrivalKey) return undefined;

    const exactQuoteId = String(model.identity.quoteId || "").trim();
    const activeOrganizationId = String(ambientContext?.organizationId || "").trim();
    const recordedOrganizationId = String(quote?.organizationId || "").trim();
    const exactArrival = arrivalContext.destination === "opportunity"
      && arrivalContext.surfaceId === "living-opportunity"
      && arrivalContext.focusConsumerState === "supported"
      && arrivalContext.object?.type === "opportunity"
      && String(arrivalContext.object?.id || "").trim() === exactQuoteId
      && String(arrivalContext.focus?.quoteId || "").trim() === exactQuoteId
      && (!recordedOrganizationId || recordedOrganizationId === activeOrganizationId);

    if (!exactArrival) {
      handledArrivalRef.current = arrivalKey;
      onArrivalResolution({
        status: "recovery",
        reason: "The requested opportunity does not match this exact workspace object.",
        consequence: "No alternate opportunity was selected and no record changed.",
        nextResolution: "Return to Opportunities and reopen the exact record."
      });
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = rootRef.current;
      if (!target || target.dataset.quoteId !== exactQuoteId) {
        handledArrivalRef.current = arrivalKey;
        onArrivalResolution({
          status: "recovery",
          reason: "The exact Living Opportunity could not receive focus.",
          consequence: "No alternate opportunity was selected and no record changed.",
          nextResolution: "Keep this record open and retry its exact opportunity action."
        });
        return;
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      handledArrivalRef.current = arrivalKey;
      onArrivalResolution({ status: "resolved" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ambientContext?.organizationId, arrivalContext, model.identity.quoteId, onArrivalResolution, quote?.organizationId]);

  useEffect(() => {
    globalPilotResolutionRef.current = onGlobalPilotResolution;
  }, [onGlobalPilotResolution]);
  const staffingScenarioStale = Boolean(
    staffingScenario
    && staffingScenario.basisGuestCount !== model.staffingObject.guestCount
  );
  const activeStaffing = staffingScenario || model.staffingObject.current;

  const emitFeedback = useCallback((type, options = {}) => {
    const event = createAmbientFeedbackEvent(type, {
      objectId: model.identity.quoteId,
      evidence: {
        source: "living-opportunity",
        quoteId: model.identity.quoteId
      },
      receipt: {
        kind: "ambient-action-acknowledgement",
        surfaceId: model.surface.id
      },
      ...options
    });
    setFeedbackEvent(event);
    routeAmbientFeedback(event, {
      target: rootRef.current,
      element: rootRef.current
    });
  }, [model.identity.quoteId, model.surface.id]);

  const handleInteractionRecovery = useCallback(({ label, result }) => {
    setAcknowledgement({ ...result, label });
    emitFeedback("warning");
  }, [emitFeedback]);

  const handleInteractionObservation = useCallback((observation) => {
    setInteractionObservation(observation);
    if (
      ["acknowledge", "timeout"].includes(observation?.phase)
      && observation?.primary === true
      && typeof observation?.deadClick === "boolean"
    ) {
      recordProductAnalyticsAmbientAssessment({
        primary: true,
        deadlineMs: observation.deadlineMs,
        deadClick: observation.deadClick,
        acknowledgementMs: observation.acknowledgementMs,
        resultKind: observation.resultKind
      });
    }
    if (typeof window !== "undefined" && rootRef.current) {
      rootRef.current.dispatchEvent(new CustomEvent(AMBIENT_INTERACTION_EVENT_NAME, {
        bubbles: true,
        detail: observation
      }));
    }
  }, []);

  useEffect(() => {
    const quoteId = String(model.identity.quoteId || "").trim();
    const issueCategory = model.risk.id === "no-tracked-risk" ? "" : model.risk.id;
    const previous = observedRiskRef.current;
    let shouldSurface = Boolean(issueCategory);

    if (previous.quoteId && previous.quoteId !== quoteId) {
      resetProductAnalyticsIssueObservationState();
      observedRiskRef.current = { quoteId: "", issueCategory: "" };
    }
    if (previous.quoteId === quoteId && previous.issueCategory && previous.issueCategory !== issueCategory) {
      if (!issueCategory) {
        recordProductAnalyticsIssueResolved({ issueCategory: previous.issueCategory });
        shouldSurface = false;
      } else {
        // A newly higher-ranked category can displace the prior top signal
        // without proving it resolved. Break the pair rather than inventing a
        // resolution, then begin timing only the newly visible category.
        resetProductAnalyticsIssueObservationState();
      }
    }
    if (shouldSurface && (previous.quoteId !== quoteId || previous.issueCategory !== issueCategory)) {
      recordProductAnalyticsIssueSurfaced({ issueCategory });
    }
    observedRiskRef.current = { quoteId, issueCategory };
  }, [model.identity.quoteId, model.risk.id]);

  useEffect(() => () => {
      resetProductAnalyticsIssueObservationState();
      observedRiskRef.current = { quoteId: "", issueCategory: "" };
  }, []);

  const actionRuntime = useAmbientActionRuntime({
    monitor: interactionMonitor,
    onRecovery: handleInteractionRecovery,
    onObservation: handleInteractionObservation
  });

  useEffect(() => {
    setScenarioGuestCount(recordedGuestCount);
    setStaffingScenario(null);
    setGuestOpen(false);
    setStaffingOpen(false);
    setPricingOpen(false);
    setMoneyOpen(false);
    setConversationOpen(false);
    setProposalOpen(false);
    setPackageOpen(false);
    setMenuOpen(false);
    setSelectionOpen(false);
    setSelectionScenario({});
    selectionScenarioRef.current = {};
    setMenuReplacementSourceId("");
    menuDragItemRef.current = "";
    setPricingPreviewState(EMPTY_PRICING_PREVIEW_STATE);
    pricingScenarioRef.current = recordedGuestCount;
    setPilotOpen(false);
    setEventLogisticsOpenKind(null);
    setMobileEventDetailsVisible(false);
    setOperationalFactsVisible(false);
    setSupportingEvidenceVisible(false);
    setFeedbackEvent(null);
    setAcknowledgement(null);
    setInteractionObservation(null);
    undoModel.clear();
  }, [
    quote?.id,
    recordedGuestCount,
    recordedStaffingSignature,
    recordedPricingSignature,
    recordedSelectionSignature,
    undoModel
  ]);

  useEffect(() => {
    pricingScenarioRef.current = scenarioGuestCount;
    setPricingPreviewState(EMPTY_PRICING_PREVIEW_STATE);
  }, [scenarioGuestCount]);

  useEffect(() => {
    if (operationalFactsVisible) operationalFactsRef.current?.focus();
  }, [operationalFactsVisible]);

  useEffect(() => {
    if (mobileEventDetailsVisible) mobileEventDetailsRef.current?.focus();
  }, [mobileEventDetailsVisible]);

  useEffect(() => {
    if (supportingEvidenceVisible) supportingEvidenceRef.current?.focus();
  }, [supportingEvidenceVisible]);

  const acknowledge = ({
    action,
    runtimeToken,
    kind,
    label,
    reason = action?.arrivalContract.reason,
    consequence = action?.arrivalContract.consequence,
    nextActionId,
    nextResolution,
    object = action?.arrivalContract.object || model.surface.object,
    destination = null,
    deferRuntime = false
  }) => {
    if (!action) throw new TypeError("Ambient acknowledgement requires a registered action.");
    const resolvedNextActionId = nextActionId || action.arrivalContract.nextResolutionIds[0];
    const result = createAmbientActionResult({
      kind,
      actionId: action.id,
      object,
      reason,
      consequence,
      nextResolutions: [{
        actionId: resolvedNextActionId,
        label: nextResolution
      }]
    });
    setAcknowledgement({ ...result, label });
    if (runtimeToken && !deferRuntime) {
      actionRuntime.acknowledge(runtimeToken, { result, destination });
    }
    return result;
  };

  const beginAction = (action, options) => {
    if (!action?.enabled) return null;
    return actionRuntime.begin(action, options);
  };

  const openExclusiveContext = (target) => {
    setGuestOpen(target === "guest");
    setStaffingOpen(target === "staffing");
    setPricingOpen(target === "pricing");
    setMoneyOpen(target === "money");
    setConversationOpen(target === "conversation");
    setProposalOpen(target === "proposal");
    setPackageOpen(target === "package");
    setMenuOpen(target === "menu");
    setSelectionOpen(target === "selections");
    setPilotOpen(target === "pilot");
    setEventLogisticsOpenKind(EVENT_LOGISTICS_KINDS.includes(target) ? target : null);
  };

  const openGuestContext = () => {
    const action = model.actions.inspectGuestCount;
    const runtimeToken = beginAction(action);
    openExclusiveContext("guest");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Guest count context opened",
      nextResolution: model.guestObject.preview.nextResolution,
      destination: {
        surface: model.surfaceContracts.guestContext,
        isEmpty: false
      }
    });
  };

  const openStaffingContext = () => {
    const action = model.actions.inspectStaffing;
    const runtimeToken = beginAction(action);
    openExclusiveContext("staffing");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Staffing suggestion ready",
      nextResolution: model.staffingObject.recommendationAvailable
        ? "Use the recommendation, keep the saved staffing, or review what it connects to."
        : model.staffingObject.unavailableReason,
      destination: {
        surface: model.surfaceContracts.staffingContext,
        isEmpty: false
      }
    });
  };

  const openPricingContext = () => {
    const action = model.actions.inspectPricing;
    const runtimeToken = beginAction(action);
    openExclusiveContext("pricing");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Pricing details ready",
      nextResolution: model.actions.simulatePricingCounterfactual.enabled
        ? `Preview pricing for ${model.guestObject.scenarioGuestCount} guests or carry it into the editor.`
        : model.actions.simulatePricingCounterfactual.disabledReason,
      destination: {
        surface: model.surfaceContracts.pricingContext,
        isEmpty: false
      }
    });
  };

  const openMoneyContext = () => {
    const action = model.actions.inspectMoney;
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    openExclusiveContext("money");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Payment details ready",
      nextResolution: model.moneyObject.nextResolution,
      destination: {
        surface: model.surfaceContracts.moneyContext,
        isEmpty: false
      }
    });
  };

  const openConversationContext = () => {
    const action = model.actions.inspectConversation;
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    openExclusiveContext("conversation");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Conversation details ready",
      nextResolution: model.conversationObject.nextResolution.availability === "available"
        ? model.conversationObject.nextResolution.label
        : model.conversationObject.nextResolution.reason,
      destination: {
        surface: model.surfaceContracts.conversationContext,
        isEmpty: false
      }
    });
  };

  const openProposalContext = () => {
    const action = model.actions.inspectProposal;
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    openExclusiveContext("proposal");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Proposal details ready",
      nextResolution: model.proposalObject.readiness.gaps.length > 0
        ? `Review ${model.proposalObject.readiness.gaps.length} proposal completeness ${model.proposalObject.readiness.gaps.length === 1 ? "gap" : "gaps"}, or continue to the existing proposal controls.`
        : "Review what the customer sees or continue to the existing proposal controls.",
      destination: {
        surface: model.surfaceContracts.proposalContext,
        isEmpty: false
      }
    });
  };

  const openPackageContext = () => {
    const action = model.actions.inspectPackage;
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    openExclusiveContext("package");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Package details ready",
      nextResolution: model.actions.replacePackageInDraft?.enabled
        ? "Review one exact current-catalog candidate in the editor, or keep the saved package."
        : model.packageObject.intentContract.reason,
      destination: {
        surface: model.surfaceContracts.packageContext,
        isEmpty: false
      }
    });
  };

  const openMenuContext = () => {
    const action = model.actions.inspectMenu;
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    setMenuReplacementSourceId((current) => (
      model.menuObject.items.some((item) => item.id === current)
        ? current
        : model.menuObject.items[0]?.id || ""
    ));
    openExclusiveContext("menu");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Menu details ready",
      nextResolution: model.actions.replaceMenuItemInDraft?.enabled
        || model.actions.reorderMenuInDraft?.enabled
        ? "Review an exact replacement or order change in the editor, or keep the saved menu."
        : model.menuObject.permissions.reason,
      destination: {
        surface: model.surfaceContracts.menuContext,
        isEmpty: false
      }
    });
  };

  const openSelectionContext = () => {
    const action = model.actions.inspectSelections;
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    openExclusiveContext("selections");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Selection details ready",
      nextResolution: model.selectionObjects.stageableCount > 0
        ? "Explore a reversible quantity or selection scenario, review its dependencies, or close this context without changing the quote."
        : model.selectionObjects.permissions.reason,
      destination: {
        surface: model.surfaceContracts.selectionContext,
        isEmpty: false
      }
    });
  };

  const openEventLogisticsContext = (kind, triggerRef = null) => {
    if (!EVENT_LOGISTICS_KINDS.includes(kind)) return;
    const descriptor = model.eventLogisticsObjects[kind];
    const action = model.actions[EVENT_LOGISTICS_UI[kind].inspect];
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    activeEventLogisticsTriggerRef.current = triggerRef || eventLogisticsTriggerRefs.current[kind];
    openExclusiveContext(kind);
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: `${descriptor.label} details ready`,
      nextResolution: model.actions[EVENT_LOGISTICS_UI[kind].stage].enabled
        ? `Continue ${descriptor.label.toLowerCase()} in the editor or close these details without changing the quote.`
        : descriptor.permissions.reason,
      destination: {
        surface: model.surfaceContracts.eventLogistics[kind],
        isEmpty: false
      }
    });
  };

  const commitGuestScenario = (nextValue, { commitContext } = {}) => {
    const next = Number(nextValue);
    const previous = scenarioGuestCount;
    if (next === previous) {
      const action = commitContext?.action || model.actions.keepGuestScenario;
      acknowledge({
        action,
        runtimeToken: commitContext?.runtimeToken,
        kind: "resolved",
        label: `Guest scenario remains at ${previous}`,
        nextResolution: "Review what would change or open the priced editor."
      });
      return;
    }
    const action = commitContext?.action || model.actions.simulateGuestCount;
    pricingScenarioRef.current = next;
    setPricingPreviewState(EMPTY_PRICING_PREVIEW_STATE);
    setScenarioGuestCount(next);
    const nextObject = buildAmbientLivingOpportunityPresentation(quote, {
      source,
      sourceFreshness: proposalSourceFreshness,
      ordinaryEditAllowed,
      conversationAvailable,
      legacyControlsAvailable: typeof onOpenLegacyWorkspace === "function",
      scenarioGuestCount: next,
      eventLogisticsEvidence,
      role: ambientRole
    }).guestObject;
    emitFeedback("recalculated");
    acknowledge({
      action,
      runtimeToken: commitContext?.runtimeToken,
      kind: "preview",
      label: `Staffing suggestion updated for ${next} guests`,
      nextResolution: nextObject.preview.nextResolution,
    });
    undoModel.push({
      label: `Guest scenario changed to ${next}`,
      detail: "This changes only the unsaved preview until the editor opens.",
      actionId: model.actions.undoGuestScenario.id,
      undo: () => {
        pricingScenarioRef.current = previous;
        setPricingPreviewState(EMPTY_PRICING_PREVIEW_STATE);
        setScenarioGuestCount(previous);
        emitFeedback("resolve");
        return true;
      }
    });
    window.setTimeout(() => openExclusiveContext("guest"), 0);
  };

  const editArrivalContext = (action) => {
    const proposalReview = action?.id === model.actions.reviewProposalInEditor?.id;
    return {
      object: {
        ...action.arrivalContract.object,
        opportunityId: model.identity.quoteId
      },
      reason: action.arrivalContract.reason,
      consequence: action.arrivalContract.consequence,
      nextResolution: proposalReview
        ? "Review the named proposal completeness fields and exact customer projection. Save only through the existing authoritative quote workflow, or leave the saved version unchanged."
        : "Review the live price and dependencies, then save or leave the existing version unchanged."
    };
  };

  const openEditor = ({ guestCount = null, staffing = null, requestedAction = null } = {}) => {
    const hasGuestScenario = Number.isFinite(guestCount) && guestCount !== recordedGuestCount;
    const hasStaffingScenario = staffing && ["servers", "chefs", "bartenders"].every((field) => (
      Number.isInteger(Number(staffing[field]))
    ));
    const action = requestedAction || (hasGuestScenario
      ? model.actions.stageGuestCount
      : model.nextAction.kind === "edit"
        ? model.actions.primary
        : model.actions.openPricedEditor);
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    if (!ordinaryEditAllowed || typeof onEditQuote !== "function") {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: "Priced editor is unavailable",
        reason: model.editBoundary,
        consequence: "The saved quote and unsaved preview remain unchanged.",
        nextActionId: "back-to-opportunities",
        nextResolution: "Return to Opportunities or ask an authorized role to review the quote."
      });
      return;
    }
    if (hasStaffingScenario && staffing.basisGuestCount !== model.staffingObject.guestCount) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: "Staffing recommendation needs refresh",
        reason: "The active guest scenario changed after this staffing recommendation was selected.",
        consequence: "The priced editor was not opened, and the saved quote and unsaved previews remain unchanged.",
        nextActionId: model.actions.useStaffingRecommendation.id,
        nextResolution: "Reapply the staffing recommendation for the current guest scenario, then stage it again."
      });
      return;
    }
    const eventPatch = {
      ...(hasGuestScenario ? { guests: Number(guestCount) } : {}),
      ...(hasStaffingScenario ? {
        servers: Number(staffing.servers),
        chefs: Number(staffing.chefs),
        bartenders: Number(staffing.bartenders)
      } : {})
    };
    const baseRevisionId = String(
      quote.activeVersionId
      || quote.versionMeta?.versionId
      || quote.updatedAtISO
      || ""
    ).trim();
    if (Object.keys(eventPatch).length > 0 && !baseRevisionId) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: "Refresh the quote before editing",
        reason: "The latest saved quote version is unavailable.",
        consequence: "The editor was not opened with staged values, and the saved quote and unsaved previews remain unchanged.",
        nextActionId: action.id,
        nextResolution: "Refresh the opportunity to load its exact active revision, then continue the scenario again."
      });
      return;
    }
    const draftPatch = Object.keys(eventPatch).length > 0
      ? {
          source: requestedAction?.id === model.actions.stagePricingInEditor.id
            ? "ambient-pricing-scenario-v1"
            : hasStaffingScenario
              ? "ambient-staffing-recommendation-v1"
              : "ambient-guest-scenario-v1",
          baseRevisionId,
          event: eventPatch
        }
      : null;
    const arrivalContext = editArrivalContext(action);
    const pendingResult = acknowledge({
      action,
      runtimeToken,
      kind: "pending",
      label: requestedAction?.id === model.actions.reviewProposalInEditor?.id
        ? "Opening proposal review in the exact draft"
        : "Opening the priced draft",
      nextResolution: arrivalContext.nextResolution,
      deferRuntime: true
    });
    actionRuntime.acknowledge(runtimeToken, {
      result: pendingResult,
      destination: {
        surface: model.surfaceContracts.quoteEditor,
        isEmpty: false
      }
    });
    let navigationResult;
    try {
      navigationResult = onEditQuote(quote, { arrivalContext, draftPatch });
    } catch (error) {
      navigationResult = {
        status: "recovery",
        reason: error?.userMessage || "The priced editor handoff failed before the route opened.",
        consequence: "The current draft, saved quote, and unsaved preview remain unchanged.",
        nextResolution: "Keep reviewing this opportunity or try the priced editor again."
      };
    }
    if (["cancelled", "recovery"].includes(navigationResult?.status)) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: "Priced editor was not opened",
        reason: navigationResult.reason || "The route change was cancelled before the editor opened.",
        consequence: navigationResult.consequence || "The current draft, saved quote, and unsaved preview remain unchanged.",
        nextActionId: action.id,
        nextResolution: navigationResult.nextResolution || "Keep the current work or try the priced editor again when it is safe to leave."
      });
      return;
    }
    emitFeedback("ready");
  };

  const continueEventLogisticsInEditor = (kind) => {
    if (!EVENT_LOGISTICS_KINDS.includes(kind)) return;
    const descriptor = model.eventLogisticsObjects[kind];
    const action = model.actions[EVENT_LOGISTICS_UI[kind].stage];
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    if (!hasExactEventLogisticsStaging(descriptor)) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: `${descriptor.label} draft metadata is unavailable`,
        reason: descriptor.permissions.reason || "The exact saved value or draft-only staging metadata is unavailable.",
        consequence: "No editor handoff occurred, and the saved quote and any existing editor draft remain unchanged.",
        nextActionId: model.actions[EVENT_LOGISTICS_UI[kind].inspect].id,
        nextResolution: "Review the saved-value boundary and refresh the opportunity before trying again."
      });
      return;
    }
    if (!ordinaryEditAllowed || typeof onEditQuote !== "function") {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: `${descriptor.label} editor is unavailable`,
        reason: descriptor.permissions.reason,
        consequence: "The saved quote, evidence snapshot, and any editor draft remain unchanged.",
        nextActionId: model.actions[EVENT_LOGISTICS_UI[kind].inspect].id,
        nextResolution: "Keep reviewing the saved value or ask an authorized role to open the quote editor."
      });
      return;
    }
    const baseRevisionId = String(
      quote.activeVersionId
      || quote.versionMeta?.versionId
      || quote.updatedAtISO
      || ""
    ).trim();
    if (!baseRevisionId) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: `${descriptor.label} needs a fresh revision`,
        reason: "The selected quote does not expose an exact active or saved revision for a draft-intent handoff.",
        consequence: "No value was applied, reserved, repriced, scheduled, or saved, and the editor was not opened with draft intent.",
        nextActionId: action.id,
        nextResolution: "Refresh the opportunity to load its saved version, then continue with this event detail."
      });
      return;
    }
    const arrivalContext = {
      ...editArrivalContext(action),
      nextResolution: `Review ${descriptor.label.toLowerCase()} and every dependency consequence, then save intentionally or leave the existing version unchanged.`
    };
    const draftIntent = {
      schemaVersion: "ambient-event-logistics-draft-intent-v1",
      source: "ambient-event-logistics-v1",
      baseRevisionId,
      objectId: descriptor.id,
      kind,
      fieldPaths: [...descriptor.staging.target.fieldPaths],
      savedValue: descriptor.savedValue.raw,
      authority: "draft_only",
      commit: false,
      consequencePreviewRequired: true,
      requiresOutcomeNamedSave: true
    };
    const pendingResult = acknowledge({
      action,
      runtimeToken,
      kind: "pending",
      label: `Opening ${descriptor.label.toLowerCase()} draft controls`,
      nextResolution: arrivalContext.nextResolution,
      deferRuntime: true
    });
    actionRuntime.acknowledge(runtimeToken, {
      result: pendingResult,
      destination: {
        surface: model.surfaceContracts.quoteEditor,
        isEmpty: false
      }
    });
    let navigationResult;
    try {
      navigationResult = onEditQuote(quote, { arrivalContext, draftIntent });
    } catch (error) {
      navigationResult = {
        status: "recovery",
        reason: error?.userMessage || `The ${descriptor.label.toLowerCase()} editor handoff failed before the route opened.`,
        consequence: "The saved quote and any existing editor draft remain unchanged.",
        nextResolution: "Keep reviewing this evidence or try the exact editor again."
      };
    }
    if (["cancelled", "recovery"].includes(navigationResult?.status)) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: `${descriptor.label} editor was not opened`,
        reason: navigationResult.reason || "The route change was cancelled before the editor opened.",
        consequence: navigationResult.consequence || "The saved quote and draft intent remain unchanged.",
        nextActionId: action.id,
        nextResolution: navigationResult.nextResolution || "Keep reviewing the evidence or try the exact editor again."
      });
      return;
    }
    emitFeedback("ready");
  };

  const continuePackageMenuInEditor = ({
    action,
    intent,
    label,
    inspectActionId,
    nextResolution
  }) => {
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    if (!intent?.ok || model.packageMenuCatalogContext?.state !== "current") {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: `${label} is not ready for the editor`,
        reason: intent?.reason
          || model.packageMenuCatalogContext?.reason
          || "Refresh this organization’s catalog before reviewing the change in the editor.",
        consequence: intent?.consequence
          || "No draft field, saved quote, catalog record, price, margin, or availability evidence changed.",
        nextActionId: inspectActionId,
        nextResolution: "Refresh the opportunity and its tenant catalog evidence, then inspect this object again."
      });
      return;
    }
    if (!ordinaryEditAllowed || typeof onEditQuote !== "function") {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: `${label} editor is unavailable`,
        reason: model.editBoundary,
        consequence: "The saved quote, catalog evidence, and any existing editor draft remain unchanged.",
        nextActionId: inspectActionId,
        nextResolution: "Keep reviewing the evidence or ask an authorized role to open the quote editor."
      });
      return;
    }
    const arrivalContext = {
      ...editArrivalContext(action),
      nextResolution
    };
    const pendingResult = acknowledge({
      action,
      runtimeToken,
      kind: "pending",
      label: `Opening ${label.toLowerCase()} review`,
      nextResolution,
      deferRuntime: true
    });
    actionRuntime.acknowledge(runtimeToken, {
      result: pendingResult,
      destination: {
        surface: model.surfaceContracts.quoteEditor,
        isEmpty: false
      }
    });
    let navigationResult;
    try {
      navigationResult = onEditQuote(quote, {
        arrivalContext,
        draftIntent: intent,
        ambientCatalogContext: model.packageMenuCatalogContext
      });
    } catch (error) {
      navigationResult = {
        status: "recovery",
        reason: error?.userMessage || `The ${label.toLowerCase()} handoff failed before the editor opened.`,
        consequence: "The saved quote, catalog evidence, and any existing editor draft remain unchanged.",
        nextResolution: "Keep reviewing this evidence or try the exact editor again."
      };
    }
    if (["cancelled", "recovery"].includes(navigationResult?.status)) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: `${label} editor was not opened`,
        reason: navigationResult.reason || "The route change was cancelled before the editor opened.",
        consequence: navigationResult.consequence || "The saved quote and draft intent remain unchanged.",
        nextActionId: action.id,
        nextResolution: navigationResult.nextResolution || "Keep reviewing the evidence or try the exact editor again."
      });
      return;
    }
    emitFeedback("ready");
  };

  const stagePackageReplacement = (candidate) => {
    continuePackageMenuInEditor({
      action: model.actions.replacePackageInDraft,
      intent: createAmbientPackageReplacementIntent(model.packageObject, candidate.id),
      label: `${candidate.name} package`,
      inspectActionId: model.actions.inspectPackage.id,
      nextResolution: "Review the exact replacement, reconciled inclusions, and live price; then save intentionally or leave the existing version unchanged."
    });
  };

  const stageMenuReplacement = (candidate) => {
    continuePackageMenuInEditor({
      action: model.actions.replaceMenuItemInDraft,
      intent: createAmbientMenuReplacementIntent(model.menuObject, {
        selectedItemId: menuReplacementSourceId,
        replacementItemId: candidate.id
      }),
      label: `${candidate.name} menu replacement`,
      inspectActionId: model.actions.inspectMenu.id,
      nextResolution: "Review the exact item replacement, preserved quantity and order, and live price; then save intentionally or leave the existing version unchanged."
    });
  };

  const stageMenuReorder = (itemId, toIndex, interaction) => {
    const item = model.menuObject.items.find((entry) => entry.id === itemId);
    continuePackageMenuInEditor({
      action: model.actions.reorderMenuInDraft,
      intent: createAmbientMenuReorderIntent(model.menuObject, { itemId, toIndex, interaction }),
      label: `${item?.savedName || "Menu item"} reorder`,
      inspectActionId: model.actions.inspectMenu.id,
      nextResolution: "Review the exact menu order and live dependencies; then save intentionally or leave the existing version unchanged."
    });
  };

  const updateSelectionScenario = (nextScenario) => {
    selectionScenarioRef.current = nextScenario;
    setSelectionScenario(nextScenario);
  };

  const adjustSelectionScenario = (selectionObject, direction, interaction) => {
    const action = model.selectionObjectActions[selectionObject.id]?.[direction];
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    const currentQuantity = selectionScenarioQuantity(
      selectionObject,
      selectionScenarioRef.current
    );
    const result = applyAmbientSelectionScenarioStep(
      selectionObject,
      currentQuantity,
      direction
    );
    if (!result.ok) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: `${selectionObject.label} scenario was not changed`,
        reason: result.reason,
        consequence: "The unsaved preview and saved quote remain unchanged.",
        nextActionId: model.actions.inspectSelections.id,
        nextResolution: "Review the saved quantity and its supported local controls."
      });
      return;
    }

    const previousScenario = { ...selectionScenarioRef.current };
    const nextScenario = { ...previousScenario };
    if (result.quantity === selectionObject.current.quantity) {
      delete nextScenario[selectionObject.id];
    } else {
      nextScenario[selectionObject.id] = result.quantity;
    }
    updateSelectionScenario(nextScenario);
    emitFeedback("recalculated", {
      objectId: selectionObject.id,
      evidence: {
        source: `selection-${interaction || "button"}`,
        quoteId: model.identity.quoteId
      }
    });
    acknowledge({
      action,
      runtimeToken,
      kind: "preview",
      label: result.quantity === 0
        ? `${selectionObject.label} removed from unsaved preview`
        : `${selectionObject.label} preview quantity is ${result.quantity}`,
      reason: `${result.reason} Input: ${interaction || "button"}.`,
      consequence: result.consequence,
      nextActionId: selectionObject.actionIds.undo,
      nextResolution: result.nextResolution,
      object: action.arrivalContract.object
    });
    undoModel.push({
      label: `${selectionObject.label} unsaved preview changed`,
      detail: "Reversible here. This scenario is unpriced and unsaved.",
      actionId: selectionObject.actionIds.undo,
      undo: () => {
        updateSelectionScenario(previousScenario);
        emitFeedback("resolve", { objectId: selectionObject.id });
        return true;
      }
    });
  };

  const keepSavedSelection = (selectionObject) => {
    const action = model.selectionObjectActions[selectionObject.id]?.keep;
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    const previousScenario = { ...selectionScenarioRef.current };
    const hadLocalScenario = Object.prototype.hasOwnProperty.call(
      previousScenario,
      selectionObject.id
    );
    if (hadLocalScenario) {
      const nextScenario = { ...previousScenario };
      delete nextScenario[selectionObject.id];
      updateSelectionScenario(nextScenario);
      undoModel.push({
        label: `${selectionObject.label} saved selection restored`,
        detail: "Undo restores the prior unsaved preview. The saved quote remains unchanged.",
        actionId: selectionObject.actionIds.undo,
        undo: () => {
          updateSelectionScenario(previousScenario);
          emitFeedback("recalculated", { objectId: selectionObject.id });
          return true;
        }
      });
    }
    emitFeedback("resolve", { objectId: selectionObject.id });
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: hadLocalScenario
        ? `Saved ${selectionObject.label} selection restored`
        : `Saved ${selectionObject.label} selection kept`,
      consequence: hadLocalScenario
        ? action.arrivalContract.consequence
        : selectionObject.descriptor.doNothing,
      nextActionId: hadLocalScenario
        ? selectionObject.actionIds.undo
        : action.arrivalContract.nextResolutionIds[0],
      nextResolution: hadLocalScenario
          ? "Undo the preview restore, explore another option, or close this context."
        : "Explore a reversible scenario or close this context without changing the quote.",
      object: action.arrivalContract.object
    });
  };

  const runNextAction = () => {
    const nextAction = model.nextAction;
    if (nextAction.kind === "workflow") {
      const action = model.actions.primary;
      const runtimeToken = beginAction(action);
      if (typeof onOpenWorkflow !== "function") {
        emitFeedback("warning");
        acknowledge({
          action,
          runtimeToken,
          kind: "recovery",
          label: "This workflow step is not available here",
          reason: "This task can’t be opened from this view.",
          consequence: "The quote and tracked Workflow item remain unchanged.",
          nextActionId: "back-to-opportunities",
          nextResolution: "Return to Opportunities or keep reviewing this item here."
        });
        return;
      }
      const pendingResult = acknowledge({
        action,
        runtimeToken,
        kind: "pending",
        label: nextAction.label,
        nextResolution: nextAction.nextResolution,
        deferRuntime: true
      });
      emitFeedback("warning");
      try {
        const navigationResult = onOpenWorkflow(nextAction.target, {
          arrivalContext: {
            surfaceId: "workflow",
            object: action.arrivalContract.object,
            reason: action.arrivalContract.reason,
            consequence: action.arrivalContract.consequence,
            nextResolution: nextAction.nextResolution
          }
        });
        if (["cancelled", "recovery"].includes(navigationResult?.status)) {
          acknowledge({
            action,
            runtimeToken,
            kind: "recovery",
            label: "Workflow item was not opened",
            reason: navigationResult.reason || "The focused Workflow route was not opened.",
            consequence: navigationResult.consequence || "The quote and tracked Workflow item remain unchanged.",
            nextActionId: "back-to-opportunities",
            nextResolution: navigationResult.nextResolution || "Keep reviewing this opportunity or return to Opportunities."
          });
          return;
        }
        actionRuntime.acknowledge(runtimeToken, {
          result: pendingResult,
          destination: {
            surface: model.surfaceContracts.workflow,
            isEmpty: false
          }
        });
      } catch (error) {
        emitFeedback("warning");
        acknowledge({
          action,
          runtimeToken,
          kind: "recovery",
          label: "Workflow item was not opened",
          reason: error?.userMessage || "The focused Workflow route could not be opened.",
          consequence: "The quote and tracked Workflow item remain unchanged.",
          nextActionId: "back-to-opportunities",
          nextResolution: "Return to Opportunities or try the focused Workflow item again."
        });
      }
      return;
    }
    if (nextAction.kind === "edit") {
      openEditor();
      return;
    }
    if (nextAction.kind === "conversation") {
      const action = model.actions.primary;
      const runtimeToken = beginAction(action);
      if (typeof onOpenConversation !== "function") {
        emitFeedback("warning");
        acknowledge({
          action,
          runtimeToken,
          kind: "recovery",
          label: "Conversation is unavailable",
          reason: "The exact opportunity conversation is not available in this workspace context.",
          consequence: "No message was sent and the quote remains unchanged.",
          nextActionId: "back-to-opportunities",
          nextResolution: "Return to Opportunities or continue reviewing the recorded customer state."
        });
        return;
      }
      const pendingResult = acknowledge({
        action,
        runtimeToken,
        kind: "pending",
        label: nextAction.label,
        nextResolution: nextAction.nextResolution,
        deferRuntime: true
      });
      emitFeedback("ready", { origin: "customer" });
      try {
        const navigationResult = onOpenConversation(model.identity.quoteId, {
          arrivalContext: {
            surfaceId: "conversation",
            object: action.arrivalContract.object,
            reason: action.arrivalContract.reason,
            consequence: action.arrivalContract.consequence,
            nextResolution: nextAction.nextResolution
          }
        });
        if (["cancelled", "recovery"].includes(navigationResult?.status)) {
          acknowledge({
            action,
            runtimeToken,
            kind: "recovery",
            label: "Conversation was not opened",
            reason: navigationResult.reason || "The exact opportunity conversation was not opened.",
            consequence: navigationResult.consequence || "No message was sent and the quote remains unchanged.",
            nextActionId: "back-to-opportunities",
            nextResolution: navigationResult.nextResolution || "Keep reviewing this opportunity or return to Opportunities."
          });
          return;
        }
        actionRuntime.acknowledge(runtimeToken, {
          result: pendingResult,
          destination: {
            surface: model.surfaceContracts.conversation,
            isEmpty: false
          }
        });
      } catch (error) {
        emitFeedback("warning");
        acknowledge({
          action,
          runtimeToken,
          kind: "recovery",
          label: "Conversation was not opened",
          reason: error?.userMessage || "The exact opportunity conversation could not be opened.",
          consequence: "No message was sent and the quote remains unchanged.",
          nextActionId: "back-to-opportunities",
          nextResolution: "Return to Opportunities or try the opportunity conversation again."
        });
      }
    }
  };

  const returnToOpportunities = () => {
    const action = model.actions.backToOpportunities;
    const runtimeToken = beginAction(action);
    if (typeof onBackToQuotes !== "function") {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: "Opportunities route is unavailable",
        reason: "A return link isn’t available from this view.",
        consequence: "The selected quote remains open and unchanged.",
        nextActionId: "explain-next-action",
        nextResolution: "Continue reviewing this opportunity or ask Pilot why this step is recommended."
      });
      return;
    }
    const pendingResult = acknowledge({
      action,
      runtimeToken,
      kind: "pending",
      label: action.outcomeLabel,
      nextResolution: "Select the exact opportunity that needs attention.",
      deferRuntime: true
    });
    try {
      const navigationResult = onBackToQuotes();
      if (["cancelled", "recovery"].includes(navigationResult?.status)) {
        acknowledge({
          action,
          runtimeToken,
          kind: "recovery",
          label: "Opportunities were not opened",
          reason: navigationResult.reason || "The return route was cancelled.",
          consequence: navigationResult.consequence || "The selected quote remains open and unchanged.",
          nextActionId: "explain-next-action",
          nextResolution: navigationResult.nextResolution || "Continue reviewing this opportunity."
        });
        return;
      }
      actionRuntime.acknowledge(runtimeToken, {
        result: pendingResult,
        destination: {
          surface: model.surfaceContracts.opportunities,
          isEmpty: false
        }
      });
    } catch (error) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: "Opportunities were not opened",
        reason: error?.userMessage || "The opportunity stream could not be opened.",
        consequence: "The selected quote remains open and unchanged.",
        nextActionId: "explain-next-action",
        nextResolution: "Continue reviewing this opportunity or try returning again."
      });
    }
  };

  const openLegacyWorkspace = () => {
    const action = model.actions.openLegacyControls;
    if (!action.enabled || typeof onOpenLegacyWorkspace !== "function") return;
    const runtimeToken = beginAction(action);
    const pendingResult = acknowledge({
      action,
      runtimeToken,
      kind: "pending",
      label: action.outcomeLabel,
      nextResolution: "Choose the exact existing control needed for this opportunity.",
      deferRuntime: true
    });
    try {
      const navigationResult = onOpenLegacyWorkspace({
        object: action.arrivalContract.object,
        reason: action.arrivalContract.reason,
        consequence: action.arrivalContract.consequence,
        nextResolution: "Choose the exact existing control needed for this opportunity."
      });
      if (["cancelled", "recovery"].includes(navigationResult?.status)) {
        acknowledge({
          action,
          runtimeToken,
          kind: "recovery",
          label: "Full opportunity controls were not opened",
          reason: navigationResult.reason || "The existing control handoff was cancelled.",
          consequence: navigationResult.consequence || "The opportunity and unsaved preview remain unchanged.",
          nextActionId: "back-to-opportunities",
          nextResolution: navigationResult.nextResolution || "Return to Opportunities or continue reviewing here."
        });
        return;
      }
      actionRuntime.acknowledge(runtimeToken, {
        result: pendingResult,
        destination: {
          surface: model.surfaceContracts.legacyOpportunityControls,
          isEmpty: false
        }
      });
    } catch (error) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: "Full opportunity controls were not opened",
        reason: error?.userMessage || "The existing role-safe controls could not be opened.",
        consequence: "The opportunity and unsaved preview remain unchanged.",
        nextActionId: "back-to-opportunities",
        nextResolution: "Return to Opportunities or continue reviewing here."
      });
    }
  };

  const continueConversationResolution = () => {
    const action = model.actions.continueConversationResolution;
    const resolution = model.conversationObject.nextResolution;
    if (!action.enabled || resolution.availability !== "available") return;

    const surfaceId = resolution.target?.surfaceId;
    const destinationSurface = surfaceId === "workflow"
      ? model.surfaceContracts.workflow
      : surfaceId === "conversation"
        ? model.surfaceContracts.conversation
        : null;
    const handler = surfaceId === "workflow" ? onOpenWorkflow : onOpenConversation;
    const nextResolution = surfaceId === "workflow"
      ? "Open the task to review it. Viewing it won’t acknowledge or resolve it."
      : "Open this quote’s conversation. Viewing it won’t send a message or mark anything read.";
    const runtimeToken = beginAction(action);

    if (!destinationSurface || typeof handler !== "function") {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: "This next step is not available here",
        reason: action.disabledReason || "The exact governed destination is not available in this workspace context.",
        consequence: "No message is sent, marked read, acknowledged, inferred, or resolved; no workflow or quote state changes.",
        nextActionId: "dismiss-conversation-context",
        nextResolution: "Continue reviewing the conversation details or close this panel."
      });
      return;
    }

    const pendingResult = acknowledge({
      action,
      runtimeToken,
      kind: "pending",
      label: action.outcomeLabel,
      nextResolution,
      deferRuntime: true
    });
    emitFeedback("ready", { origin: "customer" });

    const arrivalContext = {
      surfaceId,
      object: action.arrivalContract.object,
      reason: action.arrivalContract.reason,
      consequence: action.arrivalContract.consequence,
      nextResolution,
      target: resolution.target
    };

    try {
      const navigationResult = surfaceId === "workflow"
        ? handler(resolution.target, { arrivalContext })
        : handler(model.identity.quoteId, { arrivalContext });
      if (["cancelled", "recovery"].includes(navigationResult?.status)) {
        acknowledge({
          action,
          runtimeToken,
          kind: "recovery",
          label: "That next step is not available right now",
          reason: navigationResult.reason || "The exact governed handoff was cancelled.",
          consequence: navigationResult.consequence || "No communication, workflow, or quote state changed.",
          nextActionId: "dismiss-conversation-context",
          nextResolution: navigationResult.nextResolution || "Continue reviewing the details or close this panel."
        });
        return;
      }
      actionRuntime.acknowledge(runtimeToken, {
        result: pendingResult,
        destination: {
          surface: destinationSurface,
          isEmpty: false
        }
      });
    } catch (error) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: "That next step is not available right now",
        reason: error?.userMessage || "The exact governed communication destination could not be opened.",
        consequence: "No message is sent, marked read, acknowledged, inferred, or resolved; no workflow or quote state changes.",
        nextActionId: "dismiss-conversation-context",
        nextResolution: "Continue reviewing the details or close this panel."
      });
    }
  };

  const openProposalControls = () => {
    const action = model.actions.openProposalControls;
    if (!action.enabled || typeof onOpenLegacyWorkspace !== "function") return;
    const runtimeToken = beginAction(action);
    const nextResolution = "Choose Prepare, Send, Replace customer link, or Review delivery. QuotePilot will recheck the current quote and delivery details first.";
    const pendingResult = acknowledge({
      action,
      runtimeToken,
      kind: "pending",
      label: action.outcomeLabel,
      nextResolution,
      deferRuntime: true
    });
    try {
      const navigationResult = onOpenLegacyWorkspace({
        object: action.arrivalContract.object,
        reason: action.arrivalContract.reason,
        consequence: action.arrivalContract.consequence,
        nextResolution
      });
      if (["cancelled", "recovery"].includes(navigationResult?.status)) {
        acknowledge({
          action,
          runtimeToken,
          kind: "recovery",
          label: "Governed proposal controls were not opened",
          reason: navigationResult.reason || "The existing proposal-control handoff was cancelled.",
          consequence: navigationResult.consequence || "No proposal, portal, delivery, customer-activity, or saved quote state changed.",
          nextActionId: "dismiss-proposal-context",
          nextResolution: navigationResult.nextResolution || "Continue reviewing the proposal details or close this panel."
        });
        return;
      }
      actionRuntime.acknowledge(runtimeToken, {
        result: pendingResult,
        destination: {
          surface: model.surfaceContracts.legacyOpportunityControls,
          isEmpty: false
        }
      });
    } catch (error) {
      emitFeedback("warning");
      acknowledge({
        action,
        runtimeToken,
        kind: "recovery",
        label: "Governed proposal controls were not opened",
        reason: error?.userMessage || "The existing role-safe proposal controls could not be opened.",
        consequence: "No proposal, portal, delivery, customer-activity, or saved quote state changed.",
        nextActionId: "dismiss-proposal-context",
        nextResolution: "Continue reviewing the proposal details or close this panel."
      });
    }
  };

  const openPilotContext = (originRef = pilotTriggerRef) => {
    const action = model.actions.explainNextAction;
    const runtimeToken = beginAction(action);
    pilotContextAnchorRef.current = originRef?.current || pilotTriggerRef.current;
    const fromGlobalPilot = originRef !== pilotTriggerRef;
    setPilotContextAlign(
      fromGlobalPilot
      && typeof window !== "undefined"
      && window.innerWidth >= 1181
        ? "start"
        : "end"
    );
    openExclusiveContext("pilot");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Pilot explanation opened",
      nextResolution: model.nextAction.nextResolution,
      destination: {
        surface: model.surfaceContracts.pilotContext,
        isEmpty: false
      }
    });
  };

  useEffect(() => {
    const requestId = String(globalPilotRequest?.id || "").trim();
    if (!requestId || handledGlobalPilotRequestRef.current === requestId) return undefined;
    handledGlobalPilotRequestRef.current = requestId;
    const requestedOpportunityId = String(globalPilotRequest?.opportunityId || "").trim();
    if (!requestedOpportunityId || requestedOpportunityId !== model.identity.quoteId) {
      globalPilotResolutionRef.current?.({
        requestId,
        status: "recovery",
        reason: "The global Pilot request does not match the opportunity currently in view."
      });
      return undefined;
    }
    pendingGlobalPilotResolutionRef.current = { requestId };
    openPilotContext(globalPilotReturnFocusRef);
    return undefined;
  }, [globalPilotRequest?.id, globalPilotRequest?.opportunityId, globalPilotReturnFocusRef, model.identity.quoteId]);

  useEffect(() => {
    const pending = pendingGlobalPilotResolutionRef.current;
    if (!pending || !pilotOpen) return undefined;
    const verifyOpen = () => {
      const dialog = rootRef.current?.querySelector(
        '.ambient-pilot-context-surface [role="dialog"]'
      );
      pendingGlobalPilotResolutionRef.current = null;
      globalPilotResolutionRef.current?.({
        requestId: pending.requestId,
        status: dialog ? "opened" : "recovery",
        reason: dialog ? "" : "The populated Pilot explanation could not be opened."
      });
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      const frame = window.requestAnimationFrame(verifyOpen);
      return () => window.cancelAnimationFrame?.(frame);
    }
    const timer = setTimeout(verifyOpen, 0);
    return () => clearTimeout(timer);
  }, [pilotOpen]);

  const revealOperationalFacts = () => {
    const action = model.actions.revealOperationalFacts;
    const runtimeToken = beginAction(action);
    setOperationalFactsVisible(true);
    emitFeedback("add");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Opportunity details revealed",
      nextResolution: "Show more context when margin, history, activity, or automation details are needed.",
      destination: {
        surface: model.surfaceContracts.operationalFacts,
        isEmpty: false
      }
    });
  };

  const revealMobileEventDetails = () => {
    const action = model.actions.revealMobileEventDetails;
    const runtimeToken = beginAction(action);
    setMobileEventDetailsVisible(true);
    emitFeedback("add");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Event details shown",
      nextResolution: "Inspect the exact saved date, time, duration, or venue, or keep reviewing this opportunity.",
      destination: {
        surface: model.surfaceContracts.mobileEventDetails,
        isEmpty: false
      }
    });
  };

  const revealSupportingEvidence = () => {
    const action = model.actions.revealSupportingEvidence;
    const runtimeToken = beginAction(action);
    setOperationalFactsVisible(true);
    setSupportingEvidenceVisible(true);
    emitFeedback("ready");
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "More context shown",
      nextResolution: model.nextAction.kind === "caught_up"
        ? "Return to Opportunities or continue reviewing this evidence."
        : model.nextAction.nextResolution,
      destination: {
        surface: model.surfaceContracts.supportingEvidence,
        isEmpty: false
      }
    });
  };

  const openGuestInlineEdit = () => {
    const action = model.actions.openGuestInlineEdit;
    const runtimeToken = beginAction(action);
    acknowledge({
      action,
      runtimeToken,
      kind: "context",
      label: "Guest scenario editor opened",
      nextResolution: "Apply a valid scenario or keep the current guest count.",
      destination: {
        surface: model.surfaceContracts.guestInlineEditor,
        isEmpty: false
      }
    });
  };

  const cancelGuestInlineEdit = () => {
    const action = model.actions.cancelGuestInlineEdit;
    const runtimeToken = beginAction(action);
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Current guest scenario kept",
      nextResolution: "Open the editor again or review the current guest-count preview."
    });
  };

  const beginGuestCommit = ({ value, nextValue }) => {
    const action = Number(nextValue) === Number(value)
      ? model.actions.keepGuestScenario
      : model.actions.simulateGuestCount;
    return {
      action,
      runtimeToken: beginAction(action)
    };
  };

  const clarifyGuestValidation = ({ message }) => {
    const action = model.actions.validateGuestCount;
    const runtimeToken = beginAction(action);
    emitFeedback("warning");
    acknowledge({
      action,
      runtimeToken,
      kind: "recovery",
      label: message,
      reason: message,
      consequence: action.arrivalContract.consequence,
      nextActionId: "open-guest-count-inline-edit",
      nextResolution: "Enter a whole guest count from 1 to 400, or cancel and keep the current scenario."
    });
  };

  const recoverGuestCommit = ({ message, commitContext }) => {
    const action = commitContext?.action || model.actions.simulateGuestCount;
    emitFeedback("warning");
    acknowledge({
      action,
      runtimeToken: commitContext?.runtimeToken,
      kind: "recovery",
      label: message,
      reason: message,
      consequence: "The unsaved preview and saved quote remain unchanged.",
      nextActionId: "open-guest-count-inline-edit",
      nextResolution: "Review the guest count and try the preview again."
    });
  };

  const dismissGuestContext = () => {
    const action = model.actions.dismissGuestContext;
    const runtimeToken = beginAction(action);
    setGuestOpen(false);
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Guest-count context closed",
      nextResolution: "Review the guest-count preview again or open the priced editor."
    });
  };

  const useStaffingRecommendation = () => {
    const action = model.actions.useStaffingRecommendation;
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    const previous = staffingScenario;
    const next = {
      ...model.staffingObject.recommended,
      basisGuestCount: model.staffingObject.guestCount
    };
    const unchanged = previous
      && ["servers", "chefs", "bartenders", "basisGuestCount"].every((field) => (
        Number(previous[field]) === Number(next[field])
      ));
    if (unchanged) {
      acknowledge({
        action,
        runtimeToken,
        kind: "resolved",
        label: "Staffing recommendation is already active",
        nextResolution: "Stage it in the priced editor or keep the saved staffing."
      });
      return;
    }
    setStaffingScenario(next);
    emitFeedback("recalculated");
    acknowledge({
      action,
      runtimeToken,
      kind: "preview",
      label: `Staffing scenario updated to ${staffingLabel(next)}`,
      nextResolution: "Review the unpriced dependencies, then stage the scenario in the exact quote editor."
    });
    undoModel.push({
      label: `Staffing recommendation used for ${next.basisGuestCount} guests`,
      detail: `${staffingLabel(next)}. This remains local and unpriced until the editor opens.`,
      actionId: model.actions.undoStaffingScenario.id,
      undo: () => {
        setStaffingScenario(previous);
        emitFeedback("resolve");
        return true;
      }
    });
  };

  const keepCurrentStaffing = () => {
    const action = model.actions.keepCurrentStaffing;
    const runtimeToken = beginAction(action);
    const discardedScenario = Boolean(staffingScenario);
    setStaffingScenario(null);
    undoModel.getSnapshot()
      .filter((entry) => entry.actionId === model.actions.undoStaffingScenario.id)
      .forEach((entry) => undoModel.dismiss(entry.id));
    setStaffingOpen(false);
    emitFeedback("resolve");
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: discardedScenario ? "Saved staffing kept" : "Current staffing kept",
      consequence: discardedScenario
        ? "The local staffing recommendation was discarded. The saved quote remains unchanged."
        : action.arrivalContract.consequence,
      nextResolution: "Review staffing again or open the priced editor without a staffing scenario."
    });
  };

  const dismissStaffingContext = () => {
    const action = model.actions.dismissStaffingContext;
    const runtimeToken = beginAction(action);
    setStaffingOpen(false);
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Staffing context closed",
      nextResolution: staffingScenario
        ? "Stage the local staffing scenario, undo it, or inspect its evidence again."
        : "Review staffing again or open the priced editor."
    });
  };

  const dismissPricingContext = () => {
    const action = model.actions.dismissPricingContext;
    const runtimeToken = beginAction(action);
    setPricingOpen(false);
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Pricing context closed",
      nextResolution: model.guestObject.scenarioChanged
        ? "Review pricing again, carry the guest scenario into the editor, or undo it."
        : "Change the guest scenario or review the saved pricing again."
    });
  };

  const dismissMoneyContext = () => {
    const action = model.actions.dismissMoneyContext;
    const runtimeToken = beginAction(action);
    setMoneyOpen(false);
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Payment details closed",
      nextResolution: "Review the five payment stages again or return to saved pricing."
    });
  };

  const dismissConversationContext = () => {
    const action = model.actions.dismissConversationContext;
    const runtimeToken = beginAction(action);
    setConversationOpen(false);
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Conversation details closed",
      nextResolution: "Review the conversation stages again or continue with this opportunity."
    });
  };

  const dismissProposalContext = () => {
    const action = model.actions.dismissProposalContext;
    const runtimeToken = beginAction(action);
    setProposalOpen(false);
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Proposal details closed",
      nextResolution: "Review proposal details again, choose a completeness gap, or open the existing proposal controls."
    });
  };

  const dismissPackageContext = () => {
    const action = model.actions.dismissPackageContext;
    const runtimeToken = beginAction(action);
    setPackageOpen(false);
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Package context closed",
      nextResolution: model.actions.replacePackageInDraft
        ? "Review the package again or carry a current catalog option into the editor."
        : "Review the saved package again when the current catalog is available."
    });
  };

  const dismissMenuContext = () => {
    const action = model.actions.dismissMenuContext;
    const runtimeToken = beginAction(action);
    setMenuOpen(false);
    menuDragItemRef.current = "";
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Menu context closed",
      nextResolution: model.actions.replaceMenuItemInDraft || model.actions.reorderMenuInDraft
        ? "Review the menu again or carry a replacement or new order into the editor."
        : "Review the saved menu again when the current catalog is available."
    });
  };

  const dismissSelectionContext = () => {
    const action = model.actions.dismissSelectionContext;
    const runtimeToken = beginAction(action);
    if (!runtimeToken) return;
    setSelectionOpen(false);
    const hasLocalSelectionScenario = Object.keys(selectionScenarioRef.current).length > 0;
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Selection details closed",
      nextActionId: hasLocalSelectionScenario
        ? "clear-scenario-history"
        : model.actions.inspectSelections.id,
      nextResolution: hasLocalSelectionScenario
        ? "Use history to undo, review selections again, or keep the visible unsaved preview."
        : "Review the saved selections again when you want to see what they connect to."
    });
  };

  const dismissEventLogisticsContext = () => {
    const kind = eventLogisticsOpenKind;
    if (!EVENT_LOGISTICS_KINDS.includes(kind)) return;
    const descriptor = model.eventLogisticsObjects[kind];
    const action = model.actions[EVENT_LOGISTICS_UI[kind].dismiss];
    const runtimeToken = beginAction(action);
    setEventLogisticsOpenKind(null);
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: `${descriptor.label} context closed`,
      nextResolution: model.actions[EVENT_LOGISTICS_UI[kind].stage].enabled
        ? `Review ${descriptor.label.toLowerCase()} again or continue it in the quote editor.`
        : `Review ${descriptor.label.toLowerCase()} again when the needed details are available.`
    });
  };

  const simulatePricingCounterfactual = async () => {
    const action = model.actions.simulatePricingCounterfactual;
    const runtimeToken = beginAction(action);
    if (!runtimeToken || typeof onSimulatePricing !== "function") return;
    const requestedGuestCount = model.guestObject.scenarioGuestCount;
    pricingScenarioRef.current = requestedGuestCount;
    const pendingResult = acknowledge({
      action,
      runtimeToken,
      kind: "pending",
      label: pricingPreviewState.requestId
        ? "Checking the previous pricing request"
        : "Calculating the guest count preview",
      nextResolution: "Keep reviewing the saved details while the preview completes.",
      deferRuntime: true
    });
    setPricingPreviewState((current) => ({
      ...current,
      status: current.requestId ? "recovery" : "loading",
      preview: null,
      marginContext: null,
      error: ""
    }));
    actionRuntime.acknowledge(runtimeToken, {
      result: pendingResult,
      destination: {
        surface: model.surfaceContracts.pricingContext,
        isEmpty: false
      }
    });
    try {
      const result = await onSimulatePricing({
        quote,
        guestCount: requestedGuestCount,
        requestId: pricingPreviewState.requestId || ""
      });
      if (pricingScenarioRef.current !== requestedGuestCount) return;
      const preview = result?.preview || result;
      if (!preview || preview.schemaVersion !== "ambient-impact-preview-v1") {
        throw new Error("QuotePilot could not verify this pricing preview.");
      }
      const requestId = String(
        result?.requestId
        || preview.receipt?.requestId
        || ""
      );
      setPricingPreviewState({
        status: "success",
        preview,
        marginContext: result?.marginContext || null,
        error: "",
        requestId
      });
      emitFeedback("recalculated", {
        receipt: preview.receipt || {
          kind: "client-calculation-preview",
          surfaceId: model.surfaceContracts.pricingContext.id
        }
      });
      const resultKind = preview.receipt ? "receipt" : "preview";
      acknowledge({
        action,
        kind: resultKind,
        label: preview.receipt
          ? "Price preview confirmed"
          : "Price preview ready",
        reason: preview.why,
        consequence: preview.consequence,
        nextActionId: model.actions.stagePricingInEditor.id,
        nextResolution: "Review the price changes, then carry the scenario into the editor or leave the saved quote unchanged.",
        deferRuntime: true
      });
    } catch (error) {
      if (pricingScenarioRef.current !== requestedGuestCount) return;
      const requestId = String(error?.requestId || pricingPreviewState.requestId || "");
      setPricingPreviewState((current) => ({
        ...current,
        status: "error",
        error: error?.userMessage || error?.message || "This pricing preview is unavailable.",
        requestId: error?.definitive === true ? "" : requestId
      }));
      emitFeedback("warning");
      acknowledge({
        action,
        kind: "recovery",
        label: "Pricing preview unavailable",
        reason: error?.userMessage || error?.message || "QuotePilot did not return a pricing result.",
        consequence: "The saved quote and unsaved guest preview remain unchanged. No price, authorization, customer communication, or payment state is assumed.",
        nextActionId: requestId ? action.id : model.actions.stagePricingInEditor.id,
        nextResolution: requestId
          ? "Check the previous pricing request before starting another preview."
          : "Review the scenario in the priced editor or leave the existing version unchanged."
      });
    }
  };

  const dismissPilotContext = () => {
    const action = model.actions.dismissPilotContext;
    const runtimeToken = beginAction(action);
    setPilotOpen(false);
    acknowledge({
      action,
      runtimeToken,
      kind: "resolved",
      label: "Pilot explanation closed",
      nextResolution: model.nextAction.kind === "caught_up"
        ? "Return to Opportunities when you are finished reviewing."
        : model.nextAction.nextResolution
    });
  };

  const beginUndoScenario = ({ entry }) => {
    const staffingUndo = entry.actionId === model.actions.undoStaffingScenario.id;
    const selectionObject = model.selectionObjects.objects.find((item) => (
      item.actionIds.undo === entry.actionId
    ));
    const selectionUndo = Boolean(selectionObject);
    const action = selectionUndo
      ? model.selectionObjectActions[selectionObject.id].undo
      : staffingUndo
        ? model.actions.undoStaffingScenario
        : model.actions.undoGuestScenario;
    const runtimeToken = beginAction(action);
    acknowledge({
      action,
      runtimeToken,
      kind: "pending",
      label: selectionUndo
        ? `Restoring the previous ${selectionObject.label} scenario`
        : staffingUndo
          ? "Restoring the previous staffing scenario"
          : "Restoring the previous guest scenario",
      nextResolution: "Keep reviewing while the unsaved preview is restored.",
      deferRuntime: true
    });
    return {
      action,
      runtimeToken,
      staffingUndo,
      selectionUndo,
      scenarioLabel: selectionUndo ? selectionObject.label : staffingUndo ? "staffing" : "guest"
    };
  };

  const finishUndoScenario = ({ resolved, undoContext }) => {
    const action = undoContext?.action || model.actions.undoGuestScenario;
    const label = undoContext?.scenarioLabel || "guest";
    if (resolved) {
      acknowledge({
        action,
        runtimeToken: undoContext?.runtimeToken,
        kind: "resolved",
        label: `Previous ${label} scenario restored`,
        nextActionId: undoContext?.selectionUndo
          ? model.actions.inspectSelections.id
          : action.arrivalContract.nextResolutionIds[0],
        nextResolution: undoContext?.selectionUndo
          ? "Inspect the restored selection dependencies or try another unsaved preview."
          : "Review the restored preview or try another one."
      });
      return;
    }
    emitFeedback("warning");
    acknowledge({
      action,
      runtimeToken: undoContext?.runtimeToken,
      kind: "recovery",
      label: `${label.charAt(0).toUpperCase()}${label.slice(1)} scenario was not restored`,
      reason: "The preview could not be undone.",
      consequence: "The current unsaved preview remains visible, and the saved quote is unchanged.",
      nextActionId: action.id,
      nextResolution: "Try the undo again or keep the current unsaved preview."
    });
  };

  const beginClearScenarioHistory = () => {
    const action = model.actions.clearScenarioHistory;
    return { action, runtimeToken: beginAction(action) };
  };

  const finishClearScenarioHistory = ({ cleared, clearContext }) => {
    const action = clearContext?.action || model.actions.clearScenarioHistory;
    acknowledge({
      action,
      runtimeToken: clearContext?.runtimeToken,
      kind: cleared ? "resolved" : "recovery",
      label: cleared ? "Scenario history cleared" : "Scenario history was kept",
      ...(cleared ? {} : {
        reason: "A scenario recovery is still pending.",
        consequence: "No history entry was removed, and the active scenario remains unchanged.",
        nextActionId: "clear-scenario-history"
      }),
      nextResolution: cleared
        ? "Review the active guest-count, staffing, or selection preview, or enter another scenario."
        : "Finish the pending undo, then clear the history if it is no longer needed."
    });
  };

  const interactionHealth = interactionObservation?.monitor || EMPTY_INTERACTION_HEALTH;
  const selectionScenarioCount = Object.keys(selectionScenario).length;
  const activeEventLogisticsObject = EVENT_LOGISTICS_KINDS.includes(eventLogisticsOpenKind)
    ? model.eventLogisticsObjects[eventLogisticsOpenKind]
    : null;
  const activeEventLogisticsActions = activeEventLogisticsObject
    ? EVENT_LOGISTICS_UI[eventLogisticsOpenKind]
    : null;
  const eventLogisticsFooter = activeEventLogisticsObject
    && model.actions[activeEventLogisticsActions.stage].enabled
    && hasExactEventLogisticsStaging(activeEventLogisticsObject) ? (
    <button
      type="button"
      className="cta ambient-outcome-button"
      onClick={() => continueEventLogisticsInEditor(eventLogisticsOpenKind)}
      data-ambient-action-id={model.actions[activeEventLogisticsActions.stage].id}
    >
      Continue {activeEventLogisticsObject.label.toLowerCase()} in editor
      <ArrowRight size={17} aria-hidden="true" />
    </button>
  ) : activeEventLogisticsObject ? (
    <p className="ambient-boundary-note">{activeEventLogisticsObject.permissions.reason}</p>
  ) : null;

  const guestFooter = ordinaryEditAllowed ? (
    <button
      type="button"
      className="cta ambient-outcome-button"
      onClick={() => openEditor({
        guestCount: model.guestObject.scenarioChanged
          ? model.guestObject.scenarioGuestCount
          : null
      })}
      data-ambient-action-id={model.guestObject.scenarioChanged
        ? model.actions.stageGuestCount.id
        : model.nextAction.kind === "edit"
          ? model.actions.primary.id
          : model.actions.openPricedEditor.id}
    >
      {model.guestObject.scenarioChanged
        ? `Stage ${model.guestObject.scenarioGuestCount} guests in editor`
        : "Open priced editor"}
      <ArrowRight size={17} aria-hidden="true" />
    </button>
  ) : (
    <p className="ambient-boundary-note">{model.editBoundary}</p>
  );

  const staffingFooter = (
    <div className="ambient-context-actions">
      {model.actions.useStaffingRecommendation.enabled
        && (!staffingScenario || staffingScenarioStale) && (
          <button
            type="button"
            className="cta ambient-outcome-button"
            onClick={useStaffingRecommendation}
            data-ambient-action-id={model.actions.useStaffingRecommendation.id}
          >
            {staffingScenarioStale ? "Refresh recommendation" : "Use recommendation"}
          </button>
      )}
      {staffingScenario && !staffingScenarioStale && (
        <button
          type="button"
          className="cta ambient-outcome-button"
          onClick={() => openEditor({
            guestCount: model.guestObject.scenarioChanged
              ? model.guestObject.scenarioGuestCount
              : null,
            staffing: staffingScenario,
            requestedAction: model.actions.stageStaffingInEditor
          })}
          data-ambient-action-id={model.actions.stageStaffingInEditor.id}
        >
          Stage staffing in editor
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      )}
      {!model.actions.useStaffingRecommendation.enabled && ordinaryEditAllowed && (
        <button
          type="button"
          className="ghost ambient-outcome-button"
          onClick={() => openEditor()}
          data-ambient-action-id={model.nextAction.kind === "edit"
            ? model.actions.primary.id
            : model.actions.openPricedEditor.id}
        >
          Review in priced editor
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="ghost ambient-outcome-button"
        onClick={keepCurrentStaffing}
        data-ambient-action-id={model.actions.keepCurrentStaffing.id}
      >
        Keep saved staffing
      </button>
    </div>
  );

  const pricingFooter = (
    <div className="ambient-context-actions">
      {model.actions.simulatePricingCounterfactual.enabled && (
        <button
          type="button"
          className="cta ambient-outcome-button"
          onClick={() => void simulatePricingCounterfactual()}
          disabled={["loading", "recovery"].includes(pricingPreviewState.status)}
          data-ambient-action-id={model.actions.simulatePricingCounterfactual.id}
        >
          {["loading", "recovery"].includes(pricingPreviewState.status)
            ? "Calculating…"
            : `Price ${model.guestObject.scenarioGuestCount} guests`}
        </button>
      )}
      {ordinaryEditAllowed && (
        <button
          type="button"
          className="ghost ambient-outcome-button"
          onClick={() => openEditor({
            guestCount: model.guestObject.scenarioChanged
              ? model.guestObject.scenarioGuestCount
              : null,
            requestedAction: model.guestObject.scenarioChanged
              ? model.actions.stagePricingInEditor
              : model.actions.openPricedEditor
          })}
          data-ambient-action-id={model.guestObject.scenarioChanged
            ? model.actions.stagePricingInEditor.id
            : model.actions.openPricedEditor.id}
        >
          {model.guestObject.scenarioChanged ? "Stage scenario in editor" : "Open priced editor"}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      )}
    </div>
  );

  const proposalFooter = (
    <div className="ambient-context-actions">
      {model.proposalObject.readiness.gaps.length > 0
        && model.actions.reviewProposalInEditor.enabled && (
          <button
            type="button"
            className="ghost ambient-outcome-button"
            onClick={() => openEditor({ requestedAction: model.actions.reviewProposalInEditor })}
            data-ambient-action-id={model.actions.reviewProposalInEditor.id}
          >
            {model.actions.reviewProposalInEditor.outcomeLabel}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
      )}
      {model.actions.openProposalControls.enabled && (
        <button
          type="button"
          className="ghost ambient-outcome-button"
          onClick={openProposalControls}
          data-ambient-action-id={model.actions.openProposalControls.id}
        >
          {model.actions.openProposalControls.outcomeLabel}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      )}
      {!(model.proposalObject.readiness.gaps.length > 0
        && model.actions.reviewProposalInEditor.enabled)
        && !model.actions.openProposalControls.enabled && (
          <p className="ambient-boundary-note">
            Proposal controls are not available here. These details remain read-only.
          </p>
      )}
    </div>
  );

  const conversationFooter = model.actions.continueConversationResolution.enabled ? (
    <div className="ambient-context-actions">
      <button
        type="button"
        className="ghost ambient-outcome-button"
        onClick={continueConversationResolution}
        data-ambient-action-id={model.actions.continueConversationResolution.id}
      >
        {model.actions.continueConversationResolution.outcomeLabel}
        <ArrowRight size={17} aria-hidden="true" />
      </button>
    </div>
  ) : (
    <p className="ambient-boundary-note">
      {model.actions.continueConversationResolution.disabledReason
        || "No conversation next step is available here. These details remain read-only."}
    </p>
  );
  const contextSurfaceActive = Boolean(
    guestOpen
    || staffingOpen
    || pricingOpen
    || moneyOpen
    || conversationOpen
    || proposalOpen
    || packageOpen
    || menuOpen
    || selectionOpen
    || pilotOpen
    || eventLogisticsOpenKind
  );

  return (
    <article
      className={`ambient-living-opportunity${contextSurfaceActive ? " ambient-context-active" : ""}`}
      data-ambient-model={model.modelId}
      data-feedback-kind={feedbackEvent?.type || feedbackEvent?.kind || undefined}
      data-surface-purpose={model.surface.purpose.join(" ")}
      data-quote-id={model.identity.quoteId}
      data-ambient-role={ambientRole}
      data-ambient-organization={ambientContext?.organizationId || "unscoped"}
      data-ambient-audit-phase={interactionObservation?.phase || "idle"}
      data-ambient-primary-assessments={interactionHealth.observedActionCount}
      data-ambient-primary-dead-clicks={interactionHealth.deadClickCount}
      data-ambient-primary-dead-click-rate={interactionHealth.deadClickRate}
      ref={(node) => {
        rootRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      tabIndex={-1}
      aria-label={`${model.identity.eventName} Living Opportunity`}
    >
      <div className="ambient-opportunity-orientation">
        <button
          type="button"
          className="ambient-back-link"
          onClick={returnToOpportunities}
          data-ambient-action-id={model.actions.backToOpportunities.id}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          Opportunities
        </button>
        <span>Living Opportunity</span>
      </div>

      <section
        className="ambient-mobile-remote"
        aria-label="Opportunity quick actions"
        data-layout-audit-surface="ambient-mobile-opportunity-remote"
        data-surface-purpose="clarify advance reveal_context"
      >
        <header className="ambient-mobile-remote__identity">
          <div>
            <span>Active opportunity</span>
            <h1 id="ambient-mobile-opportunity-title">{model.identity.eventName}</h1>
          </div>
          <StatusChip {...model.identity.status} />
        </header>

        <dl className="ambient-mobile-remote__signal" aria-label="Current opportunity summary">
          <div>
            <dt>State</dt>
            <dd>{model.identity.status.label}</dd>
          </div>
          <div data-tone={model.risk.tone}>
            <dt>What matters</dt>
            <dd>{model.risk.title}</dd>
          </div>
        </dl>

        <div className="ambient-mobile-remote__objects" role="group" aria-label="Open opportunity object">
          <button
            type="button"
            onClick={revealMobileEventDetails}
            aria-expanded={mobileEventDetailsVisible}
            aria-controls="ambient-mobile-event-details"
            data-ambient-action-id={model.actions.revealMobileEventDetails.id}
          >
            Event
          </button>
          <button
            type="button"
            onClick={openMenuContext}
            disabled={!model.actions.inspectMenu.enabled}
            title={model.actions.inspectMenu.disabledReason || undefined}
            data-ambient-action-id={model.actions.inspectMenu.id}
          >
            Menu
          </button>
          <button
            type="button"
            onClick={openPricingContext}
            disabled={!model.actions.inspectPricing.enabled}
            title={model.actions.inspectPricing.disabledReason || undefined}
            data-ambient-action-id={model.actions.inspectPricing.id}
          >
            Pricing
          </button>
          <button
            type="button"
            onClick={openProposalContext}
            disabled={!model.actions.inspectProposal.enabled}
            title={model.actions.inspectProposal.disabledReason || undefined}
            data-ambient-action-id={model.actions.inspectProposal.id}
          >
            Proposal
          </button>
        </div>

        {mobileEventDetailsVisible && (
          <section
            id="ambient-mobile-event-details"
            className="ambient-mobile-event-details"
            ref={mobileEventDetailsRef}
            tabIndex={-1}
            aria-label="Event details"
            data-surface-purpose="clarify reveal_context"
          >
            <span className="ambient-mobile-event-details__label">Event details</span>
            <div className="ambient-mobile-event-details__values">
              {EVENT_LOGISTICS_KINDS.map((kind) => (
                <EventLogisticsValue
                  key={kind}
                  kind={kind}
                  descriptor={model.eventLogisticsObjects[kind]}
                  action={model.actions[EVENT_LOGISTICS_UI[kind].inspect]}
                  triggerRef={mobileEventLogisticsTriggerRefs.current[kind]}
                  onInspect={openEventLogisticsContext}
                />
              ))}
            </div>
          </section>
        )}

        <div className="ambient-mobile-remote__next" data-next-action-kind={model.nextAction.kind}>
          <div>
            <span>Next</span>
            <strong>{model.nextAction.title}</strong>
          </div>
          {model.nextAction.kind === "caught_up" ? (
            <small>{model.nextAction.label}</small>
          ) : (
            <button
              type="button"
              onClick={runNextAction}
              data-ambient-action-id={model.actions.primary.id}
            >
              {model.nextAction.label}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </section>

      <header className="ambient-opportunity-hero">
        <div className="ambient-opportunity-identity">
          <p className="ambient-kicker">{model.identity.quoteNumber} · {model.identity.sourceLabel}</p>
          <div className="ambient-title-line">
            <h1 id="ambient-opportunity-title">{model.identity.eventName}</h1>
            <StatusChip {...model.identity.status} />
          </div>
          <p>{model.identity.customerName}</p>
        </div>
        <div className="ambient-opportunity-total" aria-label={`Quoted total ${model.identity.total}`}>
          <span>Quoted total</span>
          <strong>{model.identity.total}</strong>
        </div>
      </header>

      <dl className="ambient-opportunity-glance" aria-label="Opportunity at a glance">
        <div className="ambient-event-logistics-glance" data-event-logistics-layout="responsive">
          <dt>Event details</dt>
          <dd className="ambient-event-logistics-values">
            {EVENT_LOGISTICS_KINDS.map((kind) => (
              <EventLogisticsValue
                key={kind}
                kind={kind}
                descriptor={model.eventLogisticsObjects[kind]}
                action={model.actions[EVENT_LOGISTICS_UI[kind].inspect]}
                triggerRef={eventLogisticsTriggerRefs.current[kind]}
                onInspect={openEventLogisticsContext}
              />
            ))}
          </dd>
        </div>
        <div data-glance="state">
          <dt>State</dt>
          <dd>
            <span>{model.identity.status.label}</span>
            <small>{model.momentum.proposal.value} proposal completeness</small>
          </dd>
        </div>
        <div data-glance="risk" data-tone={model.risk.tone}>
          <dt>What matters</dt>
          <dd>
            <span>{model.risk.title}</span>
            <small>{model.risk.label}</small>
          </dd>
        </div>
        <div data-glance="next">
          <dt>Next</dt>
          <dd>
            <span>{model.nextAction.title}</span>
            {model.nextAction.kind === "caught_up" ? (
              <small>{model.nextAction.label}</small>
            ) : (
              <button
                type="button"
                className="ambient-next-action"
                onClick={runNextAction}
                data-ambient-action-id={model.actions.primary.id}
              >
                {model.nextAction.label}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            )}
          </dd>
        </div>
      </dl>

      <section className="ambient-pilot-sentence" data-origin="system" aria-label="Opportunity recommendation">
        <Sparkle size={20} weight="fill" aria-hidden="true" />
        <p>{model.pilotSentence}</p>
        <button
          type="button"
          ref={pilotTriggerRef}
          onClick={() => openPilotContext()}
          aria-haspopup="dialog"
          data-ambient-action-id={model.actions.explainNextAction.id}
        >
          Why this?
        </button>
      </section>

      <ActionAcknowledgement value={acknowledgement} />
      {feedbackEvent && (
        <p
          key={feedbackEvent.id}
          className="visually-hidden ambient-feedback-announcement"
          role="status"
          aria-live="polite"
        >
          {feedbackEvent.causalText}
        </p>
      )}

      <section className="ambient-disclosure" aria-label="Opportunity detail layers">
        {!operationalFactsVisible && (
          <button
            type="button"
            className="ambient-disclosure-trigger"
            onClick={revealOperationalFacts}
            aria-expanded="false"
            aria-controls="ambient-operational-facts"
            data-ambient-action-id={model.actions.revealOperationalFacts.id}
          >
            Show event, menu, staffing, and pricing
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        )}

        {operationalFactsVisible && (
          <section
            id="ambient-operational-facts"
            className="ambient-disclosure-layer"
            ref={operationalFactsRef}
            tabIndex={-1}
            data-disclosure-layer="operational"
            data-surface-purpose={model.surfaceContracts.operationalFacts.purposes.join(" ")}
            aria-labelledby="ambient-operational-facts-title"
          >
            <header>
              <h2 id="ambient-operational-facts-title">Event, menu, staffing, pricing</h2>
              <p>These are saved event, menu, staffing, and pricing details. Missing costs or activity are marked as unavailable.</p>
            </header>
            <DisclosureFacts items={model.disclosureLayers.operational} />
            {!supportingEvidenceVisible && (
              <button
                type="button"
                className="ambient-disclosure-trigger ambient-disclosure-trigger-deeper"
                onClick={revealSupportingEvidence}
                aria-expanded="false"
                aria-controls="ambient-supporting-evidence"
                data-ambient-action-id={model.actions.revealSupportingEvidence.id}
              >
                Show more context
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            )}
          </section>
        )}

        {supportingEvidenceVisible && (
          <section
            id="ambient-supporting-evidence"
            className="ambient-disclosure-layer ambient-disclosure-layer-supporting"
            ref={supportingEvidenceRef}
            tabIndex={-1}
            data-disclosure-layer="supporting"
            data-surface-purpose={model.surfaceContracts.supportingEvidence.purposes.join(" ")}
            aria-labelledby="ambient-supporting-evidence-title"
          >
            <header>
              <h2 id="ambient-supporting-evidence-title">More context</h2>
              <p>Missing information is labeled as unavailable. Review the available details before acting on a recommendation.</p>
            </header>
            <DisclosureFacts items={model.disclosureLayers.supporting} />
          </section>
        )}
      </section>

      <section className="ambient-object-field" aria-labelledby="ambient-object-title">
        <div className="ambient-section-intro">
          <p className="ambient-kicker">Connected details</p>
          <h2 id="ambient-object-title">Details affecting this quote</h2>
          <p>Explore a detail to understand what it connects to, why it matters, and what happens if it stays as it is.</p>
        </div>
        <div className="ambient-object-list">
          <div className="ambient-object-row" data-intelligent-object="guest-count">
            <div className="ambient-object-symbol" aria-hidden="true">
              <UsersThree size={22} weight="duotone" />
            </div>
            <div className="ambient-object-copy">
              <span>Guest count</span>
              <InlineValue
                ref={guestInlineRef}
                label="Guest count scenario"
                value={model.guestObject.scenarioGuestCount}
                displayValue={`${model.guestObject.scenarioGuestCount} guests`}
                inputType="number"
                inputMode="numeric"
                editorProps={{ min: 1, max: 400, step: 1 }}
                parseValue={(value) => Number(value)}
                validate={validateAmbientGuestCount}
                onCommit={commitGuestScenario}
                onEditStart={openGuestInlineEdit}
                onCancel={cancelGuestInlineEdit}
                onCommitStart={beginGuestCommit}
                onValidationError={clarifyGuestValidation}
                onCommitError={recoverGuestCommit}
                editActionId={model.actions.openGuestInlineEdit.id}
                commitActionId={model.actions.simulateGuestCount.id}
                cancelActionId={model.actions.cancelGuestInlineEdit.id}
                disabled={!ordinaryEditAllowed}
              />
              <small>
                {model.guestObject.scenarioChanged
                  ? `Scenario only. Saved record: ${recordedGuestCount} guests.`
                  : "Saved guest count. Select it to see what a change could affect."}
              </small>
            </div>
            <button
              type="button"
              className="ambient-inspect-action"
              onClick={openGuestContext}
              ref={guestInspectRef}
              aria-haspopup="dialog"
              data-ambient-action-id={model.actions.inspectGuestCount.id}
            >
              See connections
            </button>
          </div>

          {model.packageObject.permissions.view && (
            <div
              className="ambient-object-row"
              data-intelligent-object="package"
              data-evidence-state={model.packageObject.savedSelection.state}
            >
              <div className="ambient-object-symbol ambient-object-symbol--package" aria-hidden="true">
                <Package size={22} weight="duotone" />
              </div>
              <div className="ambient-object-copy">
                <span>Package</span>
                <strong className="ambient-object-value">
                  {model.packageObject.savedSelection.packageName || "Not recorded"}
                </strong>
                <small>
                  Saved package. {catalogContextSummary(model.packageMenuCatalogContext)}
                </small>
              </div>
              {model.actions.inspectPackage.enabled && (
                <button
                  type="button"
                  className="ambient-inspect-action"
                  onClick={openPackageContext}
                  ref={packageInspectRef}
                  aria-haspopup="dialog"
                  data-ambient-action-id={model.actions.inspectPackage.id}
                >
                  Review package
                </button>
              )}
            </div>
          )}

          {model.menuObject.permissions.view && (
            <div
              className="ambient-object-row"
              data-intelligent-object="menu"
              data-evidence-state={model.menuObject.savedSelection.state}
            >
              <div className="ambient-object-symbol ambient-object-symbol--menu" aria-hidden="true">
                <ForkKnife size={22} weight="duotone" />
              </div>
              <div className="ambient-object-copy">
                <span>Menu</span>
                <strong className="ambient-object-value">
                  {model.menuObject.items.length} saved {model.menuObject.items.length === 1 ? "item" : "items"}
                </strong>
                <small>
                  Saved order and quantities. {catalogContextSummary(model.packageMenuCatalogContext)}
                </small>
              </div>
              {model.actions.inspectMenu.enabled && (
                <button
                  type="button"
                  className="ambient-inspect-action"
                  onClick={openMenuContext}
                  ref={menuInspectRef}
                  aria-haspopup="dialog"
                  data-ambient-action-id={model.actions.inspectMenu.id}
                >
                  Review menu
                </button>
              )}
            </div>
          )}

          {model.selectionObjects.populated && (
            <div
              className="ambient-object-row"
              data-intelligent-object="event-selections"
              data-evidence-state={model.selectionObjects.catalogContext.state}
              data-scenario-state={selectionScenarioCount > 0 ? "active" : "saved"}
            >
              <div className="ambient-object-symbol ambient-object-symbol--selections" aria-hidden="true">
                <Sparkle size={22} weight="duotone" />
              </div>
              <div className="ambient-object-copy">
                <span>Add-ons, rentals, bar, and services</span>
                <strong className="ambient-object-value">{model.selectionObjects.summary}</strong>
                <small>
                  {selectionScenarioCount > 0
                    ? `${selectionScenarioCount} reversible local ${selectionScenarioCount === 1 ? "change" : "changes"}. Not priced or saved.`
                    : `${model.selectionObjects.stageableCount} saved ${model.selectionObjects.stageableCount === 1 ? "selection can" : "selections can"} be previewed here.`}
                </small>
              </div>
              {model.actions.inspectSelections.enabled && (
                <button
                  type="button"
                  className="ambient-inspect-action"
                  onClick={openSelectionContext}
                  ref={selectionInspectRef}
                  aria-haspopup="dialog"
                  data-ambient-action-id={model.actions.inspectSelections.id}
                >
                  Review selections
                </button>
              )}
            </div>
          )}

          <div
            className="ambient-object-row"
            data-intelligent-object="staffing"
            data-scenario-state={staffingScenarioStale ? "stale" : staffingScenario ? "active" : "saved"}
          >
            <div className="ambient-object-symbol ambient-object-symbol--staffing" aria-hidden="true">
              <UserGear size={22} weight="duotone" />
            </div>
            <div className="ambient-object-copy">
              <span>Staffing</span>
              <strong className="ambient-object-value">{staffingLabel(activeStaffing)}</strong>
              <small>
                {staffingScenarioStale
                  ? `Refresh required: this scenario used ${staffingScenario.basisGuestCount} guests.`
                  : staffingScenario
                    ? `Local recommendation for ${staffingScenario.basisGuestCount} guests. Not yet priced or saved.`
                    : model.staffingObject.hasRecommendation
                      ? model.staffingObject.descriptor.recommendation?.summary
                      : model.staffingObject.unavailableReason}
              </small>
            </div>
            <button
              type="button"
              className="ambient-inspect-action"
              onClick={openStaffingContext}
              ref={staffingInspectRef}
              aria-haspopup="dialog"
              data-ambient-action-id={model.actions.inspectStaffing.id}
            >
              Review staffing
            </button>
          </div>

          <div className="ambient-object-row" data-intelligent-object="pricing">
            <div className="ambient-object-symbol ambient-object-symbol--pricing" aria-hidden="true">
              <CurrencyDollar size={22} weight="duotone" />
            </div>
            <div className="ambient-object-copy">
              <span>Pricing</span>
              <strong className="ambient-object-value">
                {model.pricingObject.available ? money(model.pricingObject.total) : "Unavailable"}
              </strong>
              <small>
                {model.pricingObject.exactSavedAuthority
                  ? "Current saved pricing. QuotePilot recalculates any change before it can be saved."
                  : model.pricingObject.descriptor.confidence.basis}
              </small>
            </div>
            <button
              type="button"
              className="ambient-inspect-action"
              onClick={openPricingContext}
              ref={pricingInspectRef}
              aria-haspopup="dialog"
              data-ambient-action-id={model.actions.inspectPricing.id}
              data-capability-entry="aiui-10-pricing-impact-preview"
            >
              Review pricing
            </button>
          </div>

          <div
            className="ambient-object-row"
            data-intelligent-object="money"
            data-evidence-state={model.moneyObject.descriptor.confidence.level}
          >
            <div className="ambient-object-symbol ambient-object-symbol--money" aria-hidden="true">
              <Wallet size={22} weight="duotone" />
            </div>
            <div className="ambient-object-copy">
              <span>Payments</span>
              <strong className="ambient-object-value">
                {Number.isSafeInteger(model.moneyObject.stages[0]?.amountCents)
                  ? `${money(model.moneyObject.stages[0].amountCents / 100)} deposit requirement`
                  : "Deposit requirement unavailable"}
              </strong>
              <small>Review the deposit rule, payment requests, and recorded payments separately.</small>
            </div>
            <button
              type="button"
              className="ambient-inspect-action"
              onClick={openMoneyContext}
              ref={moneyInspectRef}
              aria-haspopup="dialog"
              data-ambient-action-id={model.actions.inspectMoney.id}
              data-capability-entry="aiui-32-money-evidence"
            >
              Review payments
            </button>
          </div>

          <div
            className="ambient-object-row"
            data-intelligent-object="proposal"
            data-proposal-state={model.proposalObject.state}
            data-evidence-state={model.proposalObject.descriptor.confidence.level}
          >
            <div className="ambient-object-symbol ambient-object-symbol--proposal" aria-hidden="true">
              <FileText size={22} weight="duotone" />
            </div>
            <div className="ambient-object-copy">
              <span>Proposal</span>
              <strong className="ambient-object-value">
                {Number.isFinite(Number(model.proposalObject.readiness.score))
                  ? `${model.proposalObject.readiness.score}% proposal completeness`
                  : "Proposal completeness unavailable"}
              </strong>
              <small>
                {proposalStateLabel(model.proposalObject.state)} · {model.proposalObject.descriptor.summary}
              </small>
            </div>
            <button
              type="button"
              className="ambient-inspect-action"
              onClick={openProposalContext}
              ref={proposalInspectRef}
              aria-haspopup="dialog"
              disabled={!model.actions.inspectProposal.enabled}
              title={model.actions.inspectProposal.disabledReason || undefined}
              data-ambient-action-id={model.actions.inspectProposal.id}
            >
              Review proposal
            </button>
          </div>

          {model.conversationObject.descriptor.permissions.view && (
            <div
              className="ambient-object-row"
              data-intelligent-object="conversation"
              data-conversation-state={model.conversationObject.state}
              data-conversation-availability={model.conversationObject.access.state}
              data-evidence-state={model.conversationObject.descriptor.confidence.level}
            >
              <div className="ambient-object-symbol ambient-object-symbol--conversation" aria-hidden="true">
                <ChatCenteredDots size={22} weight="duotone" />
              </div>
              <div className="ambient-object-copy">
                <span>Conversation</span>
                <strong className="ambient-object-value">
                  {model.conversationObject.nextResolution.availability === "available"
                    ? model.conversationObject.nextResolution.label
                    : "Sent, delivered, viewed, and replied stay separate."}
                </strong>
                <small>
                  {conversationStateLabel(model.conversationObject.state)} · {model.conversationObject.descriptor.summary}
                </small>
              </div>
              <button
                type="button"
                className="ambient-inspect-action"
                onClick={openConversationContext}
                ref={conversationInspectRef}
                aria-haspopup="dialog"
                disabled={!model.actions.inspectConversation.enabled}
                title={model.actions.inspectConversation.disabledReason || undefined}
                data-ambient-action-id={model.actions.inspectConversation.id}
                data-capability-entry="aiui-34-conversation-evidence"
              >
                Review conversation
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="ambient-momentum" aria-labelledby="ambient-momentum-title">
        <div className="ambient-section-intro">
          <p className="ambient-kicker">Current picture</p>
          <h2 id="ambient-momentum-title">Status by area</h2>
          <p>Proposal, pricing, customer, and event status stay separate, so you can see what needs attention.</p>
        </div>
        <dl>
          {Object.values(model.momentum).map((item) => (
            <MomentumDimension key={item.id} item={item} />
          ))}
        </dl>
      </section>

      <footer className="ambient-opportunity-evidence">
        <Info size={17} aria-hidden="true" />
        <p>{model.evidenceNote} {model.editBoundary}</p>
        {typeof onOpenLegacyWorkspace === "function" && (
          <button
            type="button"
            className="ambient-legacy-controls"
            onClick={openLegacyWorkspace}
            data-ambient-action-id={model.actions.openLegacyControls.id}
          >
            Open quote workspace
          </button>
        )}
      </footer>

      <AmbientUndoRail
        model={undoModel}
        label="Reversible scenarios"
        onUndoStart={beginUndoScenario}
        onUndoResult={finishUndoScenario}
        onClearStart={beginClearScenarioHistory}
        onClear={finishClearScenarioHistory}
        undoActionId={(entry) => entry.actionId}
        clearActionId={model.actions.clearScenarioHistory.id}
      />

      {activeEventLogisticsObject && (
        <ContextSurface
          key={eventLogisticsOpenKind}
          open
        title={`${activeEventLogisticsObject.label} details`}
          description={`${model.identity.eventName}, ${model.identity.quoteNumber}`}
          reason={activeEventLogisticsObject.why}
          consequence={activeEventLogisticsObject.consequence}
          anchorRef={activeEventLogisticsTriggerRef.current
            || eventLogisticsTriggerRefs.current[eventLogisticsOpenKind]}
          returnFocusRef={activeEventLogisticsTriggerRef.current
            || eventLogisticsTriggerRefs.current[eventLogisticsOpenKind]}
          onClose={dismissEventLogisticsContext}
          closeActionId={model.actions[activeEventLogisticsActions.dismiss].id}
          footer={eventLogisticsFooter}
        >
          <div
            className="ambient-context-content ambient-event-logistics-context"
            data-event-logistics-context={eventLogisticsOpenKind}
            data-presentation-authority={activeEventLogisticsObject.presentationAuthority}
          >
            <div
              className="ambient-context-state"
              data-tone={activeEventLogisticsObject.savedValue.state === "available" ? "mint" : "coral"}
              data-saved-value-state={activeEventLogisticsObject.savedValue.state}
            >
              <span>Saved value</span>
              <strong>{activeEventLogisticsObject.savedValue.displayValue}</strong>
              <small>{activeEventLogisticsObject.savedValue.reason || "Recorded on the selected saved quote."}</small>
            </div>

            <section>
              <h3>What this connects to</h3>
              <ul className="ambient-event-logistics-evidence-list">
                {Object.values(activeEventLogisticsObject.evidenceSlots).map((slot) => (
                  <li key={slot.id} data-evidence-state={slot.state}>
                    <div>
                      <strong>{slot.label}</strong>
                      <span>{slot.state}</span>
                    </div>
                    <p>{slot.claim || slot.reason}</p>
                    {slot.claim && slot.reason && <p>Freshness boundary: {slot.reason}</p>}
                    {(slot.sourceLabel || slot.observedAt) && (
                      <small>
                        {[slot.sourceLabel, slot.observedAt ? `Observed ${slot.observedAt}` : ""].filter(Boolean).join(" · ")}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="ambient-counterfactuals">
              <div>
                <CheckCircle size={18} weight="fill" aria-hidden="true" />
                <h3>Why this matters</h3>
                <p>{activeEventLogisticsObject.why}</p>
              </div>
              <div>
                <WarningCircle size={18} weight="fill" aria-hidden="true" />
                <h3>If you do nothing</h3>
                <p>{activeEventLogisticsObject.doNothing}</p>
              </div>
            </section>

            <p className="ambient-provenance">
              <strong>Confidence: {activeEventLogisticsObject.confidence.level}.</strong>{" "}
              {activeEventLogisticsObject.confidence.basis}{" "}
              Sources: {activeEventLogisticsObject.provenance.map((item) => item.label).join("; ")}.
            </p>
            <p className="ambient-boundary-note">
              Advisory event-logistics context only. It does not prove availability, reserve capacity, reprice the quote, schedule work, extend quote validity, or save a draft.
            </p>
          </div>
        </ContextSurface>
      )}

      <ContextSurface
        open={guestOpen}
        title="Guest count connections"
        description={`${model.identity.eventName}, ${model.identity.quoteNumber}`}
        reason={model.guestObject.why}
        consequence={model.guestObject.consequence}
        anchorRef={guestInspectRef}
        returnFocusRef={guestInspectRef}
        onClose={dismissGuestContext}
        closeActionId={model.actions.dismissGuestContext.id}
        footer={guestFooter}
      >
        <div className="ambient-context-content">
          <div className="ambient-context-state" data-tone="teal">
            <span>Scenario</span>
            <strong>{model.guestObject.scenarioGuestCount} guests</strong>
            <small>{model.guestObject.preview.reason}</small>
          </div>
          <section>
            <h3>What this connects to</h3>
            <ul className="ambient-dependency-list">
              {model.guestObject.dependencies.map((item) => (
                <li key={item.id}>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="ambient-counterfactuals">
            <div>
              <CheckCircle size={18} weight="fill" aria-hidden="true" />
              <h3>Why this recommendation</h3>
              <p>{model.guestObject.why}</p>
            </div>
            <div>
              <WarningCircle size={18} weight="fill" aria-hidden="true" />
              <h3>If you do nothing</h3>
              <p>{model.guestObject.doNothing}</p>
            </div>
          </section>
          <p className="ambient-provenance">
            <strong>Confidence: {model.guestObject.confidence}.</strong> Source: {model.guestObject.provenance}.
          </p>
        </div>
      </ContextSurface>

      <ContextSurface
        open={packageOpen}
        title="Package details"
        description={`${model.identity.eventName}, ${model.identity.quoteNumber}`}
        reason={model.packageObject.why}
        consequence={model.packageObject.consequence}
        anchorRef={packageInspectRef}
        returnFocusRef={packageInspectRef}
        onClose={dismissPackageContext}
        closeActionId={model.actions.dismissPackageContext.id}
      >
        <div
          className="ambient-context-content ambient-package-menu-context"
          data-intelligent-object-context="package"
          data-catalog-state={model.packageMenuCatalogContext.state}
        >
          <div
            className="ambient-context-state"
            data-tone={model.packageObject.savedSelection.state === "available" ? "mint" : "coral"}
          >
            <span>Saved package</span>
            <strong>{model.packageObject.savedSelection.packageName || "Not recorded"}</strong>
            <small>
              {model.packageObject.savedSelection.packageId
                ? `Catalog match: ${catalogStateLabel(model.packageObject.savedSelection.catalogMatch.state)}.`
                : model.packageObject.savedSelection.reason}
            </small>
          </div>

          <section>
            <h3>Recorded inclusions</h3>
            <div className="ambient-package-inclusion-groups">
              {["menuItems", "addons", "rentals"].map((kind) => {
                const entries = model.packageObject.recordedInclusions[kind] || [];
                const label = kind === "menuItems" ? "Menu items" : kind === "addons" ? "Add-ons" : "Rentals";
                return (
                  <div key={kind}>
                    <strong>{label}</strong>
                    {entries.length > 0 ? (
                      <ul>
                        {entries.map((entry, index) => (
                          <li key={entry.id || `${kind}-${index}`}>{entry.name}</li>
                        ))}
                      </ul>
                    ) : <span>None recorded</span>}
                  </div>
                );
              })}
            </div>
            {model.packageObject.recordedInclusions.reason && (
              <p className="ambient-boundary-note">{model.packageObject.recordedInclusions.reason}</p>
            )}
          </section>

          {model.actions.replacePackageInDraft && (
            <section>
              <h3>Available package choices</h3>
              <p className="ambient-object-instruction">
                Choose a current catalog option to review in the editor. A catalog listing does not confirm availability for this event.
              </p>
              <div className="ambient-candidate-list">
                {model.packageObject.replacementCandidates.items
                  .filter((candidate) => candidate.draftReplacementEligible)
                  .map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      className="ambient-candidate-action"
                      onClick={() => stagePackageReplacement(candidate)}
                      data-ambient-action-id={model.actions.replacePackageInDraft.id}
                    >
                      <span>{candidate.name}</span>
                      <small>Review replacement in editor</small>
                      <ArrowRight size={17} aria-hidden="true" />
                    </button>
                  ))}
              </div>
            </section>
          )}

          <section>
            <h3>What this connects to</h3>
            <ul className="ambient-dependency-list">
              {model.packageObject.dependencies.map((item) => (
                <li key={item.object.id}>
                  <strong>{item.object.label}</strong>
                  <span>{item.consequence}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="ambient-counterfactuals">
            <div>
              <CheckCircle size={18} weight="fill" aria-hidden="true" />
              <h3>Why this matters</h3>
              <p>{model.packageObject.why}</p>
            </div>
            <div>
              <WarningCircle size={18} weight="fill" aria-hidden="true" />
              <h3>If you do nothing</h3>
              <p>{model.packageObject.doNothing}</p>
            </div>
          </section>
          <p className="ambient-provenance">
            <strong>Confidence: {model.packageObject.confidence.level}.</strong>{" "}
            {model.packageObject.confidence.basis}{" "}
            Sources: {model.packageObject.provenance.map((item) => item.label).join("; ")}.
          </p>
          <p className="ambient-boundary-note">
            Advisory selection evidence only. This inspector does not calculate price or margin, prove availability, reserve inventory or service, reconcile package inclusions, or save a quote.
          </p>
        </div>
      </ContextSurface>

      <ContextSurface
        open={menuOpen}
        title="Menu details"
        description={`${model.identity.eventName}, ${model.identity.quoteNumber}`}
        reason={model.menuObject.why}
        consequence={model.menuObject.consequence}
        anchorRef={menuInspectRef}
        returnFocusRef={menuInspectRef}
        onClose={dismissMenuContext}
        closeActionId={model.actions.dismissMenuContext.id}
      >
        <div
          className="ambient-context-content ambient-package-menu-context"
          data-intelligent-object-context="menu"
          data-catalog-state={model.packageMenuCatalogContext.state}
        >
          <div
            className="ambient-context-state"
            data-tone={model.menuObject.savedSelection.state === "available" ? "mint" : "coral"}
          >
            <span>Saved menu</span>
            <strong>{model.menuObject.items.length} saved {model.menuObject.items.length === 1 ? "item" : "items"}</strong>
            <small>{model.menuObject.savedSelection.reason || "Order, quantities, and saved inclusion links remain distinct from today's catalog."}</small>
          </div>

          <section>
            <h3>Saved order and quantities</h3>
            <ol className="ambient-menu-order-list">
              {model.menuObject.items.map((item, index) => (
                <li
                  key={item.id || `saved-menu-${index}`}
                  draggable={Boolean(model.actions.reorderMenuInDraft)}
                  onDragStart={() => { menuDragItemRef.current = item.id || ""; }}
                  onDragOver={(event) => {
                    if (model.actions.reorderMenuInDraft) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const movedItemId = menuDragItemRef.current;
                    menuDragItemRef.current = "";
                    stageMenuReorder(movedItemId, index, "pointer");
                  }}
                  onDragEnd={() => { menuDragItemRef.current = ""; }}
                  data-menu-item-id={item.id || undefined}
                  data-ambient-action-id={model.actions.reorderMenuInDraft?.id}
                >
                  <div>
                    <strong>{item.savedName || item.id || "Unnamed saved item"}</strong>
                    <span>
                      Quantity {item.quantity ?? "not recorded"} · {item.includedInPackage === true
                        ? "included in saved package"
                        : item.includedInPackage === false
                          ? "not included in saved package"
                          : "package inclusion not recorded"}
                    </span>
                    <small>Catalog match: {catalogStateLabel(item.catalogMatch.state)}.</small>
                  </div>
                  {model.actions.reorderMenuInDraft && (
                    <div className="ambient-menu-move-actions" aria-label={`Move ${item.savedName || item.id}`}>
                      {index > 0 && (
                        <button
                          type="button"
                          onClick={() => stageMenuReorder(item.id, index - 1, "keyboard")}
                          data-ambient-action-id={model.actions.reorderMenuInDraft.id}
                          aria-label={`Move ${item.savedName || item.id} earlier`}
                        >
                          Move earlier
                        </button>
                      )}
                      {index < model.menuObject.items.length - 1 && (
                        <button
                          type="button"
                          onClick={() => stageMenuReorder(item.id, index + 1, "keyboard")}
                          data-ambient-action-id={model.actions.reorderMenuInDraft.id}
                          aria-label={`Move ${item.savedName || item.id} later`}
                        >
                          Move later
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {model.actions.replaceMenuItemInDraft && (
            <section className="ambient-menu-replacement">
              <h3>Available menu replacements</h3>
              <label>
                <span>Replace this saved item</span>
                <select
                  value={menuReplacementSourceId}
                  onChange={(event) => setMenuReplacementSourceId(event.target.value)}
                >
                  {model.menuObject.items.map((item) => (
                    <option key={item.id} value={item.id}>{item.savedName || item.id}</option>
                  ))}
                </select>
              </label>
              <p className="ambient-object-instruction">
                QuotePilot keeps this item's saved quantity and position. Review price and connected effects in the editor.
              </p>
              <div className="ambient-candidate-list">
                {model.menuObject.replacementCandidates.items
                  .filter((candidate) => candidate.draftReplacementEligible)
                  .map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      className="ambient-candidate-action"
                      onClick={() => stageMenuReplacement(candidate)}
                      data-ambient-action-id={model.actions.replaceMenuItemInDraft.id}
                    >
                      <span>{candidate.name}</span>
                      <small>{candidate.section.label} · review replacement</small>
                      <ArrowRight size={17} aria-hidden="true" />
                    </button>
                  ))}
              </div>
            </section>
          )}

          <section>
            <h3>What this connects to</h3>
            <ul className="ambient-dependency-list">
              {model.menuObject.dependencies.map((item) => (
                <li key={item.object.id}>
                  <strong>{item.object.label}</strong>
                  <span>{item.consequence}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="ambient-counterfactuals">
            <div>
              <CheckCircle size={18} weight="fill" aria-hidden="true" />
              <h3>Why this matters</h3>
              <p>{model.menuObject.why}</p>
            </div>
            <div>
              <WarningCircle size={18} weight="fill" aria-hidden="true" />
              <h3>If you do nothing</h3>
              <p>{model.menuObject.doNothing}</p>
            </div>
          </section>
          <p className="ambient-provenance">
            <strong>Confidence: {model.menuObject.confidence.level}.</strong>{" "}
            {model.menuObject.confidence.basis}{" "}
            Sources: {model.menuObject.provenance.map((item) => item.label).join("; ")}.
          </p>
          <p className="ambient-boundary-note">
            Advisory selection evidence only. This inspector does not calculate price or margin, prove preparation or availability, alter quantity, or save a quote.
          </p>
        </div>
      </ContextSurface>

      <ContextSurface
        open={selectionOpen}
        title="Selection details"
        description={`${model.identity.eventName}, ${model.identity.quoteNumber}`}
        reason={model.actions.inspectSelections.arrivalContract.reason}
        consequence={model.actions.inspectSelections.arrivalContract.consequence}
        anchorRef={selectionInspectRef}
        returnFocusRef={selectionInspectRef}
        onClose={dismissSelectionContext}
        closeActionId={model.actions.dismissSelectionContext.id}
      >
        <div
          className="ambient-context-content"
          data-intelligent-object-context="event-selections"
          data-catalog-state={model.selectionObjects.catalogContext.state}
          data-selection-scenario-count={selectionScenarioCount}
        >
          <div
            className="ambient-context-state"
            data-tone={selectionScenarioCount > 0 ? "teal" : "lavender"}
          >
            <span>{selectionScenarioCount > 0 ? "Unsaved preview active" : "Saved selections"}</span>
            <strong>{model.selectionObjects.summary}</strong>
            <small>
              {selectionScenarioCount > 0
                ? `${selectionScenarioCount} unsaved ${selectionScenarioCount === 1 ? "change is" : "changes are"} reversible from history.`
                : "Open each object to understand why it is grouped, what it depends on, and what happens if it stays unchanged."}
            </small>
          </div>
          <AmbientSelectionObjects
            groups={model.selectionObjects.groups}
            scenario={selectionScenario}
            actions={model.selectionObjectActions}
            onAdjust={adjustSelectionScenario}
            onKeep={keepSavedSelection}
          />
          <p className="ambient-boundary-note">
            Selection previews are advisory, unpriced, reversible, and unsaved. They do not reserve inventory or staff, alter a package, confirm availability, contact a customer, or bypass the current calculator and trusted save path.
          </p>
        </div>
      </ContextSurface>

      <ContextSurface
        open={pricingOpen}
        title="Pricing details"
        description={`${model.identity.eventName}, ${model.identity.quoteNumber}`}
        reason={model.pricingObject.why}
        consequence={model.pricingObject.consequence}
        anchorRef={pricingInspectRef}
        returnFocusRef={pricingInspectRef}
        onClose={dismissPricingContext}
        closeActionId={model.actions.dismissPricingContext.id}
        footer={pricingFooter}
      >
        <div
          className="ambient-context-content"
          data-capability-id="aiui-10-pricing-impact-preview"
          data-capability-state={pricingCapabilityState(
            pricingPreviewState.status,
            pricingPreviewState.preview
          )}
          data-pricing-preview-state={pricingPreviewState.status}
        >
          <div
            className="ambient-context-state"
            data-tone={model.pricingObject.exactSavedAuthority ? "mint" : "teal"}
          >
            <span>{model.pricingObject.exactSavedAuthority ? "Current saved pricing" : "Saved pricing record"}</span>
            <strong>{model.pricingObject.available ? money(model.pricingObject.total) : "Unavailable"}</strong>
            <small>
              {model.pricingObject.calculatedAt
                ? `Calculated ${model.pricingObject.calculatedAtLabel || "from the current saved quote"}.`
                : "Current saved pricing; calculation time unavailable."}
            </small>
          </div>

          <section>
            <h3>Quote amounts</h3>
            <dl className="ambient-pricing-metrics">
              <div><dt>Subtotal</dt><dd>{money(model.pricingObject.subtotal)}</dd></div>
              <div><dt>Deposit requirement</dt><dd>{money(model.pricingObject.deposit)}</dd></div>
              <div><dt>Recorded discount</dt><dd>{money(model.pricingObject.discountTotal)}</dd></div>
              <div>
                <dt>Discount adjustment</dt>
                <dd>{model.pricingObject.discountAdjustmentAvailable ? "Available" : "Unavailable in pricing v1"}</dd>
              </div>
            </dl>
            {model.pricingObject.breakdown.length > 0 && (
              <ul className="ambient-pricing-breakdown" aria-label="Saved price breakdown">
                {model.pricingObject.breakdown.map((item) => (
                  <li key={item.id}>
                    <span>{item.label} · {item.lineCount} {item.lineCount === 1 ? "line" : "lines"}</span>
                    <strong>{item.formattedAmount}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>Margin</h3>
            {model.pricingObject.margin?.available ? (
              <div className="ambient-pricing-margin" data-state="available">
                <strong>{(Number(model.pricingObject.margin.marginPct) * 100).toFixed(1)}% recorded-cost margin</strong>
                <span>{model.pricingObject.margin.targetNote || model.pricingObject.margin.note}</span>
                {model.pricingObject.targetGap && (
                  <small>
                    {model.pricingObject.targetGap.points.toFixed(1)} points and approximately {money(model.pricingObject.targetGap.amount)} below target.
                  </small>
                )}
              </div>
            ) : (
              <div className="ambient-pricing-margin" data-state="unavailable">
                <strong>Margin unavailable</strong>
                <span>Add current costs for every selected item to see margin.</span>
                <ul>
                  {model.pricingObject.missingCostEvidence.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
          </section>

          <section>
            <h3>What this connects to</h3>
            <ul className="ambient-dependency-list">
              {model.pricingObject.dependencies.map((item) => (
                <li key={item.object.id}>
                  <strong>{item.object.label}</strong>
                  <span>{item.consequence}</span>
                </li>
              ))}
            </ul>
          </section>

          {pricingPreviewState.status !== "idle" && (
            <section
              className="ambient-pricing-preview"
              data-pricing-result-state={pricingPreviewState.status}
              aria-live="polite"
            >
              <h3>Guest count price preview</h3>
              {["loading", "recovery"].includes(pricingPreviewState.status) && (
                <p>Calculating this price preview. The saved quote remains unchanged.</p>
              )}
              {pricingPreviewState.error && (
                <p role="alert">{pricingPreviewState.error}</p>
              )}
              {pricingPreviewState.preview && (
                <>
                  <div className="ambient-pricing-preview-values">
                    <div>
                      <span>
                        {pricingPreviewState.preview.previewKind === "server_simulation"
                          ? "Saved version"
                          : "Current catalog price"}
                      </span>
                      <strong>{money(pricingPreviewState.preview.before?.commercial?.total)}</strong>
                    </div>
                    <div>
                      <span>Scenario</span>
                      <strong>{money(pricingPreviewState.preview.after?.commercial?.total)}</strong>
                    </div>
                    <div>
                      <span>Change</span>
                      <strong>{money(pricingPreviewState.preview.commercialDeltas?.total?.delta)}</strong>
                    </div>
                  </div>
                  <p>{pricingPreviewState.preview.consequence}</p>
                  <p><strong>If unchanged:</strong> {pricingPreviewState.preview.doNothing}</p>
                  <small>
                    {pricingPreviewState.preview.source?.label}. {pricingPreviewState.preview.receipt
                      ? `Server simulation receipt ${pricingPreviewState.preview.receipt.id} recorded. Nothing was saved.`
                      : "Planning preview only. Nothing was saved."}
                  </small>
                </>
              )}
              {pricingPreviewState.status === "success" && isStaffRole && (
                <div
                  className="ambient-pricing-scenario-margin"
                  data-margin-context-state={pricingPreviewState.marginContext?.status || "unavailable"}
                >
                  <h4>How margin would change</h4>
                  {pricingPreviewState.marginContext?.status === "available" ? (
                    <dl>
                      <div>
                        <dt>Current</dt>
                        <dd>{(Number(pricingPreviewState.marginContext.current.marginPct) * 100).toFixed(1)}%</dd>
                      </div>
                      <div>
                        <dt>Scenario</dt>
                        <dd>{(Number(pricingPreviewState.marginContext.proposed.marginPct) * 100).toFixed(1)}%</dd>
                      </div>
                      <div>
                        <dt>Point change</dt>
                        <dd>{Number(pricingPreviewState.marginContext.deltas.marginPoints) >= 0 ? "+" : ""}{Number(pricingPreviewState.marginContext.deltas.marginPoints).toFixed(1)} pts</dd>
                      </div>
                    </dl>
                  ) : (
                    <p>
                      {pricingPreviewState.marginContext?.unavailableReasons?.join(" ")
                        || "This preview does not have enough recorded cost information to show margin."}
                    </p>
                  )}
                  <small>
                    {pricingPreviewState.marginContext?.boundary
                      || "For planning only. Final pricing and approvals still happen through the saved quote workflow."}
                  </small>
                </div>
              )}
            </section>
          )}

          <section className="ambient-counterfactuals">
            <div>
              <CheckCircle size={18} weight="fill" aria-hidden="true" />
              <h3>Why this is here</h3>
              <p>{model.pricingObject.why}</p>
            </div>
            <div>
              <WarningCircle size={18} weight="fill" aria-hidden="true" />
              <h3>If you do nothing</h3>
              <p>{model.pricingObject.doNothing}</p>
            </div>
          </section>
          <p className="ambient-provenance">
            <strong>Confidence: {model.pricingObject.descriptor.confidence.level}.</strong>{" "}
            {model.pricingObject.descriptor.confidence.basis}{" "}
            Sources: {model.pricingObject.provenance.map((item) => item.label).join("; ")}.
          </p>
          <p className="ambient-boundary-note">
            Only staff can see cost and margin here. Nothing changes until you use the quote workflow, and customers never see these costs.
          </p>
        </div>
      </ContextSurface>

      <ContextSurface
        open={moneyOpen}
        title="Payments and balance"
        description={`${model.identity.eventName}, ${model.identity.quoteNumber}`}
        reason={model.moneyObject.descriptor.why}
        consequence={model.moneyObject.descriptor.consequence}
        anchorRef={moneyInspectRef}
        returnFocusRef={moneyInspectRef}
        onClose={dismissMoneyContext}
        closeActionId={model.actions.dismissMoneyContext.id}
      >
        <AmbientMoneyContext model={model.moneyObject} />
      </ContextSurface>

      <ContextSurface
        open={proposalOpen}
        title="Proposal details"
        description={`${model.identity.eventName}, ${model.identity.quoteNumber}`}
        reason={model.proposalObject.descriptor.why}
        consequence={model.proposalObject.descriptor.consequence}
        anchorRef={proposalInspectRef}
        returnFocusRef={proposalInspectRef}
        onClose={dismissProposalContext}
        closeActionId={model.actions.dismissProposalContext.id}
        footer={proposalFooter}
      >
        <AmbientProposalContext model={model.proposalObject} />
      </ContextSurface>

      <ContextSurface
        open={conversationOpen}
        title="Conversation details"
        description={`${model.identity.eventName}, ${model.identity.quoteNumber}`}
        reason={model.conversationObject.descriptor.why}
        consequence={model.conversationObject.descriptor.consequence}
        anchorRef={conversationInspectRef}
        returnFocusRef={conversationInspectRef}
        onClose={dismissConversationContext}
        closeActionId={model.actions.dismissConversationContext.id}
        footer={conversationFooter}
      >
        <AmbientConversationContext model={model.conversationObject} />
      </ContextSurface>

      <ContextSurface
        open={staffingOpen}
        title="Staffing suggestion"
        description={`${model.identity.eventName}, ${model.identity.quoteNumber}`}
        reason={model.staffingObject.why}
        consequence={model.staffingObject.consequence}
        anchorRef={staffingInspectRef}
        returnFocusRef={staffingInspectRef}
        onClose={dismissStaffingContext}
        closeActionId={model.actions.dismissStaffingContext.id}
        footer={staffingFooter}
      >
        <div className="ambient-context-content">
          <div
            className="ambient-context-state"
            data-tone={staffingScenarioStale ? "coral" : staffingScenario ? "teal" : "mint"}
          >
            <span>{staffingScenario ? "Unsaved preview" : "Saved quote"}</span>
            <strong>{staffingLabel(activeStaffing)}</strong>
            <small>
              {staffingScenarioStale
                ? `This recommendation used ${staffingScenario.basisGuestCount} guests; the active scenario now has ${model.staffingObject.guestCount}.`
                : model.staffingObject.hasRecommendation
                  ? model.staffingObject.descriptor.recommendation?.summary
                  : model.staffingObject.unavailableReason}
            </small>
          </div>
          <section>
            <h3>Saved and recommended</h3>
            <dl className="ambient-staffing-comparison">
              <div>
                <dt>Saved quote</dt>
                <dd>{staffingLabel(model.staffingObject.current)}</dd>
              </div>
              <div>
                <dt>House staffing guide</dt>
                <dd>{model.staffingObject.guidance.available
                  ? staffingLabel(model.staffingObject.recommended)
                  : "Unavailable"}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>What this connects to</h3>
            <ul className="ambient-dependency-list">
              {model.staffingObject.dependencies.map((item) => (
                <li key={item.object.id}>
                  <strong>{item.object.label}</strong>
                  <span>{item.consequence}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="ambient-counterfactuals">
            <div>
              <CheckCircle size={18} weight="fill" aria-hidden="true" />
              <h3>Why this recommendation</h3>
              <p>{model.staffingObject.why}</p>
            </div>
            <div>
              <WarningCircle size={18} weight="fill" aria-hidden="true" />
              <h3>If you do nothing</h3>
              <p>{model.staffingObject.doNothing}</p>
            </div>
          </section>
          <p className="ambient-provenance">
            <strong>Confidence: {model.staffingObject.descriptor.confidence.level}.</strong>{" "}
            {model.staffingObject.descriptor.confidence.basis}{" "}
            Sources: {model.staffingObject.provenance.map((item) => item.label).join("; ")}.
          </p>
          <p className="ambient-boundary-note">
            This is advisory staffing guidance. It does not prove staff availability, assignments, attendance, or operational readiness.
          </p>
          {OPERATIONAL_STAFFING_UI_ENABLED && OperationalStaffingPanel && (
            <Suspense fallback={(
              <section
                className="ambient-operational-staffing-loading"
                data-capability-state="loading"
                role="status"
                aria-live="polite"
              >
                Loading current staffing assignments and availability. Nothing is changing.
              </section>
            )}>
              <OperationalStaffingPanel
                open={staffingOpen}
                organizationId={ambientContext?.organizationId || quote?.organizationId || "local-fallback"}
                quote={quote}
                source={source}
                role={ambientRole}
                available={OPERATIONAL_STAFFING_UI_ENABLED}
              />
            </Suspense>
          )}
        </div>
      </ContextSurface>

      <ContextSurface
        open={pilotOpen}
        title="Why this recommendation appears"
        description={`${model.identity.eventName}, ${model.risk.label}`}
        reason={model.nextAction.reason}
        consequence={model.nextAction.consequence}
        anchorRef={pilotContextAnchorRef}
        returnFocusRef={pilotContextAnchorRef}
        align={pilotContextAlign}
        onClose={dismissPilotContext}
        closeActionId={model.actions.dismissPilotContext.id}
        className="ambient-pilot-context-surface"
        footer={model.nextAction.kind !== "caught_up" ? (
          <button
            type="button"
            className="cta ambient-outcome-button"
            onClick={runNextAction}
            data-ambient-action-id={model.actions.primary.id}
          >
            {model.nextAction.label}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        ) : null}
      >
        <div className="ambient-context-content">
          <section className="ambient-pilot-explanation">
            <p className="ambient-kicker">Why this is recommended</p>
            <h3>{model.risk.title}</h3>
            <p>{model.risk.detail}</p>
            <dl>
              <div><dt>Object</dt><dd>{model.identity.eventName}</dd></div>
              <div><dt>Source</dt><dd>{model.risk.provenance}</dd></div>
              <div><dt>What it affects</dt><dd>{model.nextAction.consequence}</dd></div>
              <div><dt>What you can do next</dt><dd>{model.nextAction.nextResolution}</dd></div>
            </dl>
          </section>
          <p className="ambient-boundary-note">
            Pilot uses only the details available on this opportunity and its workflow; it does not fill in missing information.
          </p>
        </div>
      </ContextSurface>
    </article>
  );
});

export default AmbientLivingOpportunity;
