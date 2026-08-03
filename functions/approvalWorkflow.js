const APPROVAL_ACTIONS = new Set([
  "send_payment_request",
  "convert_to_contract",
  "rotate_portal_link",
  "delete_quote"
]);
const APPROVAL_RESOLUTION_STATES = new Set(["approved", "rejected"]);
const MAX_APPROVAL_NOTE_LENGTH = 800;
const MAX_APPROVAL_REQUESTS = 50;

class ApprovalWorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApprovalWorkflowError";
    this.code = code;
  }
}

function text(value) {
  return String(value || "").trim();
}

function email(value) {
  return text(value).toLowerCase();
}

function approvalRequestsFromWorkflow(workflow) {
  const requests = workflow && typeof workflow === "object"
    ? workflow.approvalRequests
    : [];
  if (requests === undefined) return [];
  if (!Array.isArray(requests)) {
    throw new ApprovalWorkflowError(
      "failed-precondition",
      "Quote approval history is invalid and cannot be changed safely."
    );
  }
  return requests;
}

function buildApprovalRequest({
  workflow = {},
  action = "",
  note = "",
  actorEmail = "",
  nowISO = "",
  requestId = ""
} = {}) {
  const normalizedAction = text(action);
  const normalizedActorEmail = email(actorEmail);
  const normalizedNowISO = text(nowISO);
  const normalizedRequestId = text(requestId);
  if (!APPROVAL_ACTIONS.has(normalizedAction)) {
    throw new ApprovalWorkflowError("invalid-argument", "Invalid approval action.");
  }
  if (!normalizedActorEmail || !normalizedNowISO || !normalizedRequestId) {
    throw new ApprovalWorkflowError(
      "failed-precondition",
      "Approval audit identity and server timestamp are required."
    );
  }

  const current = approvalRequestsFromWorkflow(workflow);
  if (current.length >= MAX_APPROVAL_REQUESTS) {
    throw new ApprovalWorkflowError(
      "resource-exhausted",
      "Quote approval history is full. Archive or duplicate the quote before requesting another approval."
    );
  }
  if (current.some((item) => (
    text(item?.action) === normalizedAction
    && text(item?.state).toLowerCase() === "pending"
  ))) {
    throw new ApprovalWorkflowError(
      "already-exists",
      "A pending approval request already exists for this action."
    );
  }

  const request = {
    id: normalizedRequestId,
    action: normalizedAction,
    state: "pending",
    note: text(note).slice(0, MAX_APPROVAL_NOTE_LENGTH),
    requestedAtISO: normalizedNowISO,
    requestedByEmail: normalizedActorEmail,
    resolvedAtISO: "",
    resolvedByEmail: "",
    resolutionNote: ""
  };
  return {
    request,
    approvalRequests: [...current, request]
  };
}

function buildApprovalResolution({
  workflow = {},
  requestId = "",
  state = "",
  resolutionNote = "",
  actorEmail = "",
  nowISO = ""
} = {}) {
  const normalizedRequestId = text(requestId);
  const normalizedState = text(state).toLowerCase();
  const normalizedActorEmail = email(actorEmail);
  const normalizedNowISO = text(nowISO);
  if (!normalizedRequestId) {
    throw new ApprovalWorkflowError("invalid-argument", "Approval request id is required.");
  }
  if (!APPROVAL_RESOLUTION_STATES.has(normalizedState)) {
    throw new ApprovalWorkflowError(
      "invalid-argument",
      "Approval resolution must be approved or rejected."
    );
  }
  if (!normalizedActorEmail || !normalizedNowISO) {
    throw new ApprovalWorkflowError(
      "failed-precondition",
      "Approval audit identity and server timestamp are required."
    );
  }

  const current = approvalRequestsFromWorkflow(workflow);
  const target = current.find((item) => text(item?.id) === normalizedRequestId);
  if (!target) {
    throw new ApprovalWorkflowError("not-found", "Approval request not found.");
  }
  if (text(target.state).toLowerCase() !== "pending") {
    throw new ApprovalWorkflowError(
      "failed-precondition",
      "Approval request is already resolved."
    );
  }

  const request = {
    ...target,
    state: normalizedState,
    resolvedAtISO: normalizedNowISO,
    resolvedByEmail: normalizedActorEmail,
    resolutionNote: text(resolutionNote).slice(0, MAX_APPROVAL_NOTE_LENGTH)
  };
  return {
    request,
    approvalRequests: current.map((item) => (
      text(item?.id) === normalizedRequestId ? request : item
    ))
  };
}

module.exports = {
  APPROVAL_ACTIONS,
  APPROVAL_RESOLUTION_STATES,
  ApprovalWorkflowError,
  buildApprovalRequest,
  buildApprovalResolution
};
