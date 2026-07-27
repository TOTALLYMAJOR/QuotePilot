import { useState } from "react";
import { registerWithEmail, signInWithEmail, signInWithGoogle } from "../lib/authClient";

function friendlyError(err) {
  const text = String(err?.message || "Authentication failed.");
  if (text.includes("auth/invalid-credential")) return "Invalid email or password.";
  if (text.includes("auth/popup-closed-by-user")) return "Google sign-in popup was closed.";
  if (text.includes("auth/email-already-in-use")) return "This email is already registered.";
  return text;
}

export default function AuthGate({ sessionError = "" }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const submit = async () => {
    setBusy(true);
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
      setBusy(false);
    }
  };

  const submitGoogle = async () => {
    setBusy(true);
    setStatus("");
    try {
      await signInWithGoogle();
    } catch (err) {
      setStatus(friendlyError(err));
    } finally {
      setBusy(false);
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

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
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

        <div className="auth-actions">
          <button type="button" className="cta" onClick={submit} disabled={busy}>
            {busy ? "Working..." : mode === "register" ? "Create Account" : "Sign In"}
          </button>
          <button type="button" className="ghost" onClick={submitGoogle} disabled={busy}>
            Continue with Google
          </button>
        </div>

        {status && <p className="source-note">{status}</p>}
      </section>
    </main>
  );
}
