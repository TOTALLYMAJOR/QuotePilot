const STATUS_FAMILY = {
  INFO: "info",
  PENDING: "pending",
  ACTION: "action",
  CUSTOMER_ACTION: "customer_action",
  PROVIDER: "provider",
  CONFIRMED: "confirmed",
  BLOCKED: "blocked",
  FAILED: "failed",
  EXPIRED: "expired",
  ARCHIVED: "archived"
};

export { STATUS_FAMILY };

const QUOTE_STATUS_MAP = {
  draft: { family: STATUS_FAMILY.INFO, label: "Draft" },
  sent: { family: STATUS_FAMILY.PENDING, label: "Sent" },
  viewed: { family: STATUS_FAMILY.PENDING, label: "Viewed" },
  accepted: { family: STATUS_FAMILY.CONFIRMED, label: "Accepted" },
  booked: { family: STATUS_FAMILY.CONFIRMED, label: "Booked" },
  declined: { family: STATUS_FAMILY.FAILED, label: "Declined" },
  expired: { family: STATUS_FAMILY.EXPIRED, label: "Expired" },
  deleted: { family: STATUS_FAMILY.ARCHIVED, label: "Deleted" }
};

const DEPOSIT_STATUS_MAP = {
  unpaid: { family: STATUS_FAMILY.ACTION, label: "Deposit unpaid" },
  sent: { family: STATUS_FAMILY.PENDING, label: "Deposit requested" },
  paid: { family: STATUS_FAMILY.CONFIRMED, label: "Deposit paid" },
  refunded: { family: STATUS_FAMILY.ARCHIVED, label: "Deposit refunded" }
};

const FINAL_BALANCE_DISPLAY_MAP = {
  unpaid: { family: STATUS_FAMILY.ACTION, label: "Balance unpaid" },
  sent: { family: STATUS_FAMILY.PENDING, label: "Balance requested" },
  prepared: { family: STATUS_FAMILY.PENDING, label: "Checkout prepared" },
  processing: { family: STATUS_FAMILY.PROVIDER, label: "Balance processing" },
  paid: { family: STATUS_FAMILY.CONFIRMED, label: "Balance paid" },
  failed: { family: STATUS_FAMILY.FAILED, label: "Balance payment failed" },
  expired: { family: STATUS_FAMILY.EXPIRED, label: "Checkout expired" }
};

const BOOKING_CONFIRMATION_MAP = {
  pending: { family: STATUS_FAMILY.ACTION, label: "Confirmation pending" },
  sent: { family: STATUS_FAMILY.PENDING, label: "Confirmation sent" },
  confirmed: { family: STATUS_FAMILY.CONFIRMED, label: "Confirmed" },
  cancelled: { family: STATUS_FAMILY.ARCHIVED, label: "Cancelled" }
};

const ATTENTION_ITEM_MAP = {
  "change_request:new": { family: STATUS_FAMILY.ACTION, label: "New change request" },
  "change_request:acknowledged": { family: STATUS_FAMILY.ACTION, label: "Change request acknowledged" },
  "change_request:invalid": { family: STATUS_FAMILY.BLOCKED, label: "Change request data issue" },
  "follow_up:overdue": { family: STATUS_FAMILY.ACTION, label: "Overdue follow-up" },
  "follow_up:due_today": { family: STATUS_FAMILY.ACTION, label: "Follow-up due today" },
  "approval:pending": { family: STATUS_FAMILY.ACTION, label: "Pending approval" }
};

const UNKNOWN_ENTRY = Object.freeze({ family: STATUS_FAMILY.INFO, label: "Unknown" });

function lookup(map, key, fallback = UNKNOWN_ENTRY) {
  const normalized = String(key || "").trim().toLowerCase();
  const entry = map[normalized];
  return entry ? { ...entry } : { ...fallback };
}

export function classifyQuoteStatus(status) {
  return lookup(QUOTE_STATUS_MAP, status);
}

export function classifyDepositStatus(depositStatus) {
  return lookup(DEPOSIT_STATUS_MAP, depositStatus, DEPOSIT_STATUS_MAP.unpaid);
}

// Mirrors QuoteHistoryModal's getFinalBalanceDisplayStatus vocabulary
// (paid/prepared/processing/failed/expired/unpaid/sent) so the two surfaces
// never drift; kept as a standalone copy rather than a shared import so this
// module stays chunk-independent of the lazy-loaded history modal.
export function getFinalBalanceDisplayStatus(finalBalance = {}) {
  const status = String(finalBalance?.status || "unpaid").trim().toLowerCase();
  const checkoutState = String(finalBalance?.stripeCheckoutState || "").trim().toLowerCase();
  if (status === "paid") return "paid";
  if (["prepared", "processing", "failed", "expired"].includes(checkoutState)) {
    return checkoutState;
  }
  return ["unpaid", "sent"].includes(status) ? status : "unpaid";
}

export function classifyFinalBalanceDisplayStatus(displayStatus) {
  return lookup(FINAL_BALANCE_DISPLAY_MAP, displayStatus, FINAL_BALANCE_DISPLAY_MAP.unpaid);
}

export function classifyBookingConfirmation(confirmationStatus) {
  return lookup(BOOKING_CONFIRMATION_MAP, confirmationStatus, BOOKING_CONFIRMATION_MAP.pending);
}

export function classifyAttentionItem(type, state) {
  const key = `${String(type || "").trim().toLowerCase()}:${String(state || "").trim().toLowerCase()}`;
  return lookup(ATTENTION_ITEM_MAP, key);
}
