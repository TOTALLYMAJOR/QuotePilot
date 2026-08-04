import { useState } from "react";
import {
  registerWithEmail,
  requestPasswordReset,
  signInWithEmail,
  signInWithGoogle
} from "../lib/authClient";

const PASSWORD_RESET_CONFIRMATION = "If an account exists for that email, password-reset instructions have been sent.";

function friendlyError(err) {
  const text = String(err?.message || "Authentication failed.");
  if (text.includes("auth/invalid-credential")) return "Invalid email or password.";
  if (text.includes("auth/popup-closed-by-user")) return "Google sign-in popup was closed.";
  if (text.includes("auth/email-already-in-use")) return "This email is already registered.";
  if (text.includes("auth/invalid-email")) return "Enter a valid email address.";
  if (text.includes("auth/too-many-requests")) return "Too many attempts. Wait a moment and try again.";
  return text;
}

export default function AuthGate({ sessionError = "" }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [status, setStatus] = useState("");
  const busy = Boolean(pendingAction);

  const changeMode = (nextMode) => {
    if (busy) return;
    setMode(nextMode);
    setStatus("");
  };

  const submit = async () => {
    setPendingAction(mode === "register" ? "register" : "signin");
    setStatus("");
    try {
      if (mode === "register") {
        await registerWithEmail({ email, password });
        setStatus("Account created. Check your inbox and verify your email before workspace access is activated.");
      } else {
        await signInWithEmail({ email, password });
      }
    } catch (err) {
      setStatus(friendlyError(err));
    } finally {
      setPendingAction("");
    }
  };

  const submitGoogle = async () => {
    setPendingAction("google");
    setStatus("");
    try {
      await signInWithGoogle();
    } catch (err) {
      setStatus(friendlyError(err));
    } finally {
      setPendingAction("");
    }
  };

  const submitPasswordReset = async () => {
    setPendingAction("password-reset");
    setStatus("");
    try {
      await requestPasswordReset({ email });
      setStatus(PASSWORD_RESET_CONFIRMATION);
    } catch (err) {
      setStatus(friendlyError(err));
    } finally {
      setPendingAction("");
    }
  };

  return (
    <main className="auth-shell container">
      <section className="panel auth-card">
        <h1>Staff Sign In</h1>
        <p className="muted">Use email/password or Google to access the quote workspace.</p>
        {sessionError && <p className="error-note">{sessionError}</p>}

        <div className="auth-mode-switch">
          <button
            type="button"
            className={mode === "signin" ? "cta" : "ghost"}
            onClick={() => changeMode("signin")}
            disabled={busy}
          >
            Sign In
          </button>
          <button
            type="button"
            className={mode === "register" ? "cta" : "ghost"}
            onClick={() => changeMode("register")}
            disabled={busy}
          >
            Register
          </button>
        </div>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setStatus("");
            }}
            placeholder="you@business.com"
            disabled={busy}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setStatus("");
            }}
            placeholder="At least 8 characters"
            disabled={busy}
          />
        </label>

        <div className="auth-actions">
          <button type="button" className="cta" onClick={submit} disabled={busy}>
            {pendingAction === "signin" || pendingAction === "register"
              ? "Working..."
              : mode === "register" ? "Create Account" : "Sign In"}
          </button>
          <button type="button" className="ghost" onClick={submitGoogle} disabled={busy}>
            {pendingAction === "google" ? "Connecting..." : "Continue with Google"}
          </button>
          {mode === "signin" && (
            <button
              type="button"
              className="ghost"
              onClick={submitPasswordReset}
              disabled={busy}
              aria-busy={pendingAction === "password-reset"}
            >
              {pendingAction === "password-reset" ? "Sending..." : "Forgot password?"}
            </button>
          )}
        </div>

        {status && <p className="source-note" role="status" aria-live="polite">{status}</p>}
      </section>
    </main>
  );
}
