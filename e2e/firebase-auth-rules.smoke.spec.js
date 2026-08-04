import { expect, test } from "@playwright/test";

const STAFF_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const STAFF_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";
const RECOVERED_PASSWORD = "RecoveredPassw0rd!";
const FIREBASE_PROJECT_ID = process.env.E2E_FIREBASE_PROJECT_ID || "demo-e2e";
const AUTH_EMULATOR_PORT = process.env.E2E_FIREBASE_AUTH_EMULATOR_PORT || "9399";
const APP_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || "4174"}`;
const PASSWORD_RESET_CONFIRMATION = "If an account exists for that email, password-reset instructions have been sent.";

async function getPasswordResetCodes(request) {
  const response = await request.get(
    `http://127.0.0.1:${AUTH_EMULATOR_PORT}/emulator/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/oobCodes`
  );
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return Array.isArray(body?.oobCodes)
    ? body.oobCodes.filter((entry) => entry?.requestType === "PASSWORD_RESET")
    : [];
}

async function signInAsStaff(page) {
  await page.goto("/app");
  const signInHeading = page.getByRole("heading", { name: "Staff Sign In" });
  const quoteButton = page.getByRole("button", { name: "New Quote" });
  await expect(signInHeading.or(quoteButton)).toBeVisible({ timeout: 45_000 });
  if (await signInHeading.isVisible()) {
    await expect(signInHeading).toBeVisible();
    await page.getByLabel(/^Email$/i).fill(STAFF_EMAIL);
    await page.getByLabel(/^Password$/i).fill(STAFF_PASSWORD);
    await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  }
  await expect(quoteButton).toBeVisible({ timeout: 45_000 });
}

test("firebase auth + firestore rules flow loads the organization catalog", async ({ page }) => {
  await signInAsStaff(page);
  await expect(page.getByText(`Signed in as ${STAFF_EMAIL} · admin`)).toBeVisible();
  await expect(page.getByLabel(/Event type/i).locator("option")).toHaveCount(5);
});

test("email-password staff can complete account recovery with the same on-screen confirmation", async ({ page, request }) => {
  const beforeCodes = await getPasswordResetCodes(request);
  const beforeCodeIds = new Set(beforeCodes.map((entry) => entry?.oobCode));

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Staff Sign In" })).toBeVisible();
  await page.getByLabel(/^Email$/i).fill(STAFF_EMAIL.toUpperCase());
  let releaseResetRequest;
  let observeResetRequest;
  const resetRequestObserved = new Promise((resolve) => {
    observeResetRequest = resolve;
  });
  await page.route("**/accounts:sendOobCode?*", async (route) => {
    observeResetRequest();
    await new Promise((resolve) => {
      releaseResetRequest = resolve;
    });
    await route.continue();
  }, { times: 1 });
  const resetButton = page.getByRole("button", { name: "Forgot password?" });
  await resetButton.click();
  await resetRequestObserved;
  await expect(page.getByRole("button", { name: "Sending..." }))
    .toHaveAttribute("aria-busy", "true");
  await expect(page.getByLabel(/^Email$/i)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Register" })).toBeDisabled();
  releaseResetRequest();
  await expect(page.getByRole("button", { name: "Forgot password?" })).toBeEnabled();
  await expect(page.getByRole("status")).toHaveText(PASSWORD_RESET_CONFIRMATION);

  await expect.poll(async () => {
    const afterCodes = await getPasswordResetCodes(request);
    return afterCodes.filter((entry) => (
      String(entry?.email || "").toLowerCase() === STAFF_EMAIL.toLowerCase()
    )).length;
  }).toBeGreaterThan(
    beforeCodes.filter((entry) => (
      String(entry?.email || "").toLowerCase() === STAFF_EMAIL.toLowerCase()
    )).length
  );

  const createdCode = (await getPasswordResetCodes(request))
    .find((entry) => !beforeCodeIds.has(entry?.oobCode));
  expect(createdCode?.oobLink).toBeTruthy();
  const resetLink = new URL(createdCode.oobLink);
  expect(resetLink.searchParams.get("continueUrl")).toBe(`${APP_URL}/app`);

  const beforeUnknownCodes = await getPasswordResetCodes(request);
  await page.getByLabel(/^Email$/i).fill("missing-account@local.test");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("button", { name: "Forgot password?" })).toBeEnabled();
  await expect(page.getByRole("status")).toHaveText(PASSWORD_RESET_CONFIRMATION);
  await expect.poll(async () => (await getPasswordResetCodes(request)).length)
    .toBe(beforeUnknownCodes.length);

  resetLink.searchParams.set("newPassword", RECOVERED_PASSWORD);
  const resetResponse = await page.goto(resetLink.toString());
  expect(resetResponse?.ok()).toBe(true);

  await page.goto("/app");
  await page.getByLabel(/^Email$/i).fill(STAFF_EMAIL);
  await page.getByLabel(/^Password$/i).fill(RECOVERED_PASSWORD);
  await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("button", { name: "Get Instant Quote" })).toBeVisible({
    timeout: 45_000
  });
});
