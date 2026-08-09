// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CustomerRebookDraftAction, {
  RebookQuoteReviewBanner,
  rebookDraftMutationPresentation
} from "../CustomerRebookDraftAction";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACTION = Object.freeze({
  kind: "review_rebook_draft",
  state: "ready_for_staff_review",
  sourceQuoteId: "quote-source",
  sourceVersionId: "v0003",
  acceptanceReceiptId: "acceptance-1234567890"
});
const COMPLETE_REBOOKING = Object.freeze({
  schemaVersion: 1,
  sourceOrganizationId: "org-one",
  sourceQuoteId: "quote-source",
  sourceVersionId: "v0003",
  sourceCustomerId: "customer-henderson",
  sourceEventDate: "2025-10-12",
  acceptanceReceiptId: "acceptance-1234567890",
  sourceAcceptedAtISO: "2025-09-01T12:00:00.000Z",
  rebookingRequestId: `rebook_${"a".repeat(48)}`,
  draftCreatedAtISO: "2026-08-09T12:00:00.000Z",
  state: "staff_review_completed",
  reviewedEventDate: "2026-10-12",
  reviewedAtISO: "2026-08-09T12:05:00.000Z",
  reviewedBy: {
    uid: "staff-user",
    email: "staff@example.test",
    role: "sales"
  },
  reviewCalendar: {
    date: "2026-08-09",
    timeZone: "America/Chicago"
  }
});

let container;
let root;

function receipt(overrides = {}) {
  return {
    id: "rebook-created",
    quoteNumber: "Q-260809-1800-ABCDEF12",
    status: "draft",
    idempotent: false,
    rebooking: { state: "draft_created_for_staff_review" },
    ...overrides
  };
}

function mount(element) {
  act(() => root.render(element));
}

function buttonNamed(label) {
  return [...container.querySelectorAll("button")]
    .find((button) => button.textContent === label) || null;
}

async function clickAndFlush(button) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("exact-version rebook action", () => {
  test.each([
    ["ready", "ready", "Create rebook draft"],
    ["submitting", "submitting", "Creating draft…"],
    ["uncertain", "uncertain", "Reconcile draft"],
    ["reconciliation", "reconciliation", "Reconciling…"],
    ["receipt", "receipt", "Open draft to review"],
    ["error", "error", "Retry after review"],
    ["recovery", "recovery", "Retrying…"]
  ])("maps %s to the governed mutation state", (phase, state, label) => {
    expect(rebookDraftMutationPresentation({
      phase,
      receipt: phase === "receipt" ? receipt() : null
    })).toMatchObject({ state, actionLabel: label });
  });

  test("renders the ready boundary without claiming an outbound or commercial outcome", () => {
    const markup = renderToStaticMarkup(
      <CustomerRebookDraftAction
        reviewedAction={ACTION}
        onCreateRebook={() => {}}
        onOpenQuoteEdit={() => {}}
      />
    );
    expect(markup).toContain('data-capability-state="ready"');
    expect(markup).toContain("exact accepted version");
    expect(markup).toContain("current customer contact");
    expect(markup).toContain("current trusted catalog");
    expect(markup).toContain("Delivery stays blocked until the rebook review is saved");
    expect(markup).not.toContain("booked lead");
    expect(markup).not.toContain("message sent");
  });

  test("creates once, preserves the receipt, and opens the pending draft in one click", async () => {
    let resolveCreate;
    const onCreateRebook = vi.fn(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const onOpenQuote = vi.fn();
    const onOpenQuoteEdit = vi.fn();
    mount(
      <CustomerRebookDraftAction
        reviewedAction={ACTION}
        onCreateRebook={onCreateRebook}
        onOpenQuote={onOpenQuote}
        onOpenQuoteEdit={onOpenQuoteEdit}
      />
    );

    act(() => buttonNamed("Create rebook draft").click());
    expect(container.innerHTML).toContain('data-capability-state="submitting"');
    await act(async () => {
      resolveCreate(receipt());
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Rebook draft created for staff review.");
    expect(onCreateRebook).toHaveBeenCalledTimes(1);
    expect(onCreateRebook).toHaveBeenCalledWith(ACTION, { mode: "create" });
    expect(container.innerHTML).toContain('data-capability-state="receipt"');
    expect(container.textContent).toMatch(/current-or-future event date/i);
    expect(onOpenQuoteEdit).toHaveBeenCalledWith("rebook-created");
    expect(onOpenQuote).not.toHaveBeenCalled();
  });

  test("keeps a trusted receipt when automatic navigation throws", async () => {
    mount(
      <CustomerRebookDraftAction
        reviewedAction={ACTION}
        onCreateRebook={() => Promise.resolve(receipt())}
        onOpenQuoteEdit={() => { throw new Error("navigation failed"); }}
      />
    );
    await clickAndFlush(buttonNamed("Create rebook draft"));
    expect(container.querySelector('[data-capability-state="receipt"]')).not.toBeNull();
    expect(container.textContent).toContain("Rebook draft created for staff review.");
    expect(container.textContent).not.toContain("was not created");
  });

  test("blocks duplicate browser dispatches before React commits the busy render", async () => {
    let resolveCreate;
    const onCreateRebook = vi.fn(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    mount(
      <CustomerRebookDraftAction
        reviewedAction={ACTION}
        onCreateRebook={onCreateRebook}
        onOpenQuoteEdit={() => {}}
      />
    );
    const button = buttonNamed("Create rebook draft");
    act(() => {
      button.click();
      button.click();
    });
    expect(onCreateRebook).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveCreate(receipt());
      await Promise.resolve();
    });
  });

  test("routes a progressed idempotent record to its authoritative quote", async () => {
    const onOpenQuote = vi.fn();
    const onOpenQuoteEdit = vi.fn();
    mount(
      <CustomerRebookDraftAction
        reviewedAction={ACTION}
        onCreateRebook={() => Promise.resolve(receipt({
          idempotent: true,
          status: "sent",
          rebooking: { state: "staff_review_completed" }
        }))}
        onOpenQuote={onOpenQuote}
        onOpenQuoteEdit={onOpenQuoteEdit}
      />
    );
    await clickAndFlush(buttonNamed("Create rebook draft"));
    expect(container.textContent).toContain("Matching rebook record confirmed.");
    expect(onOpenQuoteEdit).not.toHaveBeenCalled();
    act(() => buttonNamed("Open matching quote").click());
    expect(onOpenQuote).toHaveBeenCalledWith("rebook-created");
  });

  test("shows browser-local mode as unavailable instead of a disabled ready claim", () => {
    mount(<CustomerRebookDraftAction reviewedAction={ACTION} available={false} />);
    expect(container.querySelector('[data-capability-state="error"]')).not.toBeNull();
    expect(container.textContent).toMatch(/authenticated Firebase workspace/i);
    expect(buttonNamed("Create rebook draft")).toBeNull();
  });

  test("locks an ambiguous outcome to deterministic reconciliation", async () => {
    const unresolved = Object.assign(new Error("network unavailable"), {
      code: "functions/unavailable"
    });
    let resolveReconciliation;
    const onCreateRebook = vi.fn()
      .mockRejectedValueOnce(unresolved)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveReconciliation = resolve;
      }));
    mount(
      <CustomerRebookDraftAction
        reviewedAction={ACTION}
        onCreateRebook={onCreateRebook}
        onOpenQuoteEdit={() => {}}
      />
    );

    await clickAndFlush(buttonNamed("Create rebook draft"));
    expect(container.innerHTML).toContain('data-capability-state="uncertain"');
    expect(container.textContent).toContain("Draft outcome is uncertain.");
    expect(container.textContent).toMatch(/Do not start another rebook/i);
    act(() => buttonNamed("Reconcile draft").click());
    expect(container.innerHTML).toContain('data-capability-state="reconciliation"');
    expect(onCreateRebook).toHaveBeenCalledTimes(2);
    expect(onCreateRebook.mock.calls[0]).toEqual([ACTION, { mode: "create" }]);
    expect(onCreateRebook.mock.calls[1]).toEqual([ACTION, { mode: "reconcile" }]);
    await act(async () => {
      resolveReconciliation(receipt({ idempotent: true }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Matching rebook record confirmed.");
  });

  test("separates definitive rejection from recovery and hides raw errors", async () => {
    const definitive = Object.assign(new Error("sensitive backend detail"), {
      code: "functions/failed-precondition"
    });
    let resolveRecovery;
    const onCreateRebook = vi.fn()
      .mockRejectedValueOnce(definitive)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRecovery = resolve;
      }));
    mount(
      <CustomerRebookDraftAction
        reviewedAction={ACTION}
        onCreateRebook={onCreateRebook}
        onOpenQuoteEdit={() => {}}
      />
    );
    await clickAndFlush(buttonNamed("Create rebook draft"));
    expect(container.innerHTML).toContain('data-capability-state="error"');
    expect(container.textContent).toContain("Rebook draft was not created.");
    expect(container.textContent).not.toContain("sensitive backend detail");
    act(() => buttonNamed("Retry after review").click());
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    expect(onCreateRebook.mock.calls[1]).toEqual([ACTION, { mode: "recovery" }]);
    await act(async () => {
      resolveRecovery(receipt());
      await Promise.resolve();
    });
  });

  test("keeps cancellation as no-dispatch ready state and confirms again on a new create", async () => {
    const cancelled = Object.assign(new Error("cancelled"), {
      code: "failed-precondition",
      rebookDefinitive: true,
      rebookCancelled: true
    });
    const onCreateRebook = vi.fn()
      .mockRejectedValueOnce(cancelled)
      .mockResolvedValueOnce(receipt({ status: "sent", rebooking: { state: "staff_review_completed" } }));
    mount(
      <CustomerRebookDraftAction
        reviewedAction={ACTION}
        onCreateRebook={onCreateRebook}
        onOpenQuote={() => {}}
      />
    );
    await clickAndFlush(buttonNamed("Create rebook draft"));
    expect(container.querySelector('[data-capability-state="ready"]')).not.toBeNull();
    expect(container.textContent).toContain("No rebook request was sent.");
    await clickAndFlush(buttonNamed("Create rebook draft"));
    expect(onCreateRebook.mock.calls[1]).toEqual([ACTION, { mode: "create" }]);
  });

  test("does not auto-navigate from a stale receipt after the action unmounts", async () => {
    let resolveCreate;
    const onOpenQuoteEdit = vi.fn();
    mount(
      <CustomerRebookDraftAction
        reviewedAction={ACTION}
        onCreateRebook={() => new Promise((resolve) => { resolveCreate = resolve; })}
        onOpenQuoteEdit={onOpenQuoteEdit}
      />
    );
    act(() => buttonNamed("Create rebook draft").click());
    act(() => root.render(<div>Authoritative source quote route</div>));
    await act(async () => {
      resolveCreate(receipt());
      await Promise.resolve();
    });
    expect(container.textContent).toBe("Authoritative source quote route");
    expect(onOpenQuoteEdit).not.toHaveBeenCalled();
  });
});

describe("exact-version rebook edit banner", () => {
  test("persists a review-required explanation and direct date-field action", () => {
    const onFocusEventDate = vi.fn();
    mount(
      <RebookQuoteReviewBanner
        quoteNumber="Q-REBOOK"
        organizationId="org-one"
        customerId="customer-henderson"
        eventDate="2025-10-12"
        tenantTimeZone="America/Chicago"
        rebooking={{
          ...COMPLETE_REBOOKING,
          state: "draft_created_for_staff_review",
          reviewedEventDate: undefined,
          reviewedAtISO: undefined,
          reviewedBy: undefined
        }}
        onFocusEventDate={onFocusEventDate}
      />
    );
    expect(container.querySelector('[data-rebook-review-state="review_required"]')).not.toBeNull();
    expect(container.textContent).toContain("Complete staff review before delivery");
    expect(container.textContent).toContain("Accepted source event: 2025-10-12");
    act(() => buttonNamed("Review event date").click());
    expect(onFocusEventDate).toHaveBeenCalledTimes(1);
  });

  test("shows exact completed evidence and detects an unsaved date divergence", () => {
    const completed = renderToStaticMarkup(
      <RebookQuoteReviewBanner
        organizationId="org-one"
        customerId="customer-henderson"
        eventDate="2026-10-12"
        tenantTimeZone="America/Chicago"
        rebooking={COMPLETE_REBOOKING}
      />
    );
    expect(completed).toContain('data-rebook-review-state="staff_review_completed"');
    expect(completed).toContain("Staff review recorded");

    const diverged = renderToStaticMarkup(
      <RebookQuoteReviewBanner
        organizationId="org-one"
        customerId="customer-henderson"
        eventDate="2026-11-01"
        tenantTimeZone="America/Chicago"
        rebooking={COMPLETE_REBOOKING}
      />
    );
    expect(diverged).toContain('data-rebook-review-state="invalid_evidence"');
    expect(diverged).toContain("no longer matches this quote");
  });
});
