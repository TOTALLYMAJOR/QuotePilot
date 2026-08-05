const APPROVAL_ACTIONS = new Set([
  "send_payment_request",
  "convert_to_contract",
  "rotate_portal_link",
  "delete_quote"
]);
const APPROVAL_RESOLUTION_STATES = new Set(["approved", "rejected"]);
const APPROVAL_EXECUTION_STATES = new Set([
  "awaiting_execution",
  "in_progress",
  "succeeded",
  "failed"
]);
const MAX_APPROVAL_NOTE_LENGTH = 800;
const MAX_APPROVAL_EXECUTION_DETAIL_LENGTH = 500;
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

function normalizeRequestId(value) {
  const normalized = text(value);
  return /^[A-Za-z0-9_-]{1,160}$/.test(normalized) ? normalized : "";
}

function executionFields({
  state = "",
  startedAtISO = "",
  completedAtISO = "",
  actorEmail = "",
  operationId = "",
  reference = "",
  error = ""
} = {}) {
  const normalizedState = text(state).toLowerCase();
  return {
    executionState: APPROVAL_EXECUTION_STATES.has(normalizedState) ? normalizedState : "",
    executionStartedAtISO: text(startedAtISO),
    executionCompletedAtISO: text(completedAtISO),
    executedByEmail: email(actorEmail),
    executionOperationId: normalizeRequestId(operationId),
    executionReference: text(reference).slice(0, MAX_APPROVAL_EXECUTION_DETAIL_LENGTH),
    executionError: text(error).slice(0, MAX_APPROVAL_EXECUTION_DETAIL_LENGTH)
  };
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
  const normalizedRequestId = normalizeRequestId(requestId);
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
  if (current.some((item) => {
    if (text(item?.action) !== normalizedAction) return false;
    const state = text(item?.state).toLowerCase();
    const executionState = text(item?.executionState).toLowerCase();
    return state === "pending"
      || (
        state === "approved"
        && !new Set(["succeeded", "failed"]).has(executionState)
      );
  })) {
    throw new ApprovalWorkflowError(
      "already-exists",
      "An unresolved or unexecuted approval request already exists for this action."
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
    resolutionNote: "",
    ...executionFields()
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
  const normalizedRequestId = normalizeRequestId(requestId);
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
    resolutionNote: text(resolutionNote).slice(0, MAX_APPROVAL_NOTE_LENGTH),
    ...executionFields({
      state: normalizedState === "approved" ? "awaiting_execution" : ""
    })
  };
  return {
    request,
    approvalRequests: current.map((item) => (
      text(item?.id) === normalizedRequestId ? request : item
    ))
  };
}

function findApprovalRequest(workflow, normalizedRequestId) {
  const current = approvalRequestsFromWorkflow(workflow);
  const target = current.find((item) => normalizeRequestId(item?.id) === normalizedRequestId);
  if (!target) {
    throw new ApprovalWorkflowError("not-found", "Approval request not found.");
  }
  return { current, target };
}

function validateApprovalExecutionInput({
  requestId: rawRequestId,
  action,
  actorEmail,
  nowISO,
  operationId
} = {}) {
  const normalizedRequestId = normalizeRequestId(rawRequestId);
  const normalizedAction = text(action);
  const normalizedActorEmail = email(actorEmail);
  const normalizedNowISO = text(nowISO);
  const normalizedOperationId = normalizeRequestId(operationId);
  if (!normalizedRequestId || !APPROVAL_ACTIONS.has(normalizedAction)) {
    throw new ApprovalWorkflowError(
      "invalid-argument",
      "A valid approval request id and action are required."
    );
  }
  if (!normalizedActorEmail || !normalizedNowISO || !normalizedOperationId) {
    throw new ApprovalWorkflowError(
      "failed-precondition",
      "Approval execution requires server-owned identity, time, and operation id."
    );
  }
  return {
    normalizedRequestId,
    normalizedAction,
    normalizedActorEmail,
    normalizedNowISO,
    normalizedOperationId
  };
}

function assertApprovedAction(target, action) {
  if (text(target?.action) !== action) {
    throw new ApprovalWorkflowError(
      "permission-denied",
      "Approval request does not authorize this action."
    );
  }
  if (text(target?.state).toLowerCase() !== "approved") {
    throw new ApprovalWorkflowError(
      "failed-precondition",
      "Approval request must be approved before execution."
    );
  }
}

function buildApprovalExecutionStart({
  workflow = {},
  requestId: rawRequestId = "",
  action = "",
  actorEmail = "",
  nowISO = "",
  operationId = ""
} = {}) {
  const validated = validateApprovalExecutionInput({
    requestId: rawRequestId,
    action,
    actorEmail,
    nowISO,
    operationId
  });
  const { current, target } = findApprovalRequest(
    workflow,
    validated.normalizedRequestId
  );
  assertApprovedAction(target, validated.normalizedAction);

  const currentExecutionState = text(target.executionState).toLowerCase()
    || "awaiting_execution";
  if (currentExecutionState === "in_progress") {
    if (
      normalizeRequestId(target.executionOperationId) === validated.normalizedOperationId
      && email(target.executedByEmail) === validated.normalizedActorEmail
    ) {
      return {
        request: target,
        approvalRequests: current,
        resumed: true
      };
    }
    throw new ApprovalWorkflowError(
      "aborted",
      "Approval execution is already in progress."
    );
  }
  if (currentExecutionState === "succeeded") {
    throw new ApprovalWorkflowError(
      "already-exists",
      "Approval request has already been executed."
    );
  }
  if (currentExecutionState === "failed") {
    throw new ApprovalWorkflowError(
      "failed-precondition",
      "Failed approval executions require a new approval request."
    );
  }
  if (currentExecutionState !== "awaiting_execution") {
    throw new ApprovalWorkflowError(
      "failed-precondition",
      "Approval execution state is invalid."
    );
  }

  const request = {
    ...target,
    ...executionFields({
      state: "in_progress",
      startedAtISO: validated.normalizedNowISO,
      actorEmail: validated.normalizedActorEmail,
      operationId: validated.normalizedOperationId
    })
  };
  return {
    request,
    approvalRequests: current.map((item) => (
      normalizeRequestId(item?.id) === validated.normalizedRequestId ? request : item
    )),
    resumed: false
  };
}

function buildApprovalExecutionOutcome({
  workflow = {},
  requestId: rawRequestId = "",
  action = "",
  actorEmail = "",
  nowISO = "",
  operationId = "",
  state = "",
  reference = "",
  error = ""
} = {}) {
  const validated = validateApprovalExecutionInput({
    requestId: rawRequestId,
    action,
    actorEmail,
    nowISO,
    operationId
  });
  const normalizedState = text(state).toLowerCase();
  if (!new Set(["succeeded", "failed"]).has(normalizedState)) {
    throw new ApprovalWorkflowError(
      "invalid-argument",
      "Approval execution outcome must be succeeded or failed."
    );
  }
  const { current, target } = findApprovalRequest(
    workflow,
    validated.normalizedRequestId
  );
  assertApprovedAction(target, validated.normalizedAction);

  const currentExecutionState = text(target.executionState).toLowerCase();
  if (
    currentExecutionState === normalizedState
    && normalizeRequestId(target.executionOperationId) === validated.normalizedOperationId
  ) {
    return {
      request: target,
      approvalRequests: current,
      idempotent: true
    };
  }
  if (
    currentExecutionState !== "in_progress"
    || normalizeRequestId(target.executionOperationId) !== validated.normalizedOperationId
    || email(target.executedByEmail) !== validated.normalizedActorEmail
  ) {
    throw new ApprovalWorkflowError(
      "failed-precondition",
      "Approval execution was not started by this server operation."
    );
  }

  const request = {
    ...target,
    ...executionFields({
      state: normalizedState,
      startedAtISO: target.executionStartedAtISO,
      completedAtISO: validated.normalizedNowISO,
      actorEmail: validated.normalizedActorEmail,
      operationId: validated.normalizedOperationId,
      reference: normalizedState === "succeeded" ? reference : "",
      error: normalizedState === "failed" ? error : ""
    })
  };
  return {
    request,
    approvalRequests: current.map((item) => (
      normalizeRequestId(item?.id) === validated.normalizedRequestId ? request : item
    )),
    idempotent: false
  };
}

module.exports = {
  APPROVAL_ACTIONS,
  APPROVAL_EXECUTION_STATES,
  APPROVAL_RESOLUTION_STATES,
  ApprovalWorkflowError,
  buildApprovalExecutionOutcome,
  buildApprovalExecutionStart,
  buildApprovalRequest,
  buildApprovalResolution
};
