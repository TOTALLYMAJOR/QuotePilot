import { useRef } from "react";
import "./workspaceActionFeedbackNotice.css";
import { createWorkspaceArrivalHandoff } from "../lib/workspaceArrivalContract";

const PHASE_PRESENTATIONS = Object.freeze({
  pending: Object.freeze({
    label: "In progress",
    defaultMessage: "This change is still in progress."
  }),
  succeeded: Object.freeze({
    label: "Confirmed",
    defaultMessage: "The requested change is confirmed."
  }),
  recovery: Object.freeze({
    label: "Needs attention",
    defaultMessage: "This action needs attention. Review what changed and what stayed the same before continuing."
  }),
  uncertain: Object.freeze({
    label: "Needs confirmation",
    defaultMessage: "The outcome could not be confirmed. Reconcile this record before trying again."
  }),
  cancelled: Object.freeze({
    label: "Cancelled",
    defaultMessage: "The change was cancelled before completion."
  })
});

const EVIDENCE_PRESENTATIONS = Object.freeze({
  authoritative_readback: "Confirmed by an authoritative readback.",
  authoritative_receipt: "Confirmed by an authoritative receipt.",
  authoritative_confirmation: "Confirmed by the owning service.",
  browser_local_readback: "Confirmed by a browser-local readback; this is not hosted evidence."
});

const FOLLOW_UP_ACTION_ID = "complete-follow-up";
const FOLLOW_UP_OBJECT_KIND = "workflow-item";
const FOLLOW_UP_OBJECT_PREFIX = "follow-up:";
const APPROVAL_ACTION_ID = "resolve-approval";
const APPROVAL_OBJECT_KIND = "approval";
const CANONICAL_INSTANT_SUFFIX = /^(?<taskId>.+):(?<startedAtISO>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/u;

function boundedText(value, maximumLength = 180) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maximumLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maximumLength - 1)).trimEnd()}…`;
}

function humanizeIdentifier(value, fallback) {
  const normalized = boundedText(value, 120);
  if (!normalized) return fallback;
  const words = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function normalizeFact(fact) {
  if (typeof fact === "string" || typeof fact === "number") {
    return boundedText(fact);
  }
  if (!fact || typeof fact !== "object") return "";

  const label = boundedText(fact.label ?? fact.name, 80);
  const value = boundedText(fact.value ?? fact.detail ?? fact.summary);
  if (label && value) return `${label}: ${value}`;
  return label || value;
}

function normalizeFacts(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.map(normalizeFact).filter(Boolean));
}

function normalizeNextAction(value) {
  if (!value || typeof value !== "object") return null;
  const label = boundedText(value.label, 80);
  if (!label) return null;
  return Object.freeze({
    ...value,
    label
  });
}

function getEvidenceText(phase, evidence) {
  if (phase !== "succeeded" || !evidence || typeof evidence !== "object") return "";
  if (!boundedText(evidence.id, 160) || !boundedText(evidence.source, 160)) return "";
  return EVIDENCE_PRESENTATIONS[evidence.kind] || "";
}

/**
 * Recovers only the bounded Workflow destination encoded by the follow-up
 * feedback adapter. The returned identity is presentation/navigation context;
 * it grants no mutation or task-persistence authority.
 */
export function buildWorkspaceActionFeedbackFollowUpIdentity(feedback) {
  if (!feedback || typeof feedback !== "object") return null;
  if (feedback.actionId !== FOLLOW_UP_ACTION_ID) return null;
  if (feedback.object?.kind !== FOLLOW_UP_OBJECT_KIND) return null;

  const requestId = boundedText(feedback.object?.id, 160);
  if (!requestId.startsWith(FOLLOW_UP_OBJECT_PREFIX)) return null;
  const quoteId = requestId.slice(FOLLOW_UP_OBJECT_PREFIX.length);
  if (!quoteId || requestId !== `${FOLLOW_UP_OBJECT_PREFIX}${quoteId}`) return null;

  const generation = boundedText(feedback.generation, 320);
  const generationMatch = generation.match(CANONICAL_INSTANT_SUFFIX);
  const taskId = generationMatch?.groups?.taskId || "";
  const startedAtISO = generationMatch?.groups?.startedAtISO || "";
  const startedAt = Date.parse(startedAtISO);
  if (
    !taskId
    || !taskId.endsWith(`:${requestId}`)
    || !startedAtISO
    || !Number.isFinite(startedAt)
    || new Date(startedAt).toISOString() !== startedAtISO
  ) {
    return null;
  }

  return Object.freeze({
    actionId: FOLLOW_UP_ACTION_ID,
    generation,
    taskId,
    startedAtISO,
    destination: "workflow",
    object: Object.freeze({ id: requestId, type: FOLLOW_UP_OBJECT_KIND }),
    focus: Object.freeze({
      quoteId,
      attentionType: "follow_up",
      requestId
    }),
    intentId: "review_follow_up"
  });
}

/** Exact active-task fence for a feedback-owned follow-up destination. */
export function workspaceActionFeedbackMatchesTaskJourney(feedback, journey) {
  const identity = buildWorkspaceActionFeedbackFollowUpIdentity(feedback);
  if (!identity || !journey || typeof journey !== "object") return false;
  return feedback.actionId === identity.actionId
    && feedback.object?.kind === FOLLOW_UP_OBJECT_KIND
    && feedback.object?.id === identity.object.id
    && feedback.generation === `${journey.taskId}:${journey.startedAtISO}`
    && journey.taskId === identity.taskId
    && journey.startedAtISO === identity.startedAtISO
    && journey.destination === identity.destination
    && journey.object?.type === identity.object.type
    && journey.object?.id === identity.object.id
    && journey.intentId === identity.intentId
    && journey.focus?.quoteId === identity.focus.quoteId
    && journey.focus?.attentionType === identity.focus.attentionType
    && journey.focus?.requestId === identity.focus.requestId;
}

/**
 * Chooses between continuing the exact owning task and an independent,
 * feedback-owned return. A newer task never gains ownership of the older
 * attempt and is never modified by this presentation-only navigation choice.
 */
export function resolveWorkspaceActionFeedbackFollowUpAction({
  feedback,
  nextActionId = "",
  activeTaskJourney = null
} = {}) {
  const selectedNextActionId = String(
    nextActionId || feedback?.nextAction?.id || ""
  ).trim();
  const identity = buildWorkspaceActionFeedbackFollowUpIdentity(feedback);
  if (
    !identity
    || !["inspect", "reconcile"].includes(selectedNextActionId)
    || feedback?.nextAction?.id !== selectedNextActionId
  ) {
    return Object.freeze({
      ok: false,
      status: "recovery",
      reason: "unsafe_feedback_destination"
    });
  }
  if (
    activeTaskJourney
    && workspaceActionFeedbackMatchesTaskJourney(feedback, activeTaskJourney)
  ) {
    return Object.freeze({ ok: true, strategy: "continue", identity });
  }
  const handoff = createWorkspaceArrivalHandoff({
    destination: identity.destination,
    object: identity.object,
    focus: identity.focus,
    intentId: identity.intentId
  });
  if (!handoff.ok) {
    return Object.freeze({
      ok: false,
      status: "recovery",
      ...handoff.recovery
    });
  }
  return Object.freeze({
    ok: true,
    strategy: "navigate",
    identity,
    navigation: handoff.navigation
  });
}

/** Exact active-task fence for one approval mutation attempt. */
export function workspaceActionFeedbackMatchesApprovalTaskJourney(feedback, journey) {
  if (!feedback || !journey || typeof journey !== "object") return false;
  const requestId = boundedText(feedback.object?.id, 160);
  const generation = boundedText(feedback.generation, 320);
  const match = generation.match(CANONICAL_INSTANT_SUFFIX);
  return Boolean(
    requestId
    && feedback.actionId === APPROVAL_ACTION_ID
    && feedback.object?.kind === APPROVAL_OBJECT_KIND
    && match?.groups?.taskId === journey.taskId
    && match?.groups?.startedAtISO === journey.startedAtISO
    && generation === `${journey.taskId}:${journey.startedAtISO}`
    && journey.taskId === `review-workflow:${requestId}`
    && journey.destination === "approval"
    && journey.intentId === "review_approval"
    && journey.object?.type === APPROVAL_OBJECT_KIND
    && journey.object?.id === requestId
    && journey.focus?.requestId === requestId
    && boundedText(journey.focus?.quoteId, 160)
  );
}

/**
 * Approval uncertainty may only continue the exact active task. It deliberately
 * has no independent generic navigation fallback because quote identity is not
 * encoded in the feedback object and must never be guessed.
 */
export function resolveWorkspaceActionFeedbackApprovalAction({
  feedback,
  nextActionId = "",
  activeTaskJourney = null
} = {}) {
  const selectedNextActionId = String(
    nextActionId || feedback?.nextAction?.id || ""
  ).trim();
  if (
    !["inspect", "reconcile"].includes(selectedNextActionId)
    || feedback?.nextAction?.id !== selectedNextActionId
    || !workspaceActionFeedbackMatchesApprovalTaskJourney(feedback, activeTaskJourney)
  ) {
    return Object.freeze({
      ok: false,
      status: "recovery",
      reason: "unsafe_feedback_destination"
    });
  }
  return Object.freeze({ ok: true, strategy: "continue" });
}

/**
 * Converts a scoped feedback record into UI-only copy and controls.
 *
 * The builder deliberately refuses records without exact action, attempt, and
 * object identities. A generic acknowledgement is more dangerous than no
 * acknowledgement because it can appear attached to the wrong staff task.
 */
export function buildWorkspaceActionFeedbackPresentation(feedback) {
  if (!feedback || typeof feedback !== "object") return null;

  const phase = boundedText(feedback.phase, 32);
  const phasePresentation = PHASE_PRESENTATIONS[phase];
  if (!phasePresentation) return null;

  const affectedObject = feedback.object || feedback.affectedObject || {};
  const actionId = boundedText(feedback.actionId ?? feedback.action?.id, 120);
  const attemptId = boundedText(feedback.attemptId, 160);
  const objectKind = boundedText(affectedObject.kind ?? feedback.objectKind, 80);
  const objectId = boundedText(affectedObject.id ?? feedback.objectId, 160);
  if (!actionId || !attemptId || !objectKind || !objectId) return null;

  const actionLabel = boundedText(
    feedback.actionLabel ?? feedback.action?.label,
    120
  ) || humanizeIdentifier(actionId, "Action");
  const objectLabel = boundedText(
    affectedObject.label ?? affectedObject.name ?? feedback.objectLabel,
    160
  ) || `${humanizeIdentifier(objectKind, "Record")} ${objectId}`;
  const message = boundedText(feedback.message, 260) || phasePresentation.defaultMessage;
  const changedFacts = normalizeFacts(feedback.changed ?? feedback.changedFacts);
  const unchangedFacts = normalizeFacts(feedback.unchanged ?? feedback.unchangedFacts);
  const evidenceText = getEvidenceText(phase, feedback.evidence);
  const nextAction = phase === "pending" ? null : normalizeNextAction(feedback.nextAction);
  const allowsFallbackDismiss = phase === "succeeded" || phase === "cancelled";
  const action = phase === "pending"
    ? null
    : Object.freeze(nextAction
      ? { kind: "next", label: nextAction.label, value: nextAction }
      : allowsFallbackDismiss
        ? { kind: "dismiss", label: "Dismiss", value: null }
        : null);

  return Object.freeze({
    phase,
    phaseLabel: phasePresentation.label,
    actionId,
    actionLabel,
    attemptId,
    objectKind,
    objectId,
    objectLabel,
    accessibleName: `${actionLabel} feedback for ${objectLabel}: ${phasePresentation.label}`,
    message,
    changedFacts,
    unchangedFacts,
    evidenceText,
    action
  });
}

/**
 * Canonical user-visible mutation state for governance and acceptance checks.
 * The mapping describes only the feedback presentation; it never upgrades the
 * authority or evidence carried by the underlying action record.
 */
export function workspaceActionFeedbackCapabilityState(feedback) {
  if (!feedback) return "ready";
  if (feedback.phase === "pending") {
    return feedback.mode === "reconcile" ? "reconciliation" : "submitting";
  }
  if (feedback.phase === "uncertain") return "uncertain";
  if (["succeeded", "cancelled"].includes(feedback.phase)) return "receipt";
  if (feedback.phase === "recovery") return "error";
  return "ready";
}

export function WorkspaceActionFeedbackAnnouncer({ announcement, feedback }) {
  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="workspace-action-feedback-announcer"
      data-action-feedback-announcement-id={announcement?.id || ""}
      data-capability-state={feedback ? undefined : "ready"}
    >
      {announcement?.text || ""}
    </div>
  );
}

function FeedbackFacts({ label, facts }) {
  if (!facts.length) return null;
  return (
    <div className="workspace-action-feedback__fact-group">
      <dt>{label}</dt>
      <dd>
        <ul>
          {facts.map((fact, index) => <li key={`${label}-${index}`}>{fact}</li>)}
        </ul>
      </dd>
    </div>
  );
}

export default function WorkspaceActionFeedbackNotice({
  feedback,
  onNextAction,
  onAcknowledge,
  nextActionResolved = false
}) {
  const feedbackRegionRef = useRef(null);
  const previousFocusRef = useRef(null);
  const presentation = buildWorkspaceActionFeedbackPresentation(feedback);
  if (!presentation) return null;

  // Once the exact destination is visibly resolved, an uncertain outcome is
  // reconciled by its local readback control. A terminal recovery may be
  // dismissed, but only after that exact navigation/focus resolution.
  const visibleAction = presentation.action?.kind === "next" && nextActionResolved
    ? presentation.phase === "recovery"
      ? { kind: "dismiss", label: "Dismiss", value: null }
      : null
    : presentation.action;

  const handleAction = () => {
    if (visibleAction?.kind === "next") {
      onNextAction?.(visibleAction.value, feedback);
      return;
    }
    if (visibleAction?.kind === "dismiss") {
      const ownerDocument = feedbackRegionRef.current?.ownerDocument;
      const previousFocus = previousFocusRef.current;
      const retainedPreviousFocus = previousFocus?.isConnected ? previousFocus : null;
      const activeWorkspaceControl = ownerDocument?.querySelector(
        'nav[aria-label="Primary workspace"] [aria-current="page"], '
        + 'nav[aria-label="Primary workspace"] .nav-view-active, '
        + 'nav[aria-label="Primary workspace"] button, '
        + 'nav[aria-label="Primary workspace"] a[href]'
      );
      const workspaceMain = ownerDocument?.querySelector(
        "main h1, main [data-workspace-focus-target], main"
      );
      const focusTarget = retainedPreviousFocus || activeWorkspaceControl || workspaceMain;
      const result = onAcknowledge?.(feedback);
      if (result?.ok === false || !ownerDocument) return;
      if (!focusTarget || typeof focusTarget.focus !== "function") return;
      if (!focusTarget.hasAttribute("tabindex") && !focusTarget.matches(
        "button, a[href], input, select, textarea, [contenteditable]"
      )) {
        focusTarget.setAttribute("tabindex", "-1");
      }
      focusTarget.focus({ preventScroll: true });
    }
  };

  const rememberCurrentFocus = () => {
    const region = feedbackRegionRef.current;
    const activeElement = region?.ownerDocument?.activeElement;
    if (
      activeElement
      && activeElement !== region.ownerDocument.body
      && !region.contains(activeElement)
    ) {
      previousFocusRef.current = activeElement;
    }
  };

  return (
    <section
      ref={feedbackRegionRef}
      className="workspace-action-feedback"
      role="region"
      tabIndex={-1}
      aria-label={presentation.accessibleName}
      aria-busy={presentation.phase === "pending" ? "true" : undefined}
      data-testid="workspace-action-feedback"
      data-surface-purpose="clarify resolve"
      data-action-feedback-phase={presentation.phase}
      data-action-feedback-action-id={presentation.actionId}
      data-action-feedback-attempt-id={presentation.attemptId}
      data-action-feedback-generation={feedback.generation || ""}
      data-action-feedback-object-kind={presentation.objectKind}
      data-action-feedback-object-id={presentation.objectId}
      data-capability-state={workspaceActionFeedbackCapabilityState(feedback)}
      onPointerDownCapture={rememberCurrentFocus}
      onFocusCapture={(event) => {
        const previous = event.relatedTarget;
        if (
          previous
          && previous !== event.currentTarget.ownerDocument.body
          && !event.currentTarget.contains(previous)
        ) {
          previousFocusRef.current = previous;
        }
      }}
    >
      <header className="workspace-action-feedback__identity">
        <span className="workspace-action-feedback__eyebrow">Action feedback</span>
        <strong>{presentation.actionLabel}</strong>
        <span className="workspace-action-feedback__state">{presentation.phaseLabel}</span>
        <span className="workspace-action-feedback__object">{presentation.objectLabel}</span>
      </header>

      <div className="workspace-action-feedback__body">
        <p className="workspace-action-feedback__message">{presentation.message}</p>
        {(presentation.changedFacts.length > 0 || presentation.unchangedFacts.length > 0) && (
          <dl className="workspace-action-feedback__facts">
            <FeedbackFacts label="Changed" facts={presentation.changedFacts} />
            <FeedbackFacts label="Unchanged" facts={presentation.unchangedFacts} />
          </dl>
        )}
        {presentation.evidenceText && (
          <p className="workspace-action-feedback__evidence">{presentation.evidenceText}</p>
        )}
      </div>

      {visibleAction && (
        <div
          className="workspace-action-feedback__actions"
          role="group"
          aria-label={`${presentation.actionLabel} feedback control`}
          data-layout-audit-group="workspace-action-feedback-control"
        >
          <button
            type="button"
            className="ghost compact"
            data-capability-state={visibleAction.kind === "next" ? "recovery" : undefined}
            onClick={handleAction}
            disabled={visibleAction.kind === "next"
              ? typeof onNextAction !== "function"
              : typeof onAcknowledge !== "function"}
          >
            {visibleAction.label}
          </button>
        </div>
      )}
    </section>
  );
}
