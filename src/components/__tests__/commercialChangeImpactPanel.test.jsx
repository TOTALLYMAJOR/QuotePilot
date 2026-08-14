import React from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import CommercialChangeImpactPanel, {
  buildCommercialChangeImpactPanelState
} from "../CommercialChangeImpactPanel";
import { COMMERCIAL_CHANGE_IMPACT_BOUNDARY } from "../../lib/commercialChangeImpact";

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL("../../App.jsx", import.meta.url)),
  "utf8"
);
const QUOTE_DRAFT_RUNTIME_SOURCE = readFileSync(
  fileURLToPath(new URL("../../lib/quoteDraftRuntime.js", import.meta.url)),
  "utf8"
);
const QUOTE_DRAFT_RUNTIME_BASE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../lib/quoteDraftRuntimeBase.js", import.meta.url)),
  "utf8"
);
const FUNCTIONS_SOURCE = readFileSync(
  fileURLToPath(new URL("../../../functions/index.js", import.meta.url)),
  "utf8"
);
function simulation(overrides = {}) {
  return {
    schemaVersion: "commercial-change-impact-v1",
    advisory: true,
    identity: {
      organizationId: "org-catering-1",
      quoteId: "quote-henderson-picnic",
      beforeRevisionId: "v0014",
      proposedRevisionId: "preview-v0015"
    },
    sources: {
      before: {
        label: "canonical_quote_revision",
        authority: "server_authoritative"
      },
      proposedAfter: {
        label: "authoritative_proposed_revision",
        authority: "server_authoritative"
      }
    },
    graph: {
      graphId: "commercial-dependency-graph-v1",
      graphVersion: "1"
    },
    factDiffs: [
      {
        nodeId: "fact.guest_count",
        before: 125,
        proposedAfter: 175
      },
      {
        nodeId: "fact.venue",
        before: { id: "venue-1", room: "Terrace" },
        proposedAfter: { id: "venue-2", room: "Ballroom" }
      }
    ],
    commercialValues: {
      currency: "USD",
      authoritativeTotal: {
        before: 12480,
        proposedAfter: 16920,
        changed: true,
        beforeSourceLabel: "canonical_pricing_snapshot",
        proposedAfterSourceLabel: "authoritative_pricing_preview",
        authority: "server_authoritative"
      },
      depositRequirement: {
        before: 3120,
        proposedAfter: 4230,
        changed: true,
        beforeSourceLabel: "canonical_pricing_snapshot",
        proposedAfterSourceLabel: "authoritative_pricing_preview",
        authority: "server_authoritative"
      }
    },
    impact: {
      rootNodeIds: ["fact.guest_count", "fact.venue"],
      dependentNodes: [
        {
          id: "output.staffing_requirement",
          kind: "output",
          distance: 1,
          triggeredBy: ["fact.guest_count"],
          advisoryClass: "REVIEW"
        },
        {
          id: "artifact.beo",
          kind: "artifact",
          distance: 1,
          triggeredBy: ["fact.guest_count", "fact.venue"],
          advisoryClass: "STALE"
        }
      ],
      counts: {
        total: 2,
        review: 1,
        stale: 1
      }
    },
    bounds: {
      declaredFactCount: 9,
      changedFactLimit: 32,
      dependentNodeLimit: 64,
      outputByteLimit: 262144
    },
    boundary: COMMERCIAL_CHANGE_IMPACT_BOUNDARY,
    ...overrides
  };
}

function emptySimulation() {
  const model = simulation();
  return {
    ...model,
    factDiffs: [],
    commercialValues: {
      ...model.commercialValues,
      authoritativeTotal: {
        ...model.commercialValues.authoritativeTotal,
        proposedAfter: model.commercialValues.authoritativeTotal.before,
        changed: false
      },
      depositRequirement: {
        ...model.commercialValues.depositRequirement,
        proposedAfter: model.commercialValues.depositRequirement.before,
        changed: false
      }
    },
    impact: {
      rootNodeIds: [],
      dependentNodes: [],
      counts: { total: 0, review: 0, stale: 0 }
    }
  };
}

function renderPanel(props = {}) {
  return renderToStaticMarkup(<CommercialChangeImpactPanel {...props} />);
}

describe("CommercialChangeImpactPanel", () => {
  test("derives every required presentation state without treating a failed refresh as current", () => {
    const model = simulation();
    const cases = [
      [{ loading: true }, "loading"],
      [{ recovering: true }, "recovery"],
      [{ model: emptySimulation() }, "empty"],
      [{ model }, "success"],
      [{ model, partial: true }, "partial"],
      [{ error: "Simulation failed." }, "error"],
      [{ model, error: "Refresh failed." }, "stale"]
    ];

    cases.forEach(([props, expected]) => {
      expect(buildCommercialChangeImpactPanelState(props).state).toBe(expected);
    });
    expect(buildCommercialChangeImpactPanelState({ model, error: "Refresh failed." }).snapshotAvailable).toBe(true);
  });

  test("shows exact before and proposed facts plus authoritative commercial deltas", () => {
    const markup = renderPanel({ model: simulation() });

    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain('data-change-fact="fact.guest_count"');
    expect(markup).toContain('data-value-side="before">125</code>');
    expect(markup).toContain('data-value-side="proposed-after">175</code>');
    expect(markup).toContain('{&quot;id&quot;:&quot;venue-1&quot;,&quot;room&quot;:&quot;Terrace&quot;}');
    expect(markup).toContain('{&quot;id&quot;:&quot;venue-2&quot;,&quot;room&quot;:&quot;Ballroom&quot;}');
    expect(markup).toContain("$12,480.00");
    expect(markup).toContain("$16,920.00");
    expect(markup).toContain(">Price change<");
    expect(markup).toContain(">Total change<");
    expect(markup).toContain("+$4,440.00");
    expect(markup).toContain("$3,120.00 → $4,230.00");
    expect(markup).toContain("+$1,110.00");
  });

  test("separates REVIEW decisions from projected STALE artifacts", () => {
    const markup = renderPanel({ model: simulation() });

    expect(markup).toContain('data-advisory-class="REVIEW"');
    expect(markup).toContain('data-dependent-node="output.staffing_requirement"');
    expect(markup).toContain(">Review<");
    expect(markup).toContain('data-advisory-class="STALE"');
    expect(markup).toContain('data-dependent-node="artifact.beo"');
    expect(markup).toContain(">Out of date<");
    expect(markup).toContain("1 to review · 1 out of date · 2 related items");
    expect(markup).toContain("Because this changed: Guest count, Venue");
  });

  test("exposes exact source, graph, revision, authority, and bound provenance", () => {
    const markup = renderPanel({ model: simulation() });

    expect(markup).toContain("quote-henderson-picnic");
    expect(markup).toContain("org-catering-1");
    expect(markup).toContain("canonical_quote_revision");
    expect(markup).toContain("authoritative_proposed_revision");
    expect(markup).toContain("server_authoritative");
    expect(markup).toContain("v0014");
    expect(markup).toContain("preview-v0015");
    expect(markup).toContain("commercial-dependency-graph-v1");
    expect(markup).toContain("2 of 32 changed inputs");
    expect(markup).toContain("2 of 64 dependents");
    expect(markup).toContain("9 tracked inputs");
    expect(markup).toContain("262,144 byte output limit");
  });

  test("keeps the simulation-only authorization, reconciliation, and publication boundary prominent", () => {
    const markup = renderPanel({ model: simulation() });

    expect(markup).toContain('data-simulation-mode="read-only-advisory"');
    expect(markup).toContain('data-simulation-boundary="authorization-reconciliation-publication"');
    expect(markup).toContain("Simulation only — authorization and reconciliation are required.");
    expect(markup).toContain("Nothing is invalidated, regenerated, or published here.");
    expect(markup).toContain(COMMERCIAL_CHANGE_IMPACT_BOUNDARY);
    expect(markup).not.toMatch(/>Authorize<|>Reconcile<|>Publish<|>Regenerate<|>Invalidate</);
  });

  test("distinguishes empty, partial, error, and stale evidence without inventing a completed result", () => {
    const empty = renderPanel({ model: emptySimulation() });
    const partial = renderPanel({ model: simulation(), partial: true });
    const error = renderPanel({ error: "Sensitive provider error." });
    const stale = renderPanel({ model: simulation(), error: "Refresh failed." });

    expect(empty).toContain('data-capability-state="empty"');
    expect(empty).toContain("no declared commercial change");
    expect(empty).toContain("No tracked input changed in this simulation.");
    expect(partial).toContain('data-capability-state="partial"');
    expect(partial).toContain('data-read-truncation="truncated"');
    expect(partial).toContain("Do not authorize or publish from this view.");
    expect(error).toContain('data-capability-state="error"');
    expect(error).toContain("staff-evidence-unavailable");
    expect(error).toContain('data-read-truncation="unknown"');
    expect(error).not.toContain("quote-henderson-picnic");
    expect(error).not.toContain("Sensitive provider error.");
    expect(stale).toContain('data-capability-state="stale"');
    expect(stale).toContain("prior completed result remains visible and may be stale");
    expect(stale).toContain("quote-henderson-picnic");
  });

  test("supports only the optional return-to-edit action", () => {
    const onReturnToEdit = vi.fn();
    const markup = renderPanel({
      model: simulation(),
      onReturnToEdit
    });
    expect(markup).toContain('data-capability-action="return-to-edit"');
    expect(markup.match(/<button/gu)).toHaveLength(1);
    expect(renderPanel({ model: simulation() })).not.toContain("<button");
  });

  test("keeps a prior result visible while a replacement simulation is loading", () => {
    const markup = renderPanel({ model: simulation(), loading: true });

    expect(markup).toContain('data-capability-state="loading"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("the prior completed result remains visible");
    expect(markup).toContain("fact.guest_count");
  });

  test("exposes a canonical recovery state while retrying authoritative simulation", () => {
    const markup = renderPanel({ model: simulation(), loading: true, recovering: true });

    expect(markup).toContain('data-capability-state="recovery"');
    expect(markup).toContain("Retrying the authoritative simulation");
    expect(markup).toContain('aria-busy="true"');
  });

  test("offers an explicit retry control after a failed simulation", () => {
    const onRetry = vi.fn();
    const markup = renderPanel({ error: "Unavailable", onRetry });
    expect(markup).toContain('data-capability-action="retry-simulation"');
    expect(markup.match(/<button/gu)).toHaveLength(1);
  });

  test("presents dormant authority as receipt-backed review without unsafe mutation controls", () => {
    const markup = renderPanel({
      model: simulation(),
      authorityState: "dormant",
      authorizationRequired: true,
      scopeCurrent: true
    });

    expect(markup).toContain('data-capability-id="cwf-15c-commercial-change-authority"');
    expect(markup).toContain('data-authority-state="dormant"');
    expect(markup).toContain("enforcement is dormant");
    expect(markup).not.toContain("Authorize exact change");
    expect(markup).not.toContain("Apply authorized change");
  });

  test("renders every literal canonical Commercial Change Authority mutation marker", () => {
    const renderAuthority = (mutationState) => renderPanel({
      model: simulation(),
      authorityState: "enforced",
      authorizationRequired: true,
      scopeCurrent: true,
      mutationState
    });

    expect(renderAuthority("ready")).toContain('data-capability-state="ready"');
    expect(renderAuthority("submitting")).toContain('data-capability-state="submitting"');
    expect(renderAuthority("uncertain")).toContain('data-capability-state="uncertain"');
    expect(renderAuthority("reconciliation")).toContain('data-capability-state="reconciliation"');
    expect(renderAuthority("receipt")).toContain('data-capability-state="receipt"');
    expect(renderAuthority("error")).toContain('data-capability-state="error"');
    expect(renderAuthority("recovery")).toContain('data-capability-state="recovery"');
  });

  test("gives sales an exact approval handoff and administrators an exact authorization action", () => {
    const onRequestAuthorization = vi.fn();
    const salesMarkup = renderPanel({
      model: simulation(),
      authorityState: "enforced",
      authorizationRequired: true,
      staffRole: "sales",
      scopeCurrent: true,
      onRequestAuthorization
    });
    expect(salesMarkup).toContain("Request admin authorization");

    const onAuthorize = vi.fn();
    const adminMarkup = renderPanel({
      model: simulation(),
      authorityState: "enforced",
      authorizationRequired: true,
      staffRole: "admin",
      scopeCurrent: true,
      onAuthorize
    });
    expect(adminMarkup).toContain("Authorize exact change");
  });

  test("enables atomic apply only for an exact current authorization receipt", () => {
    const onApply = vi.fn();
    const currentMarkup = renderPanel({
      model: simulation(),
      authorityState: "enforced",
      authorizationRequired: true,
      staffRole: "admin",
      authorizationReceiptId: `cca_${"a".repeat(48)}`,
      scopeCurrent: true,
      mutationState: "authorized",
      onApply
    });
    expect(currentMarkup).toContain("Apply authorized change");
    expect(currentMarkup).not.toContain("disabled=\"\"");

    const staleMarkup = renderPanel({
      model: simulation(),
      authorityState: "enforced",
      authorizationRequired: true,
      authorizationReceiptId: `cca_${"a".repeat(48)}`,
      scopeCurrent: false,
      mutationState: "authorized",
      onApply
    });
    expect(staleMarkup).toContain("Authorization and apply are disabled");
    expect(staleMarkup).toContain("disabled=\"\"");
  });

  test("fails an uncertain apply closed and exposes exact-outcome reconciliation", () => {
    const onReconcileApplyOutcome = vi.fn();
    const markup = renderPanel({
      model: simulation(),
      authorityState: "enforced",
      authorizationRequired: true,
      staffRole: "admin",
      authorizationReceiptId: `cca_${"a".repeat(48)}`,
      scopeCurrent: true,
      mutationState: "uncertain",
      mutationKind: "apply",
      mutationMessage: "Refresh the authoritative quote record before taking another action.",
      onApply: vi.fn(),
      onReconcileApplyOutcome
    });

    expect(markup).toContain("Apply outcome unresolved");
    expect(markup).toContain("Reconcile exact outcome");
    expect(markup).toContain('data-capability-action="reconcile-apply-outcome"');
    expect(markup).toContain("this screen will not submit the edit again");
    expect(APP_SOURCE).toContain("handleReconcileCommercialChangeApplyOutcome");
    expect(APP_SOURCE).toContain("reconcileCommercialQuoteChangeApplyOutcome");
  });

  test("renders exact committed and fenced-not-committed outcome receipts", () => {
    const common = {
      model: simulation(),
      authorityState: "enforced",
      authorizationRequired: true,
      staffRole: "admin",
      authorizationReceiptId: `cca_${"a".repeat(48)}`,
      scopeCurrent: true,
      mutationKind: "apply"
    };
    const committed = renderPanel({
      ...common,
      mutationState: "receipt",
      applyOutcome: {
        state: "committed",
        outcomeReceiptId: `ccor_${"b".repeat(48)}`,
        appliedRevisionIsActive: true,
        sourceChanged: true
      }
    });
    const recoverable = renderPanel({
      ...common,
      mutationState: "recovery",
      applyOutcome: {
        state: "not_committed",
        outcomeReceiptId: `ccor_${"c".repeat(48)}`,
        appliedRevisionIsActive: false,
        sourceChanged: false
      },
      onRecoverApply: vi.fn()
    });

    expect(committed).toContain("Exact apply proven committed");
    expect(committed).toContain("immutable applied revision is the active quote source");
    expect(recoverable).toContain("Exact apply proven not committed");
    expect(recoverable).toContain("Start fresh simulation");
    expect(recoverable).toContain('data-capability-action="recover-not-committed-apply"');
  });

  test("is mechanically bound to the trusted quote edit and authoritative pricing path", () => {
    expect(APP_SOURCE).toMatch(
      /import\s*\{[\s\S]*?RecoverableErrorBoundary[\s\S]*?\}\s*from\s*["']\.\/components\/RecoverableErrorBoundary["']/
    );
    expect(APP_SOURCE).toContain("<RecoverableErrorBoundary");
    expect(APP_SOURCE).toContain('data-capability-id="cwf-15b-commercial-change-impact-preview"');
    expect(APP_SOURCE).toContain("handlePreviewChangeImpact");
    expect(APP_SOURCE).toContain("expectedActiveVersionId: editingQuote.activeVersionId");
    expect(APP_SOURCE).toContain("const loadAmbientQuoteDraftRuntime = AMBIENT_UI_ENABLED");
    expect(APP_SOURCE).toContain('? () => import("./lib/quoteDraftRuntime")');
    expect(APP_SOURCE).toContain("const runtimeModule = await loadAmbientQuoteDraftRuntime();");
    expect(APP_SOURCE).toContain("draftRuntime = runtimeModule.hydrateSavedQuoteDraft({");
    expect(APP_SOURCE).toContain("...draftInput,");
    expect(APP_SOURCE).toContain("draftPatch,");
    expect(APP_SOURCE).toContain("draftIntent,");
    expect(APP_SOURCE).toContain("ambientCatalogContext,");
    expect(APP_SOURCE).toContain("ambientEnabled: true");
    expect(APP_SOURCE).toContain("draftRuntime = hydrateSavedQuoteDraftBase(draftInput);");
    expect(QUOTE_DRAFT_RUNTIME_SOURCE).toContain("normalizeAmbientQuoteDraftPatch({");
    expect(QUOTE_DRAFT_RUNTIME_SOURCE).toContain("normalizeAmbientDraftIntent({");
    expect(QUOTE_DRAFT_RUNTIME_SOURCE).toContain(
      "return hydrateSavedQuoteDraftBase({ ...input, normalizedPatch, normalizedDraftIntent });"
    );
    expect(QUOTE_DRAFT_RUNTIME_BASE_SOURCE).toContain(
      "activeVersionId: text(quote.activeVersionId || quote.versionMeta?.versionId)"
    );
    expect(APP_SOURCE).toContain("simulateCommercialQuoteChange({");
    expect(APP_SOURCE).toContain("requestCommercialQuoteChangeAuthorization({");
    expect(APP_SOURCE).toContain("authorizeCommercialQuoteChange({");
    expect(APP_SOURCE).toContain("commercialChangeAuthority: {");
    expect(APP_SOURCE).toContain("applyRequestId");
    expect(APP_SOURCE).toContain("Preview change impact");
    expect(APP_SOURCE).toContain("onRetry={() => handlePreviewChangeImpact({ recovery: true })}");
    expect(APP_SOURCE).toContain("No client-calculated substitute is shown");
    expect(FUNCTIONS_SOURCE).toContain("exports.simulateCommercialQuoteChange =");
    expect(FUNCTIONS_SOURCE).toContain("exports.requestCommercialQuoteChangeAuthorization =");
    expect(FUNCTIONS_SOURCE).toContain("exports.authorizeCommercialQuoteChange =");
    expect(FUNCTIONS_SOURCE).toContain("exports.reconcileCommercialQuoteChangeApplyOutcome =");
    expect(FUNCTIONS_SOURCE).toContain("commercialChangeAuthority.buildApply(");
    expect(FUNCTIONS_SOURCE).toContain("persistCommercialChangeApply({");
  });
});
