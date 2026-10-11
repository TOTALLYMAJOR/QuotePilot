import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

// Local development staff fixture only. These checks do not qualify hosted
// authentication, real-device keyboards, native browser zoom, or visual taste.
test.use({ deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "light" });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
});

const destinations = ["Now", "Opportunities", "Operations", "Clients", "Library"];
const profiles = [
  { width: 390, height: 844 },
  { width: 641, height: 900 },
  { width: 768, height: 900 },
  { width: 1180, height: 900 },
  { width: 1440, height: 900 }
];

async function arrive(page, path = "/app") {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
  await page.goto(path);
  const setup = page.getByRole("button", { name: "Explore the workspace" });
  await expect(setup.or(page.locator(".site-header"))).toBeVisible({ timeout: 45_000 });
  if (await setup.isVisible()) await setup.click();
  await expect(page.locator('[data-ambient-navigation="orientation"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await expect(page.getByRole("heading", { name: "Staff Sign In" })).toHaveCount(0);
}

async function receipt(page, request, browser, testInfo, scenario) {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const served = await request.get("/src/styles.css?direct");
  expect(served.ok()).toBe(true);
  expect(await served.text(), "The isolated server must serve this checkout's CSS.").toContain(css.trim());
  const observed = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    visualViewport: { width: visualViewport.width, height: visualViewport.height },
    headerHeight: document.querySelector(".site-header")?.getBoundingClientRect().height,
    taskWidth: document.querySelector("main")?.getBoundingClientRect().width,
    path: location.pathname
  }));
  expect(observed.dpr).toBe(1);
  expect(observed.reducedMotion).toBe(true);
  const evidence = JSON.stringify({
    scenario, browser: browser.version(), observed,
    profile: "development-ambient-local-admin-no-firebase-google-fonts-aborted",
    sourceSha256: Object.fromEntries(["src/styles.css", "src/components/WorkspaceShell.jsx", "e2e/workspace-geometry.spec.js"].map((path) => [path,
      createHash("sha256").update(readFileSync(path)).digest("hex")])),
    boundary: "Local Chromium emulation; not production, native zoom, hardware keyboard, or human visual acceptance."
  }, null, 2);
  const receiptPath = testInfo.outputPath("geometry-receipt.json");
  await writeFile(receiptPath, evidence);
  await testInfo.attach("geometry-receipt", { path: receiptPath, contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath("workspace.png"), fullPage: true });
}

async function expectUncovered(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const top = document.querySelector(".site-header")?.getBoundingClientRect().bottom || 0;
    const nav = document.querySelector(".ambient-primary-navigation");
    const bottom = nav && getComputedStyle(nav).position === "fixed"
      ? nav.getBoundingClientRect().top : visualViewport.height;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.top >= top - 1 && rect.bottom <= bottom + 1 && (hit === element || element.contains(hit));
  })).toBe(true);
}

for (const profile of profiles) {
  test(`navigation and usable task canvas at ${profile.width}px`, async ({ page, request, browser }, testInfo) => {
    await page.setViewportSize(profile);
    await arrive(page);
    const nav = page.getByRole("navigation", { name: "Primary workspace" });
    const boxes = [];
    for (const name of destinations) {
      const button = nav.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      boxes.push(box);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(profile.width + 1);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        const first = boxes[left];
        const second = boxes[right];
        expect(first.x + first.width <= second.x + 1 || second.x + second.width <= first.x + 1
          || first.y + first.height <= second.y + 1 || second.y + second.height <= first.y + 1).toBe(true);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(profile.width + 1);
    if (profile.width >= 641 && profile.width <= 1180) {
      const geometry = await page.evaluate(() => ({
        headerHeight: document.querySelector(".site-header").getBoundingClientRect().height,
        taskWidth: document.querySelector("main").getBoundingClientRect().width,
        navPosition: getComputedStyle(document.querySelector(".ambient-primary-navigation")).position
      }));
      expect(geometry.headerHeight).toBeLessThanOrEqual(160);
      expect(geometry.taskWidth).toBeGreaterThanOrEqual(profile.width - 64);
      expect(geometry.navPosition).not.toBe("fixed");
    }
    await receipt(page, request, browser, testInfo, profile);
  });
}

test("200%-equivalent reflow retains tablet navigation and task width", async ({ page, request, browser }, testInfo) => {
  // 1440x900 at 200% presents approximately 720x450 CSS pixels. This is a
  // reflow simulation, deliberately not a claim of native browser UI zoom.
  await page.setViewportSize({ width: 720, height: 450 });
  await arrive(page, "/app/customers");
  await expect(page.getByRole("heading", { name: "Clients", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary workspace" });
  await expect(nav.getByRole("button", { name: "Clients", exact: true })).toHaveAttribute("aria-current", "page");
  for (const name of destinations) await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(721);
  await receipt(page, request, browser, testInfo, { cssViewport: "720x450", effectiveReflow: "200% of 1440x900" });
});

test("reduced viewport preserves focused field and reachable final action above bottom navigation", async ({ page, request, browser }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await arrive(page, "/app/quotes/new");
  const name = page.getByRole("textbox", { name: "Event name", exact: true });
  await name.fill("Geometry fixture dinner");
  await name.focus();
  await page.setViewportSize({ width: 390, height: 390 });
  await expect(name).toBeFocused();
  await expectUncovered(name);
  const action = page.getByRole("button", { name: /save quote|review quote|continue|next/i }).last();
  await expectUncovered(action);
  const spacing = await page.evaluate(() => ({
    reserved: parseFloat(getComputedStyle(document.querySelector(".app-shell")).paddingBottom),
    navHeight: document.querySelector(".ambient-primary-navigation").getBoundingClientRect().height,
    safeArea: getComputedStyle(document.querySelector(".ambient-primary-navigation")).paddingBottom
  }));
  expect(spacing.reserved).toBeGreaterThanOrEqual(spacing.navHeight);
  await receipt(page, request, browser, testInfo, { viewportReduction: "390x844 to 390x390", finalAction: await action.innerText(), spacing });
});

test("workspace tools keyboard dismissal restores the surviving trigger", async ({ page, request, browser }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await arrive(page);
  const trigger = page.getByRole("button", { name: "Workspace and tools" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Workspace & tools" })).toBeVisible();
  const search = page.getByRole("button", { name: "Search customers and opportunities", exact: true });
  await expect(search).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Close workspace and tools" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Workspace & tools" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await receipt(page, request, browser, testInfo, { keyboard: "Enter tools, Escape, original trigger" });
});

test("secondary operational headings share typography without changing brand type", async ({ page, request, browser }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await arrive(page);
  const computed = await page.evaluate(() => {
    const styles = (element) => {
      const value = getComputedStyle(element);
      return { family: value.fontFamily, size: value.fontSize, weight: value.fontWeight, lineHeight: value.lineHeight };
    };
    const now = document.querySelector(".now-surface h3:not(.sr-only)");
    // Presentation-only probes: they test selector scoping, not Inventory
    // data/auth readiness or a Workflow business outcome.
    const fixture = document.createElement("div");
    fixture.innerHTML = '<section data-capability-id="inventory-workspace"><h3>Inventory typography probe</h3></section><section class="sales-workflow-card"><h3>Workflow typography probe</h3></section><section><h3>Unrelated typography probe</h3></section>';
    document.querySelector(".app-shell").append(fixture);
    const result = {
      now: styles(now), inventory: styles(fixture.children[0].firstChild), workflow: styles(fixture.children[1].firstChild),
      unrelated: styles(fixture.children[2].firstChild),
      brand: styles(document.querySelector(".product-brand-copy strong")),
      token: getComputedStyle(document.documentElement).getPropertyValue("--font-operational-secondary-heading").trim()
    };
    fixture.remove();
    return result;
  });
  expect(computed.token).not.toBe("");
  expect(computed.now).toEqual(computed.inventory);
  expect(computed.now).toEqual(computed.workflow);
  expect(computed.now.size).toBe("18px");
  expect(computed.now.weight).toBe("650");
  expect(computed.now.family).toContain("Manrope");
  expect(computed.unrelated).not.toEqual(computed.now);
  expect(computed.brand.family).toContain("Bodoni Moda");
  await receipt(page, request, browser, testInfo, { typography: computed, probes: "CSS-only, not Inventory authority evidence" });
});

test("nonzero safe-area inset is reserved below the mobile final action", async ({ page, request, browser }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { bottom: 24, left: 0, right: 0, top: 0 } });
  await arrive(page, "/app/quotes/new");
  const spacing = await page.evaluate(() => ({
    reserved: parseFloat(getComputedStyle(document.querySelector(".app-shell")).paddingBottom),
    navHeight: document.querySelector(".ambient-primary-navigation").getBoundingClientRect().height,
    navPadding: parseFloat(getComputedStyle(document.querySelector(".ambient-primary-navigation")).paddingBottom)
  }));
  expect(spacing.navPadding).toBeGreaterThanOrEqual(24);
  expect(spacing.reserved).toBeGreaterThanOrEqual(spacing.navHeight);
  const action = page.getByRole("button", { name: /save quote|review quote|continue|next/i }).last();
  await expectUncovered(action);
  await receipt(page, request, browser, testInfo, { emulatedSafeAreaBottom: 24, finalAction: await action.innerText(), spacing });
});
