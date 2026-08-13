import { webcrypto } from "node:crypto";
import { describe, expect, test } from "vitest";
import { generatePilotBoundedScenarios } from "../pilotBoundedScenarios";
import {
  PILOT_SCENARIO_DRAFT_PATCH_FIELDS,
  PILOT_SCENARIO_DRAFT_REVIEW_MODEL,
  applyPilotScenarioDraftReview,
  createPilotScenarioDraftReview
} from "../pilotScenarioDraftReview";

const ORGANIZATION_ID = "scenario-review-org";
const OBSERVED_AT = "2026-08-12T16:00:00.000Z";

function settings(overrides = {}) {
  return {
    depositPct: 0.3,
    serviceFeePct: 0,
    serviceFeeTiers: [],
    taxRate: 0,
    taxRegions: [],
    seasonalProfiles: [],
    staffingLaborEnabled: false,
    staffingChargeMode: "per_hour",
    serverRate: 0,
    chefRate: 0,
    bartenderRate: 0,
    perMileRate: 0,
    longDistancePerMileRate: 0,
    deliveryThresholdMiles: 0,
    ...overrides
  };
}

function catalogEvidence(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    sourceLabel: "firebase-org",
    catalogRevision: 17,
    freshness: { state: "fresh", observedAtISO: OBSERVED_AT },
    packages: [
      { id: "core", name: "Core package", ppp: 50, costPpp: 30, active: true },
      { id: "lean", name: "Lean package", ppp: 40, costPpp: 20, active: true }
    ],
    addons: [{
      id: "champagne",
      name: "Champagne service",
      price: 1_000,
      cost: 900,
      pricingType: "per_event",
      active: true
    }],
    rentals: [{
      id: "linen",
      name: "Linen",
      price: 10,
      cost: 8,
      pricingType: "per_item",
      active: true
    }],
    menuSections: [{
      id: "desserts",
      name: "Desserts",
      items: [{
        id: "dessert",
        name: "Dessert course",
        price: 8,
        cost: 7,
        pricingType: "per_person",
        active: true
      }]
    }],
    upsellRules: [],
    ...overrides
  };
}

function form(overrides = {}) {
  return {
    pkg: "core",
    eventTemplateId: "wedding-template",
    guests: 100,
    hours: 4,
    style: "Plated",
    servers: 0,
    chefs: 0,
    bartenders: 0,
    milesRT: 0,
    addons: ["champagne"],
    rentals: [],
    menuItems: ["dessert"],
    addonQuantities: {},
    rentalQuantities: {},
    menuItemQuantities: {},
    customerName: "Private customer sentinel",
    notes: "Private draft note sentinel",
    ...overrides
  };
}

function proposal() {
  const result = generatePilotBoundedScenarios({
    intent: { kind: "under_budget", budget: 5_900 },
    organizationId: ORGANIZATION_ID,
    form: form(),
    catalogEvidence: catalogEvidence(),
    settings: settings(),
    lockedScope: ["addons", "rentals", "menu", "staffing"],
    clock: () => 0
  });
  expect(result.state).toBe("available");
  return result.proposals[0];
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

async function create(overrides = {}) {
  return createPilotScenarioDraftReview({
    proposal: proposal(),
    organizationId: ORGANIZATION_ID,
    catalogEvidence: catalogEvidence(),
    form: form(),
    cryptoApi: webcrypto,
    ...overrides
  });
}

describe("Pilot scenario draft review", () => {
  test("binds a real generated proposal, exact catalog evidence, and every changed source field", async () => {
    const currentProposal = proposal();
    const currentCatalog = catalogEvidence();
    const currentForm = form();
    const proposalBefore = structuredClone(currentProposal);
    const catalogBefore = structuredClone(currentCatalog);
    const formBefore = structuredClone(currentForm);

    const result = await createPilotScenarioDraftReview({
      proposal: currentProposal,
      organizationId: ORGANIZATION_ID,
      catalogEvidence: currentCatalog,
      form: currentForm,
      cryptoApi: webcrypto
    });

    expect(result.ok).toBe(true);
    expect(result.review).toMatchObject({
      modelId: PILOT_SCENARIO_DRAFT_REVIEW_MODEL,
      kind: "pilot_scenario_draft_review",
      state: "pending_review",
      commandClass: "simulation",
      authorityLevel: "draft",
      organizationScope: { organizationId: ORGANIZATION_ID },
      catalogScope: {
        sourceLabel: "firebase-org",
        catalogRevision: 17,
        observedAt: OBSERVED_AT,
        freshness: "fresh",
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
      },
      proposalIdentity: {
        proposalId: currentProposal.id,
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
      },
      sourceSnapshot: {
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
      },
      adoption: {
        required: true,
        allowedAfterExplicitConfirmation: true,
        applyLabel: "Apply scenario to draft",
        keepLabel: "Keep current draft"
      }
    });
    expect(result.review.changedFields).toEqual(Object.keys(currentProposal.patch).sort());
    expect(result.review.sourceSnapshot.fields.map((entry) => entry.field))
      .toEqual(result.review.changedFields);
    expect(result.review.changes.map((entry) => entry.field))
      .toEqual(result.review.changedFields);
    expect(Object.isFrozen(result.review)).toBe(true);
    expect(Object.isFrozen(result.review.sourceSnapshot.fields[0])).toBe(true);
    expect(currentProposal).toEqual(proposalBefore);
    expect(currentCatalog).toEqual(catalogBefore);
    expect(currentForm).toEqual(formBefore);
  });

  test("applies only the reviewed allowlisted patch to a new draft and never mutates an input", async () => {
    const currentProposal = proposal();
    const currentCatalog = catalogEvidence();
    const currentForm = form();
    const created = await create({ proposal: currentProposal });
    const inputsBefore = {
      review: structuredClone(created.review),
      proposal: structuredClone(currentProposal),
      catalog: structuredClone(currentCatalog),
      form: structuredClone(currentForm)
    };

    const applied = await applyPilotScenarioDraftReview({
      review: created.review,
      currentProposal,
      organizationId: ORGANIZATION_ID,
      catalogEvidence: currentCatalog,
      form: currentForm,
      confirmed: true,
      cryptoApi: webcrypto
    });

    expect(applied.ok).toBe(true);
    expect(applied.form).not.toBe(currentForm);
    expect(applied.dirtyFields).toEqual(created.review.changedFields);
    expect(applied.dirtyFields.every((field) => PILOT_SCENARIO_DRAFT_PATCH_FIELDS.includes(field)))
      .toBe(true);
    for (const [field, value] of Object.entries(currentForm)) {
      expect(applied.form[field]).toEqual(
        Object.prototype.hasOwnProperty.call(currentProposal.patch, field)
          ? currentProposal.patch[field]
          : value
      );
    }
    expect(applied.acknowledgement).toMatchObject({
      kind: "preview",
      state: "draft_updated",
      saveRequired: true,
      authoritativeRepriceRequired: true
    });
    expect(currentForm).toEqual(inputsBefore.form);
    expect(currentCatalog).toEqual(inputsBefore.catalog);
    expect(currentProposal).toEqual(inputsBefore.proposal);
    expect(created.review).toEqual(inputsBefore.review);
    expect(Object.isFrozen(applied.form)).toBe(true);
  });

  test("rejects a mutable proposal and every non-allowlisted or incomplete patch", async () => {
    const mutable = structuredClone(proposal());
    const mutableResult = await create({ proposal: mutable });
    expect(mutableResult).toMatchObject({
      ok: false,
      acknowledgement: { code: "pilot_scenario_review_proposal_invalid" }
    });
    expect(mutableResult.acknowledgement.reason).toContain("deeply frozen");

    const unsafe = structuredClone(proposal());
    unsafe.patch.customerEmail = "not-allowed@example.test";
    unsafe.changedFields = Object.keys(unsafe.patch).sort();
    freeze(unsafe);
    const unsafeResult = await create({ proposal: unsafe });
    expect(unsafeResult.ok).toBe(false);
    expect(unsafeResult.acknowledgement.reason).toContain("non-draft field");

    const incomplete = structuredClone(proposal());
    incomplete.patch = { addons: [] };
    incomplete.changedFields = ["addons"];
    incomplete.compromises = [{
      dimension: "addons",
      label: "Champagne service",
      before: "Selected add-on",
      after: "Removed from scenario",
      why: "The item is an active named record in the current tenant catalog."
    }];
    freeze(incomplete);
    const incompleteResult = await create({ proposal: incomplete });
    expect(incompleteResult.ok).toBe(false);
    expect(incompleteResult.acknowledgement.reason).toContain("complete draft field group");
  });

  test("fails closed for stale, organization-drifted, revision-drifted, and content-drifted evidence", async () => {
    const currentProposal = proposal();
    const staleResult = await create({
      proposal: currentProposal,
      catalogEvidence: catalogEvidence({
        freshness: { state: "stale", observedAtISO: OBSERVED_AT }
      })
    });
    expect(staleResult.ok).toBe(false);
    expect(staleResult.acknowledgement.code).toBe("pilot_scenario_review_catalog_unavailable");

    const created = await create({ proposal: currentProposal });
    const organizationDrift = await applyPilotScenarioDraftReview({
      review: created.review,
      currentProposal,
      organizationId: "another-org",
      catalogEvidence: catalogEvidence({ organizationId: "another-org" }),
      form: form(),
      confirmed: true,
      cryptoApi: webcrypto
    });
    expect(organizationDrift.acknowledgement.code).toBe("pilot_scenario_apply_organization_drift");

    const revisionDrift = await applyPilotScenarioDraftReview({
      review: created.review,
      currentProposal,
      organizationId: ORGANIZATION_ID,
      catalogEvidence: catalogEvidence({ catalogRevision: 18 }),
      form: form(),
      confirmed: true,
      cryptoApi: webcrypto
    });
    expect(revisionDrift.acknowledgement.code).toBe("pilot_scenario_apply_catalog_drift");

    const changedCatalog = catalogEvidence();
    changedCatalog.packages[0].name = "Core package updated without revision";
    const contentDrift = await applyPilotScenarioDraftReview({
      review: created.review,
      currentProposal,
      organizationId: ORGANIZATION_ID,
      catalogEvidence: changedCatalog,
      form: form(),
      confirmed: true,
      cryptoApi: webcrypto
    });
    expect(contentDrift.acknowledgement.code).toBe("pilot_scenario_apply_catalog_drift");
    expect(contentDrift.form).toEqual(form());
  });

  test("rejects proposal identity drift and drift in any source field captured by the review", async () => {
    const currentProposal = proposal();
    const created = await create({ proposal: currentProposal });
    const changedProposal = structuredClone(currentProposal);
    changedProposal.summary = `${changedProposal.summary} Changed after review.`;
    freeze(changedProposal);

    const proposalDrift = await applyPilotScenarioDraftReview({
      review: created.review,
      currentProposal: changedProposal,
      organizationId: ORGANIZATION_ID,
      catalogEvidence: catalogEvidence(),
      form: form(),
      confirmed: true,
      cryptoApi: webcrypto
    });
    expect(proposalDrift.acknowledgement.code).toBe("pilot_scenario_apply_proposal_drift");

    for (const field of created.review.changedFields) {
      const changedForm = form();
      changedForm[field] = field === "pkg" ? "lean" : "custom";
      const sourceDrift = await applyPilotScenarioDraftReview({
        review: created.review,
        currentProposal,
        organizationId: ORGANIZATION_ID,
        catalogEvidence: catalogEvidence(),
        form: changedForm,
        confirmed: true,
        cryptoApi: webcrypto
      });
      expect(sourceDrift.acknowledgement.code, field)
        .toBe("pilot_scenario_apply_source_drift");
      expect(sourceDrift.form).toEqual(changedForm);
    }
  });

  test("requires an explicit adoption confirmation and leaves the draft unchanged", async () => {
    const currentProposal = proposal();
    const currentForm = form();
    const created = await create({ proposal: currentProposal });
    const result = await applyPilotScenarioDraftReview({
      review: created.review,
      currentProposal,
      organizationId: ORGANIZATION_ID,
      catalogEvidence: catalogEvidence(),
      form: currentForm,
      confirmed: false,
      cryptoApi: webcrypto
    });

    expect(result).toMatchObject({
      ok: false,
      form: currentForm,
      dirtyFields: [],
      acknowledgement: {
        code: "pilot_scenario_apply_confirmation_required",
        state: "not_applied"
      }
    });
    expect(currentForm).toEqual(form());
  });
});
