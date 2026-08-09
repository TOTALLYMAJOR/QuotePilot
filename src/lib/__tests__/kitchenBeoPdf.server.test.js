import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
const {
  buildKitchenBeoPdfFilename,
  renderKitchenBeoPdf
} = require("../../../functions/kitchenBeoPdf.js");

function payload(overrides = {}) {
  return {
    organizationName: "Northstar Catering",
    quoteNumber: "QP-2042",
    version: { id: "v0014", number: 14 },
    event: {
      name: "Henderson corporate picnic",
      date: "2026-08-16",
      time: "5:30 PM",
      venue: "Railroad Park",
      venueAddress: "1600 1st Ave S, Birmingham, AL",
      guests: 175,
      hours: 4,
      style: "buffet",
      dietaryRestrictions: "12 vegetarian; 2 nut allergies"
    },
    contacts: {
      clientName: "Jordan Henderson",
      clientPhone: "205-555-0142"
    },
    staffing: {
      staffLead: "Avery Cook",
      servers: 8,
      chefs: 3,
      bartenders: 2
    },
    selections: {
      packageName: "Corporate picnic service",
      menuItemNames: ["Smoked chicken", "Seasonal vegetables"],
      addons: ["Lemonade station"],
      rentals: ["Eight-foot buffet tables"]
    },
    checkpoints: [
      { id: "kitchen-ready", label: "Kitchen ready", time: "3:30 PM" }
    ],
    productionChecklist: [
      {
        group: "Cold prep",
        items: [
          { label: "Pack salads", completed: true },
          { label: "Load beverages", completed: false }
        ]
      }
    ],
    ...overrides
  };
}

function provenance(overrides = {}) {
  return {
    commercialSourceRevisionId: "v0014",
    dependencyFingerprint: "8a29b9f6f892483a5a9f86b3694a425a2e31cd585edaae881c0102726c012345",
    graphId: "commercial-dependency-graph",
    graphVersion: "commercial-dependency-graph-v1",
    requestId: "beo_request_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    generatedAtISO: "2026-08-09T18:42:00.000Z",
    ...overrides
  };
}

function normalizedPdfText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

describe("server Kitchen BEO PDF", () => {
  test("emits real PDF bytes with the exact trusted provenance and proof boundary", async () => {
    const artifact = renderKitchenBeoPdf({
      payload: payload(),
      provenance: provenance()
    });

    expect(artifact.mimeType).toBe("application/pdf");
    expect(artifact.filename).toBe("QP-2042-2026-08-16-rev14-kitchen-beo.pdf");
    expect(Buffer.isBuffer(artifact.bytes)).toBe(true);
    expect(artifact.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(artifact.bytes.byteLength).toBeGreaterThan(2_000);

    const extracted = await pdfParse(artifact.bytes);
    const pdfText = normalizedPdfText(extracted.text);
    expect(pdfText).toContain("KITCHEN BEO");
    expect(pdfText).toContain("Northstar Catering");
    expect(pdfText).toContain("Henderson corporate picnic");
    expect(pdfText).toContain("v0014");
    expect(pdfText).toContain(provenance().dependencyFingerprint);
    expect(pdfText).toContain(provenance().graphVersion);
    expect(pdfText).toContain(provenance().requestId);
    expect(pdfText).toContain(provenance().generatedAtISO);
    expect(pdfText).toContain(
      "This server receipt proves generation from the named canonical source"
    );
    expect(pdfText).toContain("It does not prove kitchen review");
  });

  test("sanitizes path-like filename inputs into one client-acceptable PDF basename", () => {
    const filename = buildKitchenBeoPdfFilename(payload({
      quoteNumber: "../../ACME / Q#42 ..",
      event: {
        ...payload().event,
        date: "../2026/08/09"
      }
    }));

    expect(filename).toMatch(/^[A-Za-z0-9_.-]+\.pdf$/u);
    expect(filename).not.toContain("/");
    expect(filename).not.toContain("\\");
    expect(filename).not.toContain("..");
    expect(filename).toMatch(/rev14-kitchen-beo\.pdf$/u);
  });

  test("fails closed without canonical payload or trusted provenance", () => {
    expect(() => renderKitchenBeoPdf({ provenance: provenance() }))
      .toThrow(/canonical Kitchen BEO payload is required/i);
    expect(() => renderKitchenBeoPdf({ payload: payload() }))
      .toThrow(/server Kitchen BEO provenance is required/i);
  });
});
