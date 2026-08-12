import React, { isValidElement } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import CustomerCommercialMeasures, {
  CustomerCommercialMeasuresPresentation,
  customerCommercialMeasuresPresentationState
} from "../CustomerCommercialMeasures";
import { buildCustomerCommercialMeasures } from "../../lib/customerCommercialMeasures";

function workspace(overrides = {}) {
  return {
    source: "firebase",
    customer: { id: "customer-1", customerId: "customer-1" },
    quotes: [],
    quotePageInfo: { limit: 25, truncated: false },
    ...overrides
  };
}

function quote({
  id,
  status,
  total,
  deposit = 0,
  eventDate = "",
  payment = {}
}) {
  return {
    id,
    customerId: "customer-1",
    status,
    totals: { total, deposit },
    event: { date: eventDate },
    payment: { depositStatus: "unpaid", ...payment }
  };
}

function elementText(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  if (!isValidElement(node)) return "";
  if (typeof node.type === "function") return elementText(node.type(node.props));
  return elementText(node.props.children);
}

function findElement(node, predicate) {
  if (!isValidElement(node)) return null;
  if (typeof node.type === "function") return findElement(node.type(node.props), predicate);
  if (predicate(node)) return node;
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const child of children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

const SUCCESS_WORKSPACE = workspace({
  quotes: [
    quote({ id: "accepted", status: "accepted", total: 500 }),
    quote({
      id: "booked-1",
      status: "booked",
      total: 1_000,
      deposit: 250,
      eventDate: "2025-08-10",
      payment: {
        depositStatus: "paid",
        depositConfirmedAtISO: "2025-06-01T14:00:00.000Z",
        finalBalance: {
          status: "paid",
          amountCents: 75_000,
          currency: "usd",
          confirmedAtISO: "2025-08-01T14:00:00.000Z"
        }
      }
    }),
    quote({ id: "booked-2", status: "booked", total: 200, eventDate: "2026-08-10" })
  ]
});

describe("Customer commercial measures presentation", () => {
  test("binds the real Customer 360 Overview to its existing retained-read state without another read", () => {
    const source = readFileSync(fileURLToPath(
      new URL("../CustomerWorkspaceView.jsx", import.meta.url)
    ), "utf8");
    const overviewStart = source.indexOf('<section id="customer-panel-overview"');
    const overviewEnd = source.indexOf('<section id="customer-panel-quotes"');
    const overviewSource = source.slice(overviewStart, overviewEnd);

    expect(source).toContain('import CustomerCommercialMeasures from "./CustomerCommercialMeasures";');
    expect(overviewSource).toContain("<CustomerCommercialMeasures");
    expect(overviewSource).toContain("workspace={workspace}");
    expect(overviewSource).toContain("loading={state.loading}");
    expect(overviewSource).toContain("error={state.error}");
    expect(overviewSource).toContain("stale={state.stale}");
    expect(overviewSource).toContain("onRetry={() => setRefreshToken((value) => value + 1)}");
    expect(overviewSource).not.toContain("getCustomerWorkspace");
    expect(overviewSource).not.toContain("buildCustomerCommercialMeasures");
  });

  test("binds the Customer 360 DTO to a polished, source-bounded successful view", () => {
    const markup = renderToStaticMarkup(
      <CustomerCommercialMeasures workspace={SUCCESS_WORKSPACE} />
    );

    expect(markup).toContain('data-capability-id="cwf-13-customer-commercial-measures"');
    expect(markup).toContain('data-capability-state="success"');
    expect(markup).toContain("Quotes, bookings, and payments");
    expect(markup).toContain("Source: Firestore customer workspace");
    expect(markup).toContain("3 customer-scoped quote records were evaluated");
    expect(markup).toContain("25-record bound");
    expect(markup).toContain("Quoted amount");
    expect(markup).toContain("$1,700.00");
    expect(markup).toContain("Accepted amount");
    expect(markup).toContain("$500.00");
    expect(markup).toContain("Booked amount");
    expect(markup).toContain("$1,200.00");
    expect(markup).toContain("Webhook-confirmed deposit amount");
    expect(markup).toContain("$250.00");
    expect(markup).toContain("Webhook-confirmed final-balance amount");
    expect(markup).toContain("$750.00");
    expect(markup).toContain("2 booked events");
    expect(markup).toContain("1 repeat booking after the first recorded event");
    expect(markup).toContain("Recorded event-date span: 365 days");
    expect(markup).toContain("Provider-confirmed payment requires a Firebase-backed read");
    expect(markup).toContain("Payment totals appear only when provider-confirmed");
    expect(markup).toContain("Do not treat these values as an accounting ledger");
    expect(markup.toLowerCase()).not.toContain("lifetime");
    expect(markup).not.toContain("Open quote");
  });

  test("renders a completed empty read without zero-value or commercial outcome claims", () => {
    const markup = renderToStaticMarkup(
      <CustomerCommercialMeasures workspace={workspace()} />
    );

    expect(markup).toContain('data-capability-state="empty"');
    expect(markup).toContain("0 customer-scoped quote records were evaluated");
    expect(markup).toContain("No eligible customer-linked quote records");
    expect(markup).not.toContain("$0.00");
    expect(markup.toLowerCase()).not.toContain("lifetime");
  });

  test("shows partial displayed-record scope, unknown amounts, and payment-evidence denominators", () => {
    const partialWorkspace = workspace({
      quotePageInfo: { limit: 25, truncated: true },
      quotes: [quote({
        id: "accepted-unknown",
        status: "accepted",
        total: "",
        deposit: "",
        payment: {
          depositStatus: "paid",
          depositConfirmedAtISO: "2026-08-09T10:00:00.000Z",
          finalBalance: {
            status: "paid",
            amountCents: 50_000,
            confirmedAtISO: ""
          }
        }
      })]
    });
    const markup = renderToStaticMarkup(
      <CustomerCommercialMeasures workspace={partialWorkspace} />
    );

    expect(markup).toContain('data-capability-state="partial"');
    expect(markup).toContain('data-commercial-measures-scope="displayed_records"');
    expect(markup).toContain("older linked records exist beyond this view");
    expect(markup).toContain("Older linked quotes are outside this displayed-record calculation");
    expect(markup).toContain("Amount unavailable");
    expect(markup).toContain("0 of 1 eligible displayed amounts are known; 1 is unavailable");
    expect(markup).toContain("1 paid-state record lacks trusted Firebase provider evidence");
    expect(markup.toLowerCase()).not.toContain("lifetime");
  });

  test("keeps browser-local quote and booking measures while withholding provider-confirmed payments", () => {
    const markup = renderToStaticMarkup(
      <CustomerCommercialMeasures workspace={workspace({
        source: "local",
        quotes: [quote({
          id: "browser-paid",
          status: "booked",
          total: 1_000,
          deposit: 250,
          eventDate: "2026-08-10",
          payment: {
            depositStatus: "paid",
            depositConfirmedAtISO: "2026-06-01T14:00:00.000Z",
            finalBalance: {
              status: "paid",
              amountCents: 75_000,
              currency: "usd",
              confirmedAtISO: "2026-08-01T14:00:00.000Z"
            }
          }
        })]
      })} />
    );

    expect(markup).toContain("Source: Browser-local customer workspace");
    expect(markup).toContain("Quoted amount");
    expect(markup).toContain("Booked amount");
    expect(markup.match(/\$1,000\.00/g)).toHaveLength(2);
    expect(markup.match(/Amount unavailable/g)).toHaveLength(2);
    expect(markup).toContain(
      "1 paid-state record lacks trusted Firebase provider evidence"
    );
    expect(markup).not.toContain("$250.00");
    expect(markup).not.toContain("$750.00");
  });

  test("exposes explicit loading, fatal error recovery, and stale retained-data states", () => {
    const onRetry = vi.fn();
    const loadingMarkup = renderToStaticMarkup(
      <CustomerCommercialMeasures loading />
    );
    const errorTree = CustomerCommercialMeasures({
      error: "backend internals should not render",
      onRetry
    });
    const errorMarkup = renderToStaticMarkup(errorTree);
    const retry = findElement(errorTree, (element) => (
      element.type === "button" && elementText(element) === "Retry"
    ));
    const staleMarkup = renderToStaticMarkup(
      <CustomerCommercialMeasures
        workspace={SUCCESS_WORKSPACE}
        stale
        error="refresh failed"
      />
    );

    expect(loadingMarkup).toContain('data-capability-state="loading"');
    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(loadingMarkup).toContain("Evaluating customer-scoped quote and payment evidence");
    expect(errorMarkup).toContain('data-capability-state="error"');
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain("No amount or repeat-event result is being shown");
    expect(errorMarkup).not.toContain("backend internals should not render");
    expect(retry.props["data-capability-state"]).toBe("recovery");
    retry.props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(staleMarkup).toContain('data-capability-state="stale"');
    expect(staleMarkup).toContain('data-model-state="success"');
    expect(staleMarkup).toContain("These retained totals may be stale");
    expect(staleMarkup).toContain("$1,700.00");
  });

  test("keeps a partial underlying model visible while a refresh is in progress", () => {
    const measures = buildCustomerCommercialMeasures(workspace({
      quotePageInfo: { limit: 25, truncated: true },
      quotes: [quote({ id: "quote-1", status: "accepted", total: 100 })]
    }));
    const markup = renderToStaticMarkup(
      <CustomerCommercialMeasuresPresentation measures={measures} loading />
    );

    expect(customerCommercialMeasuresPresentationState({ measures, loading: true }))
      .toBe("loading");
    expect(markup).toContain('data-capability-state="loading"');
    expect(markup).toContain('data-model-state="partial"');
    expect(markup).toContain('data-read-state="refreshing"');
    expect(markup).toContain("previous recorded totals remain visible");
    expect(markup).toContain("$100.00");
  });

  test("maps invalid Customer 360 identity to a safe presentation error", () => {
    const markup = renderToStaticMarkup(
      <CustomerCommercialMeasures workspace={workspace({ customer: { id: "person@example.com" } })} />
    );

    expect(markup).toContain('data-capability-state="error"');
    expect(markup).toContain("Recorded totals unavailable");
    expect(markup).not.toContain("opaque customerId");
  });
});
