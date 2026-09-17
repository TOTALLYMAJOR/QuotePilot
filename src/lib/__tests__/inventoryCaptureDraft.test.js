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
  return {
    records,
    async get(key) { return records.get(key) || null; },
    async put(value) { records.set(value.key, structuredClone(value)); return value; },
    async delete(key) { records.delete(key); },
    async list() { return [...records.values()].map((value) => structuredClone(value)); }
  };
}

const scope = Object.freeze({ organizationId: "org-a", userId: "user-a", locationId: "kitchen" });
const now = Date.parse("2026-09-17T14:00:00.000Z");

describe("inventory-capture-draft-v1", () => {
  test("creates, updates, lists, expires, and discards only exact organization/user/location scope", async () => {
    const store = memoryStore();
    const draft = await createInventoryCaptureDraft({
      ...scope,
      draftId: "draft-a",
      now,
      lines: [{
        lineId: "line-chicken",
        ingredientId: "chicken",
        ingredientName: "Chicken",
        baseUnitId: "lb",
        countedQuantity: "12.5",
        note: "Walk-in shelf",
        occurredAtISO: "2026-09-17T14:00:00.000Z",
        expectedStockRevision: 4
      }]
    }, { store });

    expect(Date.parse(draft.expiresAtISO) - Date.parse(draft.createdAtISO)).toBe(INVENTORY_CAPTURE_DRAFT_TTL_MS);
    await createInventoryCaptureDraft({ ...scope, userId: "user-b", draftId: "foreign", now, lines: [] }, { store });
    await updateInventoryCaptureDraft({
      ...scope,
      draftId: "draft-a",
      now: now + 1000,
      lines: [{ ...draft.lines[0], countedQuantity: "13", note: "Second pass" }]
    }, { store });

    await expect(listInventoryCaptureDrafts({ ...scope, now: now + 2000 }, { store }))
      .resolves.toMatchObject([{ draftId: "draft-a", lines: [{ countedQuantity: "13", note: "Second pass" }] }]);
    await expect(listInventoryCaptureDrafts({ ...scope, userId: "user-b", now: now + 2000 }, { store }))
      .resolves.toMatchObject([{ draftId: "foreign" }]);
    await discardInventoryCaptureDraft({ ...scope, draftId: "draft-a" }, { store });
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
        { lineId: "chicken", ingredientId: "chicken", ingredientName: "Chicken", baseUnitId: "lb", countedQuantity: "11", note: "", occurredAtISO: "2026-09-17T14:00:00.000Z", expectedStockRevision: 4 },
        { lineId: "pasta", ingredientId: "pasta", ingredientName: "Pasta", baseUnitId: "lb", countedQuantity: "8", note: "Dry shelf", occurredAtISO: "2026-09-17T14:00:01.000Z", expectedStockRevision: 2 },
        { lineId: "rice", ingredientId: "rice", ingredientName: "Rice", baseUnitId: "lb", countedQuantity: "9", note: "", occurredAtISO: "2026-09-17T14:00:02.000Z", expectedStockRevision: 1 }
      ]
    }, { store });

    const result = await submitInventoryCaptureDraft({
      ...scope,
      draftId: "draft-submit",
      now: now + 1000,
      online: true,
      currentStockRevisions: { chicken: 4, pasta: 2, rice: 3 },
      submitLine
    }, { store });

    expect(submitLine).toHaveBeenCalledTimes(2);
    expect(submitLine).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: "record_stock_count",
      ingredientId: "chicken",
      countedQuantity: "11",
      occurredAtISO: "2026-09-17T14:00:00.000Z",
      expectedStockRevision: 4
    }));
    expect(result.status).toBe("partial");
    expect(result.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ ingredientId: "chicken", state: "submitted", receiptId: "receipt-chicken" }),
      expect.objectContaining({ ingredientId: "pasta", state: "error" }),
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
      lines: [{ lineId: "line", ingredientId: "chicken", ingredientName: "Chicken", baseUnitId: "lb", countedQuantity: "10", note: "", occurredAtISO: "2026-09-17T14:00:00.000Z", expectedStockRevision: 4 }]
    }, { store });
    await expect(submitInventoryCaptureDraft({
      ...scope,
      draftId: "offline",
      now: now + 1000,
      online: false,
      currentStockRevisions: { chicken: 4 },
      submitLine
    }, { store })).rejects.toMatchObject({ code: "offline" });
    expect(submitLine).not.toHaveBeenCalled();
  });
});
