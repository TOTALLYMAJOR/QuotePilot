// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as recovery from "../commercialApplyRecovery";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const scope = { organizationId: "org-one", principalId: "staff-one", quoteId: "quote-one" };
const identity = {
  ...scope,
  schemaVersion: "commercial-apply-recovery-v1",
  simulationReceiptId: `ccs_${"a".repeat(48)}`,
  authorizationReceiptId: `cca_${"b".repeat(48)}`,
  applyRequestId: `change_apply_${"c".repeat(32)}`,
  expectedBaseRevisionId: "v0017",
  recordedAtISO: "2026-10-11T00:00:00.000Z"
};
function outcome(state = "not_committed", overrides = {}) {
  return {
    outcomeReceipt: {
      authority: "server_authoritative", receiptType: "outcome", state,
      organizationId: "org-one", quoteId: "quote-one",
      requestId: identity.applyRequestId,
      simulationReceiptId: identity.simulationReceiptId,
      authorizationReceiptId: identity.authorizationReceiptId,
      baseRevisionId: "v0017",
      ...overrides
    }
  };
}
let root;
let container;
beforeEach(() => {
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("commercial apply recovery identity", () => {
  test("restores Quick Updates on the home surface and fences the consumed preview after not_committed", async () => {
    recovery.recordCommercialApplyRecovery(sessionStorage, identity);
    let current;
    function Harness() { current = recovery.useCommercialApplyRecovery({ ...scope, quoteId: "" }); return null; }
    act(() => root.render(React.createElement(Harness)));
    expect(current.pending).toEqual(identity);
    expect(current.recoveryQuoteId).toBe("quote-one");
    const send = vi.fn(async () => outcome());
    await act(async () => { await current.reconcile(send); });
    expect(send).toHaveBeenCalledOnce();
    expect(current.outcome.outcomeReceipt.state).toBe("not_committed");
    const allocate = vi.fn(() => `change_apply_${"e".repeat(32)}`);
    act(() => { expect(current.begin(identity, allocate)).toBeNull(); });
    expect(allocate).not.toHaveBeenCalled();
    act(() => { expect(current.begin({ ...identity, simulationReceiptId: `ccs_${"f".repeat(48)}`, applyRequestId: "" }, allocate)).not.toBeNull(); });
    expect(allocate).toHaveBeenCalledOnce();
  });
  test("retains only the original bounded identity across reload and isolates quote scope", () => {
    expect(recovery.recordCommercialApplyRecovery).toBeTypeOf("function");
    const saved = recovery.recordCommercialApplyRecovery(sessionStorage, identity);
    expect(saved).toEqual(identity);
    expect(recovery.readCommercialApplyRecovery(sessionStorage, scope)).toEqual(identity);
    expect(recovery.readCommercialApplyRecovery(sessionStorage, { ...scope, quoteId: "quote-two" })).toBeNull();
    expect(recovery.readCommercialApplyRecovery(sessionStorage, { ...scope, principalId: "staff-two" })).toBeNull();
    expect(recovery.recordCommercialApplyRecovery(sessionStorage, {
      ...identity, applyRequestId: `change_apply_${"d".repeat(32)}`
    })).toBeNull();
    expect(recovery.readCommercialApplyRecovery(sessionStorage, scope).applyRequestId).toBe(identity.applyRequestId);
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)))).toEqual(identity);
  });

  test("rejects payload fields, malformed IDs, oversized identities and unavailable storage", () => {
    expect(recovery.recordCommercialApplyRecovery).toBeTypeOf("function");
    for (const invalid of [
      { ...identity, form: { name: "Private customer" } },
      { ...identity, simulationReceiptId: "simulation-one" },
      { ...identity, authorizationReceiptId: "foreign" },
      { ...identity, applyRequestId: "new-request" },
      { ...identity, quoteId: "../foreign" },
      { ...identity, principalId: "customer@example.com" },
      { ...identity, expectedBaseRevisionId: "x".repeat(257) },
      { ...identity, recordedAtISO: "yesterday" },
      { ...identity, schemaVersion: "future" }
    ]) expect(recovery.recordCommercialApplyRecovery(sessionStorage, invalid)).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(recovery.recordCommercialApplyRecovery(null, identity)).toBeNull();
    expect(recovery.recordCommercialApplyRecovery({ getItem() { throw Error("Denied"); } }, identity)).toBeNull();
  });

  test("refuses corrupted or oversized persisted identities", () => {
    expect(recovery.recordCommercialApplyRecovery).toBeTypeOf("function");
    recovery.recordCommercialApplyRecovery(sessionStorage, identity);
    const key = sessionStorage.key(0);
    for (const raw of ["{", "x".repeat(4097), JSON.stringify({ ...identity, pricing: { total: 50 } })]) {
      sessionStorage.setItem(key, raw);
      expect(() => recovery.readCommercialApplyRecovery(sessionStorage, scope)).toThrow();
    }
  });

  test("only an exact server outcome clears identity; active revision and foreign outcomes cannot", () => {
    expect(recovery.resolveCommercialApplyRecovery).toBeTypeOf("function");
    recovery.recordCommercialApplyRecovery(sessionStorage, identity);
    for (const invalid of [
      outcome("uncertain"), outcome("committed", { requestId: "foreign" }),
      outcome("not_committed", { organizationId: "foreign" }),
      outcome("not_committed", { simulationReceiptId: `ccs_${"d".repeat(48)}` }),
      outcome("not_committed", { baseRevisionId: "v0018" }),
      { activeRevisionId: "v0018" }
    ]) expect(recovery.resolveCommercialApplyRecovery(sessionStorage, identity, invalid)).toBe(false);
    expect(recovery.readCommercialApplyRecovery(sessionStorage, scope)).toEqual(identity);
    expect(recovery.resolveCommercialApplyRecovery(sessionStorage, identity, outcome())).toBe(true);
    expect(recovery.readCommercialApplyRecovery(sessionStorage, scope)).toBeNull();
    recovery.recordCommercialApplyRecovery(sessionStorage, identity);
    expect(recovery.resolveCommercialApplyRecovery(sessionStorage, identity, outcome("committed"))).toBe(true);
  });
});

describe("commercial apply recovery lifetime", () => {
  let current;
  function Harness({ activeScope = scope, ready = true }) {
    current = recovery.useCommercialApplyRecovery({ ...activeScope, ready, storage: sessionStorage });
    return React.createElement("p", null, current.pending?.applyRequestId || "ready");
  }
  test("restores before new apply is eligible and clears only on auth scope change", async () => {
    expect(recovery.useCommercialApplyRecovery).toBeTypeOf("function");
    recovery.recordCommercialApplyRecovery(sessionStorage, identity);
    act(() => root.render(React.createElement(Harness, { ready: false, activeScope: {} })));
    expect(sessionStorage.length).toBe(1);
    act(() => root.render(React.createElement(Harness)));
    expect(current.pending).toEqual(identity);
    expect(current.restored).toBe(true);
    expect(current.blocked).toBe(true);
    act(() => root.render(React.createElement(Harness, { activeScope: { ...scope, quoteId: "quote-two" } })));
    expect(current.pending).toBeNull();
    expect(recovery.readCommercialApplyRecovery(sessionStorage, scope)).toEqual(identity);
    act(() => root.render(React.createElement(Harness, { activeScope: { ...scope, principalId: "staff-two" } })));
    expect(recovery.readCommercialApplyRecovery(sessionStorage, scope)).toBeNull();
  });

  test("retains failed reconciliation and rejects late completion after switching quote", async () => {
    expect(recovery.useCommercialApplyRecovery).toBeTypeOf("function");
    recovery.recordCommercialApplyRecovery(sessionStorage, identity);
    act(() => root.render(React.createElement(Harness)));
    await act(async () => {
      await expect(current.reconcile(async () => { throw Error("Offline"); })).rejects.toThrow("Offline");
    });
    expect(current.pending).toEqual(identity);
    let finish;
    let pending;
    act(() => { pending = current.reconcile(() => new Promise(resolve => { finish = resolve; })); });
    act(() => root.render(React.createElement(Harness, { activeScope: { ...scope, quoteId: "quote-two" } })));
    await act(async () => { finish(outcome()); expect(await pending).toBeNull(); });
    expect(current.outcome).toBeNull();
    expect(recovery.readCommercialApplyRecovery(sessionStorage, scope)).toEqual(identity);
  });

  test("reconciles original base and request once while blocked, without any apply dispatch", async () => {
    expect(recovery.useCommercialApplyRecovery).toBeTypeOf("function");
    recovery.recordCommercialApplyRecovery(sessionStorage, identity);
    act(() => root.render(React.createElement(Harness)));
    let finish;
    let received;
    let first;
    act(() => { first = current.reconcile(input => {
      received = input;
      return new Promise(resolve => { finish = resolve; });
    }); });
    expect(current.busy).toBe(true);
    expect(await current.reconcile(() => { throw Error("Duplicate request"); })).toBeNull();
    expect(received).toEqual({
      organizationId: "org-one", quoteId: "quote-one",
      simulationReceiptId: identity.simulationReceiptId,
      authorizationReceiptId: identity.authorizationReceiptId,
      applyRequestId: identity.applyRequestId, expectedBaseRevisionId: "v0017"
    });
    await act(async () => { finish(outcome()); await first; });
    expect(current.pending).toBeNull();
    expect(current.blocked).toBe(false);
    expect(current.outcome.outcomeReceipt.state).toBe("not_committed");
  });
  test("claims persistent identity before allocating a request, including two clicks before rerender", () => {
    act(() => root.render(React.createElement(Harness)));
    let allocations = 0;
    const allocate = () => { allocations++; return identity.applyRequestId; };
    const input = { simulationReceiptId: identity.simulationReceiptId, authorizationReceiptId: identity.authorizationReceiptId, expectedBaseRevisionId: "v0017" };
    act(() => {
      expect(current.begin(input, allocate)?.applyRequestId).toBe(identity.applyRequestId);
      expect(current.begin(input, allocate)).toBeNull();
    });
    expect(allocations).toBe(1);
    const old = current;
    act(() => root.render(React.createElement(Harness, { activeScope: { ...scope, quoteId: "quote-two" } })));
    expect(old.isCurrent()).toBe(false);
    expect(old.begin(input, allocate)).toBeNull();
    expect(allocations).toBe(1);
  });
  test("quick-update dispatch on another surface scopes retention and reconciliation to the exact submitted quote", async () => {
    act(() => root.render(React.createElement(Harness, { activeScope: { ...scope, quoteId: "" } })));
    let saved;
    act(() => { saved = current.begin({
      quoteId: "quote-one", simulationReceiptId: identity.simulationReceiptId,
      authorizationReceiptId: identity.authorizationReceiptId, expectedBaseRevisionId: "v0017"
    }, () => identity.applyRequestId); });
    expect(saved?.quoteId).toBe("quote-one");
    expect(current.getPending("quote-one").applyRequestId).toBe(identity.applyRequestId);
    expect(current.getPending("quote-two")).toBeNull();
    await act(async () => {
      await current.reconcileQuote("quote-one", async input => {
        expect(input.quoteId).toBe("quote-one");
        expect(input.expectedBaseRevisionId).toBe("v0017");
        return outcome();
      });
    });
    expect(current.getPending("quote-one")).toBeNull();
    expect(current.outcome.outcomeReceipt.quoteId).toBe("quote-one");
  });
  test("an auth switch on a surface without a quote invalidates the old quick-update command", () => {
    act(() => root.render(React.createElement(Harness, { activeScope: { ...scope, quoteId: "" } })));
    const old = current;
    act(() => root.render(React.createElement(Harness, { activeScope: { ...scope, quoteId: "", principalId: "staff-two" } })));
    expect(old.isCurrent()).toBe(false);
    expect(old.begin({ quoteId: "quote-one", simulationReceiptId: identity.simulationReceiptId, expectedBaseRevisionId: "v0017" }, () => identity.applyRequestId)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
});
