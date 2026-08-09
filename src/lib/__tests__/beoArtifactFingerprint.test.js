import { describe, expect, test } from "vitest";
import {
  BEO_ARTIFACT_NODE_ID,
  BEO_ARTIFACT_TYPE,
  BEO_DECLARED_INPUT_NODE_IDS,
  BEO_INPUT_SCHEMA_VERSION,
  assertBeoArtifactGraphContract,
  buildBeoArtifactFingerprintDocument,
  createBeoArtifactFingerprint,
  normalizeBeoArtifactInputs
} from "../beoArtifactFingerprint";
import { buildBeoPayload } from "../beoPayload";
import { COMMERCIAL_DEPENDENCY_GRAPH_V1 } from "../commercialDependencyGraph";
import { proposalPayloadFixtureQuote } from "./fixtures/proposalPayloadFixture";

function versionedFixture(overrides = {}) {
  return {
    ...proposalPayloadFixtureQuote,
    activeVersionId: "v0002",
    latestVersionNumber: 2,
    versionMeta: {
      versionId: "v0002",
      versionNumber: 2,
      createdAt: "2026-04-02T10:00:00.000Z"
    },
    ...overrides
  };
}

async function fingerprintQuote(quote) {
  return createBeoArtifactFingerprint(buildBeoPayload(quote));
}

describe("Kitchen BEO artifact fingerprint", () => {
  test("binds every declared normalized input fact to the versioned graph artifact", () => {
    expect(BEO_ARTIFACT_NODE_ID).toBe("artifact.kitchen_beo");
    expect(assertBeoArtifactGraphContract()).toBe(true);
    expect(BEO_DECLARED_INPUT_NODE_IDS).toEqual([...BEO_DECLARED_INPUT_NODE_IDS].sort());

    const artifactNode = COMMERCIAL_DEPENDENCY_GRAPH_V1.nodes
      .find((node) => node.id === BEO_ARTIFACT_NODE_ID);
    expect(artifactNode?.kind).toBe("artifact");
  });

  test("builds a versioned canonical document over the complete normalized payload except revision display", () => {
    const beo = buildBeoPayload(versionedFixture());
    const document = buildBeoArtifactFingerprintDocument(beo);

    expect(document).toMatchObject({
      artifactType: BEO_ARTIFACT_TYPE,
      fingerprintSchemaVersion: BEO_INPUT_SCHEMA_VERSION,
      graphVersion: COMMERCIAL_DEPENDENCY_GRAPH_V1.graphVersion,
      declaredNodeIds: BEO_DECLARED_INPUT_NODE_IDS
    });
    expect(document.inputs).toEqual(normalizeBeoArtifactInputs(beo));
    expect(document.inputs).not.toHaveProperty("version");
    expect(document.inputs).toEqual({
      quoteNumber: beo.quoteNumber,
      organizationName: beo.organizationName,
      contacts: beo.contacts,
      event: beo.event,
      staffing: beo.staffing,
      selections: beo.selections,
      checkpoints: beo.checkpoints,
      productionChecklist: beo.productionChecklist
    });
  });

  test("is deterministic and changes for every governed rendered input family", async () => {
    const baseline = await fingerprintQuote(versionedFixture());
    const repeated = await fingerprintQuote(versionedFixture());
    const changedQuotes = [
      ["guest count", { event: { ...proposalPayloadFixtureQuote.event, guests: 175 } }],
      ["event time", { event: { ...proposalPayloadFixtureQuote.event, time: "19:30" } }],
      ["venue", { event: { ...proposalPayloadFixtureQuote.event, venue: "River Hall" } }],
      ["dietary constraints", { event: { ...proposalPayloadFixtureQuote.event, dietaryRestrictions: "Shellfish allergy" } }],
      ["staffing", { event: { ...proposalPayloadFixtureQuote.event, servers: 9 } }],
      ["menu", {
        selection: {
          ...proposalPayloadFixtureQuote.selection,
          menuItemNames: [...proposalPayloadFixtureQuote.selection.menuItemNames, "Late-night snack"]
        }
      }],
      ["rentals", {
        selection: {
          ...proposalPayloadFixtureQuote.selection,
          rentals: [...proposalPayloadFixtureQuote.selection.rentals, "Glassware"]
        }
      }],
      ["staff lead", {
        booking: { ...proposalPayloadFixtureQuote.booking, staffLead: "Morgan Hale" }
      }],
      ["checkpoint overrides", {
        booking: {
          ...proposalPayloadFixtureQuote.booking,
          kitchenCheckpoints: [{ id: "service-start", label: "Guest arrival", minuteOffset: -30 }]
        }
      }],
      ["production checklist", {
        booking: {
          ...proposalPayloadFixtureQuote.booking,
          productionChecklist: proposalPayloadFixtureQuote.booking.productionChecklist.map((item) => (
            item.id === "event-brief" ? { ...item, completed: false } : item
          ))
        }
      }],
      ["rendered array order", {
        selection: {
          ...proposalPayloadFixtureQuote.selection,
          menuItemNames: [...proposalPayloadFixtureQuote.selection.menuItemNames].reverse()
        }
      }]
    ];

    expect(baseline.dependencyFingerprint).toBe(
      "d41adee39a043049fd7ee133f576ad1b70410f340c652f970c1926faff1021a4"
    );
    expect(repeated.dependencyFingerprint).toBe(baseline.dependencyFingerprint);
    for (const [label, overrides] of changedQuotes) {
      const changed = await fingerprintQuote(versionedFixture(overrides));
      expect(changed.dependencyFingerprint).not.toBe(baseline.dependencyFingerprint);
      expect(changed.dependencyFingerprint, label).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("excludes source revision and unrelated portal, workflow, conversation, and payment states", async () => {
    const baselineQuote = versionedFixture();
    const baseline = await fingerprintQuote(baselineQuote);
    const changed = await fingerprintQuote({
      ...baselineQuote,
      activeVersionId: "v0099",
      versionMeta: {
        versionId: "v0099",
        versionNumber: 99,
        createdAt: "2026-08-09T12:00:00.000Z"
      },
      portalKey: "different-private-token",
      portalDecision: { status: "accepted" },
      workflow: { attention: "urgent" },
      conversationSummary: { messageCount: 999 },
      payment: { depositStatus: "paid", finalBalanceStatus: "paid" }
    });

    expect(changed.dependencyFingerprint).toBe(baseline.dependencyFingerprint);
  });

  test("fails closed when the graph no longer contains the declared artifact contract", () => {
    const registry = {
      ...COMMERCIAL_DEPENDENCY_GRAPH_V1,
      nodes: COMMERCIAL_DEPENDENCY_GRAPH_V1.nodes
        .filter((node) => node.id !== BEO_ARTIFACT_NODE_ID)
    };
    expect(() => assertBeoArtifactGraphContract(registry)).toThrow(
      `Commercial dependency registry is missing ${BEO_ARTIFACT_NODE_ID}.`
    );
  });
});
