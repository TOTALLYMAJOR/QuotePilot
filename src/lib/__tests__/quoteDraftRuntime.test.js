import { describe, expect, test } from "vitest";
import {
  hydrateSavedQuoteDraft,
  hydrateSavedQuoteDraftBase,
  normalizeAmbientEventLogisticsDraftIntent,
  normalizeAmbientQuoteDraftPatch,
  resolveQuoteDraftRevisionId
} from "../quoteDraftRuntime";

const previousForm = Object.freeze({
  style: "Buffet",
  pkg: "classic",
  taxRegion: "local",
  seasonProfileId: "standard",
  payMethod: "card",
  preservedField: "kept"
});

const quote = Object.freeze({
  id: "quote-alpha",
  quoteNumber: "Q-ALPHA",
  organizationId: "org-alpha",
  customerId: "customer-alpha",
  activeVersionId: "v0007",
  customer: Object.freeze({
    name: "Maya Bennett",
    email: "maya@example.test",
    phone: "555-0100",
    organization: "Bennett Foundation"
  }),
  event: Object.freeze({
    name: "Autumn Benefit Dinner",
    date: "2026-09-19",
    time: "18:00",
    hours: 6,
    venue: "The Foundry Hall",
    venueAddress: "100 Main St",
    style: "Plated",
    guests: 120,
    servers: 8,
    chefs: 3,
    bartenders: 2,
    dietaryRestrictions: "Nut free"
  }),
  selection: Object.freeze({
    packageId: "classic",
    addons: Object.freeze(["tea"]),
    addonQuantities: Object.freeze({ tea: 2 }),
    rentals: Object.freeze(["chairs"]),
    rentalQuantities: Object.freeze({ chairs: 120 }),
    menuItemDetails: Object.freeze([
      Object.freeze({ id: "salmon", quantity: 120 })
    ]),
    laborRateSnapshot: Object.freeze({
      bartenderRateApplied: 35,
      serverRateApplied: 25,
      chefRateApplied: 45,
      staffingRateTypeId: "standard"
    }),
    taxRegion: "city",
    seasonProfileId: "peak",
    milesRT: 18
  }),
  totals: Object.freeze({ total: 8_400 })
});

describe("quote draft runtime", () => {
  test("hydrates one immutable editor draft from the selected saved quote", () => {
    const result = hydrateSavedQuoteDraft({
      quote,
      previousForm,
      catalogPackages: [{ id: "classic", name: "Classic", ppp: 25 }]
    });

    expect(result).toMatchObject({
      ok: true,
      eventTypeId: "",
      stagedFields: [],
      sourceRevisionId: "v0007",
      form: {
        preservedField: "kept",
        eventName: "Autumn Benefit Dinner",
        guests: 120,
        servers: 8,
        chefs: 3,
        bartenders: 2,
        pkg: "classic",
        addons: ["tea"],
        addonQuantities: { tea: 2 },
        rentals: ["chairs"],
        rentalQuantities: { chairs: 120 },
        menuItems: ["salmon"],
        menuItemQuantities: { salmon: 120 },
        bartenderRateOverride: 35,
        serverRateOverride: 25,
        chefRateOverride: 45,
        taxRegion: "city",
        seasonProfileId: "peak"
      },
      editingQuote: {
        id: "quote-alpha",
        quoteNumber: "Q-ALPHA",
        activeVersionId: "v0007",
        organizationId: "org-alpha"
      }
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.form)).toBe(true);
  });

  test("applies only a same-revision bounded Ambient patch", () => {
    const draftPatch = {
      source: "ambient-staffing-recommendation-v1",
      baseRevisionId: "v0007",
      event: { guests: 150, servers: 13, chefs: 3, bartenders: 2 }
    };
    const result = hydrateSavedQuoteDraft({
      quote,
      previousForm,
      catalogPackages: [{ id: "classic", name: "Classic", ppp: 25 }],
      draftPatch,
      ambientEnabled: true
    });

    expect(result.ok).toBe(true);
    expect(result.form).toMatchObject({ guests: 150, servers: 13, chefs: 3, bartenders: 2 });
    expect(result.stagedFields).toEqual(["guests", "servers", "chefs", "bartenders"]);
  });

  test("accepts the Pricing intelligent object's same-revision guest scenario without granting save authority", () => {
    const result = hydrateSavedQuoteDraft({
      quote,
      previousForm,
      catalogPackages: [{ id: "classic", name: "Classic", ppp: 25 }],
      draftPatch: {
        source: "ambient-pricing-scenario-v1",
        baseRevisionId: "v0007",
        event: { guests: 150 }
      },
      ambientEnabled: true
    });

    expect(result).toMatchObject({
      ok: true,
      patchSource: "ambient-pricing-scenario-v1",
      stagedFields: ["guests"],
      form: { guests: 150 },
      sourceRevisionId: "v0007"
    });
    expect(result).not.toHaveProperty("savedQuote");
    expect(result).not.toHaveProperty("pricingAuthority");
  });

  test.each([
    [
      { source: "ambient-guest-scenario-v1", baseRevisionId: "v0006", event: { guests: 150 } },
      "ambient_patch_invalid"
    ],
    [
      { source: "ambient-guest-scenario-v1", baseRevisionId: "v0007", event: { guests: 401 } },
      "ambient_patch_out_of_bounds"
    ],
    [
      { source: "ambient-guest-scenario-v1", baseRevisionId: "v0007", event: { venue: "Elsewhere" } },
      "ambient_patch_invalid"
    ]
  ])("fails closed without mutating a stale, unbounded, or unsupported patch", (draftPatch, code) => {
    expect(normalizeAmbientQuoteDraftPatch({ quote, draftPatch, enabled: true }))
      .toMatchObject({ ok: false, code });
  });

  test("ignores Ambient patch input while the Ambient presentation gate is off", () => {
    const result = hydrateSavedQuoteDraft({
      quote,
      previousForm,
      catalogPackages: [{ id: "classic", name: "Classic", ppp: 25 }],
      draftPatch: {
        source: "ambient-guest-scenario-v1",
        baseRevisionId: "v0007",
        event: { guests: 150 }
      },
      ambientEnabled: false
    });

    expect(result.form.guests).toBe(120);
    expect(result.stagedFields).toEqual([]);
  });

  test("keeps the default-off base hydrator independent from Ambient patch input", () => {
    const result = hydrateSavedQuoteDraftBase({
      quote,
      previousForm,
      catalogPackages: [{ id: "classic", name: "Classic", ppp: 25 }],
      draftPatch: {
        source: "ambient-guest-scenario-v1",
        baseRevisionId: "v0007",
        event: { guests: 150 }
      }
    });

    expect(result).toMatchObject({
      ok: true,
      patchSource: "",
      stagedFields: [],
      form: { guests: 120 },
      sourceRevisionId: "v0007"
    });
  });

  test.each([
    ["date", "event-date", ["event.date"], "2026-09-19", "date"],
    ["time", "event-time", ["event.time"], "18:00", "time"],
    ["duration", "event-duration", ["event.hours"], 6, "hours"],
    [
      "venue",
      "event-venue",
      ["event.venue", "event.venueAddress"],
      { name: "The Foundry Hall", address: "100 Main St" },
      "venue"
    ]
  ])("validates and preserves the exact %s focus intent without mutating the hydrated draft", (
    kind,
    objectId,
    fieldPaths,
    savedValue,
    focusField
  ) => {
    const draftIntent = {
      schemaVersion: "ambient-event-logistics-draft-intent-v1",
      source: "ambient-event-logistics-v1",
      baseRevisionId: "v0007",
      objectId,
      kind,
      fieldPaths,
      savedValue,
      authority: "draft_only",
      commit: false,
      consequencePreviewRequired: true,
      requiresOutcomeNamedSave: true
    };
    const result = hydrateSavedQuoteDraft({
      quote,
      previousForm,
      catalogPackages: [{ id: "classic", name: "Classic", ppp: 25 }],
      draftIntent,
      ambientEnabled: true
    });

    expect(result).toMatchObject({
      ok: true,
      stagedFields: [],
      patchSource: "",
      ambientDraftIntent: { kind, focusField, fields: fieldPaths },
      sourceRevisionId: "v0007"
    });
    expect(result.form).toMatchObject({
      date: "2026-09-19",
      time: "18:00",
      hours: 6,
      venue: "The Foundry Hall",
      venueAddress: "100 Main St"
    });
  });

  test("fails closed on stale, altered, or ambiguous event-logistics handoffs", () => {
    const draftIntent = {
      schemaVersion: "ambient-event-logistics-draft-intent-v1",
      source: "ambient-event-logistics-v1",
      baseRevisionId: "v0007",
      objectId: "event-date",
      kind: "date",
      fieldPaths: ["event.date"],
      savedValue: "2026-09-20",
      authority: "draft_only",
      commit: false,
      consequencePreviewRequired: true,
      requiresOutcomeNamedSave: true
    };

    expect(normalizeAmbientEventLogisticsDraftIntent({
      quote,
      draftIntent,
      enabled: true
    })).toMatchObject({ ok: false, code: "ambient_logistics_intent_invalid" });
    expect(hydrateSavedQuoteDraft({
      quote,
      ambientEnabled: true,
      draftIntent: { ...draftIntent, savedValue: quote.event.date },
      draftPatch: {
        source: "ambient-guest-scenario-v1",
        baseRevisionId: "v0007",
        event: { guests: 150 }
      }
    })).toMatchObject({
      ok: false,
      code: "ambient_draft_handoff_ambiguous",
      consequence: expect.stringContaining("unchanged")
    });
  });

  test("ignores all Ambient handoff inputs when the Ambient runtime is disabled", () => {
    const result = hydrateSavedQuoteDraft({
      quote,
      previousForm,
      catalogPackages: [{ id: "classic", name: "Classic", ppp: 25 }],
      ambientEnabled: false,
      draftPatch: {
        source: "ambient-guest-scenario-v1",
        baseRevisionId: "v0007",
        event: { guests: 150 }
      },
      draftIntent: { untrusted: true }
    });

    expect(result).toMatchObject({
      ok: true,
      stagedFields: [],
      patchSource: "",
      ambientDraftIntent: null,
      form: { guests: 120 }
    });
  });

  test("rejects Ambient staging when the selected quote has no exact revision identity", () => {
    const unversionedQuote = {
      ...quote,
      activeVersionId: "",
      versionMeta: null,
      updatedAtISO: ""
    };

    expect(resolveQuoteDraftRevisionId(unversionedQuote)).toBe("");
    expect(normalizeAmbientQuoteDraftPatch({
      quote: unversionedQuote,
      enabled: true,
      draftPatch: {
        source: "ambient-guest-scenario-v1",
        baseRevisionId: "saved-record-revision-unavailable",
        event: { guests: 150 }
      }
    })).toMatchObject({
      ok: false,
      code: "ambient_patch_revision_unavailable",
      consequence: expect.stringContaining("unchanged"),
      nextResolution: expect.stringContaining("exact saved revision")
    });
  });

  test("returns a contextual recovery result when the quote identity is missing", () => {
    expect(hydrateSavedQuoteDraft({ quote: { event: { guests: 10 } } })).toMatchObject({
      ok: false,
      code: "quote_id_missing",
      consequence: expect.stringContaining("unchanged"),
      nextResolution: expect.any(String)
    });
    expect(resolveQuoteDraftRevisionId({ updatedAtISO: "2026-08-11T12:00:00.000Z" }))
      .toBe("2026-08-11T12:00:00.000Z");
  });
});
