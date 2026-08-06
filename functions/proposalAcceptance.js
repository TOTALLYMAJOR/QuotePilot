const { createHash } = require("node:crypto");

const ACCEPTANCE_CONSENT_VERSION = "proposal-acceptance-v1";
const ACCEPTANCE_CONSENT_TEXT = "I agree to this proposal and consent to use my typed name as my electronic signature.";
const ACCEPTABLE_STATUSES = new Set(["sent", "viewed"]);

class ProposalAcceptanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProposalAcceptanceError";
    this.code = code;
  }
}

function text(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeISO(value) {
  const normalized = text(value, 64);
  const parsed = normalized ? new Date(normalized) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : "";
}

function moneyToMinor(value, fieldName) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ProposalAcceptanceError(
      "failed-precondition",
      `The proposal ${fieldName} is invalid and cannot be signed.`
    );
  }
  const minor = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(minor)) {
    throw new ProposalAcceptanceError(
      "failed-precondition",
      `The proposal ${fieldName} is outside the supported monetary range.`
    );
  }
  return minor;
}

function normalizeStringList(value, maxItems = 200) {
  return (Array.isArray(value) ? value : [])
    .slice(0, maxItems)
    .map((item) => text(item, 200))
    .filter(Boolean);
}

function assertCurrentDelivery({ quote, portal, portalKey, expectedRevisionId, expectedPortalIssuedAtISO }) {
  const delivery = quote?.workflow?.quoteDelivery || {};
  const evidence = portal?.deliveryEvidence || {};
  const revisionId = text(delivery.revisionId, 160);
  const portalIssuedAtISO = normalizeISO(quote?.portalIssuedAtISO);
  if (
    !revisionId
    || revisionId !== text(expectedRevisionId, 160)
    || revisionId !== text(evidence.revisionId, 160)
    || text(delivery.state, 32).toLowerCase() !== "provider_accepted"
    || text(delivery.portalActivationState, 32).toLowerCase() !== "active"
    || text(evidence.state, 32).toLowerCase() !== "provider_accepted"
    || text(evidence.portalActivationState, 32).toLowerCase() !== "active"
    || text(delivery.portalKey, 128) !== portalKey
    || text(evidence.portalKey, 128) !== portalKey
    || !portalIssuedAtISO
    || portalIssuedAtISO !== normalizeISO(expectedPortalIssuedAtISO)
    || portalIssuedAtISO !== normalizeISO(delivery.portalIssuedAtISO)
    || portalIssuedAtISO !== normalizeISO(portal?.portalIssuedAtISO)
    || portalIssuedAtISO !== normalizeISO(evidence.portalIssuedAtISO)
    || !normalizeISO(delivery.providerAcceptedAtISO)
    || normalizeISO(delivery.providerAcceptedAtISO) !== normalizeISO(evidence.providerAcceptedAtISO)
  ) {
    throw new ProposalAcceptanceError(
      "aborted",
      "This proposal changed after it was opened. Reload the current proposal before signing."
    );
  }
  return { revisionId, portalIssuedAtISO };
}

function buildSignedProposalSnapshot({ quoteId, quote, portal, revisionId, portalIssuedAtISO }) {
  const totals = quote?.totals || {};
  return {
    schemaVersion: 1,
    organizationId: text(quote?.organizationId, 128),
    quoteId: text(quoteId, 128),
    quoteNumber: text(quote?.quoteNumber, 80),
    revisionId,
    portalIssuedAtISO,
    customer: {
      name: text(quote?.customer?.name, 160),
      email: text(quote?.customer?.email, 320).toLowerCase()
    },
    event: {
      name: text(quote?.event?.name, 160),
      date: text(quote?.event?.date, 10),
      time: text(quote?.event?.time, 5),
      hours: Number(quote?.event?.hours || 0),
      guests: Number(quote?.event?.guests || 0),
      style: text(quote?.event?.style, 80),
      venue: text(quote?.event?.venue, 240),
      venueAddress: text(quote?.event?.venueAddress, 500)
    },
    selection: {
      packageName: text(quote?.selection?.packageName, 200),
      addons: normalizeStringList(
        quote?.selection?.addonSnapshots?.map((item) => item?.name)
          || portal?.selection?.addons
      ),
      rentals: normalizeStringList(
        quote?.selection?.rentalSnapshots?.map((item) => item?.name)
          || portal?.selection?.rentals
      ),
      menuItems: normalizeStringList(
        quote?.selection?.menuItemNames || portal?.selection?.menuItems
      )
    },
    currency: "USD",
    totalsMinor: {
      base: moneyToMinor(totals.base || 0, "base amount"),
      addons: moneyToMinor(totals.addons || 0, "add-on amount"),
      rentals: moneyToMinor(totals.rentals || 0, "rental amount"),
      menu: moneyToMinor(totals.menu || 0, "menu amount"),
      labor: moneyToMinor(totals.labor || 0, "labor amount"),
      travel: moneyToMinor(totals.travel || 0, "travel amount"),
      serviceFee: moneyToMinor(totals.serviceFee || 0, "service fee"),
      tax: moneyToMinor(totals.tax || 0, "tax amount"),
      total: moneyToMinor(totals.total, "total"),
      deposit: moneyToMinor(totals.deposit || 0, "deposit")
    }
  };
}

function buildPortalProposalSnapshot({ quoteId, portal, revisionId, portalIssuedAtISO }) {
  const totals = portal?.totals || {};
  return {
    schemaVersion: 1,
    organizationId: text(portal?.organizationId, 128),
    quoteId: text(quoteId, 128),
    quoteNumber: text(portal?.quoteNumber, 80),
    revisionId,
    portalIssuedAtISO,
    customer: {
      name: text(portal?.customerName, 160),
      email: text(portal?.customerEmail, 320).toLowerCase()
    },
    event: {
      name: text(portal?.eventName, 160),
      date: text(portal?.eventDate, 10),
      time: text(portal?.eventTime, 5),
      hours: Number(portal?.eventHours || 0),
      guests: Number(portal?.eventGuests || 0),
      style: text(portal?.eventStyle, 80),
      venue: text(portal?.venue, 240),
      venueAddress: text(portal?.venueAddress, 500)
    },
    selection: {
      packageName: text(portal?.selection?.packageName, 200),
      addons: normalizeStringList(portal?.selection?.addons),
      rentals: normalizeStringList(portal?.selection?.rentals),
      menuItems: normalizeStringList(portal?.selection?.menuItems)
    },
    currency: "USD",
    totalsMinor: {
      base: moneyToMinor(totals.base || 0, "base amount"),
      addons: moneyToMinor(totals.addons || 0, "add-on amount"),
      rentals: moneyToMinor(totals.rentals || 0, "rental amount"),
      menu: moneyToMinor(totals.menu || 0, "menu amount"),
      labor: moneyToMinor(totals.labor || 0, "labor amount"),
      travel: moneyToMinor(totals.travel || 0, "travel amount"),
      serviceFee: moneyToMinor(totals.serviceFee || 0, "service fee"),
      tax: moneyToMinor(totals.tax || 0, "tax amount"),
      total: moneyToMinor(portal?.total, "total"),
      deposit: moneyToMinor(portal?.deposit || 0, "deposit")
    }
  };
}

function assertCompleteProposalSnapshot(snapshot) {
  const eventDate = text(snapshot?.event?.date, 10);
  const eventDateValue = /^\d{4}-\d{2}-\d{2}$/.test(eventDate)
    ? new Date(`${eventDate}T12:00:00.000Z`)
    : null;
  if (
    !text(snapshot?.organizationId, 128)
    || !text(snapshot?.quoteId, 128)
    || !text(snapshot?.quoteNumber, 80)
    || !text(snapshot?.customer?.name, 160)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(snapshot?.customer?.email, 320))
    || !text(snapshot?.event?.name, 160)
    || !eventDateValue
    || Number.isNaN(eventDateValue.getTime())
    || eventDateValue.toISOString().slice(0, 10) !== eventDate
    || !Number.isFinite(snapshot?.event?.hours)
    || snapshot.event.hours < 0
    || !Number.isInteger(snapshot?.event?.guests)
    || snapshot.event.guests < 1
  ) {
    throw new ProposalAcceptanceError(
      "failed-precondition",
      "This proposal is incomplete and cannot be signed. Ask staff to correct and resend it."
    );
  }
}

function planProposalAcceptance({
  quoteId = "",
  quote = {},
  portal = {},
  portalKey = "",
  signerName = "",
  consentVersion = "",
  expectedRevisionId = "",
  expectedPortalIssuedAtISO = "",
  message = "",
  acceptedAtISO = "",
  receiptId = "",
  actor = {}
} = {}) {
  const normalizedQuoteId = text(quoteId, 128);
  const normalizedPortalKey = text(portalKey, 128);
  const normalizedSignerName = text(signerName, 160).replace(/\s+/g, " ");
  const normalizedAcceptedAtISO = normalizeISO(acceptedAtISO);
  const normalizedReceiptId = text(receiptId, 160);
  const quoteStatus = text(quote?.status, 32).toLowerCase();
  const portalStatus = text(portal?.status, 32).toLowerCase();
  const organizationId = text(quote?.organizationId, 128);

  if (!normalizedQuoteId || !normalizedPortalKey || !normalizedAcceptedAtISO || !normalizedReceiptId) {
    throw new ProposalAcceptanceError(
      "failed-precondition",
      "Proposal acceptance requires server quote, portal, timestamp, and receipt identities."
    );
  }
  if (normalizedSignerName.length < 2) {
    throw new ProposalAcceptanceError("invalid-argument", "Enter the signer’s full legal name.");
  }
  if (text(consentVersion, 80) !== ACCEPTANCE_CONSENT_VERSION) {
    throw new ProposalAcceptanceError(
      "failed-precondition",
      "The acceptance terms changed. Reload the proposal before signing."
    );
  }
  if (
    !organizationId
    || organizationId !== text(portal?.organizationId, 128)
    || normalizedQuoteId !== text(portal?.quoteId, 128)
    || normalizedPortalKey !== text(quote?.portalKey, 128)
    || normalizedPortalKey !== text(portal?.portalKey, 128)
  ) {
    throw new ProposalAcceptanceError("permission-denied", "Proposal portal identity is invalid.");
  }
  if (!ACCEPTABLE_STATUSES.has(quoteStatus) || !ACCEPTABLE_STATUSES.has(portalStatus)) {
    throw new ProposalAcceptanceError(
      "failed-precondition",
      "This proposal is no longer available for acceptance."
    );
  }
  if (quoteStatus !== portalStatus) {
    throw new ProposalAcceptanceError(
      "aborted",
      "The proposal status changed while it was being signed. Reload and try again."
    );
  }
  const expiresAtMs = Number(portal?.portalExpiresAtMs);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= new Date(normalizedAcceptedAtISO).getTime()) {
    throw new ProposalAcceptanceError("failed-precondition", "Quote link is invalid or expired.");
  }
  if (quote?.acceptanceReceipt || portal?.acceptanceReceipt) {
    throw new ProposalAcceptanceError("already-exists", "This proposal already has an acceptance receipt.");
  }

  const { revisionId, portalIssuedAtISO } = assertCurrentDelivery({
    quote,
    portal,
    portalKey: normalizedPortalKey,
    expectedRevisionId,
    expectedPortalIssuedAtISO
  });
  const proposalSnapshot = buildSignedProposalSnapshot({
    quoteId: normalizedQuoteId,
    quote,
    portal,
    revisionId,
    portalIssuedAtISO
  });
  assertCompleteProposalSnapshot(proposalSnapshot);
  const portalProposalSnapshot = buildPortalProposalSnapshot({
    quoteId: normalizedQuoteId,
    portal,
    revisionId,
    portalIssuedAtISO
  });
  if (JSON.stringify(portalProposalSnapshot) !== JSON.stringify(proposalSnapshot)) {
    throw new ProposalAcceptanceError(
      "aborted",
      "The displayed proposal no longer matches the saved revision. Reload before signing."
    );
  }
  const snapshotSha256 = createHash("sha256")
    .update(JSON.stringify(proposalSnapshot))
    .digest("hex");
  const portalDecision = {
    decision: "accepted",
    message: text(message, 1200),
    requestId: normalizedReceiptId,
    submittedAtISO: normalizedAcceptedAtISO
  };
  const acceptanceReceipt = {
    receiptId: normalizedReceiptId,
    signerName: normalizedSignerName,
    actor: {
      type: "customer_portal",
      uid: text(actor?.uid, 128),
      email: text(actor?.email, 320).toLowerCase()
    },
    consentVersion: ACCEPTANCE_CONSENT_VERSION,
    consentText: ACCEPTANCE_CONSENT_TEXT,
    acceptedAtISO: normalizedAcceptedAtISO,
    quoteRevisionId: revisionId,
    portalIssuedAtISO,
    quoteNumber: proposalSnapshot.quoteNumber,
    currency: "USD",
    totalMinor: proposalSnapshot.totalsMinor.total,
    depositMinor: proposalSnapshot.totalsMinor.deposit,
    snapshotSha256
  };
  const lifecycle = {
    ...(quote?.lifecycle && typeof quote.lifecycle === "object" ? quote.lifecycle : {}),
    acceptedAtISO: normalizedAcceptedAtISO
  };
  const patch = {
    status: "accepted",
    portalDecision,
    acceptanceReceipt,
    lifecycle,
    updatedAtISO: normalizedAcceptedAtISO
  };

  return {
    organizationId,
    quoteId: normalizedQuoteId,
    status: "accepted",
    portalDecision,
    acceptanceReceipt,
    proposalSnapshot,
    quotePatch: patch,
    portalPatch: {
      ...patch,
      lifecycle: {
        ...(portal?.lifecycle && typeof portal.lifecycle === "object" ? portal.lifecycle : {}),
        acceptedAtISO: normalizedAcceptedAtISO
      }
    },
    receiptDocument: {
      ...acceptanceReceipt,
      organizationId,
      quoteId: normalizedQuoteId,
      portalKeyHash: createHash("sha256").update(normalizedPortalKey).digest("hex"),
      proposalSnapshot
    }
  };
}

function matchesAcceptanceRetry({
  quote = {},
  portal = {},
  signerName = "",
  consentVersion = "",
  expectedRevisionId = "",
  expectedPortalIssuedAtISO = ""
} = {}) {
  const quoteReceipt = quote?.acceptanceReceipt || {};
  const portalReceipt = portal?.acceptanceReceipt || {};
  const normalizedSignerName = text(signerName, 160).replace(/\s+/g, " ");
  return (
    text(quote?.status, 32).toLowerCase() === "accepted"
    && text(portal?.status, 32).toLowerCase() === "accepted"
    && text(quote?.portalDecision?.decision, 32).toLowerCase() === "accepted"
    && text(portal?.portalDecision?.decision, 32).toLowerCase() === "accepted"
    && Boolean(text(quoteReceipt.receiptId, 160))
    && quoteReceipt.receiptId === portalReceipt.receiptId
    && text(quoteReceipt.signerName, 160) === normalizedSignerName
    && text(quoteReceipt.consentVersion, 80) === text(consentVersion, 80)
    && text(quoteReceipt.quoteRevisionId, 160) === text(expectedRevisionId, 160)
    && normalizeISO(quoteReceipt.portalIssuedAtISO) === normalizeISO(expectedPortalIssuedAtISO)
    && JSON.stringify(quoteReceipt) === JSON.stringify(portalReceipt)
  );
}

module.exports = {
  ACCEPTANCE_CONSENT_TEXT,
  ACCEPTANCE_CONSENT_VERSION,
  ProposalAcceptanceError,
  matchesAcceptanceRetry,
  moneyToMinor,
  planProposalAcceptance
};
