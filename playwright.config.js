import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;

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
      VITE_E2E_BYPASS_AUTH: "true",
      VITE_E2E_ROLE: process.env.VITE_E2E_ROLE || "admin",
      VITE_FIREBASE_API_KEY: "",
      VITE_FIREBASE_PROJECT_ID: "",
      VITE_FIREBASE_AUTH_DOMAIN: "",
      VITE_FIREBASE_STORAGE_BUCKET: "",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "",
      VITE_FIREBASE_APP_ID: ""
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
