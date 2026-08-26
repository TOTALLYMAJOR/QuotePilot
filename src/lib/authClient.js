import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "firebase/auth";
import { auth, firebaseReady } from "./firebase";

function ensureAuth() {
  if (!firebaseReady || !auth) {
    throw new Error("Firebase Auth is not configured. Add VITE_FIREBASE_* env vars.");
  }
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

const APPROVED_EMAIL_ACTION_HOSTS = new Set([
  "quotepilot.mbmapps.com"
]);
const CANONICAL_EMAIL_ACTION_URL = "https://quotepilot.mbmapps.com/app";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isLoopbackHttpUrl(parsed) {
  return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
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

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("QuotePilot email action URL is invalid.");
  }

  const localHttp = isLoopbackHttpUrl(parsed);
  const approvedHttps = parsed.protocol === "https:"
    && APPROVED_EMAIL_ACTION_HOSTS.has(parsed.hostname)
    && !parsed.port;
  if (
    (!approvedHttps && !localHttp)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/app"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("QuotePilot email action URL must use an approved HTTPS /app location.");
  }

  return parsed.toString();
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
