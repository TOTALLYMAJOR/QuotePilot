import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearScopedReads,
  coalesceScopedRead,
  scopedReadCount
} from "../scopedReadCoalescer";

afterEach(() => clearScopedReads());

describe("coalesceScopedRead", () => {
  test("reuses an identical in-flight read within one tenant and principal scope", async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const read = vi.fn(() => pending);
    const input = {
      organizationId: "org-a",
      principalId: "user-a",
      operation: "catalog.complete",
      arguments: { pageSize: 200, filters: { active: true } },
      read
    };

    const first = coalesceScopedRead(input);
    const second = coalesceScopedRead({ ...input, arguments: { filters: { active: true }, pageSize: 200 } });

    expect(second).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    expect(scopedReadCount()).toBe(1);
    release({ complete: true });
    await expect(first).resolves.toEqual({ complete: true });
    expect(scopedReadCount()).toBe(0);
  });

  test("never shares work across principals or tenants", async () => {
    const read = vi.fn(async () => ({ ok: true }));
    await Promise.all([
      coalesceScopedRead({ organizationId: "org-a", principalId: "user-a", operation: "quotes", arguments: {}, read }),
      coalesceScopedRead({ organizationId: "org-a", principalId: "user-b", operation: "quotes", arguments: {}, read }),
      coalesceScopedRead({ organizationId: "org-b", principalId: "user-a", operation: "quotes", arguments: {}, read })
    ]);
    expect(read).toHaveBeenCalledTimes(3);
  });

  test("rejects incomplete scope and removes failed reads in finally", async () => {
    const failure = new Error("offline");
    const read = vi.fn(async () => { throw failure; });

    await expect(coalesceScopedRead({ organizationId: "", principalId: "user-a", operation: "quotes", arguments: {}, read }))
      .rejects.toThrow("organizationId");
    await expect(coalesceScopedRead({ organizationId: "org-a", principalId: "user-a", operation: "quotes", arguments: {}, read }))
      .rejects.toBe(failure);
    expect(scopedReadCount()).toBe(0);
    await expect(coalesceScopedRead({ organizationId: "org-a", principalId: "user-a", operation: "quotes", arguments: {}, read }))
      .rejects.toBe(failure);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("clears only the requested identity scope", () => {
    const never = () => new Promise(() => {});
    coalesceScopedRead({ organizationId: "org-a", principalId: "user-a", operation: "a", arguments: {}, read: never });
    coalesceScopedRead({ organizationId: "org-a", principalId: "user-b", operation: "a", arguments: {}, read: never });
    coalesceScopedRead({ organizationId: "org-b", principalId: "user-a", operation: "a", arguments: {}, read: never });

    expect(clearScopedReads({ organizationId: "org-a", principalId: "user-a" })).toBe(1);
    expect(scopedReadCount()).toBe(2);
  });
});
