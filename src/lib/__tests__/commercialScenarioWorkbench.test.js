import { describe, expect, test } from "vitest";
import {
  COMMERCIAL_SCENARIO_CURRENT_ID,
  buildCommercialScenarioProjectionRequest,
  createCommercialScenarioWorkbench,
  reduceCommercialScenarioWorkbench,
  validateCommercialScenarioGuestCount
} from "../commercialScenarioWorkbench";

function environment() {
  const times = [
    "2026-09-09T15:00:00.000Z",
    "2026-09-09T15:01:00.000Z",
    "2026-09-09T15:02:00.000Z",
    "2026-09-09T15:03:00.000Z"
  ];
  return {
    clock: () => times.shift() || "2026-09-09T15:04:00.000Z",
    idFactory: ({ slot, sequence }) => `scenario-${slot.toLowerCase()}-${sequence}`
  };
}

function initial() {
  return createCommercialScenarioWorkbench({
    scopeKey: "org-1:quote-1",
    baseQuoteRevisionId: "quote-revision-14",
    currentGuestCount: 125
  });
}

describe("Commercial Scenario Workbench", () => {
  test("creates Scenario A from Current and rejects a late 175 result after the input advances to 160", () => {
    const env = environment();
    const start = initial();
    const immutableCurrent = start.currentScenario;
    const scenario175 = reduceCommercialScenarioWorkbench(start, {
      type: "set_guest_count",
      guestCount: 175
    }, env);

    expect(scenario175).toMatchObject({
      authority: "session_only_non_authoritative",
      persistence: "none",
      selectedScenarioId: "scenario-a-1",
      recomputing: true,
      activeScenario: {
        name: "Scenario A",
        baseQuoteRevisionId: "quote-revision-14",
        generation: 1,
        guestCount: 175,
        createdAtISO: "2026-09-09T15:00:00.000Z"
      }
    });
    expect(scenario175.currentScenario).toBe(immutableCurrent);
    expect(scenario175.scenarios).toHaveLength(2);
    expect(Object.isFrozen(scenario175)).toBe(true);
    expect(Object.isFrozen(scenario175.activeScenario)).toBe(true);

    const request175 = buildCommercialScenarioProjectionRequest(scenario175.activeScenario);
    const cached175 = reduceCommercialScenarioWorkbench(scenario175, {
      type: "cache_projection",
      ...request175,
      projection: { total: 16_920, guests: 175 }
    }, env);
    expect(cached175).toMatchObject({
      recomputing: false,
      cachedProjection: { total: 16_920, guests: 175 }
    });
    expect(Object.isFrozen(cached175.cachedProjection)).toBe(true);

    const scenario160 = reduceCommercialScenarioWorkbench(cached175, {
      type: "set_guest_count",
      guestCount: 160
    }, env);
    expect(scenario160.activeScenario).toMatchObject({ generation: 2, guestCount: 160 });
    expect(scenario160.activeScenario.inputDigest).not.toBe(request175.inputDigest);
    expect(scenario160.recomputing).toBe(true);
    expect(scenario160.cachedProjection).toEqual({ total: 16_920, guests: 175 });

    const late = reduceCommercialScenarioWorkbench(scenario160, {
      type: "cache_projection",
      ...request175,
      projection: { total: 99_999, guests: 175 }
    }, env);
    expect(late).toBe(scenario160);
    expect(late.cachedProjection).toEqual({ total: 16_920, guests: 175 });

    const request160 = buildCommercialScenarioProjectionRequest(scenario160.activeScenario);
    for (const mismatch of [
      { scenarioId: "missing-scenario" },
      { generation: request160.generation + 1 },
      { inputDigest: `${request160.inputDigest}:old` },
      { baseQuoteRevisionId: "quote-revision-13" },
      { guestCount: 159 }
    ]) {
      const rejected = reduceCommercialScenarioWorkbench(scenario160, {
        type: "cache_projection",
        ...request160,
        ...mismatch,
        projection: { total: 1 }
      }, env);
      expect(rejected).toBe(scenario160);
    }

    const cached160 = reduceCommercialScenarioWorkbench(scenario160, {
      type: "cache_projection",
      ...request160,
      projection: { total: 15_588, guests: 160 }
    }, env);
    expect(cached160).toMatchObject({
      recomputing: false,
      cachedProjection: { total: 15_588, guests: 160 }
    });
    expect(Object.isFrozen(cached160.scenarios)).toBe(true);
    expect(Object.isFrozen(cached160.cachedProjectionEnvelope)).toBe(true);
  });

  test("duplicates an independent Scenario B and restores each scenario cache on selection", () => {
    const env = environment();
    let state = reduceCommercialScenarioWorkbench(initial(), {
      type: "set_guest_count",
      guestCount: 175
    }, env);
    const scenarioAId = state.activeScenario.scenarioId;
    const requestA = buildCommercialScenarioProjectionRequest(state.activeScenario);
    state = reduceCommercialScenarioWorkbench(state, {
      type: "cache_projection",
      ...requestA,
      projection: { label: "A at 175" }
    }, env);

    state = reduceCommercialScenarioWorkbench(state, { type: "duplicate_scenario" }, env);
    const scenarioBId = state.activeScenario.scenarioId;
    expect(state.scenarios).toHaveLength(3);
    expect(state.activeScenario).toMatchObject({
      name: "Scenario B",
      generation: 0,
      guestCount: 175,
      cachedProjection: null
    });
    expect(scenarioBId).not.toBe(scenarioAId);
    expect(state.activeScenario.inputDigest).not.toBe(requestA.inputDigest);

    state = reduceCommercialScenarioWorkbench(state, {
      type: "set_guest_count",
      guestCount: 160
    }, env);
    const requestB = buildCommercialScenarioProjectionRequest(state.activeScenario);
    state = reduceCommercialScenarioWorkbench(state, {
      type: "cache_projection",
      ...requestB,
      projection: { label: "B at 160" }
    }, env);
    expect(state.cachedProjection).toEqual({ label: "B at 160" });

    state = reduceCommercialScenarioWorkbench(state, {
      type: "select_scenario",
      scenarioId: scenarioAId
    }, env);
    expect(state.activeScenario.guestCount).toBe(175);
    expect(state.cachedProjection).toEqual({ label: "A at 175" });
    expect(state.recomputing).toBe(false);

    state = reduceCommercialScenarioWorkbench(state, {
      type: "select_scenario",
      scenarioId: scenarioBId
    }, env);
    expect(state.activeScenario.guestCount).toBe(160);
    expect(state.cachedProjection).toEqual({ label: "B at 160" });

    const beforeRename = state.activeScenario;
    state = reduceCommercialScenarioWorkbench(state, {
      type: "rename_scenario",
      scenarioId: scenarioBId,
      name: "Lean service"
    }, env);
    expect(state.activeScenario.name).toBe("Lean service");
    expect(state.activeScenario.generation).toBe(beforeRename.generation);
    expect(state.activeScenario.inputDigest).toBe(beforeRename.inputDigest);

    const atLimit = reduceCommercialScenarioWorkbench(state, {
      type: "duplicate_scenario"
    }, env);
    expect(atLimit.scenarios).toHaveLength(3);
    expect(atLimit.validation).toMatchObject({ code: "scenario_limit" });
  });

  test("selects immutable Current when a working input returns to the saved guest count", () => {
    const env = environment();
    const working = reduceCommercialScenarioWorkbench(initial(), {
      type: "set_guest_count",
      guestCount: 175
    }, env);
    const scenarioA = working.activeScenario;
    const returned = reduceCommercialScenarioWorkbench(working, {
      type: "set_guest_count",
      guestCount: 125
    }, env);

    expect(returned.selectedScenarioId).toBe(COMMERCIAL_SCENARIO_CURRENT_ID);
    expect(returned.activeScenario).toBe(returned.currentScenario);
    expect(returned.currentScenario.guestCount).toBe(125);
    expect(returned.scenarios.find((scenario) => scenario.scenarioId === scenarioA.scenarioId))
      .toBe(scenarioA);
  });

  test("discard returns an active working scenario to immutable Current and scope change clears all temporary state", () => {
    const env = environment();
    let state = reduceCommercialScenarioWorkbench(initial(), {
      type: "set_guest_count",
      guestCount: 175
    }, env);
    const scenarioAId = state.activeScenario.scenarioId;
    state = reduceCommercialScenarioWorkbench(state, {
      type: "discard_scenario",
      scenarioId: scenarioAId
    }, env);
    expect(state).toMatchObject({
      selectedScenarioId: COMMERCIAL_SCENARIO_CURRENT_ID,
      recomputing: false,
      cachedProjection: null,
      currentScenario: { guestCount: 125, readOnly: true }
    });
    expect(state.scenarios).toHaveLength(1);

    const currentDiscard = reduceCommercialScenarioWorkbench(state, {
      type: "discard_scenario",
      scenarioId: COMMERCIAL_SCENARIO_CURRENT_ID
    }, env);
    expect(currentDiscard.currentScenario.guestCount).toBe(125);
    expect(currentDiscard.validation).toMatchObject({ code: "current_immutable" });

    state = reduceCommercialScenarioWorkbench(currentDiscard, {
      type: "reset_scope",
      scopeKey: "org-1:quote-2",
      baseQuoteRevisionId: "quote-revision-1",
      currentGuestCount: 90
    }, env);
    expect(state).toMatchObject({
      scopeKey: "org-1:quote-2",
      baseQuoteRevisionId: "quote-revision-1",
      selectedScenarioId: COMMERCIAL_SCENARIO_CURRENT_ID,
      activeScenario: { guestCount: 90 },
      cachedProjection: null,
      recomputing: false,
      nextScenarioSequence: 1,
      validation: null
    });
    expect(state.scenarios).toHaveLength(1);
  });

  test("validates direct and stepped values from 1 through 400 without clamping or advancing generation", () => {
    const env = environment();
    expect(validateCommercialScenarioGuestCount(1)).toMatchObject({ ok: true, value: 1 });
    expect(validateCommercialScenarioGuestCount("400")).toMatchObject({ ok: true, value: 400 });
    for (const invalid of [0, 401, 1.5, "175.5", " 175 ", "001", null]) {
      expect(validateCommercialScenarioGuestCount(invalid)).toMatchObject({
        ok: false,
        code: "invalid_guest_count"
      });
    }

    let state = reduceCommercialScenarioWorkbench(initial(), {
      type: "set_guest_count",
      guestCount: 175
    }, env);
    const digest = state.activeScenario.inputDigest;
    const generation = state.activeScenario.generation;
    state = reduceCommercialScenarioWorkbench(state, {
      type: "set_guest_count",
      guestCount: 401
    }, env);
    expect(state.activeScenario).toMatchObject({ guestCount: 175, generation });
    expect(state.activeScenario.inputDigest).toBe(digest);
    expect(state.validation).toMatchObject({ code: "invalid_guest_count" });

    state = reduceCommercialScenarioWorkbench(state, {
      type: "step_guest_count",
      delta: -200
    }, env);
    expect(state.activeScenario).toMatchObject({ guestCount: 175, generation });
    expect(state.validation).toMatchObject({ code: "invalid_guest_count" });

    state = reduceCommercialScenarioWorkbench(state, {
      type: "set_guest_count",
      guestCount: 160
    }, env);
    const firstReturnDigest = state.activeScenario.inputDigest;
    state = reduceCommercialScenarioWorkbench(state, {
      type: "set_guest_count",
      guestCount: 175
    }, env);
    expect(state.activeScenario.generation).toBe(generation + 2);
    expect(state.activeScenario.inputDigest).not.toBe(digest);
    expect(state.activeScenario.inputDigest).not.toBe(firstReturnDigest);
  });
});
