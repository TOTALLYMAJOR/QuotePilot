// @vitest-environment jsdom

import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import OperationalStaffingPanel from "../OperationalStaffingPanel";

const client = vi.hoisted(() => ({
  applyOperationalStaffingPlan: vi.fn(),
  buildOperationalStaffingRequestId: vi.fn(),
  configureOperationalStaffProfile: vi.fn(),
  getOperationalStaffingSnapshot: vi.fn(),
  isDefinitiveOperationalStaffingError: vi.fn(),
  readPendingOperationalStaffingAttempt: vi.fn(),
  resetDefinitiveOperationalStaffingAttempt: vi.fn()
}));

vi.mock("../../lib/operationalStaffingClient", () => ({
  OPERATIONAL_STAFFING_OPERATIONS: {
    CONFIGURE_PROFILE: "configure_profile",
    APPLY_PLAN: "apply_plan"
  },
  ...client
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SCOPE = Object.freeze({ organizationId: "org-one", quoteId: "quote-one" });
const EVENT_WINDOW = Object.freeze({
  startAtISO: "2026-08-18T22:00:00.000Z",
  endAtISO: "2026-08-19T04:00:00.000Z"
});
const REQUIREMENTS = Object.freeze({ lead: 0, server: 1, chef: 0, bartender: 0 });
const FENCE_ID = `osf_${"a".repeat(48)}`;
const REQUEST_ID = `op_staff_plan_${"b".repeat(32)}`;
const PROFILE_REQUEST_ID = `op_staff_profile_${"c".repeat(32)}`;

function profile(overrides = {}) {
  return {
    schemaVersion: 1,
    authority: "server_authoritative",
    organizationId: SCOPE.organizationId,
    staffId: "staff-one",
    displayName: "Avery Cook",
    active: true,
    capabilities: ["lead", "server"],
    revision: 3,
    availabilityWindows: [{
      availabilityId: "availability-one",
      source: "operator_recorded",
      state: "available",
      ...EVENT_WINDOW
    }],
    availabilityBoundary: "operator recorded only",
    ...overrides
  };
}

function plan(assignments = [], overrides = {}) {
  const byRole = Object.fromEntries(["lead", "server", "chef", "bartender"].map((role) => {
    const quotedCount = REQUIREMENTS[role];
    const operatorConfirmedCount = assignments.filter((item) => item.role === role).length;
    return [role, {
      quotedCount,
      operatorConfirmedCount,
      gap: Math.max(0, quotedCount - operatorConfirmedCount)
    }];
  }));
  const totalGap = Object.values(byRole).reduce((total, item) => total + item.gap, 0);
  return {
    schemaVersion: 1,
    authority: "server_authoritative",
    ...SCOPE,
    quoteRevisionId: "version-seven",
    planRevision: 1,
    eventWindow: EVENT_WINDOW,
    state: totalGap ? "attention" : "coverage_confirmed",
    requirements: {
      source: "commercial_quote_copy",
      byRole: REQUIREMENTS,
      boundary: "commercial copy only"
    },
    coverage: {
      state: totalGap ? "attention" : "coverage_confirmed",
      byRole,
      totalQuotedCount: 1,
      totalOperatorConfirmedCount: assignments.length,
      totalGap,
      boundary: "coverage only"
    },
    assignments,
    assignmentState: "operator_confirmed",
    assignmentBoundary: "operator recorded only",
    ...overrides
  };
}

function envelope(state = "empty", overrides = {}) {
  const staffingPlan = Object.prototype.hasOwnProperty.call(overrides, "snapshot")
    ? overrides.snapshot
    : state === "empty" ? null : plan([]);
  return {
    ok: true,
    storage: "firebase",
    authorityVersion: "operational-staffing-authority-v1",
    ...SCOPE,
    activeQuoteRevisionId: "version-seven",
    canonicalEventWindow: EVENT_WINDOW,
    canonicalRequirements: REQUIREMENTS,
    observedAtISO: "2026-08-11T20:00:00.000Z",
    state,
    reasonCodes: [],
    profiles: [profile()],
    profilesTruncated: state === "partial",
    expectedScheduleFences: [{
      fenceId: FENCE_ID,
      staffId: "staff-one",
      utcDate: "2026-08-18",
      revision: 2
    }],
    scheduleFencesTruncated: false,
    snapshot: staffingPlan,
    ...overrides
  };
}

function assignment() {
  return {
    assignmentId: "staffing-server-1",
    staffId: "staff-one",
    displayName: "Avery Cook",
    role: "server",
    staffRevision: 3,
    state: "operator_confirmed"
  };
}

function planResult(command, overrides = {}) {
  const snapshot = plan(command.assignments.map((item) => ({
    assignmentId: item.assignmentId,
    staffId: item.staffId,
    displayName: "Avery Cook",
    role: item.role,
    staffRevision: item.expectedStaffRevision,
    state: "operator_confirmed"
  })));
  return {
    ok: true,
    storage: "firebase",
    ...SCOPE,
    idempotent: false,
    mutationMode: "submitting",
    snapshot,
    receipt: {
      receiptId: `osr_${"d".repeat(48)}`,
      requestId: command.requestId,
      recordedAtISO: "2026-08-11T20:01:00.000Z"
    },
    ...overrides
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

function mount(props = {}) {
  act(() => {
    root.render(
      <OperationalStaffingPanel
        open
        organizationId={SCOPE.organizationId}
        quote={{ id: SCOPE.quoteId, event: { servers: 1, chefs: 0, bartenders: 0 } }}
        source="firebase"
        role="sales"
        available
        {...props}
      />
    );
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function click(element) {
  await act(async () => {
    element.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function stateMarker(state) {
  return container.querySelector(`[data-capability-id="authoritative-operational-staffing"][data-capability-state="${state}"]`);
}

function selectServer() {
  const select = container.querySelector('select[aria-label="Required server assignment"]');
  if (!select) {
    const assignOnlyCandidate = Array.from(container.querySelectorAll("button"))
      .find((button) => (
        button.textContent === "Assign Avery Cook"
        && button.closest('[data-adaptive-choice-mode="suggested"]')?.textContent.includes("Required server assignment")
      ));
    expect(assignOnlyCandidate).not.toBeUndefined();
    act(() => assignOnlyCandidate.click());
    return container.querySelector('[data-adaptive-choice-mode="single"]');
  }
  act(() => {
    select.value = "staff-one";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return select;
}

beforeEach(() => {
  vi.clearAllMocks();
  client.buildOperationalStaffingRequestId.mockImplementation((operation) => (
    operation === "configure_profile" ? PROFILE_REQUEST_ID : REQUEST_ID
  ));
  client.readPendingOperationalStaffingAttempt.mockReturnValue(null);
  client.resetDefinitiveOperationalStaffingAttempt.mockReturnValue(true);
  client.isDefinitiveOperationalStaffingError.mockReturnValue(false);
  client.getOperationalStaffingSnapshot.mockResolvedValue(envelope());
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OperationalStaffingPanel read authority", () => {
  test("renders nothing while closed and never performs a hidden read", () => {
    mount({ open: false });
    expect(container.innerHTML).toBe("");
    expect(client.getOperationalStaffingSnapshot).not.toHaveBeenCalled();
  });

  test("marks loading, empty, success, stale, partial, error, and recovery literally", async () => {
    const first = deferred();
    client.getOperationalStaffingSnapshot.mockReturnValueOnce(first.promise);
    mount();
    expect(stateMarker("loading")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="loading"');

    first.resolve(envelope("empty"));
    await flush();
    expect(stateMarker("empty")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="empty"');

    client.getOperationalStaffingSnapshot.mockResolvedValueOnce(envelope("current", {
      quoteId: "quote-two",
      snapshot: plan([assignment()], { quoteId: "quote-two" })
    }));
    // A remount provides a fresh tenant-scoped read without relying on a hidden refresh control.
    mount({ quote: { id: "quote-two", event: {} } });
    await flush();
    expect(stateMarker("success")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="success"');

    client.getOperationalStaffingSnapshot.mockResolvedValueOnce(envelope("stale", {
      quoteId: "quote-three",
      snapshot: plan([], { quoteId: "quote-three", quoteRevisionId: "version-six" })
    }));
    mount({ quote: { id: "quote-three", event: {} } });
    await flush();
    expect(stateMarker("stale")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="stale"');

    client.getOperationalStaffingSnapshot.mockResolvedValueOnce(envelope("partial", { quoteId: "quote-four" }));
    mount({ quote: { id: "quote-four", event: {} } });
    await flush();
    expect(stateMarker("partial")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="partial"');

    client.getOperationalStaffingSnapshot.mockRejectedValueOnce(new Error("read unavailable"));
    mount({ quote: { id: "quote-five", event: {} } });
    await flush();
    expect(stateMarker("error")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="error"');

    const retry = deferred();
    client.getOperationalStaffingSnapshot.mockReturnValueOnce(retry.promise);
    await click(container.querySelector(".operational-staffing-state--error button"));
    expect(stateMarker("recovery")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    retry.resolve(envelope("empty", { quoteId: "quote-five" }));
    await flush();
    expect(stateMarker("empty")).not.toBeNull();
  });

  test("uses only exact tenant and quote scope and separates requirements from fulfillment", async () => {
    client.getOperationalStaffingSnapshot.mockResolvedValue(envelope("current", {
      snapshot: plan([assignment()])
    }));
    mount();
    await flush();

    expect(client.getOperationalStaffingSnapshot).toHaveBeenCalledWith(SCOPE);
    expect(container.textContent).toContain("Staffing plan");
    expect(container.textContent).toContain("For this organization");
    expect(container.textContent).toContain("Quoted staffing");
    expect(container.textContent).toContain("Still needed");
    expect(container.textContent).toContain("Team roster");
    expect(container.textContent).toContain("Roles included in this quote");
    expect(container.textContent).toContain("1 assigned of 1 quoted");
    expect(container.textContent).toContain("does not confirm that the team member acknowledged it");
    expect(container.textContent).not.toContain("event ready");
  });

  test.each([
    ["stale", "different quote revision"],
    ["partial", "truncated bounded evidence"]
  ])("fails %s evidence closed and disables apply", async (state) => {
    client.getOperationalStaffingSnapshot.mockResolvedValue(envelope(state));
    mount();
    await flush();
    expect(container.innerHTML).toContain('data-capability-state="ready"');
    const apply = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save staffing assignments"));
    expect(apply.disabled).toBe(true);
    expect(stateMarker(state)).not.toBeNull();
  });
});

describe("OperationalStaffingPanel role and fallback boundaries", () => {
  test("renders staffing candidate zero, one, and many states without silently assigning the only candidate", async () => {
    client.getOperationalStaffingSnapshot.mockResolvedValueOnce(envelope("empty", { profiles: [] }));
    mount();
    await flush();
    expect(container.querySelector('[data-adaptive-choice-mode="empty"]')).not.toBeNull();
    expect(container.textContent).toContain("No active server candidates have recorded availability");
    expect(container.querySelector('[data-field-state-primary="blocked"]')).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    client.getOperationalStaffingSnapshot.mockResolvedValueOnce(envelope());
    mount();
    await flush();
    expect(container.querySelector('[data-adaptive-choice-mode="suggested"]')).not.toBeNull();
    expect(container.textContent).toContain("This is a candidate only");
    expect(container.querySelector('select[aria-label="Required server assignment"]')).toBeNull();
    selectServer();
    expect(container.querySelector('[data-adaptive-choice-mode="single"]')).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    client.getOperationalStaffingSnapshot.mockResolvedValueOnce(envelope("empty", {
      profiles: [profile(), profile({ staffId: "staff-two", displayName: "Morgan Lead" })]
    }));
    mount();
    await flush();
    expect(container.querySelectorAll('[data-adaptive-choice-mode="select"]')).toHaveLength(2);
    expect(container.querySelectorAll(".operational-staffing-slot select")[0].querySelectorAll("option").length).toBe(3);
  });

  test.each([
    ["local", "admin"],
    ["firebase", "customer"]
  ])("renders local_draft only for source %s and role %s", (source, role) => {
    mount({ source, role });
    const panel = container.querySelector('[data-authority="local_draft"]');
    expect(panel).not.toBeNull();
    expect(stateMarker("partial")).not.toBeNull();
    expect(panel.textContent).toContain("cannot confirm team availability");
    expect(panel.textContent).not.toContain("operator-confirmed assignments recorded");
    expect(panel.textContent).not.toContain("Receipt osr_");
    expect(client.getOperationalStaffingSnapshot).not.toHaveBeenCalled();
  });

  test("lets sales read and apply but withholds profile configuration", async () => {
    mount({ role: "sales" });
    await flush();
    expect(container.textContent).toContain("Save staffing assignments");
    expect(container.textContent).not.toContain("Add team member");
    expect(container.textContent).toContain("Recorded availability covers this event");
  });

  test("lets admin add a bounded profile and sends the exact nested DTO", async () => {
    client.configureOperationalStaffProfile.mockImplementation(async (command) => ({
      ok: true,
      storage: "firebase",
      organizationId: SCOPE.organizationId,
      staffId: command.staffId,
      idempotent: false,
      mutationMode: "submitting",
      snapshot: profile({
        staffId: command.staffId,
        displayName: command.profile.displayName,
        capabilities: command.profile.capabilities,
        availabilityWindows: command.profile.availabilityWindows,
        revision: 1
      }),
      receipt: {
        receiptId: `ospr_${"e".repeat(48)}`,
        requestId: command.requestId
      }
    }));
    mount({ role: "admin" });
    await flush();
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Add team member"));
    const name = container.querySelector('input[aria-label="Display name"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(name, "Morgan Lead");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save team member"));

    expect(client.configureOperationalStaffProfile).toHaveBeenCalledTimes(1);
    const command = client.configureOperationalStaffProfile.mock.calls[0][0];
    expect(command).toEqual({
      requestId: PROFILE_REQUEST_ID,
      organizationId: SCOPE.organizationId,
      staffId: expect.stringMatching(/^staff_/),
      expectedRevision: 0,
      profile: {
        displayName: "Morgan Lead",
        active: true,
        capabilities: ["server"],
        availabilityWindows: [{
          availabilityId: expect.stringMatching(/^availability_/),
          source: "operator_recorded",
          state: "available",
          ...EVENT_WINDOW
        }]
      }
    });
  });

  test("keeps an added availability window blank and blocks overlapping or incomplete evidence", async () => {
    mount({ role: "admin" });
    await flush();
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Add team member"));
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Add availability window"));

    const windows = container.querySelectorAll(".operational-staffing-window");
    const addedInputs = windows[1].querySelectorAll('input[type="datetime-local"]');
    expect(addedInputs[0].value).toBe("");
    expect(addedInputs[1].value).toBe("");
    expect(container.textContent).toContain("windows may not overlap");
    expect(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save team member").disabled).toBe(true);
  });
});

describe("OperationalStaffingPanel mutation authority", () => {
  test("marks current mutation controls ready before a command", async () => {
    mount();
    await flush();
    expect(container.innerHTML).toContain('data-capability-state="ready"');
    expect(stateMarker("ready")).not.toBeNull();
  });

  test("sends exact server-projected inputs, selected assignment revisions, and relevant fence evidence", async () => {
    client.applyOperationalStaffingPlan.mockImplementation(async (command) => planResult(command));
    mount();
    await flush();
    selectServer();
    const apply = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save staffing assignments"));
    expect(apply.disabled).toBe(false);
    await click(apply);

    expect(client.applyOperationalStaffingPlan).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      ...SCOPE,
      expectedQuoteRevisionId: "version-seven",
      expectedPlanRevision: 0,
      eventWindow: EVENT_WINDOW,
      requirements: REQUIREMENTS,
      assignments: [{
        assignmentId: "staffing-server-1",
        staffId: "staff-one",
        role: "server",
        expectedStaffRevision: 3,
        state: "operator_confirmed"
      }],
      expectedScheduleFences: [{ fenceId: FENCE_ID, revision: 2 }]
    });
    expect(stateMarker("receipt")).not.toBeNull();
    expect(container.textContent).toContain("does not mean team members acknowledged or will attend");
  });

  test("records a partial plan with explicit gaps instead of requiring fabricated completeness", async () => {
    client.applyOperationalStaffingPlan.mockImplementation(async (command) => planResult(command));
    mount();
    await flush();
    const apply = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save staffing assignments"));
    expect(container.textContent).toContain("Roles left unfilled will stay visible under Still needed");
    expect(apply.disabled).toBe(false);
    await click(apply);

    expect(client.applyOperationalStaffingPlan.mock.calls[0][0]).toMatchObject({
      requirements: REQUIREMENTS,
      assignments: [],
      expectedScheduleFences: []
    });
  });

  test("refreshes schedule-fence revisions after a receipt before allowing another command", async () => {
    const confirmed = plan([assignment()]);
    client.getOperationalStaffingSnapshot.mockReset()
      .mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce(envelope("current", {
        snapshot: confirmed,
        expectedScheduleFences: [{
          fenceId: FENCE_ID,
          staffId: "staff-one",
          utcDate: "2026-08-18",
          revision: 3
        }]
      }))
      .mockResolvedValue(envelope("current", {
        snapshot: confirmed,
        expectedScheduleFences: [{
          fenceId: FENCE_ID,
          staffId: "staff-one",
          utcDate: "2026-08-18",
          revision: 4
        }]
      }));
    client.buildOperationalStaffingRequestId
      .mockReturnValueOnce(`op_staff_plan_${"1".repeat(32)}`)
      .mockReturnValueOnce(`op_staff_plan_${"2".repeat(32)}`);
    client.applyOperationalStaffingPlan.mockImplementation(async (command) => planResult(command));
    mount();
    await flush();
    selectServer();
    let apply = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save staffing assignments"));
    await click(apply);
    await flush();
    expect(client.getOperationalStaffingSnapshot).toHaveBeenCalledTimes(2);

    apply = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save staffing assignments"));
    await click(apply);
    expect(client.applyOperationalStaffingPlan.mock.calls[1][0]).toMatchObject({
      requestId: `op_staff_plan_${"2".repeat(32)}`,
      expectedPlanRevision: 1,
      expectedScheduleFences: [{ fenceId: FENCE_ID, revision: 3 }]
    });
  });

  test("marks submitting then preserves one request and exact DTO through uncertainty and reconciliation", async () => {
    const first = deferred();
    client.applyOperationalStaffingPlan.mockReturnValueOnce(first.promise);
    mount();
    await flush();
    selectServer();
    const apply = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save staffing assignments"));
    await click(apply);
    expect(stateMarker("submitting")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="submitting"');

    first.reject(Object.assign(new Error("No staffing change can be claimed; reconcile unchanged."), {
      code: "unavailable"
    }));
    await flush();
    expect(stateMarker("uncertain")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="uncertain"');
    const original = client.applyOperationalStaffingPlan.mock.calls[0][0];
    const replay = deferred();
    client.applyOperationalStaffingPlan.mockReturnValueOnce(replay.promise);
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Check previous save"));
    expect(stateMarker("reconciliation")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="reconciliation"');
    expect(client.applyOperationalStaffingPlan.mock.calls[1][0]).toEqual(original);
    expect(client.applyOperationalStaffingPlan.mock.calls[1][0]).toBe(original);

    replay.resolve(planResult(original, { idempotent: true, mutationMode: "reconciliation" }));
    await flush();
    expect(stateMarker("receipt")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="receipt"');
    expect(container.textContent).toContain("matched the previous save");
  });

  test("marks a definitive rejection as error and exposes an explicit recovery reset", async () => {
    client.applyOperationalStaffingPlan.mockRejectedValue(Object.assign(new Error("Your current role cannot apply this staffing plan."), {
      code: "permission-denied"
    }));
    client.isDefinitiveOperationalStaffingError.mockReturnValue(true);
    mount();
    await flush();
    selectServer();
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save staffing assignments")));
    expect(stateMarker("error")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="error"');
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Try again"));

    expect(client.resetDefinitiveOperationalStaffingAttempt).toHaveBeenCalledWith({
      operation: "apply_plan",
      ...SCOPE,
      requestId: REQUEST_ID
    });
    expect(stateMarker("recovery")).not.toBeNull();
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    expect(container.textContent).toContain("Refresh the staffing plan");
  });

  test("surfaces a retained unresolved request on entry without enabling changed controls", async () => {
    const pending = {
      operation: "apply_plan",
      requestId: REQUEST_ID,
      payload: {
        ...SCOPE,
        expectedQuoteRevisionId: "version-seven",
        expectedPlanRevision: 0,
        eventWindow: EVENT_WINDOW,
        requirements: REQUIREMENTS,
        assignments: [],
        expectedScheduleFences: []
      },
      error: "Outcome unknown.",
      definitive: false
    };
    client.readPendingOperationalStaffingAttempt.mockReturnValue(pending);
    mount();
    await flush();
    expect(stateMarker("uncertain")).not.toBeNull();
    expect(container.querySelector('[data-adaptive-choice-mode="suggested"]')).not.toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Assign Avery Cook")).toBe(false);
    expect(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save staffing assignments").disabled).toBe(true);
  });

  test("restores an uncertain profile command after unmount and reconciles the identical identity", async () => {
    client.configureOperationalStaffProfile
      .mockRejectedValueOnce(Object.assign(new Error("No definitive profile receipt."), { code: "unavailable" }))
      .mockImplementationOnce(async (command) => ({
        ok: true,
        storage: "firebase",
        organizationId: SCOPE.organizationId,
        staffId: command.staffId,
        idempotent: true,
        mutationMode: "reconciliation",
        snapshot: profile({ staffId: command.staffId, revision: 1 }),
        receipt: { receiptId: `ospr_${"f".repeat(48)}`, requestId: command.requestId }
      }));
    mount({ role: "admin" });
    await flush();
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Add team member"));
    const name = container.querySelector('input[aria-label="Display name"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(name, "Casey Crew");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save team member"));
    expect(stateMarker("uncertain")).not.toBeNull();
    const original = client.configureOperationalStaffProfile.mock.calls[0][0];

    act(() => root.unmount());
    root = createRoot(container);
    mount({ role: "admin" });
    await flush();
    expect(stateMarker("uncertain")).not.toBeNull();
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Check previous save"));
    expect(client.configureOperationalStaffProfile.mock.calls[1][0]).toEqual(original);
    expect(client.configureOperationalStaffProfile.mock.calls[1][0].requestId).toBe(original.requestId);
    await flush();
    expect(stateMarker("receipt")).not.toBeNull();
  });

  test("does not carry an unresolved admin profile command across a role boundary", async () => {
    client.configureOperationalStaffProfile.mockRejectedValueOnce(
      Object.assign(new Error("No definitive profile receipt."), { code: "unavailable" })
    );
    mount({ role: "admin" });
    await flush();
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Add team member"));
    const name = container.querySelector('input[aria-label="Display name"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(name, "Casey Crew");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save team member"));
    expect(stateMarker("uncertain")).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    mount({ role: "sales" });
    await flush();

    expect(stateMarker("uncertain")).toBeNull();
    expect(client.configureOperationalStaffProfile).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Check previous save");
  });
});
