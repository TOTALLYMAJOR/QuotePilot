const FOLLOW_UP_STAGE_DEFINITIONS = [
  { id: "new", label: "New lead" },
  { id: "contacted", label: "Contacted" },
  { id: "proposal_sent", label: "Proposal sent" },
  { id: "awaiting_response", label: "Awaiting response" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" }
];

const APPROVAL_ACTION_DEFINITIONS = [
  { id: "send_payment_request", label: "Send payment request" },
  { id: "convert_to_contract", label: "Convert to contract" },
  { id: "rotate_portal_link", label: "Rotate portal link" },
  { id: "delete_quote", label: "Delete quote" }
];

const PRODUCTION_CHECKLIST_DEFINITIONS = [
  { id: "event-brief", label: "Event brief reviewed", group: "Plan" },
  { id: "guest-count", label: "Final guest count confirmed", group: "Plan" },
  { id: "dietary-review", label: "Dietary and allergen notes reviewed", group: "Plan" },
  { id: "menu-prep", label: "Menu prep plan completed", group: "Kitchen" },
  { id: "equipment-plan", label: "Rental and equipment plan confirmed", group: "Logistics" },
  { id: "staffing-plan", label: "Staffing lead and assignments confirmed", group: "Team" },
  { id: "pack-out", label: "Pack and load-out completed", group: "Logistics" },
  { id: "venue-setup", label: "Venue setup completed", group: "Service" },
  { id: "service-handoff", label: "Service handoff completed", group: "Service" },
  { id: "closeout", label: "Event closeout completed", group: "Closeout" }
];

export const FOLLOW_UP_STAGES = FOLLOW_UP_STAGE_DEFINITIONS.map((item) => ({ ...item }));
export const FOLLOW_UP_STAGE_IDS = FOLLOW_UP_STAGE_DEFINITIONS.map((item) => item.id);
export const APPROVAL_ACTIONS = APPROVAL_ACTION_DEFINITIONS.map((item) => ({ ...item }));
export const APPROVAL_ACTION_IDS = APPROVAL_ACTION_DEFINITIONS.map((item) => item.id);
export const APPROVAL_STATES = ["pending", "approved", "rejected"];
export const PRODUCTION_CHECKLIST_ITEMS = PRODUCTION_CHECKLIST_DEFINITIONS.map((item) => ({ ...item }));
export const PRODUCTION_CHECKLIST_IDS = PRODUCTION_CHECKLIST_DEFINITIONS.map((item) => item.id);

function text(value) {
  return String(value || "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value));
}

function safeIso(value) {
  const raw = text(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function cloneForm(form = {}) {
  return {
    ...form,
    addons: Array.isArray(form.addons) ? [...form.addons] : [],
    rentals: Array.isArray(form.rentals) ? [...form.rentals] : [],
    menuItems: Array.isArray(form.menuItems) ? [...form.menuItems] : [],
    addonQuantities: { ...(form.addonQuantities || {}) },
    rentalQuantities: { ...(form.rentalQuantities || {}) },
    menuItemQuantities: { ...(form.menuItemQuantities || {}) }
  };
}

export function buildProposalReadiness(source = {}, totalsOverride = null) {
  const customer = source.customer || {
    name: source.name,
    email: source.email,
    phone: source.phone
  };
  const event = source.event || {
    name: source.eventName,
    date: source.date,
    time: source.time,
    venue: source.venue,
    guests: source.guests,
    hours: source.hours
  };
  const selection = source.selection || {
    packageId: source.pkg,
    menuItems: source.menuItems
  };
  const totals = totalsOverride || source.totals || {};
  const menuItems = Array.isArray(selection.menuItems) ? selection.menuItems : [];
  const menuNames = Array.isArray(selection.menuItemNames) ? selection.menuItemNames : [];

  const criteria = [
    { id: "customer-name", label: "Customer name", points: 10, passed: Boolean(text(customer.name)) },
    { id: "customer-email", label: "Valid customer email", points: 10, passed: hasEmail(customer.email) },
    { id: "customer-phone", label: "Customer phone", points: 5, passed: Boolean(text(customer.phone)) },
    { id: "event-name", label: "Event name", points: 5, passed: Boolean(text(event.name)) },
    { id: "event-date", label: "Event date", points: 10, passed: Boolean(text(event.date)) },
    { id: "event-time", label: "Event time", points: 5, passed: Boolean(text(event.time)) },
    { id: "venue", label: "Venue", points: 10, passed: Boolean(text(event.venue)) },
    { id: "guest-count", label: "Guest count", points: 10, passed: number(event.guests) > 0 },
    { id: "duration", label: "Event duration", points: 5, passed: number(event.hours) > 0 },
    { id: "package", label: "Package selected", points: 10, passed: Boolean(text(selection.packageId || selection.packageName)) },
    { id: "menu", label: "Menu selected", points: 10, passed: menuItems.length > 0 || menuNames.length > 0 },
    { id: "total", label: "Calculated total", points: 10, passed: number(totals.total) > 0 }
  ];

  const score = criteria.reduce((sum, item) => sum + (item.passed ? item.points : 0), 0);
  const gaps = criteria.filter((item) => !item.passed);
  const status = score === 100
    ? { id: "ready", label: "Ready to send" }
    : score >= 80
      ? { id: "review", label: "Final review" }
      : { id: "needs_details", label: "Needs details" };

  return {
    score,
    status,
    criteria,
    gaps,
    complete: score === 100
  };
}

export function buildQuoteScenarios(form = {}, catalog = {}) {
  const packages = (Array.isArray(catalog.packages) ? catalog.packages : [])
    .filter((item) => item && item.active !== false && text(item.id))
    .sort((left, right) => number(left.ppp ?? left.price) - number(right.ppp ?? right.price));

  if (!packages.length) return [];

  const middleIndex = Math.floor((packages.length - 1) / 2);
  const packageByScenario = {
    good: packages[0],
    better: packages[middleIndex],
    best: packages[packages.length - 1]
  };
  const definitions = [
    {
      id: "good",
      label: "Good",
      description: "Essential package with optional add-ons and rentals removed."
    },
    {
      id: "better",
      label: "Better",
      description: "Balanced package with the current optional selections."
    },
    {
      id: "best",
      label: "Best",
      description: "Top package with the current optional selections."
    }
  ];

  return definitions.map((definition) => {
    const pkg = packageByScenario[definition.id];
    const nextForm = cloneForm(form);
    nextForm.pkg = pkg.id;
    nextForm.eventTemplateId = "custom";
    if (definition.id === "good") {
      nextForm.addons = [];
      nextForm.rentals = [];
      nextForm.addonQuantities = {};
      nextForm.rentalQuantities = {};
    }
    return {
      ...definition,
      packageId: pkg.id,
      packageName: text(pkg.name) || pkg.id,
      form: nextForm
    };
  });
}

function pushTimelineEvent(events, id, label, detail, tone, value) {
  const atISO = safeIso(value);
  if (!atISO) return;
  events.push({ id, label, detail, tone, atISO });
}

export function buildQuoteLifecycleTimeline(quote = {}) {
  const events = [];
  const lifecycle = quote.lifecycle || {};
  const lifecycleDefinitions = [
    ["draftAtISO", "Quote drafted", "draft"],
    ["sentAtISO", "Proposal sent", "sent"],
    ["viewedAtISO", "Proposal viewed", "viewed"],
    ["acceptedAtISO", "Proposal accepted", "accepted"],
    ["declinedAtISO", "Proposal declined", "declined"],
    ["expiredAtISO", "Proposal expired", "expired"],
    ["bookedAtISO", "Event booked", "booked"]
  ];

  lifecycleDefinitions.forEach(([field, label, tone]) => {
    pushTimelineEvent(events, `lifecycle-${field}`, label, "Quote lifecycle", tone, lifecycle[field]);
  });

  if (!events.some((item) => item.tone === "draft")) {
    pushTimelineEvent(
      events,
      "quote-created",
      "Quote created",
      quote.quoteNumber || "Quote lifecycle",
      "draft",
      quote.createdAtISO
    );
  }

  const payment = quote.payment || {};
  const booking = quote.booking || {};
  [
    ["deposit-paid", "Deposit marked paid", "Payment status", "paid", payment.depositConfirmedAtISO],
    ["contract-converted", "Contract created", booking.contractNumber || "Booking workflow", "booked", booking.contractConvertedAtISO],
    ["staff-assigned", "Staff lead assigned", booking.staffLead || "Operations", "operations", booking.staffAssignedAtISO],
    ["confirmation-sent", "Booking confirmation sent", booking.contractNumber || "Booking workflow", "operations", booking.confirmationSentAtISO],
    ["confirmation-confirmed", "Booking confirmed", booking.contractNumber || "Booking workflow", "accepted", booking.confirmedAtISO]
  ].forEach((event) => pushTimelineEvent(events, ...event));

  const portalDecision = quote.portalDecision || {};
  const decisionLabel = {
    accepted: "Customer accepted proposal",
    declined: "Customer declined proposal",
    changes_requested: "Customer requested changes"
  }[portalDecision.decision];
  if (decisionLabel) {
    pushTimelineEvent(
      events,
      "portal-decision",
      decisionLabel,
      text(portalDecision.message) || "Customer portal",
      portalDecision.decision,
      portalDecision.submittedAtISO
    );
  }

  const followUp = quote.workflow?.followUp || {};
  pushTimelineEvent(
    events,
    "follow-up-updated",
    followUp.completed ? "Follow-up completed" : "Follow-up updated",
    text(followUp.note) || text(followUp.stage) || "Sales workflow",
    "follow_up",
    followUp.completedAtISO || followUp.updatedAtISO
  );

  const approvals = Array.isArray(quote.workflow?.approvalRequests)
    ? quote.workflow.approvalRequests
    : [];
  approvals.forEach((request) => {
    const action = APPROVAL_ACTION_DEFINITIONS.find((item) => item.id === request.action);
    const detail = action?.label || request.action || "Sensitive action";
    pushTimelineEvent(events, `approval-requested-${request.id}`, "Approval requested", detail, "approval", request.requestedAtISO);
    if (request.state && request.state !== "pending") {
      pushTimelineEvent(
        events,
        `approval-resolved-${request.id}`,
        request.state === "approved" ? "Approval granted" : "Approval rejected",
        detail,
        request.state,
        request.resolvedAtISO
      );
    }
  });

  return events.sort((left, right) => new Date(left.atISO).getTime() - new Date(right.atISO).getTime());
}

export function buildProductionChecklist(quote = {}) {
  const persisted = Array.isArray(quote.booking?.productionChecklist)
    ? quote.booking.productionChecklist
    : [];
  const persistedById = new Map(
    persisted
      .filter((item) => PRODUCTION_CHECKLIST_IDS.includes(text(item?.id)))
      .map((item) => [text(item.id), item])
  );

  const items = PRODUCTION_CHECKLIST_DEFINITIONS.map((definition) => {
    const stored = persistedById.get(definition.id) || {};
    return {
      ...definition,
      completed: stored.completed === true,
      completedAtISO: safeIso(stored.completedAtISO),
      completedByEmail: text(stored.completedByEmail)
    };
  });
  const completed = items.filter((item) => item.completed).length;

  return {
    items,
    completed,
    total: items.length,
    percent: items.length ? Math.round((completed / items.length) * 100) : 0
  };
}
