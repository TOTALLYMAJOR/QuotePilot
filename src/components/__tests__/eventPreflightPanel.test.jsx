import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import EventPreflightPanel from "../EventPreflightPanel";

const item = (id, title) => ({ id, domain: "Domain", title, detail: "Why this matters.", evidence: "Existing authority" });

describe("EventPreflightPanel", () => {
  test("renders the three evidence classes and no synthetic score", () => {
    const markup = renderToStaticMarkup(<EventPreflightPanel model={{
      state: "attention",
      title: "Attention is required before safe advancement",
      summary: "1 satisfied · 1 need attention · 1 unknown or unavailable",
      satisfied: [item("ready", "Commitment recorded")],
      attention: [item("blocker", "BEO is stale")],
      unknown: [item("unknown", "Inventory is not governed")],
      boundary: "Preflight is a read-only synthesis, not a readiness score or authorization to proceed."
    }} />);

    expect(markup).toContain('data-event-preflight="attention"');
    expect(markup).toContain("Ready / satisfied facts");
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Unknown / unavailable");
    expect(markup).toContain("Inventory is not governed");
    expect(markup).not.toContain("%");
  });
});
