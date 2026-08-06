function text(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function iso(value) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function deliveryHealth(quotes, nowMs) {
  const health = {
    total: 0,
    providerAccepted: 0,
    active: 0,
    retryAvailable: 0,
    reviewRequired: 0,
    failed: 0
  };
  quotes.forEach((quote) => {
    const delivery = quote?.workflow?.quoteDelivery;
    if (!delivery || typeof delivery !== "object" || !text(delivery.state)) return;
    health.total += 1;
    const state = text(delivery.state, 40).toLowerCase();
    const leaseMs = Date.parse(text(delivery.leaseExpiresAtISO));
    const deadlineMs = Date.parse(text(delivery.retryDeadlineAtISO));
    const activeLease = state === "sending" && Number.isFinite(leaseMs) && leaseMs > nowMs;
    const retryWindowOpen = !Number.isFinite(deadlineMs) || deadlineMs > nowMs;
    if (state === "provider_accepted") health.providerAccepted += 1;
    else if (activeLease) health.active += 1;
    else if (state === "outcome_unknown" || (["sending", "outcome_ambiguous"].includes(state) && !retryWindowOpen)) {
      health.reviewRequired += 1;
    } else if (state === "failed") {
      health.failed += 1;
      health.retryAvailable += 1;
    } else if (["sending", "outcome_ambiguous", "reconciled_not_sent"].includes(state)) {
      health.retryAvailable += 1;
    }
  });
  return health;
}

function dayKey(value) {
  const normalized = iso(value);
  return normalized ? normalized.slice(0, 10) : "";
}

function syncHealth(quotes, nowMs, days = 7) {
  const rows = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(nowMs - offset * 24 * 60 * 60 * 1000);
    rows.push({
      day: date.toISOString().slice(0, 10),
      success: 0,
      error: 0,
      retrying: 0,
      queued: 0,
      skipped: 0
    });
  }
  const byDay = new Map(rows.map((row) => [row.day, row]));
  quotes.forEach((quote) => {
    const logs = Array.isArray(quote?.integrations?.logs) ? quote.integrations.logs : [];
    logs.forEach((entry) => {
      const row = byDay.get(dayKey(entry?.occurredAtISO || entry?.occurredAt));
      if (!row) return;
      const state = text(entry?.state, 24).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(row, state)) row[state] += 1;
    });
  });
  const totals = rows.reduce((acc, row) => {
    ["success", "error", "retrying", "queued", "skipped"].forEach((state) => {
      acc[state] += row[state];
    });
    return acc;
  }, { success: 0, error: 0, retrying: 0, queued: 0, skipped: 0 });
  const decided = totals.success + totals.error;
  return {
    days,
    totals,
    successRate: decided ? (totals.success / decided) * 100 : 0,
    trend: rows
  };
}

function roleSummary(roles) {
  const counts = { admin: 0, sales: 0 };
  roles.forEach((role) => {
    const value = text(role?.role, 20).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, value)) counts[value] += 1;
  });
  return { ...counts, staff: counts.admin + counts.sales };
}

function actionLog({ executions, quotes, settings, roles }) {
  const roleByUid = new Map(roles.map((role) => [text(role?.uid), text(role?.role, 20).toLowerCase()]));
  const rows = [];
  executions.forEach((execution) => {
    rows.push({
      id: `approval:${text(execution?.approvalRequestId || execution?.id)}`,
      occurredAtISO: iso(execution?.completedAtISO || execution?.startedAtISO || execution?.updatedAtISO),
      action: text(execution?.action, 80) || "approval_execution",
      state: text(execution?.state, 40),
      quoteId: text(execution?.quoteId),
      actorEmail: text(execution?.executedBy?.email, 254).toLowerCase(),
      actorRole: text(execution?.executedBy?.role, 20).toLowerCase(),
      authority: "server"
    });
  });
  quotes.forEach((quote) => {
    const resolution = quote?.workflow?.quoteDelivery?.lastResolution;
    if (!resolution || typeof resolution !== "object") return;
    rows.push({
      id: `delivery:${text(quote?.id)}:${text(resolution?.resolvedAtISO)}`,
      occurredAtISO: iso(resolution?.resolvedAtISO),
      action: `quote_delivery_${text(resolution?.resolution, 60) || "review"}`,
      state: text(quote?.workflow?.quoteDelivery?.state, 40),
      quoteId: text(quote?.id),
      quoteNumber: text(quote?.quoteNumber, 80),
      actorEmail: text(resolution?.actorEmail, 254).toLowerCase(),
      actorRole: roleByUid.get(text(resolution?.actorUid)) || "admin",
      authority: "server"
    });
  });
  const confirmation = settings?.pricingConfirmation;
  if (confirmation && typeof confirmation === "object" && confirmation.confirmedAtISO) {
    rows.push({
      id: `catalog:${text(confirmation.confirmedAtISO)}`,
      occurredAtISO: iso(confirmation.confirmedAtISO),
      action: "catalog_pricing_confirmed",
      state: `revision_${Number(confirmation.confirmedCatalogRevision || 0)}`,
      actorEmail: text(confirmation.actorEmail, 254).toLowerCase(),
      actorRole: roleByUid.get(text(confirmation.actorUid)) || "admin",
      authority: "server"
    });
  }
  return rows
    .filter((row) => row.occurredAtISO)
    .sort((left, right) => right.occurredAtISO.localeCompare(left.occurredAtISO))
    .slice(0, 50);
}

function buildOperationsAuditSnapshot({
  quotes = [],
  executions = [],
  roles = [],
  settings = {},
  nowISO = new Date().toISOString()
} = {}) {
  const nowMs = Date.parse(nowISO);
  return {
    generatedAtISO: new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString(),
    delivery: deliveryHealth(quotes, Number.isFinite(nowMs) ? nowMs : Date.now()),
    sync: syncHealth(quotes, Number.isFinite(nowMs) ? nowMs : Date.now()),
    roles: roleSummary(roles),
    actions: actionLog({ executions, quotes, settings, roles })
  };
}

module.exports = {
  buildOperationsAuditSnapshot,
  deliveryHealth,
  syncHealth
};
