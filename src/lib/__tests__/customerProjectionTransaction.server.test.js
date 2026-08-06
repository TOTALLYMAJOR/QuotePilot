import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const INDEX_PATH = path.resolve(process.cwd(), "functions/index.js");

describe("trusted quote customer projection wiring", () => {
  test("creates and edits project customer data inside the quote transactions", () => {
    const source = fs.readFileSync(INDEX_PATH, "utf8");

    expect(source).toContain("buildCustomerProjection");
    expect(source).toContain('.collection("customers")');
    expect(source).toContain('.where("email", "==", documents.quote.customer.email)');
    expect(source).toContain('.where("email", "==", documents.quotePatch.customer.email)');
    expect(source.match(/tx\.set\(customerRef,/g)).toHaveLength(2);
    expect(source.match(/updatedAt: FieldValue\.serverTimestamp\(\)/g)?.length || 0)
      .toBeGreaterThanOrEqual(2);
  });
});
