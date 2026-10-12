import { describe, expect, test, vi } from "vitest";
import {
  buildInventoryReceivingLineId,
  confirmInventoryReceivingReceipts,
  createInventoryReceivingLine,
  reconcileInventoryReceivingLine,
  retryInventoryReceivingLine,
  submitInventoryReceivingBatch
} from "../inventoryReceivingBatch";

function command(ingredientId) {
  return {
    kind: "receive_stock",
    ingredientId,
    locationId: "kitchen-main",
    quantity: "4",
    baseUnitId: "lb",
    occurredAtISO: "2026-10-11T01:00:00.000Z",
    sourceLabel: `Receipt ${ingredientId}`,
    note: "",
    expectedStockRevision: 2,
    expectedCostRevision: 1,
    cost: { availability: "not_yet_available" }
  };
}

function receipt(requestId, ingredientId, stockRevision = 3) {
  return {
    receipt: {
      organizationId: "org-one",
      requestId,
      receiptId: `iar_${ingredientId.padEnd(48, "a").slice(0, 48)}`,
      commandKind: "receive_stock",
      recordedAtISO: "2026-10-11T01:01:00.000Z"
    },
    confirmation: {
      ingredientId,
      movementId: `imv_${ingredientId.padEnd(48, "b").slice(0, 48)}`,
      stockRevision,
      costRevision: 1
    }
  };
}

describe("inventory receiving batch", () => {
  test("builds stable cryptographic line identities", () => {
    const cryptoProvider = { getRandomValues: (bytes) => bytes.fill(7) };

    expect(buildInventoryReceivingLineId(cryptoProvider)).toBe(
      "inventory_receiving_line_07070707070707070707070707070707"
    );
  });

  test("submits draft lines sequentially and preserves independent outcomes", async () => {
    const first = createInventoryReceivingLine({ lineId: "line-one", command: command("flour") });
    const second = createInventoryReceivingLine({ lineId: "line-two", command: command("butter") });
    const updates = [];
    let active = 0;
    let highestActive = 0;
    const submitCommand = vi.fn(async ({ requestId, command: submitted }) => {
      active += 1;
      highestActive = Math.max(highestActive, active);
      await Promise.resolve();
      active -= 1;
      if (submitted.ingredientId === "flour") {
        throw Object.assign(new Error("The stock revision changed."), { code: "failed-precondition" });
      }
      return receipt(requestId, submitted.ingredientId);
    });
    const requestIds = ["inventory_request_11111111111111111111111111111111", "inventory_request_22222222222222222222222222222222"];

    const result = await submitInventoryReceivingBatch({
      lines: [first, second],
      scope: { organizationId: "org-one", role: "admin", browserEnabled: true, tenantEnabled: true },
      submitCommand,
      createRequestId: () => requestIds.shift(),
      isDefinitiveError: (error) => error.code === "failed-precondition",
      onLineState: (line) => updates.push(line)
    });

    expect(highestActive).toBe(1);
    expect(submitCommand).toHaveBeenCalledTimes(2);
    expect(result.map((line) => [line.lineId, line.state])).toEqual([
      ["line-one", "definitive_failure"],
      ["line-two", "receipt"]
    ]);
    expect(result[0].requestId).toBe("inventory_request_11111111111111111111111111111111");
    expect(result[1].receipt.requestId).toBe("inventory_request_22222222222222222222222222222222");
    expect(updates.map((line) => `${line.lineId}:${line.state}`)).toEqual([
      "line-one:submitting",
      "line-one:definitive_failure",
      "line-two:submitting",
      "line-two:receipt"
    ]);
  });

  test("reconciles uncertainty with the unchanged request identity", async () => {
    const line = {
      ...createInventoryReceivingLine({ lineId: "line-one", command: command("flour") }),
      state: "uncertain",
      requestId: "inventory_request_33333333333333333333333333333333",
      error: "Outcome unknown"
    };
    const reconcileCommand = vi.fn(async ({ requestId }) => receipt(requestId, "flour"));
    const updates = [];

    const result = await reconcileInventoryReceivingLine({
      line,
      scope: { organizationId: "org-one" },
      reconcileCommand,
      isDefinitiveError: () => false,
      onLineState: (next) => updates.push(next)
    });

    expect(reconcileCommand).toHaveBeenCalledWith({
      organizationId: "org-one",
      requestId: line.requestId
    });
    expect(result.state).toBe("receipt");
    expect(result.requestId).toBe(line.requestId);
    expect(updates.map((entry) => entry.state)).toEqual(["reconciliation", "receipt"]);
  });

  test("retries only a definitive failure with the same request and command", async () => {
    const requestId = "inventory_request_44444444444444444444444444444444";
    const line = {
      ...createInventoryReceivingLine({ lineId: "line-one", command: command("flour") }),
      state: "definitive_failure",
      requestId,
      error: "Rejected"
    };
    const resetCommand = vi.fn(() => true);
    const submitCommand = vi.fn(async () => receipt(requestId, "flour"));

    const result = await retryInventoryReceivingLine({
      line,
      scope: { organizationId: "org-one" },
      resetCommand,
      submitCommand,
      isDefinitiveError: () => true
    });

    expect(resetCommand).toHaveBeenCalledWith({ organizationId: "org-one", requestId });
    expect(submitCommand).toHaveBeenCalledWith({
      organizationId: "org-one",
      requestId,
      command: line.command
    });
    expect(result.state).toBe("receipt");

    await expect(retryInventoryReceivingLine({
      line: { ...line, state: "uncertain" },
      scope: { organizationId: "org-one" },
      resetCommand,
      submitCommand,
      isDefinitiveError: () => true
    })).rejects.toMatchObject({ code: "failed-precondition" });
  });

  test("locks receipt and committed lines and never replays them in a later batch", async () => {
    const requestId = "inventory_request_55555555555555555555555555555555";
    const received = {
      ...createInventoryReceivingLine({ lineId: "line-one", command: command("flour") }),
      state: "receipt",
      requestId,
      ...receipt(requestId, "flour")
    };
    const committed = {
      ...received,
      lineId: "line-committed",
      state: "committed"
    };
    const draft = createInventoryReceivingLine({ lineId: "line-two", command: command("butter") });
    const submitCommand = vi.fn(async ({ requestId: nextRequestId }) => receipt(nextRequestId, "butter"));

    const result = await submitInventoryReceivingBatch({
      lines: [received, committed, draft],
      scope: { organizationId: "org-one" },
      submitCommand,
      createRequestId: () => "inventory_request_66666666666666666666666666666666",
      isDefinitiveError: () => true
    });

    expect(submitCommand).toHaveBeenCalledTimes(1);
    expect(submitCommand.mock.calls[0][0].command.ingredientId).toBe("butter");
    expect(result[0]).toEqual(received);
    expect(result[1]).toEqual(committed);
  });

  test("marks a receipt committed only when the exact current projection confirms it", () => {
    const requestId = "inventory_request_77777777777777777777777777777777";
    const line = {
      ...createInventoryReceivingLine({ lineId: "line-one", command: command("flour") }),
      state: "receipt",
      requestId,
      ...receipt(requestId, "flour")
    };
    const confirmsReceipt = vi.fn((model, attempt) => (
      model.freshness === "current" && attempt.confirmation.stockRevision === 3
    ));

    expect(confirmInventoryReceivingReceipts([line], { freshness: "cached" }, confirmsReceipt)[0].state).toBe("receipt");
    expect(confirmInventoryReceivingReceipts([line], { freshness: "current" }, confirmsReceipt)[0].state).toBe("committed");
  });
});
