// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../lib/postEventCloseoutClient", () => ({
  isDefinitivePostEventCloseoutError: vi.fn(),
  readPendingPostEventActualAttendanceAttempt: vi.fn(),
  readPendingPostEventCloseoutConfigurationAttempt: vi.fn(),
  readPendingPostEventCloseoutAttempt: vi.fn(),
  recordPostEventActualAttendance: vi.fn(),
  recordPostEventCloseoutReview: vi.fn(),
  refreshPostEventCloseoutConfiguration: vi.fn(),
  resetDefinitivePostEventActualAttendanceAttempt: vi.fn(),
  resetDefinitivePostEventCloseoutConfigurationAttempt: vi.fn(),
  resetDefinitivePostEventCloseoutAttempt: vi.fn()
}));

import PostEventCloseoutReviewAction, {
  buildPostEventCloseoutPresentation
} from "../PostEventCloseoutReviewAction";
import {
  isDefinitivePostEventCloseoutError,
  readPendingPostEventActualAttendanceAttempt,
  readPendingPostEventCloseoutConfigurationAttempt,
  readPendingPostEventCloseoutAttempt,
  recordPostEventActualAttendance,
  recordPostEventCloseoutReview,
  refreshPostEventCloseoutConfiguration,
  resetDefinitivePostEventActualAttendanceAttempt,
  resetDefinitivePostEventCloseoutConfigurationAttempt,
  resetDefinitivePostEventCloseoutAttempt
} from "../../lib/postEventCloseoutClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_ACTION = Object.freeze({
  closeoutId: `closeout_${"a".repeat(48)}`,
  state: "due",
  dueDate: "2026-08-15",
  policy: {
    state: "configured",
    timeZone: "America/Chicago",
    blockedReason: ""
  },
  completedAtISO: "",
  completedBy: ""
});

const REVIEW_ITEMS = Object.freeze([
  Object.freeze({
    code: "internal_closeout",
    label: "Review the internal event closeout",
    state: "pending",
    reviewedAtISO: "",
    reviewedBy: ""
  }),
  Object.freeze({
    code: "thank_you",
    label: "Review a tenant-branded thank-you opportunity",
    state: "pending",
    reviewedAtISO: "",
    reviewedBy: ""
  }),
  Object.freeze({
    code: "review_request",
    label: "Review a consent- and suppression-gated review request",
    state: "pending",
    reviewedAtISO: "",
    reviewedBy: ""
  }),
  Object.freeze({
    code: "operational_follow_up",
    label: "Review unresolved operational follow-up",
    state: "pending",
    reviewedAtISO: "",
    reviewedBy: ""
  })
]);

function opportunity(overrides = {}) {
  return {
    organizationId: "org-one",
    quoteId: "quote-booked",
    type: "post_event_closeout",
    reviewItems: REVIEW_ITEMS.map((item) => ({ ...item })),
    reviewedAction: { ...BASE_ACTION },
    ...overrides
  };
}

function serverResult(overrides = {}) {
  return {
    ok: true,
    organizationId: "org-one",
    quoteId: "quote-booked",
    closeoutId: BASE_ACTION.closeoutId,
    record: {
      state: "pending"
    },
    receipt: {
      requestId: "closeout-review-request-0001",
      itemCode: "internal_closeout",
      action: "review",
      resultItemState: "reviewed",
      resultCloseoutState: "pending"
    },
    ...overrides
  };
}

let container;
let root;

function mount(element) {
  act(() => root.render(element));
}

function buttonNamed(label) {
  return [...container.querySelectorAll("button")]
    .find((button) => button.textContent === label) || null;
}

function firstNoteInput() {
  return container.querySelector('[data-closeout-item="internal_closeout"] input');
}

function enterInputValue(input, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  valueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function clickAndFlush(button) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  readPendingPostEventActualAttendanceAttempt.mockReturnValue(null);
  readPendingPostEventCloseoutAttempt.mockReturnValue(null);
  readPendingPostEventCloseoutConfigurationAttempt.mockReturnValue(null);
  isDefinitivePostEventCloseoutError.mockReturnValue(false);
  resetDefinitivePostEventCloseoutAttempt.mockReturnValue(false);
  resetDefinitivePostEventActualAttendanceAttempt.mockReturnValue(false);
  resetDefinitivePostEventCloseoutConfigurationAttempt.mockReturnValue(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("post-event closeout presentation states", () => {
  test.each([
    ["scheduled", "Scheduled", false],
    ["due", "Due today", true],
    ["overdue", "Overdue", true],
    ["blocked_configuration", "Configuration blocked", false],
    ["completed", "Closeout complete", true]
  ])("maps %s to an exact visible state and action gate", (state, label, actionable) => {
    const view = buildPostEventCloseoutPresentation(opportunity({
      reviewedAction: {
        ...BASE_ACTION,
        state,
        completedAtISO: state === "completed" ? "2026-08-15T17:00:00.000Z" : "",
        completedBy: state === "completed" ? "staff@example.test" : ""
      }
    }), true);

    expect(view).toMatchObject({
      state,
      authoritative: true,
      actionable,
      presentation: { label }
    });
  });

  test("keeps a local or legacy cue read-only without server identity", () => {
    const view = buildPostEventCloseoutPresentation(opportunity({
      reviewedAction: null
    }), true);

    expect(view).toMatchObject({
      state: "read_only_cue",
      authoritative: false,
      actionable: false,
      presentation: { label: "Read-only cue" }
    });
    expect(view.detail).toMatch(/no server closeout record/i);
  });

  test("feature/source availability closes the mutation gate without changing evidence state", () => {
    expect(buildPostEventCloseoutPresentation(opportunity(), false)).toMatchObject({
      state: "due",
      authoritative: true,
      actionable: false
    });
  });

  test("renders the governed ready state without a provider-delivery claim", () => {
    const markup = renderToStaticMarkup(
      <PostEventCloseoutReviewAction opportunity={opportunity()} />
    );

    expect(markup).toContain('data-capability-id="cwf-11-authoritative-post-event-closeout"');
    expect(markup).toContain('data-capability-state="ready"');
    expect(markup).toContain('data-closeout-state="due"');
    expect(markup).toContain("Outbound delivery remains a separate consent- and provider-gated action");
    expect(markup).not.toContain("Email sent");
    expect(markup).not.toContain("Message delivered");
    expect(markup).not.toContain("Provider accepted");
  });

  test.each([
    ["scheduled", "Internal closeout becomes due"],
    ["blocked_configuration", "tenant_time_zone_missing_or_invalid"]
  ])("disables action controls for %s", (state, expectedCopy) => {
    mount(
      <PostEventCloseoutReviewAction
        opportunity={opportunity({
          reviewedAction: {
            ...BASE_ACTION,
            state,
            policy: {
              ...BASE_ACTION.policy,
              state: state === "blocked_configuration" ? "blocked_configuration" : "configured",
              blockedReason: state === "blocked_configuration"
                ? "tenant_time_zone_missing_or_invalid"
                : ""
            }
          }
        })}
      />
    );

    expect(buttonNamed("Mark reviewed").disabled).toBe(true);
    expect(container.textContent).toContain(expectedCopy);
    expect(recordPostEventCloseoutReview).not.toHaveBeenCalled();
  });

  test("offers an actionable reopen only for an authoritative completed review item", () => {
    mount(
      <PostEventCloseoutReviewAction
        opportunity={opportunity({
          reviewedAction: {
            ...BASE_ACTION,
            state: "completed",
            completedAtISO: "2026-08-15T17:00:00.000Z",
            completedBy: "staff@example.test"
          },
          reviewItems: REVIEW_ITEMS.map((item) => ({
            ...item,
            state: "reviewed",
            reviewedAtISO: "2026-08-15T16:00:00.000Z",
            reviewedBy: "staff@example.test"
          }))
        })}
      />
    );

    expect(buttonNamed("Reopen review").disabled).toBe(false);
  });

  test("makes blocked configuration recoverable without recording a review item", async () => {
    const result = serverResult({
      state: "pending",
      receipt: {
        requestId: "closeout-configuration-request-0001",
        action: "refresh_configuration",
        resultPolicyState: "configured"
      }
    });
    refreshPostEventCloseoutConfiguration.mockResolvedValue(result);
    mount(
      <PostEventCloseoutReviewAction
        opportunity={opportunity({
          reviewedAction: {
            ...BASE_ACTION,
            state: "blocked_configuration",
            policy: {
              state: "blocked_configuration",
              timeZone: "",
              blockedReason: "tenant_time_zone_missing_or_invalid"
            }
          }
        })}
      />
    );

    await clickAndFlush(buttonNamed("Check configuration"));

    expect(refreshPostEventCloseoutConfiguration).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-booked",
      closeoutId: BASE_ACTION.closeoutId
    });
    expect(recordPostEventCloseoutReview).not.toHaveBeenCalled();
    expect(container.querySelector('[data-capability-state="receipt"]')).not.toBeNull();
    expect(container.textContent).toContain("does not claim that customer email was sent or delivered");
  });
});

describe("post-event closeout mutation lifecycle", () => {
  test("moves ready to submitting and preserves exact bounded mutation input", async () => {
    let resolveRequest;
    recordPostEventCloseoutReview.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    mount(<PostEventCloseoutReviewAction opportunity={opportunity()} />);

    act(() => {
      enterInputValue(firstNoteInput(), "Reviewed event operations.");
    });
    act(() => buttonNamed("Mark reviewed").click());

    expect(container.innerHTML).toContain('data-capability-state="submitting"');
    expect(container.querySelector('[data-mutation-state="submitting"]')).not.toBeNull();
    expect(buttonNamed("Waiting for receipt...")).not.toBeNull();
    expect(firstNoteInput().disabled).toBe(true);
    expect(recordPostEventCloseoutReview).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-booked",
      closeoutId: BASE_ACTION.closeoutId,
      itemCode: "internal_closeout",
      action: "review",
      note: "Reviewed event operations."
    });

    await act(async () => {
      resolveRequest(serverResult());
      await Promise.resolve();
    });
  });

  test("records only an exact internal receipt and notifies the owning surface", async () => {
    const result = serverResult();
    const onReceipt = vi.fn();
    recordPostEventCloseoutReview.mockResolvedValue(result);
    mount(
      <PostEventCloseoutReviewAction
        opportunity={opportunity()}
        onReceipt={onReceipt}
      />
    );

    await clickAndFlush(buttonNamed("Mark reviewed"));

    expect(container.innerHTML).toContain('data-capability-state="receipt"');
    expect(container.querySelector('[data-mutation-state="receipt"]')).not.toBeNull();
    expect(container.textContent).toContain("Receipt recorded.");
    expect(container.textContent).toContain("does not claim that customer email was sent or delivered");
    expect(container.textContent).toContain(result.receipt.requestId);
    expect(onReceipt).toHaveBeenCalledWith(result);
  });

  test("locks an ambiguous outcome to reconciliation of the unchanged pending request", async () => {
    const unavailable = Object.assign(new Error("network unavailable"), {
      code: "functions/unavailable"
    });
    const pendingAttempt = {
      organizationId: "org-one",
      quoteId: "quote-booked",
      closeoutId: BASE_ACTION.closeoutId,
      itemCode: "internal_closeout",
      action: "review",
      requestId: "closeout-review-request-0001",
      note: ""
    };
    let resolveReconciliation;
    readPendingPostEventCloseoutAttempt
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(pendingAttempt);
    recordPostEventCloseoutReview
      .mockRejectedValueOnce(unavailable)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveReconciliation = resolve;
      }));
    isDefinitivePostEventCloseoutError.mockReturnValue(false);
    mount(<PostEventCloseoutReviewAction opportunity={opportunity()} />);

    await clickAndFlush(buttonNamed("Mark reviewed"));
    expect(container.innerHTML).toContain('data-capability-state="uncertain"');
    expect(container.querySelector('[data-mutation-state="uncertain"][role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("action is not assumed complete");
    expect(firstNoteInput().disabled).toBe(true);

    act(() => buttonNamed("Reconcile exact action").click());
    expect(container.innerHTML).toContain('data-capability-state="reconciliation"');
    expect(recordPostEventCloseoutReview).toHaveBeenCalledTimes(2);
    expect(recordPostEventCloseoutReview.mock.calls[1][0]).toEqual(pendingAttempt);

    await act(async () => {
      resolveReconciliation(serverResult());
      await Promise.resolve();
    });
    expect(container.querySelector('[data-capability-state="receipt"]')).not.toBeNull();
  });

  test("separates definitive error from explicit recovery before a new request", async () => {
    const rejected = Object.assign(new Error("The accepted source changed."), {
      code: "functions/failed-precondition"
    });
    recordPostEventCloseoutReview.mockRejectedValue(rejected);
    isDefinitivePostEventCloseoutError.mockReturnValue(true);
    resetDefinitivePostEventCloseoutAttempt.mockReturnValue(true);
    mount(<PostEventCloseoutReviewAction opportunity={opportunity()} />);

    await clickAndFlush(buttonNamed("Mark reviewed"));
    expect(container.innerHTML).toContain('data-capability-state="error"');
    expect(container.querySelector('[data-mutation-state="error"][role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("server definitively rejected this action");
    expect(container.textContent).toContain("The accepted source changed.");

    act(() => buttonNamed("Reset rejected action").click());
    expect(resetDefinitivePostEventCloseoutAttempt).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    expect(container.querySelector('[data-mutation-state="recovery"][role="status"]')).not.toBeNull();
    expect(container.textContent).toContain("rejected request was reset");
    expect(buttonNamed("Mark reviewed")).not.toBeNull();
    expect(recordPostEventCloseoutReview).toHaveBeenCalledTimes(1);
  });

  test("does not claim recovery when the client refuses to reset unresolved evidence", async () => {
    const rejected = Object.assign(new Error("permission denied"), {
      code: "functions/permission-denied"
    });
    recordPostEventCloseoutReview.mockRejectedValue(rejected);
    isDefinitivePostEventCloseoutError.mockReturnValue(true);
    resetDefinitivePostEventCloseoutAttempt.mockReturnValue(false);
    mount(<PostEventCloseoutReviewAction opportunity={opportunity()} />);

    await clickAndFlush(buttonNamed("Mark reviewed"));
    act(() => buttonNamed("Reset rejected action").click());

    expect(container.querySelector('[data-capability-state="error"]')).not.toBeNull();
    expect(container.querySelector('[data-capability-state="recovery"]')).toBeNull();
  });

  test("never dispatches when the authoritative action gate is unavailable", () => {
    mount(
      <PostEventCloseoutReviewAction
        opportunity={opportunity()}
        available={false}
      />
    );

    const button = buttonNamed("Mark reviewed");
    expect(button.disabled).toBe(true);
    act(() => button.click());
    expect(recordPostEventCloseoutReview).not.toHaveBeenCalled();
  });
});

describe("post-event actual attendance", () => {
  const confirmedAttendance = {
    schemaVersion: 1,
    revision: 1,
    count: 118,
    sourceType: "staff_observed",
    note: "Lead server confirmed the final served headcount.",
    sourceReferenceId: `closeout_attendance_${"e".repeat(48)}`,
    recordedAtISO: "2026-08-15T15:30:00.000Z",
    recordedBy: { email: "owner@example.test", role: "admin" },
    lastReceiptId: `closeout_attendance_${"e".repeat(48)}`
  };

  function fillAttendance({ count = "118", sourceType = "staff_observed", note = confirmedAttendance.note } = {}) {
    const countInput = container.querySelector('input[type="number"]');
    const sourceSelect = container.querySelector('[name="actual-attendance-source"]');
    const noteInput = container.querySelector(".post-event-actual-attendance__note input");
    act(() => {
      enterInputValue(countInput, count);
      const selectSetter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value"
      )?.set;
      selectSetter.call(sourceSelect, sourceType);
      sourceSelect.dispatchEvent(new Event("change", { bubbles: true }));
      enterInputValue(noteInput, note);
    });
  }

  test("records a sourced count and renders the exact server-confirmed receipt projection", async () => {
    const result = {
      ...serverResult(),
      postEventCloseout: { actualAttendance: confirmedAttendance },
      receipt: {
        requestId: "attendance-request-0001",
        action: "record",
        priorRevision: 0,
        resultRevision: 1,
        count: 118,
        sourceType: "staff_observed"
      }
    };
    recordPostEventActualAttendance.mockResolvedValue(result);
    mount(<PostEventCloseoutReviewAction opportunity={opportunity()} />);
    fillAttendance();

    await clickAndFlush(buttonNamed("Record actual attendance"));

    expect(recordPostEventActualAttendance).toHaveBeenCalledWith({
      organizationId: "org-one",
      quoteId: "quote-booked",
      closeoutId: BASE_ACTION.closeoutId,
      action: "record",
      expectedRevision: 0,
      count: 118,
      sourceType: "staff_observed",
      note: confirmedAttendance.note
    });
    expect(container.querySelector('[data-attendance-record-state="confirmed"]'))
      .not.toBeNull();
    expect(container.textContent).toContain("118 guests recorded");
    expect(container.textContent).toContain(confirmedAttendance.sourceReferenceId);
    expect(container.textContent).toContain("does not reprice, invoice, refund");
  });

  test("corrects the current revision instead of overwriting it as a new record", async () => {
    const corrected = {
      ...confirmedAttendance,
      revision: 2,
      count: 116,
      sourceType: "venue_reported",
      note: "Venue captain reconciled the final door count.",
      sourceReferenceId: `closeout_attendance_${"f".repeat(48)}`,
      lastReceiptId: `closeout_attendance_${"f".repeat(48)}`
    };
    recordPostEventActualAttendance.mockResolvedValue({
      ...serverResult(),
      postEventCloseout: { actualAttendance: corrected },
      receipt: {
        requestId: "attendance-request-0002",
        action: "correct",
        priorRevision: 1,
        resultRevision: 2,
        count: 116,
        sourceType: "venue_reported"
      }
    });
    mount(
      <PostEventCloseoutReviewAction
        opportunity={opportunity({
          reviewedAction: { ...BASE_ACTION, actualAttendance: confirmedAttendance }
        })}
      />
    );
    fillAttendance({
      count: "116",
      sourceType: "venue_reported",
      note: corrected.note
    });

    await clickAndFlush(buttonNamed("Correct attendance record"));

    expect(recordPostEventActualAttendance).toHaveBeenCalledWith(expect.objectContaining({
      action: "correct",
      expectedRevision: 1,
      count: 116,
      sourceType: "venue_reported"
    }));
    expect(container.textContent).toContain("116 guests recorded");
    expect(container.textContent).toContain("revision 2");
  });

  test("keeps actual attendance unavailable before the closeout action gate opens", () => {
    mount(
      <PostEventCloseoutReviewAction
        opportunity={opportunity({
          reviewedAction: { ...BASE_ACTION, state: "scheduled" }
        })}
      />
    );
    expect(buttonNamed("Record actual attendance").disabled).toBe(true);
    expect(container.querySelector('[name="actual-attendance-source"]').disabled).toBe(true);
    expect(recordPostEventActualAttendance).not.toHaveBeenCalled();
  });
});

test("closeout actuals source uses projected closeout references without current quote fallback", async () => {
  const { closeoutActualsSource } = await import("../PostEventCloseoutReviewAction");
  expect(closeoutActualsSource({ organizationId: "org-a", quoteId: "quote-a", activeVersionId: "current-version", acceptanceReceipt: { receiptId: "current-receipt" }, reviewedAction: { sourceVersionId: "closeout-version", acceptanceReceiptId: "closeout-receipt" } })).toEqual({ organizationId: "org-a", quoteId: "quote-a", sourceVersionId: "closeout-version", acceptanceReceiptId: "closeout-receipt" });
  expect(closeoutActualsSource({ organizationId: "org-a", quoteId: "quote-a", activeVersionId: "current-version" }).sourceVersionId).toBe("");
});


test("native closeout review leads with explicit progress while policy and notes stay optional", () => {
  mount(<PostEventCloseoutReviewAction opportunity={opportunity()} />);
  expect(container.querySelector(".closeout-progress").textContent).toBe("0 of 4 items reviewed");
  expect(container.querySelectorAll(".post-event-closeout-item")).toHaveLength(4);
  expect(container.querySelector(".closeout-supporting-detail").open).toBe(false);
  expect([...container.querySelectorAll(".closeout-item-detail")].every((node) => !node.open)).toBe(true);
  expect(container.querySelector(".post-event-closeout-items").compareDocumentPosition(container.querySelector(".closeout-supporting-detail")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(recordPostEventCloseoutReview).not.toHaveBeenCalled();
});
