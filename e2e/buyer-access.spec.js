import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test("public buyer route collects identity and hands only the fixed order to Stripe", async ({ page }) => {
  await page.addInitScript(() => {
    window.__quotePilotE2eFunctions = {
      createBuyerAccessCheckout: async (payload) => {
        window.__buyerCheckoutPayload = payload;
        return {
          orderId: "browser-buyer-order",
          sessionId: "cs_test_browser_buyer",
          checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_browser_buyer",
          status: "checkout_pending"
        };
      }
    };
    window.__quotePilotE2eCheckoutRedirect = (url) => {
      window.__buyerCheckoutRedirect = url;
    };
  });

  await page.goto("/start");

  await expect(page.getByRole("heading", { name: "Try a starter workspace for one dollar." })).toBeVisible();
  await expect(page.getByText("Test purchase only", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Business name" }).fill("Browser Buyer Events");
  await page.getByRole("textbox", { name: "Owner name" }).fill("Avery Browser");
  await page.getByRole("button", { name: "Continue to Stripe · $1 test" }).click();

  await expect.poll(() => page.evaluate(() => window.__buyerCheckoutPayload)).toEqual({
    organizationName: "Browser Buyer Events",
    ownerName: "Avery Browser"
  });
  await expect.poll(() => page.evaluate(() => window.__buyerCheckoutRedirect))
    .toBe("https://checkout.stripe.com/c/pay/cs_test_browser_buyer");
});

test("success query alone stays pending until owner-scoped status becomes active", async ({ page }) => {
  await page.addInitScript(() => {
    window.__buyerStatus = "checkout_pending";
    window.__quotePilotE2eFunctions = {
      getBuyerAccessCheckoutStatus: async ({ sessionId }) => {
        const active = window.__buyerStatus === "active";
        return {
          orderId: "browser-buyer-order",
          sessionId,
          status: active ? "active" : "checkout_pending",
          accessGranted: active,
          organizationId: active ? "browser-buyer-events" : null,
          appUrl: active ? "/app" : null
        };
      }
    };
  });

  await page.goto("/start?purchase=success&session_id=cs_test_browser_buyer");

  await expect(page.getByRole("heading", { name: "Waiting for Stripe confirmation" })).toBeVisible();
  await expect(page.getByText(/return from Stripe is only a signal to check/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open your QuotePilot workspace" })).toHaveCount(0);

  await page.evaluate(() => {
    window.__buyerStatus = "active";
  });
  await page.getByRole("button", { name: "Check again" }).click();

  await expect(page.getByRole("heading", { name: "Your workspace is ready" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open your QuotePilot workspace" }))
    .toHaveAttribute("href", "/app");
});

test("cancelled and malformed returns never claim access", async ({ page }) => {
  await page.goto("/start?purchase=cancelled");
  await expect(page.getByText("Checkout returned as cancelled.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up your starter workspace" })).toBeVisible();
  await expect(page.getByText("Your workspace is ready", { exact: true })).toHaveCount(0);

  await page.goto("/start?purchase=success&session_id=forged");
  await expect(page.getByText("This payment return cannot be verified.", { exact: true })).toBeVisible();
  await expect(page.getByText("Your workspace is ready", { exact: true })).toHaveCount(0);
});

test("buyer access stays contained on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/start");

  await expect(page.getByRole("heading", { name: "Try a starter workspace for one dollar." })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("customer portal query keeps precedence over the public buyer route", async ({ page }) => {
  await page.goto("/start?portal=e2e-buyer-route-precedence");

  await expect(page.getByRole("heading", { name: "Proposal Decision Center" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Try a starter workspace for one dollar." }))
    .toHaveCount(0);
});
