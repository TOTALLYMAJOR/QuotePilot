import { expect, test } from "@playwright/test";
import { jsPDF } from "jspdf";

function searchableCatalogPdf() {
  const document = new jsPDF({ unit: "pt", format: "letter" });
  document.setFontSize(16);
  document.text("Entrees", 48, 72);
  document.setFontSize(12);
  document.text("Roast chicken platter", 48, 112);
  document.text("$24.00", 330, 112);
  document.text("$8.25", 420, 112);
  return Buffer.from(document.output("arraybuffer"));
}

async function openImportWorkbench(page) {
  await page.goto("/app/imports");
  const setupHeading = page.getByRole("heading", { name: "Bring Your Catalog to Life" });
  const importHeading = page.getByRole("heading", { name: "Import Studio", exact: true });
  await expect(setupHeading.or(importHeading)).toBeVisible({ timeout: 30_000 });
  if (await setupHeading.isVisible()) {
    await page.getByRole("button", { name: "Explore the workspace" }).click();
    await page.goto("/app/imports");
  }
  const workbench = page.getByRole("region", { name: "Import Studio" })
    .or(page.getByRole("dialog", { name: "Import Studio" }));
  await expect(workbench).toBeVisible({ timeout: 30_000 });
  return workbench;
}

test("searchable PDF is extracted by the pinned browser runtime into an exact, mobile-safe review", async ({ page }) => {
  test.setTimeout(90_000);
  const runtimeResponses = [];
  page.on("response", (response) => {
    if (response.url().includes("/vendor/pdfjs-5.7.284/")) {
      runtimeResponses.push({ url: response.url(), status: response.status() });
    }
  });

  const workbench = await openImportWorkbench(page);
  await workbench.locator('input[type="file"]').setInputFiles({
    name: "fall-banquet-menu.pdf",
    mimeType: "application/pdf",
    buffer: searchableCatalogPdf()
  });

  await expect(workbench.getByText("PDF source inspected", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(workbench.getByText("fall-banquet-menu.pdf", { exact: true })).toBeVisible();
  await expect(workbench.getByText(/1 inferred row\(s\).*1 page\(s\)/)).toBeVisible();

  const reviewRow = workbench.locator(".import-review-table tbody tr").first();
  await expect(reviewRow).toContainText("Page 1");
  await expect(reviewRow.locator(".import-source-excerpt")).toHaveText("Roast chicken platter $24.00 $8.25");
  await expect(reviewRow).toContainText("Roast chicken platter");
  await expect(reviewRow).toContainText("24");
  await expect(reviewRow).toContainText("8.25");
  await expect(reviewRow).toContainText("Prepopulated");
  await expect(workbench.getByText("Source page, Source excerpt", { exact: false })).toBeVisible();

  expect(runtimeResponses).toEqual(expect.arrayContaining([
    expect.objectContaining({ url: expect.stringContaining("/vendor/pdfjs-5.7.284/pdf.min.mjs"), status: 200 })
  ]));

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(reviewRow.locator(".import-source-excerpt")).toBeVisible();
  const layout = await page.evaluate(() => {
    const tableWrap = document.querySelector(".import-preview-table-wrap");
    return {
      bodyWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      tableClientWidth: tableWrap?.clientWidth || 0,
      tableScrollWidth: tableWrap?.scrollWidth || 0
    };
  });
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.tableScrollWidth).toBeGreaterThan(layout.tableClientWidth);
});
