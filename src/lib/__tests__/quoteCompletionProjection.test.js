import { describe, expect, test } from "vitest";
import { buildQuoteCompletionProjection } from "../quoteCompletionProjection";

function readiness(overrides = {}) {
  return {
    score: 100,
    complete: true,
    gaps: [],
    recommendedGaps: [],
    ...overrides
  };
}

function configuredActions(overrides = {}) {
  return {
    modelId: "configured-quote-action-state-v2",
    state: { versionSaved: true, providerAccepted: false },
    actions: {
      send_quote: {
        id: "send_quote",
        label: "Send proposal",
        visible: true,
        enabled: true,
        disabledReason: ""
      }
    },
    primaryAction: {
      id: "send_quote",
      label: "Send proposal",
      visible: true,
      enabled: true
    },
    ...overrides
  };
}

describe("quote-completion-contract-v1", () => {
  test("orders blockers, deduplicates overlapping readiness gaps, and points to the exact field", () => {
    const projection = buildQuoteCompletionProjection({
      quote: { id: "quote-1", activeVersionId: "v0004", status: "draft" },
      readiness: readiness({
        score: 70,
        complete: false,
        gaps: [
          { id: "customer-name", label: "Customer name" },
          { id: "menu", label: "Menu selected" }
        ]
      }),
      saveBlockers: [
        { id: "client-name", message: "Add the client name." },
        { id: "menu-selection", message: "Select at least one menu item." }
      ],
      configuredActions: configuredActions()
    });

    expect(projection).toMatchObject({
      schemaVersion: "quote-completion-contract-v1",
      authority: "presentation_only_projection",
      state: "blocked",
      compatibility: { percentage: 70, authority: "compatibility_only" }
    });
    expect(projection.blockerGroups.map((group) => group.id)).toEqual(["draft"]);
    expect(projection.blockerGroups[0].blockers.map((blocker) => blocker.id)).toEqual([
      "client-name",
      "menu-selection"
    ]);
    expect(projection.nextAction).toMatchObject({
      id: "resolve:client-name",
      kind: "resolve_field",
      objectContext: { quoteId: "quote-1", revisionId: "v0004" },
      destination: {
        surfaceId: "proposal-composer",
        selector: '[data-ambient-action-id="pc-edit-client-name"]'
      }
    });
  });

  test.each([
    ["loading", "not_yet_available"],
    ["stale", "stale"],
    ["partial", "partial"],
    ["awaiting_preview", "not_yet_available"],
    ["missing", "missing"],
    ["contradictory", "contradictory"],
    ["unavailable", "unavailable"],
    ["not_yet_available", "not_yet_available"],
    ["schema_drift", "schema_drift"]
  ])("keeps Living Opportunity %s evidence explicit and unable to pass", (state, evidenceState) => {
    const projection = buildQuoteCompletionProjection({
      quote: { id: "quote-1", activeVersionId: "v0004", status: "draft" },
      readiness: readiness(),
      configuredActions: configuredActions(),
      livingOpportunity: {
        schemaVersion: "living-commercial-twin-v1",
        state,
        nextAction: { label: "Refresh consequence preview" }
      }
    });

    expect(projection.state).toBe("blocked");
    expect(projection.evidence.livingOpportunity.state).toBe(evidenceState);
    expect(projection.blockerGroups[0]).toMatchObject({ id: "evidence" });
    expect(projection.nextAction.kind).toBe("recover_evidence");
  });

  test("marks only an enabled configured send action as sendable", () => {
    const projection = buildQuoteCompletionProjection({
      quote: { id: "quote-1", activeVersionId: "v0004", status: "draft" },
      readiness: readiness(),
      configuredActions: configuredActions(),
      livingOpportunity: { state: "unchanged" }
    });

    expect(projection.state).toBe("sendable");
    expect(projection.blockerGroups).toEqual([]);
    expect(projection.nextAction).toMatchObject({
      id: "send_quote",
      kind: "send_proposal",
      label: "Send proposal",
      destination: {
        surfaceId: "quote-administration",
        actionId: "send_quote"
      }
    });
  });

  test("requires current provider acceptance before classifying a sent lifecycle as sent", () => {
    const quote = { id: "quote-1", activeVersionId: "v0004", status: "sent" };
    const notAccepted = buildQuoteCompletionProjection({
      quote,
      readiness: readiness(),
      configuredActions: configuredActions(),
      livingOpportunity: { state: "unchanged" }
    });
    const providerAccepted = buildQuoteCompletionProjection({
      quote,
      readiness: readiness(),
      configuredActions: configuredActions({
        state: { versionSaved: true, providerAccepted: true },
        actions: {},
        primaryAction: {
          id: "open_conversation",
          label: "Open conversation",
          visible: true,
          enabled: true
        }
      }),
      livingOpportunity: { state: "unchanged" }
    });

    expect(notAccepted.state).toBe("sendable");
    expect(providerAccepted.state).toBe("sent");
    expect(providerAccepted.nextAction).toMatchObject({
      id: "open_conversation",
      objectContext: { quoteId: "quote-1", revisionId: "v0004" }
    });
  });

  test("keeps accepted authority terminal while exposing one configured continuation", () => {
    const projection = buildQuoteCompletionProjection({
      quote: { id: "quote-1", activeVersionId: "v0004", status: "accepted" },
      readiness: readiness(),
      configuredActions: configuredActions({
        primaryAction: {
          id: "convert_contract",
          label: "Create contract",
          visible: true,
          enabled: true
        }
      }),
      livingOpportunity: { state: "unchanged" }
    });

    expect(projection.state).toBe("accepted");
    expect(projection.nextAction).toMatchObject({
      id: "convert_contract",
      kind: "configured_action",
      label: "Create contract"
    });
    expect(Object.isFrozen(projection)).toBe(true);
  });

  test("never routes an accepted record back into draft mutation when no continuation is configured", () => {
    const projection = buildQuoteCompletionProjection({
      quote: { id: "quote-1", activeVersionId: "v0004", status: "accepted" },
      readiness: readiness({ complete: false, gaps: [{ id: "customer-name", label: "Customer name" }] }),
      saveBlockers: [{ id: "client-name", message: "Add the client name." }],
      draftDirty: true
    });

    expect(projection.state).toBe("accepted");
    expect(projection.nextAction).toMatchObject({
      id: "review_acceptance",
      kind: "review_proposal",
      destination: { surfaceId: "quote-administration", actionId: "review_acceptance" }
    });
  });

  test.each(["loading", "success", "failure", "stale", "recovery"])(
    "preserves the %s command state without changing commercial state",
    (state) => {
      const projection = buildQuoteCompletionProjection({
        quote: { id: "quote-1", status: "draft" },
        readiness: readiness(),
        draftDirty: true,
        command: {
          state,
          message: `${state} message`,
          recovery: state === "failure" ? { label: "Try again" } : null
        }
      });

      expect(projection.state).toBe("review_required");
      expect(projection.command).toMatchObject({ state, message: `${state} message` });
      expect(projection.nextAction).toMatchObject({
        id: "save_exact_revision",
        kind: "save_revision",
        destination: { surfaceId: "proposal-composer", actionId: "save_quote" }
      });
    }
  );
});
