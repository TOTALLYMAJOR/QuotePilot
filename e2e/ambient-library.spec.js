import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  DEFAULT_ADDONS,
  DEFAULT_EVENT_TEMPLATES,
  DEFAULT_PACKAGES,
  DEFAULT_RENTALS,
  DEFAULT_SETTINGS
} from "../src/data/mockCatalog";

const AMBIENT_UI_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_AMBIENT_UI_ENABLED || "").trim().toLowerCase()
);
const CUSTOMER_CENTERED_WORKSPACE_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED || "").trim().toLowerCase()
);
const CAPTURE_PROOF = ["1", "true", "yes", "on"].includes(
  String(process.env.CAPTURE_AMBIENT_BROWSER_PROOF || "").trim().toLowerCase()
);
const PROOF_DIRECTORY = "output/playwright/ambient-intelligence-current";
const LAZY_SURFACE_TIMEOUT_MS = 30_000;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
];

const CATALOG = {
  packages: DEFAULT_PACKAGES,
  addons: DEFAULT_ADDONS,
  rentals: DEFAULT_RENTALS,
  settings: {
    ...DEFAULT_SETTINGS,
    catalogRevision: 12,
    pricingSetupConfirmed: true,
    pricingConfirmation: {
      actorUid: "ambient-library-admin",
      actorEmail: "ambient-library-admin@example.test",
      confirmedAtISO: "2026-08-12T15:00:00.000Z",
      confirmedCatalogRevision: 12
    },
    menuSections: [],
    eventTemplates: DEFAULT_EVENT_TEMPLATES.slice(0, 2)
  }
};

async function seedLibrary(page) {
  await page.addInitScript((catalog) => {
    localStorage.setItem("quoteWizard.catalog.e2e-org", JSON.stringify(catalog));
  }, CATALOG);
}

async function openAmbientLibrary(page) {
  await page.goto("/app/catalog");
  const title = page.locator("#ambient-library-title");
  await expect(title).toHaveText("The choices behind every quote.", {
    timeout: LAZY_SURFACE_TIMEOUT_MS
  });
  await expect(title).toBeFocused();
  await expect(page).toHaveURL(/\/app\/catalog$/u);
  await expect(page.locator(".ambient-library")).toHaveAttribute(
    "data-library-context",
    "standalone"
  );
  return title;
}

async function readPersistedCatalog(page) {
  return page.evaluate(() => localStorage.getItem("quoteWizard.catalog.e2e-org"));
}

async function beforeUnloadIsProtected(page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function beginLibraryAcknowledgementObservation(page, actionId) {
  await page.evaluate((requestedActionId) => {
    const action = document.querySelector(`[data-library-action-id="${requestedActionId}"]`);
    if (!action) throw new Error(`Library action ${requestedActionId} is not mounted.`);

    const observation = {
      actionId: requestedActionId,
      activationAt: null,
      acknowledgementAt: null,
      acknowledgementMs: null,
      resultKind: "",
      message: ""
    };
    window.__ambientLibraryAcknowledgementObservation = observation;

    const captureAcknowledgement = () => {
      const acknowledgement = document.querySelector("[data-library-acknowledgement]");
      if (!acknowledgement || observation.activationAt === null) return false;
      observation.acknowledgementAt = performance.now();
      observation.acknowledgementMs = observation.acknowledgementAt - observation.activationAt;
      observation.resultKind = acknowledgement.getAttribute("data-result-kind") || "";
      observation.message = acknowledgement.textContent || "";
      return true;
    };

    action.addEventListener("click", () => {
      observation.activationAt = performance.now();
    }, { capture: true, once: true });
    const observer = new MutationObserver(() => {
      if (!captureAcknowledgement()) return;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }, actionId);
}

async function layoutAudit(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height
      };
    };
    const overlap = (left, right) => (
      Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
      && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
    );
    const editing = Boolean(document.querySelector(".ambient-library--editing"));
    const requiredGroups = editing
      ? [
          ".ambient-library__orientation",
          ".ambient-library__editor .modal-head",
          ".ambient-library__editor .admin-tabs"
        ]
      : [
          ".ambient-library__masthead",
          '[data-library-section="catalog"] .ambient-library__row-list',
          '[data-library-section="templates"] .ambient-library__row-list'
        ];
    const optionalGroups = editing
      ? [".ambient-library__editor .admin-section-head"]
      : [
          ".ambient-library__usage",
          ".ambient-library__template-list"
        ];
    const collisions = [];
    let auditedGroupCount = 0;
    for (const selector of requiredGroups) {
      const root = document.querySelector(selector);
      if (!root) return { setupError: `Missing declared Library layout group ${selector}.` };
      if (!visible(root)) continue;
      auditedGroupCount += 1;
      const children = [...root.children].filter(visible);
      children.forEach((leftElement, leftIndex) => {
        children.slice(leftIndex + 1).forEach((rightElement) => {
          if (overlap(rect(leftElement), rect(rightElement))) {
            collisions.push({
              group: selector,
              left: leftElement.className || leftElement.tagName,
              right: rightElement.className || rightElement.tagName
            });
          }
        });
      });
    }
    optionalGroups.forEach((selector) => {
      const root = document.querySelector(selector);
      if (!root || !visible(root)) return;
      auditedGroupCount += 1;
      const children = [...root.children].filter(visible);
      children.forEach((leftElement, leftIndex) => {
        children.slice(leftIndex + 1).forEach((rightElement) => {
          if (overlap(rect(leftElement), rect(rightElement))) {
            collisions.push({
              group: selector,
              left: leftElement.className || leftElement.tagName,
              right: rightElement.className || rightElement.tagName
            });
          }
        });
      });
    });
    const controls = [...document.querySelectorAll(".ambient-library button:not([disabled]), .ambient-library input:not([disabled]), .ambient-library select:not([disabled])")]
      .filter(visible)
      .map((element) => {
        const pointerTarget = element.matches('input[type="checkbox"], input[type="radio"]')
          ? element.closest("label") || element
          : element;
        return {
          label: element.getAttribute("aria-label") || pointerTarget.textContent.trim() || element.name,
          width: rect(pointerTarget).width,
          height: rect(pointerTarget).height
        };
      });
    const surface = document.querySelector(".ambient-library");
    return {
      setupError: "",
      auditedGroupCount,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      surfaceOverflow: surface ? surface.scrollWidth - surface.clientWidth : null,
      collisions,
      undersizedControls: controls.filter((control) => control.width < 44 || control.height < 44)
    };
  });
}

test.describe("Ambient Library", () => {
  test.skip(
    !AMBIENT_UI_ENABLED || !CUSTOMER_CENTERED_WORKSPACE_ENABLED,
    "Requires the Ambient UI and customer-centered workspace presentation gates."
  );

  for (const viewport of VIEWPORTS) {
    test(`keeps standalone Library truthful, accessible, and overlap-safe at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await seedLibrary(page);
      await openAmbientLibrary(page);

      await expect(page.locator("#ambient-library-catalog-title")).toHaveText("Choices for new quotes");
      await expect(page.locator('[data-library-section="catalog"]')).toBeVisible();
      await expect(page.locator('[data-library-section="templates"]')).toBeVisible();
      await expect(page.locator('[data-library-record-kind="event-template"]')).toHaveCount(2);
      await expect(page.locator("#catalog-admin-title")).toHaveCount(0);
      await expect(page.locator(".ambient-library__usage")).toContainText("Available from opportunities");
      await expect(page.locator("body")).not.toContainText("Return to Rivera Wedding");

      const audit = await layoutAudit(page);
      expect(audit.setupError).toBe("");
      expect(audit.auditedGroupCount).toBeGreaterThanOrEqual(3);
      expect(audit.documentOverflow).toBeLessThanOrEqual(1);
      expect(audit.surfaceOverflow).toBeLessThanOrEqual(1);
      expect(audit.collisions).toEqual([]);
      expect(audit.undersizedControls).toEqual([]);

      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(accessibility.violations).toEqual([]);

      if (CAPTURE_PROOF) {
        mkdirSync(PROOF_DIRECTORY, { recursive: true });
        await page.screenshot({
          path: `${PROOF_DIRECTORY}/ambient-library-${viewport.width}.png`,
          fullPage: true
        });
      }
    });
  }

  test("acknowledges a primary action within 250ms and opens its exact object", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedLibrary(page);
    await openAmbientLibrary(page);
    const persistedBeforeBrowse = await readPersistedCatalog(page);
    const action = page.locator(".ambient-library__next [data-library-action-id]");
    await expect(action).toHaveAttribute("data-library-action-id", "review-library-menu");

    await beginLibraryAcknowledgementObservation(page, "review-library-menu");
    await action.click();
    await expect(page.locator("[data-library-acknowledgement]")).toBeVisible();
    await page.waitForFunction(() => (
      window.__ambientLibraryAcknowledgementObservation?.acknowledgementAt !== null
    ));
    const observation = await page.evaluate(() => (
      window.__ambientLibraryAcknowledgementObservation
    ));
    expect(observation).toMatchObject({
      actionId: "review-library-menu",
      resultKind: "pending"
    });
    expect(observation.activationAt).not.toBeNull();
    expect(observation.acknowledgementMs).toBeGreaterThanOrEqual(0);
    expect(observation.acknowledgementMs).toBeLessThanOrEqual(250);
    expect(observation.message).toContain("Opening Menu");
    const menuTab = page.locator('[data-admin-tab-id="menu"]');
    await expect(menuTab).toHaveClass(/active/u);
    const acknowledgement = page.locator("[data-library-acknowledgement]");
    await expect(acknowledgement).toContainText("ready to review");
    await expect(acknowledgement).toBeFocused();
    expect(await readPersistedCatalog(page)).toBe(persistedBeforeBrowse);

    const audit = await layoutAudit(page);
    expect(audit.setupError).toBe("");
    expect(audit.auditedGroupCount).toBeGreaterThanOrEqual(3);
    expect(audit.documentOverflow).toBeLessThanOrEqual(1);
    expect(audit.surfaceOverflow).toBeLessThanOrEqual(1);
    expect(audit.collisions).toEqual([]);
  });

  test("keeps a failed menu draft on the device and rehydrates it after returning to Library", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLibrary(page);
    await openAmbientLibrary(page);

    await page.getByRole("button", { name: "Open Menu Builder" }).click();
    await expect(page.locator('[data-admin-tab-id="menu"]')).toHaveClass(/active/u);
    const editor = page.locator("#catalog-admin-title").locator("..").locator("..");
    const eventType = editor.getByRole("combobox", { name: "Event type", exact: true });
    await expect.poll(() => eventType.locator("option").count()).toBeGreaterThan(1);
    await eventType.selectOption({ index: 1 });
    const menuSection = editor.getByRole("combobox", { name: "Menu section", exact: true });
    await expect.poll(() => menuSection.locator("option").count()).toBeGreaterThan(1);
    await menuSection.selectOption({ index: 1 });

    const menuSectionDisclosure = editor.locator("details.admin-menu-disclosure").nth(1);
    if ((await menuSectionDisclosure.getAttribute("open")) === null) {
      await menuSectionDisclosure.locator("summary").click();
    }
    await editor.getByLabel("New menu section name").fill("Device buffer section");
    await editor.getByRole("button", { name: "Add Menu Section" }).click();
    await expect(menuSection.locator("option", { hasText: "Device buffer section" })).toHaveCount(1);
    await menuSection.selectOption({ index: 1 });

    const addItemDisclosure = editor.locator("details.admin-menu-add-item");
    if ((await addItemDisclosure.getAttribute("open")) === null) {
      await addItemDisclosure.locator("summary").click();
    }
    await editor.getByLabel("New menu item name").fill("Device buffer soup");
    await editor.getByLabel("New menu item price", { exact: true }).fill("12.34");
    await editor.getByRole("button", { name: "Add Item" }).click();
    await editor.getByLabel("Select Device buffer soup").check();
    await editor.getByLabel("Move selected items to menu section").selectOption({ label: "Device buffer section" });
    await editor.getByRole("button", { name: "Move selected" }).click();
    await expect(editor.getByLabel("Catalog draft status").getByText(/Sync failed — changes are device-only/u))
      .toBeVisible({ timeout: 10_000 });
    await expect(editor.getByText("Device-only changes", { exact: true })).toBeVisible();
    await expect(editor.getByText("All changes saved", { exact: false })).toHaveCount(0);

    await editor.getByRole("button", { name: "Back to Library" }).click();
    await expect(page.locator("#ambient-library-title")).toBeFocused();
    await page.getByRole("button", { name: "Open Menu Builder" }).click();
    await expect(page.locator('[data-admin-tab-id="menu"]')).toHaveClass(/active/u);

    const reopened = page.locator("#catalog-admin-title").locator("..").locator("..");
    await reopened.getByRole("combobox", { name: "Menu section", exact: true })
      .selectOption({ label: "Device buffer section" });
    const reopenedItem = reopened.getByLabel("Edit Device buffer soup");
    await expect(reopenedItem.getByLabel("Selling price", { exact: true })).toHaveValue("12.34");
    await expect(reopened.getByText("Device-only changes", { exact: true })).toBeVisible();
    const menuBuilderAudit = await layoutAudit(page);
    expect(menuBuilderAudit.documentOverflow).toBeLessThanOrEqual(1);
    expect(menuBuilderAudit.surfaceOverflow).toBeLessThanOrEqual(1);
    expect(menuBuilderAudit.collisions).toEqual([]);
    const menuBuilderAccessibility = await new AxeBuilder({ page })
      .include(".admin-menu-builder")
      .analyze();
    expect(menuBuilderAccessibility.violations).toEqual([]);
    const draftBarAccessibility = await new AxeBuilder({ page })
      .include(".catalog-draft-state-bar")
      .analyze();
    expect(draftBarAccessibility.violations).toEqual([]);
    const stagedItem = await page.evaluate(() => {
      const key = Object.keys(localStorage)
        .find((candidate) => candidate.startsWith("quotepilot.catalog-setup-device-buffer.v1:"));
      const buffer = JSON.parse(localStorage.getItem(key) || "null");
      return buffer?.changes?.find((change) => change.payload?.name === "Device buffer soup") || null;
    });
    expect(stagedItem).toMatchObject({ intent: "create", payload: { priceMinor: 1234 } });
    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-menu-device-buffer-mobile.png`,
        fullPage: true
      });
    }
  });

  test("opens the exact event template and restores Library orientation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLibrary(page);
    await openAmbientLibrary(page);
    const persistedBeforeBrowse = await readPersistedCatalog(page);
    await page.locator(".ambient-library__template-disclosure > summary").click();
    const wedding = page.locator('[data-library-record-kind="event-template"][data-library-record-id="wedding"]');
    const weddingAction = wedding.getByRole("button", { name: /Review Wedding/u });
    await weddingAction.click();

    const exactRecord = page.locator('[data-library-record-kind="event-template"][data-library-record-id="wedding"]');
    await expect(exactRecord).toBeVisible();
    const summary = exactRecord.locator('[data-template-field="summary"]');
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('[data-library-record-id="corporate"] [data-template-field="summary"]'))
      .toHaveAttribute("aria-expanded", "false");
    const acknowledgement = page.locator("[data-library-acknowledgement]");
    await expect(acknowledgement).toContainText("requested template is ready");
    await expect(acknowledgement).toBeFocused();
    expect(await readPersistedCatalog(page)).toBe(persistedBeforeBrowse);

    const audit = await layoutAudit(page);
    expect(audit.setupError).toBe("");
    expect(audit.auditedGroupCount).toBeGreaterThanOrEqual(3);
    expect(audit.documentOverflow).toBeLessThanOrEqual(1);
    expect(audit.surfaceOverflow).toBeLessThanOrEqual(1);
    expect(audit.collisions).toEqual([]);
    expect(audit.undersizedControls).toEqual([]);

    if (CAPTURE_PROOF) {
      mkdirSync(PROOF_DIRECTORY, { recursive: true });
      await page.screenshot({
        path: `${PROOF_DIRECTORY}/ambient-library-template-wedding-390.png`,
        fullPage: true
      });
    }

    await page.getByRole("button", { name: "Back to Library" }).click();
    await expect(page.locator("#ambient-library-title")).toBeVisible();
    await expect(weddingAction).toBeFocused();
    await expect(page.locator("#catalog-admin-title")).toHaveCount(0);
  });

  test("preserves an unsaved template while moving through the workspace and clears protection after discard", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedLibrary(page);
    await openAmbientLibrary(page);
    const persistedBeforeDraft = await readPersistedCatalog(page);
    await page.locator(".ambient-library__template-disclosure > summary").click();
    const wedding = page.locator('[data-library-record-kind="event-template"][data-library-record-id="wedding"]');
    const weddingAction = wedding.getByRole("button", { name: /Review Wedding/u });
    await weddingAction.click();
    const name = page.locator('[data-library-record-kind="event-template"][data-library-record-id="wedding"] [data-template-field="name"]');
    await name.fill("Wedding evening");

    await expect.poll(() => beforeUnloadIsProtected(page)).toBe(true);
    expect(await readPersistedCatalog(page)).toBe(persistedBeforeDraft);

    const backToLibrary = page.getByRole("button", { name: "Back to Library" });
    page.once("dialog", async (dialog) => dialog.dismiss());
    await backToLibrary.click();
    await expect(page).toHaveURL(/\/app\/catalog$/u);
    await expect(name).toHaveValue("Wedding evening");

    await page.locator('[data-ambient-orientation="now"]').click();
    await expect(page.locator("#ambient-library-title")).toHaveCount(0);
    await page.goBack();
    await expect(name).toHaveValue("Wedding evening");
    await page.goForward();
    await page.goBack();
    await expect(name).toHaveValue("Wedding evening");
    expect(await readPersistedCatalog(page)).toBe(persistedBeforeDraft);

    page.once("dialog", async (dialog) => dialog.accept());
    await backToLibrary.click();
    await expect(page.locator("#ambient-library-title")).toBeVisible();
    await expect(weddingAction).toBeFocused();
    expect(await readPersistedCatalog(page)).toBe(persistedBeforeDraft);
    await expect.poll(() => beforeUnloadIsProtected(page)).toBe(false);
  });

  test("gives sales direct read-only Library readiness without an admin editor or duplicate main", async ({ page }) => {
    const salesPort = Number(process.env.PLAYWRIGHT_SALES_PORT || 4176);
    await page.goto(`http://127.0.0.1:${salesPort}/app/catalog`);
    await expect(page.getByText("Business Setup Center", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Ask an administrator" }).first()).toBeDisabled();
    await expect(page.locator("#catalog-admin-title")).toHaveCount(0);
  });
});
