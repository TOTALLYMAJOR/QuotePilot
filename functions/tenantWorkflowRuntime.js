"use strict";

const WORKFLOW_FLAGS = new Set([
  "EVENT_OPERATING_SPINE_ENABLED",
  "COMMERCIAL_CHANGE_AUTHORITY_ENABLED",
  "OPERATIONAL_STAFFING_AUTHORITY_ENABLED",
  "INVENTORY_AUTHORITY_ENABLED",
  "REVENUE_AUTOPILOT_ENABLED",
  "INQUIRY_SHOWCASE_ENABLED"
]);

// A deployment-scoped tenant never admits another organization, even if a
// global flag or another tenant's settings are accidentally enabled.
function tenantWorkflowRuntimeEnabled(flag, organizationId, environment = process.env) {
  if (!WORKFLOW_FLAGS.has(flag)) return false;
  const scopedOrganization = String(environment.TENANT_WORKFLOW_ORGANIZATION_ID || "").trim();
  if (scopedOrganization) {
    return scopedOrganization === "mm05366-sandbox" && organizationId === scopedOrganization;
  }
  return environment[flag] === "true";
}

module.exports = { tenantWorkflowRuntimeEnabled };
