import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { createIntelligentObjectDescriptor } from "../ambientContracts";
import { buildAmbientProposalObject } from "../ambientProposalObject";

const NOW = "2026-08-12T12:00:00.000Z";

function completeQuote(overrides = {}) {
  const base = {
    id: "quote-proposal-proof",
    organizationId: "org-proposal-proof",
    quoteNumber: "Q-260812-1042",
    activeVersionId: "v0004",
    latestVersionNumber: 4,
    status: "draft",
    createdAtISO: "2026-08-12T10:30:00.000Z",
    updatedAtISO: "2026-08-12T10:42:00.000Z",
    portalKey: "proposal-portal-key-000000000004",
    portalIssuedAtISO: "2026-08-12T10:42:00.000Z",
    portalExpiresAtISO: "2026-09-11T10:42:00.000Z",
    customer: {
      name: "Maya Thompson",
      email: "maya@example.test",
      phone: "205-555-0142"
    },
    event: {
      name: "Thompson Wedding",
      date: "2026-10-03",
      time: "17:30",
      venue: "Juniper Hall",
      guests: 120,
      hours: 6
    },
    selection: {
      packageId: "plated-dinner",
      packageName: "Plated Dinner",
      menuItems: ["salmon"],
      menuItemNames: ["Cedar Salmon"]
    },
    totals: {
      subtotal: 9000,
      tax: 750,
      total: 9750,
      deposit: 2925
    },
    pricing: {
      authority: "server_authoritative",
      calculatedAt: "2026-08-12T10:41:30.000Z",
      grandTotal: 9750,
      deposit: { amount: 2925 }
    },
    quoteMeta: {
      organizationName: "Juniper & Pine Events",
      brandName: "Juniper & Pine"
    },
    workflow: { quoteDelivery: {} }
  };
  return { ...base, ...overrides };
}

function model(quote = completeQuote(), options = {}) {
  return buildAmbientProposalObject(quote, {
    sourceMode: "firebase",
    role: "admin",
    nowISO: NOW,
    ...options
  });
}

describe("Ambient Proposal intelligent object", () => {
  test("exposes exact completeness, customer projection, dependencies, judgment, and descriptive actions", () => {
    const result = model();
    expect(result.state).toBe("current");
    expect(result.readiness).toMatchObject({ score: 100, complete: true, gaps: [] });
    expect(result.customerProjection).toMatchObject({
      state: "available",
      exactCurrent: true,
      fields: {
        quoteNumber: "Q-260812-1042",
        customerName: "Maya Thompson",
        eventName: "Thompson Wedding",
        total: 9750
      }
    });
    expect(result.descriptor.dependencies).toHaveLength(4);
    expect(result.descriptor.why).toMatch(/stay separate/iu);
    expect(result.descriptor.consequence).toMatch(/existing controls/iu);
    expect(result.descriptor.doNothing).toMatch(/remain unchanged/iu);
    expect(result.descriptor.confidence.level).toBe("high");
    expect(result.actions.map((entry) => entry.id)).toEqual([
      "prepare-proposal",
      "send-proposal",
      "rotate-proposal-portal",
      "recover-proposal-delivery"
    ]);
    expect(result.actionById["prepare-proposal"].availability).toBe("available");
    expect(result.actionById["send-proposal"].availability).toBe("governed_resolution");
    expect(result.actionById["send-proposal"].reason).toMatch(/subject to live provider configuration, approval, revision, and idempotency checks/iu);
    expect(createIntelligentObjectDescriptor(result.descriptor)).toEqual(result.descriptor);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.actions)).toBe(true);
  });

  test("surfaces completeness gaps and blocks preparation without changing the quote", () => {
    const input = completeQuote({
      customer: { name: "Maya Thompson", email: "not-an-email", phone: "" },
      event: { name: "", date: "", time: "", venue: "", guests: 0, hours: 0 },
      selection: { packageId: "", menuItems: [] },
      totals: { total: 0, deposit: 0 },
      pricing: { authority: "client_preview", grandTotal: 0 }
    });
    const before = JSON.stringify(input);
    const result = model(input);
    expect(result.readiness.complete).toBe(false);
    expect(result.readiness.gaps.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "customer-email",
      "event-date",
      "venue",
      "package",
      "menu",
      "total"
    ]));
    expect(result.customerProjection.state).toBe("partial");
    expect(result.pricingEvidence.state).toBe("requires_authoritative_reprice");
    expect(result.actionById["prepare-proposal"].availability).toBe("blocked");
    expect(JSON.stringify(input)).toBe(before);
  });

  test("keeps provider acceptance separate from delivery, viewing, acceptance, payment, and booking", () => {
    const quote = completeQuote();
    const revisionId = `${quote.activeVersionId}@${quote.portalIssuedAtISO}`;
    const result = model({
      ...quote,
      status: "sent",
      workflow: {
        quoteDelivery: {
          state: "provider_accepted",
          revisionId,
          portalActivationState: "active",
          providerMessageId: "provider-message-42",
          providerAcceptedAtISO: "2026-08-12T11:00:00.000Z",
          portalKey: quote.portalKey,
          portalIssuedAtISO: quote.portalIssuedAtISO
        }
      }
    });
    expect(result.deliveryEvidence).toMatchObject({
      state: "provider_accepted",
      providerMessagePresent: true,
      providerAcceptedAtISO: "2026-08-12T11:00:00.000Z"
    });
    expect(result.deliveryEvidence.boundary).toMatch(/not delivered, viewed, replied, accepted, paid, or booked/iu);
    expect(result.actionById["send-proposal"].availability).toBe("not_needed");
    expect(JSON.stringify(result)).not.toContain("provider-message-42");
  });

  test("fails visibly on stale revision and malformed provider-accepted evidence", () => {
    const stale = model({
      ...completeQuote(),
      workflow: {
        quoteDelivery: {
          state: "provider_accepted",
          revisionId: "v0003@2026-08-01T10:00:00.000Z",
          portalActivationState: "active",
          providerMessageId: "provider-message-old",
          providerAcceptedAtISO: "2026-08-01T10:05:00.000Z"
        }
      }
    });
    expect(stale.state).toBe("stale");
    expect(stale.portalEvidence.state).toBe("stale_revision");
    expect(stale.deliveryEvidence.state).toBe("stale_revision");
    expect(stale.actionById["send-proposal"].availability).toBe("blocked");

    const malformedQuote = completeQuote();
    const malformed = model({
      ...malformedQuote,
      workflow: {
        quoteDelivery: {
          state: "provider_accepted",
          revisionId: `${malformedQuote.activeVersionId}@${malformedQuote.portalIssuedAtISO}`,
          portalActivationState: "active"
        }
      }
    });
    expect(malformed.state).toBe("unavailable");
    expect(malformed.deliveryEvidence.state).toBe("malformed");
    expect(malformed.deliveryEvidence.providerMessagePresent).toBe(false);
  });

  test("shows expired and rotation-required portal states as governed recovery, not automatic authority", () => {
    const expired = model({
      ...completeQuote(),
      portalExpiresAtISO: "2026-08-11T10:42:00.000Z"
    });
    expect(expired.portalEvidence.state).toBe("expired");
    expect(expired.actionById["rotate-proposal-portal"]).toMatchObject({
      availability: "governed_resolution",
      authority: "admin_trusted"
    });
    expect(expired.actionById["send-proposal"].availability).toBe("blocked");

    const quote = completeQuote();
    const rotation = model({
      ...quote,
      workflow: {
        quoteDelivery: {
          state: "provider_accepted",
          revisionId: `${quote.activeVersionId}@${quote.portalIssuedAtISO}`,
          portalActivationState: "requires_rotation",
          providerMessageId: "provider-message-inactive",
          providerAcceptedAtISO: "2026-08-12T11:00:00.000Z",
          portalKey: quote.portalKey,
          portalIssuedAtISO: quote.portalIssuedAtISO
        }
      }
    });
    expect(rotation.portalEvidence.state).toBe("requires_rotation");
    expect(rotation.actionById["rotate-proposal-portal"].availability).toBe("governed_resolution");
    expect(rotation.deliveryEvidence).toMatchObject({
      state: "provider_accepted_portal_inactive",
      providerMessagePresent: true,
      providerAcceptedAtISO: "2026-08-12T11:00:00.000Z"
    });
  });

  test("treats hydration-only portal dates without a token as absent, never as issuance", () => {
    const quote = completeQuote({
      portalKey: "",
      portalIssuedAtISO: "2026-08-12T10:42:00.000Z",
      portalExpiresAtISO: "2026-09-11T10:42:00.000Z"
    });
    const result = buildAmbientProposalObject(quote, {
      sourceMode: "local",
      role: "admin",
      nowISO: NOW
    });
    expect(result.state).toBe("local_preview");
    expect(result.portalEvidence).toMatchObject({
      state: "absent",
      keyPresent: false,
      current: false
    });
    expect(result.portalEvidence.reason).toContain("Dates alone do not establish an issuance");
    expect(result.actionById["send-proposal"].availability).toBe("blocked");
  });

  test("labels local projection and delivery-shaped records as unverified", () => {
    const quote = completeQuote();
    const result = buildAmbientProposalObject({
      ...quote,
      workflow: {
        quoteDelivery: {
          state: "provider_accepted",
          revisionId: `${quote.activeVersionId}@${quote.portalIssuedAtISO}`,
          portalActivationState: "active",
          providerMessageId: "local-provider-shaped-value",
          providerAcceptedAtISO: "2026-08-12T11:00:00.000Z",
          portalKey: quote.portalKey,
          portalIssuedAtISO: quote.portalIssuedAtISO
        }
      }
    }, { sourceMode: "local", role: "sales", nowISO: NOW });
    expect(result.state).toBe("local_preview");
    expect(result.savedEvidence.state).toBe("local_unverified");
    expect(result.customerProjection.state).toBe("local_preview");
    expect(result.deliveryEvidence.state).toBe("local_unverified");
    expect(result.descriptor.confidence.level).toBe("low");
    expect(result.actionById["prepare-proposal"].availability).toBe("blocked");
  });

  test("requires admin authority for send, rotation, and provider recovery", () => {
    const quote = completeQuote();
    const sales = model({
      ...quote,
      workflow: {
        quoteDelivery: {
          state: "outcome_unknown",
          revisionId: `${quote.activeVersionId}@${quote.portalIssuedAtISO}`
        }
      }
    }, { role: "sales" });
    expect(sales.actionById["prepare-proposal"].availability).toBe("available");
    expect(sales.actionById["send-proposal"].reason).toMatch(/Admin authority/iu);
    expect(sales.actionById["recover-proposal-delivery"].availability).toBe("blocked");
  });

  test("fails visibly when quote identity or source freshness is malformed", () => {
    const malformed = model({ customer: {}, event: {}, selection: {}, totals: {} });
    expect(malformed.state).toBe("unavailable");
    expect(malformed.savedEvidence.state).toBe("malformed");
    expect(malformed.customerProjection.state).toBe("unavailable");
    expect(malformed.descriptor.confidence.level).toBe("unavailable");

    const stale = model(completeQuote(), { sourceFreshness: "stale" });
    expect(stale.state).toBe("stale");
    expect(stale.customerProjection.state).toBe("stale");
    expect(stale.actionById["prepare-proposal"].availability).toBe("blocked");

    const invalidShape = model(completeQuote({
      customer: { name: { unsafe: true }, email: "maya@example.test", phone: "205-555-0142" },
      event: { ...completeQuote().event, date: "2026-02-31" }
    }));
    expect(invalidShape.state).toBe("unavailable");
    expect(invalidShape.savedEvidence.malformedFields).toContain("customer name");
    expect(invalidShape.customerProjection.state).toBe("unavailable");
  });

  test("remains a pure descriptive adapter over existing proposal helpers", () => {
    const source = readFileSync(new URL("../ambientProposalObject.js", import.meta.url), "utf8");
    expect(source).toContain('import { buildStaffProposalPreview } from "./customerWorkspace";');
    expect(source).toContain('import { buildProposalReadiness } from "./quoteWorkflow";');
    expect(source).not.toMatch(/from\s+["']\.\/quoteStore["']/u);
    expect(source).not.toMatch(/from\s+["']\.\/firebase["']/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/httpsCallable|writeBatch|setDoc|updateDoc/u);
  });
});
