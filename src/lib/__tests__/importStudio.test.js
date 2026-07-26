import { describe, expect, test } from "vitest";
import {
  buildImportPreview,
  detectImportType,
  parseCsvText,
  resolveProvisionOwnerUid,
  suggestFieldMapping
} from "../importStudio";

describe("Import Studio CSV intake", () => {
  test("parses quoted values, commas, and escaped quotes", () => {
    const parsed = parseCsvText([
      "Client Name,Email,Notes",
      '"Major, Michael",flightcontrol@quietpilot.us,"Asked for ""Premium"""'
    ].join("\n"));

    expect(parsed.headers).toEqual(["Client Name", "Email", "Notes"]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].values).toEqual({
      "Client Name": "Major, Michael",
      Email: "flightcontrol@quietpilot.us",
      Notes: 'Asked for "Premium"'
    });
  });

  test("detects customer records and suggests plain-language mappings", () => {
    const headers = ["Client Name", "Email Address", "Mobile"];
    expect(detectImportType(headers)).toBe("customers");
    expect(suggestFieldMapping(headers, "customers")).toMatchObject({
      name: "Client Name",
      email: "Email Address",
      phone: "Mobile"
    });
  });

  test("detects package pricing and validates bad amounts", () => {
    const parsed = parseCsvText("Package Name,Price Per Person\nPremium,$42.50\nInvalid,nope");
    expect(detectImportType(parsed.headers)).toBe("packages");
    const mapping = suggestFieldMapping(parsed.headers, "packages");
    const preview = buildImportPreview({ rows: parsed.rows, mapping, importType: "packages" });
    expect(preview[0]).toMatchObject({ ready: true, record: { name: "Premium", ppp: 42.5 } });
    expect(preview[1].ready).toBe(false);
    expect(preview[1].errors).toContain("ppp must be a positive number");
  });

  test("requires menu destination fields before a row is ready", () => {
    const parsed = parseCsvText("Item,Price\nSalmon,18");
    const mapping = suggestFieldMapping(parsed.headers, "menuItems");
    const [preview] = buildImportPreview({ rows: parsed.rows, mapping, importType: "menuItems" });
    expect(preview.ready).toBe(false);
    expect(preview.errors).toEqual(expect.arrayContaining([
      "eventTypeId is required",
      "categoryId is required"
    ]));
  });
});

describe("provisioning owner identity guardrail", () => {
  test("never substitutes the signed-in administrator when owner UID is blank", () => {
    expect(resolveProvisionOwnerUid("")).toBe("");
    expect(resolveProvisionOwnerUid("  firebase-owner-uid  ")).toBe("firebase-owner-uid");
  });
});
