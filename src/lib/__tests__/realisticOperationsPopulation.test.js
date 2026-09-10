import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOperationsPopulationArgs } from "../../../scripts/populate-ragnakok-operations.mjs";
import {
  OPERATIONS_POPULATION_VERSION,
  REALISTIC_ADDONS,
  REALISTIC_EVENTS,
  REALISTIC_OFFERS,
  REALISTIC_RENTALS,
  REALISTIC_STAFF,
  STAFF_ASSET_DIRECTORY,
  operationsPopulationSummary
} from "../../../scripts/realistic-ragnakok-operations-data.mjs";

describe("realistic organization and operations population fixture", () => {
  it("is dry-run-first and restricts writes to the exact targets and typed confirmation", () => {
    expect(parseOperationsPopulationArgs([
      "--project", "tonicatering", "--organization", "mm05366-sandbox"
    ])).toMatchObject({ apply: false, projectId: "tonicatering", organizationId: "mm05366-sandbox" });
    expect(() => parseOperationsPopulationArgs([
      "--project", "another-project", "--organization", "mm05366-sandbox"
    ])).toThrow(/Project must be one of/u);
    expect(() => parseOperationsPopulationArgs([
      "--project", "tonicatering", "--organization", "another-org"
    ])).toThrow(/restricted to organization mm05366-sandbox/u);
    expect(() => parseOperationsPopulationArgs([
      "--project", "tonicatering", "--organization", "mm05366-sandbox", "--apply"
    ])).toThrow(/Apply requires --confirm/u);
    expect(parseOperationsPopulationArgs([
      "--project", "quotepilot-staging-20260804",
      "--organization", "mm05366-sandbox",
      "--apply",
      "--confirm", `POPULATE OPERATIONS quotepilot-staging-20260804 mm05366-sandbox ${OPERATIONS_POPULATION_VERSION}`
    ])).toMatchObject({ apply: true, projectId: "quotepilot-staging-20260804" });
  });

  it("forms one coherent three-layer operating twin", () => {
    expect(operationsPopulationSummary()).toMatchObject({
      staff: 20,
      offers: 8,
      addons: 8,
      rentals: 5,
      events: 10,
      bookedEvents: 6,
      acceptedEvents: 2,
      draftEvents: 2,
      workflowKinds: 4
    });
    expect(new Set(REALISTIC_STAFF.map(({ id }) => id)).size).toBe(REALISTIC_STAFF.length);
    expect(new Set(REALISTIC_OFFERS.map(({ id }) => id)).size).toBe(REALISTIC_OFFERS.length);
    expect(new Set(REALISTIC_EVENTS.map(({ id }) => id)).size).toBe(REALISTIC_EVENTS.length);
    expect(REALISTIC_ADDONS.every(({ cost, price }) => cost > 0 && price > cost)).toBe(true);
    expect(REALISTIC_RENTALS.every(({ cost, price }) => cost > 0 && price > cost)).toBe(true);
    expect(REALISTIC_OFFERS.every(({ costPpp, ppp, choiceNames }) => (
      costPpp > 0 && ppp > costPpp && choiceNames.length >= 1
    ))).toBe(true);
    expect(REALISTIC_EVENTS.filter(({ status }) => status !== "draft").every(({ staffing }) => (
      staffing.lead >= 1 && staffing.server >= 1 && staffing.chef >= 1 && staffing.bartender >= 1
    ))).toBe(true);
  });

  it("ships a unique generated portrait asset for every synthetic staff profile", () => {
    const directory = fileURLToPath(STAFF_ASSET_DIRECTORY);
    expect(new Set(REALISTIC_STAFF.map(({ portrait }) => portrait)).size).toBe(REALISTIC_STAFF.length);
    REALISTIC_STAFF.forEach(({ portrait }) => {
      expect(portrait).toMatch(/^[a-z0-9-]+\.png$/u);
      expect(existsSync(`${directory}${portrait}`)).toBe(true);
    });
  });
});
