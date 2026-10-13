// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useCommercialScenarioWorkbench } from "../useCommercialScenarioWorkbench";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const times = [
  "2026-09-09T16:00:00.000Z",
  "2026-09-09T16:01:00.000Z",
  "2026-09-09T16:02:00.000Z",
  "2026-09-09T16:03:00.000Z",
  "2026-09-09T16:04:00.000Z"
];

let container;
let root;
let latest;
let timeIndex;

const onGuestCountChange = vi.fn();
const clock = () => times[timeIndex++] || "2026-09-09T16:05:00.000Z";
const idFactory = ({ slot, sequence }) => `hook-scenario-${slot.toLowerCase()}-${sequence}`;

const BASE = {
  scopeKey: "org-1:quote-1",
  baseQuoteRevisionId: "quote-revision-14",
  currentGuestCount: 125,
  proposedGuestCount: 125,
  onGuestCountChange,
  clock,
  idFactory
};

function Harness(props) {
  latest = useCommercialScenarioWorkbench(props);
  return (
    <div
      data-active={latest.activeScenario.scenarioId}
      data-guests={latest.activeScenario.guestCount}
      data-recomputing={String(latest.recomputing)}
    />
  );
}

function render(props = BASE) {
  act(() => root.render(<Harness {...props} />));
}

beforeEach(() => {
  vi.clearAllMocks();
  timeIndex = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCommercialScenarioWorkbench", () => {
  test("synchronizes an external proposal without echo and calls the form owner for user edit, selection, duplicate, and active discard", () => {
    render();
    expect(latest.isCurrent).toBe(true);

    render({ ...BASE, proposedGuestCount: 175 });
    expect(latest.activeScenario).toMatchObject({
      scenarioId: "hook-scenario-a-1",
      name: "Scenario A",
      guestCount: 175,
      generation: 1
    });
    expect(onGuestCountChange).not.toHaveBeenCalled();

    let editResult;
    act(() => {
      editResult = latest.actions.setGuestCount(160);
    });
    expect(editResult).toMatchObject({ ok: true, changed: true, guestCount: 160 });
    expect(latest.activeScenario).toMatchObject({ guestCount: 160, generation: 2 });
    expect(onGuestCountChange).toHaveBeenLastCalledWith(160);

    let duplicateResult;
    act(() => {
      duplicateResult = latest.actions.duplicateScenario();
    });
    expect(duplicateResult).toMatchObject({
      ok: true,
      scenarioId: "hook-scenario-b-2",
      guestCount: 160
    });
    expect(latest.activeScenario.name).toBe("Scenario B");
    expect(onGuestCountChange).toHaveBeenLastCalledWith(160);

    act(() => latest.actions.selectScenario("hook-scenario-a-1"));
    expect(latest.activeScenario).toMatchObject({
      scenarioId: "hook-scenario-a-1",
      guestCount: 160
    });
    expect(onGuestCountChange).toHaveBeenLastCalledWith(160);

    act(() => latest.actions.discardScenario("hook-scenario-a-1"));
    expect(latest).toMatchObject({
      isCurrent: true,
      activeScenario: { scenarioId: "current", guestCount: 125 }
    });
    expect(onGuestCountChange).toHaveBeenLastCalledWith(125);
  });

  test("retains the 175 cache during a 160 recompute and rejects the late generation", () => {
    render();
    act(() => latest.actions.setGuestCount(175));
    const request175 = latest.activeProjectionRequest;
    let cacheResult;
    act(() => {
      cacheResult = latest.actions.cacheProjection({
        ...request175,
        projection: { guests: 175, total: 16_920 }
      });
    });
    expect(cacheResult).toMatchObject({ ok: true, generation: 1 });
    expect(latest.cachedProjection).toEqual({ guests: 175, total: 16_920 });
    expect(latest.recomputing).toBe(false);

    act(() => latest.actions.setGuestCount(160));
    expect(latest.activeScenario.generation).toBe(2);
    expect(latest.recomputing).toBe(true);
    expect(latest.cachedProjection).toEqual({ guests: 175, total: 16_920 });

    let lateResult;
    act(() => {
      lateResult = latest.actions.cacheProjection({
        ...request175,
        projection: { guests: 175, total: 99_999 }
      });
    });
    expect(lateResult).toMatchObject({ ok: false, code: "projection_scope_mismatch" });
    expect(latest.cachedProjection).toEqual({ guests: 175, total: 16_920 });
    expect(latest.activeScenario.guestCount).toBe(160);

    const request160 = latest.activeProjectionRequest;
    act(() => latest.actions.cacheProjection({
      ...request160,
      projection: { guests: 160, total: 15_588 }
    }));
    expect(latest.cachedProjection).toEqual({ guests: 160, total: 15_588 });
    expect(latest.recomputing).toBe(false);
  });

  test("keeps Scenario A and B caches independent and restores them on switch", () => {
    render();
    act(() => latest.actions.setGuestCount(175));
    const scenarioAId = latest.activeScenario.scenarioId;
    act(() => latest.actions.cacheProjection({
      ...latest.activeProjectionRequest,
      projection: { scenario: "A", guests: 175 }
    }));

    act(() => latest.actions.duplicateScenario());
    const scenarioBId = latest.activeScenario.scenarioId;
    act(() => latest.actions.stepGuestCount(-15));
    expect(latest.activeScenario.guestCount).toBe(160);
    act(() => latest.actions.cacheProjection({
      ...latest.activeProjectionRequest,
      projection: { scenario: "B", guests: 160 }
    }));

    act(() => latest.actions.selectScenario(scenarioAId));
    expect(latest.cachedProjection).toEqual({ scenario: "A", guests: 175 });
    expect(latest.activeScenario.guestCount).toBe(175);

    act(() => latest.actions.selectScenario(scenarioBId));
    expect(latest.cachedProjection).toEqual({ scenario: "B", guests: 160 });
    expect(latest.activeScenario.guestCount).toBe(160);

    act(() => latest.actions.renameScenario(scenarioBId, "Lean service"));
    expect(latest.activeScenario.name).toBe("Lean service");
  });

  test("resets temporary scenarios and caches when the quote scope changes", () => {
    render();
    act(() => latest.actions.setGuestCount(175));
    act(() => latest.actions.cacheProjection({
      ...latest.activeProjectionRequest,
      projection: { guests: 175 }
    }));
    expect(latest.scenarios).toHaveLength(2);

    render({
      ...BASE,
      scopeKey: "org-1:quote-2",
      baseQuoteRevisionId: "quote-revision-1",
      currentGuestCount: 90,
      proposedGuestCount: 110
    });
    expect(latest).toMatchObject({
      isCurrent: true,
      activeScenario: { scenarioId: "current", guestCount: 90 },
      cachedProjection: null,
      recomputing: false
    });
    expect(latest.scenarios).toHaveLength(1);
    expect(onGuestCountChange).toHaveBeenCalledTimes(1);
  });

  test("rejects invalid direct and stepped edits and never touches browser storage or a provider", () => {
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    const localRemove = vi.spyOn(Storage.prototype, "removeItem");
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    render();

    let invalidDirect;
    act(() => {
      invalidDirect = latest.actions.setGuestCount(401);
    });
    expect(invalidDirect).toMatchObject({ ok: false, code: "invalid_guest_count" });
    expect(latest.activeScenario).toMatchObject({ scenarioId: "current", guestCount: 125 });
    expect(latest.validation.message).toContain("1 to 400");

    let invalidStep;
    act(() => {
      invalidStep = latest.actions.stepGuestCount(-125);
    });
    expect(invalidStep).toMatchObject({ ok: false, code: "invalid_guest_count" });
    expect(latest.activeScenario.guestCount).toBe(125);
    expect(onGuestCountChange).not.toHaveBeenCalled();
    expect(localSet).not.toHaveBeenCalled();
    expect(localRemove).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });
});

