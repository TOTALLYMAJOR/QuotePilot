#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAXIMUM_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAXIMUM_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_ATTEMPTS = 2;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com"
]);

export const ACTIONLINT_VERSION = "1.7.12";
export const ACTIONLINT_RELEASE_COMMIT = "914e7df21a07ef503a81201c76d2b11c789d3fca";
export const ACTIONLINT_ARGUMENTS = Object.freeze([
  "-no-color",
  "-shellcheck=",
  "-pyflakes=",
  "-verbose"
]);
export const ACTIONLINT_ASSETS = Object.freeze({
  "linux:x64": Object.freeze({
    archive: "actionlint_1.7.12_linux_amd64.tar.gz",
    sha256: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
  }),
  "linux:arm64": Object.freeze({
    archive: "actionlint_1.7.12_linux_arm64.tar.gz",
    sha256: "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6"
  }),
  "darwin:x64": Object.freeze({
    archive: "actionlint_1.7.12_darwin_amd64.tar.gz",
    sha256: "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644"
  }),
  "darwin:arm64": Object.freeze({
    archive: "actionlint_1.7.12_darwin_arm64.tar.gz",
    sha256: "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f"
  })
});

function workflowLintError(message) {
  return new Error(`GitHub workflow lint failed: ${message}`);
}

export function resolveActionlintAsset(platform = process.platform, architecture = process.arch) {
  const key = `${platform}:${architecture}`;
  const asset = ACTIONLINT_ASSETS[key];
  if (!asset) {
    throw workflowLintError(`unsupported actionlint platform ${key}.`);
  }
  return asset;
}

function validateDownloadUrl(value) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) {
    throw workflowLintError(`refusing untrusted actionlint download URL ${url.toString()}.`);
  }
  return url;
}

function downloadArchiveOnce(urlValue, destination, redirectsRemaining = MAXIMUM_REDIRECTS) {
  const url = validateDownloadUrl(urlValue);
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { "user-agent": "QuotePilot-workflow-lint" }
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = String(response.headers.location || "").trim();
        response.resume();
        if (!location || redirectsRemaining <= 0) {
          reject(workflowLintError("actionlint download exceeded the redirect limit."));
          return;
        }
        let redirected;
        try {
          redirected = validateDownloadUrl(new URL(location, url));
        } catch (error) {
          reject(error);
          return;
        }
        downloadArchiveOnce(redirected, destination, redirectsRemaining - 1)
          .then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(workflowLintError(`actionlint download returned HTTP ${status || "unknown"}.`));
        return;
      }
      const contentLength = Number(response.headers["content-length"] || 0);
      if (contentLength > MAXIMUM_ARCHIVE_BYTES) {
        response.resume();
        reject(workflowLintError("actionlint archive exceeds the size limit."));
        return;
      }

      const output = fs.createWriteStream(destination, { flags: "wx", mode: 0o600 });
      let received = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        response.destroy();
        output.destroy();
        reject(error);
      };
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > MAXIMUM_ARCHIVE_BYTES) {
          fail(workflowLintError("actionlint archive exceeds the size limit."));
        }
      });
      response.on("error", fail);
      output.on("error", fail);
      output.on("finish", () => {
        output.close((error) => {
          if (settled) return;
          if (error) {
            fail(error);
            return;
          }
          settled = true;
          resolve();
        });
      });
      response.pipe(output);
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(workflowLintError("actionlint download timed out."));
    });
    request.on("error", reject);
  });
}

async function downloadArchive(url, destination) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      await downloadArchiveOnce(url, destination);
      return;
    } catch (error) {
      lastError = error;
      if (fs.existsSync(destination)) fs.unlinkSync(destination);
    }
  }
  throw lastError || workflowLintError("actionlint download failed.");
}

function sha256File(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

export async function checkGitHubWorkflows({
  platform = process.platform,
  architecture = process.arch,
  root = ROOT
} = {}) {
  const asset = resolveActionlintAsset(platform, architecture);
  const releaseUrl = new URL(
    `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${asset.archive}`
  );
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-actionlint-"));
  fs.chmodSync(temporaryDirectory, 0o700);
  const archivePath = path.join(temporaryDirectory, asset.archive);
  const binaryPath = path.join(temporaryDirectory, "actionlint");

  try {
    await downloadArchive(releaseUrl, archivePath);
    const actualDigest = sha256File(archivePath);
    if (!crypto.timingSafeEqual(Buffer.from(actualDigest), Buffer.from(asset.sha256))) {
      throw workflowLintError(
        `actionlint archive checksum mismatch (expected ${asset.sha256}, received ${actualDigest}).`
      );
    }

    execFileSync("tar", ["-xzf", archivePath, "-C", temporaryDirectory, "actionlint"], {
      cwd: root,
      stdio: "pipe"
    });
    const binaryStat = fs.lstatSync(binaryPath);
    if (!binaryStat.isFile() || binaryStat.isSymbolicLink()) {
      throw workflowLintError("the verified archive did not contain a regular actionlint binary.");
    }
    fs.chmodSync(binaryPath, 0o700);
    const versionOutput = execFileSync(binaryPath, ["-version"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (String(versionOutput).split(/\r?\n/, 1)[0].trim() !== ACTIONLINT_VERSION) {
      throw workflowLintError("the verified actionlint binary reported an unexpected version.");
    }

    execFileSync(binaryPath, ACTIONLINT_ARGUMENTS, {
      cwd: root,
      stdio: "inherit"
    });
    process.stdout.write(
      `GitHub workflow lint passed with actionlint ${ACTIONLINT_VERSION} (${ACTIONLINT_RELEASE_COMMIT}).\n`
    );
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  checkGitHubWorkflows().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
