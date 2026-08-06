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
  const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
  await sendEmailVerification(credential.user);
  return {
    email: normalizedEmail,
    verificationSent: true
  };
}

export async function sendPasswordReset(email) {
  ensureAuth();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }
  await sendPasswordResetEmail(auth, normalizedEmail);
  return { email: normalizedEmail };
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
  await sendEmailVerification(user);
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
