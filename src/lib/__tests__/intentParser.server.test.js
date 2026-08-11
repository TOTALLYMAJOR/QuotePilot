import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  INTENT_PARSER_FACT_FIELDS,
  normalizeIntentParserConfig,
  sanitizeIntentParseRequest,
  buildIntentParserPrompt,
  buildProviderRequest,
  extractProviderText,
  validateParsedFacts
} = require("../intentParserCore.cjs");

describe("intent parser configuration gate", () => {
  test("is disabled with provider none by default, and rejects unknown providers back to none", () => {
    expect(normalizeIntentParserConfig({})).toMatchObject({ enabled: false, provider: "none" });
    expect(normalizeIntentParserConfig({
      INTENT_PARSER_ENABLED: "true",
      INTENT_PARSER_PROVIDER: "skynet"
    })).toMatchObject({ enabled: true, provider: "none" });
  });

  test("selects openai and anthropic with per-provider default models, overridable", () => {
    expect(normalizeIntentParserConfig({
      INTENT_PARSER_ENABLED: "true",
      INTENT_PARSER_PROVIDER: "anthropic"
    })).toEqual({ enabled: true, provider: "anthropic", model: "claude-haiku-4-5-20251001" });
    expect(normalizeIntentParserConfig({
      INTENT_PARSER_ENABLED: "true",
      INTENT_PARSER_PROVIDER: "openai",
      INTENT_PARSER_MODEL: "gpt-5"
    })).toEqual({ enabled: true, provider: "openai", model: "gpt-5" });
  });
});

describe("intent parse request and provider plumbing", () => {
  test("bounds intake text and rejects too-short input with a definitive code", () => {
    expect(sanitizeIntentParseRequest({ text: `  Corporate dinner for 80. ${"x".repeat(5000)}` }).text)
      .toHaveLength(4000);
    expect(() => sanitizeIntentParseRequest({ text: "hi" })).toThrow(/sentence or two/);
  });

  test("builds provider-correct requests without ever reading the environment itself", () => {
    const prompt = buildIntentParserPrompt("Dinner for 80 on 2027-09-12.");
    expect(prompt).toContain("STRICT JSON");
    const openai = buildProviderRequest({ provider: "openai", model: "gpt-5-mini", prompt, apiKey: "k1" });
    expect(openai.url).toContain("api.openai.com");
    expect(openai.headers.authorization).toBe("Bearer k1");
    const anthropic = buildProviderRequest({ provider: "anthropic", model: "claude-haiku-4-5-20251001", prompt, apiKey: "k2" });
    expect(anthropic.url).toContain("api.anthropic.com");
    expect(anthropic.headers["x-api-key"]).toBe("k2");
    expect(() => buildProviderRequest({ provider: "none", model: "", prompt, apiKey: "" }))
      .toThrow(/not configured/);
  });

  test("extracts reply text per provider shape", () => {
    expect(extractProviderText("openai", { choices: [{ message: { content: '{"facts":[]}' } }] }))
      .toBe('{"facts":[]}');
    expect(extractProviderText("anthropic", { content: [{ type: "text", text: '{"facts":[]}' }] }))
      .toBe('{"facts":[]}');
  });
});

describe("model output validation — untrusted input discipline", () => {
  test("forces every surviving fact to low confidence with a model source, allowlisting fields", () => {
    const { facts, notes } = validateParsedFacts(JSON.stringify({
      facts: [
        { field: "guests", value: "120", confidence: "high" },
        { field: "apiKey", value: "steal-me" },
        { field: "date", value: "2027-09-12" }
      ],
      notes: ["They also mentioned a live band."]
    }));
    expect(facts.map((fact) => fact.field)).toEqual(["guests", "date"]);
    expect(facts.every((fact) => fact.confidence === "low" && fact.source === "model")).toBe(true);
    expect(notes).toEqual(["They also mentioned a live band."]);
    expect(INTENT_PARSER_FACT_FIELDS).not.toContain("apiKey");
  });

  test("unreadable model output extracts nothing rather than guessing", () => {
    expect(validateParsedFacts("Sure! Here are the facts: guests=120")).toEqual({
      facts: [],
      notes: ["The model reply was not readable; nothing was extracted."]
    });
  });
});
