import { calculateQuote } from "../lib/quoteCalculator";
import { MAX_EVENT_HOURS, MIN_EVENT_HOURS } from "../lib/wizardUi";

// Deterministic change-request parsing for the flag-gated client-request
// panel (docs/POST_COMPETITIVE_DESIGN.md §4.8). The customer's stored
// freeform message is split into clauses and each clause is matched against
// a small battery of explicit change patterns; item references resolve only
// against the quote's own selections and the tenant's active catalog. No
// I/O, no invention: an unmatched clause stays the customer's text, an
// ambiguous reference becomes a choice — never a guess — and every staged
// change edits the draft form only. Saving still re-prices authoritatively
// and creates the next version through the standard trusted path.
export const CHANGE_REQUEST_PARSE_MODEL = "change-request-parse-v1";

const STAFF_ROLES = Object.freeze({
  bartender: "bartenders",
  server: "servers",
  chef: "chefs"
});

const ITEM_TYPE_LABELS = Object.freeze({
  addons: "Add-on",
  rentals: "Rental",
  menuItems: "Menu"
});

function clean(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/[^\w\s'&-]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value) {
  return normalize(value).split(" ").filter((token) => token.length >= 2);
}

function nameMatches(query, name) {
  const q = normalize(query);
  const n = normalize(name);
  if (!q || !n) return false;
  if (q.length >= 4 && (n.includes(q) || q.includes(n))) return true;
  const queryTokens = tokens(query);
  return queryTokens.length > 0 && queryTokens.every((token) => n.includes(token));
}

function menuCatalogItems(catalog) {
  return (catalog?.settings?.menuSections || [])
    .flatMap((section) => section?.items || [])
    .filter((item) => item && item.active !== false);
}

function catalogPool(catalog) {
  return [
    ...(catalog?.addons || []).filter((item) => item && item.active !== false)
      .map((item) => ({ itemType: "addons", itemId: item.id, itemName: clean(item.name) })),
    ...(catalog?.rentals || []).filter((item) => item && item.active !== false)
      .map((item) => ({ itemType: "rentals", itemId: item.id, itemName: clean(item.name) })),
    ...menuCatalogItems(catalog)
      .map((item) => ({ itemType: "menuItems", itemId: item.id, itemName: clean(item.name) }))
  ];
}

function selectedPool(form, catalog) {
  return catalogPool(catalog).filter((entry) => {
    const list = form?.[entry.itemType];
    return Array.isArray(list) && list.includes(entry.itemId);
  });
}

function resolveReference(query, pool) {
  const full = pool.filter((entry) => nameMatches(query, entry.itemName));
  if (full.length === 1) return { match: full[0], candidates: full };
  // Natural phrasing carries filler ("could we do chicken"). Try contiguous
  // token windows, longest first; only a window with exactly one catalog hit
  // may resolve — anything still ambiguous stays a choice, never a guess.
  const queryTokens = tokens(query);
  for (let length = Math.min(3, queryTokens.length); length >= 1; length -= 1) {
    for (let start = 0; start + length <= queryTokens.length; start += 1) {
      const window = queryTokens.slice(start, start + length).join(" ");
      if (window.length < 3) continue;
      const hits = pool.filter((entry) => nameMatches(window, entry.itemName));
      if (hits.length === 1) return { match: hits[0], candidates: hits };
    }
  }
  return { match: null, candidates: full };
}

function splitClauses(message) {
  return String(message || "")
    .split(/[,.;\n?]+|\band\b/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 3);
}

let idCounter = 0;
function proposalId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function parseClause(clause, { form, catalog, styles }) {
  const lower = clause.toLowerCase();

  const guestSet = lower.match(/\b(?:to|at|now at|now)\s+(\d{1,4})\s*(?:guests|people|persons|ppl)\b/)
    || lower.match(/\bcount\s+(?:to|is|at)\s+(\d{1,4})\b/)
    || lower.match(/\b(\d{1,4})\s*(?:guests|people)\s*(?:now|instead|final(?:ized)?)\b/);
  if (guestSet) {
    const value = Number(guestSet[1]);
    if (value > 0 && value !== Number(form?.guests)) {
      return {
        proposal: {
          id: proposalId("guests"),
          kind: "set_guests",
          value,
          title: `Guest count → ${value}`,
          meta: "Event",
          clause
        }
      };
    }
    return { consumed: true };
  }

  const staffAdd = lower.match(/\b(?:add|one more|another|an extra|extra)\s+(?:(\d+)\s+)?(bartender|server|chef)s?\b/);
  if (staffAdd) {
    const count = staffAdd[1] ? Number(staffAdd[1]) : 1;
    const field = STAFF_ROLES[staffAdd[2]];
    if (count > 0 && field) {
      return {
        proposal: {
          id: proposalId("staff"),
          kind: "add_staff",
          field,
          count,
          title: `Add ${count} ${staffAdd[2]}${count === 1 ? "" : "s"}`,
          meta: "Staffing",
          clause
        }
      };
    }
  }

  const hourAdd = lower.match(/\badd\s+(?:an|one)\s+hour\b/);
  const hourSet = lower.match(/\b(?:extend|go)\s+to\s+(\d{1,2})\s*hours?\b/)
    || lower.match(/\b(\d{1,2})\s*hours?\s+(?:instead|now)\b/);
  if (hourAdd || hourSet) {
    const current = Number(form?.hours) || MIN_EVENT_HOURS;
    const raw = hourSet ? Number(hourSet[1]) : current + 1;
    const value = Math.min(MAX_EVENT_HOURS, Math.max(MIN_EVENT_HOURS, raw));
    if (value !== current) {
      return {
        proposal: {
          id: proposalId("hours"),
          kind: "set_hours",
          value,
          title: `Service hours → ${value}`,
          meta: "Event",
          clause
        }
      };
    }
    return { consumed: true };
  }

  const styleSwitch = lower.match(/\bswitch(?:ing)?\s+(?:\w+\s+)?to\s+(buffet|plated|stations|drop[- ]?off)\b/)
    || lower.match(/\b(buffet|plated|stations|drop[- ]?off)\s+instead\b/);
  if (styleSwitch) {
    const canonical = (styles || []).find(
      (style) => normalize(style) === normalize(styleSwitch[1]).replace("drop off", "drop-off")
    );
    if (canonical && canonical !== form?.style) {
      return {
        proposal: {
          id: proposalId("style"),
          kind: "set_style",
          value: canonical,
          title: `Service style → ${canonical}`,
          meta: "Event",
          clause
        }
      };
    }
    return { consumed: true };
  }

  const swap = clause.match(/\b(?:swap|replace|switch)\s+(?:the\s+)?(.+?)\s+(?:for|with|to)\s+(?:the\s+)?(.+)$/i);
  const insteadOf = clause.match(/\b(?:the\s+)?(.+?)\s+instead\s+of\s+(?:the\s+)?(.+)$/i);
  if (swap || insteadOf) {
    const removeQuery = swap ? swap[1] : insteadOf[2];
    const addQuery = swap ? swap[2] : insteadOf[1];
    const removeResolved = resolveReference(removeQuery, selectedPool(form, catalog));
    const addResolved = resolveReference(addQuery, catalogPool(catalog));
    if (removeResolved.match && addResolved.match) {
      return {
        proposal: {
          id: proposalId("swap"),
          kind: "swap_item",
          remove: removeResolved.match,
          add: addResolved.match,
          title: `Swap ${removeResolved.match.itemName} → ${addResolved.match.itemName}`,
          meta: ITEM_TYPE_LABELS[addResolved.match.itemType],
          clause
        }
      };
    }
    const ambiguousSide = !removeResolved.match && removeResolved.candidates.length > 1
      ? { verb: "remove", query: removeQuery, candidates: removeResolved.candidates }
      : !addResolved.match && addResolved.candidates.length > 1
        ? { verb: "add", query: addQuery, candidates: addResolved.candidates }
        : null;
    if (ambiguousSide) {
      return { ambiguity: { id: proposalId("choice"), clause, ...ambiguousSide } };
    }
    return {};
  }

  const removal = clause.match(/\b(?:remove|drop|skip|cancel|no\s+more|take\s+(?:off|out)|get\s+rid\s+of)\s+(?:the\s+)?(.+)$/i);
  if (removal) {
    const resolved = resolveReference(removal[1], selectedPool(form, catalog));
    if (resolved.match) {
      return {
        proposal: {
          id: proposalId("remove"),
          kind: "remove_item",
          ...resolved.match,
          title: `Remove ${resolved.match.itemName}`,
          meta: ITEM_TYPE_LABELS[resolved.match.itemType],
          clause
        }
      };
    }
    if (resolved.candidates.length > 1) {
      return { ambiguity: { id: proposalId("choice"), clause, verb: "remove", query: removal[1], candidates: resolved.candidates } };
    }
    return {};
  }

  const addition = clause.match(/\b(?:add|include|we(?:'|’)?d\s+like|can\s+we\s+get)\s+(?:the\s+|a\s+|an\s+)?(.+)$/i);
  if (addition) {
    const pool = catalogPool(catalog).filter((entry) => {
      const list = form?.[entry.itemType];
      return !(Array.isArray(list) && list.includes(entry.itemId));
    });
    const resolved = resolveReference(addition[1], pool);
    if (resolved.match) {
      return {
        proposal: {
          id: proposalId("add"),
          kind: "add_item",
          ...resolved.match,
          title: `Add ${resolved.match.itemName}`,
          meta: ITEM_TYPE_LABELS[resolved.match.itemType],
          clause
        }
      };
    }
    if (resolved.candidates.length > 1) {
      return { ambiguity: { id: proposalId("choice"), clause, verb: "add", query: addition[1], candidates: resolved.candidates } };
    }
    return {};
  }

  return {};
}

export function parseChangeRequest(message, { form = {}, catalog = {}, styles = [] } = {}) {
  idCounter = 0;
  const trimmed = clean(message);
  const proposals = [];
  const ambiguities = [];
  const unparsedClauses = [];

  for (const clause of splitClauses(trimmed)) {
    const result = parseClause(clause, { form, catalog, styles });
    if (result.proposal) proposals.push(result.proposal);
    else if (result.ambiguity) ambiguities.push(result.ambiguity);
    else if (!result.consumed) unparsedClauses.push(clause);
  }

  return {
    modelId: CHANGE_REQUEST_PARSE_MODEL,
    message: trimmed,
    proposals,
    ambiguities,
    unparsedClauses
  };
}

export function applyProposalToForm(form, proposal) {
  const next = { ...form };
  if (!proposal) return next;
  if (proposal.kind === "set_guests") {
    next.guests = proposal.value;
    return next;
  }
  if (proposal.kind === "add_staff") {
    next[proposal.field] = Math.max(0, Number(form?.[proposal.field]) || 0) + proposal.count;
    return next;
  }
  if (proposal.kind === "set_hours") {
    next.hours = proposal.value;
    return next;
  }
  if (proposal.kind === "set_style") {
    next.style = proposal.value;
    return next;
  }
  const removeItem = (target) => {
    const list = Array.isArray(next[target.itemType]) ? next[target.itemType] : [];
    next[target.itemType] = list.filter((id) => id !== target.itemId);
    const quantityField = target.itemType === "addons"
      ? "addonQuantities"
      : target.itemType === "rentals"
        ? "rentalQuantities"
        : "menuItemQuantities";
    const quantities = { ...(next[quantityField] || {}) };
    delete quantities[target.itemId];
    next[quantityField] = quantities;
  };
  const addItem = (target) => {
    const list = Array.isArray(next[target.itemType]) ? next[target.itemType] : [];
    if (!list.includes(target.itemId)) next[target.itemType] = [...list, target.itemId];
  };
  if (proposal.kind === "remove_item") {
    removeItem(proposal);
    return next;
  }
  if (proposal.kind === "add_item") {
    addItem(proposal);
    return next;
  }
  if (proposal.kind === "swap_item") {
    removeItem(proposal.remove);
    addItem(proposal.add);
    return next;
  }
  return next;
}

export function proposalTouchedFields(proposal) {
  if (!proposal) return [];
  if (proposal.kind === "set_guests") return ["guests"];
  if (proposal.kind === "add_staff") return [proposal.field];
  if (proposal.kind === "set_hours") return ["hours"];
  if (proposal.kind === "set_style") return ["style"];
  if (proposal.kind === "remove_item" || proposal.kind === "add_item") return [proposal.itemType];
  if (proposal.kind === "swap_item") {
    return [...new Set([proposal.remove.itemType, proposal.add.itemType])];
  }
  return [];
}

export function buildChangeImpact({ form, catalog, settings, proposal } = {}) {
  if (!form || !catalog || !settings || !proposal) return null;
  const before = calculateQuote(form, catalog, settings);
  const after = calculateQuote(applyProposalToForm(form, proposal), catalog, settings);
  if (!before || !after) return null;
  const delta = Number(after.total || 0) - Number(before.total || 0);
  const depositDelta = Number(after.deposit || 0) - Number(before.deposit || 0);
  return {
    beforeTotal: Number(before.total || 0),
    afterTotal: Number(after.total || 0),
    delta,
    depositDelta
  };
}
