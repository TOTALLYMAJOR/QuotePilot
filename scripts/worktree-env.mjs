import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";

function realPathOrResolved(value) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function discoverGitCommonDirectory(cwd) {
  try {
    return execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return "";
  }
}

export function resolveWorktreeEnvironmentRoots({
  cwd = process.cwd(),
  gitCommonDirectory
} = {}) {
  const currentRoot = realPathOrResolved(cwd);
  const discoveredCommonDirectory = gitCommonDirectory === undefined
    ? discoverGitCommonDirectory(currentRoot)
    : gitCommonDirectory;
  const commonDirectory = realPathOrResolved(
    discoveredCommonDirectory || path.join(currentRoot, ".git")
  );
  const primaryRoot = path.basename(commonDirectory) === ".git"
    ? realPathOrResolved(path.dirname(commonDirectory))
    : currentRoot;

  return primaryRoot === currentRoot
    ? [currentRoot]
    : [primaryRoot, currentRoot];
}

export function environmentFileNames(mode = "") {
  const normalizedMode = String(mode || "").trim();
  return [
    ".env",
    ".env.local",
    ...(normalizedMode ? [`.env.${normalizedMode}`, `.env.${normalizedMode}.local`] : [])
  ];
}

export function loadWorktreeEnvironment({
  cwd = process.cwd(),
  mode = "",
  gitCommonDirectory
} = {}) {
  const environment = {};
  const roots = resolveWorktreeEnvironmentRoots({ cwd, gitCommonDirectory });

  for (const root of roots) {
    for (const fileName of environmentFileNames(mode)) {
      const filePath = path.join(root, fileName);
      if (!fs.existsSync(filePath)) continue;
      Object.assign(environment, parseEnv(fs.readFileSync(filePath, "utf8")));
    }
  }

  return environment;
}

export function applyEnvironmentDefaults(environment, {
  target = process.env,
  prefix = ""
} = {}) {
  for (const [key, value] of Object.entries(environment || {})) {
    if (prefix && !key.startsWith(prefix)) continue;
    if (Object.prototype.hasOwnProperty.call(target, key)) continue;
    target[key] = value;
  }
  return target;
}

export function primaryCheckoutEnvironmentPath(fileName, options = {}) {
  const [primaryRoot] = resolveWorktreeEnvironmentRoots(options);
  return path.join(primaryRoot, fileName);
}
