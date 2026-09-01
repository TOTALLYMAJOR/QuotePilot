import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import CatalogDraftStateBar, { catalogDraftCapabilityState } from "../CatalogDraftStateBar";

function renderState(draftState) {
  return renderToStaticMarkup(
    <CatalogDraftStateBar draftState={{ label: "Draft status", ...draftState }} />
  );
}

describe("catalog draft publication state bar", () => {
  test("projects ready without claiming publication early", () => {
    expect(catalogDraftCapabilityState({ status: "ready_review" })).toBe("ready");
    expect(renderState({ status: "ready_review", changedRecordCount: 2 })).toContain('data-capability-state="ready"');
  });

  test("projects submitting while the private draft is saving", () => {
    expect(renderState({ status: "saving" })).toContain('data-capability-state="submitting"');
  });

  test("projects uncertain when unsent edits are device-only", () => {
    expect(renderState({ status: "sync_failed", deviceOnly: true })).toContain('data-capability-state="uncertain"');
  });

  test("projects reconciliation for a revision conflict", () => {
    expect(renderState({ status: "conflict" })).toContain('data-capability-state="reconciliation"');
  });

  test("projects receipt only after publication returns a receipt", () => {
    expect(renderState({ status: "saved", receipt: { receiptId: "receipt-a" } })).toContain('data-capability-state="receipt"');
  });

  test("projects error for a definitive draft failure", () => {
    expect(renderState({ status: "error" })).toContain('data-capability-state="error"');
  });

  test("projects recovery when the operator must retry", () => {
    expect(renderState({ status: "recovery" })).toContain('data-capability-state="recovery"');
  });

  test("labels a failed synchronization as device-only and keeps publication disabled", () => {
    const html = renderToStaticMarkup(
      <CatalogDraftStateBar
        draftState={{
          status: "sync_failed",
          label: "Sync failed — changes are device-only",
          deviceOnly: true,
          changedRecordCount: 3
        }}
      />
    );
    expect(html).toContain("changes are device-only");
    expect(html).toContain("These edits remain on this device");
    expect(html).toContain("Review and publish catalog");
    expect(html).toContain("disabled");
  });
});
