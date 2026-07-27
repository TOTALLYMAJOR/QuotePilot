const APPROVED_STRIPE_PAYMENT_HOSTS = new Set([
  "checkout.stripe.com",
  "buy.stripe.com"
]);

export function sanitizeStripePaymentLink(value) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > 2_000) return "";

  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || !APPROVED_STRIPE_PAYMENT_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}
