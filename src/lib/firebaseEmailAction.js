import { validateFirebaseEmailActionContinueUrl } from "./firebaseEmailActionPolicy";

export const FIREBASE_EMAIL_ACTION_PATH = "/app/auth/action";

const fail = (kind, message) => Object.assign(new Error(message), { kind });

function verifyProject(action) {
  const key = String(import.meta.env.VITE_FIREBASE_API_KEY || "").trim();
  if (!key || action.apiKey !== key) {
    throw fail(key ? "malformed" : "configuration", "Email verification is unavailable.");
  }
}

export function parseFirebaseEmailVerificationAction(input) {
  try {
    const url = new URL(String(input || ""));
    const action = {
      apiKey: String(url.searchParams.get("apiKey") || "").trim(),
      oobCode: String(url.searchParams.get("oobCode") || "").trim()
    };
    const returnTo = String(url.searchParams.get("continueUrl") || "").trim();
    if (
      (url.pathname.replace(/\/+$/, "") || "/") !== FIREBASE_EMAIL_ACTION_PATH
      || url.searchParams.get("mode") !== "verifyEmail"
      || !action.apiKey
      || !action.oobCode
      || !returnTo
    ) throw new Error();
    action.continueUrl = validateFirebaseEmailActionContinueUrl(returnTo);
    return action;
  } catch {
    throw fail("malformed", "This verification link is incomplete.");
  }
}

async function callFirebase(action, operation) {
  let response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${operation}?key=${encodeURIComponent(action.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oobCode: action.oobCode })
    });
  } catch {
    throw fail("uncertain", "Firebase did not return a result.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const uncertain = response.status === 429 || response.status >= 500;
    throw fail(uncertain ? "uncertain" : "invalid", uncertain ? "Firebase did not return a result." : "This link is no longer valid.");
  }
  return payload;
}

export async function completeFirebaseEmailVerification(action, onChecked) {
  verifyProject(action);
  const check = await callFirebase(action, "resetPassword");
  if (check?.requestType !== "VERIFY_EMAIL") throw fail("malformed", "This code cannot verify an email.");
  onChecked?.();
  const receipt = await callFirebase(action, "update");
  if (receipt?.emailVerified !== true) throw fail("uncertain", "Firebase did not confirm verification.");
  return { continueUrl: action.continueUrl };
}
