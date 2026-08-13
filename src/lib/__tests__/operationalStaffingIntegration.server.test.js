import fs from "node:fs";
import { describe, expect, test } from "vitest";

const FUNCTIONS_SOURCE = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);
const RUNTIME_SOURCE = fs.readFileSync(
  new URL("../../../functions/operationalStaffingRuntime.js", import.meta.url),
  "utf8"
);

function callableSource(name, nextName) {
  const start = FUNCTIONS_SOURCE.indexOf(`exports.${name} =`);
  const end = nextName
    ? FUNCTIONS_SOURCE.indexOf(`exports.${nextName} =`, start + 1)
    : FUNCTIONS_SOURCE.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return FUNCTIONS_SOURCE.slice(start, end);
}

describe("operational staffing callable authority integration", () => {
  test("exports exactly the five named role-safe callable surfaces", () => {
    expect(FUNCTIONS_SOURCE.match(/exports\.getOperationalStaffingSnapshot\s*=/gu)).toHaveLength(1);
    expect(FUNCTIONS_SOURCE.match(/exports\.configureOperationalStaffProfile\s*=/gu)).toHaveLength(1);
    expect(FUNCTIONS_SOURCE.match(/exports\.applyOperationalStaffingPlan\s*=/gu)).toHaveLength(1);
    expect(FUNCTIONS_SOURCE.match(/exports\.getStaffDirectory\s*=/gu)).toHaveLength(1);
    expect(FUNCTIONS_SOURCE.match(/exports\.saveStaffRecord\s*=/gu)).toHaveLength(1);

    const snapshot = callableSource(
      "getOperationalStaffingSnapshot",
      "configureOperationalStaffProfile"
    );
    const profile = callableSource(
      "configureOperationalStaffProfile",
      "getStaffDirectory"
    );
    const plan = callableSource("applyOperationalStaffingPlan", "getProductAnalyticsSummary");
    const directory = callableSource("getStaffDirectory", "saveStaffRecord");
    const staffRecord = callableSource("saveStaffRecord", "applyOperationalStaffingPlan");
    [snapshot, profile, plan, directory, staffRecord].forEach((source) => {
      expect(source).toContain("assertStaff(context, { expectedOrganizationId: scope.organizationId })");
      expect(source).toContain("assertOperationalStaffingSameOrganization");
    });
    expect(profile).toContain("assertAdminStaff(");
    expect(directory).toContain("assertAdminStaff(");
    expect(staffRecord).toContain("assertAdminStaff(");
    expect(plan).not.toContain("assertAdminStaff(");
  });

  test("requires both global and transaction-read tenant authority gates", () => {
    expect(FUNCTIONS_SOURCE).toContain("process.env.OPERATIONAL_STAFFING_AUTHORITY_ENABLED");
    expect(RUNTIME_SOURCE).toContain("settings?.operationalStaffingAuthorityEnabled === true");
    [
      callableSource("getOperationalStaffingSnapshot", "configureOperationalStaffProfile"),
      callableSource("configureOperationalStaffProfile", "getStaffDirectory"),
      callableSource("applyOperationalStaffingPlan", "getProductAnalyticsSummary"),
      callableSource("getStaffDirectory", "saveStaffRecord"),
      callableSource("saveStaffRecord", "applyOperationalStaffingPlan")
    ].forEach((source) => {
      expect(source).toContain("tx.get(refs.settingsRef)");
      expect(source).toContain("assertOperationalStaffingStorageEnabled(settingsSnap)");
    });
  });

  test("uses the exact immutable active revision and tenant time zone for canonical evidence", () => {
    const snapshot = callableSource(
      "getOperationalStaffingSnapshot",
      "configureOperationalStaffProfile"
    );
    const plan = callableSource("applyOperationalStaffingPlan", "getProductAnalyticsSummary");
    expect(snapshot).toContain('refs.quoteRef.collection("versions").doc(activeQuoteRevisionId)');
    expect(plan).toContain('.doc(normalizeText(request.expectedQuoteRevisionId))');
    expect(plan).toContain("deriveCanonicalOperationalStaffingEvidence");
    expect(RUNTIME_SOURCE).toContain("settings?.businessTimeZone");
    expect(RUNTIME_SOURCE).toContain("lead: 0");
    expect(RUNTIME_SOURCE).not.toMatch(/snapshot\.booking|staffLead/u);
  });

  test("reads deterministic nested receipts before reconciliation and creates them immutably", () => {
    const profile = callableSource(
      "configureOperationalStaffProfile",
      "getStaffDirectory"
    );
    const plan = callableSource("applyOperationalStaffingPlan", "getProductAnalyticsSummary");
    expect(profile).toContain("buildOperationalStaffProfileReceiptId(request)");
    expect(profile).toContain('refs.profileRef.collection("versions").doc(receiptId)');
    expect(profile).toContain("tx.get(receiptRef)");
    expect(profile).toContain("tx.create(receiptRef");
    expect(plan).toContain("buildOperationalStaffingReceiptId(request)");
    expect(plan).toContain('refs.planRef.collection("versions").doc(receiptId)');
    expect(plan.indexOf("tx.get(receiptRef)")).toBeLessThan(plan.indexOf("tx.get(refs.quoteRef)"));
    expect(plan).toContain("existingReceipt: receiptSnap.data()?.receipt");
    expect(plan).toContain("tx.create(receiptRef");
  });

  test("persists exact bounded fence projections atomically without plan scans", () => {
    const plan = callableSource("applyOperationalStaffingPlan", "getProductAnalyticsSummary");
    expect(plan).toContain("deriveOperationalStaffingScheduleFenceRefs");
    expect(plan).toContain("await tx.getAll(...fenceDocRefs)");
    expect(FUNCTIONS_SOURCE).toContain("if (!snapshot?.exists) return emptyScheduleFence(ref)");
    expect(plan).toContain("dedupeScheduleFenceAssignments(fences)");
    expect(plan).toContain("planned.scheduleFenceOutputs.forEach");
    expect(plan).toContain("tx.create(fenceRef, record)");
    expect(plan).not.toMatch(/\.where\([^)]*(staff|assignment)/u);
  });

  test("keeps server timestamps outside immutable domain receipt digests", () => {
    const profile = callableSource(
      "configureOperationalStaffProfile",
      "getStaffDirectory"
    );
    const plan = callableSource("applyOperationalStaffingPlan", "getProductAnalyticsSummary");
    [profile, plan].forEach((source) => {
      expect(source).toContain("receipt: planned.receipt");
      expect(source).toContain("createdAt: FieldValue.serverTimestamp()");
    });
    expect(profile).toContain("serverTimeISO,");
    expect(plan).toContain("serverTimeISO\n      });");
    expect(RUNTIME_SOURCE).not.toContain("FieldValue");
  });

  test("preserves first-write timestamps when current projections advance", () => {
    const profile = callableSource(
      "configureOperationalStaffProfile",
      "getStaffDirectory"
    );
    const plan = callableSource("applyOperationalStaffingPlan", "getProductAnalyticsSummary");
    expect(profile).toContain("profileSnap.data()?.createdAt");
    expect(plan).toContain("planSnap.data()?.createdAt");
    expect(plan).toContain("priorSnap.data()?.createdAt");
  });
});
