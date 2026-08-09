import { describe, expect, test, vi } from "vitest";
import {
  COMMERCIAL_SEARCH_CUSTOMER_LIMIT,
  COMMERCIAL_SEARCH_QUOTE_READ_LIMIT,
  COMMERCIAL_SEARCH_QUOTE_RESULT_LIMIT,
  createCommercialSearchGenerationGuard,
  projectCommercialCustomerResults,
  searchCommercialWorkspace
} from "../commercialSearch";
import {
  isCommercialSearchAvailable,
  isCommercialSearchShortcut,
  resolveCommercialSearchShortcutAction
} from "../commercialSearchShell";

describe("bounded commercial search", () => {
  test("federates the fixed customer prefix and latest-quote windows", async () => {
    const readCustomers = vi.fn().mockResolvedValue({
      source: "firebase",
      items: [{
        id: "customer-opaque-1",
        name: "Henderson Foods",
        email: "events@henderson.test",
        company: "Henderson Group",
        portalKey: "private-customer-token",
        privateClaims: { role: "owner" }
      }],
      nextCursor: ""
    });
    const readQuotes = vi.fn().mockResolvedValue({
      source: "firebase",
      quotes: [{
        id: "quote-opaque-1",
        organizationId: "org-a",
        quoteNumber: "QP-HENDERSON-14",
        status: "accepted",
        customer: { name: "Henderson Foods", email: "events@henderson.test" },
        event: { name: "Corporate picnic", date: "2026-08-21" },
        portalKey: "private-quote-token",
        messages: [{ body: "private conversation" }],
        payment: { providerSessionId: "provider-secret" }
      }],
      truncated: false
    });

    const result = await searchCommercialWorkspace({
      organizationId: "org-a",
      query: "  HENDERSON  ",
      readCustomers,
      readQuotes
    });

    expect(readCustomers).toHaveBeenCalledWith({
      organizationId: "org-a",
      search: "henderson",
      cursor: "",
      pageSize: COMMERCIAL_SEARCH_CUSTOMER_LIMIT
    });
    expect(readQuotes).toHaveBeenCalledWith({
      organizationId: "org-a",
      limitCount: COMMERCIAL_SEARCH_QUOTE_READ_LIMIT
    });
    expect(result).toMatchObject({ status: "success", source: "firebase" });
    expect(result.results).toEqual([
      {
        kind: "customer",
        id: "customer-opaque-1",
        title: "Henderson Foods",
        detail: "Henderson Group · events@henderson.test"
      },
      {
        kind: "quote",
        id: "quote-opaque-1",
        title: "QP-HENDERSON-14",
        detail: "Henderson Foods · Corporate picnic · 2026-08-21 · Accepted"
      }
    ]);
    expect(Object.keys(result.results[0]).sort()).toEqual(["detail", "id", "kind", "title"]);
    expect(Object.keys(result.results[1]).sort()).toEqual(["detail", "id", "kind", "title"]);
    expect(JSON.stringify(result.results)).not.toContain("private-customer-token");
    expect(JSON.stringify(result.results)).not.toContain("private-quote-token");
    expect(JSON.stringify(result.results)).not.toContain("private conversation");
    expect(JSON.stringify(result.results)).not.toContain("provider-secret");
  });

  test("returns partial usable results when one bounded source fails", async () => {
    const result = await searchCommercialWorkspace({
      organizationId: "org-a",
      query: "picnic",
      readCustomers: vi.fn().mockRejectedValue(new Error("private Firestore detail")),
      readQuotes: vi.fn().mockResolvedValue({
        source: "local",
        quotes: [{
          id: "quote-1",
          organizationId: "org-a",
          quoteNumber: "QP-1",
          customer: { name: "Henderson Foods" },
          event: { name: "Annual picnic" }
        }],
        truncated: false
      })
    });

    expect(result.status).toBe("partial");
    expect(result.source).toBe("local");
    expect(result.results).toHaveLength(1);
    expect(result.reads.customers).toEqual({ status: "error", source: "", truncated: false });
    expect(result.partialReasons).toContain("customer-read-unavailable");
    expect(JSON.stringify(result)).not.toContain("private Firestore detail");
  });

  test("fails closed when neither bounded read completes", async () => {
    const result = await searchCommercialWorkspace({
      organizationId: "org-a",
      query: "henderson",
      readCustomers: vi.fn().mockRejectedValue(new Error("customer read detail")),
      readQuotes: vi.fn().mockRejectedValue(new Error("quote read detail"))
    });

    expect(result.status).toBe("error");
    expect(result.results).toEqual([]);
    expect(result.source).toBe("");
    expect(result.partialReasons).toEqual([
      "customer-read-unavailable",
      "quote-read-unavailable"
    ]);
    expect(JSON.stringify(result)).not.toContain("read detail");
  });

  test("reports capped search windows instead of implying completeness", async () => {
    const matchingQuotes = Array.from(
      { length: COMMERCIAL_SEARCH_QUOTE_RESULT_LIMIT + 2 },
      (_, index) => ({
        id: `quote-${index}`,
        organizationId: "org-a",
        quoteNumber: `QP-${index}`,
        customer: { name: "Henderson Foods" },
        event: { name: "Picnic" }
      })
    );
    const result = await searchCommercialWorkspace({
      organizationId: "org-a",
      query: "henderson",
      readCustomers: vi.fn().mockResolvedValue({
        source: "firebase",
        items: [],
        nextCursor: "next-customer-page"
      }),
      readQuotes: vi.fn().mockResolvedValue({
        source: "firebase",
        quotes: matchingQuotes,
        truncated: true
      })
    });

    expect(result.status).toBe("partial");
    expect(result.truncated).toBe(true);
    expect(result.results).toHaveLength(COMMERCIAL_SEARCH_QUOTE_RESULT_LIMIT);
    expect(result.partialReasons).toEqual([
      "customer-results-capped",
      "quote-window-capped",
      "quote-results-capped"
    ]);
  });

  test("does not read for a query shorter than the minimum", async () => {
    const readCustomers = vi.fn();
    const readQuotes = vi.fn();
    const result = await searchCommercialWorkspace({
      organizationId: "org-a",
      query: "h",
      readCustomers,
      readQuotes
    });

    expect(result.status).toBe("empty");
    expect(readCustomers).not.toHaveBeenCalled();
    expect(readQuotes).not.toHaveBeenCalled();
  });

  test("prevents a stale request generation from replacing newer results", () => {
    const generationGuard = createCommercialSearchGenerationGuard();
    const staleGeneration = generationGuard.next();
    const currentGeneration = generationGuard.next();
    let visibleResult = "newer query result";

    expect(generationGuard.commit(currentGeneration, () => {
      visibleResult = "newer query result";
    })).toBe(true);
    expect(generationGuard.commit(staleGeneration, () => {
      visibleResult = "stale query result";
    })).toBe(false);
    expect(visibleResult).toBe("newer query result");

    generationGuard.invalidate();
    expect(generationGuard.commit(currentGeneration, () => {
      visibleResult = "closed-palette result";
    })).toBe(false);
    expect(visibleResult).toBe("newer query result");
  });

  test("drops customer identifiers that cannot be routed as opaque IDs", () => {
    expect(projectCommercialCustomerResults([
      { id: "customer@example.test", name: "Customer Email" },
      { id: "customer/unsafe", name: "Customer Slash" },
      { id: "customer-safe", name: "Customer Safe" }
    ], "customer")).toEqual([{
      kind: "customer",
      id: "customer-safe",
      title: "Customer Safe",
      detail: ""
    }]);
  });

  test("fails closed for cross-tenant and unscoped quote search records", async () => {
    const result = await searchCommercialWorkspace({
      organizationId: "org-a",
      query: "henderson",
      readCustomers: vi.fn().mockResolvedValue({ source: "local", items: [], nextCursor: "" }),
      readQuotes: vi.fn().mockResolvedValue({
        source: "local",
        truncated: false,
        quotes: [
          {
            id: "org-a-quote",
            organizationId: "org-a",
            customer: { name: "Henderson One" }
          },
          {
            id: "org-b-quote",
            organizationId: "org-b",
            customer: { name: "Henderson Two" }
          },
          {
            id: "legacy-unscoped",
            customer: { name: "Henderson Legacy" }
          }
        ]
      })
    });

    expect(result.results).toEqual([{
      kind: "quote",
      id: "org-a-quote",
      title: "Saved quote",
      detail: "Henderson One"
    }]);
  });
});

describe("commercial search staff-shell guards", () => {
  const availableInput = {
    enabled: true,
    isStaff: true,
    organizationId: "org-a",
    portalMode: false,
    workspaceReady: true,
    isUnscopedPlatformOperator: false,
    isWorkspaceRoute: true
  };

  test("requires the flag, staff authority, tenant, ready shell, and workspace route", () => {
    expect(isCommercialSearchAvailable(availableInput)).toBe(true);
    for (const blocked of [
      { enabled: false },
      { isStaff: false },
      { organizationId: "" },
      { workspaceReady: false },
      { isUnscopedPlatformOperator: true },
      { isWorkspaceRoute: false }
    ]) {
      expect(isCommercialSearchAvailable({ ...availableInput, ...blocked })).toBe(false);
    }
  });

  test("portal mode has precedence over the staff search shortcut", () => {
    expect(isCommercialSearchAvailable({ ...availableInput, portalMode: true })).toBe(false);
    expect(isCommercialSearchShortcut({ key: "k", metaKey: true })).toBe(true);
    expect(isCommercialSearchShortcut({ key: "K", ctrlKey: true })).toBe(true);
    expect(isCommercialSearchShortcut({ key: "k", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isCommercialSearchShortcut({ key: "k", ctrlKey: true, defaultPrevented: true })).toBe(false);
    expect(isCommercialSearchShortcut({
      key: "k",
      ctrlKey: true,
      target: { tagName: "INPUT" }
    })).toBe(false);
    expect(isCommercialSearchShortcut({
      key: "k",
      metaKey: true,
      target: { tagName: "DIV", isContentEditable: true }
    })).toBe(false);
    expect(isCommercialSearchShortcut({
      key: "k",
      metaKey: true,
      target: { tagName: "INPUT" }
    }, { allowEditable: true })).toBe(true);
  });

  test("refocuses an open palette without hijacking a different modal", () => {
    const editableShortcut = {
      key: "k",
      ctrlKey: true,
      target: { tagName: "INPUT" }
    };
    expect(resolveCommercialSearchShortcutAction({
      event: editableShortcut,
      paletteOpen: true
    })).toBe("refocus");
    expect(resolveCommercialSearchShortcutAction({
      event: { key: "k", ctrlKey: true },
      anotherModalOpen: true
    })).toBe("");
    expect(resolveCommercialSearchShortcutAction({
      event: editableShortcut,
      paletteOpen: true,
      anotherModalOpen: true
    })).toBe("");
    expect(resolveCommercialSearchShortcutAction({
      event: editableShortcut
    })).toBe("");
    expect(resolveCommercialSearchShortcutAction({
      event: { key: "k", metaKey: true }
    })).toBe("open");
  });
});
