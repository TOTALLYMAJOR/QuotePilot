import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`${width}px new quote to sendable, customer decision to exact handoff, completed event to reviewed learning`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module" src="/e2e/quote-confidence-task5-fixture.jsx"></script></body></html>');
    const completion = page.locator('[data-capability-id="quote-completion-command-path"]');
    await expect(completion).toHaveAttribute("data-capability-state", "blocked");
    await completion.getByRole("button").click();
    await expect(completion).toHaveAttribute("data-capability-state", "sendable");
    await page.getByRole("button", { name: "Open accepted revision" }).click();
    await expect(page.locator('[data-exact-handoff="version-one"]')).toContainText("acceptance-one");
    const learning = page.locator('[data-capability-id="post-event-learning"]');
    await expect(learning).toHaveAttribute("data-capability-state", "partial");
    expect((await learning.getByRole("button", { name: "Refresh learning evidence" }).boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(learning.locator('[data-learning-row="attendance"]')).toContainText("-10");
    await learning.locator('[data-learning-category="recipe"]').getByRole("button").click();
    await expect(page.getByText("No recommendation has been adopted", { exact: false })).toBeVisible();
    const confirmation = page.getByRole("button", { name: "Confirm this receipt applies the recommendation" });
    await expect(confirmation).toHaveCount(0);
    await page.getByRole("button", { name: "Return mock recipe authority receipt" }).click();
    await expect(confirmation).toBeVisible();
    await confirmation.click();
    await expect(page.locator('[data-capability-id="post-event-learning-review"]')).toHaveAttribute("data-capability-state", "receipt");
    const disclosure = learning.getByText("Learning evidence boundary", { exact: true });
    await disclosure.focus(); await disclosure.press("Enter");
    await expect(learning).toContainText("Accepted version: version-one");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await learning.screenshot({ path: test.info().outputPath(`learning-${width}.png`) });
  });
}
