import fs from "node:fs";
import { describe, expect, test } from "vitest";

const functionsSource = fs.readFileSync(
  new URL("../../../functions/index.js", import.meta.url),
  "utf8"
);
const quoteStoreSource = fs.readFileSync(
  new URL("../quoteStore.js", import.meta.url),
  "utf8"
);
const integrationOpsSource = fs.readFileSync(
  new URL("../../components/IntegrationOpsModal.jsx", import.meta.url),
  "utf8"
);

function callableSource(name, nextName) {
  const start = functionsSource.indexOf(`exports.${name} =`);
  const end = functionsSource.indexOf(`exports.${nextName} =`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return functionsSource.slice(start, end);
}

describe("server-authoritative quote deletion safety", () => {
  test("keeps the legacy bulk purge callable fail-closed without a mutation path", () => {
    const source = callableSource(
      "purgeDeletedQuotesForOrganization",
      "applyStarterCatalogPack"
    );

    expect(source).toContain("assertStaff");
    expect(source).toContain('"failed-precondition"');
    expect(source).toContain("Bulk quote purge is retired");
    expect(source).not.toContain("recursiveDelete");
    expect(source).not.toContain("deletePortalSnapshotsForQuote");
    expect(source).not.toContain('.where("status", "==", "deleted")');
  });

  test("does not expose bulk purge through the browser client or operator UI", () => {
    expect(quoteStoreSource).not.toContain("purgeDeletedQuotesForOrganization");
    expect(integrationOpsSource).not.toContain("purgeDeletedQuotesForOrganization");
    expect(integrationOpsSource).not.toContain("Purge Deleted Quotes");
    expect(integrationOpsSource).not.toContain("purgingDeletedQuotes");
    expect(integrationOpsSource).not.toContain("setPurgingDeletedQuotes");
    expect(integrationOpsSource).toContain(
      "Permanent quote deletion is available one quote at a time in Quote History"
    );
  });

  test("keeps exact-request execution and durable audit on per-quote deletion", () => {
    const source = callableSource(
      "hardDeleteQuote",
      "purgeDeletedQuotesForOrganization"
    );

    expect(source).toContain("approvalRequestId");
    expect(source).toContain('action: "delete_quote"');
    expect(source).toContain("buildApprovalExecutionAudit");
    expect(source).toContain("getQuoteApprovalExecutionDocRef");
    expect(source).toContain("idempotent: true");
  });
});
