// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import InquiryShowcaseAdmin from "../InquiryShowcaseAdmin";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container; let root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("InquiryShowcaseAdmin", () => {
  test("keeps the capability visible but inert when the global gate is off", () => {
    act(() => root.render(<InquiryShowcaseAdmin organizationId="org-a" enabled={false} />));
    expect(container.textContent).toMatch(/gated off/i);
    expect(container.textContent).toMatch(/Nothing is published automatically/i);
  });

  test("shows draft, publication state, catalog references, and rollback history", async () => {
    const api = { getInquiryShowcaseAdminState: vi.fn().mockResolvedValue({ state: { state: "published", activeSlug: "events", tenantEnabled: true, draft: { slug: "events", pageTitle: "Events", introduction: "Tell us.", responsePromise: "We reply.", entries: [] } }, catalogReferences: [{ referenceType: "offer", referenceId: "dinner", name: "Dinner", active: true, customerSafe: true }], versions: [{ id: "pub_000001", slug: "events", catalogRevision: 3, publishedAtISO: "2026-09-13T00:00:00.000Z" }] }), saveInquiryShowcaseDraft: vi.fn(), publishInquiryShowcase: vi.fn(), pauseInquiryShowcase: vi.fn(), republishInquiryShowcaseVersion: vi.fn() };
    await act(async () => { root.render(<InquiryShowcaseAdmin organizationId="org-a" enabled api={api} />); await Promise.resolve(); });
    expect(container.textContent).toMatch(/presentation only/i);
    expect(container.textContent).toContain("published");
    expect(container.textContent).toContain("Republish as new version");
    expect(container.textContent).toContain("Open published page");
    expect(container.querySelector('[data-capability-id="inquiry-showcase-admin"]')).not.toBeNull();
  });
});
