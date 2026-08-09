#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectId = String(
  process.env.CUSTOMER_CENTERED_AUTHORITY_EMULATOR_PROJECT_ID
    || "demo-customer-centered-authority"
).trim();

if (!projectId.startsWith("demo-")) {
  throw new Error("Customer-centered authority acceptance requires a disposable demo-* project.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) {
    const error = new Error(`${command} exited unsuccessfully.`);
    error.exitCode = result.status || 1;
    throw error;
  }
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

run("bash", ["./scripts/ensure-local-jre.sh"]);

const reservedPorts = [];
while (reservedPorts.length < 6) {
  const port = await reservePort();
  if (!reservedPorts.includes(port)) reservedPorts.push(port);
}
const [authPort, firestorePort, functionsPort, hubPort, loggingPort, eventarcPort] = reservedPorts;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quotepilot-authority-emulator-"));
// Firebase requires rules/functions paths to remain inside the config's project
// directory. Keep the ignored disposable config at the repository root while
// all other transient state stays under the system temp directory.
const configPath = path.join(
  rootDir,
  `.firebase.authority.${path.basename(tempDir)}.tmp`
);
const webhookKey = createHash("sha256")
  .update(`quotepilot-resend-webhook-emulator|${projectId}`)
  .digest();
const webhookSecret = `whsec_${webhookKey.toString("base64")}`;
const tokenSecret = createHash("sha256")
  .update(`quotepilot-revenue-autopilot-token-emulator|${projectId}`)
  .digest("hex");
const secretOverridesPath = path.join(rootDir, "functions", ".secret.local");
const priorSecretOverrides = fs.existsSync(secretOverridesPath)
  ? {
      bytes: fs.readFileSync(secretOverridesPath),
      mode: fs.statSync(secretOverridesPath).mode & 0o777
    }
  : null;

fs.writeFileSync(configPath, `${JSON.stringify({
  functions: { source: "functions" },
  firestore: {
    rules: "firestore.rules",
    indexes: "firestore.indexes.json"
  },
  emulators: {
    auth: { host: "127.0.0.1", port: authPort },
    firestore: { host: "127.0.0.1", port: firestorePort },
    functions: { host: "127.0.0.1", port: functionsPort },
    eventarc: { host: "127.0.0.1", port: eventarcPort },
    hub: { host: "127.0.0.1", port: hubPort },
    logging: { host: "127.0.0.1", port: loggingPort },
    ui: { enabled: false },
    singleProjectMode: true
  }
}, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(
  secretOverridesPath,
  `REVENUE_AUTOPILOT_TOKEN_SECRET=${tokenSecret}\nRESEND_WEBHOOK_SECRET=${webhookSecret}\n`,
  { mode: 0o600 }
);
fs.chmodSync(secretOverridesPath, 0o600);

const localJre = path.join(rootDir, ".cache", "tools", "jre21");
const env = {
  ...process.env,
  GCLOUD_PROJECT: projectId,
  GOOGLE_CLOUD_PROJECT: projectId,
  COMMERCIAL_CHANGE_AUTHORITY_ENABLED: "true",
  REVENUE_AUTOPILOT_ENABLED: "true",
  REVENUE_AUTOPILOT_SENDS_ENABLED: "false",
  REVENUE_AUTOPILOT_TOKEN_SECRET: tokenSecret,
  RESEND_WEBHOOK_SECRET: webhookSecret,
  NOTIFICATIONS_EMAIL_PROVIDER: "none",
  EMAIL_FROM_NAME: "QuotePilot by MBMApps",
  EMAIL_FROM_EMAIL: "quotepilot@leaguepilot.us",
  APP_BASE_URL: "http://127.0.0.1:4174/app",
  FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || "45000",
  TMPDIR: "/tmp",
  TMP: "/tmp",
  TEMP: "/tmp"
};
// Firebase honors DEBUG, but inherited shell values can flood CI output and hide
// the acceptance result. The lane remains verbose on callable/assertion failure.
delete env.DEBUG;
delete env.FIREBASE_DEBUG_MODE;
if (fs.existsSync(path.join(localJre, "bin", "java"))) {
  env.JAVA_HOME = localJre;
  env.PATH = `${path.join(localJre, "bin")}${path.delimiter}${process.env.PATH || ""}`;
}

let emulatorExitCode = 0;
try {
  run("npx", [
    "firebase-tools",
    "--config",
    configPath,
    "--project",
    projectId,
    "emulators:exec",
    "--only",
    "auth,firestore,functions",
    "node scripts/customer-centered-authority-emulator-acceptance.mjs"
  ], { env });
} catch (error) {
  emulatorExitCode = Number(error?.exitCode) || 1;
} finally {
  if (priorSecretOverrides) {
    fs.writeFileSync(secretOverridesPath, priorSecretOverrides.bytes);
    fs.chmodSync(secretOverridesPath, priorSecretOverrides.mode);
  } else {
    fs.rmSync(secretOverridesPath, { force: true });
  }
  fs.rmSync(configPath, { force: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
}
if (emulatorExitCode) process.exitCode = emulatorExitCode;
