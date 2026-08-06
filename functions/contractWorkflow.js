const BOOKING_CONFLICT_STATUSES = new Set(["accepted", "booked"]);
const DEFAULT_CAPACITY_LIMIT = 400;

class ContractWorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ContractWorkflowError";
    this.code = code;
  }
}

function text(value) {
  return String(value || "").trim();
}

function email(value) {
  return text(value).toLowerCase();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function venueKey(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function timeWindow(time, hours) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text(time));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const start = hour * 60 + minute;
  const duration = Math.max(0, number(hours, 0)) * 60;
  return { start, end: start + duration };
}

function windowsOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function normalizePeerQuote(item) {
  const source = item && typeof item === "object" ? item : {};
  return {
    ...source,
    id: text(source.id)
  };
}

function planContractConversion({
  quoteId = "",
  quote = {},
  peerQuotes = [],
  actorEmail = "",
  nowISO = "",
  contractNumber = "",
  capacityLimit = DEFAULT_CAPACITY_LIMIT
} = {}) {
  const id = text(quoteId);
  const actor = email(actorEmail);
  const convertedAtISO = text(nowISO);
  const nextContractNumber = text(contractNumber);
  const status = text(quote?.status).toLowerCase();
  const currentBooking = quote?.booking && typeof quote.booking === "object"
    ? quote.booking
    : {};
  const existingContractNumber = text(currentBooking.contractNumber);
  if (!id || !actor || !convertedAtISO || !nextContractNumber) {
    throw new ContractWorkflowError(
      "failed-precondition",
      "Contract conversion requires quote, server actor, timestamp, and contract identity."
    );
  }
  if (status === "booked" && existingContractNumber) {
    throw new ContractWorkflowError(
      "already-exists",
      "This quote is already converted to a contract."
    );
  }
  if (status !== "accepted" && status !== "booked") {
    throw new ContractWorkflowError(
      "failed-precondition",
      "Only accepted quotes can be converted to a contract."
    );
  }

  const selection = quote?.selection && typeof quote.selection === "object"
    ? quote.selection
    : {};
  const hasMenuSelection = [
    selection.menuItems,
    selection.menuItemsSnapshot,
    selection.menuItemNames,
    selection.menuItemDetails
  ].some((items) => (
    Array.isArray(items)
    && items.some((item) => text(typeof item === "object" ? item?.id || item?.name : item))
  ));
  if (!hasMenuSelection) {
    throw new ContractWorkflowError(
      "failed-precondition",
      "This accepted quote has no menu selection. Create and send a corrected replacement quote with at least one menu item before converting it to a contract."
    );
  }

  const event = quote?.event && typeof quote.event === "object" ? quote.event : {};
  const eventDate = text(event.date);
  const normalizedVenue = venueKey(event.venue);
  const requestedWindow = timeWindow(event.time, event.hours);
  const guestCount = Math.max(0, number(event.guests, 0));
  const maxCapacity = Math.max(1, number(capacityLimit, DEFAULT_CAPACITY_LIMIT));
  const conflicts = (Array.isArray(peerQuotes) ? peerQuotes : [])
    .map(normalizePeerQuote)
    .filter((peer) => peer.id && peer.id !== id)
    .filter((peer) => BOOKING_CONFLICT_STATUSES.has(text(peer.status).toLowerCase()))
    .filter((peer) => text(peer.event?.date) === eventDate)
    .filter((peer) => !normalizedVenue || venueKey(peer.event?.venue) === normalizedVenue)
    .map((peer) => {
      const peerWindow = timeWindow(peer.event?.time, peer.event?.hours);
      let reason = "same_day_venue";
      if (requestedWindow && peerWindow) {
        reason = windowsOverlap(requestedWindow, peerWindow) ? "time_overlap" : "time_clear";
      } else if (requestedWindow || peerWindow) {
        reason = "time_unknown";
      }
      return {
        id: peer.id,
        quoteNumber: text(peer.quoteNumber),
        status: text(peer.status).toLowerCase(),
        eventName: text(peer.event?.name),
        eventDate: text(peer.event?.date),
        eventTime: text(peer.event?.time),
        eventHours: Math.max(0, number(peer.event?.hours, 0)),
        venue: text(peer.event?.venue),
        customerName: text(peer.customer?.name),
        guests: Math.max(0, number(peer.event?.guests, 0)),
        reason
      };
    })
    .filter((item) => item.reason !== "time_clear");
  const sameVenueLoad = normalizedVenue
    ? conflicts.reduce((sum, item) => sum + item.guests, 0) + guestCount
    : 0;
  const capacityExceeded = Boolean(normalizedVenue) && sameVenueLoad > maxCapacity;
  const annotatedConflicts = conflicts.map((item) => ({
    ...item,
    capacityExceeded
  }));
  const bookedConflicts = annotatedConflicts.filter((item) => item.status === "booked");
  if (bookedConflicts.length) {
    const references = bookedConflicts
      .slice(0, 3)
      .map((item) => item.quoteNumber || item.id)
      .filter(Boolean);
    const suffix = references.length
      ? ` Existing booking(s): ${references.join(", ")}.`
      : "";
    throw new ContractWorkflowError(
      "failed-precondition",
      `Booking blocked: another contract is already booked for this date/venue.${suffix}`
    );
  }

  const availability = {
    conflicts: annotatedConflicts,
    hasBlockingConflict: false,
    capacityExceeded,
    capacityLimit: maxCapacity,
    sameVenueLoad
  };
  const availabilitySummary = {
    conflictCount: annotatedConflicts.length,
    acceptedConflictCount: annotatedConflicts.filter((item) => item.status === "accepted").length,
    bookedConflictCount: 0,
    capacityExceeded,
    sameVenueLoad,
    capacityLimit: maxCapacity
  };
  const booking = {
    ...currentBooking,
    bookedAtISO: text(currentBooking.bookedAtISO) || convertedAtISO,
    bookedByEmail: email(currentBooking.bookedByEmail) || actor,
    contractNumber: existingContractNumber || nextContractNumber,
    contractConvertedAtISO: text(currentBooking.contractConvertedAtISO) || convertedAtISO,
    contractConvertedByEmail: actor,
    confirmationStatus: text(currentBooking.confirmationStatus).toLowerCase() || "pending",
    availabilityCheckedAtISO: convertedAtISO,
    availabilitySummary
  };
  const lifecycle = {
    ...(quote?.lifecycle && typeof quote.lifecycle === "object" ? quote.lifecycle : {}),
    bookedAtISO: text(quote?.lifecycle?.bookedAtISO) || convertedAtISO
  };

  return {
    quotePatch: {
      status: "booked",
      booking,
      lifecycle,
      updatedAtISO: convertedAtISO
    },
    status: "booked",
    booking,
    lifecycle,
    contractNumber: booking.contractNumber,
    availability
  };
}

module.exports = {
  ContractWorkflowError,
  planContractConversion
};
