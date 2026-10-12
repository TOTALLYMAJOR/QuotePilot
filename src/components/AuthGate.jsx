import { useRef, useState } from "react";
import {
  registerWithEmail,
  requestPasswordReset,
  signInWithEmail,
  signInWithGoogle
} from "../lib/authClient";
import ProductBrandLockup from "./ProductBrandLockup";

const PASSWORD_RESET_CONFIRMATION = "If an account exists for that email, password-reset instructions have been sent.";

export function friendlyError(err) {
  const text = String(err?.message || "");
  if (text.includes("auth/invalid-credential")) {
    return "Invalid email or password. Check your details or reset your password.";
  }
  if (text.includes("auth/popup-closed-by-user")) return "Google sign-in was canceled.";
  if (text.includes("auth/email-already-in-use")) return "Email already registered.";
  if (text.includes("auth/invalid-email")) return "Enter a valid email address.";
  if (text.includes("auth/too-many-requests")) return "Too many attempts. Try again later.";
  return "Sign-in failed. Try again or reset your password.";
}

export default function AuthGate({ sessionError = "" }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState("");
  const [emailError, setEmailError] = useState("");
  const emailInputRef = useRef(null);
  const busy = !!pendingAction;

  const changeMode = (nextMode) => {
    if (busy) return;
    setMode(nextMode);
    setStatus("");
    setStatusKind("");
    setEmailError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    setPendingAction(mode === "register" ? "register" : "signin");
    setStatus("");
    setStatusKind("");
    setEmailError("");
    try {
      if (mode === "register") {
        await registerWithEmail({ email, password });
        setStatus("Account created. Verify your email.");
        setStatusKind("success");
      } else {
        await signInWithEmail({ email, password });
      }
    } catch (err) {
      setStatus(friendlyError(err));
      setStatusKind("error");
    } finally {
      setPendingAction("");
    }
  };

  const submitGoogle = async () => {
    setPendingAction("google");
    setStatus("");
    setStatusKind("");
    try {
      await signInWithGoogle();
    } catch (err) {
      setStatus(friendlyError(err));
      setStatusKind("error");
    } finally {
      setPendingAction("");
    }
  };

  const submitPasswordReset = async () => {
    const emailInput = emailInputRef.current;
    if (!email.trim()) {
      setEmailError("Enter your email to reset your password.");
      setStatus("");
      setStatusKind("");
      emailInput?.focus();
      return;
    }
    if (emailInput && !emailInput.validity.valid) {
      setEmailError("Enter a valid email address to reset your password.");
      setStatus("");
      setStatusKind("");
      emailInput.focus();
      return;
    }
    setPendingAction("password-reset");
    setStatus("");
    setStatusKind("");
    setEmailError("");
    try {
      await requestPasswordReset({ email });
      setStatus(PASSWORD_RESET_CONFIRMATION);
      setStatusKind("success");
    } catch (err) {
      setStatus(friendlyError(err));
      setStatusKind("error");
    } finally {
      setPendingAction("");
    }
  };

  const registering = mode === "register";
  const heading = registering ? "Create Staff Account" : "Staff Sign In";
  const intro = registering
    ? "Use your work email. You’ll verify it before QuotePilot checks your workspace access."
    : "Continue to your quotes, proposals, and event work.";

  return (
    <main className="auth-shell container">
      <section className="panel auth-card" aria-labelledby="auth-title">
        <ProductBrandLockup className="auth-product-brand" />
        <div className="auth-heading">
          <h1 id="auth-title">{heading}</h1>
          <p>{intro}</p>
        </div>
        {sessionError && <p className="error-note" role="alert">{sessionError}</p>}

        <form className="auth-form" onSubmit={submit}>
          <div className={`field${emailError ? " field-error" : ""}`}>
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              ref={emailInputRef}
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError("");
                setStatus("");
                setStatusKind("");
              }}
              placeholder="you@business.com"
              disabled={busy}
              aria-invalid={emailError ? "true" : undefined}
              aria-describedby={emailError ? "auth-email-error" : undefined}
            />
            {emailError && (
              <small className="field-error-note" id="auth-email-error" role="alert">
                {emailError}
              </small>
            )}
          </div>

          <div className="field auth-password-field">
            <div className="auth-field-heading">
              <label htmlFor="auth-password">Password</label>
              {!registering && (
                <button
                  type="button"
                  className="auth-text-action auth-forgot"
                  onClick={submitPasswordReset}
                  disabled={busy}
                  aria-busy={pendingAction === "password-reset"}
                >
                  {pendingAction === "password-reset" ? "Sending..." : "Forgot password?"}
                </button>
              )}
            </div>
            <div className="auth-password-control">
              <input
                id="auth-password"
                type={passwordVisible ? "text" : "password"}
                autoComplete={registering ? "new-password" : "current-password"}
                required
                minLength={registering ? 8 : undefined}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setStatus("");
                  setStatusKind("");
                }}
                placeholder={registering ? "At least 8 characters" : "Your password"}
                disabled={busy}
                aria-describedby={registering ? "auth-password-help" : undefined}
              />
              <button
                type="button"
                className="ghost auth-password-toggle"
                onClick={() => setPasswordVisible((visible) => !visible)}
                disabled={busy}
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                aria-pressed={passwordVisible}
              >
                {passwordVisible ? "Hide" : "Show"}
              </button>
            </div>
            {registering && (
              <small className="field-hint" id="auth-password-help">
                Use at least 8 characters.
              </small>
            )}
          </div>

          <div className="auth-actions">
            <button
              type="submit"
              className="cta"
              disabled={busy}
              aria-busy={pendingAction === "signin" || pendingAction === "register"}
            >
              {pendingAction === "signin" || pendingAction === "register"
                ? registering ? "Creating account..." : "Signing in..."
                : registering ? "Create Account" : "Sign In"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={submitGoogle}
              disabled={busy}
              aria-busy={pendingAction === "google"}
            >
              {pendingAction === "google" ? "Connecting..." : "Continue with Google"}
            </button>
          </div>

          <p className="auth-mode-prompt">
            <span>{registering ? "Already have an account?" : "New to QuotePilot?"}</span>{" "}
            <button
              type="button"
              className="auth-text-action"
              onClick={() => changeMode(registering ? "signin" : "register")}
              disabled={busy}
            >
              {registering ? "Sign in" : "Create a staff account"}
            </button>
          </p>
        </form>

        {status && (
          <p
            className={statusKind === "error" ? "error-note auth-status" : "source-note auth-status"}
            role={statusKind === "error" ? "alert" : "status"}
            aria-live={statusKind === "error" ? undefined : "polite"}
          >
            {status}
          </p>
        )}
      </section>
    </main>
  );
}
