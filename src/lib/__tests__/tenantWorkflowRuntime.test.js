import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
const require = createRequire(import.meta.url);
const { tenantWorkflowRuntimeEnabled } = require("../../../functions/tenantWorkflowRuntime.js");

describe("deployment-scoped tenant workflow runtime", () => {
  test.each(["EVENT_OPERATING_SPINE_ENABLED", "COMMERCIAL_CHANGE_AUTHORITY_ENABLED"])("restricts %s to the approved tenant even when another tenant enables settings", (flag) => {
    const env = { [flag]: "false", TENANT_WORKFLOW_ORGANIZATION_ID: "mm05366-sandbox" };
    expect(tenantWorkflowRuntimeEnabled(flag, "mm05366-sandbox", env)).toBe(true);
    for (const org of ["other", "", "mm05366-sandbox ", undefined]) {
      expect(tenantWorkflowRuntimeEnabled(flag, org, env)).toBe(false);
      expect(tenantWorkflowRuntimeEnabled(flag, org, { ...env, [flag]: "true" })).toBe(false);
    }
    expect(tenantWorkflowRuntimeEnabled(flag, "other", { ...env, TENANT_WORKFLOW_ORGANIZATION_ID: "other" })).toBe(false);
    expect(tenantWorkflowRuntimeEnabled(flag, "mm05366-sandbox", {})).toBe(false);
    expect(tenantWorkflowRuntimeEnabled(flag, "local-fixture", { [flag]: "true" })).toBe(true);
  });
  test("does not activate staffing, buyer access or provider sends", () => {
    const env = { TENANT_WORKFLOW_ORGANIZATION_ID: "mm05366-sandbox" };
    for (const flag of ["OPERATIONAL_STAFFING_AUTHORITY_ENABLED", "BUYER_ACCESS_ENABLED", "REVENUE_AUTOPILOT_SENDS_ENABLED"]) {
      expect(tenantWorkflowRuntimeEnabled(flag, "mm05366-sandbox", env)).toBe(false);
    }
  });
});
