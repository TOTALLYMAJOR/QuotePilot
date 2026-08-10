import { STAFF_RULES } from "../data/mockCatalog";
import { buildProposalReadiness } from "../lib/quoteWorkflow";
import { formatWorkspaceMoney } from "../lib/workspacePresentation";

// Deterministic presentation contract for the flag-gated Event Workspace
// decide stack. Every card is advisory decision support derived only from the
// selected quote's recorded fields plus the static house staffing ratios: no
// catalog, settings, or network read, no estimate where the record cannot
// support one, and no card at all once the quote has terminal or governed
// commercial state.
export const DECIDE_STACK_MODEL = "decide-stack-v1";

export const DECIDE_STACK_BOUNDS_NOTE =
  "Advisory decision support derived from this quote's recorded fields and the house staffing ratios only. It creates no requirement, no new evidence, and no claim beyond this record.";

const ADVISORY_STATUSES = new Set(["draft", "sent", "viewed"]);

const READINESS_GAP_CARD_LIMIT = 2;

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
}

function editAction(ordinaryEditAllowed) {
  return ordinaryEditAllowed
    ? { id: "edit", kind: "edit", label: "Adjust in editor" }
    : { id: "administration", kind: "administration", label: "Review quote actions" };
}

function staffingImpact({ gap, roleLabel, totalLabor, quotedCount }) {
  const labor = Number(totalLabor);
  if (!(labor > 0) || quotedCount <= 0) {
    return "The labor cost effect is not derivable from this quote's recorded totals.";
  }
  const perStaff = labor / quotedCount;
  const estimate = gap * perStaff;
  return `≈ +${formatWorkspaceMoney(estimate)} labor at this quote's average recorded ${roleLabel} rate.`;
}

export function buildStaffingCard(quote = {}, { ordinaryEditAllowed = false } = {}) {
  const event = quote?.event || {};
  const style = String(event.style || "").trim();
  const rule = STAFF_RULES[style];
  const guests = Number(event.guests);
  if (!rule || !Number.isFinite(guests) || guests <= 0) return null;

  const quotedServers = toCount(event.servers);
  const quotedChefs = toCount(event.chefs);
  const requiredServers = Number.isFinite(rule.serverRatio)
    ? Math.max(rule.minServers || 0, Math.ceil(guests / rule.serverRatio))
    : (rule.minServers || 0);
  const requiredChefs = Number.isFinite(rule.chefRatio)
    ? Math.ceil(guests / rule.chefRatio)
    : 0;
  const serverGap = Math.max(0, requiredServers - quotedServers);
  const chefGap = Math.max(0, requiredChefs - quotedChefs);
  if (serverGap <= 0 && chefGap <= 0) return null;

  const gapParts = [];
  if (serverGap > 0) gapParts.push(`${serverGap} more server${serverGap === 1 ? "" : "s"}`);
  if (chefGap > 0) gapParts.push(`${chefGap} more chef${chefGap === 1 ? "" : "s"}`);

  const basisParts = [];
  if (Number.isFinite(rule.serverRatio)) {
    basisParts.push(`1 server per ${rule.serverRatio} guests, minimum ${rule.minServers || 0}`);
  }
  if (Number.isFinite(rule.chefRatio)) {
    basisParts.push(`1 chef per ${rule.chefRatio} guests`);
  }

  const impactParts = [];
  if (serverGap > 0) {
    impactParts.push(staffingImpact({
      gap: serverGap,
      roleLabel: "server",
      totalLabor: quote?.totals?.serverLabor,
      quotedCount: quotedServers
    }));
  }
  if (chefGap > 0) {
    impactParts.push(staffingImpact({
      gap: chefGap,
      roleLabel: "chef",
      totalLabor: quote?.totals?.chefLabor,
      quotedCount: quotedChefs
    }));
  }

  return {
    id: "staffing-house-ratio",
    kind: "staffing",
    signal: "attend",
    family: "info",
    label: "Advisory",
    title: "Staffing below the house ratio",
    meta: `${style} · ${guests} guests`,
    sentence: `${style} service at ${guests} guests calls for ${requiredServers} server${requiredServers === 1 ? "" : "s"}${requiredChefs > 0 ? ` and ${requiredChefs} chef${requiredChefs === 1 ? "" : "s"}` : ""} by the house ratio. This quote records ${quotedServers} server${quotedServers === 1 ? "" : "s"}${requiredChefs > 0 ? ` and ${quotedChefs} chef${quotedChefs === 1 ? "" : "s"}` : ""} — ${gapParts.join(" and ")} would meet it.`,
    basis: `House staffing ratio for ${style}: ${basisParts.join("; ")}.`,
    impact: [...new Set(impactParts)].join(" "),
    action: editAction(ordinaryEditAllowed)
  };
}

export function buildReadinessGapCards(quote = {}, { ordinaryEditAllowed = false } = {}) {
  const readiness = buildProposalReadiness(quote);
  if (readiness.complete || !Array.isArray(readiness.gaps) || !readiness.gaps.length) return [];
  return [...readiness.gaps]
    .sort((a, b) => Number(b.points || 0) - Number(a.points || 0))
    .slice(0, READINESS_GAP_CARD_LIMIT)
    .map((gap) => ({
      id: `readiness-gap-${gap.id}`,
      kind: "readiness_gap",
      signal: "attend",
      family: "info",
      label: "Advisory",
      title: `Record the ${String(gap.label || gap.id).toLowerCase()}`,
      meta: "Proposal completeness",
      sentence: `Recording the ${String(gap.label || gap.id).toLowerCase()} adds ${gap.points} of 100 toward the existing proposal-completeness score. This is not operational event readiness.`,
      basis: "proposal-readiness-v1, the existing weighted proposal-field model.",
      impact: `+${gap.points} toward Ready to send.`,
      action: editAction(ordinaryEditAllowed)
    }));
}

export function buildDecideStack(quote = {}, { ordinaryEditAllowed = false } = {}) {
  const status = String(quote?.status || "draft").trim().toLowerCase();
  if (!ADVISORY_STATUSES.has(status)) {
    return {
      modelId: DECIDE_STACK_MODEL,
      cards: [],
      suppressed: true,
      boundsNote: DECIDE_STACK_BOUNDS_NOTE
    };
  }
  const staffingCard = buildStaffingCard(quote, { ordinaryEditAllowed });
  const cards = [
    ...(staffingCard ? [staffingCard] : []),
    ...buildReadinessGapCards(quote, { ordinaryEditAllowed })
  ];
  return {
    modelId: DECIDE_STACK_MODEL,
    cards,
    suppressed: false,
    boundsNote: DECIDE_STACK_BOUNDS_NOTE
  };
}
