import { describe, expect, test } from "vitest";
import {
  PILOT_COMMAND_CLASSES,
  PILOT_V1_EXECUTABLE_COMMAND_CLASSES,
  authorizePilotV1Command,
  classifyPilotDraftProposal,
  getPilotCommandClassDefinition
} from "../pilotCommandPolicy";

describe("Pilot command execution policy", () => {
  test("defines all eight classes while limiting v1 execution to the four bounded classes", () => {
    expect(PILOT_COMMAND_CLASSES).toEqual([
      "navigation",
      "query",
      "draft_mutation",
      "simulation",
      "trusted_mutation",
      "communication",
      "bulk_action",
      "destructive_action"
    ]);
    expect(PILOT_V1_EXECUTABLE_COMMAND_CLASSES).toEqual([
      "navigation",
      "query",
      "draft_mutation",
      "simulation"
    ]);
    expect(getPilotCommandClassDefinition("communication")).toMatchObject({
      commandClass: "communication",
      executableInV1: false,
      maximumAuthority: "provider"
    });
  });

  test("allows a previewed, explicitly confirmed draft mutation", () => {
    expect(authorizePilotV1Command({
      commandClass: "draft_mutation",
      authorityLevel: "draft",
      previewAvailable: true,
      confirmed: true
    })).toMatchObject({
      allowed: true,
      commandClass: "draft_mutation",
      authorityLevel: "draft"
    });
  });

  test.each([
    [{ commandClass: "draft_mutation", authorityLevel: "draft", previewAvailable: false, confirmed: true }, /preview/iu],
    [{ commandClass: "draft_mutation", authorityLevel: "draft", previewAvailable: true, confirmed: false }, /explicit outcome confirmation/iu],
    [{ commandClass: "draft_mutation", authorityLevel: "trusted", previewAvailable: true, confirmed: true }, /expected draft authority/iu],
    [{ commandClass: "communication", authorityLevel: "provider", previewAvailable: true, confirmed: true }, /cannot send/iu],
    [{ commandClass: "destructive_action", authorityLevel: "destructive", previewAvailable: true, confirmed: true }, /cannot execute destructive/iu],
    [{ commandClass: "invented", authorityLevel: "draft", previewAvailable: true, confirmed: true }, /could not classify/iu]
  ])("fails closed for an unsafe or incomplete request", (request, reason) => {
    const result = authorizePilotV1Command(request);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  test("classifies only the deterministic parser's bounded proposal vocabulary", () => {
    expect(classifyPilotDraftProposal({ kind: "add_staff" })).toMatchObject({
      proposalKind: "add_staff",
      commandClass: "draft_mutation",
      authorityLevel: "draft",
      previewRequired: true,
      explicitConfirmationRequired: true,
      supported: true,
      allowed: true
    });
    expect(classifyPilotDraftProposal({ kind: "send_quote" })).toMatchObject({
      commandClass: "unclassified",
      supported: false,
      allowed: false
    });
    expect(classifyPilotDraftProposal({ kind: "set_package" })).toMatchObject({
      proposalKind: "set_package",
      commandClass: "draft_mutation",
      supported: true,
      allowed: true
    });
  });
});
