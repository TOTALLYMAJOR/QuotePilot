import { useState } from "react";
import { registerWithEmail, sendPasswordReset, signInWithEmail, signInWithGoogle } from "../lib/authClient";

export function friendlyError(err) {
  const text = String(err?.message || "");
  if (text.includes("auth/invalid-credential")) return "Invalid email or password.";
  if (text.includes("auth/popup-closed-by-user")) return "Google sign-in popup was closed.";
  if (text.includes("auth/email-already-in-use")) return "This email is already registered.";
  if (text.includes("auth/too-many-requests")) return "Too many attempts. Wait a few minutes and try again.";
  return "Sign-in failed. Try again or reset your password.";
}

export default function AuthGate({ sessionError = "" }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [infoMessage, setInfoMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSentTo, setResetSentTo] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrorMessage("");
    setInfoMessage("");
    try {
      if (mode === "register") {
        await registerWithEmail({ email, password });
        setInfoMessage("Account created. Check your inbox and verify your email before workspace access is activated.");
      } else {
        await signInWithEmail({ email, password });
      }
    } catch (err) {
      setErrorMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitGoogle = async () => {
    setBusy(true);
    setErrorMessage("");
    setInfoMessage("");
    try {
      await signInWithGoogle();
    } catch (err) {
      setErrorMessage(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setResetError("Enter your email above first.");
      return;
    }
    setResetBusy(true);
    setResetError("");
    try {
      const { email: sentTo } = await sendPasswordReset(trimmedEmail);
      setResetSentTo(sentTo);
    } catch (err) {
      setResetError(friendlyError(err));
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <main className="auth-shell container">
      <section className="panel auth-card">
        <h1>Staff Sign In</h1>
        <p className="muted">Use email/password or Google to access the quote workspace.</p>
        {sessionError && <p className="error-note" role="alert">{sessionError}</p>}

        <div className="auth-mode-switch">
          <button
            type="button"
            className={mode === "signin" ? "cta" : "ghost"}
            onClick={() => setMode("signin")}
          >
            Sign In
          </button>
          <button
            type="button"
            className={mode === "register" ? "cta" : "ghost"}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@business.com"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>

          <div className="auth-forgot">
            {resetSentTo ? (
              <p className="source-note">
                Password reset email sent to {resetSentTo}. Check your inbox.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="link-button"
                  onClick={handleForgotPassword}
                  disabled={resetBusy}
                >
                  Forgot password?
                </button>
                {resetError && <p className="error-note" role="alert">{resetError}</p>}
              </>
            )}
          </div>

          <div className="auth-actions">
            <button type="submit" className="cta" disabled={busy}>
              {busy ? "Working..." : mode === "register" ? "Create Account" : "Sign In"}
            </button>
            <button type="button" className="ghost" onClick={submitGoogle} disabled={busy}>
              Continue with Google
            </button>
          </div>
        </form>

        {errorMessage && <p className="error-note" role="alert">{errorMessage}</p>}
        {infoMessage && <p className="source-note">{infoMessage}</p>}
      </section>
    </main>
  );
}
