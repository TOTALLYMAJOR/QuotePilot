import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("../../lib/importBatchService", () => ({
  createImportBatchId: vi.fn(() => "catalog_test"),
  createImportBatch: vi.fn(),
  isCatalogImportType: vi.fn(() => false),
  MAX_IMPORT_RECORDS: 350,
  rollbackImportBatch: vi.fn()
}));

import ImportStudioModal, { ImportStudioView } from "../ImportStudioModal";

const importStudioProps = {
  open: true,
  onClose: () => {},
  organizationId: "test-org",
  organizationName: "Test Organization",
  currentUserUid: "test-user",
  currentUserEmail: "admin@example.test"
};

describe("Import Studio presentation", () => {
  test("exposes an embedded route without changing the modal wrapper contract", () => {
    const embeddedHtml = renderToStaticMarkup(
      <ImportStudioView {...importStudioProps} />
    );
    const modalHtml = renderToStaticMarkup(
      <ImportStudioModal {...importStudioProps} />
    );

    expect(embeddedHtml).toContain("container workspace-route-main embedded-workspace-route");
    expect(embeddedHtml).toContain('role="region"');
    expect(embeddedHtml).toContain("workspace-route-card");
    expect(embeddedHtml).not.toContain('aria-modal="true"');
    expect(embeddedHtml).toContain(">Back to Home</button>");

    expect(modalHtml).toContain("modal-overlay");
    expect(modalHtml).toContain('role="dialog"');
    expect(modalHtml).toContain('aria-modal="true"');
    expect(modalHtml).toContain(">Close</button>");
  });
});
