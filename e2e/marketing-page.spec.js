import { expect, test } from "@playwright/test";

test("public landing page presents QuotePilot for catering teams with truthful routes", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Catering sales + event operations", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: /The event changed\. QuotePilot knows what that means\./i
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Running a business means carrying all of it."
  })).toBeVisible();
  await expect(page.getByText(
    "Time is the one thing your business can never order more of."
  )).toBeVisible();

  const cinematicVideo = page.locator("#quote-pilot-commercial-video");
  await expect(cinematicVideo).toHaveAttribute("poster", "/videos/quote-pilot-commercial-poster.webp");
  await expect(cinematicVideo.locator("source")).toHaveAttribute("src", "/videos/quote-pilot-commercial.mp4");
  await expect(page.locator("[data-landing-chapter]")).toHaveCount(9);
  await expect(page.getByRole("button", { name: /Pause film|Resume film|Play film/ })).toBeVisible();

  const demoLinks = page.getByRole("link", { name: "Book a demo" });
  await expect(demoLinks.first()).toHaveAttribute("href", "https://mbmapps.com/contact");
  await expect(page.getByRole("link", { name: "Try $1 test access" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Staff login" }).first()).toHaveAttribute("href", "/app");
  await expect(page.getByRole("link", { name: "Explore the platform" })).toHaveAttribute("href", "/system");

  await expect(page.getByRole("heading", {
    name: "Your time is the one thing the business cannot replace."
  })).toBeVisible();
  await expect(page.getByText("An app should make life easier. On that, we stand.")).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Make the customer’s next decision feel simple." })).toBeVisible();
  await expect(page.getByText(
    "Acceptance records the customer decision. Payment and booking remain separate facts."
  )).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Let the team arrive prepared, not preoccupied."
  })).toBeVisible();

  const visibleCopy = await page.locator("body").innerText();
  expect(visibleCopy).not.toMatch(/QuoteFlow|Tony Catering|Toni Catering|Start quoting free/i);
});

test("public landing page stays contained on mobile and honors reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.getByRole("heading", {
    name: /The event changed\. QuotePilot knows what that means\./i
  })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const animationDuration = await page.locator(".qp-landing-cinematic-copy").evaluate(
    (node) => getComputedStyle(node).animationDuration
  );
  expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.01);

  const cinematicVideoPaused = await page.locator("#quote-pilot-commercial-video").evaluate(
    (video) => video.paused
  );
  expect(cinematicVideoPaused).toBe(true);
});

test("customer portal query takes precedence over the public landing page", async ({ page }) => {
  await page.goto("/?portal=e2e-route-precedence");

  await expect(page.getByRole("heading", { name: "Your proposal" })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: /The event changed\. QuotePilot knows what that means\./i
  })).toHaveCount(0);
});

test("staff route loads the workspace boundary rather than the public landing page", async ({ page }) => {
  await page.goto("/app");

  const workspaceSurface = page.getByRole("button", { name: "New Quote" }).first().or(
    page.getByRole("heading", { name: "Your Catalog Connection Needs Attention" })
  );
  await expect(workspaceSurface).toBeVisible();
  await expect(page.getByRole("heading", {
    name: /The event changed\. QuotePilot knows what that means\./i
  })).toHaveCount(0);
});
