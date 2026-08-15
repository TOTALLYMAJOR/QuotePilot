import { afterEach, describe, expect, test, vi } from "vitest";

const firebaseMocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn()
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: firebaseMocks.httpsCallable
}));

vi.mock("../firebase", () => ({
  cloudFunctions: { id: "staff-directory-functions" },
  firebaseReady: true
}));

describe("staffDirectoryClient local review fixture", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  test("loads a photo-rich staff directory only for local bypass review", async () => {
    vi.stubEnv("VITE_E2E_BYPASS_AUTH", "true");
    const { getStaffDirectory } = await import("../staffDirectoryClient");

    const directory = await getStaffDirectory({ organizationId: "org-review" });

    expect(directory).toMatchObject({
      ok: true,
      storage: "local_fixture",
      organizationId: "org-review",
      profilesTruncated: false,
      recordsTruncated: false,
      assignmentsTruncated: false
    });
    expect(directory.records).toHaveLength(8);
    expect(directory.assignments.length).toBeGreaterThanOrEqual(5);
    expect(directory.records.every((entry) => (
      String(entry.record.photoUrl || "").startsWith("data:image/svg+xml,")
    ))).toBe(true);
    expect(directory.records.some((entry) => entry.record.contact.emergencyContactPhone === "")).toBe(true);
    expect(directory.records.some((entry) => entry.profile.active === false)).toBe(true);
    expect(firebaseMocks.httpsCallable).not.toHaveBeenCalled();
  });
});
