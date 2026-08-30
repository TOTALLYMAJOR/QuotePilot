import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 }
]) {
  test(`staging email action route requires a deliberate verification action on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const params = new URLSearchParams({
      apiKey: "browser-test-key",
      mode: "verifyEmail",
      oobCode: "browser-one-time-code",
      continueUrl: "https://quotepilot-staging-20260804.web.app/app"
    });
    await page.goto(`/app/auth/action?${params}`);

    const surface = page.locator('[data-capability-id="firebase-email-verification-handler"]');
    const action = page.getByRole("button", { name: "Verify email" });
    await expect(surface).toHaveAttribute("data-capability-state", "ready");
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    await expect(action).toBeVisible();
    await expect(page).toHaveURL(/\/app\/auth\/action$/);
    await expect(page.locator("body")).not.toContainText("browser-one-time-code");

    const actionBox = await action.boundingBox();
    expect(actionBox?.height || 0).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    ))).toBe(true);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });
}
