import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
const require = createRequire(import.meta.url);
const { tenantWorkflowRuntimeEnabled } = require("../../../functions/tenantWorkflowRuntime.js");

describe("deployment-scoped tenant workflow runtime", () => {
  test.each(["EVENT_OPERATING_SPINE_ENABLED", "COMMERCIAL_CHANGE_AUTHORITY_ENABLED", "OPERATIONAL_STAFFING_AUTHORITY_ENABLED", "INVENTORY_AUTHORITY_ENABLED", "REVENUE_AUTOPILOT_ENABLED"])("restricts %s to the approved tenant even when another tenant enables settings", (flag) => {
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
  test("requires explicit Inquiry activation in addition to the approved tenant fence", () => {
    const existingProfile = {
      TENANT_WORKFLOW_ORGANIZATION_ID: "mm05366-sandbox",
      INQUIRY_SHOWCASE_ENABLED: "false"
    };
    expect(tenantWorkflowRuntimeEnabled(
      "INQUIRY_SHOWCASE_ENABLED",
      "mm05366-sandbox",
      existingProfile
    )).toBe(false);
    expect(tenantWorkflowRuntimeEnabled(
      "INQUIRY_SHOWCASE_ENABLED",
      "mm05366-sandbox",
      { ...existingProfile, INQUIRY_SHOWCASE_ENABLED: "true" }
    )).toBe(true);
    expect(tenantWorkflowRuntimeEnabled(
      "INQUIRY_SHOWCASE_ENABLED",
      "other",
      { ...existingProfile, INQUIRY_SHOWCASE_ENABLED: "true" }
    )).toBe(false);
    expect(tenantWorkflowRuntimeEnabled(
      "INQUIRY_SHOWCASE_ENABLED",
      "local-fixture",
      { INQUIRY_SHOWCASE_ENABLED: "true" }
    )).toBe(true);
  });
  test("does not activate buyer access or provider sends", () => {
    const env = { TENANT_WORKFLOW_ORGANIZATION_ID: "mm05366-sandbox" };
    for (const flag of ["BUYER_ACCESS_ENABLED", "REVENUE_AUTOPILOT_SENDS_ENABLED"]) {
      expect(tenantWorkflowRuntimeEnabled(flag, "mm05366-sandbox", env)).toBe(false);
    }
  });
});


const source = fs.readFileSync(new URL("../../../functions/index.js", import.meta.url), "utf8");
function ownerFunction(name, context) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\nfunction ", start + 1);
  return vm.runInNewContext(`(${source.slice(start, end).trim()})`, context);
}

test("revenue preparation admits RagnaKoK while the scheduler and sends remain disabled", () => {
  const environment = { TENANT_WORKFLOW_ORGANIZATION_ID: "mm05366-sandbox" };
  const control = ownerFunction("getRevenueAutopilotGlobalControl", {
    process: { env: environment }, createHash,
    getEmailConfig: () => ({ provider: "resend", resendApiKey: "", senderApproved: false }),
    configBoolean: () => false,
    tenantWorkflowRuntimeEnabled
  });
  const at = "2026-09-05T12:00:00.000Z";
  expect(control(at, "mm05366-sandbox").enabled).toBe(true);
  expect(control(at, "mm05366-sandbox").sendsEnabled).toBe(false);
  expect(control(at, "other").enabled).toBe(false);
  expect(control(at).enabled).toBe(false);
});

test("the staffing storage boundary still requires the exact tenant and its stored setting", () => {
  const runtime = require("../../../functions/operationalStaffingRuntime.js");
  const environment = { TENANT_WORKFLOW_ORGANIZATION_ID: "mm05366-sandbox" };
  const assertEnabled = ownerFunction("assertOperationalStaffingStorageEnabled", {
    ...runtime,
    tenantWorkflowRuntimeEnabled: (flag, org) => tenantWorkflowRuntimeEnabled(flag, org, environment)
  });
  const snapshot = { exists: true, data: () => ({ operationalStaffingAuthorityEnabled: true }) };
  expect(() => assertEnabled(snapshot, "mm05366-sandbox")).not.toThrow();
  expect(() => assertEnabled(snapshot, "other")).toThrow();
  expect(() => assertEnabled({ exists: true, data: () => ({}) }, "mm05366-sandbox")).toThrow();
  expect(() => assertEnabled({ exists: false }, "mm05366-sandbox")).toThrow();
});
