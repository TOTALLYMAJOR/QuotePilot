import "./workspaceTaskJourneyNotice.css";
import { WORKSPACE_ROUTE_IDS } from "../lib/workspaceRoutes";

const TASK_LABELS = Object.freeze({
  review_follow_up: "Follow-up",
  review_customer_request: "Customer request",
  review_decision_debt: "Decision review",
  review_customer_reply: "Customer reply",
  review_approval: "Approval",
  review_opportunity: "Opportunity review",
  review_proposal_gap: "Proposal review",
  review_conversation: "Conversation review",
  review_client: "Client review"
});

const DESTINATION_LABELS = Object.freeze({
  client: "Client 360",
  opportunity: "Living Opportunity",
  administration: "Quote administration",
  workflow: "Workflow",
  approval: "Workflow",
  messages: "Messages",
  schedule: "Schedule",
  reporting: "Reporting",
  library: "Library"
});

const DESTINATION_ROUTE_IDS = Object.freeze({
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

const PHASE_LABELS = Object.freeze({
  in_progress: "In progress",
  resolved: "Completed",
  uncertain: "Needs confirmation",
  cancelled: "Tracking stopped",
  superseded: "Updated elsewhere"
});

export function buildWorkspaceTaskJourneyPresentation(journey, currentRouteId = "") {
  if (!journey || journey.phase === "cancelled") return null;
  const taskLabel = TASK_LABELS[journey.intentId] || "Workspace task";
  const destinationLabel = DESTINATION_LABELS[journey.destination] || "workspace destination";
  const phaseLabel = PHASE_LABELS[journey.phase] || PHASE_LABELS.in_progress;
  const destinationRouteId = DESTINATION_ROUTE_IDS[journey.destination] || "";
  const atDestination = Boolean(destinationRouteId)
    && String(currentRouteId || "") === destinationRouteId;

  let context = `Continue to the exact ${destinationLabel} context.`;
  if (journey.phase === "resolved") {
    context = "Outcome confirmed by an authoritative same-workspace readback.";
  } else if (journey.phase === "uncertain") {
    context = "Outcome not confirmed. Keep this task attached and reconcile before retrying.";
  } else if (journey.phase === "superseded") {
    context = "Newer authoritative evidence replaced the task that was opened on this device.";
  } else if (journey.contextState === "locating") {
    context = `Finding the exact ${destinationLabel}. No business record has changed.`;
  } else if (journey.contextState === "ready") {
    context = `Exact ${destinationLabel} context ready. Completion still requires authoritative confirmation.`;
  } else if (journey.contextState === "recovery") {
    context = `Exact ${destinationLabel} unavailable. No substitute opened; the task remains in progress.`;
  }

  return Object.freeze({
    taskLabel,
    destinationLabel,
    phaseLabel,
    context,
    atDestination,
    canContinue: journey.phase === "in_progress"
      && (!atDestination || journey.contextState === "recovery"),
    canStopTracking: ["in_progress", "uncertain", "superseded"].includes(journey.phase)
  });
}

export default function WorkspaceTaskJourneyNotice({
  journey,
  currentRouteId = "",
  onContinue,
  onStopTracking
}) {
  const presentation = buildWorkspaceTaskJourneyPresentation(journey, currentRouteId);
  if (!presentation) return null;

  return (
    <section
      className="workspace-task-journey"
      role="region"
      aria-label={`Current task: ${presentation.taskLabel}, ${presentation.phaseLabel}`}
      data-surface-purpose="clarify advance resolve"
      data-workspace-task-id={journey.taskId}
      data-workspace-task-state={journey.phase}
      data-workspace-task-context={journey.contextState}
    >
      <div className="workspace-task-journey__identity">
        <span className="workspace-task-journey__eyebrow">Current task</span>
        <strong>{presentation.taskLabel}</strong>
        <span className="workspace-task-journey__state">{presentation.phaseLabel}</span>
      </div>
      <p>{presentation.context}</p>
      {(presentation.canContinue || presentation.canStopTracking) && (
        <div
          className="workspace-task-journey__actions"
          role="group"
          aria-label={`${presentation.taskLabel} task controls`}
          data-layout-audit-group="workspace-task-controls"
        >
          {presentation.canContinue && typeof onContinue === "function" && (
            <button type="button" className="ghost compact" onClick={onContinue}>
              Continue
            </button>
          )}
          {presentation.canStopTracking && typeof onStopTracking === "function" && (
            <button type="button" className="ghost compact" onClick={onStopTracking}>
              Stop tracking
            </button>
          )}
        </div>
      )}
    </section>
  );
}
