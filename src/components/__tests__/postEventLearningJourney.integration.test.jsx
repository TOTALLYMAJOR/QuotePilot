// @vitest-environment jsdom
// Local mocked-authority integration: real delivered route components and client normalizer.
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
const mock = vi.hoisted(() => ({ workspace: vi.fn(), radar: null, plan: null, execution: null, actuals: vi.fn(), call: vi.fn(), planRead: vi.fn(), executionRead: vi.fn() }));
vi.hoisted(() => { vi.stubEnv("VITE_AMBIENT_UI_ENABLED", "true"); });
vi.mock("../../lib/customerWorkspace", async () => ({ ...(await vi.importActual("../../lib/customerWorkspace")), getCustomerWorkspace: mock.workspace }));
vi.mock("../CustomerRevenueOpportunities", async () => ({ ...(await vi.importActual("../CustomerRevenueOpportunities")), buildCustomerRevenueOpportunityRead: () => mock.radar }));
vi.mock("../CustomerCommercialMeasures", () => ({ default: () => null }));
vi.mock("../CustomerCommercialTimeline", () => ({ default: () => null }));
vi.mock("../RevenueAutopilotCustomerControls", () => ({ default: () => null }));
vi.mock("../../hooks/useCatalogSetupDraft", () => ({ useCatalogSetupDraft: () => ({ draft: null, loading: false, changes: [] }) }));
vi.mock("../../lib/firebase", () => ({ firebaseReady: true, auth: { currentUser: { uid: "admin-one" } }, cloudFunctions: {}, db: {} }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => mock.call }));
vi.mock("../../lib/eventOperatingActualsClient", async () => ({ ...(await vi.importActual("../../lib/eventOperatingActualsClient")), getEventOperatingActualsSnapshot: mock.actuals }));
vi.mock("../../lib/inventoryAuthorityClient", async () => ({
  ...(await vi.importActual("../../lib/inventoryAuthorityClient")),
  subscribeToEventIngredientProjection: (input) => { mock.planRead(input); input.onData(mock.plan); return () => {}; },
  subscribeToEventIngredientExecutionProjection: (input) => { mock.executionRead(input); input.onData(mock.execution); return () => {}; },
  subscribeToInventoryIngredientProjections: ({ onData }) => { onData({ ingredients: [], locations: [], source: { state: "current" } }); return () => {}; }
}));
import CustomerWorkspaceView from "../CustomerWorkspaceView";
import AmbientLibraryRoute from "../AmbientLibraryRoute";
import InventoryWorkspace from "../InventoryWorkspace";
import PostEventLearningReviewBanner from "../PostEventLearningReviewBanner";
import { applyInventoryCommand } from "../../lib/inventoryAuthorityClient";
import { clearLearningReview, getLearningReview } from "../../lib/postEventLearningReview";
import { navigateLearningReview } from "../../lib/postEventLearningNavigation";
import { WORKSPACE_PATHS } from "../../lib/workspaceRoutes";
import { learningFixture } from "../../lib/__tests__/postEventLearning.fixture";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); clearLearningReview(); vi.clearAllMocks(); });
const button = (text) => [...container.querySelectorAll("button")].find((node) => node.textContent.includes(text));

test.each(["recipe", "pack_conversion"])("Client overview disclosure to real %s destination, normalized receipt and explicit confirmation", async (category) => {
  const input = learningFixture();
  Object.assign(input.quote, { customerId: "customer-one", quoteNumber: "Q-1", event: { ...input.quote.event, name: "Completed dinner", date: "2026-08-29" } });
  if (category === "pack_conversion") { input.planRead.projection.demandState = "partial"; input.planRead.projection.issues = [{ code: "missing_pack_conversion", ingredientId: "chicken" }]; }
  mock.plan = input.planRead; mock.execution = input.executionRead; mock.actuals.mockResolvedValue({ snapshot: input.financialRead.snapshot });
  mock.radar = { status: "available", opportunities: [{ id: "closeout-one", organizationId: "org-one", quoteId: "quote-one", type: "post_event_closeout", event: input.quote.event, reviewItems: [], reviewedAction: { ...input.closeout, closeoutId: "closeout-one", state: "completed" } }] };
  mock.workspace.mockResolvedValue({ organizationId: "org-one", source: "firebase", customer: { id: "customer-one", name: "Exact client" }, quotes: [input.quote], activeQuotes: [], events: [], money: [], conversations: [], proposalVersions: [input.acceptedVersion], recentActivity: [], attention: { itemCount: 0, items: [] }, nextAction: { kind: "none" }, quotePageInfo: { limit: 25, truncated: false }, versionPageInfo: { perQuoteLimit: 10, truncatedQuoteIds: [] } });
  function Routes() {
    const [path, setPath] = useState("/workspace/clients/customer-one");
    const navigate = (next) => { window.history.pushState({}, "", next); setPath(next); };
    return <><PostEventLearningReviewBanner enabled organizationId="org-one" principalId="admin-one" role="admin" />
      {path === WORKSPACE_PATHS.catalog ? <AmbientLibraryRoute open catalog={{ settings: {}, menu: [], packages: [], addons: [], rentals: [], templates: [], rules: [] }} organizationId="org-one" currentUserRole="admin" principalId="admin-one" />
        : path === WORKSPACE_PATHS.inventory ? <InventoryWorkspace organizationId="org-one" userId="admin-one" role="admin" browserEnabled tenantEnabled />
          : <CustomerWorkspaceView organizationId="org-one" customerId="customer-one" ambientMode isAdmin currentUserRole="admin" currentUserUid="admin-one" postEventLearningEnabled learningInventoryEnabled onReviewLearning={(proposal) => navigateLearningReview(proposal, "admin-one", navigate)} />}</>;
  }
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Routes />));
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(container.querySelector("#ambient-client-overview-title")?.textContent).toContain("Exact client");
  }, { timeout: 3000 });
  expect(mock.actuals).not.toHaveBeenCalled();
  const recordDisclosure = container.querySelector(".ambient-client-overview__record");
  expect(recordDisclosure.open).toBe(false);
  await act(async () => { recordDisclosure.open = true; recordDisclosure.dispatchEvent(new Event("toggle")); });
  expect(recordDisclosure.open).toBe(true);
  const disclosure = [...container.querySelectorAll("summary")].find((node) => node.textContent.includes("event learning"));
  expect(disclosure).toBeTruthy();
  await act(async () => {
    disclosure.parentElement.open = true;
    disclosure.parentElement.dispatchEvent(new Event("toggle"));
  });
  await act(async () => {
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await vi.waitFor(() => {
    expect(mock.planRead).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-one", quoteId: "quote-one" }));
  });
  expect(mock.planRead).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-one", quoteId: "quote-one" }));
  expect(mock.actuals).toHaveBeenCalledOnce();
  const priorReads = mock.workspace.mock.calls.length;
  await act(async () => {
    button("Refresh learning evidence").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await vi.waitFor(() => {
    expect(mock.workspace.mock.calls.length).toBeGreaterThan(priorReads);
  });
  expect(mock.workspace.mock.calls.length).toBeGreaterThan(priorReads);
  await act(async () => container.querySelector(`[data-learning-category="${category}"] button`).click());
  expect(window.location.pathname).toBe(category === "recipe" ? WORKSPACE_PATHS.catalog : WORKSPACE_PATHS.inventory);
  expect(container.textContent).toContain(category === "recipe" ? "Library" : "Inventory");
  expect(container.querySelector(category === "recipe" ? "#ambient-library-title" : "#inventory-workspace-title")).not.toBeNull();
  expect(getLearningReview().confirmed).toBe(false);
  expect(button("Confirm this receipt")).toBeUndefined();
  const command = category === "recipe" ? { kind: "publish_menu_recipe", menuItemId: "dinner", expectedCatalogRevision: 1, expectedRecipeRevision: 1, outputYield: "1", outputUnitId: "each", lines: [] } : { kind: "publish_pack_conversion", ingredientId: "chicken", expectedRevision: 0, packUnitId: "case", packLabel: "Case", baseUnitId: "lb", baseQuantity: "10", sourceLabel: "Operator verified label" };
  const receiptId = `iar_${"b".repeat(48)}`;
  mock.call.mockImplementation(async (payload) => ({ data: { ok: true, schemaVersion: 2, organizationId: "org-one", commandKind: command.kind, idempotent: false,
    receipt: { schemaVersion: 2, organizationId: "org-one", receiptId, requestId: payload.requestId, commandKind: command.kind, recordedAtISO: "2026-09-17T12:00:00.000Z" },
    result: category === "recipe" ? { schemaVersion: 2, menuItemId: "dinner", recipeRevisionId: `irr_${"f".repeat(48)}`, recipeRevision: 2, projectionSourceDigest: "operator-published", status: "complete" } : { schemaVersion: 2, ingredientId: "chicken", packUnitId: "case", revision: 1, packConversionRevisionId: `ipc_${"e".repeat(48)}`, affectedMenuItemIds: [] }
  } }));
  await act(async () => { const result = await applyInventoryCommand({ organizationId: "org-one", role: "admin", browserEnabled: true, tenantEnabled: true, requestId: `inventory_request_${"a".repeat(32)}`, command }); expect(Object.isFrozen(result.receipt)).toBe(true); });
  expect(container.querySelector('[data-capability-id="post-event-learning-review"]').dataset.capabilityState).toBe("review_required");
  expect(getLearningReview().confirmed).toBe(false);
  await act(async () => button("Confirm this receipt").click());
  expect(container.querySelector('[data-capability-id="post-event-learning-review"]').dataset.capabilityState).toBe("receipt");
  expect(getLearningReview().confirmed).toBe(true);
});
