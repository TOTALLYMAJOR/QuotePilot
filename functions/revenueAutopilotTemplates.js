"use strict";

const { createHash } = require("node:crypto");

const TEMPLATE_KINDS = Object.freeze([
  "quote_follow_up",
  "deposit_reminder",
  "final_balance_reminder",
  "post_event_review_request"
]);

const COMMON_TEMPLATE_VARIABLES = Object.freeze([
  "business_name",
  "customer_name",
  "event_date",
  "quote_number",
  "portal_url",
  "unsubscribe_url"
]);

const TEMPLATE_VARIABLES_BY_KIND = Object.freeze({
  quote_follow_up: Object.freeze([...COMMON_TEMPLATE_VARIABLES]),
  deposit_reminder: Object.freeze([...COMMON_TEMPLATE_VARIABLES, "deposit_amount"]),
  final_balance_reminder: Object.freeze([...COMMON_TEMPLATE_VARIABLES, "final_balance_amount"]),
  post_event_review_request: Object.freeze([
    "business_name",
    "customer_name",
    "event_date",
    "quote_number",
    "review_url",
    "unsubscribe_url"
  ])
});

const REQUIRED_TEMPLATE_VARIABLES_BY_KIND = Object.freeze({
  quote_follow_up: Object.freeze([
    "business_name",
    "customer_name",
    "quote_number",
    "portal_url",
    "unsubscribe_url"
  ]),
  deposit_reminder: Object.freeze([
    "business_name",
    "customer_name",
    "quote_number",
    "deposit_amount",
    "portal_url",
    "unsubscribe_url"
  ]),
  final_balance_reminder: Object.freeze([
    "business_name",
    "customer_name",
    "quote_number",
    "event_date",
    "final_balance_amount",
    "portal_url",
    "unsubscribe_url"
  ]),
  post_event_review_request: Object.freeze([
    "business_name",
    "customer_name",
    "event_date",
    "review_url",
    "unsubscribe_url"
  ])
});

const TEMPLATE_TOKEN_PATTERN = /\{\{([a-z][a-z0-9_]*)\}\}/g;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,255}$/;
const UNSAFE_HTML_PATTERN = /<(?:script|iframe|object|embed|form|meta|base)\b|\son[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/i;

class RevenueAutopilotTemplateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RevenueAutopilotTemplateError";
    this.code = code;
  }
}

function text(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function boundedText(value, maximum, fieldName) {
  const raw = String(value ?? "");
  if (raw.length > maximum) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      `${fieldName} exceeds its ${maximum}-character limit.`
    );
  }
  return raw.trim();
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIdentifier(value, fieldName) {
  const candidate = text(value, 256);
  if (!IDENTIFIER_PATTERN.test(candidate) || /^[^@\s]+@[^@\s]+$/.test(candidate)) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      `${fieldName} must be a stable non-email identifier.`
    );
  }
  return candidate;
}

function normalizeKind(value) {
  const kind = text(value, 64).toLowerCase();
  if (!TEMPLATE_KINDS.includes(kind)) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      "Revenue Autopilot email-template kind is invalid."
    );
  }
  return kind;
}

function extractTemplateVariables(source, fieldName) {
  const value = String(source ?? "");
  const variables = [];
  let match;
  TEMPLATE_TOKEN_PATTERN.lastIndex = 0;
  while ((match = TEMPLATE_TOKEN_PATTERN.exec(value))) {
    variables.push(match[1]);
  }
  const withoutValidTokens = value.replace(TEMPLATE_TOKEN_PATTERN, "");
  if (withoutValidTokens.includes("{{") || withoutValidTokens.includes("}}")) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      `${fieldName} contains malformed template syntax.`
    );
  }
  return variables;
}

function assertSafeHtml(html) {
  if (UNSAFE_HTML_PATTERN.test(html)) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      "Revenue Autopilot template HTML contains unsupported active content."
    );
  }
}

function compileRevenueAutopilotTemplate(input = {}) {
  if (!record(input)) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      "Revenue Autopilot template is required."
    );
  }
  const kind = normalizeKind(input.kind);
  const templateId = normalizeIdentifier(input.templateId, "Template identity");
  const version = normalizeIdentifier(input.version, "Template version");
  const subject = boundedText(input.subject, 200, "Template subject");
  const plainText = boundedText(input.text, 10_000, "Template text");
  const html = boundedText(input.html, 20_000, "Template HTML");
  if (!subject || !plainText || !html) {
    throw new RevenueAutopilotTemplateError(
      "failed-precondition",
      "Revenue Autopilot templates require subject, plain-text, and HTML content."
    );
  }
  if (/\r|\n/.test(subject)) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      "Revenue Autopilot template subjects cannot contain line breaks."
    );
  }
  assertSafeHtml(html);

  const subjectVariables = extractTemplateVariables(subject, "Template subject");
  const textVariables = extractTemplateVariables(plainText, "Template text");
  const htmlVariables = extractTemplateVariables(html, "Template HTML");
  const variables = [...new Set([
    ...subjectVariables,
    ...textVariables,
    ...htmlVariables
  ])].sort();
  const allowed = new Set(TEMPLATE_VARIABLES_BY_KIND[kind]);
  const unsupported = variables.filter((variable) => !allowed.has(variable));
  if (unsupported.length) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      `Revenue Autopilot template uses unsupported variables: ${unsupported.join(", ")}.`
    );
  }
  const missing = REQUIRED_TEMPLATE_VARIABLES_BY_KIND[kind]
    .filter((variable) => !variables.includes(variable));
  if (missing.length) {
    throw new RevenueAutopilotTemplateError(
      "failed-precondition",
      `Revenue Autopilot template is missing required variables: ${missing.join(", ")}.`
    );
  }
  const missingFromText = REQUIRED_TEMPLATE_VARIABLES_BY_KIND[kind]
    .filter((variable) => !textVariables.includes(variable));
  const missingFromHtml = REQUIRED_TEMPLATE_VARIABLES_BY_KIND[kind]
    .filter((variable) => !htmlVariables.includes(variable));
  if (missingFromText.length || missingFromHtml.length) {
    throw new RevenueAutopilotTemplateError(
      "failed-precondition",
      [
        missingFromText.length
          ? `plain text is missing: ${missingFromText.join(", ")}`
          : "",
        missingFromHtml.length
          ? `HTML is missing: ${missingFromHtml.join(", ")}`
          : ""
      ].filter(Boolean).join("; ")
    );
  }
  const canonical = {
    schemaVersion: 1,
    templateId,
    version,
    kind,
    channel: "email",
    subject,
    text: plainText,
    html,
    variables
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
  return Object.freeze({
    ...canonical,
    variables: Object.freeze(variables),
    fingerprint
  });
}

function normalizeHttpsUrl(value, fieldName) {
  const candidate = boundedText(value, 2_000, fieldName);
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("invalid URL authority");
    }
    return parsed.toString();
  } catch {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      `${fieldName} must be an HTTPS URL without embedded credentials.`
    );
  }
}

function normalizeTemplateValue(variable, value) {
  if (["portal_url", "review_url", "unsubscribe_url"].includes(variable)) {
    return normalizeHttpsUrl(value, variable);
  }
  const maximum = variable.endsWith("_amount") ? 80 : 500;
  const normalized = boundedText(value, maximum, `Template value ${variable}`);
  if (!normalized) {
    throw new RevenueAutopilotTemplateError(
      "failed-precondition",
      `Revenue Autopilot template value ${variable} is required.`
    );
  }
  if (/\u0000/.test(normalized)) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      `Revenue Autopilot template value ${variable} is invalid.`
    );
  }
  if (/\r|\n/.test(normalized)) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      `Revenue Autopilot template value ${variable} cannot contain line breaks.`
    );
  }
  return normalized;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function replaceTemplateVariables(source, values, { html = false } = {}) {
  return source.replace(TEMPLATE_TOKEN_PATTERN, (_token, variable) => (
    html ? escapeHtml(values[variable]) : values[variable]
  ));
}

function renderRevenueAutopilotTemplate(templateInput, valuesInput = {}) {
  const template = compileRevenueAutopilotTemplate(templateInput);
  if (!record(valuesInput)) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      "Revenue Autopilot template values are required."
    );
  }
  const suppliedVariables = Object.keys(valuesInput).sort();
  const unsupportedInputs = suppliedVariables.filter(
    (variable) => !TEMPLATE_VARIABLES_BY_KIND[template.kind].includes(variable)
  );
  if (unsupportedInputs.length) {
    throw new RevenueAutopilotTemplateError(
      "invalid-argument",
      `Revenue Autopilot template values include unsupported fields: ${unsupportedInputs.join(", ")}.`
    );
  }
  const values = Object.fromEntries(
    template.variables.map((variable) => [
      variable,
      normalizeTemplateValue(variable, valuesInput[variable])
    ])
  );
  const subject = replaceTemplateVariables(template.subject, values);
  const plainText = replaceTemplateVariables(template.text, values);
  const html = replaceTemplateVariables(template.html, values, { html: true });
  return Object.freeze({
    templateId: template.templateId,
    templateVersion: template.version,
    templateFingerprint: template.fingerprint,
    kind: template.kind,
    channel: "email",
    subject,
    text: plainText,
    html,
    variables: Object.freeze({ ...values })
  });
}

module.exports = {
  COMMON_TEMPLATE_VARIABLES,
  REQUIRED_TEMPLATE_VARIABLES_BY_KIND,
  RevenueAutopilotTemplateError,
  TEMPLATE_KINDS,
  TEMPLATE_VARIABLES_BY_KIND,
  compileRevenueAutopilotTemplate,
  renderRevenueAutopilotTemplate
};
