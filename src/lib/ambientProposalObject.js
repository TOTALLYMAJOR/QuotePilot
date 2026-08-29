import { createIntelligentObjectDescriptor } from "./ambientContracts";
import { buildStaffProposalPreview } from "./customerWorkspace";
import { buildProposalReadiness } from "./quoteWorkflow";

export const AMBIENT_PROPOSAL_OBJECT_MODEL = "ambient-proposal-object-v1";

const STAFF_ROLES = new Set(["admin", "sales"]);
const QUOTE_STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "booked",
  "expired"
]);
const RECOVERABLE_DELIVERY_STATES = new Set([
  "failed",
  "outcome_ambiguous",
  "outcome_unknown",
  "reconciled_not_sent"
]);
const KNOWN_DELIVERY_STATES = new Set([
  "",
  "sending",
  "provider_accepted",
  ...RECOVERABLE_DELIVERY_STATES
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function lower(value) {
  return text(value).toLowerCase();
}

function iso(value) {
  const candidate = text(value);
  if (!candidate) return "";
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validTime(value) {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  return Boolean(match) && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function malformedQuoteFields(quote) {
  const issues = [];
  for (const [label, value] of [
    ["customer name", quote?.customer?.name],
    ["customer email", quote?.customer?.email],
    ["customer phone", quote?.customer?.phone],
    ["event name", quote?.event?.name],
    ["event date", quote?.event?.date],
    ["event time", quote?.event?.time],
    ["event venue", quote?.event?.venue]
  ]) {
    if (value !== undefined && value !== null && typeof value !== "string") issues.push(label);
  }
  for (const [label, value] of [
    ["guest count", quote?.event?.guests],
    ["event duration", quote?.event?.hours],
    ["subtotal", quote?.totals?.subtotal],
    ["tax", quote?.totals?.tax],
    ["total", quote?.totals?.total],
    ["deposit", quote?.totals?.deposit],
    ["authoritative total", quote?.pricing?.grandTotal]
  ]) {
    if (value !== undefined && value !== null && !finiteNonNegative(value)) issues.push(label);
  }
  for (const [label, value] of [
    ["menu item identifiers", quote?.selection?.menuItems],
    ["menu item names", quote?.selection?.menuItemNames]
  ]) {
    if (value !== undefined && value !== null && !Array.isArray(value)) issues.push(label);
  }
  for (const [label, value] of [
    ["customer record", quote?.customer],
    ["event record", quote?.event],
    ["selection record", quote?.selection],
    ["totals record", quote?.totals],
    ["pricing record", quote?.pricing],
    ["workflow record", quote?.workflow],
    ["delivery record", quote?.workflow?.quoteDelivery]
  ]) {
    if (value !== undefined && value !== null && !isRecord(value)) issues.push(label);
  }
  return [...new Set(issues)];
}

function normalizeRole(role) {
  const normalized = lower(role);
  return STAFF_ROLES.has(normalized) ? normalized : "customer";
}

function normalizedVersion(quote) {
  const explicit = text(quote?.activeVersionId || quote?.versionMeta?.versionId);
  if (explicit) return explicit;
  const number = Number(quote?.latestVersionNumber || quote?.versionMeta?.versionNumber);
  return Number.isSafeInteger(number) && number > 0
    ? `v${String(number).padStart(4, "0")}`
    : "";
}

function expectedDeliveryRevision(quote, versionId) {
  const portalIdentity = iso(quote?.portalIssuedAtISO) || text(quote?.portalKey).slice(0, 64);
  return versionId && portalIdentity ? `${versionId}@${portalIdentity}` : versionId;
}

function savedQuoteEvidence(quote, { sourceMode, sourceFreshness }) {
  const connected = sourceMode === "firebase";
  const quoteId = text(quote?.id || quote?.quoteId);
  const organizationId = text(quote?.organizationId);
  const quoteNumber = text(quote?.quoteNumber);
  const versionId = normalizedVersion(quote);
  const observedAtISO = iso(quote?.updatedAtISO || quote?.createdAtISO);
  const status = lower(quote?.status || "draft");
  const malformedFields = [];
  if (!quoteId) malformedFields.push("quote id");
  if (!organizationId) malformedFields.push("organization id");
  if (!quoteNumber) malformedFields.push("quote number");
  if (!versionId) malformedFields.push("active immutable revision");
  if (!observedAtISO) malformedFields.push("saved timestamp");
  if (!QUOTE_STATUSES.has(status)) malformedFields.push("quote lifecycle state");
  malformedFields.push(...malformedQuoteFields(quote));

  let state = "exact_current";
  let reason = "The selected Firebase quote identifies its tenant, quote, immutable revision, lifecycle state, and saved timestamp.";
  if (malformedFields.length > 0) {
    state = "malformed";
    reason = `The selected quote is missing or malformed: ${malformedFields.join(", ")}.`;
  } else if (!connected) {
    state = "local_unverified";
    reason = "The browser-local quote can support a read-only preview, but it is not exact connected saved-revision evidence.";
  } else if (sourceFreshness === "stale") {
    state = "stale";
    reason = "The caller identified this connected quote snapshot as stale. Refresh the exact opportunity before relying on it.";
  } else if (sourceFreshness !== "fresh") {
    state = "malformed";
    reason = "Quote source freshness is unknown, so current-revision evidence cannot be established.";
  }

  return deepFreeze({
    state,
    quoteId,
    organizationId,
    quoteNumber,
    versionId,
    status,
    observedAtISO,
    malformedFields,
    exact: state === "exact_current",
    reason
  });
}

function pricingEvidence(quote, savedEvidence) {
  const pricing = isRecord(quote?.pricing) ? quote.pricing : {};
  const authority = lower(pricing.authority);
  const calculatedAtISO = iso(pricing.calculatedAt);
  const pricedTotal = Number(pricing.grandTotal);
  const savedTotal = Number(quote?.totals?.total);
  const amountMatches = finiteNonNegative(pricedTotal)
    && finiteNonNegative(savedTotal)
    && Math.abs(pricedTotal - savedTotal) < 0.005;

  let state = "current_authoritative";
  let reason = "The exact saved quote carries server-authoritative pricing that reconciles to the customer total.";
  if (savedEvidence.state !== "exact_current") {
    state = savedEvidence.state === "stale"
      ? "stale"
      : savedEvidence.state === "local_unverified"
        ? "local_unverified"
        : "unavailable";
    reason = savedEvidence.state === "local_unverified"
      ? "A saved pricing record is visible locally, but authoritative proposal pricing requires the exact current connected saved revision."
      : "Authoritative proposal pricing requires the exact current connected saved revision.";
  } else if (authority !== "server_authoritative") {
    state = "requires_authoritative_reprice";
    reason = "The saved quote does not carry server-authoritative pricing.";
  } else if (!calculatedAtISO || !amountMatches) {
    state = "malformed";
    reason = "The authoritative pricing timestamp or total does not reconcile with the saved customer total.";
  }
  return deepFreeze({
    state,
    authority: authority || "unavailable",
    calculatedAtISO,
    total: amountMatches ? savedTotal : null,
    reason,
    current: state === "current_authoritative"
  });
}

function projectionEvidence(quote, savedEvidence, readiness) {
  let projection = null;
  let buildError = "";
  try {
    projection = buildStaffProposalPreview(quote);
  } catch (error) {
    buildError = text(error?.message) || "The staff proposal projection could not be built.";
  }
  const fields = projection ? {
    quoteNumber: text(projection.quoteNumber),
    customerName: text(projection.customerName),
    eventName: text(projection.eventName),
    eventDate: text(projection.eventDate),
    eventTime: text(quote?.event?.time),
    venue: text(projection.venue),
    guests: finiteNonNegative(projection.guests) && projection.guests > 0 ? projection.guests : null,
    subtotal: finiteNonNegative(projection.subtotal) ? projection.subtotal : null,
    tax: finiteNonNegative(projection.tax) ? projection.tax : null,
    total: finiteNonNegative(projection.total) && projection.total > 0 ? projection.total : null,
    deposit: finiteNonNegative(projection.deposit) ? projection.deposit : null,
    brandName: text(projection.branding?.brandName || projection.branding?.organizationName)
  } : null;
  const required = [
    ["quote number", fields?.quoteNumber],
    ["customer name", fields?.customerName],
    ["event name", fields?.eventName],
    ["valid event date", validDate(fields?.eventDate)],
    ["valid event time", validTime(fields?.eventTime)],
    ["venue", fields?.venue],
    ["guest count", fields?.guests],
    ["total", fields?.total]
  ];
  const missingFields = required.filter(([, value]) => !value).map(([label]) => label);

  let state = readiness.gaps.length === 0 && missingFields.length === 0 ? "available" : "partial";
  let reason = state === "available"
    ? "The read-only staff projection shows the exact customer-visible identity, event details, and pricing summary from this quote."
    : `The projection is incomplete: ${[...missingFields, ...readiness.gaps.map((gap) => gap.label)].filter((value, index, all) => all.indexOf(value) === index).join(", ") || "required proposal fields"}.`;
  if (!projection || buildError) {
    state = "unavailable";
    reason = buildError || "The staff proposal projection is unavailable.";
  } else if (savedEvidence.state === "stale") {
    state = "stale";
    reason = "The customer projection was built from a stale connected quote snapshot and cannot be treated as current.";
  } else if (savedEvidence.state === "malformed") {
    state = "unavailable";
    reason = "The malformed quote identity prevents an exact customer projection.";
  } else if (savedEvidence.state === "local_unverified") {
    state = "local_preview";
    reason = "This read-only browser preview is not an exact connected customer-portal projection.";
  }

  return deepFreeze({
    state,
    fields,
    missingFields,
    readinessGapIds: readiness.gaps.map((gap) => gap.id),
    recommendedGapIds: readiness.recommendedGaps.map((gap) => gap.id),
    exactCurrent: state === "available" && savedEvidence.exact,
    reason,
    boundary: "Opening this projection does not send a message, issue a portal, establish provider acceptance, or create customer viewed evidence."
  });
}

function portalEvidence(quote, savedEvidence, nowISO) {
  const portalKey = text(quote?.portalKey);
  const issuedAtISO = iso(quote?.portalIssuedAtISO);
  const expiresAtISO = iso(quote?.portalExpiresAtISO || quote?.expiresAtISO);
  const presentCount = [portalKey, text(quote?.portalIssuedAtISO), text(quote?.portalExpiresAtISO || quote?.expiresAtISO)]
    .filter(Boolean).length;
  const delivery = isRecord(quote?.workflow?.quoteDelivery) ? quote.workflow.quoteDelivery : {};
  const activation = lower(delivery.portalActivationState);
  const expectedRevisionId = expectedDeliveryRevision(quote, savedEvidence.versionId);
  const deliveryRevisionId = text(delivery.revisionId);
  const nowTimestamp = Date.parse(nowISO);
  const expiryTimestamp = Date.parse(expiresAtISO);

  let state = "current";
  let reason = "The quote records a structurally valid portal issuance for the selected immutable revision.";
  // Quote hydration may supply bounded default issue/expiry dates even when no
  // portal token has ever existed. Dates alone are neither issuance nor
  // malformed customer access evidence: without a usable key the truthful
  // state is absent, and governed send remains blocked until issuance exists.
  if (!portalKey) {
    state = "absent";
    reason = "No customer portal token is recorded for this quote. Dates alone do not establish an issuance.";
  } else if (presentCount !== 3 || portalKey.length < 20 || !issuedAtISO || !expiresAtISO) {
    state = "malformed";
    reason = "The portal key, issue time, or expiry evidence is incomplete or malformed.";
  } else if (!Number.isFinite(nowTimestamp)) {
    state = "malformed";
    reason = "The current time is invalid, so portal expiry cannot be evaluated.";
  } else if (expiryTimestamp <= nowTimestamp) {
    state = "expired";
    reason = "The recorded portal issuance has expired and must not be presented as customer-accessible.";
  } else if (deliveryRevisionId && deliveryRevisionId !== expectedRevisionId) {
    state = "stale_revision";
    reason = "The recorded delivery evidence belongs to a different quote or portal revision.";
  } else if (activation === "requires_rotation") {
    state = "requires_rotation";
    reason = "Provider acceptance did not activate this exact portal issuance; governed rotation is required before another send.";
  } else if (activation && activation !== "active") {
    state = "malformed";
    reason = "The portal activation state is not recognized.";
  } else if (!savedEvidence.exact) {
    state = savedEvidence.state === "stale" ? "stale" : "local_unverified";
    reason = "Portal structure is visible, but current connected saved-revision evidence is unavailable.";
  }
  return deepFreeze({
    state,
    keyPresent: portalKey.length >= 20,
    issuedAtISO,
    expiresAtISO,
    expectedRevisionId,
    reason,
    current: state === "current"
  });
}

function deliveryEvidence(quote, savedEvidence, portal) {
  const delivery = isRecord(quote?.workflow?.quoteDelivery) ? quote.workflow.quoteDelivery : {};
  const state = lower(delivery.state);
  const revisionId = text(delivery.revisionId);
  const providerAcceptedAtISO = iso(delivery.providerAcceptedAtISO);
  const providerMessagePresent = Boolean(text(delivery.providerMessageId));
  const matchesPortal = text(delivery.portalKey) === text(quote?.portalKey)
    && iso(delivery.portalIssuedAtISO) === iso(quote?.portalIssuedAtISO);
  const exactProviderReceipt = state === "provider_accepted"
    && savedEvidence.exact
    && revisionId === portal.expectedRevisionId
    && providerMessagePresent
    && Boolean(providerAcceptedAtISO)
    && matchesPortal;
  const exactProviderAcceptance = exactProviderReceipt
    && portal.current
    && lower(delivery.portalActivationState) === "active";

  let evidenceState = state || "not_recorded";
  let reason = state
    ? `The saved quote records delivery state ${state.replaceAll("_", " ")}.`
    : "No provider delivery attempt is recorded for this exact revision.";
  if (state && !KNOWN_DELIVERY_STATES.has(state)) {
    evidenceState = "malformed";
    reason = "The recorded provider delivery state is not recognized.";
  } else if (revisionId && revisionId !== portal.expectedRevisionId) {
    evidenceState = "stale_revision";
    reason = "Delivery evidence belongs to another quote or portal revision.";
  } else if (!savedEvidence.exact && state && savedEvidence.state !== "malformed") {
    evidenceState = savedEvidence.state === "stale" ? "stale" : "local_unverified";
    reason = "Delivery-shaped fields are visible without exact current connected saved-revision evidence.";
  } else if (
    exactProviderReceipt
    && ["requires_rotation", "expired"].includes(portal.state)
  ) {
    evidenceState = "provider_accepted_portal_inactive";
    reason = "The provider accepted the exact delivery attempt, but the matching customer portal is inactive and requires governed rotation before another send.";
  } else if (state === "provider_accepted" && !exactProviderAcceptance) {
    evidenceState = "malformed";
    reason = "Provider-accepted state lacks exact current revision, portal, message, or timestamp evidence.";
  } else if (exactProviderAcceptance) {
    evidenceState = "provider_accepted";
    reason = "The provider accepted the exact current proposal delivery attempt and the matching portal issuance is active.";
  }
  return deepFreeze({
    state: evidenceState,
    providerMessagePresent: exactProviderReceipt,
    providerAcceptedAtISO: exactProviderReceipt ? providerAcceptedAtISO : "",
    reason,
    boundary: "Provider acceptance is not delivered, viewed, replied, accepted, paid, or booked evidence."
  });
}

function action(id, label, availability, authority, reason, consequence, nextResolution) {
  return deepFreeze({ id, label, availability, authority, reason, consequence, nextResolution });
}

function actionAvailability({ role, saved, pricing, projection, readiness, portal, delivery }) {
  const staff = STAFF_ROLES.has(role);
  const admin = role === "admin";
  const coreReady = staff
    && saved.exact
    && pricing.current
    && projection.exactCurrent
    && readiness.complete;
  const blockedCoreReason = !staff
    ? "Staff role is required."
    : !saved.exact
      ? saved.reason
      : !pricing.current
        ? pricing.reason
        : !projection.exactCurrent
          ? projection.reason
          : !readiness.complete
            ? `Resolve ${readiness.gaps.length} proposal completeness ${readiness.gaps.length === 1 ? "gap" : "gaps"}.`
            : "The proposal is not ready.";

  const prepare = coreReady
    ? action(
        "prepare-proposal",
        "Prepare current proposal",
        "available",
        "staff_artifact",
        "The exact connected saved revision is complete and carries reconciled server-authoritative pricing.",
        "Preparation may create a staff artifact or read-only preview, but it does not send, publish, or create customer activity evidence.",
        "Open the governed prepare flow for this exact revision."
      )
    : action(
        "prepare-proposal",
        "Prepare current proposal",
        "blocked",
        "staff_artifact",
        blockedCoreReason,
        "No proposal artifact should be treated as current until the blocker is resolved.",
        "Resolve the named evidence gap, then rebuild this object."
      );

  const deliveryRecoverable = RECOVERABLE_DELIVERY_STATES.has(delivery.state);
  const send = !admin
    ? action(
        "send-proposal",
        "Send current proposal",
        "blocked",
        "admin_provider",
        "Admin authority is required for provider communication.",
        "No message or lifecycle state changes.",
        "Ask an admin to review the exact current proposal."
      )
    : !coreReady
      ? action(
          "send-proposal",
          "Send current proposal",
          "blocked",
          "admin_provider",
          blockedCoreReason,
          "No provider communication should begin from incomplete or non-authoritative evidence.",
          "Resolve the named evidence gap, then rebuild this object."
        )
      : !portal.current
        ? action(
            "send-proposal",
            "Send current proposal",
            "blocked",
            "admin_provider",
            portal.reason,
            "The current proposal is not eligible for a provider send until its exact portal issuance is safe.",
            "Resolve or rotate the exact portal issuance in the governed workflow."
          )
        : deliveryRecoverable
          ? action(
              "send-proposal",
              "Send current proposal",
              "blocked",
              "admin_provider",
              delivery.reason,
              "A new attempt could obscure an unresolved provider outcome.",
              "Recover or reconcile the recorded delivery attempt first."
            )
          : delivery.state === "provider_accepted"
            ? action(
                "send-proposal",
                "Send current proposal",
                "not_needed",
                "admin_provider",
                "The provider already accepted the exact current proposal delivery attempt.",
                "No duplicate send is recommended from this descriptive object.",
                "Review delivery evidence or prepare a new immutable revision if content must change."
              )
            : action(
                "send-proposal",
                "Send current proposal",
                "governed_resolution",
                "admin_provider",
                "The proposal evidence is eligible for the governed send workflow, subject to live provider configuration, approval, revision, and idempotency checks.",
                "Only the existing trusted provider command may attempt delivery and return a receipt.",
                "Open the exact send review; do not execute from this object."
              );

  const rotationNeeded = ["expired", "requires_rotation", "stale_revision", "malformed"].includes(portal.state);
  const rotate = !rotationNeeded
    ? action(
        "rotate-proposal-portal",
        "Rotate proposal portal",
        "not_needed",
        "admin_trusted",
        "The current evidence does not identify a portal-rotation condition.",
        "No portal issuance changes.",
        "Continue with proposal preparation or the next governed resolution."
      )
    : !admin || !saved.exact
      ? action(
          "rotate-proposal-portal",
          "Rotate proposal portal",
          "blocked",
          "admin_trusted",
          !admin ? "Admin authority is required to rotate portal links." : saved.reason,
          "No portal key or issuance changes.",
          "Refresh the exact revision or ask an admin to use the governed rotation workflow."
        )
      : action(
          "rotate-proposal-portal",
          "Rotate proposal portal",
          "governed_resolution",
          "admin_trusted",
          portal.reason,
          "The existing approval and rotation command must issue a new token and preserve the previous issuance as inactive evidence.",
          "Open the exact portal-rotation approval for this quote."
        );

  const recover = !deliveryRecoverable
    ? action(
        "recover-proposal-delivery",
        "Recover proposal delivery",
        "not_needed",
        "admin_provider",
        "No recoverable provider outcome is recorded for this exact revision.",
        "No delivery state changes.",
        "Continue with the next exact proposal resolution."
      )
    : !admin || !saved.exact
      ? action(
          "recover-proposal-delivery",
          "Recover proposal delivery",
          "blocked",
          "admin_provider",
          !admin ? "Admin authority is required to reconcile provider delivery." : saved.reason,
          "The unresolved provider state remains unchanged.",
          "Refresh the exact revision or ask an admin to open provider reconciliation."
        )
      : action(
          "recover-proposal-delivery",
          "Recover proposal delivery",
          "governed_resolution",
          "admin_provider",
          delivery.reason,
          "Only audited provider reconciliation may resolve ambiguity or establish provider acceptance.",
          "Open the exact delivery recovery flow for this recorded attempt."
        );

  return deepFreeze([prepare, send, rotate, recover]);
}

function overallState(saved, pricing, projection, portal, delivery) {
  if ([saved.state, pricing.state, projection.state, portal.state, delivery.state]
    .some((state) => ["malformed", "unavailable"].includes(state))) return "unavailable";
  if ([saved.state, pricing.state, projection.state, portal.state, delivery.state]
    .some((state) => ["stale", "stale_revision"].includes(state))) return "stale";
  if ([saved.state, projection.state, portal.state, delivery.state]
    .some((state) => ["local_unverified", "local_preview"].includes(state))) return "local_preview";
  if (!projection.exactCurrent || !pricing.current || !portal.current) return "needs_resolution";
  return "current";
}

export function buildAmbientProposalObject(quote = {}, {
  sourceMode = "local",
  sourceFreshness = "fresh",
  role = "sales",
  nowISO = new Date().toISOString()
} = {}) {
  const normalizedSource = lower(sourceMode) === "firebase" ? "firebase" : "local";
  const normalizedFreshness = lower(sourceFreshness);
  const normalizedRole = normalizeRole(role);
  const safeQuote = isRecord(quote) ? quote : {};
  const readiness = deepFreeze(buildProposalReadiness(safeQuote, safeQuote.totals));
  const saved = savedQuoteEvidence(safeQuote, {
    sourceMode: normalizedSource,
    sourceFreshness: normalizedFreshness
  });
  const pricing = pricingEvidence(safeQuote, saved);
  const projection = projectionEvidence(safeQuote, saved, readiness);
  const portal = portalEvidence(safeQuote, saved, iso(nowISO) || text(nowISO));
  const delivery = deliveryEvidence(safeQuote, saved, portal);
  const actions = actionAvailability({
    role: normalizedRole,
    saved,
    pricing,
    projection,
    readiness,
    portal,
    delivery
  });
  const state = overallState(saved, pricing, projection, portal, delivery);
  const actionById = Object.fromEntries(actions.map((entry) => [entry.id, entry]));
  const descriptor = createIntelligentObjectDescriptor({
    id: "proposal",
    type: "customer-decision-artifact",
    label: "Proposal",
    summary: readiness.complete
      ? readiness.recommendedGaps.length > 0
        ? `All required proposal details are present. ${readiness.recommendedGaps.length} recommended contact ${readiness.recommendedGaps.length === 1 ? "detail is" : "details are"} still available to add.`
        : "All required proposal details are present. The customer view and delivery details remain separate."
      : `${readiness.gaps.length} required proposal ${readiness.gaps.length === 1 ? "detail needs" : "details need"} attention.`,
    inspectorSurfaceId: "proposal-context",
    dependencies: [
      {
        object: { id: "pricing", type: "intelligent-object", label: "Pricing" },
        relationship: "defines customer totals and deposit requirements",
        consequence: "Any scope change requires authoritative repricing before this proposal can be current."
      },
      {
        object: { id: "customer-identity", type: "customer-evidence", label: "Customer identity" },
        relationship: "identifies the intended decision maker",
        consequence: "Missing or invalid customer identity blocks a truthful current proposal."
      },
      {
        object: { id: "portal-issuance", type: "customer-access-evidence", label: "Portal issuance" },
        relationship: "binds customer access to one exact immutable revision",
        consequence: "Expiry, mismatch, or inactive issuance requires governed recovery or rotation."
      },
      {
        object: { id: "provider-delivery", type: "communication-evidence", label: "Provider delivery" },
        relationship: "records provider acceptance separately from customer activity",
        consequence: "Provider acceptance cannot establish delivered, viewed, replied, accepted, paid, or booked state."
      }
    ],
    why: "Proposal details, the customer view, customer-link status, and email delivery stay separate so one cannot stand in for another.",
    consequence: "Preparing may create a staff copy. Sending, replacing the customer link, and delivery recovery happen in their existing controls, which recheck access, quote version, current pricing, customer link, and delivery state.",
    doNothing: readiness.complete
      ? readiness.recommendedGaps.length > 0
        ? "The saved proposal remains unchanged and ready for governed review; the recommended contact detail remains blank."
        : "The saved proposal and every customer, portal, delivery, acceptance, and payment evidence domain remain unchanged."
      : `The ${readiness.gaps.length} recorded completeness ${readiness.gaps.length === 1 ? "gap remains" : "gaps remain"}; nothing is repriced, published, or sent.`,
    confidence: {
      level: state === "current" ? "high" : state === "local_preview" ? "low" : state === "needs_resolution" ? "medium" : "unavailable",
      basis: state === "current"
        ? "Exact connected saved-revision identity, authoritative pricing, customer projection, and portal evidence are internally consistent."
        : state === "local_preview"
          ? "An unsaved customer view is available; the connected quote version and delivery details are not confirmed."
          : state === "needs_resolution"
            ? "The object is readable, but one or more completeness, pricing, projection, or portal conditions require resolution."
            : "Malformed or stale evidence prevents a current proposal conclusion."
    },
    provenance: [{
      sourceId: `quote-proposal:${saved.quoteId || "unknown"}:${saved.versionId || "unknown"}`,
      label: saved.exact ? "Exact connected saved proposal revision" : "Bounded proposal source",
      type: saved.exact ? "firebase_quote_revision" : normalizedSource === "local" ? "local_quote_snapshot" : "incomplete_quote_snapshot",
      state: ["malformed"].includes(saved.state) ? "unavailable" : saved.state === "stale" ? "stale" : "available",
      observedAt: saved.observedAtISO || null,
      reason: saved.state === "malformed" || saved.state === "stale" ? saved.reason : null
    }],
    recommendation: readiness.gaps[0]
      ? {
          summary: `Resolve ${readiness.gaps[0].label.toLowerCase()} before preparing or sending the proposal.`,
          actionId: `resolve-proposal-gap-${readiness.gaps[0].id}`
        }
      : readiness.recommendedGaps[0]
        ? {
            summary: `Add ${readiness.recommendedGaps[0].label.toLowerCase()} when it would help follow-up; it does not block preparation or sending.`,
            actionId: `review-proposal-recommendation-${readiness.recommendedGaps[0].id}`
          }
        : null,
    permissions: {
      view: STAFF_ROLES.has(normalizedRole),
      simulate: false,
      stage: false,
      commit: false,
      reason: STAFF_ROLES.has(normalizedRole)
        ? "This object is descriptive only. Existing governed workflows retain artifact, communication, portal, pricing, and recovery authority."
        : "Staff role is required to inspect proposal evidence."
    },
    actionIds: actions.map((entry) => entry.id)
  });

  return deepFreeze({
    modelId: AMBIENT_PROPOSAL_OBJECT_MODEL,
    state,
    sourceMode: normalizedSource,
    role: normalizedRole,
    descriptor,
    readiness,
    savedEvidence: saved,
    pricingEvidence: pricing,
    customerProjection: projection,
    portalEvidence: portal,
    deliveryEvidence: delivery,
    actions,
    actionById,
    boundary: "This model performs no I/O and grants no mutation, repricing, publication, provider, delivery, customer-activity, acceptance, payment, booking, or recovery authority."
  });
}
