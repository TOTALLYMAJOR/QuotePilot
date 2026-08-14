"use strict";

const {
  CONNECT_COMMAND_DIGEST_PATTERN,
  CONNECT_COMMAND_ID_PATTERN,
  CONNECT_COMMAND_SCHEMA_VERSION,
  StripeConnectInterfaceError,
  assertStoredCommandMatches,
  assertStoredTerminalReceipt,
  normalizeConnectCommandRequest,
  publicCommandAcknowledgement,
  safeISO
} = require("./connectCommandContracts");

const CONNECT_COMMAND_COLLECTIONS = Object.freeze({
  commands: "connectProviderCommands",
  leases: "connectProviderCommandLeases",
  receipts: "connectProviderCommandReceipts"
});

function fail(code, message) {
  throw new StripeConnectInterfaceError(code, message);
}

function requireDatabase(database) {
  if (!database || typeof database.doc !== "function" || typeof database.runTransaction !== "function") {
    fail("internal", "The isolated Connect command store is unavailable.");
  }
  return database;
}

function requireClock(now) {
  if (typeof now !== "function") fail("internal", "The Connect command clock is unavailable.");
  return now;
}

function nowISO(clock) {
  const nowMs = Number(clock());
  if (!Number.isFinite(nowMs)) fail("internal", "The Connect command clock is invalid.");
  return safeISO(new Date(nowMs).toISOString(), "queuedAtISO");
}

function snapshotData(snapshot) {
  return snapshot?.exists ? snapshot.data() : null;
}

function commandRef(database, commandId) {
  return database.doc(`${CONNECT_COMMAND_COLLECTIONS.commands}/${commandId}`);
}

function receiptRef(database, commandId) {
  return database.doc(`${CONNECT_COMMAND_COLLECTIONS.receipts}/${commandId}`);
}

function normalizeReceiptLookup(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-argument", "The Connect command receipt lookup is invalid.");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "commandId" || keys[1] !== "requestDigest") {
    fail("invalid-argument", "The Connect command receipt lookup contains unsupported fields.");
  }
  const commandId = String(value.commandId || "").trim().toLowerCase();
  const requestDigest = String(value.requestDigest || "").trim().toLowerCase();
  if (!CONNECT_COMMAND_ID_PATTERN.test(commandId) || !CONNECT_COMMAND_DIGEST_PATTERN.test(requestDigest)) {
    fail("invalid-argument", "The Connect command receipt identity is invalid.");
  }
  return Object.freeze({ commandId, requestDigest });
}

async function runFailClosed(database, callback) {
  try {
    return await database.runTransaction(callback);
  } catch (error) {
    if (error instanceof StripeConnectInterfaceError) throw error;
    fail("internal", "The Connect command transaction could not be verified.");
  }
}

function createConnectCommandEdge({ database, now = () => Date.now() } = {}) {
  const db = requireDatabase(database);
  const clock = requireClock(now);

  async function enqueueCommand(value = {}) {
    const normalized = normalizeConnectCommandRequest(value);
    const queuedAtISO = nowISO(clock);
    const immutableCommand = Object.freeze({
      ...normalized,
      state: "queued",
      queuedAtISO
    });
    const commandDocument = commandRef(db, normalized.commandId);
    const receiptDocument = receiptRef(db, normalized.commandId);

    return runFailClosed(db, async (transaction) => {
      const [commandSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(commandDocument),
        transaction.get(receiptDocument)
      ]);
      const existingCommand = snapshotData(commandSnapshot);
      const existingReceipt = snapshotData(receiptSnapshot);

      if (!existingCommand && existingReceipt) {
        fail("data-loss", "A Connect command receipt exists without its immutable command.");
      }
      if (existingCommand) {
        const stored = assertStoredCommandMatches(existingCommand, normalized);
        const receipt = existingReceipt
          ? assertStoredTerminalReceipt(existingReceipt, stored)
          : null;
        return publicCommandAcknowledgement(stored, { replayed: true, receipt });
      }

      transaction.create(commandDocument, immutableCommand);
      return publicCommandAcknowledgement(immutableCommand, { replayed: false });
    });
  }

  async function readTerminalReceipt(value = {}) {
    const lookup = normalizeReceiptLookup(value);
    return runFailClosed(db, async (transaction) => {
      const [commandSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(commandRef(db, lookup.commandId)),
        transaction.get(receiptRef(db, lookup.commandId))
      ]);
      const command = snapshotData(commandSnapshot);
      const receipt = snapshotData(receiptSnapshot);
      if (!command) {
        if (receipt) fail("data-loss", "A Connect command receipt exists without its immutable command.");
        return null;
      }
      const stored = assertStoredCommandMatches(command);
      if (stored.requestDigest !== lookup.requestDigest) {
        fail("permission-denied", "The Connect command receipt digest does not match its request.");
      }
      if (!receipt) return null;
      const terminal = assertStoredTerminalReceipt(receipt, stored);
      return Object.freeze({
        ...publicCommandAcknowledgement(stored, { replayed: true, receipt: terminal }),
        safeCode: terminal.safeCode,
        resultDigest: terminal.resultDigest,
        completedAtISO: terminal.completedAtISO
      });
    });
  }

  return Object.freeze({ enqueueCommand, readTerminalReceipt });
}

module.exports = {
  CONNECT_COMMAND_COLLECTIONS,
  CONNECT_COMMAND_SCHEMA_VERSION,
  createConnectCommandEdge,
  normalizeReceiptLookup
};
