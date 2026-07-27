import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/configure-local-firebase-env.mjs");
const tempDirs = [];

function makeWorkspace(contents = "USER_OWNED_VALUE=preserve-me\n") {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-local-env-"));
  tempDirs.push(cwd);
  fs.writeFileSync(path.join(cwd, ".env.local"), contents, { mode: 0o600 });
  return cwd;
}

function runConfigurator(cwd, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--project", "tonicatering", ...extraArgs],
    {
      cwd,
      env: { PATH: process.env.PATH || "" },
      encoding: "utf8"
    }
  );
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("local Firebase environment configurator safety", { timeout: 30_000 }, () => {
  test("refuses to overwrite an existing .env.local by default", () => {
    const existing = "USER_OWNED_VALUE=preserve-me\n";
    const cwd = makeWorkspace(existing);

    const result = runConfigurator(cwd);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/refusing to overwrite/i);
    expect(fs.readFileSync(path.join(cwd, ".env.local"), "utf8")).toBe(existing);
    expect(fs.existsSync(path.join(cwd, ".env"))).toBe(false);
  });

  test("requires the exact project-scoped confirmation before replacement", () => {
    const existing = "USER_OWNED_VALUE=preserve-me\n";
    const cwd = makeWorkspace(existing);

    const result = runConfigurator(cwd, [
      "--replace",
      "--confirm",
      "REPLACE .env.local FOR another-project"
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires --confirm/i);
    expect(fs.readFileSync(path.join(cwd, ".env.local"), "utf8")).toBe(existing);
  });
});
