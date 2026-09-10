import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COMMERCIAL_SCENARIO_CURRENT_ID,
  buildCommercialScenarioProjectionRequest,
  commercialScenarioProjectionMatches,
  createCommercialScenarioWorkbench,
  reduceCommercialScenarioWorkbench,
  validateCommercialScenarioGuestCount
} from "../lib/commercialScenarioWorkbench";

function result(ok, details = {}) {
  return Object.freeze({ ok, ...details });
}

function messageFor(snapshot, fallback) {
  return snapshot.validation?.message || fallback;
}

/**
 * Owns temporary comparison state only. Provider preview orchestration remains
 * with the caller so scenario state can never become network or quote authority.
 */
export function useCommercialScenarioWorkbench({
  scopeKey,
  baseQuoteRevisionId,
  currentGuestCount,
  proposedGuestCount,
  onGuestCountChange,
  clock,
  idFactory
} = {}) {
  const [snapshot, setSnapshot] = useState(() => createCommercialScenarioWorkbench({
    scopeKey,
    baseQuoteRevisionId,
    currentGuestCount
  }));
  const snapshotRef = useRef(snapshot);
  const environmentRef = useRef({ clock, idFactory });
  const onGuestCountChangeRef = useRef(onGuestCountChange);
  environmentRef.current = { clock, idFactory };
  onGuestCountChangeRef.current = onGuestCountChange;

  const commit = useCallback((action) => {
    const next = reduceCommercialScenarioWorkbench(
      snapshotRef.current,
      action,
      environmentRef.current
    );
    snapshotRef.current = next;
    setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    const currentValidation = validateCommercialScenarioGuestCount(currentGuestCount);
    if (!currentValidation.ok) return;
    const current = snapshotRef.current;
    const normalizedScope = String(scopeKey ?? "").trim();
    const normalizedRevision = String(baseQuoteRevisionId ?? "").trim();
    if (
      current.scopeKey !== normalizedScope
      || current.baseQuoteRevisionId !== normalizedRevision
      || current.currentScenario.guestCount !== currentValidation.value
    ) {
      // A new quote/revision/current commitment is a hard boundary. Do not
      // carry a possibly stale proposed prop into the replacement scope.
      commit({
        type: "reset_scope",
        scopeKey,
        baseQuoteRevisionId,
        currentGuestCount: currentValidation.value
      });
      return;
    }
    if (proposedGuestCount === undefined || proposedGuestCount === null) return;
    commit({ type: "sync_proposed_guest_count", guestCount: proposedGuestCount });
  }, [baseQuoteRevisionId, commit, currentGuestCount, proposedGuestCount, scopeKey]);

  const setGuestCount = useCallback((value) => {
    const checked = validateCommercialScenarioGuestCount(value);
    const before = snapshotRef.current;
    const next = commit({ type: "set_guest_count", guestCount: value });
    if (!checked.ok) {
      return result(false, { code: checked.code, message: checked.message });
    }
    const accepted = next.activeScenario.guestCount === checked.value
      && next.validation === null;
    const changed = accepted && (
      next.activeScenario.scenarioId !== before.activeScenario.scenarioId
      || next.activeScenario.generation !== before.activeScenario.generation
    );
    if (changed && typeof onGuestCountChangeRef.current === "function") {
      onGuestCountChangeRef.current(checked.value);
    }
    return accepted
      ? result(true, {
        changed,
        guestCount: checked.value,
        scenarioId: next.activeScenario.scenarioId
      })
      : result(false, {
        code: next.validation?.code || "scenario_change_rejected",
        message: messageFor(next, "The guest-count scenario could not be changed.")
      });
  }, [commit]);

  const stepGuestCount = useCallback((delta) => {
    if (!Number.isSafeInteger(delta) || delta === 0) {
      const next = commit({ type: "step_guest_count", delta });
      return result(false, {
        code: next.validation?.code || "invalid_guest_step",
        message: messageFor(next, "Guest-count steps must be non-zero whole numbers.")
      });
    }
    return setGuestCount(snapshotRef.current.activeScenario.guestCount + delta);
  }, [commit, setGuestCount]);

  const duplicateScenario = useCallback(() => {
    const before = snapshotRef.current;
    const next = commit({ type: "duplicate_scenario" });
    if (
      next.validation
      || next.activeScenario.scenarioId === before.activeScenario.scenarioId
    ) {
      return result(false, {
        code: next.validation?.code || "scenario_change_rejected",
        message: messageFor(next, "The scenario could not be duplicated.")
      });
    }
    if (typeof onGuestCountChangeRef.current === "function") {
      onGuestCountChangeRef.current(next.activeScenario.guestCount);
    }
    return result(true, {
      scenarioId: next.activeScenario.scenarioId,
      guestCount: next.activeScenario.guestCount
    });
  }, [commit]);

  const renameScenario = useCallback((scenarioId, name) => {
    const next = commit({ type: "rename_scenario", scenarioId, name });
    const target = next.scenarios.find((scenario) => scenario.scenarioId === scenarioId);
    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (next.validation || !target || target.name !== normalizedName) {
      return result(false, {
        code: next.validation?.code || "invalid_scenario_name",
        message: messageFor(next, "The scenario could not be renamed.")
      });
    }
    return result(true, { scenarioId, name: target.name });
  }, [commit]);

  const selectScenario = useCallback((scenarioId) => {
    const before = snapshotRef.current;
    const target = before.scenarios.find((scenario) => scenario.scenarioId === scenarioId);
    const next = commit({ type: "select_scenario", scenarioId });
    if (!target || next.selectedScenarioId !== scenarioId || next.validation) {
      return result(false, {
        code: next.validation?.code || "unknown_scenario",
        message: messageFor(next, "That temporary scenario is no longer available.")
      });
    }
    const changed = before.selectedScenarioId !== scenarioId;
    if (changed && typeof onGuestCountChangeRef.current === "function") {
      onGuestCountChangeRef.current(target.guestCount);
    }
    return result(true, { changed, scenarioId, guestCount: target.guestCount });
  }, [commit]);

  const discardScenario = useCallback((scenarioId) => {
    const before = snapshotRef.current;
    const target = before.scenarios.find((scenario) => scenario.scenarioId === scenarioId);
    const wasActive = before.selectedScenarioId === scenarioId;
    const next = commit({ type: "discard_scenario", scenarioId });
    if (!target || target.kind !== "working" || next.scenarios.some((entry) => entry.scenarioId === scenarioId)) {
      return result(false, {
        code: next.validation?.code || "current_immutable",
        message: messageFor(next, "The scenario could not be discarded.")
      });
    }
    if (wasActive && typeof onGuestCountChangeRef.current === "function") {
      onGuestCountChangeRef.current(next.activeScenario.guestCount);
    }
    return result(true, {
      scenarioId,
      selectedScenarioId: next.selectedScenarioId,
      guestCount: next.activeScenario.guestCount
    });
  }, [commit]);

  const cacheProjection = useCallback((candidate) => {
    const current = snapshotRef.current;
    const scenario = current.scenarios.find((entry) => entry.scenarioId === candidate?.scenarioId);
    if (
      !scenario
      || !commercialScenarioProjectionMatches(scenario, candidate)
      || !Object.prototype.hasOwnProperty.call(candidate || {}, "projection")
    ) {
      return result(false, {
        code: "projection_scope_mismatch",
        message: "The projection does not match the current scenario generation."
      });
    }
    const next = commit({ type: "cache_projection", ...candidate });
    const accepted = next !== current
      && next.scenarios.find((entry) => entry.scenarioId === scenario.scenarioId)
        ?.cachedProjection?.generation === scenario.generation;
    return accepted
      ? result(true, { scenarioId: scenario.scenarioId, generation: scenario.generation })
      : result(false, {
        code: "projection_not_cacheable",
        message: "The projection could not be retained as bounded session evidence."
      });
  }, [commit]);

  const activeProjectionRequest = useMemo(
    () => buildCommercialScenarioProjectionRequest(snapshot.activeScenario),
    [snapshot.activeScenario]
  );
  const actions = useMemo(() => Object.freeze({
    setGuestCount,
    stepGuestCount,
    duplicateScenario,
    renameScenario,
    discardScenario,
    selectScenario,
    cacheProjection
  }), [
    cacheProjection,
    discardScenario,
    duplicateScenario,
    renameScenario,
    selectScenario,
    setGuestCount,
    stepGuestCount
  ]);

  return {
    snapshot,
    currentScenario: snapshot.currentScenario,
    activeScenario: snapshot.activeScenario,
    scenarios: snapshot.scenarios,
    cachedProjection: snapshot.cachedProjection,
    cachedProjectionEnvelope: snapshot.cachedProjectionEnvelope,
    activeProjectionRequest,
    recomputing: snapshot.recomputing,
    validation: snapshot.validation,
    canDuplicate: snapshot.canDuplicate,
    isCurrent: snapshot.selectedScenarioId === COMMERCIAL_SCENARIO_CURRENT_ID,
    actions
  };
}

export default useCommercialScenarioWorkbench;
