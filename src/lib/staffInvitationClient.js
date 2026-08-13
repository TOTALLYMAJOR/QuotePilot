import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

export const STAFF_INVITATION_PUBLIC_CALLABLES = Object.freeze({
  read: "getStaffInvitation",
  respond: "respondToStaffInvitation"
});

function text(value) {
  return String(value ?? "").trim();
}

function token(value) {
  const normalized = text(value);
  if (!normalized || normalized.length > 4096 || /\s/u.test(normalized)) {
    throw new Error("The staff invitation link is invalid.");
  }
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function getPublicStaffInvitation(rawToken) {
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("This invitation requires a connected QuotePilot workspace.");
  }
  const call = httpsCallable(cloudFunctions, STAFF_INVITATION_PUBLIC_CALLABLES.read);
  const response = await call({ token: token(rawToken) });
  const result = response?.data;
  if (!result?.ok || result.storage !== "firebase" || !result.invitation?.invitationId || !result.assignment) {
    throw new Error("The staff invitation returned incomplete evidence.");
  }
  return Object.freeze(clone(result));
}

export async function respondToPublicStaffInvitation(rawToken, decision, declineReason = "") {
  const normalizedDecision = text(decision).toLowerCase();
  if (!new Set(["accepted", "declined"]).has(normalizedDecision)) {
    throw new Error("Choose accept or decline.");
  }
  if (!firebaseReady || !cloudFunctions) {
    throw new Error("This invitation requires a connected QuotePilot workspace.");
  }
  const call = httpsCallable(cloudFunctions, STAFF_INVITATION_PUBLIC_CALLABLES.respond);
  const response = await call({
    token: token(rawToken),
    decision: normalizedDecision,
    declineReason: text(declineReason).slice(0, 500)
  });
  const result = response?.data;
  if (!result?.ok || result.storage !== "firebase" || !result.acknowledgement?.state) {
    throw new Error("The staff response returned incomplete evidence.");
  }
  return Object.freeze(clone(result));
}
