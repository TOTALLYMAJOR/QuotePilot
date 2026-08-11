import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

// Client boundary for the structured change-request record callable. The
// browser sends intent only; the server owns validation, actor identity,
// message-hash binding, revision snapshot, and the create-only write.
const DEFINITIVE_CODES = new Set([
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "permission-denied",
  "unauthenticated"
]);

export function isDefinitiveRecordError(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  return DEFINITIVE_CODES.has(code);
}

export async function recordChangeRequestParse(payload) {
  if (!firebaseReady || !cloudFunctions) {
    const error = new Error("Recording requires the Firebase workspace.");
    error.code = "failed-precondition";
    throw error;
  }
  const callable = httpsCallable(cloudFunctions, "recordChangeRequestParse");
  const { data } = await callable(payload);
  const resolutionId = String(data?.resolutionId || "").trim();
  if (!resolutionId) {
    const error = new Error("The record response was incomplete.");
    error.code = "internal";
    throw error;
  }
  return {
    resolutionId,
    recordedAtISO: String(data?.recordedAtISO || "").trim(),
    activeVersionIdAtRecord: String(data?.activeVersionIdAtRecord || "").trim(),
    alreadyRecorded: data?.alreadyRecorded === true
  };
}

// Best-effort, called after a save that already fully succeeded on its own;
// callers should not block on or surface failures from this beyond an
// internal diagnostic. See DEV_TASKS "Structured change-request version
// linking".
export async function linkChangeRequestResolutionVersion(payload) {
  if (!firebaseReady || !cloudFunctions) {
    const error = new Error("Linking requires the Firebase workspace.");
    error.code = "failed-precondition";
    throw error;
  }
  const callable = httpsCallable(cloudFunctions, "linkChangeRequestResolutionVersion");
  const { data } = await callable(payload);
  const resolutionId = String(data?.resolutionId || "").trim();
  const linkedVersionId = String(data?.linkedVersionId || "").trim();
  if (!resolutionId || !linkedVersionId) {
    const error = new Error("The link response was incomplete.");
    error.code = "internal";
    throw error;
  }
  return {
    resolutionId,
    linkedVersionId,
    linkedAtISO: String(data?.linkedAtISO || "").trim(),
    alreadyLinked: data?.alreadyLinked === true
  };
}
