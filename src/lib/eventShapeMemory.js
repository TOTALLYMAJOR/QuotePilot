import { getQuoteHistory } from "./quoteStore";

// Event-shape memory (docs/POST_COMPETITIVE_DESIGN.md §4.10; owner-decided
// scope, 2026-08-11): a deterministic aggregate of the TENANT'S OWN past
// booked events, by exact event type and guest band, surfaced as a
// provenance-labeled suggestion in CREATE. No AI, no cross-tenant
// learning — getQuoteHistory is already tenant-scoped server-side, this
// module only reads what it returns. Only "accepted" or "booked" quotes
// count as real signal (mirrors the AVAILABILITY_CONFLICT_STATUSES
// convention already independently declared in quoteStore.js and
// CustomerPortalView.jsx): a real client said yes to these numbers, not
// merely a draft someone typed. Honest cold start: below the minimum
// sample, this reports "not enough history yet" rather than a guess from
// one data point.
export const EVENT_SHAPE_MEMORY_MODEL = "event-shape-memory-v1";

const BOOKED_STATUSES = Object.freeze(new Set(["accepted", "booked"]));
export const MIN_SAMPLE_SIZE = 3;
const MAX_RENTAL_SUGGESTIONS = 5;
const RENTAL_MAJORITY_THRESHOLD = 0.5;

// Fixed, documented bands rather than a percentage window, so "similar
// size" means the same thing on every quote and is trivial to reason
// about and test.
export const GUEST_BANDS = Object.freeze([
  [1, 49], [50, 99], [100, 149], [150, 199], [200, 299], [300, 499], [500, Infinity]
]);

export function guestBandFor(guests) {
  const value = Number(guests);
  if (!(value > 0)) return null;
  const band = GUEST_BANDS.find(([min, max]) => value >= min && value <= max);
  return band ? `${band[0]}-${band[1] === Infinity ? "plus" : band[1]}` : null;
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function roundToHalf(value) {
  return Math.round(value * 2) / 2;
}

function matchingQuotes(quotes, eventTypeId, band) {
  return (Array.isArray(quotes) ? quotes : []).filter((quote) => {
    if (!BOOKED_STATUSES.has(String(quote?.status || ""))) return false;
    if (String(quote?.eventTypeId || "").trim() !== eventTypeId) return false;
    return guestBandFor(quote?.event?.guests) === band;
  });
}

function majorityRentals(matches) {
  if (!matches.length) return [];
  const counts = new Map();
  for (const quote of matches) {
    const selection = quote?.selection || {};
    const snapshots = Array.isArray(selection.rentalSnapshots) ? selection.rentalSnapshots : [];
    const ids = Array.isArray(selection.rentals) ? selection.rentals : [];
    const seen = new Set();
    // Prefer id+name pairs from snapshots (appliable and displayable);
    // fall back to bare ids (appliable, generic display) so a quote
    // whose snapshot lacks names still counts toward frequency.
    for (const item of snapshots) {
      const id = String(item?.id || "").trim();
      const name = String(item?.name || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const entry = counts.get(id) || { id, name: name || id, count: 0 };
      entry.count += 1;
      if (name) entry.name = name;
      counts.set(id, entry);
    }
    for (const id of ids) {
      const key = String(id || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key) || { id: key, name: key, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()]
    .filter((entry) => entry.count / matches.length > RENTAL_MAJORITY_THRESHOLD)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, MAX_RENTAL_SUGGESTIONS);
}

// Pure: takes already-fetched quotes (the impure boundary is
// loadEventShapeMemory below) and the current draft's event type and
// guest count. Returns null only when the inputs themselves are
// unusable (no event type, no positive guest count) — a genuinely empty
// or below-threshold history is a real, reportable outcome, not null.
export function buildEventShapeMemory({ quotes = [], eventTypeId = "", guests = 0 } = {}) {
  const normalizedEventTypeId = String(eventTypeId || "").trim();
  const band = guestBandFor(guests);
  if (!normalizedEventTypeId || !band) return null;

  const matches = matchingQuotes(quotes, normalizedEventTypeId, band);
  const sampleSize = matches.length;
  const sufficient = sampleSize >= MIN_SAMPLE_SIZE;

  return {
    modelId: EVENT_SHAPE_MEMORY_MODEL,
    eventTypeId: normalizedEventTypeId,
    band,
    sampleSize,
    sufficient,
    staffing: sufficient
      ? {
          servers: Math.round(median(matches.map((q) => Number(q.event?.servers) || 0))),
          chefs: Math.round(median(matches.map((q) => Number(q.event?.chefs) || 0))),
          bartenders: Math.round(median(matches.map((q) => Number(q.event?.bartenders) || 0)))
        }
      : null,
    hours: sufficient
      ? roundToHalf(median(matches.map((q) => Number(q.event?.hours) || 0)))
      : null,
    rentals: sufficient ? majorityRentals(matches) : []
  };
}

// The impure boundary: fetches the tenant's own booked history for the
// exact event type (server-side scoped and filtered), then hands it to
// the pure builder above. A generous limit keeps the aggregate honest
// for tenants with a long history without an unbounded read.
export async function loadEventShapeMemory({ organizationId, eventTypeId, guests }) {
  const { quotes } = await getQuoteHistory({
    organizationId,
    eventTypeId,
    limitCount: 200,
    persistExpiredStatuses: true
  });
  return buildEventShapeMemory({ quotes, eventTypeId, guests });
}
