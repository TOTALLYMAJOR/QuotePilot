import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const INQUIRY_SHOWCASE_CALLABLES = Object.freeze({
  getPublished: "getPublishedInquiryShowcase",
  submit: "submitPublicInquiry",
  resolve: "resolveInquirySubmission",
  getAdmin: "getInquiryShowcaseAdminState",
  saveDraft: "saveInquiryShowcaseDraft",
  publish: "publishInquiryShowcase",
  pause: "pauseInquiryShowcase",
  republish: "republishInquiryShowcaseVersion",
  getQueue: "getInquiryQueue",
  acknowledge: "acknowledgeInquiry",
  previewConversion: "previewInquiryConversion",
  convert: "convertInquiryToQuoteDraft",
  dismiss: "dismissInquiry"
});
export const INQUIRY_CAPABILITY_STATES = Object.freeze(["loading", "empty", "success", "stale", "partial", "error", "recovery", "ready", "submitting", "uncertain", "reconciliation", "receipt"]);
export function inquiryCapabilityStateMarker(state) {
  const normalized = String(state || "").trim().toLowerCase();
  return INQUIRY_CAPABILITY_STATES.includes(normalized) ? `data-capability-state=\"${normalized}\"` : "";
}

function safeMessage(error, fallback) {
  const message = String(error?.message || "").replace(/^Firebase:\s*/u, "").trim();
  return message || fallback;
}

function ensureCallable() {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("Inquiry pages require a connected QuotePilot workspace.");
  }
}

async function call(name, data, fallback) {
  ensureCallable();
  try {
    return (await httpsCallable(cloudFunctions, name)(data)).data;
  } catch (error) {
    const next = new Error(safeMessage(error, fallback));
    next.code = String(error?.code || "unknown").replace(/^functions\//u, "");
    next.details = error?.details;
    throw next;
  }
}

function randomToken(bytes = 24) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createInquiryRecoveryEnvelope(slug) {
  return Object.freeze({ slug: String(slug || "").trim(), requestId: `inq_${randomToken(18)}`, recoverySecret: randomToken(32) });
}

const storageKey = (slug, requestId) => `quotepilot:inquiry-recovery:${slug}:${requestId}`;

export function retainInquiryRecovery(envelope) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(storageKey(envelope.slug, envelope.requestId), JSON.stringify({ requestId: envelope.requestId, recoverySecret: envelope.recoverySecret }));
}

export function clearInquiryRecovery(envelope) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(storageKey(envelope.slug, envelope.requestId));
}

export const getPublishedInquiryShowcase = ({ slug }) => call(INQUIRY_SHOWCASE_CALLABLES.getPublished, { slug }, "Unable to load this inquiry page.");
export const recordPublicInquiryFormStarted = ({ slug, publicationVersionId }) => call(
  INQUIRY_SHOWCASE_CALLABLES.getPublished,
  { slug, publicationVersionId, analyticsEvent: "inquiry_form_started" },
  "Unable to record inquiry engagement."
);
export const submitPublicInquiry = (request) => call(INQUIRY_SHOWCASE_CALLABLES.submit, request, "Unable to submit this inquiry.");
export const resolveInquirySubmission = (request) => call(INQUIRY_SHOWCASE_CALLABLES.resolve, request, "Unable to confirm whether this inquiry was received.");
export const getInquiryShowcaseAdminState = ({ organizationId }) => call(INQUIRY_SHOWCASE_CALLABLES.getAdmin, { organizationId }, "Unable to load the Inquiry Showcase.");
export const saveInquiryShowcaseDraft = (request) => call(INQUIRY_SHOWCASE_CALLABLES.saveDraft, request, "Unable to save the Inquiry Showcase draft.");
export const publishInquiryShowcase = ({ organizationId }) => call(INQUIRY_SHOWCASE_CALLABLES.publish, { organizationId }, "Unable to publish the Inquiry Showcase.");
export const pauseInquiryShowcase = ({ organizationId }) => call(INQUIRY_SHOWCASE_CALLABLES.pause, { organizationId }, "Unable to pause the Inquiry Showcase.");
export const republishInquiryShowcaseVersion = (request) => call(INQUIRY_SHOWCASE_CALLABLES.republish, request, "Unable to republish this version.");
export const getInquiryQueue = ({ organizationId }) => call(INQUIRY_SHOWCASE_CALLABLES.getQueue, { organizationId }, "Unable to load inquiries.");
export const acknowledgeInquiry = (request) => call(INQUIRY_SHOWCASE_CALLABLES.acknowledge, request, "Unable to acknowledge this inquiry.");
export const previewInquiryConversion = (request) => call(INQUIRY_SHOWCASE_CALLABLES.previewConversion, request, "Unable to review this conversion.");
export const convertInquiryToQuoteDraft = (request) => call(INQUIRY_SHOWCASE_CALLABLES.convert, request, "Unable to convert this inquiry.");
export const dismissInquiry = (request) => call(INQUIRY_SHOWCASE_CALLABLES.dismiss, request, "Unable to dismiss this inquiry.");
