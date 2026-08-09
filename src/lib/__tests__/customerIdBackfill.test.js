import { describe, expect, test } from "vitest";
import {
  assertEmulatorCustomerIdApply,
  parseCustomerIdBackfillArgs
} from "../../../scripts/backfill-customer-ids.mjs";
import { planLegacyCustomerIdBackfill } from "../../../scripts/customer-id-backfill-plan.mjs";

const NOW_ISO = "2026-08-08T12:00:00.000Z";

function customer(id, email, overrides = {}) {
  return {
    id,
    data: {
      organizationId: "org-a",
      name: `Customer ${id}`,
      email,
      ...overrides
    }
  };
}

function quote(id, email, overrides = {}) {
  return {
    id,
    data: {
      organizationId: "org-a",
      customerEmailKey: email,
      customer: { name: `Quote ${id}`, email },
      ...overrides
    }
  };
}

describe("legacy quote customer identity backfill", () => {
  test("defaults to dry-run and requires explicit scope", () => {
    expect(parseCustomerIdBackfillArgs([
      "--project", "demo-customer-id",
      "--organization", "org-a"
    ])).toEqual({
      projectId: "demo-customer-id",
      organizationId: "org-a",
      dryRun: true,
      confirmation: ""
    });
    expect(() => parseCustomerIdBackfillArgs([])).toThrow(/--project/i);
    expect(() => parseCustomerIdBackfillArgs([
      "--project", "demo-customer-id",
      "--organization", "org-a",
      "--apply"
    ])).toThrow(/--confirm/i);
    expect(() => parseCustomerIdBackfillArgs([
      "--project", "demo-customer-id",
      "--organization", "org-a",
      "--dry-run",
      "--apply"
    ])).toThrow(/exactly one mode/i);
  });

  test("permits apply only on a loopback emulator with a demo project", () => {
    expect(() => assertEmulatorCustomerIdApply({
      projectId: "demo-customer-id",
      organizationId: "org-a",
      dryRun: false,
      confirmation: "BACKFILL CUSTOMER IDS demo-customer-id org-a",
      env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }
    })).not.toThrow();
    expect(() => assertEmulatorCustomerIdApply({
      projectId: "production-project",
      organizationId: "org-a",
      dryRun: false,
      confirmation: "BACKFILL CUSTOMER IDS production-project org-a",
      env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }
    })).toThrow(/demo-/i);
    expect(() => assertEmulatorCustomerIdApply({
      projectId: "demo-customer-id",
      organizationId: "org-a",
      dryRun: false,
      confirmation: "BACKFILL CUSTOMER IDS demo-customer-id org-a",
      env: {}
    })).toThrow(/emulator-only/i);
    expect(() => assertEmulatorCustomerIdApply({
      projectId: "demo-customer-id",
      organizationId: "org-a",
      dryRun: false,
      confirmation: "wrong",
      env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }
    })).toThrow(/exact confirmation/i);
  });

  test("binds only unique normalized-email matches and plans normalized search keys", () => {
    const plan = planLegacyCustomerIdBackfill({
      organizationId: "org-a",
      nowISO: NOW_ISO,
      quotes: [quote("quote-a", " ADA@Example.com ")],
      customers: [customer("customer-a", "ada@example.com", { name: "  Ada   Lovelace " })],
      versions: [{
        id: "v0001",
        quoteId: "quote-a",
        data: { quoteId: "quote-a", organizationId: "org-a", snapshot: { id: "quote-a" } }
      }]
    });

    expect(plan.summary).toMatchObject({ wouldBind: 1, duplicateCustomerMatch: 0 });
    expect(plan.entries).toEqual([{
      quoteId: "quote-a",
      customerId: "customer-a",
      emailKey: "ada@example.com",
      quotePatch: { customerId: "customer-a" },
      customerPatch: {
        customerId: "customer-a",
        organizationId: "org-a",
        emailKey: "ada@example.com",
        nameKey: "ada lovelace",
        customerIdentityBackfilledAtISO: NOW_ISO
      },
      versionPatches: [{
        versionId: "v0001",
        patch: {
          customerId: "customer-a",
          "snapshot.customerId": "customer-a"
        }
      }]
    }]);
    expect(plan.summary).toMatchObject({ wouldBindQuotes: 1, wouldBindVersions: 1 });
  });

  test("reports duplicate and missing matches without planning writes", () => {
    const plan = planLegacyCustomerIdBackfill({
      organizationId: "org-a",
      nowISO: NOW_ISO,
      quotes: [
        quote("quote-duplicate", "duplicate@example.com"),
        quote("quote-missing", "missing@example.com"),
        quote("quote-no-email", "", { customer: {} }),
        quote("quote-bound", "bound@example.com", { customerId: "customer-bound" })
      ],
      customers: [
        customer("customer-a", "duplicate@example.com"),
        customer("customer-b", "DUPLICATE@example.com"),
        customer("customer-bound", "bound@example.com", {
          customerId: "customer-bound",
          emailKey: "bound@example.com",
          nameKey: "customer customer-bound"
        })
      ]
    });

    expect(plan.entries).toEqual([]);
    expect(plan.summary).toMatchObject({
      wouldBind: 0,
      alreadyBound: 1,
      missingEmail: 1,
      missingCustomerMatch: 1,
      duplicateCustomerMatch: 1
    });
    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ quoteId: "quote-duplicate", state: "duplicate_customer_match" }),
      expect.objectContaining({ quoteId: "quote-missing", state: "missing_customer_match" }),
      expect.objectContaining({ quoteId: "quote-no-email", state: "missing_email" })
    ]));
  });

  test("refuses conflicting immutable version identity instead of partially binding", () => {
    const plan = planLegacyCustomerIdBackfill({
      organizationId: "org-a",
      nowISO: NOW_ISO,
      quotes: [quote("quote-a", "ada@example.com")],
      customers: [customer("customer-a", "ada@example.com")],
      versions: [{
        id: "v0001",
        quoteId: "quote-a",
        data: {
          customerId: "different-customer",
          snapshot: { customerId: "different-customer" }
        }
      }]
    });

    expect(plan.entries).toEqual([]);
    expect(plan.summary.versionIdentityConflict).toBe(1);
    expect(plan.conflicts).toContainEqual({
      quoteId: "quote-a",
      state: "version_identity_conflict"
    });
  });
});
