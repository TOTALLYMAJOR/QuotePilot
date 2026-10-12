import { expect, test } from "@playwright/test";

const STAFF_EMAIL = process.env.E2E_FIREBASE_SECOND_EMAIL || "e2e-admin-blank@local.test";
const STAFF_PASSWORD = process.env.E2E_FIREBASE_SECOND_PASSWORD || "Passw0rd!";
const ORGANIZATION_ID = process.env.E2E_FIREBASE_SECOND_ORG_ID || "e2e-org-blank";
const IMPORTED_ITEM_NAME = "Receipt-bound herb chicken";
const SOURCE_FILE_NAME = "first-quote-menu-items.csv";

async function signInAsBlankOwner(page) {
  await page.goto("/app");
  const signIn = page.getByRole("heading", { name: "Staff Sign In" });
  const setup = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  await expect(signIn.or(setup)).toBeVisible({ timeout: 45_000 });
  if (await signIn.isVisible()) {
    await page.getByLabel(/^Email$/i).fill(STAFF_EMAIL);
    await page.getByLabel(/^Password$/i).fill(STAFF_PASSWORD);
    await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  }
  await expect(setup).toBeVisible({ timeout: 45_000 });
}

async function chooseFirstRealOption(select) {
  let value = "";
  await expect.poll(async () => {
    value = await select.locator("option:not([disabled])").evaluateAll((options) => (
      options.map((option) => option.value).find(Boolean) || ""
    ));
    return value;
  }, { timeout: 45_000 }).not.toBe("");
  await select.selectOption(value);
}

async function stageStarterCatalog(page) {
  await page.getByRole("button", { name: "Choose a starter or build my catalog" }).click();
  const dialog = page.getByRole("dialog", { name: "Library settings" });
  await expect(dialog).toBeVisible();
  const pack = dialog.locator(".starter-pack-card", { hasText: "Wedding & events" });
  await pack.getByRole("button", { name: "Use Wedding & events" }).click();
  await expect(dialog.getByRole("heading", { name: "Menu Builder" })).toBeVisible({ timeout: 45_000 });
  await expect(dialog.getByRole("button", { name: /Assorted Lemonade/ })).toBeVisible({ timeout: 45_000 });
  await dialog.getByText("Manage menu sections", { exact: true }).click();
  await dialog.locator('input[aria-label="New menu section name"]:visible').fill("Imported rows");
  await dialog.locator('button:visible', { hasText: "Add Menu Section" }).click();
  await expect(dialog.getByText('Menu section "Imported rows" added to the setup draft.'))
    .toBeVisible({ timeout: 30_000 });
  await publishCatalog(dialog);
}

async function importOneMenuItem(page, baselineCatalogRevision) {
  await page.goto("/app/imports?source=library-first-quote&importType=menuItems");
  const workbench = page.getByRole("main", { name: "Import Studio" })
    .or(page.getByRole("region", { name: "Import Studio" }))
    .or(page.getByRole("dialog", { name: "Import Studio" }));
  await expect(workbench).toBeVisible({ timeout: 45_000 });
  await workbench.locator('input[type="file"]').setInputFiles({
    name: SOURCE_FILE_NAME,
    mimeType: "text/csv",
    buffer: Buffer.from([
      "Name,Price,Cost,Pricing Type,Active",
      `${IMPORTED_ITEM_NAME},37,0,per_event,yes`
    ].join("\n"))
  });
  await expect(workbench.getByText(SOURCE_FILE_NAME, { exact: true })).toBeVisible();
  await workbench.getByRole("combobox", { name: "Change record type" }).selectOption("menuItems");

  const eventTypeSelect = workbench.getByRole("combobox", {
    name: "Apply one event type to every row"
  });
  if (await eventTypeSelect.count()) await chooseFirstRealOption(eventTypeSelect);
  const categorySelect = workbench.getByRole("combobox", {
    name: "Apply one category to every row"
  });
  await expect(categorySelect).toBeVisible({ timeout: 45_000 });
  await chooseFirstRealOption(categorySelect);

  await expect(workbench.getByRole("button", { name: "Ready 1", exact: true })).toBeVisible();
  await workbench.getByRole("button", { name: "Run server preflight" }).click();
  await expect(workbench.getByLabel("Import plan: Confirmed")).toBeVisible({ timeout: 45_000 });
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain(ORGANIZATION_ID);
    await dialog.accept();
  });
  await workbench.getByRole("button", { name: "Import 1 ready record(s)" }).click();
  await expect(workbench).toContainText("1 record added to the catalog draft", { timeout: 45_000 });
  await expect(workbench).toContainText("The active catalog is unchanged");

  const proof = await page.evaluate(async ({ organizationId, importedItemName }) => {
    const catalogDraft = await import("/src/lib/catalogSetupDraftService.js");
    const result = await catalogDraft.getCatalogSetupDraft({ organizationId });
    const change = (result.draft?.changes || []).find((entry) => (
      entry.collection === "menuItems" && entry.payload?.name === importedItemName
    ));
    return {
      currentCatalogRevision: result.currentCatalogRevision,
      generation: result.draft?.generation,
      state: result.draft?.state,
      change
    };
  }, { organizationId: ORGANIZATION_ID, importedItemName: IMPORTED_ITEM_NAME });
  expect(proof).toMatchObject({
    currentCatalogRevision: baselineCatalogRevision,
    state: "open",
    change: {
      collection: "menuItems",
      payload: { name: IMPORTED_ITEM_NAME, priceMinor: 3700, costMinor: 0 },
      provenance: {
        kind: "catalog_import",
        importType: "menuItems",
        sourceKind: "csv",
        sourceFileName: SOURCE_FILE_NAME,
        sourceRowNumber: 2
      }
    }
  });
  expect(proof.generation).toBeGreaterThan(0);

  const reviewCatalogDraft = workbench.getByRole("button", { name: "Review catalog draft" });
  await expect(reviewCatalogDraft).toHaveAttribute("data-catalog-review-record-id", proof.change.recordId);
  await reviewCatalogDraft.click();
  const storedReviewJourney = await page.evaluate((organizationId) => (
    window.sessionStorage.getItem(
      `quotepilot.workspace-task-journey.v1:${encodeURIComponent(organizationId)}`
    ) || ""
  ), ORGANIZATION_ID);
  expect(storedReviewJourney).not.toBe("");
  expect(storedReviewJourney).not.toContain(SOURCE_FILE_NAME);
  expect(storedReviewJourney).not.toContain(IMPORTED_ITEM_NAME);
  expect(storedReviewJourney).not.toMatch(/mutationReceipt|changes|priceMinor|costMinor/u);

  await page.reload();
  await expect(page.locator('[data-surface-contract-id="ambient-library"]'))
    .toHaveAttribute("data-catalog-focus-request", `catalog-import:${proof.change.provenance.importBatchId}:${proof.change.recordId}:${proof.change.provenance.sourceRowNumber}`);
  const catalogDialog = page.locator('[data-ambient-library-state="editing"]');
  await expect(catalogDialog).toBeVisible({ timeout: 45_000 });
  const importedRow = catalogDialog.locator(`[data-menu-item-id="${proof.change.recordId}"]`);
  await expect(importedRow).toHaveClass(/is-import-focus/u);
  await expect(importedRow.getByRole("button", { pressed: true })).toContainText(IMPORTED_ITEM_NAME);
  await expect(catalogDialog).toContainText("Recorded cost: $0.00");
  await expect(catalogDialog).toContainText("operator-declared import value, not a recipe-derived cost");
  return { catalogDialog, importedRecordId: proof.change.recordId };
}

async function publishCatalog(dialog) {
  await dialog.getByRole("tab", { name: "Pricing", exact: true }).click();
  await dialog.getByLabel("Pricing setup reviewed and approved").check();
  const check = dialog.getByRole("button", { name: "Check draft before publishing" });
  await expect(check).toBeEnabled({ timeout: 45_000 });
  await check.click();
  const publish = dialog.getByRole("button", { name: "Publish Library" });
  await expect(publish).toBeEnabled({ timeout: 45_000 });
  await publish.click();
  await expect(
    dialog.getByText("Published Library is active", { exact: true })
      .or(dialog.getByText("Library published", { exact: true }))
  )
    .toBeVisible({ timeout: 60_000 });
  const close = dialog.getByRole("button", { name: "Close" })
    .or(dialog.getByRole("button", { name: "Back to Library" }));
  await close.click();
  try {
    await expect(dialog).toBeHidden({ timeout: 2_000 });
    return;
  } catch {
    // A newly added menu section can retain a local editor-dismissal guard even
    // after the shared draft is published. Confirm that guard; publication was
    // already proven above and this action does not publish or mutate again.
  }
  dialog.page().once("dialog", async (nativeDialog) => {
    expect(nativeDialog.type()).toBe("confirm");
    await nativeDialog.accept();
  });
  await close.click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
}

async function fillRequiredQuoteFields(page) {
  const eventDate = new Date();
  eventDate.setUTCDate(eventDate.getUTCDate() + 30);
  const eventType = page.getByRole("combobox", { name: "Event type", exact: true });
  if (await eventType.count()) {
    await chooseFirstRealOption(eventType);
  } else {
    await expect(page.getByRole("group", { name: "Event type", exact: true }))
      .toContainText("Wedding & Events");
  }
  await page.locator('input[data-ambient-field="date"]').fill(eventDate.toISOString().slice(0, 10));
  await page.locator('input[data-ambient-field="time"]').fill("18:00");
  await page.getByRole("spinbutton", { name: "Event hours", exact: true }).fill("5");
  await page.getByRole("spinbutton", { name: /Guests \(max 400\)/i }).fill("80");
  await page.getByRole("textbox", { name: "Event name", exact: true }).fill("First Quote Activation E2E");
  await page.getByRole("textbox", { name: "Venue", exact: true }).fill("Receipt Hall");
  await page.getByRole("textbox", { name: "Venue address", exact: true }).fill("100 Receipt Way, Birmingham, AL");
  await page.getByRole("textbox", { name: "Your name", exact: true }).fill("First Quote Customer");
  await page.getByRole("textbox", { name: "Phone", exact: true }).fill("205-555-0177");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("first-quote@example.test");
}

async function saveQuoteWithImportedItem(page) {
  for (let step = 0; step < 7; step += 1) {
    const save = page.getByRole("button", { name: "Save draft" });
    if (await save.count()) {
      await save.click();
      return;
    }
    const imported = page.getByRole("checkbox", { name: new RegExp(IMPORTED_ITEM_NAME, "i") });
    if (await imported.count() && await imported.isVisible()) await imported.check();
    const next = page.getByRole("button", { name: /^Next:/u });
    await expect(next).toBeVisible();
    await next.click();
  }
  throw new Error("Unable to reach Save draft.");
}

test("blank owner publishes an imported menu row and saves one server-priced first quote", async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  await signInAsBlankOwner(page);
  const historyBefore = await page.evaluate(async (organizationId) => {
    const store = await import("/src/lib/quoteStore.js");
    const history = await store.getQuoteHistory({ organizationId, includeDeleted: true });
    return { source: history.source, ids: history.quotes.map((quote) => quote.id).sort() };
  }, ORGANIZATION_ID);
  expect(historyBefore).toEqual({ source: "firebase", ids: [] });

  await stageStarterCatalog(page);
  const baselineCatalogRevision = await page.evaluate(async (organizationId) => {
    const catalogDraft = await import("/src/lib/catalogSetupDraftService.js");
    const result = await catalogDraft.getCatalogSetupDraft({ organizationId });
    return result.currentCatalogRevision;
  }, ORGANIZATION_ID);
  expect(baselineCatalogRevision).toBeGreaterThan(0);
  const { catalogDialog, importedRecordId } = await importOneMenuItem(page, baselineCatalogRevision);
  await publishCatalog(catalogDialog);

  const publication = await page.evaluate(async ({ organizationId, importedRecordId }) => {
    const catalogDraft = await import("/src/lib/catalogSetupDraftService.js");
    const menu = await import("/src/lib/menuService.js");
    const draft = await catalogDraft.getCatalogSetupDraft({ organizationId });
    const eventTypes = await menu.getEventTypes({ organizationId });
    const items = (await Promise.all(eventTypes.map((eventType) => menu.getMenuItems(eventType.id, {
      includeInactive: true,
      organizationId
    })))).flat();
    return {
      currentCatalogRevision: draft.currentCatalogRevision,
      draftState: draft.draft?.state,
      imported: items.find((item) => item.id === importedRecordId)
    };
  }, { organizationId: ORGANIZATION_ID, importedRecordId });
  expect(publication.currentCatalogRevision).toBeGreaterThan(baselineCatalogRevision);
  expect(publication.draftState).not.toBe("open");
  expect(publication.imported).toMatchObject({
    id: importedRecordId,
    name: IMPORTED_ITEM_NAME,
    price: 37,
    cost: 0,
    importProvenance: {
      kind: "catalog_import",
      importType: "menuItems",
      sourceFileName: SOURCE_FILE_NAME,
      sourceRowNumber: 2
    }
  });

  await expect(page.getByRole("button", { name: "New Quote" }).first()).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "New Quote" }).first().click();
  const guidedMode = page.getByRole("button", { name: "Guided mode" });
  await expect(guidedMode).toBeVisible({ timeout: 45_000 });
  await guidedMode.click();
  await fillRequiredQuoteFields(page);
  await saveQuoteWithImportedItem(page);

  await expect(page).toHaveURL(/\/app\/quotes\/(?!new(?:$|\?))[^/?]+(?:\?.*)?$/u, { timeout: 45_000 });
  const quoteId = decodeURIComponent(new URL(page.url()).pathname.split("/").filter(Boolean).at(-1));
  const saved = await page.evaluate(async ({ organizationId, quoteId }) => {
    const store = await import("/src/lib/quoteStore.js");
    const history = await store.getQuoteHistory({ organizationId, includeDeleted: true });
    const quote = await store.getQuoteById(quoteId, { serverOnly: true });
    const versionHistory = await store.getQuoteVersionHistory(quoteId, { organizationId });
    return {
      historySource: history.source,
      historyIds: history.quotes.map((item) => item.id),
      versionSource: versionHistory.source,
      versions: versionHistory.versions.map((version) => ({
        id: version.id,
        quoteId: version.quoteId,
        organizationId: version.organizationId,
        versionNumber: version.versionNumber,
        pricingAuthority: version.pricing?.authority,
        menuItems: version.snapshot?.selection?.menuItems || [],
        menuItemsSnapshot: version.snapshot?.selection?.menuItemsSnapshot || []
      })),
      quote: {
        id: quote.id,
        organizationId: quote.organizationId,
        status: quote.status,
        activeVersionId: quote.activeVersionId,
        latestVersionNumber: quote.latestVersionNumber,
        pricingAuthority: quote.pricing?.authority,
        menuItems: quote.selection?.menuItems || [],
        menuItemsSnapshot: quote.selection?.menuItemsSnapshot || [],
        menuItemNames: quote.selection?.menuItemNames || []
      }
    };
  }, { organizationId: ORGANIZATION_ID, quoteId });
  expect(saved).toMatchObject({
    historySource: "firebase",
    historyIds: [quoteId],
    versionSource: "firebase",
    versions: [{
      id: "v0001",
      quoteId,
      organizationId: ORGANIZATION_ID,
      versionNumber: 1,
      pricingAuthority: "server_authoritative"
    }],
    quote: {
      id: quoteId,
      organizationId: ORGANIZATION_ID,
      status: "draft",
      activeVersionId: "v0001",
      latestVersionNumber: 1,
      pricingAuthority: "server_authoritative"
    }
  });
  expect(saved.quote.menuItems).toEqual([importedRecordId]);
  expect(saved.quote.menuItemsSnapshot).toEqual([
    expect.objectContaining({ id: importedRecordId, name: IMPORTED_ITEM_NAME, price: 37 })
  ]);
  expect(saved.quote.menuItemNames).toContain(IMPORTED_ITEM_NAME);
  expect(saved.versions[0].menuItems).toEqual([importedRecordId]);
  expect(saved.versions[0].menuItemsSnapshot).toEqual([
    expect.objectContaining({ id: importedRecordId, name: IMPORTED_ITEM_NAME, price: 37 })
  ]);
  await expect(page.getByRole("button", { name: "Send quote email" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/customer (accepted|booked)|payment received/iu);
});
