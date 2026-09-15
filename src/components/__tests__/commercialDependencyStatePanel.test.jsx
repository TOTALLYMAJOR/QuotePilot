// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const client = vi.hoisted(() => ({
  buildRequestId: vi.fn(),
  getState: vi.fn(),
  isDefinitive: vi.fn(),
  reconcile: vi.fn()
}));

vi.mock("../../lib/commercialChangeAuthorityClient", () => ({
  buildCommercialChangeRequestId: client.buildRequestId,
  getCommercialDependencyState: client.getState,
  isDefinitiveCommercialChangeError: client.isDefinitive,
  reconcileCommercialDependencyState: client.reconcile
}));

import CommercialDependencyStatePanel from "../CommercialDependencyStatePanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SCOPE = Object.freeze({ organizationId: "org-one", quoteId: "quote-one" });
const APPLY_ID = `ccp_${"a".repeat(48)}`;
const OUTPUT_ID = `cci_${"b".repeat(48)}`;
const BEO_ID = `cci_${"c".repeat(48)}`;
const REQUEST_ID = `change_reconcile_${"d".repeat(32)}`;
const RECEIPT_ID = `ccr_${"e".repeat(48)}`;

function invalidation({
  id = OUTPUT_ID,
  nodeId = "output.plan.staffing_requirement",
  nodeKind = "output",
  classification = "REVIEW",
  state = "open"
} = {}) {
  const resolved = state === "resolved";
  return {
    invalidationId: id,
    operationId: `cco_${"f".repeat(48)}`,
    applyReceiptId: APPLY_ID,
    sourceRevisionId: "v0014",
    targetRevisionId: "v0015",
    nodeId,
    nodeKind,
    classification,
    triggeredBy: ["fact.event.guest_count"],
    decisionId: nodeKind === "output" ? "dependency-staffing" : "",
    decisionType: nodeKind === "output" ? "staffing" : "beo_finalization",
    state,
    createdAtISO: "2026-08-09T12:03:00.000Z",
    resolvedAtISO: resolved ? "2026-08-09T12:07:00.000Z" : "",
    resolution: resolved ? (nodeKind === "output" ? "decision_resolved" : "artifact_current") : "",
    resolutionReceiptId: resolved ? RECEIPT_ID : "",
    evidenceId: resolved ? `evidence-${id.slice(-12)}` : ""
  };
}

function dependencyState(state = "BLOCKED", overrides = {}) {
  let invalidations;
  if (state === "NOT_GENERATED") invalidations = [];
  else if (state === "READY") invalidations = [invalidation({ state: "resolved" })];
  else invalidations = [invalidation()];
  const openCount = invalidations.filter((item) => item.state === "open").length;
  const resolvedCount = invalidations.length - openCount;
  return {
    schemaVersion: 1,
    authority: "server_projection",
    source: "firebase_server_projection",
    ...SCOPE,
    customerId: "customer-one",
    eventDate: "2026-09-01",
    activeRevisionId: "v0015",
    observedAtISO: "2026-08-09T12:05:00.000Z",
    bounds: {
      invalidationLimit: 64,
      invalidationSetComplete: true,
      returnedCount: invalidations.length,
      truncated: false
    },
    state,
    safeToPublish: state === "READY",
    latestApplyReceiptId: state === "NOT_GENERATED" ? "" : APPLY_ID,
    totalInvalidationCount: invalidations.length,
    openInvalidationCount: openCount,
    resolvedInvalidationCount: resolvedCount,
    invalidations,
    reasonCodes: [state === "READY"
      ? "all_named_dependencies_reconciled"
      : state === "NOT_GENERATED"
        ? "no_governed_change_applied"
        : "governed_dependencies_unresolved"],
    ...overrides
  };
}

function reconciliationReceipt({
  requestId = REQUEST_ID,
  selected = [invalidation()]
} = {}) {
  return {
    schemaVersion: "commercial-change-reconciliation-receipt-v1",
    authority: "server_authoritative",
    receiptType: "reconciliation",
    receiptId: RECEIPT_ID,
    requestId,
    ...SCOPE,
    applyReceiptId: APPLY_ID,
    applyReceiptDigest: "1".repeat(64),
    activeRevisionId: "v0015",
    resolutions: selected.map((item) => ({
      invalidationId: item.invalidationId,
      invalidationReceiptId: item.invalidationId,
      nodeId: item.nodeId,
      evidenceId: `evidence-${item.invalidationId.slice(-12)}`,
      evidenceDigest: "2".repeat(64),
      resolution: item.nodeKind === "output" ? "decision_resolved" : "artifact_current"
    })),
    reconciledAtISO: "2026-08-09T12:07:00.000Z",
    reconciledBy: {
      uid: "staff-one",
      email: "staff@example.test",
      role: "sales"
    },
    boundary: "Server evidence only; no quote was published.",
    receiptDigest: "3".repeat(64)
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let container;
let root;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function render(props = {}) {
  act(() => {
    root.render(
      <CommercialDependencyStatePanel
        {...SCOPE}
        quoteNumber="Q-0015"
        {...props}
      />
    );
  });
}

function change(element, value) {
  act(() => {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  client.buildRequestId.mockReturnValue(REQUEST_ID);
  client.isDefinitive.mockImplementation((error) => (
    !["functions/unavailable", "functions/deadline-exceeded"].includes(error?.code)
  ));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CommercialDependencyStatePanel", () => {
  test("renders loading then deterministic READY eligibility without implying publication", async () => {
    const pending = deferred();
    client.getState.mockReturnValue(pending.promise);
    render();

    expect(container.querySelector('[data-capability-state="loading"]')).toBeTruthy();
    expect(container.querySelector('[data-commercial-publish-eligibility="not-established"]'))
      .toBeTruthy();

    await act(async () => pending.resolve(dependencyState("READY")));

    expect(container.querySelector('[data-commercial-dependency-state="ready"]')).toBeTruthy();
    expect(container.querySelector('[data-capability-state="success"]')).toBeTruthy();
    expect(container.querySelector('[data-commercial-publish-eligibility="eligible"]'))
      .toBeTruthy();
    expect(container.textContent).toContain("Eligible for a separate publish decision");
    expect(container.textContent).toContain("never publishes, sends, or establishes customer visibility");
    expect(client.getState).toHaveBeenCalledWith(SCOPE);
  });

  test("keeps NOT_GENERATED empty distinct from incomplete UNKNOWN authority", async () => {
    client.getState.mockResolvedValue(dependencyState("NOT_GENERATED"));
    render();
    await settle();

    expect(container.querySelector('[data-capability-state="empty"]')).toBeTruthy();
    expect(container.textContent).toContain("No dependency receipt yet");
    expect(container.querySelector('[data-commercial-publish-eligibility="not-established"]'))
      .toBeTruthy();

    client.getState.mockResolvedValue(dependencyState("UNKNOWN", {
      bounds: {
        invalidationLimit: 64,
        invalidationSetComplete: false,
        returnedCount: 0,
        truncated: true
      },
      latestApplyReceiptId: APPLY_ID,
      totalInvalidationCount: 65,
      openInvalidationCount: 65,
      resolvedInvalidationCount: 0,
      invalidations: [],
      safeToPublish: false,
      reasonCodes: ["invalidation_evidence_truncated"]
    }));
    act(() => container.querySelector("button.ghost.compact").click());
    await settle();

    expect(container.querySelector('[data-commercial-dependency-state="unknown"]')).toBeTruthy();
    expect(container.querySelector('[data-capability-state="partial"]')).toBeTruthy();
    expect(container.textContent).toContain("exceeded the 64-record safety bound");
  });

  test("retains prior evidence as stale after refresh failure and revokes READY eligibility", async () => {
    client.getState.mockResolvedValueOnce(dependencyState("READY"));
    render();
    await settle();

    client.getState.mockRejectedValueOnce({ code: "functions/unavailable" });
    act(() => container.querySelector("button.ghost.compact").click());
    await settle();

    expect(container.querySelector('[data-capability-state="stale"]')).toBeTruthy();
    expect(container.textContent).toContain("v0015");
    expect(container.querySelector('[data-commercial-publish-eligibility="not-established"]'))
      .toBeTruthy();
    expect(container.textContent).toContain("prior exact server projection remains visible");
  });

  test("ignores a stale request generation after exact quote scope changes", async () => {
    const first = deferred();
    client.getState.mockImplementation(({ quoteId }) => (
      quoteId === "quote-one"
        ? first.promise
        : Promise.resolve(dependencyState("NOT_GENERATED", {
          quoteId: "quote-two",
          activeRevisionId: "v0020"
        }))
    ));
    render();
    render({ quoteId: "quote-two", quoteNumber: "Q-0020" });
    await settle();
    await act(async () => first.resolve(dependencyState("READY")));

    expect(container.querySelector('[data-quote-id="quote-two"]')).toBeTruthy();
    expect(container.querySelector('[data-capability-state="empty"]')).toBeTruthy();
    expect(container.textContent).toContain("v0020");
    expect(container.textContent).not.toContain("ccp_aaaaaaaa");
  });

  test("requires a staff note for output nodes and renders the immutable reconciliation receipt", async () => {
    const output = invalidation();
    const previouslyResolvedBeo = invalidation({
      id: BEO_ID,
      nodeId: "artifact.kitchen_beo",
      nodeKind: "artifact",
      classification: "STALE",
      state: "resolved"
    });
    client.getState.mockResolvedValue(dependencyState("BLOCKED", {
      invalidations: [output, previouslyResolvedBeo],
      totalInvalidationCount: 2,
      openInvalidationCount: 1,
      resolvedInvalidationCount: 1,
      bounds: {
        invalidationLimit: 64,
        invalidationSetComplete: true,
        returnedCount: 2,
        truncated: false
      }
    }));
    const reconciliation = deferred();
    client.reconcile.mockReturnValue(reconciliation.promise);
    const reconciliationResult = {
      ok: true,
      reconciliationReceipt: reconciliationReceipt({ selected: [output] }),
      dependencyState: dependencyState("READY")
    };
    render();
    await settle();

    expect(container.querySelector('[data-commercial-dependency-state="blocked"]')).toBeTruthy();
    expect(container.innerHTML).toContain('data-capability-state="ready"');
    expect(container.querySelectorAll(".commercial-dependency-invalidation")).toHaveLength(1);
    expect(container.querySelector(`[data-commercial-invalidation-id="${OUTPUT_ID}"]`))
      .toBeTruthy();
    expect(container.querySelector(`[data-commercial-invalidation-id="${BEO_ID}"]`))
      .toBeNull();
    expect(container.textContent).toContain("v0014");
    expect(container.textContent).toContain("v0015");
    expect(container.textContent).toContain("Guest count");
    const checkbox = container.querySelector(`input[aria-label="Select Staffing requirement for reconciliation"]`);
    act(() => checkbox.click());
    act(() => container.querySelector(".commercial-dependency-reconcile .cta").click());
    expect(client.reconcile).not.toHaveBeenCalled();
    expect(container.textContent).toContain("staff resolution note is required");

    change(container.querySelector("textarea"), "Staffing plan recomputed and reviewed by operations.");
    act(() => container.querySelector(".commercial-dependency-reconcile .cta").click());
    expect(container.innerHTML).toContain('data-capability-state="submitting"');

    expect(client.reconcile).toHaveBeenCalledWith({
      ...SCOPE,
      applyReceiptId: APPLY_ID,
      requestId: REQUEST_ID,
      invalidationIds: [OUTPUT_ID],
      resolutionNote: "Staffing plan recomputed and reviewed by operations."
    });
    await act(async () => reconciliation.resolve(reconciliationResult));
    expect(container.querySelector('[data-commercial-dependency-state="ready"]')).toBeTruthy();
    expect(container.querySelector(`[data-reconciliation-receipt-id="${RECEIPT_ID}"]`))
      .toBeTruthy();
    expect(container.innerHTML).toContain('data-capability-state="receipt"');
    expect(container.textContent).toContain("Immutable reconciliation receipt");
    expect(container.textContent).toContain("does not publish the quote");
  });

  test("locks and retries the exact reconciliation identity after an uncertain outcome", async () => {
    const beo = invalidation({
      id: BEO_ID,
      nodeId: "artifact.kitchen_beo",
      nodeKind: "artifact",
      classification: "STALE"
    });
    const blocked = dependencyState("BLOCKED", {
      invalidations: [beo],
      totalInvalidationCount: 1,
      openInvalidationCount: 1,
      resolvedInvalidationCount: 0
    });
    client.getState.mockResolvedValue(blocked);
    const exactRetry = deferred();
    const exactRetryResult = {
      ok: true,
      reconciliationReceipt: reconciliationReceipt({ requestId: REQUEST_ID, selected: [beo] }),
      dependencyState: dependencyState("READY", {
        invalidations: [{ ...beo, state: "resolved", resolvedAtISO: "2026-08-09T12:07:00.000Z", resolution: "artifact_current", resolutionReceiptId: RECEIPT_ID, evidenceId: "beo-current" }],
        totalInvalidationCount: 1,
        openInvalidationCount: 0,
        resolvedInvalidationCount: 1
      })
    };
    client.reconcile
      .mockRejectedValueOnce({ code: "functions/unavailable" })
      .mockReturnValueOnce(exactRetry.promise);
    render();
    await settle();

    act(() => container.querySelector('input[aria-label="Select Kitchen BEO for reconciliation"]').click());
    act(() => container.querySelector(".commercial-dependency-reconcile .cta").click());
    await settle();

    expect(container.querySelector('[data-commercial-reconciliation-state="uncertain"]'))
      .toBeTruthy();
    expect(container.innerHTML).toContain('data-capability-state="uncertain"');
    expect(container.textContent).toContain(REQUEST_ID);
    expect(container.querySelector('input[aria-label="Select Kitchen BEO for reconciliation"]').disabled)
      .toBe(true);

    act(() => root.unmount());
    root = createRoot(container);
    render();
    await settle();

    expect(container.querySelector('[data-commercial-reconciliation-state="uncertain"]'))
      .toBeTruthy();
    expect(container.textContent).toContain(REQUEST_ID);
    act(() => container.querySelector(".commercial-dependency-reconcile .cta").click());
    expect(container.innerHTML).toContain('data-capability-state="reconciliation"');
    await act(async () => exactRetry.resolve(exactRetryResult));

    expect(client.reconcile).toHaveBeenCalledTimes(2);
    expect(client.reconcile.mock.calls[0][0]).toEqual(client.reconcile.mock.calls[1][0]);
    expect(client.buildRequestId).toHaveBeenCalledTimes(1);
    expect(container.querySelector(`[data-reconciliation-receipt-id="${RECEIPT_ID}"]`))
      .toBeTruthy();
  });

  test("keeps blocked evidence read-only when reconciliation authority is unavailable", async () => {
    client.getState.mockResolvedValue(dependencyState("BLOCKED"));
    render({ canReconcile: false });
    await settle();

    expect(container.querySelector('[data-commercial-dependency-state="blocked"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Select Staffing requirement for reconciliation"]').disabled)
      .toBe(true);
    expect(container.querySelector(".commercial-dependency-reconcile")).toBeNull();
    expect(container.textContent).toContain("may inspect this evidence but cannot submit");
    expect(client.reconcile).not.toHaveBeenCalled();
  });

  test("opens the owning BEO and production-checklist workspaces without reconciling", async () => {
    const openKitchenBeo = vi.fn();
    const openProductionChecklist = vi.fn();
    const beo = invalidation({
      id: BEO_ID,
      nodeId: "artifact.kitchen_beo",
      nodeKind: "artifact",
      classification: "STALE"
    });
    const productionPlan = invalidation({
      id: `cci_${"9".repeat(48)}`,
      nodeId: "artifact.production_plan",
      nodeKind: "artifact",
      classification: "STALE"
    });
    client.getState.mockResolvedValue(dependencyState("BLOCKED", {
      invalidations: [beo, productionPlan],
      totalInvalidationCount: 2,
      openInvalidationCount: 2,
      resolvedInvalidationCount: 0,
      bounds: {
        invalidationLimit: 64,
        invalidationSetComplete: true,
        returnedCount: 2,
        truncated: false
      }
    }));

    render({
      onOpenKitchenBeo: openKitchenBeo,
      onOpenProductionChecklist: openProductionChecklist
    });
    await settle();

    act(() => container.querySelector('[data-capability-action="review-kitchen-beo"]').click());
    act(() => container.querySelector('[data-capability-action="review-production-checklist"]').click());

    expect(openKitchenBeo).toHaveBeenCalledOnce();
    expect(openProductionChecklist).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("reconciliation remains a separate reviewed action");
    expect(client.reconcile).not.toHaveBeenCalled();
  });

  test("renders every literal canonical dependency read marker through exact reads", async () => {
    const initial = deferred();
    client.getState.mockReturnValueOnce(initial.promise);
    render();
    expect(container.innerHTML).toContain('data-capability-state="loading"');

    await act(async () => initial.resolve(dependencyState("READY")));
    expect(container.innerHTML).toContain('data-capability-state="success"');

    client.getState.mockResolvedValueOnce(dependencyState("NOT_GENERATED"));
    act(() => container.querySelector('[data-capability-action="refresh-commercial-dependency-state"]').click());
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="empty"');

    client.getState.mockResolvedValueOnce(dependencyState("UNKNOWN", {
      bounds: {
        invalidationLimit: 64,
        invalidationSetComplete: false,
        returnedCount: 0,
        truncated: true
      },
      latestApplyReceiptId: APPLY_ID,
      totalInvalidationCount: 65,
      openInvalidationCount: 65,
      resolvedInvalidationCount: 0,
      invalidations: [],
      safeToPublish: false,
      reasonCodes: ["invalidation_evidence_truncated"]
    }));
    act(() => container.querySelector('[data-capability-action="refresh-commercial-dependency-state"]').click());
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="partial"');

    client.getState.mockRejectedValueOnce({ code: "functions/unavailable" });
    act(() => container.querySelector('[data-capability-action="refresh-commercial-dependency-state"]').click());
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="stale"');

    act(() => root.unmount());
    root = createRoot(container);
    client.getState.mockRejectedValueOnce({ code: "functions/unavailable" });
    render();
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="error"');

    const recovery = deferred();
    client.getState.mockReturnValueOnce(recovery.promise);
    act(() => container.querySelector('[data-capability-action="refresh-commercial-dependency-state"]').click());
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    await act(async () => recovery.resolve(dependencyState("READY")));
  });

  test("renders definitive reconciliation error and real reload recovery markers", async () => {
    const reload = deferred();
    client.getState
      .mockResolvedValueOnce(dependencyState("BLOCKED"))
      .mockReturnValueOnce(reload.promise);
    client.reconcile.mockRejectedValueOnce({ code: "functions/failed-precondition" });
    render();
    await settle();

    act(() => container.querySelector('input[aria-label="Select Staffing requirement for reconciliation"]').click());
    change(container.querySelector("textarea"), "Staffing evidence was reviewed.");
    act(() => container.querySelector(".commercial-dependency-reconcile .cta").click());
    await settle();
    expect(container.innerHTML).toContain('data-capability-state="error"');

    act(() => [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Reload before another attempt").click());
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    await act(async () => reload.resolve(dependencyState("BLOCKED")));
  });
});
