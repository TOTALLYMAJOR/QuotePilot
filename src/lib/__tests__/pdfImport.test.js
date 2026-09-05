import { describe, expect, test, vi } from "vitest";

import {
  PdfImportError,
  buildPdfImportTable,
  extractSearchablePdf,
  groupPdfTextItems
} from "../pdfImport";

function textItem(str, x, y, width = 48, height = 10) {
  return { str, width, height, transform: [1, 0, 0, height, x, y] };
}

function pdfFile(name = "menu.pdf") {
  return {
    name,
    async arrayBuffer() {
      return new Uint8Array([37, 80, 68, 70]).buffer;
    }
  };
}

describe("searchable PDF geometry", () => {
  test("groups nearby spans into ordered lines while retaining separated columns", () => {
    const lines = groupPdfTextItems([
      textItem("$8.25", 385, 660, 40),
      textItem("Chicken", 77, 660, 52),
      textItem("Entrees", 40, 700, 48),
      textItem("$24.00", 300, 660, 48),
      textItem("Roast", 40, 660, 32)
    ], 3);

    expect(lines).toEqual([
      { pageNumber: 3, text: "Entrees", columns: ["Entrees"] },
      {
        pageNumber: 3,
        text: "Roast Chicken $24.00 $8.25",
        columns: ["Roast Chicken", "$24.00", "$8.25"]
      }
    ]);
  });

  test("turns priced lines into review rows with their section and exact page provenance", () => {
    const lines = groupPdfTextItems([
      textItem("Entrees", 40, 700, 48),
      textItem("Roast chicken", 40, 660, 96),
      textItem("$24.00", 300, 660, 48),
      textItem("$8.25", 385, 660, 40)
    ], 3);
    const table = buildPdfImportTable({ pages: [{ pageNumber: 3, lines }], fileName: "fall-menu.pdf" });

    expect(table.detectedImportType).toBe("menuItems");
    expect(table.headers).toEqual(["Name", "Price", "Cost", "Menu section", "Source page", "Source excerpt"]);
    expect(table.rows).toEqual([
      expect.objectContaining({
        rowNumber: 1,
        sourceLocator: {
          kind: "pdf",
          page: 3,
          excerpt: "Roast chicken $24.00 $8.25"
        },
        values: expect.objectContaining({
          Name: "Roast chicken",
          Price: "24",
          Cost: "8.25",
          "Menu section": "Entrees",
          "Source page": "3",
          "Source excerpt": "Roast chicken $24.00 $8.25"
        })
      })
    ]);
    expect(table.diagnostics).toContainEqual(expect.objectContaining({ code: "pdf_price_rows_inferred" }));
  });

  test("preserves an inferred fallback name for normal field validation instead of clipping source truth", () => {
    const longName = `Chef station ${"seasonal selection ".repeat(12)}`.trim();
    expect(longName.length).toBeGreaterThan(160);
    const table = buildPdfImportTable({
      pages: [{
        pageNumber: 4,
        lines: [{ pageNumber: 4, text: longName, columns: [longName] }]
      }],
      fileName: "stations.pdf"
    });

    expect(table.rows[0].values.Name).toBe(longName);
    expect(table.rows[0].values.Name).toHaveLength(longName.length);
  });
});

describe("searchable PDF inspection boundary", () => {
  test("uses an injected reader and carries page provenance into every extracted row", async () => {
    const destroy = vi.fn(async () => undefined);
    const pageItems = new Map([
      [1, [
        textItem("Entrees", 40, 700, 48),
        textItem("Roast chicken platter", 40, 660, 138),
        textItem("$24.00", 300, 660, 48)
      ]],
      [2, [
        textItem("Desserts", 40, 700, 52),
        textItem("Chocolate layer cake", 40, 660, 134),
        textItem("$9.50", 300, 660, 40)
      ]]
    ]);
    const loadPdfDocument = vi.fn(async (data) => ({
      numPages: 2,
      getPage: vi.fn(async (pageNumber) => ({
        getTextContent: vi.fn(async () => ({ items: pageItems.get(pageNumber) }))
      })),
      destroy
    }));

    const result = await extractSearchablePdf(pdfFile("banquet-menu.pdf"), { loadPdfDocument });

    expect(loadPdfDocument).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(result.source).toMatchObject({
      kind: "pdf",
      fileName: "banquet-menu.pdf",
      pageCount: 2,
      inferredRowCount: 2,
      extractionMethod: "searchable_text_geometry"
    });
    expect(result.rows.map(({ sourceLocator }) => sourceLocator)).toEqual([
      {
        kind: "pdf",
        page: 1,
        excerpt: "Roast chicken platter $24.00"
      },
      {
        kind: "pdf",
        page: 2,
        excerpt: "Chocolate layer cake $9.50"
      }
    ]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  test("accepts a short searchable text layer and lets record inference decide usability", async () => {
    const result = await extractSearchablePdf(pdfFile("tea.pdf"), {
      loadPdfDocument: vi.fn(async () => ({
        numPages: 1,
        getPage: vi.fn(async () => ({
          getTextContent: vi.fn(async () => ({ items: [textItem("Tea", 40, 700, 20)] }))
        })),
        destroy: vi.fn(async () => undefined)
      }))
    });

    expect(result.source.textCharacterCount).toBe(3);
    expect(result.rows[0].values.Name).toBe("Tea");
  });

  test("rejects an image-only document before presenting an import attempt", async () => {
    const destroy = vi.fn(async () => undefined);
    const loadPdfDocument = vi.fn(async () => ({
      numPages: 1,
      getPage: vi.fn(async () => ({
        getTextContent: vi.fn(async () => ({ items: [] }))
      })),
      destroy
    }));

    await expect(extractSearchablePdf(pdfFile("scan.pdf"), { loadPdfDocument }))
      .rejects.toEqual(expect.objectContaining({
        name: "PdfImportError",
        code: "pdf_not_searchable",
        message: expect.stringMatching(/scanned or image-only PDFs are not imported/i)
      }));
    expect(destroy).toHaveBeenCalledOnce();
  });

  test("blocks oversized and protected PDFs with distinct recovery reasons", async () => {
    const destroy = vi.fn(async () => undefined);
    await expect(extractSearchablePdf(pdfFile("catalog-book.pdf"), {
      loadPdfDocument: vi.fn(async () => ({ numPages: 81, destroy }))
    })).rejects.toMatchObject({
      name: "PdfImportError",
      code: "pdf_page_limit",
      message: expect.stringContaining("limited to 80 pages")
    });
    expect(destroy).toHaveBeenCalledOnce();

    await expect(extractSearchablePdf(pdfFile("protected.pdf"), {
      loadPdfDocument: vi.fn(async () => {
        throw new Error("PasswordException: No password given");
      })
    })).rejects.toMatchObject({
      name: "PdfImportError",
      code: "pdf_protected",
      message: expect.stringContaining("password-protected")
    });
  });

  test("exposes a typed PDF error contract", () => {
    expect(new PdfImportError("pdf_test", "Review this PDF.")).toMatchObject({
      name: "PdfImportError",
      code: "pdf_test",
      message: "Review this PDF.",
      details: {}
    });
  });
});
