import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { exportQuoteProposal } from "../proposalExport";
import { PRODUCT_FULL_NAME } from "../productIdentity";
import { proposalPayloadFixtureQuote } from "./fixtures/proposalPayloadFixture";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

function versionedDraft() {
  return {
    ...proposalPayloadFixtureQuote,
    id: "quote-a",
    organizationId: "org-a",
    status: "draft",
    portalKey: "0123456789abcdef0123456789abcdef",
    expiresAtISO: "2027-04-09T15:30:00.000Z",
    portalExpiresAtISO: "2027-04-09T15:30:00.000Z",
    activeVersionId: "v0002",
    latestVersionNumber: 2,
    versionMeta: {
      versionId: "v0002",
      versionNumber: 2,
      createdAt: "2026-08-03T18:00:00.000Z"
    },
    updatedAtISO: "2026-08-03T18:00:00.000Z",
    quoteMeta: {
      ...proposalPayloadFixtureQuote.quoteMeta,
      brandLogoUrl: "",
      brandCrew: []
    }
  };
}

describe("customer proposal PDF export", () => {
  test("produces deterministic compact bytes for one saved quote revision", async () => {
    const quote = versionedDraft();
    const options = {
      basePortalUrl: "https://quotepilot.example/app",
      output: "base64",
      compact: true
    };

    const first = await exportQuoteProposal(quote, options);
    const repeated = await exportQuoteProposal(quote, options);

    expect(first.base64).toBe(repeated.base64);
    expect(first.filename).toBe(repeated.filename);
  });

  test("keeps a draft download from exposing an unusable portal URL or key", async () => {
    const attachment = await exportQuoteProposal(versionedDraft(), {
      basePortalUrl: "https://quotepilot.example/app",
      output: "base64",
      compact: false
    });
    const pdfText = Buffer.from(attachment.base64, "base64").toString("latin1");

    expect(pdfText).not.toContain("Customer Portal");
    expect(pdfText).not.toContain("https://quotepilot.example/app?portal=");
    expect(pdfText).not.toContain("0123456789abcdef0123456789abcdef");
  });

  test("requires an explicit current-delivery decision before including a sent portal", async () => {
    const sentQuote = {
      ...versionedDraft(),
      status: "sent"
    };
    const blocked = await exportQuoteProposal(sentQuote, {
      basePortalUrl: "https://quotepilot.example/app",
      output: "base64",
      compact: false
    });
    const blockedText = Buffer.from(blocked.base64, "base64").toString("latin1");
    expect(blockedText).not.toContain("https://quotepilot.example/app?portal=");
    expect(blockedText).not.toContain("0123456789abcdef0123456789abcdef");

    const allowed = await exportQuoteProposal(sentQuote, {
      basePortalUrl: "https://quotepilot.example/app",
      output: "base64",
      compact: false,
      includePortalLink: true
    });
    const allowedText = Buffer.from(allowed.base64, "base64").toString("latin1");
    expect(allowedText).toContain("https://quotepilot.example/app?portal=");
  });

  test("real PDF extraction preserves tenant branding and exact product attribution without internals", async () => {
    const quote = {
      ...versionedDraft(),
      quoteMeta: {
        ...versionedDraft().quoteMeta,
        brandName: "",
        organizationName: "Northstar Catering",
        pricingSettingsVersion: 91
      },
      selection: {
        ...versionedDraft().selection,
        taxRegion: "internal-tax-region-id",
        seasonProfileId: "peak-season-token",
        staffingRateTypeId: "staff-rate-secret",
        bartenderRateTypeId: "bar-rate-secret",
        serverRateMixCsv: "31,33,35",
        chefRateMixCsv: "41,43"
      },
      totals: {
        ...versionedDraft().totals,
        taxRegionId: "internal-tax-region-id",
        seasonProfileId: "peak-season-token",
        staffingRateTypeId: "staff-rate-secret",
        bartenderRateTypeId: "bar-rate-secret",
        serverRatesApplied: [31, 33, 35],
        chefRatesApplied: [41, 43]
      }
    };
    const attachment = await exportQuoteProposal(quote, {
      output: "base64",
      compact: true
    });
    const extracted = await pdfParse(Buffer.from(attachment.base64, "base64"));

    expect(extracted.text).toContain("Northstar Catering");
    expect(extracted.text).toContain("Staffing team");
    expect(extracted.text).toContain(`Created with ${PRODUCT_FULL_NAME}`);
    for (const forbidden of [
      "quote-a",
      "org-a",
      "v0002",
      "pricingSettingsVersion",
      "internal-tax-region-id",
      "peak-season-token",
      "staff-rate-secret",
      "bar-rate-secret",
      "31,33,35",
      "41,43",
      "Catering proposal generator"
    ]) {
      expect(extracted.text).not.toContain(forbidden);
    }
    expect(String(extracted.info?.Creator || "")).toBe(PRODUCT_FULL_NAME);
    expect(String(extracted.info?.Author || "")).toBe("Alex Rivera");
  });
});
