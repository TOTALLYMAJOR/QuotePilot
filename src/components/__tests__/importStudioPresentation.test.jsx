import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("../../lib/importBatchService", () => ({
  createCustomerImportSession: vi.fn(),
  createCustomerImportBatchId: vi.fn(() => "customer_test"),
  createImportBatchId: vi.fn(() => "catalog_test"),
  isCatalogImportType: vi.fn(() => false),
  MAX_IMPORT_SESSION_RECORDS: 1500,
  preflightCustomerImport: vi.fn(),
  rollbackImportBatch: vi.fn()
}));

import ImportStudioModal, {
  ImportMutationStatus,
  ImportStudioView,
  IMPORT_REVIEW_PAGE_SIZE,
  advanceImportFileReadGeneration,
  buildImportMutationPresentation,
  buildImportMutationResetGuard,
  classifyImportMutationFailure,
  isDefinitiveImportMutationError,
  isImportFileReadGenerationCurrent,
  paginateImportReviewRows,
  resolveImportBatchIdentity
} from "../ImportStudioModal";

const importStudioProps = {
  open: true,
  onClose: () => {},
  organizationId: "test-org",
  organizationName: "Test Organization",
  currentUserUid: "test-user",
  currentUserEmail: "admin@example.test"
};

function renderImportMutationState(props) {
  const presentation = buildImportMutationPresentation(props);
  return renderToStaticMarkup(
    <section>
      <ImportMutationStatus presentation={presentation} showPassive />
      <button type="button">{presentation.actionLabel}</button>
    </section>
  );
}

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

  test("renders trusted customer import idle, ready, and submitting states from the live presentation seam", () => {
    const idleHtml = renderImportMutationState({ phase: "idle", operation: "import" });
    const readyHtml = renderImportMutationState({ phase: "ready", operation: "import", readyCount: 3 });
    const submittingHtml = renderImportMutationState({ phase: "submitting", operation: "import", readyCount: 3 });

    expect(idleHtml).toContain('data-mutation-state="idle"');
    expect(idleHtml).toContain("Nothing has been written to the organization.");
    expect(readyHtml).toContain('data-mutation-state="ready"');
    expect(readyHtml).toContain('data-capability-state="ready"');
    expect(readyHtml).toContain("Nothing has been written.");
    expect(readyHtml).toContain(">Import 3 ready record(s)</button>");
    expect(submittingHtml).toContain('data-mutation-state="submitting"');
    expect(submittingHtml).toContain('data-capability-state="submitting"');
    expect(submittingHtml).toContain("Waiting for a server receipt");
    expect(submittingHtml).toContain("new-file actions stay locked to this batch identity");
    expect(submittingHtml).toContain(">Importing...</button>");
  });

  test("renders uncertain customer imports and same-batch reconciliation without assuming success", () => {
    const uncertainHtml = renderImportMutationState({
      phase: "uncertain",
      operation: "import",
      readyCount: 3,
      error: "Connection closed before a receipt returned."
    });
    const reconciliationHtml = renderImportMutationState({
      phase: "reconciling",
      operation: "import",
      readyCount: 3
    });
    const partialHtml = renderImportMutationState({
      phase: "partial",
      operation: "import",
      error: "Part 2 needs attention."
    });

    expect(uncertainHtml).toContain('data-mutation-state="uncertain"');
    expect(uncertainHtml).toContain('data-capability-state="uncertain"');
    expect(uncertainHtml).toContain("Import outcome is uncertain.");
    expect(uncertainHtml).toContain("same batch identity");
    expect(uncertainHtml).toContain("new-file actions remain locked");
    expect(uncertainHtml).toContain(">Check this import</button>");
    expect(uncertainHtml).not.toContain("Import completed");
    expect(reconciliationHtml).toContain('data-mutation-state="reconciliation"');
    expect(reconciliationHtml).toContain('data-capability-state="reconciliation"');
    expect(reconciliationHtml).toContain("The same batch identity is being retried.");
    expect(reconciliationHtml).toContain("source replacement remain locked");
    expect(reconciliationHtml).toContain(">Reconciling import...</button>");
    expect(partialHtml).toContain('data-capability-state="partial"');
    expect(partialHtml).toContain("Part of this import is confirmed.");
    expect(partialHtml).toContain(">Resume this import</button>");

    const partialUndoHtml = renderImportMutationState({
      phase: "partial",
      operation: "rollback",
      error: "One removal still needs reconciliation."
    });
    expect(partialUndoHtml).toContain("Part of this undo is confirmed.");
    expect(partialUndoHtml).toContain("confirmed removals replay safely");
    expect(partialUndoHtml).toContain(">Resume this undo</button>");
  });

  test("renders server receipts and explicit retry recovery without outbound-message claims", () => {
    const receiptHtml = renderImportMutationState({
      phase: "success",
      operation: "import",
      receiptStatus: "completed"
    });
    const errorHtml = renderImportMutationState({
      phase: "error",
      operation: "import",
      error: "The source revision changed."
    });
    const rollbackRecoveryHtml = renderImportMutationState({
      phase: "recovery",
      operation: "rollback",
      error: "Review the latest catalog before retrying.",
      recoveryReady: true
    });
    const waitingRecoveryHtml = renderImportMutationState({
      phase: "recovery",
      operation: "import",
      error: "The source revision changed.",
      recoveryReady: false,
      recoveryRefreshBusy: false
    });
    const refreshingRecoveryHtml = renderImportMutationState({
      phase: "recovery",
      operation: "import",
      recoveryReady: false,
      recoveryRefreshBusy: true
    });

    expect(receiptHtml).toContain('data-mutation-state="receipt"');
    expect(receiptHtml).toContain('data-capability-state="receipt"');
    expect(receiptHtml).toContain("Import confirmed");
    expect(receiptHtml).toContain("server receipt establishes the recorded batch result");
    expect(receiptHtml).not.toContain("delivered");
    expect(errorHtml).toContain('data-mutation-state="error"');
    expect(errorHtml).toContain('data-capability-state="error"');
    expect(errorHtml).toContain("No completed change is assumed.");
    expect(errorHtml).toContain(">Retry import</button>");
    expect(rollbackRecoveryHtml).toContain('data-capability-state="recovery"');
    expect(rollbackRecoveryHtml).toContain("The latest catalog revision is loaded.");
    expect(rollbackRecoveryHtml).toContain(">Retry undo</button>");
    expect(waitingRecoveryHtml).toContain("same batch identity remains locked");
    expect(waitingRecoveryHtml).toContain(">Retry source refresh</button>");
    expect(refreshingRecoveryHtml).toContain(">Refreshing source...</button>");
  });

  test("keeps unresolved import identities locked to their source until reconciliation", () => {
    for (const phase of ["submitting", "uncertain", "partial", "reconciling", "recovery"]) {
      expect(buildImportMutationResetGuard({
        phase,
        pendingImportBatchId: "customer_1234567890abcdef",
        busy: false
      })).toEqual({
        blocked: true,
        message: "Reconcile the current import batch before closing, changing its source, or starting another import."
      });
    }
    expect(buildImportMutationResetGuard({
      phase: "recovery",
      pendingImportBatchId: "catalog_1234567890abcdef",
      busy: false
    }).blocked).toBe(true);
    expect(buildImportMutationResetGuard({
      phase: "error",
      pendingImportBatchId: "",
      busy: false
    }).blocked).toBe(false);
    expect(buildImportMutationResetGuard({
      phase: "ready",
      pendingImportBatchId: "customer_existing_batch_1",
      busy: false
    }).blocked).toBe(true);
    expect(isDefinitiveImportMutationError({ code: "functions/invalid-argument" })).toBe(true);
    expect(isDefinitiveImportMutationError({ code: "functions/resource-exhausted" })).toBe(true);
    expect(isDefinitiveImportMutationError({ code: "functions/unavailable" })).toBe(false);

    const createCustomerId = vi.fn(() => "customer_explicit_batch_1");
    const preserved = resolveImportBatchIdentity({
      pendingImportBatchId: "customer_existing_batch_1",
      createCustomerId
    });
    const created = resolveImportBatchIdentity({ createCustomerId });
    expect(preserved).toBe("customer_existing_batch_1");
    expect(created).toBe("customer_explicit_batch_1");
    expect(createCustomerId).toHaveBeenCalledOnce();
  });

  test("pages every review row without dropping the tail of the source", () => {
    const rows = Array.from({ length: IMPORT_REVIEW_PAGE_SIZE * 2 + 7 }, (_, index) => ({
      rowNumber: index + 1
    }));

    expect(paginateImportReviewRows(rows, 1)).toMatchObject({
      page: 1,
      pageCount: 3,
      total: 107,
      rangeStart: 1,
      rangeEnd: 50
    });
    const lastPage = paginateImportReviewRows(rows, 99);
    expect(lastPage).toMatchObject({
      page: 3,
      pageCount: 3,
      total: 107,
      rangeStart: 101,
      rangeEnd: 107
    });
    expect(lastPage.rows.map((row) => row.rowNumber)).toEqual([101, 102, 103, 104, 105, 106, 107]);
  });

  test("preserves stable batch identity for uncertain outcomes and catalog refresh recovery", () => {
    expect(classifyImportMutationFailure({
      error: { code: "functions/unavailable" },
      catalogImport: false
    })).toEqual({
      phase: "uncertain",
      preserveBatchIdentity: true,
      requiresCatalogRefresh: false
    });
    expect(classifyImportMutationFailure({
      error: { code: "functions/aborted" },
      catalogImport: true
    })).toEqual({
      phase: "recovery",
      preserveBatchIdentity: true,
      requiresCatalogRefresh: true
    });
    expect(classifyImportMutationFailure({
      error: { code: "functions/invalid-argument" },
      catalogImport: false
    })).toEqual({
      phase: "error",
      preserveBatchIdentity: false,
      requiresCatalogRefresh: false
    });
    expect(classifyImportMutationFailure({
      error: { code: "functions/invalid-argument", partialResult: { childReceipts: [{ ok: true }] } },
      catalogImport: false
    })).toEqual({
      phase: "partial",
      preserveBatchIdentity: true,
      requiresCatalogRefresh: false
    });
  });

  test("invalidates a stale asynchronous file read on reset, close, or a newer file selection", () => {
    const generationRef = { current: 0 };
    const firstRead = advanceImportFileReadGeneration(generationRef);
    expect(isImportFileReadGenerationCurrent(generationRef, firstRead)).toBe(true);

    const secondRead = advanceImportFileReadGeneration(generationRef);
    expect(isImportFileReadGenerationCurrent(generationRef, firstRead)).toBe(false);
    expect(isImportFileReadGenerationCurrent(generationRef, secondRead)).toBe(true);

    advanceImportFileReadGeneration(generationRef);
    expect(isImportFileReadGenerationCurrent(generationRef, secondRead)).toBe(false);
  });
});
