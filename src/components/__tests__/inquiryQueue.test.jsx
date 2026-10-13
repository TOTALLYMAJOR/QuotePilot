// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import InquiryQueue from "../InquiryQueue";
import { inquiryCapabilityStateMarker } from "../../lib/inquiryShowcaseClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container; let root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const record = { inquiryId: "inq-1", state: "received", revision: 1, submittedAtISO: new Date().toISOString(), fields: { name: "A Customer", eventType: "Wedding", eventDate: "2026-10-10", estimatedGuests: 80, location: "Chicago" }, preferences: [{ publicTitle: "Seasonal dinner" }], notification: { state: "failed" } };

describe("InquiryQueue", () => {
  test("registers every canonical mixed-surface state", () => {
    expect(inquiryCapabilityStateMarker("loading")).toContain('data-capability-state="loading"');
    expect(inquiryCapabilityStateMarker("empty")).toContain('data-capability-state="empty"');
    expect(inquiryCapabilityStateMarker("success")).toContain('data-capability-state="success"');
    expect(inquiryCapabilityStateMarker("stale")).toContain('data-capability-state="stale"');
    expect(inquiryCapabilityStateMarker("partial")).toContain('data-capability-state="partial"');
    expect(inquiryCapabilityStateMarker("error")).toContain('data-capability-state="error"');
    expect(inquiryCapabilityStateMarker("recovery")).toContain('data-capability-state="recovery"');
    expect(inquiryCapabilityStateMarker("ready")).toContain('data-capability-state="ready"');
    expect(inquiryCapabilityStateMarker("submitting")).toContain('data-capability-state="submitting"');
    expect(inquiryCapabilityStateMarker("uncertain")).toContain('data-capability-state="uncertain"');
    expect(inquiryCapabilityStateMarker("reconciliation")).toContain('data-capability-state="reconciliation"');
    expect(inquiryCapabilityStateMarker("receipt")).toContain('data-capability-state="receipt"');
  });
  test("makes the in-app inquiry and notification isolation visible", async () => {
    const api = { getInquiryQueue: vi.fn().mockResolvedValue({ inquiries: [record] }), acknowledgeInquiry: vi.fn().mockResolvedValue({ ok: true }), previewInquiryConversion: vi.fn(), convertInquiryToQuoteDraft: vi.fn(), dismissInquiry: vi.fn() };
    await act(async () => { root.render(<InquiryQueue organizationId="org-a" catalog={{}} enabled api={api} />); await Promise.resolve(); });
    expect(container.textContent).toContain("Wedding");
    expect(container.textContent).toMatch(/safely recorded/i);
    expect(container.textContent).toContain("Acknowledge and assign to me");
    await act(async () => { container.querySelector("button:not(.secondary)").click(); await Promise.resolve(); });
    expect(api.acknowledgeInquiry).toHaveBeenCalledWith({ organizationId: "org-a", inquiryId: "inq-1", expectedRevision: 1 });
  });

  test("requires explicit drift and identity choices in conversion review", async () => {
    const acknowledged = { ...record, state: "acknowledged", revision: 2 };
    const api = { getInquiryQueue: vi.fn().mockResolvedValue({ inquiries: [acknowledged] }), acknowledgeInquiry: vi.fn(), dismissInquiry: vi.fn(), convertInquiryToQuoteDraft: vi.fn(), previewInquiryConversion: vi.fn().mockResolvedValue({ inquiryId: "inq-1", inquiryRevision: 2, catalogRevision: 5, identity: { state: "existing_claim", customerId: "customer-12345678" }, drift: [{ entryId: "entry-1", publicTitle: "Dinner", referenceType: "offer", referenceId: "dinner", state: "changed", requiresResolution: true }], prefill: { name: "A Customer", email: "a@example.com", eventName: "Wedding inquiry", date: "2026-10-10", venue: "Chicago", venueAddress: "Chicago", guests: 80, packageId: "", addons: [], rentals: [], menuItems: ["salmon"], eventTemplateId: "custom" } }) };
    const catalog = { packages: [{ id: "dinner", name: "Dinner", active: true }], menuItems: [{ id: "salmon", name: "Salmon", active: true }], addons: [], rentals: [], settings: {} };
    await act(async () => { root.render(<InquiryQueue organizationId="org-a" catalog={catalog} enabled api={api} />); await Promise.resolve(); });
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => /Review conversion/i.test(button.textContent)).click(); await Promise.resolve(); });
    expect(container.textContent).toContain("Resolve the handoff");
    expect(container.textContent).toContain("Existing email claim found");
    expect(Array.from(container.querySelectorAll("button")).find((button) => /Create authoritative quote draft/i.test(button.textContent))?.disabled).toBe(true);
    const resolution = container.querySelector('select[aria-label="Resolution for Dinner"]');
    await act(async () => { resolution.value = "use_current"; resolution.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); });
    expect(Array.from(container.querySelectorAll("label")).find((label) => label.textContent.startsWith("Offer"))?.querySelector("select").value).toBe("dinner");
  });

  test("keeps converted and dismissed receipts visible without offering another mutation", async () => {
    const api = { getInquiryQueue: vi.fn().mockResolvedValue({ inquiries: [{ ...record, inquiryId: "converted-1", state: "converted", conversion: { quoteId: "quote-1" } }, { ...record, inquiryId: "dismissed-1", state: "dismissed" }] }), acknowledgeInquiry: vi.fn(), previewInquiryConversion: vi.fn(), convertInquiryToQuoteDraft: vi.fn(), dismissInquiry: vi.fn() };
    await act(async () => { root.render(<InquiryQueue organizationId="org-a" catalog={{}} enabled api={api} />); await Promise.resolve(); });
    expect(container.querySelectorAll('[data-inquiry-state="converted"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-inquiry-state="dismissed"]')).toHaveLength(1);
    expect(container.textContent).not.toContain("Acknowledge and assign to me");
    expect(container.textContent).not.toContain("Review conversion");
  });
});
