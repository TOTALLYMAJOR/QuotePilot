// @vitest-environment jsdom
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import KitchenBeoArtifactPanel, {
  buildKitchenBeoFreshnessPresentation,
  buildKitchenBeoMutationPresentation,
  KitchenBeoMutationStatus
} from "../KitchenBeoArtifactPanel";

const client = vi.hoisted(() => ({
  downloadKitchenBeoArtifact: vi.fn(),
  generateKitchenBeo: vi.fn(),
  getKitchenBeoArtifactStatus: vi.fn(),
  getKitchenBeoReceiptArtifact: vi.fn(),
  isDefinitiveKitchenBeoError: vi.fn(),
  readPendingKitchenBeoAttempt: vi.fn(),
  resetDefinitiveKitchenBeoAttempt: vi.fn()
}));

vi.mock("../../lib/kitchenBeoClient", () => client);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SCOPE = Object.freeze({ organizationId: "org-one", quoteId: "quote-one" });
const ARTIFACT = Object.freeze({
  mimeType: "application/pdf",
  filename: "Q-100-kitchen-beo.pdf",
  base64: "JVBERi0xLjQ="
});

function historyReceipt(receiptId = `beo_${"b".repeat(48)}`, overrides = {}) {
  return {
    receiptId,
    requestId: `beo_request_${"c".repeat(32)}`,
    commercialSourceRevisionId: "v0007",
    dependencyFingerprint: "b".repeat(64),
    generatedAtISO: "2026-08-09T17:30:00.000Z",
    filename: ARTIFACT.filename,
    artifactByteLength: 12,
    generatedBy: { email: "sales@example.test", role: "sales" },
    current: true,
    ...overrides
  };
}

function status(state = "CURRENT", overrides = {}) {
  const generated = state !== "NOT_GENERATED";
  return {
    schemaVersion: "kitchen-beo-artifact-status-v1",
    authority: "server_derived",
    state,
    observedAtISO: "2026-08-09T17:30:00.000Z",
    reasonCodes: state === "CURRENT"
      ? ["trusted_receipt_matches_canonical_source"]
      : state === "NOT_GENERATED"
        ? ["trusted_receipt_missing"]
        : ["declared_inputs_changed"],
    currentDependencyFingerprint: "a".repeat(64),
    receiptId: state === "NOT_GENERATED" ? "" : `beo_${"b".repeat(48)}`,
    receiptDependencyFingerprint: state === "NOT_GENERATED" ? "" : "b".repeat(64),
    commercialSourceRevisionId: state === "NOT_GENERATED" ? "" : "v0007",
    unresolvedInvalidationIds: [],
    receiptHistory: generated
      ? {
        schemaVersion: 1,
        authority: "server_projection",
        state: "COMPLETE",
        bounds: { limit: 10, returnedCount: 1, truncated: false },
        reasonCodes: ["receipt_history_complete"],
        receipts: [historyReceipt()]
      }
      : {
        schemaVersion: 1,
        authority: "server_projection",
        state: "COMPLETE",
        bounds: { limit: 10, returnedCount: 0, truncated: false },
        reasonCodes: ["no_generation_receipts"],
        receipts: []
      },
    ...overrides
  };
}

function result(overrides = {}) {
  const currentStatus = status("CURRENT");
  return {
    ok: true,
    storage: "firebase",
    ...SCOPE,
    idempotent: false,
    mutationMode: "submitting",
    receipt: {
      receiptId: `beo_${"b".repeat(48)}`,
      requestId: `beo_request_${"c".repeat(32)}`,
      generatedAtISO: "2026-08-09T17:30:00.000Z"
    },
    status: currentStatus,
    dependencyReconciliation: null,
    artifact: ARTIFACT,
    ...overrides
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let container;
let root;
let pendingAttempt;

function mount(props = {}) {
  act(() => {
    root.render(
      <KitchenBeoArtifactPanel
        open
        presentation="embedded"
        {...SCOPE}
        quoteNumber="Q-100"
        {...props}
      />
    );
  });
}

function action(name) {
  return container.querySelector(`[data-capability-action="${name}"]`);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickAndFlush(button) {
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  pendingAttempt = null;
  client.downloadKitchenBeoArtifact.mockReset();
  client.generateKitchenBeo.mockReset();
  client.getKitchenBeoArtifactStatus.mockReset();
  client.getKitchenBeoReceiptArtifact.mockReset();
  client.isDefinitiveKitchenBeoError.mockReset();
  client.readPendingKitchenBeoAttempt.mockReset();
  client.resetDefinitiveKitchenBeoAttempt.mockReset();
  client.getKitchenBeoArtifactStatus.mockResolvedValue(status());
  client.getKitchenBeoReceiptArtifact.mockResolvedValue({
    ok: true,
    storage: "firebase",
    ...SCOPE,
    receipt: {
      receiptId: status().receiptId,
      filename: ARTIFACT.filename
    },
    artifact: ARTIFACT
  });
  client.readPendingKitchenBeoAttempt.mockImplementation(() => pendingAttempt);
  client.isDefinitiveKitchenBeoError.mockImplementation((error) => new Set([
    "functions/already-exists",
    "functions/failed-precondition",
    "functions/invalid-argument",
    "functions/not-found",
    "functions/permission-denied",
    "functions/unauthenticated"
  ]).has(error?.code));
  client.resetDefinitiveKitchenBeoAttempt.mockImplementation(() => {
    if (!pendingAttempt?.definitive) return false;
    pendingAttempt = null;
    return true;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Kitchen BEO presentation contracts", () => {
  test.each([
    ["CURRENT", "confirmed", "Matches the current canonical source"],
    ["STALE", "failed", "Do not use this BEO for production"],
    ["REVIEW", "action", "A dependent decision requires review"],
    ["NOT_GENERATED", "info", "No trusted Kitchen BEO receipt"],
    ["UNKNOWN", "blocked", "Freshness cannot be established"]
  ])("maps %s without weakening its commercial meaning", (stateName, family, title) => {
    expect(buildKitchenBeoFreshnessPresentation(status(stateName))).toMatchObject({
      state: stateName,
      family,
      title
    });
  });

  test("fails an unrecognized status closed as UNKNOWN", () => {
    expect(buildKitchenBeoFreshnessPresentation({ state: "probably-fine" })).toMatchObject({
      state: "UNKNOWN",
      family: "blocked"
    });
  });

  test.each([
    ["ready", "generate", "Generate Kitchen BEO"],
    ["submitting", "none", "Generating…"],
    ["uncertain", "reconcile", "Reconcile exact generation"],
    ["reconciliation", "none", "Reconciling…"],
    ["receipt", "download", "Download PDF again"],
    ["error", "reset", "Reset rejected attempt"],
    ["recovery", "generate", "Start new generation"]
  ])("maps governed mutation state %s", (stateName, expectedAction, expectedLabel) => {
    expect(buildKitchenBeoMutationPresentation({ state: stateName })).toMatchObject({
      state: stateName,
      action: expectedAction,
      actionLabel: expectedLabel
    });
  });
});

describe("KitchenBeoArtifactPanel", () => {
  test("does not read or render while closed", () => {
    mount({ open: false });
    expect(container.innerHTML).toBe("");
    expect(client.getKitchenBeoArtifactStatus).not.toHaveBeenCalled();
  });

  test.each(["CURRENT", "STALE", "REVIEW", "NOT_GENERATED", "UNKNOWN"])(
    "loads and renders the exact %s freshness state",
    async (stateName) => {
      client.getKitchenBeoArtifactStatus.mockResolvedValue(status(stateName));
      mount();
      expect(container.querySelector('[data-capability-state="loading"]')).not.toBeNull();
      await flush();

      expect(client.getKitchenBeoArtifactStatus).toHaveBeenCalledWith(SCOPE);
      const expectedReadState = stateName === "NOT_GENERATED"
        ? "empty"
        : stateName === "UNKNOWN" ? "partial" : "success";
      expect(container.querySelector(`[data-capability-state="${expectedReadState}"]`)).not.toBeNull();
      expect(container.querySelector(`[data-beo-freshness-state="${stateName}"]`)).not.toBeNull();
      expect(container.textContent).toContain("server generation, freshness, kitchen review, publication, and operational completion are separate facts");
      expect(container.textContent).toContain("changes no proposal acceptance, booking, payment, portal, or customer-message state");
    }
  );

  test("retains the previous status as stale when refresh fails", async () => {
    mount();
    await flush();
    expect(container.querySelector('[data-beo-freshness-state="CURRENT"]')).not.toBeNull();

    client.getKitchenBeoArtifactStatus.mockRejectedValueOnce(new Error("network detail"));
    await clickAndFlush(action("refresh-status"));

    expect(container.querySelector('[data-capability-id="cwf-15-kitchen-beo-artifact-status"]')
      .getAttribute("data-capability-state")).toBe("stale");
    expect(container.querySelector('[data-beo-freshness-state="CURRENT"]')).not.toBeNull();
    expect(container.textContent).toContain("previous result remains visible");
    expect(container.textContent).not.toContain("network detail");
    expect(action("retry-status").getAttribute("data-capability-state")).toBe("recovery");
  });

  test("renders an initial read error and an explicit retry recovery state", async () => {
    client.getKitchenBeoArtifactStatus.mockRejectedValueOnce(new Error("private backend detail"));
    mount();
    await flush();
    expect(container.querySelector('[data-capability-id="cwf-15-kitchen-beo-artifact-status"]')
      .getAttribute("data-capability-state")).toBe("error");
    expect(container.textContent).not.toContain("private backend detail");

    const retry = deferred();
    client.getKitchenBeoArtifactStatus.mockReturnValueOnce(retry.promise);
    act(() => action("retry-status").click());
    expect(container.querySelector('[data-capability-id="cwf-15-kitchen-beo-artifact-status"]')
      .getAttribute("data-capability-state")).toBe("recovery");
    await act(async () => {
      retry.resolve(status("NOT_GENERATED"));
      await retry.promise;
    });
    expect(container.querySelector('[data-capability-state="empty"]')).not.toBeNull();
    expect(container.querySelector('[data-beo-freshness-state="NOT_GENERATED"]')).not.toBeNull();
  });

  test("downloads exact prior receipt bytes without creating a new generation receipt", async () => {
    const priorReceiptId = `beo_${"d".repeat(48)}`;
    client.getKitchenBeoArtifactStatus.mockResolvedValueOnce(status("CURRENT", {
      receiptHistory: {
        schemaVersion: 1,
        authority: "server_projection",
        state: "PARTIAL",
        bounds: { limit: 10, returnedCount: 2, truncated: true },
        reasonCodes: ["receipt_history_bound_reached"],
        receipts: [
          historyReceipt(),
          historyReceipt(priorReceiptId, {
            requestId: `beo_request_${"d".repeat(32)}`,
            generatedAtISO: "2026-08-08T17:30:00.000Z",
            current: false
          })
        ]
      }
    }));
    client.getKitchenBeoReceiptArtifact.mockResolvedValueOnce({
      ok: true,
      storage: "firebase",
      ...SCOPE,
      receipt: { receiptId: priorReceiptId, filename: ARTIFACT.filename },
      artifact: ARTIFACT
    });
    mount();
    await flush();
    const priorDownload = container.querySelector(
      `[data-capability-action="download-receipt"][data-receipt-id="${priorReceiptId}"]`
    );
    expect(priorDownload).not.toBeNull();
    expect(container.textContent).toContain("Prior receipt");
    expect(container.textContent).toContain("Older generation receipts may exist");
    await clickAndFlush(priorDownload);

    expect(client.getKitchenBeoReceiptArtifact).toHaveBeenCalledWith({
      ...SCOPE,
      receiptId: priorReceiptId
    });
    expect(client.generateKitchenBeo).not.toHaveBeenCalled();
    expect(client.downloadKitchenBeoArtifact).toHaveBeenCalledWith(ARTIFACT);
    expect(container.textContent).toContain("Exact receipt bytes downloaded");
    expect(container.textContent).toContain("Opening or use is not proven");
  });

  test("shows submitting, records the exact receipt, and starts the returned PDF download", async () => {
    const generation = deferred();
    const onGenerated = vi.fn();
    const onStatusChange = vi.fn();
    client.generateKitchenBeo.mockReturnValueOnce(generation.promise);
    mount({ onGenerated, onStatusChange });
    await flush();

    act(() => action("generate").click());
    expect(container.querySelector('[data-capability-id="cwf-15-kitchen-beo-generation"]')
      .getAttribute("data-capability-state")).toBe("submitting");
    expect(client.generateKitchenBeo).toHaveBeenCalledWith(SCOPE);

    const generated = result();
    await act(async () => {
      generation.resolve(generated);
      await generation.promise;
    });
    expect(container.querySelector('[data-capability-id="cwf-15-kitchen-beo-generation"]')
      .getAttribute("data-capability-state")).toBe("receipt");
    expect(container.textContent).toContain(generated.receipt.receiptId);
    expect(container.textContent).toContain("browser download was started");
    expect(client.downloadKitchenBeoArtifact).toHaveBeenCalledWith(ARTIFACT);
    expect(onGenerated).toHaveBeenCalledWith(generated);
    expect(onStatusChange).toHaveBeenLastCalledWith(generated.status);
  });

  test("shows the exact automatic Kitchen BEO dependency reconciliation outcome", async () => {
    client.generateKitchenBeo.mockResolvedValueOnce(result({
      dependencyReconciliation: {
        receiptId: `ccr_${"a".repeat(48)}`,
        applyReceiptId: `ccp_${"b".repeat(48)}`,
        resolvedInvalidationIds: [`cci_${"c".repeat(48)}`],
        resolvedCount: 1
      }
    }));
    mount();
    await flush();
    await clickAndFlush(action("generate"));

    expect(container.querySelector("[data-beo-dependency-reconciliation]")?.textContent)
      .toContain("resolved 1 current Kitchen BEO invalidation");
    expect(container.textContent).toContain("Other commercial decisions remain independently governed");
  });

  test("fails receipt history presentation closed without exposing download actions", async () => {
    client.getKitchenBeoArtifactStatus.mockResolvedValueOnce(status("UNKNOWN", {
      receiptId: "",
      receiptDependencyFingerprint: "",
      commercialSourceRevisionId: "",
      receiptHistory: {
        schemaVersion: 1,
        authority: "server_projection",
        state: "UNKNOWN",
        bounds: { limit: 10, returnedCount: 0, truncated: true },
        reasonCodes: ["receipt_history_evidence_invalid"],
        receipts: []
      }
    }));
    mount();
    await flush();

    expect(container.querySelector('[data-beo-receipt-history-state="UNKNOWN"]')).not.toBeNull();
    expect(container.textContent).toContain("No prior download is offered from untrusted history");
    expect(action("download-receipt")).toBeNull();
  });

  test("blocks duplicate dispatch before the busy render commits", async () => {
    const generation = deferred();
    client.generateKitchenBeo.mockReturnValueOnce(generation.promise);
    mount();
    await flush();
    const button = action("generate");
    act(() => {
      button.click();
      button.click();
    });
    expect(client.generateKitchenBeo).toHaveBeenCalledTimes(1);
    await act(async () => {
      generation.resolve(result());
      await generation.promise;
    });
  });

  test("locks an ambiguous outcome to its exact pending request and reconciles it unchanged", async () => {
    const exactAttempt = {
      ...SCOPE,
      requestId: `beo_request_${"d".repeat(32)}`,
      definitive: false,
      error: "connection lost"
    };
    client.generateKitchenBeo
      .mockImplementationOnce(async () => {
        pendingAttempt = exactAttempt;
        throw Object.assign(new Error("ambiguous transport"), { code: "functions/unavailable" });
      })
      .mockResolvedValueOnce(result({ idempotent: true, mutationMode: "reconciliation" }));
    mount();
    await flush();

    await clickAndFlush(action("generate"));
    expect(container.querySelector('[data-capability-state="uncertain"]')).not.toBeNull();
    expect(container.textContent).toContain("Do not create a second request");
    expect(container.textContent).not.toContain("ambiguous transport");

    await clickAndFlush(action("reconcile"));
    expect(client.generateKitchenBeo).toHaveBeenCalledTimes(2);
    expect(client.generateKitchenBeo.mock.calls[1][0]).toEqual(exactAttempt);
    expect(container.querySelector('[data-capability-state="receipt"]')).not.toBeNull();
    expect(container.textContent).toContain("Existing matching receipt confirmed");
  });

  test("restores a pending attempt on open instead of offering a second generation", async () => {
    pendingAttempt = {
      ...SCOPE,
      requestId: `beo_request_${"e".repeat(32)}`,
      definitive: false,
      error: ""
    };
    mount();
    await flush();
    expect(container.querySelector('[data-capability-state="uncertain"]')).not.toBeNull();
    expect(action("generate")).toBeNull();
    expect(action("reconcile")).not.toBeNull();
  });

  test("separates definitive rejection, safe reset, and recovery", async () => {
    client.generateKitchenBeo.mockImplementationOnce(async () => {
      pendingAttempt = {
        ...SCOPE,
        requestId: `beo_request_${"f".repeat(32)}`,
        definitive: true,
        error: "sensitive server detail"
      };
      throw Object.assign(new Error("sensitive server detail"), {
        code: "functions/failed-precondition"
      });
    });
    mount();
    await flush();
    await clickAndFlush(action("generate"));

    expect(container.querySelector('[data-capability-state="error"]')).not.toBeNull();
    expect(container.textContent).toContain("definitively rejected");
    expect(container.textContent).not.toContain("sensitive server detail");
    await clickAndFlush(action("reset"));
    expect(client.resetDefinitiveKitchenBeoAttempt).toHaveBeenCalledWith(SCOPE);
    expect(container.querySelector('[data-capability-state="recovery"]')).not.toBeNull();
    expect(action("generate").textContent).toBe("Start new generation");
  });

  test("keeps the trusted receipt visible when only the browser download fails", async () => {
    client.generateKitchenBeo.mockResolvedValueOnce(result());
    client.downloadKitchenBeoArtifact
      .mockImplementationOnce(() => { throw new Error("download blocked"); })
      .mockImplementationOnce(() => {});
    mount();
    await flush();
    await clickAndFlush(action("generate"));

    expect(container.querySelector('[data-capability-state="receipt"]')).not.toBeNull();
    expect(container.textContent).toContain("trusted server receipt remains recorded");
    expect(container.textContent).not.toContain("download blocked");
    await clickAndFlush(action("download"));
    expect(client.downloadKitchenBeoArtifact).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("browser download was started");
  });

  test("does not let presentation callback failures invalidate a trusted receipt", async () => {
    client.generateKitchenBeo.mockResolvedValueOnce(result());
    mount({
      onGenerated: () => { throw new Error("navigation callback failed"); },
      onStatusChange: () => { throw new Error("status callback failed"); }
    });
    await flush();
    expect(container.querySelector('[data-capability-state="success"]')).not.toBeNull();

    await clickAndFlush(action("generate"));
    expect(container.querySelector('[data-capability-state="receipt"]')).not.toBeNull();
    expect(container.textContent).toContain("Server generation receipt recorded");
    expect(container.textContent).not.toContain("navigation callback failed");
    expect(container.textContent).not.toContain("status callback failed");
  });

  test("ignores a stale status request after quote scope changes", async () => {
    const firstRead = deferred();
    client.getKitchenBeoArtifactStatus
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce(status("REVIEW", { commercialSourceRevisionId: "v0012" }));
    const onStatusChange = vi.fn();
    mount({ onStatusChange });
    mount({ quoteId: "quote-two", onStatusChange });
    await flush();
    expect(container.querySelector('[data-beo-freshness-state="REVIEW"]')).not.toBeNull();

    await act(async () => {
      firstRead.resolve(status("CURRENT", { commercialSourceRevisionId: "v0001" }));
      await firstRead.promise;
    });
    expect(container.querySelector('[data-beo-freshness-state="REVIEW"]')).not.toBeNull();
    expect(container.textContent).toContain("v0012");
    expect(container.textContent).not.toContain("v0001");
  });

  test("supports a focus-contained modal and explicit close", async () => {
    const onClose = vi.fn();
    mount({ presentation: "modal", onClose });
    await flush();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const close = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Close");
    await clickAndFlush(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("renders every literal canonical Kitchen BEO status-read marker through real reads", async () => {
    const initial = deferred();
    client.getKitchenBeoArtifactStatus.mockReturnValueOnce(initial.promise);
    mount();
    expect(container.innerHTML).toContain('data-capability-state="loading"');

    await act(async () => initial.resolve(status("CURRENT")));
    expect(container.innerHTML).toContain('data-capability-state="success"');

    client.getKitchenBeoArtifactStatus.mockResolvedValueOnce(status("NOT_GENERATED"));
    await clickAndFlush(action("refresh-status"));
    expect(container.innerHTML).toContain('data-capability-state="empty"');

    client.getKitchenBeoArtifactStatus.mockResolvedValueOnce(status("UNKNOWN"));
    await clickAndFlush(action("refresh-status"));
    expect(container.innerHTML).toContain('data-capability-state="partial"');

    client.getKitchenBeoArtifactStatus.mockRejectedValueOnce(new Error("read unavailable"));
    await clickAndFlush(action("refresh-status"));
    expect(container.innerHTML).toContain('data-capability-state="stale"');

    act(() => root.unmount());
    root = createRoot(container);
    client.getKitchenBeoArtifactStatus.mockRejectedValueOnce(new Error("initial unavailable"));
    mount();
    await flush();
    expect(container.innerHTML).toContain('data-capability-state="error"');

    const retry = deferred();
    client.getKitchenBeoArtifactStatus.mockReturnValueOnce(retry.promise);
    act(() => action("retry-status").click());
    expect(container.innerHTML).toContain('data-capability-state="recovery"');
    await act(async () => retry.resolve(status("CURRENT")));
  });

  test("renders every literal canonical Kitchen BEO generation marker", () => {
    const renderMutation = (stateName) => renderToStaticMarkup(
      <KitchenBeoMutationStatus
        mutation={{ state: stateName, statusRef: { current: null } }}
        onAction={() => {}}
        headingId={`generation-${stateName}`}
      />
    );

    expect(renderMutation("ready")).toContain('data-capability-state="ready"');
    expect(renderMutation("submitting")).toContain('data-capability-state="submitting"');
    expect(renderMutation("uncertain")).toContain('data-capability-state="uncertain"');
    expect(renderMutation("reconciliation")).toContain('data-capability-state="reconciliation"');
    expect(renderMutation("receipt")).toContain('data-capability-state="receipt"');
    expect(renderMutation("error")).toContain('data-capability-state="error"');
    expect(renderMutation("recovery")).toContain('data-capability-state="recovery"');
  });
});
