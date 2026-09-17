import { describe, expect, test, vi } from "vitest";

import {
  INVENTORY_CAPTURE_DRAFT_TTL_MS,
  createInventoryCaptureDraft,
  discardInventoryCaptureDraft,
  listInventoryCaptureDrafts,
  submitInventoryCaptureDraft,
  updateInventoryCaptureDraft
} from "../inventoryCaptureDraft";

function memoryStore() {
  const records = new Map();
  let tail = Promise.resolve();
  const serialized = (operation) => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  return {
    records,
    async get(key) { return records.get(key) || null; },
    create(value) {
      return serialized(() => {
        if (records.has(value.key)) throw Object.assign(new Error("exists"), { code: "already-exists" });
        records.set(value.key, structuredClone(value));
        return value;
      });
    },
    compareAndSwap(key, expectedRevision, nextValue) {
      return serialized(() => {
        const current = records.get(key);
        if (!current) throw Object.assign(new Error("missing"), { code: "not-found" });
        if (current.draftRevision !== expectedRevision) throw Object.assign(new Error("changed"), { code: "conflict" });
        if (nextValue === null) records.delete(key);
        else records.set(key, structuredClone(nextValue));
        return nextValue;
      });
    },
    async list() { return [...records.values()].map((value) => structuredClone(value)); }
  };
}

function captureLine(overrides = {}) {
  const ingredientId = overrides.ingredientId || "chicken";
  const locationId = overrides.locationId || scope.locationId;
  const baseUnitId = overrides.baseUnitId || "lb";
  const countedQuantity = overrides.countedQuantity || "12.5";
  const occurredAtISO = overrides.occurredAtISO || "2026-09-17T14:00:00.000Z";
  const expectedStockRevision = overrides.expectedStockRevision || 4;
  return {
    lineId: overrides.lineId || `line-${ingredientId}`,
    ingredientId,
    ingredientName: overrides.ingredientName || ingredientId,
    baseUnitId,
    countedQuantity,
    note: overrides.note || "",
    occurredAtISO,
    expectedStockRevision,
    requestId: overrides.requestId || `inventory_request_${(ingredientId === "chicken" ? "1" : ingredientId === "pasta" ? "2" : "3").repeat(32)}`,
    command: {
      kind: "record_stock_count",
      ingredientId,
      locationId,
      baseUnitId,
      countedQuantity,
      occurredAtISO,
      note: overrides.note || "",
      expectedStockRevision
    },
    state: overrides.state || "draft",
    ...overrides
  };
}

const scope = Object.freeze({ organizationId: "org-a", userId: "user-a", locationId: "kitchen" });
const now = Date.parse("2026-09-17T14:00:00.000Z");

describe("inventory-capture-draft-v1", () => {
  test("restores an unstarted line when scope changes during its durable claim", async () => {
    const store = memoryStore();
    let current = true;
    const compareAndSwap = store.compareAndSwap;
    store.compareAndSwap = async (...args) => {
      const value = await compareAndSwap(...args);
      if (value?.lines.some((line) => line.inFlight)) current = false;
      return value;
    };
    await createInventoryCaptureDraft({ ...scope, draftId: "scope-during-claim", now, lines: [captureLine()] }, { store });
    const submitLine = vi.fn();
    const result = await submitInventoryCaptureDraft({
      ...scope, draftId: "scope-during-claim", now: now + 1000, online: true,
      scopeIsCurrent: () => current,
      currentInventory: [{ ingredientId: "chicken", locationId: scope.locationId, baseUnitId: "lb", stockRevision: 4 }],
      submitLine
    }, { store });
    expect(submitLine).not.toHaveBeenCalled();
    expect(result.lines[0]).toMatchObject({ state: "draft", inFlight: false, requestId: captureLine().requestId, command: captureLine().command });
  });

  test("creates, updates, lists, expires, and discards only exact organization/user/location scope", async () => {
    const store = memoryStore();
    const draft = await createInventoryCaptureDraft({
      ...scope,
      draftId: "draft-a",
      now,
      lines: [captureLine({ ingredientName: "Chicken", note: "Walk-in shelf" })]
    }, { store });

    expect(Date.parse(draft.expiresAtISO) - Date.parse(draft.createdAtISO)).toBe(INVENTORY_CAPTURE_DRAFT_TTL_MS);
    await createInventoryCaptureDraft({ ...scope, userId: "user-b", draftId: "foreign", now, lines: [] }, { store });
    const updated = await updateInventoryCaptureDraft({
      ...scope,
      draftId: "draft-a",
      now: now + 1000,
      expectedDraftRevision: draft.draftRevision,
      expectedLineRevision: draft.lines[0].lineRevision,
      line: captureLine({ countedQuantity: "13", note: "Second pass", requestId: `inventory_request_${"4".repeat(32)}` })
    }, { store });

    await expect(listInventoryCaptureDrafts({ ...scope, now: now + 2000 }, { store }))
      .resolves.toMatchObject([{ draftId: "draft-a", lines: [{ countedQuantity: "13", note: "Second pass" }] }]);
    await expect(listInventoryCaptureDrafts({ ...scope, userId: "user-b", now: now + 2000 }, { store }))
      .resolves.toMatchObject([{ draftId: "foreign" }]);
    await discardInventoryCaptureDraft({ ...scope, draftId: "draft-a", expectedDraftRevision: updated.draftRevision }, { store });
    await expect(listInventoryCaptureDrafts({ ...scope, now: now + 3000 }, { store })).resolves.toEqual([]);

    await createInventoryCaptureDraft({ ...scope, draftId: "expired", now, lines: [] }, { store });
    await expect(listInventoryCaptureDrafts({ ...scope, now: now + INVENTORY_CAPTURE_DRAFT_TTL_MS + 1 }, { store }))
      .resolves.toEqual([]);
  });

  test("submits clean lines independently and retains receipts, revision conflicts, and partial failures", async () => {
    const store = memoryStore();
    const submitLine = vi.fn()
      .mockResolvedValueOnce({ receipt: { receiptId: "receipt-chicken" }, confirmation: { stockRevision: 5 } })
      .mockRejectedValueOnce(Object.assign(new Error("Temporary network interruption"), { code: "unavailable" }));
    await createInventoryCaptureDraft({
      ...scope,
      draftId: "draft-submit",
      now,
      lines: [
        captureLine({ lineId: "chicken", ingredientName: "Chicken", countedQuantity: "11" }),
        captureLine({ lineId: "pasta", ingredientId: "pasta", ingredientName: "Pasta", countedQuantity: "8", note: "Dry shelf", occurredAtISO: "2026-09-17T14:00:01.000Z", expectedStockRevision: 2 }),
        captureLine({ lineId: "rice", ingredientId: "rice", ingredientName: "Rice", countedQuantity: "9", occurredAtISO: "2026-09-17T14:00:02.000Z", expectedStockRevision: 1 })
      ]
    }, { store });

    const result = await submitInventoryCaptureDraft({
      ...scope,
      draftId: "draft-submit",
      now: now + 1000,
      online: true,
      currentInventory: [
        { ingredientId: "chicken", locationId: "kitchen", baseUnitId: "lb", stockRevision: 4 },
        { ingredientId: "pasta", locationId: "kitchen", baseUnitId: "lb", stockRevision: 2 },
        { ingredientId: "rice", locationId: "kitchen", baseUnitId: "lb", stockRevision: 3 }
      ],
      submitLine
    }, { store });

    expect(submitLine).toHaveBeenCalledTimes(2);
    expect(submitLine).toHaveBeenNthCalledWith(1, expect.objectContaining({
      requestId: `inventory_request_${"1".repeat(32)}`,
      command: expect.objectContaining({
        kind: "record_stock_count",
        ingredientId: "chicken",
        countedQuantity: "11",
        occurredAtISO: "2026-09-17T14:00:00.000Z",
        expectedStockRevision: 4
      })
    }));
    expect(result.status).toBe("partial");
    expect(result.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientId: "chicken", state: "submitted", receiptId: "receipt-chicken" }),
      expect.objectContaining({ ingredientId: "pasta", state: "uncertain" }),
      expect.objectContaining({ ingredientId: "rice", state: "conflict", currentStockRevision: 3 })
    ]));
  });

  test("keeps offline drafts local and never dispatches a stock command", async () => {
    const store = memoryStore();
    const submitLine = vi.fn();
    await createInventoryCaptureDraft({
      ...scope,
      draftId: "offline",
      now,
      lines: [captureLine({ lineId: "line", countedQuantity: "10" })]
    }, { store });
    await expect(submitInventoryCaptureDraft({
      ...scope,
      draftId: "offline",
      now: now + 1000,
      online: false,
      currentInventory: [{ ingredientId: "chicken", locationId: "kitchen", baseUnitId: "lb", stockRevision: 4 }],
      submitLine
    }, { store })).rejects.toMatchObject({ code: "offline" });
    expect(submitLine).not.toHaveBeenCalled();
  });

  test("merges concurrent line updates without losing another tab's new ingredient", async () => {
    const store = memoryStore();
    const created = await createInventoryCaptureDraft({ ...scope, draftId: "concurrent", now, lines: [captureLine()] }, { store });

    await Promise.all([
      updateInventoryCaptureDraft({
        ...scope,
        draftId: created.draftId,
        expectedDraftRevision: created.draftRevision,
        now: now + 1000,
        line: captureLine({ ingredientId: "pasta", countedQuantity: "8", expectedStockRevision: 2 })
      }, { store }),
      updateInventoryCaptureDraft({
        ...scope,
        draftId: created.draftId,
        expectedDraftRevision: created.draftRevision,
        now: now + 2000,
        line: captureLine({ ingredientId: "rice", countedQuantity: "9", expectedStockRevision: 1 })
      }, { store })
    ]);

    const [current] = await listInventoryCaptureDrafts({ ...scope, now: now + 3000 }, { store });
    expect(current.draftRevision).toBe(3);
    expect(current.lines.map((line) => line.ingredientId).sort()).toEqual(["chicken", "pasta", "rice"]);
  });

  test("persists a successful receipt before dispatching the next independent line", async () => {
    const store = memoryStore();
    let releaseSecond;
    const second = new Promise((resolve) => { releaseSecond = resolve; });
    const submitLine = vi.fn()
      .mockResolvedValueOnce({ receipt: { receiptId: "receipt-chicken" }, confirmation: { stockRevision: 5 } })
      .mockImplementationOnce(() => second);
    await createInventoryCaptureDraft({
      ...scope,
      draftId: "incremental",
      now,
      lines: [captureLine(), captureLine({ ingredientId: "pasta", expectedStockRevision: 2 })]
    }, { store });

    const submission = submitInventoryCaptureDraft({
      ...scope,
      draftId: "incremental",
      now: now + 1000,
      online: true,
      currentInventory: [
        { ingredientId: "chicken", locationId: "kitchen", baseUnitId: "lb", stockRevision: 4 },
        { ingredientId: "pasta", locationId: "kitchen", baseUnitId: "lb", stockRevision: 2 }
      ],
      submitLine
    }, { store });
    await vi.waitFor(() => expect(submitLine).toHaveBeenCalledTimes(2));
    const [during] = await listInventoryCaptureDrafts({ ...scope, now: now + 1500 }, { store });
    expect(during.lines.find((line) => line.ingredientId === "chicken")).toMatchObject({ state: "submitted", receiptId: "receipt-chicken" });
    releaseSecond({ receipt: { receiptId: "receipt-pasta" }, confirmation: { stockRevision: 3 } });
    await submission;
  });

  test("persists exact request identity, reconciles uncertainty, and rejects mismatched location evidence", async () => {
    const store = memoryStore();
    const line = captureLine();
    await createInventoryCaptureDraft({ ...scope, draftId: "uncertain", now, lines: [line] }, { store });
    const unavailable = Object.assign(new Error("<gateway>\nConnection ended"), { code: "unavailable", inventoryDefinitive: false });
    const submitLine = vi.fn().mockRejectedValueOnce(unavailable);
    const first = await submitInventoryCaptureDraft({
      ...scope,
      draftId: "uncertain",
      now: now + 1000,
      online: true,
      currentInventory: [{ ingredientId: "chicken", locationId: "kitchen", baseUnitId: "lb", stockRevision: 4 }],
      submitLine
    }, { store });
    expect(first.lines[0]).toMatchObject({ state: "uncertain", requestId: line.requestId, command: line.command, error: "gateway Connection ended" });

    const reconcileLine = vi.fn().mockResolvedValue({ receipt: { receiptId: "receipt-reconciled" }, confirmation: { stockRevision: 5 } });
    const reconciled = await submitInventoryCaptureDraft({
      ...scope,
      draftId: "uncertain",
      now: now + 2000,
      online: true,
      reconcileUncertain: true,
      currentInventory: [{ ingredientId: "chicken", locationId: "kitchen", baseUnitId: "lb", stockRevision: 5 }],
      submitLine,
      reconcileLine
    }, { store });
    expect(reconcileLine).toHaveBeenCalledWith({ requestId: line.requestId, command: line.command });
    expect(reconciled.lines[0]).toMatchObject({ state: "submitted", receiptId: "receipt-reconciled", stockRevision: 5 });

    await createInventoryCaptureDraft({ ...scope, draftId: "wrong-location", now, lines: [captureLine()] }, { store });
    const conflict = await submitInventoryCaptureDraft({
      ...scope,
      draftId: "wrong-location",
      now: now + 3000,
      online: true,
      currentInventory: [{ ingredientId: "chicken", locationId: "other-kitchen", baseUnitId: "lb", stockRevision: 4 }],
      submitLine
    }, { store });
    expect(conflict.lines[0]).toMatchObject({ state: "conflict" });
    expect(submitLine).toHaveBeenCalledTimes(1);
  });

  test("refuses ordinary replacement while the exact same line request is in flight", async () => {
    const store = memoryStore();
    const original = captureLine();
    await createInventoryCaptureDraft({ ...scope, draftId: "pending-replacement", now, lines: [original] }, { store });
    let resolveSubmission;
    const submitLine = vi.fn(() => new Promise((resolve) => { resolveSubmission = resolve; }));
    const submission = submitInventoryCaptureDraft({
      ...scope,
      draftId: "pending-replacement",
      now: now + 1000,
      online: true,
      currentInventory: [{ ingredientId: "chicken", locationId: "kitchen", baseUnitId: "lb", stockRevision: 4 }],
      submitLine
    }, { store });
    await vi.waitFor(() => expect(submitLine).toHaveBeenCalledTimes(1));
    const [pending] = await listInventoryCaptureDrafts({ ...scope, now: now + 1500 }, { store });
    const pendingLine = pending.lines[0];
    expect(pendingLine).toMatchObject({ state: "uncertain", inFlight: true, requestId: original.requestId });

    await expect(updateInventoryCaptureDraft({
      ...scope,
      draftId: pending.draftId,
      now: now + 1600,
      expectedDraftRevision: pending.draftRevision,
      expectedLineRevision: pendingLine.lineRevision || 1,
      line: captureLine({ countedQuantity: "13", requestId: `inventory_request_${"8".repeat(32)}` })
    }, { store })).rejects.toMatchObject({ code: "conflict" });

    resolveSubmission({ receipt: { receiptId: "receipt-original" }, confirmation: { stockRevision: 5 } });
    const completed = await submission;
    expect(completed.lines[0]).toMatchObject({
      state: "submitted",
      requestId: original.requestId,
      receiptId: "receipt-original",
      countedQuantity: original.countedQuantity
    });
  });

  test("requires an explicit reset and preserves the predecessor receipt before a new count", async () => {
    const store = memoryStore();
    const submittedLine = captureLine({
      state: "submitted",
      receiptId: "receipt-first-count",
      stockRevision: 5
    });
    const created = await createInventoryCaptureDraft({
      ...scope,
      draftId: "submitted-reset",
      now,
      lines: [submittedLine]
    }, { store });
    const replacement = captureLine({
      countedQuantity: "14",
      expectedStockRevision: 5,
      occurredAtISO: "2026-09-17T15:00:00.000Z",
      requestId: `inventory_request_${"9".repeat(32)}`
    });
    await expect(updateInventoryCaptureDraft({
      ...scope,
      draftId: created.draftId,
      expectedDraftRevision: created.draftRevision,
      expectedLineRevision: created.lines[0].lineRevision,
      line: replacement
    }, { store })).rejects.toMatchObject({ code: "conflict" });

    const reset = await updateInventoryCaptureDraft({
      ...scope,
      draftId: created.draftId,
      now: now + 1000,
      expectedDraftRevision: created.draftRevision,
      expectedLineRevision: created.lines[0].lineRevision,
      resolution: "reset",
      line: replacement
    }, { store });
    expect(reset.lines[0]).toMatchObject({
      state: "draft",
      requestId: replacement.requestId,
      lineRevision: 2,
      previousAttempts: [{
        requestId: submittedLine.requestId,
        state: "submitted",
        command: submittedLine.command,
        receiptId: "receipt-first-count",
        stockRevision: 5,
        resolvedAtISO: "2026-09-17T14:00:01.000Z"
      }]
    });
  });

  test("normalizes a pre-line-revision device draft before its next mutation", async () => {
    const store = memoryStore();
    const created = await createInventoryCaptureDraft({
      ...scope,
      draftId: "legacy-line",
      now,
      lines: [captureLine()]
    }, { store });
    const legacy = structuredClone(store.records.get(created.key));
    delete legacy.lines[0].lineRevision;
    delete legacy.lines[0].previousAttempts;
    store.records.set(created.key, legacy);

    const [listed] = await listInventoryCaptureDrafts({ ...scope, now: now + 500 }, { store });
    expect(listed.lines[0]).toMatchObject({ lineRevision: 1, previousAttempts: [] });
    const submitted = await submitInventoryCaptureDraft({
      ...scope,
      draftId: created.draftId,
      now: now + 1000,
      online: true,
      currentInventory: [{ ingredientId: "chicken", locationId: "kitchen", baseUnitId: "lb", stockRevision: 4 }],
      submitLine: vi.fn().mockResolvedValue({ receipt: { receiptId: "legacy-receipt" }, confirmation: { stockRevision: 5 } })
    }, { store });
    expect(submitted.lines[0]).toMatchObject({ lineRevision: 3, state: "submitted", receiptId: "legacy-receipt" });
  });

  test("revision-fences discard so a stale tab cannot delete newer lines", async () => {
    const store = memoryStore();
    const created = await createInventoryCaptureDraft({ ...scope, draftId: "discard-race", now, lines: [captureLine()] }, { store });
    await updateInventoryCaptureDraft({
      ...scope,
      draftId: created.draftId,
      expectedDraftRevision: created.draftRevision,
      now: now + 1000,
      line: captureLine({ ingredientId: "pasta", expectedStockRevision: 2 })
    }, { store });
    await expect(discardInventoryCaptureDraft({
      ...scope,
      draftId: created.draftId,
      expectedDraftRevision: created.draftRevision
    }, { store })).rejects.toMatchObject({ code: "conflict" });
    await expect(listInventoryCaptureDrafts({ ...scope, now: now + 2000 }, { store }))
      .resolves.toMatchObject([{ lines: [{ ingredientId: "chicken" }, { ingredientId: "pasta" }] }]);
  });

  test("rejects a saved command whose location differs from the draft scope", async () => {
    const store = memoryStore();
    await expect(createInventoryCaptureDraft({
      ...scope,
      draftId: "cross-location",
      now,
      lines: [captureLine({ locationId: "other-kitchen" })]
    }, { store })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(listInventoryCaptureDrafts({ ...scope, now: now + 1 }, { store })).resolves.toEqual([]);
  });
});
