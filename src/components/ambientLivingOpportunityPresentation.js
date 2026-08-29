import { STAFF_RULES } from "../data/mockCatalog";
import {
  createAmbientAction,
  createAmbientCapabilityManifest,
  createImpactPreview,
  createIntelligentObjectDescriptor,
  createOpportunityMomentum,
  createSurfacePurposeContract
} from "../lib/ambientContracts";
import {
  AMBIENT_EVENT_LOGISTICS_OBJECT_KINDS,
  buildAmbientEventLogisticsObjects
} from "../lib/ambientEventLogisticsObjects";
import { buildAmbientPackageMenuObjects } from "../lib/ambientPackageMenuObjects";
import { buildAmbientConversationObject } from "../lib/ambientConversationObject";
import { buildAmbientMoneyObject } from "../lib/ambientMoneyObject";
import { buildAmbientProposalObject } from "../lib/ambientProposalObject";
import { buildAmbientSelectionObjects } from "../lib/ambientSelectionObjects";
import { buildAmbientOperationalReceipts } from "../lib/ambientOperationalReceipts";
import { buildProposalReadiness } from "../lib/quoteWorkflow";
import { buildEventWorkspacePresentation } from "./eventWorkspacePresentation";

export const AMBIENT_LIVING_OPPORTUNITY_MODEL = "pilot-slice-alpha-v1";
export const AMBIENT_GUEST_SCENARIO_MIN = 1;
export const AMBIENT_GUEST_SCENARIO_MAX = 400;
export const AMBIENT_STAFFING_SERVER_MAX = 30;
export const AMBIENT_STAFFING_CHEF_MAX = 20;
export const AMBIENT_STAFFING_BARTENDER_MAX = 20;

const CONVERSATION_WORKFLOW_ATTENTION_TYPES = new Set([
  "change_request",
  "follow_up"
]);

function text(value) {
  return String(value ?? "").trim();
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function plural(value, singular, pluralValue = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralValue}`;
}

function friendlyDateTime(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(parsed);
}

function staffingGuidance(event = {}, guestCount = count(event.guests)) {
  const style = text(event.style);
  const rule = STAFF_RULES[style];
  if (!rule || guestCount <= 0) {
    return {
      available: false,
      style,
      guestCount,
      reason: style
        ? `QuotePilot does not have a staffing guide for ${style}.`
        : "Add a service style to see staffing guidance.",
      provenance: "Saved quote only"
    };
  }

  const servers = Number.isFinite(rule.serverRatio)
    ? Math.max(rule.minServers || 0, Math.ceil(guestCount / rule.serverRatio))
    : (rule.minServers || 0);
  const chefs = Number.isFinite(rule.chefRatio)
    ? Math.ceil(guestCount / rule.chefRatio)
    : 0;
  const quotedServers = count(event.servers);
  const quotedChefs = count(event.chefs);
  const serverGap = Math.max(0, servers - quotedServers);
  const chefGap = Math.max(0, chefs - quotedChefs);
  const basis = [
    Number.isFinite(rule.serverRatio)
      ? `1 server per ${rule.serverRatio} guests, minimum ${rule.minServers || 0}`
      : `${rule.minServers || 0} minimum servers`,
    Number.isFinite(rule.chefRatio) ? `1 chef per ${rule.chefRatio} guests` : ""
  ].filter(Boolean).join("; ");

  return {
    available: true,
    style,
    guestCount,
    servers,
    chefs,
    quotedServers,
    quotedChefs,
    serverGap,
    chefGap,
    hasGap: serverGap > 0 || chefGap > 0,
    basis,
    recommendation: `For ${style} with ${plural(guestCount, "guest")}, the staffing guide suggests ${plural(servers, "server")}${chefs > 0 ? ` and ${plural(chefs, "chef")}` : ""}.`,
    provenance: "Saved quote plus house staffing guide"
  };
}

export function validateAmbientGuestCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    return "Enter a whole guest count.";
  }
  if (number < AMBIENT_GUEST_SCENARIO_MIN || number > AMBIENT_GUEST_SCENARIO_MAX) {
    return `Enter ${AMBIENT_GUEST_SCENARIO_MIN} to ${AMBIENT_GUEST_SCENARIO_MAX} guests.`;
  }
  return "";
}

export function buildAmbientGuestObject(quote = {}, scenarioGuestCount) {
  const event = quote.event || {};
  const currentGuestCount = count(event.guests);
  const scenario = count(scenarioGuestCount) || currentGuestCount;
  const currentStaffing = staffingGuidance(event, currentGuestCount);
  const scenarioStaffing = staffingGuidance(event, scenario);
  const rentalLineCount = Array.isArray(quote.selection?.rentals)
    ? quote.selection.rentals.length
    : 0;
  const addonLineCount = Array.isArray(quote.selection?.addons)
    ? quote.selection.addons.length
    : 0;
  const scenarioChanged = currentGuestCount > 0 && scenario !== currentGuestCount;
  const consequence = scenarioChanged
    ? `This unsaved preview changes the recorded guest count from ${currentGuestCount} to ${scenario}. Package, menu, extras, fees, tax, deposit, and margin may change. The saved-record view cannot price that delta without the current catalog.`
    : "Guest count can affect per-person scope, staffing, rentals, service fees, tax, deposit, and margin. No unsaved preview is active.";
  const doNothing = currentStaffing.available && currentStaffing.hasGap
    ? `The quote remains at ${plural(currentGuestCount, "guest")} with ${plural(currentStaffing.quotedServers, "quoted server")}${currentStaffing.quotedChefs > 0 ? ` and ${plural(currentStaffing.quotedChefs, "quoted chef")}` : ""}, below the staffing guide.`
    : `The saved quote remains unchanged at ${currentGuestCount > 0 ? plural(currentGuestCount, "guest") : "its current recorded guest count"}.`;

  return {
    id: "guest-count",
    type: "operational-fact",
    label: "Guest count",
    currentGuestCount,
    scenarioGuestCount: scenario,
    scenarioChanged,
    dependencies: [
      {
        id: "commercial-scope",
        label: "Price and scope",
        detail: "Current catalog pricing is required to reprice package, menu, extras, fees, tax, deposit, and margin."
      },
      {
        id: "staffing",
        label: "Staffing",
        detail: scenarioStaffing.available
          ? scenarioStaffing.recommendation
          : scenarioStaffing.reason
      },
      {
        id: "quantities",
        label: "Quantity rules",
        detail: `${plural(rentalLineCount, "recorded rental line")} and ${plural(addonLineCount, "recorded add-on line")} must be checked against current catalog rules.`
      }
    ],
    why: scenarioStaffing.available
      ? `For ${plural(scenario, "guest")}, the ${scenarioStaffing.style} staffing guide suggests ${plural(scenarioStaffing.servers, "server")} and ${plural(scenarioStaffing.chefs, "chef")}. The house guide uses ${scenarioStaffing.basis}.`
      : "Guest count is the anchor for per-person pricing and scope. Staffing guidance remains unavailable until a supported service style is recorded.",
    consequence,
    doNothing,
    confidence: scenarioStaffing.available ? "high" : "bounded",
    provenance: scenarioStaffing.provenance,
    currentStaffing,
    scenarioStaffing,
    preview: {
      available: false,
      reason: "An exact price preview requires the current tenant catalog and the ordinary quote calculator.",
      nextResolution: scenarioChanged
        ? `Stage ${scenario} guests in the quote editor, review the live preview, then save intentionally.`
        : "Try another guest count or open the quote editor to review current pricing."
    }
  };
}

function staffingCountLabel({ servers = 0, chefs = 0, bartenders = 0 } = {}) {
  return [
    plural(servers, "server"),
    plural(chefs, "chef"),
    plural(bartenders, "bartender")
  ].join(", ");
}

function pricingAmount(value) {
  if (value === null || value === undefined || value === "") return "Amount unavailable";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Amount unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function pricingCategoryLabel(value) {
  return text(value || "other")
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export function buildAmbientPricingObject(quote = {}, {
  source = "",
  ordinaryEditAllowed = false,
  margin = null
} = {}) {
  const pricing = quote.pricing && typeof quote.pricing === "object"
    ? quote.pricing
    : {};
  const lineItems = Array.isArray(pricing.lineItems) ? pricing.lineItems : [];
  const total = Number(pricing.grandTotal ?? quote.totals?.total);
  const subtotal = Number(pricing.subtotal ?? quote.totals?.subtotal);
  const deposit = Number(pricing.deposit?.amount ?? quote.totals?.deposit);
  const discountTotal = pricing.discountTotal === null || pricing.discountTotal === undefined
    ? null
    : Number(pricing.discountTotal);
  const authority = text(pricing.authority);
  const calculatedAt = text(pricing.calculatedAt);
  const calculatedAtLabel = friendlyDateTime(calculatedAt);
  const available = Number.isFinite(total) && total >= 0;
  const exactSavedAuthority = authority === "server_authoritative";
  const groupedLines = new Map();
  for (const item of lineItems) {
    const category = text(item?.category) || "other";
    const amount = Number(item?.total);
    if (!Number.isFinite(amount)) continue;
    const current = groupedLines.get(category) || { amount: 0, count: 0 };
    groupedLines.set(category, {
      amount: current.amount + amount,
      count: current.count + 1
    });
  }
  const breakdown = [...groupedLines.entries()].map(([category, value]) => Object.freeze({
    id: category,
    label: pricingCategoryLabel(category),
    amount: value.amount,
    formattedAmount: pricingAmount(value.amount),
    lineCount: value.count
  }));
  const guestCount = count(pricing.inputs?.event?.guests || quote.event?.guests);
  const catalogRevision = Number(pricing.rulesSnapshot?.pricingSettingsVersion);
  const taxRegion = text(pricing.tax?.regionName || pricing.tax?.regionId);
  const marginAvailable = margin?.available === true;
  const marginUnavailable = margin?.available === false;
  const targetGap = marginAvailable
    && Number.isFinite(Number(margin.target))
    && Number(margin.marginPct) < Number(margin.target)
      ? {
          points: (Number(margin.target) - Number(margin.marginPct)) * 100,
          amount: Number(margin.revenue) * (Number(margin.target) - Number(margin.marginPct))
        }
      : null;
  const missingCostEvidence = marginUnavailable && Array.isArray(margin.missing)
    ? margin.missing.map((item) => text(item)).filter(Boolean)
    : marginAvailable
      ? []
      : ["Current tenant catalog and staff cost context are not attached to this saved-record view."];
  const provenance = [
    {
      sourceId: `quote-pricing:${text(quote.id || quote.quoteId) || "selected"}`,
      label: exactSavedAuthority
        ? "Saved pricing calculation"
        : authority
          ? `Saved ${authority.replaceAll("_", " ")} pricing snapshot`
          : "Saved quote total",
      type: authority || text(source) || "saved-record",
      state: available ? "available" : "unavailable",
      ...(available ? {} : { reason: "No finite saved total is recorded." })
    }
  ];
  if (marginAvailable || marginUnavailable) {
    provenance.push({
      sourceId: "tenant-cost-context",
      label: marginAvailable
        ? "Current tenant-recorded cost coverage"
        : "Incomplete tenant cost coverage",
      type: "staff-only-cost-evidence",
      state: marginAvailable ? "available" : "unavailable",
      ...(marginUnavailable ? { reason: margin.note || "One or more selected costs are unavailable." } : {})
    });
  }
  const why = exactSavedAuthority
    ? `The current saved quote totals ${pricingAmount(total)}${calculatedAtLabel ? ` and was calculated ${calculatedAtLabel}` : ""}. QuotePilot recalculates any change before it can be saved.`
    : available
      ? `The selected quote records ${pricingAmount(total)}, but its source is ${authority ? authority.replaceAll("_", " ") : "not declared"}; it is not treated as current authoritative repricing.`
      : "Without a saved pricing total, QuotePilot cannot yet compare pricing or model what might change.";
  const consequence = "Changing guest count, package, menu, staffing, rentals, service fees, tax region, or deposit policy can change this total. Opening these details changes nothing; a preview remains for planning until QuotePilot recalculates and saves the quote.";
  const doNothing = available
    ? `The saved quote remains ${pricingAmount(total)}${Number.isFinite(deposit) ? ` with a ${pricingAmount(deposit)} deposit requirement` : ""}. No repricing, discount, authorization, or customer communication occurs.`
    : "The saved quote remains unchanged and pricing stays unavailable until the exact source is recovered.";
  const recommendationSummary = targetGap
    ? `Review the ${targetGap.points.toFixed(1)}-point target-margin gap (${pricingAmount(targetGap.amount)}) before sending or changing scope.`
    : missingCostEvidence.length > 0
      ? `Resolve ${missingCostEvidence.length} missing cost-evidence ${missingCostEvidence.length === 1 ? "item" : "items"} before relying on margin.`
      : "Preview the price before carrying any scope change into the draft.";
  const dependencies = [
    {
      object: { id: "guest-count", type: "intelligent-object", label: "Guest count" },
      relationship: "pricing_uses",
      consequence: guestCount > 0
        ? `The saved pricing input records ${plural(guestCount, "guest")}.`
        : "The saved pricing input does not expose a usable guest count."
    },
    {
      object: { id: "catalog-revision", type: "commercial-dependency", label: "Catalog revision" },
      relationship: "pricing_requires",
      consequence: Number.isSafeInteger(catalogRevision) && catalogRevision >= 0
        ? `Pricing settings revision ${catalogRevision} is recorded in the snapshot.`
        : "A current catalog revision is not established by this saved view."
    },
    {
      object: { id: "tax-region", type: "commercial-dependency", label: "Tax region" },
      relationship: "pricing_uses",
      consequence: taxRegion
        ? `${taxRegion} is recorded on the pricing snapshot.`
        : "No named tax-region evidence is exposed by this snapshot."
    },
    {
      object: { id: "deposit-policy", type: "commercial-dependency", label: "Deposit policy" },
      relationship: "pricing_derives",
      consequence: Number.isFinite(deposit)
        ? `The recorded deposit requirement is ${pricingAmount(deposit)}.`
        : "The deposit requirement is unavailable."
    }
  ];
  const descriptor = createIntelligentObjectDescriptor({
    id: "pricing",
    type: "intelligent-object",
    label: "Pricing",
    summary: available
      ? `${pricingAmount(total)} saved total${Number.isFinite(deposit) ? ` · ${pricingAmount(deposit)} deposit` : ""}.`
      : "Saved pricing is unavailable.",
    inspectorSurfaceId: "pricing-context",
    dependencies,
    why,
    consequence,
    doNothing,
    confidence: {
      level: exactSavedAuthority ? "high" : available ? "medium" : "unavailable",
      basis: exactSavedAuthority
        ? "High confidence applies only to these saved amounts. Current costs, margin, payment, and customer acceptance remain separate."
        : available
          ? "The saved amount is visible, but current catalog authority is not established."
          : "No finite saved pricing amount is available."
    },
    provenance,
    recommendation: available ? {
      summary: recommendationSummary,
      actionId: ordinaryEditAllowed ? "simulate-pricing-counterfactual" : "inspect-pricing"
    } : null,
    permissions: {
      view: true,
      simulate: ordinaryEditAllowed && available,
      stage: ordinaryEditAllowed && available,
      commit: false,
      reason: ordinaryEditAllowed && available
        ? "Simulation and staging remain advisory; the trusted quote save path owns authoritative repricing and immutable writes."
        : "This lifecycle or role is view-only. No commercial mutation is available."
    },
    actionIds: ordinaryEditAllowed && available
      ? ["inspect-pricing", "simulate-pricing-counterfactual", "stage-pricing-in-editor"]
      : ["inspect-pricing"]
  });

  return Object.freeze({
    id: "pricing",
    available,
    authority: authority || "unavailable",
    exactSavedAuthority,
    calculatedAt,
    calculatedAtLabel,
    total: available ? total : null,
    subtotal: Number.isFinite(subtotal) ? subtotal : null,
    deposit: Number.isFinite(deposit) ? deposit : null,
    discountTotal: Number.isFinite(discountTotal) ? discountTotal : null,
    discountAdjustmentAvailable: false,
    breakdown: Object.freeze(breakdown),
    margin: margin || null,
    targetGap: targetGap ? Object.freeze(targetGap) : null,
    missingCostEvidence: Object.freeze(missingCostEvidence),
    why,
    consequence,
    doNothing,
    dependencies: Object.freeze(dependencies),
    provenance: Object.freeze(provenance),
    descriptor
  });
}

export function buildAmbientStaffingObject(quote = {}, {
  guestCount,
  ordinaryEditAllowed = false,
  source = ""
} = {}) {
  const event = quote.event || {};
  const savedGuestCount = count(event.guests);
  const activeGuestCount = count(guestCount) || savedGuestCount;
  const usesLocalGuestScenario = savedGuestCount > 0 && activeGuestCount !== savedGuestCount;
  const guidance = staffingGuidance(event, activeGuestCount);
  const savedPricingStaffing = quote.pricing?.rulesSnapshot?.staffing
    || quote.pricing?.staffing
    || {};
  const addonStaffing = Object.freeze({
    servers: Math.max(count(savedPricingStaffing.addonServers), count(quote.totals?.addonServers)),
    chefs: Math.max(count(savedPricingStaffing.addonChefs), count(quote.totals?.addonChefs)),
    bartenders: Math.max(
      count(savedPricingStaffing.addonBartenders),
      count(quote.totals?.addonBartenders)
    )
  });
  const hasAddonStaffingEvidence = Object.values(addonStaffing).some((value) => value > 0);
  const current = Object.freeze({
    servers: count(event.servers),
    chefs: count(event.chefs),
    bartenders: count(event.bartenders)
  });
  const recommended = guidance.available
    ? Object.freeze({
        servers: Math.max(current.servers, guidance.servers),
        chefs: Math.max(current.chefs, guidance.chefs),
        bartenders: current.bartenders
      })
    : current;
  const serverGap = guidance.available ? Math.max(0, recommended.servers - current.servers) : 0;
  const chefGap = guidance.available ? Math.max(0, recommended.chefs - current.chefs) : 0;
  const hasRecommendation = guidance.available && (serverGap > 0 || chefGap > 0);
  const recommendationWithinEditorBounds = recommended.servers <= AMBIENT_STAFFING_SERVER_MAX
    && recommended.chefs <= AMBIENT_STAFFING_CHEF_MAX
    && recommended.bartenders <= AMBIENT_STAFFING_BARTENDER_MAX;
  const scenarioSource = usesLocalGuestScenario
    ? `the active unsaved preview for ${plural(activeGuestCount, "guest")}`
    : `the saved ${activeGuestCount > 0 ? plural(activeGuestCount, "guest") : "guest-count"} record`;
  const gapLabel = [
    serverGap > 0 ? plural(serverGap, "additional server") : "",
    chefGap > 0 ? plural(chefGap, "additional chef") : ""
  ].filter(Boolean).join(" and ");
  const why = guidance.available
    ? `For ${scenarioSource}, the ${guidance.style} staffing guide suggests at least ${plural(guidance.servers, "server")} and ${plural(guidance.chefs, "chef")}. This comes from the house guide of ${guidance.basis}. QuotePilot has no bartender rule for this service style.`
    : `${guidance.reason} No staffing recommendation is inferred.`;
  const consequence = hasAddonStaffingEvidence
    ? `Saved pricing includes add-on staffing (${staffingCountLabel(addonStaffing)}). Review how those roles combine with the base team in the quote editor before changing anything.`
    : hasRecommendation
    ? `Using this suggestion adds ${gapLabel} to the unsaved staffing preview. Review labor price, margin, availability, schedule, and BEO details before saving.`
    : guidance.available
      ? "The saved staffing meets or exceeds the static minimum ratio. Exact labor price, margin, availability, schedule, and BEO health are not inferred."
      : "No staffing change is recommended. Exact labor price, margin, availability, schedule, and BEO health remain unavailable.";
  const doNothing = hasAddonStaffingEvidence
    ? `The saved base staffing remains at ${staffingCountLabel(current)}, with ${staffingCountLabel(addonStaffing)} recorded from add-ons. No total-staffing sufficiency claim is made until the exact composition is reviewed.`
    : hasRecommendation
    ? `The saved quote stays at ${staffingCountLabel(current)}. QuotePilot will keep showing a ${gapLabel} gap against the house guide; this is a planning prompt, not proof that the event is understaffed.`
    : `The saved quote remains at ${staffingCountLabel(current)}. QuotePilot does not assume the staffing plan is sufficient, available, or financially healthy.`;
  const dependencies = Object.freeze([
    Object.freeze({
      object: { id: "guest-count", type: "intelligent-object", label: "Guest count" },
      relationship: "staffing_ratio_uses",
      consequence: `The static ratio is evaluated against ${scenarioSource}.`
    }),
    Object.freeze({
      object: { id: "service-style", type: "operational-fact", label: "Service style" },
      relationship: "staffing_rule_selects",
      consequence: guidance.available
        ? `${guidance.style} uses this house staffing guide: ${guidance.basis}.`
        : guidance.reason
    }),
    Object.freeze({
      object: { id: "labor-pricing", type: "commercial-dependency", label: "Labor pricing" },
      relationship: "staffing_change_requires",
      consequence: "Current tenant labor rates, duration, fees, tax, and authoritative repricing are not available on this saved-record surface."
    }),
    Object.freeze({
      object: { id: "staffing-operations", type: "operational-dependency", label: "Schedule and BEO" },
      relationship: "staffing_change_requires",
      consequence: "Staff availability, assignments, schedule fit, and BEO freshness must be confirmed in their existing records."
    })
  ]);
  const provenance = [{
    sourceId: `quote:${text(quote.id || quote.quoteId) || "selected"}`,
    label: "Selected saved quote",
    type: text(source) || "saved-record",
    state: "available"
  }];
  if (usesLocalGuestScenario) {
    provenance.push({
      sourceId: "local:guest-count-scenario",
      label: "Active unsaved guest-count preview",
      type: "local-scenario",
      state: "available"
    });
  }
  if (guidance.available) {
    provenance.push({
      sourceId: "house-staffing-ratios",
      label: "Static house staffing ratios",
      type: "deterministic-rule",
      state: "available"
    });
  }
  const recommendationAvailable = Boolean(
    ordinaryEditAllowed
    && hasRecommendation
    && recommendationWithinEditorBounds
    && !hasAddonStaffingEvidence
  );
  const unavailableReason = !guidance.available
    ? guidance.reason
    : hasAddonStaffingEvidence
      ? `Saved pricing records ${staffingCountLabel(addonStaffing)} from add-ons. Manual review is required before changing base staffing.`
    : !recommendationWithinEditorBounds
      ? `The static ratio calls for ${staffingCountLabel(recommended)}, above the quote editor bounds of ${AMBIENT_STAFFING_SERVER_MAX} servers, ${AMBIENT_STAFFING_CHEF_MAX} chefs, and ${AMBIENT_STAFFING_BARTENDER_MAX} bartenders. Manual review is required; the recommendation cannot be staged here.`
      : !ordinaryEditAllowed
        ? "Ordinary quote editing is unavailable for this role or lifecycle state."
        : "The saved staffing already meets or exceeds the static minimum ratio.";
  const descriptor = createIntelligentObjectDescriptor({
    id: "staffing",
    type: "intelligent-object",
    label: "Staffing",
    summary: `${staffingCountLabel(current)} saved. ${guidance.available
      ? `Static minimum for ${plural(activeGuestCount, "guest")}: ${plural(guidance.servers, "server")} and ${plural(guidance.chefs, "chef")}.`
      : guidance.reason}`,
    inspectorSurfaceId: "staffing-context",
    dependencies,
    why,
    consequence,
    doNothing,
    confidence: {
      level: guidance.available ? "high" : "unavailable",
      basis: guidance.available
        ? `High confidence applies only to the staffing-guide calculation (${guidance.basis}). It does not confirm availability, sufficient coverage, tenant history, or cost.`
        : guidance.reason
    },
    provenance,
    recommendation: guidance.available
      ? {
          summary: hasAddonStaffingEvidence || !recommendationWithinEditorBounds
            ? unavailableReason
            : hasRecommendation
            ? `Add ${gapLabel}; keep ${plural(current.bartenders, "bartender")} unchanged because no bartender rule is declared.`
            : "Keep the saved staffing. It meets or exceeds the static minimum ratio.",
          actionId: recommendationAvailable
            ? "use-staffing-recommendation"
            : hasRecommendation
              ? "inspect-staffing"
              : "keep-current-staffing"
        }
      : null,
    permissions: {
      view: true,
      simulate: recommendationAvailable,
      stage: recommendationAvailable,
      commit: false,
      reason: recommendationAvailable
        ? "The recommendation remains an unsaved preview; trusted save remains in the quote editor."
        : `${unavailableReason} Trusted save remains in the quote editor.`
    },
    actionIds: recommendationAvailable
      ? [
          "inspect-staffing",
          "use-staffing-recommendation",
          "keep-current-staffing",
          "stage-staffing-in-editor"
        ]
      : ["inspect-staffing", "keep-current-staffing"]
  });

  return Object.freeze({
    id: "staffing",
    type: "intelligent-object",
    label: "Staffing",
    guestCount: activeGuestCount,
    usesLocalGuestScenario,
    current,
    addonStaffing,
    hasAddonStaffingEvidence,
    recommended,
    guidance,
    serverGap,
    chefGap,
    hasRecommendation,
    recommendationWithinEditorBounds,
    recommendationAvailable,
    unavailableReason,
    why,
    consequence,
    doNothing,
    dependencies,
    provenance: Object.freeze(provenance.map((entry) => Object.freeze({ ...entry }))),
    descriptor
  });
}

function buildRisk({ model, proposal, guestObject }) {
  if (model.attention.target) {
    return {
      id: "workflow-attention",
      tone: "coral",
      label: "Needs attention",
      title: model.attention.title,
      detail: model.attention.detail,
      provenance: "Loaded Workflow items"
    };
  }
  if (!proposal.complete && proposal.gaps.length > 0) {
    const gap = [...proposal.gaps].sort((left, right) => Number(right.points) - Number(left.points))[0];
    return {
      id: `proposal-gap-${gap.id}`,
      tone: "gold",
      label: "Proposal gap",
      title: `${gap.label} needs review`,
      detail: `This field accounts for ${gap.points} of the existing proposal-completeness model.`,
      provenance: "proposal-readiness-v1"
    };
  }
  if (guestObject.currentStaffing.available && guestObject.currentStaffing.hasGap) {
    const { serverGap, chefGap } = guestObject.currentStaffing;
    const gaps = [
      serverGap > 0 ? plural(serverGap, "additional server") : "",
      chefGap > 0 ? plural(chefGap, "additional chef") : ""
    ].filter(Boolean).join(" and ");
    return {
      id: "staffing-guidance",
      tone: "gold",
      label: "Recommendation",
      title: "Staffing may need attention",
      detail: `The staffing guide suggests ${gaps} for this service style.`,
      provenance: guestObject.currentStaffing.provenance
    };
  }
  return {
    id: "no-tracked-risk",
    tone: "mint",
    label: "Caught up",
    title: "No tracked blocker on this quote",
    detail: "QuotePilot found no current blocker in this quote or its loaded Workflow items. Event readiness is checked separately.",
    provenance: "Saved quote plus loaded Workflow items"
  };
}

function buildNextAction({ model, risk, ordinaryEditAllowed }) {
  if (model.attention.target) {
    return {
      id: "open-workflow-item",
      kind: "workflow",
      category: ["approval", "change_request"].includes(model.attention.target.attentionType)
        ? "customer_reply_or_approval"
        : "deadline",
      label: "Review in Workflow",
      title: model.attention.title,
      reason: model.attention.detail,
      consequence: "The exact tracked Workflow item will open for review. No quote change is made by navigation.",
      nextResolution: "Review the details, then choose the next step available on that item.",
      target: model.attention.target
    };
  }
  if (ordinaryEditAllowed) {
    return {
      id: "open-priced-draft",
      kind: "edit",
      category: risk.id.startsWith("proposal-gap") ? "proposal_gap" : "recommendation",
      label: "Review draft",
      title: risk.title,
      reason: risk.detail,
      consequence: "The exact quote opens as an editable draft. Nothing is saved until the intentional save action succeeds.",
      nextResolution: "Review the live price and dependencies, then save or leave the existing version unchanged.",
      target: { quoteId: model.quoteId }
    };
  }
  return {
    id: "caught-up",
    kind: "caught_up",
    category: "none",
    label: "No action required",
    title: "No role-safe resolution is currently required",
    reason: "No tracked Workflow item is present and ordinary editing is unavailable.",
    consequence: "The saved quote remains unchanged.",
    nextResolution: "Return when new evidence or an authorized action becomes available.",
    target: { quoteId: model.quoteId }
  };
}

function buildPilotSentence(risk, nextAction) {
  if (risk.id === "no-tracked-risk") {
    return "No tracked Workflow blocker appears here. The proposal is ready to review when you are.";
  }
  const nextStep = nextAction.kind === "edit"
    ? "Reviewing the draft"
    : nextAction.kind === "workflow"
      ? "Reviewing the exact Workflow item"
      : nextAction.kind === "conversation"
        ? "Reviewing the conversation"
        : nextAction.label;
  return `${risk.title}. ${nextStep} is the clearest available next step.`;
}

function objectReference(model) {
  return {
    id: model.quoteId,
    type: "opportunity",
    label: model.eventName
  };
}

function dependencyContracts(guestObject) {
  return guestObject.dependencies.map((dependency) => ({
    object: {
      id: dependency.id,
      type: "opportunity-dependency",
      label: dependency.label
    },
    relationship: "guest_count_affects",
    consequence: dependency.detail
  }));
}

function provenanceContracts(guestObject, quote, source) {
  const values = [{
    sourceId: `quote:${text(quote.id || quote.quoteId) || "selected"}`,
    label: "Selected saved quote",
    type: text(source) || "saved-record",
    state: "available"
  }];
  if (guestObject.scenarioStaffing.available) {
    values.push({
      sourceId: "house-staffing-ratios",
      label: "Static house staffing ratios",
      type: "deterministic-rule",
      state: "available"
    });
  }
  return values;
}

function buildDisclosureLayers({ quote, model, guestObject }) {
  const selection = quote.selection || {};
  const event = quote.event || {};
  const soldScope = new Map(model.soldScope.map((item) => [item.id, item]));
  const quotedStaff = [event.servers, event.chefs, event.bartenders]
    .reduce((total, value) => {
      const number = Number(value);
      return total + (Number.isFinite(number) && number > 0 ? Math.round(number) : 0);
    }, 0);
  const versionNumber = Number(quote.latestVersionNumber || quote.versionMeta?.versionNumber);
  const activeVersionId = text(quote.activeVersionId || quote.versionMeta?.versionId);
  const status = text(quote.status || "draft").toLowerCase();
  const hasCustomerEvidence = ["sent", "viewed", "accepted", "booked"].includes(status);

  return Object.freeze({
    operational: Object.freeze([
      Object.freeze({
        id: "event",
        label: "Event",
        value: `${model.eventDate}, ${model.eventTime}`,
        detail: `${model.venue}. ${guestObject.scenarioGuestCount || model.guests} guests, ${soldScope.get("service")?.value || "service style not recorded"}.`,
        state: "recorded"
      }),
      Object.freeze({
        id: "menu",
        label: "Menu",
        value: soldScope.get("package")?.value || "Package not recorded",
        detail: soldScope.get("menu")?.value || "No menu items recorded",
        state: Array.isArray(selection.menuItems) && selection.menuItems.length ? "recorded" : "attention"
      }),
      Object.freeze({
        id: "staffing",
        label: "Staffing",
        value: quotedStaff > 0 ? `${quotedStaff} quoted staff` : "No quoted staff",
        detail: guestObject.scenarioStaffing.available
          ? guestObject.scenarioStaffing.recommendation
          : guestObject.scenarioStaffing.reason,
        state: guestObject.scenarioStaffing.available && guestObject.scenarioStaffing.hasGap
          ? "attention"
          : quotedStaff > 0 ? "recorded" : "unavailable"
      }),
      Object.freeze({
        id: "pricing",
        label: "Pricing",
        value: model.total,
        detail: "Saved quoted total. Current catalog repricing remains in the intentional quote editor.",
        state: Number(quote.totals?.total) > 0 ? "recorded" : "unavailable"
      })
    ]),
    supporting: Object.freeze([
      Object.freeze({
        id: "margin",
        label: "Margin",
        value: "Unavailable",
        detail: "The saved opportunity does not carry current cost coverage, so margin health is not inferred.",
        state: "unavailable"
      }),
      Object.freeze({
        id: "history",
        label: "History",
        value: Number.isSafeInteger(versionNumber) && versionNumber > 0
          ? `Version ${versionNumber}`
          : activeVersionId || "Version unavailable",
        detail: activeVersionId
          ? `Active saved version ${activeVersionId}. Open full controls for the complete immutable history.`
          : "No active version identifier is available in this bounded record.",
        state: activeVersionId || (Number.isSafeInteger(versionNumber) && versionNumber > 0)
          ? "recorded"
          : "unavailable"
      }),
      Object.freeze({
        id: "activity",
        label: "Customer update",
        value: hasCustomerEvidence ? model.status.label : "No recorded activity",
        detail: hasCustomerEvidence
          ? "This is lifecycle evidence only. Delivery, viewing, replies, acceptance, and payment remain separate records."
          : "No sent, viewed, accepted, or booked lifecycle evidence is recorded.",
        state: hasCustomerEvidence ? "recorded" : "unavailable"
      }),
      Object.freeze({
        id: "automation",
        label: "Automation",
        value: model.attention.target ? "Tracked item needs review" : "No tracked item",
        detail: model.attention.target
          ? model.attention.detail
          : "No current item appears in the loaded Workflow details. Event readiness is checked separately.",
        state: model.attention.target ? "attention" : "unavailable"
      })
    ])
  });
}

function buildAmbientActions({
  model,
  guestObject,
  staffingObject,
  pricingObject,
  conversationObject,
  moneyObject,
  proposalObject,
  packageObject,
  menuObject,
  selectionObjects,
  eventLogisticsObjects,
  nextAction,
  ordinaryEditAllowed,
  pricingPreviewAvailable,
  conversationHandlerAvailable,
  workflowHandlerAvailable,
  legacyControlsAvailable,
  role
}) {
  const object = objectReference(model);
  const guestCountObject = {
    id: "guest-count",
    type: "intelligent-object",
    label: "Guest count"
  };
  const staffingReference = {
    id: "staffing",
    type: "intelligent-object",
    label: "Staffing"
  };
  const pricingReference = {
    id: "pricing",
    type: "intelligent-object",
    label: "Pricing"
  };
  const conversationReference = {
    id: model.quoteId,
    type: "customer-communication-evidence",
    label: "Conversation"
  };
  const moneyReference = {
    id: "money",
    type: "commercial-evidence",
    label: "Money"
  };
  const proposalReference = {
    id: "proposal",
    type: "customer-decision-artifact",
    label: "Proposal"
  };
  const packageReference = {
    id: "package",
    type: "intelligent-object",
    label: "Package"
  };
  const menuReference = {
    id: "menu",
    type: "intelligent-object",
    label: "Menu"
  };
  const selectionsReference = {
    id: "event-selections",
    type: "intelligent-object-collection",
    label: "Add-ons, rentals, bar, and services"
  };
  const eventLogisticsActionKeys = {
    date: {
      inspect: "inspectEventDate",
      stage: "stageEventDate",
      dismiss: "dismissEventDateContext"
    },
    time: {
      inspect: "inspectEventTime",
      stage: "stageEventTime",
      dismiss: "dismissEventTimeContext"
    },
    duration: {
      inspect: "inspectEventDuration",
      stage: "stageEventDuration",
      dismiss: "dismissEventDurationContext"
    },
    venue: {
      inspect: "inspectEventVenue",
      stage: "stageEventVenue",
      dismiss: "dismissEventVenueContext"
    }
  };
  const noRecovery = { kind: "none" };
  const common = {
    roles: [role],
    enabled: true
  };
  const editAvailability = {
    enabled: ordinaryEditAllowed,
    disabledReason: ordinaryEditAllowed ? null : model.editBoundary
  };
  const staffingRecommendationAvailability = {
    enabled: staffingObject.recommendationAvailable,
    disabledReason: staffingObject.recommendationAvailable
      ? null
      : staffingObject.unavailableReason
  };
  const pricingPreviewAvailability = {
    enabled: Boolean(
      ordinaryEditAllowed
      && pricingPreviewAvailable
      && pricingObject.available
      && guestObject.scenarioChanged
    ),
    disabledReason: !ordinaryEditAllowed
        ? model.editBoundary
      : !pricingObject.available
        ? "A saved total is required before a price preview can be compared."
        : !pricingPreviewAvailable
          ? "The current pricing preview authority is unavailable on this source."
          : !guestObject.scenarioChanged
            ? "Try a different guest count before requesting a price preview."
            : null
  };
  const packageViewAvailability = {
    enabled: packageObject.permissions.view,
    disabledReason: packageObject.permissions.view ? null : packageObject.permissions.reason
  };
  const menuViewAvailability = {
    enabled: menuObject.permissions.view,
    disabledReason: menuObject.permissions.view ? null : menuObject.permissions.reason
  };
  const proposalViewAvailability = {
    enabled: proposalObject.descriptor.permissions.view,
    disabledReason: proposalObject.descriptor.permissions.view
      ? null
      : proposalObject.descriptor.permissions.reason
  };
  const proposalEditorAvailability = {
    enabled: proposalObject.descriptor.permissions.view && ordinaryEditAllowed,
    disabledReason: !proposalObject.descriptor.permissions.view
      ? proposalObject.descriptor.permissions.reason
      : ordinaryEditAllowed
        ? null
        : model.editBoundary
  };
  const proposalControlsAvailability = {
    enabled: proposalObject.descriptor.permissions.view && legacyControlsAvailable,
    disabledReason: !proposalObject.descriptor.permissions.view
      ? proposalObject.descriptor.permissions.reason
      : legacyControlsAvailable
        ? null
        : "The existing role-safe quote workspace handoff is unavailable."
  };
  const conversationViewAvailability = {
    enabled: conversationObject.descriptor.permissions.view,
    disabledReason: conversationObject.descriptor.permissions.view
      ? null
      : conversationObject.descriptor.permissions.reason
  };
  const conversationResolution = conversationObject.nextResolution;
  const conversationResolutionSurface = text(conversationResolution?.target?.surfaceId);
  const conversationResolutionHandlerAvailable = conversationResolutionSurface === "conversation"
    ? conversationHandlerAvailable
    : conversationResolutionSurface === "workflow"
      ? workflowHandlerAvailable
      : false;
  const conversationWorkflowTarget = conversationResolution?.target || {};
  const conversationWorkflowTargetAvailable = conversationResolutionSurface !== "workflow" || Boolean(
    text(conversationWorkflowTarget.quoteId)
    && text(conversationWorkflowTarget.requestId)
    && CONVERSATION_WORKFLOW_ATTENTION_TYPES.has(text(conversationWorkflowTarget.attentionType))
  );
  const conversationResolutionAvailability = {
    enabled: Boolean(
      conversationViewAvailability.enabled
      && conversationResolution?.availability === "available"
      && conversationWorkflowTargetAvailable
      && conversationResolutionHandlerAvailable
    ),
    disabledReason: !conversationViewAvailability.enabled
      ? conversationViewAvailability.disabledReason
      : conversationResolution?.availability !== "available"
        ? conversationResolution?.reason || "No exact communication resolution is currently available."
        : !conversationWorkflowTargetAvailable
          ? "The exact Workflow destination is missing its quote, request, or recognized attention identity, so QuotePilot will not open a substitute item."
        : !conversationResolutionHandlerAvailable
          ? `The existing ${conversationResolutionSurface || "communication"} destination is unavailable in this mounted workspace.`
          : null
  };
  const exactDraftIntentAvailable = (descriptor, intent) => Boolean(
    descriptor.permissions.stage
    && intent?.enabled === true
    && intent.authority === "draft_only"
    && intent.commit === false
    && intent.baseContext?.quoteId === model.quoteId
    && text(intent.baseContext?.organizationId)
    && text(intent.baseContext?.baseRevisionId)
    && Number.isSafeInteger(intent.baseContext?.catalogRevision)
    && intent.target?.objectId === descriptor.id
    && Array.isArray(intent.target?.fieldPaths)
    && intent.target.fieldPaths.length > 0
    && intent.consequencePreviewRequired === true
    && intent.requiresOutcomeNamedSave === true
  );
  const packageDraftIntentAvailable = exactDraftIntentAvailable(
    packageObject,
    packageObject.intentContract
  );
  const menuReplaceIntentAvailable = exactDraftIntentAvailable(
    menuObject,
    menuObject.intentContracts.replace
  );
  const menuReorderIntentAvailable = exactDraftIntentAvailable(
    menuObject,
    menuObject.intentContracts.reorder
  );
  const clearScenarioHistoryAction = createAmbientAction({
    ...common,
    ...editAvailability,
    id: "clear-scenario-history",
    outcomeLabel: "Clear preview history",
    purpose: "resolve",
    authorityLevel: "presentation",
    previewPolicy: "none",
    executionTarget: {
      kind: "context",
      targetId: "scenario-history",
      surfaceId: "living-opportunity"
    },
    receiptType: "resolved",
    reversibility: noRecovery,
    arrivalContract: {
      object,
      reason: "Remove displayed preview recovery entries after they are no longer needed.",
      consequence: "Active unsaved previews and the saved quote remain unchanged. Cleared recovery entries are no longer available to undo.",
      nextResolutionIds: ["inspect-guest-count", "inspect-staffing", "inspect-event-selections"]
    },
    primary: false
  });
  const actions = {
    backToOpportunities: createAmbientAction({
      ...common,
      id: "back-to-opportunities",
      outcomeLabel: "Return to opportunities",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "route", targetId: "opportunities", surfaceId: "opportunities" },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object,
        reason: "Return from the selected Living Opportunity to the opportunity stream.",
        consequence: "The selected quote remains unchanged.",
        nextResolutionIds: ["open-opportunity"]
      },
      primary: false
    }),
    inspectGuestCount: createAmbientAction({
      ...common,
      id: "inspect-guest-count",
      outcomeLabel: "See what guest count changes",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "context", targetId: "guest-count", surfaceId: "guest-count-context" },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: { id: "guest-count", type: "intelligent-object", label: "Guest count" },
        reason: guestObject.why,
        consequence: guestObject.consequence,
        nextResolutionIds: ordinaryEditAllowed
          ? ["simulate-guest-count", "stage-guest-count-in-editor"]
          : ["back-to-opportunities"]
      },
      primary: false
    }),
    openGuestInlineEdit: createAmbientAction({
      ...common,
      ...editAvailability,
      id: "open-guest-count-inline-edit",
      outcomeLabel: "Try another guest count",
      purpose: "advance",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "guest-count",
        surfaceId: "guest-count-inline-editor"
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: guestCountObject,
        reason: "Enter a guest count to preview what it affects.",
        consequence: "The inline editor opens with the current unsaved preview. The saved quote remains unchanged.",
        nextResolutionIds: ["simulate-guest-count", "cancel-guest-count-inline-edit"]
      },
      primary: false
    }),
    cancelGuestInlineEdit: createAmbientAction({
      ...common,
      ...editAvailability,
      id: "cancel-guest-count-inline-edit",
      outcomeLabel: "Keep current preview",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "guest-count",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: guestCountObject,
        reason: "Leave the inline guest-count editor without applying its draft value.",
        consequence: "The current unsaved preview and saved quote remain unchanged.",
        nextResolutionIds: ["open-guest-count-inline-edit", "inspect-guest-count"]
      },
      primary: false
    }),
    validateGuestCount: createAmbientAction({
      ...common,
      ...editAvailability,
      id: "clarify-guest-count-validation",
      outcomeLabel: "Explain the guest-count requirement",
      purpose: "clarify",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "guest-count",
        surfaceId: "guest-count-inline-editor"
      },
      receiptType: "recovery",
      reversibility: noRecovery,
      arrivalContract: {
        object: guestCountObject,
        reason: `Guest count must be a whole number from ${AMBIENT_GUEST_SCENARIO_MIN} to ${AMBIENT_GUEST_SCENARIO_MAX}.`,
        consequence: "No preview is updated. The current unsaved preview and saved quote remain unchanged.",
        nextResolutionIds: ["open-guest-count-inline-edit", "cancel-guest-count-inline-edit"]
      },
      primary: false
    }),
    keepGuestScenario: createAmbientAction({
      ...common,
      ...editAvailability,
      id: "keep-guest-count-scenario",
      outcomeLabel: "Keep current preview",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "simulation",
        targetId: "guest-count",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: guestCountObject,
        reason: "The submitted guest count matches the current unsaved preview.",
        consequence: "No recalculation or saved-quote change is needed.",
        nextResolutionIds: ["inspect-guest-count", "open-priced-editor"]
      },
      primary: false
    }),
    simulateGuestCount: createAmbientAction({
      ...common,
      ...editAvailability,
      id: "simulate-guest-count",
      outcomeLabel: "Update guest preview",
      purpose: "simulate",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: { kind: "simulation", targetId: "guest-count", surfaceId: "living-opportunity" },
      receiptType: "preview",
      reversibility: { kind: "undo", actionId: "undo-guest-scenario", windowMs: 86_400_000 },
      arrivalContract: {
        object: guestCountObject,
        reason: "Preview a different guest count without changing the saved quote.",
        consequence: "The unsaved preview and related guidance are updated. Exact pricing remains unavailable until the quote editor uses the current tenant catalog.",
        nextResolutionIds: ["stage-guest-count-in-editor", "undo-guest-scenario"]
      },
      primary: false
    }),
    stageGuestCount: createAmbientAction({
      ...common,
      ...editAvailability,
      id: "stage-guest-count-in-editor",
      outcomeLabel: "Use guest count in quote editor",
      purpose: "advance",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: { kind: "draft_mutation", targetId: model.quoteId, surfaceId: "quote-editor" },
      receiptType: "preview",
      reversibility: { kind: "manual_recovery", actionId: "leave-existing-version-unchanged" },
      arrivalContract: {
        object,
        reason: "Continue the active guest-count preview in the exact quote editor.",
        consequence: "The editable draft receives the active preview. Live pricing remains a preview, and the saved version remains unchanged until an intentional save succeeds.",
        nextResolutionIds: ["review-live-price", "leave-existing-version-unchanged"]
      },
      primary: false
    }),
    openPricedEditor: createAmbientAction({
      ...common,
      ...editAvailability,
      id: "open-priced-editor",
      outcomeLabel: "Open priced editor",
      purpose: "advance",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "route",
        targetId: model.quoteId,
        surfaceId: "quote-editor"
      },
      receiptType: "pending",
      reversibility: { kind: "manual_recovery", actionId: "leave-existing-version-unchanged" },
      arrivalContract: {
        object,
        reason: "Open the selected quote in the exact editor to review current catalog pricing.",
        consequence: "The quote opens as an editable draft. Nothing is saved until the intentional save action succeeds.",
        nextResolutionIds: ["review-live-price", "leave-existing-version-unchanged"]
      },
      primary: false
    }),
    reviewFinalCountDecision: createAmbientAction({
      ...common,
      enabled: Boolean(workflowHandlerAvailable),
      disabledReason: workflowHandlerAvailable
        ? null
        : "The existing Workflow destination is unavailable in this workspace.",
      id: "review-final-guest-count-in-workflow",
      outcomeLabel: "Review final-count task",
      purpose: "advance",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "route",
        targetId: model.quoteId,
        surfaceId: "workflow"
      },
      receiptType: "pending",
      reversibility: noRecovery,
      arrivalContract: {
        object: guestCountObject,
        reason: "Open the exact final guest-count decision already recorded for this quote.",
        consequence: "Workflow opens for review. Navigation does not confirm attendance, change the quote, or resolve the decision.",
        nextResolutionIds: ["review-exact-workflow-item", "inspect-guest-count"]
      },
      primary: false
    }),
    dismissGuestContext: createAmbientAction({
      ...common,
      id: "dismiss-guest-count-context",
      outcomeLabel: "Close guest-count context",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "guest-count",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: guestCountObject,
        reason: "Close the guest-count inspector and return focus to its exact trigger.",
        consequence: "The unsaved preview and saved quote remain unchanged.",
        nextResolutionIds: ["inspect-guest-count", "open-priced-editor"]
      },
      primary: false
    }),
    undoGuestScenario: createAmbientAction({
      ...common,
      ...editAvailability,
      id: "undo-guest-scenario",
      outcomeLabel: "Undo guest-count preview",
      purpose: "resolve",
      authorityLevel: "draft",
      previewPolicy: "none",
      executionTarget: {
        kind: "simulation",
        targetId: "guest-count",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: guestCountObject,
        reason: "Reverse the most recent unsaved guest-count preview.",
        consequence: "The previous unsaved preview is restored. The saved quote remains unchanged.",
        nextResolutionIds: ["inspect-guest-count", "open-guest-count-inline-edit"]
      },
      primary: false
    }),
    clearScenarioHistory: clearScenarioHistoryAction,
    clearGuestScenarioHistory: clearScenarioHistoryAction,
    inspectStaffing: createAmbientAction({
      ...common,
      id: "inspect-staffing",
      outcomeLabel: "Review staffing",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "staffing",
        surfaceId: "staffing-context"
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: staffingReference,
        reason: staffingObject.why,
        consequence: staffingObject.consequence,
        nextResolutionIds: staffingObject.recommendationAvailable
          ? ["use-staffing-recommendation", "keep-current-staffing"]
          : ["keep-current-staffing", "dismiss-staffing-context"]
      },
      primary: false
    }),
    useStaffingRecommendation: createAmbientAction({
      ...common,
      ...staffingRecommendationAvailability,
      id: "use-staffing-recommendation",
      outcomeLabel: "Use staffing recommendation",
      purpose: "simulate",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "simulation",
        targetId: "staffing",
        surfaceId: "living-opportunity"
      },
      receiptType: "preview",
      reversibility: {
        kind: "undo",
        actionId: "undo-staffing-scenario",
        windowMs: 86_400_000
      },
      arrivalContract: {
        object: staffingReference,
        reason: "Use the house staffing guide in an unsaved staffing preview.",
        consequence: staffingObject.consequence,
        nextResolutionIds: ["stage-staffing-in-editor", "undo-staffing-scenario"]
      },
      primary: false
    }),
    keepCurrentStaffing: createAmbientAction({
      ...common,
      id: "keep-current-staffing",
      outcomeLabel: "Keep current staffing",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "simulation",
        targetId: "staffing",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: staffingReference,
        reason: "Keep the saved staffing instead of using the unsaved recommendation preview.",
        consequence: "Any unsaved staffing recommendation is discarded, while the saved quote remains unchanged. QuotePilot does not assume the plan is operationally sufficient or financially healthy.",
        nextResolutionIds: ["dismiss-staffing-context", "open-priced-editor"]
      },
      primary: false
    }),
    stageStaffingInEditor: createAmbientAction({
      ...common,
      ...staffingRecommendationAvailability,
      id: "stage-staffing-in-editor",
      outcomeLabel: "Stage staffing in editor",
      purpose: "advance",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "draft_mutation",
        targetId: model.quoteId,
        surfaceId: "quote-editor"
      },
      receiptType: "pending",
      reversibility: {
        kind: "manual_recovery",
        actionId: "leave-existing-version-unchanged"
      },
      arrivalContract: {
        object,
        reason: "Continue the active staffing recommendation in the exact quote editor.",
        consequence: "The editable draft receives the staffing preview. Labor pricing remains a preview, and the saved version remains unchanged until an intentional save succeeds.",
        nextResolutionIds: ["review-live-price", "leave-existing-version-unchanged"]
      },
      primary: false
    }),
    dismissStaffingContext: createAmbientAction({
      ...common,
      id: "dismiss-staffing-context",
      outcomeLabel: "Close staffing context",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "staffing",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: staffingReference,
        reason: "Close the staffing inspector and return focus to its exact trigger.",
        consequence: "The unsaved staffing preview and saved quote remain unchanged.",
        nextResolutionIds: ["inspect-staffing", "open-priced-editor"]
      },
      primary: false
    }),
    undoStaffingScenario: createAmbientAction({
      ...common,
      ...editAvailability,
      id: "undo-staffing-scenario",
      outcomeLabel: "Undo staffing preview",
      purpose: "resolve",
      authorityLevel: "draft",
      previewPolicy: "none",
      executionTarget: {
        kind: "simulation",
        targetId: "staffing",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: staffingReference,
        reason: "Reverse the unsaved staffing recommendation.",
        consequence: "The unsaved staffing preview returns to the saved staff counts. The saved quote remains unchanged.",
        nextResolutionIds: ["inspect-staffing", "use-staffing-recommendation"]
      },
      primary: false
    }),
    inspectPricing: createAmbientAction({
      ...common,
      id: "inspect-pricing",
      outcomeLabel: "Review pricing",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "pricing",
        surfaceId: "pricing-context"
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: pricingReference,
        reason: pricingObject.why,
        consequence: pricingObject.consequence,
        nextResolutionIds: pricingPreviewAvailability.enabled
          ? ["simulate-pricing-counterfactual", "stage-pricing-in-editor"]
          : ordinaryEditAllowed
            ? ["stage-pricing-in-editor", "dismiss-pricing-context"]
            : ["dismiss-pricing-context", "back-to-opportunities"]
      },
      primary: false
    }),
    simulatePricingCounterfactual: createAmbientAction({
      ...common,
      ...pricingPreviewAvailability,
      id: "simulate-pricing-counterfactual",
      outcomeLabel: "Preview guest-count price",
      purpose: "simulate",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "simulation",
        targetId: model.quoteId,
        surfaceId: "pricing-context"
      },
      receiptType: "preview",
      reversibility: noRecovery,
      arrivalContract: {
        object: pricingReference,
        reason: "Compare the active guest-count preview with the exact saved quote before using a pricing change.",
        consequence: "A read-only preview is produced. Connected simulations may record an immutable simulation receipt, but no quote version, authorization, customer message, or payment state changes.",
        nextResolutionIds: ["stage-pricing-in-editor", "dismiss-pricing-context"]
      },
      primary: false
    }),
    stagePricingInEditor: createAmbientAction({
      ...common,
      ...editAvailability,
      id: "stage-pricing-in-editor",
      outcomeLabel: "Use priced preview in editor",
      purpose: "advance",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "draft_mutation",
        targetId: model.quoteId,
        surfaceId: "quote-editor"
      },
      receiptType: "pending",
      reversibility: {
        kind: "manual_recovery",
        actionId: "leave-existing-version-unchanged"
      },
      arrivalContract: {
        object,
        reason: "Continue the reviewed pricing preview in the exact quote editor.",
        consequence: "The editable draft receives the active preview. The saved version remains unchanged until intentional authoritative repricing and save both succeed.",
        nextResolutionIds: ["review-live-price", "leave-existing-version-unchanged"]
      },
      primary: false
    }),
    dismissPricingContext: createAmbientAction({
      ...common,
      id: "dismiss-pricing-context",
      outcomeLabel: "Close pricing context",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "pricing",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: pricingReference,
        reason: "Close the pricing inspector and return focus to its exact trigger.",
        consequence: "The saved quote and any unsaved preview remain unchanged. Any completed simulation receipt remains evidence only.",
        nextResolutionIds: ["inspect-pricing", "open-priced-editor"]
      },
      primary: false
    }),
    inspectMoney: createAmbientAction({
      ...common,
      id: "inspect-money",
      outcomeLabel: "Review payments",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "money",
        surfaceId: moneyObject.descriptor.inspectorSurfaceId
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: moneyReference,
        reason: moneyObject.descriptor.why,
        consequence: moneyObject.descriptor.consequence,
        nextResolutionIds: ["dismiss-money-context"]
      },
      primary: false
    }),
    dismissMoneyContext: createAmbientAction({
      ...common,
      id: "dismiss-money-context",
      outcomeLabel: "Close payment details",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "money",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: moneyReference,
        reason: "Close the five payment stages and return focus to the same button.",
        consequence: "No policy, request, provider evidence, pricing, or settlement state changes.",
        nextResolutionIds: ["inspect-money", "inspect-pricing"]
      },
      primary: false
    }),
    openMoneyControls: createAmbientAction({
      ...common,
      id: "open-governed-payment-controls",
      outcomeLabel: "Open quote workspace",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "route",
        targetId: model.quoteId,
        surfaceId: "legacy-opportunity-controls"
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: moneyReference,
        reason: "Review the existing role-safe deposit, balance-request, reconciliation, and settlement controls for this exact quote.",
        consequence: "Only the view changes. No request, collection, reconciliation, settlement, pricing, or provider evidence changes by navigation.",
        nextResolutionIds: ["choose-exact-payment-control", "dismiss-money-context"]
      },
      primary: false,
      enabled: legacyControlsAvailable,
      disabledReason: legacyControlsAvailable
        ? null
        : "The quote workspace handoff is unavailable."
    }),
    inspectConversation: createAmbientAction({
      ...common,
      ...conversationViewAvailability,
      id: "inspect-conversation",
      outcomeLabel: "Review conversation",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "conversation",
        surfaceId: conversationObject.descriptor.inspectorSurfaceId
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: conversationReference,
        reason: conversationObject.descriptor.why,
        consequence: conversationObject.descriptor.consequence,
        nextResolutionIds: conversationResolutionAvailability.enabled
          ? ["continue-conversation-resolution", "dismiss-conversation-context"]
          : ["dismiss-conversation-context"]
      },
      primary: false
    }),
    continueConversationResolution: createAmbientAction({
      ...common,
      ...conversationResolutionAvailability,
      id: "continue-conversation-resolution",
      outcomeLabel: conversationResolution?.label || "Continue communication resolution",
      purpose: "advance",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: conversationResolution?.target?.kind === "route" ? "route" : "context",
        targetId: text(
          conversationResolution?.target?.messageId
          || conversationResolution?.target?.requestId
          || conversationResolution?.target?.quoteId
          || model.quoteId
        ),
        surfaceId: conversationResolutionSurface || "conversation"
      },
      receiptType: "pending",
      reversibility: noRecovery,
      arrivalContract: {
        object: conversationReference,
        reason: conversationResolution?.reason || conversationObject.reason,
        consequence: conversationResolution?.consequence || conversationObject.consequence,
        nextResolutionIds: [
          conversationResolutionSurface === "workflow"
            ? "review-exact-workflow-item"
            : "review-opportunity-conversation"
        ]
      },
      primary: false
    }),
    dismissConversationContext: createAmbientAction({
      ...common,
      ...conversationViewAvailability,
      id: "dismiss-conversation-context",
      outcomeLabel: "Close conversation details",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "conversation",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: conversationReference,
        reason: "Close conversation details and return focus to the same button.",
        consequence: "No message is sent, marked read, acknowledged, inferred, or resolved; no workflow or quote state changes.",
        nextResolutionIds: ["inspect-conversation"]
      },
      primary: false
    }),
    inspectProposal: createAmbientAction({
      ...common,
      ...proposalViewAvailability,
      id: "inspect-proposal",
      outcomeLabel: "Review proposal",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "proposal",
        surfaceId: proposalObject.descriptor.inspectorSurfaceId
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: proposalReference,
        reason: proposalObject.descriptor.why,
        consequence: proposalObject.descriptor.consequence,
        nextResolutionIds: [
          ...(proposalEditorAvailability.enabled && proposalObject.readiness.gaps.length > 0
            ? ["review-proposal-in-editor"]
            : []),
          ...(proposalControlsAvailability.enabled ? ["open-governed-proposal-controls"] : []),
          "dismiss-proposal-context"
        ]
      },
      primary: false
    }),
    reviewProposalInEditor: createAmbientAction({
      ...common,
      ...proposalEditorAvailability,
      id: "review-proposal-in-editor",
      outcomeLabel: proposalObject.readiness.gaps.length > 0
        ? "Review proposal gaps in editor"
        : "Review proposal in editor",
      purpose: "advance",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "route",
        targetId: model.quoteId,
        surfaceId: "quote-editor"
      },
      receiptType: "pending",
      reversibility: noRecovery,
      arrivalContract: {
        object: proposalReference,
        reason: proposalObject.readiness.gaps.length > 0
          ? `Review the ${proposalObject.readiness.gaps.length} exact proposal completeness ${proposalObject.readiness.gaps.length === 1 ? "gap" : "gaps"} in the existing quote editor.`
          : "Review the current proposal projection against the exact editable quote.",
        consequence: "The existing quote editor opens on this opportunity. Nothing is repriced, saved, published, sent, rotated, or recovered by this navigation.",
        nextResolutionIds: ["review-proposal-fields", "leave-existing-version-unchanged"]
      },
      primary: false
    }),
    openProposalControls: createAmbientAction({
      ...common,
      ...proposalControlsAvailability,
      id: "open-governed-proposal-controls",
      outcomeLabel: "Open proposal controls",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "route",
        targetId: model.quoteId,
        surfaceId: "legacy-opportunity-controls"
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: proposalReference,
        reason: "Choose Prepare proposal, Send proposal, Replace customer link, or Review delivery in the existing role-safe quote workspace.",
        consequence: "Only the view changes. Before any action, the existing controls must independently recheck role, exact revision, authoritative pricing, customer-link issuance, delivery-provider state, approval, and safe retry state.",
        nextResolutionIds: ["choose-exact-proposal-control", "dismiss-proposal-context"]
      },
      primary: false
    }),
    dismissProposalContext: createAmbientAction({
      ...common,
      id: "dismiss-proposal-context",
      outcomeLabel: "Close proposal details",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "proposal",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: proposalReference,
        reason: "Close proposal details and return focus to the same button.",
        consequence: "No proposal artifact, price, customer-link issuance, delivery-provider evidence, customer activity, acceptance, payment, booking, or saved quote state changes.",
        nextResolutionIds: proposalViewAvailability.enabled
          ? ["inspect-proposal", "inspect-pricing"]
          : ["back-to-opportunities"]
      },
      primary: false
    }),
    inspectPackage: createAmbientAction({
      ...common,
      ...packageViewAvailability,
      id: "inspect-package",
      outcomeLabel: "Review package",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "package",
        surfaceId: packageObject.inspectorSurfaceId
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: packageReference,
        reason: packageObject.why,
        consequence: packageObject.consequence,
        nextResolutionIds: [
          ...(packageDraftIntentAvailable ? [packageObject.intentContract.actionId] : []),
          "dismiss-package-context"
        ]
      },
      primary: false
    }),
    dismissPackageContext: createAmbientAction({
      ...common,
      id: "dismiss-package-context",
      outcomeLabel: "Close package context",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "package",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: packageReference,
        reason: "Close the package inspector and return focus to its exact trigger.",
        consequence: "The saved package, current catalog evidence, and any editor draft remain unchanged.",
        nextResolutionIds: packageObject.permissions.view
          ? ["inspect-package"]
          : ["back-to-opportunities"]
      },
      primary: false
    }),
    inspectMenu: createAmbientAction({
      ...common,
      ...menuViewAvailability,
      id: "inspect-menu",
      outcomeLabel: "Review menu",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "menu",
        surfaceId: menuObject.inspectorSurfaceId
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: menuReference,
        reason: menuObject.why,
        consequence: menuObject.consequence,
        nextResolutionIds: [
          ...(menuReplaceIntentAvailable ? [menuObject.intentContracts.replace.actionId] : []),
          ...(menuReorderIntentAvailable ? [menuObject.intentContracts.reorder.actionId] : []),
          "dismiss-menu-context"
        ]
      },
      primary: false
    }),
    dismissMenuContext: createAmbientAction({
      ...common,
      id: "dismiss-menu-context",
      outcomeLabel: "Close menu context",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "menu",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: menuReference,
        reason: "Close the menu inspector and return focus to its exact trigger.",
        consequence: "The saved menu, current catalog evidence, and any editor draft remain unchanged.",
        nextResolutionIds: menuObject.permissions.view
          ? ["inspect-menu"]
          : ["back-to-opportunities"]
      },
      primary: false
    }),
    inspectSelections: createAmbientAction({
      ...common,
      enabled: selectionObjects.permissions.view && selectionObjects.populated,
      disabledReason: selectionObjects.permissions.view && selectionObjects.populated
        ? null
        : selectionObjects.permissions.reason || "No saved add-on or rental selections are recorded.",
      id: "inspect-event-selections",
      outcomeLabel: "Inspect add-ons, rentals, bar, and services",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "event-selections",
        surfaceId: "selection-context"
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: selectionsReference,
        reason: "Review every saved add-on and rental as a quantity-aware object, including bounded bar and service groupings when their evidence supports that interpretation.",
        consequence: "The inspector shows saved quantities, dependencies, recommendation evidence, and unsaved previews. No price, selection, reservation, assignment, or saved quote changes merely by opening it.",
        nextResolutionIds: [
          ...selectionObjects.objects
            .filter((item) => item.adjustment.enabled)
            .slice(0, 1)
            .map((item) => item.actionIds.reduce),
          "dismiss-selection-context"
        ]
      },
      primary: false
    }),
    dismissSelectionContext: createAmbientAction({
      ...common,
      id: "dismiss-selection-context",
      outcomeLabel: "Close selection context",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: "event-selections",
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: selectionsReference,
        reason: "Close the populated selection inspector and return focus to its exact trigger.",
        consequence: "The saved quote remains unchanged. Any reversible unsaved selection preview remains visible in the Living Opportunity and undo rail.",
        nextResolutionIds: ["inspect-event-selections", "clear-scenario-history"]
      },
      primary: false
    }),
    explainNextAction: createAmbientAction({
      ...common,
      id: "explain-next-action",
      outcomeLabel: "Explain the next step",
      purpose: "clarify",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "context", targetId: nextAction.id, surfaceId: "pilot-context" },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object,
        reason: nextAction.reason,
        consequence: nextAction.consequence,
        nextResolutionIds: nextAction.kind === "caught_up"
          ? ["back-to-opportunities"]
          : [nextAction.id]
      },
      primary: false
    }),
    dismissPilotContext: createAmbientAction({
      ...common,
      id: "dismiss-pilot-context",
      outcomeLabel: "Close Pilot explanation",
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: nextAction.id,
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object,
        reason: "Close Pilot's explanation and return focus to the exact question that opened it.",
        consequence: "The opportunity and its recommended next step remain unchanged.",
        nextResolutionIds: [
          nextAction.kind === "caught_up" ? "back-to-opportunities" : nextAction.id,
          "explain-next-action"
        ]
      },
      primary: false
    }),
    revealMobileEventDetails: createAmbientAction({
      ...common,
      id: "reveal-mobile-event-details",
      outcomeLabel: "Show event details",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "context", targetId: model.quoteId, surfaceId: "mobile-event-details" },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object,
        reason: "Show the date, time, duration, and venue recorded for this opportunity.",
        consequence: "The exact saved event details become available for inspection without changing the quote.",
        nextResolutionIds: AMBIENT_EVENT_LOGISTICS_OBJECT_KINDS.map((kind) => `inspect-event-${kind}`)
      },
      primary: false
    }),
    revealOperationalFacts: createAmbientAction({
      ...common,
      id: "reveal-operational-facts",
      outcomeLabel: "Show event, menu, staffing, and pricing",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "context", targetId: model.quoteId, surfaceId: "operational-facts-layer" },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object,
        reason: "Show the recorded event details that shape this opportunity.",
        consequence: "Event, menu, staffing, and saved pricing context becomes visible without changing the quote.",
        nextResolutionIds: ["reveal-supporting-evidence"]
      },
      primary: false
    }),
    revealSupportingEvidence: createAmbientAction({
      ...common,
      id: "reveal-supporting-evidence",
      outcomeLabel: "Show margin, history, activity, and automation context",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: { kind: "context", targetId: model.quoteId, surfaceId: "supporting-evidence-layer" },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object,
        reason: "Show more context without treating incomplete information as certain.",
        consequence: "Margin, version, customer-activity, and Workflow evidence becomes visible without changing the quote.",
        nextResolutionIds: [nextAction.kind === "caught_up" ? "back-to-opportunities" : nextAction.id]
      },
      primary: false
    }),
    openLegacyControls: createAmbientAction({
      ...common,
      id: "open-full-opportunity-controls",
      outcomeLabel: "Open quote workspace",
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "route",
        targetId: model.quoteId,
        surfaceId: "legacy-opportunity-controls"
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object,
        reason: "Open the existing role-safe Schedule, Client, BEO, PDF, lifecycle, and quote actions while this new view is still being completed.",
        consequence: "Only the view changes. The saved quote and any unsaved preview remain unchanged.",
        nextResolutionIds: ["choose-exact-opportunity-control", "back-to-opportunities"]
      },
      primary: false,
      enabled: legacyControlsAvailable,
      disabledReason: legacyControlsAvailable
        ? null
        : "The quote workspace handoff is unavailable."
    })
  };

  if (packageDraftIntentAvailable) {
    actions.replacePackageInDraft = createAmbientAction({
      ...common,
      id: packageObject.intentContract.actionId,
      outcomeLabel: "Choose package replacement in editor",
      purpose: "advance",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "draft_mutation",
        targetId: model.quoteId,
        surfaceId: "quote-editor"
      },
      receiptType: "pending",
      reversibility: {
        kind: "manual_recovery",
        actionId: "leave-existing-version-unchanged"
      },
      arrivalContract: {
        object: packageReference,
        reason: packageObject.intentContract.reason,
        consequence: "The editor may form a package replacement only from the kernel's exact saved revision, fresh same-tenant catalog revision, and bounded eligible candidates. No package, price, availability, or saved version changes until explicit adoption and an outcome-named save succeed.",
        nextResolutionIds: [
          "choose-exact-package-candidate",
          "review-live-price",
          "leave-existing-version-unchanged"
        ]
      },
      primary: false
    });
  }

  if (menuReplaceIntentAvailable) {
    actions.replaceMenuItemInDraft = createAmbientAction({
      ...common,
      id: menuObject.intentContracts.replace.actionId,
      outcomeLabel: "Choose menu replacement in editor",
      purpose: "advance",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "draft_mutation",
        targetId: model.quoteId,
        surfaceId: "quote-editor"
      },
      receiptType: "pending",
      reversibility: {
        kind: "manual_recovery",
        actionId: "leave-existing-version-unchanged"
      },
      arrivalContract: {
        object: menuReference,
        reason: menuObject.intentContracts.replace.reason,
        consequence: "The editor may replace only an exact saved item and preserve its explicit saved quantity and order using the kernel's fresh same-tenant catalog candidates. No menu, price, preparation, availability, or saved version changes until explicit adoption and an outcome-named save succeed.",
        nextResolutionIds: [
          "choose-exact-menu-candidate",
          "review-live-price",
          "leave-existing-version-unchanged"
        ]
      },
      primary: false
    });
  }

  if (menuReorderIntentAvailable) {
    actions.reorderMenuInDraft = createAmbientAction({
      ...common,
      id: menuObject.intentContracts.reorder.actionId,
      outcomeLabel: "Reorder exact menu in editor",
      purpose: "advance",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "draft_mutation",
        targetId: model.quoteId,
        surfaceId: "quote-editor"
      },
      receiptType: "pending",
      reversibility: {
        kind: "manual_recovery",
        actionId: "leave-existing-version-unchanged"
      },
      arrivalContract: {
        object: menuReference,
        reason: menuObject.intentContracts.reorder.reason,
        consequence: "The editor may stage only a bounded order over exact saved menu identities, with equivalent pointer and keyboard intent semantics. No item, quantity, price, preparation, availability, or saved version changes until explicit adoption and an outcome-named save succeed.",
        nextResolutionIds: [
          "review-exact-menu-order",
          "review-live-price",
          "leave-existing-version-unchanged"
        ]
      },
      primary: false
    });
  }

  selectionObjects.objects.forEach((selectionObject) => {
    const reference = {
      id: selectionObject.id,
      type: "selection-intelligent-object",
      label: selectionObject.label
    };
    const adjustmentAvailability = {
      enabled: selectionObject.adjustment.enabled,
      disabledReason: selectionObject.adjustment.enabled
        ? null
        : selectionObject.adjustment.reason
    };
    const scenarioConsequence = selectionObject.descriptor.consequence;

    actions[selectionObject.actionIds.reduce] = createAmbientAction({
      ...common,
      ...adjustmentAvailability,
      id: selectionObject.actionIds.reduce,
      outcomeLabel: selectionObject.adjustment.quantityMutable
        ? `Reduce ${selectionObject.label} in preview`
        : `Remove ${selectionObject.label} from preview`,
      purpose: "simulate",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "simulation",
        targetId: selectionObject.id,
        surfaceId: "selection-context"
      },
      receiptType: "preview",
      reversibility: {
        kind: "undo",
        actionId: selectionObject.actionIds.undo,
        windowMs: 86_400_000
      },
      arrivalContract: {
        object: reference,
        reason: selectionObject.adjustment.quantityMutable
          ? `Preview one fewer ${selectionObject.label} unit without changing the saved quote.`
          : `Preview removing ${selectionObject.label} without changing the saved quote.`,
        consequence: scenarioConsequence,
        nextResolutionIds: [selectionObject.actionIds.undo, "dismiss-selection-context"]
      },
      primary: false
    });
    actions[selectionObject.actionIds.increase] = createAmbientAction({
      ...common,
      ...adjustmentAvailability,
      id: selectionObject.actionIds.increase,
      outcomeLabel: selectionObject.adjustment.quantityMutable
        ? `Add one ${selectionObject.label} to preview`
        : `Restore ${selectionObject.label} in preview`,
      purpose: "simulate",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "simulation",
        targetId: selectionObject.id,
        surfaceId: "selection-context"
      },
      receiptType: "preview",
      reversibility: {
        kind: "undo",
        actionId: selectionObject.actionIds.undo,
        windowMs: 86_400_000
      },
      arrivalContract: {
        object: reference,
        reason: selectionObject.adjustment.quantityMutable
          ? `Preview one more ${selectionObject.label} unit without changing the saved quote.`
          : `Restore ${selectionObject.label} after removing it from the unsaved preview.`,
        consequence: scenarioConsequence,
        nextResolutionIds: [selectionObject.actionIds.undo, "dismiss-selection-context"]
      },
      primary: false
    });
    actions[selectionObject.actionIds.keep] = createAmbientAction({
      ...common,
      id: selectionObject.actionIds.keep,
      outcomeLabel: `Restore saved ${selectionObject.label} selection`,
      purpose: "resolve",
      authorityLevel: "draft",
      previewPolicy: "none",
      executionTarget: {
        kind: "simulation",
        targetId: selectionObject.id,
        surfaceId: "selection-context"
      },
      receiptType: "resolved",
      reversibility: selectionObject.adjustment.enabled
        ? {
            kind: "undo",
            actionId: selectionObject.actionIds.undo,
            windowMs: 86_400_000
          }
        : noRecovery,
      arrivalContract: {
        object: reference,
        reason: selectionObject.recommendationEvidence?.reason
          || "Restore the exact saved selection in the unsaved preview.",
        consequence: "Any unsaved preview for this object is discarded and the saved selection is shown again. The saved quote remains unchanged.",
        nextResolutionIds: selectionObject.adjustment.enabled
          ? [selectionObject.actionIds.undo, selectionObject.actionIds.reduce, "dismiss-selection-context"]
          : ["dismiss-selection-context"]
      },
      primary: false
    });
    actions[selectionObject.actionIds.undo] = createAmbientAction({
      ...common,
      ...adjustmentAvailability,
      id: selectionObject.actionIds.undo,
      outcomeLabel: `Undo ${selectionObject.label} preview`,
      purpose: "resolve",
      authorityLevel: "draft",
      previewPolicy: "none",
      executionTarget: {
        kind: "simulation",
        targetId: selectionObject.id,
        surfaceId: "selection-context"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: reference,
        reason: `Reverse the latest unsaved ${selectionObject.label} preview step.`,
        consequence: "The previous unsaved selection quantity is restored. The saved quote remains unchanged.",
        nextResolutionIds: [selectionObject.actionIds.reduce, selectionObject.actionIds.increase]
      },
      primary: false
    });
  });

  AMBIENT_EVENT_LOGISTICS_OBJECT_KINDS.forEach((kind) => {
    const descriptor = eventLogisticsObjects[kind];
    const keys = eventLogisticsActionKeys[kind];
    const inspectId = `inspect-${descriptor.id}`;
    const dismissId = `dismiss-${descriptor.id}-context`;
    const stageId = descriptor.staging?.actionId || `stage-${descriptor.id}`;
    const reference = {
      id: descriptor.id,
      type: "intelligent-object",
      label: descriptor.label
    };
    const viewAvailability = {
      enabled: descriptor.permissions.view,
      disabledReason: descriptor.permissions.view ? null : descriptor.permissions.reason
    };
    const exactStagingAvailable = Boolean(
      descriptor.permissions.stage
      && descriptor.savedValue?.state === "available"
      && descriptor.staging?.authority === "draft_only"
      && descriptor.staging?.commit === false
      && descriptor.staging?.target?.objectId === descriptor.id
      && Array.isArray(descriptor.staging?.target?.fieldPaths)
      && descriptor.staging.target.fieldPaths.length > 0
    );
    const stageAvailability = {
      enabled: exactStagingAvailable,
      disabledReason: exactStagingAvailable
        ? null
        : descriptor.permissions.reason || "Exact draft-only staging metadata is unavailable."
    };

    actions[keys.inspect] = createAmbientAction({
      ...common,
      ...viewAvailability,
      id: inspectId,
      outcomeLabel: `Review ${descriptor.label.toLowerCase()}`,
      purpose: "reveal_context",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: descriptor.id,
        surfaceId: descriptor.inspectorSurfaceId
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object: reference,
        reason: descriptor.why,
        consequence: descriptor.consequence,
        nextResolutionIds: exactStagingAvailable ? [stageId, dismissId] : [dismissId]
      },
      primary: false
    });
    actions[keys.stage] = createAmbientAction({
      ...common,
      ...stageAvailability,
      id: stageId,
      outcomeLabel: `Continue ${descriptor.label.toLowerCase()} in editor`,
      purpose: "advance",
      authorityLevel: "draft",
      previewPolicy: "required",
      executionTarget: {
        kind: "draft_mutation",
        targetId: model.quoteId,
        surfaceId: "quote-editor"
      },
      receiptType: "pending",
      reversibility: {
        kind: "manual_recovery",
        actionId: "leave-existing-version-unchanged"
      },
      arrivalContract: {
        object,
        reason: exactStagingAvailable
          ? `Continue the exact saved ${descriptor.label.toLowerCase()} in the selected quote editor with draft-only intent metadata.`
          : stageAvailability.disabledReason,
        consequence: exactStagingAvailable
          ? `The editor opens on ${descriptor.label.toLowerCase()} with its saved value and dependency context. No value is applied, reserved, repriced, scheduled, or saved by this handoff.`
          : "The editor handoff remains unavailable; the saved quote and any existing draft remain unchanged.",
        nextResolutionIds: ["review-event-logistics-draft", "leave-existing-version-unchanged"]
      },
      primary: false
    });
    actions[keys.dismiss] = createAmbientAction({
      ...common,
      ...viewAvailability,
      id: dismissId,
      outcomeLabel: `Close ${descriptor.label.toLowerCase()} context`,
      purpose: "resolve",
      authorityLevel: "presentation",
      previewPolicy: "none",
      executionTarget: {
        kind: "context",
        targetId: descriptor.id,
        surfaceId: "living-opportunity"
      },
      receiptType: "resolved",
      reversibility: noRecovery,
      arrivalContract: {
        object: reference,
        reason: `Close the ${descriptor.label.toLowerCase()} inspector and return focus to its exact trigger.`,
        consequence: "The saved quote, evidence snapshot, and any editor draft remain unchanged.",
        nextResolutionIds: [inspectId]
      },
      primary: false
    });
  });

  if (nextAction.kind !== "caught_up") {
    const targetKind = nextAction.kind === "edit" ? "route" : "route";
    actions.primary = createAmbientAction({
      ...common,
      id: nextAction.id,
      outcomeLabel: nextAction.label,
      purpose: "resolve",
      authorityLevel: nextAction.kind === "edit" ? "draft" : "presentation",
      previewPolicy: nextAction.kind === "edit" ? "required" : "none",
      executionTarget: {
        kind: targetKind,
        targetId: nextAction.target?.quoteId || model.quoteId,
        surfaceId: nextAction.kind === "workflow"
          ? "workflow"
          : nextAction.kind === "conversation"
            ? "conversation"
            : "quote-editor"
      },
      receiptType: "context",
      reversibility: noRecovery,
      arrivalContract: {
        object,
        reason: nextAction.reason,
        consequence: nextAction.consequence,
        nextResolutionIds: [
          nextAction.kind === "edit"
            ? "review-live-price"
            : nextAction.kind === "workflow"
              ? "review-exact-workflow-item"
              : "review-opportunity-conversation"
        ]
      },
      primary: true
    });
  }
  return Object.freeze(actions);
}

function buildMomentumContract({ quote, model, proposal, nextAction }) {
  const object = objectReference(model);
  const status = text(quote.status || "draft").toLowerCase();
  const candidates = [];
  if (nextAction.kind !== "caught_up") {
    candidates.push({
      id: nextAction.id,
      label: nextAction.label,
      category: nextAction.category,
      severity: model.attention.target ? "warning" : "attention",
      object,
      reason: nextAction.reason,
      consequence: nextAction.consequence,
      resolutionActionId: nextAction.id,
      availability: "available"
    });
  }
  return createOpportunityMomentum({
    domains: {
      proposal: {
        state: proposal.complete ? "healthy" : "attention",
        summary: proposal.complete
          ? "Required proposal fields are recorded."
          : `${proposal.gaps.length} weighted proposal fields need review.`,
        evidence: [{ model: "proposal-readiness-v1", gapCount: proposal.gaps.length }],
        completenessPercent: proposal.score
      },
      commercial: {
        state: "unavailable",
        summary: Number(quote.totals?.total) > 0
          ? "A saved total is recorded, but pricing and margin status cannot yet be confirmed."
          : "Pricing and margin are unavailable.",
        reason: Number(quote.totals?.total) > 0
          ? "A positive saved total does not establish current cost coverage, margin health, or authoritative repricing."
          : "No positive saved quoted total is recorded.",
        evidence: Number(quote.totals?.total) > 0 ? [{ totalRecorded: true }] : []
      },
      customer: ["accepted", "booked"].includes(status)
        ? {
            state: "healthy",
            summary: `Recorded lifecycle state: ${model.status.label}.`,
            evidence: [{ lifecycleStatus: status }]
          }
        : ["sent", "viewed"].includes(status)
          ? {
              state: "attention",
              summary: `Recorded lifecycle state: ${model.status.label}.`,
              evidence: [{ lifecycleStatus: status }]
            }
          : {
              state: "unavailable",
              summary: "Customer state is unavailable.",
              reason: "No sent, viewed, accepted, or booked lifecycle evidence is recorded.",
              evidence: []
            },
      operational: model.attention.target
        ? {
            state: "attention",
            summary: model.attention.title,
            evidence: [{ attentionType: model.attention.target.attentionType }]
          }
        : {
          state: "unavailable",
          summary: "The current record does not show enough to summarize event planning.",
          reason: "No workflow item is waiting, but that does not confirm the event plan is complete.",
          evidence: []
        }
    },
    candidates,
    nextActionUnavailableReason: candidates.length
      ? undefined
      : "No tracked role-safe action is required on the bounded evidence."
  });
}

function buildVisibleMomentum(momentumContract, statusLabel) {
  const stateValue = (domain) => {
    if (domain.state === "unavailable") return "Not enough detail";
    if (domain.state === "attention") return "Needs attention";
    return "On track";
  };
  const domain = (id) => momentumContract.domains[id];

  return Object.freeze({
    proposal: Object.freeze({
      id: "proposal",
      kind: domain("proposal").kind,
      state: domain("proposal").state,
      label: "Proposal completeness",
      value: `${domain("proposal").completenessPercent}%`,
      detail: `Proposal completeness only. ${domain("proposal").summary}`
    }),
    commercial: Object.freeze({
      id: "commercial",
      kind: domain("commercial").kind,
      state: domain("commercial").state,
      label: "Pricing and margin",
      value: stateValue(domain("commercial")),
      detail: domain("commercial").reason || domain("commercial").summary
    }),
    customer: Object.freeze({
      id: "customer",
      kind: domain("customer").kind,
      state: domain("customer").state,
      label: "Customer state",
      value: domain("customer").state === "unavailable" ? "Unavailable" : statusLabel,
      detail: domain("customer").reason || domain("customer").summary
    }),
    operational: Object.freeze({
      id: "operational",
      kind: domain("operational").kind,
      state: domain("operational").state,
      label: "Event planning",
      value: stateValue(domain("operational")),
      detail: domain("operational").reason || domain("operational").summary
    })
  });
}

export function buildAmbientLivingOpportunityPresentation(quote = {}, {
  source = "",
  sourceFreshness = "unknown",
  ordinaryEditAllowed = false,
  conversationAvailable = false,
  conversationHandlerAvailable = false,
  workflowHandlerAvailable = false,
  legacyControlsAvailable = false,
  operationalStaffingEnabled = false,
  pricingPreviewAvailable = false,
  pricingMargin = null,
  eventLogisticsEvidence = null,
  packageMenuCatalogEvidence = null,
  scenarioGuestCount,
  role = "non_staff",
  now,
  todayISO
} = {}) {
  const model = buildEventWorkspacePresentation(quote, {
    source,
    ordinaryEditAllowed,
    now,
    todayISO
  });
  const proposal = buildProposalReadiness(quote);
  const guestObject = buildAmbientGuestObject(quote, scenarioGuestCount);
  const staffingObject = buildAmbientStaffingObject(quote, {
    guestCount: guestObject.scenarioGuestCount,
    ordinaryEditAllowed,
    source
  });
  const pricingObject = buildAmbientPricingObject(quote, {
    source,
    ordinaryEditAllowed,
    margin: pricingMargin
  });
  const moneyObject = buildAmbientMoneyObject(quote, { sourceMode: source });
  const normalizedRole = text(role).toLowerCase() || "non_staff";
  const operationalReceipts = buildAmbientOperationalReceipts(quote, {
    role: normalizedRole
  });
  const conversationObject = buildAmbientConversationObject(quote, {
    sourceMode: source,
    sourceFreshness,
    role: normalizedRole,
    todayISO,
    conversationAvailable
  });
  const proposalObject = buildAmbientProposalObject(quote, {
    sourceMode: source,
    sourceFreshness,
    role: normalizedRole,
    nowISO: now instanceof Date ? now.toISOString() : text(now) || undefined
  });
  const packageMenuObjects = buildAmbientPackageMenuObjects(quote, {
    role: normalizedRole,
    ordinaryEditAllowed,
    catalogEvidence: packageMenuCatalogEvidence
  });
  const packageObject = packageMenuObjects.package;
  const menuObject = packageMenuObjects.menu;
  const selectionObjects = buildAmbientSelectionObjects(quote, {
    source,
    role: normalizedRole,
    ordinaryEditAllowed,
    catalogEvidence: packageMenuCatalogEvidence
  });
  const eventLogisticsObjects = buildAmbientEventLogisticsObjects(quote, {
    role: normalizedRole,
    ordinaryEditAllowed,
    evidence: eventLogisticsEvidence || {}
  });
  const risk = buildRisk({ model, proposal, guestObject });
  const nextAction = buildNextAction({
    model,
    risk,
    ordinaryEditAllowed
  });
  const object = objectReference(model);
  const surfaceContract = createSurfacePurposeContract({
    id: "living-opportunity",
    objectScopes: ["opportunity"],
    purposes: ["clarify", "advance", "resolve", "simulate", "reveal_context"],
    entryReason: "Review the selected opportunity and its highest-ranked next resolution.",
    allowedEmptyState: {
      kind: "caught_up",
      message: "No tracked role-safe action is required on the bounded evidence."
    },
    recoveryBehavior: {
      message: "Return to Opportunities without changing the selected quote.",
      nextActionIds: ["back-to-opportunities"]
    }
  });
  const opportunitiesSurfaceContract = createSurfacePurposeContract({
    id: "opportunities",
    objectScopes: ["opportunity"],
    purposes: ["clarify", "reveal_context", "resolve"],
    entryReason: "Orient the user in the opportunity stream after leaving the selected object.",
    allowedEmptyState: {
      kind: "caught_up",
      message: "No opportunity currently needs attention."
    },
    recoveryBehavior: {
      message: "Return to the selected Living Opportunity without changing its quote.",
      nextActionIds: ["open-opportunity"]
    }
  });
  const guestContextSurfaceContract = createSurfacePurposeContract({
    id: "guest-count-context",
    objectScopes: ["intelligent-object"],
    purposes: ["reveal_context", "simulate", "advance"],
    entryReason: "Explain guest-count dependencies and create an unsaved preview.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Close the inspector and preserve the current saved quote and unsaved preview.",
      nextActionIds: ["inspect-guest-count", "back-to-opportunities"]
    }
  });
  const guestInlineEditorSurfaceContract = createSurfacePurposeContract({
    id: "guest-count-inline-editor",
    objectScopes: ["intelligent-object"],
    purposes: ["clarify", "advance", "resolve", "simulate"],
    entryReason: "Edit and validate an unsaved guest-count preview in place.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Cancel the inline edit and preserve the current unsaved preview and saved quote.",
      nextActionIds: ["cancel-guest-count-inline-edit", "inspect-guest-count"]
    }
  });
  const staffingContextSurfaceContract = createSurfacePurposeContract({
    id: "staffing-context",
    objectScopes: ["intelligent-object"],
    purposes: ["clarify", "reveal_context", "simulate", "resolve", "advance"],
    entryReason: "Explain saved staffing, the house staffing guide, connected details, and local next steps.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Close the staffing inspector and preserve the saved counts and any unsaved preview.",
      nextActionIds: ["inspect-staffing", "keep-current-staffing"]
    }
  });
  const pricingContextSurfaceContract = createSurfacePurposeContract({
    id: "pricing-context",
    objectScopes: ["intelligent-object"],
    purposes: ["clarify", "reveal_context", "simulate", "advance", "resolve"],
    entryReason: "Explain the saved price, dependencies, margin boundary, and a guest-count preview.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Close the pricing inspector and preserve the saved quote and any unsaved preview.",
      nextActionIds: ["inspect-pricing", "open-priced-editor"]
    }
  });
  const moneyContextSurfaceContract = createSurfacePurposeContract({
    id: moneyObject.descriptor.inspectorSurfaceId,
    objectScopes: ["commercial-evidence"],
    purposes: ["clarify", "reveal_context", "resolve"],
    entryReason: "Keep deposit policy, payment requests, and provider-confirmed settlements as five separate evidence domains.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Close money evidence without requesting, collecting, reconciling, or repricing anything.",
      nextActionIds: ["dismiss-money-context", "inspect-pricing"]
    }
  });
  const conversationContextSurfaceContract = createSurfacePurposeContract({
    id: conversationObject.descriptor.inspectorSurfaceId,
    objectScopes: ["customer-communication-evidence"],
    purposes: ["clarify", "reveal_context", "advance", "resolve"],
    entryReason: "Keep sent, delivery-provider, customer-link view, reply, inferred-engagement, customer-request, and internal follow-up evidence explicit on one exact opportunity.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Close communication evidence without sending, reading, acknowledging, inferring, or resolving anything.",
      nextActionIds: ["dismiss-conversation-context", "inspect-conversation"]
    }
  });
  const proposalContextSurfaceContract = createSurfacePurposeContract({
    id: proposalObject.descriptor.inspectorSurfaceId,
    objectScopes: ["customer-decision-artifact"],
    purposes: ["clarify", "reveal_context", "advance", "resolve"],
    entryReason: "Explain exact proposal completeness, the customer projection, saved revision, authoritative pricing, customer-link issuance, and delivery-provider evidence without blending their authority.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Close proposal evidence without preparing, repricing, publishing, sending, rotating, recovering, or changing any customer activity state.",
      nextActionIds: ["dismiss-proposal-context", "inspect-proposal"]
    }
  });
  const packageContextSurfaceContract = createSurfacePurposeContract({
    id: packageObject.inspectorSurfaceId,
    objectScopes: ["intelligent-object"],
    purposes: ["clarify", "reveal_context", "advance", "resolve"],
    entryReason: "Explain the exact saved package, recorded inclusions, current-catalog evidence, dependencies, and any kernel-permitted draft-only replacement.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Close the package inspector without changing the saved package, catalog evidence, or any editor draft.",
      nextActionIds: ["dismiss-package-context", "back-to-opportunities"]
    }
  });
  const menuContextSurfaceContract = createSurfacePurposeContract({
    id: menuObject.inspectorSurfaceId,
    objectScopes: ["intelligent-object"],
    purposes: ["clarify", "reveal_context", "advance", "resolve"],
    entryReason: "Explain exact saved menu identities, quantities, order, package-inclusion links, current-catalog evidence, and any kernel-permitted draft-only manipulation.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Close the menu inspector without changing the saved menu, catalog evidence, or any editor draft.",
      nextActionIds: ["dismiss-menu-context", "back-to-opportunities"]
    }
  });
  const selectionContextSurfaceContract = createSurfacePurposeContract({
    id: "selection-context",
    objectScopes: ["intelligent-object-collection", "selection-intelligent-object"],
    purposes: ["clarify", "reveal_context", "simulate", "resolve"],
    entryReason: "Explain each saved add-on and rental selection, its quantity, dependencies, evidence-backed grouping, and reversible unsaved previews.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Close the populated selection inspector while preserving the saved quote and any reversible unsaved previews.",
      nextActionIds: ["dismiss-selection-context", "inspect-event-selections"]
    }
  });
  const pilotContextSurfaceContract = createSurfacePurposeContract({
    id: "pilot-context",
    objectScopes: ["opportunity"],
    purposes: ["clarify", "resolve"],
    entryReason: "Explain why Pilot recommends the current next step.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Close Pilot context and continue on the same opportunity.",
      nextActionIds: ["explain-next-action", "back-to-opportunities"]
    }
  });
  const quoteEditorSurfaceContract = createSurfacePurposeContract({
    id: "quote-editor",
    objectScopes: ["opportunity", "customer-decision-artifact"],
    purposes: ["advance", "resolve", "simulate"],
    entryReason: "Review the exact selected quote with live client pricing before intentional save.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Leave the editor without saving to preserve the current stored version.",
      nextActionIds: ["leave-existing-version-unchanged", "back-to-opportunities"]
    }
  });
  const workflowSurfaceContract = createSurfacePurposeContract({
    id: "workflow",
    objectScopes: ["opportunity"],
    purposes: ["reveal_context", "resolve"],
    entryReason: "Open the exact tracked Workflow item and its role-gated resolution.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Return to the same opportunity without changing the quote.",
      nextActionIds: ["back-to-opportunities"]
    }
  });
  const conversationSurfaceContract = createSurfacePurposeContract({
    id: "conversation",
    objectScopes: ["opportunity"],
    purposes: ["reveal_context", "resolve"],
    entryReason: "Open the exact opportunity conversation when customer evidence requires review.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Return to the same opportunity without sending a message.",
      nextActionIds: ["back-to-opportunities"]
    }
  });
  const operationalFactsSurfaceContract = createSurfacePurposeContract({
    id: "operational-facts-layer",
    objectScopes: ["opportunity"],
    purposes: ["clarify", "reveal_context"],
    entryReason: "Show recorded event, menu, staffing, and saved pricing details.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Continue on the same opportunity without changing the saved quote.",
      nextActionIds: ["reveal-supporting-evidence", "back-to-opportunities"]
    }
  });
  const mobileEventDetailsSurfaceContract = createSurfacePurposeContract({
    id: "mobile-event-details",
    objectScopes: ["opportunity"],
    purposes: ["clarify", "reveal_context"],
    entryReason: "Show the exact saved event details from the mobile opportunity remote.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Continue on the same opportunity without changing the saved quote.",
      nextActionIds: ["back-to-opportunities"]
    }
  });
  const supportingEvidenceSurfaceContract = createSurfacePurposeContract({
    id: "supporting-evidence-layer",
    objectScopes: ["opportunity"],
    purposes: ["clarify", "reveal_context"],
    entryReason: "Show margin, history, customer activity, and Workflow context without guessing.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Continue on the same opportunity with unavailable evidence left explicit.",
      nextActionIds: ["back-to-opportunities"]
    }
  });
  const legacyOpportunityControlsSurfaceContract = createSurfacePurposeContract({
    id: "legacy-opportunity-controls",
    objectScopes: ["opportunity", "customer-decision-artifact"],
    purposes: ["reveal_context", "resolve"],
    entryReason: "Preserve access to existing role-safe opportunity controls while Ambient parity remains open.",
    allowedEmptyState: null,
    recoveryBehavior: {
      message: "Return to the Living Opportunity without changing the saved quote.",
      nextActionIds: ["back-to-opportunities"]
    }
  });
  const eventLogisticsSurfaceContracts = Object.freeze(Object.fromEntries(
    AMBIENT_EVENT_LOGISTICS_OBJECT_KINDS.map((kind) => {
      const descriptor = eventLogisticsObjects[kind];
      return [kind, createSurfacePurposeContract({
        id: descriptor.inspectorSurfaceId,
        objectScopes: ["intelligent-object"],
        purposes: ["clarify", "reveal_context", "advance", "resolve"],
        entryReason: `Explain the exact saved ${descriptor.label.toLowerCase()}, its evidence coverage, dependencies, and draft-only handoff.`,
        allowedEmptyState: null,
        recoveryBehavior: {
          message: `Close the ${descriptor.label.toLowerCase()} inspector without changing the saved quote or any editor draft.`,
          nextActionIds: [`inspect-${descriptor.id}`]
        }
      })];
    })
  ));
  const guestDependencies = dependencyContracts(guestObject);
  const guestDescriptor = createIntelligentObjectDescriptor({
    id: "guest-count",
    type: "intelligent-object",
    label: "Guest count",
    summary: `${guestObject.scenarioGuestCount} guests in the active unsaved preview.`,
    inspectorSurfaceId: "guest-count-context",
    dependencies: guestDependencies,
    why: guestObject.why,
    consequence: guestObject.consequence,
    doNothing: guestObject.doNothing,
    confidence: {
      level: guestObject.scenarioStaffing.available ? "high" : "unavailable",
      basis: guestObject.scenarioStaffing.available
        ? guestObject.scenarioStaffing.basis
        : guestObject.scenarioStaffing.reason
    },
    provenance: provenanceContracts(guestObject, quote, source),
    recommendation: guestObject.scenarioStaffing.available
      ? {
          summary: guestObject.scenarioStaffing.recommendation,
          actionId: ordinaryEditAllowed ? "stage-guest-count-in-editor" : "inspect-guest-count"
        }
      : null,
    permissions: {
      view: true,
      simulate: ordinaryEditAllowed,
      stage: ordinaryEditAllowed,
      commit: false,
      reason: ordinaryEditAllowed
        ? "The Living Opportunity stages only; trusted save remains in the quote editor."
        : model.editBoundary
    },
    actionIds: ordinaryEditAllowed
      ? [
          "inspect-guest-count",
          "open-guest-count-inline-edit",
          "simulate-guest-count",
          "stage-guest-count-in-editor",
          "open-priced-editor"
        ]
      : ["inspect-guest-count"]
  });
  const guestImpactPreview = createImpactPreview({
    id: `guest-count:${model.quoteId}`,
    object: { id: "guest-count", type: "intelligent-object", label: "Guest count" },
    status: "unavailable",
    baseRevision: text(
      quote.activeVersionId
      || quote.versionMeta?.versionId
      || quote.updatedAtISO
      || "saved-record-revision-unavailable"
    ),
    source: {
      sourceId: `quote:${model.quoteId}`,
      label: "Saved-record opportunity view",
      type: text(source) || "saved-record",
      state: "available"
    },
    before: { guests: guestObject.currentGuestCount },
    after: null,
    deltas: [],
    commercialDeltas: null,
    affectedDependencies: guestDependencies,
    warnings: [],
    unavailableReasons: [guestObject.preview.reason]
  });
  const staffingImpactPreview = createImpactPreview({
    id: `staffing:${model.quoteId}`,
    object: { id: "staffing", type: "intelligent-object", label: "Staffing" },
    status: staffingObject.hasRecommendation ? "partial" : "unavailable",
    baseRevision: text(
      quote.activeVersionId
      || quote.versionMeta?.versionId
      || quote.updatedAtISO
      || "saved-record-revision-unavailable"
    ),
    source: staffingObject.provenance.find((entry) => entry.sourceId === "house-staffing-ratios")
      || staffingObject.provenance[0],
    before: staffingObject.hasRecommendation ? staffingObject.current : null,
    after: staffingObject.hasRecommendation ? staffingObject.recommended : null,
    deltas: staffingObject.hasRecommendation
      ? [
          { field: "servers", before: staffingObject.current.servers, after: staffingObject.recommended.servers },
          { field: "chefs", before: staffingObject.current.chefs, after: staffingObject.recommended.chefs },
          { field: "bartenders", before: staffingObject.current.bartenders, after: staffingObject.recommended.bartenders }
        ]
      : [],
    commercialDeltas: null,
    affectedDependencies: staffingObject.dependencies,
    warnings: staffingObject.guidance.available
      ? ["STAFF_RULES declares no bartender ratio and does not establish staff availability or assignments."]
      : [],
    unavailableReasons: staffingObject.hasRecommendation
      ? ["Exact labor, fee, tax, deposit, margin, availability, schedule, and BEO consequences must be confirmed in their existing records."]
      : [staffingObject.unavailableReason]
  });
  const actions = buildAmbientActions({
    model,
    guestObject,
    staffingObject,
    pricingObject,
    conversationObject,
    moneyObject,
    proposalObject,
    operationalReceipts,
    packageObject,
    menuObject,
    selectionObjects,
    packageMenuCatalogContext: packageMenuObjects.catalogEvidence,
    eventLogisticsObjects,
    nextAction,
    ordinaryEditAllowed,
    pricingPreviewAvailable,
    conversationHandlerAvailable,
    workflowHandlerAvailable,
    legacyControlsAvailable,
    role: normalizedRole
  });
  const momentumContract = buildMomentumContract({
    quote,
    model,
    proposal,
    nextAction
  });
  const momentum = buildVisibleMomentum(momentumContract, model.status.label);
  const disclosureLayers = buildDisclosureLayers({ quote, model, guestObject });
  const capabilityManifest = createAmbientCapabilityManifest({
    schemaVersion: 1,
    ambientShellEnabled: true,
    presentationGates: {
      VITE_AMBIENT_UI_ENABLED: true,
      VITE_OPERATIONAL_STAFFING_ENABLED: operationalStaffingEnabled
    },
    authorityGates: {
      ordinary_quote_edit: ordinaryEditAllowed
    },
    capabilities: [
      {
        id: "living-opportunity",
        enabled: true,
        mode: "ambient",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: []
      },
      {
        id: "guest-count-context",
        enabled: true,
        mode: "ambient",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: []
      },
      {
        id: "guest-count-stage",
        enabled: true,
        mode: "dual",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: ["ordinary_quote_edit"]
      },
      {
        id: "staffing-context",
        enabled: true,
        mode: "ambient",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: []
      },
      {
        id: "operational-staffing-context",
        enabled: true,
        mode: "ambient",
        presentationGateIds: [
          "VITE_AMBIENT_UI_ENABLED",
          "VITE_OPERATIONAL_STAFFING_ENABLED"
        ],
        authorityGateIds: []
      },
      {
        id: "staffing-stage",
        enabled: true,
        mode: "dual",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: ["ordinary_quote_edit"]
      },
      {
        id: "pricing-context",
        enabled: true,
        mode: "ambient",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: []
      },
      {
        id: "money-context",
        enabled: true,
        mode: "ambient",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: []
      },
      {
        id: "conversation-context",
        enabled: conversationObject.descriptor.permissions.view,
        mode: "ambient",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: []
      },
      {
        id: "pricing-preview",
        enabled: pricingPreviewAvailable,
        mode: "dual",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: ["ordinary_quote_edit"]
      },
      {
        id: "package-context",
        enabled: packageObject.permissions.view,
        mode: "ambient",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: []
      },
      {
        id: "package-draft-intent",
        enabled: packageObject.intentContract.enabled,
        mode: "dual",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: ["ordinary_quote_edit"]
      },
      {
        id: "menu-context",
        enabled: menuObject.permissions.view,
        mode: "ambient",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: []
      },
      {
        id: "menu-draft-intent",
        enabled: menuObject.permissions.stage,
        mode: "dual",
        presentationGateIds: ["VITE_AMBIENT_UI_ENABLED"],
        authorityGateIds: ["ordinary_quote_edit"]
      }
    ]
  });

  return {
    modelId: AMBIENT_LIVING_OPPORTUNITY_MODEL,
    surface: {
      id: "living-opportunity",
      purpose: ["clarify", "advance", "resolve", "simulate", "reveal_context"],
      object: { id: model.quoteId, type: "opportunity", label: model.eventName },
      entryReason: "Review the selected opportunity and its highest-ranked next resolution."
    },
    surfaceContract,
    surfaceContracts: Object.freeze({
      livingOpportunity: surfaceContract,
      opportunities: opportunitiesSurfaceContract,
      guestContext: guestContextSurfaceContract,
      guestInlineEditor: guestInlineEditorSurfaceContract,
      staffingContext: staffingContextSurfaceContract,
      pricingContext: pricingContextSurfaceContract,
      moneyContext: moneyContextSurfaceContract,
      conversationContext: conversationContextSurfaceContract,
      proposalContext: proposalContextSurfaceContract,
      packageContext: packageContextSurfaceContract,
      menuContext: menuContextSurfaceContract,
      selectionContext: selectionContextSurfaceContract,
      eventLogistics: eventLogisticsSurfaceContracts,
      pilotContext: pilotContextSurfaceContract,
      quoteEditor: quoteEditorSurfaceContract,
      workflow: workflowSurfaceContract,
      conversation: conversationSurfaceContract,
      mobileEventDetails: mobileEventDetailsSurfaceContract,
      operationalFacts: operationalFactsSurfaceContract,
      supportingEvidence: supportingEvidenceSurfaceContract,
      legacyOpportunityControls: legacyOpportunityControlsSurfaceContract
    }),
    capabilityManifest,
    actions,
    identity: {
      quoteId: model.quoteId,
      quoteNumber: model.quoteNumber,
      eventName: model.eventName,
      customerName: model.customerName,
      venue: model.venue,
      date: model.eventDate,
      time: model.eventTime,
      total: model.total,
      sourceLabel: model.sourceLabel,
      status: model.status
    },
    momentum,
    risk,
    nextAction,
    guestObject: {
      ...guestObject,
      descriptor: guestDescriptor,
      impactPreview: guestImpactPreview
    },
    staffingObject: {
      ...staffingObject,
      impactPreview: staffingImpactPreview
    },
    pricingObject,
    conversationObject,
    moneyObject,
    proposalObject,
    packageObject,
    menuObject,
    selectionObjects,
    selectionObjectActions: Object.freeze(Object.fromEntries(
      selectionObjects.objects.map((item) => [item.id, Object.freeze({
        reduce: actions[item.actionIds.reduce],
        increase: actions[item.actionIds.increase],
        keep: actions[item.actionIds.keep],
        undo: actions[item.actionIds.undo]
      })])
    )),
    packageMenuCatalogContext: packageMenuObjects.catalogEvidence,
    eventLogisticsObjects,
    momentumContract,
    disclosureLayers,
    pilotSentence: buildPilotSentence(risk, nextAction),
    evidenceNote: model.evidenceNote,
    editBoundary: model.editBoundary
  };
}
