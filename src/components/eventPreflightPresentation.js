import { buildCommercialPriorityContext } from "../lib/ambientOpportunityStream";
import { buildAmbientOperationalReceipts } from "../lib/ambientOperationalReceipts";

function text(value) {
  return String(value ?? "").trim();
}

function fact(id, domain, title, detail, evidence, action = null) {
  return Object.freeze({ id, domain, title, detail, evidence, action });
}

const quoteAction = Object.freeze({ kind: "quote", label: "Open commercial truth" });
const scheduleAction = Object.freeze({ kind: "schedule", label: "Open exact event in Schedule" });
const refreshAction = Object.freeze({ kind: "refresh", label: "Refresh Event Preflight" });

function checklistItem(execution, id) {
  return (execution?.runOfShow?.productionChecklist?.groups || [])
    .flatMap((group) => group.items || [])
    .find((item) => item.id === id) || null;
}

const SCHEDULE_REASON_TEXT = Object.freeze({
  time_overlap: "Its event window overlaps another event at the same recorded venue.",
  capacity: "The bounded concurrent guest load exceeds the declared Schedule capacity."
});

function commercialSnapshotCurrent(snapshot) {
  return !snapshot.loading && !snapshot.error && !snapshot.partial
    && !snapshot.stale && !snapshot.truncated && snapshot.truncationKnown !== false;
}

export function buildEventPreflightPresentation({
  quote = {},
  execution = null,
  authorityReads = {},
  authorityIdentity = "",
  organizationId = "",
  snapshot = {},
  scheduleAssessment = { state: "unknown", reasons: [] },
  scheduleAvailable = true
} = {}) {
  const satisfied = [];
  const attention = [];
  const unknown = [];
  const commercial = buildCommercialPriorityContext(quote).position;
  const currentRevisionId = text(quote.activeVersionId || quote.versionMeta?.versionId);
  const acceptedRevisionId = text(quote.acceptanceReceipt?.quoteRevisionId);
  const commercialCurrent = commercialSnapshotCurrent(snapshot);

  if (!commercialCurrent) {
    unknown.push(
      fact("commitment", "Commercial", "Commercial commitment is awaiting a current read", "The retained quote is not used to pass Event Preflight while its bounded snapshot is incomplete or stale.", "Commercial snapshot"),
      fact("accepted-revision", "Commercial", "Accepted revision cannot be verified from current evidence", "Refresh the commercial snapshot before comparing current and accepted revisions.", "Commercial snapshot"),
      fact("deposit", "Payment", "Deposit state is awaiting a current read", "Retained payment evidence is not upgraded to a current Preflight fact.", "Commercial snapshot"),
      fact("final-balance", "Payment", "Final balance state is awaiting a current read", "Retained payment evidence is not upgraded to a current Preflight fact.", "Commercial snapshot"),
      fact("final-count", "Guest plan", "Final guest count confirmation is awaiting a current read", "Retained checklist evidence is not upgraded to a current Preflight fact.", "Commercial snapshot")
    );
  } else {
    if (["accepted", "booked"].includes(text(quote.status).toLowerCase())) {
      satisfied.push(fact("commitment", "Commercial", "Commercial commitment recorded", `Lifecycle: ${commercial.lifecycle.value}.`, "Saved quote lifecycle"));
    } else {
      attention.push(fact("commitment", "Commercial", "Commitment is not established", "Event Preflight applies only to accepted or booked work.", "Saved quote lifecycle", quoteAction));
    }

    const acceptance = buildAmbientOperationalReceipts(quote, { role: "admin" })
      .receipts.find((item) => item.id === "acceptance");
    if (acceptance?.state === "resolved" && acceptedRevisionId && currentRevisionId) {
      (acceptedRevisionId === currentRevisionId ? satisfied : attention).push(fact(
        "accepted-revision",
        "Commercial",
        acceptedRevisionId === currentRevisionId ? "Customer acceptance matches the current revision" : "Current revision is not the accepted revision",
        acceptedRevisionId === currentRevisionId
          ? `Acceptance receipt is bound to ${acceptedRevisionId}.`
          : `Acceptance remains preserved on ${acceptedRevisionId}; current revision is ${currentRevisionId}. Renewed customer review may be required.`,
        "Immutable acceptance receipt",
        acceptedRevisionId === currentRevisionId ? null : quoteAction
      ));
    } else {
      unknown.push(fact("accepted-revision", "Commercial", "Accepted revision cannot be verified", "An exact acceptance-receipt identity, timestamp, source revision, and current revision were not all available.", "Acceptance receipt", quoteAction));
    }

    for (const [id, label, value] of [
      ["deposit", "Deposit", commercial.deposit],
      ["final-balance", "Final balance", commercial.finalBalance]
    ]) {
      if (!value.available) {
        unknown.push(fact(id, "Payment", `${label} state is unavailable`, value.reason, "Recorded payment projection", quoteAction));
      } else if (value.family === "confirmed") {
        satisfied.push(fact(id, "Payment", `${value.value}`, value.reason, "Recorded payment projection"));
      } else {
        attention.push(fact(id, "Payment", `${value.value}`, value.reason, "Recorded payment projection", quoteAction));
      }
    }

    const finalCount = checklistItem(execution, "guest-count");
    if (finalCount?.state === "completed") {
      satisfied.push(fact("final-count", "Guest plan", "Final guest count confirmation is recorded", "The production checklist records this checkpoint complete; this is not actual attendance.", "Production checklist"));
    } else if (finalCount?.state === "not_completed") {
      attention.push(fact("final-count", "Guest plan", "Final guest count needs confirmation", "The production checklist records this checkpoint not complete.", "Production checklist", scheduleAvailable ? scheduleAction : quoteAction));
    } else {
      unknown.push(fact("final-count", "Guest plan", "Final guest count confirmation is not established", "A quoted guest count is planning scope, not final-count confirmation or actual attendance.", "Production checklist", scheduleAvailable ? scheduleAction : quoteAction));
    }
  }

  const authorityGenerationCurrent = commercialCurrent
    && Boolean(authorityIdentity)
    && authorityReads.identity === authorityIdentity;
  const beoRead = authorityReads.beo || {};
  const beoState = text(beoRead.value?.state).toUpperCase();
  const beoCurrent = authorityGenerationCurrent && beoRead.state === "current";
  const beoRevisionExact = text(beoRead.value?.commercialSourceRevisionId) === currentRevisionId;
  if (beoCurrent && beoState === "CURRENT" && beoRevisionExact) {
    satisfied.push(fact("beo", "Production", "Kitchen BEO is current", "The exact governed BEO freshness read reports CURRENT for this revision.", "Kitchen BEO authority"));
  } else if (beoCurrent && ["STALE", "REVIEW", "NOT_GENERATED"].includes(beoState)) {
    attention.push(fact("beo", "Production", `Kitchen BEO requires attention: ${beoState.toLowerCase().replaceAll("_", " ")}`, "Use the governed BEO record before production proceeds.", "Kitchen BEO authority", quoteAction));
  } else {
    unknown.push(fact("beo", "Production", "Kitchen BEO freshness is unavailable", "The exact quote revision and current authority generation were not both established.", "Kitchen BEO authority", quoteAction));
  }

  const invalidationCount = Array.isArray(beoRead.value?.unresolvedInvalidationIds)
    ? beoRead.value.unresolvedInvalidationIds.length
    : null;
  if (beoCurrent && beoRevisionExact && invalidationCount === 0) {
    satisfied.push(fact("invalidations", "Dependencies", "No unresolved BEO invalidations are reported", "This conclusion is limited to the exact current BEO status projection.", "Kitchen BEO authority"));
  } else if (beoCurrent && invalidationCount > 0) {
    attention.push(fact("invalidations", "Dependencies", `${invalidationCount} BEO ${invalidationCount === 1 ? "invalidation is" : "invalidations are"} unresolved`, "Reconcile the governed dependency records before relying on the artifact.", "Kitchen BEO authority", quoteAction));
  } else {
    unknown.push(fact("invalidations", "Dependencies", "Artifact invalidations are unavailable", "No cross-artifact healthy state is inferred from an unavailable or mismatched BEO read.", "Governed dependency evidence", quoteAction));
  }

  const staffingRead = authorityReads.staffing || {};
  const staffingState = text(staffingRead.value?.snapshot?.coverage?.state || staffingRead.value?.state);
  const staffingCurrent = authorityGenerationCurrent
    && staffingRead.state === "current"
    && text(staffingRead.value?.organizationId) === text(organizationId)
    && text(staffingRead.value?.quoteId) === text(quote.id)
    && text(staffingRead.value?.activeQuoteRevisionId) === currentRevisionId;
  if (staffingCurrent && ["coverage_confirmed", "not_required"].includes(staffingState)) {
    satisfied.push(fact("staffing", "Staffing", staffingState === "not_required" ? "Operational staffing is not required" : "Operational staffing coverage is confirmed", "The exact staffing authority reports current coverage for this revision; this is not attendance.", "Operational staffing authority"));
  } else if (staffingCurrent && staffingState === "attention") {
    attention.push(fact("staffing", "Staffing", "Operational staffing coverage needs attention", "The exact current staffing projection reports a coverage gap.", "Operational staffing authority", quoteAction));
  } else {
    const staffingUnavailableDetail = ["stale", "partial", "empty"].includes(staffingRead.state)
      ? `Authoritative read is ${staffingRead.state}; coverage is withheld until a current exact-object read completes.`
      : "The exact organization, quote, revision, and authority generation were not all established.";
    unknown.push(fact("staffing", "Staffing", "Operational staffing coverage is unavailable", staffingUnavailableDetail, "Operational staffing authority", quoteAction));
  }

  if (commercialCurrent && execution?.workspace?.intelligence?.needsYou?.target) {
    attention.push(fact("workflow", "Workflow", execution.workspace.intelligence.needsYou.title, execution.workspace.intelligence.needsYou.detail, "Bounded Workflow priority", {
      kind: "workflow",
      label: "Open exact work in Workflow",
      target: execution.workspace.intelligence.needsYou.target
    }));
  } else {
    unknown.push(fact("workflow", "Workflow", "No current Workflow blocker is established", commercialCurrent ? "An empty bounded priority projection does not prove all operational work is resolved." : "Refresh before relying on retained Workflow context.", "Bounded Workflow priority"));
  }

  if (!commercialCurrent || scheduleAssessment.state === "unknown") {
    unknown.push(fact("schedule", "Schedule", "Schedule conflict state is unavailable", "Event identity, venue, date, timing, guest load, or the bounded Schedule evidence is incomplete or stale.", "Schedule projection", scheduleAvailable ? scheduleAction : quoteAction));
  } else if (scheduleAssessment.state === "conflict") {
    attention.push(fact(
      "schedule",
      "Schedule",
      "A schedule conflict is recorded",
      scheduleAssessment.reasons.map((reason) => SCHEDULE_REASON_TEXT[reason] || "Schedule reports an unclassified conflict.").join(" "),
      "Schedule projection",
      scheduleAvailable ? scheduleAction : quoteAction
    ));
  } else {
    satisfied.push(fact("schedule", "Schedule", "No conflict appears in the current bounded Schedule projection", "The selected event and comparable records contain the date, venue, timing, and guest-load facts needed for this bounded conclusion; this is not resource availability.", "Schedule projection", scheduleAvailable ? scheduleAction : quoteAction));
  }

  unknown.push(
    fact("phase-issues", "Live execution", "Live phase and unresolved issues are unavailable", "QuotePilot has no server-owned live event session for this event.", "No current authority"),
    fact("inventory", "Inventory", "Inventory and equipment availability are not governed here", "A checklist does not prove that equipment exists, is reserved, loaded, returned, or undamaged.", "New authority required"),
    fact("attendance", "Attendance", "Actual attendance is not governed here", "Quoted guests and final-count confirmation are not actual attendance.", "New authority required")
  );

  const nextFact = attention.find((item) => item.action)
    || unknown.find((item) => item.action)
    || satisfied.find((item) => item.action);
  const nextAction = !commercialCurrent ? refreshAction : nextFact?.action || quoteAction;
  const nextReason = !commercialCurrent
    ? "Refresh the bounded commercial snapshot before acting on retained evidence."
    : nextFact
      ? `${nextFact.domain}: ${nextFact.title}.`
      : "Continue in the exact commercial record; no other supported continuation is available.";

  return Object.freeze({
    modelId: "event-preflight-presentation-v1",
    state: attention.length ? "attention" : unknown.length ? "incomplete" : "observed_clear",
    title: attention.length ? "Attention is required before safe advancement" : "Preflight evidence is incomplete",
    summary: `${satisfied.length} satisfied · ${attention.length} need attention · ${unknown.length} unknown or unavailable`,
    satisfied: Object.freeze(satisfied),
    attention: Object.freeze(attention),
    unknown: Object.freeze(unknown),
    nextAction: Object.freeze(nextAction),
    nextReason,
    boundary: "Preflight is a read-only synthesis, not a readiness score or authorization to proceed. Missing evidence never passes."
  });
}
