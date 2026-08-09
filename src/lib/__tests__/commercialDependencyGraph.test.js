import { describe, expect, test } from "vitest";
import {
  COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES,
  COMMERCIAL_DEPENDENCY_GRAPH_ID,
  COMMERCIAL_DEPENDENCY_GRAPH_SCHEMA_VERSION,
  COMMERCIAL_DEPENDENCY_GRAPH_V1,
  COMMERCIAL_DEPENDENCY_GRAPH_VERSION,
  COMMERCIAL_DEPENDENCY_HASH_ERROR_CODES,
  CommercialDependencyGraphError,
  canonicalSerialize,
  evaluateCommercialDependencyImpact,
  sha256CanonicalValue,
  validateCommercialDependencyGraph
} from "../commercialDependencyGraph";

function cloneRegistry(registry = COMMERCIAL_DEPENDENCY_GRAPH_V1) {
  return JSON.parse(JSON.stringify(registry));
}

function expectGraphError(action, code) {
  let thrown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CommercialDependencyGraphError);
  expect(thrown?.code).toBe(code);
  return thrown;
}

function summarizeAffected(result) {
  return result.affectedNodes.map(({ id, kind, distance }) => [id, kind, distance]);
}

describe("commercial dependency graph registry", () => {
  test("validates and preserves the frozen production registry", () => {
    expect(validateCommercialDependencyGraph(COMMERCIAL_DEPENDENCY_GRAPH_V1))
      .toBe(COMMERCIAL_DEPENDENCY_GRAPH_V1);
    expect(COMMERCIAL_DEPENDENCY_GRAPH_V1).toMatchObject({
      schemaVersion: COMMERCIAL_DEPENDENCY_GRAPH_SCHEMA_VERSION,
      graphId: COMMERCIAL_DEPENDENCY_GRAPH_ID,
      graphVersion: COMMERCIAL_DEPENDENCY_GRAPH_VERSION
    });
    expect(Object.isFrozen(COMMERCIAL_DEPENDENCY_GRAPH_V1)).toBe(true);
    expect(Object.isFrozen(COMMERCIAL_DEPENDENCY_GRAPH_V1.nodes)).toBe(true);
    expect(COMMERCIAL_DEPENDENCY_GRAPH_V1.nodes.every((node) => (
      Object.isFrozen(node) && Object.isFrozen(node.dependsOn)
    ))).toBe(true);
    expect(() => COMMERCIAL_DEPENDENCY_GRAPH_V1.nodes.push({})).toThrow(TypeError);
  });

  test("traverses guest-count consequences with exact deterministic distances", () => {
    const result = evaluateCommercialDependencyImpact({
      changedNodeIds: ["fact.event.guest_count"]
    });

    expect(summarizeAffected(result)).toEqual([
      ["artifact.contract", "artifact", 1],
      ["artifact.kitchen_beo", "artifact", 1],
      ["output.plan.food_quantity", "output", 1],
      ["output.plan.production", "output", 1],
      ["output.plan.rental_quantity", "output", 1],
      ["output.plan.staffing_requirement", "output", 1],
      ["output.pricing.authoritative_total", "output", 1],
      ["projection.customer_decision_center", "projection", 1],
      ["artifact.production_plan", "artifact", 2],
      ["output.operations.staff_call_time", "output", 2],
      ["output.operations.venue_setup", "output", 2],
      ["output.payment.deposit_requirement", "output", 2],
      ["output.payment.final_balance", "output", 2]
    ]);
    expect(result.affectedNodes.every((node) => (
      Object.keys(node).sort().join(",") === "distance,id,kind,triggeredBy"
      && node.triggeredBy.join(",") === "fact.event.guest_count"
    ))).toBe(true);
    expect(Object.keys(result).sort()).toEqual([
      "affectedNodes",
      "changedNodeIds",
      "graphId",
      "graphVersion"
    ]);
  });

  test("traverses event-time and accepted-revision consequences exactly", () => {
    const eventTime = evaluateCommercialDependencyImpact({
      changedNodeIds: ["fact.event.time"]
    });
    expect(summarizeAffected(eventTime)).toEqual([
      ["artifact.contract", "artifact", 1],
      ["artifact.kitchen_beo", "artifact", 1],
      ["output.operations.delivery_window", "output", 1],
      ["output.operations.kitchen_checkpoints", "output", 1],
      ["output.operations.staff_call_time", "output", 1],
      ["output.operations.venue_setup", "output", 1],
      ["output.plan.production", "output", 1],
      ["output.plan.staffing_requirement", "output", 1],
      ["projection.customer_decision_center", "projection", 1],
      ["artifact.production_plan", "artifact", 2]
    ]);

    const acceptedRevision = evaluateCommercialDependencyImpact({
      changedNodeIds: ["fact.quote.accepted_revision"]
    });
    expect(summarizeAffected(acceptedRevision)).toEqual([
      ["artifact.contract", "artifact", 1],
      ["artifact.kitchen_beo", "artifact", 1],
      ["artifact.production_plan", "artifact", 1],
      ["output.payment.deposit_requirement", "output", 1],
      ["output.plan.production", "output", 1],
      ["projection.customer_decision_center", "projection", 1],
      ["output.payment.final_balance", "output", 2]
    ]);
  });

  test("deduplicates seeds, excludes changed seeds, and reports every reaching seed", () => {
    const result = evaluateCommercialDependencyImpact({
      changedNodeIds: [
        "fact.event.time",
        "fact.event.guest_count",
        "fact.event.time"
      ]
    });

    expect(result.changedNodeIds).toEqual([
      "fact.event.guest_count",
      "fact.event.time"
    ]);
    expect(result.affectedNodes.some(({ id }) => result.changedNodeIds.includes(id))).toBe(false);
    expect(result.affectedNodes.find(({ id }) => id === "artifact.kitchen_beo"))
      .toEqual({
        id: "artifact.kitchen_beo",
        kind: "artifact",
        distance: 1,
        triggeredBy: ["fact.event.guest_count", "fact.event.time"]
      });
  });

  test("stays deterministic when registry declaration order changes", () => {
    const reordered = {
      ...cloneRegistry(),
      nodes: cloneRegistry().nodes.reverse().map((node) => ({
        ...node,
        dependsOn: [...node.dependsOn].reverse()
      }))
    };
    const changedNodeIds = ["fact.event.time", "fact.event.guest_count"];
    const beforeEvaluation = JSON.stringify(reordered);

    expect(evaluateCommercialDependencyImpact({ registry: reordered, changedNodeIds }))
      .toEqual(evaluateCommercialDependencyImpact({ changedNodeIds }));
    expect(JSON.stringify(reordered)).toBe(beforeEvaluation);
  });

  test("rejects cycles and unknown nodes before deterministic traversal", () => {
    const cyclic = {
      schemaVersion: COMMERCIAL_DEPENDENCY_GRAPH_SCHEMA_VERSION,
      graphId: COMMERCIAL_DEPENDENCY_GRAPH_ID,
      graphVersion: COMMERCIAL_DEPENDENCY_GRAPH_VERSION,
      nodes: [
        { id: "output.a", kind: "output", dependsOn: ["output.b"] },
        { id: "output.b", kind: "output", dependsOn: ["output.a"] }
      ]
    };
    const cycleError = expectGraphError(
      () => evaluateCommercialDependencyImpact({ registry: cyclic, changedNodeIds: ["output.a"] }),
      COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES.CYCLE_DETECTED
    );
    expect(cycleError.details.cycle).toEqual(["output.a", "output.b", "output.a"]);

    const unknownDependency = cloneRegistry();
    unknownDependency.nodes[0].dependsOn.push("fact.missing");
    const dependencyError = expectGraphError(
      () => validateCommercialDependencyGraph(unknownDependency),
      COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES.UNKNOWN_DEPENDENCY
    );
    expect(dependencyError.details.unknownDependencies).toEqual([
      { nodeId: "artifact.kitchen_beo", dependencyId: "fact.missing" }
    ]);

    const changedError = expectGraphError(
      () => evaluateCommercialDependencyImpact({
        changedNodeIds: ["fact.unknown_z", "fact.unknown_a"]
      }),
      COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES.UNKNOWN_CHANGED_NODE
    );
    expect(changedError.details.unknownNodeIds).toEqual([
      "fact.unknown_a",
      "fact.unknown_z"
    ]);
  });

  test("rejects unsupported versions, duplicate nodes, and malformed records", () => {
    expectGraphError(
      () => validateCommercialDependencyGraph({
        ...cloneRegistry(),
        schemaVersion: 2
      }),
      COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION
    );
    expectGraphError(
      () => validateCommercialDependencyGraph({
        ...cloneRegistry(),
        graphVersion: "commercial-dependency-graph-v2"
      }),
      COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES.UNSUPPORTED_GRAPH_VERSION
    );

    const duplicated = cloneRegistry();
    duplicated.nodes.push({ ...duplicated.nodes[0] });
    expectGraphError(
      () => validateCommercialDependencyGraph(duplicated),
      COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES.DUPLICATE_NODE
    );

    const malformed = cloneRegistry();
    malformed.nodes[0].unexpected = true;
    expectGraphError(
      () => validateCommercialDependencyGraph(malformed),
      COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES.INVALID_REGISTRY
    );
  });
});

describe("qp-canonical-json-v1", () => {
  test("serializes supported values deterministically without normalizing strings", () => {
    const shared = { β: "two", a: true };
    expect(canonicalSerialize({ z: [3, -0, "é", shared], a: shared })).toBe(
      "{\"a\":{\"a\":true,\"β\":\"two\"},\"z\":[3,0,\"é\",{\"a\":true,\"β\":\"two\"}]}"
    );
    expect(canonicalSerialize({ value: "é" })).not.toBe(
      canonicalSerialize({ value: "e\u0301" })
    );
  });

  test("rejects unsupported canonical values without partial serialization", () => {
    class RecordValue {}
    const cyclic = {};
    cyclic.self = cyclic;
    const accessor = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
    const hidden = {};
    Object.defineProperty(hidden, "value", { enumerable: false, value: 1 });
    const extraArray = [];
    extraArray.extra = true;

    const invalidValues = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      Symbol("value"),
      () => true,
      new Date(),
      new Map(),
      new Set(),
      new RecordValue(),
      cyclic,
      Array(1),
      extraArray,
      accessor,
      hidden,
      { value: undefined }
    ];

    for (const value of invalidValues) {
      expectGraphError(
        () => canonicalSerialize(value),
        COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES.INVALID_CANONICAL_VALUE
      );
    }
  });

  test("fails closed with stable browser hash adapter errors", async () => {
    await expect(sha256CanonicalValue({ valid: true }, { cryptoApi: null }))
      .rejects.toMatchObject({
        name: "CommercialDependencyGraphError",
        code: COMMERCIAL_DEPENDENCY_HASH_ERROR_CODES.UNAVAILABLE
      });
    await expect(sha256CanonicalValue(undefined, { cryptoApi: null }))
      .rejects.toMatchObject({
        name: "CommercialDependencyGraphError",
        code: COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES.INVALID_CANONICAL_VALUE
      });

    const failedCrypto = {
      subtle: {
        digest: async () => {
          throw new Error("digest failure");
        }
      }
    };
    await expect(sha256CanonicalValue({ valid: true }, { cryptoApi: failedCrypto }))
      .rejects.toMatchObject({
        name: "CommercialDependencyGraphError",
        code: COMMERCIAL_DEPENDENCY_HASH_ERROR_CODES.FAILED
      });
  });
});
