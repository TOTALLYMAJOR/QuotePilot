import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildConnectCommandPayloadDigest,
  normalizeConnectCommandRequest,
  sha256
} = require("../../../functions-connect/connectCommandContracts.js");
const {
  CONNECT_COMMAND_COLLECTIONS,
  createConnectCommandEdge
} = require("../../../functions-connect/connectCommandEdge.js");
const {
  createConnectCommandWorker
} = require("../../../functions-connect/connectCommandWorker.js");

const NOW_MS = Date.parse("2026-08-14T12:00:00.000Z");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createMemoryFirestore() {
  const records = new Map();
  let transactionFailure = false;
  const snapshot = (ref, source) => ({
    exists: source.has(ref.path),
    data: () => clone(source.get(ref.path))
  });
  return {
    doc(pathValue) {
      return { path: String(pathValue) };
    },
    read(pathValue) {
      return clone(records.get(pathValue));
    },
    entries() {
      return [...records.entries()].map(([key, value]) => [key, clone(value)]);
    },
    setTransactionFailure(value) {
      transactionFailure = value === true;
    },
    async runTransaction(callback) {
      if (transactionFailure) throw new Error("simulated transaction outage");
      const view = new Map([...records.entries()].map(([key, value]) => [key, clone(value)]));
      const writes = [];
      const transaction = {
        async get(ref) {
          return snapshot(ref, view);
        },
        create(ref, value) {
          if (view.has(ref.path) || writes.some((write) => write.path === ref.path)) {
            throw new Error("document already exists");
          }
          writes.push({ path: ref.path, value: clone(value) });
        },
        set(ref, value) {
          writes.push({ path: ref.path, value: clone(value) });
        }
      };
      const result = await callback(transaction);
      for (const write of writes) records.set(write.path, clone(write.value));
      return result;
    }
  };
}

function commandRequest({
  operation = "create_merchant_account",
  requestId = "connect-command-request-0001",
  expectedRevision = 7,
  connectionGeneration = 2,
  payload = {
    authorityPayloadDigest: "9".repeat(64),
    configurationDigest: "a".repeat(64),
    contactEmailDigest: "b".repeat(64),
    reservationDigest: "8".repeat(64)
  }
} = {}) {
  return {
    organizationId: "org_alpha",
    operation,
    requestId,
    expectedRevision,
    connectionGeneration,
    payload,
    payloadDigest: buildConnectCommandPayloadDigest({ operation, payload })
  };
}

function outcome(overrides = {}) {
  return {
    state: "succeeded",
    safeCode: "provider_bound",
    resultDigest: "c".repeat(64),
    providerReferenceDigest: "d".repeat(64),
    ...overrides
  };
}

describe("deploy-dormant Connect command contracts", () => {
  test("derives deterministic payload, request, command, and provider idempotency identities", () => {
    const first = normalizeConnectCommandRequest(commandRequest());
    const reorderedPayload = {
      reservationDigest: "8".repeat(64),
      contactEmailDigest: "b".repeat(64),
      configurationDigest: "a".repeat(64),
      authorityPayloadDigest: "9".repeat(64)
    };
    const replay = normalizeConnectCommandRequest(commandRequest({ payload: reorderedPayload }));

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      commandId: expect.stringMatching(/^[a-f0-9]{64}$/),
      payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      providerIdempotencyKey: expect.stringMatching(/^qpcmd_[a-f0-9]{64}$/)
    });
    expect(normalizeConnectCommandRequest(commandRequest({
      requestId: "connect-command-request-0002"
    })).providerIdempotencyKey).not.toBe(first.providerIdempotencyKey);
  });

  test("rejects an incorrect caller payload digest before any transaction", async () => {
    const database = createMemoryFirestore();
    const edge = createConnectCommandEdge({ database, now: () => NOW_MS });
    const input = commandRequest();
    input.payloadDigest = "f".repeat(64);

    await expect(edge.enqueueCommand(input)).rejects.toMatchObject({ code: "invalid-argument" });
    expect(database.entries()).toEqual([]);
  });
});

describe("Connect edge command enqueue and replay", () => {
  let database;
  let edge;

  beforeEach(() => {
    database = createMemoryFirestore();
    edge = createConnectCommandEdge({ database, now: () => NOW_MS });
  });

  test("creates one immutable command and replays the exact acknowledgement transactionally", async () => {
    const input = commandRequest();
    const first = await edge.enqueueCommand(input);
    const commandPath = `${CONNECT_COMMAND_COLLECTIONS.commands}/${first.commandId}`;
    const immutableCommand = database.read(commandPath);
    const replay = await edge.enqueueCommand(input);

    expect(first).toMatchObject({ state: "queued", replayed: false });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(database.read(commandPath)).toEqual(immutableCommand);
    expect(database.entries().filter(([entryPath]) => (
      entryPath.startsWith(`${CONNECT_COMMAND_COLLECTIONS.commands}/`)
    ))).toHaveLength(1);
  });

  test("fails closed when one request ID is reused with a different exact digest", async () => {
    const firstInput = commandRequest();
    const first = await edge.enqueueCommand(firstInput);
    const commandPath = `${CONNECT_COMMAND_COLLECTIONS.commands}/${first.commandId}`;
    const before = database.read(commandPath);
    const conflictingPayload = {
      authorityPayloadDigest: "9".repeat(64),
      configurationDigest: "e".repeat(64),
      contactEmailDigest: "b".repeat(64),
      reservationDigest: "8".repeat(64)
    };
    const conflictingInput = commandRequest({ payload: conflictingPayload });

    await expect(edge.enqueueCommand(conflictingInput)).rejects.toMatchObject({
      code: "already-exists"
    });
    expect(database.read(commandPath)).toEqual(before);
  });

  test("binds each organization request ID across operations, not only within one operation", async () => {
    const first = await edge.enqueueCommand(commandRequest());
    const refreshPayload = {
      accountBindingDigest: "f".repeat(64),
      authorityPayloadDigest: "9".repeat(64)
    };
    const conflictingOperation = commandRequest({
      operation: "refresh_merchant_account",
      payload: refreshPayload
    });

    await expect(edge.enqueueCommand(conflictingOperation)).rejects.toMatchObject({
      code: "already-exists"
    });
    expect(database.entries().filter(([entryPath]) => (
      entryPath.startsWith(`${CONNECT_COMMAND_COLLECTIONS.commands}/`)
    ))).toHaveLength(1);
    expect(database.read(`${CONNECT_COMMAND_COLLECTIONS.commands}/${first.commandId}`))
      .toMatchObject({ operation: "create_merchant_account" });
  });

  test("contains no Stripe SDK or provider-operation call path", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "functions-connect/connectCommandEdge.js"),
      "utf8"
    );
    expect(source).not.toMatch(/require\(["']stripe["']\)|new\s+Stripe\s*\(|stripeClient/);
    expect(source).not.toMatch(/createMerchantAccount|retrieveMerchantAccount|createAccountLink/);
  });

  test("fails closed when the transaction store is unavailable", async () => {
    database.setTransactionFailure(true);
    await expect(edge.enqueueCommand(commandRequest())).rejects.toMatchObject({ code: "internal" });
    expect(database.entries()).toEqual([]);
  });
});

describe("Connect worker command leases and terminal receipts", () => {
  let database;
  let clockMs;
  let edge;
  let worker;
  let acknowledgement;
  let immutableCommand;

  beforeEach(async () => {
    database = createMemoryFirestore();
    clockMs = NOW_MS;
    edge = createConnectCommandEdge({ database, now: () => clockMs });
    worker = createConnectCommandWorker({
      database,
      now: () => clockMs,
      leaseDurationSeconds: 60,
      maxAttempts: 3
    });
    acknowledgement = await edge.enqueueCommand(commandRequest());
    immutableCommand = database.read(
      `${CONNECT_COMMAND_COLLECTIONS.commands}/${acknowledgement.commandId}`
    );
  });

  test("replays an owned lease, rejects another active claimant, and recovers after expiry", async () => {
    const firstIdentity = {
      commandId: acknowledgement.commandId,
      workerId: "connect_worker_one",
      leaseId: "worker-one-lease-000001"
    };
    const first = await worker.claimCommand(firstIdentity);
    const replay = await worker.claimCommand(firstIdentity);
    const blocked = await worker.claimCommand({
      commandId: acknowledgement.commandId,
      workerId: "connect_worker_two",
      leaseId: "worker-two-lease-000001"
    });

    expect(first).toMatchObject({ claimed: true, replayed: false, lease: { attempt: 1 } });
    expect(replay).toMatchObject({ claimed: true, replayed: true, lease: { attempt: 1 } });
    expect(blocked).toMatchObject({ claimed: false, reason: "actively_leased" });

    clockMs += 60_001;
    const recovered = await worker.claimCommand({
      commandId: acknowledgement.commandId,
      workerId: "connect_worker_two",
      leaseId: "worker-two-lease-000002"
    });
    expect(recovered).toMatchObject({ claimed: true, replayed: false, lease: { attempt: 2 } });
    expect(recovered.command.providerIdempotencyKey)
      .toBe(first.command.providerIdempotencyKey);
    expect(database.read(`${CONNECT_COMMAND_COLLECTIONS.commands}/${acknowledgement.commandId}`))
      .toEqual(immutableCommand);
  });

  test("requires the immutable request digest and exact unexpired lease for completion", async () => {
    const identity = {
      commandId: acknowledgement.commandId,
      workerId: "connect_worker_one",
      leaseId: "worker-one-lease-000001"
    };
    await worker.claimCommand(identity);
    await expect(worker.completeCommand({
      ...identity,
      requestDigest: "f".repeat(64),
      outcome: outcome()
    })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(worker.completeCommand({
      ...identity,
      workerId: "connect_worker_two",
      requestDigest: acknowledgement.requestDigest,
      outcome: outcome()
    })).rejects.toMatchObject({ code: "permission-denied" });

    clockMs += 60_001;
    await expect(worker.completeCommand({
      ...identity,
      requestDigest: acknowledgement.requestDigest,
      outcome: outcome()
    })).rejects.toMatchObject({ code: "aborted" });
  });

  test("creates one immutable terminal receipt and safely replays the same completion", async () => {
    const identity = {
      commandId: acknowledgement.commandId,
      workerId: "connect_worker_one",
      leaseId: "worker-one-lease-000001"
    };
    await worker.claimCommand(identity);
    const completionInput = {
      ...identity,
      requestDigest: acknowledgement.requestDigest,
      outcome: outcome()
    };
    const first = await worker.completeCommand(completionInput);
    const receiptPath = `${CONNECT_COMMAND_COLLECTIONS.receipts}/${acknowledgement.commandId}`;
    const immutableReceipt = database.read(receiptPath);
    const replay = await worker.completeCommand(completionInput);

    expect(first).toMatchObject({
      replayed: false,
      receipt: {
        state: "succeeded",
        safeCode: "provider_bound",
        receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    expect(replay).toEqual({ replayed: true, receipt: first.receipt });
    expect(database.read(receiptPath)).toEqual(immutableReceipt);
    expect(database.read(`${CONNECT_COMMAND_COLLECTIONS.commands}/${acknowledgement.commandId}`))
      .toEqual(immutableCommand);

    await expect(worker.completeCommand({
      ...completionInput,
      outcome: outcome({ safeCode: "different_terminal_outcome" })
    })).rejects.toMatchObject({ code: "already-exists" });

    await expect(worker.claimCommand({
      commandId: acknowledgement.commandId,
      workerId: "connect_worker_two",
      leaseId: "worker-two-lease-000001"
    })).resolves.toMatchObject({
      claimed: false,
      terminal: true,
      replayed: true,
      receipt: { receiptDigest: first.receipt.receiptDigest }
    });

    await expect(edge.readTerminalReceipt({
      commandId: acknowledgement.commandId,
      requestDigest: acknowledgement.requestDigest
    })).resolves.toMatchObject({
      state: "succeeded",
      safeCode: "provider_bound",
      resultDigest: "c".repeat(64),
      receiptDigest: first.receipt.receiptDigest
    });
  });

  test("dead-letters after the fixed stale-lease attempt limit without changing the command", async () => {
    worker = createConnectCommandWorker({
      database,
      now: () => clockMs,
      leaseDurationSeconds: 15,
      maxAttempts: 2
    });
    await worker.claimCommand({
      commandId: acknowledgement.commandId,
      workerId: "connect_worker_one",
      leaseId: "worker-one-lease-000001"
    });
    clockMs += 15_001;
    await worker.claimCommand({
      commandId: acknowledgement.commandId,
      workerId: "connect_worker_two",
      leaseId: "worker-two-lease-000002"
    });
    clockMs += 15_001;
    const exhausted = await worker.claimCommand({
      commandId: acknowledgement.commandId,
      workerId: "connect_worker_three",
      leaseId: "worker-three-lease-0003"
    });

    expect(exhausted).toMatchObject({
      claimed: false,
      terminal: true,
      replayed: false,
      receipt: {
        state: "dead_lettered",
        safeCode: "lease_attempts_exhausted",
        resultDigest: sha256(
          `connect-command-lease-attempts-exhausted-v1\n${acknowledgement.commandId}\n2`
        )
      }
    });
    expect(database.read(`${CONNECT_COMMAND_COLLECTIONS.commands}/${acknowledgement.commandId}`))
      .toEqual(immutableCommand);
  });

  test("fails closed when worker claim persistence is unavailable", async () => {
    database.setTransactionFailure(true);
    await expect(worker.claimCommand({
      commandId: acknowledgement.commandId,
      workerId: "connect_worker_one",
      leaseId: "worker-one-lease-000001"
    })).rejects.toMatchObject({ code: "internal" });
  });
});
