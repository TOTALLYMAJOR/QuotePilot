import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyEnvironmentDefaults,
  loadWorktreeEnvironment,
  primaryCheckoutEnvironmentPath,
  resolveWorktreeEnvironmentRoots
} from "../../../scripts/worktree-env.mjs";

const temporaryRoots = [];

function createFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-worktree-env-"));
  temporaryRoots.push(fixtureRoot);
  const primaryRoot = path.join(fixtureRoot, "primary");
  const worktreeRoot = path.join(primaryRoot, "output", "worktrees", "feature");
  fs.mkdirSync(path.join(primaryRoot, ".git"), { recursive: true });
  fs.mkdirSync(worktreeRoot, { recursive: true });
  return {
    primaryRoot,
    worktreeRoot,
    gitCommonDirectory: path.join(primaryRoot, ".git")
  };
}

afterEach(() => {
  while (temporaryRoots.length) {
    fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

describe("worktree environment loading", () => {
  it("loads the primary checkout first and lets worktree files override it", () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.primaryRoot, ".env"),
      "PRIMARY_ONLY=present\nOVERRIDE=primary-base\n"
    );
    fs.writeFileSync(
      path.join(fixture.primaryRoot, ".env.production.local"),
      "PRIMARY_MODE=present\nOVERRIDE=primary-mode\n"
    );
    fs.writeFileSync(
      path.join(fixture.worktreeRoot, ".env"),
      "WORKTREE_ONLY=present\nOVERRIDE=worktree-base\n"
    );
    fs.writeFileSync(
      path.join(fixture.worktreeRoot, ".env.production.local"),
      "OVERRIDE=worktree-mode\n"
    );

    const environment = loadWorktreeEnvironment({
      cwd: fixture.worktreeRoot,
      mode: "production",
      gitCommonDirectory: fixture.gitCommonDirectory
    });

    expect(environment).toMatchObject({
      PRIMARY_ONLY: "present",
      PRIMARY_MODE: "present",
      WORKTREE_ONLY: "present",
      OVERRIDE: "worktree-mode"
    });
  });

  it("uses only the current root for an ordinary checkout", () => {
    const fixture = createFixture();

    expect(resolveWorktreeEnvironmentRoots({
      cwd: fixture.primaryRoot,
      gitCommonDirectory: fixture.gitCommonDirectory
    })).toEqual([fs.realpathSync(fixture.primaryRoot)]);
    expect(primaryCheckoutEnvironmentPath(".env.local", {
      cwd: fixture.primaryRoot,
      gitCommonDirectory: fixture.gitCommonDirectory
    })).toBe(path.join(fs.realpathSync(fixture.primaryRoot), ".env.local"));
  });

  it("resolves shared configuration writes to the primary checkout", () => {
    const fixture = createFixture();

    expect(primaryCheckoutEnvironmentPath(".env.local", {
      cwd: fixture.worktreeRoot,
      gitCommonDirectory: fixture.gitCommonDirectory
    })).toBe(path.join(fs.realpathSync(fixture.primaryRoot), ".env.local"));
  });

  it("hydrates only the requested prefix and never replaces injected values", () => {
    const target = {
      VITE_PROVIDER_VALUE: "provider"
    };

    applyEnvironmentDefaults({
      VITE_PROVIDER_VALUE: "file",
      VITE_SHARED_VALUE: "shared",
      SERVER_SECRET: "hidden"
    }, { target, prefix: "VITE_" });

    expect(target).toEqual({
      VITE_PROVIDER_VALUE: "provider",
      VITE_SHARED_VALUE: "shared"
    });
  });
});
