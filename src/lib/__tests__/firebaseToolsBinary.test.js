import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  FIREBASE_TOOLS_LINUX_SHA256,
  FIREBASE_TOOLS_LINUX_URL,
  FIREBASE_TOOLS_VERSION,
  prepareFirebaseToolsBinary,
  validateFirebaseToolsBinary
} from "../../../scripts/firebase-tools-binary.mjs";

describe("checksum-verified Firebase CLI artifact", () => {
  test("pins one immutable official Linux release asset and digest", () => {
    expect(FIREBASE_TOOLS_VERSION).toBe("15.24.0");
    expect(FIREBASE_TOOLS_LINUX_URL).toBe(
      "https://github.com/firebase/firebase-tools/releases/download/v15.24.0/firebase-tools-linux"
    );
    expect(FIREBASE_TOOLS_LINUX_SHA256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("downloads once, verifies before promotion, and reuses only the verified artifact", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-firebase-cli-"));
    const bytes = Buffer.from("bounded firebase cli fixture");
    const expectedDigest = crypto.createHash("sha256").update(bytes).digest("hex");
    const download = vi.fn((_url, destination) => fs.writeFileSync(destination, bytes));
    try {
      const first = await prepareFirebaseToolsBinary({ cacheRoot: root, expectedDigest, download });
      expect(fs.statSync(first).mode & 0o777).toBe(0o700);
      expect(download).toHaveBeenCalledOnce();
      const second = await prepareFirebaseToolsBinary({ cacheRoot: root, expectedDigest, download });
      expect(second).toBe(first);
      expect(download).toHaveBeenCalledOnce();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects an artifact whose bytes do not match the pinned digest", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-firebase-cli-bad-"));
    const file = path.join(root, "firebase-tools-linux");
    fs.writeFileSync(file, "wrong bytes");
    try {
      await expect(validateFirebaseToolsBinary(file)).rejects.toThrow(/checksum verification failed/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
