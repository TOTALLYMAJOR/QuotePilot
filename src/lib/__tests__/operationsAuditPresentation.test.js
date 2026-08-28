import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { resolveOperationsAuditCapabilityState } from "../operationsAuditPresentation";

function marker(state) {
  return `data-capability-state="${state}"`;
}

describe("Operations Audit presentation contract", () => {
  test("maps every canonical bounded read state without inventing stale data", () => {
    expect(marker(resolveOperationsAuditCapabilityState({ loading: true })))
      .toContain('data-capability-state="loading"');
    expect(marker(resolveOperationsAuditCapabilityState()))
      .toContain('data-capability-state="empty"');
    expect(marker(resolveOperationsAuditCapabilityState({ snapshot: { actions: [] } })))
      .toContain('data-capability-state="success"');
    expect(marker(resolveOperationsAuditCapabilityState({ snapshot: { sourceTruncated: true } })))
      .toContain('data-capability-state="partial"');
    expect(marker(resolveOperationsAuditCapabilityState({ error: "Unavailable" })))
      .toContain('data-capability-state="error"');
    expect(marker(resolveOperationsAuditCapabilityState({ loading: true, recovering: true })))
      .toContain('data-capability-state="recovery"');
  });

  test("binds the canonical state marker and receipt-versus-observation language to the admin surface", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/IntegrationOpsModal.jsx"),
      "utf8"
    );
    expect(source).toContain('data-capability-id="bounded-security-audit"');
    expect(source).toContain("data-capability-state={operationsAuditCapabilityState}");
    expect(source).toContain("Receipt-backed actions");
    expect(source).toContain("Legacy observations");
    expect(source).toContain("no receipt-clear workflow is implemented");
    expect(source).toContain("Operations audit could not be loaded. Try again.");
  });
});
