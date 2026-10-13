const PAYMENT_EVIDENCE_PRESENCE = Symbol.for(
  "quotepilot.commercial-evidence-presence.payment.v1"
);
const BOOKING_EVIDENCE_PRESENCE = Symbol.for(
  "quotepilot.commercial-evidence-presence.booking.v1"
);

const DEPOSIT_EVIDENCE_FIELDS = Object.freeze([
  "depositStatus",
  "depositLink",
  "depositConfirmedAtISO",
  "depositRefundedAtISO",
  "depositStripeSessionId",
  "stripeSessionId",
  "checkoutGeneration",
  "knownStripeSessionIds"
]);
const FINAL_BALANCE_EVIDENCE_FIELDS = Object.freeze([
  "status",
  "paymentLink",
  "confirmedAtISO",
  "stripeSessionId",
  "stripeCheckoutState",
  "checkoutGeneration",
  "knownStripeSessionIds"
]);
const BOOKING_EVIDENCE_FIELDS = Object.freeze([
  "confirmationStatus",
  "confirmationSentAtISO",
  "confirmedAtISO",
  "confirmationUpdatedByEmail",
  "bookedAtISO",
  "bookedByEmail",
  "contractNumber",
  "contractConvertedAtISO",
  "contractConvertedByEmail"
]);

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function meaningful(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (record(value)) return Object.keys(value).length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return String(value ?? "").trim().length > 0;
}

function hasMeaningfulField(source, fields) {
  return record(source) && fields.some((field) => (
    Object.prototype.hasOwnProperty.call(source, field) && meaningful(source[field])
  ));
}

function hasMeaningfulOwnField(source, field) {
  return record(source)
    && Object.prototype.hasOwnProperty.call(source, field)
    && meaningful(source[field]);
}

function statusValue(source, field) {
  return hasMeaningfulOwnField(source, field)
    ? String(source[field]).trim().toLowerCase()
    : "";
}

export function captureCommercialEvidencePresence({ payment, booking } = {}) {
  const paymentSource = record(payment) ? payment : {};
  const finalBalanceSource = record(paymentSource.finalBalance) ? paymentSource.finalBalance : {};
  return Object.freeze({
    deposit: hasMeaningfulField(paymentSource, DEPOSIT_EVIDENCE_FIELDS),
    depositStatus: hasMeaningfulOwnField(paymentSource, "depositStatus"),
    depositStatusValue: statusValue(paymentSource, "depositStatus"),
    finalBalance: hasMeaningfulField(finalBalanceSource, FINAL_BALANCE_EVIDENCE_FIELDS),
    finalBalanceStatus: hasMeaningfulOwnField(finalBalanceSource, "status")
      || hasMeaningfulOwnField(finalBalanceSource, "stripeCheckoutState"),
    finalBalanceStatusValue: statusValue(finalBalanceSource, "status"),
    finalBalanceCheckoutStateValue: statusValue(finalBalanceSource, "stripeCheckoutState"),
    booking: hasMeaningfulField(booking, BOOKING_EVIDENCE_FIELDS),
    bookingStatus: hasMeaningfulOwnField(booking, "confirmationStatus"),
    bookingStatusValue: statusValue(booking, "confirmationStatus")
  });
}

function attachPresence(target, symbol, presence) {
  if (!record(target)) return target;
  Object.defineProperty(target, symbol, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ ...presence }),
    writable: false
  });
  return target;
}

export function attachPaymentEvidencePresence(payment, presence = {}) {
  return attachPresence(payment, PAYMENT_EVIDENCE_PRESENCE, {
    deposit: presence.deposit === true,
    depositStatus: presence.depositStatus === true,
    depositStatusValue: String(presence.depositStatusValue || ""),
    finalBalance: presence.finalBalance === true,
    finalBalanceStatus: presence.finalBalanceStatus === true,
    finalBalanceStatusValue: String(presence.finalBalanceStatusValue || ""),
    finalBalanceCheckoutStateValue: String(presence.finalBalanceCheckoutStateValue || "")
  });
}

export function attachBookingEvidencePresence(booking, presence = {}) {
  return attachPresence(booking, BOOKING_EVIDENCE_PRESENCE, {
    booking: presence.booking === true,
    bookingStatus: presence.bookingStatus === true,
    bookingStatusValue: String(presence.bookingStatusValue || "")
  });
}

export function readCommercialEvidencePresence(quote = {}) {
  const payment = record(quote?.payment) ? quote.payment : {};
  const booking = record(quote?.booking) ? quote.booking : {};
  const captured = captureCommercialEvidencePresence({ payment, booking });
  const paymentPresence = payment[PAYMENT_EVIDENCE_PRESENCE];
  const bookingPresence = booking[BOOKING_EVIDENCE_PRESENCE];
  return Object.freeze({
    quote: Boolean(String(quote?.id || quote?.quoteNumber || quote?.activeVersionId || "").trim()),
    deposit: record(paymentPresence) ? paymentPresence.deposit === true : captured.deposit,
    depositStatus: record(paymentPresence)
      ? paymentPresence.depositStatus === true
      : captured.depositStatus,
    depositStatusValue: record(paymentPresence)
      ? paymentPresence.depositStatusValue
      : captured.depositStatusValue,
    finalBalance: record(paymentPresence) ? paymentPresence.finalBalance === true : captured.finalBalance,
    finalBalanceStatus: record(paymentPresence)
      ? paymentPresence.finalBalanceStatus === true
      : captured.finalBalanceStatus,
    finalBalanceStatusValue: record(paymentPresence)
      ? paymentPresence.finalBalanceStatusValue
      : captured.finalBalanceStatusValue,
    finalBalanceCheckoutStateValue: record(paymentPresence)
      ? paymentPresence.finalBalanceCheckoutStateValue
      : captured.finalBalanceCheckoutStateValue,
    booking: record(bookingPresence) ? bookingPresence.booking === true : captured.booking,
    bookingStatus: record(bookingPresence)
      ? bookingPresence.bookingStatus === true
      : captured.bookingStatus,
    bookingStatusValue: record(bookingPresence)
      ? bookingPresence.bookingStatusValue
      : captured.bookingStatusValue
  });
}

export function restoreCommercialEvidenceSource(quote = {}) {
  const payment = record(quote?.payment) ? quote.payment : {};
  const booking = record(quote?.booking) ? quote.booking : {};
  const paymentPresence = payment[PAYMENT_EVIDENCE_PRESENCE];
  const bookingPresence = booking[BOOKING_EVIDENCE_PRESENCE];
  if (!record(paymentPresence) && !record(bookingPresence)) return quote;

  const restoredPayment = { ...payment };
  if (record(paymentPresence)) {
    if (paymentPresence.depositStatus) {
      restoredPayment.depositStatus = paymentPresence.depositStatusValue;
    } else {
      delete restoredPayment.depositStatus;
    }

    if (Object.prototype.propertyIsEnumerable.call(payment, "finalBalance")) {
      const restoredFinalBalance = { ...payment.finalBalance };
      if (paymentPresence.finalBalanceStatusValue) {
        restoredFinalBalance.status = paymentPresence.finalBalanceStatusValue;
      } else {
        delete restoredFinalBalance.status;
      }
      if (paymentPresence.finalBalanceCheckoutStateValue) {
        restoredFinalBalance.stripeCheckoutState = paymentPresence.finalBalanceCheckoutStateValue;
      } else {
        delete restoredFinalBalance.stripeCheckoutState;
      }
      restoredPayment.finalBalance = restoredFinalBalance;
    } else {
      delete restoredPayment.finalBalance;
    }
  }

  const restoredBooking = { ...booking };
  if (record(bookingPresence)) {
    if (bookingPresence.bookingStatus) {
      restoredBooking.confirmationStatus = bookingPresence.bookingStatusValue;
    } else {
      delete restoredBooking.confirmationStatus;
    }
  }

  return {
    ...quote,
    payment: restoredPayment,
    booking: restoredBooking
  };
}
