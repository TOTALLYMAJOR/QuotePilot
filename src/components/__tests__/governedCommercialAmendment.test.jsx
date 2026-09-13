// @vitest-environment jsdom
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CommercialAmendmentWorkspace from "../CommercialAmendmentWorkspace";
import CommercialChangeImpactPanel from "../CommercialChangeImpactPanel";
import LivingCommercialTwin from "../LivingCommercialTwin";
import { buildLivingCommercialTwinProjection } from "../../lib/livingCommercialTwinProjection";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const APP_SOURCE = readFileSync("src/App.jsx", "utf8");
const LEGACY_APP_SOURCE = readFileSync("src/LegacyApp.jsx", "utf8");
const PROPOSAL_COMPOSER_SOURCE = readFileSync("src/components/ProposalComposer.jsx", "utf8");

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function occurrenceCount(source, needle) {
  return source.split(needle).length - 1;
}

const commitment = Object.freeze({
  quoteNumber: "Q-0017",
  versionLabel: "Version 17",
  status: "viewed",
  event: { name: "Henderson Dinner", guests: 125 },
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
  vi.useRealTimers();
});

describe("Governed Commercial Amendment Experience", () => {
  test("coordinates commercial and eligible ingredient previews without a competing inventory preview action", () => {
    const variants = [
      [APP_SOURCE, "const unifiedConsequenceScopeIsCurrent"],
      [LEGACY_APP_SOURCE, "const changeImpactScopeIsCurrent"]
    ];
    for (const [source, endMarker] of variants) {
      const handler = sourceSlice(source, "const handlePreviewChangeImpact", endMarker);
      expect(occurrenceCount(handler, "eventIngredientProjection.previewCurrent({")).toBe(0);
      expect(occurrenceCount(handler, "simulateCommercialQuoteChange({")).toBe(1);
      expect(handler).toContain("candidateForm = form");
      expect(handler).toContain("const formKey = JSON.stringify(candidateForm)");
      expect(handler).toContain("proposedForm: candidateForm");
      expect(handler).toContain("formKey === currentChangeImpactFormKey");
      expect(handler).toContain("form: candidateForm");
      expect(handler).toContain("eventIngredientOutputs: eventIngredientPreviewInput.selections.map");
      expect(handler).toContain("inventoryObservation: result.inventoryObservation");
      expect(handler).not.toContain("void eventIngredientProjection.previewCurrent({");
      expect(handler).toContain("const pending = pendingLivingTwinConsequenceRequest");
      expect(handler).toContain("pending.baseQuoteRevisionId !== livingTwinBaseQuoteRevisionId");
      expect(handler).toContain("pending.scopeKey !== livingTwinScopeKey");
      expect(handler).toContain("pending.formKey !== currentChangeImpactFormKey");
      expect(handler).toContain("setPendingLivingTwinConsequenceRequest(null)");
      expect(handler).toContain("candidateForm: pending.candidateForm");
      expect(handler).toContain("workbenchRequest: pending");
      expect(handler).toContain("workbenchRequest: exactWorkbenchRequest");
      expect(handler).toContain("changeImpactPreview.mutationState === \"uncertain\"");
      expect(source).toContain(
        "showPreviewAction={!livingCommercialTwinProjection.scenario.proposalChanged}"
      );
      expect(source).toContain("livingCommercialTwin={isEditingQuote ? {");
      expect(source).toContain("onPreview: (request) => handlePreviewChangeImpact({");
      expect(source).toContain("draftDirty: quoteDirty");
      expect(source).toContain("currentInventoryScenarioFingerprint");
      expect(source).toContain("onRetry={proposalComposerActive");
      [
        "scopeKey: livingTwinScopeKey",
        "baseQuoteRevisionId: livingTwinBaseQuoteRevisionId",
        "currentGuestCount: livingCommercialTwinProjection.scenario.currentGuestCount",
        "proposedGuestCount: form.guests",
        "|| editingQuote.baseForm?.eventName",
        "|| editingQuote.baseForm?.date",
        "|| editingQuote.baseForm?.time",
        "|| editingQuote.baseForm?.venue",
        "proposedEventName: form.eventName",
        "proposedEventDate: form.date",
        "proposedEventTime: form.time",
        "proposedVenue: form.venue",
        "onGuestCountChange: handleLivingTwinGuestCountChange",
        "onRequestConsequences: handleLivingTwinConsequenceRequest",
        "onReviewForCommitment: focusLivingTwinCommitmentReview"
      ].forEach((prop) => expect(source).toContain(prop));

      const guestChange = sourceSlice(
        source,
        "const handleLivingTwinGuestCountChange",
        "const handleRevertLivingTwinGuestCount"
      );
      expect(guestChange).toContain("normalizeLivingTwinGuestCount(value)");
      expect(guestChange).toContain(
        "guestCount === null || guestCount === Number(form.guests)"
      );
      expect(guestChange).toContain("resetChangeImpactPreview()");
      expect(guestChange).toContain("setForm(nextForm)");
      expect(guestChange).toContain("hasCommercialFormChanges({");
      expect(guestChange.indexOf("guestCount === Number(form.guests)")).toBeLessThan(
        guestChange.indexOf("resetChangeImpactPreview()")
      );

      const requestQueue = sourceSlice(
        source,
        "const handleLivingTwinConsequenceRequest",
        "const organizationName"
      );
      expect(requestQueue).toContain(
        "normalizeLivingTwinProjectionRequest(request, livingTwinScopeKey)"
      );
      expect(requestQueue).toContain("baseQuoteRevisionId !== livingTwinBaseQuoteRevisionId");
      expect(requestQueue).toContain("scopeKey: livingTwinScopeKey");
      expect(requestQueue).toContain("candidateForm");
      expect(requestQueue).toContain("formKey: JSON.stringify(candidateForm)");

      const proposedStaffing = sourceSlice(
        source,
        "const proposedStaffingRequirements",
        "const commercialInventoryConsequences"
      );
      expect(proposedStaffing).toContain("lead: 0");
      expect(proposedStaffing).not.toContain("fulfillmentStaffing.read");

      const previewFreshness = sourceSlice(
        source,
        "const changeImpactPresentationError",
        "const changeImpactPreviewAvailable"
      );
      expect(previewFreshness).toContain("The catalog revision changed after this preview");
      expect(source).toContain("inventoryEvidenceAvailable: eventIngredientProjection.access.readEnabled");
    }
    expect(PROPOSAL_COMPOSER_SOURCE).toContain("!livingCommercialTwin && consequences");
  });

  test("presents an authority-safe scenario workbench and requests one coordinated consequence refresh", () => {
    vi.useFakeTimers();
    const onGuestCountChange = vi.fn();
    const onRequestConsequences = vi.fn();
    const projectionInput = {
      organizationId: "org-one",
      quoteId: "quote-17",
      quoteRevisionId: "v0017",
      commitment,
      proposedGuestCount: 175,
      selectedMenuItemNames: ["Chicken Alfredo"],
      previewAvailable: true,
      inventoryEnabled: true,
      inventoryScenarioEligible: true,
      inventoryInputReady: false
    };
    const projection = buildLivingCommercialTwinProjection(projectionInput);
    act(() => root.render(
      <LivingCommercialTwin
        projection={projection}
        scopeKey="org-one:quote-17"
        baseQuoteRevisionId="v0017"
        currentGuestCount={125}
        proposedGuestCount={175}
        eventName="Henderson Dinner"
        onGuestCountChange={onGuestCountChange}
        onRequestConsequences={onRequestConsequences}
        previewDebounceMs={0}
      />
    ));

    const twin = container.querySelector('[data-capability-id="commercial-scenario-workbench"]');
    expect(twin).not.toBeNull();
    expect(twin.getAttribute("data-authority")).toBe("session-only-non-authoritative");
    expect(twin.textContent).toContain("Scenario Workbench");
    expect(twin.textContent).toContain("Current125 guests · saved");
    expect(twin.textContent).toContain("Working175+50 guests");
    expect(twin.textContent).not.toContain("Chicken Alfredo");
    expect(twin.textContent).toContain("People");
    expect(twin.textContent).toContain("Supply");
    expect(twin.textContent).toContain("Overall");
    expect(twin.textContent).toContain("Not verified");
    expect(twin.textContent).toMatch(/Nothing here has changed Commercial, Staffing, Inventory, or BEO authority/i);
    expect(twin.textContent).not.toMatch(/staffing covered|schedule clear|BEO regenerated/i);

    act(() => vi.runAllTimers());
    expect(onRequestConsequences).toHaveBeenCalledOnce();
    expect(onRequestConsequences).toHaveBeenCalledWith(expect.objectContaining({
      baseQuoteRevisionId: "v0017",
      generation: 1,
      guestCount: 175
    }));
    const exactRequest = onRequestConsequences.mock.calls[0][0];
    const exactProjection = buildLivingCommercialTwinProjection({
      ...projectionInput,
      previewRequested: true,
      previewScopeCurrent: true,
      commercialModel: model,
      workbenchRequest: exactRequest
    });
    act(() => root.render(
      <LivingCommercialTwin
        projection={exactProjection}
        scopeKey="org-one:quote-17"
        baseQuoteRevisionId="v0017"
        currentGuestCount={125}
        proposedGuestCount={175}
        eventName="Henderson Dinner"
        onGuestCountChange={onGuestCountChange}
        onRequestConsequences={onRequestConsequences}
        previewDebounceMs={0}
      />
    ));
    expect(twin.textContent).toContain("Chicken Alfredo");
    act(() => [...twin.querySelectorAll("button")]
      .find((entry) => entry.textContent === "Discard scenario").click());
    expect(onGuestCountChange).toHaveBeenLastCalledWith(125);
    vi.useRealTimers();
  });

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
