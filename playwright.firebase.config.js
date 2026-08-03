import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4174);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const allowNonAuthoritativePricing = ["1", "true", "yes", "on"].includes(
  String(process.env.E2E_ALLOW_NON_AUTHORITATIVE_PRICING || "true").trim().toLowerCase()
)
  ? "true"
  : "false";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["clipboard-read", "clipboard-write"]
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: `npm run dev -- --host ${HOST} --port ${PORT}`,
    url: BASE_URL,
    env: {
      VITE_E2E_BYPASS_AUTH: "false",
      VITE_FIREBASE_API_KEY: "demo-api-key",
      VITE_FIREBASE_PROJECT_ID: process.env.E2E_FIREBASE_PROJECT_ID || "demo-e2e",
      VITE_FIREBASE_AUTH_DOMAIN: "demo-e2e.firebaseapp.com",
      VITE_FIREBASE_STORAGE_BUCKET: "demo-e2e.appspot.com",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
      VITE_FIREBASE_APP_ID: "1:1234567890:web:abcdef123456",
      VITE_FIREBASE_FUNCTIONS_REGION: "us-central1",
      VITE_USE_FIREBASE_EMULATORS: "true",
      VITE_E2E_ALLOW_NON_AUTHORITATIVE_PRICING: allowNonAuthoritativePricing,
      VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
      VITE_FIREBASE_AUTH_EMULATOR_PORT: process.env.E2E_FIREBASE_AUTH_EMULATOR_PORT || "9099",
      VITE_FIRESTORE_EMULATOR_PORT: process.env.E2E_FIRESTORE_EMULATOR_PORT || "8080",
      VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: process.env.E2E_FIREBASE_FUNCTIONS_EMULATOR_PORT || "5001"
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
