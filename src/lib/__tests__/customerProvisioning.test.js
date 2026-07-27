import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import {
  buildCustomerProvisioningConfirmationMessage,
  buildCustomerProvisioningPayload,
  createCustomerProvisioningForm,
  createCustomerProvisioningOrderId,
  ensureCustomerProvisioningOrderId,
  normalizeProvisioningEmail,
  normalizeProvisioningOrderId,
  resolveProvisionOwnerUid,
  validateCustomerProvisioningPayload
} from "../customerProvisioning";

const require = createRequire(import.meta.url);
const {
  buildExistingOrderMessage,
  buildExistingOrganizationMessage,
  canProvisionOrganization,
  findConflictingOrganizationScope,
  hasExistingProvisioningTarget,
  isAlreadyExistsError,
  isConfiguredAppHost
} = require("../../../functions/provisioningPolicy.js");

describe("customer provisioning owner identity guardrails", () => {
  test("never falls back to the signed-in operator", () => {
    const payload = buildCustomerProvisioningPayload({
      organizationName: "Acme Events",
      currentUserEmail: "operator@example.com",
      ownerEmail: "",
      ownerUid: "",
      plan: "growth"
    }, "https://quotepilot.mbmapps.com/app");

    expect(payload.ownerEmail).toBe("");
    expect(payload.ownerUid).toBe("");
    expect(validateCustomerProvisioningPayload(payload)).toBe(
      "Organization name and owner email are required."
    );
  });

  test("uses only explicitly supplied owner identity", () => {
    const payload = buildCustomerProvisioningPayload({
      organizationName: "Acme Events",
      ownerEmail: "  OWNER@Example.com ",
      ownerUid: "  firebase-owner-uid  ",
      plan: "growth"
    });

    expect(normalizeProvisioningEmail(payload.ownerEmail)).toBe("owner@example.com");
    expect(resolveProvisionOwnerUid(payload.ownerUid)).toBe("firebase-owner-uid");
    expect(validateCustomerProvisioningPayload(payload)).toBe("");
  });

  test("existing-org update strips owner, email, and onboarding fields", () => {
    const payload = buildCustomerProvisioningPayload({
      organizationId: " Existing Org ",
      ownerEmail: "owner@example.com",
      ownerUid: "owner-uid",
      ownerName: "Owner Name",
      supportEmail: "support@example.com",
      appUrl: "https://tenant.example.com",
      sendEmail: true,
      plan: "starter",
      updateExistingOrganization: true
    });

    expect(payload).toMatchObject({
      organizationId: "existing-org",
      ownerEmail: "",
      ownerUid: "",
      ownerName: "",
      supportEmail: "",
      appUrl: "",
      sendEmail: false,
      updateExistingOrganization: true
    });
    expect(validateCustomerProvisioningPayload(payload)).toBe("");
  });

  test("existing-org update requires an explicit organization id", () => {
    const payload = buildCustomerProvisioningPayload({
      organizationName: "Do Not Infer This",
      plan: "starter",
      updateExistingOrganization: true
    });

    expect(validateCustomerProvisioningPayload(payload)).toBe(
      "Organization id is required for an existing-organization update."
    );
  });

  test("requires explicit plans and valid owner/support email addresses", () => {
    expect(validateCustomerProvisioningPayload({
      organizationName: "Acme Events",
      ownerEmail: "owner@example.com",
      plan: ""
    })).toBe("Select an explicit starter, growth, or enterprise plan.");
    expect(validateCustomerProvisioningPayload({
      organizationName: "Acme Events",
      ownerEmail: "not-an-email",
      plan: "growth"
    })).toBe("Enter a valid owner email address.");
    expect(validateCustomerProvisioningPayload({
      organizationName: "Acme Events",
      ownerEmail: "owner@example.com",
      supportEmail: "invalid",
      plan: "growth"
    })).toBe("Enter a valid support email address.");
  });
});

describe("customer provisioning request lifecycle", () => {
  test("creates a stable normalized order id and preserves an existing id", () => {
    const generated = createCustomerProvisioningOrderId({
      randomUUID: () => "ABCDEF12-3456-7890-ABCD-EF1234567890"
    });

    expect(generated).toBe("qp-abcdef12-3456-7890-abcd-ef1234567890");
    expect(ensureCustomerProvisioningOrderId("", {
      randomUUID: () => "ABCDEF12-3456-7890-ABCD-EF1234567890"
    })).toBe(generated);
    expect(ensureCustomerProvisioningOrderId(" Customer Order 101 ")).toBe("customer-order-101");
    expect(normalizeProvisioningOrderId(" Customer Order 101 ")).toBe("customer-order-101");
  });

  test("creates a fresh form with only the canonical app URL retained", () => {
    expect(createCustomerProvisioningForm(" https://quotepilot.mbmapps.com/app ")).toEqual({
      organizationName: "",
      organizationId: "",
      ownerEmail: "",
      ownerName: "",
      ownerUid: "",
      plan: "",
      orderId: "",
      supportEmail: "",
      appUrl: "https://quotepilot.mbmapps.com/app",
      sendEmail: false,
      updateExistingOrganization: false
    });
  });

  test("confirmation includes the resolved organization, plan, and stable order id", () => {
    const message = buildCustomerProvisioningConfirmationMessage({
      organizationName: "Acme Events",
      organizationId: "acme-events",
      ownerEmail: "owner@example.com",
      plan: "enterprise",
      orderId: "qp-request-101"
    });

    expect(message).toContain("Organization ID: acme-events");
    expect(message).toContain("Plan: enterprise");
    expect(message).toContain("Order ID: qp-request-101");
    expect(message).toContain("owner@example.com");

    const updateMessage = buildCustomerProvisioningConfirmationMessage({
      organizationId: "existing-events",
      plan: "starter",
      orderId: "qp-request-102",
      updateExistingOrganization: true
    }, {
      currentPlan: "growth"
    });
    expect(updateMessage).toContain("Organization ID: existing-events");
    expect(updateMessage).toContain("Plan change: growth → starter");
    expect(updateMessage).toContain("Order ID: qp-request-102");
    expect(updateMessage).toContain("will not change owner identity");
  });
});

describe("server provisioning policy", () => {
  test("detects organization or settings state before create", () => {
    expect(hasExistingProvisioningTarget({
      organizationExists: true,
      settingsExists: false
    })).toBe(true);
    expect(hasExistingProvisioningTarget({
      organizationExists: false,
      settingsExists: true
    })).toBe(true);
    expect(hasExistingProvisioningTarget({})).toBe(false);
    expect(buildExistingOrganizationMessage("acme")).toMatch(/No changes were made/);
  });

  test("treats explicit order collisions as non-overwritable", () => {
    expect(buildExistingOrderMessage("order-101")).toContain('"order-101" already exists');
    expect(isAlreadyExistsError({ code: 6 })).toBe(true);
    expect(isAlreadyExistsError({ message: "Document already exists" })).toBe(true);
  });

  test("classifies the configured APP_BASE_URL hostname as the app host", () => {
    expect(isConfiguredAppHost(
      "quotepilot.mbmapps.com",
      "https://quotepilot.mbmapps.com/app"
    )).toBe(true);
    expect(isConfiguredAppHost(
      "customer.mbmapps.com",
      "https://quotepilot.mbmapps.com/app"
    )).toBe(false);
  });

  test("rejects role, claim, or invite scope owned by another organization", () => {
    expect(findConflictingOrganizationScope({
      targetOrganizationId: "new-org",
      roleOrganizationId: "operator-org"
    })).toBe("operator-org");
    expect(findConflictingOrganizationScope({
      targetOrganizationId: "new-org",
      claimsOrganizationId: "new-org",
      inviteOrganizationId: "new-org"
    })).toBe("");
  });

  test("limits tenant admins to their own organization and reserves cross-org creation for platform admins", () => {
    expect(canProvisionOrganization({
      targetOrganizationId: "tenant-a",
      principalOrganizationId: "tenant-a"
    })).toBe(true);
    expect(canProvisionOrganization({
      targetOrganizationId: "tenant-b",
      principalOrganizationId: "tenant-a"
    })).toBe(false);
    expect(canProvisionOrganization({
      targetOrganizationId: "tenant-b",
      principalOrganizationId: "tenant-a",
      hasCrossOrganizationBypass: true
    })).toBe(true);
    expect(canProvisionOrganization({
      targetOrganizationId: "tenant-b",
      principalOrganizationId: "platform",
      resolvedHostOrganizationId: "tenant-a",
      hasCrossOrganizationBypass: true
    })).toBe(false);
  });
});
