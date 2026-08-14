"use strict";

const {
  canonicalJson,
  sha256,
  StripeConnectInterfaceError
} = require("./interfaceContracts");

const CONNECT_COMMAND_SCHEMA_VERSION = 1;
const CONNECT_COMMAND_ID_PATTERN = /^[a-f0-9]{64}$/;
const CONNECT_COMMAND_REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{20,80}$/;
const CONNECT_COMMAND_SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const CONNECT_COMMAND_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

const CONNECT_COMMAND_OPERATIONS = Object.freeze({
  create_merchant_account: Object.freeze([
    "authorityPayloadDigest",
    "configurationDigest",
    "contactEmailDigest",
    "reservationDigest"
  ]),
  refresh_merchant_account: Object.freeze([
    "accountBindingDigest",
    "authorityPayloadDigest"
  ])
});

const CONNECT_COMMAND_TERMINAL_STATES = Object.freeze([
  "succeeded",
  "failed",
  "quarantined",
  "dead_lettered"
]);

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function text(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function exactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-argument", `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid-argument", `${label} must contain only the exact supported fields.`);
  }
}

function safeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    fail("invalid-argument", `${label} is invalid.`);
  }
  return parsed;
}

function safeISO(value, label) {
  const parsed = Date.parse(text(value, 64));
  if (!Number.isFinite(parsed)) fail("invalid-argument", `${label} is invalid.`);
  return new Date(parsed).toISOString();
}

function normalizeDigest(value, label, { optional = false } = {}) {
  const normalized = text(value, 64).toLowerCase();
  if (optional && !normalized) return "";
  if (!CONNECT_COMMAND_DIGEST_PATTERN.test(normalized)) {
    fail("invalid-argument", `${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

function normalizeOperation(value) {
  const operation = text(value, 80).toLowerCase();
  if (!Object.hasOwn(CONNECT_COMMAND_OPERATIONS, operation)) {
    fail("failed-precondition", "The Connect command operation has not been reviewed.");
  }
  return operation;
}

function normalizeCommandPayload(operation, value) {
  const expectedKeys = CONNECT_COMMAND_OPERATIONS[operation];
  exactKeys(value, expectedKeys, `${operation} payload`);
  return Object.freeze(Object.fromEntries(expectedKeys.map((key) => [
    key,
    normalizeDigest(value[key], `${operation} ${key}`)
  ])));
}

function buildConnectCommandPayloadDigest({ operation, payload } = {}) {
  const normalizedOperation = normalizeOperation(operation);
  const normalizedPayload = normalizeCommandPayload(normalizedOperation, payload);
  return sha256(canonicalJson({
    schemaVersion: CONNECT_COMMAND_SCHEMA_VERSION,
    operation: normalizedOperation,
    payload: normalizedPayload
  }));
}

function buildConnectCommandRequestDigest({
  organizationId,
  operation,
  requestId,
  expectedRevision,
  connectionGeneration,
  payloadDigest
} = {}) {
  return sha256(canonicalJson({
    schemaVersion: CONNECT_COMMAND_SCHEMA_VERSION,
    organizationId,
    operation,
    requestId,
    expectedRevision,
    connectionGeneration,
    payloadDigest
  }));
}

function buildConnectCommandId({ organizationId, requestId } = {}) {
  return sha256([
    `quotepilot-connect-command-v${CONNECT_COMMAND_SCHEMA_VERSION}`,
    organizationId,
    requestId
  ].join("\n"));
}

function buildConnectProviderIdempotencyKey({ commandId, requestDigest } = {}) {
  const command = normalizeDigest(commandId, "commandId");
  const request = normalizeDigest(requestDigest, "requestDigest");
  return `qpcmd_${sha256(canonicalJson({
    schemaVersion: CONNECT_COMMAND_SCHEMA_VERSION,
    commandId: command,
    requestDigest: request
  }))}`;
}

function normalizeConnectCommandRequest(value = {}) {
  exactKeys(value, [
    "connectionGeneration",
    "expectedRevision",
    "operation",
    "organizationId",
    "payload",
    "payloadDigest",
    "requestId"
  ], "Connect command request");

  const organizationId = text(value.organizationId, 160).toLowerCase();
  const operation = normalizeOperation(value.operation);
  const requestId = text(value.requestId, 80);
  const expectedRevision = safeInteger(value.expectedRevision, "expectedRevision");
  const connectionGeneration = safeInteger(
    value.connectionGeneration,
    "connectionGeneration",
    { min: 1 }
  );
  if (!CONNECT_COMMAND_SAFE_ID_PATTERN.test(organizationId)) {
    fail("invalid-argument", "organizationId is invalid.");
  }
  if (!CONNECT_COMMAND_REQUEST_ID_PATTERN.test(requestId)) {
    fail("invalid-argument", "requestId must be 20-80 letters, numbers, or hyphens.");
  }
  const payload = normalizeCommandPayload(operation, value.payload);
  const payloadDigest = normalizeDigest(value.payloadDigest, "payloadDigest");
  const expectedPayloadDigest = buildConnectCommandPayloadDigest({ operation, payload });
  if (payloadDigest !== expectedPayloadDigest) {
    fail("invalid-argument", "payloadDigest does not match the exact command payload.");
  }
  const requestDigest = buildConnectCommandRequestDigest({
    organizationId,
    operation,
    requestId,
    expectedRevision,
    connectionGeneration,
    payloadDigest
  });
  const commandId = buildConnectCommandId({ organizationId, requestId });
  const providerIdempotencyKey = buildConnectProviderIdempotencyKey({ commandId, requestDigest });

  return Object.freeze({
    schemaVersion: CONNECT_COMMAND_SCHEMA_VERSION,
    commandId,
    organizationId,
    operation,
    requestId,
    expectedRevision,
    connectionGeneration,
    payload,
    payloadDigest,
    requestDigest,
    providerIdempotencyKey
  });
}

function assertStoredCommandMatches(stored = {}, expected = null) {
  exactKeys(stored, [
    "commandId",
    "connectionGeneration",
    "expectedRevision",
    "operation",
    "organizationId",
    "payload",
    "payloadDigest",
    "providerIdempotencyKey",
    "queuedAtISO",
    "requestDigest",
    "requestId",
    "schemaVersion",
    "state"
  ], "Stored Connect command");
  const normalized = normalizeConnectCommandRequest({
    organizationId: stored.organizationId,
    operation: stored.operation,
    requestId: stored.requestId,
    expectedRevision: stored.expectedRevision,
    connectionGeneration: stored.connectionGeneration,
    payload: stored.payload,
    payloadDigest: stored.payloadDigest
  });
  if (
    stored.schemaVersion !== CONNECT_COMMAND_SCHEMA_VERSION
    || stored.commandId !== normalized.commandId
    || stored.requestDigest !== normalized.requestDigest
    || stored.providerIdempotencyKey !== normalized.providerIdempotencyKey
    || stored.state !== "queued"
    || safeISO(stored.queuedAtISO, "queuedAtISO") !== stored.queuedAtISO
  ) {
    fail("data-loss", "The stored Connect command envelope is invalid.");
  }
  if (expected && (
    normalized.commandId !== expected.commandId
    || normalized.requestDigest !== expected.requestDigest
    || normalized.payloadDigest !== expected.payloadDigest
  )) {
    fail("already-exists", "requestId is already bound to a different Connect command digest.");
  }
  return Object.freeze({ ...stored, payload: normalized.payload });
}

function normalizeConnectCommandOutcome(value = {}) {
  exactKeys(value, [
    "providerReferenceDigest",
    "resultDigest",
    "safeCode",
    "state"
  ], "Connect command outcome");
  const state = text(value.state, 32).toLowerCase();
  const safeCode = text(value.safeCode, 64).toLowerCase();
  if (!CONNECT_COMMAND_TERMINAL_STATES.includes(state)) {
    fail("invalid-argument", "The Connect command outcome is not terminal.");
  }
  if (!/^[a-z0-9_-]{1,64}$/.test(safeCode)) {
    fail("invalid-argument", "The Connect command safe outcome code is invalid.");
  }
  return Object.freeze({
    state,
    safeCode,
    resultDigest: normalizeDigest(value.resultDigest, "resultDigest"),
    providerReferenceDigest: normalizeDigest(
      value.providerReferenceDigest,
      "providerReferenceDigest",
      { optional: true }
    )
  });
}

function buildConnectCommandTerminalReceipt({ command, outcome, completedAtISO } = {}) {
  const storedCommand = assertStoredCommandMatches(command);
  const terminal = normalizeConnectCommandOutcome(outcome);
  const completedAt = safeISO(completedAtISO, "completedAtISO");
  const receiptCore = Object.freeze({
    schemaVersion: CONNECT_COMMAND_SCHEMA_VERSION,
    commandId: storedCommand.commandId,
    organizationId: storedCommand.organizationId,
    operation: storedCommand.operation,
    requestId: storedCommand.requestId,
    requestDigest: storedCommand.requestDigest,
    payloadDigest: storedCommand.payloadDigest,
    connectionGeneration: storedCommand.connectionGeneration,
    state: terminal.state,
    safeCode: terminal.safeCode,
    resultDigest: terminal.resultDigest,
    providerReferenceDigest: terminal.providerReferenceDigest,
    completedAtISO: completedAt
  });
  return Object.freeze({
    ...receiptCore,
    receiptDigest: sha256(canonicalJson(receiptCore))
  });
}

function assertStoredTerminalReceipt(value = {}, command) {
  exactKeys(value, [
    "commandId",
    "completedAtISO",
    "connectionGeneration",
    "operation",
    "organizationId",
    "payloadDigest",
    "providerReferenceDigest",
    "receiptDigest",
    "requestDigest",
    "requestId",
    "resultDigest",
    "safeCode",
    "schemaVersion",
    "state"
  ], "Stored Connect command receipt");
  const rebuilt = buildConnectCommandTerminalReceipt({
    command,
    outcome: {
      state: value.state,
      safeCode: value.safeCode,
      resultDigest: value.resultDigest,
      providerReferenceDigest: value.providerReferenceDigest
    },
    completedAtISO: value.completedAtISO
  });
  if (
    value.schemaVersion !== CONNECT_COMMAND_SCHEMA_VERSION
    || value.commandId !== rebuilt.commandId
    || value.organizationId !== rebuilt.organizationId
    || value.operation !== rebuilt.operation
    || value.requestId !== rebuilt.requestId
    || value.requestDigest !== rebuilt.requestDigest
    || value.payloadDigest !== rebuilt.payloadDigest
    || Number(value.connectionGeneration) !== rebuilt.connectionGeneration
    || value.receiptDigest !== rebuilt.receiptDigest
  ) {
    fail("data-loss", "The stored Connect command receipt is invalid.");
  }
  return rebuilt;
}

function publicCommandAcknowledgement(command, { replayed = false, receipt = null } = {}) {
  const stored = assertStoredCommandMatches(command);
  const terminal = receipt ? assertStoredTerminalReceipt(receipt, stored) : null;
  return Object.freeze({
    schemaVersion: CONNECT_COMMAND_SCHEMA_VERSION,
    commandId: stored.commandId,
    operation: stored.operation,
    requestId: stored.requestId,
    requestDigest: stored.requestDigest,
    payloadDigest: stored.payloadDigest,
    connectionGeneration: stored.connectionGeneration,
    state: terminal?.state || "queued",
    replayed: replayed === true,
    receiptDigest: terminal?.receiptDigest || ""
  });
}

module.exports = {
  CONNECT_COMMAND_DIGEST_PATTERN,
  CONNECT_COMMAND_ID_PATTERN,
  CONNECT_COMMAND_OPERATIONS,
  CONNECT_COMMAND_SCHEMA_VERSION,
  CONNECT_COMMAND_TERMINAL_STATES,
  StripeConnectInterfaceError,
  assertStoredCommandMatches,
  assertStoredTerminalReceipt,
  buildConnectCommandId,
  buildConnectCommandPayloadDigest,
  buildConnectCommandRequestDigest,
  buildConnectCommandTerminalReceipt,
  buildConnectProviderIdempotencyKey,
  normalizeConnectCommandOutcome,
  normalizeConnectCommandRequest,
  publicCommandAcknowledgement,
  safeISO,
  sha256
};
