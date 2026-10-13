import { describe, expect, test, vi } from "vitest";
import { readCompletePages } from "../completePageReader";

describe("readCompletePages", () => {
  test("retrieves every stable page and reports explicit completeness metadata", async () => {
    const rows = Array.from({ length: 450 }, (_, index) => ({ id: `doc-${String(index).padStart(3, "0")}` }));
    const readPage = vi.fn(async ({ afterId, pageSize }) => {
      const start = afterId ? rows.findIndex((row) => row.id === afterId) + 1 : 0;
      return rows.slice(start, start + pageSize);
    });

    const result = await readCompletePages({ pageSize: 200, readPage });

    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(450);
    expect(result.pageCount).toBe(3);
    expect(result.pageSize).toBe(200);
    expect(result.lastId).toBe("doc-449");
    expect(readPage).toHaveBeenNthCalledWith(2, { afterId: "doc-199", pageSize: 200, pageNumber: 2 });
  });

  test("rejects the complete read when any page fails", async () => {
    const readPage = vi.fn()
      .mockResolvedValueOnce(Array.from({ length: 200 }, (_, index) => ({ id: `doc-${String(index).padStart(3, "0")}` })))
      .mockRejectedValueOnce(new Error("page unavailable"));

    await expect(readCompletePages({ pageSize: 200, readPage })).rejects.toThrow("page unavailable");
  });

  test("rejects duplicate or regressing cursors instead of silently truncating", async () => {
    const page = Array.from({ length: 2 }, (_, index) => ({ id: `doc-${index}` }));
    const readPage = vi.fn(async () => page);

    await expect(readCompletePages({ pageSize: 2, readPage })).rejects.toThrow("cursor did not advance");
  });
});
