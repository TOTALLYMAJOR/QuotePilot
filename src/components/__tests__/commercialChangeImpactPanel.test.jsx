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
const FUNCTIONS_SOURCE = readFileSync(
  fileURLToPath(new URL("../../../functions/index.js", import.meta.url)),
  "utf8"
);
const COMMERCE_OPS_SOURCE = readFileSync(
  fileURLToPath(new URL("../../lib/commerceOps.js", import.meta.url)),
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

function collectElements(node, predicate, matches = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectElements(child, predicate, matches));
    return matches;
  }
  if (!React.isValidElement(node)) return matches;
  if (predicate(node)) matches.push(node);
  collectElements(node.props.children, predicate, matches);
  return matches;
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
    expect(markup).toContain("+$4,440.00");
    expect(markup).toContain("$3,120.00 → $4,230.00");
    expect(markup).toContain("+$1,110.00");
  });

  test("separates REVIEW decisions from projected STALE artifacts", () => {
    const markup = renderPanel({ model: simulation() });

    expect(markup).toContain('data-advisory-class="REVIEW"');
    expect(markup).toContain('data-dependent-node="output.staffing_requirement"');
    expect(markup).toContain(">REVIEW<");
    expect(markup).toContain('data-advisory-class="STALE"');
    expect(markup).toContain('data-dependent-node="artifact.beo"');
    expect(markup).toContain(">STALE<");
    expect(markup).toContain("1 REVIEW · 1 STALE · 2 total dependent results");
    expect(markup).toContain("Triggered by: fact.guest_count, fact.venue");
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
    expect(markup).toContain("2 of 32 changed facts");
    expect(markup).toContain("2 of 64 dependents");
    expect(markup).toContain("9 declared facts");
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
    expect(empty).toContain("No declared fact changed in this simulation.");
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
    const tree = CommercialChangeImpactPanel({
      model: simulation(),
      onReturnToEdit
    });
    const buttons = collectElements(tree, (node) => node.type === "button");

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props["data-capability-action"]).toBe("return-to-edit");
    buttons[0].props.onClick();
    expect(onReturnToEdit).toHaveBeenCalledTimes(1);
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
    const tree = CommercialChangeImpactPanel({ error: "Unavailable", onRetry });
    const buttons = collectElements(tree, (node) => node.type === "button");

    expect(buttons).toHaveLength(1);
    expect(buttons[0].props["data-capability-action"]).toBe("retry-simulation");
    buttons[0].props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("is mechanically bound to the trusted quote edit and authoritative pricing path", () => {
    expect(APP_SOURCE).toContain('data-capability-id="cwf-15b-commercial-change-impact-preview"');
    expect(APP_SOURCE).toContain("handlePreviewChangeImpact");
    expect(APP_SOURCE).toContain("includeChangeImpactPreview: true");
    expect(APP_SOURCE).toContain("expectedActiveVersionId: editingQuote.activeVersionId");
    expect(APP_SOURCE).toContain('activeVersionId: quote.activeVersionId || quote.versionMeta?.versionId || ""');
    expect(COMMERCE_OPS_SOURCE).toContain("expectedActiveVersionId = \"\"");
    expect(COMMERCE_OPS_SOURCE).toContain("payload.expectedActiveVersionId = String(expectedActiveVersionId || \"\").trim()");
    expect(APP_SOURCE).toContain("simulateCommercialChangeImpact(snapshots)");
    expect(APP_SOURCE).toContain("Preview change impact");
    expect(APP_SOURCE).toContain("onRetry={() => handlePreviewChangeImpact({ recovery: true })}");
    expect(APP_SOURCE).toContain("No client-calculated substitute is shown");
    expect(FUNCTIONS_SOURCE).toContain("quoteId && data?.includeChangeImpactPreview === true");
    expect(FUNCTIONS_SOURCE).toContain("const expectedActiveVersionId = normalizeText(data?.expectedActiveVersionId)");
    expect(FUNCTIONS_SOURCE).toContain("changeImpactPreview = await db.runTransaction(async (tx) =>");
    expect(FUNCTIONS_SOURCE).toContain("tx.get(quoteRef)");
    expect(FUNCTIONS_SOURCE).toContain("tx.get(settingsRef)");
    expect(FUNCTIONS_SOURCE).toContain("assertPricingCatalogAuthorityCurrent(result.catalogAuthority");
    expect(FUNCTIONS_SOURCE).toContain("sanitizeQuoteCreationRequest({");
    expect(FUNCTIONS_SOURCE).toContain("buildCommercialChangeImpactPreviewSnapshots({");
    expect(FUNCTIONS_SOURCE).toContain("...(changeImpactPreview ? { changeImpactPreview } : {})");
  });
});
