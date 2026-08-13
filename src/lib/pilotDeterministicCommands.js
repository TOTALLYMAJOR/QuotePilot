import { calculateQuote, currency } from "./quoteCalculator";
import { buildProposalReadiness } from "./quoteWorkflow";
import { authorizePilotV1Command } from "./pilotCommandPolicy";
import { buildMarginPresentation } from "../components/marginPresentation";
import { parseChangeRequest } from "../components/changeRequestParse";

export const PILOT_DETERMINISTIC_COMMAND_MODEL = "pilot-deterministic-command-v1";

export const PILOT_QUERY_KINDS = Object.freeze([
  "proposal_blockers",
  "price_explanation",
  "margin_explanation",
  "client_summary"
]);

function text(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9%$\s-]/gu, " ").replace(/\s+/gu, " ").trim();
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => freeze(entry, seen));
  return Object.freeze(value);
}

function queryKindFor(clause) {
  const value = normalize(clause);
  if (!value) return "";
  if (
    /\b(?:client|customer)[ -]?(?:friendly )?summary\b/u.test(value)
    || /\b(?:summarize|explain)\b.*\b(?:client|customer)\b/u.test(value)
    || /\b(?:client|customer)\b.*\bsummary\b/u.test(value)
  ) return "client_summary";
  if (/\b(?:margin|profit)\b/u.test(value)) return "margin_explanation";
  if (
    /\b(?:price|pricing|total)\b.*\b(?:explain|breakdown|why|made up|come from)\b/u.test(value)
    || /\b(?:explain|break down|why|show)\b.*\b(?:price|pricing|total)\b/u.test(value)
    || /\bprice breakdown\b/u.test(value)
  ) return "price_explanation";
  if (
    /\b(?:blocker|blockers|blocking|missing|needs attention)\b/u.test(value)
    || /\b(?:is|are)\b.*\b(?:proposal|quote)\b.*\bready\b/u.test(value)
    || /\bwhat\b.*\b(?:proposal|quote)\b.*\bneed/u.test(value)
  ) return "proposal_blockers";
  return "";
}

function packageName(form, catalog) {
  const selected = (catalog?.packages || []).find((item) => item?.id === form?.pkg);
  return text(selected?.name) || "Package not recorded";
}

function eventName(form) {
  return text(form?.eventName || form?.name) || "This event";
}

function finiteDateLabel(value) {
  const candidate = text(value);
  if (!candidate) return "date not recorded";
  const date = new Date(`${candidate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return candidate;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function calculateIfAvailable(form, catalog, settings) {
  const hasCalculatorContext = Array.isArray(catalog?.packages)
    && Array.isArray(catalog?.addons)
    && Array.isArray(catalog?.rentals)
    && settings && typeof settings === "object";
  if (!hasCalculatorContext) return null;
  try {
    return calculateQuote(form, catalog, settings);
  } catch {
    return null;
  }
}

function result({ kind, title, summary, facts, consequence, doNothing, confidence, provenance, state = "available" }) {
  const policy = authorizePilotV1Command({
    commandClass: "query",
    authorityLevel: "presentation"
  });
  return freeze({
    id: `pilot-query:${kind}`,
    kind,
    commandClass: "query",
    authorityLevel: "presentation",
    allowed: policy.allowed,
    state,
    title,
    summary,
    facts,
    consequence,
    doNothing,
    confidence,
    provenance,
    boundary: "Read-only deterministic explanation. No draft, saved quote, customer communication, provider state, booking, or payment state changes."
  });
}

function proposalBlockers({ form, totals }) {
  const readiness = buildProposalReadiness(form, totals);
  const gaps = readiness.gaps.map((gap) => ({
    label: gap.label,
    value: "Needs review",
    detail: `${gap.points} proposal-completeness ${gap.points === 1 ? "point" : "points"}.`
  }));
  return result({
    kind: "proposal_blockers",
    title: gaps.length ? "Proposal gaps" : "Proposal completeness is caught up",
    summary: gaps.length
      ? `${gaps.length} ${gaps.length === 1 ? "field is" : "fields are"} missing from the deterministic proposal-completeness contract.`
      : "All proposal-completeness criteria are present. This is not event-wide readiness.",
    facts: gaps.length ? gaps : [{
      label: "Proposal completeness",
      value: "100%",
      detail: "Commercial, customer, and operational evidence remain separate."
    }],
    consequence: gaps.length
      ? "The customer projection may omit information until these exact fields are reviewed."
      : "The proposal can be reviewed, but sending and lifecycle actions still use their governed evidence.",
    doNothing: gaps.length
      ? "The missing fields remain unresolved and the draft remains unchanged."
      : "The draft remains unchanged and no proposal is prepared or sent.",
    confidence: "High for the deterministic proposal criteria only.",
    provenance: "Current in-memory draft plus proposal-readiness-v1.",
    state: gaps.length ? "attention" : "healthy"
  });
}

function priceExplanation({ form, catalog, totals }) {
  if (!totals || !(Number(totals.total) > 0)) {
    return result({
      kind: "price_explanation",
      title: "Draft price unavailable",
      summary: "The current draft does not produce a positive client-side price preview.",
      facts: [],
      consequence: "No price composition or commercial conclusion is inferred.",
      doNothing: "The draft remains unchanged and unpriced.",
      confidence: "Unavailable until the draft has complete calculable inputs.",
      provenance: "Current in-memory draft and client quote calculator.",
      state: "unavailable"
    });
  }
  const facts = [
    ["Package", totals.base],
    ["Add-ons", totals.addons],
    ["Rentals", totals.rentals],
    ["Menu", totals.menu],
    ["Staffing", totals.labor],
    ["Travel", totals.travel],
    ["Service fee", totals.serviceFee],
    ["Tax", totals.tax]
  ].map(([label, value]) => ({ label, value: currency(Number(value) || 0), detail: "Current draft preview" }));
  facts.push(
    { label: "Total", value: currency(totals.total), detail: "Client preview, not a saved authoritative price" },
    { label: "Deposit", value: currency(totals.deposit), detail: "Derived from the current draft policy" }
  );
  return result({
    kind: "price_explanation",
    title: "How this draft price is composed",
    summary: `${packageName(form, catalog)} produces a ${currency(totals.total)} current client preview.`,
    facts,
    consequence: "Changing scope can change fees, tax, total, and deposit together; saving still triggers server-authoritative repricing.",
    doNothing: `The current in-memory preview remains ${currency(totals.total)} and nothing is saved or sent.`,
    confidence: "High for the current client-calculator output; unavailable as saved-price authority.",
    provenance: "Current in-memory draft plus quoteCalculator."
  });
}

function marginExplanation({ form, catalog, settings, totals, marginEnabled, marginAuthorized }) {
  if (marginEnabled !== true || marginAuthorized !== true) {
    const presentationDisabled = marginEnabled !== true;
    return result({
      kind: "margin_explanation",
      title: presentationDisabled ? "Margin explanation is gated off" : "Margin explanation is unavailable for this role",
      summary: presentationDisabled
        ? "Pilot cannot expose staff cost context while the margin presentation gate is disabled."
        : "Pilot cannot expose staff cost context without explicit staff-commercial permission.",
      facts: [],
      consequence: "No cost, margin, target-gap, or commercial-health conclusion is shown.",
      doNothing: "The draft and all cost evidence remain unchanged.",
      confidence: presentationDisabled
        ? "Unavailable by presentation policy."
        : "Unavailable by role policy.",
      provenance: presentationDisabled
        ? "VITE_PILOT_MARGINS_ENABLED is disabled."
        : "Current authenticated staff-commercial permission is absent.",
      state: "unavailable"
    });
  }
  const margin = buildMarginPresentation({ form, totals, catalog, settings });
  if (!margin?.available) {
    const missing = Array.isArray(margin?.missing) ? margin.missing : [];
    return result({
      kind: "margin_explanation",
      title: "Margin unavailable",
      summary: margin?.note || "The current draft lacks complete, tenant-recorded cost coverage.",
      facts: missing.map((item) => ({ label: item, value: "Missing cost evidence", detail: "No estimate substituted" })),
      consequence: "Pilot cannot calculate margin or recommend a margin action from incomplete cost coverage.",
      doNothing: "The missing cost evidence remains unresolved and the draft remains unchanged.",
      confidence: "Unavailable because cost coverage fails closed.",
      provenance: "Current draft, tenant catalog cost fields, and margin-presentation-v1.",
      state: "unavailable"
    });
  }
  return result({
    kind: "margin_explanation",
    title: "Recorded-cost margin",
    summary: `${(margin.marginPct * 100).toFixed(1)}% margin on the current catering-scope preview.`,
    facts: [
      { label: "Scope revenue", value: currency(margin.revenue), detail: "Travel and tax excluded" },
      { label: "Recorded costs", value: currency(margin.cost), detail: "Tenant-recorded cost fields only" },
      { label: "Margin", value: `${(margin.marginPct * 100).toFixed(1)}%`, detail: margin.targetNote || "No target recorded" }
    ],
    consequence: "A scope or price change may change this staff-only advisory calculation; the server remains authoritative for saved price, not this margin explanation.",
    doNothing: "The current draft and recorded cost evidence remain unchanged.",
    confidence: "High only because every selected revenue line has recorded cost coverage.",
    provenance: "Current draft, tenant-recorded costs, and margin-presentation-v1."
  });
}

function clientSummary({ form, totals, catalog }) {
  if (!totals || !(Number(totals.total) > 0)) {
    return result({
      kind: "client_summary",
      title: "Client summary unavailable",
      summary: "The current draft needs a calculable total before Pilot can produce a price-bearing customer summary.",
      facts: [],
      consequence: "No customer-facing wording is inferred from incomplete scope.",
      doNothing: "The draft remains unchanged and no message is prepared or sent.",
      confidence: "Unavailable until the draft is calculable.",
      provenance: "Current in-memory draft.",
      state: "unavailable"
    });
  }
  const guests = Math.max(0, Math.round(Number(form?.guests) || 0));
  const summary = `${eventName(form)} is planned for ${finiteDateLabel(form?.date)}${guests ? ` for ${guests} guests` : ""}${text(form?.venue) ? ` at ${text(form.venue)}` : ""}. The current ${packageName(form, catalog)} draft is ${currency(totals.total)}, with ${currency(totals.deposit)} shown as the deposit requirement.`;
  return result({
    kind: "client_summary",
    title: "Client-safe draft summary",
    summary,
    facts: [
      { label: "Package", value: packageName(form, catalog), detail: "Current draft selection" },
      { label: "Menu selections", value: String((form?.menuItems || []).length), detail: "Count only; review exact names before use" },
      { label: "Quoted preview", value: currency(totals.total), detail: "Requires server repricing before save/send" }
    ],
    consequence: "This wording may be copied for review, but Pilot does not prepare or send a customer communication.",
    doNothing: "No customer message, proposal, or draft field changes.",
    confidence: "High for the displayed draft fields; communication suitability still requires human review.",
    provenance: "Current in-memory draft and client quote calculator."
  });
}

export function buildPilotDeterministicQuery(clause, {
  form = {},
  catalog = {},
  settings = {},
  totals = null,
  marginEnabled = false,
  marginAuthorized = false
} = {}) {
  const kind = queryKindFor(clause);
  if (!kind) return null;
  // Questions whose answer is independent of pricing dispatch before any
  // calculator access. Price-bearing answers fail closed when the caller has
  // not supplied either exact totals or a complete browser-calculator context.
  if (kind === "proposal_blockers") {
    return proposalBlockers({
      form,
      totals: totals || calculateIfAvailable(form, catalog, settings) || {}
    });
  }
  if (kind === "margin_explanation") {
    if (marginEnabled !== true || marginAuthorized !== true) {
      return marginExplanation({
        form,
        catalog,
        settings,
        totals: null,
        marginEnabled,
        marginAuthorized
      });
    }
  }
  const calculated = totals || calculateIfAvailable(form, catalog, settings);
  if (kind === "price_explanation") {
    return priceExplanation({ form, catalog, totals: calculated });
  }
  if (kind === "margin_explanation") {
    return marginExplanation({
      form,
      catalog,
      settings,
      totals: calculated,
      marginEnabled,
      marginAuthorized
    });
  }
  return clientSummary({ form, totals: calculated, catalog });
}

export function buildPilotCommandPreview(message, context = {}) {
  const change = parseChangeRequest(message, context);
  const queries = [];
  const unparsedClauses = [];
  change.unparsedClauses.forEach((clause) => {
    const query = buildPilotDeterministicQuery(clause, context);
    if (query) queries.push(query);
    else unparsedClauses.push(clause);
  });
  return freeze({
    ...change,
    modelId: PILOT_DETERMINISTIC_COMMAND_MODEL,
    queries,
    unparsedClauses
  });
}
