import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BUYER_ACCESS_E2E_TURNSTILE_TOKEN,
  clearBuyerAccessRequestContext,
  createBuyerAccessInvoice,
  createBuyerAccessRequestId,
  getBuyerAccessInvoiceStatus,
  readBuyerAccessRequestContext,
  readBuyerAccessStatusContext,
  redirectToBuyerAccessInvoice,
  storeBuyerAccessRequestContext
} from "../lib/buyerAccess";
import {
  getBuyerAccessTurnstileSiteKey,
  isBuyerAccessEnabled,
  isBuyerAccessTurnstileConfigured,
  isBuyerE2eAuthBypassEnabled
} from "../lib/buyerAccessConfig";
import "../buyer-access.css";

const E2E_FUNCTION_BYPASS = isBuyerE2eAuthBypassEnabled(import.meta.env);
const BUYER_ACCESS_ENABLED = isBuyerAccessEnabled(import.meta.env);
const TURNSTILE_SITE_KEY = getBuyerAccessTurnstileSiteKey(import.meta.env);
const STATUS_POLL_INTERVAL_MS = 2_500;
const STATUS_POLL_LIMIT = 48;
const TURNSTILE_SCRIPT_ID = "quotepilot-turnstile-api";
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let turnstileScriptPromise = null;

export function isBuyerAccessVerificationConfigured({ siteKey = "", e2eBypass = false } = {}) {
  return isBuyerAccessTurnstileConfigured({
    VITE_BUYER_ACCESS_TURNSTILE_SITE_KEY: siteKey
  }) || e2eBypass === true;
}

export function readBuyerAccessReturn(search = "") {
  const params = new URLSearchParams(String(search || ""));
  return {
    hasIgnoredStatusQuery: ["order", "statusToken", "session_id", "purchase"]
      .some((key) => params.has(key))
  };
}

export function friendlyBuyerAccessError(error) {
  const code = String(error?.code || "").trim().toLowerCase();
  const message = String(error?.message || "").trim();
  if (code === "functions/resource-exhausted") {
    return "Too many invoice attempts. Wait a moment before trying again.";
  }
  if (code === "functions/permission-denied") {
    return "This invoice request could not be authorized.";
  }
  if (code === "functions/unavailable") {
    return "Invoice creation is temporarily unavailable. Try the same request again.";
  }
  if (code.startsWith("functions/")) {
    return "QuotePilot could not complete the invoice request. Try again or contact support.";
  }
  const safeClientMessages = new Set([
    "Enter your business name.",
    "Enter the owner name.",
    "Enter a valid email address.",
    "Complete the security verification before creating your invoice.",
    "Buyer invoice creation is unavailable in this environment.",
    "QuotePilot could not create a secure invoice request identity.",
    "Secure invoice request recovery is unavailable in this browser.",
    "Secure invoice status recovery is unavailable in this browser.",
    "Security verification could not load. Refresh this page and try again."
  ]);
  return safeClientMessages.has(message)
    ? message
    : "QuotePilot could not complete the request. Try again or contact support.";
}

export function getBuyerAccessStatusMessage(status = "", evidence = {}) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  switch (normalizedStatus) {
    case "invoice_open":
      return {
        title: "Your $1 invoice is ready",
        text: "Stripe is waiting for payment. This page cannot mark the invoice paid or grant access on its own."
      };
    case "payment_processing":
      return {
        title: "Payment is processing",
        text: "Stripe is still processing the invoice payment. Access remains locked until the signed payment event is verified."
      };
    case "provisioning":
      return evidence?.workspaceReady === true
        ? {
            title: "Payment confirmed — your workspace is prepared",
            text: "QuotePilot verified the paid invoice and prepared the workspace. Account activation is still pending, so do not create or pay another invoice."
          }
        : {
            title: "Preparing your invoice",
            text: "QuotePilot is preparing the Stripe invoice. No payment has been claimed and access remains locked."
          };
    case "activation_sent":
      return {
        title: "Check your email to activate QuotePilot",
        text: "Your workspace is provisioned, but access stays locked until you follow the verified-email activation instructions sent to the owner."
      };
    case "active":
      return {
        title: "Your workspace is ready",
        text: "QuotePilot observed completed owner activation. You can now sign in to your workspace."
      };
    case "payment_failed":
      return {
        title: "The invoice still needs payment",
        text: "Stripe did not confirm payment, so no activation was issued. Reopen the same invoice to try again."
      };
    case "void":
      return {
        title: "This invoice is closed",
        text: "The server reports that this invoice was voided. It cannot activate a QuotePilot workspace."
      };
    case "expired":
      return {
        title: "This invoice has expired",
        text: "The server reports that this invoice is no longer payable. It cannot activate a QuotePilot workspace."
      };
    default:
      return {
        title: "Checking your invoice",
        text: "QuotePilot is asking the server for the token-bound invoice status. Browser history alone cannot grant access."
      };
  }
}

function loadTurnstileScript() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Security verification could not load. Refresh this page and try again."));
  }
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID);
    const script = existing || document.createElement("script");
    const onLoad = () => {
      if (window.turnstile?.render) resolve(window.turnstile);
      else reject(new Error("Security verification could not load. Refresh this page and try again."));
    };
    const onError = () => reject(
      new Error("Security verification could not load. Refresh this page and try again.")
    );
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    turnstileScriptPromise = null;
    throw error;
  });

  return turnstileScriptPromise;
}

function BuyerTurnstile({ siteKey, onTokenChange, onError, resetNonce }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!E2E_FUNCTION_BYPASS) return undefined;
    onTokenChange(BUYER_ACCESS_E2E_TURNSTILE_TOKEN);
    return () => onTokenChange("");
  }, [onTokenChange]);

  useEffect(() => {
    if (E2E_FUNCTION_BYPASS || !siteKey || !containerRef.current) return undefined;
    let active = true;
    loadTurnstileScript()
      .then((turnstile) => {
        if (!active || !containerRef.current) return;
        const compact = window.matchMedia?.("(max-width: 360px)")?.matches === true;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: "buyer_access_invoice",
          appearance: "always",
          size: compact ? "compact" : "flexible",
          theme: "light",
          callback: (token) => onTokenChange(String(token || "").trim()),
          "expired-callback": () => onTokenChange(""),
          "timeout-callback": () => onTokenChange(""),
          "error-callback": () => {
            onTokenChange("");
            onError(new Error("Security verification could not load. Refresh this page and try again."));
          }
        });
      })
      .catch(onError);

    return () => {
      active = false;
      if (widgetIdRef.current != null && window.turnstile?.remove) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [onError, onTokenChange, siteKey]);

  useEffect(() => {
    if (resetNonce <= 0) return;
    onTokenChange("");
    if (E2E_FUNCTION_BYPASS) {
      globalThis.__quotePilotE2eTurnstileResetCount = Number(
        globalThis.__quotePilotE2eTurnstileResetCount || 0
      ) + 1;
      queueMicrotask(() => onTokenChange(BUYER_ACCESS_E2E_TURNSTILE_TOKEN));
      return;
    }
    if (widgetIdRef.current != null && window.turnstile?.reset) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [onTokenChange, resetNonce]);

  if (E2E_FUNCTION_BYPASS) {
    return (
      <div className="buyer-turnstile buyer-turnstile-test" role="status">
        Automated security verification is active for this browser test.
      </div>
    );
  }
  return (
    <div
      className="buyer-turnstile"
      ref={containerRef}
      aria-label="Security verification"
    />
  );
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

function InvoiceRequestCard({
  busy,
  organizationName,
  ownerName,
  ownerEmail,
  verificationComplete,
  turnstileResetNonce,
  onOrganizationNameChange,
  onOwnerNameChange,
  onOwnerEmailChange,
  onTurnstileTokenChange,
  onTurnstileError,
  onSubmit
}) {
  return (
    <section className="buyer-card buyer-purchase-card" aria-labelledby="buyer-purchase-title">
      <p className="buyer-kicker">One secure step</p>
      <div className="buyer-purchase-heading">
        <div>
          <h2 id="buyer-purchase-title">Create your $1 invoice</h2>
          <p>No QuotePilot sign-in is required before payment.</p>
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
          <label>
            <span>Owner email</span>
            <input
              type="email"
              name="ownerEmail"
              autoComplete="email"
              maxLength="254"
              required
              value={ownerEmail}
              onChange={(event) => onOwnerEmailChange(event.target.value)}
              placeholder="owner@business.com"
            />
          </label>
          <div className="buyer-invoice-note">
            <strong>Pay securely on Stripe</strong>
            <span>
              QuotePilot fixes this invoice at $1 USD. Stripe collects payment details.
              After a signed payment event, QuotePilot provisions the workspace and emails
              the owner instructions for the verified-email activation path.
            </span>
          </div>
          <BuyerTurnstile
            siteKey={TURNSTILE_SITE_KEY}
            resetNonce={turnstileResetNonce}
            onTokenChange={onTurnstileTokenChange}
            onError={onTurnstileError}
          />
          <p className="buyer-turnstile-state" role="status">
            {verificationComplete
              ? "Security verification complete."
              : "Complete the security verification to create the invoice."}
          </p>
          <button
            className="buyer-primary buyer-invoice-button"
            type="submit"
            disabled={!verificationComplete || busy}
          >
            {busy ? "Creating your invoice..." : "Create my $1 invoice"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}

function PurchaseStatusCard({ status, checking, error, exhausted, onRetry }) {
  const copy = getBuyerAccessStatusMessage(status?.status, status);
  const accessReady = status?.status === "active"
    && status.workspaceReady === true
    && status.appUrl === "/app";
  const stopped = ["payment_failed", "void", "expired"].includes(status?.status);
  const tone = accessReady ? "is-ready" : stopped ? "is-stopped" : "is-pending";

  return (
    <section className={`buyer-card buyer-status-card ${tone}`} aria-labelledby="buyer-status-title">
      <p className="buyer-kicker">Server-verified invoice status</p>
      <h2 id="buyer-status-title">{copy.title}</h2>
      <p>{copy.text}</p>
      {checking && <p className="buyer-live-status" role="status">Checking the token-bound server record...</p>}
      {error && <p className="buyer-error" role="alert">{error}</p>}
      {exhausted && (
        <p className="buyer-live-status" role="status">
          This is taking longer than expected. No browser return has granted access.
        </p>
      )}
      {accessReady ? (
        <a className="buyer-primary buyer-link-button" href="/app">Sign in to your QuotePilot workspace</a>
      ) : (
        <div className="buyer-status-actions">
          {status?.hostedInvoiceUrl && (
            <a className="buyer-secondary buyer-link-button" href={status.hostedInvoiceUrl} rel="noreferrer">
              Open my Stripe invoice
            </a>
          )}
          <button className="buyer-secondary" type="button" onClick={onRetry} disabled={checking}>
            {checking ? "Checking..." : "Check again"}
          </button>
        </div>
      )}
    </section>
  );
}

export default function BuyerAccessPage() {
  const returnHint = useMemo(
    () => readBuyerAccessReturn(typeof window === "undefined" ? "" : window.location.search),
    []
  );
  const statusContext = useMemo(() => readBuyerAccessStatusContext(), []);
  const savedRequestContext = useMemo(() => readBuyerAccessRequestContext(), []);
  const verificationConfigured = isBuyerAccessVerificationConfigured({
    siteKey: TURNSTILE_SITE_KEY,
    e2eBypass: E2E_FUNCTION_BYPASS
  });
  const [organizationName, setOrganizationName] = useState(
    savedRequestContext?.organizationName || ""
  );
  const [ownerName, setOwnerName] = useState(savedRequestContext?.ownerName || "");
  const [ownerEmail, setOwnerEmail] = useState(savedRequestContext?.ownerEmail || "");
  const [requestId, setRequestId] = useState(savedRequestContext?.requestId || "");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetNonce, setTurnstileResetNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState(null);
  const [statusChecking, setStatusChecking] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [pollExhausted, setPollExhausted] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const handleTurnstileError = useCallback((turnstileError) => {
    setTurnstileToken("");
    setError(friendlyBuyerAccessError(turnstileError));
  }, []);

  useEffect(() => {
    if (!BUYER_ACCESS_ENABLED || !verificationConfigured || !statusContext) return undefined;
    let active = true;
    let timer = null;
    let attempts = 0;
    setStatusError("");
    setPollExhausted(false);

    const poll = async () => {
      attempts += 1;
      setStatusChecking(true);
      try {
        const result = await getBuyerAccessInvoiceStatus(statusContext);
        if (!active) return;
        setInvoiceStatus(result);
        setStatusError("");
        if (["activation_sent", "active", "payment_failed", "void", "expired"].includes(result.status)) {
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
  }, [retryNonce, statusContext, verificationConfigured]);

  const updateIdentity = (setter) => (value) => {
    setter(value);
    setRequestId("");
    clearBuyerAccessRequestContext();
    setError("");
  };

  const submitInvoice = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const stableRequestId = requestId || createBuyerAccessRequestId();
      if (!requestId) setRequestId(stableRequestId);
      const requestStored = storeBuyerAccessRequestContext({
        organizationName,
        ownerName,
        ownerEmail,
        requestId: stableRequestId
      });
      if (!requestStored) {
        throw new Error("Secure invoice request recovery is unavailable in this browser.");
      }
      const invoice = await createBuyerAccessInvoice({
        organizationName,
        ownerName,
        ownerEmail,
        requestId: stableRequestId,
        turnstileToken
      });
      redirectToBuyerAccessInvoice(invoice);
    } catch (invoiceError) {
      setError(friendlyBuyerAccessError(invoiceError));
      setTurnstileToken("");
      setTurnstileResetNonce((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const showInvoiceForm = BUYER_ACCESS_ENABLED
    && verificationConfigured
    && !statusContext;

  return (
    <main className="buyer-access-shell">
      <header className="buyer-header">
        <BuyerBrand />
        <a className="buyer-header-link" href="/app">Existing customer sign in</a>
      </header>

      <div className="buyer-layout">
        <section className="buyer-intro" aria-labelledby="buyer-page-title">
          <p className="buyer-kicker">QuotePilot starter access</p>
          <h1 id="buyer-page-title">Start with a one-dollar invoice.</h1>
          <p className="buyer-lead">
            Enter the owner details, create a fixed $1 invoice, and pay on Stripe.
            QuotePilot emails activation instructions only after the signed payment event
            provisions the workspace.
          </p>
          <ul className="buyer-promise-list">
            <li>No QuotePilot login required before payment</li>
            <li>Stripe-hosted invoice and payment page</li>
            <li>Verified-email account activation after server-confirmed payment</li>
          </ul>
          <p className="buyer-proof-note">
            Returning to this page never marks an invoice paid or grants access.
          </p>
        </section>

        <div className="buyer-flow">
          {!BUYER_ACCESS_ENABLED && (
            <section className="buyer-card buyer-status-card is-stopped">
              <p className="buyer-kicker">Unavailable</p>
              <h2>Buyer access is closed in this environment</h2>
              <p>This route opens only on an explicitly approved deployment.</p>
            </section>
          )}

          {BUYER_ACCESS_ENABLED && !verificationConfigured && (
            <section className="buyer-card buyer-status-card is-stopped">
              <p className="buyer-kicker">Configuration required</p>
              <h2>Secure invoice verification is unavailable</h2>
              <p>
                QuotePilot will not create a public invoice until the approved Turnstile
                site key is configured for this build.
              </p>
            </section>
          )}

          {BUYER_ACCESS_ENABLED && returnHint.hasIgnoredStatusQuery && (
            <section className="buyer-return-note is-error" role="alert">
              <strong>Invoice status details in the URL were ignored.</strong>
              <span>QuotePilot reads the token only from this tab’s session storage. No payment or access decision was inferred.</span>
            </section>
          )}

          {BUYER_ACCESS_ENABLED && error && <p className="buyer-feedback is-error" role="alert">{error}</p>}

          {BUYER_ACCESS_ENABLED && verificationConfigured && statusContext && (
            <PurchaseStatusCard
              status={invoiceStatus}
              checking={statusChecking}
              error={statusError}
              exhausted={pollExhausted}
              onRetry={() => setRetryNonce((value) => value + 1)}
            />
          )}

          {showInvoiceForm && (
            <InvoiceRequestCard
              busy={busy}
              organizationName={organizationName}
              ownerName={ownerName}
              ownerEmail={ownerEmail}
              verificationComplete={Boolean(turnstileToken)}
              turnstileResetNonce={turnstileResetNonce}
              onOrganizationNameChange={updateIdentity(setOrganizationName)}
              onOwnerNameChange={updateIdentity(setOwnerName)}
              onOwnerEmailChange={updateIdentity(setOwnerEmail)}
              onTurnstileTokenChange={setTurnstileToken}
              onTurnstileError={handleTurnstileError}
              onSubmit={submitInvoice}
            />
          )}
        </div>
      </div>

      <footer className="buyer-footer">
        <span>QuotePilot by MBMapps</span>
        <span>Payment details stay on Stripe’s Hosted Invoice Page.</span>
      </footer>
    </main>
  );
}
