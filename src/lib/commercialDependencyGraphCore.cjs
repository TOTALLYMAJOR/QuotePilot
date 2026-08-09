"use strict";

const COMMERCIAL_DEPENDENCY_GRAPH_SCHEMA_VERSION = 1;
const COMMERCIAL_DEPENDENCY_GRAPH_ID = "quotepilot-commercial";
const COMMERCIAL_DEPENDENCY_GRAPH_VERSION = "commercial-dependency-graph-v1";
const COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES = Object.freeze({
  INVALID_REGISTRY: "invalid_registry",
  UNSUPPORTED_SCHEMA_VERSION: "unsupported_schema_version",
  UNSUPPORTED_GRAPH_VERSION: "unsupported_graph_version",
  DUPLICATE_NODE: "duplicate_node",
  UNKNOWN_DEPENDENCY: "unknown_dependency",
  CYCLE_DETECTED: "cycle_detected",
  UNKNOWN_CHANGED_NODE: "unknown_changed_node",
  INVALID_CANONICAL_VALUE: "invalid_canonical_value"
});
const COMMERCIAL_DEPENDENCY_NODE_KINDS = new Set([
  "fact",
  "output",
  "artifact",
  "projection"
]);
const NODE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

class CommercialDependencyGraphError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CommercialDependencyGraphError";
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const COMMERCIAL_DEPENDENCY_GRAPH_V1 = deepFreeze({
  schemaVersion: COMMERCIAL_DEPENDENCY_GRAPH_SCHEMA_VERSION,
  graphId: COMMERCIAL_DEPENDENCY_GRAPH_ID,
  graphVersion: COMMERCIAL_DEPENDENCY_GRAPH_VERSION,
  nodes: [
    { id: "artifact.kitchen_beo", kind: "artifact", dependsOn: [
      "fact.customer.day_of_contact",
      "fact.event.date",
      "fact.event.dietary_constraints",
      "fact.event.duration",
      "fact.event.guest_count",
      "fact.event.name",
      "fact.event.service_style",
      "fact.event.time",
      "fact.event.venue",
      "fact.organization.day_of_contact",
      "fact.operations.checkpoint_overrides",
      "fact.operations.production_checklist",
      "fact.operations.staff_lead",
      "fact.quote.accepted_revision",
      "fact.quote.active_revision",
      "fact.quote.identity",
      "fact.selection.addons",
      "fact.selection.menu",
      "fact.selection.package",
      "fact.selection.rentals",
      "fact.staffing.counts",
      "output.operations.kitchen_checkpoints"
    ] },
    { id: "artifact.contract", kind: "artifact", dependsOn: [
      "fact.customer.day_of_contact",
      "fact.event.date",
      "fact.event.duration",
      "fact.event.guest_count",
      "fact.event.name",
      "fact.event.service_style",
      "fact.event.time",
      "fact.event.venue",
      "fact.quote.accepted_revision",
      "fact.quote.identity",
      "fact.selection.addons",
      "fact.selection.menu",
      "fact.selection.package",
      "fact.selection.rentals",
      "output.payment.deposit_requirement",
      "output.pricing.authoritative_total"
    ] },
    { id: "artifact.production_plan", kind: "artifact", dependsOn: [
      "fact.quote.accepted_revision",
      "output.plan.production"
    ] },
    { id: "fact.customer.day_of_contact", kind: "fact", dependsOn: [] },
    { id: "fact.event.date", kind: "fact", dependsOn: [] },
    { id: "fact.event.dietary_constraints", kind: "fact", dependsOn: [] },
    { id: "fact.event.duration", kind: "fact", dependsOn: [] },
    { id: "fact.event.guest_count", kind: "fact", dependsOn: [] },
    { id: "fact.event.name", kind: "fact", dependsOn: [] },
    { id: "fact.event.service_style", kind: "fact", dependsOn: [] },
    { id: "fact.event.time", kind: "fact", dependsOn: [] },
    { id: "fact.event.venue", kind: "fact", dependsOn: [] },
    { id: "fact.organization.day_of_contact", kind: "fact", dependsOn: [] },
    { id: "fact.operations.checkpoint_overrides", kind: "fact", dependsOn: [] },
    { id: "fact.operations.production_checklist", kind: "fact", dependsOn: [] },
    { id: "fact.operations.staff_lead", kind: "fact", dependsOn: [] },
    { id: "fact.payment.verified_deposit_state", kind: "fact", dependsOn: [] },
    { id: "fact.pricing.catalog_snapshot", kind: "fact", dependsOn: [] },
    { id: "fact.pricing.season_profile", kind: "fact", dependsOn: [] },
    { id: "fact.pricing.settings_snapshot", kind: "fact", dependsOn: [] },
    { id: "fact.pricing.tax_region", kind: "fact", dependsOn: [] },
    { id: "fact.pricing.travel", kind: "fact", dependsOn: [] },
    { id: "fact.quote.accepted_revision", kind: "fact", dependsOn: [] },
    { id: "fact.quote.active_revision", kind: "fact", dependsOn: [] },
    { id: "fact.quote.identity", kind: "fact", dependsOn: [] },
    { id: "fact.selection.addons", kind: "fact", dependsOn: [] },
    { id: "fact.selection.menu", kind: "fact", dependsOn: [] },
    { id: "fact.selection.package", kind: "fact", dependsOn: [] },
    { id: "fact.selection.rentals", kind: "fact", dependsOn: [] },
    { id: "fact.staffing.counts", kind: "fact", dependsOn: [] },
    { id: "output.operations.delivery_window", kind: "output", dependsOn: [
      "fact.event.time",
      "fact.event.venue"
    ] },
    { id: "output.operations.kitchen_checkpoints", kind: "output", dependsOn: [
      "fact.operations.checkpoint_overrides",
      "fact.event.duration",
      "fact.event.time"
    ] },
    { id: "output.operations.staff_call_time", kind: "output", dependsOn: [
      "fact.event.time",
      "fact.event.venue",
      "output.plan.staffing_requirement"
    ] },
    { id: "output.operations.venue_setup", kind: "output", dependsOn: [
      "fact.event.time",
      "fact.event.venue",
      "output.plan.rental_quantity",
      "output.plan.staffing_requirement"
    ] },
    { id: "output.payment.deposit_requirement", kind: "output", dependsOn: [
      "fact.pricing.settings_snapshot",
      "fact.quote.accepted_revision",
      "output.pricing.authoritative_total"
    ] },
    { id: "output.payment.final_balance", kind: "output", dependsOn: [
      "fact.payment.verified_deposit_state",
      "output.payment.deposit_requirement",
      "output.pricing.authoritative_total"
    ] },
    { id: "output.plan.food_quantity", kind: "output", dependsOn: [
      "fact.event.dietary_constraints",
      "fact.event.guest_count",
      "fact.selection.addons",
      "fact.selection.menu",
      "fact.selection.package"
    ] },
    { id: "output.plan.production", kind: "output", dependsOn: [
      "fact.event.date",
      "fact.event.dietary_constraints",
      "fact.event.guest_count",
      "fact.event.time",
      "fact.event.venue",
      "fact.quote.accepted_revision",
      "output.plan.food_quantity",
      "output.plan.rental_quantity",
      "output.plan.staffing_requirement"
    ] },
    { id: "output.plan.rental_quantity", kind: "output", dependsOn: [
      "fact.event.guest_count",
      "fact.event.service_style",
      "fact.event.venue",
      "fact.selection.rentals"
    ] },
    { id: "output.plan.staffing_requirement", kind: "output", dependsOn: [
      "fact.event.date",
      "fact.event.duration",
      "fact.event.guest_count",
      "fact.event.service_style",
      "fact.event.time"
    ] },
    { id: "output.pricing.authoritative_total", kind: "output", dependsOn: [
      "fact.event.duration",
      "fact.event.guest_count",
      "fact.event.service_style",
      "fact.pricing.catalog_snapshot",
      "fact.pricing.season_profile",
      "fact.pricing.settings_snapshot",
      "fact.pricing.tax_region",
      "fact.pricing.travel",
      "fact.selection.addons",
      "fact.selection.menu",
      "fact.selection.package",
      "fact.selection.rentals",
      "fact.staffing.counts"
    ] },
    { id: "projection.customer_decision_center", kind: "projection", dependsOn: [
      "fact.customer.day_of_contact",
      "fact.event.date",
      "fact.event.duration",
      "fact.event.guest_count",
      "fact.event.name",
      "fact.event.service_style",
      "fact.event.time",
      "fact.event.venue",
      "fact.quote.accepted_revision",
      "fact.quote.active_revision",
      "fact.quote.identity",
      "fact.selection.addons",
      "fact.selection.menu",
      "fact.selection.package",
      "fact.selection.rentals",
      "output.payment.deposit_requirement",
      "output.payment.final_balance",
      "output.pricing.authoritative_total"
    ] }
  ]
});

function graphError(code, message, details = {}) {
  return new CommercialDependencyGraphError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  if (
    actualKeys.length !== expected.length
    || actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw graphError(
      "invalid_registry",
      `${label} must contain exactly: ${expected.join(", ")}.`,
      { actualKeys, expectedKeys: expected }
    );
  }
}

function validateCommercialDependencyGraph(registry) {
  if (!isPlainObject(registry)) {
    throw graphError("invalid_registry", "Commercial dependency registry must be a plain object.");
  }
  assertExactKeys(
    registry,
    ["schemaVersion", "graphId", "graphVersion", "nodes"],
    "Commercial dependency registry"
  );
  if (registry.schemaVersion !== COMMERCIAL_DEPENDENCY_GRAPH_SCHEMA_VERSION) {
    throw graphError(
      "unsupported_schema_version",
      `Unsupported commercial dependency schema version: ${String(registry.schemaVersion)}.`,
      { schemaVersion: registry.schemaVersion }
    );
  }
  if (
    registry.graphId !== COMMERCIAL_DEPENDENCY_GRAPH_ID
    || registry.graphVersion !== COMMERCIAL_DEPENDENCY_GRAPH_VERSION
  ) {
    throw graphError(
      "unsupported_graph_version",
      `Unsupported commercial dependency graph: ${String(registry.graphId)}@${String(registry.graphVersion)}.`,
      { graphId: registry.graphId, graphVersion: registry.graphVersion }
    );
  }
  if (!Array.isArray(registry.nodes) || registry.nodes.length === 0) {
    throw graphError("invalid_registry", "Commercial dependency registry must contain nodes.");
  }

  const nodesById = new Map();
  registry.nodes.forEach((node, index) => {
    if (!isPlainObject(node)) {
      throw graphError("invalid_registry", `Commercial dependency node at index ${index} must be a plain object.`);
    }
    assertExactKeys(node, ["id", "kind", "dependsOn"], `Commercial dependency node at index ${index}`);
    if (typeof node.id !== "string" || !NODE_ID_PATTERN.test(node.id)) {
      throw graphError("invalid_registry", `Commercial dependency node at index ${index} has an invalid id.`);
    }
    if (!COMMERCIAL_DEPENDENCY_NODE_KINDS.has(node.kind)) {
      throw graphError(
        "invalid_registry",
        `Commercial dependency node ${node.id} has an unsupported kind.`,
        { nodeId: node.id, kind: node.kind }
      );
    }
    if (!Array.isArray(node.dependsOn) || node.dependsOn.some((id) => (
      typeof id !== "string" || !NODE_ID_PATTERN.test(id)
    ))) {
      throw graphError(
        "invalid_registry",
        `Commercial dependency node ${node.id} has invalid dependencies.`,
        { nodeId: node.id }
      );
    }
    if (new Set(node.dependsOn).size !== node.dependsOn.length) {
      throw graphError(
        "invalid_registry",
        `Commercial dependency node ${node.id} contains duplicate dependencies.`,
        { nodeId: node.id }
      );
    }
    if (nodesById.has(node.id)) {
      throw graphError(
        "duplicate_node",
        `Commercial dependency node is duplicated: ${node.id}.`,
        { nodeId: node.id }
      );
    }
    nodesById.set(node.id, node);
  });

  const unknownDependencies = [];
  for (const node of [...nodesById.values()].sort((left, right) => compareText(left.id, right.id))) {
    for (const dependencyId of [...node.dependsOn].sort(compareText)) {
      if (!nodesById.has(dependencyId)) {
        unknownDependencies.push({ nodeId: node.id, dependencyId });
      }
    }
  }
  if (unknownDependencies.length) {
    throw graphError(
      "unknown_dependency",
      "Commercial dependency registry contains unknown dependency nodes.",
      { unknownDependencies }
    );
  }

  const visitState = new Map();
  const stack = [];
  const visit = (nodeId) => {
    visitState.set(nodeId, "visiting");
    stack.push(nodeId);
    const node = nodesById.get(nodeId);
    for (const dependencyId of [...node.dependsOn].sort(compareText)) {
      const dependencyState = visitState.get(dependencyId);
      if (dependencyState === "visiting") {
        const cycleStart = stack.indexOf(dependencyId);
        const cycle = [...stack.slice(cycleStart), dependencyId];
        throw graphError(
          "cycle_detected",
          `Commercial dependency cycle detected: ${cycle.join(" -> ")}.`,
          { cycle }
        );
      }
      if (dependencyState !== "visited") visit(dependencyId);
    }
    stack.pop();
    visitState.set(nodeId, "visited");
  };
  for (const nodeId of [...nodesById.keys()].sort(compareText)) {
    if (!visitState.has(nodeId)) visit(nodeId);
  }

  return registry;
}

function evaluateCommercialDependencyImpact({
  registry = COMMERCIAL_DEPENDENCY_GRAPH_V1,
  changedNodeIds = []
} = {}) {
  validateCommercialDependencyGraph(registry);
  if (!Array.isArray(changedNodeIds) || changedNodeIds.some((nodeId) => typeof nodeId !== "string")) {
    throw graphError("invalid_registry", "Changed commercial dependency node IDs must be an array of strings.");
  }

  const changed = [...new Set(changedNodeIds)].sort(compareText);
  const nodesById = new Map(registry.nodes.map((node) => [node.id, node]));
  const unknownNodeIds = changed.filter((nodeId) => !nodesById.has(nodeId));
  if (unknownNodeIds.length) {
    throw graphError(
      "unknown_changed_node",
      `Unknown changed commercial dependency node${unknownNodeIds.length === 1 ? "" : "s"}: ${unknownNodeIds.join(", ")}.`,
      { unknownNodeIds }
    );
  }

  const dependentsById = new Map(registry.nodes.map((node) => [node.id, []]));
  for (const node of registry.nodes) {
    for (const dependencyId of node.dependsOn) {
      dependentsById.get(dependencyId).push(node.id);
    }
  }
  dependentsById.forEach((dependents) => dependents.sort(compareText));

  const changedSet = new Set(changed);
  const affected = new Map();
  const visitedByRoot = new Set();
  const queue = changed.map((rootNodeId) => {
    visitedByRoot.add(`${rootNodeId}\u0000${rootNodeId}`);
    return { nodeId: rootNodeId, rootNodeId, distance: 0 };
  });

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const dependentId of dependentsById.get(current.nodeId)) {
      const visitKey = `${current.rootNodeId}\u0000${dependentId}`;
      if (visitedByRoot.has(visitKey)) continue;
      visitedByRoot.add(visitKey);
      const distance = current.distance + 1;
      queue.push({ nodeId: dependentId, rootNodeId: current.rootNodeId, distance });

      if (changedSet.has(dependentId)) continue;
      const existing = affected.get(dependentId) || {
        id: dependentId,
        kind: nodesById.get(dependentId).kind,
        distance,
        triggeredBy: new Set()
      };
      existing.distance = Math.min(existing.distance, distance);
      existing.triggeredBy.add(current.rootNodeId);
      affected.set(dependentId, existing);
    }
  }

  const affectedNodes = [...affected.values()]
    .map((node) => ({
      id: node.id,
      kind: node.kind,
      distance: node.distance,
      triggeredBy: [...node.triggeredBy].sort(compareText)
    }))
    .sort((left, right) => left.distance - right.distance || compareText(left.id, right.id));

  return {
    graphId: registry.graphId,
    graphVersion: registry.graphVersion,
    changedNodeIds: changed,
    affectedNodes
  };
}

function invalidCanonicalValue(path, reason) {
  throw graphError(
    "invalid_canonical_value",
    `Value at ${path} cannot be serialized by qp-canonical-json-v1: ${reason}.`,
    { path, reason }
  );
}

function canonicalSerialize(value) {
  const ancestors = new Set();

  const serialize = (current, path) => {
    if (current === null) return "null";
    if (typeof current === "boolean" || typeof current === "string") {
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) invalidCanonicalValue(path, "numbers must be finite");
      return JSON.stringify(Object.is(current, -0) ? 0 : current);
    }
    if (["undefined", "function", "symbol", "bigint"].includes(typeof current)) {
      invalidCanonicalValue(path, `${typeof current} values are unsupported`);
    }
    if (!current || typeof current !== "object") {
      invalidCanonicalValue(path, "value type is unsupported");
    }
    if (ancestors.has(current)) invalidCanonicalValue(path, "cyclic references are unsupported");

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getOwnPropertySymbols(current).length) {
          invalidCanonicalValue(path, "symbol properties are unsupported");
        }
        const allowedNames = new Set(["length"]);
        const values = [];
        for (let index = 0; index < current.length; index += 1) {
          const key = String(index);
          allowedNames.add(key);
          if (!Object.prototype.hasOwnProperty.call(current, key)) {
            invalidCanonicalValue(`${path}[${index}]`, "sparse arrays are unsupported");
          }
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            invalidCanonicalValue(`${path}[${index}]`, "array accessors and hidden entries are unsupported");
          }
          values.push(serialize(descriptor.value, `${path}[${index}]`));
        }
        const unexpectedName = Object.getOwnPropertyNames(current)
          .find((name) => !allowedNames.has(name));
        if (unexpectedName) {
          invalidCanonicalValue(path, `array property ${unexpectedName} is unsupported`);
        }
        return `[${values.join(",")}]`;
      }

      if (!isPlainObject(current)) {
        invalidCanonicalValue(path, "only plain objects are supported");
      }
      if (Object.getOwnPropertySymbols(current).length) {
        invalidCanonicalValue(path, "symbol properties are unsupported");
      }
      const keys = Object.getOwnPropertyNames(current).sort(compareText);
      const properties = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          invalidCanonicalValue(`${path}.${key}`, "object accessors and hidden properties are unsupported");
        }
        return `${JSON.stringify(key)}:${serialize(descriptor.value, `${path}.${key}`)}`;
      });
      return `{${properties.join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  };

  return serialize(value, "$");
}

module.exports = {
  COMMERCIAL_DEPENDENCY_GRAPH_ID,
  COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES,
  COMMERCIAL_DEPENDENCY_GRAPH_SCHEMA_VERSION,
  COMMERCIAL_DEPENDENCY_GRAPH_V1,
  COMMERCIAL_DEPENDENCY_GRAPH_VERSION,
  CommercialDependencyGraphError,
  canonicalSerialize,
  evaluateCommercialDependencyImpact,
  validateCommercialDependencyGraph
};
