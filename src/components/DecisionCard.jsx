import StatusChip from "./StatusChip";

// Shared decision-grammar card: one claim sentence, its evidence chip, and the
// actions that resolve it. Presentation-only — every action is delegated to
// the caller, and nothing here reads or mutates records.
export default function DecisionCard({
  signal = "attend",
  family = "",
  label = "",
  title,
  meta = "",
  sentence,
  basis = "",
  impact = "",
  actions = [],
  onAction
}) {
  return (
    <article className="now-card" data-signal={signal}>
      <span className="now-card-signal" aria-hidden="true" />
      <div className="now-card-body">
        <div className="now-card-head">
          <p className="now-card-title">{title}</p>
          {meta ? <p className="now-card-meta">{meta}</p> : null}
        </div>
        <p className="now-card-sentence">{sentence}</p>
        {basis ? <p className="now-card-basis">Based on: {basis}</p> : null}
        {impact ? <p className="now-card-impact">{impact}</p> : null}
        <div className="now-card-foot">
          {family ? <StatusChip family={family} label={label} /> : null}
          <div className="now-card-actions">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={action.kind === "primary" ? "cta" : "ghost"}
                onClick={() => onAction?.(action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
