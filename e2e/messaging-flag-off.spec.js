import { expect, test } from "@playwright/test";

const CUSTOMER_CENTERED_WORKSPACE_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED || "").trim().toLowerCase()
);

test("the disabled messaging flag keeps the station nav hidden and deep links fail closed", async ({ page }) => {
  test.skip(
    CUSTOMER_CENTERED_WORKSPACE_ENABLED,
    "This fail-closed contract applies only while the customer-centered workspace flag is disabled."
  );

  await page.goto("/app/messages");

  await expect(page.getByRole("heading", { name: "Workspace page not found" })).toBeVisible();
  await expect(page.getByText("/app/messages is not a QuotePilot staff workspace route.")).toBeVisible();
  await expect(page.locator(".site-header").getByRole("button", { name: "Messages", exact: true }))
    .toHaveCount(0);
});
