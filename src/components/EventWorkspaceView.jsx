import { forwardRef, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarBlank,
  ChatCircle,
  ClipboardText,
  FilePdf,
  ListChecks,
  PencilSimple,
  UserCircle,
  UsersThree,
  Armchair
} from "@phosphor-icons/react";
import { buildEventWorkspacePresentation } from "./eventWorkspacePresentation";
import { buildCascadePresentation } from "./cascadePresentation";
import { buildDecideStack } from "./decideStackPresentation";
import { formatWorkspaceMoney } from "../lib/workspacePresentation";
import DecisionCard from "./DecisionCard";
import ReadinessRing from "./ReadinessRing";
import StatusChip from "./StatusChip";

// Default-off presentation gate for the pilot Event Room dressing (readiness
// ring + advisory decide stack). Absent or unrecognized values keep it off;
// it never widens data access or authority.
const PILOT_EVENT_ROOM_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_EVENT_ROOM_ENABLED || "").trim().toLowerCase()
);

function buildQuoteSummaryRows(totals) {
  if (!totals || !Number.isFinite(Number(totals.total)) || Number(totals.total) <= 0) return null;
  const part = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const subtotal = part(totals.base) + part(totals.addons) + part(totals.rentals)
    + part(totals.menu) + part(totals.labor) + part(totals.travel);
  const feePct = Number(totals.serviceFeePctApplied);
  const taxPct = Number(totals.taxRateApplied);
  const rows = [
    { id: "subtotal", label: "Subtotal", value: formatWorkspaceMoney(subtotal) },
    {
      id: "service-fee",
      label: Number.isFinite(feePct) && feePct > 0 ? `Service charge (${Math.round(feePct * 100)}%)` : "Service charge",
      value: formatWorkspaceMoney(totals.serviceFee, { emptyLabel: "$0.00" })
    },
    {
      id: "tax",
      label: Number.isFinite(taxPct) && taxPct > 0 ? `Tax (${(taxPct * 100).toFixed(2).replace(/\.?0+$/, "")}%)` : "Tax",
      value: formatWorkspaceMoney(totals.tax, { emptyLabel: "$0.00" })
    }
  ];
  return {
    rows,
    total: formatWorkspaceMoney(totals.total),
    deposit: Number.isFinite(Number(totals.deposit)) && Number(totals.deposit) > 0
      ? formatWorkspaceMoney(totals.deposit)
      : ""
  };
}

const CONTEXT_ICONS = {
  schedule: CalendarBlank,
  staffing: UsersThree,
  rentals: Armchair,
  production: ClipboardText,
  customer: UserCircle
};

function ContextCard({ id, title, detail, actionLabel, disabled = false, onClick }) {
  const Icon = CONTEXT_ICONS[id] || ListChecks;
  const interactive = typeof onClick === "function";
  const content = (
    <>
      <span className="event-context-icon" aria-hidden="true"><Icon size={22} weight="duotone" /></span>
      <span className="event-context-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {interactive && !disabled && <ArrowRight size={18} aria-hidden="true" />}
      {disabled && <span className="event-context-unavailable">Unavailable</span>}
    </>
  );

  if (!interactive) {
    return <div className="event-context-card" data-context={id}>{content}</div>;
  }
  return (
    <button
      type="button"
      className="event-context-card event-context-button"
      data-context={id}
      onClick={onClick}
      disabled={disabled}
      aria-label={`${actionLabel || title}: ${detail}`}
    >
      {content}
    </button>
  );
}

const EventWorkspaceView = forwardRef(function EventWorkspaceView({
  quote,
  source,
  ordinaryEditAllowed = false,
  scheduleAvailable = false,
  beoAvailable = false,
  conversationAvailable = false,
  exportingPdf = false,
  onBackToQuotes,
  onEditQuote,
  onMoreQuoteActions,
  onOpenWorkflow,
  onOpenSchedule,
  onOpenCustomer,
  onOpenBeo,
  onExportPdf,
  onOpenConversation,
  pilotEventRoom = PILOT_EVENT_ROOM_ENABLED
}, forwardedRef) {
  const soldScopeRef = useRef(null);
  const model = buildEventWorkspacePresentation(quote, {
    source,
    ordinaryEditAllowed
  });
  const decideStack = pilotEventRoom
    ? buildDecideStack(quote, { ordinaryEditAllowed })
    : null;
  const cascade = pilotEventRoom ? buildCascadePresentation(quote) : null;

  const runDecideAction = (action) => {
    if (action?.kind === "edit") {
      onEditQuote?.(quote);
      return;
    }
    onMoreQuoteActions?.();
  };

  const runNextAction = () => {
    if (model.nextAction.kind === "workflow") {
      onOpenWorkflow?.(model.nextAction.target);
      return;
    }
    if (model.nextAction.kind === "edit") {
      onEditQuote?.(quote);
      return;
    }
    onMoreQuoteActions?.();
  };

  const focusSoldScope = () => {
    soldScopeRef.current?.focus({ preventScroll: false });
    soldScopeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const quoteSummary = buildQuoteSummaryRows(quote?.totals);

  return (
    <article
      className="event-workspace saved-quote-handoff"
      data-quote-id={model.quoteId}
      ref={forwardedRef}
      tabIndex={-1}
      aria-labelledby="event-workspace-title"
      aria-describedby="event-workspace-evidence"
    >
      <button type="button" className="event-back-link" onClick={onBackToQuotes}>
        <ArrowLeft size={18} aria-hidden="true" />
        Back to Quotes
      </button>

      <header className="event-identity">
        <div className="event-identity-copy">
          <p className="eyebrow">{model.quoteNumber} · {model.sourceLabel}</p>
          <div className="event-title-row">
            <h1 id="event-workspace-title">{model.eventName}</h1>
            <StatusChip {...model.status} />
          </div>
          <p className="event-venue">{model.venue}</p>
          <dl className="event-key-facts" aria-label="Event facts">
            <div><dt>Customer</dt><dd>{model.customerName}</dd></div>
            <div><dt>Date</dt><dd>{model.eventDate}</dd></div>
            <div><dt>Time</dt><dd>{model.eventTime}</dd></div>
            <div><dt>Guests</dt><dd>{model.guests}</dd></div>
            <div><dt>Quoted total</dt><dd>{model.total}</dd></div>
          </dl>
        </div>
        <div className="event-primary-actions" aria-label="Event actions">
          {model.ordinaryEditAllowed && (
            <button type="button" className="cta" onClick={() => onEditQuote?.(quote)}>
              <PencilSimple size={18} aria-hidden="true" />
              Edit quote
            </button>
          )}
          <button type="button" className="ghost" onClick={onMoreQuoteActions}>
            More actions
          </button>
        </div>
      </header>

      <div className="event-workspace-body">
      <div className="event-main-col">
      <section className="event-triage-grid" aria-label="Current event condition and next action">
        <div className={`event-condition-card is-${model.attention.state}`}>
          <p className="eyebrow">Current condition</p>
          <strong>{model.attention.title}</strong>
          <p>{model.attention.detail}</p>
        </div>
        <div className="event-next-action-card">
          <p className="eyebrow">{model.intelligence.needsYou.state === "attention" ? "Needs you" : "Next action"}</p>
          <strong>{model.nextAction.title}</strong>
          <p>{model.nextAction.detail}</p>
          <button type="button" className="event-inline-action" onClick={runNextAction}>
            {model.nextAction.label}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      </section>

      {decideStack && !decideStack.suppressed && decideStack.cards.length > 0 && (
        <section
          className="event-decide-stack"
          aria-labelledby="event-decide-title"
          data-decide-stack={decideStack.modelId}
        >
          <div className="event-section-heading">
            <div>
              <p className="eyebrow">Decide</p>
              <h2 id="event-decide-title">Advisory decisions on this record</h2>
            </div>
            <p>{decideStack.boundsNote}</p>
          </div>
          <div className="now-stream">
            {decideStack.cards.map((card) => (
              <DecisionCard
                key={card.id}
                signal={card.signal}
                family={card.family}
                label={card.label}
                title={card.title}
                meta={card.meta}
                sentence={card.sentence}
                basis={card.basis}
                impact={card.impact}
                actions={[{ ...card.action, kind: card.action.kind === "edit" ? "primary" : "secondary", label: card.action.label }]}
                onAction={() => runDecideAction(card.action)}
              />
            ))}
          </div>
        </section>
      )}

      <section
        className="event-intelligence"
        aria-labelledby="event-intelligence-title"
        data-event-intelligence="deterministic-presentation-v1"
      >
        <div className="event-section-heading">
          <div>
            <p className="eyebrow">Quote insights</p>
            <h2 id="event-intelligence-title">Decision support</h2>
          </div>
          <p>Existing evidence only. Unsupported conclusions stay unavailable.</p>
        </div>
        <div className="event-intelligence-strip">
          <div
            className="event-intelligence-dimension"
            data-intelligence-dimension="readiness"
            data-intelligence-state={model.intelligence.readiness.state}
            style={{ "--readiness-score": model.intelligence.readiness.score }}
          >
            <span>{model.intelligence.readiness.label}</span>
            {pilotEventRoom ? (
              <ReadinessRing
                score={model.intelligence.readiness.score}
                label={model.intelligence.readiness.label}
                sublabel={model.intelligence.readiness.statusLabel}
              />
            ) : (
              <>
                <strong>{model.intelligence.readiness.score}%</strong>
                <small>{model.intelligence.readiness.statusLabel}</small>
                <progress max="100" value={model.intelligence.readiness.score}>
                  {model.intelligence.readiness.score}%
                </progress>
              </>
            )}
            <em>{model.intelligence.readiness.scopeLabel}</em>
          </div>
          <div
            className="event-intelligence-dimension is-unavailable"
            data-intelligence-dimension="flexibility"
            data-intelligence-state={model.intelligence.flexibility.state}
          >
            <span>{model.intelligence.flexibility.label}</span>
            <strong>{model.intelligence.flexibility.statusLabel}</strong>
            <small>Change-window evidence is not available.</small>
          </div>
          <div
            className="event-intelligence-dimension is-unavailable"
            data-intelligence-dimension="alignment"
            data-intelligence-state={model.intelligence.alignment.state}
          >
            <span>{model.intelligence.alignment.label}</span>
            <strong>{model.intelligence.alignment.statusLabel}</strong>
            <small>Combined integrity evidence is not available.</small>
          </div>
        </div>
        <details className="event-intelligence-why">
          <summary>Why?</summary>
          <div className="event-intelligence-evidence">
            <section>
              <h3>Proposal readiness</h3>
              <p>{model.intelligence.readiness.detail}</p>
              {model.intelligence.readiness.gaps.length > 0 && (
                <p><strong>Gaps:</strong> {model.intelligence.readiness.gaps.map((gap) => gap.label).join(", ")}</p>
              )}
            </section>
            <section>
              <h3>Flexibility</h3>
              <p>{model.intelligence.flexibility.detail}</p>
            </section>
            <section>
              <h3>Alignment</h3>
              <p>{model.intelligence.alignment.detail}</p>
            </section>
            <section>
              <h3>Evidence boundary</h3>
              <p>{model.intelligence.evidence.bounds}. Source: {model.intelligence.evidence.source}.</p>
              <p className="event-reason-codes">
                <strong>Reason codes:</strong>{" "}
                {model.intelligence.evidence.reasonCodes.map((code) => <code key={code}>{code}</code>)}
              </p>
            </section>
          </div>
        </details>
      </section>

      <section className="event-section" aria-labelledby="event-context-title">
        <div className="event-section-heading">
          <div>
            <p className="eyebrow">Event context</p>
            <h2 id="event-context-title">Open the record you need</h2>
          </div>
          <p>Shortcuts preserve each surface's existing authority.</p>
        </div>
        <div className="event-context-grid">
          <ContextCard
            id="schedule"
            {...model.context.schedule}
            actionLabel="Open Schedule"
            onClick={onOpenSchedule}
            disabled={!scheduleAvailable}
          />
          <ContextCard id="staffing" {...model.context.staffing} />
          <ContextCard
            id="rentals"
            {...model.context.rentals}
            actionLabel="Review sold rentals"
            onClick={focusSoldScope}
          />
          <ContextCard
            id="production"
            {...model.context.production}
            actionLabel="Open Production BEO"
            onClick={onOpenBeo}
            disabled={!beoAvailable}
          />
          <ContextCard
            id="customer"
            {...model.context.customer}
            actionLabel="Open Customer"
            onClick={onOpenCustomer}
            disabled={!model.customerId || typeof onOpenCustomer !== "function"}
          />
        </div>
      </section>

      <section
        className="event-section event-sold-scope"
        aria-labelledby="event-scope-title"
        ref={soldScopeRef}
        tabIndex={-1}
      >
        <div className="event-section-heading">
          <div>
            <p className="eyebrow">Sold scope</p>
            <h2 id="event-scope-title">What this quote records</h2>
          </div>
          <span className="event-type-chip">{model.eventTypeLabel}</span>
        </div>
        <dl className="event-scope-list">
          {model.soldScope.map((item) => (
            <div key={item.id} data-scope={item.id}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
              {item.detail && <small>{item.detail}</small>}
            </div>
          ))}
        </dl>
      </section>
      </div>

      <aside className="event-side-rail" aria-label="Quote summary and progress">
        {quoteSummary && (
          <section className="event-section event-summary-card" aria-labelledby="event-summary-title">
            <p className="eyebrow" id="event-summary-title">Quote summary</p>
            <dl className="event-summary-rows">
              {quoteSummary.rows.map((row) => (
                <div key={row.id} data-summary-row={row.id}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="event-summary-total">
              <span>Total</span>
              <strong>{quoteSummary.total}</strong>
            </div>
            {quoteSummary.deposit && (
              <div className="event-summary-deposit">
                <span>Deposit due</span>
                <strong>{quoteSummary.deposit}</strong>
              </div>
            )}
          </section>
        )}

        <section className="event-section event-lifecycle" aria-labelledby="event-lifecycle-title">
          <div className="event-section-heading">
            <div>
              <p className="eyebrow">Lifecycle</p>
              <h2 id="event-lifecycle-title">Quote progress</h2>
            </div>
          </div>
          <ol>
            {model.lifecycle.map((milestone) => (
              <li key={milestone.id} className={`is-${milestone.state}`}>
                <span className="event-lifecycle-marker" aria-hidden="true" />
                <span><strong>{milestone.label}</strong><small>{milestone.dateLabel}</small></span>
              </li>
            ))}
          </ol>
        </section>

        {cascade?.applicable && (
          <section
            className="event-section event-cascade"
            aria-labelledby="event-cascade-title"
            data-cascade={cascade.modelId}
          >
            <div className="event-section-heading">
              <div>
                <p className="eyebrow">The cascade</p>
                <h2 id="event-cascade-title">{cascade.headline}</h2>
              </div>
            </div>
            <p className="event-cascade-progress">{cascade.progressLabel}</p>
            <ol className="event-cascade-steps">
              {cascade.steps.map((item) => (
                <li key={item.id} data-cascade-state={item.state}>
                  <span className="event-cascade-mark" aria-hidden="true">
                    {item.state === "done" ? "✓" : item.state === "blocked" ? "✕" : "○"}
                  </span>
                  <span className="event-cascade-copy">
                    <strong>{item.label}</strong>
                    <small>{item.detail}{item.timeLabel ? ` · ${item.timeLabel}` : ""}</small>
                  </span>
                </li>
              ))}
            </ol>
            <p className="source-note">{cascade.boundsNote}</p>
          </section>
        )}
      </aside>
      </div>

      <footer className="event-workspace-footer">
        <div>
          <p id="event-workspace-evidence" className="source-note">{model.evidenceNote}</p>
          <p className="source-note">{model.editBoundary}</p>
        </div>
        <div className="event-secondary-actions">
          {typeof onExportPdf === "function" && (
            <button type="button" className="ghost compact" onClick={onExportPdf} disabled={exportingPdf}>
              <FilePdf size={18} aria-hidden="true" />
              {exportingPdf ? "Generating PDF..." : "Download PDF"}
            </button>
          )}
          {conversationAvailable && (
            <button type="button" className="ghost compact" onClick={onOpenConversation}>
              <ChatCircle size={18} aria-hidden="true" />
              Conversation
            </button>
          )}
        </div>
      </footer>
    </article>
  );
});

export default EventWorkspaceView;
