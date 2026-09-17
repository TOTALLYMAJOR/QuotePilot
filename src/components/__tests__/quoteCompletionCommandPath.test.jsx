import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import QuoteCompletionCommandPath from "../QuoteCompletionCommandPath";

function projection(overrides = {}) {
  return {
    schemaVersion: "quote-completion-contract-v1",
    state: "blocked",
    compatibility: { percentage: 70, authority: "compatibility_only" },
    blockerGroups: [{
      id: "draft",
      label: "Draft requirements",
      blockers: [{ id: "client-name", label: "Add the client name." }]
    }],
    command: { state: "idle", message: "" },
    nextAction: {
      id: "resolve:client-name",
      kind: "resolve_field",
      label: "Add client name",
      enabled: true
    },
    ...overrides
  };
}

describe("QuoteCompletionCommandPath", () => {
  test("renders one dominant action and demotes compatibility percentage", () => {
    const html = renderToStaticMarkup(
      <QuoteCompletionCommandPath enabled projection={projection()} surface="proposal_composer" />
    );

    expect(html).toContain('data-capability-id="quote-completion-command-path"');
    expect(html).toContain('data-capability-state="blocked"');
    expect(html).toContain("Add client name");
    expect(html).toContain("Compatibility details");
    expect(html).toContain("70%");
    expect((html.match(/<button/g) || [])).toHaveLength(1);
  });

  test("exposes loading, failure, stale, success, and recovery as textual command states", () => {
    for (const state of ["loading", "failure", "stale", "success", "recovery"]) {
      const html = renderToStaticMarkup(
        <QuoteCompletionCommandPath
          enabled
          projection={projection({
            command: { state, message: `${state} message` }
          })}
          surface="review"
        />
      );
      expect(html).toContain(`data-command-state="${state}"`);
      expect(html).toContain(`${state} message`);
    }
  });

  test("renders nothing when the gate is off", () => {
    expect(renderToStaticMarkup(
      <QuoteCompletionCommandPath enabled={false} projection={projection()} />
    )).toBe("");
  });
});
