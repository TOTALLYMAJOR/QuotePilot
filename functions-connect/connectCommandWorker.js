"use strict";

const {
  CONNECT_COMMAND_DIGEST_PATTERN,
  CONNECT_COMMAND_ID_PATTERN,
  CONNECT_COMMAND_SCHEMA_VERSION,
  StripeConnectInterfaceError,
  assertStoredCommandMatches,
  assertStoredTerminalReceipt,
  buildConnectCommandTerminalReceipt,
  normalizeConnectCommandOutcome,
  sha256
} = require("./connectCommandContracts");
const { CONNECT_COMMAND_COLLECTIONS } = require("./connectCommandEdge");

const CONNECT_COMMAND_DEFAULT_LEASE_SECONDS = 60;
const CONNECT_COMMAND_DEFAULT_MAX_ATTEMPTS = 5;
const SAFE_WORKER_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_LEASE_ID_PATTERN = /^[A-Za-z0-9-]{20,80}$/;

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function requireDatabase(database) {
  if (!database || typeof database.doc !== "function" || typeof database.runTransaction !== "function") {
    fail("internal", "The isolated Connect worker command store is unavailable.");
  }
  return database;
}

function safeInteger(value, label, { min, max }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    fail("invalid-argument", `${label} is invalid.`);
  }
  return parsed;
}

function nowFromClock(clock) {
  const nowMs = Number(clock());
  if (!Number.isFinite(nowMs)) fail("internal", "The Connect worker clock is invalid.");
  return Object.freeze({ nowMs, nowISO: new Date(nowMs).toISOString() });
}

function snapshotData(snapshot) {
  return snapshot?.exists ? snapshot.data() : null;
}

function refs(database, commandId) {
  return Object.freeze({
    command: database.doc(`${CONNECT_COMMAND_COLLECTIONS.commands}/${commandId}`),
    lease: database.doc(`${CONNECT_COMMAND_COLLECTIONS.leases}/${commandId}`),
    receipt: database.doc(`${CONNECT_COMMAND_COLLECTIONS.receipts}/${commandId}`)
  });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-argument", `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("invalid-argument", `${label} contains unsupported fields.`);
  }
}

function normalizeWorkerIdentity({ commandId, leaseId, workerId } = {}, label) {
  const command = String(commandId || "").trim().toLowerCase();
  const lease = String(leaseId || "").trim();
  const worker = String(workerId || "").trim();
  if (
    !CONNECT_COMMAND_ID_PATTERN.test(command)
    || !SAFE_LEASE_ID_PATTERN.test(lease)
    || !SAFE_WORKER_ID_PATTERN.test(worker)
  ) {
    fail("invalid-argument", `${label} identity is invalid.`);
  }
  return Object.freeze({ commandId: command, leaseId: lease, workerId: worker });
}

function normalizeClaimInput(value = {}) {
  exactKeys(value, ["commandId", "leaseId", "workerId"], "Connect command claim");
  return normalizeWorkerIdentity(value, "Connect command claim");
}

function normalizeCompletionInput(value = {}) {
  exactKeys(
    value,
    ["commandId", "leaseId", "outcome", "requestDigest", "workerId"],
    "Connect command completion"
  );
  const identity = normalizeWorkerIdentity(value, "Connect command completion");
  const requestDigest = String(value.requestDigest || "").trim().toLowerCase();
  if (!CONNECT_COMMAND_DIGEST_PATTERN.test(requestDigest)) {
    fail("invalid-argument", "Connect command completion requestDigest is invalid.");
  }
  return Object.freeze({
    ...identity,
    requestDigest,
    outcome: normalizeConnectCommandOutcome(value.outcome)
  });
}

function assertStoredLease(value = {}, command) {
  const attempt = Number(value.attempt);
  if (
    value.schemaVersion !== CONNECT_COMMAND_SCHEMA_VERSION
    || value.commandId !== command.commandId
    || value.requestDigest !== command.requestDigest
    || !SAFE_LEASE_ID_PATTERN.test(String(value.leaseId || ""))
    || !SAFE_WORKER_ID_PATTERN.test(String(value.workerId || ""))
    || !Number.isSafeInteger(attempt)
    || attempt < 1
    || !["leased", "completed"].includes(value.state)
    || !Number.isFinite(Date.parse(value.claimedAtISO || ""))
    || !Number.isFinite(Date.parse(value.expiresAtISO || ""))
  ) {
    fail("data-loss", "The stored Connect command lease is invalid.");
  }
  return Object.freeze({ ...value, attempt });
}

function sameOutcome(receipt, outcome) {
  return receipt.state === outcome.state
    && receipt.safeCode === outcome.safeCode
    && receipt.resultDigest === outcome.resultDigest
    && receipt.providerReferenceDigest === outcome.providerReferenceDigest;
}

async function runFailClosed(database, callback) {
  try {
    return await database.runTransaction(callback);
  } catch (error) {
    if (error instanceof StripeConnectInterfaceError) throw error;
    fail("internal", "The Connect worker transaction could not be verified.");
  }
}

function createConnectCommandWorker({
  database,
  now = () => Date.now(),
  leaseDurationSeconds = CONNECT_COMMAND_DEFAULT_LEASE_SECONDS,
  maxAttempts = CONNECT_COMMAND_DEFAULT_MAX_ATTEMPTS
} = {}) {
  const db = requireDatabase(database);
  if (typeof now !== "function") fail("internal", "The Connect worker clock is unavailable.");
  const leaseSeconds = safeInteger(leaseDurationSeconds, "leaseDurationSeconds", { min: 15, max: 300 });
  const attemptLimit = safeInteger(maxAttempts, "maxAttempts", { min: 1, max: 20 });

  async function claimCommand(value = {}) {
    const input = normalizeClaimInput(value);
    const clock = nowFromClock(now);
    const documents = refs(db, input.commandId);
    return runFailClosed(db, async (transaction) => {
      const [commandSnapshot, leaseSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(documents.command),
        transaction.get(documents.lease),
        transaction.get(documents.receipt)
      ]);
      const rawCommand = snapshotData(commandSnapshot);
      const rawLease = snapshotData(leaseSnapshot);
      const rawReceipt = snapshotData(receiptSnapshot);
      if (!rawCommand) {
        if (rawLease || rawReceipt) fail("data-loss", "Connect command state exists without its immutable command.");
        fail("not-found", "The Connect command does not exist.");
      }
      const command = assertStoredCommandMatches(rawCommand);
      if (rawReceipt) {
        const receipt = assertStoredTerminalReceipt(rawReceipt, command);
        return Object.freeze({ claimed: false, terminal: true, replayed: true, receipt });
      }

      const lease = rawLease ? assertStoredLease(rawLease, command) : null;
      const leaseExpiresAtMs = Date.parse(lease?.expiresAtISO || "");
      const activeLease = lease?.state === "leased" && leaseExpiresAtMs > clock.nowMs;
      if (activeLease) {
        if (lease.leaseId === input.leaseId && lease.workerId === input.workerId) {
          return Object.freeze({
            claimed: true,
            terminal: false,
            replayed: true,
            command,
            lease
          });
        }
        return Object.freeze({
          claimed: false,
          terminal: false,
          replayed: false,
          reason: "actively_leased",
          leaseExpiresAtISO: lease.expiresAtISO
        });
      }

      const priorAttempts = lease?.attempt || 0;
      if (priorAttempts >= attemptLimit) {
        const receipt = buildConnectCommandTerminalReceipt({
          command,
          outcome: {
            state: "dead_lettered",
            safeCode: "lease_attempts_exhausted",
            resultDigest: sha256(
              `connect-command-lease-attempts-exhausted-v${CONNECT_COMMAND_SCHEMA_VERSION}\n${command.commandId}\n${attemptLimit}`
            ),
            providerReferenceDigest: ""
          },
          completedAtISO: clock.nowISO
        });
        transaction.create(documents.receipt, receipt);
        transaction.set(documents.lease, {
          ...(lease || {}),
          schemaVersion: CONNECT_COMMAND_SCHEMA_VERSION,
          commandId: command.commandId,
          requestDigest: command.requestDigest,
          state: "completed",
          completedAtISO: clock.nowISO,
          receiptDigest: receipt.receiptDigest
        });
        return Object.freeze({ claimed: false, terminal: true, replayed: false, receipt });
      }

      const nextLease = Object.freeze({
        schemaVersion: CONNECT_COMMAND_SCHEMA_VERSION,
        commandId: command.commandId,
        requestDigest: command.requestDigest,
        state: "leased",
        workerId: input.workerId,
        leaseId: input.leaseId,
        attempt: priorAttempts + 1,
        claimedAtISO: clock.nowISO,
        expiresAtISO: new Date(clock.nowMs + leaseSeconds * 1000).toISOString()
      });
      transaction.set(documents.lease, nextLease);
      return Object.freeze({
        claimed: true,
        terminal: false,
        replayed: false,
        command,
        lease: nextLease
      });
    });
  }

  async function completeCommand(value = {}) {
    const input = normalizeCompletionInput(value);
    const clock = nowFromClock(now);
    const documents = refs(db, input.commandId);
    return runFailClosed(db, async (transaction) => {
      const [commandSnapshot, leaseSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(documents.command),
        transaction.get(documents.lease),
        transaction.get(documents.receipt)
      ]);
      const rawCommand = snapshotData(commandSnapshot);
      const rawLease = snapshotData(leaseSnapshot);
      const rawReceipt = snapshotData(receiptSnapshot);
      if (!rawCommand) fail("not-found", "The Connect command does not exist.");
      const command = assertStoredCommandMatches(rawCommand);
      if (command.requestDigest !== input.requestDigest) {
        fail("permission-denied", "The Connect command completion digest does not match its immutable request.");
      }
      if (rawReceipt) {
        const receipt = assertStoredTerminalReceipt(rawReceipt, command);
        if (!sameOutcome(receipt, input.outcome)) {
          fail("already-exists", "The Connect command already has a different terminal receipt.");
        }
        return Object.freeze({ replayed: true, receipt });
      }
      if (!rawLease) fail("failed-precondition", "The Connect command has no worker lease.");
      const lease = assertStoredLease(rawLease, command);
      if (
        lease.state !== "leased"
        || lease.leaseId !== input.leaseId
        || lease.workerId !== input.workerId
      ) {
        fail("permission-denied", "The Connect command completion does not own the active lease.");
      }
      if (Date.parse(lease.expiresAtISO) <= clock.nowMs) {
        fail("aborted", "The Connect command lease expired before completion.");
      }

      const receipt = buildConnectCommandTerminalReceipt({
        command,
        outcome: input.outcome,
        completedAtISO: clock.nowISO
      });
      transaction.create(documents.receipt, receipt);
      transaction.set(documents.lease, {
        ...lease,
        state: "completed",
        completedAtISO: clock.nowISO,
        receiptDigest: receipt.receiptDigest
      });
      return Object.freeze({ replayed: false, receipt });
    });
  }

  return Object.freeze({ claimCommand, completeCommand });
}

module.exports = {
  CONNECT_COMMAND_DEFAULT_LEASE_SECONDS,
  CONNECT_COMMAND_DEFAULT_MAX_ATTEMPTS,
  createConnectCommandWorker,
  normalizeClaimInput,
  normalizeCompletionInput
};
