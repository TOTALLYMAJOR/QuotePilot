import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { recordCommercialApplyRecovery, readCommercialApplyRecovery } from "../../lib/commercialApplyRecovery";

function handler(path, start, end, dependencies) {
  const source = readFileSync(path, "utf8");
  const from = source.indexOf(`  const ${start} =`);
  const to = source.indexOf(`  ${end}`, from);
  if (from < 0 || to < 0) throw Error("Handler boundary unavailable");
  const body = source.slice(from, to).replace(/await import\([\s\S]*?\)/gu, "await Promise.resolve(api)");
  return new Function(...Object.keys(dependencies), `${body}\nreturn ${start};`)(...Object.values(dependencies));
}
const original = {
  organizationId: "org-one", quoteId: "quote-one", principalId: "staff-one",
  simulationReceiptId: `ccs_${"a".repeat(48)}`, authorizationReceiptId: "",
  applyRequestId: `change_apply_${"c".repeat(32)}`, expectedBaseRevisionId: "v0017"
};
const savedForm = { name: "Private customer", email: "private@example.com", menuItems: ["menu-one"], guests: 50, eventTypeId: "event", date: "2026-10-20", eventName: "Dinner", venue: "Venue", style: "buffet" };
function saveDependencies(commercialApplyRecovery, updateQuote) {
  const noop = () => {};
  return {
    commercialApplyRecovery, updateQuote,
    form: savedForm, totals: { guests: 50, total: 100 }, calculateQuote: () => ({ guests: 50, total: 100 }),
    editingQuote: { id: "quote-one", organizationId: "org-one", activeVersionId: "v0017" },
    isEditingQuote: true, quoteEditRouteId: "quote-one", quoteEditReady: true,
    commercialChangeAuthority: null, changeImpactPreviewAvailable: true,
    authSession: { organizationId: "org-one", user: { uid: "staff-one" } },
    selectedMenuItemCount: 1, catalogRevisionReview: { review: null }, catalog: { source: "firebase", settings: {} }, effectiveSettings: {},
    pilotScenarioDraftReview: null, ambientDraftIntentReview: null, quoteDirty: false,
    setSubmitState: noop, setChangeImpactPreview: noop, setAvailabilityBlock: noop, setAvailabilityNotice: noop,
    scheduleCapacityLimit: 100, checkEventAvailability: async () => ({ conflicts: [], hasBlockingConflict: false }),
    E2E_ALLOW_NON_AUTHORITATIVE_PRICING: false, buildCurrentPricingInput: () => ({}),
    calculateQuotePricing: async () => ({ pricing: { grandTotal: 100 } }), buildTotalsFromPricingSnapshot: () => ({ guests: 50, total: 100 }),
    toNumber: (value, fallback) => Number(value ?? fallback), currency: String,
    withTimeout: promise => promise, SAVE_FLOW_TIMEOUT_MS: 5000, recordDiagnosticError: noop, pushToast: noop,
    api: { buildCommercialChangeRequestId: () => original.applyRequestId }
  };
}
for (const path of ["src/App.jsx", "src/LegacyApp.jsx"]) describe(`${path} recovery wiring`, () => {
  test("a stale write response cannot project, reconcile, or escape to caller readback", async () => {
    let current = true;
    const callback = vi.fn();
    const reconcileQuote = vi.fn();
    const recovery = { getPending: () => null, begin: request => request, isCurrent: () => current, reconcileQuote };
    const dependencies = saveDependencies(recovery, async () => { current = false; return { id: "quote-one", activeVersionId: "v0018" }; });
    const submit = handler(path, "handleSubmitQuote", path === "src/App.jsx" ? "const quickUpdateFailure" : "const handleEditQuote", dependencies);
    const result = await submit({ commercialChangeAuthority: original, propagateError: true, onPersistenceResolved: callback });
    expect(result).toBeNull();
    expect(callback).not.toHaveBeenCalled();
    expect(reconcileQuote).not.toHaveBeenCalled();
  });
  test("a terminal not-committed receipt overrides an earlier successful write response", async () => {
    const callback = vi.fn();
    const terminal = { outcomeReceipt: { state: "not_committed", requestId: original.applyRequestId } };
    const recovery = { getPending: () => null, begin: request => request, isCurrent: () => true, reconcileQuote: async () => terminal };
    const dependencies = saveDependencies(recovery, async () => ({ id: "quote-one", activeVersionId: "v0018" }));
    const submit = handler(path, "handleSubmitQuote", path === "src/App.jsx" ? "const quickUpdateFailure" : "const handleEditQuote", dependencies);
    await expect(submit({ commercialChangeAuthority: original, propagateError: true, onPersistenceResolved: callback })).rejects.toMatchObject({ code: "apply-not-committed", commercialApplyOutcome: terminal });
    expect(callback).not.toHaveBeenCalled();
  });
  test.each(["not-current", "contradictory", "offline"])("a %s terminal lookup cannot report write success or call readback", async failure => {
    const callback = vi.fn();
    const recovery = { getPending: () => null, begin: request => request, isCurrent: () => true,
      reconcileQuote: async () => {
        if (failure !== "not-current") throw Error(failure);
        return { outcomeReceipt: { state: "committed", appliedRevisionIsActive: false, newRevisionId: "v0018" } };
      } };
    const dependencies = saveDependencies(recovery, async () => ({ id: "quote-one", activeVersionId: "v0018" }));
    const submit = handler(path, "handleSubmitQuote", path === "src/App.jsx" ? "const quickUpdateFailure" : "const handleEditQuote", dependencies);
    await expect(submit({ commercialChangeAuthority: original, propagateError: true, onPersistenceResolved: callback })).rejects.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });
  test("restored Quick Updates reconciles on the home surface without entering the editor", async () => {
    const send = vi.fn(async () => ({ outcomeReceipt: { state: "not_committed" } }));
    const previewUpdate = vi.fn();
    const reconcile = handler(path, "handleReconcileCommercialChangeApplyOutcome", "const handleRecoverCommercialChangeApply", {
      commercialApplyRecovery: { busy: false, isCurrent: () => true, reconcile: send }, isEditingQuote: false,
      api: { reconcileCommercialQuoteChangeApplyOutcome: vi.fn() }, setChangeImpactPreview: previewUpdate,
      recordDiagnosticError: vi.fn()
    });
    await reconcile();
    expect(send).toHaveBeenCalledOnce();
    expect(previewUpdate).not.toHaveBeenCalled();
  });
  test("refresh and reconnect on home reconcile restored identity without a preview or apply action", () => {
    const source = readFileSync(path, "utf8");
    const from = source.indexOf("  const commercialApplyRecovery =");
    const to = source.indexOf("  const inventoryRecipeExtension =", from);
    const reconcile = vi.fn();
    const events = new EventTarget();
    const cleanups = [];
    const previewUpdate = vi.fn();
    const dependencies = {
      useCommercialApplyRecovery: () => ({ pending: original, restored: true }),
      useEffect: effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
      authSession: { organizationId: "org-one", user: { uid: "staff-one" }, loading: false }, tenantContext: { ready: true },
      isEditingQuote: false, editingQuote: { id: "" }, changeImpactPreview: {}, setChangeImpactPreview: previewUpdate,
      handleReconcileCommercialChangeApplyOutcome: reconcile, window: events, navigator: { onLine: true }
    };
    new Function(...Object.keys(dependencies), source.slice(from, to))(...Object.values(dependencies));
    expect(reconcile).toHaveBeenCalledOnce();
    expect(previewUpdate).not.toHaveBeenCalled();
    events.dispatchEvent(new Event("online"));
    expect(reconcile).toHaveBeenCalledTimes(2);
    cleanups.forEach(cleanup => cleanup());
  });
  test("unresolved recovery blocks simulation before request allocation or dispatch", async () => {
    const simulate = vi.fn(async () => ({ simulationReceipt: { receiptId: "new-simulation" } }));
    const reconcile = vi.fn();
    const preview = handler(path, "handlePreviewChangeImpact", "useEffect(() => {", {
      commercialApplyRecovery: { blocked: true, pending: original },
      handleReconcileCommercialChangeApplyOutcome: reconcile,
      api: { buildCommercialChangeRequestId: () => "new-simulation", simulateCommercialQuoteChange: simulate, isDefinitiveCommercialChangeError: () => false },
      form: {}, isEditingQuote: true, editingQuote: { id: "quote-one", baseForm: {}, activeVersionId: "v0018" },
      normalizeLivingTwinProjectionRequest: () => null, livingTwinScopeKey: "scope", changeImpactPreview: {},
      changeImpactPreviewGenerationRef: { current: 0 }, isGuestCountOnlyProposal: () => false,
      currentChangeImpactFormKey: "{}", eventIngredientProjection: { access: { readEnabled: false } },
      eventIngredientPreviewInput: { valid: false, selections: [] }, buildLivingCommercialTwinInventoryFingerprint: () => "fingerprint",
      setChangeImpactPreview: () => {}, authSession: { organizationId: "org-one" }, attendanceChange: null,
      catalog: { settings: {} }, recordDiagnosticError: () => {}
    });
    await preview();
    expect(simulate).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledOnce();
  });
  test("unresolved recovery cannot allocate or dispatch another apply", async () => {
    const allocate = vi.fn(() => "new-apply");
    const submit = vi.fn(async () => null);
    const reconcile = vi.fn();
    const apply = handler(path, "handleApplyCommercialChange", path === "src/App.jsx" ? "const handleApplyAmbientDraftIntent" : "const handleSubmitQuote", {
      commercialApplyRecovery: { blocked: true, pending: original },
      changeImpactPreview: { authorityState: "enforced", authorizationRequired: false },
      changeImpactScopeIsCurrent: () => true,
      handleReconcileCommercialChangeApplyOutcome: reconcile,
      api: { buildCommercialChangeRequestId: allocate, isDefinitiveCommercialChangeError: () => false },
      setChangeImpactPreview: () => {}, handleSubmitQuote: submit
    });
    await apply();
    expect(allocate).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledOnce();
  });
  test("restored reconciliation sends retained base identity even after active revision changed", async () => {
    let received;
    const reconcile = handler(path, "handleReconcileCommercialChangeApplyOutcome", "const handleRecoverCommercialChangeApply", {
      commercialApplyRecovery: {
        pending: original, busy: false, isCurrent: () => true,
        reconcile: send => send({ organizationId: "org-one", quoteId: "quote-one", simulationReceiptId: original.simulationReceiptId,
          authorizationReceiptId: "", applyRequestId: original.applyRequestId, expectedBaseRevisionId: "v0017" })
      },
      isEditingQuote: true, editingQuote: { id: "quote-one", activeVersionId: "v0018" },
      changeImpactPreview: { simulationReceiptId: original.simulationReceiptId, authorizationReceiptId: "", applyRequestId: original.applyRequestId },
      authSession: { organizationId: "org-one" }, setChangeImpactPreview: () => {},
      api: {
        reconcileCommercialQuoteChangeApplyOutcome: async input => { received = input; return { outcomeReceipt: { state: "not_committed" } }; },
        isDefinitiveCommercialChangeError: () => false
      },
      recordDiagnosticError: () => {}
    });
    await reconcile();
    expect(received.expectedBaseRevisionId).toBe("v0017");
    expect(received.applyRequestId).toBe(original.applyRequestId);
  });
  test("ordinary apply delegates identity allocation to the shared persistence seam", async () => {
    const order = [];
    const dependencies = {
      commercialApplyRecovery: { blocked: false, pending: null, isCurrent: () => true },
      changeImpactPreview: { simulationReceiptId: original.simulationReceiptId, model: { identity: { beforeRevisionId: "v0017" } } },
      changeImpactScopeIsCurrent: () => true, handleReconcileCommercialChangeApplyOutcome: async () => {},
      api: { buildCommercialChangeRequestId: () => { order.push("allocate"); return original.applyRequestId; }, isDefinitiveCommercialChangeError: () => false },
      setChangeImpactPreview: () => {}, editingQuote: { id: "quote-one", activeVersionId: "v0018" },
      handleSubmitQuote: async request => { order.push("shared-seam"); expect(request.commercialChangeAuthority.applyRequestId).toBe(""); return null; }
    };
    const end = path === "src/App.jsx" ? "const handleApplyAmbientDraftIntent" : "const handleSubmitQuote";
    await handler(path, "handleApplyCommercialChange", end, dependencies)();
    expect(order).toEqual(["shared-seam"]);
  });
  test("late outcome failures after changing auth or quote do not update the current editor", async () => {
    let changed = false;
    const updates = [];
    const reconcile = handler(path, "handleReconcileCommercialChangeApplyOutcome", "const handleRecoverCommercialChangeApply", {
      commercialApplyRecovery: {
        pending: original, busy: false, isCurrent: () => !changed,
        reconcile: async () => { changed = true; throw Error("Late rejected outcome"); }
      },
      isEditingQuote: true, editingQuote: { id: "quote-one", activeVersionId: "v0018" }, changeImpactPreview: {},
      setChangeImpactPreview: update => updates.push(update({})),
      api: { reconcileCommercialQuoteChangeApplyOutcome: () => {}, isDefinitiveCommercialChangeError: () => false },
      recordDiagnosticError: () => {}
    });
    await reconcile();
    expect(updates).toHaveLength(1);
    expect(updates[0].mutationState).toBe("reconciliation");
  });
  test("local quote fallback keeps its existing save validation without requiring recovery storage", async () => {
    const missingMenu = vi.fn();
    const updates = [];
    const submit = handler(path, "handleSubmitQuote", path === "src/App.jsx" ? "const quickUpdateFailure" : "const handleEditQuote", {
      commercialApplyRecovery: { blocked: true, pending: null }, changeImpactPreviewAvailable: false,
      form: { menuItems: [] }, editingQuote: { id: "local-quote" }, isEditingQuote: true,
      totals: {}, quoteEditRouteId: "", quoteEditReady: true, catalogRevisionReview: { review: null }, quoteDirty: false,
      selectedMenuItemCount: 0, setSubmitState: update => updates.push(update({})),
      showMissingMenuSelection: missingMenu, clearPilotScenarioDraftReview: () => {},
      ambientDraftIntentReview: null, pendingLivingTwinConsequenceRequest: null, pilotScenarioDraftReview: null
    });
    await submit();
    expect(missingMenu).toHaveBeenCalledOnce();
    expect(updates).toEqual([]);
  });
  test("reconnect retries the retained uncertain apply without resubmitting the edit", () => {
    const source = readFileSync(path, "utf8");
    const from = source.indexOf("  const commercialApplyRecovery =");
    const to = source.indexOf("  const inventoryRecipeExtension =", from);
    const reconcile = vi.fn();
    const events = new EventTarget();
    const cleanups = [];
    const dependencies = {
      useCommercialApplyRecovery: () => ({ pending: original, restored: false }),
      useEffect: effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
      authSession: { organizationId: "org-one", user: { uid: "staff-one" }, loading: false },
      tenantContext: { ready: true },
      isEditingQuote: true, editingQuote: { id: "quote-one" },
      changeImpactPreview: { mutationState: "uncertain", mutationKind: "apply" },
      setChangeImpactPreview: () => {}, handleReconcileCommercialChangeApplyOutcome: reconcile,
      window: events, navigator: { onLine: true }
    };
    new Function(...Object.keys(dependencies), source.slice(from, to))(...Object.values(dependencies));
    expect(reconcile).not.toHaveBeenCalled();
    events.dispatchEvent(new Event("online"));
    expect(reconcile).toHaveBeenCalledOnce();
    cleanups.forEach(cleanup => cleanup());
    events.dispatchEvent(new Event("online"));
    expect(reconcile).toHaveBeenCalledOnce();
  });
  test("shared governed dispatch retains the exact identity on interrupted write and rejects any second application", async () => {
    const entries = new Map();
    const storage = { get length() { return entries.size; }, key: index => [...entries.keys()][index], getItem: key => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
    const authority = { simulationReceiptId: original.simulationReceiptId, authorizationReceiptId: "", applyRequestId: original.applyRequestId };
    const recovery = {
      blocked: false, pending: null, isCurrent: () => true,
      getPending: target => readCommercialApplyRecovery(storage, { organizationId: "org-one", principalId: "staff-one", quoteId: target }),
      begin: (request, allocate) => recordCommercialApplyRecovery(storage, {
        ...request, organizationId: "org-one", principalId: "staff-one",
        applyRequestId: request.applyRequestId || allocate(),
        schemaVersion: "commercial-apply-recovery-v1", recordedAtISO: "2026-10-11T00:00:00.000Z"
      })
    };
    const writes = [];
    const dependencies = saveDependencies(recovery, async input => {
      writes.push(input);
      expect(recovery.getPending(input.quoteId).applyRequestId).toBe(original.applyRequestId);
      throw Error("Interrupted apply response");
    });
    const submit = handler(path, "handleSubmitQuote", path === "src/App.jsx" ? "const quickUpdateFailure" : "const handleEditQuote", dependencies);
    await expect(submit({ commercialChangeAuthority: authority, propagateError: true })).rejects.toThrow("Interrupted apply response");
    expect(writes).toHaveLength(1);
    expect(recovery.getPending("quote-one").expectedBaseRevisionId).toBe("v0017");
    expect(Object.keys(JSON.parse([...entries.values()][0]))).not.toContain("form");
    await expect(submit({ commercialChangeAuthority: { ...authority, applyRequestId: `change_apply_${"d".repeat(32)}` }, propagateError: true })).rejects.toThrow(/previous apply outcome/i);
    expect(writes).toHaveLength(1);
  });
});
test("quick-update review cannot allocate a second request after refresh restores an unresolved apply", async () => {
  const allocate = vi.fn();
  const prepare = vi.fn();
  const preview = handler("src/App.jsx", "handlePreviewQuickUpdate", "const handleSaveQuickUpdate", {
    commercialApplyRecovery: { getPending: target => target === "quote-one" ? original : null },
    quickUpdateFailure: (status, code, reason, nextResolution, recovery) => ({ status, code, ...recovery }),
    prepareQuickUpdateCandidate: prepare, api: { buildCommercialChangeRequestId: allocate }, recordDiagnosticError: () => {}
  });
  const result = await preview({ organizationId: "org-one", quoteId: "quote-one" });
  expect(result.status).toBe("uncertain");
  expect(result.action).toBe("reconcile_only");
  expect(allocate).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});
test("quick-update save restores an unresolved request before candidate reload or a second write", async () => {
  const prepare = vi.fn();
  const submit = vi.fn();
  const save = handler("src/App.jsx", "handleSaveQuickUpdate", "const handleOpenQuickUpdatesLibrary", {
    commercialApplyRecovery: { getPending: target => target === "quote-one" ? original : null },
    quickUpdateFailure: (status, code, reason, nextResolution, recovery) => ({ status, code, ...recovery }),
    prepareQuickUpdateCandidate: prepare, handleSubmitQuote: submit, recordDiagnosticError: () => {}
  });
  const result = await save({ organizationId: "org-one", quoteId: "quote-one" });
  expect(result.status).toBe("uncertain");
  expect(result.action).toBe("reconcile_only");
  expect(prepare).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
test("quick-update cannot reuse a resolved preview even after the pending envelope was cleared", async () => {
  const prepare = vi.fn();
  const save = handler("src/App.jsx", "handleSaveQuickUpdate", "const handleOpenQuickUpdatesLibrary", {
    commercialApplyRecovery: { getPending: () => null, requiresFreshPreview: () => true },
    quickUpdateFailure: (status, code, reason, nextResolution, recovery) => ({ status, code, ...recovery }),
    prepareQuickUpdateCandidate: prepare, recordDiagnosticError: vi.fn()
  });
  const result = await save({ quoteId: "quote-one", preview: { status: "ready", simulationReceiptId: original.simulationReceiptId, applyRequestId: original.applyRequestId } });
  expect(result.status).toBe("conflict");
  expect(result.code).toBe("fresh-preview-required");
  expect(prepare).not.toHaveBeenCalled();
});
test("quick-update's shared dispatch binds the submitted quote and base instead of the open editor", async () => {
  let retained;
  let dispatched;
  const recovery = {
    getPending: () => null, isCurrent: () => true,
    begin: request => { retained = request; return request; }
  };
  const dependencies = saveDependencies(recovery, async input => { dispatched = input; throw Error("Interrupted quick-update response"); });
  const submit = handler("src/App.jsx", "handleSubmitQuote", "const quickUpdateFailure", dependencies);
  await expect(submit({
    commercialChangeAuthority: { simulationReceiptId: original.simulationReceiptId, authorizationReceiptId: "", applyRequestId: original.applyRequestId },
    propagateError: true, manageEditorState: false, navigateAfterSave: false,
    explicitDraft: { form: savedForm, editingQuote: { id: "quote-two", organizationId: "org-one", activeVersionId: "v0027" }, expectedActiveVersionId: "v0027" }
  })).rejects.toThrow("Interrupted quick-update response");
  expect(retained.quoteId).toBe("quote-two");
  expect(retained.expectedBaseRevisionId).toBe("v0027");
  expect(dispatched.quoteId).toBe("quote-two");
  expect(dispatched.expectedActiveVersionId).toBe("v0027");
  expect(dispatched.commercialChangeAuthority.applyRequestId).toBe(original.applyRequestId);
});
