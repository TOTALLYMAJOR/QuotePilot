"use strict";

// Model-assisted intake lane (docs/INTENT_INTAKE_ADR.md; owner-approved
// 2026-08-11 with BOTH OpenAI and Anthropic as selectable providers).
// Server-owned and default-off twice over: INTENT_PARSER_ENABLED must be
// "true" AND INTENT_PARSER_PROVIDER must name a configured provider, and
// the provider key must exist, before a single provider call happens. The
// deterministic browser extractor remains the availability floor; this
// lane (mirrored into functions/ as its runtime twin at the integration
// slice, per the commercialDependencyGraphCore house pattern) only proposes REVIEWABLE facts (confidence is always forced to
// "low" so the CREATE canvas requires human confirmation), and it persists
// nothing — a stateless parse, never an authority.

const INTENT_PARSER_PROVIDERS = Object.freeze(["none", "openai", "anthropic", "auto"]);
const INTENT_PARSER_DEFAULT_MODELS = Object.freeze({
  openai: "gpt-5-mini",
  anthropic: "claude-haiku-4-5-20251001"
});
const INTENT_PARSER_AUTO_ROUTE = Object.freeze([
  `openai:${INTENT_PARSER_DEFAULT_MODELS.openai}`,
  `anthropic:${INTENT_PARSER_DEFAULT_MODELS.anthropic}`
]);
const INTENT_PARSER_OPENAI_KEY_NAME = "INTENT_PARSER_OPENAI_KEY";
const INTENT_PARSER_ANTHROPIC_KEY_NAME = "INTENT_PARSER_ANTHROPIC_KEY";
const INTENT_PARSER_MAX_TEXT_LENGTH = 4000;
const INTENT_PARSER_MAX_FACTS = 16;
const INTENT_PARSER_MAX_PROVIDER_ATTEMPTS = 2;
const INTENT_PARSER_UNREADABLE_NOTE = "The model reply was not readable; nothing was extracted.";
// Mirrors the deterministic extractor's fact fields (src/components/
// intentExtraction.js) so the CREATE canvas consumes both lanes identically.
const INTENT_PARSER_FACT_FIELDS = Object.freeze([
  "guests", "date", "time", "hours", "email", "phone", "style",
  "eventTypeId", "venue", "name", "eventName",
  "servers", "chefs", "bartenders", "dietaryRestrictions"
]);

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function parseIntentParserCandidate(candidate) {
  const normalized = text(candidate, 160).toLowerCase();
  if (!normalized) return null;
  const separator = normalized.includes(":") ? ":" : normalized.includes("/") ? "/" : "";
  const [providerToken, modelToken] = separator
    ? normalized.split(separator, 2)
    : [normalized, ""];
  if (!INTENT_PARSER_PROVIDERS.includes(providerToken) || providerToken === "none" || providerToken === "auto") {
    return null;
  }
  const model = text(modelToken, 120) || INTENT_PARSER_DEFAULT_MODELS[providerToken] || "";
  return model ? { provider: providerToken, model } : null;
}

function normalizeIntentParserAutoRoute(raw) {
  const source = String(raw || "").trim();
  const parsed = source
    .split(",")
    .map((candidate) => parseIntentParserCandidate(candidate))
    .filter(Boolean);
  const route = source
    ? parsed
    : INTENT_PARSER_AUTO_ROUTE
      .map((candidate) => parseIntentParserCandidate(candidate))
      .filter(Boolean);
  const deduped = [];
  const seen = new Set();
  route.forEach((candidate) => {
    const key = `${candidate.provider}:${candidate.model}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(candidate);
  });
  return deduped;
}

function normalizeIntentParserConfig(env = {}) {
  const enabled = String(env.INTENT_PARSER_ENABLED || "").trim().toLowerCase() === "true";
  const requestedProvider = String(env.INTENT_PARSER_PROVIDER || "none").trim().toLowerCase();
  const provider = INTENT_PARSER_PROVIDERS.includes(requestedProvider) ? requestedProvider : "none";
  const rawModel = text(env.INTENT_PARSER_MODEL, 400);
  if (provider === "auto") {
    return {
      enabled,
      provider,
      model: "",
      routeCandidates: normalizeIntentParserAutoRoute(rawModel || env.INTENT_PARSER_AUTO_ROUTE || "")
    };
  }
  const model = text(rawModel, 120) || INTENT_PARSER_DEFAULT_MODELS[provider] || "";
  return { enabled, provider, model };
}

function sanitizeIntentParseRequest(data = {}) {
  const intakeText = text(data.text, INTENT_PARSER_MAX_TEXT_LENGTH);
  if (intakeText.length < 8) {
    const error = new Error("Describe the event in a sentence or two before parsing.");
    error.code = "invalid-argument";
    throw error;
  }
  return { text: intakeText };
}

function buildIntentParserPrompt(intakeText) {
  return [
    "You extract catering-event facts from one freeform intake message.",
    "Reply with STRICT JSON only — no prose, no markdown fences — shaped:",
    '{"facts":[{"field":"guests","value":"120"}],"notes":["unparsed remainder"]}',
    `Allowed field values: ${INTENT_PARSER_FACT_FIELDS.join(", ")}.`,
    "Rules: only facts literally present in the message; value is a short",
    "string; dates as YYYY-MM-DD; times as HH:MM 24h; never guess or",
    "invent; put anything uncertain in notes instead of facts.",
    "Message:",
    intakeText
  ].join("\n");
}

function buildIntentParserDemandProfile(intakeText) {
  const message = text(intakeText, INTENT_PARSER_MAX_TEXT_LENGTH);
  const estimatedInputTokens = Math.max(1, Math.ceil(message.length / 4));
  const signalPatterns = [
    /\b\d{1,4}\s*(guests?|people|covers?)\b/iu,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/iu,
    /\b\d{4}-\d{2}-\d{2}\b/u,
    /\b\d{1,2}:\d{2}\b/u,
    /\b(?:plated|buffet|family style|cocktail)\b/iu,
    /\b(?:wedding|corporate|birthday|gala|shower|rehearsal)\b/iu,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    /\b(?:dietary|allerg(?:y|ies)|vegetarian|vegan|halal|kosher)\b/iu,
    /\b(?:servers?|chefs?|bartenders?)\b/iu
  ];
  const signalCount = signalPatterns.reduce((count, pattern) => count + (pattern.test(message) ? 1 : 0), 0);
  let complexityScore = signalCount;
  if (message.length > 450) complexityScore += 2;
  if (message.length > 900) complexityScore += 2;
  if ((message.match(/\n/g) || []).length >= 2) complexityScore += 1;
  if (/\b(?:between|from)\b.+\b(?:and|to)\b/iu.test(message)) complexityScore += 1;
  if (/\b(?:about|around|approx(?:imately)?|roughly)\b/iu.test(message)) complexityScore += 1;
  const complexity = complexityScore >= 8 ? "high" : complexityScore >= 4 ? "medium" : "low";
  const completionTokenBudget = complexity === "low" ? 220 : complexity === "medium" ? 360 : 520;
  return {
    estimatedInputTokens,
    signalCount,
    complexity,
    completionTokenBudget
  };
}

function buildIntentParserExecutionPlan({ config = {}, intakeText = "", availableProviders = {} } = {}) {
  const demand = buildIntentParserDemandProfile(intakeText);
  if (config.provider && config.provider !== "auto") {
    return {
      mode: config.provider,
      demand,
      attempts: availableProviders[config.provider]
        ? [{
          provider: config.provider,
          model: config.model || INTENT_PARSER_DEFAULT_MODELS[config.provider] || "",
          completionTokenBudget: demand.completionTokenBudget
        }]
        : []
    };
  }
  const attempts = (Array.isArray(config.routeCandidates) ? config.routeCandidates : [])
    .filter((candidate) => availableProviders[candidate.provider])
    .slice(0, INTENT_PARSER_MAX_PROVIDER_ATTEMPTS)
    .map((candidate) => ({
      provider: candidate.provider,
      model: candidate.model,
      completionTokenBudget: demand.completionTokenBudget
    }));
  return {
    mode: "auto",
    demand,
    attempts
  };
}

// Pure request builders — the caller injects the key it read from the
// bound secret; this module never touches process.env itself.
function buildProviderRequest({ provider, model, prompt, apiKey, completionTokenBudget = 700 }) {
  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: {
        model,
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: completionTokenBudget
      }
    };
  }
  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: {
        model,
        max_tokens: completionTokenBudget,
        messages: [{ role: "user", content: prompt }]
      }
    };
  }
  const error = new Error("Intent parser provider is not configured.");
  error.code = "failed-precondition";
  throw error;
}

function extractProviderText(provider, responseJson = {}) {
  if (provider === "openai") {
    return text(responseJson?.choices?.[0]?.message?.content, 8000);
  }
  if (provider === "anthropic") {
    const blocks = Array.isArray(responseJson?.content) ? responseJson.content : [];
    return text(blocks.filter((b) => b?.type === "text").map((b) => b.text).join("\n"), 8000);
  }
  return "";
}

// The model's output is untrusted input: strict-JSON parse, field
// allowlist, bounded values, capped count — and every surviving fact is
// forced to low confidence with a "model" source label so the CREATE
// canvas demands human confirmation before anything touches the draft.
function validateParsedFacts(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawText || ""));
  } catch {
    return { facts: [], notes: [INTENT_PARSER_UNREADABLE_NOTE] };
  }
  const facts = (Array.isArray(parsed?.facts) ? parsed.facts : [])
    .filter((fact) => fact && typeof fact === "object"
      && INTENT_PARSER_FACT_FIELDS.includes(String(fact.field || "").trim()))
    .slice(0, INTENT_PARSER_MAX_FACTS)
    .map((fact, index) => {
      const field = String(fact.field).trim();
      const value = text(fact.value, 200);
      return {
        id: `model-${field}-${index}`,
        field,
        label: field,
        value,
        displayValue: value,
        confidence: "low",
        source: "model"
      };
    })
    .filter((fact) => Boolean(fact.value));
  const notes = (Array.isArray(parsed?.notes) ? parsed.notes : [])
    .map((note) => text(note, 300))
    .filter(Boolean)
    .slice(0, 8);
  return { facts, notes };
}

function summarizeIntentParserValidation(validated = {}) {
  const facts = Array.isArray(validated.facts) ? validated.facts : [];
  const notes = Array.isArray(validated.notes) ? validated.notes : [];
  if (!facts.length && notes.length === 1 && notes[0] === INTENT_PARSER_UNREADABLE_NOTE) {
    return { kind: "unreadable", factCount: 0, noteCount: 1 };
  }
  if (facts.length && notes.length) {
    return { kind: "partial", factCount: facts.length, noteCount: notes.length };
  }
  if (facts.length) {
    return { kind: "success", factCount: facts.length, noteCount: 0 };
  }
  if (notes.length) {
    return { kind: "notes_only", factCount: 0, noteCount: notes.length };
  }
  return { kind: "empty", factCount: 0, noteCount: 0 };
}

function shouldRetryIntentParserAttempt({
  demand = {},
  summary = {},
  attemptIndex = 0,
  totalAttempts = 0,
  providerFailed = false
} = {}) {
  if (attemptIndex + 1 >= totalAttempts) return false;
  if (providerFailed) return true;
  if (summary.kind === "unreadable") return true;
  if (summary.kind === "empty") return Number(demand.signalCount || 0) >= 3;
  if (summary.kind === "notes_only") return String(demand.complexity || "") !== "low";
  return false;
}

module.exports = {
  INTENT_PARSER_PROVIDERS,
  INTENT_PARSER_DEFAULT_MODELS,
  INTENT_PARSER_AUTO_ROUTE,
  INTENT_PARSER_OPENAI_KEY_NAME,
  INTENT_PARSER_ANTHROPIC_KEY_NAME,
  INTENT_PARSER_FACT_FIELDS,
  INTENT_PARSER_UNREADABLE_NOTE,
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
};
