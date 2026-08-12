import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createIntelligentObjectDescriptor } from "../ambientContracts";
import {
  AMBIENT_EVENT_LOGISTICS_EVIDENCE_SLOTS,
  AMBIENT_EVENT_LOGISTICS_INPUT_BOUNDS,
  AMBIENT_EVENT_LOGISTICS_OBJECT_KINDS,
  buildAmbientEventLogisticsObject,
  buildAmbientEventLogisticsObjects
} from "../ambientEventLogisticsObjects";

const QUOTE = Object.freeze({
  id: "quote-logistics",
  updatedAtISO: "2026-08-11T15:00:00.000Z",
  event: Object.freeze({
    date: "2026-09-19",
    time: "18:30",
    hours: 5,
    venue: "The Foundry Hall",
    venueAddress: "123 Exact Record Way, Austin, TX"
  })
});

function completeEvidence() {
  return {
    availability: {
      state: "available",
      claim: "The operator-recorded availability check reports no conflict for the exact saved scope.",
      sourceLabel: "Operator availability record",
      observedAt: "2026-08-11T14:55:00.000Z"
    },
    seasonalPricing: {
      state: "available",
      claim: "Pricing snapshot revision 12 records the applied seasonal profile.",
      sourceLabel: "Saved pricing snapshot",
      observedAt: "2026-08-11T14:56:00.000Z"
    },
    travel: {
      state: "available",
      claim: "The saved logistics record contains an operator-reviewed travel scope.",
      sourceLabel: "Operator travel record",
      observedAt: "2026-08-11T14:57:00.000Z"
    },
    quoteValidity: {
      state: "available",
      claim: "The selected quote version records its exact validity boundary.",
      sourceLabel: "Saved quote version",
      observedAt: "2026-08-11T14:58:00.000Z"
    },
    scheduling: {
      state: "available",
      claim: "The bounded schedule projection references the selected quote version.",
      sourceLabel: "Schedule projection",
      observedAt: "2026-08-11T14:59:00.000Z"
    }
  };
}

function containsFunction(value, seen = new WeakSet()) {
  if (typeof value === "function") return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((entry) => containsFunction(entry, seen));
}

describe("ambient event logistics intelligent objects", () => {
  test("returns four deeply frozen descriptor-compatible objects with exact saved values and five explicit evidence slots", () => {
    const result = buildAmbientEventLogisticsObjects(QUOTE, { role: "sales" });

    expect(Object.keys(result)).toEqual(AMBIENT_EVENT_LOGISTICS_OBJECT_KINDS);
    expect(result.date.savedValue).toMatchObject({
      state: "available",
      raw: "2026-09-19",
      displayValue: "2026-09-19"
    });
    expect(result.time.savedValue).toMatchObject({
      state: "available",
      raw: "18:30",
      displayValue: "18:30"
    });
    expect(result.duration.savedValue).toMatchObject({
      state: "available",
      raw: 5,
      displayValue: "5 hours"
    });
    expect(result.venue.savedValue).toMatchObject({
      state: "available",
      raw: {
        name: "The Foundry Hall",
        address: "123 Exact Record Way, Austin, TX"
      }
    });

    for (const [kind, object] of Object.entries(result)) {
      expect(object.id).toBe(`event-${kind}`);
      expect(Object.keys(object.evidenceSlots)).toEqual(
        AMBIENT_EVENT_LOGISTICS_EVIDENCE_SLOTS.map((slot) => slot.key)
      );
      expect(Object.values(object.evidenceSlots).map((slot) => slot.state))
        .toEqual(["missing", "missing", "missing", "missing", "missing"]);
      expect(object.dependencies).toHaveLength(5);
      expect(object.dependencies.every((dependency) => dependency.consequence.includes("Missing")))
        .toBe(true);
      expect(object.why).toContain("none of those outcomes is inferred without named evidence");
      expect(object.consequence).toContain("does not reserve capacity, reprice, schedule work, extend validity, or save a quote");
      expect(object.doNothing).toContain("no downstream outcome is assumed");
      expect(object.confidence).toMatchObject({ level: "low" });
      expect(object.confidence.basis).toContain("Availability: missing");
      expect(object.provenance).toHaveLength(6);
      expect(object.permissions).toMatchObject({
        view: true,
        simulate: false,
        stage: false,
        commit: false
      });
      expect(object.staging).toBeNull();
      expect(createIntelligentObjectDescriptor(object)).toMatchObject({
        id: object.id,
        label: object.label,
        permissions: object.permissions
      });
      expect(Object.isFrozen(object)).toBe(true);
      expect(Object.isFrozen(object.savedValue)).toBe(true);
      expect(Object.isFrozen(object.evidenceSlots)).toBe(true);
      expect(Object.isFrozen(object.dependencies[0].object)).toBe(true);
    }
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("preserves named available, stale, partial, unavailable, and missing evidence without upgrading a claim", () => {
    const evidence = {
      availability: completeEvidence().availability,
      seasonalPricing: {
        state: "partial",
        claim: "A seasonal profile name is present, but its authoritative revision is absent.",
        sourceLabel: "Saved quote projection",
        reason: "The pricing revision is missing."
      },
      travel: {
        state: "stale",
        claim: "The last operator travel review recorded 22 miles.",
        sourceLabel: "Operator travel record",
        observedAt: "2026-07-01T12:00:00.000Z",
        reason: "The venue changed after this observation."
      },
      quoteValidity: {
        state: "unavailable",
        reason: "The selected record exposes no validity evidence."
      }
    };
    const result = buildAmbientEventLogisticsObject("date", QUOTE, {
      role: "admin",
      evidence
    });

    expect(Object.fromEntries(Object.entries(result.evidenceSlots).map(([key, slot]) => [key, slot.state])))
      .toEqual({
        availability: "available",
        seasonalPricing: "partial",
        travel: "stale",
        quoteValidity: "unavailable",
        scheduling: "missing"
      });
    expect(result.evidenceSlots.travel).toMatchObject({
      claim: "The last operator travel review recorded 22 miles.",
      observedAt: "2026-07-01T12:00:00.000Z",
      reason: "The venue changed after this observation."
    });
    expect(result.evidenceSlots.scheduling.claim).toBeNull();
    expect(result.dependencies.map((dependency) => dependency.consequence)).toEqual([
      expect.stringContaining("Availability: Available."),
      expect.stringContaining("Seasonal pricing: Partial."),
      expect.stringContaining("Travel: Stale."),
      expect.stringContaining("Quote validity: Unavailable."),
      expect.stringContaining("Scheduling: Missing.")
    ]);
    expect(result.confidence.level).toBe("medium");
    expect(result.confidence.basis).toContain("Seasonal pricing: partial");
    expect(result.confidence.basis).toContain("Travel: stale");
    expect(result.confidence.basis).toContain("No availability, seasonal-price, travel, validity, or scheduling conclusion is inferred");
  });

  test("emits metadata-only direct manipulation for staff with ordinary edit authority and never grants commit authority", () => {
    for (const role of ["admin", "sales"]) {
      const result = buildAmbientEventLogisticsObjects(QUOTE, {
        role,
        ordinaryEditAllowed: true,
        evidence: completeEvidence()
      });

      for (const [kind, object] of Object.entries(result)) {
        expect(object.permissions).toMatchObject({
          view: true,
          simulate: false,
          stage: true,
          commit: false
        });
        expect(object.staging).toMatchObject({
          actionId: `stage-event-${kind}`,
          mode: "direct_manipulation",
          authority: "draft_only",
          commit: false,
          requiresOutcomeNamedSave: true,
          consequencePreviewRequired: true
        });
        expect(object.staging.target.fieldPaths.every((path) => path.startsWith("event."))).toBe(true);
        expect(object.staging.input).toEqual(AMBIENT_EVENT_LOGISTICS_INPUT_BOUNDS[kind]);
        expect(containsFunction(object.staging)).toBe(false);
      }
      expect(result.venue.staging.target.fieldPaths).toEqual(["event.venue", "event.venueAddress"]);
    }

    const viewOnly = buildAmbientEventLogisticsObjects(QUOTE, {
      role: "sales",
      ordinaryEditAllowed: false,
      evidence: completeEvidence()
    });
    expect(Object.values(viewOnly).every((object) => object.staging === null)).toBe(true);
    expect(Object.values(viewOnly).every((object) => object.permissions.stage === false)).toBe(true);
  });

  test("redacts internal evidence and denies view, staging, simulation, and commit metadata for non-staff roles", () => {
    const privateClaim = "INTERNAL-TRAVEL-COST-DO-NOT-EXPOSE";
    const evidence = completeEvidence();
    evidence.travel = {
      ...evidence.travel,
      claim: privateClaim
    };
    const result = buildAmbientEventLogisticsObjects(QUOTE, {
      role: "customer",
      ordinaryEditAllowed: true,
      evidence
    });

    for (const object of Object.values(result)) {
      expect(object.permissions).toMatchObject({
        view: false,
        simulate: false,
        stage: false,
        commit: false
      });
      expect(object.staging).toBeNull();
      expect(object.roleBoundary).toEqual({
        role: "non_staff",
        staffRole: false,
        ordinaryEditAllowed: false
      });
      expect(Object.values(object.evidenceSlots).every((slot) => (
        slot.state === "unavailable"
        && slot.claim === null
        && slot.reason.includes("Staff role is required")
      ))).toBe(true);
      expect(JSON.stringify(object)).not.toContain(privateClaim);
    }
  });

  test("fails closed when the caller omits its role", () => {
    const privateClaim = "INTERNAL-AVAILABILITY-EVIDENCE";
    const result = buildAmbientEventLogisticsObject("date", QUOTE, {
      ordinaryEditAllowed: true,
      evidence: {
        availability: {
          ...completeEvidence().availability,
          claim: privateClaim
        }
      }
    });

    expect(result.permissions).toMatchObject({
      view: false,
      simulate: false,
      stage: false,
      commit: false
    });
    expect(result.roleBoundary).toEqual({
      role: "non_staff",
      staffRole: false,
      ordinaryEditAllowed: false
    });
    expect(result.evidenceSlots.availability).toMatchObject({
      state: "unavailable",
      claim: null
    });
    expect(JSON.stringify(result)).not.toContain(privateClaim);
  });

  test("fails closed on malformed or oversized saved values and evidence without clamping or truncation", () => {
    const oversizedVenue = "V".repeat(161);
    const oversizedClaim = "C".repeat(401);
    const quote = {
      id: "quote-malformed",
      event: {
        date: "2026-02-31",
        time: "25:90",
        hours: 13,
        venue: oversizedVenue,
        venueAddress: "A".repeat(241)
      }
    };
    const inputSnapshot = structuredClone(quote);
    const result = buildAmbientEventLogisticsObjects(quote, {
      role: "admin",
      ordinaryEditAllowed: true,
      evidence: {
        availability: {
          state: "available",
          claim: oversizedClaim,
          sourceLabel: "Operator record"
        }
      }
    });

    expect(result.date.savedValue).toMatchObject({ state: "partial", raw: "2026-02-31" });
    expect(result.time.savedValue).toMatchObject({ state: "partial", raw: "25:90" });
    expect(result.duration.savedValue).toMatchObject({ state: "partial", raw: 13 });
    expect(result.duration.savedValue.reason).toContain("No clamped or inferred duration is presented");
    expect(result.venue.savedValue).toMatchObject({ state: "partial", raw: null });
    expect(result.venue.savedValue.reason).toContain("No truncated value is presented");
    for (const object of Object.values(result)) {
      expect(object.permissions.stage).toBe(false);
      expect(object.permissions.reason).toContain("Draft staging requires an exact available saved");
      expect(object.staging).toBeNull();
      expect(object.actionIds).not.toContain(`stage-${object.id}`);
      expect(object.evidenceSlots.availability).toMatchObject({
        state: "partial",
        claim: null
      });
      expect(object.evidenceSlots.availability.reason).toContain("No truncated claim is presented");
      expect(JSON.stringify(object)).not.toContain(oversizedClaim);
    }
    expect(quote).toEqual(inputSnapshot);
    expect(() => buildAmbientEventLogisticsObject("weather", quote)).toThrow(/Unsupported/);
  });

  test("withholds staging metadata when an otherwise authorized staff record has missing saved values", () => {
    const result = buildAmbientEventLogisticsObjects({ id: "quote-missing", event: {} }, {
      role: "sales",
      ordinaryEditAllowed: true,
      evidence: completeEvidence()
    });

    for (const object of Object.values(result)) {
      expect(object.savedValue.state).toBe("missing");
      expect(object.permissions).toMatchObject({
        view: true,
        simulate: false,
        stage: false,
        commit: false
      });
      expect(object.permissions.reason).toContain("Draft staging requires an exact available saved");
      expect(object.permissions.reason).toContain("The saved value is missing");
      expect(object.staging).toBeNull();
      expect(object.actionIds).toEqual([`inspect-${object.id}`]);
    }
  });

  test("keeps the kernel free of network, Firebase, storage, and mutation callbacks", () => {
    const source = readFileSync(fileURLToPath(new URL("../ambientEventLogisticsObjects.js", import.meta.url)), "utf8");
    const imports = source.match(/^import .*;$/gmu) || [];

    expect(imports).toEqual([
      'import { createIntelligentObjectDescriptor } from "./ambientContracts";',
      'import { MAX_EVENT_HOURS, MIN_EVENT_HOURS } from "./wizardUi";'
    ]);
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|firebase|firestore|localStorage|sessionStorage)\b/u);
    expect(source).not.toMatch(/\b(?:setDoc|updateDoc|addDoc|deleteDoc|httpsCallable)\b/u);
    const result = buildAmbientEventLogisticsObjects(QUOTE, {
      role: "admin",
      ordinaryEditAllowed: true,
      evidence: completeEvidence()
    });
    expect(containsFunction(result)).toBe(false);
  });
});
