import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";
import {
  AcceptanceCeremonyReceipt,
  PaymentStatusCeremonyBlock,
  ceremonyMotionDisabled,
  isFreshAcceptanceTransition,
  isFreshPaymentConfirmationTransition
} from "../CustomerPortalView";

const PORTAL_KEY = "portal_key_12345678901234567890";

function acceptedQuote(overrides = {}) {
  return {
    portalKey: PORTAL_KEY,
    status: "accepted",
    acceptanceReceipt: {
      receiptId: "acceptance-1",
      signerName: "Ada Lovelace",
      acceptedAtISO: "2026-08-09T12:00:00.000Z",
      quoteRevisionId: "v0014"
    },
    ...overrides
  };
}

describe("acceptance ceremony transition detection", () => {
  test("fires only when the same live proposal moves into the accepted family", () => {
    expect(isFreshAcceptanceTransition(
      { portalKey: PORTAL_KEY, status: "viewed" },
      { portalKey: PORTAL_KEY, status: "accepted" }
    )).toBe(true);
    expect(isFreshAcceptanceTransition(
      { portalKey: PORTAL_KEY, status: "sent" },
      { portalKey: PORTAL_KEY, status: "booked" }
    )).toBe(true);
  });

  test("never fires on first observation of an already-accepted quote", () => {
    expect(isFreshAcceptanceTransition(null, { portalKey: PORTAL_KEY, status: "accepted" })).toBe(false);
    expect(isFreshAcceptanceTransition(undefined, { portalKey: PORTAL_KEY, status: "booked" })).toBe(false);
    expect(isFreshAcceptanceTransition(
      { portalKey: "", status: "" },
      { portalKey: PORTAL_KEY, status: "accepted" }
    )).toBe(false);
  });

  test("ignores repeats, downstream accepted states, cross-quote jumps, and non-acceptance", () => {
    expect(isFreshAcceptanceTransition(
      { portalKey: PORTAL_KEY, status: "accepted" },
      { portalKey: PORTAL_KEY, status: "accepted" }
    )).toBe(false);
    // accepted -> booked is a downstream transition, not a fresh acceptance.
    expect(isFreshAcceptanceTransition(
      { portalKey: PORTAL_KEY, status: "accepted" },
      { portalKey: PORTAL_KEY, status: "booked" }
    )).toBe(false);
    // Loading a different (already accepted) quote in the same session.
    expect(isFreshAcceptanceTransition(
      { portalKey: "portal_key_other_000000000000", status: "viewed" },
      { portalKey: PORTAL_KEY, status: "accepted" }
    )).toBe(false);
    expect(isFreshAcceptanceTransition(
      { portalKey: PORTAL_KEY, status: "viewed" },
      { portalKey: PORTAL_KEY, status: "declined" }
    )).toBe(false);
  });
});

describe("payment confirmation transition detection", () => {
  test("fires only on a live transition into confirmed", () => {
    expect(isFreshPaymentConfirmationTransition("checking", "confirmed")).toBe(true);
    expect(isFreshPaymentConfirmationTransition("cancelled", "confirmed")).toBe(true);
    expect(isFreshPaymentConfirmationTransition("idle", "confirmed")).toBe(true);
  });

  test("stays quiet without a prior live observation or outside confirmed", () => {
    expect(isFreshPaymentConfirmationTransition(null, "confirmed")).toBe(false);
    expect(isFreshPaymentConfirmationTransition(undefined, "confirmed")).toBe(false);
    expect(isFreshPaymentConfirmationTransition("", "confirmed")).toBe(false);
    expect(isFreshPaymentConfirmationTransition("confirmed", "confirmed")).toBe(false);
    expect(isFreshPaymentConfirmationTransition("checking", "pending")).toBe(false);
    expect(isFreshPaymentConfirmationTransition("checking", "failed")).toBe(false);
  });
});

describe("ceremonyMotionDisabled", () => {
  afterEach(() => {
    delete globalThis.window;
  });

  test("skips ceremony work without a window (SSR) and honors prefers-reduced-motion", () => {
    expect(ceremonyMotionDisabled()).toBe(true);
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    expect(ceremonyMotionDisabled()).toBe(true);
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    expect(ceremonyMotionDisabled()).toBe(false);
    globalThis.window = { matchMedia: () => { throw new Error("unavailable"); } };
    expect(ceremonyMotionDisabled()).toBe(false);
  });
});

describe("acceptance receipt static render (already-accepted quotes)", () => {
  test("keeps the exact pre-ceremony receipt markup with no ceremony artifacts", () => {
    const markup = renderToStaticMarkup(<AcceptanceCeremonyReceipt quote={acceptedQuote()} />);

    expect(markup).toContain('class="portal-decision-note-receipt portal-signature-receipt"');
    expect(markup).toContain("Signed by <strong>Ada Lovelace</strong>");
    expect(markup).toContain("Receipt acceptance-1");
    expect(markup).not.toContain("portal-ceremony");
    expect(markup).not.toContain("shimmer-reveal");
  });

  test("renders nothing before an acceptance receipt exists", () => {
    expect(renderToStaticMarkup(
      <AcceptanceCeremonyReceipt quote={{ portalKey: PORTAL_KEY, status: "viewed" }} />
    )).toBe("");
    expect(renderToStaticMarkup(
      <AcceptanceCeremonyReceipt quote={acceptedQuote({ acceptanceReceipt: null })} />
    )).toBe("");
    expect(renderToStaticMarkup(
      <AcceptanceCeremonyReceipt quote={acceptedQuote({ status: "declined" })} />
    )).toBe("");
  });
});

describe("payment status static render", () => {
  test("keeps the exact pre-ceremony payment block when no return flow is live", () => {
    const markup = renderToStaticMarkup(
      <PaymentStatusCeremonyBlock
        payment={{ depositStatus: "sent" }}
        confirmationState="idle"
        confirmationMessage=""
      />
    );

    expect(markup).toContain('class="portal-payment-state"');
    expect(markup).toContain("Deposit requested");
    expect(markup).not.toContain("portal-ceremony");
    expect(markup).not.toContain("shimmer-reveal");
    expect(markup).not.toContain("<svg");
  });

  test("shows the instantly-final checkmark when confirmed without a live transition", () => {
    const markup = renderToStaticMarkup(
      <PaymentStatusCeremonyBlock
        payment={{ depositStatus: "paid", depositConfirmedAtISO: "2026-08-09" }}
        confirmationState="confirmed"
        confirmationMessage="Payment confirmed—your deposit has been received."
      />
    );

    expect(markup).toContain('class="portal-ceremony-check"');
    expect(markup).not.toContain("portal-ceremony-check-drawing");
    expect(markup).not.toContain("portal-ceremony-host");
    expect(markup).not.toContain("shimmer-reveal");
    expect(markup).toContain("Payment confirmed");
  });
});

describe("ceremony discipline", () => {
  const componentSource = readFileSync(
    fileURLToPath(new URL("../CustomerPortalView.jsx", import.meta.url)),
    "utf8"
  );
  const ceremonyCss = readFileSync(
    fileURLToPath(new URL("../portalCeremony.css", import.meta.url)),
    "utf8"
  );

  test("plays exactly one cue per ceremony through the central sound router", () => {
    expect(componentSource.match(/playCue\("seal"\)/g)).toHaveLength(1);
    expect(componentSource.match(/playCue\("chime", "positive"\)/g)).toHaveLength(1);
    expect(componentSource).not.toContain("shimmerChime");
    // Both ceremony shimmers stay muted so the ceremony cue is the only sound.
    expect(componentSource.match(/sound=\{false\}/g)).toHaveLength(2);
  });

  test("uses the shared motion tokens and respects reduced motion", () => {
    expect(ceremonyCss).toContain("var(--motion-slow)");
    expect(ceremonyCss).toContain("var(--motion-base)");
    expect(ceremonyCss).toContain("var(--ease-spring)");
    expect(ceremonyCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(componentSource).toContain("ceremonyMotionDisabled()");
    expect(componentSource).toContain("PORTAL_CEREMONY_SETTLE_MS");
  });
});
