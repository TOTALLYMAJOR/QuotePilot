import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getQuoteById,
  getQuoteHistory,
  requestQuoteApproval,
  resolveQuoteApprovalRequest,
  updateQuoteChangeRequestHandling,
  updateQuoteFollowUp
} from "../lib/quoteStore";
import {
  APPROVAL_ACTIONS,
  buildProposalReadiness,
  buildQuoteLifecycleTimeline,
  buildWorkflowAttentionSummary,
  FOLLOW_UP_STAGES,
  getApprovalActionEligibility,
  getApprovalRequestExecutionEligibility,
  getRequestableApprovalActions,
  getWorkflowAttentionFocusId,
  mergeUnreadReplyAttention
} from "../lib/quoteWorkflow";
import { classifyQuoteStatus } from "../lib/statusSemantics";
import {
  WORKFLOW_TIMING_INPUT_SCAN_LIMIT,
  buildWorkflowTimingCues
} from "../lib/workflowTimingCues";
import {
  WORKSPACE_FOLLOW_UP_TASK_PROOF_TYPE,
  WORKSPACE_FOLLOW_UP_TASK_VERIFIER_ID
} from "../lib/workspaceTaskJourney";
import { buildRevenueAutopilotPreview } from "../lib/revenueAutopilotPreview";
import {
  acknowledgeRevenueAutopilotReply,
  configureRevenueAutopilotPolicy,
  getRevenueAutopilotOperations,
  isDefinitiveRevenueAutopilotError,
  materializeRevenueAutopilotJobs,
  normalizeRevenueAutopilotReviewRequestUrl,
  readPendingRevenueAutopilotMaterializationAttempt,
  readPendingRevenueAutopilotPolicyAttempt,
  resetDefinitiveRevenueAutopilotPolicyAttempt,
  reconcileRevenueAutopilotJob
} from "../lib/revenueAutopilotClient";
import {
  configureDecisionDebtPolicy,
  getDecisionDebtSnapshot,
  readPendingDecisionDebtPolicyAttempt,
  reconcileDecisionDebtPolicy,
  resetDefinitiveDecisionDebtPolicyAttempt
} from "../lib/decisionDebtClient";
import { useWorkspaceRouteHeadingFocus } from "../hooks/useWorkspaceRouteHeadingFocus";
import { useWorkspaceActionFeedback } from "../context/WorkspaceActionFeedbackContext";
import DecisionDebtPanel from "./DecisionDebtPanel";
import AdaptiveChoiceField from "./AdaptiveChoiceField";
import RevenueAutopilotOperations from "./RevenueAutopilotOperations";
import RevenueAutopilotPreviewPanel from "./RevenueAutopilotPreviewPanel";
import WorkflowTimingPanel from "./WorkflowTimingPanel";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceSource,
  formatWorkspaceText,
  humanizeWorkspaceValue
} from "../lib/workspacePresentation";
import {
  mergeAnniversaryRebookingAttention,
  resolveAnniversaryAttentionCalendar
} from "../lib/anniversaryRebookingAttention";

const WORKFLOW_TABS = ["attention", "followups", "autopilot", "debt", "approvals"];
const PROVIDER_APPROVAL_ACTIONS = new Set([
  "send_payment_request",
  "send_final_balance_request"
]);

export function isCanonicalWorkflowDateOnly(value = "") {
  const candidate = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(candidate);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function resolveWorkflowFocusTarget({
  focusQuoteId = "",
  focusAttentionType = "",
  focusRequestId = "",
  attentionItems = [],
  decisionDebtItems = []
} = {}) {
  const quoteId = String(focusQuoteId || "").trim();
  const attentionType = String(focusAttentionType || "").trim();
  const requestId = String(focusRequestId || "").trim();
  if (!quoteId) return null;

  if (attentionType === "decision_debt") {
    const item = (Array.isArray(decisionDebtItems) ? decisionDebtItems : []).find((candidate) => (
      String(candidate?.quoteId || "").trim() === quoteId
      && (!requestId || String(candidate?.id || "").trim() === requestId)
    ));
    return {
      tab: "debt",
      itemId: String(item?.id || "").trim()
    };
  }

  const item = (Array.isArray(attentionItems) ? attentionItems : []).find((candidate) => (
    String(candidate?.quoteId || "").trim() === quoteId
    && (!attentionType || String(candidate?.type || "").trim() === attentionType)
    && (
      !requestId
      || String(candidate?.id || "").trim() === requestId
      || getWorkflowAttentionFocusId(candidate) === requestId
      || String(candidate?.sourceRequestId || "").trim() === requestId
      || String(candidate?.attentionId || "").trim() === requestId
      || String(candidate?.messageId || "").trim() === requestId
      || candidate?.pendingRequests?.some((request) => (
        String(request?.id || "").trim() === requestId
      ))
    )
  ));
  return item
    ? { tab: "attention", itemId: String(item.id || "").trim() }
    : null;
}

const FOLLOW_UP_CONFIRMATION_FIELDS = Object.freeze([
  "stage",
  "dueDate",
  "note",
  "completed",
  "completedAtISO",
  "updatedAtISO",
  "updatedByEmail"
]);

function followUpConfirmationShape(value) {
  const source = record(value) ? value : {};
  return {
    stage: String(source.stage || "").trim(),
    dueDate: String(source.dueDate || "").trim(),
    note: String(source.note || "").trim(),
    completed: source.completed === true,
    completedAtISO: String(source.completedAtISO || "").trim(),
    updatedAtISO: String(source.updatedAtISO || "").trim(),
    updatedByEmail: String(source.updatedByEmail || "").trim().toLowerCase()
  };
}

function confirmedInstant(value, nowISO) {
  const candidate = String(value || "").trim();
  const nowMs = Date.parse(String(nowISO || ""));
  if (
    !/^\d{4}-\d{2}-\d{2}T/u.test(candidate)
    || !/(?:Z|[+-]\d{2}:\d{2})$/iu.test(candidate)
    || !Number.isFinite(nowMs)
  ) return "";
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(candidateMs) || candidateMs > nowMs) return "";
  return new Date(candidateMs).toISOString();
}

/**
 * Confirms only one exact follow-up completion from a server-only quote read.
 * This is current-record confirmation, not an immutable provider receipt.
 */
export function verifyFollowUpCompletionReadback({
  organizationId = "",
  quoteId = "",
  quote = null,
  expectedFollowUp = null,
  nowISO = "",
  timeZone = "UTC"
} = {}) {
  const expectedOrganizationId = String(organizationId || "").trim();
  const expectedQuoteId = String(quoteId || "").trim();
  if (!expectedOrganizationId || !expectedQuoteId || !record(quote)) {
    return { ok: false, code: "invalid_readback" };
  }
  if (
    String(quote.id || "").trim() !== expectedQuoteId
    || String(quote.organizationId || "").trim() !== expectedOrganizationId
  ) {
    return { ok: false, code: "scope_mismatch" };
  }
  if (!record(expectedFollowUp)) {
    return { ok: false, code: "firebase_write_expectation_missing" };
  }

  const confirmedFollowUp = followUpConfirmationShape(quote.workflow?.followUp);
  if (!confirmedFollowUp.completed) {
    return { ok: false, code: "completion_missing" };
  }
  const expected = followUpConfirmationShape(expectedFollowUp);
  if (FOLLOW_UP_CONFIRMATION_FIELDS.some((field) => expected[field] !== confirmedFollowUp[field])) {
    return { ok: false, code: "write_readback_mismatch" };
  }

  const completedAtISO = confirmedInstant(confirmedFollowUp.completedAtISO, nowISO);
  const updatedAtISO = confirmedInstant(confirmedFollowUp.updatedAtISO, nowISO);
  if (
    !completedAtISO
    || !updatedAtISO
    || Date.parse(updatedAtISO) < Date.parse(completedAtISO)
    || !/^[^@\s]+@[^@\s]+$/u.test(confirmedFollowUp.updatedByEmail)
  ) {
    return { ok: false, code: "invalid_completion_evidence" };
  }

  try {
    const attentionSummary = buildWorkflowAttentionSummary([quote], { nowISO });
    if (attentionSummary.items.some((item) => (
      item.type === "follow_up" && String(item.quoteId || "").trim() === expectedQuoteId
    ))) {
      return { ok: false, code: "attention_still_open" };
    }
    const timing = buildWorkflowTimingCues({
      attentionSummary,
      quotes: [quote],
      nowISO,
      timeZone
    });
    const confirmations = timing.receipts.filter((receipt) => (
      receipt.kind === "follow_up_completed"
      && receipt.quoteId === expectedQuoteId
      && receipt.source === "quote.workflow.follow_up"
      && receipt.completedAtISO === completedAtISO
    ));
    if (confirmations.length !== 1) return { ok: false, code: "confirmation_missing" };
    return {
      ok: true,
      proof: {
        verifierId: WORKSPACE_FOLLOW_UP_TASK_VERIFIER_ID,
        proofId: `follow-up-completed:${confirmations[0].completedAtISO}`,
        proofType: WORKSPACE_FOLLOW_UP_TASK_PROOF_TYPE
      }
    };
  } catch {
    return { ok: false, code: "invalid_completion_evidence" };
  }
}

export function buildFollowUpCompletionChangedFacts(taskOutcome) {
  return Object.freeze([
    "Internal follow-up marked complete",
    ...(taskOutcome?.taskState === "persisted" ? ["Current task marked completed"] : [])
  ]);
}

function followUpTaskJourneyForQuote(journey, organizationId, quoteId) {
  const scopedOrganizationId = String(organizationId || "").trim();
  const scopedQuoteId = String(quoteId || "").trim();
  const expectedRequestId = scopedQuoteId ? `follow-up:${scopedQuoteId}` : "";
  if (
    !journey
    || !["in_progress", "uncertain"].includes(journey.phase)
    || !String(journey.startedAtISO || "").trim()
    || journey.organizationId !== scopedOrganizationId
    || journey.destination !== "workflow"
    || journey.intentId !== "review_follow_up"
    || journey.object?.type !== "workflow-item"
    || journey.object?.id !== expectedRequestId
    || journey.focus?.quoteId !== scopedQuoteId
    || journey.focus?.attentionType !== "follow_up"
    || journey.focus?.requestId !== expectedRequestId
  ) {
    return null;
  }
  return journey;
}

function fmtDateTime(value) {
  return formatWorkspaceDateTime(value);
}

function fmtDueDate(value) {
  return formatWorkspaceDate(value, { emptyLabel: "No due date" });
}

function captureWorkflowSnapshotContext() {
  const snapshotAtISO = new Date().toISOString();
  let snapshotTimeZone = "UTC";
  try {
    snapshotTimeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    snapshotTimeZone = "UTC";
  }
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: snapshotTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(snapshotAtISO));
  const dateValues = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  return {
    snapshotAtISO,
    snapshotTimeZone,
    snapshotTodayISO: `${dateValues.year}-${dateValues.month}-${dateValues.day}`
  };
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTimeZone(value) {
  const requested = String(value || "").trim();
  if (!requested) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: requested })
      .resolvedOptions()
      .timeZone;
  } catch {
    return "";
  }
}

function calendarDateAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function revenueAutopilotReadFailure(code, detail) {
  return {
    preview: null,
    error: code,
    detail
  };
}

export function buildRevenueAutopilotReviewRequestConfiguration({
  enabled = false,
  reviewRequestUrl = ""
} = {}) {
  if (!enabled) {
    return {
      state: "dormant",
      valid: true,
      normalizedUrl: "",
      host: "",
      detail: "The post-event review lane is dormant. A review destination is not required."
    };
  }
  try {
    const normalizedUrl = normalizeRevenueAutopilotReviewRequestUrl(reviewRequestUrl, {
      required: true
    });
    return {
      state: "configured",
      valid: true,
      normalizedUrl,
      host: new URL(normalizedUrl).hostname,
      detail: "The destination is a valid public HTTPS URL. Runtime, provider, closeout, consent, and suppression gates remain separate."
    };
  } catch {
    const missing = !String(reviewRequestUrl || "").trim();
    return {
      state: missing ? "missing" : "invalid",
      valid: false,
      normalizedUrl: "",
      host: "",
      detail: missing
        ? "Enter the tenant-approved public HTTPS review destination before enabling this lane."
        : "Use a public HTTPS URL without credentials, fragments, a nonstandard port, or a private/local host."
    };
  }
}

export function RevenueAutopilotReviewRequestPolicyFields({
  draft,
  onDraftChange = () => {}
}) {
  const enabled = draft?.kinds?.post_event_review_request === true;
  const reviewRequestUrl = String(draft?.reviewRequestUrl || "");
  const configuration = buildRevenueAutopilotReviewRequestConfiguration({
    enabled,
    reviewRequestUrl
  });
  return (
    <div
      className="workflow-form-section"
      data-capability-id="cwf-12-post-event-review-policy"
      data-capability-state={configuration.state}
      data-autopilot-review-url-state={configuration.state}
    >
      <label className="checkrow">
        <input
          type="checkbox"
          checked={enabled}
          data-capability-action="toggle-post-event-review-request"
          onChange={(event) => onDraftChange((current) => ({
            ...current,
            kinds: {
              ...current.kinds,
              post_event_review_request: event.target.checked
            }
          }))}
        />
        <span>Post-event review requests</span>
      </label>
      {enabled && (
        <label className="field">
          <span>Tenant review destination</span>
          <input
            type="url"
            inputMode="url"
            required
            value={reviewRequestUrl}
            placeholder="https://reviews.example.com/your-business"
            aria-invalid={!configuration.valid}
            aria-describedby="revenue-autopilot-review-url-guidance"
            data-capability-action="set-post-event-review-url"
            onChange={(event) => onDraftChange((current) => ({
              ...current,
              reviewRequestUrl: event.target.value
            }))}
          />
        </label>
      )}
      <p
        id="revenue-autopilot-review-url-guidance"
        className={configuration.valid ? "source-note" : "warning-note"}
        role={configuration.valid ? "status" : "alert"}
      >
        {configuration.detail}
        {configuration.host ? ` Configured host: ${configuration.host}.` : ""}
        {enabled && " A review ask is not evidence of an external review or recovered revenue."}
      </p>
    </div>
  );
}

export function isRevenueAutopilotPolicySaveBlocked({
  mutationState = "ready",
  pendingAttempt = null,
  reviewConfiguration = { valid: true }
} = {}) {
  if (new Set(["submitting", "reconciliation"]).has(String(mutationState || "").trim())) {
    return true;
  }
  return !pendingAttempt && reviewConfiguration?.valid !== true;
}

export function buildWorkflowRevenueAutopilotInput({
  organizationId = "",
  quote = null,
  source = "",
  snapshotAtISO = "",
  tenantTimeZone = ""
} = {}) {
  const scopedOrganizationId = String(organizationId || "").trim();
  const quoteId = String(quote?.id || quote?.quoteId || "").trim();
  if (String(source || "").trim().toLowerCase() !== "firebase") {
    throw new TypeError("Follow-up automation requires a canonical Firestore quote snapshot.");
  }
  if (!scopedOrganizationId || !record(quote) || !quoteId) {
    throw new TypeError("Follow-up automation requires one tenant-scoped quote snapshot.");
  }
  const instant = new Date(snapshotAtISO);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError("Follow-up automation requires the successful quote-read timestamp.");
  }
  const normalizedTenantTimeZone = normalizeTimeZone(tenantTimeZone);
  if (!normalizedTenantTimeZone) {
    throw new TypeError("Follow-up automation requires an explicit tenant IANA time zone.");
  }
  const calendarContext = {
    date: calendarDateAt(instant, normalizedTenantTimeZone),
    source: "tenant",
    timeZone: normalizedTenantTimeZone
  };
  const ledger = record(quote?.payment?.ledger) ? quote.payment.ledger : null;
  const evidence = ledger
    ? {
        paymentLedgers: [{
          source: "canonical_payment_ledger",
          organizationId: scopedOrganizationId,
          quoteId,
          observedForDate: calendarContext.date,
          version: ledger.version,
          entries: ledger.entries
        }]
      }
    : {};

  return {
    organizationId: scopedOrganizationId,
    quote,
    calendarContext,
    controls: {},
    evidence
  };
}

export function buildWorkflowRevenueAutopilotRead(input = {}) {
  if (!input.quote) return { preview: null, error: "", detail: "" };
  if (String(input.source || "").trim().toLowerCase() !== "firebase") {
    return revenueAutopilotReadFailure(
      "authoritative_quote_read_required",
      "This preview requires the current Firestore staff quote snapshot. Browser-local quote data remains blocked."
    );
  }
  if (!normalizeTimeZone(input.tenantTimeZone)) {
    return revenueAutopilotReadFailure(
      "tenant_calendar_authority_required",
      "Tenant calendar policy is not available to this Workflow read. Eligibility remains blocked until an explicit tenant IANA time zone is supplied."
    );
  }
  try {
    return {
      preview: buildRevenueAutopilotPreview(buildWorkflowRevenueAutopilotInput(input)),
      error: "",
      detail: ""
    };
  } catch {
    return revenueAutopilotReadFailure(
      "authoritative_preview_input_invalid",
      "The selected quote could not be evaluated from the current bounded staff snapshot. No automation was authorized."
    );
  }
}

function actionLabel(action) {
  return APPROVAL_ACTIONS.find((item) => item.id === action)?.label || action || "Sensitive action";
}

function approvalOutcomeLabel(request) {
  if (request?.state === "rejected") return "Rejected";
  const executionState = String(request?.executionState || "").trim().toLowerCase();
  if (executionState === "in_progress") return "Admin action in progress";
  if (executionState === "succeeded") return "Admin action completed";
  if (executionState === "failed") return "Admin action failed — new approval required";
  return "Approved, awaiting admin action";
}

function safeDomId(value) {
  return String(value || "item").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function followUpFromQuote(quote) {
  const followUp = quote?.workflow?.followUp || {};
  return {
    stage: FOLLOW_UP_STAGES.some((item) => item.id === followUp.stage) ? followUp.stage : "new",
    dueDate: followUp.dueDate || "",
    note: followUp.note || "",
    completed: followUp.completed === true
  };
}

export function SalesWorkflowView({
  open,
  onClose,
  presentation = "embedded",
  onOpenQuoteHistory,
  onOpenCustomer,
  onStartQuote,
  onEditQuote,
  onAttentionSummaryChange,
  focusQuoteId = "",
  focusAttentionType = "",
  focusRequestId = "",
  arrivalContext = null,
  onArrivalResolution = null,
  activeTaskJourney = null,
  onTaskOutcome = null,
  organizationId = "",
  currentUserEmail = "",
  currentUserRole = "customer",
  tenantTimeZone = "",
  onToast
}) {
  const {
    available: workspaceActionFeedbackAvailable,
    feedbackRecords: workspaceActionFeedbackRecords,
    beginActionFeedback,
    transitionActionFeedback
  } = useWorkspaceActionFeedback();
  const embedded = presentation === "embedded";
  const [state, setState] = useState({
    loading: Boolean(open),
    error: "",
    feedback: "",
    source: "",
    organizationId: "",
    quotes: [],
    truncated: false,
    snapshotAtISO: "",
    snapshotTimeZone: "UTC",
    snapshotTodayISO: ""
  });
  const [activeTab, setActiveTab] = useState("attention");
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [followUpDraft, setFollowUpDraft] = useState(() => followUpFromQuote(null));
  const [approvalAction, setApprovalAction] = useState(APPROVAL_ACTIONS[0]?.id || "");
  const [approvalNote, setApprovalNote] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState({});
  const [handlingNotes, setHandlingNotes] = useState({});
  const [busyKey, setBusyKey] = useState("");
  const [followUpConfirmation, setFollowUpConfirmation] = useState({
    phase: "idle",
    quoteId: "",
    reason: "",
    shared: false
  });
  const [followUpValidationField, setFollowUpValidationField] = useState("");
  const [workflowReadError, setWorkflowReadError] = useState("");
  const [autopilotOperations, setAutopilotOperations] = useState({
    loading: false,
    error: "",
    stale: false,
    snapshot: null,
    mutation: { state: "ready", error: "", receipt: null }
  });
  const [decisionDebt, setDecisionDebt] = useState({
    loading: false,
    error: "",
    stale: false,
    snapshot: null,
    policyVersion: "",
    mutation: { state: "ready", error: "", receipt: null }
  });
  const [autopilotConfigurationOpen, setAutopilotConfigurationOpen] = useState(false);
  const [autopilotPolicyDraft, setAutopilotPolicyDraft] = useState({
    enabled: false,
    timeZone: "UTC",
    quietHours: { enabled: true, start: "21:00", end: "08:00" },
    kinds: {
      quote_follow_up: true,
      deposit_reminder: true,
      final_balance_reminder: true,
      post_event_review_request: false,
      unread_customer_reply: true
    },
    reviewRequestUrl: "",
    maxAttempts: 3,
    quoteFollowUpDayOffsets: [2, 5],
    depositReminderDayOffsets: [1, 3],
    finalBalanceReminderDayOffsets: [14, 7, 3]
  });
  const dialogRef = useRef(null);
  const routeHeadingRef = useWorkspaceRouteHeadingFocus(Boolean(open && embedded));
  const detailHeadingRef = useRef(null);
  const attentionEmptyHeadingRef = useRef(null);
  const followUpStageRef = useRef(null);
  const followUpDueDateRef = useRef(null);
  const tabRefs = useRef({});
  const returnFocusRef = useRef(null);
  const skipReturnFocusRef = useRef(false);
  const tabInteractedRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const arrivalReportRef = useRef("");
  const followUpConfirmationGenerationRef = useRef(0);
  const followUpConfirmationExpectationRef = useRef(null);
  const followUpSaveOperationRef = useRef(null);
  const followUpConfirmationOperationRef = useRef(null);
  const followUpMountedRef = useRef(true);
  const autopilotGenerationRef = useRef(0);
  const decisionDebtGenerationRef = useRef(0);
  const workflowScopeRef = useRef("");
  const activeFollowUpTaskIdentityRef = useRef("");
  const onCloseRef = useRef(onClose);
  workflowScopeRef.current = [organizationId, currentUserRole, currentUserEmail]
    .map((value) => String(value || "").trim().toLowerCase())
    .join(":");
  activeFollowUpTaskIdentityRef.current = activeTaskJourney
    ? `${activeTaskJourney.taskId}:${activeTaskJourney.startedAtISO}`
    : "";
  const exactArrivalActive = Boolean(
    open
    && arrivalContext?.surfaceId === "workflow"
    && arrivalContext?.focus?.quoteId === focusQuoteId
    && arrivalContext?.focus?.attentionType === focusAttentionType
    && arrivalContext?.focus?.requestId === focusRequestId
  );
  const exactArrivalKey = exactArrivalActive
    ? [focusQuoteId, focusAttentionType, focusRequestId].join(":")
    : "";

  const reportArrivalResolution = useCallback((resolution) => {
    if (!exactArrivalActive || typeof onArrivalResolution !== "function") return;
    const next = {
      ...resolution,
      focus: {
        quoteId: focusQuoteId,
        attentionType: focusAttentionType,
        requestId: focusRequestId
      }
    };
    const signature = JSON.stringify(next);
    if (arrivalReportRef.current === signature) return;
    arrivalReportRef.current = signature;
    onArrivalResolution(next);
  }, [
    exactArrivalActive,
    focusAttentionType,
    focusQuoteId,
    focusRequestId,
    onArrivalResolution
  ]);

  useEffect(() => {
    arrivalReportRef.current = "";
    if (exactArrivalActive) reportArrivalResolution({ status: "pending" });
  }, [exactArrivalActive, exactArrivalKey, reportArrivalResolution]);

  useEffect(() => {
    followUpConfirmationGenerationRef.current += 1;
    followUpConfirmationExpectationRef.current = null;
    const abandonedOperations = [
      followUpSaveOperationRef.current,
      followUpConfirmationOperationRef.current
    ].filter((operation) => (
      operation
      && operation.workflowScope !== workflowScopeRef.current
    ));
    const abandonedBusyKeys = new Set(
      abandonedOperations.map((operation) => operation.busyKey)
    );
    const abandonedFeedbackAttempts = new Set();
    abandonedOperations.forEach((operation) => {
      const selector = operation.feedbackSelector;
      const attemptKey = selector
        ? JSON.stringify([selector.attemptId, selector.generation])
        : "";
      if (
        !workspaceActionFeedbackAvailable
        || !selector
        || abandonedFeedbackAttempts.has(attemptKey)
      ) {
        return;
      }
      abandonedFeedbackAttempts.add(attemptKey);
      transitionActionFeedback({
        ...selector,
        phase: "uncertain",
        message: "The request was sent, but staff identity changed before exact confirmation completed.",
        changed: ["Follow-up completion remains unconfirmed"],
        unchanged: [
          "Current task remains open",
          "Customer contact was not sent",
          "Payment and booking evidence did not change",
          "No provider outcome was inferred"
        ],
        dispatchState: "dispatched",
        nextAction: { id: "reconcile", label: "Review exact follow-up" }
      });
    });
    if (abandonedOperations.includes(followUpSaveOperationRef.current)) {
      followUpSaveOperationRef.current = null;
    }
    if (abandonedOperations.includes(followUpConfirmationOperationRef.current)) {
      followUpConfirmationOperationRef.current = null;
    }
    setBusyKey((current) => {
      const pendingOperation = followUpConfirmationOperationRef.current
        || followUpSaveOperationRef.current;
      if (pendingOperation?.workflowScope === workflowScopeRef.current) {
        return pendingOperation.busyKey;
      }
      if (abandonedBusyKeys.has(current)) return "";
      return current.startsWith("confirm-followup:") ? "" : current;
    });
    setFollowUpConfirmation({ phase: "idle", quoteId: "", reason: "", shared: false });
    setFollowUpValidationField("");
    return () => {
      followUpConfirmationGenerationRef.current += 1;
      followUpConfirmationExpectationRef.current = null;
    };
  }, [
    activeTaskJourney?.startedAtISO,
    activeTaskJourney?.taskId,
    currentUserEmail,
    currentUserRole,
    focusAttentionType,
    focusQuoteId,
    focusRequestId,
    organizationId,
    transitionActionFeedback,
    workspaceActionFeedbackAvailable
  ]);

  useEffect(() => {
    followUpMountedRef.current = true;
    return () => {
      followUpMountedRef.current = false;
      followUpConfirmationGenerationRef.current += 1;
      followUpConfirmationExpectationRef.current = null;
      const abandonedOperation = followUpConfirmationOperationRef.current
        || followUpSaveOperationRef.current;
      if (workspaceActionFeedbackAvailable && abandonedOperation?.feedbackSelector) {
        transitionActionFeedback({
          ...abandonedOperation.feedbackSelector,
          phase: "uncertain",
          message: "The request was sent, but this view closed before exact confirmation completed.",
          changed: ["Follow-up completion remains unconfirmed"],
          unchanged: [
            "Current task remains open",
            "Customer contact was not sent",
            "Payment and booking evidence did not change",
            "No provider outcome was inferred"
          ],
          dispatchState: "dispatched",
          nextAction: { id: "reconcile", label: "Review exact follow-up" }
        });
      }
      followUpSaveOperationRef.current = null;
      followUpConfirmationOperationRef.current = null;
    };
  }, [transitionActionFeedback, workspaceActionFeedbackAvailable]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const pushToast = (message, tone = "info") => {
    if (typeof onToast === "function") onToast(message, tone);
  };
  const reportSuccess = (message) => {
    setState((prev) => ({ ...prev, feedback: message }));
    pushToast(message, "success");
  };

  const loadRevenueAutopilotOperations = async () => {
    const scopedOrganizationId = String(organizationId || "").trim();
    if (!scopedOrganizationId) return;
    const generation = autopilotGenerationRef.current + 1;
    autopilotGenerationRef.current = generation;
    setAutopilotOperations((current) => ({
      ...current,
      loading: true,
      error: "",
      stale: Boolean(current.snapshot)
    }));
    try {
      const result = await getRevenueAutopilotOperations({
        organizationId: scopedOrganizationId,
        jobLimit: 100,
        attentionLimit: 50
      });
      if (generation !== autopilotGenerationRef.current) return;
      setAutopilotOperations((current) => ({
        ...current,
        loading: false,
        error: "",
        stale: false,
        snapshot: result
      }));
    } catch (error) {
      if (generation !== autopilotGenerationRef.current) return;
      setAutopilotOperations((current) => ({
        ...current,
        loading: false,
        error: error?.message || "Follow-up automation could not be loaded.",
        stale: Boolean(current.snapshot)
      }));
    }
  };

  const loadDecisionDebt = async () => {
    const scopedOrganizationId = String(organizationId || "").trim();
    if (!scopedOrganizationId) return;
    const generation = decisionDebtGenerationRef.current + 1;
    decisionDebtGenerationRef.current = generation;
    setDecisionDebt((current) => ({
      ...current,
      loading: true,
      error: "",
      stale: Boolean(current.snapshot)
    }));
    try {
      const result = await getDecisionDebtSnapshot({
        organizationId: scopedOrganizationId,
        limit: 50
      });
      if (generation !== decisionDebtGenerationRef.current) return;
      setDecisionDebt((current) => ({
        ...current,
        loading: false,
        error: "",
        stale: false,
        snapshot: result.snapshot,
        policyVersion: result.policyVersion || ""
      }));
    } catch (error) {
      if (generation !== decisionDebtGenerationRef.current) return;
      setDecisionDebt((current) => ({
        ...current,
        loading: false,
        error: error?.message || "Decision priorities could not be calculated.",
        stale: Boolean(current.snapshot)
      }));
    }
  };

  const load = async ({ selectDefaultTab = false } = {}) => {
    const loadOrganizationId = String(organizationId || "").trim();
    const loadScope = [organizationId, currentUserRole, currentUserEmail]
      .map((value) => String(value || "").trim().toLowerCase())
      .join(":");
    if (workflowScopeRef.current !== loadScope) return;
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setWorkflowReadError("");
    setState((prev) => ({ ...prev, loading: true, error: "", feedback: "" }));
    void loadRevenueAutopilotOperations();
    void loadDecisionDebt();
    try {
      const result = await getQuoteHistory({
        organizationId,
        limitCount: WORKFLOW_TIMING_INPUT_SCAN_LIMIT
      });
      if (generation !== loadGenerationRef.current || workflowScopeRef.current !== loadScope) return;
      const snapshotContext = captureWorkflowSnapshotContext();
      setState({
        loading: false,
        error: "",
        feedback: "",
        source: result.source,
        organizationId: loadOrganizationId,
        quotes: result.quotes,
        truncated: result.truncated === true,
        ...snapshotContext
      });
      setSelectedQuoteId((current) => {
        if (focusQuoteId && result.quotes.some((item) => item.id === focusQuoteId)) return focusQuoteId;
        if (exactArrivalActive) return "";
        return result.quotes.some((item) => item.id === current) ? current : result.quotes[0]?.id || "";
      });
      if (selectDefaultTab && !tabInteractedRef.current) {
        setActiveTab(
          focusAttentionType === "decision_debt"
            ? "debt"
            : focusAttentionType
              ? "attention"
              : buildWorkflowAttentionSummary(result.quotes, {
                  todayISO: snapshotContext.snapshotTodayISO,
                  nowISO: snapshotContext.snapshotAtISO
                }).quoteCount > 0
                ? "attention"
                : "followups"
        );
      }
    } catch (err) {
      if (generation !== loadGenerationRef.current || workflowScopeRef.current !== loadScope) return;
      setWorkflowReadError(err?.message || "Failed to load sales workflow.");
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to load sales workflow."
      }));
    }
  };

  useEffect(() => {
    if (!open) {
      loadGenerationRef.current += 1;
      autopilotGenerationRef.current += 1;
      decisionDebtGenerationRef.current += 1;
      return;
    }
    tabInteractedRef.current = false;
    skipReturnFocusRef.current = false;
    setState((prev) => ({
      ...prev,
      loading: true,
      error: "",
      feedback: "",
      source: "",
      organizationId: "",
      quotes: [],
      truncated: false,
      snapshotAtISO: "",
      snapshotTimeZone: "UTC",
      snapshotTodayISO: ""
    }));
    setActiveTab("attention");
    setApprovalNote("");
    setResolutionNotes({});
    setHandlingNotes({});
    setBusyKey(() => {
      const pendingOperation = followUpConfirmationOperationRef.current
        || followUpSaveOperationRef.current;
      return pendingOperation?.workflowScope === workflowScopeRef.current
        ? pendingOperation.busyKey
        : "";
    });
    followUpConfirmationGenerationRef.current += 1;
    followUpConfirmationExpectationRef.current = null;
    setFollowUpConfirmation({ phase: "idle", quoteId: "", reason: "", shared: false });
    setWorkflowReadError("");
    setAutopilotConfigurationOpen(false);
    setAutopilotOperations({
      loading: true,
      error: "",
      stale: false,
      snapshot: null,
      mutation: { state: "ready", error: "", receipt: null }
    });
    setDecisionDebt({
      loading: true,
      error: "",
      stale: false,
      snapshot: null,
      policyVersion: "",
      mutation: { state: "ready", error: "", receipt: null }
    });
    load({ selectDefaultTab: true });
  }, [focusQuoteId, open, organizationId]);

  useEffect(() => {
    if (!open || embedded) return undefined;
    returnFocusRef.current = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleDialogKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleDialogKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      const returnTarget = returnFocusRef.current;
      if (!skipReturnFocusRef.current && returnTarget?.isConnected) {
        window.requestAnimationFrame(() => returnTarget.focus());
      }
    };
  }, [embedded, open]);

  const selectedQuote = useMemo(
    () => state.quotes.find((item) => item.id === selectedQuoteId) || null,
    [state.quotes, selectedQuoteId]
  );
  const selectedFollowUpTaskJourney = useMemo(
    () => exactArrivalActive
      ? followUpTaskJourneyForQuote(
          activeTaskJourney,
          organizationId,
          selectedQuote?.id
        )
      : null,
    [activeTaskJourney, exactArrivalActive, organizationId, selectedQuote?.id]
  );

  useEffect(() => {
    setFollowUpDraft(followUpFromQuote(selectedQuote));
    setFollowUpValidationField("");
  }, [selectedQuote]);

  const quoteSummaries = useMemo(
    () => state.quotes
      .map((quote) => ({
        quote,
        readiness: buildProposalReadiness(quote),
        followUp: followUpFromQuote(quote)
      }))
      .sort((left, right) => {
        const leftDone = left.followUp.completed ? 1 : 0;
        const rightDone = right.followUp.completed ? 1 : 0;
        if (leftDone !== rightDone) return leftDone - rightDone;
        const leftDue = left.followUp.dueDate || "9999-12-31";
        const rightDue = right.followUp.dueDate || "9999-12-31";
        if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
        return String(right.quote.updatedAtISO || "").localeCompare(String(left.quote.updatedAtISO || ""));
      }),
    [state.quotes]
  );

  const approvalQueue = useMemo(
    () => state.quotes
      .flatMap((quote) => (
        Array.isArray(quote.workflow?.approvalRequests)
          ? quote.workflow.approvalRequests.map((request) => ({ quote, request }))
          : []
      ))
      .sort((left, right) => {
        const leftPending = left.request.state === "pending" ? 0 : 1;
        const rightPending = right.request.state === "pending" ? 0 : 1;
        if (leftPending !== rightPending) return leftPending - rightPending;
        return String(right.request.requestedAtISO || "").localeCompare(String(left.request.requestedAtISO || ""));
      }),
    [state.quotes]
  );

  const attentionSummary = useMemo(
    () => mergeUnreadReplyAttention(
      mergeAnniversaryRebookingAttention(
        buildWorkflowAttentionSummary(state.quotes, {
          todayISO: state.snapshotTodayISO || undefined,
          nowISO: state.snapshotAtISO || undefined
        }),
        {
          quotes: state.quotes,
          calendarContext: resolveAnniversaryAttentionCalendar({
            instant: state.snapshotAtISO || undefined,
            tenantTimeZone
          }),
          sourceLimit: WORKFLOW_TIMING_INPUT_SCAN_LIMIT,
          sourceTruncated: state.truncated
        }
      ),
      {
        attention: autopilotOperations.snapshot?.attention || [],
        quotes: state.quotes
      }
    ),
    [
      autopilotOperations.snapshot?.attention,
      state.quotes,
      state.snapshotAtISO,
      state.snapshotTodayISO,
      state.truncated,
      tenantTimeZone
    ]
  );

  const timingRead = useMemo(() => {
    if (!state.snapshotAtISO) return { model: null, error: "" };
    try {
      return {
        model: buildWorkflowTimingCues({
          attentionSummary,
          quotes: state.quotes,
          nowISO: state.snapshotAtISO,
          timeZone: state.snapshotTimeZone
        }),
        error: ""
      };
    } catch (error) {
      return {
        model: null,
        error: error?.message || "Timing evidence could not be derived from this snapshot."
      };
    }
  }, [attentionSummary, state.quotes, state.snapshotAtISO, state.snapshotTimeZone]);

  const revenueAutopilotRead = useMemo(
    () => buildWorkflowRevenueAutopilotRead({
      organizationId: state.organizationId || organizationId,
      quote: selectedQuote,
      source: state.source,
      snapshotAtISO: state.snapshotAtISO,
      tenantTimeZone
    }),
    [
      organizationId,
      selectedQuote,
      state.organizationId,
      state.snapshotAtISO,
      state.source,
      tenantTimeZone
    ]
  );
  const quoteSnapshotBound = state.snapshotAtISO
    ? (state.truncated ? "truncated" : "complete")
    : "unknown";
  const authoritativeQuoteOptions = quoteSummaries.map(({ quote }) => ({
    value: quote.id,
    label: `${formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" })} · ${quote.customer?.name || quote.customer?.email || "Customer"}`
  }));
  const authoritativeQuoteSelectionStale = Boolean(
    selectedQuoteId && !authoritativeQuoteOptions.some((option) => option.value === selectedQuoteId)
  );
  if (authoritativeQuoteSelectionStale && authoritativeQuoteOptions.length > 0) {
    authoritativeQuoteOptions.unshift({
      value: selectedQuoteId,
      label: `Previously selected quote ${selectedQuoteId} (not in the current Workflow read)`
    });
  }
  const displayedAutopilotAttentionCount = Array.isArray(autopilotOperations.snapshot?.attention)
    ? autopilotOperations.snapshot.attention.length
    : 0;
  const totalAutopilotAttentionCount = Number(
    autopilotOperations.snapshot?.bounds?.totalAttention
  );
  const autopilotAttentionTruncated = Number.isSafeInteger(totalAutopilotAttentionCount)
    && totalAutopilotAttentionCount > displayedAutopilotAttentionCount;

  useEffect(() => {
    if (!open || state.loading || !focusQuoteId) return undefined;
    if (exactArrivalActive) return undefined;
    if (focusAttentionType === "decision_debt") return undefined;
    setSelectedQuoteId((current) => (
      state.quotes.some((quote) => quote.id === focusQuoteId) ? focusQuoteId : current
    ));
    const focusTarget = resolveWorkflowFocusTarget({
      focusQuoteId,
      focusAttentionType,
      focusRequestId,
      attentionItems: attentionSummary.items
    });
    if (!focusTarget?.itemId) return undefined;
    setActiveTab("attention");
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(dialogRef.current?.querySelectorAll("[data-attention-id]") || [])
        .find((element) => element.dataset.attentionId === focusTarget.itemId);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    attentionSummary.items,
    exactArrivalActive,
    focusAttentionType,
    focusQuoteId,
    focusRequestId,
    open,
    state.loading,
    state.quotes
  ]);

  useEffect(() => {
    if (!open || focusAttentionType !== "decision_debt" || !focusQuoteId) return undefined;
    if (exactArrivalActive) return undefined;
    setSelectedQuoteId((current) => (
      state.quotes.some((quote) => quote.id === focusQuoteId) ? focusQuoteId : current
    ));
    setActiveTab("debt");
    if (decisionDebt.loading || !decisionDebt.snapshot) return undefined;
    const focusTarget = resolveWorkflowFocusTarget({
      focusQuoteId,
      focusAttentionType,
      focusRequestId,
      decisionDebtItems: decisionDebt.snapshot?.items
    });
    if (!focusTarget?.itemId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(dialogRef.current?.querySelectorAll("[data-decision-debt-id]") || [])
        .find((element) => element.dataset.decisionDebtId === focusTarget.itemId);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    decisionDebt.loading,
    decisionDebt.snapshot,
    exactArrivalActive,
    focusAttentionType,
    focusQuoteId,
    focusRequestId,
    open,
    state.quotes
  ]);

  useEffect(() => {
    if (!exactArrivalActive) return undefined;
    if (state.loading) {
      reportArrivalResolution({ status: "pending" });
      return undefined;
    }
    if (state.error || workflowReadError) {
      reportArrivalResolution({
        status: "recovery",
        reason: "The exact Workflow item could not be verified because the current Workflow evidence failed to load.",
        consequence: "No alternate quote or Workflow item was selected; the original work remains unresolved.",
        nextResolution: "Refresh Workflow, then reopen the exact action from its opportunity if the read still fails."
      });
      return undefined;
    }

    const exactQuote = state.quotes.find((quote) => quote.id === focusQuoteId) || null;
    if (!exactQuote) {
      reportArrivalResolution({
        status: "recovery",
        reason: state.truncated
          ? "The requested opportunity is not present in this bounded Workflow snapshot; it may be outside the current read limit or no longer available."
          : "The requested opportunity is no longer present in the current Workflow snapshot.",
        consequence: "No alternate opportunity or Workflow item was selected; the requested work remains unresolved.",
        nextResolution: "Refresh Workflow, or return to the originating opportunity and choose its current next action."
      });
      return undefined;
    }

    let target = null;
    let tab = "attention";
    let rowKind = "attention";

    if (focusAttentionType === "decision_debt") {
      if (decisionDebt.loading) {
        reportArrivalResolution({ status: "pending" });
        return undefined;
      }
      if (decisionDebt.error || decisionDebt.stale || !decisionDebt.snapshot) {
        reportArrivalResolution({
          status: "recovery",
          reason: decisionDebt.stale
            ? "The requested decision appears only in stale information, so its current state cannot be verified."
            : "The requested decision could not be verified from the current information.",
          consequence: "No alternate decision was selected; navigation did not acknowledge or resolve the requested item.",
          nextResolution: "Retry the decision review, or return to the opportunity and reopen its current details."
        });
        return undefined;
      }
      target = resolveWorkflowFocusTarget({
        focusQuoteId,
        focusAttentionType,
        focusRequestId,
        decisionDebtItems: decisionDebt.snapshot.items
      });
      tab = "debt";
      rowKind = "debt";
    } else if (focusAttentionType === "approval") {
      const approval = approvalQueue.find(({ quote, request }) => (
        quote.id === focusQuoteId && request.id === focusRequestId
      ));
      if (approval && approval.request.state !== "pending") {
        reportArrivalResolution({
          status: "recovery",
          reason: `The requested approval is now ${String(approval.request.state || "in another state").replaceAll("_", " ")}, so its earlier pending context is no longer current.`,
          consequence: "No approval was focused as pending, and navigation did not approve, reject, or execute anything.",
          nextResolution: "Review the current approval history or return to the opportunity for its newly ranked next action."
        });
        return undefined;
      }
      target = approval ? { itemId: approval.request.id } : null;
      tab = "approvals";
      rowKind = "approval";
    } else {
      if (focusAttentionType === "unread_customer_reply" && autopilotOperations.loading) {
        reportArrivalResolution({ status: "pending" });
        return undefined;
      }
      if (
        focusAttentionType === "unread_customer_reply"
        && (autopilotOperations.error || autopilotOperations.stale)
      ) {
        reportArrivalResolution({
          status: "recovery",
          reason: "The exact customer-reply item appears only in unavailable or stale Workflow evidence, so its current state cannot be verified.",
          consequence: "No retained reply or alternate Workflow item was focused; nothing was answered or marked handled.",
          nextResolution: "Reconnect Workflow and retry the exact customer reply after its evidence is current."
        });
        return undefined;
      }
      target = resolveWorkflowFocusTarget({
        focusQuoteId,
        focusAttentionType,
        focusRequestId,
        attentionItems: attentionSummary.items
      });
      if (
        !target?.itemId
        && focusAttentionType === "follow_up"
        && followUpTaskJourneyForQuote(activeTaskJourney, organizationId, exactQuote.id)
      ) {
        target = { itemId: focusRequestId };
        tab = "followups";
        rowKind = "follow_up";
      }
    }

    if (!target?.itemId) {
      const sourceIsBounded = state.truncated
        || (focusAttentionType === "unread_customer_reply" && autopilotAttentionTruncated)
        || (focusAttentionType === "decision_debt" && decisionDebt.snapshot?.bounds?.truncated === true);
      reportArrivalResolution({
        status: "recovery",
        reason: sourceIsBounded
          ? "The exact Workflow item is not present in the bounded evidence currently available; it may be outside the read limit or no longer current."
          : "The exact Workflow item is no longer present in the current opportunity evidence.",
        consequence: "No similar or first-listed item was substituted; the requested action remains unresolved.",
        nextResolution: "Refresh Workflow, or return to the opportunity and choose the next action supported by its current evidence."
      });
      return undefined;
    }

    setSelectedQuoteId(focusQuoteId);
    setActiveTab(tab);
    const arrivalFocusFrames = [];
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        const row = rowKind === "approval"
          ? Array.from(dialogRef.current?.querySelectorAll(".approval-row") || []).find((candidate) => (
              candidate.dataset.quoteId === focusQuoteId
              && candidate.dataset.requestId === focusRequestId
            ))
          : rowKind === "debt"
            ? Array.from(dialogRef.current?.querySelectorAll("[data-decision-debt-id]") || []).find(
                (candidate) => candidate.dataset.decisionDebtId === target.itemId
              )
            : rowKind === "follow_up"
              ? Array.from(dialogRef.current?.querySelectorAll("[data-follow-up-record-id]") || []).find(
                  (candidate) => candidate.dataset.followUpRecordId === target.itemId
                )
            : Array.from(dialogRef.current?.querySelectorAll("[data-attention-id]") || []).find(
                (candidate) => candidate.dataset.attentionId === target.itemId
              );
        row?.scrollIntoView({
          behavior: rowKind === "follow_up" ? "auto" : "smooth",
          block: rowKind === "follow_up" ? "start" : "center"
        });
        const alignExactFollowUpRecord = () => {
          if (!row || rowKind !== "follow_up") return;
          const continuityStack = document.querySelector(
            '[data-workspace-continuity-stack="true"]'
          );
          if (
            !continuityStack
            || getComputedStyle(continuityStack).position !== "sticky"
          ) {
            return;
          }

          let stackRect = continuityStack.getBoundingClientRect();
          let rowRect = row.getBoundingClientRect();
          const requiredRowTop = stackRect.bottom + 8;
          if (rowRect.top < requiredRowTop - 0.5) {
            window.scrollBy({
              top: rowRect.top - requiredRowTop,
              behavior: "auto"
            });
            stackRect = continuityStack.getBoundingClientRect();
            rowRect = row.getBoundingClientRect();
          }

          const headerActions = dialogRef.current?.querySelector(
            ".modal-head .right-actions"
          );
          if (!headerActions) return;
          const headerRect = headerActions.getBoundingClientRect();
          const overlapsVertically = headerRect.bottom > stackRect.top + 1
            && headerRect.top < stackRect.bottom - 1;
          const overlapsHorizontally = headerRect.right > stackRect.left + 1
            && headerRect.left < stackRect.right - 1;
          if (overlapsVertically && overlapsHorizontally) {
            const hideHeaderAboveDelta = headerRect.bottom - (stackRect.top - 8);
            const maximumSafeDelta = Math.max(
              0,
              rowRect.top - (stackRect.bottom + 8)
            );
            const scrollDelta = Math.min(hideHeaderAboveDelta, maximumSafeDelta);
            if (scrollDelta > 0.5) {
              window.scrollBy({ top: scrollDelta, behavior: "auto" });
            }
          }
        };
        alignExactFollowUpRecord();
        row?.focus({ preventScroll: true });
        if (row && document.activeElement === row) {
          reportArrivalResolution({ status: "resolved", itemId: target.itemId });
          if (rowKind === "follow_up") {
            let remainingAlignmentFrames = 4;
            const settleExactFollowUpRecord = () => {
              const frame = window.requestAnimationFrame(() => {
                alignExactFollowUpRecord();
                row.focus({ preventScroll: true });
                remainingAlignmentFrames -= 1;
                if (remainingAlignmentFrames > 0) {
                  settleExactFollowUpRecord();
                }
              });
              arrivalFocusFrames.push(frame);
            };
            settleExactFollowUpRecord();
          }
          return;
        }
        reportArrivalResolution({
          status: "recovery",
          reason: "The exact Workflow item exists, but its focused resolution state could not be opened.",
          consequence: "No alternate item was focused and the requested work remains unresolved.",
          nextResolution: "Refresh Workflow, or return to the opportunity and reopen this exact action."
        });
      });
      arrivalFocusFrames.push(secondFrame);
    });
    arrivalFocusFrames.push(firstFrame);
    return () => arrivalFocusFrames.forEach((frame) => window.cancelAnimationFrame(frame));
  }, [
    approvalQueue,
    activeTaskJourney,
    attentionSummary.items,
    autopilotAttentionTruncated,
    autopilotOperations.error,
    autopilotOperations.loading,
    autopilotOperations.stale,
    decisionDebt.error,
    decisionDebt.loading,
    decisionDebt.snapshot,
    decisionDebt.stale,
    exactArrivalActive,
    focusAttentionType,
    focusQuoteId,
    focusRequestId,
    organizationId,
    reportArrivalResolution,
    state.error,
    state.loading,
    state.quotes,
    state.truncated,
    workflowReadError
  ]);

  useEffect(() => {
    if (
      !open
      || state.loading
      || autopilotOperations.loading
      || exactArrivalActive
      || tabInteractedRef.current
      || activeTab !== "followups"
      || attentionSummary.quoteCount < 1
    ) return;
    setActiveTab("attention");
  }, [
    activeTab,
    attentionSummary.quoteCount,
    autopilotOperations.loading,
    exactArrivalActive,
    open,
    state.loading
  ]);

  useEffect(() => {
    if (
      !open
      || state.loading
      || state.organizationId !== String(organizationId || "").trim()
      || typeof onAttentionSummaryChange !== "function"
    ) return;
    onAttentionSummaryChange({
      ...attentionSummary,
      organizationId: state.organizationId
    });
  }, [
    attentionSummary.itemCount,
    attentionSummary.quoteCount,
    open,
    onAttentionSummaryChange,
    organizationId,
    state.loading,
    state.organizationId
  ]);

  const metrics = useMemo(() => {
    return {
      active: state.quotes.filter((quote) => ["draft", "sent", "viewed", "accepted"].includes(quote.status)).length,
      needsReadiness: quoteSummaries.filter((item) => item.readiness.score < 100).length,
      due: attentionSummary.counts.followUps + attentionSummary.counts.postEventCloseouts,
      pendingApprovals: approvalQueue.filter((item) => item.request.state === "pending").length
    };
  }, [
    state.quotes,
    quoteSummaries,
    approvalQueue,
    attentionSummary.counts.followUps,
    attentionSummary.counts.postEventCloseouts
  ]);

  const readiness = selectedQuote ? buildProposalReadiness(selectedQuote) : null;
  const timeline = selectedQuote ? buildQuoteLifecycleTimeline(selectedQuote) : [];
  const requestableApprovalActions = useMemo(
    () => getRequestableApprovalActions(selectedQuote || {}, {
      requireActivePortal: state.source === "firebase"
    }).filter((action) => (
      state.source === "firebase" || !PROVIDER_APPROVAL_ACTIONS.has(action.id)
    )),
    [selectedQuote, state.source]
  );
  const resolvedApprovalAction = requestableApprovalActions.some((item) => item.id === approvalAction)
    ? approvalAction
    : requestableApprovalActions[0]?.id || "";
  const isAdmin = String(currentUserRole || "").toLowerCase() === "admin";
  const isStaff = ["admin", "sales"].includes(String(currentUserRole || "").toLowerCase());

  useEffect(() => {
    setApprovalAction((current) => (
      requestableApprovalActions.some((item) => item.id === current)
        ? current
        : requestableApprovalActions[0]?.id || ""
    ));
  }, [requestableApprovalActions]);

  const selectTab = (tabId, { focus = false } = {}) => {
    tabInteractedRef.current = true;
    setActiveTab(tabId);
    if (focus) {
      window.requestAnimationFrame(() => tabRefs.current[tabId]?.focus());
    }
  };

  const handleTabKeyDown = (event, tabId) => {
    const currentIndex = WORKFLOW_TABS.indexOf(tabId);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % WORKFLOW_TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + WORKFLOW_TABS.length) % WORKFLOW_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = WORKFLOW_TABS.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextTab = WORKFLOW_TABS[nextIndex];
    selectTab(nextTab, { focus: true });
  };

  const applyQuoteLocally = (quoteId, updater) => {
    setState((prev) => ({
      ...prev,
      quotes: prev.quotes.map((quote) => (quote.id === quoteId ? updater(quote) : quote))
    }));
  };

  const reportFollowUpTaskOutcome = (phase, taskJourney, proof = null) => {
    if (!taskJourney || typeof onTaskOutcome !== "function") return null;
    return onTaskOutcome({
      organizationId: String(organizationId || "").trim(),
      startedAtISO: taskJourney.startedAtISO,
      taskId: taskJourney.taskId,
      focus: {
        quoteId: taskJourney.focus.quoteId,
        attentionType: taskJourney.focus.attentionType,
        requestId: taskJourney.focus.requestId
      },
      phase,
      proof: phase === "resolved" ? proof : null
    });
  };

  const followUpUnchangedFacts = () => [
    "Customer contact was not sent",
    "Payment and booking evidence did not change",
    "No provider outcome was inferred"
  ];

  const transitionFollowUpActionFeedback = (selector, phase, fields = {}) => {
    if (!workspaceActionFeedbackAvailable || !selector) return null;
    return transitionActionFeedback({
      ...selector,
      phase,
      ...fields
    });
  };

  const followUpFeedbackSelectorFromRecord = (feedback) => {
    if (!feedback) return null;
    return {
      attemptId: feedback.attemptId,
      actionId: feedback.actionId,
      generation: feedback.generation,
      object: feedback.object
    };
  };

  const findFollowUpFeedbackSelector = ({ quoteId, taskJourney }) => {
    if (!taskJourney) return null;
    const generation = `${taskJourney.taskId}:${taskJourney.startedAtISO}`;
    const feedback = workspaceActionFeedbackRecords.find((candidate) => (
      candidate.actionId === "complete-follow-up"
      && candidate.object?.kind === "workflow-item"
      && candidate.object?.id === `follow-up:${quoteId}`
      && candidate.generation === generation
      && candidate.phase === "uncertain"
    ));
    return followUpFeedbackSelectorFromRecord(feedback);
  };

  const followUpOperationIsLive = (operation) => Boolean(
    operation
    && followUpMountedRef.current
    && workflowScopeRef.current === operation.workflowScope
  );

  const followUpOperationIsCurrent = (operation) => Boolean(
    followUpOperationIsLive(operation)
    && followUpConfirmationGenerationRef.current === operation.uiGeneration
  );

  const followUpOperationOwnsActiveTask = (operation) => Boolean(
    operation?.taskJourney
    && activeFollowUpTaskIdentityRef.current
      === `${operation.taskJourney.taskId}:${operation.taskJourney.startedAtISO}`
  );

  const beginFollowUpActionFeedback = ({ quoteId, quoteNumber, taskJourney }) => {
    if (!workspaceActionFeedbackAvailable) return null;
    return beginActionFeedback({
      actionId: "complete-follow-up",
      actionLabel: "Complete follow-up",
      generation: `${taskJourney.taskId}:${taskJourney.startedAtISO}`,
      object: {
        kind: "workflow-item",
        id: `follow-up:${quoteId}`,
        label: `${quoteNumber || "Quote"} follow-up`
      },
      message: "Saving the internal follow-up and checking the exact workspace record.",
      changed: ["Internal follow-up completion requested"],
      unchanged: followUpUnchangedFacts()
    });
  };

  const markFollowUpConfirmationUncertain = ({ operation, reason }) => {
    if (!followUpOperationIsLive(operation)) return { status: "ignored" };
    const taskOutcome = followUpOperationOwnsActiveTask(operation)
      ? reportFollowUpTaskOutcome("uncertain", operation.taskJourney)
      : operation.taskJourney ? { status: "recovery", reason: "task_generation_changed" } : null;
    const browserLocal = reason === "connected_readback_required";
    const feedbackResult = transitionFollowUpActionFeedback(operation.feedbackSelector, "uncertain", {
      message: browserLocal
        ? "This browser changed its local follow-up, but no exact connected record confirmed the outcome."
        : "The write may have completed, but the exact same-workspace record did not confirm this outcome.",
      changed: browserLocal
        ? ["Browser-local follow-up changed"]
        : ["Follow-up completion remains unconfirmed"],
      unchanged: [
        "Current task remains open",
        ...followUpUnchangedFacts()
      ],
      nextAction: { id: "reconcile", label: "Review exact follow-up" }
    });
    if (followUpOperationIsCurrent(operation)) {
      setFollowUpConfirmation({
        phase: "uncertain",
        quoteId: operation.quoteId,
        reason: String(reason || "readback_unavailable"),
        shared: Boolean(feedbackResult?.ok)
      });
    }
    return { status: taskOutcome?.status || "uncertain", taskOutcome, feedbackResult };
  };

  const confirmFollowUpCompletion = async ({
    quoteId,
    quoteNumber,
    taskJourney,
    expectedFollowUp = null,
    feedbackSelector = null,
    uiGeneration = followUpConfirmationGenerationRef.current
  }) => {
    if (followUpConfirmationOperationRef.current) return { status: "busy" };
    const actionScope = workflowScopeRef.current;
    const confirmationBusyKey = `confirm-followup:${quoteId}`;
    const selectedFeedback = workspaceActionFeedbackRecords.find((candidate) => (
      candidate.attemptId === feedbackSelector?.attemptId
      && candidate.generation === feedbackSelector?.generation
    ));
    const reconciling = selectedFeedback?.phase === "uncertain";
    const operation = Object.freeze({
      operationId: Symbol("confirm-follow-up"),
      workflowScope: actionScope,
      uiGeneration,
      busyKey: confirmationBusyKey,
      quoteId,
      taskJourney,
      feedbackSelector
    });
    followUpConfirmationOperationRef.current = operation;
    setBusyKey(confirmationBusyKey);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    const pendingFeedback = transitionFollowUpActionFeedback(feedbackSelector, "pending", {
      message: "The write returned. Checking the exact same-workspace follow-up before confirming success.",
      changed: ["Internal follow-up completion requested"],
      unchanged: followUpUnchangedFacts(),
      dispatchState: "dispatched",
      mode: reconciling ? "reconcile" : undefined
    });
    if (followUpOperationIsCurrent(operation)) {
      setFollowUpConfirmation({
        phase: "pending",
        quoteId,
        reason: "readback_pending",
        shared: Boolean(pendingFeedback?.ok)
      });
    }
    try {
      const authoritativeQuote = await getQuoteById(quoteId, { serverOnly: true });
      if (!followUpOperationIsLive(operation)) return { status: "ignored" };
      const verification = verifyFollowUpCompletionReadback({
        organizationId,
        quoteId,
        quote: authoritativeQuote,
        expectedFollowUp,
        nowISO: new Date().toISOString(),
        timeZone: tenantTimeZone || state.snapshotTimeZone || "UTC"
      });
      if (!verification.ok) {
        return markFollowUpConfirmationUncertain({
          operation,
          reason: verification.code
        });
      }

      if (followUpOperationIsCurrent(operation)) {
        const snapshotContext = captureWorkflowSnapshotContext();
        setState((prev) => ({
          ...prev,
          error: "",
          feedback: "",
          source: "firebase",
          quotes: prev.quotes.map((quote) => (
            quote.id === quoteId ? authoritativeQuote : quote
          )),
          ...snapshotContext
        }));
        followUpConfirmationExpectationRef.current = null;
      }
      const taskOutcome = followUpOperationOwnsActiveTask(operation)
        ? reportFollowUpTaskOutcome(
          "resolved",
          taskJourney,
          verification.proof
        )
        : taskJourney ? { status: "recovery", reason: "task_generation_changed" } : null;
      if (!taskJourney || taskOutcome?.status === "resolved") {
        const feedbackResult = transitionFollowUpActionFeedback(feedbackSelector, "succeeded", {
          message: "The exact same-workspace record confirms this internal follow-up is complete.",
          changed: buildFollowUpCompletionChangedFacts(taskOutcome),
          unchanged: followUpUnchangedFacts(),
          evidence: {
            kind: "authoritative_readback",
            id: verification.proof.proofId,
            source: "quote.workflow.followUp",
          },
          nextAction: null
        });
        if (followUpOperationIsCurrent(operation)) {
          setFollowUpConfirmation({
            phase: "confirmed",
            quoteId,
            reason: "",
            shared: Boolean(feedbackResult?.ok)
          });
        }
        if (!feedbackResult?.ok) {
          pushToast(`Follow-up completion confirmed for ${quoteNumber}.`, "success");
        }
        return { status: "confirmed", verification, taskOutcome, feedbackResult };
      } else {
        const feedbackResult = transitionFollowUpActionFeedback(feedbackSelector, "recovery", {
          message: "The follow-up record is confirmed, but the current task could not be closed on this device.",
          changed: ["Internal follow-up marked complete"],
          unchanged: ["Current task tracking remains open", ...followUpUnchangedFacts()],
          nextAction: { id: "reconcile", label: "Review exact follow-up" }
        });
        if (followUpOperationIsCurrent(operation)) {
          setFollowUpConfirmation({
            phase: "uncertain",
            quoteId,
            reason: "task_outcome_not_retained",
            shared: Boolean(feedbackResult?.ok)
          });
        }
        return { status: "recovery", verification, taskOutcome, feedbackResult };
      }
    } catch {
      if (!followUpOperationIsLive(operation)) return { status: "ignored" };
      return markFollowUpConfirmationUncertain({
        operation,
        reason: "readback_unavailable"
      });
    } finally {
      if (followUpConfirmationOperationRef.current === operation) {
        followUpConfirmationOperationRef.current = null;
      }
      if (followUpOperationIsLive(operation)) {
        setBusyKey((current) => (current === confirmationBusyKey ? "" : current));
      }
    }
  };

  const handleSaveFollowUp = async () => {
    if (!selectedQuote?.id || !isStaff || followUpSaveOperationRef.current) return;
    const normalizedFollowUpDueDate = String(followUpDraft.dueDate || "").trim();
    const preflightField = !FOLLOW_UP_STAGES.some((stage) => stage.id === followUpDraft.stage)
      ? "stage"
      : normalizedFollowUpDueDate && !isCanonicalWorkflowDateOnly(normalizedFollowUpDueDate)
        ? "dueDate"
        : "";
    const preflightError = preflightField === "stage"
      ? "Choose a valid follow-up stage before saving."
      : preflightField === "dueDate"
        ? "Enter a real calendar date in YYYY-MM-DD format before saving."
        : "";
    if (preflightError) {
      setState((prev) => ({ ...prev, error: preflightError, feedback: "" }));
      setFollowUpValidationField(preflightField);
      setFollowUpConfirmation({ phase: "idle", quoteId: "", reason: "", shared: false });
      const invalidField = preflightField === "stage"
        ? followUpStageRef.current
        : followUpDueDateRef.current;
      invalidField?.focus();
      return;
    }
    setFollowUpValidationField("");
    if (selectedFollowUpTaskJourney?.phase === "uncertain") {
      setFollowUpConfirmation({
        phase: "uncertain",
        quoteId: selectedQuote.id,
        reason: "retry_readback_only",
        shared: Boolean(findFollowUpFeedbackSelector({
          quoteId: selectedQuote.id,
          taskJourney: selectedFollowUpTaskJourney
        }))
      });
      return;
    }
    const actionScope = workflowScopeRef.current;
    const actionBusyKey = `followup:${selectedQuote.id}`;
    const uiGeneration = followUpConfirmationGenerationRef.current;
    followUpConfirmationExpectationRef.current = null;
    const unresolvedExistingFeedback = workspaceActionFeedbackRecords.some((candidate) => (
      candidate.actionId === "complete-follow-up"
      && candidate.object?.kind === "workflow-item"
      && candidate.object?.id === `follow-up:${selectedQuote.id}`
      && ["pending", "uncertain"].includes(candidate.phase)
    ));
    if (unresolvedExistingFeedback) {
      setState((prev) => ({ ...prev, error: "", feedback: "" }));
      setFollowUpConfirmation({
        phase: "uncertain",
        quoteId: selectedQuote.id,
        reason: "existing_feedback_unresolved",
        shared: false
      });
      return;
    }
    const trackedFeedbackRequired = Boolean(
      selectedFollowUpTaskJourney && followUpDraft.completed
    );
    const startedFeedback = trackedFeedbackRequired
      ? beginFollowUpActionFeedback({
        quoteId: selectedQuote.id,
        quoteNumber: selectedQuote.quoteNumber,
        taskJourney: selectedFollowUpTaskJourney
      })
      : null;
    if (trackedFeedbackRequired && !startedFeedback?.ok) {
      setState((prev) => ({ ...prev, error: "", feedback: "" }));
      setFollowUpConfirmation({
        phase: "uncertain",
        quoteId: selectedQuote.id,
        reason: startedFeedback?.reason === "unresolved_feedback_exists"
          ? "existing_feedback_unresolved"
          : "feedback_contract_unavailable",
        shared: false
      });
      return;
    }
    const feedbackSelector = startedFeedback?.ok && startedFeedback.selector
      ? startedFeedback.selector
      : null;
    const operation = Object.freeze({
      operationId: Symbol("save-follow-up"),
      workflowScope: actionScope,
      uiGeneration,
      busyKey: actionBusyKey,
      quoteId: selectedQuote.id,
      taskJourney: selectedFollowUpTaskJourney,
      feedbackSelector
    });
    followUpSaveOperationRef.current = operation;
    if (selectedFollowUpTaskJourney && followUpDraft.completed) {
      setFollowUpConfirmation({
        phase: "pending",
        quoteId: selectedQuote.id,
        reason: "write_pending",
        shared: Boolean(feedbackSelector)
      });
    }
    setBusyKey(actionBusyKey);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const updatePromise = updateQuoteFollowUp({
        quoteId: selectedQuote.id,
        ...followUpDraft,
        actorEmail: currentUserEmail
      });
      if (selectedFollowUpTaskJourney && followUpDraft.completed) {
        const dispatchedFeedback = transitionFollowUpActionFeedback(feedbackSelector, "pending", {
          message: "The internal follow-up request was sent. Waiting for its exact result.",
          changed: ["Internal follow-up completion requested"],
          unchanged: followUpUnchangedFacts(),
          dispatchState: "dispatched"
        });
        if (followUpOperationIsCurrent(operation) && !dispatchedFeedback?.ok) {
          setFollowUpConfirmation((current) => ({ ...current, shared: false }));
        }
      }
      const result = await updatePromise;
      if (!followUpOperationIsLive(operation)) return;
      if (result?.ok !== true || !record(result.followUp)) {
        throw new Error("Follow-up save did not return its expected result.");
      }
      applyQuoteLocally(selectedQuote.id, (quote) => ({
        ...quote,
        workflow: {
          ...(quote.workflow || {}),
          followUp: result.followUp,
          approvalRequests: quote.workflow?.approvalRequests || []
        }
      }));
      if (!result.followUp.completed || !selectedFollowUpTaskJourney) {
        setFollowUpConfirmation({ phase: "idle", quoteId: "", reason: "", shared: false });
        reportSuccess(`Follow-up saved for ${selectedQuote.quoteNumber}.`);
        return;
      }
      if (result.storage !== "firebase") {
        markFollowUpConfirmationUncertain({
          operation,
          reason: "connected_readback_required"
        });
        return;
      }
      const confirmationExpectation = {
        workflowScope: actionScope,
        organizationId: String(organizationId || "").trim(),
        quoteId: selectedQuote.id,
        startedAtISO: selectedFollowUpTaskJourney.startedAtISO,
        taskId: selectedFollowUpTaskJourney.taskId,
        focus: {
          quoteId: selectedFollowUpTaskJourney.focus.quoteId,
          attentionType: selectedFollowUpTaskJourney.focus.attentionType,
          requestId: selectedFollowUpTaskJourney.focus.requestId
        },
        followUp: followUpConfirmationShape(result.followUp),
        feedbackSelector
      };
      if (followUpOperationIsCurrent(operation)) {
        followUpConfirmationExpectationRef.current = confirmationExpectation;
      }
      await confirmFollowUpCompletion({
        quoteId: selectedQuote.id,
        quoteNumber: selectedQuote.quoteNumber,
        taskJourney: selectedFollowUpTaskJourney,
        expectedFollowUp: confirmationExpectation.followUp,
        feedbackSelector,
        uiGeneration
      });
    } catch (err) {
      if (!followUpOperationIsLive(operation)) return;
      const trackedCompletion = Boolean(selectedFollowUpTaskJourney && followUpDraft.completed);
      if (followUpOperationIsCurrent(operation)) {
        setState((prev) => ({
          ...prev,
          error: trackedCompletion ? "" : err?.message || "Failed to save follow-up."
        }));
      }
      if (trackedCompletion) {
        markFollowUpConfirmationUncertain({
          operation,
          reason: "write_outcome_unconfirmed"
        });
      }
    } finally {
      if (followUpSaveOperationRef.current === operation) {
        followUpSaveOperationRef.current = null;
      }
      if (followUpOperationIsLive(operation)) {
        setBusyKey((current) => (current === actionBusyKey ? "" : current));
      }
    }
  };

  const handleRetryFollowUpConfirmation = () => {
    if (!selectedQuote?.id || busyKey) return;
    const expectation = followUpConfirmationExpectationRef.current;
    const exactExpectation = expectation
      && expectation.workflowScope === workflowScopeRef.current
      && expectation.organizationId === String(organizationId || "").trim()
      && expectation.quoteId === selectedQuote.id
      && expectation.focus.quoteId === focusQuoteId
      && expectation.focus.attentionType === focusAttentionType
      && expectation.focus.requestId === focusRequestId
      ? expectation
      : null;
    const feedbackSelector = exactExpectation?.feedbackSelector
      || findFollowUpFeedbackSelector({
        quoteId: selectedQuote.id,
        taskJourney: selectedFollowUpTaskJourney
      });
    void confirmFollowUpCompletion({
      quoteId: selectedQuote.id,
      quoteNumber: selectedQuote.quoteNumber,
      taskJourney: selectedFollowUpTaskJourney,
      expectedFollowUp: exactExpectation?.followUp || null,
      feedbackSelector,
      uiGeneration: followUpConfirmationGenerationRef.current
    });
  };

  const handleRequestApproval = async () => {
    if (!selectedQuote?.id || !isStaff || !resolvedApprovalAction) return;
    if (state.source !== "firebase" && PROVIDER_APPROVAL_ACTIONS.has(resolvedApprovalAction)) {
      setState((prev) => ({
        ...prev,
        error: "Payment approvals require Firebase-backed provider execution. Reload the hosted workspace and try again."
      }));
      return;
    }
    const eligibility = getApprovalActionEligibility(selectedQuote, resolvedApprovalAction, {
      requireActivePortal: state.source === "firebase"
    });
    if (!eligibility.eligible) {
      setState((prev) => ({
        ...prev,
        error: eligibility.reason || "This action is no longer available for the selected quote."
      }));
      return;
    }
    const actionScope = workflowScopeRef.current;
    const actionBusyKey = `request:${selectedQuote.id}`;
    setBusyKey(actionBusyKey);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await requestQuoteApproval({
        quoteId: selectedQuote.id,
        action: resolvedApprovalAction,
        note: approvalNote,
        actorEmail: currentUserEmail,
        actorRole: currentUserRole
      });
      if (workflowScopeRef.current !== actionScope) return;
      applyQuoteLocally(selectedQuote.id, (quote) => ({
        ...quote,
        workflow: {
          ...(quote.workflow || {}),
          followUp: quote.workflow?.followUp || followUpFromQuote(quote),
          approvalRequests: [...(quote.workflow?.approvalRequests || []), result.request]
        }
      }));
      setApprovalNote("");
      reportSuccess(`${actionLabel(resolvedApprovalAction)} approval requested.`);
    } catch (err) {
      if (workflowScopeRef.current !== actionScope) return;
      setState((prev) => ({ ...prev, error: err?.message || "Failed to request approval." }));
    } finally {
      if (workflowScopeRef.current === actionScope) {
        setBusyKey((current) => (current === actionBusyKey ? "" : current));
      }
    }
  };

  const handleResolveApproval = async (quoteId, requestId, nextState) => {
    if (!isAdmin) return;
    const actionScope = workflowScopeRef.current;
    const actionBusyKey = `resolve:${requestId}:${nextState}`;
    setBusyKey(actionBusyKey);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await resolveQuoteApprovalRequest({
        quoteId,
        requestId,
        state: nextState,
        resolutionNote: resolutionNotes[requestId] || "",
        actorEmail: currentUserEmail,
        actorRole: currentUserRole
      });
      if (workflowScopeRef.current !== actionScope) return;
      applyQuoteLocally(quoteId, (quote) => ({
        ...quote,
        workflow: {
          ...(quote.workflow || {}),
          approvalRequests: (quote.workflow?.approvalRequests || []).map((item) => (
            item.id === requestId ? result.request : item
          ))
        }
      }));
      setResolutionNotes((prev) => ({ ...prev, [requestId]: "" }));
      reportSuccess(`Approval request ${nextState}.`);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const resolvedRow = Array.from(dialogRef.current?.querySelectorAll(".approval-row") || [])
            .find((element) => element.dataset.requestId === requestId);
          (resolvedRow || tabRefs.current.approvals)?.focus();
        });
      });
    } catch (err) {
      if (workflowScopeRef.current !== actionScope) return;
      setState((prev) => ({ ...prev, error: err?.message || "Failed to resolve approval." }));
    } finally {
      if (workflowScopeRef.current === actionScope) {
        setBusyKey((current) => (current === actionBusyKey ? "" : current));
      }
    }
  };

  const handleReviewFollowUp = (quoteId) => {
    setSelectedQuoteId(quoteId);
    selectTab("followups");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => detailHeadingRef.current?.focus());
    });
  };

  const handleReviewApprovals = (quoteId) => {
    selectTab("approvals");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const quoteApproval = Array.from(dialogRef.current?.querySelectorAll(".approval-row") || [])
          .find((element) => element.dataset.quoteId === quoteId && element.dataset.pending === "true");
        (quoteApproval || tabRefs.current.approvals)?.focus();
      });
    });
  };

  const handleReviewApprovalRecord = (quoteId, requestId = "") => {
    selectTab("approvals");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const approvalRows = Array.from(dialogRef.current?.querySelectorAll(".approval-row") || []);
        const exactRequest = requestId
          ? approvalRows.find((element) => (
            element.dataset.quoteId === quoteId
            && element.dataset.requestId === requestId
          ))
          : null;
        const quoteApproval = approvalRows.find((element) => element.dataset.quoteId === quoteId);
        (exactRequest || quoteApproval || tabRefs.current.approvals)?.focus();
      });
    });
  };

  const handleEditQuote = (quote) => {
    skipReturnFocusRef.current = true;
    onEditQuote?.(quote);
  };

  const handleOpenQuoteHistory = (quote, request) => {
    skipReturnFocusRef.current = true;
    onOpenQuoteHistory?.({
      quoteId: quote?.id || "",
      action: request?.action || ""
    });
  };

  const handleOpenCloseoutWorkspace = (quote) => {
    const customerId = String(quote?.customerId || "").trim();
    if (customerId && typeof onOpenCustomer === "function") {
      skipReturnFocusRef.current = true;
      onOpenCustomer(customerId);
      return;
    }
    handleOpenQuoteHistory(quote, null);
  };

  const openAutopilotConfiguration = () => {
    const policy = autopilotOperations.snapshot?.policy || {};
    const kinds = policy.kinds || {};
    const quietHoursEnabled = policy.quietHours?.enabled === true;
    setAutopilotPolicyDraft({
      enabled: policy.tenantEnabled === true || policy.tenant?.enabled === true,
      timeZone: normalizeTimeZone(policy.timeZone || tenantTimeZone)
        || state.snapshotTimeZone
        || "UTC",
      quietHours: quietHoursEnabled
        ? {
            enabled: true,
            start: policy.quietHours?.start || "21:00",
            end: policy.quietHours?.end || "08:00"
          }
        : { enabled: false, start: "", end: "" },
      kinds: {
        quote_follow_up: kinds.quote_follow_up?.enabled !== false,
        deposit_reminder: kinds.deposit_reminder?.enabled !== false,
        final_balance_reminder: kinds.final_balance_reminder?.enabled !== false,
        post_event_review_request: kinds.post_event_review_request?.enabled === true,
        unread_customer_reply: kinds.unread_customer_reply?.enabled !== false
      },
      reviewRequestUrl: String(policy.reviewRequestUrl || "").trim(),
      maxAttempts: Number(policy.maxAttempts) || 3,
      quoteFollowUpDayOffsets: kinds.quote_follow_up?.dayOffsets || [2, 5],
      depositReminderDayOffsets: kinds.deposit_reminder?.dayOffsets || [1, 3],
      finalBalanceReminderDayOffsets: [14, 7, 3]
    });
    setAutopilotConfigurationOpen(true);
  };

  const updateAutopilotMutation = (mutation) => {
    setAutopilotOperations((current) => ({ ...current, mutation }));
  };

  const handleSaveAutopilotPolicy = async () => {
    if (!isAdmin) return;
    const scopedOrganizationId = String(organizationId || "").trim();
    const pending = readPendingRevenueAutopilotPolicyAttempt({
      organizationId: scopedOrganizationId
    });
    updateAutopilotMutation({
      state: pending ? "reconciliation" : "submitting",
      operation: "configure_policy",
      error: "",
      receipt: null
    });
    try {
      const result = await configureRevenueAutopilotPolicy(pending
        ? {
            organizationId: pending.organizationId,
            ...(pending.expectedPolicyVersion
              ? { expectedPolicyVersion: pending.expectedPolicyVersion }
              : {}),
            policy: pending.policy,
            requestId: pending.requestId
          }
        : {
            organizationId: scopedOrganizationId,
            expectedPolicyVersion: autopilotOperations.snapshot?.policy?.policyVersion || undefined,
            policy: autopilotPolicyDraft
          });
      updateAutopilotMutation({
        state: "receipt",
        operation: "configure_policy",
        error: "",
        receipt: result.receipt
      });
      setAutopilotConfigurationOpen(false);
      await loadRevenueAutopilotOperations();
      pushToast("Follow-up automation policy recorded. Runtime and provider gates remain separate.", "success");
    } catch (error) {
      updateAutopilotMutation({
        state: isDefinitiveRevenueAutopilotError(error) ? "error" : "uncertain",
        operation: "configure_policy",
        error: error?.message || "The policy action did not return a definitive receipt.",
        receipt: null
      });
    }
  };

  const handleMaterializeAutopilot = async () => {
    const scopedOrganizationId = String(organizationId || "").trim();
    if (!selectedQuoteId) {
      updateAutopilotMutation({
        state: "error",
        operation: "materialize_jobs",
        error: "Select an authoritative quote before preparing its governed records.",
        receipt: null
      });
      return;
    }
    const pending = readPendingRevenueAutopilotMaterializationAttempt({
      organizationId: scopedOrganizationId,
      quoteId: selectedQuoteId
    });
    updateAutopilotMutation({
      state: pending ? "reconciliation" : "submitting",
      operation: "materialize_jobs",
      error: "",
      receipt: null,
      quoteId: selectedQuoteId
    });
    try {
      const result = await materializeRevenueAutopilotJobs({
        organizationId: scopedOrganizationId,
        quoteId: selectedQuoteId,
        ...(pending?.requestId ? { requestId: pending.requestId } : {})
      });
      updateAutopilotMutation({
        state: "receipt",
        operation: "materialize_jobs",
        error: "",
        receipt: result.receipt,
        materializationSummary: result.materializationSummary,
        quoteId: selectedQuoteId
      });
      await loadRevenueAutopilotOperations();
    } catch (error) {
      updateAutopilotMutation({
        state: isDefinitiveRevenueAutopilotError(error) ? "error" : "uncertain",
        operation: "materialize_jobs",
        error: error?.message || "Job preparation did not return a definitive receipt.",
        receipt: null,
        quoteId: selectedQuoteId
      });
    }
  };

  const handleReconcileAutopilotJob = async (job) => {
    const targetJobId = String(job?.jobId || "").trim();
    const targetQuoteId = String(job?.quoteId || selectedQuoteId || "").trim();
    if (!targetJobId || !targetQuoteId) {
      if (autopilotOperations.mutation?.operation === "materialize_jobs") {
        await handleMaterializeAutopilot();
      }
      return;
    }
    updateAutopilotMutation({
      state: "reconciliation",
      operation: "reconcile_job",
      error: "",
      receipt: null,
      jobId: targetJobId
    });
    try {
      const result = await reconcileRevenueAutopilotJob({
        organizationId,
        quoteId: targetQuoteId,
        jobId: targetJobId
      });
      updateAutopilotMutation({
        state: "receipt",
        operation: "reconcile_job",
        error: "",
        receipt: result.receipt,
        reconciliationState: result.reconciliationState,
        reconciliationReason: result.reason || "",
        jobId: targetJobId
      });
      await loadRevenueAutopilotOperations();
    } catch (error) {
      updateAutopilotMutation({
        state: isDefinitiveRevenueAutopilotError(error) ? "error" : "uncertain",
        operation: "reconcile_job",
        error: error?.message || "Provider outcome reconciliation remains uncertain.",
        receipt: null,
        jobId: targetJobId
      });
    }
  };

  const handleAcknowledgeAutopilotReply = async (attention) => {
    updateAutopilotMutation({
      state: "submitting",
      operation: "acknowledge_reply",
      error: "",
      receipt: null,
      attentionId: attention?.attentionId
    });
    try {
      const result = await acknowledgeRevenueAutopilotReply({
        organizationId,
        quoteId: attention?.quoteId,
        attentionId: attention?.attentionId,
        messageId: attention?.messageId
      });
      updateAutopilotMutation({
        state: "receipt",
        operation: "acknowledge_reply",
        error: "",
        receipt: result.receipt,
        attentionId: attention?.attentionId
      });
      await loadRevenueAutopilotOperations();
    } catch (error) {
      updateAutopilotMutation({
        state: isDefinitiveRevenueAutopilotError(error) ? "error" : "uncertain",
        operation: "acknowledge_reply",
        error: error?.message || "Manual reply acknowledgement remains uncertain.",
        receipt: null,
        attentionId: attention?.attentionId
      });
    }
  };

  const handleOpenAutopilotConversation = (attention) => {
    const quoteId = String(attention?.quoteId || "").trim();
    if (!quoteId) return;
    skipReturnFocusRef.current = true;
    onOpenQuoteHistory?.({
      quoteId,
      action: "conversation"
    });
  };

  const handleConfigureDecisionDebt = async ({ policy, expectedPolicyVersion }) => {
    setDecisionDebt((current) => ({
      ...current,
      mutation: { state: "submitting", error: "", receipt: null }
    }));
    try {
      const result = await configureDecisionDebtPolicy({
        organizationId,
        policy,
        ...(expectedPolicyVersion ? { expectedPolicyVersion } : {})
      });
      setDecisionDebt((current) => ({
        ...current,
        mutation: { state: "receipt", error: "", receipt: result.receipt }
      }));
      await loadDecisionDebt();
    } catch (error) {
      const pending = readPendingDecisionDebtPolicyAttempt({ organizationId });
      setDecisionDebt((current) => ({
        ...current,
        mutation: {
          state: pending?.definitive ? "error" : "uncertain",
          error: error?.message || "Decision-priority policy outcome is uncertain.",
          receipt: null,
          requestId: pending?.requestId
        }
      }));
    }
  };

  const handleReconcileDecisionDebt = async () => {
    setDecisionDebt((current) => ({
      ...current,
      mutation: { ...current.mutation, state: "reconciliation", error: "" }
    }));
    try {
      const result = await reconcileDecisionDebtPolicy({ organizationId });
      setDecisionDebt((current) => ({
        ...current,
        mutation: { state: "receipt", error: "", receipt: result.receipt }
      }));
      await loadDecisionDebt();
    } catch (error) {
      const pending = readPendingDecisionDebtPolicyAttempt({ organizationId });
      setDecisionDebt((current) => ({
        ...current,
        mutation: {
          state: pending?.definitive ? "error" : "uncertain",
          error: error?.message || "Decision-priority policy reconciliation remains uncertain.",
          receipt: null,
          requestId: pending?.requestId
        }
      }));
    }
  };

  const handleResetDecisionDebt = () => {
    const pending = readPendingDecisionDebtPolicyAttempt({ organizationId });
    if (resetDefinitiveDecisionDebtPolicyAttempt({
      organizationId,
      ...(pending?.requestId ? { requestId: pending.requestId } : {})
    })) {
      setDecisionDebt((current) => ({
        ...current,
        mutation: { state: "recovery", error: "", receipt: null }
      }));
    }
  };

  const focusAttentionItem = (candidateIds = []) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const rows = Array.from(dialogRef.current?.querySelectorAll(".workflow-attention-row") || []);
        const target = candidateIds
          .map((candidateId) => rows.find((row) => row.dataset.attentionId === candidateId))
          .find(Boolean);
        (target || attentionEmptyHeadingRef.current || tabRefs.current.attention)?.focus();
      });
    });
  };

  const handleReviewTimingCue = (cue) => {
    if (!cue?.quoteId) return;
    if (cue.type === "follow_up") {
      handleReviewFollowUp(cue.quoteId);
      return;
    }
    const attentionItem = attentionSummary.items.find((item) => (
      item.id === cue.id
      || (item.quoteId === cue.quoteId && item.type === cue.type)
    ));
    if (attentionItem) {
      selectTab("attention");
      focusAttentionItem([attentionItem.id]);
      return;
    }
    if (cue.type === "approval") handleReviewApprovalRecord(cue.quoteId);
    else handleReviewFollowUp(cue.quoteId);
  };

  const handleOpenTimingReceipt = (receipt) => {
    if (!state.quotes.some((item) => item.id === receipt?.quoteId)) return;
    if (receipt.kind === "approval_decision_recorded") {
      handleReviewApprovalRecord(receipt.quoteId, receipt.requestId);
      return;
    }
    handleReviewFollowUp(receipt.quoteId);
  };

  const handleChangeRequestAction = async (item, action) => {
    if (!isStaff || !item?.quoteId || item.unhandleable) return;
    const actionScope = workflowScopeRef.current;
    const note = handlingNotes[item.id] || "";
    const busyId = `change-request:${item.quoteId}:${action}`;
    const itemIndex = attentionSummary.items.findIndex((candidate) => candidate.id === item.id);
    const nextItemId = attentionSummary.items[itemIndex + 1]?.id || "";
    const previousItemId = attentionSummary.items[itemIndex - 1]?.id || "";
    setBusyKey(busyId);
    setState((prev) => ({ ...prev, error: "", feedback: "" }));
    try {
      const result = await updateQuoteChangeRequestHandling({
        organizationId,
        quoteId: item.quoteId,
        sourceRequestId: item.sourceRequestId,
        sourceSubmittedAtISO: item.sourceSubmittedAtISO,
        sourceMessage: item.sourceMessage,
        action,
        note,
        actorEmail: currentUserEmail,
        actorRole: currentUserRole
      });
      if (workflowScopeRef.current !== actionScope) return;
      applyQuoteLocally(item.quoteId, (quote) => ({
        ...quote,
        workflow: {
          ...(quote.workflow || {}),
          changeRequestHandling: result.handling
        }
      }));
      if (action === "mark_handled") {
        setHandlingNotes((prev) => ({ ...prev, [item.id]: "" }));
      }
      reportSuccess(action === "mark_handled"
        ? "Change request marked handled internally. No customer message was sent."
        : "Change request acknowledged internally. No customer message was sent.");
      focusAttentionItem(action === "mark_handled"
        ? [nextItemId, previousItemId].filter(Boolean)
        : [item.id]);
    } catch (err) {
      if (workflowScopeRef.current !== actionScope) return;
      if (err?.code === "workflow/stale-change-request") {
        await load();
      }
      if (workflowScopeRef.current !== actionScope) return;
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to update change request handling."
      }));
    } finally {
      if (workflowScopeRef.current === actionScope) {
        setBusyKey((current) => (current === busyId ? "" : current));
      }
    }
  };

  const revenueOperationsSnapshot = autopilotOperations.snapshot
    ? {
        ...autopilotOperations.snapshot,
        readState: autopilotOperations.loading
          ? "recovery"
          : autopilotOperations.error
            ? "stale"
            : autopilotOperations.snapshot.readState,
        mutation: autopilotOperations.mutation
      }
    : null;
  const decisionDebtPartial = Boolean(
    decisionDebt.snapshot?.bounds?.truncated
  );
  const autopilotReviewRequestConfiguration = buildRevenueAutopilotReviewRequestConfiguration({
    enabled: autopilotPolicyDraft.kinds.post_event_review_request,
    reviewRequestUrl: autopilotPolicyDraft.reviewRequestUrl
  });
  const pendingAutopilotPolicyAttempt = String(organizationId || "").trim()
    ? readPendingRevenueAutopilotPolicyAttempt({ organizationId })
    : null;
  const autopilotPolicySaveBlocked = isRevenueAutopilotPolicySaveBlocked({
    mutationState: autopilotOperations.mutation?.state,
    pendingAttempt: pendingAutopilotPolicyAttempt,
    reviewConfiguration: autopilotReviewRequestConfiguration
  });
  const followUpValidationErrorId = selectedQuote?.id
    ? `workflow-follow-up-${safeDomId(selectedQuote.id)}-validation-error`
    : undefined;

  if (!open) return null;

  return (
    <div
      className={embedded ? "container workspace-route-main embedded-workspace-route" : "modal-overlay"}
      data-layout-overlap-allowed={embedded ? undefined : "true"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="sales-workflow-title"
    >
      <div
        className={`modal-card sales-workflow-card${embedded ? " workspace-route-card" : ""}`}
        ref={dialogRef}
        tabIndex={-1}
        aria-busy={state.loading}
      >
        <div className="modal-head">
          <div>
            <h2
              ref={routeHeadingRef}
              id="sales-workflow-title"
              className={embedded ? "workspace-route-heading" : undefined}
              tabIndex={embedded ? -1 : undefined}
            >
              Workflow
            </h2>
            <p className="source-note">Source: {formatWorkspaceSource(state.source)}</p>
          </div>
          <div className="right-actions">
            <button type="button" className="ghost" onClick={load} disabled={state.loading}>
              {state.loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="ghost" onClick={onClose}>
              {embedded ? "Back to Home" : "Close"}
            </button>
          </div>
        </div>

        <p className="visually-hidden" role="status" aria-live="polite">
          {state.loading ? "Loading sales workflow." : ""}
        </p>
        {state.error && (
          <p
            className="error-note"
            role="alert"
            id={followUpValidationField ? followUpValidationErrorId : undefined}
          >
            {state.error}
          </p>
        )}
        {state.feedback && <p className="source-note">{state.feedback}</p>}

        <div className="workflow-metrics" aria-label="Sales workflow summary">
          <div><span>Active opportunities</span><strong>{metrics.active}</strong></div>
          <div><span>Readiness gaps</span><strong>{metrics.needsReadiness}</strong></div>
          <div><span>Due work</span><strong>{metrics.due}</strong></div>
          <div><span>Pending approvals</span><strong>{metrics.pendingApprovals}</strong></div>
        </div>

        <div className="workflow-tabs" role="tablist" aria-label="Sales workflow views">
          <button
            type="button"
            role="tab"
            id="workflow-tab-attention"
            aria-controls="workflow-panel-attention"
            tabIndex={activeTab === "attention" ? 0 : -1}
            ref={(node) => { tabRefs.current.attention = node; }}
            onKeyDown={(event) => handleTabKeyDown(event, "attention")}
            aria-selected={activeTab === "attention"}
            className={activeTab === "attention" ? "active" : ""}
            onClick={() => selectTab("attention")}
          >
            Attention ({attentionSummary.quoteCount})
          </button>
          <button
            type="button"
            role="tab"
            id="workflow-tab-followups"
            aria-controls="workflow-panel-followups"
            tabIndex={activeTab === "followups" ? 0 : -1}
            ref={(node) => { tabRefs.current.followups = node; }}
            onKeyDown={(event) => handleTabKeyDown(event, "followups")}
            aria-selected={activeTab === "followups"}
            className={activeTab === "followups" ? "active" : ""}
            onClick={() => selectTab("followups")}
          >
            Follow-ups
          </button>
          <button
            type="button"
            role="tab"
            id="workflow-tab-autopilot"
            aria-controls="workflow-panel-autopilot"
            tabIndex={activeTab === "autopilot" ? 0 : -1}
            ref={(node) => { tabRefs.current.autopilot = node; }}
            onKeyDown={(event) => handleTabKeyDown(event, "autopilot")}
            aria-selected={activeTab === "autopilot"}
            className={activeTab === "autopilot" ? "active" : ""}
            onClick={() => selectTab("autopilot")}
          >
            Follow-up automation
          </button>
          <button
            type="button"
            role="tab"
            id="workflow-tab-debt"
            aria-controls="workflow-panel-debt"
            tabIndex={activeTab === "debt" ? 0 : -1}
            ref={(node) => { tabRefs.current.debt = node; }}
            onKeyDown={(event) => handleTabKeyDown(event, "debt")}
            aria-selected={activeTab === "debt"}
            className={activeTab === "debt" ? "active" : ""}
            onClick={() => selectTab("debt")}
          >
            Decisions to review
          </button>
          <button
            type="button"
            role="tab"
            id="workflow-tab-approvals"
            aria-controls="workflow-panel-approvals"
            tabIndex={activeTab === "approvals" ? 0 : -1}
            ref={(node) => { tabRefs.current.approvals = node; }}
            onKeyDown={(event) => handleTabKeyDown(event, "approvals")}
            aria-selected={activeTab === "approvals"}
            className={activeTab === "approvals" ? "active" : ""}
            onClick={() => selectTab("approvals")}
          >
            Approvals ({metrics.pendingApprovals})
          </button>
        </div>

        <section
          className="workflow-attention-panel"
          role="tabpanel"
          id="workflow-panel-attention"
          aria-labelledby="workflow-tab-attention"
          tabIndex={0}
          hidden={activeTab !== "attention"}
          data-capability-id="cwf-12-workflow-attention"
        >
            <p className="workflow-attention-boundary">
              This is an in-app queue. Acknowledging or marking work handled does not edit a quote or send email or SMS.
            </p>
            {autopilotAttentionTruncated && (
              <p className="warning-note" data-unread-attention-bound="truncated">
                Customer-reply Attention reached the operations read bound. This queue is incomplete; review the Follow-up automation tab for the bounded source details.
              </p>
            )}
            <WorkflowTimingPanel
              model={timingRead.model}
              loading={state.loading}
              error={state.error || timingRead.error}
              loadedAtISO={state.snapshotAtISO}
              source={state.source}
              sourceTruncated={state.truncated}
              onRetry={() => load()}
              onReviewCue={handleReviewTimingCue}
              onOpenReceipt={handleOpenTimingReceipt}
            />
            {attentionSummary.items.length === 0
              && !state.loading
              && !state.error
              && state.snapshotAtISO && (
              <div className="workflow-attention-empty">
                <h3 ref={attentionEmptyHeadingRef} tabIndex={-1}>No workflow attention needed</h3>
                <p>Unread customer replies, due follow-ups, post-event closeouts, repeat-event opportunities, customer change requests, and pending approvals will appear here.</p>
              </div>
            )}
            <ol className="workflow-attention-list" aria-label="Quotes needing workflow attention">
              {attentionSummary.items.map((item) => {
                const quote = item.quote;
                const customerLabel = quote.customer?.name || quote.customer?.email || "Customer";
                const quoteLabel = formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" });
                const acknowledgeBusyKey = `change-request:${item.quoteId}:acknowledge`;
                const handleBusyKey = `change-request:${item.quoteId}:mark_handled`;
                const acknowledging = busyKey === acknowledgeBusyKey;
                const markingHandled = busyKey === handleBusyKey;
                const itemBusy = acknowledging || markingHandled;
                const handlingNote = handlingNotes[item.id] || "";
                const itemDomId = `workflow-attention-${safeDomId(item.id)}`;
                return (
                  <li key={item.id}>
                    <article
                      className={`workflow-attention-row attention-${item.type} state-${item.state}`}
                      tabIndex={-1}
                      data-attention-id={item.id}
                      aria-labelledby={`${itemDomId}-priority ${itemDomId}-quote`}
                    >
                      <div className="workflow-attention-head">
                        <div>
                          <span className="workflow-attention-priority" id={`${itemDomId}-priority`}>
                            {item.type === "change_request"
                              ? item.state === "acknowledged"
                                ? "Acknowledged change request"
                                : item.state === "invalid"
                                  ? "Change request data issue"
                                  : "New customer change request"
                              : item.type === "follow_up"
                                ? item.state === "overdue"
                                  ? `Overdue follow-up${item.daysOverdue ? ` · ${item.daysOverdue}d` : ""}`
                                  : "Follow-up due today"
                                : item.type === "unread_customer_reply"
                                  ? "Unread customer reply"
                                : item.type === "anniversary_rebooking"
                                  ? "Repeat-event opportunity"
                                : item.type === "post_event_closeout"
                                  ? item.state === "blocked_source"
                                    ? "Post-event closeout source review needed"
                                    : item.state === "blocked_configuration"
                                    ? "Post-event closeout configuration blocked"
                                    : item.state === "overdue"
                                      ? `Post-event closeout overdue${item.daysOverdue ? ` · ${item.daysOverdue}d` : ""}`
                                      : "Post-event closeout due today"
                                : `${item.pendingRequests.length} pending approval${item.pendingRequests.length === 1 ? "" : "s"}`}
                          </span>
                          <h3 id={`${itemDomId}-quote`}>{quoteLabel}</h3>
                          <p>{customerLabel}</p>
                        </div>
                        <time dateTime={item.dateISO}>{["follow_up", "post_event_closeout", "anniversary_rebooking"].includes(item.type) ? fmtDueDate(item.dateISO) : fmtDateTime(item.dateISO)}</time>
                      </div>

                      {item.type === "change_request" && (
                        <>
                          <p className="workflow-attention-message">
                            {quote.portalDecision?.message || "The customer request has no readable message."}
                          </p>
                          {item.unhandleable ? (
                            <p className="error-note">
                              This request is missing valid identity or message evidence. Review the quote data before taking action.
                            </p>
                          ) : (
                            <label className="field workflow-handling-note">
                              <span>Internal handling note (required to mark handled)</span>
                              <textarea
                                rows="2"
                                maxLength="800"
                                aria-label={`Internal handling note (required to mark handled) — ${quoteLabel}`}
                                value={handlingNote}
                                placeholder="What was changed or how was the request addressed?"
                                onChange={(event) => setHandlingNotes((prev) => ({
                                  ...prev,
                                  [item.id]: event.target.value
                                }))}
                              />
                            </label>
                          )}
                          <div className="workflow-attention-actions">
                            {!item.unhandleable && item.state === "new" && (
                              <button
                                type="button"
                                className="ghost compact"
                                onClick={() => handleChangeRequestAction(item, "acknowledge")}
                                disabled={itemBusy}
                                aria-label={acknowledging
                                  ? `Saving... acknowledgment — ${quoteLabel}`
                                  : `Acknowledge internally — ${quoteLabel}`}
                                aria-busy={acknowledging}
                              >
                                {acknowledging ? "Saving..." : "Acknowledge internally"}
                              </button>
                            )}
                            {!item.unhandleable && (
                              <button
                                type="button"
                                className="cta compact"
                                onClick={() => handleChangeRequestAction(item, "mark_handled")}
                                disabled={itemBusy || !handlingNote.trim()}
                                aria-label={markingHandled
                                  ? `Saving... handled state — ${quoteLabel}`
                                  : `Mark handled internally — ${quoteLabel}`}
                                aria-busy={markingHandled}
                              >
                                {markingHandled ? "Saving..." : "Mark handled internally"}
                              </button>
                            )}
                            {typeof onEditQuote === "function" && (
                              <button
                                type="button"
                                className="ghost compact"
                                onClick={() => handleEditQuote(quote)}
                                aria-label={`Edit quote — ${quoteLabel}`}
                              >
                                Edit quote
                              </button>
                            )}
                          </div>
                        </>
                      )}

                      {item.type === "follow_up" && (
                        <div className="workflow-attention-actions">
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleReviewFollowUp(item.quoteId)}
                            aria-label={`Review follow-up for ${quoteLabel}`}
                          >
                            Review follow-up
                          </button>
                        </div>
                      )}

                      {item.type === "approval" && (
                        <div className="workflow-attention-actions">
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleReviewApprovals(item.quoteId)}
                            aria-label={`Review approvals for ${quoteLabel}`}
                          >
                            Review approvals
                          </button>
                        </div>
                      )}

                      {item.type === "unread_customer_reply" && (
                        <>
                          <p className="workflow-attention-message">
                            A customer reply is waiting in the authoritative quote conversation. Message content remains quote-scoped and is not copied into this queue.
                          </p>
                          <div className="workflow-attention-actions">
                            <button
                              type="button"
                              className="cta compact"
                              onClick={() => handleOpenAutopilotConversation(item)}
                              disabled={!item.quoteId}
                              data-capability-action="open-central-unread-reply"
                              aria-label={`Open unread customer reply — ${quoteLabel}`}
                            >
                              Open conversation
                            </button>
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={() => handleAcknowledgeAutopilotReply(item)}
                              disabled={
                                !item.attentionId
                                || !item.messageId
                                || ["submitting", "reconciliation"].includes(autopilotOperations.mutation.state)
                              }
                              data-capability-action="acknowledge-central-unread-reply"
                              aria-label={`Mark unread customer reply handled manually — ${quoteLabel}`}
                            >
                              Mark handled manually
                            </button>
                          </div>
                        </>
                      )}

                      {item.type === "anniversary_rebooking" && (
                        <>
                          <p
                            className="workflow-attention-message"
                            data-capability-id="cwf-11-central-anniversary-attention"
                            data-capability-state="verification_required"
                          >
                            {formatWorkspaceText(item.eventName, { emptyLabel: "Prior event" })} was recorded as booked for this week last year. Open the client overview to verify the retained accepted proposal version and create or resume one governed rebook draft.
                          </p>
                          <p className="source-note">
                            {item.evidenceBoundary} {item.sourceBound?.truncated
                              ? "The bounded quote-history scan is incomplete, so older or matching rebook records may exist outside this view."
                              : "The cue comes from the bounded current quote-history read."} Calendar: {formatWorkspaceText(item.calendarContext?.label, { emptyLabel: "Calendar source unavailable" })} ({formatWorkspaceText(item.calendarContext?.timeZone, { emptyLabel: "time zone unavailable" })}).
                          </p>
                          <div className="workflow-attention-actions">
                            <button
                              type="button"
                              className="cta compact"
                              onClick={() => handleOpenCloseoutWorkspace(quote)}
                              disabled={!quote.customerId || typeof onOpenCustomer !== "function"}
                              data-capability-action="open-exact-version-rebook-review"
                              aria-label={`Review exact-version rebook for ${quoteLabel}`}
                            >
                              Review exact-version rebook
                            </button>
                          </div>
                        </>
                      )}

                      {item.type === "post_event_closeout" && (
                        <>
                          <p className={["blocked_configuration", "blocked_source"].includes(item.state) ? "warning-note" : "source-note"}>
                            {item.state === "blocked_source"
                              ? "This legacy booking is preserved, but its exact accepted proposal source could not establish an authoritative closeout. Review the quote record before follow-up."
                              : item.state === "blocked_configuration"
                              ? "Set a valid business time zone in Catalog Administration, then open the client overview to review closeout items."
                              : "This internal closeout record is due in the client overview. Reviewing it does not send a thank-you or review request."}
                          </p>
                          <div className="workflow-attention-actions">
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={() => handleOpenCloseoutWorkspace(quote)}
                              aria-label={`${quote.customerId && onOpenCustomer ? "Open client overview" : "Open quote"} for post-event closeout — ${quoteLabel}`}
                            >
                              {quote.customerId && onOpenCustomer ? "Open client overview" : "Open quote"}
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
        </section>

        <div
          className={`sales-workflow-layout${quoteSummaries.length === 0 && !state.loading ? " sales-workflow-layout-empty" : ""}`}
          role="tabpanel"
          id="workflow-panel-followups"
          aria-labelledby="workflow-tab-followups"
          tabIndex={0}
          hidden={activeTab !== "followups"}
        >
            <section className="workflow-quote-list" aria-label="Quotes and follow-ups">
              {quoteSummaries.length === 0 && !state.loading && <p className="muted">No quotes saved yet.</p>}
              {quoteSummaries.map(({ quote, readiness: itemReadiness, followUp }) => {
                const overdue = !followUp.completed
                  && followUp.dueDate
                  && state.snapshotTodayISO
                  && followUp.dueDate < state.snapshotTodayISO;
                return (
                  <button
                    type="button"
                    key={quote.id}
                    className={`workflow-quote-row ${quote.id === selectedQuoteId ? "selected" : ""}`.trim()}
                    onClick={() => setSelectedQuoteId(quote.id)}
                  >
                    <span>
                      <strong>{formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" })}</strong>
                      <small>{quote.customer?.name || quote.customer?.email || "Customer"}</small>
                    </span>
                    <span className="workflow-quote-meta">
                      <em className={`readiness-tone-${itemReadiness.status.id}`}>{itemReadiness.score}%</em>
                      <small className={overdue ? "overdue" : ""}>
                        {followUp.completed ? "Complete" : fmtDueDate(followUp.dueDate)}
                      </small>
                    </span>
                  </button>
                );
              })}
            </section>

            <section className="workflow-detail">
              {!selectedQuote && quoteSummaries.length === 0 && !state.loading && (
                <div className="workflow-zero-state" data-capability-state="empty">
                  <p className="eyebrow">No workflow yet</p>
                  <h3>Create the first quote to begin follow-up</h3>
                  <p>
                    Start with the customer inquiry. QuotePilot will carry the saved quote,
                    proposal readiness, decisions, and follow-ups into this workspace.
                  </p>
                  <button
                    type="button"
                    className="cta"
                    onClick={() => onStartQuote?.()}
                    disabled={typeof onStartQuote !== "function"}
                  >
                    Start a quote
                  </button>
                </div>
              )}
              {!selectedQuote && quoteSummaries.length > 0 && <p className="muted">Select a quote to manage its workflow.</p>}
              {selectedQuote && readiness && (
                <>
                  <header
                    className="workflow-detail-head"
                    ref={detailHeadingRef}
                    tabIndex={-1}
                    aria-labelledby={`workflow-detail-${safeDomId(selectedQuote.id)}-quote workflow-detail-${safeDomId(selectedQuote.id)}-customer`}
                  >
                    <div>
                      <p className="eyebrow" id={`workflow-detail-${safeDomId(selectedQuote.id)}-quote`}>
                        {formatWorkspaceText(selectedQuote.quoteNumber, { emptyLabel: "Quote number pending" })}
                      </p>
                      <h3 id={`workflow-detail-${safeDomId(selectedQuote.id)}-customer`}>
                        {selectedQuote.customer?.name || selectedQuote.customer?.email || "Customer"}
                      </h3>
                    </div>
                    <span className={`status-badge status-${selectedQuote.status || "draft"}`}>
                      {classifyQuoteStatus(selectedQuote.status || "draft").label}
                    </span>
                  </header>

                  <section className={`readiness-panel readiness-${readiness.status.id}`}>
                    <div className="readiness-head">
                      <div>
                        <span>Proposal readiness</span>
                        <strong>{readiness.score}%</strong>
                      </div>
                      <em>{readiness.status.label}</em>
                    </div>
                    <progress max="100" value={readiness.score}>{readiness.score}%</progress>
                    {readiness.gaps.length > 0 && (
                      <div className="readiness-gaps">
                        {readiness.gaps.map((item) => <span key={item.id}>{item.label}</span>)}
                      </div>
                    )}
                  </section>

                  <section
                    className="workflow-form-section"
                    aria-labelledby={`workflow-follow-up-${safeDomId(selectedQuote.id)}-heading`}
                    aria-busy={[
                      `followup:${selectedQuote.id}`,
                      `confirm-followup:${selectedQuote.id}`
                    ].includes(busyKey)}
                    data-follow-up-record-id={`follow-up:${selectedQuote.id}`}
                    tabIndex={-1}
                  >
                    <h4 id={`workflow-follow-up-${safeDomId(selectedQuote.id)}-heading`}>Next follow-up</h4>
                    {followUpConfirmation.quoteId === selectedQuote.id
                      && followUpConfirmation.phase === "pending" && (
                      <p
                        className="source-note"
                        role={followUpConfirmation.shared ? undefined : "status"}
                        aria-live={followUpConfirmation.shared ? undefined : "polite"}
                        data-follow-up-confirmation-state="pending"
                      >
                        {followUpConfirmation.reason === "write_pending"
                          ? "Saving the internal follow-up before checking the exact same-workspace record."
                          : "Confirming completion from the exact same-workspace server record before closing this task."}
                      </p>
                    )}
                    {followUpConfirmation.quoteId === selectedQuote.id
                      && followUpConfirmation.phase === "confirmed" && (
                      <p
                        className="source-note"
                        data-follow-up-confirmation-state="confirmed"
                      >
                        Completion confirmed from the exact same-workspace server record. This confirms only the internal follow-up.
                      </p>
                    )}
                    {(
                      followUpConfirmation.quoteId === selectedQuote.id
                        && followUpConfirmation.phase === "uncertain"
                    ) || (
                      selectedFollowUpTaskJourney?.phase === "uncertain"
                      && followUpConfirmation.phase === "idle"
                    ) ? (
                      <div
                        className="warning-note"
                        role={followUpConfirmation.shared ? undefined : "alert"}
                        data-follow-up-confirmation-state="uncertain"
                      >
                        <strong>Completion needs confirmation.</strong>{" "}
                        {followUpConfirmation.reason === "connected_readback_required"
                          ? "The follow-up was saved in browser-local data, but no exact server record is available here."
                          : followUpConfirmation.reason === "existing_feedback_unresolved"
                            ? "An earlier follow-up attempt for this exact quote still needs confirmation, so no second write was sent."
                          : followUpConfirmation.reason === "feedback_contract_unavailable"
                            ? "Action feedback could not start, so the follow-up write was not sent."
                          : followUpConfirmation.reason === "firebase_write_expectation_missing"
                            ? "The exact prior connected-write details are no longer available, so this server read alone cannot close the task."
                            : followUpConfirmation.reason === "task_outcome_not_retained"
                              ? "The exact follow-up record is confirmed, but this device could not close the attached task."
                            : "The save returned, but the exact same-workspace server record did not confirm this completion."}
                        {" "}The task remains open; no customer contact, provider action, payment, or booking was inferred.
                        <div className="right-actions">
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={followUpConfirmation.reason === "feedback_contract_unavailable"
                              ? () => setFollowUpConfirmation({
                                  phase: "idle",
                                  quoteId: "",
                                  reason: "",
                                  shared: false
                                })
                              : handleRetryFollowUpConfirmation}
                            disabled={busyKey === `confirm-followup:${selectedQuote.id}`}
                          >
                            {followUpConfirmation.reason === "feedback_contract_unavailable"
                              ? "Return to save"
                              : busyKey === `confirm-followup:${selectedQuote.id}`
                              ? "Checking..."
                              : "Retry confirmation"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="workflow-form-grid">
                      <label className="field">
                        <span>Stage</span>
                        <select
                          ref={followUpStageRef}
                          value={followUpDraft.stage}
                          aria-invalid={followUpValidationField === "stage" || undefined}
                          aria-describedby={followUpValidationField === "stage"
                            ? followUpValidationErrorId
                            : undefined}
                          onChange={(event) => {
                            setFollowUpDraft((prev) => ({ ...prev, stage: event.target.value }));
                            if (followUpValidationField === "stage") {
                              setFollowUpValidationField("");
                              setState((prev) => ({ ...prev, error: "" }));
                            }
                          }}
                        >
                          {FOLLOW_UP_STAGES.map((item) => (
                            <option key={item.id} value={item.id}>{item.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Due date</span>
                        <input
                          ref={followUpDueDateRef}
                          type="date"
                          value={followUpDraft.dueDate}
                          aria-invalid={followUpValidationField === "dueDate" || undefined}
                          aria-describedby={followUpValidationField === "dueDate"
                            ? followUpValidationErrorId
                            : undefined}
                          onChange={(event) => {
                            setFollowUpDraft((prev) => ({ ...prev, dueDate: event.target.value }));
                            if (followUpValidationField === "dueDate") {
                              setFollowUpValidationField("");
                              setState((prev) => ({ ...prev, error: "" }));
                            }
                          }}
                        />
                      </label>
                      <label className="workflow-complete-toggle">
                        <input
                          type="checkbox"
                          checked={followUpDraft.completed}
                          onChange={(event) => setFollowUpDraft((prev) => ({ ...prev, completed: event.target.checked }))}
                        />
                        <span>Follow-up complete</span>
                      </label>
                      <label className="field workflow-note-field">
                        <span>Note</span>
                        <textarea
                          rows="3"
                          maxLength="1200"
                          value={followUpDraft.note}
                          onChange={(event) => setFollowUpDraft((prev) => ({ ...prev, note: event.target.value }))}
                        />
                      </label>
                    </div>
                    <div className="right-actions">
                      <button
                        type="button"
                        className="cta compact"
                        data-follow-up-save-action="true"
                        onClick={handleSaveFollowUp}
                        disabled={Boolean(busyKey)
                          || selectedFollowUpTaskJourney?.phase === "uncertain"
                          || (
                            followUpConfirmation.quoteId === selectedQuote.id
                            && followUpConfirmation.phase === "uncertain"
                          )}
                      >
                        {busyKey === `followup:${selectedQuote.id}` ? "Saving..." : "Save Follow-up"}
                      </button>
                    </div>
                  </section>

                  {isStaff && (
                    <section className="workflow-form-section">
                      <h4>Request sensitive action approval</h4>
                      <div className="workflow-approval-request">
                        <AdaptiveChoiceField
                          label="Requestable approval action"
                          options={requestableApprovalActions.map((item) => ({
                            value: item.id,
                            label: item.label
                          }))}
                          value={resolvedApprovalAction}
                          onChange={(event) => setApprovalAction(event.target.value)}
                          placeholder="Choose an approval action"
                          emptyReason="This quote has no sensitive action that can be requested in its current state."
                          recoveryAction={{
                            label: "Review quote",
                            onClick: () => handleEditQuote(selectedQuote)
                          }}
                          singleChoiceDetail="This is the only sensitive action this quote can request now."
                        />
                        {requestableApprovalActions.length > 0 && (
                          <>
                            <input
                              type="text"
                              maxLength="800"
                              placeholder="Reason or customer context"
                              value={approvalNote}
                              onChange={(event) => setApprovalNote(event.target.value)}
                            />
                            <button
                              type="button"
                              className="ghost compact"
                              onClick={handleRequestApproval}
                              disabled={!resolvedApprovalAction || busyKey === `request:${selectedQuote.id}`}
                            >
                              {busyKey === `request:${selectedQuote.id}` ? "Requesting..." : "Request"}
                            </button>
                          </>
                        )}
                      </div>
                    </section>
                  )}

                  <section className="workflow-timeline-section">
                    <h4>Lifecycle timeline</h4>
                    <ol className="workflow-timeline">
                      {timeline.map((item) => (
                        <li key={item.id} className={`timeline-${item.tone || "default"}`}>
                          <span aria-hidden="true" />
                          <div>
                            <strong>{item.label}</strong>
                            <p>{item.detail}</p>
                            <time dateTime={item.atISO}>{fmtDateTime(item.atISO)}</time>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                </>
              )}
            </section>
        </div>

        <section
          className="workflow-attention-panel"
          role="tabpanel"
          id="workflow-panel-autopilot"
          aria-labelledby="workflow-tab-autopilot"
          tabIndex={0}
          hidden={activeTab !== "autopilot"}
          data-automation-surface="read-only-preview"
        >
          <p className="workflow-attention-boundary">
            The preview below remains a bounded quote-only simulation. The operations surface separately reads server-owned policy, consent, suppression, job, conversation-attention, and provider evidence; neither surface implies a send or recovered revenue.
          </p>
          <section className="workflow-form-section" aria-labelledby="workflow-autopilot-quote-title">
            <h4 id="workflow-autopilot-quote-title">Quote snapshot</h4>
            <div className="field" data-choice-field="workflow-authoritative-quote">
              <AdaptiveChoiceField
                label="Authoritative quote"
                options={authoritativeQuoteOptions}
                value={selectedQuoteId}
                onChange={(event) => setSelectedQuoteId(event.target.value)}
                disabled={state.loading}
                placeholder="Select a quote"
                emptyState="unavailable"
                emptyReason={authoritativeQuoteSelectionStale
                  ? `The previously selected quote ${selectedQuoteId} is not in the current Workflow read.`
                  : state.loading
                    ? "The bounded Workflow quote read is still loading."
                    : "No authoritative quote is available in the bounded Workflow read."}
                recoveryAction={{ label: "Reload quotes", onClick: () => load() }}
                singleChoiceDetail="This is the only authoritative quote in the bounded Workflow read."
                fieldState={authoritativeQuoteSelectionStale ? { evidence: "stale" } : undefined}
                fieldStateDetails={authoritativeQuoteSelectionStale ? {
                  reason: "The selected quote remains visible but is not present in the current Workflow read.",
                  recoveryAction: { label: "Reload quotes", onClick: () => load() }
                } : undefined}
              />
            </div>
            <p
              className={state.truncated ? "warning-note" : "source-note"}
              data-quote-snapshot-bound={quoteSnapshotBound}
            >
              {quoteSnapshotBound === "unknown"
                ? `Awaiting the bounded Workflow quote snapshot. Each load reads at most ${WORKFLOW_TIMING_INPUT_SCAN_LIMIT} quotes.`
                : <>Source: {formatWorkspaceSource(state.source)}. This Workflow load reads at most {WORKFLOW_TIMING_INPUT_SCAN_LIMIT} quotes{state.truncated ? "; older quotes are outside this selector." : "."}</>}
            </p>
          </section>
          {revenueAutopilotRead.detail && (
            <p className="warning-note" role="status" data-autopilot-read-blocker={revenueAutopilotRead.error}>
              {revenueAutopilotRead.detail}
            </p>
          )}
          <RevenueAutopilotPreviewPanel
            preview={revenueAutopilotRead.preview}
            loading={state.loading}
            error={workflowReadError || revenueAutopilotRead.error}
            stale={Boolean(workflowReadError && revenueAutopilotRead.preview)}
          />
          <RevenueAutopilotOperations
            snapshot={revenueOperationsSnapshot}
            available={!autopilotOperations.error || Boolean(autopilotOperations.snapshot)}
            onConfigure={isAdmin ? openAutopilotConfiguration : undefined}
            onMaterialize={handleMaterializeAutopilot}
            onReconcile={handleReconcileAutopilotJob}
            onOpenConversation={handleOpenAutopilotConversation}
            onAcknowledgeReply={handleAcknowledgeAutopilotReply}
          />
          {autopilotOperations.error && (
            <p className="warning-note" role="alert">
              {autopilotOperations.error}
              <button type="button" className="ghost compact" onClick={loadRevenueAutopilotOperations}>
                Retry operations read
              </button>
            </p>
          )}
          {isAdmin && autopilotConfigurationOpen && (
            <section
              className="workflow-form-section"
              aria-labelledby="revenue-autopilot-policy-form-title"
              data-capability-id="cwf-12-revenue-autopilot-policy-form"
            >
              <div className="workspace-route-head">
                <div>
                  <p className="eyebrow">Tenant administrator</p>
                  <h3 id="revenue-autopilot-policy-form-title">Automation policy</h3>
                  <p className="muted">This records tenant intent only. Runtime and approved-provider gates remain independently dormant until configured outside this form.</p>
                </div>
              </div>
              <div className="workflow-form-grid">
                <label className="workflow-complete-toggle">
                  <input
                    type="checkbox"
                    checked={autopilotPolicyDraft.enabled}
                    onChange={(event) => setAutopilotPolicyDraft((current) => ({
                      ...current,
                      enabled: event.target.checked
                    }))}
                  />
                  <span>Enable tenant automation policy</span>
                </label>
                <label className="field">
                  <span>Tenant IANA time zone</span>
                  <input
                    value={autopilotPolicyDraft.timeZone}
                    onChange={(event) => setAutopilotPolicyDraft((current) => ({
                      ...current,
                      timeZone: event.target.value
                    }))}
                    placeholder="America/Chicago"
                  />
                </label>
                <label className="field">
                  <span>Maximum bounded attempts</span>
                  <select
                    value={autopilotPolicyDraft.maxAttempts}
                    onChange={(event) => setAutopilotPolicyDraft((current) => ({
                      ...current,
                      maxAttempts: Number(event.target.value)
                    }))}
                  >
                    {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="workflow-complete-toggle">
                  <input
                    type="checkbox"
                    checked={autopilotPolicyDraft.quietHours.enabled}
                    onChange={(event) => setAutopilotPolicyDraft((current) => ({
                      ...current,
                      quietHours: event.target.checked
                        ? { enabled: true, start: "21:00", end: "08:00" }
                        : { enabled: false, start: "", end: "" }
                    }))}
                  />
                  <span>Enforce tenant-local quiet hours</span>
                </label>
                {autopilotPolicyDraft.quietHours.enabled && (
                  <>
                    <label className="field">
                      <span>Quiet hours start</span>
                      <input
                        type="time"
                        value={autopilotPolicyDraft.quietHours.start}
                        onChange={(event) => setAutopilotPolicyDraft((current) => ({
                          ...current,
                          quietHours: { ...current.quietHours, start: event.target.value }
                        }))}
                      />
                    </label>
                    <label className="field">
                      <span>Quiet hours end</span>
                      <input
                        type="time"
                        value={autopilotPolicyDraft.quietHours.end}
                        onChange={(event) => setAutopilotPolicyDraft((current) => ({
                          ...current,
                          quietHours: { ...current.quietHours, end: event.target.value }
                        }))}
                      />
                    </label>
                  </>
                )}
              </div>
              <fieldset className="workflow-form-section">
                <legend>Governed lanes</legend>
                <div className="checklist">
                  {[
                    ["quote_follow_up", "Quote follow-ups"],
                    ["deposit_reminder", "Deposit reminders"],
                    ["final_balance_reminder", "Final-balance reminders"],
                    ["unread_customer_reply", "Unread customer-reply attention"]
                  ].map(([kind, label]) => (
                    <label className="checkrow" key={kind}>
                      <input
                        type="checkbox"
                        checked={autopilotPolicyDraft.kinds[kind]}
                        onChange={(event) => setAutopilotPolicyDraft((current) => ({
                          ...current,
                          kinds: { ...current.kinds, [kind]: event.target.checked }
                        }))}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <RevenueAutopilotReviewRequestPolicyFields
                  draft={autopilotPolicyDraft}
                  onDraftChange={setAutopilotPolicyDraft}
                />
              </fieldset>
              <div className="workflow-form-grid">
                <label className="field">
                  <span>Quote follow-up days after send</span>
                  <input
                    value={autopilotPolicyDraft.quoteFollowUpDayOffsets.join(", ")}
                    onChange={(event) => setAutopilotPolicyDraft((current) => ({
                      ...current,
                      quoteFollowUpDayOffsets: event.target.value.split(",")
                        .map((value) => Number(value.trim()))
                        .filter(Number.isSafeInteger)
                    }))}
                  />
                </label>
                <label className="field">
                  <span>Deposit reminder days after acceptance</span>
                  <input
                    value={autopilotPolicyDraft.depositReminderDayOffsets.join(", ")}
                    onChange={(event) => setAutopilotPolicyDraft((current) => ({
                      ...current,
                      depositReminderDayOffsets: event.target.value.split(",")
                        .map((value) => Number(value.trim()))
                        .filter(Number.isSafeInteger)
                    }))}
                  />
                </label>
                <label className="field">
                  <span>Final-balance event-minus windows</span>
                  <input value="14, 7, 3" readOnly />
                </label>
              </div>
              <div className="right-actions">
                <button
                  type="button"
                  className="cta compact"
                  onClick={handleSaveAutopilotPolicy}
                  disabled={autopilotPolicySaveBlocked}
                  title={!pendingAutopilotPolicyAttempt && !autopilotReviewRequestConfiguration.valid
                    ? "Configure a valid public HTTPS review destination before saving this enabled lane."
                    : undefined}
                >
                  {pendingAutopilotPolicyAttempt ? "Reconcile exact policy attempt" : "Save tenant policy"}
                </button>
                <button type="button" className="ghost compact" onClick={() => setAutopilotConfigurationOpen(false)}>
                  Cancel
                </button>
                {autopilotOperations.mutation?.state === "error" && (
                  <button
                    type="button"
                    className="ghost compact"
                    onClick={() => {
                      const pending = readPendingRevenueAutopilotPolicyAttempt({ organizationId });
                      if (resetDefinitiveRevenueAutopilotPolicyAttempt({
                        organizationId,
                        ...(pending?.requestId ? { requestId: pending.requestId } : {})
                      })) {
                        updateAutopilotMutation({ state: "recovery", error: "", receipt: null });
                      }
                    }}
                  >
                    Reset rejected policy attempt
                  </button>
                )}
              </div>
            </section>
          )}
        </section>

        <section
          className="workflow-attention-panel"
          role="tabpanel"
          id="workflow-panel-debt"
          aria-labelledby="workflow-tab-debt"
          tabIndex={0}
          hidden={activeTab !== "debt"}
        >
          <DecisionDebtPanel
            snapshot={decisionDebt.snapshot
              ? { ...decisionDebt.snapshot, policyVersion: decisionDebt.policyVersion }
              : null}
            loading={decisionDebt.loading}
            error={decisionDebt.error}
            stale={decisionDebt.stale}
            partial={decisionDebtPartial}
            mutation={decisionDebt.mutation}
            isAdmin={isAdmin}
            onRetry={loadDecisionDebt}
            onConfigurePolicy={handleConfigureDecisionDebt}
            onReconcilePolicy={handleReconcileDecisionDebt}
            onResetMutation={handleResetDecisionDebt}
            onOpenQuote={(quoteId) => {
              const quote = state.quotes.find((item) => item.id === quoteId);
              if (quote) handleOpenQuoteHistory(quote, null);
            }}
          />
        </section>

        <section
          className="approval-queue"
          aria-label="Sensitive action approval queue"
          role="tabpanel"
          id="workflow-panel-approvals"
          aria-labelledby="workflow-tab-approvals"
          tabIndex={0}
          hidden={activeTab !== "approvals"}
        >
            {approvalQueue.length === 0 && !state.loading && (
              <p className="muted">No approval requests yet.</p>
            )}
            {approvalQueue.map(({ quote, request }) => {
              const approvalDomId = `workflow-approval-${safeDomId(quote.id)}-${safeDomId(request.id)}`;
              const quoteLabel = formatWorkspaceText(quote.quoteNumber, { emptyLabel: "Quote number pending" });
              const resolvingApproval = busyKey === `resolve:${request.id}:approved`;
              const resolvingRejection = busyKey === `resolve:${request.id}:rejected`;
              const requestResolving = resolvingApproval || resolvingRejection;
              const awaitingExecution = request.state === "approved"
                && (!request.executionState || request.executionState === "awaiting_execution")
                && APPROVAL_ACTIONS.some((action) => action.id === request.action);
              const executionEligibility = awaitingExecution
                ? getApprovalRequestExecutionEligibility(quote, request, {
                  requireActivePortal: state.source === "firebase"
                })
                : null;
              return (
              <article
                key={`${quote.id}-${request.id}`}
                className={`approval-row state-${request.state}`}
                tabIndex={-1}
                data-quote-id={quote.id}
                data-request-id={request.id}
                data-pending={request.state === "pending"}
                aria-labelledby={`${approvalDomId}-action ${approvalDomId}-quote`}
              >
                <div className="approval-row-main">
                  <div>
                    <span className="approval-state">{humanizeWorkspaceValue(request.state)}</span>
                    <h3 id={`${approvalDomId}-action`}>{actionLabel(request.action)}</h3>
                    <p id={`${approvalDomId}-quote`}>{quoteLabel} · {quote.customer?.name || quote.customer?.email || "Customer"}</p>
                  </div>
                  <div className="approval-audit">
                    <span>Requested by {request.requestedByEmail || "staff"}</span>
                    <time dateTime={request.requestedAtISO}>{fmtDateTime(request.requestedAtISO)}</time>
                  </div>
                </div>
                {request.note && <p className="approval-note">{request.note}</p>}
                {request.state === "pending" && isAdmin && (
                  <div className="approval-resolution">
                    <input
                      type="text"
                      maxLength="800"
                      placeholder="Resolution note"
                      aria-label={`Resolution note for ${actionLabel(request.action)} on ${quoteLabel}`}
                      value={resolutionNotes[request.id] || ""}
                      onChange={(event) => setResolutionNotes((prev) => ({
                        ...prev,
                        [request.id]: event.target.value
                      }))}
                    />
                    <button
                      type="button"
                      className="cta compact"
                      onClick={() => handleResolveApproval(quote.id, request.id, "approved")}
                      disabled={requestResolving}
                      aria-label={resolvingApproval
                        ? `Approving... ${actionLabel(request.action)} for ${quoteLabel}`
                        : `Approve ${actionLabel(request.action)} for ${quoteLabel}`}
                      aria-busy={resolvingApproval}
                    >
                      {resolvingApproval ? "Approving..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => handleResolveApproval(quote.id, request.id, "rejected")}
                      disabled={requestResolving}
                      aria-label={resolvingRejection
                        ? `Rejecting... ${actionLabel(request.action)} for ${quoteLabel}`
                        : `Reject ${actionLabel(request.action)} for ${quoteLabel}`}
                      aria-busy={resolvingRejection}
                    >
                      {resolvingRejection ? "Rejecting..." : "Reject"}
                    </button>
                  </div>
                )}
                {request.state !== "pending" && (
                  <div className="approval-resolution-summary">
                    <strong>{approvalOutcomeLabel(request)}</strong>
                    <span>{request.resolutionNote || "No resolution note."}</span>
                    <small>{request.resolvedByEmail || "admin"} · {fmtDateTime(request.resolvedAtISO)}</small>
                    {request.executionState && (
                      <small>
                        {request.executedByEmail || "admin"}
                        {request.executionCompletedAtISO
                          ? ` · ${fmtDateTime(request.executionCompletedAtISO)}`
                          : request.executionStartedAtISO
                            ? ` · started ${fmtDateTime(request.executionStartedAtISO)}`
                            : ""}
                      </small>
                    )}
                    {request.executionReference && <span>{request.executionReference}</span>}
                    {request.executionError && <span>{request.executionError}</span>}
                    {isAdmin && awaitingExecution && (
                      executionEligibility?.eligible ? (
                        <button
                          type="button"
                          className="cta compact"
                          onClick={() => handleOpenQuoteHistory(quote, request)}
                        >
                          Execute in Quotes
                        </button>
                      ) : (
                        <p className="muted approval-not-executable" role="status">
                          No longer executable: {executionEligibility?.reason || "the quote changed after approval."}
                        </p>
                      )
                    )}
                  </div>
                )}
              </article>
              );
            })}
        </section>
      </div>
    </div>
  );
}

export default function SalesWorkflowModal(props) {
  return <SalesWorkflowView {...props} presentation="modal" />;
}
