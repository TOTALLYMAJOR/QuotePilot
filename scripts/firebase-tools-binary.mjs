#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const FIREBASE_TOOLS_VERSION = "15.24.0";
export const FIREBASE_TOOLS_LINUX_SHA256 = "bf964987f095a5fb991cf1c709f640526a4e1b4f9eb1f271f5c09bc693263d33";
export const FIREBASE_TOOLS_LINUX_URL = `https://github.com/firebase/firebase-tools/releases/download/v${FIREBASE_TOOLS_VERSION}/firebase-tools-linux`;

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function validateFirebaseToolsBinary(
  filePath,
  { expectedDigest = FIREBASE_TOOLS_LINUX_SHA256 } = {}
) {
  const resolved = path.resolve(String(filePath || ""));
  if (!filePath || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`firebase-tools ${FIREBASE_TOOLS_VERSION} verified binary is missing.`);
  }
  const digest = await sha256File(resolved);
  if (digest !== expectedDigest) {
    throw new Error(`firebase-tools ${FIREBASE_TOOLS_VERSION} checksum verification failed.`);
  }
  return resolved;
}

export async function prepareFirebaseToolsBinary({
  cacheRoot = path.join(os.tmpdir(), "quotepilot-provider-tools"),
  expectedDigest = FIREBASE_TOOLS_LINUX_SHA256,
  download = (url, destination) => {
    const result = spawnSync("curl", [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--output",
      destination,
      url
    ], { stdio: "inherit", shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`firebase-tools download failed with exit code ${result.status}.`);
  }
} = {}) {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("The governed Firebase CLI artifact currently supports Linux x64 only.");
  }
  const versionRoot = path.resolve(cacheRoot, `firebase-tools-v${FIREBASE_TOOLS_VERSION}`);
  const binaryPath = path.join(versionRoot, "firebase-tools-linux");
  fs.mkdirSync(versionRoot, { recursive: true, mode: 0o700 });
  if (fs.existsSync(binaryPath)) {
    try {
      return await validateFirebaseToolsBinary(binaryPath, { expectedDigest });
    } catch {
      fs.rmSync(binaryPath, { force: true });
    }
  }
  const temporaryPath = `${binaryPath}.${process.pid}.download`;
  try {
    download(FIREBASE_TOOLS_LINUX_URL, temporaryPath);
    await validateFirebaseToolsBinary(temporaryPath, { expectedDigest });
    fs.chmodSync(temporaryPath, 0o700);
    fs.renameSync(temporaryPath, binaryPath);
    return await validateFirebaseToolsBinary(binaryPath, { expectedDigest });
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--print-path") {
    throw new Error("Usage: node scripts/firebase-tools-binary.mjs --print-path");
  }
  process.stdout.write(`${await prepareFirebaseToolsBinary()}\n`);
}
