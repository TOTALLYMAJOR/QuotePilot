import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "firebase/auth";
import { auth, firebaseReady } from "./firebase";
import {
  CANONICAL_EMAIL_ACTION_URL,
  isLoopbackHttpUrl,
  validateFirebaseEmailActionContinueUrl
} from "./firebaseEmailActionPolicy";

function ensureAuth() {
  if (!firebaseReady || !auth) {
    throw new Error("Firebase Auth is not configured. Add VITE_FIREBASE_* env vars.");
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function firebaseEmailActionContinueUrl() {
  const configuredUrl = String(import.meta.env.VITE_APP_URL || "").trim();
  let candidate = configuredUrl || CANONICAL_EMAIL_ACTION_URL;

  if (!configuredUrl && typeof window !== "undefined") {
    try {
      const browserOrigin = new URL(window.location.origin);
      if (isLoopbackHttpUrl(browserOrigin)) {
        candidate = `${browserOrigin.origin}/app`;
      }
    } catch {
      // A malformed browser origin cannot widen the canonical production URL.
    }
  }

  return validateFirebaseEmailActionContinueUrl(candidate);
}

function firebaseEmailActionSettings() {
  return {
    url: firebaseEmailActionContinueUrl(),
    handleCodeInApp: false
  };
}

export async function signInWithEmail({ email, password }) {
  ensureAuth();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new Error("Email and password are required.");
  }
  await signInWithEmailAndPassword(auth, normalizedEmail, password);
}

export async function registerWithEmail({ email, password }) {
  ensureAuth();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new Error("Email and password are required.");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const actionCodeSettings = firebaseEmailActionSettings();
  const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  await sendEmailVerification(credential.user, actionCodeSettings);
  return {
    email: normalizedEmail,
    verificationSent: true
  };
}

export async function requestPasswordReset({ email }) {
  ensureAuth();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  try {
    await sendPasswordResetEmail(auth, normalizedEmail, firebaseEmailActionSettings());
  } catch (err) {
    const code = String(err?.code || "").trim().toLowerCase();
    if (["auth/user-not-found", "auth/user-disabled"].includes(code)) {
      return { requestAccepted: true };
    }
    throw err;
  }

  return { requestAccepted: true };
}

export async function signInWithGoogle() {
  ensureAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(auth, provider);
}

export async function signOutCurrentUser() {
  ensureAuth();
  await signOut(auth);
}

export async function resendCurrentUserVerification() {
  ensureAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before requesting a verification email.");
  if (user.emailVerified) return { alreadyVerified: true };
  await sendEmailVerification(user, firebaseEmailActionSettings());
  return { verificationSent: true };
}

export async function refreshCurrentUserVerification() {
  ensureAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before checking email verification.");
  await user.reload();
  if (user.emailVerified) {
    await user.getIdToken(true);
  }
  return { emailVerified: user.emailVerified === true };
}

export async function refreshCurrentUserAccess() {
  ensureAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before refreshing workspace access.");
  await user.reload();
  await user.getIdToken(true);
  return { refreshed: true, emailVerified: user.emailVerified === true };
}

export function getCurrentUserReauthenticationMethods() {
  ensureAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before confirming your identity.");
  const providers = new Set((user.providerData || []).map((entry) => String(entry?.providerId || "")));
  return Object.freeze([
    ...(providers.has("password") ? ["password"] : []),
    ...(providers.has("google.com") ? ["google"] : [])
  ]);
}

export async function getCurrentUserRecentAuthState({
  forceRefresh = false,
  maxAgeSeconds = 300
} = {}) {
  ensureAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before confirming your identity.");
  const token = await user.getIdTokenResult(forceRefresh === true);
  const authenticatedAtMs = Date.parse(String(token?.authTime || ""));
  const ageSeconds = Number.isFinite(authenticatedAtMs)
    ? Math.max(0, Math.floor((Date.now() - authenticatedAtMs) / 1000))
    : Number.POSITIVE_INFINITY;
  return Object.freeze({
    recent: Number.isFinite(ageSeconds) && ageSeconds <= maxAgeSeconds,
    ageSeconds,
    maxAgeSeconds,
    authenticatedAtISO: Number.isFinite(authenticatedAtMs)
      ? new Date(authenticatedAtMs).toISOString()
      : ""
  });
}

export async function reauthenticateCurrentUser({ method = "", password = "" } = {}) {
  ensureAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before confirming your identity.");
  const methods = getCurrentUserReauthenticationMethods();
  const selected = String(method || "").trim().toLowerCase();
  if (!methods.includes(selected)) {
    throw new Error("This sign-in provider cannot confirm a sensitive access change.");
  }
  if (selected === "password") {
    if (!password) throw new Error("Enter your password to confirm this access change.");
    const email = normalizeEmail(user.email);
    if (!email) throw new Error("The signed-in account email is unavailable.");
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
  } else if (selected === "google") {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await reauthenticateWithPopup(user, provider);
  }
  await user.getIdToken(true);
  return await getCurrentUserRecentAuthState({ forceRefresh: true });
}
