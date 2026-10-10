// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { StepEvent } from "../WizardSteps";

const FORM = Object.freeze({
  eventTypeId: "wedding",
  eventTemplateId: "custom",
  date: "2026-09-19",
  time: "18:00",
  hours: 6,
  guests: 120,
  servers: 8,
  chefs: 3,
  bartenders: 2,
  eventName: "Autumn Benefit Dinner",
  venue: "The Foundry Hall",
  venueAddress: "100 Main St",
  dietaryRestrictions: "",
  name: "Maya Bennett",
  phone: "555-0100",
  email: "maya@example.test",
  clientOrg: "Bennett Foundation",
  style: "Plated",
  taxRegion: "city",
  seasonProfileId: "standard",
  includeDisposables: true,
  serverRateOverride: "",
  serverRateMixCsv: "",
  chefRateOverride: "",
  chefRateMixCsv: "",
  bartenderRateOverride: ""
});

describe("Ambient event-logistics editor focus targets", () => {
  test("marks each exact event control without changing its ordinary form semantics", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <StepEvent
        form={FORM}
        setForm={vi.fn()}
        styles={["Plated"]}
        settings={{ eventTemplates: [], taxRegions: [], seasonalProfiles: [] }}
        eventTypes={[{ id: "wedding", name: "Wedding" }]}
      />
    );

    expect(host.querySelector('[data-ambient-field="date"]')).toMatchObject({ type: "date" });
    expect(host.querySelector('[data-ambient-field="time"]')).toMatchObject({ type: "time" });
    expect(host.querySelector('[data-ambient-field="hours"]')).toMatchObject({ type: "number" });
    expect(host.querySelector('[data-ambient-field="venue"]')).toMatchObject({ type: "text" });
    expect(host.querySelector('[data-ambient-field="venueAddress"]')).toMatchObject({ type: "text" });
    expect(host.querySelectorAll("[data-ambient-field]")).toHaveLength(8);
  });
});
