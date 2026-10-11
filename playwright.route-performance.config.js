import { defineConfig } from "@playwright/test";
import { PROFILE } from "./scripts/route-performance-metrics.mjs";

const runDirectory = process.env.ROUTE_PERF_RUN_DIR;
const port = Number(process.env.ROUTE_PERF_PORT || 4197);
const baseURL = `http://127.0.0.1:${port}`;
if (!runDirectory) throw new Error("Use check:perf:routes or calibrate:perf:routes to build an isolated preview.");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "route-performance.spec.js",
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  repeatEach: process.env.ROUTE_PERF_CALIBRATE === "true" ? 5 : 3,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  outputDir: `${runDirectory}/tests`,
  reporter: [["list"], ["json", { outputFile: `${runDirectory}/playwright.json` }]],
  use: {
    browserName: "chromium",
    baseURL,
    viewport: PROFILE.viewport,
    deviceScaleFactor: PROFILE.deviceScaleFactor,
    locale: "en-US",
    timezoneId: PROFILE.timezone,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --outDir '${runDirectory}/build' --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/route-performance-build.json`,
    reuseExistingServer: false,
    timeout: 30_000
  }
});
