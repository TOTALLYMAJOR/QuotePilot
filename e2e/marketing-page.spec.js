import { expect, test } from "@playwright/test";

test("public landing page presents QuotePilot for catering teams with truthful routes", async ({ page }) => {
  const videoRequests = [];
  page.on("request", (request) => {
    if (/\.mp4(?:\?|$)/.test(request.url())) videoRequests.push(request.url());
  });
  await page.goto("/");

  await expect(page.getByText("Catering sales + event operations", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: /Every event is a document/i
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Running a business means carrying all of it."
  })).toBeVisible();
  await expect(page.getByText(
    "Time is the one thing your business can never order more of."
  )).toBeVisible();

  const cinematicVideo = page.locator("#quote-pilot-commercial-video");
  await expect(cinematicVideo).toHaveAttribute("poster", "/videos/quote-pilot-commercial-poster.webp");
  await expect(cinematicVideo.locator("source")).toHaveCount(0);
  expect(videoRequests).toEqual([]);
  await expect(page.locator("[data-landing-chapter]")).toHaveCount(10);
  const commercial = page.locator("#commercial");
  const playFilm = commercial.getByRole("button", { name: "Load and play full film" });
  await expect(playFilm).toBeVisible();
  await playFilm.click();
  await expect(cinematicVideo.locator("source"))
    .toHaveAttribute("src", "/videos/quote-pilot-commercial.mp4");
  await expect(commercial.locator(".qp-landing-film-status")).toBeVisible();

  await expect(page.getByRole("link", { name: "Book a demo" })).toHaveCount(0);
  const partnerEntry = page.getByRole("link", { name: "Become a design partner" });
  await expect(partnerEntry.first()).toHaveAttribute("href", "#design-partner");
  await expect(page.getByRole("heading", {
    name: "Five caterers will shape what this becomes."
  })).toBeVisible();
  const applyLinks = page.getByRole("link", { name: "Apply for a partner seat" });
  await expect(applyLinks.first()).toHaveAttribute("href", "https://mbmapps.com/contact");
  await expect(page.getByText("FIVE SEATS · A SHORT CONVERSATION, NOT A SALES CALL")).toBeVisible();
  await expect(page.getByRole("link", { name: "Try $1 test access" })).toHaveCount(0);

  await page.getByRole("tab", { name: /Plans/ }).click();
  await expect(page.getByText("Strategic Agency", { exact: true })).toBeVisible();
  await expect(page.getByText("+$49.99/MO")).toBeVisible();
  await expect(page.getByText("PLAN PRICING SET WITH FOUNDING PARTNERS")).toBeVisible();
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
  expect(visibleCopy).not.toMatch(/QuoteFlow|Tony Catering|Toni Catering|Start quoting free|placeholder price/i);
});

test("public landing page stays contained on mobile and honors reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.getByRole("heading", {
    name: /Every event is a document/i
  })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await expect(page.locator(".qp-dh-stamp.qp-dh-on")).toBeVisible();
  await expect(page.locator(".qp-landing-header-login")).toBeVisible();
  await expect(page.locator("#quote-pilot-commercial-video source")).toHaveCount(0);

  const cinematicVideoPaused = await page.locator("#quote-pilot-commercial-video").evaluate(
    (video) => video.paused
  );
  expect(cinematicVideoPaused).toBe(true);
});

test("customer portal query takes precedence over the public landing page", async ({ page }) => {
  await page.goto("/?portal=e2e-route-precedence");

  await expect(page.getByRole("heading", { name: "Your proposal" })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: /Every event is a document/i
  })).toHaveCount(0);
});

test("staff route loads the workspace boundary rather than the public landing page", async ({ page }) => {
  const runtimeErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/app");

  const workspaceSurface = page.getByRole("button", { name: "New Quote" }).first().or(
    page.getByRole("heading", { name: "Your Catalog Connection Needs Attention" })
  );
  const recoverySurface = page.getByRole("heading", { name: "QuotePilot workspace did not load" });
  await expect(workspaceSurface.or(recoverySurface)).toBeVisible();
  expect(runtimeErrors, "workspace route runtime errors").toEqual([]);
  expect(consoleErrors, "workspace route console errors").toEqual([]);

  await expect(workspaceSurface).toBeVisible();
  await expect(page.getByRole("heading", {
    name: /Every event is a document/i
  })).toHaveCount(0);
});
