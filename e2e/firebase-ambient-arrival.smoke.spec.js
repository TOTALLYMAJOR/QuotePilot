import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const STAFF_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const STAFF_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";
const CONVERSATION_QUOTE_ID = "conversation-e2e-quote";
const OUTPUT_DIR = "output/playwright/quotepilot-connected-arrival-audit";
const AMBIENT_CONNECTED_ARRIVAL_ENABLED = [
  process.env.VITE_AMBIENT_UI_ENABLED,
  process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED
].every((value) => ["1", "true", "yes", "on"].includes(
  String(value || "").trim().toLowerCase()
));

async function signInAsStaff(page) {
  await page.goto("/app");
  const signInHeading = page.getByRole("heading", { name: "Staff Sign In" });
  const quoteButton = page.getByRole("banner").getByRole("button", { name: "New quote" });
  await expect(signInHeading.or(quoteButton)).toBeVisible({ timeout: 45_000 });
  if (await signInHeading.isVisible()) {
    await page.getByLabel(/^Email$/i).fill(STAFF_EMAIL);
    await page.getByLabel(/^Password$/i).fill(STAFF_PASSWORD);
    await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  }
  await expect(quoteButton).toBeVisible({ timeout: 45_000 });
}

async function inspectConversationReflow(page, width, screenshotName) {
  await page.setViewportSize({ width, height: 800 });
  const station = page.locator(".messaging-station");
  const thread = page.getByRole("region", { name: "Selected event conversation" });
  await expect(station).toBeVisible();
  await expect(thread).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();

  const overflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const selectors = [
      '[data-arrival-surface="conversation"]',
      ".messaging-station",
      ".messaging-thread",
      ".quote-conversation",
      ".quote-conversation-compose"
    ];
    return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > viewportWidth + 1);
      })
      .map((element) => ({
        className: element.className,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        viewportWidth
      }));
  });
  expect(overflow, `Horizontal reflow overflow at ${width}px`).toEqual([]);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  )), `Document overflow at ${width}px`).toBe(true);

  await page.screenshot({
    path: `${OUTPUT_DIR}/${screenshotName}`,
    fullPage: false
  });

  const accessibility = await new AxeBuilder({ page })
    .include(".messaging-station")
    .analyze();
  expect(
    accessibility.violations,
    `Axe violations at ${width}px: ${JSON.stringify(accessibility.violations, null, 2)}`
  ).toEqual([]);
}

async function exerciseDelayedQuoteAdministrationArrival(page, {
  reviewAction,
  dialogName,
  handoffAction,
  objectLabel,
  screenshotPrefix
}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsStaff(page);
  await page.goto(`/app/quotes/${CONVERSATION_QUOTE_ID}`);

  const opportunity = page.locator(".ambient-living-opportunity");
  await expect(opportunity).toBeVisible({ timeout: 45_000 });
  await opportunity.getByRole("button", { name: reviewAction }).click();
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();

  await page.evaluate(() => {
    globalThis.__quotePilotE2eDelays = {
      ...(globalThis.__quotePilotE2eDelays || {}),
      quoteHistoryMs: 5_000
    };
  });
  await dialog.getByRole("button", { name: handoffAction }).click();

  await expect(page).toHaveURL(/\/app\/quotes$/);
  const arrival = page.locator('[data-arrival-surface="quote-administration"]');
  const administrationSummary = page.locator(
    '[data-quote-administration="true"] > summary'
  );
  await expect(arrival).toHaveAttribute("data-arrival-state", "pending");
  await expect(arrival).toContainText(`Finding ${objectLabel}`);
  await expect(arrival).not.toContainText(/ready/iu);
  await expect(administrationSummary).toBeVisible();
  await expect(administrationSummary).not.toBeFocused();
  await expect(page.locator(`tr[data-quote-id="${CONVERSATION_QUOTE_ID}"]`)).toHaveCount(0);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await page.screenshot({
    path: `${OUTPUT_DIR}/${screenshotPrefix}-pending-mobile.png`,
    fullPage: false
  });

  await expect(arrival).toHaveAttribute("data-arrival-state", "resolved", { timeout: 45_000 });
  await expect(arrival).toContainText(`${objectLabel} ready`);
  await expect(administrationSummary).toBeFocused();
  await expect(page.locator(`tr[data-quote-id="${CONVERSATION_QUOTE_ID}"]`)).toBeVisible();
  await expect(page.getByText("Showing 1 of 1 quotes", { exact: true })).toBeVisible();
  await expect(page.locator(".saved-quote-handoff")).toHaveCount(0);
  await expect(page.locator(".commercial-dependency-panel")).toHaveCount(0);
  await expect(page.locator(".quote-decision-debt-panel")).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(administrationSummary).toBeVisible();
  expect((await administrationSummary.boundingBox())?.y).toBeLessThan(500);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
  await page.screenshot({
    path: `${OUTPUT_DIR}/${screenshotPrefix}-resolved-desktop.png`,
    fullPage: false
  });

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/app/quotes/${CONVERSATION_QUOTE_ID}$`));
  await expect(page.locator(".ambient-living-opportunity")).toBeVisible({ timeout: 45_000 });

  await page.goForward();
  await expect(page).toHaveURL(/\/app\/quotes$/);
  const restoredArrival = page.locator('[data-arrival-surface="quote-administration"]');
  await expect(restoredArrival).toContainText(`${objectLabel} ready`, { timeout: 45_000 });
  await expect(administrationSummary).toBeFocused();
  await expect(page.locator(`tr[data-quote-id="${CONVERSATION_QUOTE_ID}"]`)).toBeVisible();
  await expect(page.getByText("Showing 1 of 1 quotes", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/app\/quotes$/);
  const reloadedArrival = page.locator('[data-arrival-surface="quote-administration"]');
  await expect(reloadedArrival).toContainText(`${objectLabel} ready`, { timeout: 45_000 });
  await expect(administrationSummary).toBeFocused();
  await expect(page.locator(`tr[data-quote-id="${CONVERSATION_QUOTE_ID}"]`)).toBeVisible();
  await expect(page.getByText("Showing 1 of 1 quotes", { exact: true })).toBeVisible();
}

test("connected Ambient conversation arrival stays pending until the exact thread bodies load", async ({ page }) => {
  test.skip(
    !AMBIENT_CONNECTED_ARRIVAL_ENABLED,
    "Connected Ambient arrival qualification requires both presentation gates."
  );
  test.setTimeout(180_000);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.addInitScript(() => {
    globalThis.__quotePilotMessagingPerformance = [];
    globalThis.addEventListener("quotepilot:messaging-performance", (event) => {
      globalThis.__quotePilotMessagingPerformance.push(event.detail);
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsStaff(page);
  await page.goto(`/app/quotes/${CONVERSATION_QUOTE_ID}`);

  const opportunity = page.locator(".ambient-living-opportunity");
  await expect(opportunity).toBeVisible({ timeout: 45_000 });
  await opportunity.getByRole("button", { name: "Review conversation" }).click();
  const dialog = page.getByRole("dialog", { name: "Conversation details" });
  await expect(dialog).toBeVisible();

  let releaseConversationLoadGate;
  let conversationLoadReleased = false;
  let delayedConversationLoad = false;
  const conversationLoadGate = new Promise((resolve) => {
    releaseConversationLoadGate = resolve;
  });
  const releaseConversationLoad = () => {
    if (conversationLoadReleased) return;
    conversationLoadReleased = true;
    releaseConversationLoadGate();
  };
  await page.route("**/getQuotePortalConversation**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    delayedConversationLoad = true;
    await conversationLoadGate;
    await route.continue();
  });

  try {
    await dialog.getByRole("button", { name: "Open event conversation" }).click();
    await expect.poll(() => delayedConversationLoad, { timeout: 45_000 }).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/app/messages\\?quoteId=${CONVERSATION_QUOTE_ID}$`));

    const arrival = page.locator('[data-arrival-surface="conversation"]');
    const eventHeading = page.getByRole("heading", { name: "Conversation Reception", level: 2 });
    await expect(arrival).toHaveAttribute("data-arrival-state", "pending");
    await expect(arrival).toContainText("Finding Conversation");
    await expect(arrival).not.toContainText(/ready/iu);
    await expect(eventHeading).toBeVisible();
    await expect(eventHeading).not.toBeFocused();
    await page.screenshot({
      path: `${OUTPUT_DIR}/connected-conversation-pending-mobile.png`,
      fullPage: false
    });

    releaseConversationLoad();
    await expect(arrival).toHaveAttribute("data-arrival-state", "resolved", { timeout: 45_000 });
    await expect(arrival).toContainText("Conversation ready");
    await expect(eventHeading).toBeFocused();

    await expect.poll(async () => page.evaluate(() => (
      globalThis.__quotePilotMessagingPerformance.some(
        (entry) => entry.milestone === "thread_interactive"
      )
    )), { timeout: 45_000 }).toBe(true);
    const observations = await page.evaluate(() => globalThis.__quotePilotMessagingPerformance);
    const relevant = observations.filter(({ milestone }) => [
      "route_usable",
      "inbox_visible",
      "thread_interactive"
    ].includes(milestone));
    expect(relevant.map(({ milestone }) => milestone)).toEqual(expect.arrayContaining([
      "route_usable",
      "inbox_visible",
      "thread_interactive"
    ]));
    for (const observation of relevant) {
      expect(Object.keys(observation).sort()).toEqual([
        "durationMs",
        "messageCount",
        "milestone",
        "schemaVersion",
        "threadCount"
      ]);
      expect(observation.durationMs).toBeGreaterThanOrEqual(0);
    }
    console.log(`Connected local messaging performance: ${JSON.stringify(relevant)}`);

    await inspectConversationReflow(
      page,
      640,
      "connected-conversation-resolved-200-percent-reflow-proxy.png"
    );
    await inspectConversationReflow(
      page,
      320,
      "connected-conversation-resolved-400-percent-reflow-proxy.png"
    );

    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator(".messaging-station")).toBeVisible();
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);
    await page.screenshot({
      path: `${OUTPUT_DIR}/connected-conversation-resolved-desktop.png`,
      fullPage: false
    });
  } finally {
    releaseConversationLoad();
  }
});

test("connected Payment administration arrival waits for the exact quote read and focus", async ({ page }) => {
  test.skip(
    !AMBIENT_CONNECTED_ARRIVAL_ENABLED,
    "Connected Ambient arrival qualification requires both presentation gates."
  );
  test.setTimeout(180_000);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await exerciseDelayedQuoteAdministrationArrival(page, {
    reviewAction: "Review payments",
    dialogName: "Payments and balance",
    handoffAction: "Open quote workspace",
    objectLabel: "Payment",
    screenshotPrefix: "connected-payment-administration"
  });
});

test("connected Proposal administration arrival waits for the exact quote read and focus", async ({ page }) => {
  test.skip(
    !AMBIENT_CONNECTED_ARRIVAL_ENABLED,
    "Connected Ambient arrival qualification requires both presentation gates."
  );
  test.setTimeout(180_000);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await exerciseDelayedQuoteAdministrationArrival(page, {
    reviewAction: "Review proposal",
    dialogName: "Proposal details",
    handoffAction: "Open proposal controls",
    objectLabel: "Proposal",
    screenshotPrefix: "connected-proposal-administration"
  });
});
