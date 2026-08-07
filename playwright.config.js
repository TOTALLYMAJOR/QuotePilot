import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);
const SALES_PORT = Number(process.env.PLAYWRIGHT_SALES_PORT || PORT + 3);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const SALES_BASE_URL = `http://${HOST}:${SALES_PORT}`;

function buildWebServer(port, role) {
  const baseURL = `http://${HOST}:${port}`;
  return {
    command: `npm run dev -- --host ${HOST} --port ${port}`,
    url: baseURL,
    env: {
      VITE_E2E_BYPASS_AUTH: "true",
      VITE_E2E_ROLE: role,
      VITE_E2E_ORGANIZATION_ID: process.env.VITE_E2E_ORGANIZATION_ID ?? "e2e-org",
      VITE_DEFAULT_ORGANIZATION_ID: process.env.VITE_DEFAULT_ORGANIZATION_ID ?? "e2e-org",
      VITE_ALLOW_LOCAL_CATALOG_FALLBACK: "true",
      VITE_APP_URL: "https://quotepilot.mbmapps.com/app",
      VITE_APP_HOST: "quotepilot.mbmapps.com",
      VITE_FIREBASE_API_KEY: "",
      VITE_FIREBASE_PROJECT_ID: "",
      VITE_FIREBASE_AUTH_DOMAIN: "",
      VITE_FIREBASE_STORAGE_BUCKET: "",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "",
      VITE_FIREBASE_APP_ID: ""
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  };
}

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /firebase-(?:auth-rules|authoritative-pricing|starter-catalog-onboarding)\.smoke\.spec\.js$/,
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
      name: "chromium-admin",
      testIgnore: [
        /firebase-(?:auth-rules|authoritative-pricing|starter-catalog-onboarding)\.smoke\.spec\.js$/,
        /quote-history-role-permissions\.spec\.js$/
      ],
      use: { ...devices["Desktop Chrome"], baseURL: BASE_URL }
    },
    {
      name: "chromium-sales",
      testMatch: /quote-history-role-permissions\.spec\.js$/,
      use: { ...devices["Desktop Chrome"], baseURL: SALES_BASE_URL }
    }
  ],
  webServer: [
    buildWebServer(PORT, process.env.VITE_E2E_ROLE || "admin"),
    buildWebServer(SALES_PORT, "sales")
  ]
});
