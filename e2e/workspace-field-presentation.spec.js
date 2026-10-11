import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

// Real presentation components with explicit local data. Not authenticated
// Inventory success, customer-detail routing, hosted data, or visual acceptance.
test.use({ deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "light" });

for (const width of [390, 768, 1440]) {
  test(`field proportions and vertical comparison columns at ${width}px`, async ({ page, request, browser }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
    await page.addInitScript(() => {
      const ActualDate = Date;
      window.Date = class extends ActualDate {
        constructor(...args) { super(...(args.length ? args : ["2026-10-11T12:00:00.000Z"])); }
        static now() { return ActualDate.parse("2026-10-11T12:00:00.000Z"); }
      };
    });
    await page.goto("/app");
    const css = readFileSync("src/styles.css", "utf8");
    const served = await request.get("/src/styles.css?direct");
    expect(served.ok()).toBe(true);
    expect(await served.text()).toContain(css.trim());
    await page.evaluate(async () => {
      const [{ default: React }, { default: ReactDOM }, { InventoryWorkspaceView }, { QuoteVersionComparisonPresentation }] = await Promise.all([
        import("/node_modules/.vite/deps/react.js"),
        import("/node_modules/.vite/deps/react-dom_client.js"),
        import("/src/components/InventoryWorkspace.jsx"),
        import("/src/components/QuoteVersionComparison.jsx")
      ]);
      const host = document.createElement("div");
      host.className = "app-shell-neutral";
      host.dataset.presentationEvidence = "local-component-fixture-not-authority";
      document.body.replaceChildren(host);
      const attempt = { state: "ready", error: "", requestId: "", receipt: null, confirmation: null };
      const model = {
        schemaVersion: 2, organizationId: "local-presentation",
        workspace: { locations: [{ locationId: "kitchen", name: "Local kitchen fixture", active: true, revision: 1 }] },
        ingredients: [{ ingredientId: "rice", name: "Rice fixture", nameSortKey: "rice fixture", category: "Grain", baseUnitId: "lb", dimension: "mass", active: true, ingredientRevision: 1,
          stock: { state: "recorded", availability: "current", revision: 1, onHandMicros: 40_000_000, quantity: "40", allocationRevision: 1, committedMicros: 0, committedQuantity: "0", availableToAllocateMicros: 40_000_000, availableToAllocateQuantity: "40", unit: "lb", locationId: "kitchen" },
          cost: { state: "not_recorded", availability: "not_yet_available", revision: 0 }, packConversions: [], locationId: "kitchen", locationName: "Local kitchen fixture" }],
        sources: { workspace: { state: "current", fromCache: false, hasPendingWrites: false }, ingredients: { state: "current", fromCache: false, hasPendingWrites: false } }, freshness: "current", bounded: false
      };
      const known = (value) => ({ state: "known", value });
      const fields = [
        ["total", "Recorded total", "money", 1200, 1499.5],
        ["guests", "Guest count", "number", 40, 125],
        ["hours", "Duration (hours)", "number", 3, 4.5],
        ["miles", "Round-trip miles", "number", 12, 108],
        ["date", "Event date", "date", "2026-10-14", "2026-10-15"],
        ["time", "Event time", "time", "09:00", "10:30"]
      ].map(([id, label, valueType, before, after]) => ({ id, label, valueType, before: known(before), after: known(after), comparison: "changed" }));
      fields.push({ id: "missing", label: "Recorded quantity unavailable", valueType: "number", before: { state: "unknown", value: null }, after: known(12), comparison: "unknown" });
      const comparison = { comparisonState: "partial", equivalence: "different", evidenceBoundary: "Local immutable-comparison presentation fixture only.", issues: [], before: { identity: {} }, after: { identity: {} }, summary: { changedFieldCount: 6, unknownFieldCount: 1 }, sections: [{ id: "fixture", label: "Local comparison fixture", state: "changed_partial", summary: { changed: 6 }, fields }] };
      const noop = () => {};
      ReactDOM.createRoot(host).render(React.createElement(React.Fragment, null,
        React.createElement("p", { role: "note" }, "Local presentation fixture — not authenticated Inventory or customer-route evidence"),
        React.createElement(InventoryWorkspaceView, { access: { organizationId: "local-presentation", role: "admin", readEnabled: true, mutationEnabled: true }, read: { state: "current", model, error: "" }, attempts: Object.fromEntries(["location", "ingredient", "stock", "receiving", "cost", "conversion"].map((axis) => [axis, attempt])), onRetry: noop, onSubmit: noop, onReconcile: noop, onReset: noop }),
        React.createElement("div", { className: "container" }, React.createElement(QuoteVersionComparisonPresentation, { comparison }))
      ));
    });
    const costTask = page.getByRole("button", { name: "Record cost evidence", exact: true }).first();
    await costTask.focus();
    await page.keyboard.press("Enter");
    const form = page.getByRole("form", { name: "Record purchase cost", exact: true });
    await expect(form).toBeVisible();
    const code = form.locator('input[maxlength="3"]');
    const quantity = form.locator('input[placeholder="40"]');
    const note = form.locator("textarea");
    await quantity.fill("123456.125");
    await note.fill("A long receipt note retains the available task width without resizing the currency code.");
    await code.focus();
    await expect(code).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(quantity).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(code).toBeFocused();
    await expect(code).toHaveValue("USD");
    const proportions = await form.evaluate((element) => {
      const measure = (selector) => { const input = element.querySelector(selector); const style = getComputedStyle(input); return { width: input.getBoundingClientRect().width, align: style.textAlign, numerals: style.fontVariantNumeric }; };
      return { code: measure('input[maxlength="3"]'), quantity: measure('input[placeholder="40"]'), date: measure('input[type="datetime-local"]'), note: measure("textarea") };
    });
    expect(proportions.code.width).toBeLessThan(proportions.quantity.width);
    expect(proportions.quantity.width).toBeLessThan(proportions.note.width);
    expect(proportions.quantity.align).toBe("end");
    expect(proportions.quantity.numerals).toContain("tabular-nums");
    expect(proportions.date.numerals).toContain("tabular-nums");
    const containment = await form.evaluate((element) => {
      const panel = element.closest(".panel");
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      const left = rect.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
      const right = rect.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
      return { left, right, fields: [...element.querySelectorAll("input, select, textarea")].map((field) => ({ left: field.getBoundingClientRect().left, right: field.getBoundingClientRect().right })) };
    });
    for (const field of containment.fields) {
      expect(field.left).toBeGreaterThanOrEqual(containment.left - 1);
      expect(field.right).toBeLessThanOrEqual(containment.right + 1);
    }
    const comparison = page.locator(".quote-version-comparison");
    await expect(comparison).toHaveAttribute("data-capability-state", "partial");
    await expect(comparison).toContainText("Before: Not recorded");
    const columns = await comparison.locator("dd").evaluateAll((rows) => rows.map((row) => [...row.children].map((value) => ({ x: value.getBoundingClientRect().x, right: value.getBoundingClientRect().right, y: value.getBoundingClientRect().y, align: getComputedStyle(value).textAlign, numerals: getComputedStyle(value).fontVariantNumeric }))));
    for (const [before, after] of columns) {
      expect(before.y).toBeCloseTo(after.y, 0);
      expect(before.align).toBe("end");
      expect(after.numerals).toContain("tabular-nums");
      expect(before.right).toBeCloseTo(columns[0][0].right, 0);
      expect(after.right).toBeCloseTo(columns[0][1].right, 0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    const observed = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches }));
    expect(observed.dpr).toBe(1);
    expect(observed.reducedMotion).toBe(true);
    const receiptPath = testInfo.outputPath("field-presentation-receipt.json");
    await writeFile(receiptPath, JSON.stringify({ browser: browser.version(), observed, proportions, containment, columns,
      profile: "local-real-presentation-components-fixture-google-fonts-aborted",
      sourceSha256: Object.fromEntries(["src/styles.css", "src/components/InventoryWorkspace.jsx", "src/components/QuoteVersionComparison.jsx", "e2e/workspace-field-presentation.spec.js"].map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
      boundary: "Local presentation only; no auth, route-continuity, submitted-payload, hosted-data, or human-acceptance claim."
    }, null, 2));
    await testInfo.attach("field-presentation-receipt", { path: receiptPath, contentType: "application/json" });
    await page.screenshot({ path: testInfo.outputPath("fields-and-comparison.png"), fullPage: true });
  });
}
