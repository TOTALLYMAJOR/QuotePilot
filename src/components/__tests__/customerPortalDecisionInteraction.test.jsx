import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React, { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
  PortalDecisionMutationState,
  buildPortalDecisionAttempt,
  reconcilePortalDecisionSnapshot
} from "../CustomerPortalView";

const PORTAL_KEY = "portal_key_12345678901234567890";
const REVISION_ID = "v0014";
const ISSUED_AT = "2026-08-09T12:00:00.000Z";

function quote(overrides = {}) {
  return {
    portalKey: PORTAL_KEY,
    status: "viewed",
    portalIssuedAtISO: ISSUED_AT,
    deliveryEvidence: { revisionId: REVISION_ID },
    ...overrides
  };
}

function acceptanceAttempt() {
  return buildPortalDecisionAttempt({
    quote: quote(),
    decision: "accepted",
    message: "Please call before arrival.",
    signerName: "  Ada   Lovelace  "
  });
}

function findElement(node, predicate) {
  if (isValidElement(node) && predicate(node)) return node;
  if (!isValidElement(node)) return null;
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const child of children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

describe("customer portal decision reconciliation", () => {
  test("freezes the exact reviewed issuance and normalized signature input", () => {
    const attempt = acceptanceAttempt();

    expect(attempt).toEqual({
      portalKey: PORTAL_KEY,
      decision: "accepted",
      message: "Please call before arrival.",
      signerName: "Ada Lovelace",
      consentVersion: "proposal-acceptance-v1",
      expectedRevisionId: REVISION_ID,
      expectedPortalIssuedAtISO: ISSUED_AT
    });
    expect(Object.isFrozen(attempt)).toBe(true);
  });

  test("recognizes only an acceptance receipt bound to the exact signer and source", () => {
    const attempt = acceptanceAttempt();
    const snapshot = quote({
      status: "accepted",
      portalDecision: { decision: "accepted" },
      acceptanceReceipt: {
        receiptId: "acceptance-1",
        signerName: "Ada Lovelace",
        consentVersion: "proposal-acceptance-v1",
        quoteRevisionId: REVISION_ID,
        portalIssuedAtISO: ISSUED_AT
      }
    });

    expect(reconcilePortalDecisionSnapshot(attempt, snapshot)).toEqual({
      phase: "receipt",
      receiptKind: "electronic_acceptance",
      receiptId: "acceptance-1"
    });
    expect(reconcilePortalDecisionSnapshot(attempt, {
      ...snapshot,
      acceptanceReceipt: { ...snapshot.acceptanceReceipt, signerName: "Grace Hopper" }
    })).toEqual({ phase: "error", reason: "different_terminal_decision" });
  });

  test("detects a changed source before permitting another signature attempt", () => {
    const attempt = acceptanceAttempt();
    const snapshot = quote({
      deliveryEvidence: { revisionId: "v0015" },
      portalIssuedAtISO: "2026-08-09T13:00:00.000Z"
    });

    expect(reconcilePortalDecisionSnapshot(attempt, snapshot)).toEqual({
      phase: "stale",
      reason: "proposal_source_changed"
    });
  });

  test("reconciles a recorded change request without calling it an acceptance receipt", () => {
    const attempt = buildPortalDecisionAttempt({
      quote: quote(),
      decision: "changes_requested",
      message: "Please update the guest count."
    });
    const snapshot = quote({
      portalDecision: {
        decision: "changes_requested",
        message: "Please update the guest count.",
        requestId: "request-1",
        submittedAtISO: "2026-08-09T12:05:00.000Z"
      }
    });

    expect(reconcilePortalDecisionSnapshot(attempt, snapshot)).toEqual({
      phase: "receipt",
      receiptKind: "portal_decision",
      receiptId: "request-1"
    });
  });
});

describe("customer portal decision presentation", () => {
  test.each([
    ["ready", "ready", "Ready for your decision"],
    ["submitting", "submitting", "Recording your decision"],
    ["uncertain", "uncertain", "Decision outcome needs confirmation"],
    ["reconciliation", "reconciliation", "Checking the recorded decision"],
    ["receipt", "receipt", "Electronic acceptance recorded"],
    ["error", "error", "Decision not recorded"]
  ])("renders the %s state through the live decision seam", (phase, capabilityState, copy) => {
    const markup = renderToStaticMarkup(
      <PortalDecisionMutationState
        mutation={{
          phase,
          receiptKind: phase === "receipt" ? "electronic_acceptance" : "",
          receiptId: phase === "receipt" ? "acceptance-1" : ""
        }}
      />
    );

    expect(markup).toContain(`data-capability-state="${capabilityState}"`);
    expect(markup).toContain(copy);
  });

  test("renders stale review and explicit same-attempt recovery without auto retry", () => {
    const onReconcile = vi.fn();
    const uncertainTree = PortalDecisionMutationState({
      mutation: { phase: "uncertain" },
      onReconcile
    });
    const uncertainMarkup = renderToStaticMarkup(uncertainTree);
    const button = findElement(uncertainTree, (element) => (
      element.type === "button" && element.props["data-capability-state"] === "recovery"
    ));
    const staleMarkup = renderToStaticMarkup(
      <PortalDecisionMutationState mutation={{ phase: "stale" }} />
    );

    expect(uncertainMarkup).toContain("Check the same response before trying again");
    expect(uncertainMarkup).toContain('data-capability-state="recovery"');
    button.props.onClick();
    expect(onReconcile).toHaveBeenCalledOnce();
    expect(staleMarkup).toContain('data-decision-state="stale"');
    expect(staleMarkup).toContain("prior signature input was not applied");
  });

  test("keeps electronic acceptance distinct from payment and booking", () => {
    const markup = renderToStaticMarkup(
      <PortalDecisionMutationState mutation={{
        phase: "receipt",
        receiptKind: "electronic_acceptance",
        receiptId: "acceptance-1"
      }} />
    );

    expect(markup).toContain("the proposal you reviewed");
    expect(markup).toContain("Payment and booking remain separate");
    expect(markup).not.toContain("Event booked");
    expect(markup).not.toContain("Payment received");
  });

  test("uses focusable feedback, no browser persistence, and the reduced-motion stylesheet", () => {
    const componentSource = readFileSync(
      fileURLToPath(new URL("../CustomerPortalView.jsx", import.meta.url)),
      "utf8"
    );
    const styleSource = readFileSync(
      fileURLToPath(new URL("../../styles.css", import.meta.url)),
      "utf8"
    );

    expect(componentSource).toContain("decisionFeedbackRef.current");
    expect(componentSource).toContain('tabIndex={phase === "ready" ? undefined : -1}');
    expect(componentSource).toContain("reconcilePortalDecisionSnapshot(attempt, refreshed)");
    expect(componentSource).not.toMatch(/localStorage\.(?:setItem|getItem).*decision/i);
    expect(styleSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styleSource).toContain(".portal-decision-state");
  });
});
