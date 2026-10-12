import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

function source(file) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("quote workflow lazy boundary", () => {
  test.each(["src/App.jsx", "src/LegacyApp.jsx"])("%s loads composer surfaces through one workflow module", (file) => {
    const app = source(file);
    expect(app).toContain('import("./components/QuoteWorkflowModule")');
    expect(app).not.toMatch(/import LiveBreakdown from "\.\/components\/LiveBreakdown"/u);
    expect(app).not.toMatch(/import ChangeRequestPanel from "\.\/components\/ChangeRequestPanel"/u);
    expect(app).not.toMatch(/import CatalogReadNotice from "\.\/components\/CatalogReadNotice"/u);
    expect(app).not.toContain('import("./components/ProposalComposer")');
    expect(app).not.toContain('import("./components/WizardSteps")');
  });

  test("the workflow module owns composer, guided steps, breakdown, catalog review, and recovery notices", () => {
    const workflow = source("src/components/QuoteWorkflowModule.jsx");
    [
      "ProposalComposer",
      "StepEvent",
      "StepMenu",
      "StepServices",
      "StepReview",
      "LiveBreakdown",
      "QuoteCatalogRevisionReviewPanel",
      "ChangeRequestPanel",
      "CatalogReadNotice"
    ].forEach((name) => expect(workflow).toContain(name));
  });
});
