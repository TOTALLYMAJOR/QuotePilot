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
  { id: "delete_quote", label: "Delete quote" },
  { id: "send_quote_email", label: "Send quote email" }
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

const WORKFLOW_ATTENTION_STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "accepted"
]);
const WORKFLOW_ATTENTION_PRIORITY = {
  new_change_request: 0,
  overdue_follow_up: 1,
  pending_approval: 2,
  acknowledged_change_request: 3,
  due_follow_up: 4
};

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

function localDateIso(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const year = safeDate.getFullYear();
  const month = String(safeDate.getMonth() + 1).padStart(2, "0");
  const day = String(safeDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetweenDates(earlierDateIso, laterDateIso) {
  const earlier = Date.parse(`${earlierDateIso}T00:00:00.000Z`);
  const later = Date.parse(`${laterDateIso}T00:00:00.000Z`);
  if (!Number.isFinite(earlier) || !Number.isFinite(later)) return 0;
  return Math.max(0, Math.round((later - earlier) / 86400000));
}

export function buildWorkflowAttentionSummary(quotes = [], options = {}) {
  const todayISO = /^\d{4}-\d{2}-\d{2}$/.test(text(options.todayISO))
    ? text(options.todayISO)
    : localDateIso(options.now);
  const items = [];

  (Array.isArray(quotes) ? quotes : []).forEach((quote) => {
    const quoteId = text(quote?.id);
    const quoteStatus = text(quote?.status).toLowerCase();
    if (!quoteId || !WORKFLOW_ATTENTION_STATUSES.has(quoteStatus)) return;

    const portalDecision = quote?.portalDecision || {};
    const requestSubmittedAtISO = safeIso(portalDecision.submittedAtISO);
    if (portalDecision.decision === "changes_requested") {
      const handling = quote?.workflow?.changeRequestHandling || {};
      const requestId = text(portalDecision.requestId);
      const requestMessage = text(portalDecision.message);
      const matchesCurrentRequest = (
        text(handling.sourceSubmittedAtISO) === text(portalDecision.submittedAtISO)
        && text(handling.sourceMessage) === requestMessage
        && (
          requestId
            ? text(handling.sourceRequestId) === requestId
            : !text(handling.sourceRequestId)
        )
      );
      const handlingState = matchesCurrentRequest ? text(handling.state).toLowerCase() : "";
      if (!requestSubmittedAtISO || !requestMessage) {
        items.push({
          id: `change-request:${quoteId}:invalid`,
          type: "change_request",
          state: "invalid",
          priority: WORKFLOW_ATTENTION_PRIORITY.new_change_request,
          dateISO: safeIso(quote?.updatedAtISO) || safeIso(quote?.createdAtISO),
          quote,
          quoteId,
          sourceRequestId: requestId,
          sourceSubmittedAtISO: text(portalDecision.submittedAtISO),
          sourceMessage: requestMessage,
          unhandleable: true
        });
      } else if (handlingState !== "handled") {
        const acknowledged = handlingState === "acknowledged";
        items.push({
          id: `change-request:${quoteId}:${text(portalDecision.submittedAtISO)}`,
          type: "change_request",
          state: acknowledged ? "acknowledged" : "new",
          priority: WORKFLOW_ATTENTION_PRIORITY[
            acknowledged ? "acknowledged_change_request" : "new_change_request"
          ],
          dateISO: requestSubmittedAtISO,
          quote,
          quoteId,
          sourceRequestId: requestId,
          sourceSubmittedAtISO: text(portalDecision.submittedAtISO),
          sourceMessage: requestMessage
        });
      }
    }

    const followUp = quote?.workflow?.followUp || {};
    const dueDate = text(followUp.dueDate);
    const followUpClosed = followUp.completed === true || ["won", "lost"].includes(text(followUp.stage));
    if (!followUpClosed && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate <= todayISO) {
      const daysOverdue = daysBetweenDates(dueDate, todayISO);
      items.push({
        id: `follow-up:${quoteId}`,
        type: "follow_up",
        state: daysOverdue > 0 ? "overdue" : "due_today",
        priority: WORKFLOW_ATTENTION_PRIORITY[daysOverdue > 0 ? "overdue_follow_up" : "due_follow_up"],
        dateISO: dueDate,
        daysOverdue,
        quote,
        quoteId
      });
    }

    const pendingRequests = (Array.isArray(quote?.workflow?.approvalRequests)
      ? quote.workflow.approvalRequests
      : [])
      .filter((request) => request?.state === "pending")
      .sort((left, right) => text(left?.requestedAtISO).localeCompare(text(right?.requestedAtISO)));
    if (pendingRequests.length > 0) {
      items.push({
        id: `approval:${quoteId}`,
        type: "approval",
        state: "pending",
        priority: WORKFLOW_ATTENTION_PRIORITY.pending_approval,
        dateISO: safeIso(pendingRequests[0]?.requestedAtISO) || safeIso(quote?.updatedAtISO),
        pendingRequests,
        quote,
        quoteId
      });
    }
  });

  items.sort((left, right) => (
    left.priority - right.priority
    || text(left.dateISO).localeCompare(text(right.dateISO))
    || text(left.quote?.quoteNumber || left.quoteId).localeCompare(text(right.quote?.quoteNumber || right.quoteId))
    || left.type.localeCompare(right.type)
  ));

  return {
    todayISO,
    quoteCount: new Set(items.map((item) => item.quoteId)).size,
    itemCount: items.length,
    counts: {
      changeRequests: items.filter((item) => item.type === "change_request").length,
      followUps: items.filter((item) => item.type === "follow_up").length,
      approvals: items.filter((item) => item.type === "approval").length
    },
    items
  };
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

  const changeRequestHandling = quote.workflow?.changeRequestHandling || {};
  const handlingMatchesCurrentRequest = (
    text(changeRequestHandling.sourceSubmittedAtISO) === text(portalDecision.submittedAtISO)
    && text(changeRequestHandling.sourceMessage) === text(portalDecision.message)
    && (
      text(portalDecision.requestId)
        ? text(changeRequestHandling.sourceRequestId) === text(portalDecision.requestId)
        : !text(changeRequestHandling.sourceRequestId)
    )
  );
  if (
    portalDecision.decision === "changes_requested"
    && handlingMatchesCurrentRequest
  ) {
    pushTimelineEvent(
      events,
      "change-request-acknowledged",
      "Change request acknowledged internally",
      text(changeRequestHandling.acknowledgedByEmail) || "Sales workflow",
      "follow_up",
      changeRequestHandling.acknowledgedAtISO
    );
    if (changeRequestHandling.state === "handled") {
      pushTimelineEvent(
        events,
        "change-request-handled",
        "Change request marked handled internally",
        text(changeRequestHandling.note) || text(changeRequestHandling.handledByEmail) || "Sales workflow",
        "follow_up",
        changeRequestHandling.handledAtISO
      );
    }
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
    if (request.executionState === "in_progress") {
      pushTimelineEvent(
        events,
        `approval-execution-started-${request.id}`,
        "Approved action started",
        detail,
        "approval",
        request.executionStartedAtISO
      );
    }
    if (["succeeded", "failed"].includes(request.executionState)) {
      pushTimelineEvent(
        events,
        `approval-execution-completed-${request.id}`,
        request.executionState === "succeeded"
          ? "Approved action completed"
          : "Approved action failed",
        request.executionReference || request.executionError || detail,
        request.executionState === "succeeded" ? "booked" : "rejected",
        request.executionCompletedAtISO
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

export function parseTimeToMinutes(value) {
  const text = String(value || "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(text)) return null;
  const [hRaw, mRaw] = text.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return (h * 60) + m;
}

function formatClock(minutesInDay) {
  const normalized = ((minutesInDay % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

export function formatCheckpointTime(totalMinutes) {
  const dayOffset = Math.floor(totalMinutes / 1440);
  const label = formatClock(totalMinutes);

  if (dayOffset === -1) return `${label} (prev day)`;
  if (dayOffset === 1) return `${label} (next day)`;
  if (dayOffset < -1 || dayOffset > 1) return `${label} (${dayOffset > 0 ? `+${dayOffset}` : dayOffset} days)`;
  return label;
}

export function formatMinutesToTimeInput(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function defaultKitchenCheckpointOffsets(durationMinutes) {
  return [
    { id: "prep-start", label: "Prep kickoff", minuteOffset: -180 },
    { id: "line-check", label: "Line check", minuteOffset: -120 },
    { id: "pack-out", label: "Pack and load-out", minuteOffset: -60 },
    { id: "onsite-setup", label: "On-site setup", minuteOffset: -30 },
    { id: "service-start", label: "Service start", minuteOffset: 0 },
    { id: "service-end", label: "Service wrap", minuteOffset: durationMinutes },
    { id: "reset", label: "Kitchen reset", minuteOffset: durationMinutes + 45 }
  ];
}

export function buildKitchenCheckpoints(event) {
  const startMinutes = parseTimeToMinutes(event.time);
  if (startMinutes === null) return [];

  const durationMinutes = Math.max(60, Math.round(number(event.hours) * 60));
  const defaults = defaultKitchenCheckpointOffsets(durationMinutes);
  const overrides = Array.isArray(event.kitchenCheckpointOverrides) ? event.kitchenCheckpointOverrides : [];
  const overrideById = new Map(
    overrides
      .map((item) => ({
        id: String(item?.id || "").trim(),
        label: String(item?.label || "").trim(),
        minuteOffset: Number(item?.minuteOffset)
      }))
      .filter((item) => item.id && Number.isFinite(item.minuteOffset))
      .map((item) => [item.id, item])
  );

  return defaults.map((item) => {
    const override = overrideById.get(item.id);
    const minuteOffset = override ? Math.round(override.minuteOffset) : item.minuteOffset;
    const minute = startMinutes + minuteOffset;
    const label = override?.label ? override.label.slice(0, 80) : item.label;
    return {
      id: item.id,
      label,
      minute,
      minuteOffset,
      timeLabel: formatCheckpointTime(minute),
      timeValue: formatMinutesToTimeInput(minute)
    };
  });
}
