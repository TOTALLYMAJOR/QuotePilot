import fs from "node:fs";
import path from "node:path";

const REQUIRED = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID"
];

const PLACEHOLDER_PATTERNS = [
  /^your[_-]/i,
  /your[_-]?project/i,
  /your[_-]?sender/i,
  /your[_-]?app/i,
  /replace[_-]?me/i,
  /change[_-]?me/i,
  /placeholder/i,
  /^x+$/i
];

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const out = {};
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const idx = line.indexOf("=");
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      out[key] = value;
    });
  return out;
}

const cwd = process.cwd();
const envPath = path.join(cwd, ".env");
const envLocalPath = path.join(cwd, ".env.local");
const dotEnv = {
  ...readDotEnv(envPath),
  ...readDotEnv(envLocalPath)
};

function valueFor(key) {
  return String(process.env[key] || dotEnv[key] || "").trim();
}

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

const missing = REQUIRED.filter((key) => !valueFor(key));
const placeholders = REQUIRED.filter((key) => {
  const value = valueFor(key);
  return value && isPlaceholder(value);
});

if (missing.length || placeholders.length) {
  if (missing.length) console.error("Missing required Firebase env vars:");
  missing.forEach((key) => console.error(`- ${key}`));
  if (placeholders.length) console.error(`${missing.length ? "\n" : ""}Placeholder Firebase env vars must be replaced:`);
  placeholders.forEach((key) => console.error(`- ${key}`));
  console.error("\nCopy the Firebase Web App configuration into .env.local or the hosting provider environment. Never commit real values.");
  process.exit(1);
}

console.log("Firebase env check passed (process environment/.env.local/.env).");
