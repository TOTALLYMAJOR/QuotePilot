import { expect, test } from "@playwright/test";

async function openCustomerProvisioning(page) {
  const platformLauncher = page.getByRole("button", { name: "Open Customer Provisioning" });
  const scopedLauncher = page.getByRole("button", { name: "Operations" });

  await expect.poll(async () => (
    await platformLauncher.isVisible() || await scopedLauncher.isVisible()
  )).toBe(true);

  if (await platformLauncher.isVisible()) {
    await platformLauncher.click();
  } else {
    await expect(page.getByRole("button", { name: "New Quote" })).toBeVisible();
    await scopedLauncher.click();
    await page.getByRole("menuitem", { name: "Integrations Ops" }).click();
  }

  await expect(page.getByRole("heading", { name: "Customer Provisioning (Admin)" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/app");
  await openCustomerProvisioning(page);
});

test("unscoped platform operators see only the customer-provisioning surface", async ({ page }) => {
  test.skip(
    process.env.VITE_E2E_ORGANIZATION_ID !== "",
    "Run with an empty VITE_E2E_ORGANIZATION_ID to exercise the unscoped platform-operator shell."
  );

  const dialog = page.getByRole("dialog");
  await expect(page.locator("main").getByRole("heading", { name: "Customer Provisioning", exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Customer Provisioning", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your Catalog Connection Needs Attention" })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Provider Config" })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: /Buyer Setup Assistant/i })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: /Buyer Invoice Recovery/i })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /Organization Cleanup/i })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: /Record Integration Event/i })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Integration Activity" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Refresh" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Check Setup" })).toHaveCount(0);
});

test("sales can view CRM activity without provider setup or test controls", async ({ page }) => {
  test.skip(
    process.env.VITE_E2E_ROLE !== "sales",
    "Run with VITE_E2E_ROLE=sales to exercise staff-visible integration activity."
  );

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Integration Activity" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Provider Config" })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: /Buyer Setup Assistant/i })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: /Buyer Invoice Recovery/i })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: /Record Integration Event/i })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Check Setup" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Send Test SMS" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Record Event" })).toHaveCount(0);
});

test("new-customer owner identity starts blank and requires an explicit choice", async ({ page }) => {
  const dialog = page.getByRole("dialog");
  const ownerEmail = dialog.getByRole("textbox", { name: /Owner email/i });
  const ownerUid = dialog.getByRole("textbox", { name: /Owner UID/i });

  await expect(ownerEmail).toHaveValue("");
  await expect(ownerUid).toHaveValue("");

  await dialog.getByRole("combobox", { name: "Plan" }).selectOption("growth");
  await dialog.getByRole("button", { name: "Provision Customer" }).click();
  await expect(dialog.getByText("Organization name and owner email are required.")).toBeVisible();

  await dialog.getByRole("button", { name: "Use My Account" }).click();
  await expect(ownerEmail).toHaveValue("e2e-admin@local.test");
  await expect(ownerUid).toHaveValue("e2e-admin");
});

test("existing-organization mode is explicit and removes owner handoff inputs", async ({ page }) => {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Use My Account" }).click();
  await dialog.getByLabel(/Update an existing organization/i).check();

  await expect(dialog.getByRole("textbox", { name: /Owner email/i })).toBeDisabled();
  await expect(dialog.getByRole("textbox", { name: /Owner email/i })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: /Owner UID/i })).toBeDisabled();
  await expect(dialog.getByRole("textbox", { name: /Owner UID/i })).toHaveValue("");
  await expect(dialog.getByLabel("Send onboarding email now")).toBeDisabled();
  await expect(dialog.getByText(/does not change owner identity, branding, catalog data, or invites/i)).toBeVisible();

  await dialog.getByRole("combobox", { name: "Plan" }).selectOption("starter");
  await dialog.getByRole("button", { name: "Update Entitlements" }).click();
  await expect(dialog.getByText("Organization id is required for an existing-organization update.")).toBeVisible();
});

test("generates one stable order id before preflight and locks controls while checking", async ({ page }) => {
  const dialog = page.getByRole("dialog");
  const provisioningControls = dialog.locator("fieldset.provisioning-controls");
  const orderId = dialog.getByRole("textbox", { name: /Order id/i });
  const provisionButton = dialog.getByRole("button", { name: "Provision Customer" });

  await dialog.getByRole("textbox", { name: "Organization name" }).fill("Stable Order Events");
  await dialog.getByRole("textbox", { name: /Owner email/i }).fill("owner@example.com");
  await dialog.getByRole("combobox", { name: "Plan" }).selectOption("growth");
  await expect(orderId).toHaveValue("");
  await provisioningControls.evaluate((fieldset) => {
    window.__provisioningControlsLocked = false;
    const observer = new MutationObserver(() => {
      if (fieldset.disabled && fieldset.getAttribute("aria-busy") === "true") {
        window.__provisioningControlsLocked = true;
        observer.disconnect();
      }
    });
    observer.observe(fieldset, {
      attributes: true,
      attributeFilter: ["disabled", "aria-busy"]
    });
  });

  await provisionButton.click();
  await expect.poll(() => page.evaluate(() => window.__provisioningControlsLocked)).toBe(true);
  await expect(dialog.getByText("Cloud Functions are not configured.")).toBeVisible();
  await expect(provisioningControls).toBeEnabled();
  await expect(orderId).toHaveValue(/^qp-[a-z0-9-]+$/);
  const firstOrderId = await orderId.inputValue();

  await provisionButton.click();
  await expect(dialog.getByText("Cloud Functions are not configured.")).toBeVisible();
  await expect(orderId).toHaveValue(firstOrderId);
});

test("reopening provisioning starts a fresh customer session with the canonical app URL", async ({ page }) => {
  let dialog = page.getByRole("dialog");
  const canonicalAppUrl = "https://quotepilot.mbmapps.com/app";

  await dialog.getByRole("textbox", { name: "Organization name" }).fill("Previous Customer");
  await dialog.getByRole("textbox", { name: /^Organization id/i }).fill("previous-customer");
  await dialog.getByRole("textbox", { name: /Owner email/i }).fill("previous@example.com");
  await dialog.getByRole("textbox", { name: /Owner name/i }).fill("Previous Owner");
  await dialog.getByRole("textbox", { name: /Owner UID/i }).fill("previous-owner-uid");
  await dialog.getByRole("combobox", { name: "Plan" }).selectOption("enterprise");
  await dialog.getByRole("textbox", { name: /Order id/i }).fill("previous-order");
  await dialog.getByRole("textbox", { name: /Support email/i }).fill("support@example.com");
  await expect(dialog.getByRole("textbox", { name: "App URL" })).toHaveValue(canonicalAppUrl);
  await dialog.getByLabel("Send onboarding email now").check();

  await dialog.getByRole("button", { name: "Close" }).click();
  await openCustomerProvisioning(page);
  dialog = page.getByRole("dialog");

  await expect(dialog.getByRole("textbox", { name: "Organization name" })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: /^Organization id/i })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: /Owner email/i })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: /Owner name/i })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: /Owner UID/i })).toHaveValue("");
  await expect(dialog.getByRole("combobox", { name: "Plan" })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: /Order id/i })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: /Support email/i })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: "App URL" })).toHaveValue(canonicalAppUrl);
  await expect(dialog.getByLabel("Send onboarding email now")).not.toBeChecked();

  await dialog.getByLabel(/Update an existing organization/i).check();
  await dialog.getByRole("textbox", { name: /^Organization id/i }).fill("existing-customer");
  await dialog.getByRole("combobox", { name: "Plan" }).selectOption("starter");
  await dialog.getByRole("textbox", { name: /Order id/i }).fill("existing-order");
  await dialog.getByRole("button", { name: "Close" }).click();
  await openCustomerProvisioning(page);
  dialog = page.getByRole("dialog");

  await expect(dialog.getByLabel(/Update an existing organization/i)).not.toBeChecked();
  await expect(dialog.getByRole("textbox", { name: /^Organization id/i })).toHaveValue("");
  await expect(dialog.getByRole("combobox", { name: "Plan" })).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: /Order id/i })).toHaveValue("");
});

test("successful provisioning preserves a recoverable manual owner handoff", async ({ page }) => {
  await page.evaluate(() => {
    window.__quotePilotE2eFunctions = {
      preflightCustomerOrder: async (payload) => ({
        ok: true,
        preflight: true,
        organizationId: payload.organizationId || "browser-success-events",
        exists: false,
        orderExists: false,
        unsafeResidue: false,
        canCreate: true
      }),
      provisionCustomerOrder: async (payload) => ({
        ok: true,
        operation: "created",
        organizationId: payload.organizationId || "browser-success-events",
        organizationName: payload.organizationName,
        ownerEmail: payload.ownerEmail,
        ownerUid: "",
        orderId: payload.orderId,
        plan: payload.plan,
        email: {
          sent: false,
          reason: "send_email_disabled"
        },
        claimsSync: {
          required: false,
          succeeded: true
        },
        onboarding: {
          emailSubject: "Your QuotePilot workspace is ready",
          emailText: "Sign in at https://quotepilot.mbmapps.com/app"
        }
      })
    };
  });

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Organization name" }).fill("Browser Success Events");
  await dialog.getByRole("textbox", { name: /^Organization id/i }).fill("browser-success-events");
  await dialog.getByRole("textbox", { name: /Owner email/i }).fill("owner@example.com");
  await dialog.getByRole("combobox", { name: "Plan" }).selectOption("growth");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Provision Customer" }).click();

  await expect(dialog.getByText("Organization created")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy Onboarding Message" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Organization name" })).toHaveValue("");
  await expect(dialog.getByRole("combobox", { name: "Plan" })).toHaveValue("");

  await dialog.getByRole("button", { name: "Close" }).click();
  await openCustomerProvisioning(page);
  await expect(page.getByRole("dialog").getByText(/Most recent successful provisioning order/i)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Copy Onboarding Message" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Provision Customer" }).click();
  await expect(page.getByRole("dialog").getByText(/Select an explicit starter/i)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Copy Onboarding Message" })).toHaveCount(0);
});

test("claims-sync failure blocks handoff until explicit repair succeeds", async ({ page }) => {
  await page.evaluate(() => {
    window.__quotePilotE2eFunctions = {
      preflightCustomerOrder: async (payload) => ({
        ok: true,
        preflight: true,
        organizationId: payload.organizationId || "claims-repair-events",
        exists: false,
        orderExists: false,
        unsafeResidue: false,
        canCreate: true
      }),
      provisionCustomerOrder: async (payload) => ({
        ok: true,
        operation: "created",
        organizationId: payload.organizationId || "claims-repair-events",
        organizationName: payload.organizationName,
        ownerEmail: payload.ownerEmail,
        ownerUid: payload.ownerUid,
        orderId: payload.orderId,
        plan: payload.plan,
        email: {
          sent: false,
          reason: "send_email_disabled"
        },
        claimsSync: {
          required: true,
          succeeded: false,
          error: "simulated sync failure"
        },
        onboarding: {
          emailSubject: "Your QuotePilot workspace is ready",
          emailText: "Sign in at https://quotepilot.mbmapps.com/app"
        }
      }),
      repairCustomerProvisioningOrder: async (payload) => ({
        ok: true,
        operation: "created",
        ownerUid: payload.ownerUid,
        ownerEmail: "owner@example.com",
        organizationId: payload.organizationId,
        orderId: payload.orderId,
        plan: "starter",
        email: {
          sent: true,
          provider: "resend",
          messageId: "mock-repair-message",
          auditPersisted: true
        },
        claimsSync: {
          required: true,
          succeeded: true
        },
        onboarding: {
          emailSubject: "Your QuotePilot workspace is ready",
          emailText: "Sign in at https://quotepilot.mbmapps.com/app"
        }
      })
    };
  });

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Organization name" }).fill("Claims Repair Events");
  await dialog.getByRole("textbox", { name: /^Organization id/i }).fill("claims-repair-events");
  await dialog.getByRole("textbox", { name: /Owner email/i }).fill("owner@example.com");
  await dialog.getByRole("textbox", { name: /Owner UID/i }).fill("owner-uid");
  await dialog.getByRole("combobox", { name: "Plan" }).selectOption("starter");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Provision Customer" }).click();

  await expect(dialog.getByText(/Owner onboarding is incomplete/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy Onboarding Message" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Retry Owner Access Repair" }).click();
  await expect(dialog.getByText(/Owner access and onboarding order repaired/i)).toBeVisible();
  await expect(dialog.getByText(/Email: sent/i)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy Onboarding Message" })).toHaveCount(0);
});

test("editing a new tenant clears the previous customer handoff immediately", async ({ page }) => {
  await page.evaluate(() => {
    sessionStorage.setItem("quotepilot:last-provisioning-result:e2e-admin", JSON.stringify({
      ok: true,
      operation: "created",
      organizationId: "previous-customer",
      organizationName: "Previous Customer",
      ownerEmail: "previous@example.com",
      orderId: "previous-order",
      plan: "growth",
      email: { sent: false, reason: "send_email_disabled" },
      claimsSync: { required: false, succeeded: true },
      onboarding: {
        emailSubject: "Previous customer onboarding",
        emailText: "Previous customer secret handoff"
      }
    }));
  });

  await page.getByRole("button", { name: "Close" }).click();
  await openCustomerProvisioning(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Most recent successful provisioning order/i)).toBeVisible();
  await expect(dialog.getByText(/Previous customer secret handoff/i)).toBeVisible();

  await dialog.getByRole("textbox", { name: "Organization name" }).fill("Next Customer");
  await expect(dialog.getByText(/Previous customer secret handoff/i)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem("quotepilot:last-provisioning-result:e2e-admin")
  )).toBeNull();
});
