import { getCustomerDirectoryPage } from "./customerWorkspace";
import { getQuoteHistory } from "./quoteStore";

export const COMMERCIAL_SEARCH_MIN_QUERY_LENGTH = 2;
export const COMMERCIAL_SEARCH_CUSTOMER_LIMIT = 6;
export const COMMERCIAL_SEARCH_QUOTE_READ_LIMIT = 50;
export const COMMERCIAL_SEARCH_QUOTE_RESULT_LIMIT = 6;
export const COMMERCIAL_SEARCH_RESULT_LIMIT = (
  COMMERCIAL_SEARCH_CUSTOMER_LIMIT + COMMERCIAL_SEARCH_QUOTE_RESULT_LIMIT
);

const QUERY_LENGTH_LIMIT = 120;

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeCommercialSearchQuery(value) {
  return text(value)
    .replace(/\s+/g, " ")
    .slice(0, QUERY_LENGTH_LIMIT)
    .toLowerCase();
}

function safeOpaqueId(value, { rejectEmail = false } = {}) {
  const id = text(value);
  if (
    !id
    || id.length > 256
    || /[\s/?#\\\u0000]/u.test(id)
    || id === "."
    || id === ".."
    || (rejectEmail && /^[^@\s]+@[^@\s]+$/.test(id))
  ) {
    return "";
  }
  return id;
}

function readableStatus(value) {
  const normalized = text(value).replace(/[_-]+/g, " ").toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}

function joinedDetail(parts = []) {
  return parts.map(text).filter(Boolean).join(" · ");
}

function customerMatchesPrefix(customer = {}, query = "") {
  const name = normalizeCommercialSearchQuery(customer.nameKey || customer.name);
  const email = normalizeCommercialSearchQuery(customer.emailKey || customer.email);
  return query.includes("@") ? email.startsWith(query) : name.startsWith(query);
}

function quoteMatchesQuery(quote = {}, query = "") {
  const searchable = [
    quote.quoteNumber,
    quote.customer?.name,
    quote.customer?.email,
    quote.customer?.organization,
    quote.customer?.company,
    quote.event?.name,
    quote.event?.date,
    quote.event?.venue,
    quote.status
  ]
    .map(normalizeCommercialSearchQuery)
    .filter(Boolean)
    .join(" ");
  const terms = query.split(" ").filter(Boolean);
  return terms.length > 0 && terms.every((term) => searchable.includes(term));
}

export function projectCommercialCustomerResults(customers = [], query = "") {
  const normalizedQuery = normalizeCommercialSearchQuery(query);
  if (normalizedQuery.length < COMMERCIAL_SEARCH_MIN_QUERY_LENGTH) return [];

  return (Array.isArray(customers) ? customers : [])
    .filter((customer) => customerMatchesPrefix(customer, normalizedQuery))
    .map((customer) => {
      const id = safeOpaqueId(customer?.id || customer?.customerId, { rejectEmail: true });
      if (!id) return null;
      const name = text(customer?.name);
      const email = text(customer?.email).toLowerCase();
      return {
        kind: "customer",
        id,
        title: name || email || "Unnamed customer",
        detail: joinedDetail([customer?.company || customer?.organization, email])
      };
    })
    .filter(Boolean)
    .slice(0, COMMERCIAL_SEARCH_CUSTOMER_LIMIT);
}

export function projectCommercialQuoteResults(quotes = [], query = "") {
  const normalizedQuery = normalizeCommercialSearchQuery(query);
  if (normalizedQuery.length < COMMERCIAL_SEARCH_MIN_QUERY_LENGTH) return [];

  return (Array.isArray(quotes) ? quotes : [])
    .filter((quote) => quoteMatchesQuery(quote, normalizedQuery))
    .map((quote) => {
      const id = safeOpaqueId(quote?.id);
      if (!id) return null;
      const quoteNumber = text(quote?.quoteNumber);
      return {
        kind: "quote",
        id,
        title: quoteNumber || "Saved quote",
        detail: joinedDetail([
          quote?.customer?.name,
          quote?.event?.name,
          quote?.event?.date,
          readableStatus(quote?.status)
        ])
      };
    })
    .filter(Boolean)
    .slice(0, COMMERCIAL_SEARCH_QUOTE_RESULT_LIMIT);
}

function readSource(result = {}) {
  const source = text(result?.source).toLowerCase();
  return ["firebase", "local", "mixed", "firebase-required"].includes(source)
    ? source
    : "";
}

function combinedSource(reads = []) {
  const sources = [...new Set(reads.map((read) => read.source).filter(Boolean))];
  if (sources.length > 1) return "mixed";
  return sources[0] || "";
}

function unavailableRead() {
  return Object.freeze({ status: "error", source: "", truncated: false });
}

export async function searchCommercialWorkspace({
  organizationId = "",
  query = "",
  readCustomers = getCustomerDirectoryPage,
  readQuotes = getQuoteHistory
} = {}) {
  const orgId = text(organizationId);
  if (!orgId) throw new Error("organizationId is required for commercial search.");

  const normalizedQuery = normalizeCommercialSearchQuery(query);
  if (normalizedQuery.length < COMMERCIAL_SEARCH_MIN_QUERY_LENGTH) {
    return {
      status: "empty",
      source: "",
      results: [],
      reads: {
        customers: { status: "not-requested", source: "", truncated: false },
        quotes: { status: "not-requested", source: "", truncated: false }
      },
      partialReasons: [],
      truncated: false
    };
  }

  const [customerOutcome, quoteOutcome] = await Promise.allSettled([
    readCustomers({
      organizationId: orgId,
      search: normalizedQuery,
      cursor: "",
      pageSize: COMMERCIAL_SEARCH_CUSTOMER_LIMIT
    }),
    readQuotes({
      organizationId: orgId,
      limitCount: COMMERCIAL_SEARCH_QUOTE_READ_LIMIT
    })
  ]);

  const customerRead = customerOutcome.status === "fulfilled"
    ? {
        status: "success",
        source: readSource(customerOutcome.value),
        truncated: Boolean(customerOutcome.value?.nextCursor)
      }
    : unavailableRead();
  const quoteRead = quoteOutcome.status === "fulfilled"
    ? {
        status: "success",
        source: readSource(quoteOutcome.value),
        truncated: Boolean(quoteOutcome.value?.truncated)
      }
    : unavailableRead();

  const customerItems = customerOutcome.status === "fulfilled"
    ? customerOutcome.value?.items
    : [];
  const quoteItems = quoteOutcome.status === "fulfilled"
    ? quoteOutcome.value?.quotes
    : [];
  const tenantQuoteItems = (Array.isArray(quoteItems) ? quoteItems : [])
    .filter((quote) => text(quote?.organizationId) === orgId);
  const matchingQuoteCount = tenantQuoteItems
    .filter((quote) => quoteMatchesQuery(quote, normalizedQuery)).length;
  const customerResults = projectCommercialCustomerResults(customerItems, normalizedQuery);
  const quoteResults = projectCommercialQuoteResults(tenantQuoteItems, normalizedQuery);
  const results = [...customerResults, ...quoteResults].slice(0, COMMERCIAL_SEARCH_RESULT_LIMIT);

  const partialReasons = [
    customerRead.status === "error" ? "customer-read-unavailable" : "",
    quoteRead.status === "error" ? "quote-read-unavailable" : "",
    customerRead.truncated ? "customer-results-capped" : "",
    quoteRead.truncated ? "quote-window-capped" : "",
    matchingQuoteCount > COMMERCIAL_SEARCH_QUOTE_RESULT_LIMIT ? "quote-results-capped" : ""
  ].filter(Boolean);
  const successfulReadCount = [customerRead, quoteRead]
    .filter((read) => read.status === "success").length;
  const truncated = partialReasons.some((reason) => reason.endsWith("-capped"));
  const status = successfulReadCount === 0
    ? "error"
    : partialReasons.length > 0
      ? "partial"
      : results.length > 0
        ? "success"
        : "empty";

  return {
    status,
    source: combinedSource([customerRead, quoteRead]),
    results,
    reads: {
      customers: customerRead,
      quotes: quoteRead
    },
    partialReasons,
    truncated
  };
}

export function createCommercialSearchGenerationGuard(initialGeneration = 0) {
  let currentGeneration = Math.max(0, Number(initialGeneration) || 0);
  return Object.freeze({
    next() {
      currentGeneration += 1;
      return currentGeneration;
    },
    invalidate() {
      currentGeneration += 1;
      return currentGeneration;
    },
    commit(generation, apply) {
      if (generation !== currentGeneration) return false;
      apply?.();
      return true;
    },
    current() {
      return currentGeneration;
    }
  });
}
