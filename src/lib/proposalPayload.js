import { currency } from "./quoteCalculator";
import { sanitizeStripePaymentLink } from "./paymentLink";

const DEFAULT_BRANDING = {
  name: "",
  tagline: "",
  logoPath: "",
  crewMembers: []
};

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toRateArray(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => Math.round(toNumber(value, 0) * 100) / 100)
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function toDateLabel(iso) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

function toList(input) {
  return Array.isArray(input) ? input.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

// Mirrors proposalExport.js's resolvePortalLink, kept local (rather than
// imported) because proposalExport.js already imports from this file and a
// reverse import would create a cycle.
function resolvePortalLink(quote, basePortalUrl = "") {
  const portalKey = String(quote?.portalKey || "").trim();
  const base = String(basePortalUrl || "").trim();
  if (!portalKey || !base) return "";
  return `${base}?portal=${encodeURIComponent(portalKey)}`;
}

export function normalizeCrewMembers(input) {
  const source = Array.isArray(input) && input.length ? input : DEFAULT_BRANDING.crewMembers;
  return source
    .map((member, idx) => ({
      label: cleanText(member?.label, `Team Member ${idx + 1}`),
      imagePath: cleanText(member?.imagePath ?? member?.imageUrl ?? "", "")
    }))
    .filter((member) => Boolean(member.label))
    .slice(0, 4);
}

export function resolveBranding(meta = {}) {
  const organizationName = cleanText(meta.organizationName, DEFAULT_BRANDING.name);
  const brandName = cleanText(meta.brandName, organizationName);
  const brandTagline = cleanText(meta.brandTagline, DEFAULT_BRANDING.tagline);
  return {
    brandName,
    brandTagline,
    title: brandName ? `${brandName} Proposal` : "Catering Proposal",
    logoPath: cleanText(meta.brandLogoUrl, DEFAULT_BRANDING.logoPath),
    crewMembers: normalizeCrewMembers(meta.brandCrew)
  };
}

export function buildProposalPayload(quote) {
  if (!quote) {
    throw new Error("Missing quote data for proposal payload.");
  }

  const meta = quote.quoteMeta || {};
  const branding = resolveBranding(meta);
  const validityDays = Math.max(1, Math.round(toNumber(meta.quoteValidityDays, 30)));

  return {
    quoteId: cleanText(quote.id),
    quoteNumber: cleanText(quote.quoteNumber, "your quote"),
    status: cleanText(quote.status, "draft"),
    createdAtISO: cleanText(quote.createdAtISO),
    expiresAtISO: cleanText(quote.expiresAtISO),
    createdOn: toDateLabel(quote.createdAtISO) || "-",
    expiresOn: toDateLabel(quote.expiresAtISO) || "-",
    customer: {
      name: cleanText(quote.customer?.name),
      email: cleanText(quote.customer?.email),
      phone: cleanText(quote.customer?.phone),
      organization: cleanText(quote.customer?.organization)
    },
    event: {
      name: cleanText(quote.event?.name),
      date: cleanText(quote.event?.date, "your event date"),
      time: cleanText(quote.event?.time),
      venue: cleanText(quote.event?.venue, "your venue"),
      venueAddress: cleanText(quote.event?.venueAddress),
      guests: toNumber(quote.event?.guests, 0),
      hours: toNumber(quote.event?.hours, 0),
      servers: toNumber(quote.event?.servers, 0),
      chefs: toNumber(quote.event?.chefs, 0),
      bartenders: toNumber(quote.event?.bartenders, 0),
      dietaryRestrictions: cleanText(quote.event?.dietaryRestrictions),
      style: cleanText(quote.event?.style)
    },
    selection: {
      packageId: cleanText(quote.selection?.packageId),
      packageName: cleanText(quote.selection?.packageName),
      addons: toList(quote.selection?.addons),
      rentals: toList(quote.selection?.rentals),
      menuItems: toList(quote.selection?.menuItems),
      menuItemNames: toList(quote.selection?.menuItemNames),
      milesRT: toNumber(quote.selection?.milesRT, 0),
      payMethod: cleanText(quote.selection?.payMethod),
      taxRegion: cleanText(quote.selection?.taxRegion),
      seasonProfileId: cleanText(quote.selection?.seasonProfileId),
      eventTemplateId: cleanText(quote.selection?.eventTemplateId, "custom"),
      laborRateSnapshot: {
        bartenderRateApplied: toNumber(quote.selection?.laborRateSnapshot?.bartenderRateApplied, 0),
        serverRateApplied: toNumber(quote.selection?.laborRateSnapshot?.serverRateApplied, 0),
        chefRateApplied: toNumber(quote.selection?.laborRateSnapshot?.chefRateApplied, 0),
        bartenderRateTypeId: cleanText(quote.selection?.laborRateSnapshot?.bartenderRateTypeId),
        bartenderRateTypeName: cleanText(quote.selection?.laborRateSnapshot?.bartenderRateTypeName),
        staffingRateTypeId: cleanText(quote.selection?.laborRateSnapshot?.staffingRateTypeId),
        staffingRateTypeName: cleanText(quote.selection?.laborRateSnapshot?.staffingRateTypeName)
      },
      bartenderRateTypeId: cleanText(quote.selection?.bartenderRateTypeId),
      staffingRateTypeId: cleanText(quote.selection?.staffingRateTypeId),
      bartenderRateOverride: toNumber(quote.selection?.bartenderRateOverride, 0),
      serverRateOverride: toNumber(quote.selection?.serverRateOverride, 0),
      chefRateOverride: toNumber(quote.selection?.chefRateOverride, 0),
      serverRateMixCsv: cleanText(quote.selection?.serverRateMixCsv),
      chefRateMixCsv: cleanText(quote.selection?.chefRateMixCsv)
    },
    payment: {
      depositLink: sanitizeStripePaymentLink(quote.payment?.depositLink),
      depositStatus: cleanText(quote.payment?.depositStatus, "unpaid")
    },
    totals: {
      base: toNumber(quote.totals?.base, 0),
      addons: toNumber(quote.totals?.addons, 0),
      rentals: toNumber(quote.totals?.rentals, 0),
      menu: toNumber(quote.totals?.menu, 0),
      labor: toNumber(quote.totals?.labor, 0),
      serverLabor: toNumber(quote.totals?.serverLabor, 0),
      chefLabor: toNumber(quote.totals?.chefLabor, 0),
      bartenderLabor: toNumber(quote.totals?.bartenderLabor, 0),
      bartenderRateApplied: toNumber(quote.totals?.bartenderRateApplied, 0),
      serverRateApplied: toNumber(quote.totals?.serverRateApplied, 0),
      serverRatesApplied: toRateArray(quote.totals?.serverRatesApplied),
      chefRateApplied: toNumber(quote.totals?.chefRateApplied, 0),
      chefRatesApplied: toRateArray(quote.totals?.chefRatesApplied),
      bartenderRateTypeId: cleanText(quote.totals?.bartenderRateTypeId),
      bartenderRateTypeName: cleanText(quote.totals?.bartenderRateTypeName),
      staffingRateTypeId: cleanText(quote.totals?.staffingRateTypeId),
      staffingRateTypeName: cleanText(quote.totals?.staffingRateTypeName),
      travel: toNumber(quote.totals?.travel, 0),
      serviceFee: toNumber(quote.totals?.serviceFee, 0),
      tax: toNumber(quote.totals?.tax, 0),
      total: toNumber(quote.totals?.total, 0),
      deposit: toNumber(quote.totals?.deposit, 0),
      serviceFeePctApplied: Object.prototype.hasOwnProperty.call(quote.totals || {}, "serviceFeePctApplied")
        ? toNumber(quote.totals?.serviceFeePctApplied, 0)
        : null,
      taxRateApplied: toNumber(quote.totals?.taxRateApplied, 0),
      taxRegionId: cleanText(quote.totals?.taxRegionId),
      taxRegionName: cleanText(quote.totals?.taxRegionName),
      seasonProfileId: cleanText(quote.totals?.seasonProfileId),
      seasonProfileName: cleanText(quote.totals?.seasonProfileName),
      packageMultiplier: toNumber(quote.totals?.packageMultiplier, 1),
      addonMultiplier: toNumber(quote.totals?.addonMultiplier, 1),
      rentalMultiplier: toNumber(quote.totals?.rentalMultiplier, 1)
    },
    meta: {
      organizationName: cleanText(meta.organizationName),
      quotePreparedBy: cleanText(meta.quotePreparedBy),
      acceptanceEmail: cleanText(meta.acceptanceEmail, cleanText(meta.businessEmail)),
      businessEmail: cleanText(meta.businessEmail),
      businessPhone: cleanText(meta.businessPhone),
      businessAddress: cleanText(meta.businessAddress),
      includeDisposables: meta.includeDisposables !== false,
      disposablesNote: cleanText(meta.disposablesNote),
      depositNotice: cleanText(meta.depositNotice),
      quoteValidityDays: validityDays,
      brandPrimaryColor: cleanText(meta.brandPrimaryColor),
      brandAccentColor: cleanText(meta.brandAccentColor),
      brandDarkAccentColor: cleanText(meta.brandDarkAccentColor)
    },
    branding
  };
}

export function buildQuoteEmailPayload(quote, { basePortalUrl = "", includePortalLink = false } = {}) {
  const proposal = buildProposalPayload(quote);
  const customerName = proposal.customer.name || "there";
  const eventDate = proposal.event.date || "your event date";
  const eventName = proposal.event.name || "your event";
  const venue = proposal.event.venue || "your venue";
  const brandName = proposal.branding.brandName;
  const signature = proposal.meta.quotePreparedBy || brandName || "The catering team";
  const total = currency(proposal.totals.total);
  const deposit = currency(proposal.totals.deposit);
  const subject = `${brandName ? `${brandName} ` : ""}Quote ${proposal.quoteNumber} - ${eventDate}`;
  const portalLink = includePortalLink === true ? resolvePortalLink(quote, basePortalUrl) : "";
  const lines = [
    `Hi ${customerName},`,
    "",
    `Thank you for considering ${brandName || "us"} for ${eventName} on ${eventDate} at ${venue}.`,
    `Your quote (${proposal.quoteNumber}) total is ${total}.`,
    `To reserve your date, the deposit due is ${deposit}.`,
    proposal.payment.depositLink
      ? `Deposit payment link: ${proposal.payment.depositLink}`
      : "Reply to this email if you need a payment link.",
    proposal.expiresOn !== "-" ? `This quote is valid through ${proposal.expiresOn}.` : "",
    portalLink ? `Review and accept your quote: ${portalLink}` : "",
    "",
    "Please reply with any questions or requested adjustments.",
    "",
    signature
  ].filter(Boolean);

  return {
    subject,
    body: lines.join("\n"),
    lines,
    proposal
  };
}
