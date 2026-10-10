import { describe, expect, test } from "vitest";
import { buildPostEventLearningProjection, resolvePostEventLearningGate } from "../postEventLearningProjection";
import { learningFixture } from "./postEventLearning.fixture";

describe("post-event learning exact-source projection", () => {
  test("withholds usage recommendations when the pinned allocation is stale", () => {
    const input = learningFixture();
    input.planRead.projection.freshnessState.allocation.state = "stale";
    const result = buildPostEventLearningProjection(input);
    expect(result.rows.find((row) => row.id === "execution").availability).toBe("stale");
    expect(result.proposals.some((proposal) => proposal.category === "recipe")).toBe(false);
  });
  test("does not infer freshness from a bare projection payload", () => {
    const input = learningFixture(); delete input.executionRead.source;
    expect(buildPostEventLearningProjection(input).rows.find((row) => row.id === "execution").availability).toBe("missing");
  });
  test("keeps ingredient recommendations distinct and rejects duplicate source rows", () => {
    const input = learningFixture();
    input.planRead.projection.ingredients.push({ ...input.planRead.projection.ingredients[0], ingredientId: "rice" });
    input.executionRead.projection.ingredients.push({ ...input.executionRead.projection.ingredients[0], ingredientId: "rice" });
    const recipes = buildPostEventLearningProjection(input).proposals.filter((proposal) => proposal.category === "recipe");
    expect(new Set(recipes.map((proposal) => proposal.proposalId)).size).toBe(2);
    input.executionRead.projection.ingredients[1].ingredientId = "chicken";
    expect(buildPostEventLearningProjection(input).rows.find((row) => row.id === "execution").availability).toBe("contradictory");
  });
  test("compares independent quantities without adopting policy or mutating sources", () => {
    const input = learningFixture(), before = JSON.stringify(input), result = buildPostEventLearningProjection(input);
    expect(result.schemaVersion).toBe("post-event-learning-proposal-v1");
    expect(result.rows.find((row) => row.id === "attendance")).toMatchObject({ planned: 100, actual: 90, difference: -10 });
    expect(result.rows.find((row) => row.id === "ingredient:chicken")).toMatchObject({ planned: 20, actual: 18, difference: -2, unit: "lb" });
    expect(result.rows.find((row) => row.id === "receiving").availability).toBe("blocked_by_integration");
    expect(result.rows.find((row) => row.id === "financial")).toMatchObject({ actual: 200, detail: "Provisional captured subtotal" });
    expect(result.proposals.map((proposal) => proposal.category)).toEqual(["template", "recipe", "workflow"]);
    expect(result.proposals.every((proposal) => proposal.suggestedValues === null && proposal.sourceReferences.length > 1)).toBe(true);
    expect(result.proposals.find((proposal) => proposal.category === "recipe").targetIds).toEqual(["dinner"]);
    expect(result).not.toHaveProperty("score"); expect(result).not.toHaveProperty("margin");
    expect(JSON.stringify(input)).toBe(before); expect(Object.isFrozen(input.quote)).toBe(false); expect(Object.isFrozen(result.rows)).toBe(true);
  });
  test.each(["missing", "not_yet_available", "blocked_by_integration", "contradictory", "schema_drift", "unavailable", "stale", "partial"])("preserves %s evidence without a zero or recipe proposal", (state) => {
    const input = learningFixture(); input.executionRead = { state };
    const result = buildPostEventLearningProjection(input);
    expect(result.rows.find((row) => row.id === "execution").availability).toBe(state);
    expect(result.rows.some((row) => row.id === "ingredient:chicken")).toBe(false);
    expect(result.proposals.some((proposal) => proposal.category === "recipe")).toBe(false);
  });
  test.each(["local", "mixed", "stale"])("withholds all comparisons for %s source", (source) => {
    const result = buildPostEventLearningProjection({ ...learningFixture(), source }); expect(result.acceptedState).toBe("unavailable"); expect(result.proposals).toEqual([]);
  });
  test("pins quote, immutable version, closeout and receipt without accepting a newer draft", () => {
    for (const mutate of [
      (input) => { input.quote.activeVersionId = "later-draft"; },
      (input) => { input.closeout.acceptanceReceiptId = "different-receipt"; },
      (input) => { input.acceptedVersion.id = "different-version"; },
      (input) => { input.acceptedVersion.organizationId = "foreign"; },
      (input) => { input.quote.portalDecision.decision = "declined"; }
    ]) { const input = learningFixture(); mutate(input); const result = buildPostEventLearningProjection(input); expect(result.acceptedState).not.toBe("available"); expect(result.proposals).toEqual([]); }
  });
  test("refuses foreign, cached, or mismatched execution and financial evidence independently", () => {
    const input = learningFixture(); input.executionRead.projection.eventRequirementRevisionId = "other"; input.financialRead.snapshot.sourceVersionId = "other";
    const result = buildPostEventLearningProjection(input);
    expect(result.rows.find((row) => row.id === "execution").availability).toBe("stale"); expect(result.rows.find((row) => row.id === "financial").availability).toBe("stale");
    input.executionRead.projection.organizationId = "other";
    expect(buildPostEventLearningProjection(input).rows.find((row) => row.id === "execution").availability).toBe("contradictory");
  });
  test("proposes operator conversion review without inventing pack contents", () => {
    const input = learningFixture(); input.planRead.projection.demandState = "incomplete"; input.planRead.projection.issues = [{ code: "pack_conversion_missing", ingredientId: "chicken" }];
    const proposal = buildPostEventLearningProjection(input).proposals.find((item) => item.category === "pack_conversion"); expect(proposal.destination).toBe("inventory"); expect(proposal.suggestedValues).toBeNull();
  });
  test("defaults off and requires both exact gates", () => {
    expect(resolvePostEventLearningGate()).toBe(false); expect(resolvePostEventLearningGate({ buildValue: "true", tenantValue: "true" })).toBe(false); expect(resolvePostEventLearningGate({ buildValue: "true", tenantValue: true })).toBe(true);
  });
});
