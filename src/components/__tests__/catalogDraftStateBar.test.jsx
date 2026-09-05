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

  test("explains a failed save in business terms and offers only the valid recovery", () => {
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
    expect(html).toContain("Library changes are waiting to save");
    expect(html).toContain("not in the shared draft and cannot be published yet");
    expect(html).toContain("Try saving again");
    expect(html).not.toContain("Check draft before publishing");
    expect(html).not.toContain("Publish Library");
    expect(html).toContain("Technical details");
    expect(html).toContain("Sync failed — changes are device-only");
  });

  test("never labels a device-only or unpublished change as saved", () => {
    const html = renderState({
      status: "sync_failed",
      deviceOnly: true,
      changedRecordCount: 1,
      label: "Sync failed — changes are device-only"
    });
    expect(html).not.toContain("All changes saved");
    expect(html).not.toContain(">Saved<");
  });

  test("distinguishes an unavailable shared draft from a failed save", () => {
    const publishedHtml = renderState({
      status: "sync_failed",
      deviceOnly: false,
      changedRecordCount: 0,
      error: "Failed to load the catalog setup draft."
    });
    expect(publishedHtml).toContain("Library draft is unavailable");
    expect(publishedHtml).toContain("Published pricing remains active");
    expect(publishedHtml).toContain("Try reconnecting");
    expect(publishedHtml).not.toContain("could not be saved");

    const localHtml = renderToStaticMarkup(
      <CatalogDraftStateBar
        draftState={{
          status: "sync_failed",
          deviceOnly: false,
          changedRecordCount: 0,
          error: "Failed to load the catalog setup draft."
        }}
        publishedCatalogAvailable={false}
      />
    );
    expect(localHtml).toContain("Library is available in this workspace");
    expect(localHtml).toContain("The shared draft cannot be reached from this source");
    expect(localHtml).toContain("no shared catalog or pricing changed");
  });

  test("compresses healthy state and hides redundant technical detail", () => {
    const html = renderState({ status: "idle", changedRecordCount: 0 });
    expect(html).toContain("Published Library is active");
    expect(html).not.toContain("Technical details");
  });

  test("does not claim shared publication from a local-only Library source", () => {
    const html = renderToStaticMarkup(
      <CatalogDraftStateBar
        draftState={{ status: "idle", changedRecordCount: 3 }}
        publishedCatalogAvailable={false}
      />
    );
    expect(html).toContain("Library changes are in this workspace only");
    expect(html).toContain("3 changes are available here");
    expect(html).toContain("Publishing is unavailable from this source");
    expect(html).not.toContain("Published Library is active");
    expect(html).not.toContain("Check draft before publishing");
    expect(html).not.toContain("Publish Library");
  });
});
