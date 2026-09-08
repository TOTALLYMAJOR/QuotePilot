import { describe, expect, test, vi } from "vitest";
import {
  createWorkspaceReturnContextStore,
  readWorkspaceReturnContextToken,
  restoreWorkspaceReturnViewport,
  sanitizeWorkspaceReturnView,
  withWorkspaceReturnContextState,
  WORKSPACE_RETURN_CONTEXT_MODEL_ID,
  WORKSPACE_RETURN_CONTEXT_STATE_KEY
} from "../workspaceReturnContext";

const scope = Object.freeze({
  organizationId: "org-rivera",
  principalId: "admin-1",
  role: "admin"
});
const originEntry = Object.freeze({ sessionId: "runtime-1", entryId: "entry-4", position: 4 });
const destinationEntry = Object.freeze({ sessionId: "runtime-1", entryId: "entry-5", position: 5 });

function quoteRoundTrip(store, overrides = {}) {
  store.setScope(scope);
  const prepared = store.prepare({
    entry: originEntry,
    origin: {
      routeId: "quote-list",
      pathname: "/app/quotes",
      search: "?eventType=wedding&status=draft"
    },
    destination: {
      routeId: "quote-detail",
      pathname: "/app/quotes/rivera-wedding",
      search: ""
    },
    surfaceId: "living-opportunity",
    view: {
      routeId: "quote-list",
      structured: { eventTypeFilter: "wedding", statusFilter: "draft" },
      transient: { query: "rivera@example.test" },
      disclosureIds: ["rivera-wedding", "read-boundary"],
      scrollY: 712,
      focus: {
        kind: "opportunity-action",
        objectId: "rivera-wedding",
        actionId: "review-staffing:rivera-wedding"
      }
    },
    ...overrides
  });
  return prepared;
}

function decisionRoundTrip(store, overrides = {}) {
  store.setScope(scope);
  return store.prepare({
    entry: originEntry,
    origin: {
      routeId: "clear-deck",
      pathname: "/app/clear-the-deck",
      search: ""
    },
    destination: {
      routeId: "workflow",
      pathname: "/app/workflow",
      search: "?quoteId=rivera-wedding&attentionType=approval&requestId=approval-rivera-4"
    },
    surfaceId: "decision-resolution",
    view: {
      routeId: "clear-deck",
      disclosureIds: ["decision:approval-rivera-4"],
      scrollY: 604,
      focus: {
        kind: "decision-action",
        objectId: "approval-rivera-4",
        actionId: "review-workflow:approval-rivera-4"
      }
    },
    ...overrides
  });
}

describe("workspace return context", () => {
  test("returns from the exact Workflow request to its Clear the Deck decision action", () => {
    const store = createWorkspaceReturnContextStore();
    const prepared = decisionRoundTrip(store);

    expect(prepared).toMatchObject({
      ok: true,
      token: {
        origin: {
          routeId: "clear-deck",
          pathname: "/app/clear-the-deck",
          search: ""
        },
        destination: {
          routeId: "workflow",
          pathname: "/app/workflow",
          search: "?attentionType=approval&quoteId=rivera-wedding&requestId=approval-rivera-4"
        },
        surfaceId: "decision-resolution"
      }
    });
    const state = withWorkspaceReturnContextState(null, prepared.token);
    expect(readWorkspaceReturnContextToken(state)).toEqual(prepared.token);
    expect(store.commit({ token: prepared.token, destinationEntry })).toEqual({ ok: true });
    expect(store.resolveOrigin({
      entry: destinationEntry,
      state,
      route: {
        routeId: "workflow",
        pathname: "/app/workflow",
        search: "?requestId=approval-rivera-4&quoteId=rivera-wedding&attentionType=approval"
      }
    })).toMatchObject({
      ok: true,
      delta: -1,
      routeId: "clear-deck",
      view: {
        disclosureIds: ["decision:approval-rivera-4"],
        scrollY: 604,
        focus: {
          kind: "decision-action",
          objectId: "approval-rivera-4",
          actionId: "review-workflow:approval-rivera-4"
        }
      }
    });
    expect(store.readOriginView({ entry: originEntry, routeId: "clear-deck" }))
      .toMatchObject({ ok: true, view: { focus: { objectId: "approval-rivera-4" } } });
  });

  test("rejects malformed, unsupported, nearby, or request-mismatched decision returns", () => {
    const invalidInputs = [
      {
        destination: {
          routeId: "workflow",
          pathname: "/app/workflow",
          search: "?quoteId=rivera-wedding&attentionType=follow_up&requestId=approval-rivera-4"
        }
      },
      {
        destination: {
          routeId: "workflow",
          pathname: "/app/workflow",
          search: "?quoteId=rivera-wedding&attentionType=approval&requestId=approval-rivera-4&nearby=true"
        }
      },
      {
        destination: {
          routeId: "workflow",
          pathname: "/app/workflow",
          search: "?quoteId=rivera-wedding&attentionType=approval&requestId=approval-rivera-4&requestId=approval-rivera-5"
        }
      },
      {
        destination: {
          routeId: "workflow",
          pathname: "/app/workflow",
          search: "?quoteId=rivera-wedding&attentionType=approval&requestId=unsafe%2Frequest"
        }
      },
      {
        destination: {
          routeId: "workflow",
          pathname: "/app/workflow",
          search: "?quoteId=rivera-wedding&attentionType=approval&requestId=bad%"
        }
      },
      {
        destination: {
          routeId: "workflow",
          pathname: "/app/workflow",
          search: "?quoteId=rivera-wedding&attentionType=approval"
        }
      },
      {
        destination: {
          routeId: "workflow",
          pathname: "/app/workflow",
          search: "?quoteId=&attentionType=approval&requestId=approval-rivera-4"
        }
      },
      {
        origin: {
          routeId: "clear-deck",
          pathname: "/app/clear-the-deck/nearby",
          search: ""
        }
      },
      {
        view: {
          routeId: "clear-deck",
          focus: {
            kind: "decision-action",
            objectId: "approval-rivera-5",
            actionId: "review-workflow:approval-rivera-5"
          }
        }
      },
      {
        view: {
          routeId: "clear-deck",
          focus: {
            kind: "decision-action",
            objectId: "approval-rivera-4",
            actionId: "review-workflow:approval-rivera-5"
          }
        }
      }
    ];

    for (const invalid of invalidInputs) {
      const store = createWorkspaceReturnContextStore();
      expect(decisionRoundTrip(store, invalid)).toEqual({ ok: false, reason: "invalid_context" });
    }
  });

  test("does not accept an altered Workflow request token after commit", () => {
    const store = createWorkspaceReturnContextStore();
    const prepared = decisionRoundTrip(store);
    expect(store.commit({ token: prepared.token, destinationEntry })).toEqual({ ok: true });
    const alteredToken = {
      ...prepared.token,
      destination: {
        ...prepared.token.destination,
        search: "?attentionType=approval&quoteId=rivera-wedding&requestId=approval-rivera-5"
      }
    };
    expect(store.resolveOrigin({
      entry: destinationEntry,
      state: withWorkspaceReturnContextState(null, alteredToken),
      route: alteredToken.destination
    })).toEqual({ ok: false, reason: "origin_unavailable" });
  });

  test("keeps view state runtime-only while native Back resolves the exact adjacent origin", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-2222-4333-8444-555555555555");
    const store = createWorkspaceReturnContextStore();
    const prepared = quoteRoundTrip(store);

    expect(prepared).toMatchObject({
      ok: true,
      token: {
        modelId: WORKSPACE_RETURN_CONTEXT_MODEL_ID,
        contextId: "qprc_11111111222243338444555555555555",
        runtimeId: "runtime-1",
        organizationId: "org-rivera",
        principal: { id: "admin-1", role: "admin" },
        origin: { entryId: "entry-4", position: 4, routeId: "quote-list" },
        destination: { routeId: "quote-detail" },
        surfaceId: "living-opportunity"
      }
    });
    const state = withWorkspaceReturnContextState({
      ambientArrival: { modelId: "workspace-arrival-contract-v1" }
    }, prepared.token);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("rivera@example.test");
    expect(serialized).not.toContain("read-boundary");
    expect(state.ambientArrival).toEqual({ modelId: "workspace-arrival-contract-v1" });
    expect(readWorkspaceReturnContextToken(state)).toEqual(prepared.token);

    expect(store.commit({ token: prepared.token, destinationEntry })).toEqual({ ok: true });
    expect(store.resolveOrigin({
      entry: destinationEntry,
      state,
      route: {
        routeId: "quote-detail",
        pathname: "/app/quotes/rivera-wedding",
        search: ""
      }
    })).toMatchObject({
      ok: true,
      delta: -1,
      routeId: "quote-list",
      view: {
        transient: { query: "rivera@example.test" },
        scrollY: 712,
        disclosureIds: ["rivera-wedding", "read-boundary"]
      }
    });
    expect(store.readOriginView({ entry: originEntry, routeId: "quote-list" }))
      .toMatchObject({ ok: true, view: { focus: { objectId: "rivera-wedding" } } });
  });

  test("fails closed for copied, forged, non-adjacent, cross-principal, and expired runtime tokens", () => {
    const store = createWorkspaceReturnContextStore();
    const prepared = quoteRoundTrip(store);
    const state = withWorkspaceReturnContextState(null, prepared.token);

    expect(store.commit({
      token: prepared.token,
      destinationEntry: { ...destinationEntry, position: 7 }
    })).toEqual({ ok: false, reason: "invalid_destination" });
    expect(store.commit({ token: prepared.token, destinationEntry })).toEqual({ ok: true });
    expect(store.resolveOrigin({
      entry: { ...destinationEntry, entryId: "copied-entry" },
      state,
      route: prepared.token.destination
    })).toEqual({ ok: false, reason: "origin_unavailable" });

    const forged = structuredClone(state);
    forged[WORKSPACE_RETURN_CONTEXT_STATE_KEY].organizationId = "foreign-org";
    expect(store.resolveOrigin({
      entry: destinationEntry,
      state: forged,
      route: prepared.token.destination
    })).toEqual({ ok: false, reason: "origin_unavailable" });

    store.setScope({ ...scope, principalId: "sales-2", role: "sales" });
    expect(store.resolveOrigin({
      entry: destinationEntry,
      state,
      route: prepared.token.destination
    })).toEqual({ ok: false, reason: "origin_unavailable" });

    const reloadedStore = createWorkspaceReturnContextStore();
    reloadedStore.setScope(scope);
    expect(reloadedStore.resolveOrigin({
      entry: destinationEntry,
      state,
      route: prepared.token.destination
    })).toEqual({ ok: false, reason: "origin_unavailable" });
  });

  test("allowlists structured values and bounds transient values without inventing nearby focus", () => {
    const sanitized = sanitizeWorkspaceReturnView({
      routeId: "customer-list",
      structured: { directoryFilter: "forged", order: "custom", extra: "private" },
      transient: {
        searchDraft: "x".repeat(241),
        search: "Rivera",
        cursor: "cursor-2",
        cursorHistory: Array.from({ length: 20 }, (_, index) => `cursor-${index}`),
        extra: "private"
      },
      disclosureIds: ["about", "about", "\u0000unsafe"],
      scrollY: -12,
      focus: { kind: "nearby-row", objectId: "client-other" }
    });

    expect(sanitized).toEqual({
      routeId: "customer-list",
      structured: { directoryFilter: "all", order: "recorded-event" },
      transient: {
        searchDraft: "",
        search: "Rivera",
        cursor: "cursor-2",
        cursorHistory: Array.from({ length: 12 }, (_, index) => `cursor-${index + 8}`)
      },
      disclosureIds: ["about"],
      scrollY: 0,
      focus: null
    });
  });

  test("retains the empty first-page cursor sentinel needed to return from page two", () => {
    expect(sanitizeWorkspaceReturnView({
      routeId: "customer-list",
      structured: { directoryFilter: "all" },
      transient: {
        cursor: "page-two",
        cursorHistory: ["", "page-one"]
      },
      focus: {
        kind: "client-action",
        objectId: "client-rivera",
        actionId: "review-client:client-rivera"
      }
    })).toMatchObject({
      transient: {
        cursor: "page-two",
        cursorHistory: ["", "page-one"]
      }
    });
  });

  test("rejects a mismatched initiating object and invalid editor surface pairing", () => {
    const store = createWorkspaceReturnContextStore();
    expect(quoteRoundTrip(store, {
      view: {
        routeId: "quote-list",
        structured: { eventTypeFilter: "wedding", statusFilter: "draft" },
        focus: {
          kind: "opportunity-action",
          objectId: "nearby-opportunity",
          actionId: "review-staffing:nearby-opportunity"
        }
      }
    })).toEqual({ ok: false, reason: "invalid_context" });

    store.setScope(scope);
    expect(store.prepare({
      entry: originEntry,
      origin: { routeId: "catalog", pathname: "/app/catalog", search: "" },
      destination: { routeId: "catalog", pathname: "/app/catalog", search: "" },
      surfaceId: "ambient-library",
      view: {
        routeId: "catalog",
        focus: {
          kind: "library-action",
          objectId: "wedding",
          actionId: "review-library-template:wedding"
        }
      },
      destinationView: {
        kind: "library-editor",
        sectionId: "templates",
        recordId: "wedding",
        actionId: "review-library-template:wedding"
      }
    })).toEqual({ ok: false, reason: "invalid_context" });
  });

  test("keeps an exact Library editor target in runtime memory for Forward", () => {
    const store = createWorkspaceReturnContextStore();
    store.setScope(scope);
    const prepared = store.prepare({
      entry: originEntry,
      origin: { routeId: "catalog", pathname: "/app/catalog", search: "" },
      destination: { routeId: "catalog", pathname: "/app/catalog", search: "" },
      surfaceId: "library-editor",
      view: {
        routeId: "catalog",
        disclosureIds: ["templates"],
        scrollY: 480,
        focus: {
          kind: "library-action",
          objectId: "church",
          actionId: "review-library-template:church"
        }
      },
      destinationView: {
        kind: "library-editor",
        sectionId: "templates",
        recordId: "church",
        actionId: "review-library-template:church"
      }
    });
    const state = withWorkspaceReturnContextState(null, prepared.token);
    expect(JSON.stringify(state)).not.toContain("church");
    expect(store.commit({ token: prepared.token, destinationEntry })).toEqual({ ok: true });
    expect(store.readDestination({
      entry: destinationEntry,
      state,
      route: { routeId: "catalog", pathname: "/app/catalog", search: "" }
    })).toEqual({
      ok: true,
      destination: {
        kind: "library-editor",
        sectionId: "templates",
        recordId: "church",
        actionId: "review-library-template:church"
      }
    });
  });

  test("walks an exact adjacent Library editor chain back to its opportunity", () => {
    const store = createWorkspaceReturnContextStore();
    store.setScope(scope);
    const opportunityEntry = { sessionId: "runtime-1", entryId: "entry-8", position: 8 };
    const libraryEntry = { sessionId: "runtime-1", entryId: "entry-9", position: 9 };
    const editorEntry = { sessionId: "runtime-1", entryId: "entry-10", position: 10 };
    const library = store.prepare({
      entry: opportunityEntry,
      origin: {
        routeId: "quote-detail",
        pathname: "/app/quotes/rivera-wedding",
        search: ""
      },
      destination: { routeId: "catalog", pathname: "/app/catalog", search: "" },
      surfaceId: "ambient-library",
      view: {
        routeId: "quote-detail",
        scrollY: 420,
        focus: {
          kind: "quick-updates",
          objectId: "rivera-wedding",
          actionId: "open-quick-updates"
        }
      }
    });
    expect(store.commit({ token: library.token, destinationEntry: libraryEntry })).toEqual({ ok: true });
    const editor = store.prepare({
      entry: libraryEntry,
      origin: { routeId: "catalog", pathname: "/app/catalog", search: "" },
      destination: { routeId: "catalog", pathname: "/app/catalog", search: "" },
      surfaceId: "library-editor",
      view: {
        routeId: "catalog",
        focus: {
          kind: "library-action",
          objectId: "wedding",
          actionId: "review-library-template:wedding"
        }
      },
      destinationView: {
        kind: "library-editor",
        sectionId: "templates",
        recordId: "wedding",
        actionId: "review-library-template:wedding"
      }
    });
    expect(store.commit({ token: editor.token, destinationEntry: editorEntry })).toEqual({ ok: true });

    expect(store.resolveOrigin({
      entry: editorEntry,
      state: withWorkspaceReturnContextState(null, editor.token),
      route: { routeId: "catalog", pathname: "/app/catalog", search: "" },
      targetRouteId: "quote-detail"
    })).toMatchObject({
      ok: true,
      delta: -2,
      routeId: "quote-detail",
      view: { scrollY: 420, focus: { objectId: "rivera-wedding" } }
    });
  });

  test("refreshes only an existing exact origin view before a later Forward round trip", () => {
    const store = createWorkspaceReturnContextStore();
    const prepared = quoteRoundTrip(store);
    expect(store.commit({ token: prepared.token, destinationEntry })).toEqual({ ok: true });
    expect(store.updateOriginView({
      entry: originEntry,
      routeId: "quote-list",
      view: {
        routeId: "quote-list",
        structured: { eventTypeFilter: "all", statusFilter: "submitted" },
        transient: { query: "latest private search" },
        disclosureIds: ["newly-opened"],
        scrollY: 915,
        focus: {
          kind: "opportunity-action",
          objectId: "rivera-wedding",
          actionId: "review-pricing:rivera-wedding"
        }
      }
    })).toMatchObject({ ok: true });
    expect(store.resolveOrigin({
      entry: destinationEntry,
      state: withWorkspaceReturnContextState(null, prepared.token),
      route: prepared.token.destination
    })).toMatchObject({
      ok: true,
      view: {
        structured: { eventTypeFilter: "all", statusFilter: "submitted", order: "priority" },
        transient: { query: "latest private search" },
        disclosureIds: ["newly-opened"],
        scrollY: 915
      }
    });
    expect(store.updateOriginView({
      entry: { ...originEntry, entryId: "foreign-entry" },
      routeId: "quote-list",
      view: { routeId: "quote-list" }
    })).toEqual({ ok: false, reason: "unavailable" });
  });

  test("rejects private or non-canonical routes and unknown token keys", () => {
    const store = createWorkspaceReturnContextStore();
    expect(quoteRoundTrip(store, {
      destination: {
        routeId: "quote-detail",
        pathname: "/app/quotes/rivera%40example.test",
        search: ""
      }
    })).toEqual({ ok: false, reason: "invalid_context" });
    expect(quoteRoundTrip(store, {
      origin: {
        routeId: "quote-list",
        pathname: "/app/quotes",
        search: "?status=draft&status=submitted"
      }
    })).toEqual({ ok: false, reason: "invalid_context" });

    const valid = quoteRoundTrip(store);
    const state = withWorkspaceReturnContextState(null, valid.token);
    const forgedState = {
      ...state,
      [WORKSPACE_RETURN_CONTEXT_STATE_KEY]: {
        ...state[WORKSPACE_RETURN_CONTEXT_STATE_KEY],
        customerName: "Private"
      }
    };
    expect(readWorkspaceReturnContextToken(forgedState)).toBeNull();
  });

  test("pins focus and scroll through late native-history layout settlement", () => {
    const callbacks = [];
    const focus = vi.fn();
    const scrollTo = vi.fn();
    const windowObject = {
      requestAnimationFrame: vi.fn((callback) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
      cancelAnimationFrame: vi.fn(),
      scrollTo
    };

    restoreWorkspaceReturnViewport({
      focusTarget: { focus },
      scrollY: 481,
      windowObject
    });
    while (callbacks.length) callbacks.shift()();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollTo).toHaveBeenCalledTimes(4);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 481, behavior: "auto" });
  });
});
