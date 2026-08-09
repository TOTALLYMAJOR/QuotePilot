import { describe, expect, test } from "vitest";
import {
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceInteger,
  formatWorkspaceMoney,
  formatWorkspaceSource,
  formatWorkspaceText,
  hasWorkspaceNumber,
  humanizeWorkspaceValue
} from "../workspacePresentation";

describe("workspace presentation formatting", () => {
  test("formats date-only values without leaking ISO syntax or shifting the calendar day", () => {
    expect(formatWorkspaceDate("2026-09-01")).toBe("Sep 1, 2026");
    expect(formatWorkspaceDate("not-a-date")).toBe("Date not set");
    expect(formatWorkspaceDate("")).toBe("Date not set");
  });

  test("formats timestamps and semantic empty states", () => {
    expect(formatWorkspaceDateTime("2026-08-09T15:30:00.000Z")).not.toContain("T15:30");
    expect(formatWorkspaceDateTime("bad", { emptyLabel: "Never refreshed" })).toBe("Never refreshed");
    expect(formatWorkspaceText("", { emptyLabel: "Venue not set" })).toBe("Venue not set");
  });

  test("formats USD values and counts while preserving a real zero", () => {
    expect(formatWorkspaceMoney(1500)).toBe("$1,500.00");
    expect(formatWorkspaceMoney(null)).toBe("Amount not recorded");
    expect(formatWorkspaceInteger(1200)).toBe("1,200");
    expect(formatWorkspaceInteger(0)).toBe("0");
    expect(hasWorkspaceNumber(0)).toBe(true);
    expect(hasWorkspaceNumber("unknown")).toBe(false);
    expect(formatWorkspaceInteger("unknown", { emptyLabel: "Guest count not set" })).toBe("Guest count not set");
  });

  test("humanizes enums and known read sources without changing stored values", () => {
    expect(humanizeWorkspaceValue("awaiting_execution")).toBe("Awaiting execution");
    expect(humanizeWorkspaceValue("customer-action")).toBe("Customer action");
    expect(formatWorkspaceSource("firebase")).toBe("Firestore staff records");
    expect(formatWorkspaceSource("local")).toBe("Browser-local workspace");
    expect(formatWorkspaceSource("")).toBe("Source not confirmed");
  });
});
