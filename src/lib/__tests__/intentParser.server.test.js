import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  INTENT_PARSER_AUTO_ROUTE,
  INTENT_PARSER_FACT_FIELDS,
  normalizeIntentParserConfig,
  normalizeIntentParserAutoRoute,
  sanitizeIntentParseRequest,
  buildIntentParserPrompt,
  buildIntentParserDemandProfile,
  buildIntentParserExecutionPlan,
  buildProviderRequest,
  extractProviderText,
  validateParsedFacts,
  summarizeIntentParserValidation,
  shouldRetryIntentParserAttempt
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

  test("supports auto routing with default or explicit candidate order", () => {
    expect(normalizeIntentParserConfig({
      INTENT_PARSER_ENABLED: "true",
      INTENT_PARSER_PROVIDER: "auto"
    })).toEqual({
      enabled: true,
      provider: "auto",
      model: "",
      routeCandidates: normalizeIntentParserAutoRoute(INTENT_PARSER_AUTO_ROUTE.join(","))
    });
    expect(normalizeIntentParserConfig({
      INTENT_PARSER_ENABLED: "true",
      INTENT_PARSER_PROVIDER: "auto",
      INTENT_PARSER_MODEL: "anthropic:claude-haiku-4-5-20251001, openai:gpt-5-mini"
    })).toEqual({
      enabled: true,
      provider: "auto",
      model: "",
      routeCandidates: [
        { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
        { provider: "openai", model: "gpt-5-mini" }
      ]
    });
  });

  test("fails closed when an explicit auto route contains no valid candidates", () => {
    expect(normalizeIntentParserConfig({
      INTENT_PARSER_ENABLED: "true",
      INTENT_PARSER_PROVIDER: "auto",
      INTENT_PARSER_MODEL: "unknown:model, auto:gpt-5-mini"
    })).toEqual({
      enabled: true,
      provider: "auto",
      model: "",
      routeCandidates: []
    });
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
    const openai = buildProviderRequest({
      provider: "openai",
      model: "gpt-5-mini",
      prompt,
      apiKey: "k1",
      completionTokenBudget: 220
    });
    expect(openai.url).toContain("api.openai.com");
    expect(openai.headers.authorization).toBe("Bearer k1");
    expect(openai.body.max_completion_tokens).toBe(220);
    const anthropic = buildProviderRequest({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      prompt,
      apiKey: "k2",
      completionTokenBudget: 360
    });
    expect(anthropic.url).toContain("api.anthropic.com");
    expect(anthropic.headers["x-api-key"]).toBe("k2");
    expect(anthropic.body.max_tokens).toBe(360);
    expect(() => buildProviderRequest({ provider: "none", model: "", prompt, apiKey: "" }))
      .toThrow(/not configured/);
  });

  test("extracts reply text per provider shape", () => {
    expect(extractProviderText("openai", { choices: [{ message: { content: '{"facts":[]}' } }] }))
      .toBe('{"facts":[]}');
    expect(extractProviderText("anthropic", { content: [{ type: "text", text: '{"facts":[]}' }] }))
      .toBe('{"facts":[]}');
  });

  test("profiles demand and builds an auto routing plan from available providers", () => {
    const demand = buildIntentParserDemandProfile(
      "Wedding for about 120 guests on 2027-09-12 at 18:30.\nNeed plated dinner, vegan notes, and 8 servers."
    );
    expect(demand.estimatedInputTokens).toBeGreaterThan(10);
    expect(["medium", "high"]).toContain(demand.complexity);
    expect(demand.completionTokenBudget).toBeGreaterThanOrEqual(360);

    const plan = buildIntentParserExecutionPlan({
      config: normalizeIntentParserConfig({
        INTENT_PARSER_ENABLED: "true",
        INTENT_PARSER_PROVIDER: "auto",
        INTENT_PARSER_MODEL: "anthropic:claude-haiku-4-5-20251001, openai:gpt-5-mini"
      }),
      intakeText: "Dinner for 80 on 2027-09-12, plated.",
      availableProviders: { openai: true, anthropic: false }
    });
    expect(plan.mode).toBe("auto");
    expect(plan.attempts).toEqual([{
      provider: "openai",
      model: "gpt-5-mini",
      completionTokenBudget: expect.any(Number)
    }]);
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

  test("classifies validated output for routing and retries only when bounded rules say so", () => {
    expect(summarizeIntentParserValidation(validateParsedFacts('{"facts":[{"field":"guests","value":"80"}]}')))
      .toEqual({ kind: "success", factCount: 1, noteCount: 0 });
    expect(summarizeIntentParserValidation(validateParsedFacts('{"facts":[],"notes":["Needs review"]}')))
      .toEqual({ kind: "notes_only", factCount: 0, noteCount: 1 });
    expect(summarizeIntentParserValidation(validateParsedFacts("not-json")))
      .toEqual({ kind: "unreadable", factCount: 0, noteCount: 1 });

    expect(shouldRetryIntentParserAttempt({
      demand: { signalCount: 4, complexity: "medium" },
      summary: { kind: "empty" },
      attemptIndex: 0,
      totalAttempts: 2
    })).toBe(true);
    expect(shouldRetryIntentParserAttempt({
      demand: { signalCount: 1, complexity: "low" },
      summary: { kind: "notes_only" },
      attemptIndex: 0,
      totalAttempts: 2
    })).toBe(false);
    expect(shouldRetryIntentParserAttempt({
      demand: { signalCount: 1, complexity: "low" },
      summary: { kind: "success" },
      attemptIndex: 0,
      totalAttempts: 2,
      providerFailed: true
    })).toBe(true);
  });
});
