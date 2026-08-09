import { expect, test } from "@playwright/test";

const STAFF_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const STAFF_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";

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

async function fillRequiredQuoteFields(page) {
  const eventType = page.getByLabel(/Event type/i);
  const optionCount = await eventType.locator("option").count();
  if (optionCount > 1) {
    await eventType.selectOption({ index: 1 });
  }

  await page.getByLabel(/Event date/i).fill("2026-09-12");
  await page.getByLabel(/Start time/i).fill("19:00");
  await page.getByRole("spinbutton", { name: /Event hours/i }).fill("5");
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("96");
  await page.getByRole("textbox", { name: /Event name/i }).fill("Authoritative Pricing E2E");
  await page.getByRole("textbox", { name: /Venue/i }).first().fill("Birmingham Authority Hall");
  await page.getByRole("textbox", { name: /Venue address/i }).fill("500 Authority Ave, Birmingham, AL");
  await page.getByRole("textbox", { name: /Your name/i }).fill("E2E Admin");
  await page.getByRole("textbox", { name: /Phone/i }).fill("205-555-0196");
  await page.getByRole("textbox", { name: /Email/i }).fill("client@example.com");
}

async function advanceToSave(page, saveLabel = "Save draft") {
  for (let i = 0; i < 6; i += 1) {
    const saveButton = page.getByRole("button", { name: saveLabel });
    if (await saveButton.count()) {
      await expect(saveButton).toBeVisible();
      await saveButton.click();
      return;
    }

    const nextButton = page.getByRole("button", { name: "Next" });
    if (!(await nextButton.count())) break;

    const menuHeading = page.getByRole("heading", { name: "Customized Cuisine Menu" });
    if (await menuHeading.isVisible()) {
      const firstMenuItem = page.getByRole("checkbox").first();
      await expect(firstMenuItem).toBeVisible();
      await firstMenuItem.check();
    }

    await nextButton.click();
  }

  throw new Error(`Unable to reach ${saveLabel}`);
}

async function advanceToFinalReview(page, saveLabel = "Save Changes") {
  for (let i = 0; i < 6; i += 1) {
    const saveButton = page.getByRole("button", { name: saveLabel, exact: true });
    if (await saveButton.count()) {
      await expect(saveButton).toBeVisible();
      return;
    }

    const nextButton = page.getByRole("button", { name: "Next", exact: true });
    if (!(await nextButton.count())) break;

    const menuHeading = page.getByRole("heading", { name: "Customized Cuisine Menu" });
    if (await menuHeading.isVisible()) {
      const firstMenuItem = page.getByRole("checkbox").first();
      await expect(firstMenuItem).toBeVisible();
      if (!(await firstMenuItem.isChecked())) await firstMenuItem.check();
    }

    await nextButton.click();
  }

  throw new Error(`Unable to reach the final review with ${saveLabel}`);
}

test("owner saves an authoritative quote and disabled delivery cannot activate its portal", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsStaff(page);
  await fillRequiredQuoteFields(page);
  await advanceToSave(page, "Save draft");

  const historyHeading = page.getByRole("heading", { name: "Quotes" });
  await expect(historyHeading).toBeVisible({ timeout: 45_000 });
  const handoff = page.getByRole("dialog", { name: "Quotes" }).locator(".saved-quote-handoff");
  await expect(handoff).toContainText(/Saved as a draft/i, { timeout: 45_000 });
  await expect(handoff).toBeFocused();
  await expect(page.getByText(/Email delivery unavailable/i)).toBeVisible();
  await expect(handoff.getByRole("button", { name: "Download draft PDF" })).toBeVisible();
  await expect(handoff.getByRole("button", { name: "Send quote email" })).toHaveCount(0);
  const quoteId = await handoff.getAttribute("data-quote-id");
  expect(quoteId).toBeTruthy();

  const customerProjection = await page.evaluate(async () => {
    const store = await import("/src/lib/quoteStore.js");
    return store.getCustomerRecordByEmail("client@example.com", "e2e-org");
  });
  expect(customerProjection).toMatchObject({
    organizationId: "e2e-org",
    email: "client@example.com",
    lastQuoteId: quoteId,
    recordSource: "trusted_quote_projection"
  });

  const rejectedDelivery = await page.evaluate(async (savedQuoteId) => {
    const store = await import("/src/lib/quoteStore.js");
    const commerce = await import("/src/lib/commerceOps.js");
    const quote = await store.getQuoteById(savedQuoteId);
    let message = "";
    try {
      await commerce.sendQuoteToCustomerEmail({
        quoteId: savedQuoteId,
        quoteRevisionId: commerce.resolveQuoteDeliveryRevisionId(quote)
      });
    } catch (error) {
      message = String(error?.message || error);
    }
    const persisted = await store.getQuoteById(savedQuoteId);
    let draftPortalRejected = false;
    try {
      await store.getPortalQuote(persisted.portalKey);
    } catch {
      draftPortalRejected = true;
    }
    return {
      message,
      status: persisted.status,
      deliveryState: persisted.workflow?.quoteDelivery?.state || "",
      draftPortalRejected
    };
  }, quoteId);
  expect(rejectedDelivery.message).toMatch(/email provider is disabled|email provider/i);
  expect(rejectedDelivery).toMatchObject({
    status: "draft",
    deliveryState: "failed",
    draftPortalRejected: true
  });

  const rows = page.locator(".history-table-wrap tbody tr").filter({
    has: page.getByRole("button", { name: "Copy Email" })
  });
  const refreshButton = page.getByRole("button", { name: "Refresh" });
  await expect.poll(async () => {
    if (await refreshButton.isVisible() && await refreshButton.isEnabled()) {
      await refreshButton.click();
    }
    return await rows.filter({ hasText: "96" }).count();
  }, { timeout: 90_000 }).toBeGreaterThan(0);

  const quoteRow = rows.filter({ hasText: "96" }).first();
  const statusSelect = quoteRow.locator("td").nth(7).locator("select");
  const copyPortalButton = quoteRow.getByRole("button", { name: "Copy Portal" });
  const sendQuoteButton = quoteRow.getByRole("button", { name: /^(Send|Retry) Quote Email$/ });
  await expect(statusSelect).toHaveValue("draft");
  await expect(statusSelect.locator('option[value="sent"]')).toHaveCount(0);
  await expect(copyPortalButton).toBeDisabled();
  await expect(sendQuoteButton).toBeDisabled();
  await expect(sendQuoteButton).toHaveAttribute("title", /Configure a supported email provider/i);

  const directDeliveryClaimsRejected = await page.evaluate(async (savedQuoteId) => {
    const store = await import("/src/lib/quoteStore.js");
    const messages = {};
    for (const status of ["sent", "viewed"]) {
      try {
        await store.updateQuoteStatus(savedQuoteId, status);
      } catch (error) {
        messages[status] = String(error?.message || error);
      }
    }
    const persisted = await store.getQuoteById(savedQuoteId);
    return { messages, status: persisted.status };
  }, quoteId);
  expect(directDeliveryClaimsRejected.messages.sent).toBeTruthy();
  expect(directDeliveryClaimsRejected.messages.viewed).toBeTruthy();
  expect(directDeliveryClaimsRejected.status).toBe("draft");
  await expect(copyPortalButton).toBeDisabled();
  await expect(page.getByText(/Failed to calculate authoritative quote pricing/i)).toHaveCount(0);

  await quoteRow.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/quotes/${quoteId}/edit$`));
  const guestCount = page.getByRole("spinbutton", { name: /Guests \(max 400\)/i });
  await expect(guestCount).toHaveValue("96", { timeout: 45_000 });
  await guestCount.fill("104");
  await advanceToFinalReview(page);

  const changeImpactEntry = page.locator(
    '[data-capability-id="cwf-15b-commercial-change-impact-preview"]'
  );
  const previewButton = changeImpactEntry.getByRole("button", {
    name: "Preview change impact",
    exact: true
  });
  await expect(previewButton).toBeEnabled();
  await previewButton.click();

  const changeImpact = page.locator(
    '[data-capability-id="cwf-15b-commercial-change-impact-presentation"]'
  );
  await expect(changeImpact).toHaveAttribute("data-capability-state", "success", {
    timeout: 45_000
  });
  await expect(changeImpact).toContainText("fact.event.guest_count");
  await expect(changeImpact).toContainText("Commercial delta");
  await expect(changeImpact).toContainText(
    "Nothing is invalidated, regenerated, or published here."
  );
  await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeVisible();
});

test("quote transactions reuse identity, move email ownership, and reject collisions", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsStaff(page);

  const proof = await page.evaluate(async () => {
    const fixture = await import("/e2e/firebase-customer-projection.fixture.js");
    return fixture.exerciseCustomerProjectionTransactions();
  });

  expect(proof.createdQuoteIds).toHaveLength(2);
  expect(new Set(proof.createdQuoteIds).size).toBe(2);
  expect(proof.originalEmailCustomerCount).toBe(0);
  expect(proof.collisionCustomerIds).toHaveLength(1);
  expect(proof.collisionCustomerIds[0]).not.toBe(proof.importedCustomerId);
  expect(proof.collisionErrorCode).toMatch(/already-exists$/);
  expect(proof.customerDocs).toHaveLength(1);
  const [customer] = proof.customerDocs;
  expect(customer).toMatchObject({
    id: proof.importedCustomerId,
    organizationId: "e2e-org",
    email: proof.movedEmail,
    phone: "205-555-0142",
    company: "Imported Customer Company",
    notes: "Preserve this imported customer note.",
    recordSource: "import_studio",
    importSource: "import_studio",
    importBatchId: proof.importedBatchId,
    createdAtISO: proof.importedCreatedAtISO,
    lastQuoteId: proof.finalQuote.id,
    lastQuoteNumber: proof.finalQuote.quoteNumber,
    lastEventName: proof.finalQuote.event.name,
    lastEventDate: proof.finalQuote.event.date,
    name: proof.finalQuote.customer.name
  });
  expect(proof.finalQuote).toMatchObject({
    id: proof.createdQuoteIds[0],
    organizationId: "e2e-org",
    customer: {
      email: proof.movedEmail,
      phone: "",
      organization: ""
    },
    activeVersionId: "v0004",
    latestVersionNumber: 4
  });
});

test("managed menu removal reopens pricing and rejects a stale catalog revision", async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsStaff(page);

  const mutation = await page.evaluate(async () => {
    const menu = await import("/src/lib/menuService.js");
    const eventTypes = await menu.getEventTypes({ organizationId: "e2e-org" });
    const eventTypeId = eventTypes[0]?.id || "";
    const items = await menu.getMenuItems(eventTypeId, {
      includeInactive: true,
      organizationId: "e2e-org"
    });
    const [first, second] = items.filter((item) => item.active !== false);
    if (!first || !second) throw new Error("The authoritative menu fixture needs two active items.");
    const firstResult = await menu.updateMenuItem(first.id, {
      name: first.name,
      price: first.price,
      pricingType: first.pricingType || first.type,
      eventTypeId: first.eventTypeId,
      categoryId: first.categoryId,
      active: false,
      organizationId: "e2e-org",
      expectedCatalogRevision: 0
    });
    let staleError = null;
    try {
      await menu.updateMenuItem(second.id, {
        name: second.name,
        price: second.price,
        pricingType: second.pricingType || second.type,
        eventTypeId: second.eventTypeId,
        categoryId: second.categoryId,
        active: false,
        organizationId: "e2e-org",
        expectedCatalogRevision: 0
      });
    } catch (error) {
      staleError = {
        code: String(error?.code || ""),
        message: String(error?.message || error),
        recognizedConflict: menu.isMenuCatalogRevisionConflict(error)
      };
    }
    return { firstResult, staleError };
  });

  expect(mutation.firstResult).toMatchObject({
    authoritativeMutation: true,
    catalogRevision: 1
  });
  expect(mutation.staleError).toMatchObject({ recognizedConflict: true });
  expect(mutation.staleError.code).toMatch(/aborted/i);
  expect(mutation.staleError.message).toMatch(/catalog revision changed/i);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Configure Your Catalog" }))
    .toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "New Quote" })).toHaveCount(0);
});
