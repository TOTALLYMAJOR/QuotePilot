import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import {
  BEO_ARTIFACT_PROVENANCE_DISCLAIMER,
  BEO_CANONICAL_SCHEMA_VERSION,
  BEO_INPUT_SCHEMA_VERSION
} from "../beoArtifactFingerprint";
import { exportKitchenBeo } from "../beoExport";
import { COMMERCIAL_DEPENDENCY_GRAPH_V1 } from "../commercialDependencyGraph";
import { proposalPayloadFixtureQuote } from "./fixtures/proposalPayloadFixture";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

function pdfQuote(overrides = {}) {
  return {
    ...proposalPayloadFixtureQuote,
    activeVersionId: "v0014",
    latestVersionNumber: 14,
    versionMeta: {
      versionId: "v0014",
      versionNumber: 14,
      createdAt: "2026-08-09T14:30:00.000Z"
    },
    ...overrides
  };
}

function normalizePdfText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

describe("Kitchen BEO PDF provenance", () => {
  test("renders the full dependency digest, schemas, graph, exact source, and proof boundary", async () => {
    const attachment = await exportKitchenBeo(pdfQuote(), { output: "base64" });
    const extracted = await pdfParse(Buffer.from(attachment.base64, "base64"));
    const pdfText = normalizePdfText(extracted.text);
    const digest = pdfText.match(/Dependency fingerprint:\s*sha256:([a-f0-9]{64})/i)?.[1];

    expect(Object.keys(attachment).sort()).toEqual(["base64", "filename", "mimeType"]);
    expect(attachment.mimeType).toBe("application/pdf");
    expect(attachment.filename).toContain("rev14-kitchen-beo.pdf");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(pdfText).toMatch(/Commercial source revision:\s*v0014/);
    expect(pdfText).toMatch(/Source revision created:\s*2026-08-09T14:30:00\.000Z/);
    expect(pdfText).toMatch(new RegExp(
      `Graph:\\s*${COMMERCIAL_DEPENDENCY_GRAPH_V1.graphId} · ${COMMERCIAL_DEPENDENCY_GRAPH_V1.graphVersion}`
    ));
    expect(pdfText).toMatch(new RegExp(`Input schema:\\s*${BEO_INPUT_SCHEMA_VERSION}`));
    expect(pdfText).toMatch(new RegExp(`Canonical schema:\\s*${BEO_CANONICAL_SCHEMA_VERSION}`));
    expect(pdfText).toContain(BEO_ARTIFACT_PROVENANCE_DISCLAIMER);
    expect(pdfText).not.toContain("generation receipt");
    expect(pdfText).not.toContain("trusted generation");
    expect(pdfText).not.toContain("STATUS: STALE");
    expect(pdfText).not.toContain("STATUS: CURRENT");
  });

  test("keeps mismatched version metadata from supplying source time", async () => {
    const attachment = await exportKitchenBeo(pdfQuote({
      activeVersionId: "v0015",
      latestVersionNumber: 15,
      versionMeta: {
        versionId: "v0014",
        versionNumber: 14,
        createdAt: "2026-08-09T14:30:00.000Z"
      }
    }), { output: "base64" });
    const extracted = await pdfParse(Buffer.from(attachment.base64, "base64"));
    const pdfText = normalizePdfText(extracted.text);

    expect(pdfText).toMatch(/Commercial source revision:\s*v0015/);
    expect(pdfText).not.toContain("Source revision created:");
    expect(pdfText).not.toContain("2026-08-09T14:30:00.000Z");
  });
});
