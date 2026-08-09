import {
  COMMERCIAL_DEPENDENCY_GRAPH_V1,
  canonicalSerialize,
  sha256CanonicalValue,
  validateCommercialDependencyGraph
} from "./commercialDependencyGraph";

export const BEO_ARTIFACT_NODE_ID = "artifact.kitchen_beo";
export const BEO_ARTIFACT_TYPE = "kitchen_beo";
export const BEO_INPUT_SCHEMA_VERSION = "kitchen-beo-input-v1";
export const BEO_CANONICAL_SCHEMA_VERSION = "qp-canonical-json-v1";
export const BEO_ARTIFACT_PROVENANCE_DISCLAIMER = "Identifies the declared inputs used for this download. It is not retained freshness or completion evidence.";

export const BEO_DECLARED_INPUT_NODE_IDS = Object.freeze([
  "fact.customer.day_of_contact",
  "fact.event.date",
  "fact.event.dietary_constraints",
  "fact.event.duration",
  "fact.event.guest_count",
  "fact.event.name",
  "fact.event.service_style",
  "fact.event.time",
  "fact.event.venue",
  "fact.operations.checkpoint_overrides",
  "fact.operations.production_checklist",
  "fact.operations.staff_lead",
  "fact.organization.day_of_contact",
  "fact.quote.identity",
  "fact.selection.addons",
  "fact.selection.menu",
  "fact.selection.package",
  "fact.selection.rentals",
  "fact.staffing.counts"
]);

function assertPlainObject(value, label) {
  const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null;
  if (!value || Array.isArray(value) || (prototype !== Object.prototype && prototype !== null)) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function collectUpstreamNodeIds(nodesById, nodeId, visited = new Set()) {
  const node = nodesById.get(nodeId);
  if (!node) return visited;
  for (const dependencyId of node.dependsOn) {
    if (visited.has(dependencyId)) continue;
    visited.add(dependencyId);
    collectUpstreamNodeIds(nodesById, dependencyId, visited);
  }
  return visited;
}

export function assertBeoArtifactGraphContract(
  registry = COMMERCIAL_DEPENDENCY_GRAPH_V1,
  declaredNodeIds = BEO_DECLARED_INPUT_NODE_IDS
) {
  assertPlainObject(registry, "Commercial dependency registry");
  validateCommercialDependencyGraph(registry);
  if (!Array.isArray(registry.nodes)) {
    throw new Error("Commercial dependency registry nodes are required for the Kitchen BEO fingerprint.");
  }
  const nodesById = new Map(registry.nodes.map((node) => [node?.id, node]));
  const artifactNode = nodesById.get(BEO_ARTIFACT_NODE_ID);
  if (!artifactNode || artifactNode.kind !== "artifact") {
    throw new Error(`Commercial dependency registry is missing ${BEO_ARTIFACT_NODE_ID}.`);
  }
  const upstreamNodeIds = collectUpstreamNodeIds(nodesById, BEO_ARTIFACT_NODE_ID);
  const missingNodeIds = declaredNodeIds.filter((nodeId) => !nodesById.has(nodeId));
  if (missingNodeIds.length) {
    throw new Error(`Kitchen BEO fingerprint declares unknown graph nodes: ${missingNodeIds.join(", ")}.`);
  }
  const nonFactNodeIds = declaredNodeIds.filter((nodeId) => nodesById.get(nodeId)?.kind !== "fact");
  if (nonFactNodeIds.length) {
    throw new Error(`Kitchen BEO fingerprint inputs must be graph facts: ${nonFactNodeIds.join(", ")}.`);
  }
  const unrelatedNodeIds = declaredNodeIds.filter((nodeId) => !upstreamNodeIds.has(nodeId));
  if (unrelatedNodeIds.length) {
    throw new Error(`Kitchen BEO fingerprint nodes are not dependencies of ${BEO_ARTIFACT_NODE_ID}: ${unrelatedNodeIds.join(", ")}.`);
  }
  return true;
}

export function normalizeBeoArtifactInputs(beoPayload) {
  assertPlainObject(beoPayload, "Kitchen BEO payload");
  const normalizedInputs = {};
  for (const [key, value] of Object.entries(beoPayload)) {
    if (["version", "fingerprint", "dependencyFingerprint"].includes(key)) continue;
    normalizedInputs[key] = value;
  }
  return normalizedInputs;
}

export function buildBeoArtifactFingerprintDocument(
  beoPayload,
  { registry = COMMERCIAL_DEPENDENCY_GRAPH_V1 } = {}
) {
  assertBeoArtifactGraphContract(registry);
  return {
    artifactType: BEO_ARTIFACT_TYPE,
    fingerprintSchemaVersion: BEO_INPUT_SCHEMA_VERSION,
    declaredNodeIds: [...BEO_DECLARED_INPUT_NODE_IDS],
    graphVersion: registry.graphVersion,
    inputs: normalizeBeoArtifactInputs(beoPayload)
  };
}

export async function createBeoArtifactFingerprint(
  beoPayload,
  {
    registry = COMMERCIAL_DEPENDENCY_GRAPH_V1,
    hashCanonicalValue = sha256CanonicalValue
  } = {}
) {
  const document = buildBeoArtifactFingerprintDocument(beoPayload, { registry });
  // Canonicalize before invoking an injectable hasher so tests and alternative
  // browser crypto adapters cannot silently accept unsupported input values.
  canonicalSerialize(document);
  const dependencyFingerprint = await hashCanonicalValue(document);
  if (!/^[a-f0-9]{64}$/.test(String(dependencyFingerprint || ""))) {
    throw new Error("Kitchen BEO dependency fingerprint must be a lowercase SHA-256 digest.");
  }
  return {
    artifactType: document.artifactType,
    declaredNodeIds: document.declaredNodeIds,
    canonicalSchemaVersion: BEO_CANONICAL_SCHEMA_VERSION,
    fingerprintSchemaVersion: document.fingerprintSchemaVersion,
    graphId: registry.graphId,
    graphVersion: document.graphVersion,
    dependencyFingerprint
  };
}
