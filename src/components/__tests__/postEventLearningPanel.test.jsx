// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import PostEventLearningPanel, { PostEventLearningView } from "../PostEventLearningPanel";
import PostEventLearningReviewBanner from "../PostEventLearningReviewBanner";
import { buildPostEventLearningProjection } from "../../lib/postEventLearningProjection";
import { clearLearningReview, getLearningReview, observeLearningInventoryReceipt, openLearningReview } from "../../lib/postEventLearningReview";
import { learningFixture } from "../../lib/__tests__/postEventLearning.fixture";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, container;
async function render(component) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); await act(async () => root.render(component)); return container; }
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); clearLearningReview(); });
const projection = () => buildPostEventLearningProjection(learningFixture());
describe("post-event learning component states", () => {
  test("fences late subscriptions and reads after principal or gate changes", async () => {
    const input = learningFixture(); let latePlan, lateExecution, finishActuals;
    const unsubPlan = vi.fn(), unsubExecution = vi.fn();
    const subscribePlan = vi.fn(({ onData }) => { latePlan = onData; return unsubPlan; });
    const subscribeExecution = vi.fn(({ onData }) => { lateExecution = onData; return unsubExecution; });
    const readActuals = vi.fn(() => new Promise((resolve) => { finishActuals = resolve; }));
    const props = { ...input, enabled: true, inventoryEnabled: true, role: "admin", principalId: "admin-one", subscribePlan, subscribeExecution, readActuals };
    await render(<PostEventLearningPanel {...props} />);
    expect(container.innerHTML).toContain('data-capability-state="loading"');
    await act(async () => root.render(<PostEventLearningPanel {...props} enabled={false} principalId="other-admin" />));
    await act(async () => { latePlan(input.planRead); lateExecution(input.executionRead); finishActuals({ snapshot: input.financialRead.snapshot }); });
    expect(container.innerHTML).toBe(""); expect(unsubPlan).toHaveBeenCalledOnce(); expect(unsubExecution).toHaveBeenCalledOnce();
    await act(async () => root.render(<PostEventLearningPanel {...props} role="customer" />));
    expect(container.innerHTML).toBe(""); expect(subscribePlan).toHaveBeenCalledOnce();
  });
  test.each(["loading", "error", "stale", "unavailable", "empty", "success"])("asserts the canonical %s capability marker", async (state) => {
    const model = projection(); const shown = { ...model, rows: state === "success" ? [] : model.rows, acceptedState: ["stale", "unavailable"].includes(state) ? state : model.acceptedState, proposals: state === "empty" ? [] : model.proposals };
    const element = await render(<PostEventLearningView projection={shown} loading={state === "loading"} error={state === "error" ? "Read failed." : ""} onRefresh={() => {}} />);
    expect(element.querySelector('[data-capability-id="post-event-learning"]').getAttribute("data-capability-state")).toBe(state);
    expect(element.textContent).toContain("Refresh learning evidence");
  });
  test("asserts learning read lifecycle markers including partial evidence and explicit recovery", async () => {
    await render(<PostEventLearningView projection={projection()} loading />);
    expect(container.innerHTML).toContain('data-capability-state="loading"');
    await act(async () => root.render(<PostEventLearningView projection={projection()} error="Failed read" />));
    expect(container.innerHTML).toContain('data-capability-state="error"');
    await act(async () => root.render(<PostEventLearningView projection={{ ...projection(), acceptedState: "stale" }} />));
    expect(container.innerHTML).toContain('data-capability-state="stale"');
    await act(async () => root.render(<PostEventLearningView projection={{ ...projection(), proposals: [] }} />));
    expect(container.innerHTML).toContain('data-capability-state="empty"');
    await act(async () => root.render(<PostEventLearningView projection={{ ...projection(), rows: [] }} />));
    expect(container.innerHTML).toContain('data-capability-state="success"');
    await act(async () => root.render(<PostEventLearningView projection={projection()} />));
    expect(container.innerHTML).toContain('data-capability-state="partial"');
    await act(async () => container.querySelector("button").click());
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
  });
  test("preserves suggested/read-only field axes and explicit review failure and recovery", async () => {
    const onReview = vi.fn().mockRejectedValueOnce(new Error("Review unavailable")).mockResolvedValue({ status: "review_opened" });
    const element = await render(<PostEventLearningView projection={projection()} role="admin" onReview={onReview} />);
    expect(element.querySelector('[data-field-state-surface="post-event-learning-recommendations"]')).not.toBeNull();
    expect(element.querySelector('[data-field-state-primary="suggested"]')).not.toBeNull();
    const button = [...element.querySelectorAll("button")].find((item) => item.textContent === "Open Library review");
    await act(async () => button.click()); expect(element.querySelector('[data-learning-review-state="error"]')).not.toBeNull();
    await act(async () => button.click()); expect(element.querySelector('[data-learning-review-state="success"]')).not.toBeNull();
    expect(element.textContent).toContain("No recommendation has been adopted");
  });
  test("requires the exact authority receipt plus operator confirmation for applied observation", async () => {
    const model = projection(), recipe = model.proposals.find((proposal) => proposal.category === "recipe");
    openLearningReview({ ...recipe, scope: model.scope }, "admin-one");
    const element = await render(<PostEventLearningReviewBanner enabled organizationId="org-one" principalId="admin-one" role="admin" />);
    expect(element.querySelector('[data-capability-state="ready"]')).not.toBeNull();
    const attempt = { uid: "admin-one", payload: { command: { kind: "publish_menu_recipe", menuItemId: "dinner" } } };
    expect(observeLearningInventoryReceipt(attempt, { ok: true, organizationId: "foreign", receipt: { receiptId: "receipt" } })).toBe(false);
    await act(async () => observeLearningInventoryReceipt(attempt, { ok: true, organizationId: "org-one", receipt: { receiptId: "recipe-published" } }));
    expect(element.querySelector('[data-capability-state="review_required"]')).not.toBeNull(); expect(getLearningReview().confirmed).toBe(false);
    await act(async () => [...element.querySelectorAll("button")].find((button) => button.textContent.startsWith("Confirm this receipt")).click());
    expect(element.querySelector('[data-capability-state="receipt"]')).not.toBeNull(); expect(getLearningReview().confirmed).toBe(true);
  });
});
