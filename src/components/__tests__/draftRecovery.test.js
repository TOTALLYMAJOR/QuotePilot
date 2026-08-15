import { describe, expect, it } from "vitest";
import {
  clearDraftSnapshot,
  describeSnapshotAge,
  draftRecoveryKey,
  readDraftSnapshot,
  snapshotMeaningful,
  writeDraftSnapshot
} from "../draftRecovery";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map
  };
}

describe("draft recovery snapshots", () => {
  it("scopes the storage key per organization", () => {
    expect(draftRecoveryKey({ organizationId: "org-1" })).toContain(":org-1:new");
    expect(draftRecoveryKey({})).toContain(":local:new");
    expect(draftRecoveryKey({ organizationId: "a" }))
      .not.toBe(draftRecoveryKey({ organizationId: "b" }));
  });

  it("round-trips a form and reports its age", () => {
    const storage = memoryStorage();
    const key = draftRecoveryKey({ organizationId: "org-1" });
    expect(writeDraftSnapshot(storage, key, { form: { eventName: "Gala" }, now: 1000 })).toBe(true);
    const snapshot = readDraftSnapshot(storage, key, { now: 61000 });
    expect(snapshot.form).toEqual({ eventName: "Gala" });
    expect(snapshot.ageMs).toBe(60000);
  });

  it("rejects expired, corrupt, and foreign payloads", () => {
    const key = draftRecoveryKey({ organizationId: "org-1" });
    const storage = memoryStorage();
    writeDraftSnapshot(storage, key, { form: { eventName: "Old" }, now: 0 });
    expect(readDraftSnapshot(storage, key, { now: 8 * 24 * 60 * 60 * 1000 })).toBeNull();

    expect(readDraftSnapshot(memoryStorage({ [key]: "not json" }), key)).toBeNull();
    expect(readDraftSnapshot(memoryStorage({ [key]: JSON.stringify({ version: "other", form: {} }) }), key)).toBeNull();
    expect(readDraftSnapshot(memoryStorage({ [key]: JSON.stringify({ version: "quotepilot.draft-recovery.v1", form: [] , savedAtMs: 1 }) }), key)).toBeNull();
  });

  it("clears without throwing on broken storage", () => {
    const storage = memoryStorage();
    const key = draftRecoveryKey({});
    writeDraftSnapshot(storage, key, { form: { a: 1 } });
    clearDraftSnapshot(storage, key);
    expect(readDraftSnapshot(storage, key)).toBeNull();
    expect(() => clearDraftSnapshot(null, key)).not.toThrow();
    expect(writeDraftSnapshot({ setItem: () => { throw new Error("quota"); } }, key, { form: {} })).toBe(false);
  });
});

describe("snapshotMeaningful", () => {
  const baseline = {
    eventName: "",
    guests: 0,
    hours: 1,
    menuItems: [],
    menuItemQuantities: {},
    includeDisposables: true,
    style: "Buffet"
  };

  it("ignores a pristine or baseline-equal form", () => {
    expect(snapshotMeaningful({ ...baseline }, baseline)).toBe(false);
    expect(snapshotMeaningful({ ...baseline, eventName: "  " }, baseline)).toBe(false);
  });

  it("detects text, number, selection, map, and boolean divergence", () => {
    expect(snapshotMeaningful({ ...baseline, eventName: "Gala" }, baseline)).toBe(true);
    expect(snapshotMeaningful({ ...baseline, guests: 40 }, baseline)).toBe(true);
    expect(snapshotMeaningful({ ...baseline, menuItems: ["salad"] }, baseline)).toBe(true);
    expect(snapshotMeaningful({ ...baseline, menuItemQuantities: { salad: 2 } }, baseline)).toBe(true);
    expect(snapshotMeaningful({ ...baseline, includeDisposables: false }, baseline)).toBe(true);
    expect(snapshotMeaningful({ ...baseline, style: "Plated" }, baseline)).toBe(true);
  });
});

describe("describeSnapshotAge", () => {
  it("phrases ages for the banner", () => {
    expect(describeSnapshotAge(10_000)).toBe("moments ago");
    expect(describeSnapshotAge(60_000)).toBe("a minute ago");
    expect(describeSnapshotAge(12 * 60_000)).toBe("12 minutes ago");
    expect(describeSnapshotAge(3 * 3_600_000)).toBe("3 hours ago");
    expect(describeSnapshotAge(2 * 86_400_000)).toBe("2 days ago");
    expect(describeSnapshotAge(-5)).toBe("recently");
  });
});
