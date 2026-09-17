// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import QuoteCompletionCommandPath from "../QuoteCompletionCommandPath";
import {
  PRODUCT_ANALYTICS_STORAGE_KEYS,
  beginWizardAnalyticsSession
} from "../../lib/productAnalytics";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    objectContext: { quoteId: "quote-1", revisionId: "v0001" },
    nextAction: {
      id: "resolve:client-name",
      kind: "resolve_field",
      label: "Add client name",
      enabled: true
    },
    ...overrides
  };
}

let container;
let root;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderInteractive(props = {}) {
  await act(async () => root.render(
    <QuoteCompletionCommandPath
      enabled
      projection={projection()}
      surface="proposal_composer"
      {...props}
    />
  ));
  return container.querySelector('[data-capability-id="quote-completion-command-path"]');
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

  test("shows loading while a deferred action is pending, then exposes success", async () => {
    let resolveAction;
    const onAction = vi.fn(() => new Promise((resolve) => { resolveAction = resolve; }));
    const panel = await renderInteractive({ onAction });

    await act(async () => panel.querySelector("button").click());
    expect(panel.dataset.commandState).toBe("loading");
    expect(panel.textContent).toContain("Working");

    await act(async () => resolveAction({ state: "success", message: "Exact destination opened." }));
    expect(panel.dataset.commandState).toBe("success");
    expect(panel.textContent).toContain("Exact destination opened.");
  });

  test.each([
    ["rejected", () => Promise.reject(new Error("route failed")), "failure"],
    ["stale", () => Promise.resolve({ state: "stale", message: "Revision changed.", recovery: { label: "Reload and retry" } }), "stale"],
    ["recovery", () => Promise.resolve({ state: "recovery", message: "Destination unavailable.", recovery: { label: "Try exact destination again" } }), "recovery"]
  ])("exposes an actionable %s outcome", async (_label, run, expectedState) => {
    const panel = await renderInteractive({ onAction: vi.fn(run) });

    await act(async () => panel.querySelector("button").click());

    expect(panel.dataset.commandState).toBe(expectedState);
    expect(panel.querySelector("button").disabled).toBe(false);
    expect(panel.querySelector("button").textContent).toMatch(/again|retry|Add client name/i);
  });

  test("records one resolved event per successful action identity only", async () => {
    beginWizardAnalyticsSession({ organizationId: "org-one", mode: "edit" });
    const panel = await renderInteractive({
      onAction: vi.fn(() => ({ state: "success", message: "Opened." }))
    });

    await act(async () => panel.querySelector("button").click());
    await act(async () => panel.querySelector("button").click());

    const queue = JSON.parse(localStorage.getItem(PRODUCT_ANALYTICS_STORAGE_KEYS.QUEUE_KEY) || "[]");
    expect(queue.filter((event) => event.eventName === "quote_completion_action_resolved"))
      .toHaveLength(1);
  });
});
