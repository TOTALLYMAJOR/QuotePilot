import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 }
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

for (const viewport of VIEWPORTS) {
  test(`workspace meets contrast and text-floor checks at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/app");
    await expect(page.getByRole("button", { name: /New quote/i }).first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include(".app-shell")
      .withRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);

    const undersizedText = await page.locator(".app-shell").evaluate((root) => (
      Array.from(root.querySelectorAll("*"))
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return rect.width > 0
            && rect.height > 0
            && style.display !== "none"
            && style.visibility !== "hidden"
            && Array.from(element.childNodes).some(
              (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
            );
        })
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: element.className,
          text: element.textContent.trim().slice(0, 60),
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
        }))
        .filter((entry) => entry.fontSize < 12)
    ));
    expect(undersizedText).toEqual([]);

    await expect(
      page.locator(".command-center:visible, .wizard-panel:visible").first()
    ).toBeVisible();
    const isCommandCenterHome = await page.locator(".command-center").isVisible();
    const actionTargetSelector = isCommandCenterHome
      ? ".command-center .cta:visible, .command-center .ghost:visible"
      : ".wizard-panel .cta:visible, .wizard-panel .ghost:visible";
    const primaryAndGhostSizes = await page.locator(actionTargetSelector)
      .evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, text: element.textContent.trim() };
      }));
    expect(primaryAndGhostSizes.length).toBeGreaterThan(0);
    expect(primaryAndGhostSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

    const stepperSizes = await page.locator(".field-stepper .stepper-input button:visible")
      .evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }));
    if (stepperSizes.length > 0) {
      expect(stepperSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test("fonts load from swap-enabled document links without CSS imports", async ({ page, request }) => {
  await page.goto("/app");
  const fontLinks = await page.locator('link[rel="stylesheet"][href*="fonts.googleapis.com"]').evaluateAll(
    (links) => links.map((link) => link.getAttribute("href"))
  );
  expect(fontLinks).toHaveLength(1);
  expect(fontLinks[0]).toContain("display=swap");
  expect(fontLinks[0]).toContain("Bodoni+Moda");
  expect(fontLinks[0]).toContain("DM+Mono");
  expect(fontLinks[0]).toContain("Inter");
  expect(fontLinks[0]).toContain("Manrope");
  await expect(page.locator('link[rel="preconnect"][href="https://fonts.googleapis.com"]')).toHaveCount(1);
  await expect(page.locator('link[rel="preconnect"][href="https://fonts.gstatic.com"]')).toHaveCount(1);

  for (const stylesheet of ["/src/styles.css", "/src/marketing.css"]) {
    const response = await request.get(stylesheet);
    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toMatch(/^\s*@import/m);
  }
});
