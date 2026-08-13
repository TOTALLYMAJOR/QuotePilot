import {
  classifyDepositStatus,
  classifyFinalBalanceDisplayStatus,
  getFinalBalanceDisplayStatus
} from "./statusSemantics";
import { hasWorkspaceNumber } from "./workspacePresentation";

export const UPCOMING_WINDOW_DAYS = 7;

function localDateIso(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function selectUpcomingEvents(
  quotes = [],
  { nowDate = new Date(), windowDays = UPCOMING_WINDOW_DAYS } = {}
) {
  const todayISO = localDateIso(nowDate);
  const windowEndDate = new Date(nowDate);
  windowEndDate.setDate(windowEndDate.getDate() + windowDays);
  const windowEndISO = localDateIso(windowEndDate);
  return (Array.isArray(quotes) ? quotes : [])
    .filter((quote) => ["accepted", "booked"].includes(quote?.status))
    .filter((quote) => {
      const eventDate = String(quote?.event?.date || "").trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(eventDate)
        && eventDate >= todayISO
        && eventDate <= windowEndISO;
    })
    .sort((a, b) => String(a?.event?.date || "").localeCompare(String(b?.event?.date || "")));
}

export function buildMoneyRows(quotes = []) {
  const rows = [];
  (Array.isArray(quotes) ? quotes : []).forEach((quote) => {
    const depositStatus = String(quote?.payment?.depositStatus || "unpaid").toLowerCase();
    if (["accepted", "booked"].includes(quote?.status) && ["unpaid", "sent"].includes(depositStatus)) {
      rows.push({
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        customerName: quote.customer?.name || quote.customer?.email || "Customer",
        kind: "Deposit",
        amount: hasWorkspaceNumber(quote.totals?.deposit) ? Number(quote.totals.deposit) : null,
        ...classifyDepositStatus(depositStatus)
      });
    }
    if (quote?.status !== "booked" || !quote.booking?.contractNumber) return;

    const displayStatus = getFinalBalanceDisplayStatus(quote.payment?.finalBalance);
    const amountCents = Number(quote.payment?.finalBalance?.amountCents || 0);
    const eligibleToShow = displayStatus !== "unpaid" || depositStatus === "paid";
    if (amountCents > 0 && eligibleToShow && ["unpaid", "sent", "prepared", "processing"].includes(displayStatus)) {
      rows.push({
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        customerName: quote.customer?.name || quote.customer?.email || "Customer",
        kind: "Final balance",
        amount: amountCents / 100,
        ...classifyFinalBalanceDisplayStatus(displayStatus)
      });
    }
  });
  return rows;
}

export function summarizeMoneyRows(rows = []) {
  const requestedRows = rows.filter((row) => row.family === "pending");
  const outstandingRows = rows.filter((row) => row.family === "action");
  const sumKnown = (items) => items.reduce(
    (sum, row) => sum + (hasWorkspaceNumber(row.amount) ? Number(row.amount) : 0),
    0
  );
  return {
    requested: sumKnown(requestedRows),
    requestedUnknown: requestedRows.filter((row) => !hasWorkspaceNumber(row.amount)).length,
    outstanding: sumKnown(outstandingRows),
    outstandingUnknown: outstandingRows.filter((row) => !hasWorkspaceNumber(row.amount)).length
  };
}
