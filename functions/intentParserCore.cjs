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

const INTENT_PARSER_PROVIDERS = Object.freeze(["none", "openai", "anthropic"]);
const INTENT_PARSER_DEFAULT_MODELS = Object.freeze({
  openai: "gpt-5-mini",
  anthropic: "claude-haiku-4-5-20251001"
});
const INTENT_PARSER_OPENAI_KEY_NAME = "INTENT_PARSER_OPENAI_KEY";
const INTENT_PARSER_ANTHROPIC_KEY_NAME = "INTENT_PARSER_ANTHROPIC_KEY";
const INTENT_PARSER_MAX_TEXT_LENGTH = 4000;
const INTENT_PARSER_MAX_FACTS = 16;
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

function normalizeIntentParserConfig(env = {}) {
  const enabled = String(env.INTENT_PARSER_ENABLED || "").trim().toLowerCase() === "true";
  const requestedProvider = String(env.INTENT_PARSER_PROVIDER || "none").trim().toLowerCase();
  const provider = INTENT_PARSER_PROVIDERS.includes(requestedProvider) ? requestedProvider : "none";
  const model = text(env.INTENT_PARSER_MODEL, 120)
    || INTENT_PARSER_DEFAULT_MODELS[provider]
    || "";
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

// Pure request builders — the caller injects the key it read from the
// bound secret; this module never touches process.env itself.
function buildProviderRequest({ provider, model, prompt, apiKey }) {
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
        max_completion_tokens: 700
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
        max_tokens: 700,
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
    return { facts: [], notes: ["The model reply was not readable; nothing was extracted."] };
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

module.exports = {
  INTENT_PARSER_PROVIDERS,
  INTENT_PARSER_DEFAULT_MODELS,
  INTENT_PARSER_OPENAI_KEY_NAME,
  INTENT_PARSER_ANTHROPIC_KEY_NAME,
  INTENT_PARSER_FACT_FIELDS,
  normalizeIntentParserConfig,
  sanitizeIntentParseRequest,
  buildIntentParserPrompt,
  buildProviderRequest,
  extractProviderText,
  validateParsedFacts
};
