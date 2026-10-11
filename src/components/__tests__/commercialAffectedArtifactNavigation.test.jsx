// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CommercialChangeImpactPanel from "../CommercialChangeImpactPanel";

const model = {
  identity: {
    organizationId: "org-1",
    quoteId: "quote-1",
    beforeRevisionId: "revision-before",
    proposedRevisionId: "revision-proposed"
  },
  sources: {
    before: { label: "canonical_quote_revision", authority: "server_authoritative" },
    proposedAfter: { label: "authoritative_proposed_revision", authority: "server_authoritative" }
  },
  graph: { graphId: "graph-1", graphVersion: "1" },
  factDiffs: [],
  commercialValues: {
    currency: "USD",
    authoritativeTotal: { before: 100, proposedAfter: 100, changed: false },
    depositRequirement: { before: 25, proposedAfter: 25, changed: false }
  },
  impact: {
    rootNodeIds: ["fact.event.guest_count"],
    dependentNodes: [{ id: "artifact.kitchen_beo", advisoryClass: "STALE" }],
    counts: { total: 1, review: 0, stale: 1 }
  },
  bounds: {
    declaredFactCount: 1,
    changedFactLimit: 32,
    dependentNodeLimit: 64,
    outputByteLimit: 262144
  }
};

describe("commercial affected artifact navigation", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  test("passes the exact quote, revision, artifact, and initiating control identity", async () => {
    const onOpenAffectedArtifact = vi.fn();
    await act(async () => {
      root.render(
        <CommercialChangeImpactPanel
          model={model}
          onOpenAffectedArtifact={onOpenAffectedArtifact}
        />
      );
    });

    const control = container.querySelector('[data-affected-artifact-action="kitchen_beo"]');
    expect(control).not.toBeNull();
    await act(async () => control.click());

    expect(onOpenAffectedArtifact).toHaveBeenCalledWith({
      kind: "kitchen_beo",
      label: "Review Kitchen BEO",
      artifactId: "artifact.kitchen_beo",
      quoteId: "quote-1",
      beforeRevisionId: "revision-before",
      proposedRevisionId: "revision-proposed",
      returnFocusId: "commercial-change-artifact-artifact-kitchen-beo"
    });
  });
});
