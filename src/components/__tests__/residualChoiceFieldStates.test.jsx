import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AdminCatalogView } from "../AdminCatalogModal";
import { IntegrationOpsView } from "../IntegrationOpsModal";
import { SalesWorkflowView } from "../SalesWorkflowModal";
import { SalesWorkflowView as LegacySalesWorkflowView } from "../LegacySalesWorkflowModal";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function catalogDraftController() {
  return {
    status: "idle",
    label: "Draft saved",
    generation: 0,
    changedRecordCount: 0,
    serverChanges: [],
    deviceChanges: [],
    changes: [],
    deviceOnly: false,
    error: "",
    receipt: null,
    queueChanges: vi.fn(() => true),
    discardDeviceChanges: vi.fn(() => true),
    syncNow: vi.fn(async () => ({ ok: true })),
    retry: vi.fn(async () => ({ ok: true })),
    review: vi.fn(async () => ({ readyToPublish: true })),
    publish: vi.fn(async () => ({ catalogRevisionAfter: 2 }))
  };
}

const CATALOG = {
  source: "firebase-org",
  authoritativeVersion: 1,
  packages: [{ id: "offer-1", name: "Offer one", ppp: 30, active: true }],
  addons: [],
  rentals: [],
  settings: {
    catalogRevision: 1,
    pricingSetupConfirmed: true,
    configurationRules: [],
    upsellRules: []
  }
};

describe("residual 0/1/many choice fields", () => {
  test("Admin Catalog explains empty event-type and menu-section choices with one local recovery each", () => {
    const html = renderToStaticMarkup(
      <AdminCatalogView
        open
        catalog={CATALOG}
        organizationId="org-1"
        initialTab="menu"
        catalogSetupDraftController={catalogDraftController()}
        onClose={() => {}}
        onSave={async () => ({ ok: true })}
        onApplyStarterPack={async () => ({ ok: true })}
        saving={false}
      />
    );

    expect(html).toContain('data-choice-field="catalog-event-type"');
    expect(html).toContain('data-choice-field="catalog-menu-section"');
    expect(html.match(/data-adaptive-choice-mode="empty"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Add event type");
    expect(html).toContain("Choose or add an event type before adding a menu section.");
  });

  test("both Workflow implementations expose the authoritative quote zero state through the shared primitive", () => {
    for (const [WorkflowView, marker] of [
      [SalesWorkflowView, "workflow-authoritative-quote"],
      [LegacySalesWorkflowView, "legacy-workflow-authoritative-quote"]
    ]) {
      const html = renderToStaticMarkup(
        <WorkflowView
          open
          presentation="embedded"
          organizationId="org-1"
          currentUserRole="admin"
          onClose={() => {}}
        />
      );

      expect(html).toContain(`data-choice-field="${marker}"`);
      expect(html).toContain('data-adaptive-choice-mode="empty"');
      expect(html).toContain("The bounded Workflow quote read is still loading.");
      expect(html).toContain("Reload quotes");
    }
  });

  test("Integration Ops explains why no quote can receive an audit event and keeps reload recovery", () => {
    const html = renderToStaticMarkup(
      <IntegrationOpsView
        open
        organizationId="org-1"
        currentUserRole="admin"
        canManageProviders
        onClose={() => {}}
      />
    );

    expect(html).toContain('data-adaptive-choice-mode="empty"');
    expect(html).toContain('data-choice-field="integration-audit-quote"');
    expect(html).toContain("No quote is available to receive an integration audit event.");
    expect(html).toContain("Reload quotes");
    expect(html).not.toContain("<select><option value=\"\">Select quote");
  });

  test("all named residual selectors are wired to AdaptiveChoiceField with stale-value recovery copy", () => {
    const admin = readSource("../AdminCatalogModal.jsx");
    const workflow = readSource("../SalesWorkflowModal.jsx");
    const legacyWorkflow = readSource("../LegacySalesWorkflowModal.jsx");
    const integration = readSource("../IntegrationOpsModal.jsx");

    for (const label of [
      'label="Event type"',
      'label="Menu section"',
      'label="Move selected items to menu section"',
      'label="Catalog component"',
      'label="Target item"'
    ]) {
      expect(admin).toContain(label);
    }
    expect(admin).toContain("Previously selected event type");
    expect(admin).toContain("Previously selected menu section");
    expect(admin).toContain("Previously selected destination");
    expect(admin).toContain("Previously selected ${kind === \"package\" ? \"offer\" : kind}");

    for (const source of [workflow, legacyWorkflow]) {
      expect(source).toContain('label="Requestable approval action"');
      expect(source).toContain('label="Authoritative quote"');
      expect(source).toContain("Previously selected quote");
      expect(source).toContain('label: "Review quote"');
      expect(source).toContain('label: "Reload quotes"');
    }

    expect(integration).toContain('label="Quote"');
    expect(integration).toContain("Previously selected quote");
    expect(integration).toContain('fieldState={form.quoteId && !selectedIntegrationQuotePresent');
  });
});
