// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import WorkspaceShell from "../WorkspaceShell";
import { AMBIENT_PRIMARY_WORKSPACE_NAVIGATION } from "../../lib/workspaceRoutes";

let root;
let container;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
test("primary destinations are links while ordinary clicks retain caller-owned guards", async () => {
  const actions = Object.fromEntries(AMBIENT_PRIMARY_WORKSPACE_NAVIGATION.map((item) => [item.action, vi.fn()]));
  await act(async () => root.render(
    <WorkspaceShell model={{ mode: "workspace", activeSection: "quotes" }}
      principal={{ isAdmin: true }} ambientNavigation actions={actions} />
  ));
  const nav = container.querySelector('nav[aria-label="Primary workspace"]');
  const links = [...nav.querySelectorAll("a")];
  expect(links.map((link) => link.getAttribute("href")))
    .toEqual(AMBIENT_PRIMARY_WORKSPACE_NAVIGATION.map((item) => item.path));
  const opportunity = links.find((link) => link.textContent === "Opportunities");
  expect(opportunity.getAttribute("aria-current")).toBe("page");
  const click = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true });
  await act(async () => opportunity.dispatchEvent(click));
  expect(click.defaultPrevented).toBe(true);
  expect(actions.onQuotes).toHaveBeenCalledTimes(1);
  // The wrapper does not force navigation if the caller's dirty-draft guard
  // stops here. URL mutation remains entirely caller-owned.
  expect(window.location.pathname).not.toBe("/app/quotes");
});

test("a disabled Calendar capability has no primary Operations link", async () => {
  await act(async () => root.render(
    <WorkspaceShell model={{ mode: "workspace" }} principal={{ isAdmin: true }}
      ambientNavigation capabilities={{ eventSchedule: false }} />
  ));
  expect(container.querySelector('nav[aria-label="Primary workspace"] a[href="/app/operations"]')).toBeNull();
});
