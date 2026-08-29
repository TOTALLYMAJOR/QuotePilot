import { createIntelligentObjectDescriptor } from "./ambientContracts";

export const AMBIENT_CONVERSATION_OBJECT_MODEL = "ambient-conversation-object-v1";

const STAFF_ROLES = new Set(["admin", "sales"]);
const ACTOR_TYPES = new Set(["staff", "customer"]);
const PROVIDER_EVENT_STATES = new Set([
  "provider_accepted",
  "delivered",
  "bounced",
  "complained"
]);
const FOLLOW_UP_STAGES = new Set([
  "new",
  "contacted",
  "proposal_sent",
  "awaiting_response",
  "won",
  "lost"
]);
const CONFIDENCE_LEVELS = new Set(["medium", "low"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function lower(value, maxLength = 500) {
  return text(value, maxLength).toLowerCase();
}

function iso(value) {
  const candidate = text(value, 64);
  if (!candidate) return "";
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function validDate(value) {
  const candidate = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return "";
  const [year, month, day] = candidate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? candidate
    : "";
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
}

function normalizedVersion(quote) {
  const explicit = text(quote?.activeVersionId || quote?.versionMeta?.versionId, 160);
  if (explicit) return explicit;
  const number = Number(quote?.latestVersionNumber || quote?.versionMeta?.versionNumber);
  return Number.isSafeInteger(number) && number > 0
    ? `v${String(number).padStart(4, "0")}`
    : "";
}

function revisionMatchesActiveVersion(revisionId, versionId) {
  const revision = text(revisionId, 160);
  const version = text(versionId, 160);
  return Boolean(version && (revision === version || revision.startsWith(`${version}@`)));
}

function normalizeRole(value) {
  const role = lower(value, 32);
  return STAFF_ROLES.has(role) ? role : "customer";
}

function quoteFreshness(quote, sourceFreshness) {
  const observedAt = iso(quote?.updatedAtISO || quote?.createdAtISO);
  const requested = lower(sourceFreshness, 16);
  if (requested === "fresh" && observedAt) {
    return {
      state: "fresh",
      observedAt,
      reason: "The caller identified this exact quote snapshot as fresh."
    };
  }
  if (requested === "stale" && observedAt) {
    return {
      state: "stale",
      observedAt,
      reason: "The caller identified this quote snapshot as stale. Refresh it before acting on customer activity."
    };
  }
  return {
    state: "unknown",
    observedAt: observedAt || null,
    reason: observedAt
      ? "Source freshness was not established by the caller."
      : "The quote does not carry a valid observed timestamp."
  };
}

function opportunityScope(quote, { sourceMode, sourceFreshness }) {
  const freshness = quoteFreshness(quote, sourceFreshness);
  const organizationId = text(quote?.organizationId, 160).toLowerCase();
  const quoteId = text(quote?.id || quote?.quoteId, 160);
  const versionId = normalizedVersion(quote);
  const missing = [];
  if (!organizationId) missing.push("organization id");
  if (!quoteId) missing.push("quote id");
  if (!versionId) missing.push("active immutable revision");

  let state = "exact_current";
  let reason = "The connected quote identifies one organization, opportunity, and active immutable revision.";
  if (missing.length > 0) {
    state = "incomplete";
    reason = `The active opportunity scope is missing ${missing.join(", ")}.`;
  } else if (sourceMode !== "firebase") {
    state = "local_unverified";
    reason = "The browser-local opportunity can support a bounded preview, but it is not exact connected evidence.";
  } else if (freshness.state === "stale") {
    state = "stale";
    reason = freshness.reason;
  } else if (freshness.state !== "fresh") {
    state = "unknown";
    reason = freshness.reason;
  }

  return {
    state,
    exact: state === "exact_current",
    organizationId,
    quoteId,
    quoteNumber: text(quote?.quoteNumber, 80) || quoteId || "Quote unavailable",
    versionId,
    eventName: text(quote?.event?.name || quote?.eventName, 160) || "Event not named",
    customerName: text(quote?.customer?.name || quote?.customerName, 160) || "Customer not named",
    status: lower(quote?.status || "draft", 40),
    freshness,
    missing,
    reason
  };
}

function quoteEvidenceState(scope, present) {
  if (!present) return "not_recorded";
  if (scope.state === "exact_current") return "recorded";
  if (scope.state === "stale") return "stale";
  if (scope.state === "local_unverified") return "local_unverified";
  return "unavailable";
}

function directFactConfidence(scope, present, malformed = false) {
  if (malformed || !present || !scope.exact) {
    return {
      level: malformed || scope.state === "incomplete" ? "unavailable" : "low",
      basis: malformed
        ? "The recorded evidence is incomplete or contradictory."
        : !present
          ? "No exact evidence is recorded for this rail."
          : "The evidence is visible without an exact current connected opportunity scope."
    };
  }
  return {
    level: "high",
    basis: "This is recorded on the exact current connected opportunity."
  };
}

function evidenceFreshness(scope, observedAtISO = "") {
  const observedAt = iso(observedAtISO) || scope.freshness.observedAt;
  if (scope.state === "stale") {
    return { state: "stale", observedAt, reason: scope.reason };
  }
  if (scope.exact && observedAt) {
    return { state: "fresh", observedAt, reason: "The evidence belongs to the caller-declared fresh opportunity snapshot." };
  }
  return {
    state: "unknown",
    observedAt: observedAt || null,
    reason: scope.state === "local_unverified"
      ? "A local record cannot establish connected evidence freshness."
      : scope.reason
  };
}

function sentEvidence(quote, scope) {
  const raw = text(quote?.lifecycle?.sentAtISO, 64);
  const sentAtISO = iso(raw);
  const malformed = Boolean(raw && !sentAtISO);
  const present = Boolean(sentAtISO);
  const state = malformed ? "unavailable" : quoteEvidenceState(scope, present);
  return {
    id: "sent",
    label: "Proposal sent status",
    state,
    evidenceAtISO: sentAtISO,
    evidenceAuthority: present ? "quote_lifecycle" : "none",
    reason: malformed
      ? "The recorded sent timestamp is invalid."
      : state === "recorded"
        ? "The exact current quote lifecycle records when proposal sent status was established."
        : state === "stale"
          ? "A sent timestamp is recorded on a stale opportunity snapshot."
          : state === "local_unverified"
            ? "A sent timestamp is visible locally, but the exact connected lifecycle record was not read."
            : "No valid sent timestamp is recorded. Quote status, portal availability, or later timestamps do not create one.",
    consequence: "Sent status alone does not establish provider acceptance, provider delivery, portal viewing, or a customer reply.",
    doNothing: present
      ? "The recorded sent state remains unchanged. No message is resent."
      : "Sent status remains unestablished.",
    confidence: directFactConfidence(scope, present, malformed),
    freshness: evidenceFreshness(scope, sentAtISO)
  };
}

function exactProviderAcceptance(quote, scope) {
  const delivery = isRecord(quote?.workflow?.quoteDelivery)
    ? quote.workflow.quoteDelivery
    : {};
  const acceptedAtISO = iso(delivery.providerAcceptedAtISO);
  const providerMessageId = text(delivery.providerMessageId, 160);
  const revisionId = text(delivery.revisionId, 160);
  const exact = scope.exact
    && lower(delivery.state, 40) === "provider_accepted"
    && Boolean(acceptedAtISO)
    && Boolean(providerMessageId)
    && revisionMatchesActiveVersion(revisionId, scope.versionId);
  return {
    exact,
    acceptedAtISO,
    providerMessageId,
    revisionId,
    recordedState: lower(delivery.state, 40)
  };
}

function providerDeliveryEvidence(quote, scope, suppliedEvidence) {
  const acceptance = exactProviderAcceptance(quote, scope);
  if (suppliedEvidence == null) {
    return {
      id: "provider-delivered",
      label: "Provider-reported delivery",
      state: acceptance.exact ? "provider_accepted_only" : "not_recorded",
      outcome: acceptance.exact ? "provider_accepted" : "",
      evidenceAtISO: acceptance.acceptedAtISO,
      evidenceAuthority: acceptance.exact ? "quote_delivery_provider_acceptance" : "none",
      reason: acceptance.exact
        ? "The provider accepted the exact current proposal send request. No verified delivered event is recorded in this object."
        : "No exact verified provider-delivery event was supplied. Sent status and provider acceptance never upgrade this rail to delivered.",
      consequence: "Provider acceptance is not inbox delivery, and provider delivery is not a portal view or reply.",
      doNothing: "Provider-delivery evidence remains exactly as recorded. No provider request is made.",
      confidence: directFactConfidence(scope, acceptance.exact),
      freshness: evidenceFreshness(scope, acceptance.acceptedAtISO),
      provenance: null
    };
  }

  const evidence = isRecord(suppliedEvidence) ? suppliedEvidence : {};
  const outcome = lower(evidence.state || evidence.type, 40);
  const occurredAtISO = iso(evidence.occurredAtISO || evidence.deliveredAtISO);
  const organizationId = text(evidence.organizationId, 160).toLowerCase();
  const quoteId = text(evidence.quoteId, 160);
  const revisionId = text(evidence.revisionId || evidence.quoteRevisionId, 160);
  const providerMessageId = text(evidence.providerMessageId, 160);
  const provider = lower(evidence.provider, 40);
  const source = lower(evidence.source, 80);
  const valid = PROVIDER_EVENT_STATES.has(outcome)
    && evidence.signatureVerified === true
    && source === "verified_provider_webhook"
    && Boolean(provider)
    && Boolean(providerMessageId)
    && Boolean(occurredAtISO)
    && organizationId === scope.organizationId
    && quoteId === scope.quoteId
    && revisionMatchesActiveVersion(revisionId, scope.versionId);
  const usable = valid && scope.exact;
  const state = !valid
    ? "unavailable"
    : !scope.exact
      ? scope.state === "stale" ? "stale" : "local_unverified"
      : outcome === "delivered"
        ? "verified_delivered"
        : outcome === "provider_accepted"
          ? "provider_accepted_only"
          : "provider_non_delivery";
  return {
    id: "provider-delivered",
    label: "Provider-reported delivery",
    state,
    outcome: usable ? outcome : "",
    evidenceAtISO: occurredAtISO,
    evidenceAuthority: usable ? "verified_provider_webhook" : "unavailable",
    reason: !valid
      ? "Provider evidence is missing an exact scope, active revision, verified signature, provider message identity, supported outcome, or occurrence time."
      : state === "verified_delivered"
        ? "A verified provider webhook records delivery for this exact organization, quote, active revision, and provider message."
        : state === "provider_non_delivery"
          ? `A verified provider webhook records ${outcome}. This does not establish delivery.`
          : state === "provider_accepted_only"
            ? "Verified evidence records provider acceptance only. It is not delivered evidence."
            : "Provider evidence is visible without an exact current connected opportunity scope.",
    consequence: "This provider rail never establishes portal viewing, message reading, reply intent, proposal acceptance, or payment.",
    doNothing: "The provider outcome remains unchanged. This model neither retries nor sends.",
    confidence: directFactConfidence(scope, usable, !valid),
    freshness: valid
      ? {
          state: scope.state === "stale" ? "stale" : scope.exact ? "fresh" : "unknown",
          observedAt: occurredAtISO,
          reason: scope.state === "stale"
            ? scope.reason
            : scope.exact
              ? "The signed provider event matches the exact current opportunity scope."
              : scope.reason
        }
      : { state: "unknown", observedAt: occurredAtISO || null, reason: "Provider evidence could not be validated." },
    provenance: {
      sourceId: text(evidence.sourceId, 160) || `provider-event:${providerMessageId || "unknown"}:${outcome || "unknown"}`,
      label: text(evidence.sourceLabel, 160) || "Supplied provider event evidence",
      type: source || "unverified_provider_event",
      state: !valid ? "unavailable" : scope.state === "stale" ? "stale" : "available",
      observedAt: occurredAtISO || null,
      reason: !valid ? "The provider event failed exact evidence validation." : scope.state === "stale" ? scope.reason : null
    }
  };
}

function viewedEvidence(quote, scope) {
  const raw = text(quote?.lifecycle?.viewedAtISO, 64);
  const viewedAtISO = iso(raw);
  const malformed = Boolean(raw && !viewedAtISO);
  const present = Boolean(viewedAtISO);
  const state = malformed ? "unavailable" : quoteEvidenceState(scope, present);
  return {
    id: "portal-viewed",
    label: "Portal view",
    state: state === "recorded" ? "recorded_view" : state,
    evidenceAtISO: viewedAtISO,
    evidenceAuthority: present ? "quote_lifecycle_portal_visit" : "none",
    reason: malformed
      ? "The recorded portal-view timestamp is invalid."
      : state === "recorded"
        ? "The exact current quote lifecycle records a real customer portal visit."
        : state === "stale"
          ? "A portal-view timestamp is recorded on a stale opportunity snapshot."
          : state === "local_unverified"
            ? "A view-shaped timestamp is visible locally, but the exact connected portal lifecycle record was not read."
            : "No valid portal-view timestamp is recorded. Sent, accepted, delivered, or available status does not imply a view.",
    consequence: "A portal visit does not establish that any particular section was read, that the customer replied, or that the proposal was accepted.",
    doNothing: present
      ? "The recorded portal visit remains historical evidence."
      : "Portal viewing remains unestablished.",
    confidence: directFactConfidence(scope, present, malformed),
    freshness: evidenceFreshness(scope, viewedAtISO)
  };
}

function repliedEvidence(quote, scope) {
  const summaryPresent = isRecord(quote?.conversationSummary);
  const summary = summaryPresent ? quote.conversationSummary : {};
  const count = Number(summary.messageCount);
  const messageCountValid = Number.isSafeInteger(count) && count >= 0;
  const latestMessageId = text(summary.latestMessageId, 160);
  const latestMessageAtISO = iso(summary.latestMessageAtISO);
  const latestActorType = lower(summary.latestActorType, 32);
  const completeLatest = count > 0
    && Boolean(latestMessageId)
    && Boolean(latestMessageAtISO)
    && ACTOR_TYPES.has(latestActorType);
  const emptyConsistent = count === 0
    && !latestMessageId
    && !text(summary.latestMessageAtISO, 64)
    && !latestActorType;
  const malformed = summaryPresent
    && (!messageCountValid || (count > 0 && !completeLatest) || (count === 0 && !emptyConsistent));
  const latestCustomer = completeLatest && latestActorType === "customer";
  const latestStaff = completeLatest && latestActorType === "staff";

  let state = "not_recorded";
  if (malformed) state = "unavailable";
  else if (scope.state === "stale" && summaryPresent) state = "stale";
  else if (scope.state === "local_unverified" && summaryPresent) state = "local_unverified";
  else if (!scope.exact && summaryPresent) state = "unavailable";
  else if (latestCustomer) state = "latest_customer_reply";
  else if (latestStaff) state = "latest_staff_message";
  else if (summaryPresent && emptyConsistent) state = "no_messages_recorded";

  return {
    id: "replied",
    label: "Conversation reply",
    state,
    messageCount: messageCountValid ? count : null,
    latestMessageId: completeLatest ? latestMessageId : "",
    latestMessageAtISO: completeLatest ? latestMessageAtISO : "",
    latestActorType: completeLatest ? latestActorType : "",
    evidenceAuthority: completeLatest || emptyConsistent ? "quote_conversation_summary" : "none",
    reason: malformed
      ? "The canonical conversation summary is incomplete or contradictory."
      : state === "latest_customer_reply"
        ? "The exact current conversation summary records the latest message as customer-authored."
        : state === "latest_staff_message"
          ? "The exact current conversation summary records the latest message as staff-authored. Earlier customer replies are not inferred or denied."
          : state === "no_messages_recorded"
            ? "The exact current conversation summary records zero messages."
            : state === "stale"
              ? "Conversation activity is visible on a stale opportunity snapshot."
              : state === "local_unverified"
                ? "Conversation activity is visible locally without exact connected evidence."
                : "No complete canonical conversation summary is recorded. Conversation availability and other timestamps do not imply a reply.",
    consequence: "Latest-author evidence does not prove the message was read by staff, acknowledge intent, resolve a request, or establish provider delivery.",
    doNothing: state === "latest_customer_reply"
      ? "The latest customer reply remains available for staff review and is not marked read or resolved."
      : "The exact conversation summary remains unchanged.",
    confidence: directFactConfidence(scope, latestCustomer || latestStaff || emptyConsistent, malformed),
    freshness: evidenceFreshness(scope, latestMessageAtISO)
  };
}

function inferredEngagementEvidence(scope, suppliedInference) {
  if (suppliedInference == null) {
    return {
      id: "inferred-engagement",
      label: "Inferred engagement",
      state: "unsupported",
      claim: "",
      evidenceAtISO: "",
      evidenceAuthority: "advisory_only",
      reason: "No governed customer-engagement inference was supplied. QuotePilot does not create one from sends, delivery, views, timestamps, or conversation availability.",
      consequence: "No interest, intent, urgency, presence, or likelihood conclusion is available.",
      doNothing: "No inferred engagement is stored or acted upon.",
      confidence: {
        level: "unavailable",
        basis: "There is no supported inference source."
      },
      freshness: { state: "unknown", observedAt: null, reason: "No inference evidence was supplied." },
      provenance: null
    };
  }

  const inference = isRecord(suppliedInference) ? suppliedInference : {};
  const organizationId = text(inference.organizationId, 160).toLowerCase();
  const quoteId = text(inference.quoteId, 160);
  const claim = text(inference.claim, 240);
  const reason = text(inference.reason, 500);
  const consequence = text(inference.consequence, 500);
  const observedAtISO = iso(inference.observedAtISO);
  const confidenceLevel = lower(inference.confidence?.level, 24);
  const confidenceBasis = text(inference.confidence?.basis, 500);
  const sourceId = text(inference.sourceId, 160);
  const sourceLabel = text(inference.sourceLabel, 160);
  const sourceType = text(inference.sourceType, 80);
  const valid = organizationId === scope.organizationId
    && quoteId === scope.quoteId
    && Boolean(claim)
    && Boolean(reason)
    && Boolean(consequence)
    && Boolean(observedAtISO)
    && CONFIDENCE_LEVELS.has(confidenceLevel)
    && Boolean(confidenceBasis)
    && Boolean(sourceId)
    && Boolean(sourceLabel)
    && Boolean(sourceType);
  const usable = valid && scope.exact;
  return {
    id: "inferred-engagement",
    label: "Inferred engagement",
    state: !valid
      ? "unavailable"
      : scope.state === "stale"
        ? "stale"
        : scope.exact
          ? "advisory"
          : "local_unverified",
    claim: usable ? claim : "",
    evidenceAtISO: observedAtISO,
    evidenceAuthority: usable ? "bounded_advisory_inference" : "unavailable",
    reason: !valid
      ? "The supplied inference lacks exact opportunity scope, bounded advisory language, provenance, freshness, or permitted confidence."
      : scope.exact
        ? reason
        : "The supplied inference is visible without an exact current connected opportunity scope.",
    consequence: usable
      ? consequence
      : "No customer behavior or intent conclusion may be drawn from this inference.",
    doNothing: "The advisory claim remains non-authoritative and no communication or workflow state changes.",
    confidence: usable
      ? { level: confidenceLevel, basis: confidenceBasis }
      : { level: "unavailable", basis: "The inference contract could not be established for the exact current opportunity." },
    freshness: valid
      ? {
          state: scope.state === "stale" ? "stale" : scope.exact ? "fresh" : "unknown",
          observedAt: observedAtISO,
          reason: scope.state === "stale"
            ? scope.reason
            : scope.exact
              ? "The advisory inference was observed for the exact current opportunity scope."
              : scope.reason
        }
      : { state: "unknown", observedAt: observedAtISO || null, reason: "The inference contract is incomplete." },
    provenance: {
      sourceId: sourceId || "engagement-inference:unavailable",
      label: sourceLabel || "Supplied engagement inference",
      type: sourceType || "unsupported_inference",
      state: !valid ? "unavailable" : scope.state === "stale" ? "stale" : "available",
      observedAt: observedAtISO || null,
      reason: !valid ? "The inference failed exact evidence validation." : scope.state === "stale" ? scope.reason : null
    }
  };
}

function changeRequestEvidence(quote, scope) {
  const decision = isRecord(quote?.portalDecision) ? quote.portalDecision : {};
  if (lower(decision.decision, 40) !== "changes_requested") {
    return {
      id: "change-request",
      state: "not_recorded",
      requestId: "",
      submittedAtISO: "",
      message: "",
      messageTruncated: false,
      reason: "No current customer portal change request is recorded.",
      consequence: "No change-request resolution is required by this evidence domain.",
      doNothing: "The opportunity and conversation remain unchanged."
    };
  }

  const requestId = text(decision.requestId, 160);
  const submittedAtISO = iso(decision.submittedAtISO);
  const rawMessage = String(decision.message ?? "").trim();
  const message = rawMessage.slice(0, 280);
  const malformed = !submittedAtISO || !rawMessage;
  const handling = isRecord(quote?.workflow?.changeRequestHandling)
    ? quote.workflow.changeRequestHandling
    : {};
  const handlingMatches = text(handling.sourceSubmittedAtISO, 64) === text(decision.submittedAtISO, 64)
    && text(handling.sourceMessage, 500) === text(decision.message, 500)
    && (requestId
      ? text(handling.sourceRequestId, 160) === requestId
      : !text(handling.sourceRequestId, 160));
  const handlingState = handlingMatches ? lower(handling.state, 40) : "";

  let state = "open";
  if (malformed) state = "unavailable";
  else if (scope.state === "stale") state = "stale";
  else if (scope.state === "local_unverified") state = "local_unverified";
  else if (!scope.exact) state = "unavailable";
  else if (handlingState === "handled") state = "handled_internal";
  else if (handlingState === "acknowledged") state = "acknowledged_internal";

  return {
    id: "change-request",
    state,
    requestId,
    submittedAtISO,
    message,
    messageTruncated: rawMessage.length > message.length,
    reason: malformed
      ? "The current change request is missing an exact message or submitted timestamp."
      : state === "handled_internal"
        ? "The exact current request is marked handled in the internal workflow. This is not a customer reply or quote revision receipt."
        : state === "acknowledged_internal"
          ? "The exact current request is acknowledged internally and still requires explicit resolution."
          : state === "open"
            ? "The exact current customer portal request is open for staff review."
            : state === "stale"
              ? "A change request is visible on a stale opportunity snapshot."
              : state === "local_unverified"
                ? "A change request is visible locally without exact connected evidence."
                : "The change-request scope is unavailable.",
    consequence: "Reviewing or acknowledging a request does not edit, reprice, save, send, or resolve the quote.",
    doNothing: state === "open" || state === "acknowledged_internal"
      ? "The customer request remains unresolved and the saved quote remains unchanged."
      : "The recorded internal handling state remains unchanged."
  };
}

function followUpEvidence(quote, scope, todayISO) {
  const followUp = isRecord(quote?.workflow?.followUp) ? quote.workflow.followUp : {};
  const stage = lower(followUp.stage, 40);
  const dueDateRaw = text(followUp.dueDate, 10);
  const dueDate = validDate(dueDateRaw);
  const completed = followUp.completed === true || new Set(["won", "lost"]).has(stage);
  const hasRecord = Boolean(
    dueDateRaw
    || text(followUp.note, 500)
    || followUp.completed === true
    || text(followUp.updatedAtISO, 40)
    || text(followUp.updatedByEmail, 320)
    || (stage && stage !== "new")
  );
  if (!hasRecord) {
    return {
      id: "follow-up",
      state: "not_scheduled",
      stage: "",
      dueDate: "",
      note: "",
      reason: "No internal follow-up is scheduled for this opportunity.",
      consequence: "No follow-up action is required by this record.",
      doNothing: "No follow-up schedule changes."
    };
  }
  const malformed = (stage && !FOLLOW_UP_STAGES.has(stage))
    || (dueDateRaw && !dueDate)
    || (followUp.completed !== undefined && typeof followUp.completed !== "boolean");
  const today = validDate(todayISO);
  let state = "scheduled";
  if (malformed) state = "unavailable";
  else if (scope.state === "stale") state = "stale";
  else if (scope.state === "local_unverified") state = "local_unverified";
  else if (!scope.exact) state = "unavailable";
  else if (completed) state = "completed_internal";
  else if (dueDate && today && dueDate < today) state = "overdue";
  else if (dueDate && today && dueDate === today) state = "due_today";

  return {
    id: "follow-up",
    state,
    stage,
    dueDate,
    note: text(followUp.note, 280),
    reason: malformed
      ? "The internal follow-up record has an unsupported stage, invalid due date, or invalid completion state."
      : state === "completed_internal"
        ? "The exact follow-up is marked complete internally. This does not prove customer contact or reply."
        : state === "overdue"
          ? `The exact internal follow-up was due ${dueDate}.`
          : state === "due_today"
            ? `The exact internal follow-up is due ${dueDate}.`
            : state === "scheduled"
              ? dueDate
                ? `The exact internal follow-up is scheduled for ${dueDate}.`
                : "An internal follow-up stage is recorded without a due date."
              : state === "stale"
                ? "An internal follow-up is visible on a stale opportunity snapshot."
                : state === "local_unverified"
                  ? "An internal follow-up is visible locally without exact connected evidence."
                  : "The follow-up record is unavailable for the exact current opportunity.",
    consequence: "Follow-up state is an internal workflow record. It never proves a message was sent, delivered, viewed, or answered.",
    doNothing: ["overdue", "due_today", "scheduled"].includes(state)
      ? "The internal follow-up remains open and the customer record remains unchanged."
      : "The recorded follow-up state remains unchanged."
  };
}

function conversationAccess(options) {
  const supplied = isRecord(options.conversationAccess)
    ? options.conversationAccess
    : options.conversationAvailable === true || options.conversationAvailable === false
      ? {
          available: options.conversationAvailable,
          readOnly: options.conversationReadOnly,
          reason: options.conversationUnavailableReason
        }
      : null;
  if (!supplied) {
    return {
      state: "unknown",
      available: false,
      readOnly: false,
      reason: "Conversation availability was not supplied. It is never inferred from lifecycle or portal timestamps."
    };
  }
  if (supplied.available === true) {
    return {
      state: supplied.readOnly === true ? "read_only" : "available",
      available: true,
      readOnly: supplied.readOnly === true,
      reason: supplied.readOnly === true
        ? text(supplied.reason, 500) || "The exact event conversation is available to read, but new messages are closed."
        : "The caller identified the exact event conversation as available."
    };
  }
  if (supplied.available === false) {
    return {
      state: "unavailable",
      available: false,
      readOnly: false,
      reason: text(supplied.reason, 500) || "The exact event conversation is unavailable."
    };
  }
  return {
    state: "unknown",
    available: false,
    readOnly: false,
    reason: "Conversation availability is incomplete."
  };
}

function resolution(id, label, availability, reason, consequence, target) {
  return { id, label, availability, reason, consequence, target };
}

function buildResolutions({ role, scope, access, replied, changeRequest, followUp }) {
  const staff = STAFF_ROLES.has(role);
  const exactStaffScope = staff && scope.exact;
  const exactChangeRequestId = text(changeRequest.requestId, 160);
  const followUpRequestId = scope.quoteId ? `follow-up:${scope.quoteId}` : "";
  const openConversation = exactStaffScope && access.available
    ? resolution(
        "open-opportunity-conversation",
        access.readOnly ? "Read event conversation" : "Open event conversation",
        "available",
        access.reason,
        "Opening reveals the exact quote-scoped thread. It does not send or mark any message read.",
        { kind: "context", surfaceId: "conversation", quoteId: scope.quoteId }
      )
    : resolution(
        "open-opportunity-conversation",
        "Open event conversation",
        "blocked",
        !staff ? "Staff role is required." : !scope.exact ? scope.reason : access.reason,
        "No generic or contextless conversation destination should open.",
        { kind: "context", surfaceId: "conversation", quoteId: scope.quoteId }
      );

  const reviewReply = replied.state === "latest_customer_reply"
    ? exactStaffScope && access.available
      ? resolution(
          "review-latest-customer-reply",
          "Review latest customer reply",
          "available",
          "The latest exact conversation message is customer-authored.",
          "Reviewing does not acknowledge, resolve, or answer the message.",
          { kind: "context", surfaceId: "conversation", quoteId: scope.quoteId, messageId: replied.latestMessageId }
        )
      : resolution(
          "review-latest-customer-reply",
          "Review latest customer reply",
          "blocked",
          !exactStaffScope ? scope.reason : access.reason,
          "The reply remains unreviewed by this model.",
          { kind: "context", surfaceId: "conversation", quoteId: scope.quoteId, messageId: replied.latestMessageId }
        )
    : resolution(
        "review-latest-customer-reply",
        "Review latest customer reply",
        "not_needed",
        "No exact current latest-customer-message evidence is available.",
        "No reply state changes.",
        { kind: "context", surfaceId: "conversation", quoteId: scope.quoteId }
      );

  const changeNeedsReview = new Set(["open", "acknowledged_internal"]).has(changeRequest.state);
  const reviewChange = changeNeedsReview && exactStaffScope && Boolean(exactChangeRequestId)
    ? resolution(
        "review-customer-change-request",
        "Review customer change request",
        "available",
        changeRequest.reason,
        "Review remains advisory until an explicit draft action and trusted save record their own outcomes.",
        {
          kind: "route",
          surfaceId: "workflow",
          quoteId: scope.quoteId,
          attentionType: "change_request",
          requestId: exactChangeRequestId
        }
      )
    : resolution(
        "review-customer-change-request",
        "Review customer change request",
        changeNeedsReview ? "blocked" : "not_needed",
        changeNeedsReview
          ? !staff
            ? "Staff role is required."
            : !scope.exact
              ? scope.reason
              : !exactChangeRequestId
                ? "The current customer change request has no exact request identity, so Workflow cannot focus it without risking substitution."
                : "The exact change-request Workflow target is unavailable."
          : changeRequest.reason,
        "No change request is staged, handled, or resolved.",
        {
          kind: "route",
          surfaceId: "workflow",
          quoteId: scope.quoteId,
          attentionType: "change_request",
          requestId: exactChangeRequestId
        }
      );

  const followUpOpen = new Set(["scheduled", "due_today", "overdue"]).has(followUp.state);
  const reviewFollowUp = followUpOpen && exactStaffScope
    ? resolution(
        "review-opportunity-follow-up",
        followUp.state === "overdue" ? "Review overdue follow-up" : "Review opportunity follow-up",
        "available",
        followUp.reason,
        "Opening the workflow does not contact the customer or mark the follow-up complete.",
        {
          kind: "route",
          surfaceId: "workflow",
          quoteId: scope.quoteId,
          attentionType: "follow_up",
          requestId: followUpRequestId
        }
      )
    : resolution(
        "review-opportunity-follow-up",
        "Review opportunity follow-up",
        followUpOpen ? "blocked" : "not_needed",
        followUpOpen ? (!staff ? "Staff role is required." : scope.reason) : followUp.reason,
        "The internal follow-up record remains unchanged.",
        {
          kind: "route",
          surfaceId: "workflow",
          quoteId: scope.quoteId,
          attentionType: "follow_up",
          requestId: followUpRequestId
        }
      );

  return [reviewReply, reviewChange, reviewFollowUp, openConversation];
}

function selectNextResolution(resolutions) {
  const available = resolutions.find((entry) => entry.availability === "available");
  if (available) return available;
  const blocked = resolutions.find((entry) => entry.availability === "blocked");
  if (blocked) return blocked;
  return {
    id: "conversation-caught-up",
    label: "No communication resolution is currently required",
    availability: "not_needed",
    reason: "The supplied evidence identifies no open reply, change request, or follow-up resolution.",
    consequence: "Other opportunity evidence domains remain separate.",
    target: { kind: "context", surfaceId: "conversation", quoteId: "" }
  };
}

function overallState(scope, evidence, changeRequest, followUp) {
  if (scope.state === "stale") return "stale";
  if (!scope.exact) return scope.state === "local_unverified" ? "local_preview" : "unavailable";
  if (evidence.some((entry) => entry.state === "unavailable")) return "needs_reconciliation";
  if (
    evidence.some((entry) => entry.state === "latest_customer_reply")
    || new Set(["open", "acknowledged_internal"]).has(changeRequest.state)
    || new Set(["due_today", "overdue"]).has(followUp.state)
  ) return "attention";
  return "current";
}

function descriptorProvenance(scope, providerDelivery, inferredEngagement, sourceMode) {
  const entries = [{
    sourceId: `conversation-opportunity:${scope.organizationId || "unknown"}:${scope.quoteId || "unknown"}:${scope.versionId || "unknown"}`,
    label: scope.exact ? "Exact connected opportunity communication evidence" : "Bounded opportunity communication source",
    type: scope.exact ? "firebase_quote_snapshot" : sourceMode === "local" ? "local_quote_snapshot" : "incomplete_quote_snapshot",
    state: scope.state === "stale" ? "stale" : scope.state === "incomplete" ? "unavailable" : "available",
    observedAt: scope.freshness.observedAt,
    reason: scope.state === "stale" || scope.state === "incomplete" ? scope.reason : null
  }];
  if (providerDelivery.provenance) entries.push(providerDelivery.provenance);
  if (inferredEngagement.provenance) entries.push(inferredEngagement.provenance);
  const seen = new Set();
  return entries.map((entry, index) => {
    let sourceId = entry.sourceId;
    while (seen.has(sourceId)) sourceId = `${entry.sourceId}:${index}`;
    seen.add(sourceId);
    return { ...entry, sourceId };
  });
}

export function buildAmbientConversationObject(quote = {}, options = {}) {
  const safeQuote = isRecord(quote) ? quote : {};
  const sourceMode = lower(options.sourceMode, 24) === "firebase" ? "firebase" : "local";
  const role = normalizeRole(options.role || "sales");
  const scope = opportunityScope(safeQuote, {
    sourceMode,
    sourceFreshness: options.sourceFreshness || "fresh"
  });
  const sent = sentEvidence(safeQuote, scope);
  const providerDelivery = providerDeliveryEvidence(
    safeQuote,
    scope,
    options.providerDeliveryEvidence
  );
  const viewed = viewedEvidence(safeQuote, scope);
  const replied = repliedEvidence(safeQuote, scope);
  const inferredEngagement = inferredEngagementEvidence(scope, options.engagementInference);
  const evidence = [sent, providerDelivery, viewed, replied, inferredEngagement];
  const changeRequest = changeRequestEvidence(safeQuote, scope);
  const followUp = followUpEvidence(safeQuote, scope, options.todayISO);
  const access = conversationAccess(options);
  const resolutions = buildResolutions({
    role,
    scope,
    access,
    replied,
    changeRequest,
    followUp
  });
  const nextResolution = selectNextResolution(resolutions);
  const state = overallState(scope, evidence, changeRequest, followUp);
  const confidence = {
    level: state === "current" || state === "attention"
      ? "high"
      : state === "local_preview"
        ? "low"
        : "unavailable",
    basis: state === "current" || state === "attention"
      ? "The direct communication records are bound to one exact current connected opportunity. Each signal preserves its own evidence authority."
      : state === "local_preview"
        ? "An unsaved preview is available; connected conversation details are not confirmed."
        : "Stale, incomplete, or contradictory evidence prevents a current communication conclusion."
  };
  const doNothing = nextResolution.availability === "available"
    ? `${nextResolution.label} remains available but unresolved. No message is sent, no reply is marked read, and no workflow item changes.`
    : "Every recorded communication and workflow detail remains unchanged. No message is sent or inferred.";
  const descriptor = createIntelligentObjectDescriptor({
    id: "conversation",
    type: "customer-communication-evidence",
    label: "Conversation",
    summary: state === "attention"
      ? nextResolution.label
      : "Sent, provider delivery, portal view, reply, and inferred engagement remain separate evidence rails.",
    inspectorSurfaceId: "conversation-context",
    dependencies: [
      {
        object: { id: "proposal", type: "intelligent-object", label: "Proposal" },
        relationship: "defines the exact customer decision artifact and active revision",
        consequence: "A revision change can invalidate delivery and portal evidence without changing conversation history."
      },
      {
        object: { id: "provider-delivery", type: "communication-evidence", label: "Provider delivery" },
        relationship: "records signed provider outcomes separately from quote lifecycle",
        consequence: "Provider acceptance or delivery cannot create a portal view, reply, acceptance, or payment record."
      },
      {
        object: { id: "portal-view", type: "customer-activity-evidence", label: "Portal view" },
        relationship: "records a real visit to the exact customer portal",
        consequence: "A portal visit never proves a particular section was read or a reply was intended."
      },
      {
        object: { id: "change-request", type: "customer-workflow-evidence", label: "Change request" },
        relationship: "captures an exact customer decision separately from conversation latest-author state",
        consequence: "Reviewing the request does not change, reprice, save, or send the quote."
      },
      {
        object: { id: "follow-up", type: "staff-workflow-evidence", label: "Follow-up" },
        relationship: "tracks internal next work without claiming customer contact",
        consequence: "Internal completion never proves sent, delivered, viewed, or replied state."
      }
    ],
    why: "Recorded communication stays separate from suggestions so one timestamp or availability flag cannot imply customer behavior that was not observed.",
    consequence: "Staff can open the exact conversation or task. Existing access, customer-link, delivery, draft, pricing, and trusted-save checks still apply.",
    doNothing,
    confidence,
    provenance: descriptorProvenance(scope, providerDelivery, inferredEngagement, sourceMode),
    recommendation: nextResolution.availability === "available"
      ? { summary: nextResolution.label, actionId: nextResolution.id }
      : null,
    permissions: {
      view: STAFF_ROLES.has(role),
      simulate: false,
      stage: false,
      commit: false,
      reason: STAFF_ROLES.has(role)
        ? "This object is read-only. Existing conversation and workflow surfaces retain every send, acknowledgement, change, and completion authority."
        : "Staff role is required to inspect internal opportunity communication evidence."
    },
    actionIds: resolutions.map((entry) => entry.id)
  });

  return deepFreeze({
    modelId: AMBIENT_CONVERSATION_OBJECT_MODEL,
    state,
    sourceMode,
    role,
    scope,
    freshness: scope.freshness,
    descriptor,
    evidence,
    evidenceById: Object.fromEntries(evidence.map((entry) => [entry.id, entry])),
    changeRequest,
    followUp,
    access,
    resolutions,
    nextResolution,
    reason: nextResolution.reason,
    consequence: descriptor.consequence,
    doNothing: descriptor.doNothing,
    confidence: descriptor.confidence,
    provenance: descriptor.provenance,
    dependencies: descriptor.dependencies,
    boundary: "This pure model performs no I/O and grants no message-send, read-receipt, acknowledgement, workflow mutation, quote mutation, pricing, provider, acceptance, payment, booking, or inference authority."
  });
}
