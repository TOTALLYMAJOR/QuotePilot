import { describe, expect, test } from "vitest";
import { resolveQuoteCompletionCommandPathGate } from "../quoteCompletionGate";
import { DEFAULT_FEATURE_FLAGS, normalizeCatalog } from "../../data/mockCatalog";

describe("quote completion command path gate", () => {
  test("defaults both build and tenant controls off", () => {
    expect(DEFAULT_FEATURE_FLAGS.quoteCompletionCommandPath).toBe(false);
    expect(normalizeCatalog({ settings: {} }).settings.featureFlags.quoteCompletionCommandPath)
      .toBe(false);
    expect(resolveQuoteCompletionCommandPathGate()).toBe(false);
  });

  test("requires both an enabled build and an enabled tenant", () => {
    expect(resolveQuoteCompletionCommandPathGate({ buildValue: "true", tenantValue: false }))
      .toBe(false);
    expect(resolveQuoteCompletionCommandPathGate({ buildValue: "false", tenantValue: true }))
      .toBe(false);
    expect(resolveQuoteCompletionCommandPathGate({ buildValue: "true", tenantValue: true }))
      .toBe(true);
    expect(resolveQuoteCompletionCommandPathGate({ buildValue: "1", tenantValue: true }))
      .toBe(true);
  });
});
