// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import PublicInquiryPage from "../PublicInquiryPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container; let root;
const showcase = { publicationVersionId: "pub_000001", pageTitle: "Tell us about your event", introduction: "Share what you are considering.", responsePromise: "We will follow up.", branding: { name: "Example Catering", primaryColor: "#243126", logoUrl: "" }, entries: [{ entryId: "entry-one", publicTitle: "Seasonal dinner", shortDescription: "A preference.", imageUrl: "", featuredLabel: "Popular" }] };

beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.head.querySelectorAll('[data-inquiry-robots="true"], [data-inquiry-turnstile="true"]').forEach((node) => node.remove()); delete window.turnstile; vi.restoreAllMocks(); });
async function render(api = { getPublishedInquiryShowcase: vi.fn().mockResolvedValue({ showcase }), submitPublicInquiry: vi.fn(), resolveInquirySubmission: vi.fn() }) { await act(async () => { root.render(<PublicInquiryPage slug="events" api={api} enabled turnstileSiteKey="test-key" />); await Promise.resolve(); }); return api; }
function input(id, value) { const element = container.querySelector(`#${id}`); const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value").set; act(() => { setter.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); }); }

describe("PublicInquiryPage", () => {
  test("renders noindex and explicit non-commercial boundaries", async () => {
    await render();
    expect(document.head.querySelector('meta[name="robots"]')?.content).toBe("noindex,nofollow");
    expect(container.textContent).toMatch(/does not show pricing or confirm availability/i);
    expect(container.textContent).toMatch(/allergen safety/i);
  });

  test("records one content-free form-start signal pinned to the visible publication", async () => {
    const api = await render({
      getPublishedInquiryShowcase: vi.fn().mockResolvedValue({ showcase }),
      recordPublicInquiryFormStarted: vi.fn().mockResolvedValue({ ok: true }),
      submitPublicInquiry: vi.fn(),
      resolveInquirySubmission: vi.fn()
    });
    input("name", "A Customer");
    input("email", "a@example.com");
    expect(api.recordPublicInquiryFormStarted).toHaveBeenCalledTimes(1);
    expect(api.recordPublicInquiryFormStarted).toHaveBeenCalledWith({
      slug: "events",
      publicationVersionId: "pub_000001"
    });
  });

  test("restores validation focus and presents an exact review before submission", async () => {
    await render();
    act(() => container.querySelector('button[type="submit"]').click());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    input("name", "A Customer"); input("email", "a@example.com"); input("eventType", "Wedding"); input("eventDate", "2026-10-10"); input("estimatedGuests", "80"); input("location", "Chicago");
    act(() => container.querySelector('button[type="submit"]').click());
    expect(container.textContent).toMatch(/What feels right/i);
    act(() => { const consent = container.querySelector("#serviceResponseConsent"); consent.click(); container.querySelector(".inquiry-preference input").click(); });
    act(() => Array.from(container.querySelectorAll("button")).find((button) => /Review request/i.test(button.textContent)).click());
    expect(container.textContent).toContain("Exact review");
    expect(container.textContent).toContain("A Customer");
    expect(container.textContent).toContain("Seasonal dinner");
    expect(container.textContent).toContain("Service-response consent");
    expect(container.textContent).toContain("Agreed");
    expect(container.textContent).toMatch(/Submitting does not subscribe you to marketing/i);
  });

  test("shows stale-publication recovery rather than accepting changed scope", async () => {
    window.turnstile = { render: vi.fn((_, options) => options.callback("verified-token")) };
    const updatedShowcase = { ...showcase, publicationVersionId: "pub_000002", pageTitle: "Updated event inquiry", entries: [] };
    const api = await render({ getPublishedInquiryShowcase: vi.fn().mockResolvedValueOnce({ showcase }).mockResolvedValueOnce({ showcase: updatedShowcase }), submitPublicInquiry: vi.fn().mockRejectedValue(Object.assign(new Error("This inquiry page changed while it was open."), { code: "aborted" })), resolveInquirySubmission: vi.fn() });
    input("name", "A Customer"); input("email", "a@example.com"); input("eventType", "Wedding"); input("eventDate", "2026-10-10"); input("estimatedGuests", "80"); input("location", "Chicago");
    act(() => container.querySelector('button[type="submit"]').click());
    act(() => container.querySelector("#serviceResponseConsent").click());
    act(() => Array.from(container.querySelectorAll("button")).find((button) => /Review request/i.test(button.textContent)).click());
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => /Send inquiry/i.test(button.textContent)).click(); await Promise.resolve(); });
    expect(container.textContent).toMatch(/changed while it was open/i);
    await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => /Refresh and review/i.test(button.textContent)).click(); await Promise.resolve(); });
    expect(api.getPublishedInquiryShowcase).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Updated event inquiry");
    expect(container.textContent).toContain("A Customer");
    expect(container.textContent).toContain("Review the updated request");
  });
});
