"use strict";

const {
  STEWARD_POLICY_VERSION,
  normalizeStewardRequest
} = require("./contracts.cjs");

const ADMIN_ONLY_TASKS = new Set([
  "setup_menu",
  "configure_workflow",
  "guide_provider_setup"
]);

const SECRET_PATTERNS = Object.freeze([
  { code: "stripe_secret", pattern: /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{12,}\b/u },
  { code: "webhook_secret", pattern: /\bwhsec_[A-Za-z0-9]{12,}\b/u },
  { code: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { code: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}={0,2}\b/iu },
  { code: "generic_api_key", pattern: /\b(?:api[_ -]?key|client[_ -]?secret|webhook[_ -]?secret)\s*[:=]\s*\S{12,}/iu }
]);

const SENSITIVE_PERSONAL_PATTERNS = Object.freeze([
  { code: "allergy_or_health", pattern: /\b(?:allerg(?:y|ic|ies)|medical|diagnos(?:is|ed)|health condition)\b/iu },
  { code: "disability_or_accommodation", pattern: /\b(?:disab(?:ility|led)|wheelchair|accommodation|accessibility need)\b/iu },
  { code: "religion", pattern: /\b(?:religion|religious|christian|jewish|muslim|hindu|buddhist|sikh)\b/iu },
  { code: "minor", pattern: /\b(?:minor|child|children|kid|kids|underage)\b/iu }
]);

const PROHIBITED_TACTIC_PATTERNS = Object.freeze([
  { code: "protected_trait_pricing", pattern: /\b(?:race|ethnicity|nationality|gender|sex|sexual orientation|pregnan(?:t|cy)|religion|disability)\b.{0,80}\b(?:price|charge|discount|margin|offer)\b/iu },
  { code: "vulnerability", pattern: /\b(?:vulnerab(?:le|ility)|desperate|easy target|pressure them|exploit)\b/iu },
  { code: "wealth_or_willingness", pattern: /\b(?:perceived wealth|looks wealthy|willingness to pay|maximum they will pay|charge them more)\b/iu },
  { code: "sentiment_or_personality", pattern: /\b(?:sentiment score|personality profile|emotionally weak|anxious client|difficult personality)\b/iu },
  { code: "fabricated_scarcity", pattern: /\b(?:fake scarcity|fabricate scarcity|pretend (?:we are|you are) booked|lie about availability)\b/iu },
  { code: "deception", pattern: /\b(?:mislead|deceive|make up a competitor|false competitor claim)\b/iu }
]);

const PROVIDER_MUTATION_PATTERNS = Object.freeze([
  { code: "provider_money_movement", pattern: /\b(?:create|issue|make|send|process)\b.{0,40}\b(?:charge|refund|payout|payment)\b/iu },
  { code: "provider_account_mutation", pattern: /\b(?:create|connect|delete|update)\b.{0,40}\b(?:stripe account|connected account|account link|provider object)\b/iu },
  { code: "provider_configuration", pattern: /\b(?:rotate|set|bind|replace|reveal)\b.{0,40}\b(?:secret|credential|webhook key|api key)\b/iu },
  { code: "deployment_or_gate", pattern: /\b(?:deploy|enable live mode|turn on production|promote the gate|change routing)\b/iu },
  { code: "autonomous_contact", pattern: /\b(?:send it now|contact the client|email the client|text the client|auto[- ]?send)\b/iu }
]);

const ADMIN_REVIEW_PATTERNS = Object.freeze([
  { code: "discount", pattern: /\b(?:discount|markdown|price override|waive (?:the )?fee)\b/iu },
  { code: "custom_menu", pattern: /\b(?:custom menu|off[- ]menu|new menu item|custom dish)\b/iu },
  { code: "policy_text", pattern: /\b(?:policy text|terms and conditions|contract language|cancellation policy)\b/iu }
]);

function matches(patterns, value) {
  return patterns
    .filter(({ pattern }) => pattern.test(String(value || "")))
    .map(({ code }) => code);
}

function inspectStewardContent(value) {
  return {
    secrets: matches(SECRET_PATTERNS, value),
    sensitivePersonalData: matches(SENSITIVE_PERSONAL_PATTERNS, value),
    prohibitedTactics: matches(PROHIBITED_TACTIC_PATTERNS, value),
    providerMutations: matches(PROVIDER_MUTATION_PATTERNS, value),
    adminReview: matches(ADMIN_REVIEW_PATTERNS, value)
  };
}

function evaluateStewardRequestPolicy(input) {
  const request = normalizeStewardRequest(input);
  const findings = inspectStewardContent(request.brief);
  const reasons = [];
  if (request.countryCode !== "US") reasons.push("us_pilot_only");
  if (ADMIN_ONLY_TASKS.has(request.task) && request.actor.role === "sales") {
    reasons.push("admin_task_required");
  }
  if (findings.secrets.length) reasons.push(...findings.secrets);
  if (findings.sensitivePersonalData.length) reasons.push(...findings.sensitivePersonalData);
  if (findings.prohibitedTactics.length) reasons.push(...findings.prohibitedTactics);
  if (findings.providerMutations.length) reasons.push(...findings.providerMutations);
  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length) {
    return {
      policyVersion: STEWARD_POLICY_VERSION,
      decision: "block",
      reasons: uniqueReasons,
      adminReviewReasons: findings.adminReview
    };
  }
  if (findings.adminReview.length && request.actor.role === "sales") {
    return {
      policyVersion: STEWARD_POLICY_VERSION,
      decision: "admin_review",
      reasons: [],
      adminReviewReasons: findings.adminReview
    };
  }
  return {
    policyVersion: STEWARD_POLICY_VERSION,
    decision: "allow",
    reasons: [],
    adminReviewReasons: findings.adminReview
  };
}

module.exports = {
  ADMIN_ONLY_TASKS,
  inspectStewardContent,
  evaluateStewardRequestPolicy
};
