import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const inquiry = require("../../../functions/inquiryShowcase.js");

const catalog = {
  packages: [{ id: "offer-one", name: "Dinner", active: true, offerVersion: "offer-v3", ppp: 99, costPpp: 40 }],
  addons: [{ id: "coffee", name: "Coffee", active: true, price: 8 }],
  rentals: [{ id: "linen", name: "Linen", active: false, price: 12 }],
  menuItems: [{ id: "salmon", name: "Salmon", active: true, updatedAtISO: "2026-09-01T00:00:00.000Z", cost: 20 }]
};
const settings = { catalogRevision: 17, eventTemplates: [{ id: "wedding", name: "Wedding", active: true, version: "template-v2" }] };
const draft = {
  slug: "celebrate-with-us",
  pageTitle: "Plan your gathering",
  introduction: "Tell us what you are considering.",
  responsePromise: "We will follow up.",
  entries: [
    { referenceType: "offer", referenceId: "offer-one", publicTitle: "A relaxed dinner", shortDescription: "A starting point.", displayOrder: 1 },
    { referenceType: "menu_item", referenceId: "salmon", publicTitle: "Seasonal seafood", displayOrder: 2 }
  ]
};

function publication() {
  return inquiry.buildPublication({ organizationId: "org-a", versionId: "pub_000001", draft, catalog, settings, actor: { uid: "admin-1", email: "admin@example.com", role: "admin" }, nowISO: "2026-09-13T18:00:00.000Z" });
}

describe("Inquiry Showcase authority", () => {
  test("publishes only customer-safe presentation and pinned reference evidence", () => {
    const result = publication();
    const projected = inquiry.publicProjection(result, { brandName: "Example Catering", brandPrimaryColor: "#123456" });
    expect(projected.publicationVersionId).toBe("pub_000001");
    expect(projected.entries[0]).toMatchObject({ referenceId: "offer-one", sourceCatalogRevision: 17, sourceItemVersion: "offer-v3" });
    expect(JSON.stringify(projected)).not.toMatch(/ppp|price|cost|margin|availability|inclusion/iu);
    expect(projected.searchIndexing).toBe("noindex");
  });

  test("rejects missing, inactive, internal-only, duplicate, and unsafe-image references", () => {
    expect(inquiry.validateDraftReferences(inquiry.normalizeDraft({ ...draft, entries: [{ referenceType: "rental", referenceId: "linen", publicTitle: "Linen" }] }), { catalog, settings }).violations[0].reason).toBe("inactive");
    expect(() => inquiry.buildPublication({ organizationId: "org-a", versionId: "pub_2", draft: { ...draft, entries: [{ referenceType: "addon", referenceId: "missing", publicTitle: "Missing" }] }, catalog, settings, actor: { uid: "a" }, nowISO: "2026-09-13T18:00:00.000Z" })).toThrow(/not safe to publish/i);
    expect(() => inquiry.normalizeDraft({ ...draft, entries: [...draft.entries, { ...draft.entries[0], entryId: "again" }] })).toThrow(/more than once/i);
    expect(() => inquiry.normalizeDraft({ ...draft, entries: [{ ...draft.entries[0], imageUrl: "javascript:alert(1)" }] })).toThrow(/HTTPS image URL/i);
    expect(() => inquiry.normalizeDraft({ ...draft, pageTitle: "Dinner from $99 per person" })).toThrow(/cannot claim price/i);
    expect(() => inquiry.normalizeDraft({ ...draft, entries: [{ ...draft.entries[0], shortDescription: "Guaranteed availability" }] })).toThrow(/cannot claim price, availability/i);
  });

  test("pins submissions to the exact publication and hashes recovery data", () => {
    const built = inquiry.buildInquiry({
      organizationId: "org-a", inquiryId: "inquiry-1", requestId: "request_abcdefghijklmnop", recoverySecret: "a".repeat(32), publication: publication(),
      fields: { name: "A Customer", email: "CUSTOMER@example.com", eventType: "Wedding", eventDate: "2026-10-10", estimatedGuests: 80, location: "Chicago", notes: "Outdoor if possible", serviceResponseConsent: true },
      preferenceRefs: [{ entryId: publication().entries[0].entryId }], nowISO: "2026-09-13T18:10:00.000Z", deleteAtISO: "2026-12-12T18:10:00.000Z"
    });
    expect(built.source).toMatchObject({ publicationVersionId: "pub_000001", catalogRevision: 17 });
    expect(built.recoverySecretHash).not.toContain("a".repeat(24));
    expect(inquiry.recoverySecretMatches("a".repeat(32), built.recoverySecretHash)).toBe(true);
    expect(() => inquiry.normalizePreferenceRefs([{ entryId: "not-shown" }], publication())).toThrow(/no longer part/i);
  });

  test("enforces lifecycle transitions and content-free retention receipts", () => {
    expect(inquiry.transitionInquiry({ state: "received", assignment: {} }, "acknowledged", { actor: { uid: "sales-1", email: "sales@example.com" }, nowISO: "2026-09-13T19:00:00.000Z" })).toMatchObject({ state: "acknowledged", assignment: { uid: "sales-1" } });
    expect(() => inquiry.transitionInquiry({ state: "received" }, "converted", { nowISO: "2026-09-13T19:00:00.000Z" })).toThrow(/cannot move/i);
    const receipt = inquiry.contentFreeDeletionReceipt({ organizationId: "org-a", inquiryId: "inquiry-1", state: "dismissed", source: { publicationVersionId: "pub_000001" }, fields: { email: "private@example.com" } }, "2026-12-12T18:10:00.000Z");
    expect(receipt.contentRetained).toBe(false);
    expect(JSON.stringify(receipt)).not.toContain("private@example.com");
  });

  test("classifies current catalog drift without treating preferences as scope", () => {
    const source = publication();
    const preferences = source.entries.map((entry) => ({ ...entry }));
    const changed = { ...catalog, packages: [{ ...catalog.packages[0], offerVersion: "offer-v4" }], menuItems: [] };
    expect(inquiry.resolveReferenceDrift(preferences, { catalog: changed, settings }).map((item) => item.state)).toEqual(["changed", "missing"]);
    const prefill = inquiry.buildQuotePrefill({ fields: { name: "A", email: "a@example.com", eventType: "Dinner", eventDate: "2026-10-10", estimatedGuests: 20, location: "Chicago" }, preferences }, inquiry.resolveReferenceDrift(preferences, { catalog: changed, settings }));
    expect(prefill.pkg).toBeUndefined();
    expect(prefill.packageId).toBe("");
    const addonPublication = inquiry.buildPublication({ organizationId: "org-a", versionId: "pub_addon", draft: { ...draft, entries: [{ referenceType: "addon", referenceId: "coffee", publicTitle: "Coffee service" }] }, catalog, settings, actor: { uid: "admin-1" }, nowISO: "2026-09-13T18:00:00.000Z" });
    const changedAddonCatalog = { ...catalog, addons: [{ ...catalog.addons[0], price: 9 }] };
    expect(inquiry.resolveReferenceDrift(addonPublication.entries, { catalog: changedAddonCatalog, settings })[0].state).toBe("changed");
    expect(inquiry.resolveReferenceDrift(source.entries, { catalog, settings: { ...settings, catalogRevision: 18 } }).every((item) => item.state === "changed")).toBe(true);
  });
});
