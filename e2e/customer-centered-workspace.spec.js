import { expect, test } from "@playwright/test";

const CUSTOMER_CENTERED_WORKSPACE_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED || "").trim().toLowerCase()
);

async function fillRequiredQuoteFields(page) {
  const eventType = page.getByLabel(/Event type/i);
  await expect(eventType).toBeVisible();
  await eventType.selectOption({ index: 1 });
  await page.getByLabel(/Event date/i).fill("2027-06-12");
  await page.getByLabel(/Start time/i).fill("18:00");
  await page.getByRole("spinbutton", { name: /Event hours/i }).fill("4");
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("72");
  await page.getByLabel("Event name").fill("Context Catalog Dinner");
  await page.getByRole("textbox", { name: /Venue/i }).first().fill("Context Hall");
  await page.getByRole("textbox", { name: /Venue address/i }).fill("100 Context Way");
  await page.getByRole("textbox", { name: /Your name/i }).fill("Context Customer");
  await page.getByRole("textbox", { name: /Phone/i }).fill("205-555-0101");
  await page.getByRole("textbox", { name: /Email/i }).fill("context@example.test");
}

test.describe("customer-centered workspace", () => {
  test.skip(
    !CUSTOMER_CENTERED_WORKSPACE_ENABLED,
    "The customer-centered workspace browser contract runs only when its rollout flag is enabled."
  );

  test("/app is Home and a dirty quote draft survives routed Home, Back, and Forward navigation", async ({ page }) => {
    await page.goto("/app");

    const homeHeading = page.getByRole("heading", { name: "What needs your attention" });
    await expect(homeHeading).toBeVisible();
    await expect(homeHeading).toBeFocused();
    const evidenceRail = page.getByRole("complementary", { name: "Staff read context" });
    await expect(evidenceRail).toHaveAttribute("data-capability-state", /current|truncated/);
    await expect(evidenceRail).toContainText("Tenant key: e2e-org");
    await expect(evidenceRail).toContainText("Browser-local workspace");
    await expect(evidenceRail).toContainText("does not prove provider delivery");
    const staffHeader = page.locator(".site-header");
    await expect(staffHeader.getByRole("button", { name: "Home", exact: true })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(staffHeader.getByRole("button", { name: "Customers", exact: true })).toBeVisible();
    await expect(staffHeader.getByRole("button", { name: "Quotes", exact: true })).toBeVisible();
    await expect(staffHeader.getByRole("button", { name: /^Workflow/ })).toBeVisible();
    await expect(staffHeader.getByRole("button", { name: "Schedule", exact: true })).toBeVisible();

    await staffHeader.getByRole("button", { name: "New quote", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/quotes\/new$/);

    const eventName = page.getByLabel("Event name");
    await eventName.fill("Sticky command-center draft");
    await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();

    await staffHeader.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "What needs your attention" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/app\/quotes\/new$/);
    await expect(eventName).toBeVisible();
    await expect(eventName).toHaveValue("Sticky command-center draft");

    await page.goForward();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "What needs your attention" })).toBeVisible();

    await page.goBack();
    await expect(eventName).toBeVisible();
    await expect(eventName).toHaveValue("Sticky command-center draft");
  });

  test("/app/home replaces to the canonical Home route", async ({ page }) => {
    await page.goto("/app/home");

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "What needs your attention" })).toBeVisible();
  });

  test("explicit New quote discard and browser-exit protection remain attached to a dirty routed draft", async ({ page }) => {
    await page.goto("/app/quotes/new");
    const eventName = page.getByLabel("Event name");
    await eventName.fill("Protected routed draft");

    expect(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(true);

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Your unsaved changes will be discarded");
      await dialog.dismiss();
    });
    await page.locator(".site-header").getByRole("button", { name: "New quote", exact: true }).click();
    await expect(eventName).toHaveValue("Protected routed draft");

    page.once("dialog", async (dialog) => dialog.accept());
    await page.locator(".site-header").getByRole("button", { name: "New quote", exact: true }).click();
    await expect(eventName).toHaveValue("");
    await expect(page.getByText("Ready for a new quote", { exact: true })).toBeVisible();
  });

  test("primary workspace navigation remains visible and overflow-safe at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");

    const header = page.locator(".site-header");
    for (const name of ["Home", "Customers", "Quotes", "Schedule"]) {
      await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(header.getByRole("button", { name: /^Workflow/ })).toBeVisible();
    await expect(header.getByRole("button", { name: "More", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await header.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/schedule$/);
    await expect(page.getByRole("region", { name: "Event Schedule" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("desktop workspace navigation keeps Account with the primary actions across nearby widths", async ({ page }) => {
    for (const width of [1440, 1366, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/app");

      const header = page.locator(".site-header");
      for (const name of ["Home", "Customers", "Quotes", "Schedule", "Operations", "Account"]) {
        await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
      }
      await expect(header.getByRole("button", { name: /^Workflow/ })).toBeVisible();
      await expect(header.getByRole("button", { name: "More", exact: true })).toBeHidden();

      const [homeBox, accountBox] = await Promise.all([
        header.getByRole("button", { name: "Home", exact: true }).boundingBox(),
        header.getByRole("button", { name: "Account", exact: true }).boundingBox()
      ]);
      expect(homeBox).not.toBeNull();
      expect(accountBox).not.toBeNull();
      expect(Math.abs(accountBox.y - homeBox.y)).toBeLessThanOrEqual(2);
      await expect(header.locator(".header-actions")).toHaveCSS("flex-wrap", "nowrap");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });

  test("unknown staff paths render an authenticated in-shell 404", async ({ page }) => {
    await page.goto("/app/not-a-workspace-route");

    await expect(page.getByRole("heading", { name: "Workspace page not found" })).toBeVisible();
    await expect(page.getByText("/app/not-a-workspace-route is not a QuotePilot staff workspace route.")).toBeVisible();
    await expect(page.locator(".site-header").getByRole("button", { name: "Home", exact: true })).toBeVisible();
  });

  test("primary routed staff surfaces focus their heading and use route return language", async ({ page }) => {
    const surfaces = [
      ["/app/customers", "Customer directory", false],
      ["/app/quotes", "Quotes", true],
      ["/app/workflow", "Workflow", true]
    ];

    for (const [path, headingName, hasReturn] of surfaces) {
      await page.goto(path);
      const heading = page.getByRole("heading", { name: headingName, exact: true }).first();
      await expect(heading).toBeVisible();
      await expect(heading).toBeFocused();
      await expect(heading).toHaveCSS("outline-style", "solid");
      if (hasReturn) {
        await expect(page.getByRole("button", { name: "Back to Home", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
      }
    }
  });

  test("operational paths render as embedded workspaces and preserve browser history", async ({ page }) => {
    const surfaces = [
      ["/app/schedule", "Event Schedule"],
      ["/app/reporting", "Reporting Dashboard"],
      ["/app/catalog", "Catalog Admin"],
      ["/app/imports", "Import Studio"],
      ["/app/integrations", "Integrations Ops"],
      ["/app/diagnostics", "Session Diagnostics"]
    ];

    for (const [path, name] of surfaces) {
      await page.goto(path);
      const route = page.getByRole("region", { name });
      await expect(route).toBeVisible();
      await expect(route).toHaveClass(/embedded-workspace-route/);
      const heading = route.getByRole("heading", { name });
      await expect(heading).toBeVisible();
      if (path === "/app/schedule") {
        await expect(heading).toBeFocused();
        await expect(heading).toHaveCSS("outline-style", "solid");
        await expect(heading).toHaveCSS("outline-width", "3px");
      }
      await expect(route.getByRole("button", { name: "Back to Home", exact: true })).toBeVisible();
      await expect(route.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name })).toHaveCount(0);
    }

    await page.goto("/app");
    const operations = page.locator(".desktop-header-menu").getByRole("button", { name: "Operations" });
    await operations.click();
    await page.getByRole("menuitem", { name: "Reporting Dashboard" }).click();
    await expect(page).toHaveURL(/\/app\/reporting$/);
    await expect(page.getByRole("region", { name: "Reporting Dashboard" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "What needs your attention" })).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/app\/reporting$/);
    await expect(page.getByRole("region", { name: "Reporting Dashboard" })).toBeVisible();
  });

  test("quote-builder Catalog work stays contextual and modal while routed Catalog stays embedded", async ({ page }) => {
    await page.addInitScript(() => {
      window.__quotePilotE2eFunctions = { loadMenuByEvent: async () => [] };
    });
    await page.goto("/app/quotes/new");
    await fillRequiredQuoteFields(page);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText(/No menu items are configured for/i)).toBeVisible();
    await page.getByRole("button", { name: "Add menu items", exact: true }).click();

    const catalogDialog = page.getByRole("dialog", { name: "Catalog Admin" });
    await expect(catalogDialog).toBeVisible();
    await expect(catalogDialog).toHaveAttribute("aria-modal", "true");
    await expect(page).toHaveURL(/\/app\/quotes\/new$/);
    await expect(page.getByRole("region", { name: "Catalog Admin" })).toHaveCount(0);

    await catalogDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(catalogDialog).toHaveCount(0);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByLabel("Event name")).toHaveValue("Context Catalog Dinner");
  });

  test("an operational route chunk failure recovers in-shell without becoming a modal", async ({ page }) => {
    await page.route("**/src/components/DiagnosticsModal.jsx*", (route) => route.abort("failed"));
    await page.goto("/app/diagnostics");

    const recovery = page.locator(".ui-recovery-route");
    await expect(recovery.getByRole("heading", { name: "Session Diagnostics did not load" })).toBeVisible();
    await expect(recovery.getByRole("button", { name: "Try again" })).toBeFocused();
    await expect(recovery.getByRole("button", { name: "Reload page" })).toBeVisible();
    await expect(recovery.getByRole("button", { name: "Back to QuotePilot" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Session Diagnostics did not load" })).toHaveCount(0);

    await recovery.getByRole("button", { name: "Back to QuotePilot" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "What needs your attention" })).toBeVisible();
  });

  test("sticky Quotes and Workflow failures stay route-scoped without losing the dirty quote draft", async ({ page }) => {
    await page.route("**/src/components/QuoteHistoryModal.jsx*", (route) => route.abort("failed"));
    await page.route("**/src/components/SalesWorkflowModal.jsx*", (route) => route.abort("failed"));
    await page.goto("/app/quotes/new");

    const eventName = page.getByLabel("Event name");
    await eventName.fill("Recovery-safe routed draft");
    const header = page.locator(".site-header");

    const exerciseFailure = async ({ trigger, path, heading }) => {
      await header.getByRole("button", {
        name: trigger,
        exact: typeof trigger === "string"
      }).click();
      await expect(page).toHaveURL(path);
      const recovery = page.locator(".ui-recovery-route");
      await expect(recovery.getByRole("heading", { name: heading })).toBeVisible();
      await recovery.getByRole("button", { name: "Back to QuotePilot" }).click();

      await expect(page).toHaveURL(/\/app$/);
      await expect(page.getByRole("heading", { name: heading })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "What needs your attention" })).toBeVisible();

      await page.goBack();
      await expect(page).toHaveURL(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/app\/quotes\/new$/);
      await expect(eventName).toHaveValue("Recovery-safe routed draft");
    };

    await exerciseFailure({
      trigger: "Quotes",
      path: /\/app\/quotes$/,
      heading: "Quotes did not load"
    });
    await exerciseFailure({
      trigger: /^Workflow/,
      path: /\/app\/workflow$/,
      heading: "Workflow did not load"
    });
  });

  test("Home targets the exact customer, Workflow attention item, and quote record", async ({ page }) => {
    await page.addInitScript(() => {
      const createdAtISO = "2026-08-08T10:00:00.000Z";
      localStorage.setItem("quoteWizard.quotes", JSON.stringify([
        {
          id: "home-attention-quote",
          organizationId: "e2e-org",
          customerId: "home-attention-customer",
          quoteNumber: "Q-HOME-ATTENTION",
          status: "sent",
          createdAtISO,
          updatedAtISO: "2026-08-08T11:00:00.000Z",
          expiresAtISO: "2099-12-31T23:59:59.000Z",
          customer: { name: "Home Attention Customer", email: "attention@example.test" },
          event: { name: "Attention Dinner", date: "2027-03-12", guests: 40 },
          totals: { total: 4000, deposit: 1000 },
          payment: { depositStatus: "unpaid" },
          portalDecision: {
            decision: "changes_requested",
            requestId: "home-request-1",
            message: "Please revise the service timing.",
            submittedAtISO: "2026-08-08T11:00:00.000Z"
          }
        },
        {
          id: "home-money-quote",
          organizationId: "e2e-org",
          customerId: "home-money-customer",
          quoteNumber: "Q-HOME-MONEY",
          status: "accepted",
          createdAtISO,
          updatedAtISO: "2026-08-08T12:00:00.000Z",
          expiresAtISO: "2099-12-31T23:59:59.000Z",
          customer: { name: "Home Money Customer", email: "money@example.test" },
          event: { name: "Money Dinner", date: "2027-03-13", guests: 55 },
          totals: { total: 5000, deposit: 1500 },
          payment: { depositStatus: "unpaid" },
          lifecycle: { acceptedAtISO: "2026-08-08T12:00:00.000Z" }
        }
      ]));
    });

    await page.goto("/app");
    const attentionRow = page.locator(".command-center-row").filter({ hasText: "Please revise the service timing." });
    await expect(attentionRow).toBeVisible();

    await attentionRow.getByRole("button", { name: "Home Attention Customer", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/customers\/home-attention-customer$/);
    await expect(page.getByRole("heading", { name: "Home Attention Customer", level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "What needs your attention" })).toBeVisible();

    await page.locator(".command-center-row").filter({ hasText: "Please revise the service timing." })
      .getByRole("button", { name: "Open in Workflow" }).click();
    await expect(page).toHaveURL(/\/app\/workflow\?quoteId=home-attention-quote&attentionType=change_request&requestId=home-request-1$/);
    const focusedAttention = page.locator('[data-attention-id="change-request:home-attention-quote:2026-08-08T11:00:00.000Z"]');
    await expect(focusedAttention).toBeVisible();
    await expect(focusedAttention).toBeFocused();

    await page.goBack();
    await expect(page.getByRole("heading", { name: "What needs your attention" })).toBeVisible();
    const moneyRow = page.locator(".command-center-row").filter({ hasText: "Q-HOME-MONEY" });
    await moneyRow.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/quotes\/home-money-quote$/);
    const focusedQuote = page.locator('.saved-quote-handoff[data-quote-id="home-money-quote"]');
    await expect(focusedQuote).toBeVisible();
    await expect(focusedQuote).toBeFocused();
  });

  test("a portal token takes precedence over the staff surface on a nested workspace path", async ({ page }) => {
    const portalKey = "workspace-portal-precedence-12345678901234567890";
    const createdAtISO = "2026-08-08T12:00:00.000Z";

    await page.addInitScript(({ key, createdAt }) => {
      localStorage.setItem("quoteWizard.quotes", JSON.stringify([{
        id: "workspace-portal-precedence-quote",
        organizationId: "e2e-org",
        quoteNumber: "Q-WORKSPACE-PORTAL",
        status: "sent",
        portalKey: key,
        portalIssuedAtISO: createdAt,
        portalExpiresAtISO: "2099-12-31T23:59:59.000Z",
        expiresAtISO: "2099-12-31T23:59:59.000Z",
        createdAtISO: createdAt,
        updatedAtISO: createdAt,
        customer: { name: "Portal Route Customer", email: "portal-route@example.com" },
        event: {
          name: "Portal Route Dinner",
          date: "2027-06-12",
          time: "18:00",
          hours: 4,
          guests: 80,
          venue: "Route Hall",
          style: "Plated"
        },
        totals: { total: 5000, deposit: 1500, serviceFee: 600, serviceFeePctApplied: 0.18 },
        selection: { packageName: "Route Dinner", menuItemNames: ["Herb Chicken"] },
        payment: { depositStatus: "unpaid", depositLink: "" },
        booking: {},
        quoteMeta: {
          organizationName: "Northstar Events",
          brandName: "Northstar Catering",
          businessEmail: "events@northstar.test",
          businessPhone: "205-555-0100",
          brandPrimaryColor: "#8d611a",
          brandDarkAccentColor: "#5e3b08"
        },
        lifecycle: { sentAtISO: createdAt }
      }]));
    }, { key: portalKey, createdAt: createdAtISO });

    await page.goto(`/app/quotes/new?portal=${encodeURIComponent(portalKey)}`);

    await expect(page.getByRole("heading", { name: "Your proposal from Northstar Catering" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Portal Route Dinner on June 12, 2027/ })).toBeVisible();
    await expect(page.locator(".site-header")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "What needs your attention" })).toHaveCount(0);
  });

  test("Customer 360 keeps customer identity opaque and staff preview separate from portal evidence", async ({ page }) => {
    const customerId = "customer:360+e2e";
    const quoteId = "quote-customer-360-accepted";
    const createdAtISO = "2026-08-07T15:00:00.000Z";
    const acceptedAtISO = "2026-08-08T16:30:00.000Z";

    await page.addInitScript(({ customerKey, canonicalQuoteId, createdAt, acceptedAt }) => {
      const quote = {
        id: canonicalQuoteId,
        organizationId: "e2e-org",
        customerId: customerKey,
        quoteNumber: "Q-C360-ACCEPTED",
        status: "accepted",
        activeVersionId: "v0002",
        latestVersionNumber: 2,
        portalKey: "customer-360-portal-12345678901234567890",
        portalIssuedAtISO: createdAt,
        portalExpiresAtISO: "2099-12-31T23:59:59.000Z",
        expiresAtISO: "2099-12-31T23:59:59.000Z",
        createdAtISO: createdAt,
        updatedAtISO: acceptedAt,
        customer: {
          name: "Avery O'Neil",
          email: "avery.oneil@example.com",
          phone: "205-555-0188",
          organization: "O'Neil Community Foundation"
        },
        event: {
          name: "Community Leadership Dinner",
          date: "2027-04-24",
          time: "18:30",
          hours: 4,
          guests: 120,
          venue: "Heritage Hall",
          style: "Plated"
        },
        totals: {
          subtotal: 5000,
          serviceFee: 900,
          tax: 600,
          total: 6500,
          deposit: 1500
        },
        selection: {
          packageName: "Leadership Dinner",
          menuItemNames: ["Herb Chicken", "Seasonal Vegetables"]
        },
        payment: {
          depositStatus: "paid",
          depositConfirmedAtISO: acceptedAt,
          finalBalance: {
            status: "sent",
            amountCents: 500000,
            paymentLink: "https://checkout.example.test/final-balance"
          }
        },
        booking: {},
        portalDecision: {
          decision: "accepted",
          submittedAtISO: acceptedAt,
          receipt: {
            signerName: "Avery O'Neil",
            consentVersion: "proposal-acceptance-v1",
            signedAtISO: acceptedAt
          }
        },
        conversationSummary: {
          messageCount: 2,
          latestMessageAtISO: acceptedAt,
          latestActorType: "customer"
        },
        lifecycle: {
          draftAtISO: createdAt,
          sentAtISO: "2026-08-07T18:00:00.000Z",
          acceptedAtISO: acceptedAt
        }
      };

      localStorage.setItem("quoteWizard.quotes", JSON.stringify([quote]));
      localStorage.setItem("quoteWizard.quoteHistory", JSON.stringify([{
        id: "customer-360-version-record",
        versionId: "v0002",
        versionNumber: 2,
        reason: "customer_accepted_revision",
        quoteId: canonicalQuoteId,
        organizationId: "e2e-org",
        customerId: customerKey,
        snapshot: quote,
        pricing: quote.totals,
        timestamp: acceptedAt
      }]));
    }, {
      customerKey: customerId,
      canonicalQuoteId: quoteId,
      createdAt: createdAtISO,
      acceptedAt: acceptedAtISO
    });

    await page.goto("/app/customers");

    await expect(page.getByRole("heading", { name: "Customer directory" })).toBeVisible();
    await expect(page.getByText("Source: Browser-local workspace", { exact: true })).toBeVisible();
    const customerRow = page.getByRole("row").filter({ hasText: "Avery O'Neil" });
    await expect(customerRow).toContainText("Q-C360-ACCEPTED");
    await expect(customerRow).toContainText("Community Leadership Dinner");
    await expect(customerRow).toContainText("Apr 24, 2027");
    await expect(customerRow).not.toContainText("2027-04-24");
    await customerRow.getByRole("button", { name: "Avery O'Neil", exact: true }).click();

    await expect(page).toHaveURL(/\/app\/customers\/customer%3A360%2Be2e$/);
    await expect(page.getByRole("heading", { name: "Avery O'Neil", level: 1 })).toBeVisible();

    const overviewTab = page.getByRole("tab", { name: "Overview", exact: true });
    const quotesTab = page.getByRole("tab", { name: "Quotes & Proposals", exact: true });
    const eventsTab = page.getByRole("tab", { name: "Events", exact: true });
    const moneyTab = page.getByRole("tab", { name: "Money", exact: true });
    const conversationsTab = page.getByRole("tab", { name: "Conversations", exact: true });

    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
    await expect(quotesTab).toBeVisible();
    await expect(eventsTab).toBeVisible();
    await expect(moneyTab).toBeVisible();
    await expect(conversationsTab).toBeVisible();
    await expect(page.locator("#customer-panel-overview")).toContainText("Accepted / booked events");
    await expect(page.locator("#customer-panel-overview")).toContainText("Proposal accepted");

    await quotesTab.click();
    const quotesPanel = page.locator("#customer-panel-quotes");
    await expect(quotesPanel.getByRole("heading", { name: "Quotes & proposals" })).toBeVisible();
    await expect(quotesPanel.getByRole("heading", { name: "Q-C360-ACCEPTED" })).toBeVisible();
    await expect(quotesPanel.getByText("Customer viewed evidence is never inferred here.", { exact: false })).toBeVisible();
    await expect(quotesPanel).toContainText("1 most recent retained version");
    await quotesPanel.getByText("Review proposal versions", { exact: true }).click();
    await expect(quotesPanel).toContainText("Version 2");
    await expect(quotesPanel).toContainText("Customer accepted revision");

    const previewButton = quotesPanel.getByRole("button", { name: "Preview", exact: true });
    await previewButton.click();

    const staffPreview = quotesPanel.locator(".staff-proposal-preview");
    const customerPresentation = staffPreview.locator('[data-customer-presentation="true"]');
    await expect(staffPreview).toBeVisible();
    await expect(staffPreview.getByRole("heading", { name: "Proposal presentation" })).toBeFocused();
    await expect(staffPreview.getByRole("button", { name: "Close preview" })).toBeVisible();
    await expect(customerPresentation).toHaveAttribute("data-customer-presentation", "true");
    await expect(staffPreview).toContainText(
      "Built from canonical staff data. Opening this preview does not create customer viewed evidence."
    );
    await expect(customerPresentation).toContainText("Community Leadership Dinner");

    await page.keyboard.press("Escape");
    await expect(staffPreview).toHaveCount(0);
    await expect(previewButton).toBeFocused();

    const evidenceAfterPreview = await page.evaluate((canonicalQuoteId) => {
      const quote = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]")
        .find((item) => item.id === canonicalQuoteId);
      const versions = JSON.parse(localStorage.getItem("quoteWizard.quoteHistory") || "[]")
        .filter((item) => item.quoteId === canonicalQuoteId);
      return {
        hasViewedEvidence: Boolean(quote?.viewedAtISO || quote?.lifecycle?.viewedAtISO),
        status: quote?.status,
        activeVersionId: quote?.activeVersionId,
        versionCount: versions.length
      };
    }, quoteId);
    expect(evidenceAfterPreview).toEqual({
      hasViewedEvidence: false,
      status: "accepted",
      activeVersionId: "v0002",
      versionCount: 1
    });

    await eventsTab.click();
    const eventsPanel = page.locator("#customer-panel-events");
    await expect(eventsPanel.getByRole("heading", { name: "Events" })).toBeVisible();
    await expect(eventsPanel.getByRole("heading", { name: "Community Leadership Dinner" })).toBeVisible();
    await expect(eventsPanel).toContainText("Acceptance recorded; booking not yet recorded");

    await moneyTab.click();
    const moneyPanel = page.locator("#customer-panel-money");
    await expect(moneyPanel.getByRole("heading", { name: "Money" })).toBeVisible();
    await expect(moneyPanel).toContainText("Operational payment states only");
    await expect(moneyPanel.getByRole("heading", { name: /Deposit.*1,?500/ })).toBeVisible();
    await expect(moneyPanel.getByRole("heading", { name: /Final balance.*5,?000/ })).toBeVisible();

    await conversationsTab.click();
    const conversationsPanel = page.locator("#customer-panel-conversations");
    await expect(conversationsPanel.getByRole("heading", { name: "Conversations" })).toBeVisible();
    await expect(conversationsPanel).toContainText("Messages remain bound to each quote");
    await expect(conversationsPanel).toContainText("2 messages recorded");
    await expect(conversationsPanel).toContainText("latest from customer");
    const conversationAction = conversationsPanel.getByRole("button", { name: "Open quote conversation" });
    await expect(conversationAction).toBeVisible();
    await conversationAction.click();
    await expect(page).toHaveURL(new RegExp(`/app/quotes/${quoteId}$`));

    expect(await page.evaluate((canonicalQuoteId) => {
      const quote = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]")
        .find((item) => item.id === canonicalQuoteId);
      return Boolean(quote?.viewedAtISO || quote?.lifecycle?.viewedAtISO);
    }, quoteId)).toBe(false);
  });

  test("a missing direct edit route fails closed without exposing a usable quote builder", async ({ page }) => {
    await page.goto("/app/quotes/missing-edit-quote/edit");

    await expect(page.getByRole("heading", { name: "Quote edit unavailable" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Quote not found.");
    await expect(page.getByRole("button", { name: "Retry edit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to Quotes" })).toBeVisible();

    const hiddenBuilder = page.locator("main.wizard-grid");
    await expect(hiddenBuilder).toHaveAttribute("hidden", "");
    await expect(hiddenBuilder).toHaveAttribute("aria-hidden", "true");
    await expect(hiddenBuilder).toBeHidden();
    await expect(hiddenBuilder.getByLabel("Event name")).toBeHidden();
    await expect(page.getByRole("button", { name: /Save (?:draft|Changes)/i })).toHaveCount(0);
  });

  test("history navigation from a direct edit route detaches the mounted form into create mode", async ({ page }) => {
    const quoteId = "direct-edit-history-quote";
    const eventName = "Direct Route Edit Dinner";
    const menuItemId = "wedding__meats__roasted-chicken";

    await page.addInitScript(({ canonicalQuoteId, canonicalEventName, canonicalMenuItemId }) => {
      localStorage.setItem("quoteWizard.quotes", JSON.stringify([{
        id: canonicalQuoteId,
        organizationId: "e2e-org",
        quoteNumber: "Q-DIRECT-EDIT-1001",
        status: "draft",
        eventTypeId: "wedding",
        activeVersionId: "v0001",
        latestVersionNumber: 1,
        createdAtISO: "2026-08-07T14:00:00.000Z",
        updatedAtISO: "2026-08-08T14:00:00.000Z",
        expiresAtISO: "2099-12-31T23:59:59.000Z",
        customer: {
          name: "Direct Edit Customer",
          email: "direct-edit@example.com",
          phone: "205-555-0144",
          organization: "Direct Edit Foundation"
        },
        event: {
          name: canonicalEventName,
          date: "2027-05-22",
          time: "18:00",
          hours: 4,
          guests: 64,
          venue: "History Hall",
          venueAddress: "100 Route Avenue, Birmingham, AL",
          style: "Plated",
          servers: 4,
          chefs: 2,
          bartenders: 0,
          dietaryRestrictions: "Vegetarian option"
        },
        selection: {
          eventTypeId: "wedding",
          packageId: "premium",
          packageName: "Premium",
          menuItems: [canonicalMenuItemId],
          menuItemQuantities: { [canonicalMenuItemId]: 1 },
          menuItemDetails: [{
            id: canonicalMenuItemId,
            name: "Roasted Chicken",
            quantity: 1,
            pricingType: "per_event",
            price: 0
          }],
          addons: [],
          addonQuantities: {},
          rentals: [],
          rentalQuantities: {},
          eventTemplateId: "custom",
          taxRegion: "local",
          seasonProfileId: "auto",
          milesRT: 12,
          includeDisposables: true,
          payMethod: "card"
        },
        totals: { total: 2500, deposit: 750, guests: 64 },
        payment: { depositStatus: "unpaid", depositLink: "" },
        booking: {},
        quoteMeta: { includeDisposables: true },
        lifecycle: { draftAtISO: "2026-08-07T14:00:00.000Z" }
      }]));
    }, {
      canonicalQuoteId: quoteId,
      canonicalEventName: eventName,
      canonicalMenuItemId: menuItemId
    });

    const editPath = `/app/quotes/${quoteId}/edit`;
    await page.goto(editPath);

    const eventNameInput = page.getByLabel("Event name");
    await expect(eventNameInput).toBeVisible();
    await expect(eventNameInput).toHaveValue(eventName);
    await expect(page.getByText("Editing quote Q-DIRECT-EDIT-1001", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Next", exact: true }).click();
    const seededMenuItem = page.getByRole("checkbox", { name: /Roasted Chicken/i });
    await expect(seededMenuItem).toBeVisible();
    if (!(await seededMenuItem.isChecked())) await seededMenuItem.check();

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByLabel("Package tier")).toHaveValue("premium");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Catering Quote" })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    const recap = page.locator(".quote-recap-card");
    await expect(recap).toContainText(eventName);
    await expect(recap).toContainText("64");
    await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);

    await page.evaluate(({ currentEditPath }) => {
      const currentState = window.history.state;
      window.history.replaceState({ ...currentState, e2eRoute: "quote-new" }, "", "/app/quotes/new");
      window.history.pushState({ ...currentState, e2eRoute: "quote-edit" }, "", currentEditPath);
    }, { currentEditPath: editPath });
    await page.goBack();

    await expect(page).toHaveURL(/\/app\/quotes\/new$/);
    await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toHaveCount(0);
    await expect(page.getByText(
      "This in-memory draft is detached from the saved quote and will save as a new quote.",
      { exact: true }
    )).toBeVisible();
    await expect(recap).toContainText(eventName);
    await expect(recap).toContainText("64");

    const wizardBack = page.locator(".wizard-actions").getByRole("button", { name: "Back", exact: true });
    for (let step = 0; step < 4; step += 1) await wizardBack.click();
    await expect(page.getByLabel("Event name")).toHaveValue(eventName);
    await expect(page.getByLabel("Your name")).toHaveValue("Direct Edit Customer");
    await expect(page.getByRole("spinbutton", { name: /Guests \(max 400\)/i })).toHaveValue("64");
  });
});
