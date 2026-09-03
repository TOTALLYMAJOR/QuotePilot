import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

function ensureFunctionsReady() {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Cloud Functions unavailable. Check Firebase env configuration.");
  }
}

export function createEmailTestRequestId(cryptoSource = globalThis.crypto) {
  const uuid = String(cryptoSource?.randomUUID?.() || "")
    .replaceAll("-", "")
    .toLowerCase();
  if (/^[a-f0-9]{32}$/.test(uuid)) return `email_test_${uuid}`;
  if (typeof cryptoSource?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoSource.getRandomValues(bytes);
    return `email_test_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error("A secure email acceptance request ID could not be created.");
}

export function buildEmailTestConfirmationToken(recipientEmail = "") {
  const recipient = String(recipientEmail || "").trim().toLowerCase();
  return recipient ? `SEND RESEND TEST TO ${recipient}` : "";
}

export async function sendResendAcceptanceTestEmail({
  requestId = "",
  recipientEmail = "",
  confirmationToken = ""
} = {}) {
  ensureFunctionsReady();
  const normalizedRequestId = String(requestId || "").trim().toLowerCase()
    || createEmailTestRequestId();
  const normalizedRecipient = String(recipientEmail || "").trim().toLowerCase();
  const expectedConfirmation = buildEmailTestConfirmationToken(normalizedRecipient);
  if (!/^email_test_[a-f0-9]{32}$/.test(normalizedRequestId)) {
    throw new Error("Email acceptance request ID is invalid.");
  }
  if (!/^[^@\s]+@quietpilot\.us$/.test(normalizedRecipient)) {
    throw new Error("The acceptance recipient must be a controlled quietpilot.us address.");
  }
  if (String(confirmationToken || "").trim() !== expectedConfirmation) {
    throw new Error(`Confirmation mismatch. Use exactly: ${expectedConfirmation}`);
  }
  const call = httpsCallable(cloudFunctions, "sendResendAcceptanceTestEmail");
  const result = await call({
    requestId: normalizedRequestId,
    recipientEmail: normalizedRecipient,
    confirmationToken: expectedConfirmation
  });
  const response = result.data && typeof result.data === "object" ? result.data : {};
  if (
    response.ok !== true
    || String(response.requestId || "").trim().toLowerCase() !== normalizedRequestId
    || String(response.recipientEmail || "").trim().toLowerCase() !== normalizedRecipient
    || String(response.state || "").trim().toLowerCase() !== "provider_accepted"
    || String(response.provider || "").trim().toLowerCase() !== "resend"
    || !String(response.providerMessageId || "").trim()
    || !String(response.acceptedAtISO || "").trim()
    || Object.keys(response).some((key) => /secret|token|api.?key/i.test(key))
  ) {
    throw new Error("Email acceptance test returned an invalid provider receipt.");
  }
  return response;
}
