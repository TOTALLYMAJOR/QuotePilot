import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { StaffLeadChoiceField } from "../EventScheduleModal";
import { StaffLeadChoiceField as LegacyStaffLeadChoiceField } from "../LegacyEventScheduleModal";

function renderChoice(Component, overrides = {}) {
  return renderToStaticMarkup(
    <Component
      staffLeads={[]}
      value=""
      disabled={false}
      onChange={() => {}}
      onRecover={() => {}}
      {...overrides}
    />
  );
}

describe.each([
  ["converged", StaffLeadChoiceField],
  ["legacy", LegacyStaffLeadChoiceField]
])("%s schedule staff-lead choice states", (_surface, Component) => {
  test("renders zero, one, and many choices without inventing a lead", () => {
    const empty = renderChoice(Component);
    expect(empty).toContain('data-adaptive-choice-mode="empty"');
    expect(empty).toContain('data-field-state-primary="unavailable"');
    expect(empty).toContain("No current staff leads are available");
    expect(empty).not.toContain("<select");

    const single = renderChoice(Component, { staffLeads: ["Avery Cook"], value: "Avery Cook" });
    expect(single).toContain('data-adaptive-choice-mode="single"');
    expect(single).toContain('data-field-state-primary="confirmed"');
    expect(single).not.toContain("<select");

    const many = renderChoice(Component, { staffLeads: ["Avery Cook", "Morgan Lead"] });
    expect(many).toContain('data-adaptive-choice-mode="select"');
    expect(many).toContain("<select");
    expect(many).toContain("Avery Cook");
    expect(many).toContain("Morgan Lead");
  });

  test("preserves a stale saved lead until the operator resolves it", () => {
    const stale = renderChoice(Component, {
      staffLeads: ["Morgan Lead"],
      value: "Former Lead"
    });
    expect(stale).toContain('data-adaptive-choice-mode="select"');
    expect(stale).toContain('value="Former Lead" disabled="" selected=""');
    expect(stale).toContain('data-field-state-primary="stale"');
    expect(stale).toContain("saved lead is no longer in the current team choices");
    expect(stale).toContain("Clear unavailable lead");
  });
});
