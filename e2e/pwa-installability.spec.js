import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1440, height: 1000 }
]) {
  test(`offline recovery stays clear and contained at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/offline.html");

    const shell = page.locator('[data-pwa-offline-shell="safe-recovery-v1"]');
    await expect(shell).toBeVisible();
    await expect(page.getByRole("heading", { name: "QuotePilot is offline" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Nothing was sent, saved, or changed.");
    await expect(page.getByRole("link", { name: "Try QuotePilot again" })).toBeVisible();

    const actionSize = await page.getByRole("link", { name: "Try QuotePilot again" })
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { height: rect.height, width: rect.width };
      });
    expect(actionSize.height).toBeGreaterThanOrEqual(44);
    expect(actionSize.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });
}

test("manifest exposes the install icons through the public shell", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.id).toBe("/");
  expect(manifest.display).toBe("standalone");

  for (const size of ["192x192", "512x512"]) {
    const icon = manifest.icons.find((candidate) => candidate.sizes === size);
    expect(icon).toBeTruthy();
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
  }
});
