// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDecisionDebtSnapshot: vi.fn()
}));

vi.mock("../../lib/decisionDebtClient", () => ({
  getDecisionDebtSnapshot: mocks.getDecisionDebtSnapshot
}));

import QuoteDecisionDebtPanel from "../QuoteDecisionDebtPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function result(items = []) {
  return {
    ok: true,
    storage: "firebase",
    organizationId: "org-a",
    quoteId: "quote-a",
    policyVersion: "decision-debt-policy-v1",
    snapshot: {
      schemaVersion: "decision-debt-snapshot-v1",
      formulaVersion: "decision-debt-score-v1",
      authority: "server_derived",
      predictive: false,
      observedAtISO: "2026-08-09T17:00:00.000Z",
      tenantTimeZone: "America/Chicago",
      tenantLocalDate: "2026-08-09",
      graph: {
        graphId: "quotepilot-commercial",
        graphVersion: "commercial-dependency-graph-v1"
      },
      policy: {
        schemaVersion: 1,
        maxEventHorizonDays: 365,
        decisionTypes: {}
      },
      bounds: {
        candidateCount: items.length,
        eligibleCount: items.length,
        resultLimit: 25,
        returnedCount: items.length,
        truncated: false
      },
      items,
      snapshotDigest: "f".repeat(64)
    }
  };
}

let container;
let root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("exact quote Decision Debt surface", () => {
  test("reads only the exact tenant/quote scope and renders an empty authoritative result", async () => {
    const readResult = result();
    const onReadStateChange = vi.fn();
    mocks.getDecisionDebtSnapshot.mockResolvedValue(readResult);
    await act(async () => {
      root.render(
        <QuoteDecisionDebtPanel
          organizationId="org-a"
          quoteId="quote-a"
          timeZone="America/Chicago"
          onReadStateChange={onReadStateChange}
        />
      );
    });

    expect(mocks.getDecisionDebtSnapshot).toHaveBeenCalledWith({
      organizationId: "org-a",
      quoteId: "quote-a",
      limit: 25
    });
    expect(container.querySelector(
      '[data-capability-id="cwf-15-decision-debt-quote-record"]'
    )).toBeTruthy();
    expect(container.querySelector('[data-capability-state="empty"]')).toBeTruthy();
    expect(container.textContent).toContain("No quote decisions need review right now");
    expect(container.querySelector('[data-decision-debt-policy]')).toBeFalsy();
    expect(container.querySelector('[data-capability-action="configure-decision-debt-policy"]')).toBeFalsy();
    expect(onReadStateChange).toHaveBeenLastCalledWith({
      organizationId: "org-a",
      quoteId: "quote-a",
      loading: false,
      stale: false,
      error: "",
      result: readResult
    });
  });

  test("fails closed without a connected scope and never invokes the callable", async () => {
    await act(async () => {
      root.render(
        <QuoteDecisionDebtPanel organizationId="" quoteId="quote-a" available={false} />
      );
    });

    expect(mocks.getDecisionDebtSnapshot).not.toHaveBeenCalled();
    expect(container.querySelector('[data-capability-state="error"]')).toBeTruthy();
    expect(container.textContent).toContain("Connect this quote to review");
  });

  test("shows the configuration action without invoking the callable when tenant time zone is missing", async () => {
    const onReadStateChange = vi.fn();
    await act(async () => {
      root.render(
        <QuoteDecisionDebtPanel
          organizationId="org-a"
          quoteId="quote-a"
          timeZone=""
          onReadStateChange={onReadStateChange}
        />
      );
    });

    expect(mocks.getDecisionDebtSnapshot).not.toHaveBeenCalled();
    expect(container.querySelector('[data-capability-state="error"]')).toBeTruthy();
    expect(container.textContent).toContain("Set a valid IANA time zone");
    expect(onReadStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      loading: false,
      stale: false,
      result: null
    }));
  });

  test("opens Workflow with the exact Decision Debt quote and item identity", async () => {
    const onOpenWorkflow = vi.fn();
    mocks.getDecisionDebtSnapshot.mockResolvedValue(result([{
      id: "debt-guest-count",
      quoteId: "quote-a",
      decisionType: "guest_count",
      label: "Final guest count",
      urgency: "high",
      eventDate: "2026-08-20",
      lockDate: "2026-08-13",
      daysUntilLock: 4,
      score: 84,
      rawScore: 84,
      commercialExposureCents: 110000,
      affectedNodeIds: ["artifact.kitchen_beo"],
      factors: {},
      explanation: [],
      sourceRevisionId: "version-1"
    }]));
    await act(async () => {
      root.render(
        <QuoteDecisionDebtPanel
          organizationId="org-a"
          quoteId="quote-a"
          timeZone="America/Chicago"
          onOpenWorkflow={onOpenWorkflow}
        />
      );
    });

    const button = container.querySelector('[data-capability-action="open-decision-debt-workflow"]');
    expect(button).toBeTruthy();
    act(() => button.click());
    expect(onOpenWorkflow).toHaveBeenCalledWith({
      quoteId: "quote-a",
      attentionType: "decision_debt",
      requestId: "debt-guest-count"
    });
  });
});
