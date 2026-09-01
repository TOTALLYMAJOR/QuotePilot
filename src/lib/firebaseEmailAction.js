import { validateFirebaseEmailActionContinueUrl } from "./firebaseEmailActionPolicy";

export const FIREBASE_EMAIL_ACTION_PATH = "/app/auth/action";

const fail = (kind) => Object.assign(new Error(), { kind });

export function parseFirebaseEmailVerificationAction(input) {
  try {
    const url = new URL(String(input || ""));
    const params = url.searchParams;
    const action = {
      apiKey: params.get("apiKey"),
      oobCode: params.get("oobCode")
    };
    const returnTo = params.get("continueUrl");
    if (
      url.pathname !== FIREBASE_EMAIL_ACTION_PATH
      || params.get("mode") !== "verifyEmail"
      || !action.apiKey
      || !action.oobCode
      || !returnTo
    ) throw new Error();
    action.continueUrl = validateFirebaseEmailActionContinueUrl(returnTo);
    return action;
  } catch {
    throw fail("malformed");
  }
}

export async function completeFirebaseEmailVerification(action, onChecked) {
  const key = String(import.meta.env.VITE_FIREBASE_API_KEY || "").trim();
  if (!key || action.apiKey !== key) throw fail(key ? "malformed" : "configuration");
  onChecked?.();
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(action.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oobCode: action.oobCode })
    });
    if (!response.ok) throw fail(response.status === 429 || response.status >= 500 ? "uncertain" : "invalid");
    const receipt = await response.json();
    if (receipt?.emailVerified !== true) throw fail("uncertain");
  } catch (error) {
    throw error?.kind ? error : fail("uncertain");
  }
  return { continueUrl: action.continueUrl };
}
