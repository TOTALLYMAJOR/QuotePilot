export const COMMERCIAL_SCENARIO_WORKBENCH_SCHEMA_VERSION =
  "commercial-scenario-workbench-v1";
export const COMMERCIAL_SCENARIO_CURRENT_ID = "current";
export const COMMERCIAL_SCENARIO_MIN_GUESTS = 1;
export const COMMERCIAL_SCENARIO_MAX_GUESTS = 400;
export const COMMERCIAL_SCENARIO_MAX_WORKING = 2;

const MAX_SCENARIO_NAME_LENGTH = 48;
const MAX_SCOPE_TEXT_LENGTH = 240;
const MAX_PROJECTION_NODES = 25_000;
const MAX_PROJECTION_DEPTH = 24;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/u;
const SCENARIO_SLOTS = Object.freeze(["A", "B"]);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function boundedText(value, label) {
  const normalized = String(value ?? "").trim();
  if (
    !normalized
    || normalized.length > MAX_SCOPE_TEXT_LENGTH
    || CONTROL_CHARACTERS.test(normalized)
  ) {
    throw new TypeError(`${label} must be non-empty bounded text.`);
  }
  return normalized;
}

function normalizeIso(value) {
  const candidate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(candidate.getTime())) {
    throw new TypeError("Scenario time must resolve to a valid instant.");
  }
  return candidate.toISOString();
}

function clockIso(clock) {
  return normalizeIso(typeof clock === "function" ? clock() : clock ?? new Date());
}

function defaultScenarioIdFactory({ slot, sequence }) {
  return `commercial-scenario-${sequence}-${String(slot).toLowerCase()}`;
}

function cloneProjection(value, state = { nodes: 0, ancestors: new Set() }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_PROJECTION_NODES || depth > MAX_PROJECTION_DEPTH) {
    throw new TypeError("The cached projection exceeds the session workbench bound.");
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cached projection numbers must be finite.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== "object" || (!Array.isArray(value) && !isRecord(value))) {
    throw new TypeError("Cached projections must contain only JSON-safe values.");
  }
  if (state.ancestors.has(value)) {
    throw new TypeError("Cached projections cannot contain circular references.");
  }
  if (Object.getOwnPropertySymbols(value).length) {
    throw new TypeError("Cached projections cannot contain symbol properties.");
  }
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => cloneProjection(entry, state, depth + 1));
    }
    const output = {};
    for (const key of Object.keys(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new TypeError("Cached projections contain an unsafe property.");
      }
      output[key] = cloneProjection(value[key], state, depth + 1);
    }
    return output;
  } finally {
    state.ancestors.delete(value);
  }
}

function guestValidationFailure(value) {
  return deepFreeze({
    ok: false,
    code: "invalid_guest_count",
    value: null,
    attemptedValue: typeof value === "string" || typeof value === "number" ? value : null,
    message: `Enter a whole guest count from ${COMMERCIAL_SCENARIO_MIN_GUESTS} to ${COMMERCIAL_SCENARIO_MAX_GUESTS}.`
  });
}

export function validateCommercialScenarioGuestCount(value) {
  let normalized = null;
  if (Number.isSafeInteger(value)) {
    normalized = value;
  } else if (
    typeof value === "string"
    && /^(?:[1-9]|[1-9]\d|[1-3]\d{2}|400)$/u.test(value)
  ) {
    normalized = Number(value);
  }
  if (
    normalized === null
    || normalized < COMMERCIAL_SCENARIO_MIN_GUESTS
    || normalized > COMMERCIAL_SCENARIO_MAX_GUESTS
  ) {
    return guestValidationFailure(value);
  }
  return deepFreeze({ ok: true, code: null, value: normalized, message: "" });
}

export function buildCommercialScenarioInputDigest({
  scopeKey,
  scenarioId,
  baseQuoteRevisionId,
  generation,
  guestCount
}) {
  const safeScopeKey = boundedText(scopeKey, "Scenario scope");
  const safeScenarioId = boundedText(scenarioId, "Scenario ID");
  const safeRevisionId = boundedText(baseQuoteRevisionId, "Base quote revision ID");
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError("Scenario generation must be a non-negative safe integer.");
  }
  const guestValidation = validateCommercialScenarioGuestCount(guestCount);
  if (!guestValidation.ok) throw new TypeError(guestValidation.message);
  // The generation is deliberately part of this local fingerprint. Returning
  // to a prior value is still a new input generation and cannot accept a late
  // result from the earlier visit to that value.
  return `cws-input-v1:${JSON.stringify([
    safeScopeKey,
    safeScenarioId,
    safeRevisionId,
    generation,
    guestValidation.value
  ])}`;
}

function currentScenario(scopeKey, baseQuoteRevisionId, guestCount) {
  const scenario = {
    kind: "current",
    scopeKey,
    scenarioId: COMMERCIAL_SCENARIO_CURRENT_ID,
    slot: null,
    name: "Current",
    baseQuoteRevisionId,
    generation: 0,
    inputDigest: "",
    createdAtISO: null,
    guestCount,
    readOnly: true,
    cachedProjection: null,
    recomputing: false
  };
  scenario.inputDigest = buildCommercialScenarioInputDigest(scenario);
  return scenario;
}

function validation(code, message) {
  return deepFreeze({ code, message });
}

function stateParts(state) {
  return {
    scopeKey: state.scopeKey,
    baseQuoteRevisionId: state.baseQuoteRevisionId,
    currentScenario: state.currentScenario,
    workingScenarios: state.scenarios.filter((scenario) => scenario.kind === "working"),
    selectedScenarioId: state.selectedScenarioId,
    nextScenarioSequence: state.nextScenarioSequence,
    validation: state.validation
  };
}

function finalizeState({
  scopeKey,
  baseQuoteRevisionId,
  currentScenario: immutableCurrent,
  workingScenarios,
  selectedScenarioId,
  nextScenarioSequence,
  validation: currentValidation = null
}) {
  const boundedWorking = workingScenarios.slice(0, COMMERCIAL_SCENARIO_MAX_WORKING);
  const scenarios = [immutableCurrent, ...boundedWorking];
  const activeScenario = scenarios.find((scenario) => scenario.scenarioId === selectedScenarioId)
    || immutableCurrent;
  const cachedProjectionEnvelope = activeScenario.cachedProjection || null;
  return deepFreeze({
    schemaVersion: COMMERCIAL_SCENARIO_WORKBENCH_SCHEMA_VERSION,
    authority: "session_only_non_authoritative",
    persistence: "none",
    scopeKey,
    baseQuoteRevisionId,
    currentScenario: immutableCurrent,
    scenarios,
    selectedScenarioId: activeScenario.scenarioId,
    activeScenario,
    cachedProjectionEnvelope,
    cachedProjection: cachedProjectionEnvelope?.projection ?? null,
    recomputing: activeScenario.recomputing === true,
    canDuplicate: boundedWorking.length < COMMERCIAL_SCENARIO_MAX_WORKING,
    nextScenarioSequence,
    validation: currentValidation,
    boundary: "Temporary comparison state only. It does not mutate or persist a quote, call a provider, authorize a change, or create commercial evidence."
  });
}

export function createCommercialScenarioWorkbench({
  scopeKey,
  baseQuoteRevisionId,
  currentGuestCount
} = {}) {
  const safeScopeKey = boundedText(scopeKey, "Scenario scope");
  const safeRevisionId = boundedText(baseQuoteRevisionId, "Base quote revision ID");
  const guestValidation = validateCommercialScenarioGuestCount(currentGuestCount);
  if (!guestValidation.ok) throw new TypeError(guestValidation.message);
  return finalizeState({
    scopeKey: safeScopeKey,
    baseQuoteRevisionId: safeRevisionId,
    currentScenario: currentScenario(safeScopeKey, safeRevisionId, guestValidation.value),
    workingScenarios: [],
    selectedScenarioId: COMMERCIAL_SCENARIO_CURRENT_ID,
    nextScenarioSequence: 1,
    validation: null
  });
}

function rebuild(state, overrides = {}) {
  return finalizeState({ ...stateParts(state), ...overrides });
}

function clearValidation(state) {
  return state.validation ? rebuild(state, { validation: null }) : state;
}

function availableSlot(workingScenarios) {
  const occupied = new Set(workingScenarios.map((scenario) => scenario.slot));
  return SCENARIO_SLOTS.find((slot) => !occupied.has(slot)) || null;
}

function makeWorkingScenario(state, {
  guestCount,
  generation,
  environment
}) {
  const workingScenarios = state.scenarios.filter((scenario) => scenario.kind === "working");
  const slot = availableSlot(workingScenarios);
  if (!slot) return null;
  const sequence = state.nextScenarioSequence;
  const createdAtISO = clockIso(environment?.clock);
  const factory = typeof environment?.idFactory === "function"
    ? environment.idFactory
    : defaultScenarioIdFactory;
  const scenarioId = String(factory({
    slot,
    sequence,
    scopeKey: state.scopeKey,
    baseQuoteRevisionId: state.baseQuoteRevisionId,
    createdAtISO
  }) ?? "").trim();
  if (
    !SAFE_ID.test(scenarioId)
    || state.scenarios.some((scenario) => scenario.scenarioId === scenarioId)
  ) {
    throw new TypeError("Scenario ID factory must return a unique bounded identifier.");
  }
  const scenario = {
    kind: "working",
    scopeKey: state.scopeKey,
    scenarioId,
    slot,
    name: `Scenario ${slot}`,
    baseQuoteRevisionId: state.baseQuoteRevisionId,
    generation,
    inputDigest: "",
    createdAtISO,
    guestCount,
    readOnly: false,
    cachedProjection: null,
    recomputing: true
  };
  scenario.inputDigest = buildCommercialScenarioInputDigest(scenario);
  return scenario;
}

function replaceScenario(state, replacement) {
  const scenarios = state.scenarios.map((scenario) => (
    scenario.scenarioId === replacement.scenarioId ? replacement : scenario
  ));
  return rebuild(state, {
    currentScenario: scenarios[0],
    workingScenarios: scenarios.slice(1),
    validation: null
  });
}

function applyGuestCount(state, rawGuestCount, environment) {
  const checked = validateCommercialScenarioGuestCount(rawGuestCount);
  if (!checked.ok) {
    return rebuild(state, {
      validation: validation(checked.code, checked.message)
    });
  }
  const active = state.activeScenario;
  if (active.guestCount === checked.value) return clearValidation(state);
  if (active.kind === "current") {
    if (!state.canDuplicate) {
      return rebuild(state, {
        validation: validation(
          "scenario_limit",
          "Discard a working scenario before creating another one."
        )
      });
    }
    let created;
    try {
      created = makeWorkingScenario(state, {
        guestCount: checked.value,
        generation: 1,
        environment
      });
    } catch (error) {
      return rebuild(state, {
        validation: validation("invalid_scenario_identity", String(error?.message || error))
      });
    }
    return rebuild(state, {
      workingScenarios: [...state.scenarios.slice(1), created],
      selectedScenarioId: created.scenarioId,
      nextScenarioSequence: state.nextScenarioSequence + 1,
      validation: null
    });
  }
  if (checked.value === state.currentScenario.guestCount) {
    return rebuild(state, {
      selectedScenarioId: COMMERCIAL_SCENARIO_CURRENT_ID,
      validation: null
    });
  }
  const generation = active.generation + 1;
  const changed = {
    ...active,
    generation,
    guestCount: checked.value,
    recomputing: true
  };
  changed.inputDigest = buildCommercialScenarioInputDigest(changed);
  // The last accepted cache intentionally remains attached while the new
  // generation is being evaluated. Its envelope makes the staleness explicit.
  return replaceScenario(state, changed);
}

function duplicateActiveScenario(state, environment) {
  if (!state.canDuplicate) {
    return rebuild(state, {
      validation: validation("scenario_limit", "Only two working scenarios can be compared at once.")
    });
  }
  let created;
  try {
    created = makeWorkingScenario(state, {
      guestCount: state.activeScenario.guestCount,
      generation: 0,
      environment
    });
  } catch (error) {
    return rebuild(state, {
      validation: validation("invalid_scenario_identity", String(error?.message || error))
    });
  }
  return rebuild(state, {
    workingScenarios: [...state.scenarios.slice(1), created],
    selectedScenarioId: created.scenarioId,
    nextScenarioSequence: state.nextScenarioSequence + 1,
    validation: null
  });
}

function renameScenario(state, scenarioId, rawName) {
  const target = state.scenarios.find((scenario) => scenario.scenarioId === scenarioId);
  if (!target || target.kind !== "working") {
    return rebuild(state, {
      validation: validation("current_immutable", "Only a working scenario can be renamed.")
    });
  }
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name || name.length > MAX_SCENARIO_NAME_LENGTH || CONTROL_CHARACTERS.test(name)) {
    return rebuild(state, {
      validation: validation(
        "invalid_scenario_name",
        `Use a scenario name from 1 to ${MAX_SCENARIO_NAME_LENGTH} characters.`
      )
    });
  }
  if (name === target.name) return clearValidation(state);
  return replaceScenario(state, { ...target, name });
}

function discardScenario(state, scenarioId) {
  const target = state.scenarios.find((scenario) => scenario.scenarioId === scenarioId);
  if (!target || target.kind !== "working") {
    return rebuild(state, {
      validation: validation("current_immutable", "The current commitment cannot be discarded.")
    });
  }
  const workingScenarios = state.scenarios
    .filter((scenario) => scenario.kind === "working" && scenario.scenarioId !== scenarioId);
  return rebuild(state, {
    workingScenarios,
    selectedScenarioId: state.selectedScenarioId === scenarioId
      ? COMMERCIAL_SCENARIO_CURRENT_ID
      : state.selectedScenarioId,
    validation: null
  });
}

function selectScenario(state, scenarioId) {
  if (!state.scenarios.some((scenario) => scenario.scenarioId === scenarioId)) {
    return rebuild(state, {
      validation: validation("unknown_scenario", "That temporary scenario is no longer available.")
    });
  }
  if (scenarioId === state.selectedScenarioId) return clearValidation(state);
  return rebuild(state, { selectedScenarioId: scenarioId, validation: null });
}

export function buildCommercialScenarioProjectionRequest(scenario) {
  if (!isRecord(scenario)) throw new TypeError("A scenario is required.");
  const scenarioId = boundedText(scenario.scenarioId, "Scenario ID");
  if (!SAFE_ID.test(scenarioId)) throw new TypeError("Scenario ID is invalid.");
  if (!Number.isSafeInteger(scenario.generation) || scenario.generation < 0) {
    throw new TypeError("Scenario generation must be a non-negative safe integer.");
  }
  const guestValidation = validateCommercialScenarioGuestCount(scenario.guestCount);
  if (!guestValidation.ok) throw new TypeError(guestValidation.message);
  const inputDigest = boundedText(scenario.inputDigest, "Scenario input digest");
  if (inputDigest !== buildCommercialScenarioInputDigest(scenario)) {
    throw new TypeError("Scenario input digest does not match its current inputs.");
  }
  return deepFreeze({
    scenarioId,
    generation: scenario.generation,
    inputDigest,
    baseQuoteRevisionId: boundedText(
      scenario.baseQuoteRevisionId,
      "Base quote revision ID"
    ),
    guestCount: guestValidation.value
  });
}

export function commercialScenarioProjectionMatches(scenario, candidate) {
  if (!isRecord(scenario) || !isRecord(candidate)) return false;
  const guestValidation = validateCommercialScenarioGuestCount(candidate.guestCount);
  return guestValidation.ok
    && candidate.scenarioId === scenario.scenarioId
    && candidate.generation === scenario.generation
    && candidate.inputDigest === scenario.inputDigest
    && candidate.baseQuoteRevisionId === scenario.baseQuoteRevisionId
    && guestValidation.value === scenario.guestCount;
}

function cacheProjection(state, candidate, environment) {
  const scenario = state.scenarios.find((entry) => entry.scenarioId === candidate?.scenarioId);
  if (
    !scenario
    || !commercialScenarioProjectionMatches(scenario, candidate)
    || !Object.prototype.hasOwnProperty.call(candidate, "projection")
  ) {
    return state;
  }
  let projection;
  try {
    projection = deepFreeze(cloneProjection(candidate.projection));
  } catch {
    return state;
  }
  const cachedProjection = {
    ...buildCommercialScenarioProjectionRequest(scenario),
    cachedAtISO: clockIso(environment?.clock),
    projection
  };
  return replaceScenario(state, {
    ...scenario,
    cachedProjection,
    recomputing: false
  });
}

function resetScope(state, action) {
  let reset;
  try {
    reset = createCommercialScenarioWorkbench({
      scopeKey: action.scopeKey,
      baseQuoteRevisionId: action.baseQuoteRevisionId,
      currentGuestCount: action.currentGuestCount
    });
  } catch {
    return state;
  }
  if (
    reset.scopeKey === state.scopeKey
    && reset.baseQuoteRevisionId === state.baseQuoteRevisionId
    && reset.currentScenario.guestCount === state.currentScenario.guestCount
  ) {
    return state;
  }
  return reset;
}

export function reduceCommercialScenarioWorkbench(state, action, environment = {}) {
  if (!state || state.schemaVersion !== COMMERCIAL_SCENARIO_WORKBENCH_SCHEMA_VERSION) {
    throw new TypeError("A current Commercial Scenario Workbench snapshot is required.");
  }
  switch (action?.type) {
    case "set_guest_count":
    case "sync_proposed_guest_count":
      return applyGuestCount(state, action.guestCount, environment);
    case "step_guest_count": {
      const delta = action.delta;
      if (!Number.isSafeInteger(delta) || delta === 0) {
        return rebuild(state, {
          validation: validation("invalid_guest_step", "Guest-count steps must be non-zero whole numbers.")
        });
      }
      return applyGuestCount(state, state.activeScenario.guestCount + delta, environment);
    }
    case "duplicate_scenario":
      return duplicateActiveScenario(state, environment);
    case "rename_scenario":
      return renameScenario(state, action.scenarioId, action.name);
    case "discard_scenario":
      return discardScenario(state, action.scenarioId);
    case "select_scenario":
      return selectScenario(state, action.scenarioId);
    case "cache_projection":
      return cacheProjection(state, action, environment);
    case "reset_scope":
      return resetScope(state, action);
    default:
      return state;
  }
}
