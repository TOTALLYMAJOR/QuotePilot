const PDF_RUNTIME_PATH = "/vendor/pdfjs-5.7.284/pdf.min.mjs";
const PDF_WORKER_PATH = "/vendor/pdfjs-5.7.284/pdf.worker.min.mjs";

export const MAX_PDF_PAGES = 80;
export const MAX_PDF_TEXT_CHARACTERS = 500_000;

export class PdfImportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PdfImportError";
    this.code = code;
    this.details = details;
  }
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizedMoney(value = "") {
  const source = String(value || "").replace(/[\s$,]/g, "").replace(/^\((.+)\)$/, "-$1");
  if (!source || !/^-?\d+(?:\.\d{1,2})?$/.test(source)) return "";
  const parsed = Number(source);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "";
}

function looksLikeMoneyToken(value = "") {
  const source = cleanText(value);
  return /^\$\s*\d[\d,]*(?:\.\d{1,2})?$/.test(source)
    || /^\d[\d,]*\.\d{2}$/.test(source);
}

function looksLikeHeading(value = "") {
  const source = cleanText(value);
  if (source.length < 2 || source.length > 80) return false;
  if (!/[A-Za-z]/.test(source) || looksLikeMoneyToken(source)) return false;
  if (/^(page\s+)?\d+(\s+of\s+\d+)?$/i.test(source)) return false;
  if (/^(name|item|description|price|cost|rate|amount|menu item)(\s+.*)?$/i.test(source)) return false;
  const words = source.split(/\s+/);
  return words.length <= 8 && !/[.!?]$/.test(source);
}

export function groupPdfTextItems(items = [], pageNumber = 1) {
  const spans = (Array.isArray(items) ? items : [])
    .map((item) => ({
      text: cleanText(item?.str),
      x: Number(item?.transform?.[4] || 0),
      y: Number(item?.transform?.[5] || 0),
      width: Math.max(0, Number(item?.width || 0)),
      height: Math.max(1, Number(item?.height || Math.abs(item?.transform?.[3] || 0) || 10))
    }))
    .filter((item) => item.text);
  const lines = [];
  spans
    .sort((left, right) => Math.abs(right.y - left.y) > 2 ? right.y - left.y : left.x - right.x)
    .forEach((span) => {
      let line = lines.find((candidate) => Math.abs(candidate.y - span.y) <= Math.max(2, span.height * 0.28));
      if (!line) {
        line = { pageNumber, y: span.y, spans: [] };
        lines.push(line);
      }
      line.spans.push(span);
    });
  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => {
      const ordered = line.spans.sort((left, right) => left.x - right.x);
      const columns = [];
      let current = "";
      let previousEnd = null;
      ordered.forEach((span) => {
        const gap = previousEnd === null ? 0 : span.x - previousEnd;
        if (current && gap > Math.max(14, span.height * 1.4)) {
          columns.push(cleanText(current));
          current = span.text;
        } else {
          current = `${current}${current ? " " : ""}${span.text}`;
        }
        previousEnd = Math.max(previousEnd ?? span.x, span.x + span.width);
      });
      if (current) columns.push(cleanText(current));
      return {
        pageNumber,
        text: cleanText(columns.join("  ")),
        columns: columns.filter(Boolean)
      };
    })
    .filter((line) => line.text);
}

function priceParts(line = {}) {
  const columns = Array.isArray(line.columns) ? line.columns : [];
  const pricedColumns = columns
    .map((value, index) => ({ value, index, money: normalizedMoney(value) }))
    .filter((entry) => entry.money && looksLikeMoneyToken(entry.value));
  if (pricedColumns.length) {
    const first = pricedColumns[0];
    const name = cleanText(columns.slice(0, first.index).join(" "));
    return {
      name,
      price: first.money,
      cost: pricedColumns[1]?.money || ""
    };
  }
  const source = cleanText(line.text);
  const matches = [...source.matchAll(/\$\s*\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*\.\d{2}\b/g)];
  if (!matches.length) return null;
  const first = matches[0];
  return {
    name: cleanText(source.slice(0, first.index).replace(/[.·•\-–—\s]+$/, "")),
    price: normalizedMoney(first[0]),
    cost: matches[1] ? normalizedMoney(matches[1][0]) : ""
  };
}

export function buildPdfImportTable({ pages = [], fileName = "document.pdf" } = {}) {
  const lines = pages.flatMap((page) => Array.isArray(page?.lines) ? page.lines : []);
  const pricedRows = [];
  let currentSection = "";
  lines.forEach((line) => {
    const parts = priceParts(line);
    if (parts?.name && parts.price) {
      pricedRows.push({
        pageNumber: line.pageNumber,
        values: {
          Name: parts.name,
          Price: parts.price,
          Cost: parts.cost,
          "Menu section": currentSection,
          "Source page": String(line.pageNumber),
          "Source excerpt": cleanText(line.text).slice(0, 240)
        }
      });
      return;
    }
    if (looksLikeHeading(line.text)) currentSection = cleanText(line.text);
  });

  const fallbackRows = pricedRows.length ? [] : lines
    .filter((line) => /[A-Za-z]/.test(line.text) && !/^(page\s+)?\d+(\s+of\s+\d+)?$/i.test(line.text))
    .map((line) => ({
      pageNumber: line.pageNumber,
      values: {
        Name: cleanText(line.text),
        "Source page": String(line.pageNumber),
        "Source excerpt": cleanText(line.text).slice(0, 240)
      }
    }));
  const inferred = (pricedRows.length ? pricedRows : fallbackRows).slice(0, 1_500);
  const headers = pricedRows.length
    ? ["Name", "Price", "Cost", "Menu section", "Source page", "Source excerpt"]
    : ["Name", "Source page", "Source excerpt"];
  return {
    headers,
    rows: inferred.map((row, index) => ({
      rowNumber: index + 1,
      sourceLocator: { kind: "pdf", page: row.pageNumber, excerpt: row.values["Source excerpt"] },
      values: row.values
    })),
    detectedImportType: pricedRows.length && pricedRows.some((row) => row.values["Menu section"])
      ? "menuItems"
      : pricedRows.length ? "addons" : "eventTypes",
    diagnostics: [
      {
        severity: "warning",
        code: pricedRows.length ? "pdf_price_rows_inferred" : "pdf_list_rows_inferred",
        message: pricedRows.length
          ? `QuotePilot inferred ${pricedRows.length} priced row(s). Confirm the record type, headings, prices, and relationships before preflight.`
          : `QuotePilot inferred ${fallbackRows.length} text row(s). Confirm which lines are real records before preflight.`
      },
      ...(inferred.length < (pricedRows.length ? pricedRows.length : fallbackRows.length)
        ? [{ severity: "warning", code: "pdf_row_limit", message: "Only the first 1,500 inferred PDF rows were staged for review." }]
        : [])
    ],
    source: {
      kind: "pdf",
      fileName,
      pageCount: pages.length,
      inferredRowCount: inferred.length,
      extractionMethod: "searchable_text_geometry"
    }
  };
}

async function defaultPdfDocumentLoader(data) {
  const origin = globalThis.location?.origin || globalThis.document?.baseURI;
  if (!origin) throw new Error("A browser origin is required to load the PDF inspection runtime.");
  const runtimeUrl = new URL(PDF_RUNTIME_PATH, origin).href;
  const workerUrl = new URL(PDF_WORKER_PATH, origin).href;
  const pdfjs = await import(/* @vite-ignore */ runtimeUrl);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs.getDocument({ data }).promise;
}

export async function extractSearchablePdf(file, { loadPdfDocument = defaultPdfDocumentLoader } = {}) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new PdfImportError("pdf_missing", "Choose a searchable PDF file.");
  }
  let document;
  try {
    document = await loadPdfDocument(new Uint8Array(await file.arrayBuffer()));
    if (!document || !Number.isSafeInteger(Number(document.numPages))) {
      throw new Error("The PDF reader did not return a valid document.");
    }
    if (document.numPages > MAX_PDF_PAGES) {
      throw new PdfImportError(
        "pdf_page_limit",
        `PDF imports are limited to ${MAX_PDF_PAGES} pages so every extracted record can be reviewed.`
      );
    }
    const pages = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = groupPdfTextItems(content?.items, pageNumber);
      characterCount += lines.reduce((sum, line) => sum + line.text.length, 0);
      if (characterCount > MAX_PDF_TEXT_CHARACTERS) {
        throw new PdfImportError(
          "pdf_text_limit",
          "This PDF contains too much text for a safe interactive review. Split it into smaller catalog sections."
        );
      }
      pages.push({ pageNumber, lines });
    }
    if (characterCount === 0) {
      throw new PdfImportError(
        "pdf_not_searchable",
        "No usable text layer was found. Export a searchable PDF; scanned or image-only PDFs are not imported in this release."
      );
    }
    const table = buildPdfImportTable({ pages, fileName: file.name });
    if (!table.rows.length) {
      throw new PdfImportError(
        "pdf_no_records",
        "Text was found, but no reviewable catalog records could be inferred. Use CSV or split the PDF into a simpler list."
      );
    }
    return {
      ...table,
      source: { ...table.source, textCharacterCount: characterCount }
    };
  } catch (error) {
    if (error instanceof PdfImportError) throw error;
    const message = String(error?.message || "");
    if (/password|encrypted/i.test(message)) {
      throw new PdfImportError(
        "pdf_protected",
        "This PDF is password-protected. Export an unlocked searchable copy before importing."
      );
    }
    throw new PdfImportError(
      "pdf_read_failed",
      `The PDF could not be inspected: ${message || "the file may be damaged or unsupported."}`
    );
  } finally {
    await document?.destroy?.().catch?.(() => undefined);
  }
}
