import { expect, test } from "@playwright/test";

const CUSTOMER_CENTERED_WORKSPACE_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED || "").trim().toLowerCase()
);
const PILOT_TRANSFORMATION_ENABLED = [
  "VITE_PILOT_NOW_ENABLED",
  "VITE_PILOT_EVENT_ROOM_ENABLED",
  "VITE_PILOT_GUIDED_SELLING_ENABLED",
  "VITE_PILOT_CREATE_ENABLED",
  "VITE_PILOT_CHANGE_REQUESTS_ENABLED",
  "VITE_PILOT_COMMAND_ENABLED",
  "VITE_PILOT_MARGINS_ENABLED"
].every((name) => ["1", "true", "yes", "on"].includes(
  String(process.env[name] || "").trim().toLowerCase()
));
const AMBIENT_UI_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_AMBIENT_UI_ENABLED || "").trim().toLowerCase()
);
const LOCAL_REVIEW_FIXTURES_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_E2E_LOCAL_REVIEW_FIXTURES || "").trim().toLowerCase()
);
const HOME_HEADING = /What (?:needs|deserves) your attention/;

async function gotoWorkspace(page, path) {
  await page.goto(path);
  const setupHeading = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  const workspaceHeader = page.locator(".site-header");
  await expect(setupHeading.or(workspaceHeader)).toBeVisible({ timeout: 30_000 });
  if (await setupHeading.isVisible()) {
    await page.getByRole("button", { name: "Explore the workspace" }).click();
    await expect(workspaceHeader).toBeVisible({ timeout: 30_000 });
  }
}

async function gotoGovernedOpportunity(page, quoteId) {
  await gotoWorkspace(page, "/app");
  await page.evaluate(async (exactQuoteId) => {
    const { createWorkspaceArrivalHandoff } = await import("/src/lib/workspaceArrivalContract.js");
    const handoff = createWorkspaceArrivalHandoff({
      destination: "opportunity",
      object: { id: exactQuoteId, type: "opportunity" },
      focus: { quoteId: exactQuoteId },
      intentId: "review_opportunity"
    });
    if (!handoff.ok) throw new Error(`Pilot opportunity handoff failed: ${handoff.recovery.code}`);
    window.history.pushState(handoff.navigation.state, "", handoff.navigation.path);
    window.dispatchEvent(new Event("quotepilot:locationchange"));
  }, quoteId);
}

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

async function seedPilotQuote(page) {
  await page.addInitScript(() => {
    localStorage.setItem("quoteWizard.quotes", JSON.stringify([{
      id: "pilot-release-quote",
      organizationId: "e2e-org",
      quoteNumber: "Q-PILOT-6001",
      status: "draft",
      eventTypeId: "wedding",
      activeVersionId: "v0001",
      latestVersionNumber: 1,
      createdAtISO: "2026-08-10T14:00:00.000Z",
      updatedAtISO: "2026-08-10T15:00:00.000Z",
      customer: {
        name: "Pilot Customer",
        email: "pilot@example.test",
        phone: "205-555-0160"
      },
      event: {
        name: "Pilot Release Dinner",
        date: "2027-09-12",
        time: "18:00",
        hours: 4,
        guests: 64,
        venue: "Pilot Hall",
        venueAddress: "600 Release Way",
        style: "Plated",
        servers: 4,
        chefs: 2,
        bartenders: 0
      },
      selection: {
        eventTypeId: "wedding",
        packageId: "premium",
        packageName: "Premium",
        menuItems: ["wedding__meats__roasted-chicken"],
        menuItemNames: ["Roasted Chicken"],
        addons: [],
        rentals: [],
        eventTemplateId: "custom"
      },
      totals: {
        total: 5000,
        deposit: 1500,
        serverLabor: 800,
        chefLabor: 600,
        serviceFeePctApplied: 0.2,
        taxRateApplied: 0.1
      },
      portalDecision: {
        decision: "changes_requested",
        message: "Change to 90 guests and add one server.",
        submittedAtISO: "2026-08-10T15:00:00.000Z"
      },
      lifecycle: { draftAtISO: "2026-08-10T14:00:00.000Z" }
    }]));
  });
}

test.describe("customer-centered workspace", () => {
  test.skip(
    !CUSTOMER_CENTERED_WORKSPACE_ENABLED,
    "The customer-centered workspace browser contract runs only when its rollout flag is enabled."
  );

  test("/app is Home and a dirty quote draft survives routed Home, Back, and Forward navigation", async ({ page }) => {
    await gotoWorkspace(page, "/app");

    const homeHeading = page.getByRole("heading", { name: HOME_HEADING });
    await expect(homeHeading).toBeVisible();
    await expect(homeHeading).toBeFocused();
    const evidenceRail = page.getByRole("complementary", { name: "Staff read context" });
    await expect(evidenceRail).toHaveAttribute("data-capability-state", /current|truncated|partial/);
    await expect(evidenceRail).toContainText("Tenant key: e2e-org");
    await expect(evidenceRail).toContainText("Browser-local workspace");
    await expect(evidenceRail).toContainText("does not prove provider delivery");
    const staffHeader = page.locator(".site-header");
    await expect(staffHeader.getByRole("button", { name: "Now", exact: true })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(staffHeader.getByRole("button", { name: "Customers", exact: true })).toBeVisible();
    await expect(staffHeader.getByRole("button", { name: "Quotes", exact: true })).toBeVisible();
    await expect(staffHeader.getByRole("button", { name: "Messages", exact: true })).toBeVisible();
    await expect(staffHeader.getByRole("button", { name: /^Workflow/ })).toBeVisible();

    await staffHeader.getByRole("button", { name: "New quote", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/quotes\/new$/);

    const eventName = page.getByLabel("Event name");
    await eventName.fill("Sticky command-center draft");
    await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();

    await staffHeader.getByRole("button", { name: "Now", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/app\/quotes\/new$/);
    await expect(eventName).toBeVisible();
    await expect(eventName).toHaveValue("Sticky command-center draft");

    await page.goForward();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();

    await page.goBack();
    await expect(eventName).toBeVisible();
    await expect(eventName).toHaveValue("Sticky command-center draft");
  });

  test("/app/home replaces to the canonical Home route", async ({ page }) => {
    await gotoWorkspace(page, "/app/home");

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  });

  test("client-language aliases replace to the canonical customer routes", async ({ page }) => {
    test.skip(
      !(AMBIENT_UI_ENABLED && LOCAL_REVIEW_FIXTURES_ENABLED),
      "Exact Client alias proof needs the Ambient local review fixture."
    );

    await gotoWorkspace(page, "/app/clients");
    await expect(page).toHaveURL(/\/app\/customers$/);
    await expect(page.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();

    const firstClientName = await page.locator("#ambient-client-directory h2").first().textContent();
    await page.locator("#ambient-client-directory").getByRole("button", { name: "Review client" }).first().click();
    const canonicalUrl = new URL(page.url());
    const customerId = canonicalUrl.pathname.split("/").at(-1);
    expect(customerId).toBeTruthy();

    await gotoWorkspace(page, `/app/clients/${customerId}`);
    await expect(page).toHaveURL(new RegExp(`/app/customers/${customerId}$`));
    await expect(page.getByRole("heading", { name: firstClientName, level: 1 })).toBeVisible();
  });

  test("Events turns an unavailable read into one productive recovery path", async ({ page }) => {
    test.skip(
      !LOCAL_REVIEW_FIXTURES_ENABLED,
      "The unavailable Events proof uses the explicit local review environment."
    );

    await gotoWorkspace(page, "/app/events");
    const recovery = page.locator('[data-events-state="unavailable"]');
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("heading", { name: "We couldn’t load event records." })).toBeVisible();
    await expect(recovery.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(recovery.getByRole("button", { name: "Review opportunities" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
    const readBoundary = page.locator('[data-events-evidence="collapsed"]');
    await expect(readBoundary).toBeVisible();
    await expect(readBoundary).not.toHaveAttribute("open", "");
    await expect(readBoundary.getByRole("heading", { name: "Staff read context" })).toBeHidden();
    await readBoundary.getByText("About this view", { exact: true }).click();
    await expect(readBoundary.getByRole("heading", { name: "Staff read context" })).toBeVisible();
    await expect(page.getByText(/Missing or insufficient permissions/i)).toHaveCount(0);
    await expect(page.getByText("Live operations evidence not established", { exact: true })).toHaveCount(0);

    await recovery.getByRole("button", { name: "Review opportunities" }).click();
    await expect(page).toHaveURL(/\/app\/quotes$/);
    await expect(page.getByRole("heading", { name: "Current opportunities", level: 2 })).toBeVisible();
  });

  test("the production pilot matrix exposes NOW, Event Room, command, margins, and staged client changes", async ({ page }) => {
    test.skip(!PILOT_TRANSFORMATION_ENABLED, "The production pilot matrix is not enabled.");
    await seedPilotQuote(page);

    await gotoWorkspace(page, "/app");
    await expect(page.getByRole("heading", { name: "What to review today" })).toBeVisible();
    await expect(page.locator(".now-surface")).toBeVisible();

    await gotoGovernedOpportunity(page, "pilot-release-quote");
    await expect(page.getByRole("heading", { name: "Pilot Release Dinner" })).toBeVisible();
    await expect(page.locator('[data-decide-stack="decide-stack-v1"]')).toBeVisible();
    await expect(page.getByRole("img", { name: /Proposal readiness:/ })).toBeVisible();

    await gotoWorkspace(page, "/app/quotes/pilot-release-quote/edit");
    const changePanel = page.locator('[data-change-request="change-request-parse-v1"]');
    await expect(changePanel).toContainText("Change to 90 guests and add one server.");
    await changePanel.getByRole("button", { name: "Stage this" }).first().click();
    const guests = page.getByRole("spinbutton", { name: /Guests \(max 400\)/i });
    await expect(guests).toHaveValue("90");

    const command = page.locator('[data-pilot-command="change-request-parse-v1"]');
    await expect(command).toHaveAttribute("data-pilot-expanded", "false");
    await command.getByRole("textbox", { name: "Command for this draft" }).fill("Change to 100 guests");
    await command.getByRole("button", { name: "Preview", exact: true }).click();
    await command.getByRole("button", { name: "Apply to draft" }).click();
    await expect(guests).toHaveValue("100");
    await expect(command.locator("[data-pilot-query-kind]")).toHaveCount(0);
    await expect(command.locator("[data-pilot-scenario-model]")).toHaveCount(0);
    await expect(page.locator('[data-margin="margin-presentation-v1"]')).toBeVisible();
  });

  test("the production CREATE intake applies bounded facts and shows a draft-only pricing band", async ({ page }) => {
    test.skip(!PILOT_TRANSFORMATION_ENABLED, "The production pilot matrix is not enabled.");
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWorkspace(page, "/app/quotes/new");

    const intake = page.locator('[data-create-intake="intent-extraction-v1"]');
    await expect(intake.getByRole("heading", { name: "What are you planning?" })).toBeVisible();
    await expect(page.locator(".pilot-command")).toHaveCount(0);
    await intake.getByRole("textbox", { name: "Describe the event in your own words" }).fill(
      "Corporate dinner for about 80 guests on September 12, 2027 at The Foundry, plated, 4 hours, pilot@example.test."
    );
    await intake.getByRole("button", { name: "Structure it" }).click();
    await intake.getByRole("button", { name: /Add \d+ details? to the draft/ }).click();

    await expect(intake).toHaveAttribute("data-create-intake-state", "applied");
    const appliedHeading = intake.getByRole("heading", { name: /details? (?:is|are) in this draft/ });
    await expect(appliedHeading).toBeVisible();
    await expect(appliedHeading).toBeFocused();
    await expect(intake.getByRole("heading", { name: "What are you planning?" })).toHaveCount(0);
    await expect(page.locator(".pilot-command")).toBeVisible();
    await expect(intake.getByRole("button", { name: "Review intake" })).toBeVisible();
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);

    await expect(page.getByRole("spinbutton", { name: /Guests \(max 400\)/i })).toHaveValue("80");

    await intake.getByRole("button", { name: "Review intake" }).click();
    await expect(intake.getByRole("heading", { name: "What are you planning?" })).toBeVisible();
    await expect(intake.getByRole("button", { name: "Added - review below" })).toBeDisabled();
    await expect(intake.getByRole("textbox", { name: "Describe the event in your own words" })).toBeFocused();

    await page.setViewportSize({ width: 1440, height: 1000 });
    await intake.getByRole("button", { name: "Collapse intake" }).click();
    await expect(appliedHeading).toBeVisible();
    await expect(appliedHeading).toBeFocused();
    await expect(page.locator('[data-pricing-band="pricing-band-v1"]')).toBeVisible();
    await expect(page.getByText("Saving always prices the exact recorded count.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);
  });

  test("mobile Clients leads with the highest-priority relationship view and preserves exact client handoff", async ({ page }) => {
    test.skip(
      !(AMBIENT_UI_ENABLED && LOCAL_REVIEW_FIXTURES_ENABLED),
      "The Ambient Clients journey needs the explicit local review fixture."
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWorkspace(page, "/app/customers");

    const priority = page.locator(".ambient-clients__mobile-priority");
    const metrics = page.locator(".ambient-clients__metrics");
    const desktopFilters = page.locator(".ambient-clients__filters");
    const mobileFilter = page.locator(".ambient-clients__mobile-filter select");
    const directory = page.locator("#ambient-client-directory");

    await expect(priority).toBeVisible();
    await expect(priority).toContainText("7 clients need contact details");
    await expect(priority).toContainText("24 clients are shown on this page");
    await expect(metrics).toBeHidden();
    await expect(desktopFilters).toBeHidden();
    await expect(mobileFilter).toBeVisible();
    await expect(mobileFilter).toHaveValue("all");

    await priority.getByRole("button", { name: "Review contact gaps" }).click();
    await expect(mobileFilter).toHaveValue("contact_gap");
    await expect(directory).toBeFocused();
    await expect(directory.locator("[data-client-id]")).toHaveCount(7);
    await expect(directory.locator(".ambient-client__state")).toHaveText([
      "Add contact",
      "Add contact",
      "Add contact",
      "Add contact",
      "Add contact",
      "Add contact",
      "Add contact"
    ]);

    const selectBox = await mobileFilter.boundingBox();
    expect(selectBox).not.toBeNull();
    expect(selectBox.x).toBeGreaterThanOrEqual(0);
    expect(selectBox.x + selectBox.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);

    const firstClientName = await directory.locator("h2").first().textContent();
    await directory.getByRole("button", { name: "Review client" }).first().click();
    await expect(page).toHaveURL(/\/app\/customers\/[a-z0-9-]+$/u);
    await expect(page.getByRole("heading", { name: firstClientName, level: 1 })).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goBack();
    await expect(metrics).toBeVisible();
    await expect(priority).toBeHidden();
    await expect(desktopFilters).toBeVisible();
  });

  test("explicit New quote discard and browser-exit protection remain attached to a dirty routed draft", async ({ page }) => {
    await gotoWorkspace(page, "/app/quotes/new");
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
    await expect(page.getByText("Workspace open", { exact: true })).toBeVisible();
  });

  test("primary workspace navigation remains visible and overflow-safe at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWorkspace(page, "/app");

    const header = page.locator(".site-header");
    for (const name of ["Now", "Customers", "Quotes", "Messages"]) {
      await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(header.getByRole("button", { name: /^Workflow/ })).toBeVisible();
    await expect(header.getByRole("button", { name: "More", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await header.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Event Schedule" }).click();
    await expect(page).toHaveURL(/\/app\/schedule$/);
    await expect(page.getByRole("region", { name: "Event Schedule" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("desktop workspace navigation keeps Account with the primary actions across nearby widths", async ({ page }) => {
    for (const width of [1440, 1366, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoWorkspace(page, "/app");

      const header = page.locator(".site-header");
      for (const name of ["Now", "Customers", "Quotes", "Messages", "Operations", "Account"]) {
        await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
      }
      await expect(header.getByRole("button", { name: /^Workflow/ })).toBeVisible();
      await expect(header.getByRole("button", { name: "More", exact: true })).toBeHidden();

      const [homeBox, accountBox] = await Promise.all([
        header.getByRole("button", { name: "Now", exact: true }).boundingBox(),
        header.getByRole("button", { name: "Account", exact: true }).boundingBox()
      ]);
      expect(homeBox).not.toBeNull();
      expect(accountBox).not.toBeNull();
      if (width >= 1181) {
        // Sidebar layout: Account stacks in the same rail column as Home.
        expect(Math.abs(accountBox.x - homeBox.x)).toBeLessThanOrEqual(2);
        await expect(header.locator(".header-actions")).toHaveCSS("flex-direction", "column");
      } else {
        expect(Math.abs(accountBox.y - homeBox.y)).toBeLessThanOrEqual(2);
        await expect(header.locator(".header-actions")).toHaveCSS("flex-wrap", "nowrap");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });

  test("Messages keeps event conversations segregated and stays usable at phone width", async ({ page }) => {
    await page.addInitScript(() => {
      const sharedCustomer = { name: "Jordan Customer", email: "jordan@example.test" };
      localStorage.setItem("quoteWizard.quotes", JSON.stringify([
        {
          id: "message-event-a",
          organizationId: "e2e-org",
          customerId: "customer-jordan",
          quoteNumber: "Q-MSG-101",
          status: "sent",
          portalKey: "message-event-a-portal-12345678901234567890",
          activeVersionId: "v0001",
          portalIssuedAtISO: "2026-08-08T09:00:00.000Z",
          portalExpiresAtISO: "2099-08-08T09:00:00.000Z",
          createdAtISO: "2026-08-08T10:00:00.000Z",
          updatedAtISO: "2026-08-09T18:00:00.000Z",
          customer: sharedCustomer,
          event: { name: "Museum Dinner", date: "2027-03-12", venue: "City Museum" },
          totals: { total: 4200 },
          conversationSummary: {
            messageCount: 3,
            latestMessageId: "message-a-3",
            latestMessageAtISO: "2026-08-09T18:00:00.000Z",
            latestActorType: "customer"
          },
          workflow: { quoteDelivery: {
            revisionId: "v0001@2026-08-08T09:00:00.000Z",
            state: "provider_accepted",
            portalActivationState: "active",
            providerMessageId: "provider-message-event-a",
            providerAcceptedAtISO: "2026-08-08T09:05:00.000Z",
            portalKey: "message-event-a-portal-12345678901234567890",
            portalIssuedAtISO: "2026-08-08T09:00:00.000Z"
          } }
        },
        {
          id: "message-event-b",
          organizationId: "e2e-org",
          customerId: "customer-jordan",
          quoteNumber: "Q-MSG-102",
          status: "accepted",
          portalKey: "message-event-b-portal-12345678901234567890",
          activeVersionId: "v0001",
          portalIssuedAtISO: "2026-08-07T09:00:00.000Z",
          portalExpiresAtISO: "2099-08-07T09:00:00.000Z",
          createdAtISO: "2026-08-07T10:00:00.000Z",
          updatedAtISO: "2026-08-08T18:00:00.000Z",
          customer: sharedCustomer,
          event: { name: "Garden Reception", date: "2027-04-18", venue: "North Garden" },
          totals: { total: 6100 },
          conversationSummary: {
            messageCount: 1,
            latestMessageId: "message-b-1",
            latestMessageAtISO: "2026-08-08T18:00:00.000Z",
            latestActorType: "staff"
          },
          workflow: { quoteDelivery: {
            revisionId: "v0001@2026-08-07T09:00:00.000Z",
            state: "provider_accepted",
            portalActivationState: "active",
            providerMessageId: "provider-message-event-b",
            providerAcceptedAtISO: "2026-08-07T09:05:00.000Z",
            portalKey: "message-event-b-portal-12345678901234567890",
            portalIssuedAtISO: "2026-08-07T09:00:00.000Z"
          } }
        }
      ]));
    });

    await gotoWorkspace(page, "/app/messages");
    const station = page.locator(".messaging-station");
    await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeFocused();
    await expect(station).toHaveAttribute("data-capability-state", "partial");
    await expect(station.locator(".messaging-sync-state")).toHaveText(/Updates paused/);
    await expect(station.getByText("Customer last replied", { exact: true }).first()).toBeVisible();
    await expect(station.getByRole("button", { name: /Museum Dinner.*Q-MSG-101.*City Museum/ })).toBeVisible();
    const gardenRow = station.getByRole("button", { name: /Garden Reception.*Q-MSG-102.*North Garden/ });
    await expect(gardenRow).toBeVisible();

    await gardenRow.click();
    await expect(page).toHaveURL(/\/app\/messages\?quoteId=message-event-b$/);
    const gardenHeading = station.getByRole("heading", { name: "Garden Reception" });
    await expect(gardenHeading).toBeVisible();
    await expect(station.getByText("$6,100.00", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/messages$/);
    await expect(gardenRow).toBeVisible();
    await expect(gardenRow).toBeFocused();

    await page.goForward();
    await expect(page).toHaveURL(/\/app\/messages\?quoteId=message-event-b$/);
    await expect(gardenHeading).toBeVisible();
    await expect(gardenHeading).toBeFocused();

    await station.getByRole("button", { name: "Back to Messages" }).click();
    await expect(page).toHaveURL(/\/app\/messages$/);
    await expect(gardenRow).toBeVisible();
    await expect(gardenRow).toBeFocused();
    await page.reload();
    await expect(page).toHaveURL(/\/app\/messages$/);
    await expect(station.getByRole("button", { name: /Museum Dinner/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("unknown staff paths render an authenticated in-shell 404", async ({ page }) => {
    await gotoWorkspace(page, "/app/not-a-workspace-route");

    await expect(page.getByRole("heading", { name: "Workspace page not found" })).toBeVisible();
    await expect(page.getByText("/app/not-a-workspace-route is not a QuotePilot staff workspace route.")).toBeVisible();
    await expect(page.locator(".site-header").getByRole("button", { name: "Now", exact: true })).toBeVisible();
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
        await expect(heading).toHaveCSS("outline-width", "2px");
      }
      await expect(route.getByRole("button", { name: "Back to Home", exact: true })).toBeVisible();
      await expect(route.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name })).toHaveCount(0);
    }

    await gotoWorkspace(page, "/app");
    const operations = page.locator(".desktop-header-menu").getByRole("button", { name: "Operations" });
    await operations.click();
    await page.getByRole("menuitem", { name: "Reporting Dashboard" }).click();
    await expect(page).toHaveURL(/\/app\/reporting$/);
    await expect(page.getByRole("region", { name: "Reporting Dashboard" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/app\/reporting$/);
    await expect(page.getByRole("region", { name: "Reporting Dashboard" })).toBeVisible();
  });

  test("quote-builder Catalog work stays contextual and modal while routed Catalog stays embedded", async ({ page }) => {
    await page.addInitScript(() => {
      window.__quotePilotE2eFunctions = { loadMenuByEvent: async () => [] };
    });
    await gotoWorkspace(page, "/app/quotes/new");
    await fillRequiredQuoteFields(page);
    await page.getByRole("button", { name: /^Next:/ }).click();
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
    await gotoWorkspace(page, "/app/diagnostics");

    const recovery = page.locator(".ui-recovery-route");
    await expect(recovery.getByRole("heading", { name: "Session Diagnostics did not load" })).toBeVisible();
    await expect(recovery.getByRole("button", { name: "Try again" })).toBeFocused();
    await expect(recovery.getByRole("button", { name: "Reload page" })).toBeVisible();
    await expect(recovery.getByRole("button", { name: "Back to QuotePilot" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Session Diagnostics did not load" })).toHaveCount(0);

    await recovery.getByRole("button", { name: "Back to QuotePilot" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
  });

  test("sticky Quotes and Workflow failures stay route-scoped without losing the dirty quote draft", async ({ page }) => {
    await page.route("**/src/components/QuoteHistoryModal.jsx*", (route) => route.abort("failed"));
    await page.route("**/src/components/SalesWorkflowModal.jsx*", (route) => route.abort("failed"));
    await gotoWorkspace(page, "/app/quotes/new");

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
      await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();

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
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
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
          customer: {
            name: "Home Money Customer",
            email: "money@example.test",
            organization: "Bennett Foundation"
          },
          event: {
            name: "Money Dinner",
            date: "2027-03-13",
            time: "18:30",
            guests: 55,
            venue: "The Foundry Hall",
            style: "Plated",
            servers: 4,
            chefs: 2
          },
          selection: {
            eventTypeId: "benefit-dinner",
            packageName: "Classic Dinner",
            menuItemNames: ["Herb Chicken", "Seasonal Vegetables"],
            rentals: ["linen", "chairs"],
            rentalQuantities: { linen: 8, chairs: 55 }
          },
          totals: { total: 5000, deposit: 1500 },
          payment: { depositStatus: "unpaid" },
          lifecycle: { acceptedAtISO: "2026-08-08T12:00:00.000Z" }
        }
      ]));
    });

    await gotoWorkspace(page, "/app");
    const attentionRow = page.locator(".command-center-row").filter({ hasText: "Please revise the service timing." });
    await expect(attentionRow).toBeVisible();

    await attentionRow.getByRole("button", { name: "Home Attention Customer", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/customers\/home-attention-customer$/);
    await expect(page.getByRole("heading", { name: "Home Attention Customer", level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();

    await page.locator(".command-center-row").filter({ hasText: "Please revise the service timing." })
      .getByRole("button", { name: "Open in Workflow" }).click();
    await expect(page).toHaveURL(/\/app\/workflow\?quoteId=home-attention-quote&attentionType=change_request&requestId=home-request-1$/);
    const focusedAttention = page.locator('[data-attention-id="change-request:home-attention-quote:2026-08-08T11:00:00.000Z"]');
    await expect(focusedAttention).toBeVisible();
    await expect(focusedAttention).toBeFocused();

    await page.goBack();
    await expect(page.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
    const moneyRow = page.locator(".command-center-row").filter({ hasText: "Q-HOME-MONEY" });
    await moneyRow.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/quotes\/home-money-quote$/);
    const focusedQuote = page.locator('.saved-quote-handoff[data-quote-id="home-money-quote"]');
    await expect(focusedQuote).toBeVisible();
    await expect(focusedQuote).toBeFocused();
    await expect(page.getByRole("heading", { name: "Money Dinner", level: 1 })).toBeVisible();
    await expect(focusedQuote).toContainText("No tracked quote attention");
    await expect(focusedQuote).toContainText("not an event-readiness or completion claim");
    await expect(focusedQuote).toContainText("What this quote records");
    await expect(focusedQuote.locator('[data-intelligence-dimension="readiness"]'))
      .toContainText("Proposal completeness only");
    await expect(focusedQuote.locator('[data-intelligence-dimension="flexibility"]'))
      .toHaveAttribute("data-intelligence-state", "unavailable");
    await expect(focusedQuote.locator('[data-intelligence-dimension="alignment"]'))
      .toHaveAttribute("data-intelligence-state", "unavailable");
    await focusedQuote.getByText("Why?", { exact: true }).click();
    await expect(focusedQuote).toContainText("event_change_window_contract_absent");
    await expect(focusedQuote).toContainText("combined_transaction_integrity_projection_absent");
    await focusedQuote.getByText("Why?", { exact: true }).click();
    await expect(focusedQuote.getByRole("button", { name: "Edit quote" })).toHaveCount(0);
    await expect(focusedQuote.getByRole("button", { name: "More actions", exact: true })).toBeVisible();

    if (process.env.CWF16_SCREENSHOT_DESKTOP) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(100);
      await page.screenshot({ path: process.env.CWF16_SCREENSHOT_DESKTOP, fullPage: false });
      if (process.env.CWF16_SCREENSHOT_FULL) {
        await page.screenshot({ path: process.env.CWF16_SCREENSHOT_FULL, fullPage: true });
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Money Dinner", level: 1 })).toBeVisible();
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);

    if (process.env.CWF16_SCREENSHOT_MOBILE) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: process.env.CWF16_SCREENSHOT_MOBILE, fullPage: false });
    }

    await focusedQuote.getByRole("button", { name: "Back to Quotes" }).click();
    await expect(page).toHaveURL(/\/app\/quotes$/);
    await expect(page.getByRole("heading", { name: "Quotes", level: 2 })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });

  test("Workflow exposes Revenue Autopilot as an explicit non-sending, fail-closed preview", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("quoteWizard.quotes", JSON.stringify([{
        id: "autopilot-browser-boundary-quote",
        organizationId: "e2e-org",
        quoteNumber: "Q-AUTOPILOT-BOUNDARY",
        status: "sent",
        createdAtISO: "2026-08-08T10:00:00.000Z",
        updatedAtISO: "2026-08-08T11:00:00.000Z",
        customer: { name: "Autopilot Boundary Customer", email: "autopilot@example.test" },
        event: { name: "Boundary Dinner", date: "2027-03-12", guests: 40 },
        totals: { total: 4000, deposit: 1000 },
        payment: { depositStatus: "unpaid" }
      }]));
    });

    await gotoWorkspace(page, "/app/workflow");
    const autopilotTab = page.getByRole("tab", { name: "Revenue autopilot" });
    await expect(autopilotTab).toBeVisible();
    await autopilotTab.click();

    const panel = page.locator('[data-capability-id="cwf-12-revenue-autopilot-preview"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-capability-state", "error");
    await expect(panel).toContainText("0 messages scheduled · 0 messages sent");
    await expect(page.locator('[data-autopilot-read-blocker="authoritative_quote_read_required"]'))
      .toContainText("Browser-local quote data remains blocked");
    await expect(panel).not.toContainText(/message (?:scheduled|sent) successfully/i);
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

    await expect(page.locator('[data-portal-presentation="event-story"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your proposal from Northstar Catering" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Portal Route Dinner/ })).toBeVisible();
    await expect(page.locator(".portal-event-date")).toHaveText("June 12, 2027");
    await expect(page.locator(".site-header")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: HOME_HEADING })).toHaveCount(0);
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

    await gotoWorkspace(page, "/app/customers");

    await expect(page.getByRole("heading", { name: "Customer directory", exact: true })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "What matters next" })).toBeVisible();
    await expect(page.locator("#customer-panel-overview")).toContainText("Customer accepted the proposal");
    const commercialMeasures = page.locator('[data-capability-id="cwf-13-customer-commercial-measures"]');
    await expect(commercialMeasures).toBeVisible();
    await expect(commercialMeasures).toHaveAttribute("data-capability-state", "partial");
    await expect(commercialMeasures).toContainText("Quotes, bookings, and payments");
    await expect(commercialMeasures).toContainText("Quoted amount");
    await expect(commercialMeasures).toContainText("$6,500.00");
    const depositMeasure = commercialMeasures.locator('[data-measure-id="webhook_confirmed_deposit"]');
    await expect(depositMeasure).toContainText("Amount unavailable");
    await expect(depositMeasure).toContainText("lacks trusted Firebase provider evidence");
    await expect(commercialMeasures).toContainText("do not treat these values as an accounting ledger");
    const revenueOpportunities = page.locator('[data-capability-id="cwf-11-rebooking-radar"]');
    await expect(revenueOpportunities).toBeVisible();
    await expect(revenueOpportunities).toContainText("Follow-ups worth revisiting");

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
    const conversationAction = conversationsPanel.getByRole("button", { name: "Open event conversation" });
    await expect(conversationAction).toBeVisible();
    await conversationAction.click();
    await expect(page).toHaveURL(new RegExp(`/app/messages\\?quoteId=${quoteId}$`));

    expect(await page.evaluate((canonicalQuoteId) => {
      const quote = JSON.parse(localStorage.getItem("quoteWizard.quotes") || "[]")
        .find((item) => item.id === canonicalQuoteId);
      return Boolean(quote?.viewedAtISO || quote?.lifecycle?.viewedAtISO);
    }, quoteId)).toBe(false);
  });

  test("Customer 360 surfaces an exact-version anniversary rebook cue without inventing a local draft", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-08-12T15:00:00.000Z"));
    await page.addInitScript(() => {
      const organizationId = "e2e-org";
      const customerId = "customer-rebook-e2e";
      const quoteId = "quote-rebook-source-e2e";
      const portalIssuedAtISO = "2025-07-01T12:00:00.000Z";
      const sourceQuote = {
        id: quoteId,
        organizationId,
        customerId,
        quoteNumber: "Q-REBOOK-SOURCE",
        status: "booked",
        activeVersionId: "v0002",
        latestVersionNumber: 2,
        createdAtISO: "2025-06-20T10:00:00.000Z",
        updatedAtISO: "2025-07-03T12:00:00.000Z",
        customer: {
          name: "Henderson Group",
          email: "henderson@example.test",
          phone: "205-555-0155",
          organization: "Henderson Industries"
        },
        event: {
          name: "Annual Leadership Picnic",
          date: "2025-08-14",
          time: "12:00",
          hours: 4,
          guests: 160,
          venue: "Oak Meadow",
          style: "Buffet"
        },
        selection: { packageName: "Corporate Picnic" },
        totals: { total: 8200, deposit: 2050 },
        payment: { depositStatus: "paid", depositConfirmedAtISO: "2025-07-03T12:00:00.000Z" },
        booking: {
          contractNumber: "C-REBOOK-SOURCE",
          contractConvertedAtISO: "2025-07-03T12:00:00.000Z"
        },
        acceptanceReceipt: {
          receiptId: "acceptance-rebook-source-e2e",
          acceptedAtISO: "2025-07-02T12:00:00.000Z",
          portalIssuedAtISO,
          quoteRevisionId: `v0002@${portalIssuedAtISO}`
        },
        lifecycle: {
          acceptedAtISO: "2025-07-02T12:00:00.000Z",
          bookedAtISO: "2025-07-03T12:00:00.000Z"
        }
      };
      localStorage.setItem("quoteWizard.quotes", JSON.stringify([sourceQuote]));
      localStorage.setItem("quoteWizard.quoteHistory", JSON.stringify([{
        id: "quote-rebook-source-version-record",
        versionId: "v0002",
        versionNumber: 2,
        quoteId,
        organizationId,
        customerId,
        createdAtISO: "2025-07-01T12:00:00.000Z",
        snapshot: sourceQuote
      }]));
    });

    await gotoWorkspace(page, "/app/customers/customer-rebook-e2e");
    await expect(page.getByRole("heading", { name: "Henderson Group", level: 1 })).toBeVisible();

    const radar = page.locator('[data-capability-id="cwf-11-rebooking-radar"]');
    await expect(radar).toHaveAttribute("data-capability-state", "success");
    await expect(radar).toContainText("Annual Leadership Picnic was scheduled for this week last year");
    await expect(radar.locator('[data-rebook-source-state="verified"]')).toContainText(
      "Accepted source identified: version v0002"
    );

    const action = radar.locator('[data-capability-id="cwf-11-exact-version-rebook"]');
    await expect(action).toHaveAttribute("data-capability-state", "error");
    await expect(action).toContainText("Trusted rebook creation is unavailable here");
    await expect(action.getByRole("button", { name: "Unavailable" })).toBeDisabled();
    await expect(action).toContainText("No customer message, acceptance, booking, or payment is created");

    const measures = page.locator('[data-capability-id="cwf-13-customer-commercial-measures"]');
    await expect(measures).toContainText("Booked amount");
    await expect(measures).toContainText("$8,200.00");
  });

  test("a missing direct edit route fails closed without exposing a usable quote builder", async ({ page }) => {
    await gotoWorkspace(page, "/app/quotes/missing-edit-quote/edit");

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

    await page.getByRole("button", { name: /^Next:/ }).click();
    const seededMenuItem = page.getByRole("checkbox", { name: /Roasted Chicken/i });
    await expect(seededMenuItem).toBeVisible();
    if (!(await seededMenuItem.isChecked())) await seededMenuItem.check();

    await page.getByRole("button", { name: /^Next:/ }).click();
    await expect(page.getByLabel("Package tier")).toHaveValue("premium");
    await page.getByRole("button", { name: /^Next:/ }).click();
    await expect(page.getByRole("heading", { name: "Catering Quote" })).toBeVisible();
    await page.getByRole("button", { name: /^Next:/ }).click();

    const recap = page.locator(".quote-recap-card");
    await expect(recap).toContainText(eventName);
    await expect(recap).toContainText("64");
    await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
    const changeImpactPreview = page.locator('[data-capability-id="cwf-15b-commercial-change-impact-preview"]');
    await expect(changeImpactPreview).toBeVisible();
    await expect(changeImpactPreview).toContainText("What will this change affect?");
    await expect(changeImpactPreview).toContainText(
      "Authoritative change impact is unavailable in browser-local mode"
    );
    await expect(changeImpactPreview.getByRole("button", { name: "Preview change impact" })).toBeDisabled();

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
