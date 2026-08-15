import { describe, expect, test } from "vitest";
import {
  getLocalCustomerDirectoryFixturePage,
  getLocalCustomerWorkspaceFixture
} from "../localCustomerDirectoryFixture";

describe("local customer directory review fixture", () => {
  test("provides at least twenty non-authoritative clients across three months", () => {
    const page = getLocalCustomerDirectoryFixturePage({ organizationId: "org-review" });

    expect(page).toMatchObject({ source: "local", state: "local_fixture", nextCursor: "" });
    expect(page.items.length).toBeGreaterThanOrEqual(20);
    expect(new Set(page.items.map((customer) => customer.organizationId))).toEqual(new Set(["org-review"]));
    expect(new Set(page.items.map((customer) => customer.lastEventDate.slice(0, 7)).filter(Boolean)))
      .toEqual(new Set(["2026-08", "2026-09", "2026-10"]));
    expect(page.items.some((customer) => !customer.email || !customer.phone)).toBe(true);
    expect(page.items.some((customer) => !customer.lastQuoteId)).toBe(true);
  });

  test("keeps search and pagination deterministic", () => {
    const search = getLocalCustomerDirectoryFixturePage({ organizationId: "org-review", search: "avery" });
    expect(search.items.map((customer) => customer.name)).toEqual(["Avery Williams"]);

    const first = getLocalCustomerDirectoryFixturePage({ organizationId: "org-review", pageSize: 5 });
    const second = getLocalCustomerDirectoryFixturePage({ organizationId: "org-review", pageSize: 5, cursor: first.nextCursor });
    expect(first.items).toHaveLength(5);
    expect(second.items).toHaveLength(5);
    expect(second.items[0].id).not.toBe(first.items[0].id);
  });

  test("opens an exact, organization-scoped local client workspace", () => {
    const workspace = getLocalCustomerWorkspaceFixture({
      organizationId: "org-review",
      customerId: "review-client-01"
    });

    expect(workspace).toMatchObject({
      source: "local",
      state: "local_fixture",
      customer: {
        customerId: "review-client-01",
        organizationId: "org-review",
        name: "Avery Williams"
      },
      quotePageInfo: { limit: 25, truncated: false }
    });
    expect(workspace.quotes).toHaveLength(1);
    expect(workspace.quotes[0]).toMatchObject({
      customerId: "review-client-01",
      organizationId: "org-review",
      quoteNumber: "QP-2601"
    });
    expect(getLocalCustomerWorkspaceFixture({
      organizationId: "other-org",
      customerId: "not-a-review-client"
    })).toBeNull();
  });
});
