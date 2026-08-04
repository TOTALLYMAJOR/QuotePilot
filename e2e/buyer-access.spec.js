import { expect, test } from "@playwright/test";

const STATUS_STORAGE_KEY = "quotepilot:buyer-access-status:v1";
const REQUEST_STORAGE_KEY = "quotepilot:buyer-access-request:v1";
const ORDER_ID = "ba-0123456789abcdef0123456789abcdef01234567";
const STATUS_TOKEN = "90e1f410-92e0-4e1d-8f62-4e9c6f30eb9c";
const HOSTED_INVOICE_URL = "https://invoice.stripe.com/i/acct_test/test_browser_invoice?s=em";
const E2E_TURNSTILE_TOKEN = "quotepilot-e2e-turnstile-token";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });
});

test("public buyer route creates a fixed invoice without requiring sign-in", async ({ page }) => {
  await page.addInitScript(({ hostedInvoiceUrl, orderId }) => {
    window.__quotePilotE2eFunctions = {
      createBuyerAccessInvoice: async (payload) => {
        window.__buyerInvoicePayload = payload;
        window.__buyerRequestContextAtCall = JSON.parse(
          sessionStorage.getItem("quotepilot:buyer-access-request:v1")
        );
        return {
          orderId,
          statusToken: payload.requestId,
          hostedInvoiceUrl,
          status: "invoice_open"
        };
      }
    };
    window.__quotePilotE2eInvoiceRedirect = (url) => {
      window.__buyerInvoiceRedirect = url;
    };
  }, { hostedInvoiceUrl: HOSTED_INVOICE_URL, orderId: ORDER_ID });

  await page.goto("/start");

  await expect(page.getByRole("heading", { name: "Start with a one-dollar invoice." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your $1 invoice" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Business name" }).fill("Browser Buyer Events");
  await page.getByRole("textbox", { name: "Owner name" }).fill("Avery Browser");
  await page.getByRole("textbox", { name: "Owner email" }).fill("OWNER@Example.com");
  const createButton = page.getByRole("button", { name: "Create my $1 invoice" });
  await expect(createButton).toBeEnabled();
  await createButton.click();

  const payload = await expect.poll(
    () => page.evaluate(() => window.__buyerInvoicePayload)
  ).toBeTruthy().then(() => page.evaluate(() => window.__buyerInvoicePayload));
  expect(payload).toMatchObject({
    organizationName: "Browser Buyer Events",
    ownerName: "Avery Browser",
    ownerEmail: "owner@example.com",
    turnstileToken: E2E_TURNSTILE_TOKEN
  });
  expect(payload.requestId).toMatch(UUID_V4_PATTERN);
  expect(Object.keys(payload).sort()).toEqual([
    "organizationName",
    "ownerEmail",
    "ownerName",
    "requestId",
    "turnstileToken"
  ]);
  await expect.poll(() => page.evaluate(() => window.__buyerInvoiceRedirect))
    .toBe(HOSTED_INVOICE_URL);
  await expect(page).toHaveURL("/start");

  const storedContext = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), STATUS_STORAGE_KEY);
  expect(storedContext).toEqual({ orderId: ORDER_ID, statusToken: payload.requestId });
  expect(JSON.stringify(storedContext)).not.toContain("invoice.stripe.com");
  expect(await page.evaluate(() => window.__buyerRequestContextAtCall)).toMatchObject({
    organizationName: "Browser Buyer Events",
    ownerName: "Avery Browser",
    ownerEmail: "owner@example.com",
    requestId: payload.requestId
  });
  const localValues = await page.evaluate(() => Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return [key, localStorage.getItem(key)];
    })
  ));
  expect(JSON.stringify(localValues)).not.toContain(payload.requestId);
  expect(JSON.stringify(localValues)).not.toContain(ORDER_ID);
  expect(JSON.stringify(localValues)).not.toContain("invoice.stripe.com");
});

test("a failed submission resets Turnstile and reuses the same idempotent request", async ({ page }) => {
  await page.addInitScript(({ hostedInvoiceUrl, orderId }) => {
    window.__quotePilotE2eFunctions = {
      createBuyerAccessInvoice: async (payload) => {
        const attempts = JSON.parse(sessionStorage.getItem("e2e-buyer-invoice-attempts") || "[]");
        attempts.push(payload);
        sessionStorage.setItem("e2e-buyer-invoice-attempts", JSON.stringify(attempts));
        if (attempts.length === 1) {
          throw Object.assign(new Error("temporary provider detail"), {
            code: "functions/unavailable"
          });
        }
        return {
          orderId,
          statusToken: payload.requestId,
          hostedInvoiceUrl,
          status: "invoice_open"
        };
      }
    };
    window.__quotePilotE2eInvoiceRedirect = (url) => {
      window.__buyerInvoiceRedirect = url;
    };
  }, { hostedInvoiceUrl: HOSTED_INVOICE_URL, orderId: ORDER_ID });

  await page.goto("/start");
  await page.getByRole("textbox", { name: "Business name" }).fill("Retry Events");
  await page.getByRole("textbox", { name: "Owner name" }).fill("Riley Retry");
  await page.getByRole("textbox", { name: "Owner email" }).fill("retry@example.com");
  await page.getByRole("button", { name: "Create my $1 invoice" }).click();

  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect.poll(() => page.evaluate(() => window.__quotePilotE2eTurnstileResetCount)).toBe(1);
  const firstRequest = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), REQUEST_STORAGE_KEY);
  expect(firstRequest).toMatchObject({
    organizationName: "Retry Events",
    ownerName: "Riley Retry",
    ownerEmail: "retry@example.com"
  });

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Business name" })).toHaveValue("Retry Events");
  await expect(page.getByRole("textbox", { name: "Owner name" })).toHaveValue("Riley Retry");
  await expect(page.getByRole("textbox", { name: "Owner email" })).toHaveValue("retry@example.com");
  const createButton = page.getByRole("button", { name: "Create my $1 invoice" });
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect.poll(() => page.evaluate(() => window.__buyerInvoiceRedirect)).toBe(HOSTED_INVOICE_URL);

  const attempts = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("e2e-buyer-invoice-attempts"))
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[0].requestId).toBe(attempts[1].requestId);
  expect(attempts[1].turnstileToken).toBe(E2E_TURNSTILE_TOKEN);
});

test("browser return stays locked through invoice, provisioning, and activation states", async ({ page }) => {
  await page.addInitScript(({ hostedInvoiceUrl, orderId, statusStorageKey, statusToken }) => {
    sessionStorage.setItem(statusStorageKey, JSON.stringify({ orderId, statusToken }));
    window.__buyerStatus = "invoice_open";
    window.__buyerProvisioningReady = false;
    window.__quotePilotE2eFunctions = {
      getBuyerAccessInvoiceStatus: async ({ orderId: requestedOrderId }) => {
        const status = window.__buyerStatus;
        const activationReady = status === "activation_sent" || status === "active";
        const workspaceReady = status === "provisioning"
          ? window.__buyerProvisioningReady
          : activationReady;
        return {
          orderId: requestedOrderId,
          status,
          activationEmailSent: activationReady,
          workspaceReady,
          appUrl: status === "active" ? "/app" : null,
          hostedInvoiceUrl: status === "invoice_open" ? hostedInvoiceUrl : null
        };
      }
    };
  }, {
    hostedInvoiceUrl: HOSTED_INVOICE_URL,
    orderId: ORDER_ID,
    statusStorageKey: STATUS_STORAGE_KEY,
    statusToken: STATUS_TOKEN
  });

  await page.goto("/start");

  await expect(page.getByRole("heading", { name: "Your $1 invoice is ready" })).toBeVisible();
  await expect(page.getByText(/cannot mark the invoice paid or grant access/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open my Stripe invoice" }))
    .toHaveAttribute("href", HOSTED_INVOICE_URL);
  await expect(page.getByRole("link", { name: "Sign in to your QuotePilot workspace" })).toHaveCount(0);

  await page.evaluate(() => {
    window.__buyerStatus = "provisioning";
    window.__buyerProvisioningReady = false;
  });
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("heading", { name: "Preparing your invoice" })).toBeVisible();
  await expect(page.getByText(/no payment has been claimed/i)).toBeVisible();

  await page.evaluate(() => {
    window.__buyerProvisioningReady = true;
  });
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("heading", { name: "Payment confirmed — your workspace is prepared" })).toBeVisible();
  await expect(page.getByText(/account activation is still pending/i)).toBeVisible();

  await page.evaluate(() => {
    window.__buyerStatus = "activation_sent";
  });
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("heading", { name: "Check your email to activate QuotePilot" })).toBeVisible();
  await expect(page.getByText(/access stays locked/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to your QuotePilot workspace" })).toHaveCount(0);

  await page.evaluate(() => {
    window.__buyerStatus = "active";
  });
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("heading", { name: "Your workspace is ready" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to your QuotePilot workspace" }))
    .toHaveAttribute("href", "/app");
});

test("status identities in the URL are ignored and never claim payment or access", async ({ page }) => {
  await page.goto(`/start?order=${ORDER_ID}`);
  await expect(page.getByText("Invoice status details in the URL were ignored.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your $1 invoice" })).toBeVisible();
  await expect(page.getByText("Your workspace is ready", { exact: true })).toHaveCount(0);

  await page.goto(`/start?statusToken=${STATUS_TOKEN}`);
  await expect(page.getByText("Invoice status details in the URL were ignored.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your $1 invoice" })).toBeVisible();
  await expect(page.getByText("Your workspace is ready", { exact: true })).toHaveCount(0);
});

test("buyer invoice intake stays contained on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/start");

  await expect(page.getByRole("heading", { name: "Start with a one-dollar invoice." })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("customer portal query keeps precedence over the public buyer route", async ({ page }) => {
  await page.goto("/start?portal=e2e-buyer-route-precedence");

  await expect(page.getByRole("heading", { name: "Proposal Decision Center" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with a one-dollar invoice." }))
    .toHaveCount(0);
});
