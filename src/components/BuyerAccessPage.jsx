import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  refreshCurrentUserVerification,
  registerWithEmail,
  resendCurrentUserVerification,
  signInWithEmail,
  signOutCurrentUser
} from "../lib/authClient";
import {
  createBuyerAccessCheckout,
  getBuyerAccessCheckoutStatus,
  isBuyerAccessSessionId,
  redirectToBuyerAccessCheckout
} from "../lib/buyerAccess";
import { isBuyerAccessEnabled, isBuyerE2eAuthBypassEnabled } from "../lib/buyerAccessConfig";
import { auth, firebaseReady } from "../lib/firebase";
import "../buyer-access.css";

const E2E_AUTH_BYPASS = isBuyerE2eAuthBypassEnabled(import.meta.env);
const BUYER_ACCESS_ENABLED = isBuyerAccessEnabled(import.meta.env);
const STATUS_POLL_INTERVAL_MS = 2_500;
const STATUS_POLL_LIMIT = 48;

export function readBuyerAccessReturn(search = "") {
  const params = new URLSearchParams(String(search || ""));
  const purchaseValue = String(params.get("purchase") || "").trim().toLowerCase();
  const purchase = ["success", "cancelled"].includes(purchaseValue) ? purchaseValue : "";
  const sessionId = String(params.get("session_id") || "").trim();
  return {
    purchase,
    sessionId: isBuyerAccessSessionId(sessionId) ? sessionId : "",
    hasInvalidSessionId: Boolean(sessionId) && !isBuyerAccessSessionId(sessionId)
  };
}

export function isAlreadyScopedBuyerError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || "").trim().toLowerCase();
  return code === "functions/failed-precondition"
    && message.includes("already has quotepilot organization access");
}

export function friendlyBuyerAccessError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || "").trim();
  if (isAlreadyScopedBuyerError(error)) {
    return "This account already has QuotePilot workspace access.";
  }
  if (code === "auth/invalid-credential") return "The email or password is incorrect.";
  if (code === "auth/email-already-in-use") return "An account already exists for this email. Sign in instead.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a moment and try again.";
  if (code === "auth/network-request-failed") return "The network request failed. Check your connection and try again.";
  if (code === "functions/unauthenticated") return "Sign in again before checking buyer access.";
  if (code === "functions/permission-denied") return "This account cannot verify that buyer order.";
  if (code === "functions/not-found") return "No buyer order was found for this account and Checkout Session.";
  if (code.startsWith("functions/")) return "QuotePilot could not complete the buyer access request. Try again or contact support.";
  const safeClientMessages = new Set([
    "Enter your business name.",
    "Enter the owner name.",
    "Sign in before starting the $1 access purchase.",
    "Verify your email before starting the $1 access purchase.",
    "Buyer checkout is unavailable in this environment."
  ]);
  return safeClientMessages.has(message)
    ? message
    : "QuotePilot could not complete the request. Try again or contact support.";
}

export function getBuyerAccessStatusMessage(status = "") {
  switch (String(status || "").trim().toLowerCase()) {
    case "checkout_pending":
      return {
        title: "Waiting for Stripe confirmation",
        text: "Your return from Stripe is only a signal to check. QuotePilot has not granted access yet."
      };
    case "payment_processing":
      return {
        title: "Payment is processing",
        text: "Stripe has reported processing, but access remains locked until the signed payment event provisions your workspace."
      };
    case "active":
      return {
        title: "Your workspace is ready",
        text: "QuotePilot verified the paid Checkout Session and completed workspace provisioning."
      };
    case "payment_failed":
      return {
        title: "Payment was not completed",
        text: "Stripe reported a failed payment. No workspace access was granted."
      };
    case "expired":
      return {
        title: "Checkout expired",
        text: "This Checkout Session expired before access was activated. You can start a new $1 test purchase."
      };
    default:
      return {
        title: "Verifying your purchase",
        text: "QuotePilot is asking the server for the owner-scoped Checkout status. The return URL alone cannot grant access."
      };
  }
}

function useBuyerAuthSession() {
  const [session, setSession] = useState({
    loading: true,
    user: null,
    error: ""
  });

  useEffect(() => {
    if (!BUYER_ACCESS_ENABLED) {
      setSession({ loading: false, user: null, error: "" });
      return undefined;
    }
    if (E2E_AUTH_BYPASS) {
      setSession({
        loading: false,
        user: {
          uid: String(import.meta.env.VITE_E2E_UID || "e2e-buyer"),
          email: String(import.meta.env.VITE_E2E_EMAIL || "buyer@local.test"),
          emailVerified: true
        },
        error: ""
      });
      return undefined;
    }
    if (!firebaseReady || !auth) {
      setSession({
        loading: false,
        user: null,
        error: "Firebase Auth is unavailable in this environment."
      });
      return undefined;
    }

    return onAuthStateChanged(
      auth,
      (user) => setSession({ loading: false, user, error: "" }),
      () => setSession({
        loading: false,
        user: null,
        error: "QuotePilot could not read the current sign-in session."
      })
    );
  }, []);

  return session;
}

function BuyerBrand() {
  return (
    <a className="buyer-brand" href="/" aria-label="QuotePilot home">
      <img src="/brand/quotepilot-mark.svg" alt="" />
      <span>
        <strong>QuotePilot</strong>
        <small>Buyer access</small>
      </span>
    </a>
  );
}

function BuyerAuthForm({ busy, mode, onModeChange, onSubmit, email, password, onEmailChange, onPasswordChange }) {
  return (
    <section className="buyer-card buyer-auth-card" aria-labelledby="buyer-auth-title">
      <p className="buyer-kicker">Step 1 of 3</p>
      <h2 id="buyer-auth-title">Create or sign in to your account</h2>
      <p>Your payment and workspace stay bound to this verified email account.</p>

      <div className="buyer-mode-switch" aria-label="Account action">
        <button
          type="button"
          className={mode === "register" ? "is-selected" : ""}
          aria-pressed={mode === "register"}
          onClick={() => onModeChange("register")}
          disabled={busy}
        >
          Create account
        </button>
        <button
          type="button"
          className={mode === "signin" ? "is-selected" : ""}
          aria-pressed={mode === "signin"}
          onClick={() => onModeChange("signin")}
          disabled={busy}
        >
          Sign in
        </button>
      </div>

      <form className="buyer-form" onSubmit={onSubmit}>
        <fieldset disabled={busy}>
          <label>
            <span>Email address</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="owner@business.com"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              minLength={mode === "register" ? 8 : undefined}
              required
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
            />
          </label>
          <button className="buyer-primary" type="submit">
            {busy ? "Working..." : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}

function VerificationCard({ email, busy, onRefresh, onResend, onSignOut }) {
  return (
    <section className="buyer-card buyer-verification" aria-labelledby="buyer-verify-title">
      <p className="buyer-kicker">Step 2 of 3</p>
      <h2 id="buyer-verify-title">Verify your email before checkout</h2>
      <p>
        We sent a Firebase verification message to <strong>{email || "your email"}</strong>.
        Checkout stays locked until Firebase confirms verification.
      </p>
      <div className="buyer-actions">
        <button className="buyer-primary" type="button" onClick={onRefresh} disabled={busy}>
          {busy ? "Checking..." : "I verified my email"}
        </button>
        <button className="buyer-secondary" type="button" onClick={onResend} disabled={busy}>
          Resend verification
        </button>
        <button className="buyer-text-button" type="button" onClick={onSignOut} disabled={busy}>
          Use another account
        </button>
      </div>
    </section>
  );
}

function PurchaseCard({ email, busy, organizationName, ownerName, onOrganizationNameChange, onOwnerNameChange, onSubmit }) {
  return (
    <section className="buyer-card buyer-purchase-card" aria-labelledby="buyer-purchase-title">
      <p className="buyer-kicker">Step 3 of 3</p>
      <div className="buyer-purchase-heading">
        <div>
          <h2 id="buyer-purchase-title">Set up your starter workspace</h2>
          <p>Signed in as {email}</p>
        </div>
        <div className="buyer-price" aria-label="One dollar one-time purchase">
          <strong>$1</strong>
          <span>USD · one time</span>
        </div>
      </div>

      <form className="buyer-form" onSubmit={onSubmit}>
        <fieldset disabled={busy}>
          <label>
            <span>Business name</span>
            <input
              type="text"
              name="organizationName"
              autoComplete="organization"
              minLength="2"
              maxLength="120"
              required
              value={organizationName}
              onChange={(event) => onOrganizationNameChange(event.target.value)}
              placeholder="Acme Events"
            />
          </label>
          <label>
            <span>Owner name</span>
            <input
              type="text"
              name="ownerName"
              autoComplete="name"
              minLength="2"
              maxLength="100"
              required
              value={ownerName}
              onChange={(event) => onOwnerNameChange(event.target.value)}
              placeholder="Avery Owner"
            />
          </label>
          <div className="buyer-test-note">
            <strong>Test purchase only</strong>
            <span>
              You will continue to Stripe-hosted Checkout. Confirm Stripe shows test mode before entering test card details.
              Stripe generates a post-purchase invoice after successful payment.
            </span>
          </div>
          <button className="buyer-primary buyer-checkout-button" type="submit">
            {busy ? "Opening Stripe..." : "Continue to Stripe · $1 test"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}

function PurchaseStatusCard({ status, checking, error, exhausted, onRetry }) {
  const copy = getBuyerAccessStatusMessage(status?.status);
  const accessReady = status?.status === "active" && status.accessGranted === true;
  const tone = accessReady
    ? "is-ready"
    : ["payment_failed", "expired"].includes(status?.status)
      ? "is-stopped"
      : "is-pending";

  return (
    <section className={`buyer-card buyer-status-card ${tone}`} aria-labelledby="buyer-status-title">
      <p className="buyer-kicker">Authoritative access check</p>
      <h2 id="buyer-status-title">{copy.title}</h2>
      <p>{copy.text}</p>
      {checking && <p className="buyer-live-status" role="status">Checking the owner-scoped server record...</p>}
      {error && <p className="buyer-error" role="alert">{error}</p>}
      {exhausted && (
        <p className="buyer-live-status" role="status">
          Provisioning is taking longer than expected. Your return URL still has not granted access.
        </p>
      )}
      {accessReady ? (
        <a className="buyer-primary buyer-link-button" href="/app">Open your QuotePilot workspace</a>
      ) : (
        <button className="buyer-secondary" type="button" onClick={onRetry} disabled={checking}>
          {checking ? "Checking..." : "Check again"}
        </button>
      )}
    </section>
  );
}

export default function BuyerAccessPage() {
  const authSession = useBuyerAuthSession();
  const returnHint = useMemo(
    () => readBuyerAccessReturn(typeof window === "undefined" ? "" : window.location.search),
    []
  );
  const [mode, setMode] = useState("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [verifiedAfterRefresh, setVerifiedAfterRefresh] = useState(false);
  const [alreadyScoped, setAlreadyScoped] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState(null);
  const [statusChecking, setStatusChecking] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [pollExhausted, setPollExhausted] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const user = authSession.user;
  const emailVerified = user?.emailVerified === true || verifiedAfterRefresh;
  const hasSuccessfulReturn = returnHint.purchase === "success";
  const hasValidSuccessfulReturn = hasSuccessfulReturn && Boolean(returnHint.sessionId);
  const ownerScopedCheckoutStatus = checkoutStatus?.verifiedForUid === user?.uid
    ? checkoutStatus
    : null;
  const terminalFailedStatus = ["payment_failed", "expired"].includes(ownerScopedCheckoutStatus?.status);

  useEffect(() => {
    setVerifiedAfterRefresh(false);
    setAlreadyScoped(false);
    setCheckoutStatus(null);
    setStatusError("");
  }, [user?.uid]);

  useEffect(() => {
    if (!BUYER_ACCESS_ENABLED || !user || !emailVerified || !hasValidSuccessfulReturn) {
      return undefined;
    }

    let active = true;
    let timer = null;
    let attempts = 0;
    setStatusError("");
    setPollExhausted(false);

    const poll = async () => {
      attempts += 1;
      setStatusChecking(true);
      try {
        const result = await getBuyerAccessCheckoutStatus({ sessionId: returnHint.sessionId });
        if (!active) return;
        setCheckoutStatus({ ...result, verifiedForUid: user.uid });
        setStatusError("");
        if (["active", "payment_failed", "expired"].includes(result.status)) {
          setStatusChecking(false);
          return;
        }
        if (attempts >= STATUS_POLL_LIMIT) {
          setPollExhausted(true);
          setStatusChecking(false);
          return;
        }
        setStatusChecking(false);
        timer = window.setTimeout(poll, STATUS_POLL_INTERVAL_MS);
      } catch (requestError) {
        if (!active) return;
        setStatusChecking(false);
        setStatusError(friendlyBuyerAccessError(requestError));
      }
    };

    poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [emailVerified, hasValidSuccessfulReturn, retryNonce, returnHint.sessionId, user]);

  const clearFeedback = () => {
    setNotice("");
    setError("");
  };

  const submitAuth = async (event) => {
    event.preventDefault();
    clearFeedback();
    setBusyAction("auth");
    try {
      if (mode === "register") {
        await registerWithEmail({ email, password });
        setNotice("Account created. Check your inbox, verify your email, then return here and confirm verification.");
      } else {
        await signInWithEmail({ email, password });
      }
    } catch (authError) {
      setError(friendlyBuyerAccessError(authError));
    } finally {
      setBusyAction("");
    }
  };

  const refreshVerification = async () => {
    clearFeedback();
    setBusyAction("verification");
    try {
      const result = await refreshCurrentUserVerification();
      if (result.emailVerified) {
        setVerifiedAfterRefresh(true);
        setNotice("Email verified. You can continue to the $1 test checkout.");
      } else {
        setNotice("Firebase has not confirmed verification yet. Open the verification link, then check again.");
      }
    } catch (verificationError) {
      setError(friendlyBuyerAccessError(verificationError));
    } finally {
      setBusyAction("");
    }
  };

  const resendVerification = async () => {
    clearFeedback();
    setBusyAction("verification");
    try {
      const result = await resendCurrentUserVerification();
      setNotice(result.alreadyVerified
        ? "Firebase already reports this email as verified."
        : "A new verification email was requested. Check your inbox.");
      if (result.alreadyVerified) setVerifiedAfterRefresh(true);
    } catch (verificationError) {
      setError(friendlyBuyerAccessError(verificationError));
    } finally {
      setBusyAction("");
    }
  };

  const signOutBuyer = async () => {
    clearFeedback();
    setBusyAction("signout");
    try {
      await signOutCurrentUser();
      setPassword("");
      setMode("signin");
    } catch (signOutError) {
      setError(friendlyBuyerAccessError(signOutError));
    } finally {
      setBusyAction("");
    }
  };

  const submitPurchase = async (event) => {
    event.preventDefault();
    clearFeedback();
    setAlreadyScoped(false);
    setBusyAction("checkout");
    try {
      const checkout = await createBuyerAccessCheckout({ organizationName, ownerName });
      redirectToBuyerAccessCheckout(checkout.checkoutUrl);
    } catch (checkoutError) {
      if (isAlreadyScopedBuyerError(checkoutError)) setAlreadyScoped(true);
      setError(friendlyBuyerAccessError(checkoutError));
    } finally {
      setBusyAction("");
    }
  };

  const showPurchaseForm = user
    && emailVerified
    && !alreadyScoped
    && (!hasValidSuccessfulReturn || terminalFailedStatus || returnHint.purchase === "cancelled");

  return (
    <main className="buyer-access-shell">
      <header className="buyer-header">
        <BuyerBrand />
        <a className="buyer-header-link" href="/app">Existing customer sign in</a>
      </header>

      <div className="buyer-layout">
        <section className="buyer-intro" aria-labelledby="buyer-page-title">
          <p className="buyer-kicker">QuotePilot test access</p>
          <h1 id="buyer-page-title">Try a starter workspace for one dollar.</h1>
          <p className="buyer-lead">
            Create a verified owner account, complete a Stripe-hosted $1 test purchase,
            and wait while the signed payment event securely provisions your workspace.
          </p>
          <ul className="buyer-promise-list">
            <li>Email verification before Checkout</li>
            <li>Stripe-hosted payment with a generated post-purchase invoice</li>
            <li>Access only after server-confirmed provisioning</li>
          </ul>
          <p className="buyer-proof-note">
            A <code>?purchase=success</code> URL never grants access by itself.
          </p>
        </section>

        <div className="buyer-flow">
          {!BUYER_ACCESS_ENABLED && (
            <section className="buyer-card buyer-status-card is-stopped">
              <p className="buyer-kicker">Unavailable</p>
              <h2>Buyer access is closed in this environment</h2>
              <p>This route opens only on an explicitly approved test deployment.</p>
            </section>
          )}

          {BUYER_ACCESS_ENABLED && authSession.loading && (
            <section className="buyer-card" role="status">
              <p className="buyer-kicker">Secure account check</p>
              <h2>Loading your sign-in session...</h2>
            </section>
          )}

          {BUYER_ACCESS_ENABLED && authSession.error && (
            <section className="buyer-card buyer-status-card is-stopped">
              <h2>Buyer access is not configured</h2>
              <p className="buyer-error" role="alert">{authSession.error}</p>
            </section>
          )}

          {BUYER_ACCESS_ENABLED && returnHint.purchase === "cancelled" && (
            <section className="buyer-return-note" role="status">
              <strong>Checkout returned as cancelled.</strong>
              <span>No access decision is inferred from that return. You can start a new Checkout below.</span>
            </section>
          )}

          {BUYER_ACCESS_ENABLED && hasSuccessfulReturn && (!returnHint.sessionId || returnHint.hasInvalidSessionId) && (
            <section className="buyer-return-note is-error" role="alert">
              <strong>This payment return cannot be verified.</strong>
              <span>Sign in and restart Checkout so QuotePilot can receive a valid owner-scoped Session reference.</span>
            </section>
          )}

          {BUYER_ACCESS_ENABLED && notice && <p className="buyer-feedback" role="status">{notice}</p>}
          {BUYER_ACCESS_ENABLED && error && <p className="buyer-feedback is-error" role="alert">{error}</p>}

          {BUYER_ACCESS_ENABLED && alreadyScoped && (
            <section className="buyer-card buyer-status-card is-ready">
              <p className="buyer-kicker">Existing access</p>
              <h2>Your account already has a workspace</h2>
              <p>No new Checkout is needed for this account.</p>
              <a className="buyer-primary buyer-link-button" href="/app">Open QuotePilot</a>
            </section>
          )}

          {BUYER_ACCESS_ENABLED && !authSession.loading && !authSession.error && !user && (
            <BuyerAuthForm
              busy={busyAction === "auth"}
              mode={mode}
              onModeChange={(nextMode) => {
                clearFeedback();
                setMode(nextMode);
              }}
              onSubmit={submitAuth}
              email={email}
              password={password}
              onEmailChange={(value) => {
                clearFeedback();
                setEmail(value);
              }}
              onPasswordChange={(value) => {
                clearFeedback();
                setPassword(value);
              }}
            />
          )}

          {BUYER_ACCESS_ENABLED && user && !emailVerified && (
            <VerificationCard
              email={user.email}
              busy={busyAction === "verification" || busyAction === "signout"}
              onRefresh={refreshVerification}
              onResend={resendVerification}
              onSignOut={signOutBuyer}
            />
          )}

          {BUYER_ACCESS_ENABLED && user && emailVerified && hasValidSuccessfulReturn && (
            <PurchaseStatusCard
              status={ownerScopedCheckoutStatus}
              checking={statusChecking}
              error={statusError}
              exhausted={pollExhausted}
              onRetry={() => setRetryNonce((value) => value + 1)}
            />
          )}

          {BUYER_ACCESS_ENABLED && showPurchaseForm && (
            <PurchaseCard
              email={user.email}
              busy={busyAction === "checkout"}
              organizationName={organizationName}
              ownerName={ownerName}
              onOrganizationNameChange={(value) => {
                clearFeedback();
                setOrganizationName(value);
              }}
              onOwnerNameChange={(value) => {
                clearFeedback();
                setOwnerName(value);
              }}
              onSubmit={submitPurchase}
            />
          )}
        </div>
      </div>

      <footer className="buyer-footer">
        <span>QuotePilot by MBMapps</span>
        <span>Payment details stay on Stripe-hosted Checkout.</span>
      </footer>
    </main>
  );
}
