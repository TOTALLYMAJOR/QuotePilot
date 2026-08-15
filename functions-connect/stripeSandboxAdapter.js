"use strict";

const {
  canonicalJson,
  sha256,
  StripeConnectInterfaceError
} = require("./interfaceContracts");
const {
  STRIPE_CONNECT_API_VERSION,
  STRIPE_CONNECT_SDK_VERSION
} = require("./runtimePolicy");
const {
  REVIEWED_CONFIGURATION,
  REVIEWED_CONFIGURATION_DIGEST,
  SANDBOX_PROVIDER_MODE
} = require("./providerModel");

const STRIPE_ACCOUNT_PATTERN = /^acct_[A-Za-z0-9]{8,255}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const RFC3339_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

class StripeSandboxAccountQuarantineError extends StripeConnectInterfaceError {
  constructor(message, privateProviderEvidence) {
    super("failed-precondition", message);
    this.name = "StripeSandboxAccountQuarantineError";
    Object.defineProperty(this, "privateProviderEvidence", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({ ...privateProviderEvidence })
    });
  }
}

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function text(value, max = 4096) {
  return String(value || "").trim().slice(0, max);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid-argument", `${label} is invalid.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-argument", `${label} contains unsupported fields.`);
  }
}

function requireHttpsUrl(value, label) {
  const url = new URL(text(value, 2048));
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    fail("invalid-argument", `${label} is invalid.`);
  }
  return url.toString();
}

function requireSandboxAccount(account = {}, expectedAccountId = "") {
  const id = text(account.id, 255);
  if (
    account.object !== "v2.core.account"
    || !STRIPE_ACCOUNT_PATTERN.test(id)
    || (expectedAccountId && id !== expectedAccountId)
    || account.livemode !== false
  ) {
    fail("failed-precondition", "Stripe returned an account outside the reviewed Sandbox binding.");
  }
  return id;
}

function privateProviderEvidence(account = {}, {
  platformAccountBinding,
  reviewReason
} = {}) {
  const privateAccountId = text(account.id, 255);
  if (!STRIPE_ACCOUNT_PATTERN.test(privateAccountId)) return null;
  const providerMode = account.livemode === false
    ? SANDBOX_PROVIDER_MODE
    : account.livemode === true
      ? "live"
      : "unknown";
  const safeReason = text(reviewReason, 64).toLowerCase();
  return Object.freeze({
    privateAccountId,
    providerMode,
    platformAccountBinding,
    configurationDigest: REVIEWED_CONFIGURATION_DIGEST,
    providerResponseDigest: sha256(canonicalJson({
      schemaVersion: 1,
      privateAccountId,
      object: text(account.object, 64),
      providerMode,
      dashboard: text(account.dashboard, 32).toLowerCase(),
      reviewedConfiguration: hasReviewedConfiguration(account),
      reviewReason: safeReason
    })),
    reviewReason: safeReason
  });
}

function quarantineReturnedAccount(account, options) {
  const evidence = privateProviderEvidence(account, options);
  if (!evidence) {
    fail("failed-precondition", "Stripe returned an account without a usable private identity.");
  }
  throw new StripeSandboxAccountQuarantineError(
    "Stripe created an account that requires private security review.",
    evidence
  );
}

function responsibilityState(account = {}) {
  const responsibilities = account.defaults?.responsibilities || {};
  return responsibilities.fees_collector === REVIEWED_CONFIGURATION.feesCollector
    && responsibilities.losses_collector === REVIEWED_CONFIGURATION.lossesCollector
    && responsibilities.requirements_collector === REVIEWED_CONFIGURATION.requirementsCollector
    ? "confirmed"
    : "mismatch";
}

function isValidRfc3339Timestamp(value) {
  if (typeof value !== "string" || value !== value.trim() || value.length > 64) return false;
  const match = RFC3339_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const [zoneHour, zoneMinute] = zone === "Z"
    ? [0, 0]
    : zone.slice(1).split(":").map(Number);
  return year >= 1
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= monthDays[month - 1]
    && hour <= 23
    && minute <= 59
    && second <= 59
    && zoneHour <= 23
    && zoneMinute <= 59
    && Number.isFinite(Date.parse(value));
}

function hasReviewedConfiguration(account = {}) {
  return account.dashboard === REVIEWED_CONFIGURATION.dashboard
    && String(account.defaults?.currency || "").toLowerCase() === REVIEWED_CONFIGURATION.currency
    && Array.isArray(account.applied_configurations)
    && account.applied_configurations.includes("merchant")
    && isValidRfc3339Timestamp(account.configuration?.merchant?.applied)
    && responsibilityState(account) === "confirmed";
}

function projectAccountObservation(account = {}) {
  requireSandboxAccount(account);
  const requirements = Array.isArray(account.requirements?.entries) ? account.requirements.entries : [];
  const userRequirements = requirements.filter((entry) => entry?.awaiting_action_from === "user");
  const pastDueCount = userRequirements.filter(
    (entry) => entry?.minimum_deadline?.status === "past_due"
  ).length;
  const cardPaymentsState = text(
    account.configuration?.merchant?.capabilities?.card_payments?.status,
    32
  ).toLowerCase() || "unknown";
  const payoutsState = text(
    account.configuration?.merchant?.capabilities?.stripe_balance?.payouts?.status,
    32
  ).toLowerCase() || "unknown";
  const reviewed = hasReviewedConfiguration(account);
  let connectionState = "pending_review";
  let healthState = "attention";
  let requirementState = pastDueCount > 0 ? "past_due" : userRequirements.length > 0 ? "due" : "clear";

  if (account.closed === true) {
    connectionState = "closed";
    healthState = "unavailable";
    requirementState = "unavailable";
  } else if (!reviewed) {
    connectionState = "security_review";
    healthState = "unavailable";
  } else if (cardPaymentsState === "active" && payoutsState === "active" && userRequirements.length === 0) {
    connectionState = "ready";
    healthState = "healthy";
  } else if (
    [cardPaymentsState, payoutsState].some((state) => ["restricted", "unsupported"].includes(state))
    || pastDueCount > 0
  ) {
    connectionState = "attention_required";
  }

  const projection = Object.freeze({
    connectionState,
    requirementState,
    currentlyDueCount: userRequirements.length,
    pastDueCount,
    healthState,
    cardPaymentsState,
    payoutsState,
    responsibilityState: reviewed ? "confirmed" : "mismatch"
  });
  return Object.freeze({
    ...projection,
    observationDigest: sha256(canonicalJson({
      schemaVersion: 1,
      accountId: account.id,
      closed: account.closed === true,
      projection
    }))
  });
}

function createStripeSandboxAdapter({
  stripeClient,
  apiVersion,
  sdkVersion,
  providerMode,
  platformAccountBinding,
  canonicalReturnOrigin
} = {}) {
  if (apiVersion !== STRIPE_CONNECT_API_VERSION || sdkVersion !== STRIPE_CONNECT_SDK_VERSION) {
    fail("failed-precondition", "The Stripe Sandbox adapter version binding is invalid.");
  }
  if (providerMode !== SANDBOX_PROVIDER_MODE) {
    fail("failed-precondition", "The Connect adapter is restricted to Stripe Sandbox.");
  }
  if (!STRIPE_ACCOUNT_PATTERN.test(text(platformAccountBinding, 255))) {
    fail("failed-precondition", "The Stripe Sandbox platform binding is unavailable.");
  }
  const returnOrigin = new URL(text(canonicalReturnOrigin, 2048));
  if (returnOrigin.protocol !== "https:" || returnOrigin.origin !== canonicalReturnOrigin) {
    fail("failed-precondition", "The Stripe onboarding return origin is invalid.");
  }
  const accounts = stripeClient?.v2?.core?.accounts;
  const accountLinks = stripeClient?.v2?.core?.accountLinks;
  const platformAccounts = stripeClient?.accounts;
  const balance = stripeClient?.balance;
  if (
    !accounts
    || typeof accounts.create !== "function"
    || typeof accounts.retrieve !== "function"
    || !accountLinks
    || typeof accountLinks.create !== "function"
    || !platformAccounts
    || typeof platformAccounts.retrieve !== "function"
    || !balance
    || typeof balance.retrieve !== "function"
  ) {
    fail("internal", "The Stripe Sandbox client or platform preflight API is unavailable.");
  }

  async function preflightProviderBinding() {
    try {
      const [platformAccount, platformBalance] = await Promise.all([
        platformAccounts.retrieve(platformAccountBinding),
        balance.retrieve()
      ]);
      if (
        platformAccount?.object !== "account"
        || platformAccount.id !== platformAccountBinding
        || platformBalance?.object !== "balance"
        || platformBalance.livemode !== false
      ) {
        fail("failed-precondition", "The Stripe credential does not match the reviewed Sandbox platform binding.");
      }
      return Object.freeze({
        platformAccountBinding,
        providerMode: SANDBOX_PROVIDER_MODE,
        preflightDigest: sha256(canonicalJson({
          schemaVersion: 1,
          platformAccountBinding,
          providerMode: SANDBOX_PROVIDER_MODE,
          accountObject: platformAccount.object,
          balanceObject: platformBalance.object,
          livemode: platformBalance.livemode
        }))
      });
    } catch (error) {
      if (error instanceof StripeConnectInterfaceError) throw error;
      fail("unavailable", "The Stripe Sandbox platform binding could not be verified.");
    }
  }

  function assertPrivateBinding(privateAccountBinding = {}) {
    exactKeys(
      privateAccountBinding,
      ["bindingId", "configurationDigest", "generation", "platformAccountBinding", "privateAccountId", "providerMode"],
      "private account binding"
    );
    if (
      !STRIPE_ACCOUNT_PATTERN.test(text(privateAccountBinding.privateAccountId, 255))
      || privateAccountBinding.providerMode !== SANDBOX_PROVIDER_MODE
      || privateAccountBinding.platformAccountBinding !== platformAccountBinding
      || privateAccountBinding.configurationDigest !== REVIEWED_CONFIGURATION_DIGEST
      || !Number.isSafeInteger(Number(privateAccountBinding.generation))
      || Number(privateAccountBinding.generation) < 1
    ) {
      fail("failed-precondition", "The private Stripe account binding does not match this Sandbox adapter.");
    }
    return privateAccountBinding;
  }

  async function createMerchantAccount(input = {}) {
    exactKeys(
      input,
      ["capabilities", "contactEmail", "country", "currency", "dashboard", "feesCollector", "idempotencyKey", "lossesCollector"],
      "merchant account request"
    );
    exactKeys(input.capabilities, ["cardPayments"], "merchant capabilities");
    const idempotencyKey = text(input.idempotencyKey, 255);
    const contactEmail = text(input.contactEmail, 320).toLowerCase();
    if (
      !idempotencyKey
      || !contactEmail.includes("@")
      || input.country !== REVIEWED_CONFIGURATION.country
      || input.currency !== REVIEWED_CONFIGURATION.currency
      || input.dashboard !== REVIEWED_CONFIGURATION.dashboard
      || input.feesCollector !== REVIEWED_CONFIGURATION.feesCollector
      || input.lossesCollector !== REVIEWED_CONFIGURATION.lossesCollector
      || input.capabilities.cardPayments !== "requested"
    ) {
      fail("failed-precondition", "The merchant account request does not match the reviewed Connect model.");
    }
    try {
      await preflightProviderBinding();
      const account = await accounts.create({
        contact_email: contactEmail,
        dashboard: REVIEWED_CONFIGURATION.dashboard,
        defaults: {
          currency: REVIEWED_CONFIGURATION.currency,
          responsibilities: {
            fees_collector: REVIEWED_CONFIGURATION.feesCollector,
            losses_collector: REVIEWED_CONFIGURATION.lossesCollector
          }
        },
        identity: { country: REVIEWED_CONFIGURATION.country },
        configuration: {
          merchant: {
            capabilities: { card_payments: { requested: true } }
          }
        },
        include: ["configuration.merchant", "defaults", "requirements"]
      }, { idempotencyKey });
      const candidateId = text(account?.id, 255);
      if (
        !STRIPE_ACCOUNT_PATTERN.test(candidateId)
        || account?.object !== "v2.core.account"
        || account?.livemode !== false
      ) {
        quarantineReturnedAccount(account, {
          platformAccountBinding,
          reviewReason: "provider_binding_mismatch"
        });
      }
      const privateAccountId = requireSandboxAccount(account);
      if (!hasReviewedConfiguration(account)) {
        quarantineReturnedAccount(account, {
          platformAccountBinding,
          reviewReason: "unreviewed_configuration"
        });
      }
      return Object.freeze({
        privateAccountId,
        providerMode: SANDBOX_PROVIDER_MODE,
        platformAccountBinding,
        configurationDigest: REVIEWED_CONFIGURATION_DIGEST
      });
    } catch (error) {
      if (error instanceof StripeConnectInterfaceError) throw error;
      fail("unavailable", "Stripe Sandbox account creation is temporarily unavailable.");
    }
  }

  async function retrieveMerchantAccount(input = {}) {
    exactKeys(input, ["operationDigest", "privateAccountBinding"], "merchant account retrieval");
    const binding = assertPrivateBinding(input.privateAccountBinding);
    if (!DIGEST_PATTERN.test(text(input.operationDigest, 64).toLowerCase())) {
      fail("invalid-argument", "The provider observation operation digest is invalid.");
    }
    try {
      await preflightProviderBinding();
      const account = await accounts.retrieve(binding.privateAccountId, {
        include: ["configuration.merchant", "defaults", "requirements"]
      });
      requireSandboxAccount(account, binding.privateAccountId);
      return projectAccountObservation(account);
    } catch (error) {
      if (error instanceof StripeConnectInterfaceError) throw error;
      fail("unavailable", "Stripe Sandbox status is temporarily unavailable.");
    }
  }

  async function createAccountLink(input = {}) {
    exactKeys(
      input,
      ["attemptDigest", "privateAccountBinding", "refreshUrl", "returnUrl"],
      "account link request"
    );
    const binding = assertPrivateBinding(input.privateAccountBinding);
    const attemptDigest = text(input.attemptDigest, 64).toLowerCase();
    const returnUrl = requireHttpsUrl(input.returnUrl, "returnUrl");
    const refreshUrl = requireHttpsUrl(input.refreshUrl, "refreshUrl");
    if (
      !DIGEST_PATTERN.test(attemptDigest)
      || new URL(returnUrl).origin !== returnOrigin.origin
      || new URL(refreshUrl).origin !== returnOrigin.origin
    ) {
      fail("failed-precondition", "The Account Link handoff is outside the reviewed staging origin.");
    }
    try {
      await preflightProviderBinding();
      const accountLink = await accountLinks.create({
        account: binding.privateAccountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["merchant"],
            collection_options: {
              fields: "currently_due",
              future_requirements: "omit"
            },
            return_url: returnUrl,
            refresh_url: refreshUrl
          }
        }
      }, { idempotencyKey: `qpal_${attemptDigest}` });
      const expiresAtMs = Date.parse(text(accountLink?.expires_at, 64));
      if (
        accountLink?.object !== "v2.core.account_link"
        || accountLink.account !== binding.privateAccountId
        || accountLink.livemode !== false
        || !Number.isFinite(expiresAtMs)
      ) {
        fail("failed-precondition", "Stripe returned an Account Link outside the reviewed Sandbox binding.");
      }
      return Object.freeze({
        url: text(accountLink.url, 4096),
        expiresAtSeconds: Math.floor(expiresAtMs / 1000)
      });
    } catch (error) {
      if (error instanceof StripeConnectInterfaceError) throw error;
      fail("unavailable", "Stripe Sandbox onboarding is temporarily unavailable.");
    }
  }

  return Object.freeze({
    createMerchantAccount,
    retrieveMerchantAccount,
    createAccountLink,
    preflightProviderBinding
  });
}

module.exports = {
  REVIEWED_CONFIGURATION,
  REVIEWED_CONFIGURATION_DIGEST,
  SANDBOX_PROVIDER_MODE,
  StripeSandboxAccountQuarantineError,
  createStripeSandboxAdapter,
  hasReviewedConfiguration,
  privateProviderEvidence,
  projectAccountObservation,
  responsibilityState
};
