// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import QuoteCompletionCommandPath from "../QuoteCompletionCommandPath";
import DecisionPacketPanel from "../DecisionPacketPanel";
import GovernedQuoteStarts from "../GovernedQuoteStarts";
import { InventoryExceptionWorkspace, InventoryMobileCapturePanel } from "../InventoryWorkspace";
import { learningFixture } from "../../lib/__tests__/postEventLearning.fixture";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); root = null; });
const completion = (state, commandState = "idle") => ({ state, nextAction: { id: "review", label: "Review", enabled: true }, objectContext: { quoteId: "quote-one", revisionId: "version-one" }, blockerGroups: [], compatibility: { percentage: null }, command: { state: commandState, message: "Exact command feedback" } });

test("binds completion lifecycle states to its own surface", () => {
  const render = (state) => renderToStaticMarkup(<QuoteCompletionCommandPath enabled projection={completion(state)} />);
  expect(render("blocked")).toContain('data-capability-id="quote-completion-command-path"');
  expect(render("blocked")).toContain('data-capability-state="blocked"');
  expect(render("review_required")).toContain('data-capability-state="review_required"');
  expect(render("sendable")).toContain('data-capability-state="sendable"');
  expect(render("sent")).toContain('data-capability-state="sent"');
  expect(render("accepted")).toContain('data-capability-state="accepted"');
});
test("binds completion feedback states to its own surface", () => {
  const render = (state) => renderToStaticMarkup(<QuoteCompletionCommandPath enabled projection={completion("blocked", state)} />);
  expect(render("idle")).toContain('data-capability-id="quote-completion-command-feedback"');
  expect(render("idle")).toContain('data-capability-state="idle"');
  expect(render("loading")).toContain('data-capability-state="loading"');
  expect(render("failure")).toContain('data-capability-state="failure"');
  expect(render("stale")).toContain('data-capability-state="stale"');
  expect(render("success")).toContain('data-capability-state="success"');
  expect(render("recovery")).toContain('data-capability-state="recovery"');
});
test("binds decision packet readiness and recovery to its own surface", () => {
  const { quote } = learningFixture();
  quote.payment = { depositStatus: "paid", finalBalance: { status: "unpaid" } };
  const render = (source) => renderToStaticMarkup(<DecisionPacketPanel enabled quote={quote} source={source} />);
  expect(render("firebase")).toContain('data-capability-id="quote-decision-packet"');
  expect(render("firebase")).toContain('data-capability-state="ready"');
  expect(render("local")).toContain('data-capability-state="recovery"');
});
test("binds governed starts to the ready presentation surface", () => {
  const html = renderToStaticMarkup(<GovernedQuoteStarts enabled />);
  expect(html).toContain('data-capability-id="governed-quote-starts"');
  expect(html).toContain('data-capability-state="ready"');
});
test("binds exception workspace ready empty and stale states to its own surface", () => {
  const render = (ingredients, current = true) => renderToStaticMarkup(<InventoryExceptionWorkspace ingredients={ingredients} current={current} />);
  expect(render([])).toContain('data-capability-id="inventory-exception-workspace"');
  expect(render([])).toContain('data-capability-state="empty"');
  expect(render([{ ingredientId: "chicken" }])).toContain('data-capability-state="ready"');
  expect(render([], false)).toContain('data-capability-state="stale"');
});
test("binds mobile capture lifecycle and recovery to its own surface", async () => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  let finishList, finishSubmit;
  const line = { lineId: "count-chicken", ingredientId: "chicken", ingredientName: "Chicken", countedQuantity: "2", baseUnitId: "lb", state: "draft" };
  const draft = { draftId: "draft-one", draftRevision: 1, lines: [line] };
  const service = { list: vi.fn(() => new Promise((resolve) => { finishList = resolve; })), submit: vi.fn(() => new Promise((resolve) => { finishSubmit = resolve; })) };
  const render = async (key = "a") => act(async () => root.render(<InventoryMobileCapturePanel key={key} enabled organizationId="org-one" userId="admin-one" locations={[{ locationId: "main", name: "Main" }]} draftService={service} />));
  await render(); expect(container.innerHTML).toContain('data-capability-id="inventory-mobile-capture"');
  expect(container.innerHTML).toContain('data-capability-state="loading"');
  await act(async () => finishList([])); expect(container.innerHTML).toContain('data-capability-state="empty"');
  service.list.mockResolvedValue([draft]); await render("b"); expect(container.innerHTML).toContain('data-capability-state="ready"');
  await act(async () => window.dispatchEvent(new Event("offline"))); expect(container.innerHTML).toContain('data-capability-state="stale"');
  await act(async () => window.dispatchEvent(new Event("online")));
  const submit = () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Submit clean counts").click();
  await act(async () => submit()); expect(container.innerHTML).toContain('data-capability-state="submitting"');
  await act(async () => finishSubmit({ ...draft, status: "partial" })); expect(container.innerHTML).toContain('data-capability-state="recovery"');
  await act(async () => submit()); await act(async () => finishSubmit({ ...draft, status: "submitted", lines: [{ ...line, state: "submitted", receiptId: "stock-receipt" }] })); expect(container.innerHTML).toContain('data-capability-state="receipt"');
  service.list.mockRejectedValue(new Error("Device storage unavailable")); await render("c"); expect(container.innerHTML).toContain('data-capability-state="error"');
});
