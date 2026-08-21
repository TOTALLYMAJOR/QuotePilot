import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

describe("mock catalog Node import compatibility", () => {
  test("loads through native Node ESM for Firebase seed scripts", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "const catalog = await import('./src/data/mockCatalog.js'); process.stdout.write(String(catalog.DEFAULT_PACKAGES.length));"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    expect(Number(output)).toBeGreaterThan(0);
  });
});
