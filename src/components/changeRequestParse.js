import { calculateQuote } from "../lib/quoteCalculator";
import { MAX_EVENT_HOURS, MIN_EVENT_HOURS } from "../lib/wizardUi";
import { buildMarginPresentation } from "./marginPresentation";

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

function packagePool(catalog) {
  return (catalog?.packages || [])
    .filter((item) => item && item.active !== false && clean(item.id) && clean(item.name))
    .map((item) => ({
      itemType: "packages",
      itemId: clean(item.id),
      itemName: clean(item.name)
    }));
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

// Ids are anchored to the clause's own position in the ORIGINAL message
// (clauseIndex), never to a running "how many artifacts so far" counter.
// ChangeRequestPanel re-parses reactively as staging changes the draft
// form, and a clause that becomes satisfied (set_guests/set_hours) stops
// producing an artifact on the next parse — a counter-based id would shift
// every later clause's id down a slot when that happens, orphaning an
// already-staged proposal's tracked id and letting it be staged again.
// Clause-index anchoring keeps every clause's id stable for the life of
// the message regardless of what any other clause does.
function proposalId(prefix, clauseIndex) {
  return `${prefix}-${clauseIndex}`;
}

function parseClause(clause, clauseIndex, {
  form,
  catalog,
  styles,
  allowPackageChanges = true
}) {
  const lower = clause.toLowerCase();

  const guestSet = lower.match(/\b(?:to|at|now at|now)\s+(\d{1,4})\s*(?:guests|people|persons|ppl)\b/)
    || lower.match(/\bcount\s+(?:to|is|at)\s+(\d{1,4})\b/)
    || lower.match(/\b(\d{1,4})\s*(?:guests|people)\s*(?:now|instead|final(?:ized)?)\b/);
  if (guestSet) {
    const value = Number(guestSet[1]);
    if (value > 0 && value !== Number(form?.guests)) {
      return {
        proposal: {
          id: proposalId("guests", clauseIndex),
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
          id: proposalId("staff", clauseIndex),
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
          id: proposalId("hours", clauseIndex),
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

  // Package changes require the explicit word "package" and must resolve to
  // exactly one active tenant-catalog record. This keeps ordinary service-
  // style language ("switch to buffet") in its own grammar and makes a vague
  // request such as "switch package to premium" fail closed when more than
  // one package matches.
  const packageSwitch = clause.match(
    /\b(?:switch|change|move|upgrade|downgrade)(?:ing)?\s+(?:the\s+)?package\s+(?:to|into)\s+(?:the\s+)?(.+)$/i
  ) || clause.match(
    /\b(?:switch|change|move)(?:ing)?\s+to\s+(?:the\s+)?(.+?)\s+package\b/i
  ) || clause.match(
    /\b(?:use|choose|select)\s+(?:the\s+)?(.+?)\s+package\b/i
  );
  if (allowPackageChanges && packageSwitch) {
    const query = packageSwitch[1];
    const resolved = resolveReference(query, packagePool(catalog));
    if (resolved.match) {
      if (resolved.match.itemId === form?.pkg) return { consumed: true };
      return {
        proposal: {
          id: proposalId("package", clauseIndex),
          kind: "set_package",
          value: resolved.match.itemId,
          packageId: resolved.match.itemId,
          packageName: resolved.match.itemName,
          title: `Package → ${resolved.match.itemName}`,
          meta: "Package",
          clause
        }
      };
    }
    if (resolved.candidates.length > 1) {
      return {
        ambiguity: {
          id: proposalId("choice", clauseIndex),
          clause,
          verb: "set package",
          query,
          candidates: resolved.candidates
        }
      };
    }
    return {};
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
          id: proposalId("style", clauseIndex),
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
          id: proposalId("swap", clauseIndex),
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
      return { ambiguity: { id: proposalId("choice", clauseIndex), clause, ...ambiguousSide } };
    }
    return {};
  }

  const removal = clause.match(/\b(?:remove|drop|skip|cancel|no\s+more|take\s+(?:off|out)|get\s+rid\s+of)\s+(?:the\s+)?(.+)$/i);
  if (removal) {
    const resolved = resolveReference(removal[1], selectedPool(form, catalog));
    if (resolved.match) {
      return {
        proposal: {
          id: proposalId("remove", clauseIndex),
          kind: "remove_item",
          ...resolved.match,
          title: `Remove ${resolved.match.itemName}`,
          meta: ITEM_TYPE_LABELS[resolved.match.itemType],
          clause
        }
      };
    }
    if (resolved.candidates.length > 1) {
      return { ambiguity: { id: proposalId("choice", clauseIndex), clause, verb: "remove", query: removal[1], candidates: resolved.candidates } };
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
          id: proposalId("add", clauseIndex),
          kind: "add_item",
          ...resolved.match,
          title: `Add ${resolved.match.itemName}`,
          meta: ITEM_TYPE_LABELS[resolved.match.itemType],
          clause
        }
      };
    }
    if (resolved.candidates.length > 1) {
      return { ambiguity: { id: proposalId("choice", clauseIndex), clause, verb: "add", query: addition[1], candidates: resolved.candidates } };
    }
    return {};
  }

  return {};
}

export function parseChangeRequest(message, {
  form = {},
  catalog = {},
  styles = [],
  allowPackageChanges = true
} = {}) {
  const trimmed = clean(message);
  const proposals = [];
  const ambiguities = [];
  const unparsedClauses = [];

  const clauses = splitClauses(trimmed);
  for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
    const clause = clauses[clauseIndex];
    const result = parseClause(clause, clauseIndex, {
      form,
      catalog,
      styles,
      allowPackageChanges
    });
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
  if (proposal.kind === "set_package") {
    next.pkg = proposal.packageId || proposal.value;
    next.eventTemplateId = "custom";
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
  if (proposal.kind === "set_package") return ["pkg", "eventTemplateId"];
  if (proposal.kind === "remove_item" || proposal.kind === "add_item") return [proposal.itemType];
  if (proposal.kind === "swap_item") {
    return [...new Set([proposal.remove.itemType, proposal.add.itemType])];
  }
  return [];
}

export function buildChangeImpact({ form, catalog, settings, proposal } = {}) {
  if (!form || !catalog || !settings || !proposal) return null;
  const nextForm = applyProposalToForm(form, proposal);
  const before = calculateQuote(form, catalog, settings);
  const after = calculateQuote(nextForm, catalog, settings);
  if (!before || !after) return null;
  const delta = Number(after.total || 0) - Number(before.total || 0);
  const depositDelta = Number(after.deposit || 0) - Number(before.deposit || 0);
  // Fail-closed independently of the total/deposit delta above: a proposal
  // can move a quote into or out of cost coverage (e.g. adding a bartender
  // when no bartender cost rate is on file), so margin is only ever shown
  // when both the current draft and the proposed one have it.
  const beforeMargin = buildMarginPresentation({ form, totals: before, catalog, settings });
  const afterMargin = buildMarginPresentation({ form: nextForm, totals: after, catalog, settings });
  const marginDelta = beforeMargin?.available && afterMargin?.available
    ? { beforePct: beforeMargin.marginPct, afterPct: afterMargin.marginPct }
    : null;
  return {
    beforeTotal: Number(before.total || 0),
    afterTotal: Number(after.total || 0),
    delta,
    depositDelta,
    marginDelta
  };
}
