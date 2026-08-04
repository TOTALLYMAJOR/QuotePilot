import { describe, expect, test } from "vitest";
import { resolveQuoteDeliveryRevisionId } from "../commerceOps";

describe("quote delivery client identity", () => {
  test("matches the server version and portal issuance contract", () => {
    expect(resolveQuoteDeliveryRevisionId({
      activeVersionId: "v0002",
      portalIssuedAtISO: "2026-08-03T18:00:00-05:00",
      portalKey: "portal-key-abcdefghijklmnopqrstuvwxyz"
    })).toBe("v0002@2026-08-03T23:00:00.000Z");
  });

  test("changes when the portal rotates without changing quote content", () => {
    const quote = {
      activeVersionId: "v0002",
      portalIssuedAtISO: "2026-08-03T18:00:00.000Z",
      portalKey: "portal-key-before-abcdefghijklmnopqrstuvwxyz"
    };
    expect(resolveQuoteDeliveryRevisionId(quote)).not.toBe(
      resolveQuoteDeliveryRevisionId({
        ...quote,
        portalIssuedAtISO: "2026-08-03T19:00:00.000Z",
        portalKey: "portal-key-after-abcdefghijklmnopqrstuvwxyz"
      })
    );
  });

  test("falls back to the portal key and rejects unversioned drafts", () => {
    expect(resolveQuoteDeliveryRevisionId({
      latestVersionNumber: 3,
      portalIssuedAtISO: "not-a-date",
      portalKey: "portal-key-abcdefghijklmnopqrstuvwxyz"
    })).toBe("v0003@portal-key-abcdefghijklmnopqrstuvwxyz");
    expect(() => resolveQuoteDeliveryRevisionId({ portalKey: "portal-key" }))
      .toThrow(/versioned draft/i);
  });
});
