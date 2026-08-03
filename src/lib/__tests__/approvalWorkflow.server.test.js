import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  ApprovalWorkflowError,
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
      resolutionNote: ""
    });
    expect(result.approvalRequests).toEqual([result.request]);
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
});
