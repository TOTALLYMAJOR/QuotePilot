import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildBuyerAccessRepairConfirmationToken,
  getIntegrationSetupStatus,
  repairBuyerAccessInvoice,
  getOperationsAuditSnapshot,
  sendIntegrationTestSms
} from "../lib/commerceOps";
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
import {
  getQuoteHistory,
  purgeDeletedQuotesForOrganization,
  recordQuoteIntegrationSync
} from "../lib/quoteStore";

const PROVIDERS = ["crm", "webhook", "webhook_bridge", "hubspot", "salesforce"];
const STATES = ["queued", "success", "error", "retrying", "skipped"];
const DIRECTIONS = ["push", "pull"];
const PROVISION_PLANS = ["starter", "growth", "enterprise"];
const FUNCTIONS_ENV_SETUP_GUIDANCE = [
  "For local validation of the production deploy configuration only, keep non-secret configuration in the ignored functions/.env.tonicatering file (mode 0600):",
  "NOTIFICATIONS_SMS_PROVIDER=twilio",
  "TWILIO_ACCOUNT_SID=",
  "TWILIO_AUTH_TOKEN=",
  "TWILIO_FROM_NUMBER=",
  "NOTIFICATIONS_OWNER_PHONE=",
  "STRIPE_MODE=live",
  "",
  "Validate the production dotenv payload without rewriting:",
  "FIREBASE_PROJECT_ID=tonicatering node --env-file=functions/.env.tonicatering scripts/materialize-functions-env.mjs --validate-only",
  "The production materializer rejects Resend and Stripe secret values. Do not use it for emulator setup: disposable emulator configuration must use STRIPE_MODE=test, with expendable RESEND_API_KEY, STRIPE_SECRET_KEY, and STRIPE_WEBHOOK_SECRET fixtures only in the separately ignored functions/.secret.local file.",
  "Never upload either file or use production credentials locally; production provider credentials belong only in Firebase Secret Manager bindings."
].join("\n");
const SMS_DISABLE_GUIDANCE = [
  "Keep NOTIFICATIONS_SMS_PROVIDER=none in the trusted runtime configuration",
  "until an authorized backend promotion includes approved buyer-owned Twilio credentials."
].join(" ");
const PREPARE_BACKEND_GUIDANCE = [
  "GitHub Actions -> Prepare Firebase Production Artifact",
  "firebase_scope=backend (Firestore rules + Functions)",
  "Use the matching firebase-backend UAT and exact release evidence inputs.",
  "This stages a provider-mutation-credential-free payload with a deterministic manifest; it does not change runtime configuration or deploy.",
  "Promotion remains blocked until the separately owned trusted deployer is implemented and qualified."
].join("\n");

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

function describeSmsOutcome(sms) {
  if (sms?.sent) return "Twilio accepted the test SMS request; delivery is not yet proven.";
  const reason = String(sms?.reason || "").trim();
  if (reason === "sms_not_configured") return "SMS is not configured in the current runtime. Production values require an authorized backend promotion through the trusted runtime channel.";
  if (reason === "sms_disabled") return "SMS is intentionally disabled (NOTIFICATIONS_SMS_PROVIDER=none).";
  if (reason === "sms_provider_unsupported") return "Configured SMS provider is unsupported in this build.";
  if (reason === "sms_send_failed") return `SMS send failed${sms?.message ? `: ${sms.message}` : "."}`;
  return "SMS test did not send.";
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

export default function IntegrationOpsModal({
  open,
  onClose,
  organizationId = "",
  settings = {},
  currentUserEmail = "",
  currentUserUid = "",
  canProvisionCustomer = false,
  canManageProviders = false,
  provisioningOnly = false
}) {
  const defaultProvider = toProvider(settings.crmProvider || "crm");
  const [state, setState] = useState({
    loading: false,
    error: "",
    source: "",
    quotes: []
  });
  const [auditState, setAuditState] = useState({ loading: false, error: "", snapshot: null });
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [syncStateFilter, setSyncStateFilter] = useState("all");
  const [saving, setSaving] = useState(false);
  const [setupState, setSetupState] = useState({
    loading: false,
    testing: false,
    error: "",
    resultMessage: "",
    status: null,
    testMessage: ""
  });
  const [provisionState, setProvisionState] = useState({
    loading: false,
    phase: "",
    error: "",
    result: null
  });
  const [lastProvisioningResult, setLastProvisioningResult] = useState(null);
  const [provisionForm, setProvisionForm] = useState(
    () => createCustomerProvisioningForm(getCanonicalAppUrl())
  );
  const wasOpenRef = useRef(false);
  const [cleanupState, setCleanupState] = useState({
    loading: false,
    error: "",
    result: null
  });
  const [purgingDeletedQuotes, setPurgingDeletedQuotes] = useState(false);
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
    if (canManageProviders) setAuditState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [result, auditResult] = await Promise.all([
        getQuoteHistory({ organizationId }),
        canManageProviders
          ? getOperationsAuditSnapshot({ organizationId })
            .then((snapshot) => ({ snapshot, error: "" }))
            .catch((err) => ({ snapshot: null, error: err?.message || "Operations audit is unavailable." }))
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
        setAuditState({ loading: false, error: auditResult.error, snapshot: auditResult.snapshot });
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "Failed to load integration data."
      }));
      if (canManageProviders) {
        setAuditState((prev) => ({ ...prev, loading: false }));
      }
    }
  };

  const refreshSetupStatus = async () => {
    if (!canManageProviders) return;
    setSetupState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const result = await getIntegrationSetupStatus();
      const status = result?.status || null;
      setSetupState((prev) => ({
        ...prev,
        loading: false,
        error: "",
        status
      }));
    } catch (err) {
      setSetupState((prev) => ({
        ...prev,
        loading: false,
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
    setSetupState((prev) => ({
      ...prev,
      testing: true,
      error: "",
      resultMessage: ""
    }));
    try {
      const result = await sendIntegrationTestSms({
        message: setupState.testMessage
      });
      const sms = result?.sms || {};
      setSetupState((prev) => ({
        ...prev,
        testing: false,
        status: result?.status || prev.status,
        resultMessage: describeSmsOutcome(sms)
      }));
    } catch (err) {
      setSetupState((prev) => ({
        ...prev,
        testing: false,
        error: err?.message || "Failed to send integration SMS test."
      }));
    }
  };

  const handleProvisionCustomer = async () => {
    if (!canProvisionCustomer) {
      setProvisionState((prev) => ({ ...prev, error: "Admin role is required for customer provisioning." }));
      return;
    }

    const payload = buildCustomerProvisioningPayload(provisionForm, getCanonicalAppUrl());
    const validationError = validateCustomerProvisioningPayload(payload);
    if (validationError) {
      setProvisionState((prev) => ({ ...prev, error: validationError }));
      return;
    }
    payload.orderId = ensureCustomerProvisioningOrderId(payload.orderId);
    setProvisionForm((prev) => (
      prev.orderId === payload.orderId
        ? prev
        : { ...prev, orderId: payload.orderId }
    ));

    setProvisionState({ loading: true, phase: "checking", error: "", result: null });
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
          setFeedback(
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
            result: null
          });
          return;
        }
      }
      if (preflight.unsafeResidue) {
        setProvisionState({
          loading: false,
          phase: "",
          error: `Organization id "${preflight.organizationId || payload.organizationId}" has retired or orphaned state and cannot be provisioned automatically. No changes were made.`,
          result: null
        });
        return;
      }
      if (preflight.exists && !payload.updateExistingOrganization && !preflight.canResume) {
        setProvisionState({
          loading: false,
          phase: "",
          error: `Organization "${preflight.organizationId || payload.organizationId || payload.organizationName}" already exists. No changes were made. Use an explicit tenant update workflow instead.`,
          result: null
        });
        return;
      }
      if (!preflight.exists && payload.updateExistingOrganization) {
        setProvisionState({
          loading: false,
          phase: "",
          error: `Organization "${preflight.organizationId || payload.organizationId}" does not exist. No changes were made.`,
          result: null
        });
        return;
      }
      if (payload.updateExistingOrganization && !preflight.canUpdate && !preflight.canResume) {
        setProvisionState({
          loading: false,
          phase: "",
          error: `Organization "${preflight.organizationId || payload.organizationId}" cannot be updated safely. No changes were made.`,
          result: null
        });
        return;
      }
      if (preflight.organizationId) {
        payload.organizationId = preflight.organizationId;
      }
    } catch (err) {
      setProvisionState({
        loading: false,
        phase: "",
        error: err?.message || "Failed to check the organization before provisioning.",
        result: null
      });
      return;
    }

    const confirmed = window.confirm(
      buildCustomerProvisioningConfirmationMessage(payload, completedPreflight)
    );
    if (!confirmed) {
      setProvisionState({ loading: false, phase: "", error: "", result: null });
      return;
    }

    setProvisionState({ loading: true, phase: "provisioning", error: "", result: null });
    try {
      const result = await provisionCustomerOrder(payload);
      if (!result?.ok) {
        throw new Error("Provisioning failed.");
      }
      setProvisionState({
        loading: false,
        phase: "",
        error: "",
        result
      });
      setLastProvisioningResult(result);
      writeLastProvisioningResult(currentUserUid, result);
      setProvisionForm(createCustomerProvisioningForm(getCanonicalAppUrl()));
      setFeedback(result.operation === "updated_entitlements"
        ? `Updated plan entitlements for ${result.organizationName || result.organizationId || "organization"}.`
        : `Provisioned ${result.organizationName || payload.organizationName} (${result.organizationId || "n/a"}).`);
    } catch (err) {
      setProvisionState({
        loading: false,
        phase: "",
        error: err?.message || "Failed to provision customer order.",
        result: null
      });
    }
  };

  const invalidateProvisioningHandoff = () => {
    setProvisionState((prev) => ({
      ...prev,
      error: "",
      result: null
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

  const handlePurgeDeletedQuotes = async () => {
    if (!canProvisionCustomer) {
      setCleanupState((prev) => ({ ...prev, error: "Admin role is required for quote cleanup." }));
      return;
    }

    const targetOrganizationId = normalizeOrganizationSlug(cleanupForm.organizationId);
    if (!targetOrganizationId) {
      setCleanupState((prev) => ({ ...prev, error: "Target organization id is required." }));
      return;
    }

    const confirmed = window.confirm(
      `Permanently purge legacy deleted quotes for "${targetOrganizationId}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setPurgingDeletedQuotes(true);
    setCleanupState((prev) => ({ ...prev, error: "" }));
    setFeedback("");
    try {
      const result = await purgeDeletedQuotesForOrganization({
        organizationId: targetOrganizationId,
        limit: 300
      });
      if (!result?.ok) {
        throw new Error("Purge operation failed.");
      }
      const deletedQuotes = Math.max(0, Number(result.deletedQuotes || 0));
      const hasMore = result.hasMore === true;
      setCleanupState((prev) => ({
        ...prev,
        result: {
          ...(result || {}),
          action: "purge-deleted-quotes"
        }
      }));
      setFeedback(
        hasMore
          ? `Purged ${deletedQuotes} deleted quote(s). More may remain; run purge again.`
          : `Purged ${deletedQuotes} deleted quote(s).`
      );
      await load();
    } catch (err) {
      setCleanupState((prev) => ({
        ...prev,
        error: err?.message || "Failed to purge deleted quotes.",
        result: null
      }));
    } finally {
      setPurgingDeletedQuotes(false);
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
    if (!provisioningOnly) {
      setCleanupState({
        loading: false,
        error: "",
        result: null
      });
      setPurgingDeletedQuotes(false);
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

  const providerEndpoints = useMemo(() => ([
    { id: "webhook", label: "Webhook URL", value: String(settings.crmWebhookUrl || "").trim() },
    { id: "webhook_bridge", label: "Webhook bridge URL", value: String(settings.crmWebhookBridgeUrl || "").trim() },
    { id: "hubspot", label: "HubSpot bridge URL", value: String(settings.crmHubspotBridgeUrl || "").trim() },
    { id: "salesforce", label: "Salesforce bridge URL", value: String(settings.crmSalesforceBridgeUrl || "").trim() }
  ]), [settings.crmWebhookUrl, settings.crmWebhookBridgeUrl, settings.crmHubspotBridgeUrl, settings.crmSalesforceBridgeUrl]);

  const integrationStatus = setupState.status || {};
  const twilioStatus = integrationStatus.twilio || {};
  const stripeStatus = integrationStatus.stripe || {};
  const twilioMissingFields = Array.isArray(twilioStatus.missingFields) ? twilioStatus.missingFields : [];
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

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card integration-card">
        <div className="modal-head">
          <h2>{provisioningOnly ? "Customer Provisioning" : "Integrations Ops"}</h2>
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
            <button type="button" className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>

        {!provisioningOnly && <p className="source-note">Source: {state.source || "-"}</p>}
        {state.error && <p className="error-note">{state.error}</p>}
        {feedback && <p className="source-note">{feedback}</p>}

        {!provisioningOnly && canManageProviders && <section className="admin-section operations-audit-panel">
          <div className="admin-section-head">
            <div>
              <h3>Operations Audit</h3>
              <p className="source-note">Server-derived delivery health, recorded sync trend, and role-stamped sensitive actions.</p>
            </div>
            {auditState.loading && <span>Loading...</span>}
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
              </div>
              <div className="status-strip" aria-label="Seven-day integration health trend">
                {(auditState.snapshot.sync?.trend || []).map((row) => (
                  <span key={row.day}>{row.day.slice(5)}: {row.success} ok / {row.error} error</span>
                ))}
              </div>
              <div className="history-table-wrap">
                <table>
                  <thead><tr><th>When</th><th>Action</th><th>State</th><th>Quote</th><th>Actor role</th><th>Actor</th><th>Authority</th></tr></thead>
                  <tbody>
                    {(auditState.snapshot.actions || []).map((row) => (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.occurredAtISO)}</td>
                        <td>{row.action}</td>
                        <td>{row.state || "-"}</td>
                        <td>{row.quoteNumber || row.quoteId || "-"}</td>
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
                Retry counts are operational candidates, not proof that a resend occurred. Recorded sync events are operator audit entries until a server connector is enabled.
              </p>
            </>
          )}
        </section>}

        {!provisioningOnly && canManageProviders && <section className="admin-section">
          <div className="admin-section-head">
            <h3>Provider Config</h3>
          </div>
          <div className="status-strip">
            <span>
              CRM: <strong>{settings.crmEnabled ? "enabled" : "disabled"}</strong>
            </span>
            <span>Provider: <strong>{settings.crmProvider || "webhook"}</strong></span>
            <span>CRM module: <strong>{settings.featureFlags?.crmSync === false ? "disabled" : "enabled"}</strong></span>
            <span>Retry limit: <strong>{Math.max(1, Number(settings.integrationRetryLimit || 3))}</strong></span>
            <span>Audit retention: <strong>{Math.max(10, Number(settings.integrationAuditRetention || 50))}</strong></span>
          </div>
          <div className="admin-grid-settings integration-form-grid">
            {providerEndpoints.map((endpoint) => (
              <label key={endpoint.id}>
                {endpoint.label}
                <input type="text" readOnly value={endpoint.value || "Not configured"} />
              </label>
            ))}
          </div>
        </section>}

        {!provisioningOnly && canManageProviders && <section className="admin-section">
          <div className="admin-section-head">
            <h3>Buyer Setup Assistant (Optional Twilio)</h3>
          </div>
          <p className="source-note">
            Core quote + portal workflows continue without Twilio. SMS can be enabled only after the trusted backend
            promotion path exists, the sender is registered and provider-accepted, and buyer-owned credentials are supplied through its runtime secret channel. Production promotion is currently blocked until that separately owned trusted deployer is implemented and qualified.
          </p>
          {setupState.error && <p className="error-note">{setupState.error}</p>}
          {setupState.resultMessage && <p className="source-note">{setupState.resultMessage}</p>}
          <div className="status-strip">
            <span>SMS provider: <strong>{integrationStatus.smsProvider || "unknown"}</strong></span>
            <span>Twilio: <strong>{twilioStatus.configured ? "configured" : "not configured"}</strong></span>
            <span>SMS test configured: <strong>{twilioStatus.canSend ? "yes" : "no"}</strong></span>
            <span>Stripe: <strong>{stripeStatus.configured ? "configured" : "not configured"}</strong></span>
            <span>App base URL: <strong>{integrationStatus.appBaseUrlConfigured ? "configured" : "not configured"}</strong></span>
          </div>
          {twilioMissingFields.length > 0 && (
            <p className="warning-note">Twilio missing fields: {formatMissingFields(twilioMissingFields)}</p>
          )}
          {stripeMissingFields.length > 0 && (
            <p className="warning-note">Stripe missing fields: {formatMissingFields(stripeMissingFields)}</p>
          )}
          <div className="admin-grid-settings integration-form-grid">
            <label className="integration-message-field">
              Test SMS message (optional)
              <input
                type="text"
                placeholder="Connectivity test for buyer setup"
                value={setupState.testMessage}
                onChange={(event) => setSetupState((prev) => ({ ...prev, testMessage: event.target.value }))}
              />
            </label>
          </div>
          <p className="source-note">
            Provider secrets belong in the trusted deployment/runtime secret channel, never in this browser, local validation file, or release artifact. This status reflects the current runtime; editing a local file does not change production.
          </p>
          <pre className="integration-command-block"><code>{FUNCTIONS_ENV_SETUP_GUIDANCE}</code></pre>
          <div className="right-actions">
            <button type="button" className="ghost" onClick={() => handleCopyValue(FUNCTIONS_ENV_SETUP_GUIDANCE, "Setup guidance")}>
              Copy Setup Guidance
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => handleCopyValue(SMS_DISABLE_GUIDANCE, "SMS disable guidance")}
            >
              Copy SMS Disable Guidance
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => handleCopyValue(PREPARE_BACKEND_GUIDANCE, "Prepare instructions")}
            >
              Copy Prepare Instructions
            </button>
            <button
              type="button"
              className="cta"
              onClick={handleSendTestSms}
              disabled={setupState.testing || !twilioStatus.canSend}
            >
              {setupState.testing ? "Sending Test..." : "Send Test SMS"}
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
                  onClick={handlePurgeDeletedQuotes}
                  disabled={cleanupState.loading || purgingDeletedQuotes}
                >
                  {purgingDeletedQuotes ? "Purging..." : "Purge Deleted Quotes"}
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
            <label>
              Quote
              <select
                value={form.quoteId}
                onChange={(event) => setForm((prev) => ({ ...prev, quoteId: event.target.value }))}
              >
                <option value="">Select quote</option>
                {state.quotes.map((quote) => (
                  <option key={quote.id} value={quote.id}>
                    {quote.quoteNumber || quote.id} • {quote.customer?.name || quote.customer?.email || "-"} • {quote.event?.date || "-"}
                  </option>
                ))}
              </select>
            </label>
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
