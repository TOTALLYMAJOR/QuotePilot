import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  ApprovalWorkflowError,
  buildApprovalExecutionOutcome,
  buildApprovalExecutionStart,
  buildApprovalRequest,
  buildApprovalResolution
} = require("../../../functions/approvalWorkflow.js");

describe("server approval workflow planning", () => {
  test("builds pending requests from server-owned identity and time", () => {
    const result = buildApprovalRequest({
      workflow: {},
      action: "convert_to_contract",
      note: " Customer approved by phone. ",
      actorEmail: "ADMIN@EXAMPLE.COM",
      nowISO: "2026-08-03T18:00:00.000Z",
      requestId: "0123456789abcdef0123456789abcdef"
    });

    expect(result.request).toEqual({
      id: "0123456789abcdef0123456789abcdef",
      action: "convert_to_contract",
      state: "pending",
      note: "Customer approved by phone.",
      requestedAtISO: "2026-08-03T18:00:00.000Z",
      requestedByEmail: "admin@example.com",
      resolvedAtISO: "",
      resolvedByEmail: "",
      resolutionNote: "",
      executionState: "",
      executionStartedAtISO: "",
      executionCompletedAtISO: "",
      executedByEmail: "",
      executionOperationId: "",
      executionReference: "",
      executionError: ""
    });
    expect(result.approvalRequests).toEqual([result.request]);
  });

  test("requires and preserves exact server-owned scope for payment requests", () => {
    const actionScope = {
      version: 1,
      kind: "stripe_checkout_deposit_request",
      organizationId: "org-a",
      quoteId: "quote-a",
      quoteRevisionId: "v0001@2026-08-03T18:00:00.000Z",
      portalKey: "portal-key-abcdefghijklmnopqrstuvwxyz",
      portalIssuedAtISO: "2026-08-03T18:00:00.000Z",
      portalExpiresAtISO: "2026-09-03T18:00:00.000Z",
      customerEmail: "customer@example.com",
      paymentKind: "deposit",
      currency: "usd",
      amountCents: 12500
    };
    const actionScopeDigest = "a".repeat(64);
    const result = buildApprovalRequest({
      workflow: {},
      action: "send_payment_request",
      actorEmail: "admin@example.com",
      nowISO: "2026-08-03T18:00:00.000Z",
      requestId: "payment-request",
      actionScope,
      actionScopeDigest
    });
    expect(result.request).toMatchObject({ actionScope, actionScopeDigest });
    expect(() => buildApprovalRequest({
      workflow: {},
      action: "send_payment_request",
      actorEmail: "admin@example.com",
      nowISO: "2026-08-03T18:00:00.000Z",
      requestId: "legacy-payment-request"
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
  });

  test("rejects duplicate pending action requests without rewriting history", () => {
    expect(() => buildApprovalRequest({
      workflow: {
        approvalRequests: [{
          id: "existing-request",
          action: "delete_quote",
          state: "pending"
        }]
      },
      action: "delete_quote",
      actorEmail: "sales@example.com",
      nowISO: "2026-08-03T18:00:00.000Z",
      requestId: "new-request"
    })).toThrowError(expect.objectContaining({
      name: "ApprovalWorkflowError",
      code: "already-exists"
    }));
  });

  test("resolves exactly one pending request and preserves sibling audit records", () => {
    const sibling = {
      id: "sibling-request",
      action: "rotate_portal_link",
      state: "rejected",
      requestedAtISO: "2026-08-01T10:00:00.000Z"
    };
    const target = {
      id: "target-request",
      action: "send_payment_request",
      state: "pending",
      requestedAtISO: "2026-08-02T10:00:00.000Z",
      requestedByEmail: "sales@example.com",
      resolvedAtISO: "",
      resolvedByEmail: "",
      resolutionNote: ""
    };
    const result = buildApprovalResolution({
      workflow: { approvalRequests: [sibling, target] },
      requestId: target.id,
      state: "approved",
      resolutionNote: "Approved for separate admin execution.",
      actorEmail: "ADMIN@EXAMPLE.COM",
      nowISO: "2026-08-03T18:05:00.000Z"
    });

    expect(result.approvalRequests[0]).toBe(sibling);
    expect(result.request).toMatchObject({
      id: target.id,
      action: target.action,
      state: "approved",
      resolvedAtISO: "2026-08-03T18:05:00.000Z",
      resolvedByEmail: "admin@example.com",
      resolutionNote: "Approved for separate admin execution."
    });
  });

  test("fails closed on malformed history and repeated resolution", () => {
    expect(() => buildApprovalRequest({
      workflow: { approvalRequests: {} },
      action: "delete_quote",
      actorEmail: "sales@example.com",
      nowISO: "2026-08-03T18:00:00.000Z",
      requestId: "request-id"
    })).toThrow(ApprovalWorkflowError);

    expect(() => buildApprovalResolution({
      workflow: {
        approvalRequests: [{
          id: "resolved-request",
          action: "delete_quote",
          state: "approved"
        }]
      },
      requestId: "resolved-request",
      state: "rejected",
      actorEmail: "admin@example.com",
      nowISO: "2026-08-03T18:10:00.000Z"
    })).toThrowError(expect.objectContaining({
      name: "ApprovalWorkflowError",
      code: "failed-precondition"
    }));
  });

  test("starts and completes only the exact approved action once", () => {
    const approved = buildApprovalResolution({
      workflow: {
        approvalRequests: [{
          id: "0123456789abcdef0123456789abcdef",
          action: "rotate_portal_link",
          state: "pending"
        }]
      },
      requestId: "0123456789abcdef0123456789abcdef",
      state: "approved",
      actorEmail: "approver@example.com",
      nowISO: "2026-08-03T18:00:00.000Z"
    });
    expect(approved.request.executionState).toBe("awaiting_execution");

    const started = buildApprovalExecutionStart({
      workflow: { approvalRequests: approved.approvalRequests },
      requestId: approved.request.id,
      action: "rotate_portal_link",
      actorEmail: "executor@example.com",
      nowISO: "2026-08-03T18:05:00.000Z",
      operationId: approved.request.id
    });
    expect(started.request).toMatchObject({
      executionState: "in_progress",
      executedByEmail: "executor@example.com",
      executionOperationId: approved.request.id
    });

    const completed = buildApprovalExecutionOutcome({
      workflow: { approvalRequests: started.approvalRequests },
      requestId: approved.request.id,
      action: "rotate_portal_link",
      actorEmail: "executor@example.com",
      nowISO: "2026-08-03T18:06:00.000Z",
      operationId: approved.request.id,
      state: "succeeded",
      reference: "portal-version-v0002"
    });
    expect(completed.request).toMatchObject({
      executionState: "succeeded",
      executionCompletedAtISO: "2026-08-03T18:06:00.000Z",
      executionReference: "portal-version-v0002",
      executionError: ""
    });
    expect(() => buildApprovalExecutionStart({
      workflow: { approvalRequests: completed.approvalRequests },
      requestId: approved.request.id,
      action: "rotate_portal_link",
      actorEmail: "executor@example.com",
      nowISO: "2026-08-03T18:07:00.000Z",
      operationId: approved.request.id
    })).toThrowError(expect.objectContaining({ code: "already-exists" }));
  });

  test("rejects mismatched actions and requires a new request after failure", () => {
    const approvedRequest = {
      id: "fedcba9876543210fedcba9876543210",
      action: "send_payment_request",
      state: "approved",
      executionState: "awaiting_execution"
    };
    expect(() => buildApprovalExecutionStart({
      workflow: { approvalRequests: [approvedRequest] },
      requestId: approvedRequest.id,
      action: "delete_quote",
      actorEmail: "executor@example.com",
      nowISO: "2026-08-03T18:05:00.000Z",
      operationId: approvedRequest.id
    })).toThrowError(expect.objectContaining({ code: "permission-denied" }));

    const started = buildApprovalExecutionStart({
      workflow: { approvalRequests: [approvedRequest] },
      requestId: approvedRequest.id,
      action: approvedRequest.action,
      actorEmail: "executor@example.com",
      nowISO: "2026-08-03T18:05:00.000Z",
      operationId: approvedRequest.id
    });
    const failed = buildApprovalExecutionOutcome({
      workflow: { approvalRequests: started.approvalRequests },
      requestId: approvedRequest.id,
      action: approvedRequest.action,
      actorEmail: "executor@example.com",
      nowISO: "2026-08-03T18:06:00.000Z",
      operationId: approvedRequest.id,
      state: "failed",
      error: "Provider unavailable."
    });
    expect(failed.request).toMatchObject({
      executionState: "failed",
      executionError: "Provider unavailable."
    });
    expect(() => buildApprovalExecutionStart({
      workflow: { approvalRequests: failed.approvalRequests },
      requestId: approvedRequest.id,
      action: approvedRequest.action,
      actorEmail: "executor@example.com",
      nowISO: "2026-08-03T18:07:00.000Z",
      operationId: approvedRequest.id
    })).toThrowError(expect.objectContaining({ code: "failed-precondition" }));
  });
});
