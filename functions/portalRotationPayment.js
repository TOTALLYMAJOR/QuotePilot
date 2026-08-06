function text(value) {
  return String(value || "").trim();
}

function hasMaterialFinalBalanceCheckout(quote = {}) {
  const finalBalance = quote?.payment?.finalBalance;
  if (!finalBalance || typeof finalBalance !== "object" || Array.isArray(finalBalance)) {
    return false;
  }

  const status = text(finalBalance.status).toLowerCase() || "unpaid";
  const checkoutGeneration = Number(finalBalance.checkoutGeneration || 0);
  return status !== "unpaid"
    || Boolean(text(finalBalance.paymentLink))
    || Boolean(text(finalBalance.confirmedAtISO))
    || Boolean(text(finalBalance.stripeSessionId))
    || Boolean(text(finalBalance.stripeCheckoutState))
    || (Number.isSafeInteger(checkoutGeneration) && checkoutGeneration > 0)
    || (Array.isArray(finalBalance.knownStripeSessionIds)
      && finalBalance.knownStripeSessionIds.some((sessionId) => Boolean(text(sessionId))));
}

function portalRotationPaymentKinds(quote = {}) {
  return hasMaterialFinalBalanceCheckout(quote)
    ? ["deposit", "final_balance"]
    : ["deposit"];
}

module.exports = {
  hasMaterialFinalBalanceCheckout,
  portalRotationPaymentKinds
};
