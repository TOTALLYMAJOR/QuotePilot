// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const batchService = vi.hoisted(() => ({
  createCustomerImportSession: vi.fn(),
  createCustomerImportBatchId: vi.fn(() => "customer_session_001"),
  createImportBatchId: vi.fn(() => "catalog_batch_001"),
  preflightCustomerImport: vi.fn(),
  rollbackImportBatch: vi.fn()
}));
const catalogDraftService = vi.hoisted(() => ({
  preflightCatalogImportDraft: vi.fn(),
  stageCatalogImportDraft: vi.fn()
}));
const pdfService = vi.hoisted(() => ({
  extractSearchablePdf: vi.fn()
}));

vi.mock("../../lib/importBatchService", () => ({
  ...batchService,
  isCatalogImportType: (importType = "") => new Set([
    "packages",
    "addons",
    "rentals",
    "eventTypes",
    "menuCategories",
    "menuItems"
  ]).has(String(importType)),
  MAX_IMPORT_SESSION_RECORDS: 1500
}));

vi.mock("../../lib/catalogSetupDraftService", () => ({
  ...catalogDraftService
}));

vi.mock("../../lib/pdfImport", () => ({
  ...pdfService
}));

import { ImportStudioView } from "../ImportStudioModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_PROPS = Object.freeze({
  open: true,
  organizationId: "org-alpha",
  organizationName: "Northstar Catering",
  currentUserUid: "admin-alpha",
  currentUserEmail: "admin@northstar.test",
  catalogRevision: 7
});

let container;
let root;
let confirmSpy;

function mount(props = {}) {
  act(() => {
    root.render(
      <ImportStudioView
        {...BASE_PROPS}
        onClose={() => {}}
        {...props}
      />
    );
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    await Promise.resolve();
  });
}

async function uploadCsv(source, name = "records.csv") {
  const input = container.querySelector('input[type="file"]');
  const file = {
    name,
    type: "text/csv",
    size: new TextEncoder().encode(source).byteLength,
    text: vi.fn(async () => source)
  };
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file]
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
  return file;
}

async function uploadPdf(name = "catalog.pdf") {
  const input = container.querySelector('input[type="file"]');
  const file = {
    name,
    type: "application/pdf",
    size: 1024,
    arrayBuffer: vi.fn(async () => new Uint8Array([37, 80, 68, 70]).buffer)
  };
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file]
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
  return file;
}

function button(label) {
  return [...container.querySelectorAll("button")].find((candidate) => (
    candidate.textContent.replace(/\s+/g, " ").trim().includes(label)
  ));
}

function labeledSelect(label) {
  const normalized = String(label).trim();
  return [...container.querySelectorAll("label")]
    .find((candidate) => candidate.textContent.replace(/\s+/g, " ").trim().startsWith(normalized))
    ?.querySelector("select") || null;
}

function mappingSelect(fieldLabel) {
  return [...container.querySelectorAll(".import-mapping-field")]
    .find((field) => field.querySelector("label > span")?.textContent.trim() === fieldLabel)
    ?.querySelector("label > select") || null;
}

function choiceField(label) {
  return [...container.querySelectorAll(".adaptive-choice-field")]
    .find((field) => field.querySelector(".adaptive-choice-field__label")?.textContent.trim() === label) || null;
}

function metric(label) {
  return [...container.querySelectorAll(".import-review-section .import-review-metrics > div")]
    .find((entry) => entry.querySelector("span")?.textContent.trim() === label)
    ?.querySelector("strong")?.textContent.trim() || "";
}

async function click(candidate) {
  expect(candidate).toBeTruthy();
  await act(async () => {
    candidate.click();
    await Promise.resolve();
  });
  await settle();
}

async function choose(select, value) {
  expect(select).toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value"
    ).set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
}

async function prepareMenuItemRelationships(catalogContext = {}, props = {}) {
  mount({ catalogContext, ...props });
  await uploadCsv("Name,Price\nHerb chicken,18\n", "menu-items.csv");
  await choose(labeledSelect("Change record type"), "menuItems");
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

  Object.values(batchService).forEach((mock) => mock.mockClear());
  Object.values(catalogDraftService).forEach((mock) => mock.mockReset());
  pdfService.extractSearchablePdf.mockReset();

  batchService.preflightCustomerImport.mockImplementation(async ({ records }) => ({
    ok: true,
    authority: "server_preflight",
    observedAtISO: "2026-09-05T16:00:00.000Z",
    projectedCreateCount: records.length,
    projectedSkipCount: 0,
    chunks: [{ sourceIndexes: records.map((_, index) => index) }]
  }));
  batchService.createCustomerImportSession.mockResolvedValue({
    ok: true,
    status: "completed",
    importType: "customers",
    importBatchId: "customer_session_001",
    childBatchIds: ["customer_session_001"],
    createdCount: 1,
    skippedCount: 0
  });
  catalogDraftService.preflightCatalogImportDraft.mockResolvedValue({
    ok: true,
    authority: "shared_catalog_draft",
    observedAtISO: "2026-09-05T16:00:00.000Z",
    stagedCount: 1,
    projectedDraftChangeCount: 1,
    baseCatalogRevision: 7,
    currentCatalogRevision: 7
  });
  catalogDraftService.stageCatalogImportDraft.mockResolvedValue({
    ok: true,
    status: "staged",
    importType: "eventTypes",
    importBatchId: "catalog_batch_001",
    stagedCount: 1,
    skippedCount: 0
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  confirmSpy.mockRestore();
});

describe("Import Workbench flow", () => {
  test("makes every inferred source row reachable through explicit review pages", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => (
      `Customer ${index + 1},customer-${index + 1}@example.test`
    ));
    mount();
    await uploadCsv(["Name,Email", ...rows].join("\n"), "customers-51.csv");

    expect(container.querySelectorAll(".import-review-table tbody tr")).toHaveLength(50);
    expect(container.querySelector(".import-review-pagination")?.textContent).toContain("1-50 of 51");
    expect(container.textContent).toContain("Every inferred record remains available through review pages");

    await click(button("Next review page"));

    expect(container.querySelectorAll(".import-review-table tbody tr")).toHaveLength(1);
    expect(container.querySelector(".import-review-pagination")?.textContent).toContain("51-51 of 51");
    expect(container.querySelector(".import-review-table tbody tr")?.textContent).toContain("Customer 51");
  });

  test("renders every mapped PDF value, resolved relationship, and source excerpt before preflight", async () => {
    pdfService.extractSearchablePdf.mockResolvedValue({
      headers: ["Name", "Price", "Cost", "Menu section", "Source page", "Source excerpt"],
      detectedImportType: "menuItems",
      diagnostics: [{ severity: "warning", code: "pdf_price_rows_inferred", message: "Confirm the inferred price." }],
      source: { kind: "pdf", fileName: "fall-menu.pdf", pageCount: 3, textCharacterCount: 48 },
      rows: [{
        rowNumber: 1,
        sourceLocator: { kind: "pdf", page: 3, excerpt: "Roast chicken $24.00 $8.25" },
        values: {
          Name: "Roast chicken",
          Price: "24.00",
          Cost: "8.25",
          "Menu section": "Entrees",
          "Source page": "3",
          "Source excerpt": "Roast chicken $24.00 $8.25"
        }
      }]
    });
    mount({
      catalogContext: {
        eventTypes: [{ id: "wedding", name: "Wedding" }],
        categories: [{ id: "entrees", name: "Entrees", eventTypeId: "wedding" }]
      }
    });

    await uploadPdf("fall-menu.pdf");

    expect(container.querySelector(".import-source-excerpt")?.textContent)
      .toBe("Roast chicken $24.00 $8.25");
    expect(container.querySelector(".import-unmapped-fields")?.textContent)
      .toContain("Source page, Source excerpt");
    expect(container.querySelector(".import-unmapped-fields")?.textContent)
      .toContain("remain attached as review provenance");
    const reviewedValues = [...container.querySelectorAll(".import-preview-field > strong")]
      .map((node) => node.textContent);
    expect(reviewedValues).toEqual(expect.arrayContaining([
      "Roast chicken",
      "Wedding (wedding)",
      "Entrees (entrees)",
      "24",
      "8.25",
      "per item (per_item)",
      "Yes"
    ]));
    expect(container.querySelectorAll(".import-preview-field [data-field-state-primary]").length)
      .toBe(7);
    expect(catalogDraftService.preflightCatalogImportDraft).not.toHaveBeenCalled();
  });

  test("uploads CSV, explicitly excludes a blocked row, preflights, and hands a multi-batch customer session to the service", async () => {
    const onImported = vi.fn();
    batchService.preflightCustomerImport.mockResolvedValue({
      ok: true,
      authority: "server_preflight",
      planHash: "customer-plan-hash-001",
      observedAtISO: "2026-09-05T16:00:00.000Z",
      projectedCreateCount: 2,
      projectedSkipCount: 0,
      chunks: [
        { sourceIndexes: [0], maximumWrites: 3 },
        { sourceIndexes: [1], maximumWrites: 3 }
      ]
    });
    batchService.createCustomerImportSession.mockResolvedValue({
      ok: true,
      status: "completed",
      importType: "customers",
      importBatchId: "customer_session_001",
      childBatchIds: ["customer_session_001_part_001", "customer_session_001_part_002"],
      createdCount: 2,
      skippedCount: 0
    });
    mount({ onImported });

    const sourceFile = await uploadCsv([
      "Name,Email",
      "Maya Bennett,maya@example.test",
      "Jordan Lee,jordan@example.test",
      "Broken identity,not-an-email"
    ].join("\n"), "customers.csv");

    expect(sourceFile.text).toHaveBeenCalledOnce();
    expect(pdfService.extractSearchablePdf).not.toHaveBeenCalled();
    expect(container.textContent).toContain("CSV source inspected");
    expect(metric("Included + ready")).toBe("2");
    expect(metric("Included blockers")).toBe("1");
    expect(button("Run server preflight").disabled).toBe(true);

    await click(button("Exclude every blocked row"));

    expect(metric("Included + ready")).toBe("2");
    expect(metric("Included blockers")).toBe("0");
    expect(metric("Explicitly excluded")).toBe("1");
    expect(container.querySelector('input[aria-label="Include source row 4"]')).not.toBeNull();
    expect(container.querySelector(".import-studio-foot .cta").disabled).toBe(true);
    expect(batchService.createCustomerImportSession).not.toHaveBeenCalled();

    await click(button("Run server preflight"));

    expect(batchService.preflightCustomerImport).toHaveBeenCalledOnce();
    expect(batchService.preflightCustomerImport).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-alpha",
      fileName: "customers.csv",
      records: expect.arrayContaining([
        expect.objectContaining({ record: expect.objectContaining({ email: "maya@example.test" }) }),
        expect.objectContaining({ record: expect.objectContaining({ email: "jordan@example.test" }) })
      ])
    }));
    expect(batchService.preflightCustomerImport.mock.calls[0][0].records)
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ rowNumber: 4 })
      ]));
    expect(container.querySelector('[data-capability-state="confirmed"]')).not.toBeNull();
    expect(container.textContent).toContain("Safe child batches2");
    expect(container.querySelector(".import-studio-foot .cta").disabled).toBe(false);

    await click(container.querySelector(".import-studio-foot .cta"));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("2 safe batch part(s)"));
    expect(batchService.createCustomerImportSession).toHaveBeenCalledOnce();
    expect(batchService.createCustomerImportSession).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-alpha",
      organizationName: "Northstar Catering",
      fileName: "customers.csv",
      importBatchId: "customer_session_001",
      records: expect.any(Array),
      preflight: expect.objectContaining({
        importType: "customers",
        importBatchId: "customer_session_001",
        planHash: "customer-plan-hash-001",
        readyCount: 2,
        chunks: expect.arrayContaining([
          expect.objectContaining({ sourceIndexes: [0] }),
          expect.objectContaining({ sourceIndexes: [1] })
        ])
      })
    }));
    expect(batchService.createCustomerImportSession.mock.calls[0][0].records).toHaveLength(2);
    expect(batchService.createCustomerImportSession.mock.calls[0][0].records)
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ rowNumber: 4 })
      ]));
    expect(container.textContent).toContain("Northstar Catering has new records");
    expect(container.textContent).toContain("2 transaction-safe batch part(s)");
    expect(container.textContent).toContain("No outbound messages were sent");
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  test("invalidates the current preflight whenever an operator changes field mapping", async () => {
    mount();
    await uploadCsv([
      "Name,Email,Phone",
      "Maya Bennett,maya@example.test,312-555-0101",
      "Jordan Lee,jordan@example.test,312-555-0102"
    ].join("\n"), "customers.csv");

    expect(container.querySelector(".import-studio-foot .cta").disabled).toBe(true);
    await click(button("Run server preflight"));
    expect(container.querySelector(".import-studio-foot .cta").disabled).toBe(false);
    expect(container.querySelector('[aria-label="Import plan: Confirmed"]')).not.toBeNull();

    await choose(mappingSelect("Phone"), "");

    expect(container.querySelector('[aria-label="Import plan: Confirmed"]')).toBeNull();
    expect(container.querySelector('[aria-label="Import plan: Pending"]')).not.toBeNull();
    expect(container.querySelector(".import-studio-foot .cta").disabled).toBe(true);
    expect(button("Run server preflight")).toBeTruthy();
    expect(batchService.preflightCustomerImport).toHaveBeenCalledOnce();

    await click(button("Run server preflight"));
    expect(batchService.preflightCustomerImport).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".import-studio-foot .cta").disabled).toBe(false);
  });

  test("stages catalog rows without publishing and hands the exact receipt to catalog review", async () => {
    const onReviewCatalog = vi.fn();
    const onImported = vi.fn();
    mount({ onReviewCatalog, onImported });
    await uploadCsv("Name,Active\nWedding,yes\n", "event-types.csv");
    await choose(labeledSelect("Change record type"), "eventTypes");

    expect(metric("Included + ready")).toBe("1");
    await click(button("Run server preflight"));
    expect(catalogDraftService.preflightCatalogImportDraft).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_batch_001"
    }));
    expect(container.textContent).toContain("Shared catalog draft checked 1 row(s)");

    await click(container.querySelector(".import-studio-foot .cta"));

    expect(catalogDraftService.stageCatalogImportDraft).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-alpha",
      importType: "eventTypes",
      importBatchId: "catalog_batch_001",
      preflight: expect.objectContaining({
        baseCatalogRevision: 7,
        currentCatalogRevision: 7
      })
    }));
    expect(container.textContent).toContain("1 record added to the catalog draft");
    expect(container.textContent).toContain("Saved in the shared draft. It is not Published");
    expect(container.textContent).toContain("The active catalog is unchanged");
    expect(button("Review catalog draft")).toBeTruthy();
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ status: "staged" }));

    await click(button("Review catalog draft"));
    expect(onReviewCatalog).toHaveBeenCalledWith(expect.objectContaining({
      status: "staged",
      importType: "eventTypes",
      importBatchId: "catalog_batch_001"
    }));
  });

  test("renders a reconciled published catalog receipt without offering draft undo", async () => {
    const onReviewCatalog = vi.fn();
    const onImported = vi.fn();
    catalogDraftService.stageCatalogImportDraft.mockResolvedValueOnce({
      ok: true,
      status: "published",
      importType: "eventTypes",
      importBatchId: "catalog_batch_001",
      stagedCount: 1,
      skippedCount: 0,
      publicationReceiptId: "publish_receipt_001",
      catalogRevisionAfter: 8
    });
    mount({ onReviewCatalog, onImported });
    await uploadCsv("Name,Active\nWedding,yes\n", "event-types.csv");
    await choose(labeledSelect("Change record type"), "eventTypes");
    await click(button("Run server preflight"));
    await click(container.querySelector(".import-studio-foot .cta"));

    expect(container.textContent).toContain("1 catalog record already published");
    expect(container.querySelector('[aria-label="Catalog import: Published"]')).not.toBeNull();
    expect(container.textContent).toContain("publication publish_receipt_001 at catalog revision 8");
    expect(container.textContent).toContain("current shared draft may contain later, unrelated work");
    expect(button("Review active catalog")).toBeTruthy();
    expect(button("Undo this import")).toBeUndefined();
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));

    await click(button("Review active catalog"));
    expect(onReviewCatalog).toHaveBeenCalledWith(expect.objectContaining({
      status: "published",
      publicationReceiptId: "publish_receipt_001",
      catalogRevisionAfter: 8
    }));
  });

  test("recovers a shared-draft generation conflict with the same batch identity and a fresh preflight", async () => {
    const conflict = new Error("The shared catalog draft changed before save.");
    conflict.code = "functions/aborted";
    catalogDraftService.stageCatalogImportDraft
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        ok: true,
        status: "staged",
        importType: "eventTypes",
        importBatchId: "catalog_batch_001",
        stagedCount: 1,
        skippedCount: 0
      });
    const onReload = vi.fn(async () => undefined);
    mount({ onReload });
    await uploadCsv("Name,Active\nWedding,yes\n", "event-types.csv");
    await choose(labeledSelect("Change record type"), "eventTypes");
    await click(button("Run server preflight"));
    await click(container.querySelector(".import-studio-foot .cta"));

    expect(onReload).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("run preflight again with the same batch identity");
    expect(catalogDraftService.stageCatalogImportDraft).toHaveBeenCalledTimes(1);

    await click(button("Run server preflight"));
    expect(catalogDraftService.preflightCatalogImportDraft).toHaveBeenCalledTimes(2);
    expect(catalogDraftService.preflightCatalogImportDraft.mock.calls.map(([input]) => input.importBatchId))
      .toEqual(["catalog_batch_001", "catalog_batch_001"]);

    await click(container.querySelector(".import-studio-foot .cta"));
    expect(catalogDraftService.stageCatalogImportDraft).toHaveBeenCalledTimes(2);
    expect(catalogDraftService.stageCatalogImportDraft.mock.calls[1][0].importBatchId)
      .toBe("catalog_batch_001");
    expect(container.textContent).toContain("1 record added to the catalog draft");
  });

  test("keeps an unresolved customer batch locked to its issued preflight while resuming", async () => {
    const partialFailure = new Error("The second child batch needs reconciliation.");
    partialFailure.partialResult = {
      ok: true,
      status: "partial",
      importType: "customers",
      importBatchId: "customer_session_001",
      childBatchIds: ["customer_session_001_part_001"],
      childReceipts: [{ ok: true, importBatchId: "customer_session_001_part_001" }],
      createdCount: 1,
      skippedCount: 0
    };
    batchService.createCustomerImportSession.mockRejectedValue(partialFailure);
    batchService.rollbackImportBatch.mockResolvedValue({
      ok: true,
      status: "rolled_back",
      importType: "customers",
      importBatchId: "customer_session_001",
      deletedCount: 1,
      protectedCount: 0
    });
    mount();
    await uploadCsv("Name,Email\nMaya Bennett,maya@example.test\n", "customers.csv");
    await click(button("Run server preflight"));
    await click(container.querySelector(".import-studio-foot .cta"));

    expect(container.querySelector('[data-mutation-state="partial"]')).not.toBeNull();
    expect(container.textContent).toContain("Part of this customer import is confirmed");
    expect(button("Resume remaining import")).toBeTruthy();
    expect(button("Undo this import")).toBeTruthy();
    expect(button("Run preflight again")).toBeUndefined();
    expect(button("Back to Home").disabled).toBe(true);
    expect(batchService.preflightCustomerImport).toHaveBeenCalledOnce();

    await click(button("Undo this import"));
    expect(batchService.rollbackImportBatch).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-alpha",
      importBatchId: "customer_session_001",
      childBatchIds: ["customer_session_001_part_001"],
      importType: "customers"
    }));
    expect(container.textContent).toContain("Import safely undone");
  });

  test("keeps catalog source-refresh retry reachable after reload fails, then re-preflights the same batch", async () => {
    const conflict = new Error("The shared catalog draft changed before save.");
    conflict.code = "functions/aborted";
    catalogDraftService.stageCatalogImportDraft.mockRejectedValue(conflict);
    const onReload = vi.fn()
      .mockRejectedValueOnce(new Error("Catalog source unavailable."))
      .mockResolvedValueOnce(undefined);
    mount({ onReload });
    await uploadCsv("Name,Active\nWedding,yes\n", "event-types.csv");
    await choose(labeledSelect("Change record type"), "eventTypes");
    await click(button("Run server preflight"));
    await click(container.querySelector(".import-studio-foot .cta"));

    const footerAction = () => container.querySelector(".import-studio-foot .cta");
    expect(onReload).toHaveBeenCalledOnce();
    expect(footerAction().textContent).toContain("Retry source refresh");
    expect(footerAction().disabled).toBe(false);
    expect(button("Back to Home").disabled).toBe(true);

    await click(footerAction());
    expect(onReload).toHaveBeenCalledTimes(2);
    expect(footerAction().textContent).toContain("Run preflight again");
    expect(footerAction().disabled).toBe(false);

    await click(footerAction());
    expect(catalogDraftService.preflightCatalogImportDraft).toHaveBeenCalledTimes(2);
    expect(catalogDraftService.preflightCatalogImportDraft.mock.calls.map(([input]) => input.importBatchId))
      .toEqual(["catalog_batch_001", "catalog_batch_001"]);
    expect(button("Run preflight again").disabled).toBe(true);
    expect(button("Back to Home").disabled).toBe(true);
    expect(footerAction().textContent).toContain("Import 1 ready record(s)");
    expect(footerAction().disabled).toBe(false);

    mount({ onReload, catalogRevision: 8 });
    expect(container.querySelector('[aria-label="Import plan: Stale"]')).not.toBeNull();
    expect(button("Refresh latest catalog source")).toBeTruthy();
    expect(button("Back to Home").disabled).toBe(true);
  });

  test("keeps a failed catalog recovery preflight retryable under the same locked identity", async () => {
    const conflict = new Error("The shared catalog draft changed before save.");
    conflict.code = "functions/aborted";
    catalogDraftService.stageCatalogImportDraft.mockRejectedValue(conflict);
    const onReload = vi.fn(async () => undefined);
    mount({ onReload });
    await uploadCsv("Name,Active\nWedding,yes\n", "event-types.csv");
    await choose(labeledSelect("Change record type"), "eventTypes");
    await click(button("Run server preflight"));
    await click(container.querySelector(".import-studio-foot .cta"));

    catalogDraftService.preflightCatalogImportDraft
      .mockRejectedValueOnce(new Error("Latest shared draft could not be read."));
    const footerAction = () => container.querySelector(".import-studio-foot .cta");
    await click(footerAction());

    expect(container.querySelector('[data-mutation-state="recovery"]')).not.toBeNull();
    expect(container.textContent).toContain("Latest shared draft could not be read");
    expect(footerAction().textContent).toContain("Run preflight again");
    expect(footerAction().disabled).toBe(false);
    expect(button("Back to Home").disabled).toBe(true);

    await click(footerAction());
    expect(catalogDraftService.preflightCatalogImportDraft).toHaveBeenCalledTimes(3);
    expect(footerAction().textContent).toContain("Import 1 ready record(s)");
    expect(footerAction().disabled).toBe(false);
  });

  test("allows scoped relationship repair after refresh without releasing the recovering catalog batch", async () => {
    const conflict = new Error("The shared catalog draft changed before save.");
    conflict.code = "functions/aborted";
    catalogDraftService.stageCatalogImportDraft.mockRejectedValue(conflict);
    const onReload = vi.fn(async () => undefined);
    const initialContext = {
      eventTypes: [{ id: "wedding", name: "Wedding" }],
      categories: [{ id: "entrees", name: "Entrees", eventTypeId: "wedding" }]
    };
    await prepareMenuItemRelationships(initialContext, { onReload });
    await click(button("Run server preflight"));
    await click(container.querySelector(".import-studio-foot .cta"));

    const refreshedContext = {
      eventTypes: [
        { id: "social", name: "Social" },
        { id: "corporate", name: "Corporate" }
      ],
      categories: [
        { id: "starters", name: "Starters", eventTypeId: "social" },
        { id: "boxed", name: "Boxed meals", eventTypeId: "corporate" }
      ]
    };
    mount({ onReload, catalogContext: refreshedContext });
    await settle();

    const eventType = choiceField("Apply one event type to every row");
    expect(metric("Included blockers")).toBe("1");
    expect(eventType?.dataset.adaptiveChoiceMode).toBe("select");
    expect(eventType.querySelector("select").disabled).toBe(false);
    expect(button("Back to Home").disabled).toBe(true);

    await choose(eventType.querySelector("select"), "social");
    expect(choiceField("Apply one category to every row")?.dataset.adaptiveChoiceMode).toBe("single");
    expect(metric("Included blockers")).toBe("0");
    expect(metric("Included + ready")).toBe("1");
    expect(container.querySelector(".import-studio-foot .cta").disabled).toBe(false);

    await click(container.querySelector(".import-studio-foot .cta"));
    expect(catalogDraftService.preflightCatalogImportDraft).toHaveBeenCalledTimes(2);
    expect(catalogDraftService.preflightCatalogImportDraft.mock.calls.map(([input]) => input.importBatchId))
      .toEqual(["catalog_batch_001", "catalog_batch_001"]);
    expect(button("Back to Home").disabled).toBe(true);
  });

  test("shows a blocked relationship state and recovery when no constant choices exist", async () => {
    const onReviewCatalog = vi.fn();
    await prepareMenuItemRelationships({}, { onReviewCatalog });

    const eventType = choiceField("Apply one event type to every row");
    const category = choiceField("Apply one category to every row");
    expect(eventType?.dataset.adaptiveChoiceMode).toBe("empty");
    expect(category?.dataset.adaptiveChoiceMode).toBe("empty");
    expect(eventType.querySelector("select")).toBeNull();
    expect(category.querySelector("select")).toBeNull();
    expect(eventType.textContent).toContain("No active event types");
    expect(category.textContent).toContain("No active menu sections");
    expect(metric("Included blockers")).toBe("1");

    await click(eventType.querySelector("button"));
    expect(onReviewCatalog).toHaveBeenCalledWith({ importType: "menuItems" });
  });

  test("shows one constant relationship choice as static context and applies it automatically", async () => {
    await prepareMenuItemRelationships({
      eventTypes: [{ id: "wedding", name: "Wedding" }],
      categories: [{ id: "entrees", name: "Entrees", eventTypeId: "wedding" }]
    });

    const eventType = choiceField("Apply one event type to every row");
    const category = choiceField("Apply one category to every row");
    expect(eventType?.dataset.adaptiveChoiceMode).toBe("single");
    expect(category?.dataset.adaptiveChoiceMode).toBe("single");
    expect(eventType.querySelector("select")).toBeNull();
    expect(category.querySelector("select")).toBeNull();
    expect(eventType.querySelector('[data-adaptive-choice-value="wedding"]')?.textContent)
      .toContain("Wedding");
    expect(category.querySelector('[data-adaptive-choice-value="entrees"]')?.textContent)
      .toContain("Entrees");
    expect(metric("Included + ready")).toBe("1");
    expect(metric("Included blockers")).toBe("0");
  });

  test("narrows a dependent relationship choice after an exact event type is selected", async () => {
    await prepareMenuItemRelationships({
      eventTypes: [
        { id: "wedding", name: "Wedding" },
        { id: "corporate", name: "Corporate" }
      ],
      categories: [
        { id: "entrees", name: "Entrees", eventTypeId: "wedding" },
        { id: "boxed", name: "Boxed meals", eventTypeId: "corporate" }
      ]
    });

    const eventType = choiceField("Apply one event type to every row");
    expect(eventType?.dataset.adaptiveChoiceMode).toBe("select");
    expect(metric("Included + ready")).toBe("0");

    await choose(eventType.querySelector("select"), "wedding");
    const category = choiceField("Apply one category to every row");
    expect(category?.dataset.adaptiveChoiceMode).toBe("single");
    expect(category.querySelector("select")).toBeNull();
    expect(category.querySelector('[data-adaptive-choice-value="entrees"]')?.textContent)
      .toContain("Entrees");

    expect(eventType.querySelector("select").value).toBe("wedding");
    expect(metric("Included + ready")).toBe("1");
    expect(metric("Included blockers")).toBe("0");
  });

  test("locks constant relationship choices while a catalog mutation is in flight", async () => {
    let resolveStage;
    catalogDraftService.stageCatalogImportDraft.mockImplementation(() => new Promise((resolve) => {
      resolveStage = resolve;
    }));
    await prepareMenuItemRelationships({
      eventTypes: [
        { id: "wedding", name: "Wedding" },
        { id: "corporate", name: "Corporate" }
      ],
      categories: [
        { id: "entrees", name: "Entrees", eventTypeId: "wedding" },
        { id: "desserts", name: "Desserts", eventTypeId: "wedding" }
      ]
    });
    const eventType = choiceField("Apply one event type to every row");
    await choose(eventType.querySelector("select"), "wedding");
    const category = choiceField("Apply one category to every row");
    await choose(category.querySelector("select"), "entrees");
    await click(button("Run server preflight"));

    await click(container.querySelector(".import-studio-foot .cta"));

    expect(container.querySelector('[data-mutation-state="submitting"]')).not.toBeNull();
    expect(choiceField("Apply one event type to every row").querySelector("select").disabled)
      .toBe(true);
    expect(choiceField("Apply one category to every row").querySelector("select").disabled)
      .toBe(true);

    await act(async () => {
      resolveStage({
        ok: true,
        status: "staged",
        importType: "menuItems",
        importBatchId: "catalog_batch_001",
        stagedCount: 1,
        skippedCount: 0
      });
      await Promise.resolve();
    });
    await settle();
  });

  test("scopes category zero, one, and many choices to the selected event type", async () => {
    await prepareMenuItemRelationships({
      eventTypes: [
        { id: "wedding", name: "Wedding" },
        { id: "corporate", name: "Corporate" },
        { id: "social", name: "Social" }
      ],
      categories: [
        { id: "boxed", name: "Boxed meals", eventTypeId: "corporate" },
        { id: "starters", name: "Starters", eventTypeId: "social" },
        { id: "desserts", name: "Desserts", eventTypeId: "social" }
      ]
    });
    const eventType = choiceField("Apply one event type to every row").querySelector("select");

    await choose(eventType, "wedding");
    expect(choiceField("Apply one category to every row")?.dataset.adaptiveChoiceMode)
      .toBe("empty");

    await choose(eventType, "corporate");
    let category = choiceField("Apply one category to every row");
    expect(category?.dataset.adaptiveChoiceMode).toBe("single");
    expect(category.querySelector('[data-adaptive-choice-value="boxed"]')).not.toBeNull();

    await choose(eventType, "social");
    category = choiceField("Apply one category to every row");
    expect(category?.dataset.adaptiveChoiceMode).toBe("select");
    expect([...category.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "",
      "starters",
      "desserts"
    ]);
  });

  test("does not render a confirmed receipt when the customer session boundary resolves a failed result", async () => {
    batchService.createCustomerImportSession.mockResolvedValue({
      ok: false,
      status: "failed",
      importType: "customers",
      importBatchId: "customer_session_001",
      error: "A child batch did not return an accepted receipt."
    });
    mount();
    await uploadCsv("Name,Email\nMaya Bennett,maya@example.test\n", "customers.csv");
    await click(button("Run server preflight"));

    await click(container.querySelector(".import-studio-foot .cta"));

    expect(container.querySelector(".import-receipt")).toBeNull();
    expect(container.querySelector('[data-mutation-state="error"]')).not.toBeNull();
    expect(container.textContent).toContain("A child batch did not return an accepted receipt");
  });
});
