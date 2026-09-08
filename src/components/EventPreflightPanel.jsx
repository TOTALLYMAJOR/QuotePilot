function PreflightList({ title, tone, items }) {
  return (
    <section className={`event-preflight-column event-preflight-${tone}`} aria-labelledby={`preflight-${tone}-title`}>
      <div className="event-preflight-column-heading">
        <h3 id={`preflight-${tone}-title`}>{title}</h3>
        <span>{items.length}</span>
      </div>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.domain}</span>
              <strong>{item.title}</strong>
              {tone === "attention" ? (
                <>
                  <p>{item.detail}</p>
                  <small>{item.evidence}</small>
                </>
              ) : (
                <details>
                  <summary>Why this is classified here</summary>
                  <p>{item.detail}</p>
                  <small>{item.evidence}</small>
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : <p>None established by the current evidence.</p>}
    </section>
  );
}

export default function EventPreflightPanel({ model }) {
  if (!model) return null;
  return (
    <section className="event-preflight" data-event-preflight={model.state} aria-labelledby="event-preflight-title">
      <div className="event-preflight-heading">
        <div>
          <p className="eyebrow">Event Preflight</p>
          <h2 id="event-preflight-title">{model.title}</h2>
          <p role="status" aria-live="polite" aria-atomic="true">{model.summary}</p>
        </div>
        <span className={`event-preflight-state event-preflight-state-${model.state}`}>{model.state === "attention" ? "Needs attention" : "Evidence incomplete"}</span>
      </div>
      <div className="event-preflight-grid">
        <PreflightList title="Ready / satisfied facts" tone="satisfied" items={model.satisfied} />
        <PreflightList title="Needs attention" tone="attention" items={model.attention} />
        <PreflightList title="Unknown / unavailable" tone="unknown" items={model.unknown} />
      </div>
      <p className="event-preflight-boundary">{model.boundary}</p>
    </section>
  );
}
