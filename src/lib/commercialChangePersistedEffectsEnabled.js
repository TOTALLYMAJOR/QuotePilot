export const COMMERCIAL_CHANGE_PERSISTED_EFFECTS_ENABLED = true;

function normalizeStaffing(value, label, helpers) {
  const { boundedInteger, exactKeys } = helpers;
  exactKeys(value, ["servers", "chefs", "bartenders"], label);
  return Object.fromEntries(["servers", "chefs", "bartenders"].map((field) => {
    const count = value[field];
    return [field, count === null ? null : boundedInteger(count, `${label} ${field}`, 10_000)];
  }));
}

export default function normalizeCommercialChangePersistedEffects(
  value,
  scope,
  receipt,
  helpers
) {
  const {
    boundedInteger,
    exactBoolean,
    exactKeys,
    exactOpaqueId,
    exactText,
    fail,
    jsonClone,
    normalizeCommercialValues,
    normalizeReceiptImpact,
    sameJson
  } = helpers;
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "source",
    "identity",
    "requestedDelta",
    "pricing",
    "staffing",
    "status",
    "version",
    "proposal",
    "portal",
    "lifecycle",
    "dependencies",
    "boundary"
  ], "Commercial change persisted effects");
  if (
    value.schemaVersion !== "commercial-change-persisted-effects-v1"
    || value.authority !== "server_authoritative"
    || value.source !== "trusted_quote_edit_material_projection"
  ) {
    fail("Commercial change persisted effects authority is invalid.");
  }

  exactKeys(value.identity, [
    "organizationId",
    "quoteId",
    "baseRevisionId",
    "projectedRevisionId"
  ], "Persisted-effects identity");
  const identity = Object.fromEntries(Object.entries(value.identity).map(([key, id]) => [
    key,
    exactOpaqueId(id, `Persisted-effects ${key}`, 256, "invalid-server-response")
  ]));
  if (
    identity.organizationId !== scope.organizationId
    || identity.quoteId !== scope.quoteId
    || identity.baseRevisionId !== receipt.baseRevisionId
  ) {
    fail("Commercial change persisted effects are outside the immutable simulation scope.");
  }

  if (!Array.isArray(value.requestedDelta) || value.requestedDelta.length > 32) {
    fail("Persisted-effects requested delta is invalid.");
  }
  const requestedDelta = value.requestedDelta.map((item, index) => {
    const label = `Persisted delta ${index}`;
    exactKeys(item, ["nodeId", "fieldPath", "before", "after"], label);
    return {
      nodeId: exactOpaqueId(item.nodeId, `${label} nodeId`, 256, "invalid-server-response"),
      fieldPath: exactText(item.fieldPath, `${label} fieldPath`, 256),
      before: jsonClone(item.before, `${label} before`, { maximum: 32_768 }),
      after: jsonClone(item.after, `${label} after`, { maximum: 32_768 })
    };
  });
  const expectedDelta = receipt.factDiffs.map((item) => ({
    nodeId: item.nodeId,
    fieldPath: item.nodeId === "fact.event.service_style" ? "event.style" : item.nodeId,
    before: item.before,
    after: item.proposedAfter
  }));
  if (!sameJson(requestedDelta, expectedDelta)) {
    fail("Persisted-effects requested delta does not match the immutable simulation.");
  }

  const pricing = normalizeCommercialValues(value.pricing);
  if (!sameJson(pricing, receipt.commercialValues)) {
    fail("Persisted-effects pricing does not match the immutable simulation.");
  }
  exactKeys(value.staffing, ["before", "after", "changed"], "Persisted-effects staffing");
  const staffing = {
    before: normalizeStaffing(value.staffing.before, "Persisted staffing before", helpers),
    after: normalizeStaffing(value.staffing.after, "Persisted staffing after", helpers),
    changed: exactBoolean(value.staffing.changed, "Persisted staffing change state")
  };
  if (staffing.changed !== !sameJson(staffing.before, staffing.after)) {
    fail("Persisted staffing change state is inconsistent.");
  }

  exactKeys(value.status, ["before", "after", "changed"], "Persisted-effects status");
  const status = {
    before: exactText(value.status.before, "Persisted status before", 32).toLowerCase(),
    after: exactText(value.status.after, "Persisted status after", 32).toLowerCase(),
    changed: exactBoolean(value.status.changed, "Persisted status change state")
  };
  if (status.changed !== (status.before !== status.after) || status.after !== "draft") {
    fail("Persisted quote status effect is inconsistent.");
  }

  exactKeys(value.version, [
    "beforeRevisionId",
    "afterRevisionId",
    "beforeVersionNumber",
    "afterVersionNumber",
    "createsImmutableVersion"
  ], "Persisted-effects version");
  const version = {
    beforeRevisionId: exactOpaqueId(
      value.version.beforeRevisionId,
      "Persisted version before revision",
      256,
      "invalid-server-response"
    ),
    afterRevisionId: exactOpaqueId(
      value.version.afterRevisionId,
      "Persisted version after revision",
      256,
      "invalid-server-response"
    ),
    beforeVersionNumber: boundedInteger(value.version.beforeVersionNumber, "Persisted version before number"),
    afterVersionNumber: boundedInteger(value.version.afterVersionNumber, "Persisted version after number"),
    createsImmutableVersion: exactBoolean(
      value.version.createsImmutableVersion,
      "Persisted immutable-version state"
    )
  };
  if (
    version.beforeRevisionId !== identity.baseRevisionId
    || version.afterRevisionId !== identity.projectedRevisionId
    || version.afterVersionNumber !== version.beforeVersionNumber + 1
    || !version.createsImmutableVersion
  ) {
    fail("Persisted quote version effect is inconsistent.");
  }

  exactKeys(value.proposal, [
    "statusBefore",
    "statusAfter",
    "workflowEvidencePreserved",
    "customerDeliveryTriggered",
    "publicationTriggered"
  ], "Persisted-effects proposal");
  const proposal = {
    statusBefore: exactText(value.proposal.statusBefore, "Proposal status before", 32).toLowerCase(),
    statusAfter: exactText(value.proposal.statusAfter, "Proposal status after", 32).toLowerCase(),
    workflowEvidencePreserved: exactBoolean(
      value.proposal.workflowEvidencePreserved,
      "Proposal workflow preservation"
    ),
    customerDeliveryTriggered: exactBoolean(
      value.proposal.customerDeliveryTriggered,
      "Proposal delivery effect"
    ),
    publicationTriggered: exactBoolean(
      value.proposal.publicationTriggered,
      "Proposal publication effect"
    )
  };
  if (
    proposal.statusBefore !== status.before
    || proposal.statusAfter !== status.after
    || !proposal.workflowEvidencePreserved
    || proposal.customerDeliveryTriggered
    || proposal.publicationTriggered
  ) {
    fail("Persisted proposal effect is inconsistent.");
  }

  exactKeys(value.portal, [
    "activeRevisionIdBefore",
    "activeRevisionIdAfter",
    "projectionRefreshed",
    "accessIdentityRetained",
    "issuanceRecordedAtSave",
    "expiryRecalculatedAtSave",
    "customerDeliveryTriggered"
  ], "Persisted-effects portal");
  const portal = {
    activeRevisionIdBefore: exactOpaqueId(
      value.portal.activeRevisionIdBefore,
      "Portal revision before",
      256,
      "invalid-server-response"
    ),
    activeRevisionIdAfter: exactOpaqueId(
      value.portal.activeRevisionIdAfter,
      "Portal revision after",
      256,
      "invalid-server-response"
    ),
    ...Object.fromEntries([
      "projectionRefreshed",
      "accessIdentityRetained",
      "issuanceRecordedAtSave",
      "expiryRecalculatedAtSave",
      "customerDeliveryTriggered"
    ].map((key) => [key, exactBoolean(value.portal[key], `Persisted portal ${key}`)]))
  };
  if (
    portal.activeRevisionIdBefore !== version.beforeRevisionId
    || portal.activeRevisionIdAfter !== version.afterRevisionId
    || !portal.projectionRefreshed
    || !portal.accessIdentityRetained
    || !portal.issuanceRecordedAtSave
    || !portal.expiryRecalculatedAtSave
    || portal.customerDeliveryTriggered
  ) {
    fail("Persisted portal effect is inconsistent.");
  }

  exactKeys(value.lifecycle, [
    "draftAtPreserved",
    "draftAtAssignedIfMissing",
    "editedAtRecordedAtSave",
    "terminalDecisionEvidencePreserved"
  ], "Persisted-effects lifecycle");
  const lifecycle = Object.fromEntries(Object.entries(value.lifecycle).map(([key, state]) => [
    key,
    exactBoolean(state, `Persisted lifecycle ${key}`)
  ]));
  if (
    lifecycle.draftAtPreserved === lifecycle.draftAtAssignedIfMissing
    || !lifecycle.editedAtRecordedAtSave
    || !lifecycle.terminalDecisionEvidencePreserved
  ) {
    fail("Persisted lifecycle effect is inconsistent.");
  }

  exactKeys(value.dependencies, ["authorizationRequired", "impact"], "Persisted-effects dependencies");
  const dependencies = {
    authorizationRequired: exactBoolean(
      value.dependencies.authorizationRequired,
      "Persisted dependency authorization"
    ),
    impact: normalizeReceiptImpact(value.dependencies.impact)
  };
  if (
    dependencies.authorizationRequired !== receipt.authorizationRequired
    || !sameJson(dependencies.impact, receipt.impact)
  ) {
    fail("Persisted dependency effects do not match the immutable simulation.");
  }
  return {
    schemaVersion: value.schemaVersion,
    authority: value.authority,
    source: value.source,
    identity,
    requestedDelta,
    pricing,
    staffing,
    status,
    version,
    proposal,
    portal,
    lifecycle,
    dependencies,
    boundary: exactText(value.boundary, "Persisted-effects boundary", 2_000)
  };
}
