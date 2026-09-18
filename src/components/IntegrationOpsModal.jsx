import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildBuyerAccessRepairConfirmationToken,
  createSmsTestRequestId,
  getIntegrationSetupStatus,
  repairBuyerAccessInvoice,
  getOperationsAuditSnapshot,
  sendIntegrationTestSms
} from "../lib/commerceOps";
import {
  buildEmailTestConfirmationToken,
  createEmailTestRequestId,
  sendResendAcceptanceTestEmail
} from "../lib/resendAcceptanceClient";
import EmailProviderAcceptancePanel from "./EmailProviderAcceptancePanel";
import SmsProviderPanel, { isSmsProviderAttemptLocked } from "./SmsProviderPanel";
import {
  archiveOrganizationWorkspace,
  deleteOrganizationWorkspace,
  preflightCustomerOrder,
  provisionCustomerOrder,
  repairCustomerProvisioningOrder
} from "../lib/organizationService";
import {
  buildCustomerProvisioningConfirmationMessage,
  buildCustomerProvisioningPayload,
  createCustomerProvisioningForm,
  ensureCustomerProvisioningOrderId,
  validateCustomerProvisioningPayload
} from "../lib/customerProvisioning";
import { currency } from "../lib/quoteCalculator";
import { resolveOperationsAuditCapabilityState } from "../lib/operationsAuditPresentation";
import {
  getQuoteHistory,
  recordQuoteIntegrationSync
} from "../lib/quoteStore";
import { useModalDialog } from "../hooks/useModalDialog";
import CustomerProvisioningAuthorityState from "./CustomerProvisioningAuthorityState";
import OrganizationRoleAuthorityPanel from "./OrganizationRoleAuthorityPanel";
import AdaptiveChoiceField from "./AdaptiveChoiceField";
import GoogleCalendarIntegrationPanel from "./GoogleCalendarIntegrationPanel";

const PROVIDERS = ["crm", "webhook", "webhook_bridge", "hubspot", "salesforce"];
const STATES = ["queued", "success", "error", "retrying", "skipped"];
const DIRECTIONS = ["push", "pull"];
const PROVISION_PLANS = ["starter", "growth", "enterprise"];
const FUNCTIONS_ENV_SETUP_GUIDANCE = [
  "For local validation of the production deploy configuration only, keep non-secret configuration in the ignored functions/.env.tonicatering file (mode 0600):",
  "NOTIFICATIONS_SMS_PROVIDER=pingram",
  "PINGRAM_API_ORIGIN=https://api.pingram.io",
  "PINGRAM_FROM_NUMBER=",
  "PINGRAM_CONFIGURATION_GENERATION=",
  "NOTIFICATIONS_OWNER_PHONE=",
  "NOTIFICATIONS_OWNER_SMS_CONSENT=granted",
  "",
  "Validate the production dotenv payload without rewriting:",
  "FIREBASE_PROJECT_ID=tonicatering node --env-file=functions/.env.tonicatering scripts/materialize-functions-env.mjs --validate-only",
  "The production materializer rejects Pingram, Resend, Twilio, and Stripe secret values. PINGRAM_API_KEY, PINGRAM_WEBHOOK_SECRET, and SMS_CONTACT_DIGEST_SECRET belong only in Firebase Secret Manager.",
  "Do not use it for emulator setup: disposable emulator configuration must use STRIPE_MODE=test, with expendable fixtures only in the separately ignored functions/.secret.local file.",
  "Do not combine Pingram and Twilio runtime fields. Provider selection is deployment-owned and credential presence never selects a provider.",
  "Never upload either file or use production credentials locally; production provider credentials belong only in Firebase Secret Manager bindings."
].join("\n");
const SMS_DISABLE_GUIDANCE = [
  "Keep NOTIFICATIONS_SMS_PROVIDER=none in the trusted runtime configuration",
  "and leave every provider-specific field, owner destination, and consent field unset until sender registration, consent evidence, signed webhook verification, and governed backend promotion are complete."
].join(" ");
const PREPARE_BACKEND_GUIDANCE = [
  "GitHub Actions -> Prepare Firebase Production Artifact",
  "firebase_scope=backend (Firestore rules + Functions)",
  "Use the matching firebase-backend UAT and exact release evidence inputs.",
  "This stages a provider-mutation-credential-free payload with a deterministic manifest; it does not change runtime configuration or deploy.",
  "Promotion remains blocked until the separately owned trusted deployer is implemented and qualified."
].join("\n");
const DEFINITIVE_PROVISIONING_ERROR_CODES = new Set([
  "already-exists",
  "failed-precondition",
  "invalid-argument",
  "not-found",
  "out-of-range",
  "permission-denied",
  "unauthenticated"
]);

function isDefinitiveProvisioningError(error) {
  const code = String(error?.code || "")
    .trim()
    .toLowerCase()
    .replace(/^functions\//, "");
  return DEFINITIVE_PROVISIONING_ERROR_CODES.has(code);
}

function toIso(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function formatDateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function toProvider(value) {
  const provider = String(value || "").trim().toLowerCase().replace("-", "_");
  if (provider === "webhookbridge") return "webhook_bridge";
  return PROVIDERS.includes(provider) ? provider : "crm";
}

function toState(value) {
  const state = String(value || "").trim().toLowerCase();
  return STATES.includes(state) ? state : "queued";
}

function toDirection(value) {
  return String(value || "").trim().toLowerCase() === "pull" ? "pull" : "push";
}

function getCanonicalAppUrl() {
  const configuredUrl = String(import.meta.env.VITE_APP_URL || "").trim();
  if (configuredUrl) return configuredUrl;
  if (import.meta.env.PROD) {
    const configuredHost = String(import.meta.env.VITE_APP_HOST || "quotepilot.mbmapps.com")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    return `https://${configuredHost}/app`;
  }
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/app`;
}

function getLastProvisioningResultKey(uid = "") {
  const normalizedUid = String(uid || "").trim();
  return normalizedUid ? `quotepilot:last-provisioning-result:${normalizedUid}` : "";
}

function readLastProvisioningResult(uid = "") {
  const key = getLastProvisioningResultKey(uid);
  if (!key || typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) || "null");
    return parsed?.ok ? parsed : null;
  } catch {
    return null;
  }
}

function writeLastProvisioningResult(uid = "", result = null) {
  const key = getLastProvisioningResultKey(uid);
  if (!key || !result?.ok || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(result));
  } catch {
    // The on-screen result remains available when browser storage is blocked.
  }
}

function clearLastProvisioningResult(uid = "") {
  const key = getLastProvisioningResultKey(uid);
  if (!key || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // The on-screen state is still cleared when browser storage is blocked.
  }
}

function formatMissingFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return "none";
  return fields.join(", ");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeOrganizationSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function buildArchiveToken(organizationId = "") {
  const id = normalizeOrganizationSlug(organizationId);
  return id ? `ARCHIVE ${id}` : "";
}

function buildDeleteToken(organizationId = "") {
  const id = normalizeOrganizationSlug(organizationId);
  return id ? `DELETE ${id}` : "";
}

function describeProvisionEmailStatus(email = {}) {
  if (email?.sent) return "sent";
  if (email?.reason === "send_email_disabled") return "disabled";
  if (email?.reason === "existing_org_update") return "not applicable";
  if (email?.error) return "failed";
  return "not sent";
}

export function applySmsSetupStatusRefresh(previousState = {}, status = null) {
  const current = previousState.smsResult || null;
  const latest = status?.sms?.latestEvidence || null;
  const sameAttempt = latest?.attemptId
    && current?.attemptId
    && latest.attemptId === current.attemptId;
  const nextSmsResult = !current || sameAttempt ? (latest || current) : current;
  return {
    ...previousState,
    loading: false,
    reconciling: false,
    error: "",
    status,
    smsResult: nextSmsResult
  };
}

export function applySmsTestMessageChange(previousState = {}, value = "") {
  const status = previousState.status || null;
  const smsResult = previousState.smsResult || status?.sms?.latestEvidence || null;
  if (isSmsProviderAttemptLocked({
    status,
    testing: previousState.testing,
    reconciling: previousState.reconciling,
    statusError: previousState.error,
    smsResult
  })) {
    return previousState;
  }
  return {
    ...previousState,
    testMessage: value,
    testRequestId: "",
    smsResult: null
  };
}

export function resolveSmsDiagnosticRequestId({
  currentRequestId = "",
  smsResult = null,
  createRequestId = createSmsTestRequestId
} = {}) {
  const state = String(smsResult?.state || smsResult?.outcome || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const completed = ["delivered", "failed", "definite_failure", "rejected"]
    .includes(state);
  return completed || !String(currentRequestId || "").trim()
    ? createRequestId()
    : currentRequestId;
}

async function copyText(text) {
  if (!navigator?.clipboard) {
    throw new Error("Clipboard unavailable in this browser.");
  }
  await navigator.clipboard.writeText(text);
}

function flattenLogs(quotes) {
  const rows = [];
  quotes.forEach((quote) => {
    const logs = Array.isArray(quote.integrations?.logs) ? quote.integrations.logs : [];
    logs.forEach((entry, idx) => {
      rows.push({
        id: `${quote.id}-${entry.id || idx}`,
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber || "-",
        customer: quote.customer?.name || quote.customer?.email || "-",
        eventDate: quote.event?.date || "-",
        total: Number(quote.totals?.total || 0),
        provider: toProvider(entry.provider),
        state: toState(entry.state),
        direction: toDirection(entry.direction),
        message: String(entry.message || "").trim(),
        attempt: Math.max(1, Number(entry.attempt || 1)),
        payloadRef: String(entry.payloadRef || "").trim(),
        actorEmail: String(entry.actorEmail || "").trim(),
        occurredAtISO: toIso(entry.occurredAtISO) || toIso(entry.occurredAt)
      });
    });
  });

  return rows.sort((a, b) => b.occurredAtISO.localeCompare(a.occurredAtISO));
}

export function IntegrationOpsView({
  open,
  onClose,
  presentation = "embedded",
  organizationId = "",
  settings = {},
  currentUserEmail = "",
  currentUserUid = "",
  canProvisionCustomer = false,
  canManageProviders = false,
  provisioningOnly = false,
  returnFocusRef = null
}) {
  const embedded = presentation === "embedded";
  const defaultProvider = toProvider(settings.crmProvider || "crm");
  const [state, setState] = useState({
    loading: false,
    error: "",
    source: "",
    quotes: []
  });
  const [auditState, setAuditState] = useState({
    loading: false,
    recovering: false,
    error: "",
    snapshot: null
  });
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [syncStateFilter, setSyncStateFilter] = useState("all");
  const [saving, setSaving] = useState(false);
  const [setupState, setSetupState] = useState({
    loading: false,
    testing: false,
    reconciling: false,
    error: "",
    smsResult: null,
    testRequestId: "",
    status: null,
    testMessage: ""
  });
  const [emailTestState, setEmailTestState] = useState({
    testing: false,
    reconciling: false,
    recovering: false,
    uncertain: false,
    error: "",
    requestId: "",
    recipientEmail: "",
    confirmationToken: "",
    result: null
  });
  const [provisionState, setProvisionState] = useState({
    loading: false,
    phase: "",
    error: "",
    result: null,
    reconciliationPayload: null
  });
  const [lastProvisioningResult, setLastProvisioningResult] = useState(null);
  const [provisionForm, setProvisionForm] = useState(
    () => createCustomerProvisioningForm(getCanonicalAppUrl())
  );
  const routeRef = useRef(null);
  const wasOpenRef = useRef(false);
  const [cleanupState, setCleanupState] = useState({
    loading: false,
    error: "",
    result: null
  });
  const [buyerRepairState, setBuyerRepairState] = useState({
    loading: false,
    error: "",
    result: null
  });
  const [buyerRepairForm, setBuyerRepairForm] = useState({
    orderId: "",
    confirmationToken: ""
  });
  const [cleanupForm, setCleanupForm] = useState({
    organizationId: normalizeOrganizationSlug(organizationId),
    archiveToken: "",
    deleteToken: ""
  });
  const [form, setForm] = useState({
    quoteId: "",
    provider: defaultProvider,
    state: "queued",
    direction: "push",
    attempt: 1,
    message: "",
    payloadRef: ""
  });

  const load = async () => {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    if (canManageProviders) {
      setAuditState((prev) => ({
        ...prev,
        loading: true,
        recovering: Boolean(prev.error),
        error: ""
      }));
    }
    try {
      const [result, auditResult] = await Promise.all([
        getQuoteHistory({ organizationId }),
        canManageProviders
          ? getOperationsAuditSnapshot({ organizationId })
            .then((snapshot) => ({ snapshot, error: "" }))
            .catch(() => ({
              snapshot: null,
              error: "Operations audit could not be loaded. Try again."
            }))
          : Promise.resolve({ snapshot: null, error: "" })
      ]);
      setState({
        loading: false,
        error: "",
        source: result.source,
        quotes: result.quotes
      });
      setForm((prev) => ({
        ...prev,
        quoteId: prev.quoteId || result.quotes[0]?.id || ""
      }));
      if (canManageProviders) {
        setAuditState({
          loading: false,
          recovering: false,
          error: auditResult.error,
          snapshot: auditResult.snapshot
        });
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to load integration data."
      }));
      if (canManageProviders) {
        setAuditState((prev) => ({ ...prev, loading: false, recovering: false }));
      }
    }
  };

  const refreshSetupStatus = async () => {
    if (!canManageProviders) return;
    const reconcile = setupState.smsResult?.requiresReconciliation === true
      || ["uncertain", "reconciliation"].includes(
        String(setupState.status?.sms?.mutationState || "").trim().toLowerCase()
      );
    setSetupState((prev) => ({
      ...prev,
      loading: !reconcile,
      reconciling: reconcile,
      error: ""
    }));
    try {
      const result = await getIntegrationSetupStatus();
      const status = result?.status || null;
      setSetupState((prev) => applySmsSetupStatusRefresh(prev, status));
    } catch (err) {
      setSetupState((prev) => ({
        ...prev,
        loading: false,
        reconciling: false,
        error: err?.message || "Failed to load integration setup status."
      }));
    }
  };

  const handleCopyValue = async (value, label) => {
    try {
      await copyText(value);
      setFeedback(`${label} copied.`);
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || `Failed to copy ${label.toLowerCase()}.` }));
    }
  };

  const handleSendTestSms = async () => {
    if (!canManageProviders) {
      setSetupState((prev) => ({
        ...prev,
        error: "Admin role is required for provider setup and test sends."
      }));
      return;
    }
    if (isSmsProviderAttemptLocked({
      status: setupState.status,
      testing: setupState.testing,
      reconciling: setupState.reconciling,
      statusError: setupState.error,
      smsResult: setupState.smsResult || setupState.status?.sms?.latestEvidence || null
    })) {
      return;
    }
    setSetupState((prev) => ({
      ...prev,
      testing: true,
      error: "",
      smsResult: null
    }));
    let requestId = setupState.testRequestId;
    try {
      requestId = resolveSmsDiagnosticRequestId({
        currentRequestId: setupState.testRequestId,
        smsResult: setupState.smsResult || setupState.status?.sms?.latestEvidence || null
      });
      setSetupState((prev) => ({ ...prev, testRequestId: requestId }));
      const result = await sendIntegrationTestSms({
        requestId,
        message: setupState.testMessage
      });
      const sms = result?.sms || {};
      setSetupState((prev) => ({
        ...prev,
        testing: false,
        status: result?.status || prev.status,
        smsResult: sms
      }));
    } catch (err) {
      setSetupState((prev) => ({
        ...prev,
        testing: false,
        testRequestId: requestId || prev.testRequestId,
        error: err?.message || "Failed to send integration SMS test."
      }));
    }
  };

  const handleSendEmailAcceptanceTest = async () => {
    if (!canProvisionCustomer) {
      setEmailTestState((prev) => ({
        ...prev,
        error: "Platform administrator authority is required for an email acceptance test."
      }));
      return;
    }
    if (emailTestState.testing || emailTestState.uncertain || emailTestState.result) return;
    const requestId = emailTestState.requestId || createEmailTestRequestId();
    setEmailTestState((prev) => ({
      ...prev,
      testing: true,
      reconciling: false,
      recovering: false,
      uncertain: false,
      error: "",
      requestId
    }));
    try {
      const result = await sendResendAcceptanceTestEmail({
        requestId,
        recipientEmail: emailTestState.recipientEmail,
        confirmationToken: emailTestState.confirmationToken
      });
      setEmailTestState((prev) => ({
        ...prev,
        testing: false,
        recovering: false,
        uncertain: false,
        error: "",
        result
      }));
      setFeedback(
        "Resend accepted the controlled request. Delivery still requires provider and inbox evidence."
      );
      await load();
    } catch (err) {
      const code = String(err?.code || "").trim().toLowerCase().replace(/^functions\//, "");
      const uncertain = ["aborted", "deadline-exceeded", "internal", "unavailable", "unknown"]
        .includes(code) || !code;
      const recovering = code === "failed-precondition";
      setEmailTestState((prev) => ({
        ...prev,
        testing: false,
        recovering,
        uncertain,
        requestId: uncertain ? prev.requestId : "",
        error: err?.message || (uncertain
          ? "The provider outcome is unknown. Do not retry this request."
          : "The controlled email acceptance request was rejected.")
      }));
    }
  };

  const handleReviewEmailAcceptanceRecord = async () => {
    if (!emailTestState.uncertain || emailTestState.reconciling) return;
    setEmailTestState((prev) => ({ ...prev, reconciling: true }));
    try {
      await load();
    } finally {
      setEmailTestState((prev) => ({ ...prev, reconciling: false }));
    }
  };

  const handleProvisionCustomer = async (reconciliationPayload = null) => {
    if (!canProvisionCustomer) {
      setProvisionState((prev) => ({ ...prev, error: "Admin role is required for customer provisioning." }));
      return;
    }

    const reconciling = Boolean(reconciliationPayload?.orderId && reconciliationPayload?.organizationId);
    const payload = reconciling
      ? { ...reconciliationPayload }
      : buildCustomerProvisioningPayload(provisionForm, getCanonicalAppUrl());
    const validationError = validateCustomerProvisioningPayload(payload);
    if (validationError) {
      setProvisionState((prev) => ({ ...prev, error: validationError }));
      return;
    }
    if (!reconciling) {
      payload.orderId = ensureCustomerProvisioningOrderId(payload.orderId);
      setProvisionForm((prev) => (
        prev.orderId === payload.orderId ? prev : { ...prev, orderId: payload.orderId }
      ));
    }

    setProvisionState({
      loading: true,
      phase: reconciling ? "reconciling" : "checking",
      error: "",
      result: null,
      reconciliationPayload: reconciling ? payload : null
    });
    setFeedback("");
    setState((prev) => ({ ...prev, error: "" }));
    let completedPreflight = null;
    try {
      const preflight = await preflightCustomerOrder(payload);
      completedPreflight = preflight;
      if (!preflight?.ok || !preflight?.preflight) {
        throw new Error("Organization preflight did not complete.");
      }
      if (preflight.orderExists) {
        if (preflight.canResume) {
          if (!reconciling) setFeedback(
            `Matching order "${payload.orderId}" found with status ${preflight.orderStatus || "pending"}. Confirm to resume it safely.`
          );
        } else {
          const artifactsBlocked = Array.isArray(preflight.resumeBlockedReasons)
            && preflight.resumeBlockedReasons.length > 0;
          setProvisionState({
            loading: false,
            phase: "",
            error: artifactsBlocked
              ? `Provisioning order "${payload.orderId}" cannot be resumed because its tenant artifacts are incomplete or no longer match. No email was sent.`
              : `Provisioning order "${payload.orderId}" already exists. No changes were made. Use a new order id.`,
            result: null,
            reconciliationPayload: null
          });
          return;
        }
      }
      if (reconciling && (!preflight.orderExists || !preflight.canResume)) {
        throw Object.assign(
          new Error("No committed receipt was found for this exact order. Review the unchanged form before trying again."),
          { code: "functions/failed-precondition" }
        );
      }
      if (preflight.unsafeResidue) {
        setProvisionState({
          loading: false,
          phase: "",
          error: `Organization id "${preflight.organizationId || payload.organizationId}" has retired or orphaned state and cannot be provisioned automatically. No changes were made.`,
          result: null,
          reconciliationPayload: null
        });
        return;
      }
      if (preflight.exists && !payload.updateExistingOrganization && !preflight.canResume) {
        setProvisionState({
          loading: false,
          phase: "",
          error: `Organization "${preflight.organizationId || payload.organizationId || payload.organizationName}" already exists. No changes were made. Use an explicit tenant update workflow instead.`,
          result: null,
          reconciliationPayload: null
        });
        return;
      }
      if (!preflight.exists && payload.updateExistingOrganization) {
        setProvisionState({
          loading: false,
          phase: "",
          error: `Organization "${preflight.organizationId || payload.organizationId}" does not exist. No changes were made.`,
          result: null,
          reconciliationPayload: null
        });
        return;
      }
      if (payload.updateExistingOrganization && !preflight.canUpdate && !preflight.canResume) {
        setProvisionState({
          loading: false,
          phase: "",
          error: `Organization "${preflight.organizationId || payload.organizationId}" cannot be updated safely. No changes were made.`,
          result: null,
          reconciliationPayload: null
        });
        return;
      }
      if (preflight.organizationId) {
        payload.organizationId = preflight.organizationId;
      }
    } catch (err) {
      const uncertainReconciliation = reconciling && !isDefinitiveProvisioningError(err);
      setProvisionState({
        loading: false,
        phase: uncertainReconciliation ? "uncertain" : "",
        error: err?.message || "Failed to check the organization before provisioning.",
        result: null,
        reconciliationPayload: uncertainReconciliation ? payload : null
      });
      return;
    }

    const confirmed = reconciling || window.confirm(
      buildCustomerProvisioningConfirmationMessage(payload, completedPreflight)
    );
    if (!confirmed) {
      setProvisionState({ loading: false, phase: "", error: "", result: null, reconciliationPayload: null });
      return;
    }

    setProvisionState({ loading: true, phase: "provisioning", error: "", result: null, reconciliationPayload: null });
    try {
      const result = await provisionCustomerOrder(payload);
      if (!result?.ok || (reconciling && String(result.orderId || "") !== String(payload.orderId))) {
        throw new Error("Provisioning failed.");
      }
      setProvisionState({
        loading: false,
        phase: "",
        error: "",
        result,
        reconciliationPayload: null
      });
      setLastProvisioningResult(result);
      writeLastProvisioningResult(currentUserUid, result);
      setProvisionForm(createCustomerProvisioningForm(getCanonicalAppUrl()));
      setFeedback(reconciling
        ? `Recovered the exact provisioning receipt for ${result.organizationName || result.organizationId}.`
        : result.operation === "updated_entitlements"
          ? `Updated plan entitlements for ${result.organizationName || result.organizationId || "organization"}.`
          : `Provisioned ${result.organizationName || payload.organizationName} (${result.organizationId || "n/a"}).`);
    } catch (err) {
      const definitive = isDefinitiveProvisioningError(err);
      setProvisionState({
        loading: false,
        phase: definitive ? "" : "uncertain",
        error: err?.message || (definitive
          ? "Provisioning was rejected without changing the organization."
          : "The provisioning request ended without a receipt."),
        result: null,
        reconciliationPayload: definitive ? null : payload
      });
    }
  };

  const handleReconcileProvisioning = () => handleProvisionCustomer(
    provisionState.reconciliationPayload
  );

  const invalidateProvisioningHandoff = () => {
    setProvisionState((prev) => ({
      ...prev,
      error: "",
      result: null,
      phase: "",
      reconciliationPayload: null
    }));
    setLastProvisioningResult(null);
    clearLastProvisioningResult(currentUserUid);
  };

  const updateProvisionForm = (updater) => {
    invalidateProvisioningHandoff();
    setProvisionForm(updater);
  };

  const handleRetryOwnerClaims = async () => {
    const previous = provisionState.result || lastProvisioningResult;
    const ownerUid = String(previous?.ownerUid || "").trim();
    if (!ownerUid) {
      setProvisionState((prev) => ({
        ...prev,
        error: "The completed order does not contain an owner UID to repair."
      }));
      return;
    }

    setProvisionState((prev) => ({
      ...prev,
      loading: true,
      phase: "repairing-claims",
      error: ""
    }));
    try {
      const repaired = await repairCustomerProvisioningOrder({
        orderId: previous.orderId,
        organizationId: previous.organizationId,
        ownerUid
      });
      if (
        !repaired?.ok
        || String(repaired.ownerUid || "").trim() !== ownerUid
        || normalizeOrganizationSlug(repaired.organizationId)
          !== normalizeOrganizationSlug(previous.organizationId)
        || String(repaired.orderId || "").trim() !== String(previous.orderId || "").trim()
        || repaired?.claimsSync?.succeeded !== true
        || repaired?.email?.auditPersisted !== true
      ) {
        throw new Error("Owner claims repair returned an unexpected identity or organization.");
      }
      const result = repaired;
      setProvisionState({
        loading: false,
        phase: "",
        error: "",
        result
      });
      setLastProvisioningResult(result);
      writeLastProvisioningResult(currentUserUid, result);
      setFeedback(`Owner access and onboarding order repaired for ${previous.ownerEmail || ownerUid}.`);
    } catch (error) {
      setProvisionState((prev) => ({
        ...prev,
        loading: false,
        phase: "",
        error: error?.message || "Owner claims repair failed."
      }));
    }
  };

  const handleArchiveOrganization = async () => {
    if (!canProvisionCustomer) {
      setCleanupState((prev) => ({ ...prev, error: "Admin role is required for organization cleanup." }));
      return;
    }

    const targetOrganizationId = normalizeOrganizationSlug(cleanupForm.organizationId);
    const confirmation = String(cleanupForm.archiveToken || "").trim();
    if (!targetOrganizationId) {
      setCleanupState((prev) => ({ ...prev, error: "Target organization id is required." }));
      return;
    }
    if (!confirmation) {
      setCleanupState((prev) => ({ ...prev, error: `Enter confirmation token: ${buildArchiveToken(targetOrganizationId)}` }));
      return;
    }

    const expectedToken = buildArchiveToken(targetOrganizationId);
    if (confirmation !== expectedToken) {
      setCleanupState((prev) => ({ ...prev, error: `Archive token mismatch. Use exactly: ${expectedToken}` }));
      return;
    }

    const confirmed = window.confirm(
      `Archive organization "${targetOrganizationId}"? This disables tenant host mappings and marks the org archived.`
    );
    if (!confirmed) return;

    setCleanupState({ loading: true, error: "", result: null });
    setFeedback("");
    try {
      const result = await archiveOrganizationWorkspace({
        organizationId: targetOrganizationId,
        confirmationToken: confirmation
      });
      if (!result?.ok) {
        throw new Error("Archive operation failed.");
      }
      setCleanupState({
        loading: false,
        error: "",
        result: {
          ...result,
          action: "archive"
        }
      });
      setCleanupForm((prev) => ({
        ...prev,
        organizationId: targetOrganizationId,
        archiveToken: "",
        deleteToken: prev.deleteToken || buildDeleteToken(targetOrganizationId)
      }));
      setFeedback(`Archived organization ${targetOrganizationId}.`);
    } catch (err) {
      setCleanupState({
        loading: false,
        error: err?.message || "Failed to archive organization.",
        result: null
      });
    }
  };

  const handleRepairBuyerInvoice = async () => {
    if (!canProvisionCustomer) {
      setBuyerRepairState((prev) => ({
        ...prev,
        error: "Platform administrator authority is required for buyer invoice repair."
      }));
      return;
    }
    const orderId = String(buyerRepairForm.orderId || "").trim().toLowerCase();
    const expectedToken = buildBuyerAccessRepairConfirmationToken(orderId);
    if (!expectedToken) {
      setBuyerRepairState((prev) => ({
        ...prev,
        error: "Enter a valid buyer access order id."
      }));
      return;
    }
    if (String(buyerRepairForm.confirmationToken || "").trim() !== expectedToken) {
      setBuyerRepairState((prev) => ({
        ...prev,
        error: `Repair token mismatch. Use exactly: ${expectedToken}`
      }));
      return;
    }
    const confirmed = window.confirm(
      `Verify and permanently void the terminal Stripe test Invoice for "${orderId}"? This action is audited and cannot be undone.`
    );
    if (!confirmed) return;

    setBuyerRepairState({ loading: true, error: "", result: null });
    setFeedback("");
    try {
      const result = await repairBuyerAccessInvoice({
        orderId,
        confirmationToken: expectedToken
      });
      setBuyerRepairState({ loading: false, error: "", result });
      setBuyerRepairForm({ orderId, confirmationToken: "" });
      setFeedback(
        `Buyer Invoice ${orderId} is provider-verified void. A fresh request is allowed after the server-owned email window.`
      );
    } catch (err) {
      setBuyerRepairState({
        loading: false,
        error: err?.message || "Buyer invoice repair failed.",
        result: null
      });
    }
  };

  const handleDeleteOrganization = async () => {
    if (!canProvisionCustomer) {
      setCleanupState((prev) => ({ ...prev, error: "Admin role is required for organization cleanup." }));
      return;
    }

    const targetOrganizationId = normalizeOrganizationSlug(cleanupForm.organizationId);
    const confirmation = String(cleanupForm.deleteToken || "").trim();
    if (!targetOrganizationId) {
      setCleanupState((prev) => ({ ...prev, error: "Target organization id is required." }));
      return;
    }
    if (!confirmation) {
      setCleanupState((prev) => ({ ...prev, error: `Enter confirmation token: ${buildDeleteToken(targetOrganizationId)}` }));
      return;
    }

    const expectedToken = buildDeleteToken(targetOrganizationId);
    if (confirmation !== expectedToken) {
      setCleanupState((prev) => ({ ...prev, error: `Delete token mismatch. Use exactly: ${expectedToken}` }));
      return;
    }

    const confirmed = window.confirm(
      `Hard delete organization "${targetOrganizationId}"? This permanently deletes org data and cannot be undone.`
    );
    if (!confirmed) return;

    setCleanupState({ loading: true, error: "", result: null });
    setFeedback("");
    try {
      const result = await deleteOrganizationWorkspace({
        organizationId: targetOrganizationId,
        confirmationToken: confirmation
      });
      if (!result?.ok) {
        throw new Error("Delete operation failed.");
      }
      setCleanupState({
        loading: false,
        error: "",
        result: {
          ...result,
          action: "delete"
        }
      });
      setCleanupForm((prev) => ({
        ...prev,
        organizationId: targetOrganizationId,
        archiveToken: "",
        deleteToken: ""
      }));
      setFeedback(`Deleted organization ${targetOrganizationId}.`);
    } catch (err) {
      setCleanupState({
        loading: false,
        error: err?.message || "Failed to delete organization.",
        result: null
      });
    }
  };

  useEffect(() => {
    setLastProvisioningResult(readLastProvisioningResult(currentUserUid));
  }, [currentUserUid]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setFeedback("");
    if (!provisioningOnly) {
      setForm((prev) => ({ ...prev, provider: toProvider(settings.crmProvider || prev.provider || "crm") }));
      load();
      if (canManageProviders) refreshSetupStatus();
    }
    setProvisionState({
      loading: false,
      phase: "",
      error: "",
      result: null
    });
    setLastProvisioningResult(readLastProvisioningResult(currentUserUid));
    setProvisionForm(createCustomerProvisioningForm(getCanonicalAppUrl()));
    setBuyerRepairState({ loading: false, error: "", result: null });
    setBuyerRepairForm({ orderId: "", confirmationToken: "" });
    setEmailTestState({
      testing: false,
      reconciling: false,
      recovering: false,
      uncertain: false,
      error: "",
      requestId: "",
      recipientEmail: "",
      confirmationToken: "",
      result: null
    });
    if (!provisioningOnly) {
      setCleanupState({
        loading: false,
        error: "",
        result: null
      });
      setCleanupForm((prev) => {
        const targetOrganizationId = normalizeOrganizationSlug(prev.organizationId || organizationId);
        return {
          organizationId: targetOrganizationId,
          archiveToken: prev.archiveToken,
          deleteToken: prev.deleteToken
        };
      });
    }
  }, [open, provisioningOnly, canManageProviders]);

  const activityRows = useMemo(() => flattenLogs(state.quotes), [state.quotes]);

  const filteredRows = useMemo(() => {
    return activityRows.filter((row) => {
      if (providerFilter !== "all" && row.provider !== providerFilter) return false;
      if (syncStateFilter !== "all" && row.state !== syncStateFilter) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      const haystack = [
        row.quoteNumber,
        row.customer,
        row.eventDate,
        row.provider,
        row.state,
        row.message,
        row.actorEmail,
        row.payloadRef
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [activityRows, providerFilter, syncStateFilter, search]);

  const selectedQuote = useMemo(
    () => state.quotes.find((quote) => quote.id === form.quoteId) || null,
    [state.quotes, form.quoteId]
  );

  const integrationStatus = setupState.status || {};
  const emailStatus = integrationStatus.email || {};
  const expectedEmailTestConfirmation = buildEmailTestConfirmationToken(
    emailTestState.recipientEmail
  );
  const operationsAuditCapabilityState = resolveOperationsAuditCapabilityState(auditState);
  const stripeStatus = integrationStatus.stripe || {};
  const stripeMissingFields = Array.isArray(stripeStatus.missingFields) ? stripeStatus.missingFields : [];
  const canShowRecoveredProvisioningResult = !provisionState.loading && !provisionState.error;
  const provisioningResult = provisionState.result
    || (canShowRecoveredProvisioningResult ? lastProvisioningResult : null)
    || {};
  const provisioningEmailStatus = describeProvisionEmailStatus(provisioningResult.email);
  const provisioningOnboarding = provisioningResult.onboarding || {};
  const updatedExistingOrganization = provisioningResult.operation === "updated_entitlements";
  const ownerClaimsIncomplete = provisioningResult?.claimsSync?.required
    && !provisioningResult.claimsSync.succeeded;
  const showingRecoveredProvisioningResult = !provisionState.result
    && canShowRecoveredProvisioningResult
    && Boolean(lastProvisioningResult?.ok);
  const provisioningCapabilityState = provisionState.phase === "uncertain"
    ? "uncertain"
    : provisionState.phase === "reconciling"
      ? "reconciliation"
      : provisionState.loading
        ? "submitting"
        : provisioningResult.ok
          ? "receipt"
          : provisionState.error
            ? "error"
            : "ready";
  const selectedIntegrationQuotePresent = state.quotes.some((quote) => quote.id === form.quoteId);
  const integrationQuoteOptions = state.quotes.map((quote) => ({
    value: quote.id,
    label: `${quote.quoteNumber || quote.id} • ${quote.customer?.name || quote.customer?.email || "-"} • ${quote.event?.date || "-"}`
  }));
  if (form.quoteId && !selectedIntegrationQuotePresent && integrationQuoteOptions.length > 0) {
    integrationQuoteOptions.unshift({
      value: form.quoteId,
      label: `Previously selected quote ${form.quoteId} (not in the current read)`
    });
  }

  const handleRecord = async () => {
    if (!form.quoteId) {
      setState((prev) => ({ ...prev, error: "Choose a quote before recording a sync event." }));
      return;
    }

    setSaving(true);
    setFeedback("");
    setState((prev) => ({ ...prev, error: "" }));
    try {
      const result = await recordQuoteIntegrationSync({
        quoteId: form.quoteId,
        provider: form.provider,
        direction: form.direction,
        state: form.state,
        message: form.message,
        actorEmail: currentUserEmail,
        attempt: form.attempt,
        payloadRef: form.payloadRef
      });
      setFeedback(`Recorded ${result.entry.provider} ${result.entry.state} event.`);
      setForm((prev) => ({ ...prev, message: "", payloadRef: "" }));
      await load();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err?.message || "Failed to record integration event."
      }));
    } finally {
      setSaving(false);
    }
  };

  const closeBlocked = Boolean(
    saving
    || setupState.testing
    || emailTestState.testing
    || emailTestState.reconciling
    || provisionState.loading
    || cleanupState.loading
    || buyerRepairState.loading
  );
  const handleClose = () => {
    if (closeBlocked) {
      setFeedback("Wait for the current operation to finish before closing this tool.");
      return;
    }
    onClose?.();
  };
  const { dialogRef } = useModalDialog({
    open: open && !embedded,
    onRequestClose: handleClose,
    canClose: !closeBlocked,
    onCloseBlocked: () => setFeedback("Wait for the current operation to finish before closing this tool."),
    returnFocusRef
  });

  useEffect(() => {
    if (!open || !embedded || typeof window === "undefined") return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      routeRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [embedded, open]);

  if (!open) return null;

  return (
    <div
      ref={embedded ? routeRef : dialogRef}
      className={embedded ? "container workspace-route-main embedded-workspace-route" : "modal-overlay"}
      data-layout-overlap-allowed={embedded ? undefined : "true"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-labelledby="integration-ops-title"
      tabIndex={-1}
    >
      <div className={`modal-card integration-card${embedded ? " workspace-route-card" : ""}`}>
        <div className="modal-head">
          <h2 id="integration-ops-title">{provisioningOnly ? "Customer Provisioning" : "Integrations Ops"}</h2>
          <div className="right-actions">
            {!provisioningOnly && (
              <>
                <button type="button" className="ghost" onClick={load} disabled={state.loading}>
                  {state.loading ? "Refreshing..." : "Refresh"}
                </button>
                {canManageProviders && <button type="button" className="ghost" onClick={refreshSetupStatus} disabled={setupState.loading}>
                  {setupState.loading ? "Checking Setup..." : "Check Setup"}
                </button>}
              </>
            )}
            <button
              type="button"
              className="ghost"
              data-modal-initial-focus={embedded ? undefined : "true"}
              onClick={handleClose}
              disabled={closeBlocked}
            >
              {embedded ? "Back to Home" : "Close"}
            </button>
          </div>
        </div>

        {!provisioningOnly && <p className="source-note">Source: {state.source || "-"}</p>}
        {state.error && <p className="error-note">{state.error}</p>}
        {feedback && <p className="source-note">{feedback}</p>}

        {!provisioningOnly && canManageProviders && <OrganizationRoleAuthorityPanel />}

        {!provisioningOnly && canManageProviders && <GoogleCalendarIntegrationPanel
          mode="connection"
          organizationId={organizationId}
          role="admin"
          source={state.source || "firebase"}
          enabled={Boolean(organizationId)}
        />}

        {!provisioningOnly && canManageProviders && <section
          className="admin-section operations-audit-panel"
          data-capability-id="bounded-security-audit"
          data-capability-state={operationsAuditCapabilityState}
        >
          <div className="admin-section-head">
            <div>
              <h3>Operations Audit</h3>
              <p className="source-note">Server-derived delivery health, recorded sync trend, and role-stamped sensitive actions.</p>
            </div>
            {auditState.loading && <span>{auditState.recovering ? "Checking again..." : "Loading..."}</span>}
          </div>
          {auditState.error && <p className="warning-note">{auditState.error}</p>}
          {auditState.snapshot && (
            <>
              <div className="dashboard-grid">
                <div className="metric-card"><span>Delivery accepted</span><strong>{auditState.snapshot.delivery?.providerAccepted || 0}</strong></div>
                <div className="metric-card"><span>Retry available</span><strong>{auditState.snapshot.delivery?.retryAvailable || 0}</strong></div>
                <div className="metric-card"><span>Review required</span><strong>{auditState.snapshot.delivery?.reviewRequired || 0}</strong></div>
                <div className="metric-card"><span>7-day sync success</span><strong>{Number(auditState.snapshot.sync?.successRate || 0).toFixed(1)}%</strong></div>
                <div className="metric-card"><span>Admins</span><strong>{auditState.snapshot.roles?.admin || 0}</strong></div>
                <div className="metric-card"><span>Sales staff</span><strong>{auditState.snapshot.roles?.sales || 0}</strong></div>
                <div className="metric-card"><span>Receipt-backed actions</span><strong>{auditState.snapshot.security?.receiptBackedActionCount || 0}</strong></div>
                <div className="metric-card"><span>Legacy observations</span><strong>{auditState.snapshot.security?.legacyObservationCount || 0}</strong></div>
              </div>
              <div className="status-strip" aria-label="Seven-day integration health trend">
                {(auditState.snapshot.sync?.trend || []).map((row) => (
                  <span key={row.day}>{row.day.slice(5)}: {row.success} ok / {row.error} error</span>
                ))}
              </div>
              <div className="history-table-wrap">
                <table>
                  <thead><tr><th>When</th><th>Action</th><th>State</th><th>Target</th><th>Actor role</th><th>Actor</th><th>Evidence</th></tr></thead>
                  <tbody>
                    {(auditState.snapshot.actions || []).map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.occurredAtISO)}</td>
                        <td>{row.action}</td>
                        <td>{row.state || "-"}</td>
                        <td>{row.targetEmail || row.quoteNumber || row.quoteId || "-"}</td>
                        <td>{row.actorRole || "-"}</td>
                        <td>{row.actorEmail || "-"}</td>
                        <td>{row.authority}</td>
                      </tr>
                    ))}
                    {!(auditState.snapshot.actions || []).length && (
                      <tr><td colSpan="7">No server-owned sensitive actions recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="source-note">
                Receipt-backed rows are durable server evidence for the bounded action taxonomy. Delivery and catalog rows remain labeled legacy observations. Retry counts are operational candidates, not proof that a resend occurred. Browser export and clear are unavailable, and no receipt-clear workflow is implemented.
              </p>
            </>
          )}
        </section>}

        {!provisioningOnly && canManageProviders && <section className="admin-section">
          <div className="admin-section-head">
            <h3>Integration Record Policy</h3>
          </div>
          <p className="source-note">
            CRM endpoints and tokens are not active configuration in this release. Legacy catalog values are ignored; the controls below this section record operator audit events and do not contact an external CRM.
          </p>
          <div className="status-strip">
            <span>CRM connector: <strong>unavailable</strong></span>
            <span>Outbound provider: <strong>none</strong></span>
            <span>Mode: <strong>audit only</strong></span>
            <span>Retry limit: <strong>{Math.max(1, Number(settings.integrationRetryLimit || 3))}</strong></span>
            <span>Audit retention: <strong>{Math.max(10, Number(settings.integrationAuditRetention || 50))}</strong></span>
          </div>
        </section>}

        {!provisioningOnly && canManageProviders && <SmsProviderPanel
          status={integrationStatus}
          loading={setupState.loading}
          testing={setupState.testing}
          reconciling={setupState.reconciling}
          statusError={setupState.error}
          smsResult={setupState.smsResult || integrationStatus.sms?.latestEvidence || null}
          testMessage={setupState.testMessage}
          onRefresh={refreshSetupStatus}
          onTestMessageChange={(value) => setSetupState((prev) => (
            applySmsTestMessageChange(prev, value)
          ))}
          onSendTest={handleSendTestSms}
          onCopySetupGuidance={() => handleCopyValue(FUNCTIONS_ENV_SETUP_GUIDANCE, "Setup guidance")}
          onCopyDisableGuidance={() => handleCopyValue(SMS_DISABLE_GUIDANCE, "SMS disable guidance")}
          setupGuidance={FUNCTIONS_ENV_SETUP_GUIDANCE}
          disableGuidance={SMS_DISABLE_GUIDANCE}
        />}

        {!provisioningOnly && canProvisionCustomer && <EmailProviderAcceptancePanel
          emailStatus={emailStatus}
          recipientEmail={emailTestState.recipientEmail}
          confirmationToken={emailTestState.confirmationToken}
          expectedConfirmationToken={expectedEmailTestConfirmation}
          testing={emailTestState.testing}
          reconciling={emailTestState.reconciling}
          recovering={emailTestState.recovering}
          result={emailTestState.result}
          error={emailTestState.error}
          uncertain={emailTestState.uncertain}
          onRecipientChange={(recipientEmail) => setEmailTestState((prev) => ({
            ...prev,
            recipientEmail,
            confirmationToken: "",
            requestId: "",
            result: null,
            recovering: false,
            uncertain: false,
            error: ""
          }))}
          onConfirmationChange={(confirmationToken) => setEmailTestState((prev) => ({
            ...prev,
            confirmationToken,
            error: ""
          }))}
          onSend={handleSendEmailAcceptanceTest}
          onReview={handleReviewEmailAcceptanceRecord}
        />}

        {!provisioningOnly && canManageProviders && <section className="admin-section">
          <div className="admin-section-head">
            <h3>Payment provider runtime</h3>
          </div>
          <p className="source-note">
            Stripe readiness remains separate from SMS provider choice. This cached runtime check does not alter payment routing or create provider objects.
          </p>
          <div className="status-strip">
            <span>Stripe: <strong>{stripeStatus.configured ? "configured" : "not configured"}</strong></span>
            <span>Mode: <strong>{stripeStatus.mode || "unknown"}</strong></span>
            <span>App base URL: <strong>{integrationStatus.appBaseUrlConfigured ? "configured" : "not configured"}</strong></span>
          </div>
          {stripeMissingFields.length > 0 && (
            <p className="warning-note">Stripe missing fields: {formatMissingFields(stripeMissingFields)}</p>
          )}
          <div className="right-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => handleCopyValue(PREPARE_BACKEND_GUIDANCE, "Prepare instructions")}
            >
              Copy Prepare Instructions
            </button>
          </div>
        </section>}

        <section className="admin-section">
          <div className="admin-section-head">
            <h3>Customer Provisioning (Admin)</h3>
          </div>
          <p className="source-note">
            Create or update customer organizations directly in-app with order-based module entitlements.
          </p>
          {canProvisionCustomer && (
            <CustomerProvisioningAuthorityState
              state={provisioningCapabilityState}
              message={provisionState.phase === "uncertain" ? provisionState.error : ""}
              onReconcile={handleReconcileProvisioning}
              onReset={invalidateProvisioningHandoff}
            />
          )}
          {!canProvisionCustomer && (
            <p className="warning-note">Provisioning controls are restricted to admin users.</p>
          )}
          {canProvisionCustomer && (
            <>
              <fieldset
                className="provisioning-controls"
                disabled={provisionState.loading}
                aria-busy={provisionState.loading}
              >
                <div className="right-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      updateProvisionForm((prev) => ({
                        ...prev,
                        ownerEmail: normalizeEmail(currentUserEmail),
                        ownerUid: String(currentUserUid || "").trim()
                      }))}
                    disabled={provisionForm.updateExistingOrganization}
                  >
                    Use My Account
                  </button>
                </div>
                <p className="source-note">
                  Signed-in account: <strong>{normalizeEmail(currentUserEmail) || "-"}</strong> • UID:{" "}
                  <strong>{String(currentUserUid || "").trim() || "-"}</strong>
                </p>
                <label className="provisioning-existing-update">
                  <input
                    type="checkbox"
                    checked={provisionForm.updateExistingOrganization}
                    onChange={(event) => {
                      const updateExistingOrganization = event.target.checked;
                      const nextForm = createCustomerProvisioningForm(getCanonicalAppUrl());
                      updateProvisionForm({
                        ...nextForm,
                        appUrl: updateExistingOrganization ? "" : nextForm.appUrl,
                        updateExistingOrganization
                      });
                    }}
                  />
                  Update an existing organization (plan entitlements only)
                </label>
                {provisionForm.updateExistingOrganization && (
                  <p className="warning-note">
                    Requires an exact organization id. This does not change owner identity, branding, catalog data, or invites.
                  </p>
                )}
                {provisionState.error && <p className="error-note">{provisionState.error}</p>}
                <div className="admin-grid-settings integration-form-grid">
                <label>
                  Organization name
                  <input
                    type="text"
                    placeholder="Acme Events"
                    value={provisionForm.organizationName}
                    disabled={provisionForm.updateExistingOrganization}
                    onChange={(event) => updateProvisionForm((prev) => ({ ...prev, organizationName: event.target.value }))}
                  />
                </label>
                <label>
                  Organization id {provisionForm.updateExistingOrganization ? "(required)" : "(optional)"}
                  <input
                    type="text"
                    placeholder="acme-events"
                    value={provisionForm.organizationId}
                    onChange={(event) => updateProvisionForm((prev) => ({ ...prev, organizationId: event.target.value }))}
                  />
                </label>
                <label>
                  Plan
                  <select
                    value={provisionForm.plan}
                    onChange={(event) => updateProvisionForm((prev) => ({ ...prev, plan: event.target.value }))}
                  >
                    <option value="">Select a plan...</option>
                    {PROVISION_PLANS.map((plan) => (
                      <option key={plan} value={plan}>{plan}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Owner email
                  <input
                    type="email"
                    placeholder="owner@example.com"
                    value={provisionForm.ownerEmail}
                    disabled={provisionForm.updateExistingOrganization}
                    onChange={(event) => updateProvisionForm((prev) => ({ ...prev, ownerEmail: event.target.value }))}
                  />
                  <small className="source-note">
                    Enter the customer owner email. Your signed-in account is used only when you choose Use My Account.
                  </small>
                </label>
                <label>
                  Owner name (optional)
                  <input
                    type="text"
                    placeholder="Avery Owner"
                    value={provisionForm.ownerName}
                    disabled={provisionForm.updateExistingOrganization}
                    onChange={(event) => updateProvisionForm((prev) => ({ ...prev, ownerName: event.target.value }))}
                  />
                </label>
                <label>
                  Owner UID (optional; never defaults to your account)
                  <input
                    type="text"
                    placeholder="firebase-auth-uid"
                    value={provisionForm.ownerUid}
                    disabled={provisionForm.updateExistingOrganization}
                    onChange={(event) => updateProvisionForm((prev) => ({ ...prev, ownerUid: event.target.value }))}
                  />
                </label>
                <label>
                  Order id (auto-generated if blank)
                  <input
                    type="text"
                    placeholder="acme-order-2026-001"
                    value={provisionForm.orderId}
                    onChange={(event) => updateProvisionForm((prev) => ({ ...prev, orderId: event.target.value }))}
                  />
                </label>
                <label>
                  Support email (optional)
                  <input
                    type="email"
                    placeholder="support@example.com"
                    value={provisionForm.supportEmail}
                    disabled={provisionForm.updateExistingOrganization}
                    onChange={(event) => updateProvisionForm((prev) => ({ ...prev, supportEmail: event.target.value }))}
                  />
                </label>
                <label>
                  App URL
                  <input
                    type="url"
                    placeholder="https://your-live-domain.example"
                    value={provisionForm.appUrl}
                    disabled={provisionForm.updateExistingOrganization}
                    readOnly
                  />
                  <small className="source-note">Canonical owner sign-in URL from application configuration.</small>
                </label>
                <label className="provisioning-send-email">
                  <input
                    type="checkbox"
                    checked={provisionForm.sendEmail}
                    disabled={provisionForm.updateExistingOrganization}
                    onChange={(event) => updateProvisionForm((prev) => ({ ...prev, sendEmail: event.target.checked }))}
                  />
                  Send onboarding email now
                </label>
                </div>
                <div className="right-actions">
                  <button
                    type="button"
                    className="cta"
                    onClick={handleProvisionCustomer}
                    disabled={provisionState.loading}
                  >
                    {provisionState.phase === "checking"
                      ? "Checking Organization..."
                      : provisionState.phase === "provisioning"
                        ? "Provisioning..."
                        : provisionForm.updateExistingOrganization
                          ? "Update Entitlements"
                          : "Provision Customer"}
                  </button>
                </div>
              </fieldset>
              {provisioningResult.ok && (
                <>
                  {showingRecoveredProvisioningResult && (
                    <p className="source-note">
                      Most recent successful provisioning order from this browser session.
                    </p>
                  )}
                  <div className="status-strip">
                    <span>Operation: <strong>{updatedExistingOrganization ? "Entitlements updated" : "Organization created"}</strong></span>
                    <span>Organization: <strong>{provisioningResult.organizationId || "-"}</strong></span>
                    <span>Order: <strong>{provisioningResult.orderId || "-"}</strong></span>
                    <span>Plan: <strong>{provisioningResult.plan || "-"}</strong></span>
                    <span>Email: <strong>{provisioningEmailStatus}</strong></span>
                  </div>
                  {provisioningResult?.email?.error && (
                    <p className="warning-note">Onboarding email error: {provisioningResult.email.error}</p>
                  )}
                  {provisioningResult?.email?.warning && (
                    <p className="warning-note">{provisioningResult.email.warning}</p>
                  )}
                  {ownerClaimsIncomplete && (
                    <>
                      <p className="error-note">
                        Owner onboarding is incomplete: the role was saved, but Auth claims did not synchronize.
                        Do not hand off access until this repair succeeds.
                      </p>
                      <div className="right-actions">
                        <button
                          type="button"
                          className="cta"
                          onClick={handleRetryOwnerClaims}
                          disabled={provisionState.loading}
                        >
                          {provisionState.phase === "repairing-claims"
                            ? "Repairing Owner Access..."
                            : "Retry Owner Access Repair"}
                        </button>
                      </div>
                    </>
                  )}
                  {!ownerClaimsIncomplete && (
                    <div className="provisioning-next-steps">
                    <h4>Next steps</h4>
                    {updatedExistingOrganization ? (
                      <ol>
                        <li>Have an organization admin refresh the workspace and reopen Admin Catalog.</li>
                        <li>Verify included modules are editable and excluded modules remain locked.</li>
                        <li>Confirm existing owner access, branding, catalog data, and invites remain unchanged.</li>
                      </ol>
                    ) : (
                      <ol>
                        <li>
                          {provisioningResult?.email?.sent
                            ? `Confirm ${provisioningResult.ownerEmail || "the owner"} received the onboarding email.`
                            : `Copy and send the onboarding message to ${provisioningResult.ownerEmail || "the owner"}.`}
                        </li>
                        <li>Have the owner register or sign in with that exact email and confirm the organization name.</li>
                        <li>Configure branding and catalog data, then create, save, and reopen a test quote.</li>
                        <li>Configure and verify any customer-specific domain separately before sharing it.</li>
                      </ol>
                    )}
                    {provisioningOnboarding.emailText && !provisioningResult?.email?.sent && (
                      <>
                        <pre className="integration-command-block"><code>{`Subject: ${provisioningOnboarding.emailSubject || "Your QuotePilot workspace is ready"}\n\n${provisioningOnboarding.emailText}`}</code></pre>
                        <div className="right-actions">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() =>
                              handleCopyValue(
                                `Subject: ${provisioningOnboarding.emailSubject || "Your QuotePilot workspace is ready"}\n\n${provisioningOnboarding.emailText}`,
                                "Onboarding message"
                              )}
                          >
                            Copy Onboarding Message
                          </button>
                        </div>
                      </>
                    )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>

        {canManageProviders && <section className="admin-section">
          <div className="admin-section-head">
            <h3>Buyer Invoice Recovery (Platform Admin)</h3>
          </div>
          <p className="warning-note">
            This recovery is only for a terminal unpaid Stripe test Invoice. QuotePilot verifies the exact stored
            Invoice, voids an uncollectible Invoice at Stripe, rechecks that no workspace or invitation exists, and
            records an operator audit before a replacement can be requested.
          </p>
          {!canProvisionCustomer && (
            <p className="warning-note">Recovery controls require platform administrator authority.</p>
          )}
          {canProvisionCustomer && (
            <>
              {buyerRepairState.error && <p className="error-note">{buyerRepairState.error}</p>}
              <div className="admin-grid-settings integration-form-grid">
                <label>
                  Buyer test purchase reference
                  <input
                    type="text"
                    placeholder="ba-<40 hex characters>"
                    value={buyerRepairForm.orderId}
                    onChange={(event) => setBuyerRepairForm((prev) => ({
                      ...prev,
                      orderId: event.target.value,
                      confirmationToken: ""
                    }))}
                  />
                </label>
                <label>
                  Repair token
                  <input
                    type="text"
                    placeholder={buildBuyerAccessRepairConfirmationToken(buyerRepairForm.orderId)
                      || "VOID BUYER INVOICE ba-..."}
                    value={buyerRepairForm.confirmationToken}
                    onChange={(event) => setBuyerRepairForm((prev) => ({
                      ...prev,
                      confirmationToken: event.target.value
                    }))}
                  />
                </label>
              </div>
              <div className="right-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setBuyerRepairForm((prev) => ({
                    ...prev,
                    confirmationToken: buildBuyerAccessRepairConfirmationToken(prev.orderId)
                  }))}
                  disabled={!buildBuyerAccessRepairConfirmationToken(buyerRepairForm.orderId)}
                >
                  Fill Repair Token
                </button>
                <button
                  type="button"
                  className="cta"
                  onClick={handleRepairBuyerInvoice}
                  disabled={buyerRepairState.loading}
                >
                  {buyerRepairState.loading ? "Verifying Stripe..." : "Void and Release Test Invoice"}
                </button>
              </div>
              {buyerRepairState.result?.ok && (
                <div className="status-strip">
                  <span>Order: <strong>{buyerRepairState.result.orderId}</strong></span>
                  <span>Provider: <strong>{buyerRepairState.result.providerState}</strong></span>
                  <span>Provider void verified: <strong>{buyerRepairState.result.providerVoidVerified ? "yes" : "no"}</strong></span>
                  <span>24-hour email window: <strong>{buyerRepairState.result.emailWindowStillApplies ? "still applies" : "unknown"}</strong></span>
                  <span>Audit: <strong>{buyerRepairState.result.auditEventId}</strong></span>
                </div>
              )}
            </>
          )}
        </section>}

        {!provisioningOnly && canManageProviders && <section className="admin-section">
          <div className="admin-section-head">
            <h3>Organization Cleanup (Admin)</h3>
          </div>
          <p className="warning-note">
            Use archive first. Hard delete is permanent and removes the organization workspace data.
          </p>
          <p className="source-note">
            Permanent quote deletion is available one quote at a time in Quote History and requires an exact approved deletion request.
          </p>
          {!canProvisionCustomer && (
            <p className="warning-note">Cleanup controls are restricted to admin users.</p>
          )}
          {canProvisionCustomer && (
            <>
              {cleanupState.error && <p className="error-note">{cleanupState.error}</p>}
              <div className="admin-grid-settings integration-form-grid">
                <label>
                  Target organization id
                  <input
                    type="text"
                    placeholder="queentrinis"
                    value={cleanupForm.organizationId}
                    onChange={(event) =>
                      setCleanupForm((prev) => ({
                        ...prev,
                        organizationId: event.target.value
                      }))}
                  />
                </label>
                <label>
                  Archive token
                  <input
                    type="text"
                    placeholder={`ARCHIVE ${normalizeOrganizationSlug(cleanupForm.organizationId) || "<org-id>"}`}
                    value={cleanupForm.archiveToken}
                    onChange={(event) =>
                      setCleanupForm((prev) => ({
                        ...prev,
                        archiveToken: event.target.value
                      }))}
                  />
                </label>
                <label>
                  Delete token
                  <input
                    type="text"
                    placeholder={`DELETE ${normalizeOrganizationSlug(cleanupForm.organizationId) || "<org-id>"}`}
                    value={cleanupForm.deleteToken}
                    onChange={(event) =>
                      setCleanupForm((prev) => ({
                        ...prev,
                        deleteToken: event.target.value
                      }))}
                  />
                </label>
              </div>
              <div className="right-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setCleanupForm((prev) => ({
                      ...prev,
                      archiveToken: buildArchiveToken(prev.organizationId)
                    }))}
                >
                  Fill Archive Token
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setCleanupForm((prev) => ({
                      ...prev,
                      deleteToken: buildDeleteToken(prev.organizationId)
                    }))}
                >
                  Fill Delete Token
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={handleArchiveOrganization}
                  disabled={cleanupState.loading}
                >
                  {cleanupState.loading ? "Working..." : "Archive Organization"}
                </button>
                <button
                  type="button"
                  className="cta"
                  onClick={handleDeleteOrganization}
                  disabled={cleanupState.loading}
                >
                  {cleanupState.loading ? "Working..." : "Hard Delete Organization"}
                </button>
              </div>
              {cleanupState.result?.ok && (
                <div className="status-strip">
                  <span>Action: <strong>{cleanupState.result.action || "-"}</strong></span>
                  <span>Organization: <strong>{cleanupState.result.organizationId || "-"}</strong></span>
                  <span>Timestamp: <strong>{cleanupState.result.completedAtISO || "-"}</strong></span>
                </div>
              )}
            </>
          )}
        </section>}

        {!provisioningOnly && canManageProviders && <section className="admin-section">
          <div className="admin-section-head">
            <h3>Record Integration Event</h3>
          </div>
          <p className="source-note">
            Outbound browser CRM sends are disabled. Use this admin-only form
            for audit events until a server-authorized CRM connector is enabled.
          </p>
          <div className="admin-grid-settings integration-form-grid">
            <div data-choice-field="integration-audit-quote">
              <AdaptiveChoiceField
                label="Quote"
                options={integrationQuoteOptions}
                value={form.quoteId}
                onChange={(event) => setForm((prev) => ({ ...prev, quoteId: event.target.value }))}
                disabled={state.loading}
                placeholder="Select quote"
                emptyState="unavailable"
                emptyReason={form.quoteId && !selectedIntegrationQuotePresent
                  ? `The previously selected quote ${form.quoteId} is not in the current integration read.`
                  : state.loading
                    ? "The integration quote read is still loading."
                    : "No quote is available to receive an integration audit event."}
                recoveryAction={{ label: "Reload quotes", onClick: load }}
                singleChoiceDetail="This is the only quote available for an integration audit event."
                fieldState={form.quoteId && !selectedIntegrationQuotePresent
                  ? { evidence: "stale" }
                  : undefined}
                fieldStateDetails={form.quoteId && !selectedIntegrationQuotePresent
                  ? {
                      reason: "The selected quote is not present in the current integration read.",
                      recoveryAction: { label: "Reload quotes", onClick: load }
                    }
                  : undefined}
              />
            </div>
            <label>
              Provider
              <select
                value={form.provider}
                onChange={(event) => setForm((prev) => ({ ...prev, provider: event.target.value }))}
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>{provider}</option>
                ))}
              </select>
            </label>
            <label>
              State
              <select
                value={form.state}
                onChange={(event) => setForm((prev) => ({ ...prev, state: event.target.value }))}
              >
                {STATES.map((syncState) => (
                  <option key={syncState} value={syncState}>{syncState}</option>
                ))}
              </select>
            </label>
            <label>
              Direction
              <select
                value={form.direction}
                onChange={(event) => setForm((prev) => ({ ...prev, direction: event.target.value }))}
              >
                {DIRECTIONS.map((direction) => (
                  <option key={direction} value={direction}>{direction}</option>
                ))}
              </select>
            </label>
            <label>
              Attempt
              <input
                type="number"
                min="1"
                max={Math.max(1, Number(settings.integrationRetryLimit || 3))}
                value={form.attempt}
                onChange={(event) => setForm((prev) => ({ ...prev, attempt: Math.max(1, Number(event.target.value || 1)) }))}
              />
            </label>
            <label>
              Payload reference
              <input
                type="text"
                placeholder="invoice-1234 / webhook-id"
                value={form.payloadRef}
                onChange={(event) => setForm((prev) => ({ ...prev, payloadRef: event.target.value }))}
              />
            </label>
            <label className="integration-message-field">
              Message
              <input
                type="text"
                placeholder="Sync queued, API timeout, or success notes"
                value={form.message}
                onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
              />
            </label>
          </div>
          {selectedQuote && (
            <p className="source-note">
              Selected quote: {selectedQuote.quoteNumber || selectedQuote.id} • {selectedQuote.customer?.name || selectedQuote.customer?.email || "-"}
            </p>
          )}
          <div className="right-actions">
            <button type="button" className="cta" onClick={handleRecord} disabled={saving || state.loading}>
              {saving ? "Recording..." : "Record Event"}
            </button>
          </div>
        </section>}

        {!provisioningOnly && <section className="admin-section">
          <div className="admin-section-head">
            <h3>Integration Activity</h3>
          </div>
          <div className="integration-filters">
            <input
              type="text"
              placeholder="Search quote, customer, message"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
              <option value="all">All providers</option>
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
            <select value={syncStateFilter} onChange={(event) => setSyncStateFilter(event.target.value)}>
              <option value="all">All states</option>
              {STATES.map((syncState) => (
                <option key={syncState} value={syncState}>{syncState}</option>
              ))}
            </select>
          </div>
          <div className="history-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Provider</th>
                  <th>State</th>
                  <th>Quote</th>
                  <th>Event</th>
                  <th>Total</th>
                  <th>Message</th>
                  <th>Attempt</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {!state.loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan="9">No integration events found.</td>
                  </tr>
                )}
                {filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.occurredAtISO)}</td>
                    <td>{row.provider}</td>
                    <td>{row.state}</td>
                    <td>{row.quoteNumber}</td>
                    <td>{row.customer} • {row.eventDate}</td>
                    <td>{currency(row.total)}</td>
                    <td>{row.message || row.payloadRef || "-"}</td>
                    <td>{row.attempt}</td>
                    <td>{row.actorEmail || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>}
      </div>
    </div>
  );
}

export default function IntegrationOpsModal(props) {
  return <IntegrationOpsView {...props} presentation="modal" />;
}
