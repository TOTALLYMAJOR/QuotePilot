import { expect, test } from "@playwright/test";

const STAFF_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const STAFF_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";
const FIREBASE_PROJECT_ID = process.env.E2E_FIREBASE_PROJECT_ID || "demo-e2e";
const AUTH_EMULATOR_PORT = process.env.E2E_FIREBASE_AUTH_EMULATOR_PORT || "9399";

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

test("firebase auth reset issues an emulator OOB code and staff can load the organization catalog", async ({ page, request }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Staff Sign In" })).toBeVisible();
  await page.getByLabel(/^Email$/i).fill(STAFF_EMAIL);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByText(`Password reset email sent to ${STAFF_EMAIL}. Check your inbox.`)).toBeVisible();

  const oobResponse = await request.get(
    `http://127.0.0.1:${AUTH_EMULATOR_PORT}/emulator/v1/projects/${FIREBASE_PROJECT_ID}/oobCodes`
  );
  expect(oobResponse.ok()).toBe(true);
  const oobPayload = await oobResponse.json();
  expect(oobPayload.oobCodes).toEqual(expect.arrayContaining([
    expect.objectContaining({
      email: STAFF_EMAIL,
      requestType: "PASSWORD_RESET"
    })
  ]));

  await signInAsStaff(page);
  await page.getByRole("button", { name: "Account" }).click();
  const accountMenu = page.getByRole("menu", { name: "Account" });
  await expect(accountMenu).toContainText(STAFF_EMAIL);
  await expect(accountMenu).toContainText("admin");
  await expect(page.getByLabel(/Event type/i).locator("option")).toHaveCount(5);
});
