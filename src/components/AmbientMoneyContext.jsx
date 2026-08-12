import "./ambientMoneyContext.css";

const STATE_LABELS = Object.freeze({
  recorded: "Requirement recorded",
  not_requested: "Not requested",
  provider_request_recorded: "Request recorded",
  superseded_by_settlement: "Payment recorded separately",
  not_settled: "Not settled",
  provider_confirmed_paid: "Payment confirmed by provider",
  provider_confirmed_refund: "Refund confirmed by provider",
  recorded_unverified: "Recorded in QuotePilot; not independently confirmed",
  unavailable: "Payment details need review"
});

function currencyFromCents(cents, currency) {
  if (!Number.isSafeInteger(cents) || cents < 0) return "Amount unavailable";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "usd").toUpperCase()
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function percentage(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(value * 100 % 1 === 0 ? 0 : 1)}% of quote total`
    : "Policy percentage unavailable";
}

function stageMeta(stage, currency) {
  const amount = currencyFromCents(stage.amountCents, currency);
  if (stage.id === "deposit-policy") return `${amount} · ${percentage(stage.percentage)}`;
  return amount;
}

export default function AmbientMoneyContext({ model }) {
  const stages = Array.isArray(model?.stages) ? model.stages : [];
  const descriptor = model?.descriptor;
  if (!descriptor || stages.length !== 5) {
    return (
      <section
        className="ambient-money-context ambient-money-context--unavailable"
        role="alert"
        data-surface-purpose="clarify reveal_context"
      >
        <strong>Payment details are unavailable</strong>
        <p>Refresh this opportunity before relying on its deposit, request, or settlement status.</p>
      </section>
    );
  }

  return (
    <section
      className="ambient-money-context"
      data-ambient-intelligent-object="money"
      data-money-source={model.sourceMode}
      data-surface-purpose="clarify reveal_context"
    >
      <header className="ambient-money-context__intro">
        <p className="eyebrow">Payment stages</p>
        <p>{model.boundary}</p>
      </header>

      <ol className="ambient-money-context__rail" aria-label="Payment stages">
        {stages.map((stage, index) => (
          <li
            key={stage.id}
            className={`ambient-money-context__stage is-${stage.state}`}
            data-money-stage={stage.id}
            data-money-stage-state={stage.state}
          >
            <span className="ambient-money-context__index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="ambient-money-context__stage-copy">
              <div className="ambient-money-context__stage-heading">
                <h3>{stage.label}</h3>
                <span className="ambient-money-context__state">
                  {STATE_LABELS[stage.state] || "State unavailable"}
                </span>
              </div>
              <strong className="ambient-money-context__amount">
                {stageMeta(stage, model.currency)}
              </strong>
              <p>{stage.reason}</p>
              <small>{stage.consequence}</small>
            </div>
          </li>
        ))}
      </ol>

      <dl className="ambient-money-context__judgment">
        <div>
          <dt>Why this is shown</dt>
          <dd>{descriptor.why}</dd>
        </div>
        <div>
          <dt>If nothing changes</dt>
          <dd>{descriptor.doNothing}</dd>
        </div>
        <div>
          <dt>Confidence and source</dt>
          <dd>
            <strong>{descriptor.confidence.level}</strong>
            <span>{descriptor.confidence.basis}</span>
          </dd>
        </div>
      </dl>

      <aside className="ambient-money-context__next" aria-label="What you can do next">
        <span>What you can do next</span>
        <strong>{model.nextResolution}</strong>
      </aside>
    </section>
  );
}
