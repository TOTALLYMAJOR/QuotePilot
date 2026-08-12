// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import DecisionDebtPanel, { buildDecisionDebtPresentation } from "../DecisionDebtPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function policy() {
  return {
    schemaVersion: 1,
    maxEventHorizonDays: 365,
    decisionTypes: {
      guest_count: {
        label: "Final guest count",
        lockWindowDays: 7,
        dependencyWeight: 5,
        reversibility: "constrained"
      },
      beo_finalization: {
        label: "Kitchen BEO finalization",
        lockWindowDays: 3,
        dependencyWeight: 5,
        reversibility: "irreversible"
      }
    }
  };
}

function item(overrides = {}) {
  return {
    id: `debt_${"a".repeat(40)}`,
    quoteId: "quote-a",
    customerId: "customer-a",
    sourceRevisionId: "v0014",
    decisionId: "guest-count-final",
    decisionType: "guest_count",
    label: "Final guest count",
    eventDate: "2026-08-16",
    lockDate: "2026-08-09",
    daysUntilLock: 0,
    affectedNodeIds: [
      "artifact.kitchen_beo",
      "output.authoritative_total",
      "output.staffing_requirement"
    ],
    affectedDependencyCount: 3,
    commercialExposureCents: 2500001,
    factors: {
      dependency: {
        value: 5,
        affectedDependencyCount: 3,
        source: "validated_tenant_policy_and_versioned_graph"
      },
      proximity: {
        value: 5,
        lockWindowDays: 7,
        daysUntilLock: 0,
        source: "tenant_local_calendar"
      },
      exposure: {
        value: 5,
        known: true,
        cents: 2500001,
        source: "bounded_authoritative_commercial_delta"
      },
      reversibility: {
        value: 3,
        classification: "constrained",
        source: "validated_tenant_policy"
      }
    },
    rawScore: 375,
    score: 60,
    scoreState: "KNOWN",
    urgency: "high",
    explanation: [
      "3 graph dependencies remain exposed.",
      "The 7-day lock window is due or overdue.",
      "Recorded commercial exposure is 2500001 cents.",
      "Score 60/100 uses decision-debt-score-v1; it is deterministic, not predictive AI."
    ],
    ...overrides
  };
}

function snapshot(items = [item()], overrides = {}) {
  return {
    schemaVersion: "decision-debt-snapshot-v1",
    formulaVersion: "decision-debt-score-v1",
    authority: "server_derived",
    predictive: false,
    observedAtISO: "2026-08-09T18:42:00.000Z",
    tenantTimeZone: "America/Chicago",
    tenantLocalDate: "2026-08-09",
    graph: {
      graphId: "quotepilot-commercial",
      graphVersion: "commercial-dependency-graph-v1"
    },
    policy: policy(),
    bounds: {
      candidateCount: items.length,
      eligibleCount: items.length,
      resultLimit: 50,
      returnedCount: items.length,
      truncated: false
    },
    items,
    snapshotDigest: "f".repeat(64),
    ...overrides
  };
}

let container;
let root;

function mount(element) {
  act(() => root.render(element));
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

describe("Decision Debt CWF-14 read states", () => {
  test("resolves loading, empty, success, stale, partial, and error without fabricating data", () => {
    expect(buildDecisionDebtPresentation({ loading: true }).state).toBe("loading");
    expect(buildDecisionDebtPresentation().state).toBe("empty");
    expect(buildDecisionDebtPresentation({ snapshot: snapshot() }).state).toBe("success");
    expect(buildDecisionDebtPresentation({ snapshot: snapshot(), stale: true }).state).toBe("stale");
    expect(buildDecisionDebtPresentation({
      snapshot: snapshot([item()], {
        bounds: {
          candidateCount: 2,
          eligibleCount: 2,
          resultLimit: 1,
          returnedCount: 1,
          truncated: true
        }
      })
    }).state).toBe("partial");
    expect(buildDecisionDebtPresentation({ error: "failed" }).state).toBe("error");
    expect(buildDecisionDebtPresentation({ snapshot: { predictive: true } }).state).toBe("error");
  });

  test.each([
    ["loading", { loading: true }, "Reading the current tenant-scoped"],
    ["empty", {}, "No unresolved quote decision"],
    ["success", { snapshot: snapshot() }, "server-derived snapshot is current"],
    ["stale", { snapshot: snapshot(), stale: true }, "retained snapshot remains visible"],
    ["partial", {
      snapshot: snapshot([item()], {
        bounds: {
          candidateCount: 2,
          eligibleCount: 2,
          resultLimit: 1,
          returnedCount: 1,
          truncated: true
        }
      })
    }, "hidden decisions remain unresolved"],
    ["error", { error: "read failed" }, "no retained server snapshot"]
  ])("renders canonical %s state markers and proof boundary", (state, props, expected) => {
    const markup = renderToStaticMarkup(<DecisionDebtPanel {...props} />);
    expect(markup).toContain('data-capability-id="cwf-15-decision-debt"');
    expect(markup).toContain(`data-capability-state="${state}"`);
    expect(markup).toContain(expected);
    expect(markup).toContain("no predictive AI");
    expect(markup).toContain("not accounting revenue");
    expect(markup).toContain("payment, booking, acceptance, completion, or customer-contact evidence");
  });

  test("renders every literal canonical Decision Debt read marker from real presentations", () => {
    const loading = renderToStaticMarkup(<DecisionDebtPanel loading />);
    const empty = renderToStaticMarkup(<DecisionDebtPanel />);
    const success = renderToStaticMarkup(<DecisionDebtPanel snapshot={snapshot()} />);
    const stale = renderToStaticMarkup(<DecisionDebtPanel snapshot={snapshot()} stale />);
    const partial = renderToStaticMarkup(<DecisionDebtPanel
      snapshot={snapshot([item()], {
        bounds: {
          candidateCount: 2,
          eligibleCount: 2,
          resultLimit: 1,
          returnedCount: 1,
          truncated: true
        }
      })}
    />);
    const error = renderToStaticMarkup(<DecisionDebtPanel error="read failed" />);
    const recovery = renderToStaticMarkup(
      <DecisionDebtPanel snapshot={snapshot()} stale onRetry={() => {}} />
    );

    expect(loading).toContain('data-capability-state="loading"');
    expect(loading).toContain("Loading decisions to review");
    expect(empty).toContain('data-capability-state="empty"');
    expect(success).toContain('data-capability-state="success"');
    expect(stale).toContain('data-capability-state="stale"');
    expect(partial).toContain('data-capability-state="partial"');
    expect(error).toContain('data-capability-state="error"');
    expect(recovery).toContain('data-capability-state="recovery"');
  });

  test("retains stale evidence and exposes an explicit retry without claiming refresh success", () => {
    const onRetry = vi.fn();
    mount(<DecisionDebtPanel snapshot={snapshot()} error="network failed" onRetry={onRetry} />);

    expect(container.querySelector('[data-capability-state="stale"]')).toBeTruthy();
    expect(container.querySelector('[data-retained-snapshot="stale"]')).toBeTruthy();
    const retry = container.querySelector('[data-capability-action="retry-decision-debt"]');
    expect(retry?.getAttribute("data-capability-state")).toBe("recovery");
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("Decision Debt deterministic explanation", () => {
  test("shows every factor, source, equation, dependency, bound, and non-accounting exposure", () => {
    const markup = renderToStaticMarkup(<DecisionDebtPanel snapshot={snapshot()} />);

    expect(markup).toContain("Priority score");
    expect(markup).toContain("60 / 100");
    expect(markup).toContain("$25,000.01");
    expect(markup).toContain("Not accounting revenue or a receivable");
    expect(markup).toContain('data-decision-debt-factor="dependency"');
    expect(markup).toContain('data-decision-debt-factor="proximity"');
    expect(markup).toContain('data-decision-debt-factor="exposure"');
    expect(markup).toContain('data-decision-debt-factor="reversibility"');
    expect(markup).toContain("5 × 5 × 5 × 3 = raw 375 → normalized 60/100");
    expect(markup).toContain('data-dependency-node="artifact.kitchen_beo"');
    expect(markup).toContain('data-dependency-node="output.authoritative_total"');
    expect(markup).toContain("3 affected dependencies");
    expect(markup).toContain("Graph commercial-dependency-graph-v1");
    expect(markup).toContain("Formula decision-debt-score-v1");
    expect(markup).toContain('data-decision-type="guest_count"');
    expect(markup).toContain("7-day lock");
  });

  test("keeps unknown exposure unavailable instead of coercing it to zero", () => {
    const unknown = item({
      commercialExposureCents: null,
      factors: {
        ...item().factors,
        exposure: {
          value: null,
          known: false,
          cents: null,
          source: "bounded_authoritative_commercial_delta"
        }
      },
      rawScore: null,
      score: null,
      scoreState: "UNKNOWN",
      urgency: null
    });
    const markup = renderToStaticMarkup(<DecisionDebtPanel snapshot={snapshot([unknown])} />);
    expect(markup).toContain("Quote amount affected is unavailable—not zero");
    expect(markup).toContain("<strong>Unavailable</strong>");
    expect(markup).toContain("Priority unknown");
    expect(markup).toContain("no exposure factor, raw score, normalized score, or urgency has been guessed");
    expect(markup).not.toContain("Unknown×");
    expect(markup).not.toContain(" / 100");
    expect(markup).not.toContain("$0.00");
  });

  test("opens only the authoritative quote callback with the selected item", () => {
    const onOpenQuote = vi.fn();
    const selected = item();
    mount(<DecisionDebtPanel snapshot={snapshot([selected])} onOpenQuote={onOpenQuote} />);
    const button = container.querySelector('[data-capability-action="open-decision-debt-quote"]');
    act(() => button.click());
    expect(onOpenQuote).toHaveBeenCalledWith("quote-a", selected);
  });
});

describe("Decision Debt admin policy mutation states", () => {
  test.each([
    ["ready", "No decision-priority policy change"],
    ["submitting", "exact policy request is in flight"],
    ["uncertain", "Reconcile the unchanged request"],
    ["reconciliation", "checking the same request identity"],
    ["receipt", "does not resolve any underlying decision"],
    ["error", "No successful policy change is assumed"],
    ["recovery", "safely reset"]
  ])("renders the exact %s mutation marker and proof-safe copy", (state, expected) => {
    const markup = renderToStaticMarkup(
      <DecisionDebtPanel
        snapshot={{ snapshot: snapshot(), policyVersion: "decision-debt-policy-v7" }}
        mutation={{ state }}
        isAdmin
      />
    );
    expect(markup).toContain(`data-mutation-state="${state}"`);
    expect(markup).toContain(expected);
  });

  test("renders every literal canonical Decision Debt policy mutation marker", () => {
    const renderMutation = (state) => renderToStaticMarkup(
      <DecisionDebtPanel
        snapshot={{ snapshot: snapshot(), policyVersion: "decision-debt-policy-v7" }}
        mutation={{ state }}
        isAdmin
      />
    );

    expect(renderMutation("ready")).toContain('data-capability-state="ready"');
    expect(renderMutation("submitting")).toContain('data-capability-state="submitting"');
    expect(renderMutation("uncertain")).toContain('data-capability-state="uncertain"');
    expect(renderMutation("reconciliation")).toContain('data-capability-state="reconciliation"');
    expect(renderMutation("receipt")).toContain('data-capability-state="receipt"');
    expect(renderMutation("error")).toContain('data-capability-state="error"');
    expect(renderMutation("recovery")).toContain('data-capability-state="recovery"');
  });

  test("keeps configuration admin-only and saves an edited policy against the displayed server version", () => {
    const staffMarkup = renderToStaticMarkup(
      <DecisionDebtPanel snapshot={snapshot()} isAdmin={false} onConfigurePolicy={() => {}} />
    );
    expect(staffMarkup).toContain('data-policy-authority="admin-only"');
    expect(staffMarkup).not.toContain('data-capability-action="configure-decision-debt-policy"');

    const onConfigurePolicy = vi.fn();
    mount(
      <DecisionDebtPanel
        snapshot={{ snapshot: snapshot(), policyVersion: "decision-debt-policy-v7" }}
        isAdmin
        onConfigurePolicy={onConfigurePolicy}
      />
    );
    const configure = container.querySelector('[data-capability-action="configure-decision-debt-policy"]');
    expect(configure.disabled).toBe(false);
    act(() => configure.click());
    expect(container.querySelector('[data-capability-id="cwf-15-decision-debt-policy-editor"]')).toBeTruthy();
    const lockWindow = container.querySelector('[aria-label="Final guest count lock window days"]');
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      valueSetter.call(lockWindow, "9");
      lockWindow.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = container.querySelector('[data-capability-action="save-decision-debt-policy"]');
    act(() => save.click());
    expect(onConfigurePolicy).toHaveBeenCalledWith({
      policy: {
        ...policy(),
        decisionTypes: {
          ...policy().decisionTypes,
          guest_count: {
            ...policy().decisionTypes.guest_count,
            lockWindowDays: 9
          }
        }
      },
      expectedPolicyVersion: "decision-debt-policy-v7"
    });
  });

  test("locks duplicate configuration while busy and exposes exact reconcile/reset controls", () => {
    const submitting = renderToStaticMarkup(
      <DecisionDebtPanel snapshot={snapshot()} isAdmin mutation={{ state: "submitting" }} />
    );
    expect(submitting).toContain('data-capability-action="configure-decision-debt-policy"');
    expect(submitting).toContain("disabled");

    const onReconcilePolicy = vi.fn();
    const onResetMutation = vi.fn();
    mount(
      <DecisionDebtPanel
        snapshot={snapshot()}
        isAdmin
        mutation={{ state: "uncertain", requestId: "request-a" }}
        onReconcilePolicy={onReconcilePolicy}
        onResetMutation={onResetMutation}
      />
    );
    const reconcile = container.querySelector('[data-capability-action="reconcile-decision-debt-policy"]');
    act(() => reconcile.click());
    expect(onReconcilePolicy).toHaveBeenCalledWith(expect.objectContaining({
      state: "uncertain",
      requestId: "request-a"
    }));

    mount(
      <DecisionDebtPanel
        snapshot={snapshot()}
        isAdmin
        mutation={{ state: "error", requestId: "request-b", error: "policy rejected" }}
        onResetMutation={onResetMutation}
      />
    );
    const reset = container.querySelector('[data-capability-action="reset-decision-debt-policy"]');
    act(() => reset.click());
    expect(onResetMutation).toHaveBeenCalledWith(expect.objectContaining({
      state: "error",
      requestId: "request-b"
    }));
    expect(container.textContent).toContain("policy rejected");
  });
});
