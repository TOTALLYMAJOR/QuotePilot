#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const contracts = require(path.join(ROOT, "functions-connect", "interfaceContracts.js"));
const authority = require(path.join(ROOT, "functions-connect", "authorityProjection.js"));
const commandContracts = require(path.join(ROOT, "functions-connect", "connectCommandContracts.js"));
const commandEdge = require(path.join(ROOT, "functions-connect", "connectCommandEdge.js"));
const commandWorker = require(path.join(ROOT, "functions-connect", "connectCommandWorker.js"));
const handoff = require(path.join(ROOT, "functions-connect", "onboardingHandoff.js"));
const repository = require(path.join(ROOT, "functions-connect", "connectControlRepository.js"));
const limiter = require(path.join(ROOT, "functions-connect", "durableRateLimiter.js"));
const adapter = require(path.join(ROOT, "functions-connect", "stripeSandboxAdapter.js"));
const providerModel = require(path.join(ROOT, "functions-connect", "providerModel.js"));
const edgeService = require(path.join(ROOT, "functions-connect", "statusOnboardingCommandEdgeService.js"));
const providerExecutor = require(path.join(ROOT, "functions-connect", "connectProviderCommandExecutor.js"));

function fail(message) {
  throw new Error(`Stripe Connect onboarding source check failed: ${message}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sectionBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) fail(`${label} source boundary is unavailable.`);
  return source.slice(start, end);
}

function assertBefore(source, beforeMarker, afterMarker, label) {
  const before = source.indexOf(beforeMarker);
  const after = source.indexOf(afterMarker);
  if (before < 0 || after < 0 || before >= after) fail(`${label} must run before its provider operation.`);
}

const dormantModules = [
  "interfaceContracts",
  "authorityProjection",
  "providerModel",
  "onboardingHandoff",
  "statusOnboardingService",
  "statusOnboardingCommandEdgeService",
  "connectControlRepository",
  "durableRateLimiter",
  "connectCommandContracts",
  "connectCommandEdge",
  "connectCommandWorker",
  "connectProviderCommandExecutor",
  "stripeSandboxAdapter"
];

const indexSource = read("functions-connect/index.js");
if (!indexSource.includes("module.exports = Object.freeze({});")) {
  fail("functions-connect must remain deploy-empty before the applied infrastructure and App Check gates.");
}
for (const moduleName of dormantModules) {
  if (indexSource.includes(moduleName)) fail(`${moduleName} must not be exported from the dormant codebase.`);
}

const sourceByModule = Object.fromEntries(dormantModules.map((moduleName) => [
  moduleName,
  read(`functions-connect/${moduleName}.js`)
]));
const source = Object.values(sourceByModule).join("\n");
if (/require\(["']stripe["']\)|\bnew\s+Stripe\b|\bonCall\b|\bonRequest\b/.test(source)) {
  fail("dormant interface source must use injected adapters and expose no function or Stripe runtime.");
}
if (/\b(?:console|functions\.logger)\s*\./.test(source)) {
  fail("onboarding source must not log provider links, handoff tokens, or private bindings.");
}
for (const forbidden of ["application_fee_amount", "transfer_data", "on_behalf_of"]) {
  if (source.includes(forbidden)) fail(`${forbidden} is outside the zero-platform-fee direct-charge model.`);
}
if (!source.includes("principalDigest") || /\bprincipal:\s*actor\.uid\b/.test(source)) {
  fail("durable rate-limit storage must receive only a separately HMAC-hashed principal digest.");
}
const interfaceSource = sourceByModule.interfaceContracts;
const authoritySource = sourceByModule.authorityProjection;
const repositorySource = sourceByModule.connectControlRepository;
const handoffSource = sourceByModule.onboardingHandoff;
const edgeServiceSource = sourceByModule.statusOnboardingCommandEdgeService;
if (!repositorySource.includes('databaseId !== CONNECT_DATABASE_ID')
  || !repositorySource.includes('getFirestore(firebaseApp, CONNECT_DATABASE_ID)')
  || /getFirestore\(firebaseApp\)(?!\s*,)/.test(repositorySource)) {
  fail("the Connect repository must select only the exact named database and never the default database.");
}
if (!authoritySource.includes("CONNECT_AUTHORITY_MAX_VALIDITY_SECONDS = 10 * 60")
  || !repositorySource.includes("applyAuthorityProjection")
  || !repositorySource.includes("authorityPublisherIdentity")
  || !repositorySource.includes("Canonical owner replacement requires separate operator review.")) {
  fail("current, publisher-bound Connect authority projection enforcement is incomplete.");
}
if (!interfaceSource.includes("appId !== expected")
  || !interfaceSource.includes('replayProtection: "consume_required"')
  || !interfaceSource.includes("function assertAppCheck")) {
  fail("the onboarding edge must bind an unconsumed App Check token to the exact reviewed application.");
}
const cachedStatusSource = sectionBetween(
  edgeServiceSource,
  "async function getStripeConnectStatus",
  "async function beginStripeConnectOnboarding",
  "cached Connect status"
);
const providerRefreshSource = sectionBetween(
  edgeServiceSource,
  "async function refreshStripeConnectStatus",
  "async function prepareStripeConnectOnboardingRedirect",
  "Connect provider refresh"
);
if (!cachedStatusSource.includes("assertAppCheck(request.app, expectedAppId)")
  || !providerRefreshSource.includes("assertConsumedAppCheck(request.app, expectedAppId)")) {
  fail("every Connect status callable must bind exact App Check, with replay protection before provider refresh.");
}
const limiterSource = sourceByModule.durableRateLimiter;
if (!limiterSource.includes("database.runTransaction")
  || !limiterSource.includes("createHmac")
  || !limiterSource.includes("fail(\"internal\", \"The durable Connect rate limiter could not verify this request.\")")) {
  fail("the Connect limiter must be transactional, HMAC-scoped, and fail closed.");
}
const expectedRatePolicies = {
  refresh_status: [
    { scope: "principal", limit: 6, windowSeconds: 5 * 60, minIntervalSeconds: 0 },
    { scope: "organization", limit: 6, windowSeconds: 5 * 60, minIntervalSeconds: 10 }
  ],
  begin_onboarding: [
    { scope: "principal", limit: 6, windowSeconds: 24 * 60 * 60, minIntervalSeconds: 0 },
    { scope: "organization", limit: 10, windowSeconds: 24 * 60 * 60, minIntervalSeconds: 0 }
  ],
  prepare_onboarding_redirect: [
    { scope: "principal", limit: 3, windowSeconds: 15 * 60, minIntervalSeconds: 0 },
    { scope: "organization", limit: 10, windowSeconds: 24 * 60 * 60, minIntervalSeconds: 0 }
  ]
};
if (JSON.stringify(limiter.RATE_LIMIT_POLICIES) !== JSON.stringify(expectedRatePolicies)) {
  fail("the reviewed refresh, onboarding, and Account Link rate policies changed without source-policy review.");
}

const statusEdgeSource = sourceByModule.statusOnboardingCommandEdgeService;
const compatibilitySource = sourceByModule.statusOnboardingService;
const commandEdgeSource = sourceByModule.connectCommandEdge;
const commandWorkerSource = sourceByModule.connectCommandWorker;
const providerExecutorSource = sourceByModule.connectProviderCommandExecutor;
for (const [label, edgeSource] of [
  ["status/onboarding edge", statusEdgeSource],
  ["command edge", commandEdgeSource],
  ["command worker lease store", commandWorkerSource]
]) {
  if (/\b(?:createMerchantAccount|retrieveMerchantAccount|createAccountLink|preflightProviderBinding|stripeClient)\b/.test(edgeSource)
    || edgeSource.includes("stripeSandboxAdapter")) {
    fail(`${label} must not hold a Stripe client or invoke provider APIs.`);
  }
}
if (!statusEdgeSource.includes("assertProjectedConnectAdmin(actor, authority, now())")
  || !statusEdgeSource.includes("enqueueCommand")
  || !statusEdgeSource.includes('commandPayloadDigest("create_merchant_account", payload)')
  || !compatibilitySource.includes("createStripeConnectStatusOnboardingCommandEdgeService")) {
  fail("the status/onboarding compatibility path must use current authority and immutable provider commands.");
}
if (!commandEdgeSource.includes("transaction.create(commandDocument, immutableCommand)")
  || !commandEdgeSource.includes("assertStoredCommandMatches(existingCommand, normalized)")
  || !commandWorkerSource.includes("CONNECT_COMMAND_DEFAULT_MAX_ATTEMPTS = 5")
  || !commandWorkerSource.includes("lease_attempts_exhausted")
  || !commandWorkerSource.includes("transaction.create(documents.receipt, receipt)")) {
  fail("the command bridge must preserve immutable commands, leased retries, dead letters, and terminal receipts.");
}
const createExecutorSource = sectionBetween(
  providerExecutorSource,
  "async function executeCreateMerchantAccount",
  "async function executeRefreshMerchantAccount",
  "merchant command execution"
);
const completeOnboardingSource = sectionBetween(
  repositorySource,
  "async function completeOnboarding",
  "async function refreshStatus",
  "post-provider onboarding completion"
);
const quarantineProviderSource = sectionBetween(
  repositorySource,
  "async function quarantineProviderOperation",
  "async function savePreparedHandoff",
  "private provider quarantine"
);
const recordProviderExpirySource = sectionBetween(
  repositorySource,
  "async function recordProviderExpiry",
  "async function recordHandoffFailure",
  "post-provider handoff issuance"
);
assertBefore(
  createExecutorSource,
  'recoveryExpiresAtMs <= Number(now())',
  'await createMerchantAccount({',
  "provider recovery expiry"
);
assertBefore(
  createExecutorSource,
  "await createMerchantAccount({",
  "await completeOnboarding({",
  "post-provider account authority persistence"
);
if (typeof commandEdge.createConnectCommandEdge !== "function"
  || typeof commandWorker.createConnectCommandWorker !== "function"
  || typeof edgeService.createStripeConnectStatusOnboardingCommandEdgeService !== "function"
  || typeof providerExecutor.createConnectProviderCommandExecutor !== "function") {
  fail("the dormant command-backed Connect factories are incomplete.");
}

const adapterSource = sourceByModule.stripeSandboxAdapter;
if (!adapterSource.includes("stripeClient?.v2?.core?.accounts")
  || !adapterSource.includes("stripeClient?.v2?.core?.accountLinks")
  || adapterSource.includes('require("stripe")')
  || /\bnew\s+Stripe\b/.test(adapterSource)) {
  fail("the Sandbox adapter must use only an injected Accounts v2 client.");
}
if (providerModel.REVIEWED_CONFIGURATION.chargePattern !== "direct"
  || providerModel.REVIEWED_CONFIGURATION.platformApplicationFee !== false
  || providerModel.REVIEWED_CONFIGURATION.dashboard !== "full"
  || providerModel.REVIEWED_CONFIGURATION.feesCollector !== "stripe"
  || providerModel.REVIEWED_CONFIGURATION.lossesCollector !== "stripe"
  || adapter.REVIEWED_CONFIGURATION_DIGEST !== providerModel.REVIEWED_CONFIGURATION_DIGEST) {
  fail("the Sandbox adapter must retain the approved direct-charge responsibility model.");
}
const protectedProviderEvidence = Object.freeze({
  privateAccountId: "acct_policyprivate0001",
  providerMode: "sandbox",
  platformAccountBinding: "acct_policyplatform0001",
  configurationDigest: "d".repeat(64),
  providerResponseDigest: "e".repeat(64),
  reviewReason: "provider_binding_mismatch"
});
const protectedIdentityError = new adapter.StripeSandboxAccountQuarantineError(
  "Private provider identity requires review.",
  protectedProviderEvidence
);
const protectedIdentityDescriptor = Object.getOwnPropertyDescriptor(
  protectedIdentityError,
  "privateProviderEvidence"
);
if (!(protectedIdentityError instanceof contracts.StripeConnectInterfaceError)
  || protectedIdentityError.name !== "StripeSandboxAccountQuarantineError"
  || protectedIdentityError.code !== "failed-precondition"
  || !protectedIdentityDescriptor
  || protectedIdentityDescriptor.enumerable !== false
  || protectedIdentityDescriptor.configurable !== false
  || protectedIdentityDescriptor.writable !== false
  || !Object.isFrozen(protectedIdentityDescriptor.value)
  || protectedIdentityDescriptor.value.privateAccountId !== protectedProviderEvidence.privateAccountId
  || Object.keys(protectedIdentityError).includes("privateProviderEvidence")
  || JSON.stringify(protectedIdentityError).includes(protectedProviderEvidence.privateAccountId)) {
  fail("specialized provider identity evidence must remain immutable and non-enumerable on quarantine errors.");
}
const createMerchantSource = sectionBetween(
  adapterSource,
  "async function createMerchantAccount",
  "async function retrieveMerchantAccount",
  "merchant creation"
);
const retrieveMerchantSource = sectionBetween(
  adapterSource,
  "async function retrieveMerchantAccount",
  "async function createAccountLink",
  "merchant retrieval"
);
const accountLinkSource = sectionBetween(
  adapterSource,
  "async function createAccountLink",
  "\n  return Object.freeze({\n    createMerchantAccount",
  "Account Link creation"
);
assertBefore(createMerchantSource, "await preflightProviderBinding()", "await accounts.create(", "merchant creation preflight");
assertBefore(retrieveMerchantSource, "await preflightProviderBinding()", "await accounts.retrieve(", "merchant retrieval preflight");
assertBefore(accountLinkSource, "await preflightProviderBinding()", "await accountLinks.create(", "Account Link preflight");
if (!adapterSource.includes("platformAccounts.retrieve(platformAccountBinding)")
  || !adapterSource.includes("balance.retrieve()")
  || !adapterSource.includes("platformBalance.livemode !== false")
  || !adapterSource.includes("isValidRfc3339Timestamp(account.configuration?.merchant?.applied)")
  || !adapterSource.includes('cardPaymentsState === "active" && payoutsState === "active"')) {
  fail("the Sandbox adapter must verify platform/mode before every provider operation and require current provider-shaped readiness.");
}

if (!repository.COLLECTIONS.rateLimits
  || !repository.COLLECTIONS.authorities
  || !repository.COLLECTIONS.onboardingHandoffReceipts
  || !repositorySource.includes("Another onboarding handoff is already active.")
  || !repositorySource.includes("status.activeHandoffTokenDigest !== protectedToken")
  || !repositorySource.includes("Number(status.revision) !== Number(current.revision)")
  || !repositorySource.includes("Number(status.generation) !== Number(current.generation)")
  || !repositorySource.includes('["onboarding", "pending_review", "attention_required"].includes(text(status.connectionState, 64))')
  || !repositorySource.includes("authority.ownerUid !== current.ownerUid")
  || !repositorySource.includes("authority.authorityRevision !== Number(current.authorityRevision)")) {
  fail("the named repository must recheck the single active handoff against current state and owner authority.");
}

const authorityNowMs = Date.parse("2026-08-14T12:00:00.000Z");
const currentAuthority = authority.buildConnectAuthorityProjection({
  organizationId: "policy_org",
  authorityRevision: 1,
  organizationActive: true,
  ownerUid: "policy_owner",
  members: [{
    uid: "policy_owner",
    email: "owner@example.com",
    role: "admin",
    emailVerified: true,
    disabled: false
  }],
  sourceReceiptId: "policy-authority-receipt-0001",
  sourceReceiptDigest: "b".repeat(64),
  observedAtISO: new Date(authorityNowMs).toISOString(),
  expiresAtISO: new Date(authorityNowMs + 5 * 60 * 1000).toISOString()
}, { nowMs: authorityNowMs });
const projectedOwner = authority.assertProjectedConnectAdmin({
  uid: "policy_owner",
  email: "owner@example.com",
  organizationId: "policy_org"
}, currentAuthority, authorityNowMs);
if (!projectedOwner.actorIsOwner || projectedOwner.projection.payloadDigest !== currentAuthority.payloadDigest) {
  fail("the edge cannot establish canonical ownership from the current authority projection.");
}
try {
  authority.assertProjectedConnectAdmin({
    uid: "policy_owner",
    email: "owner@example.com",
    organizationId: "policy_org"
  }, currentAuthority, authorityNowMs + 6 * 60 * 1000);
  fail("expired Connect authority must fail closed.");
} catch (error) {
  if (!(error instanceof contracts.StripeConnectInterfaceError)) throw error;
}
try {
  authority.assertProjectedConnectAdmin({
    uid: "removed_admin",
    email: "removed@example.com",
    organizationId: "policy_org"
  }, currentAuthority, authorityNowMs);
  fail("stale token-only admin authority must not pass current projection checks.");
} catch (error) {
  if (!(error instanceof contracts.StripeConnectInterfaceError)) throw error;
}

const commandPayload = {
  authorityPayloadDigest: currentAuthority.payloadDigest,
  configurationDigest: providerModel.REVIEWED_CONFIGURATION_DIGEST,
  contactEmailDigest: "c".repeat(64),
  reservationDigest: "d".repeat(64)
};
const commandPayloadDigest = commandContracts.buildConnectCommandPayloadDigest({
  operation: "create_merchant_account",
  payload: commandPayload
});
const normalizedCommand = commandContracts.normalizeConnectCommandRequest({
  organizationId: "policy_org",
  operation: "create_merchant_account",
  requestId: "onboarding-policy-command-0001",
  expectedRevision: 1,
  connectionGeneration: 1,
  payload: commandPayload,
  payloadDigest: commandPayloadDigest
});
const replayedCommand = commandContracts.normalizeConnectCommandRequest({
  organizationId: "policy_org",
  operation: "create_merchant_account",
  requestId: "onboarding-policy-command-0001",
  expectedRevision: 1,
  connectionGeneration: 1,
  payload: commandPayload,
  payloadDigest: commandPayloadDigest
});
if (normalizedCommand.commandId !== replayedCommand.commandId
  || normalizedCommand.requestDigest !== replayedCommand.requestDigest
  || normalizedCommand.providerIdempotencyKey !== replayedCommand.providerIdempotencyKey
  || !normalizedCommand.providerIdempotencyKey.startsWith("qpcmd_")) {
  fail("provider commands must retain replay-stable identity and provider idempotency.");
}
if (JSON.stringify(Object.keys(commandContracts.CONNECT_COMMAND_OPERATIONS).sort())
  !== JSON.stringify(["create_merchant_account", "refresh_merchant_account"])) {
  fail("only provider command operations with a complete reviewed executor may be declared.");
}
try {
  commandContracts.buildConnectCommandPayloadDigest({
    operation: "create_account_link",
    payload: {
      accountBindingDigest: "f".repeat(64),
      attemptDigest: "a".repeat(64)
    }
  });
  fail("create_account_link must not become a command without a reviewed worker executor.");
} catch (error) {
  if (!(error instanceof contracts.StripeConnectInterfaceError)) throw error;
}
const merchantIdempotencyAssignments = createExecutorSource.match(/\bidempotencyKey\s*:/g) || [];
if (source.includes("qpca_")
  || repositorySource.includes("providerIdempotencyKey")
  || merchantIdempotencyAssignments.length !== 1
  || !createExecutorSource.includes("idempotencyKey: command.providerIdempotencyKey")
  || !repositorySource.includes("authorityPayloadDigest: protectedAuthority")
  || !providerExecutorSource.includes("priorQuarantineOutcome(command, status)")) {
  fail("merchant creation must use only the qpcmd command identity and replay quarantine exactly.");
}
if (!repositorySource.includes("PROVIDER_ACCOUNT_PATTERN.test(platformAccountBinding)")
  || !repositorySource.includes("configurationDigest !== REVIEWED_CONFIGURATION_DIGEST")) {
  fail("the repository must reject an unreviewed platform or configuration before provider binding.");
}
if (!adapterSource.includes("StripeSandboxAccountQuarantineError")
  || !adapterSource.includes('enumerable: false')
  || !repository.COLLECTIONS.providerQuarantines
  || !providerExecutorSource.includes("error.privateProviderEvidence || null")) {
  fail("returned provider identities must be carried only as private quarantine evidence.");
}
if (!quarantineProviderSource.includes('`${COLLECTIONS.providerQuarantines}/${occurrenceId}`')
  || !quarantineProviderSource.includes("privateProviderEvidence: evidence")
  || !quarantineProviderSource.includes("transaction.create(occurrenceRef, { ...occurrenceCore, occurrenceDigest })")
  || !quarantineProviderSource.includes("current.lastProviderQuarantine?.requestDigest === protectedRequest")
  || !quarantineProviderSource.includes("return Object.freeze({ ...current.lastProviderQuarantine });")
  || !repositorySource.includes("normalizeStoredQuarantineOccurrence")
  || !repositorySource.includes("assertStoredQuarantineBinding")
  || !repositorySource.includes("sha256(canonicalJson(occurrenceCore))")
  || !providerExecutorSource.includes("priorQuarantineOutcome(command, status)")) {
  fail("private provider quarantine occurrences and account claims must be canonical, validated, and replayable.");
}
if (!completeOnboardingSource.includes("transaction.get(authorityDocumentRef)")
  || !completeOnboardingSource.includes("const committedAtMs = Number(now())")
  || !completeOnboardingSource.includes("nowMs: committedAtMs")
  || !completeOnboardingSource.includes("authority.payloadDigest === current.activeReservation.authorityPayloadDigest")
  || !completeOnboardingSource.includes("authority.ownerUid === current.activeReservation.actorUid")
  || !completeOnboardingSource.includes("sha256(owner.email) === current.activeReservation.actorEmailDigest")
  || !completeOnboardingSource.includes('"provider_authority_changed"')
  || !completeOnboardingSource.includes("transaction.create(quarantineRef, { ...occurrenceCore, occurrenceDigest })")) {
  fail("provider account completion must recheck current owner authority and privately quarantine drift.");
}
if (!recordProviderExpirySource.includes("transaction.get(authorityDocumentRef)")
  || !recordProviderExpirySource.includes("if (!statusMatches || !authorityMatches || !expiryMatches)")
  || !recordProviderExpirySource.includes('state: "provider_withheld"')
  || !handoffSource.includes('issuance?.state !== "provider_issued"')
  || !handoffSource.includes("Date.parse(record.expiresAtISO)")
  || !handoffSource.includes("providerReturnedAtMs")
  || !handoffSource.includes("effectiveExpiresAtSeconds <= Math.floor(disclosureAtMs / 1000)")
  || !handoffSource.includes("return redirectResponse(refreshUrl)")) {
  fail("post-provider authority, state, or expiry drift must withhold the Account Link and recover in-app.");
}

const request = {
  requestId: "onboarding-policy-request-0001",
  expectedRevision: 0,
  expectedGeneration: 0
};
request.payloadDigest = contracts.buildConnectMutationPayloadDigest("beginStripeConnectOnboarding", request);
contracts.normalizeMutationRequest(request, "beginStripeConnectOnboarding");
try {
  contracts.normalizeMutationRequest(
    { ...request, organizationId: "browser_scope_must_fail" },
    "beginStripeConnectOnboarding"
  );
  fail("browser mutation schemas must reject organizationId.");
} catch (error) {
  if (!(error instanceof contracts.StripeConnectInterfaceError)) throw error;
}

const prepared = handoff.prepareOneUseOnboardingHandoff({
  organizationId: "policy_org",
  generation: 1,
  revision: 2,
  requestId: request.requestId,
  payloadDigest: request.payloadDigest,
  ownerUid: "policy_owner",
  authorityRevision: 1,
  appIdDigest: "a".repeat(64),
  canonicalReturnOrigin: "https://quotepilot-staging-20260804.web.app",
  hmacKey: "source-policy-handoff-key-with-at-least-thirty-two-bytes",
  nowMs: Date.parse("2026-08-14T12:00:00.000Z")
});
if (!prepared.browser.handoffUrl.startsWith("https://quotepilot-staging-20260804.web.app/")) {
  fail("the browser handoff must stay on the exact staging origin.");
}
if (prepared.browser.handoffUrl.includes("stripe.com")) {
  fail("application JavaScript must never receive a Stripe Account Link URL.");
}
if (prepared.browser.handoffMethod !== "POST" || prepared.browser.handoffUrl.includes(prepared.browser.handoffToken)) {
  fail("the one-use handoff token must travel in the same-tab POST body, never the URL.");
}
const derivedHandoffToken = handoff.deriveHandoffToken(
  prepared.privateRecord,
  "source-policy-handoff-key-with-at-least-thirty-two-bytes"
);
const rebuiltBrowser = handoff.buildOnboardingHandoffBrowser({
  privateRecord: prepared.privateRecord,
  canonicalReturnOrigin: "https://quotepilot-staging-20260804.web.app",
  hmacKey: "source-policy-handoff-key-with-at-least-thirty-two-bytes"
});
if (prepared.browser.handoffToken !== derivedHandoffToken
  || rebuiltBrowser.handoffToken !== prepared.browser.handoffToken
  || rebuiltBrowser.attempt !== prepared.browser.attempt
  || prepared.privateRecord.ownerUid !== "policy_owner"
  || prepared.privateRecord.authorityRevision !== 1
  || prepared.privateRecord.appIdDigest !== "a".repeat(64)) {
  fail("the handoff bearer token must be replay-stable and bound to owner, authority, app, and attempt.");
}
if (JSON.stringify(prepared.privateRecord).includes(derivedHandoffToken)) {
  fail("the raw one-use handoff token must not be persisted.");
}
const changedOwnerToken = handoff.deriveHandoffToken(
  { ...prepared.privateRecord, ownerUid: "another_owner" },
  "source-policy-handoff-key-with-at-least-thirty-two-bytes"
);
if (changedOwnerToken === derivedHandoffToken || handoff.HANDOFF_SCHEMA_VERSION !== 2) {
  fail("handoff v2 identity changes must revoke the derived bearer token.");
}

let providerIssuanceRecorded = false;
const withheldResponse = await handoff.consumeOneUseOnboardingHandoff({
  method: "POST",
  token: prepared.browser.handoffToken,
  canonicalReturnOrigin: "https://quotepilot-staging-20260804.web.app",
  store: {
    consumePreparedHandoff: async ({ tokenDigest }) => Object.freeze({
      ...prepared.privateRecord,
      tokenDigest,
      state: "consumed",
      privateAccountBinding: Object.freeze({ bindingId: "policy_binding" })
    }),
    recordProviderExpiry: async () => {
      providerIssuanceRecorded = true;
      return Object.freeze({ state: "provider_withheld" });
    }
  },
  provider: {
    createAccountLink: async () => Object.freeze({
      url: "https://connect.stripe.com/setup/s/policy-handoff",
      expiresAtSeconds: Math.floor(authorityNowMs / 1000) + 300
    })
  },
  now: () => authorityNowMs
});
const withheldLocation = new URL(withheldResponse?.headers?.Location || "https://invalid.example");
if (!providerIssuanceRecorded
  || withheldResponse?.statusCode !== 303
  || withheldLocation.origin !== "https://quotepilot-staging-20260804.web.app"
  || withheldLocation.searchParams.get("connect_return") !== "recover"
  || withheldLocation.hostname.endsWith("stripe.com")) {
  fail("provider_withheld handoffs must never disclose the provider Account Link.");
}

console.log("Stripe Connect onboarding contracts are current-authority-bound, command-backed, preflighted, replay-stable, redacted, rate-limited, and deploy-dormant.");
