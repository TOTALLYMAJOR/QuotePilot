import { expect, test } from "@playwright/test";

test("public landing page presents QuotePilot for catering teams with truthful routes", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", {
    name: /Every event is a document that won’t hold still/i
  })).toBeVisible();
  await expect(page.getByText("Catering sales + event operations", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", {
    name: /Banquet event order for Morgan Wedding, revision six/i
  })).toBeVisible();

  const demoLinks = page.getByRole("link", { name: "Book a demo" });
  await expect(demoLinks.first()).toHaveAttribute("href", "https://mbmapps.com/contact");
  await expect(page.getByRole("link", { name: "Try $1 test access" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Staff login" }).first()).toHaveAttribute("href", "/app");
  await expect(page.getByRole("link", { name: "Explore the platform" })).toHaveAttribute("href", "/system");

  await expect(page.getByRole("heading", { name: "The full quote-to-event toolkit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Make every customer decision easier to review" })).toBeVisible();
  await expect(page.getByText(
    "Acceptance records the customer decision. Payment and booking remain separate facts."
  )).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Keep event operations connected to the approved scope"
  })).toBeVisible();

  const visibleCopy = await page.locator("body").innerText();
  expect(visibleCopy).not.toMatch(/QuoteFlow|Tony Catering|Toni Catering|Start quoting free/i);
});

test("public landing page stays contained on mobile and honors reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.getByRole("heading", {
    name: /Every event is a document that won’t hold still/i
  })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const animationDuration = await page.locator(".qp-dh-h1").evaluate(
    (node) => getComputedStyle(node).animationDuration
  );
  expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.01);
});

test("customer portal query takes precedence over the public landing page", async ({ page }) => {
  await page.goto("/?portal=e2e-route-precedence");

  await expect(page.getByRole("heading", { name: "Your proposal" })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: /Every event is a document that won’t hold still/i
  })).toHaveCount(0);
});

test("staff route loads the workspace boundary rather than the public landing page", async ({ page }) => {
  await page.goto("/app");

  const workspaceSurface = page.getByRole("button", { name: "New Quote" }).first().or(
    page.getByRole("heading", { name: "Your Catalog Connection Needs Attention" })
  );
  await expect(workspaceSurface).toBeVisible();
  await expect(page.getByRole("heading", {
    name: /Every event is a document that won’t hold still/i
  })).toHaveCount(0);
});
