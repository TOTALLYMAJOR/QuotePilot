// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AmbientContextProvider, useAmbientContext } from "../AmbientContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function Consumer() {
  const context = useAmbientContext();
  return <output>{context.organizationId}:{context.activeOpportunityId}:{context.sourceFreshness.state}</output>;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AmbientContextProvider", () => {
  test("provides one normalized, immutable opportunity snapshot", () => {
    act(() => {
      root.render(
        <AmbientContextProvider value={{
          organizationId: "org-alpha",
          role: "sales",
          route: "/app/quotes/quote-alpha",
          activeOpportunityId: "quote-alpha",
          selectedObject: { id: "quote-alpha", type: "opportunity", label: "Autumn Benefit" },
          revision: "version-alpha",
          sourceFreshness: {
            state: "unknown",
            reason: "The bounded loader does not expose an observation timestamp."
          },
          pendingPreview: null
        }}>
          <Consumer />
        </AmbientContextProvider>
      );
    });

    expect(container.textContent).toBe("org-alpha:quote-alpha:unknown");
  });
});
