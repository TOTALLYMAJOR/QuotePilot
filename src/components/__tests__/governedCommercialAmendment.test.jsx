// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CommercialAmendmentWorkspace from "../CommercialAmendmentWorkspace";
import CommercialChangeImpactPanel from "../CommercialChangeImpactPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const commitment = Object.freeze({
  quoteNumber: "Q-0017",
  versionLabel: "Version 17",
  status: "viewed",
  event: { name: "Henderson Dinner" },
  commercial: { currency: "USD", total: 18400, deposit: 4600 },
  protocol: {
    label: "Renewed delivery required",
    explanation: "The saved customer-facing revision remains historical evidence.",
    nextAction: "Review the revised draft, then issue a new customer delivery."
  },
  preservedEvidence: [
    { kind: "provider_delivery", label: "Provider-accepted delivery", detail: "Delivery evidence remains historical." }
  ]
});
const model = Object.freeze({
  identity: { organizationId: "org-one", quoteId: "quote-17", beforeRevisionId: "v0017", proposedRevisionId: "preview-v0018" },
  sources: {
    before: { label: "canonical_quote_revision", authority: "server_authoritative" },
    proposedAfter: { label: "authoritative_proposed_revision", authority: "server_authoritative" }
  },
  graph: { graphId: "commercial-dependency-graph-v1", graphVersion: "1" },
  factDiffs: [{ nodeId: "fact.guest_count", before: 168, proposedAfter: 180 }],
  commercialValues: {
    currency: "USD",
    authoritativeTotal: { before: 18400, proposedAfter: 19500, changed: true, authority: "server_authoritative" },
    depositRequirement: { before: 4600, proposedAfter: 4875, changed: true }
  },
  impact: {
    dependentNodes: [
      { id: "output.staffing_requirement", advisoryClass: "REVIEW", triggeredBy: ["fact.guest_count"] },
      { id: "artifact.kitchen_beo", advisoryClass: "STALE", triggeredBy: ["fact.guest_count"] }
    ],
    counts: { total: 2, review: 1, stale: 1 }
  },
  bounds: { declaredFactCount: 9, changedFactLimit: 32, dependentNodeLimit: 64, outputByteLimit: 262144 }
});

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Governed Commercial Amendment Experience", () => {
  test("assembles current commitment, lifecycle consequence, and preview into one decision surface", () => {
    const markup = renderToStaticMarkup(
      <CommercialAmendmentWorkspace
        commitment={commitment}
        dirty
        previewAvailable
        onPreview={() => {}}
      >
        <p>Impact result belongs here.</p>
      </CommercialAmendmentWorkspace>
    );

    expect(markup).toContain('data-capability-id="qp-uxr-001-governed-commercial-amendment"');
    expect(markup).toContain("Q-0017 · Version 17");
    expect(markup).toContain("$18,400.00");
    expect(markup).toContain("$4,600.00");
    expect(markup).toContain("Renewed delivery required");
    expect(markup).toContain("Preview consequences");
    expect(markup).toContain("Propose");
    expect(markup).toContain("Understand");
    expect(markup).toContain("Continue");
    expect(markup).toContain("Impact result belongs here.");
  });

  test("renders and focuses a complete outcome receipt while preserving an explicit next action", () => {
    const onOpenAppliedQuote = vi.fn();
    act(() => root.render(
      <CommercialChangeImpactPanel
        model={model}
        commitment={commitment}
        authorityState="enforced"
        authorizationRequired
        authorizationReceiptId={`cca_${"a".repeat(48)}`}
        mutationState="receipt"
        mutationKind="apply"
        applyResult={{
          authorityState: "enforced",
          applyReceiptId: `ccap_${"b".repeat(48)}`,
          state: "BLOCKED",
          safeToPublish: false,
          openInvalidationCount: 2,
          totalInvalidationCount: 2
        }}
        appliedQuote={{ quoteId: "quote-17", activeVersionId: "v0018", latestVersionNumber: 18 }}
        scopeCurrent
        onOpenAppliedQuote={onOpenAppliedQuote}
      />
    ));

    const receipt = container.querySelector('[data-capability-id="qp-uxr-001-amendment-receipt"]');
    expect(receipt).not.toBeNull();
    expect(document.activeElement).toBe(receipt);
    expect(receipt.textContent).toContain("Changed");
    expect(receipt.textContent).toContain("Preserved");
    expect(receipt.textContent).toContain("Needs attention");
    expect(receipt.textContent).toContain("Next");
    expect(receipt.textContent).toContain("Provider-accepted delivery");
    expect(receipt.textContent).toContain("Staffing requirement");
    expect(receipt.textContent).toContain("Kitchen beo");
    act(() => [...receipt.querySelectorAll("button")].find((button) => button.textContent === "Review updated quote").click());
    expect(onOpenAppliedQuote).toHaveBeenCalledTimes(1);
  });

  test("labels dormant application honestly without inventing invalidation authority", () => {
    const markup = renderToStaticMarkup(
      <CommercialChangeImpactPanel
        model={model}
        commitment={commitment}
        authorityState="dormant"
        mutationState="receipt"
        applyResult={{
          authorityState: "dormant",
          applyReceiptId: "",
          state: "DORMANT",
          safeToPublish: false,
          openInvalidationCount: 0,
          totalInvalidationCount: 0
        }}
        appliedQuote={{ quoteId: "quote-17", activeVersionId: "v0018" }}
        scopeCurrent
      />
    );
    expect(markup).toContain("review evidence only");
    expect(markup).toContain("no dependency invalidation was persisted or implied");
    expect(markup).not.toContain("2 named invalidations");
  });
});
