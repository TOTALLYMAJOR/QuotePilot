import { expect, test } from "@playwright/test";

const STAFF_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const STAFF_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";
const SECOND_STAFF_EMAIL = process.env.E2E_FIREBASE_SECOND_EMAIL || "e2e-admin-blank@local.test";
const SECOND_STAFF_PASSWORD = process.env.E2E_FIREBASE_SECOND_PASSWORD || "Passw0rd!";
const RECOVERED_PASSWORD = "RecoveredPassw0rd!";
const FIREBASE_PROJECT_ID = process.env.E2E_FIREBASE_PROJECT_ID || "demo-e2e";
const AUTH_EMULATOR_PORT = process.env.E2E_FIREBASE_AUTH_EMULATOR_PORT || "9399";
const APP_URL = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || "4174"}`;
const PASSWORD_RESET_CONFIRMATION = "If an account exists for that email, password-reset instructions have been sent.";
const CONVERSATION_QUOTE_NUMBER = "QP-CONVERSATION-E2E";
const CONVERSATION_PORTAL_KEY = "conversation-e2e-portal-token-1234567890";

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

test("firebase auth and firestore rules load the organization catalog", async ({ page }) => {
  await signInAsStaff(page);
  await page.getByRole("button", { name: "Account" }).click();
  const accountMenu = page.getByRole("menu", { name: "Account" });
  await expect(accountMenu).toContainText(STAFF_EMAIL);
  await expect(accountMenu).toContainText("admin");
  await expect(page.getByLabel(/Event type/i).locator("option")).toHaveCount(5);
});

test("switching authenticated principals destroys the prior tenant workspace state", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsStaff(page);

  const eventType = page.getByLabel(/Event type/i);
  await eventType.selectOption({ index: 1 });
  expect(await eventType.inputValue()).not.toBe("");

  await page.getByRole("button", { name: "Quotes", exact: true }).click();
  const quotesDialog = page.getByRole("dialog", { name: "Quotes" });
  const quoteRow = quotesDialog.locator('tr[data-quote-id="conversation-e2e-quote"]');
  await expect(quoteRow).toContainText(CONVERSATION_QUOTE_NUMBER);
  await quoteRow.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText(`Editing quote ${CONVERSATION_QUOTE_NUMBER}`)).toBeAttached();
  await page.getByRole("button", { name: "Quotes", exact: true }).click();
  await expect(quotesDialog).toBeVisible();

  await page.evaluate(async () => {
    const { signOutCurrentUser } = await import("/src/lib/authClient.js");
    await signOutCurrentUser();
  });
  await expect(page.getByRole("heading", { name: "Staff Sign In" })).toBeVisible({ timeout: 45_000 });
  await expect(quotesDialog).toHaveCount(0);

  await page.evaluate(() => {
    window.__quotePilotScopeLeakFrames = [];
    const recordFrame = () => {
      const text = document.body?.innerText || "";
      const leaked = [
        text.includes("New Quote"),
        text.includes("Portal Conversation Customer"),
        text.includes("Editing quote QP-CONVERSATION-E2E"),
        Boolean(document.querySelector('[role="dialog"]'))
      ].some(Boolean);
      if (leaked) window.__quotePilotScopeLeakFrames.push(text.slice(0, 500));
    };
    const observer = new MutationObserver(recordFrame);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.__quotePilotScopeLeakObserver = observer;
  });

  await page.getByLabel(/^Email$/i).fill(SECOND_STAFF_EMAIL);
  await page.getByLabel(/^Password$/i).fill(SECOND_STAFF_PASSWORD);
  await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { name: "Configure Your Catalog" })).toBeVisible({
    timeout: 45_000
  });
  expect(await page.evaluate(() => {
    window.__quotePilotScopeLeakObserver?.disconnect();
    return window.__quotePilotScopeLeakFrames || [];
  })).toEqual([]);
  await expect(page.getByRole("button", { name: "New Quote" })).toHaveCount(0);
  await expect(page.getByText("Portal Conversation Customer")).toHaveCount(0);
  await expect(page.getByText(`Editing quote ${CONVERSATION_QUOTE_NUMBER}`)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(page.getByRole("heading", { name: "Staff Sign In" })).toBeVisible({ timeout: 45_000 });
  await page.getByLabel(/^Email$/i).fill(STAFF_EMAIL);
  await page.getByLabel(/^Password$/i).fill(STAFF_PASSWORD);
  await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("button", { name: "New Quote" })).toBeVisible({ timeout: 45_000 });

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(`Editing quote ${CONVERSATION_QUOTE_NUMBER}`)).toHaveCount(0);
  await expect(page.getByLabel(/Event type/i)).toHaveValue("");
  await expect(page.getByRole("textbox", { name: /Your name/i })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: /^Email$/i })).toHaveValue("");
});

test("staff and the exact customer portal share one quote-scoped conversation", async ({ page }) => {
  await signInAsStaff(page);
  await page.getByRole("button", { name: "Quotes", exact: true }).click();
  const quotesDialog = page.getByRole("dialog", { name: "Quotes" });
  const quoteRow = quotesDialog.locator(`tr[data-quote-id="conversation-e2e-quote"]`);
  await expect(quoteRow).toContainText(CONVERSATION_QUOTE_NUMBER);
  await quoteRow.getByRole("button", { name: "Conversation" }).click();
  const staffConversation = quotesDialog.locator(".quote-conversation-modal .quote-conversation");
  await expect(staffConversation.getByText(/No messages yet/i)).toBeVisible();
  await staffConversation.getByLabel("Message").fill("Staff confirms load-in begins at 4:30 PM.");
  await staffConversation.getByRole("button", { name: "Send message" }).click();
  await expect(staffConversation.getByRole("status")).toContainText("Message sent");
  await expect(staffConversation).toContainText("Staff confirms load-in begins at 4:30 PM.");
  await staffConversation.getByRole("button", { name: "Close conversation" }).click();
  await quotesDialog.getByRole("button", { name: "Close" }).click();

  await page.goto(`/app?portal=${CONVERSATION_PORTAL_KEY}`);
  await expect(page.getByRole("heading", { name: /Your proposal from E2E Organization/i }))
    .toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "Open conversation" }).click();
  const customerConversation = page.locator(".quote-conversation");
  await expect(customerConversation).toContainText("Staff confirms load-in begins at 4:30 PM.");
  await customerConversation.getByLabel("Message").fill("Thank you. The venue door will be open.");
  await customerConversation.getByRole("button", { name: "Send message" }).click();
  await expect(customerConversation.getByRole("status")).toContainText("Message sent");

  await customerConversation.getByRole("button", { name: "Close conversation" }).click();
  await page.getByRole("button", { name: "Staff sign in" }).click();
  await expect(page.getByRole("button", { name: "Quotes", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Quotes", exact: true }).click();
  const reopenedDialog = page.getByRole("dialog", { name: "Quotes" });
  const reopenedRow = reopenedDialog.locator(`tr[data-quote-id="conversation-e2e-quote"]`);
  await reopenedRow.getByRole("button", { name: "Conversation" }).click();
  const reopenedConversation = reopenedDialog.locator(".quote-conversation-modal .quote-conversation");
  await expect(reopenedConversation).toContainText("Staff confirms load-in begins at 4:30 PM.");
  await expect(reopenedConversation).toContainText("Thank you. The venue door will be open.");
  await reopenedConversation.getByRole("button", { name: "Refresh conversation" }).click();
  await expect(reopenedConversation.getByRole("status")).toContainText("Conversation refreshed");
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
  await expect(page.getByRole("button", { name: "New Quote" })).toBeVisible({
    timeout: 45_000
  });
});
