import { describe, expect, test } from "vitest";
import {
  CASCADE_BOUNDS_NOTE,
  CASCADE_MODEL,
  buildCascadePresentation
} from "../cascadePresentation";

function acceptedQuote(overrides = {}) {
  return {
    status: "accepted",
    activeVersionId: "v0006",
    acceptanceReceipt: { receiptId: "pa_1234567890abcdef" },
    lifecycle: { acceptedAtISO: "2026-08-12T15:04:00.000Z" },
    booking: {},
    payment: { depositStatus: "unpaid" },
    workflow: {},
    ...overrides
  };
}

function stepById(result, id) {
  return result.steps.find((item) => item.id === id);
}

describe("buildCascadePresentation", () => {
  test("does not apply before acceptance", () => {
    for (const status of ["draft", "sent", "viewed", "declined", "expired"]) {
      const result = buildCascadePresentation({ status });
      expect(result.applicable).toBe(false);
      expect(result.steps).toEqual([]);
    }
    expect(buildCascadePresentation({}).modelId).toBe(CASCADE_MODEL);
  });

  test("reports acceptance, retained version, and pending steps from recorded evidence only", () => {
    const result = buildCascadePresentation(acceptedQuote());
    expect(result.applicable).toBe(true);
    expect(result.headline).toBe("Accepted — the cascade so far");
    expect(result.boundsNote).toBe(CASCADE_BOUNDS_NOTE);
    expect(stepById(result, "accepted").state).toBe("done");
    expect(stepById(result, "accepted").detail).toContain("pa_1234567890a");
    expect(stepById(result, "version").detail).toContain("v0006");
    expect(stepById(result, "contract").state).toBe("pending");
    expect(stepById(result, "deposit-request").state).toBe("pending");
    expect(stepById(result, "deposit-request").detail).toContain("approval-gated");
    expect(stepById(result, "staff-lead").state).toBe("pending");
    expect(stepById(result, "final-balance")).toBeUndefined();
  });

  test("keeps deposit request and provider payment as separate truths", () => {
    const sent = buildCascadePresentation(acceptedQuote({ payment: { depositStatus: "sent" } }));
    expect(stepById(sent, "deposit-request").state).toBe("done");
    expect(stepById(sent, "deposit-paid").state).toBe("pending");
    expect(stepById(sent, "deposit-paid").detail).toContain("provider");

    const paid = buildCascadePresentation(acceptedQuote({
      payment: { depositStatus: "paid", depositConfirmedAtISO: "2026-08-13T10:00:00.000Z" }
    }));
    expect(stepById(paid, "deposit-paid").state).toBe("done");
    expect(stepById(paid, "deposit-paid").detail).toContain("Provider-confirmed");
    expect(stepById(paid, "deposit-paid").timeLabel).not.toBe("");
  });

  test("adds booked-only steps and gates the final balance on the paid deposit", () => {
    const booked = buildCascadePresentation(acceptedQuote({
      status: "booked",
      booking: {
        contractNumber: "C-260812-00001",
        contractConvertedAtISO: "2026-08-12T15:05:00.000Z",
        confirmationStatus: "sent",
        confirmationSentAtISO: "2026-08-12T15:06:00.000Z",
        availabilityCheckedAtISO: "2026-08-12T15:06:30.000Z",
        staffLead: "Marcus"
      },
      payment: { depositStatus: "unpaid" },
      workflow: {}
    }));
    expect(booked.headline).toBe("Booked — the cascade so far");
    expect(stepById(booked, "contract").state).toBe("done");
    expect(stepById(booked, "confirmation").label).toBe("Confirmation sent");
    expect(stepById(booked, "availability").state).toBe("done");
    expect(stepById(booked, "staff-lead").label).toBe("Staff lead: Marcus");
    expect(stepById(booked, "final-balance").state).toBe("pending");
    expect(stepById(booked, "final-balance").detail).toContain("after the deposit is provider-confirmed");
    expect(stepById(booked, "closeout").state).toBe("pending");
  });

  test("recognizes a settled booking end to end", () => {
    const settled = buildCascadePresentation(acceptedQuote({
      status: "booked",
      booking: {
        contractNumber: "C-260812-00001",
        confirmationStatus: "confirmed",
        confirmedAtISO: "2026-08-13T09:00:00.000Z",
        availabilityCheckedAtISO: "2026-08-12T15:06:30.000Z",
        staffLead: "Marcus"
      },
      payment: {
        depositStatus: "paid",
        depositConfirmedAtISO: "2026-08-13T10:00:00.000Z",
        finalBalance: { status: "paid" }
      },
      workflow: { postEventCloseout: { closeoutId: "closeout-1" } }
    }));
    expect(settled.steps.every((item) => item.state === "done")).toBe(true);
    expect(settled.progressLabel).toBe(`${settled.steps.length} of ${settled.steps.length} steps recorded`);
  });

  test("marks a cancelled confirmation as blocked without inventing a recovery claim", () => {
    const cancelled = buildCascadePresentation(acceptedQuote({
      booking: { confirmationStatus: "cancelled" }
    }));
    expect(stepById(cancelled, "confirmation").state).toBe("blocked");
    expect(stepById(cancelled, "confirmation").detail).toContain("recorded confirmation state is cancelled");
  });
});
