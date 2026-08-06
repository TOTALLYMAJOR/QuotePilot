import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildPortalRecoveryContact,
  createPortalRecoveryThrottle,
  isRecoverablePortalSnapshot,
  isPortalRecoveryToken,
  resolvePortalRecoveryContact
} = require("../../../functions/portalRecovery.js");

describe("portal recovery contact", () => {
  test("accepts only bounded opaque portal tokens", () => {
    expect(isPortalRecoveryToken("portal-key-12345678901234567890")).toBe(true);
    expect(isPortalRecoveryToken("short")).toBe(false);
    expect(isPortalRecoveryToken("portal key with spaces 1234567890")).toBe(false);
    expect(isPortalRecoveryToken("a".repeat(129))).toBe(false);
  });

  test("returns only sanitized public tenant contact fields", () => {
    const contact = buildPortalRecoveryContact({
      portal: {
        customerName: "Must Not Escape",
        total: 999,
        quoteMeta: {
          organizationName: "Legacy Organization",
          businessEmail: "legacy@example.com"
        }
      },
      organization: { name: "Northstar Events" },
      settings: {
        brandName: "Northstar Catering",
        businessEmail: "Events@Northstar.test",
        businessPhone: "205-555-0100",
        brandLogoUrl: "https://cdn.example.test/logo.png",
        brandPrimaryColor: "#8d611a",
        brandAccentColor: "not-a-color"
      }
    });

    expect(contact).toEqual({
      brandName: "Northstar Catering",
      organizationName: "Northstar Events",
      email: "events@northstar.test",
      phone: "205-555-0100",
      logoUrl: "https://cdn.example.test/logo.png",
      brandPrimaryColor: "#8d611a",
      brandAccentColor: "",
      brandDarkAccentColor: ""
    });
    expect(contact).not.toHaveProperty("customerName");
    expect(contact).not.toHaveProperty("total");
  });

  test("resolves only delivery-activated, non-deleted portal snapshots", () => {
    const portalKey = "portal-key-12345678901234567890";
    const activeSnapshot = {
      portalKey,
      status: "sent",
      portalIssuedAtISO: "2019-12-15T00:00:00.000Z",
      portalExpiresAtISO: "2020-01-01T00:00:00.000Z",
      deliveryEvidence: {
        revisionId: "revision-1",
        state: "provider_accepted",
        portalActivationState: "active",
        portalKey,
        portalIssuedAtISO: "2019-12-15T00:00:00.000Z",
        providerAcceptedAtISO: "2019-12-15T00:01:00.000Z"
      }
    };

    expect(isRecoverablePortalSnapshot(activeSnapshot, portalKey)).toBe(true);
    expect(isRecoverablePortalSnapshot({ ...activeSnapshot, status: "deleted" }, portalKey)).toBe(false);
    expect(isRecoverablePortalSnapshot({ ...activeSnapshot, status: "draft" }, portalKey)).toBe(false);
    expect(isRecoverablePortalSnapshot({ ...activeSnapshot, deliveryEvidence: {} }, portalKey)).toBe(false);
    expect(isRecoverablePortalSnapshot({
      ...activeSnapshot,
      deliveryEvidence: {
        ...activeSnapshot.deliveryEvidence,
        portalIssuedAtISO: "2019-12-14T00:00:00.000Z"
      }
    }, portalKey)).toBe(false);
    expect(isRecoverablePortalSnapshot(activeSnapshot, `${portalKey}x`)).toBe(false);
  });

  test("rejects unsafe logo protocols and returns null without public identity", () => {
    expect(buildPortalRecoveryContact({
      settings: { brandLogoUrl: "javascript:alert(1)" }
    })).toBeNull();
  });

  test("throttles repeated requests per requester within a bounded window", () => {
    let clock = 1_000;
    const throttle = createPortalRecoveryThrottle({
      limit: 2,
      windowMs: 500,
      now: () => clock
    });
    expect(throttle("203.0.113.1")).toBe(false);
    expect(throttle("203.0.113.1")).toBe(false);
    expect(throttle("203.0.113.2")).toBe(false);
    expect(throttle("203.0.113.1")).toBe(true);
    clock += 501;
    expect(throttle("203.0.113.1")).toBe(false);
  });

  test("returns one generic null result for malformed, unknown, legacy, and inactive tenant lookups", async () => {
    const validKey = "portal-key-12345678901234567890";
    const activeDelivery = {
      portalKey: validKey,
      organizationId: "northstar",
      status: "expired",
      portalIssuedAtISO: "2026-07-01T00:00:00.000Z",
      deliveryEvidence: {
        revisionId: "revision-1",
        state: "provider_accepted",
        portalActivationState: "active",
        portalKey: validKey,
        portalIssuedAtISO: "2026-07-01T00:00:00.000Z",
        providerAcceptedAtISO: "2026-07-01T00:01:00.000Z"
      },
      quoteMeta: { customerName: "Must stay private" }
    };
    const base = {
      readOrganization: async () => ({ name: "Northstar Events", status: "active" }),
      readSettings: async () => ({ businessEmail: "events@northstar.test" }),
      isOrganizationActive: (organization) => organization.status === "active"
    };

    await expect(resolvePortalRecoveryContact({
      ...base,
      portalKey: "malformed",
      readPortal: async () => activeDelivery
    })).resolves.toBeNull();
    await expect(resolvePortalRecoveryContact({
      ...base,
      portalKey: validKey,
      readPortal: async () => null
    })).resolves.toBeNull();
    await expect(resolvePortalRecoveryContact({
      ...base,
      portalKey: validKey,
      readPortal: async () => ({ ...activeDelivery, deliveryEvidence: {} })
    })).resolves.toBeNull();
    await expect(resolvePortalRecoveryContact({
      ...base,
      portalKey: validKey,
      readPortal: async () => activeDelivery,
      readOrganization: async () => ({ name: "Northstar Events", status: "inactive" })
    })).resolves.toBeNull();
  });

  test("resolves an active exact issuance to the whitelisted contact shape", async () => {
    const portalKey = "portal-key-12345678901234567890";
    const contact = await resolvePortalRecoveryContact({
      portalKey,
      readPortal: async () => ({
        portalKey,
        organizationId: "northstar",
        customerName: "Private Customer",
        total: 4_200,
        status: "expired",
        portalIssuedAtISO: "2026-07-01T00:00:00.000Z",
        deliveryEvidence: {
          revisionId: "revision-1",
          state: "provider_accepted",
          portalActivationState: "active",
          portalKey,
          portalIssuedAtISO: "2026-07-01T00:00:00.000Z",
          providerAcceptedAtISO: "2026-07-01T00:01:00.000Z"
        }
      }),
      readOrganization: async () => ({ name: "Northstar Events", status: "active" }),
      readSettings: async () => ({
        brandName: "Northstar Catering",
        businessEmail: "events@northstar.test"
      }),
      isOrganizationActive: (organization) => organization.status === "active"
    });

    expect(contact).toEqual({
      brandName: "Northstar Catering",
      organizationName: "Northstar Events",
      email: "events@northstar.test",
      phone: "",
      logoUrl: "",
      brandPrimaryColor: "",
      brandAccentColor: "",
      brandDarkAccentColor: ""
    });
    expect(contact).not.toHaveProperty("customerName");
    expect(contact).not.toHaveProperty("total");
  });
});
